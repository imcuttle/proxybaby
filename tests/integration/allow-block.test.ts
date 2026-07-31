import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleEngine } from '../../electron/engine/rule-engine';
import { PluginManager } from '../../electron/engine/plugins';
import { ProxyServer } from '../../electron/proxy/proxy-server';
import { AllowBlockStore, setAllowBlockStore } from '../../electron/engine/allow-block';
import { makeEntry } from '../../electron/engine/filter-entry';

function httpViaProxy(proxyPort: number, targetUrl: string) {
  return new Promise<{ status: number; body: string; ok: boolean }>((resolve) => {
    const u = new URL(targetUrl);
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: targetUrl, headers: { Host: u.host } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), ok: true }));
    });
    req.on('error', () => resolve({ status: 0, body: '', ok: false }));
    req.end();
  });
}

const listsDir = path.join(os.tmpdir(), 'proxybaby-test', 'lists');
beforeEach(() => { fs.rmSync(listsDir, { recursive: true, force: true }); });
afterEach(() => { fs.rmSync(listsDir, { recursive: true, force: true }); setAllowBlockStore(null); });

async function setupTarget() {
  const target = http.createServer((_, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const tp = (target.address() as any).port;
  return {
    tp,
    stop: () => new Promise<void>((r) => target.close(() => r())),
    url: (p: string) => `http://127.0.0.1:${tp}${p}`,
  };
}

describe('allow / block list 插件', () => {
  it('黑名单：命中 host 直接失败', async () => {
    const target = await setupTarget();
    const store = new AllowBlockStore();
    setAllowBlockStore(store);
    store.set({ mode: 'block', entries: [makeEntry('host', '127.0.0.1')] });

    const eng = new RuleEngine();
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    try {
      const r = await httpViaProxy(pp, target.url('/x'));
      expect(r.ok).toBe(false);   // 连接被中断
    } finally { await proxy.stop(); await target.stop(); }
  });

  it('白名单：未在列表中 abort', async () => {
    const target = await setupTarget();
    const store = new AllowBlockStore();
    setAllowBlockStore(store);
    store.set({ mode: 'allow', entries: [makeEntry('host', 'example.com')] });

    const eng = new RuleEngine();
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    try {
      const r = await httpViaProxy(pp, target.url('/y'));
      expect(r.ok).toBe(false);
    } finally { await proxy.stop(); await target.stop(); }
  });

  it('通配 *.host 匹配', () => {
    const store = new AllowBlockStore();
    store.set({ mode: 'block', entries: [makeEntry('host', '*.tracker.com')] });
    expect(store.decide({ host: 'x.tracker.com' }).allow).toBe(false);
    expect(store.decide({ host: 'tracker.com' }).allow).toBe(false);
    expect(store.decide({ host: 'other.com' }).allow).toBe(true);
  });

  it('URL 类目在请求阶段生效（block 模式）', () => {
    const store = new AllowBlockStore();
    store.set({
      mode: 'block',
      entries: [makeEntry('url', 'https://api.foo.com/*')],
    });
    expect(
      store.decide({ host: 'api.foo.com', url: 'https://api.foo.com/v1/x', method: 'GET' }).allow,
    ).toBe(false);
    expect(
      store.decide({ host: 'other.com', url: 'https://other.com/x' }).allow,
    ).toBe(true);
  });

  it('App 类目匹配', () => {
    const store = new AllowBlockStore();
    store.set({ mode: 'block', entries: [makeEntry('app', 'Google Chrome')] });
    expect(store.decide({ host: 'x.com', appName: 'Google Chrome' }).allow).toBe(false);
    expect(store.decide({ host: 'x.com', appName: 'Firefox' }).allow).toBe(true);
  });

  it('从旧 hosts 数组自动升级为 entries', () => {
    fs.mkdirSync(listsDir, { recursive: true });
    fs.writeFileSync(
      path.join(listsDir, 'allowblock.json'),
      JSON.stringify({ mode: 'block', hosts: ['a.com', '*.b.com'] }),
    );
    const store = new AllowBlockStore();
    const cfg = store.get();
    expect(cfg.entries).toHaveLength(2);
    expect(cfg.entries[0]).toMatchObject({ kind: 'host', value: 'a.com', enabled: true });
    // 二次落盘为新格式
    const raw = JSON.parse(fs.readFileSync(path.join(listsDir, 'allowblock.json'), 'utf8'));
    expect(Array.isArray(raw.entries)).toBe(true);
    expect(raw.hosts).toBeUndefined();
  });

  it('模式关闭时全部放行', async () => {
    const target = await setupTarget();
    const store = new AllowBlockStore();
    setAllowBlockStore(store);
    store.set({ mode: 'off', entries: [makeEntry('host', '127.0.0.1')] });

    const eng = new RuleEngine();
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    try {
      const r = await httpViaProxy(pp, target.url('/z'));
      expect(r.ok).toBe(true);
      expect(r.status).toBe(200);
    } finally { await proxy.stop(); await target.stop(); }
  });
});
