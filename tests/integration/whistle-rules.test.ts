import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleEngine } from '../../electron/engine/rule-engine';
import { PluginManager } from '../../electron/engine/plugins';
import { ProxyServer } from '../../electron/proxy/proxy-server';

function httpViaProxy(proxyPort: number, targetUrl: string, opts: { method?: string; headers?: any; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: any }>((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: opts.method || 'GET', path: targetUrl, headers: { Host: u.host, ...(opts.headers || {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// 每个测试用独立 rules 目录（RuleEngine 读 app.getPath()/rules）
const rulesDir = path.join(os.tmpdir(), 'proxybaby-test', 'rules');
beforeEach(() => { fs.rmSync(rulesDir, { recursive: true, force: true }); });
afterEach(() => { fs.rmSync(rulesDir, { recursive: true, force: true }); });

describe('whistle rules — CRUD 与持久化', () => {
  it('增删改查 + 启用切换', () => {
    const eng = new RuleEngine();
    const rs = eng.add('测试集', 'a.com/x  abort', true);
    expect(eng.list()).toHaveLength(1);
    expect(eng.get(rs.id)?.rules).toHaveLength(1);

    eng.update(rs.id, { text: 'a.com/x  statusCode://404\nb.com/y  abort' });
    expect(eng.get(rs.id)?.rules).toHaveLength(2);

    eng.setEnabled(rs.id, false);
    expect(eng.get(rs.id)?.enabled).toBe(false);

    eng.remove(rs.id);
    expect(eng.list()).toHaveLength(0);
  });

  it('磁盘持久化：新引擎实例能加载已存规则', () => {
    const eng1 = new RuleEngine();
    const rs = eng1.add('持久化集', 'x.com  mock://{"p":1}', true);
    // 新实例从磁盘重新加载
    const eng2 = new RuleEngine();
    const loaded = eng2.get(rs.id);
    expect(loaded).toBeTruthy();
    expect(loaded?.name).toBe('持久化集');
    expect(loaded?.rules[0].pattern).toBe('x.com');
  });

  it('多规则集 + 组解析', () => {
    const eng = new RuleEngine();
    eng.add('集A', '[分组1]\na.com  abort', true);
    eng.add('集B', 'b.com  abort', false);
    expect(eng.list()).toHaveLength(2);
    const a = eng.list().find((s) => s.name === '集A')!;
    expect(a.rules[0].group).toBe('分组1');
  });
});

describe('whistle rules — 经代理端到端生效', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

  async function setupWithRules(ruleText: string, enabled = true) {
    const target = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-orig': 'server' });
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => res.end(JSON.stringify({ real: true, path: req.url, reqAuth: req.headers['authorization'] || null })));
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;

    const eng = new RuleEngine();
    // 规则里用真实目标端口
    eng.add('e2e', ruleText.replace(/__PORT__/g, String(tp)), enabled);
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });
    return { tp, pp, url: (p: string) => `http://127.0.0.1:${tp}${p}` };
  }

  it('mock:// 短路返回，不打上游', async () => {
    const s = await setupWithRules('127.0.0.1/mock  mock://{"mocked":true}');
    const r = await httpViaProxy(s.pp, s.url('/mock'));
    expect(JSON.parse(r.body).mocked).toBe(true);
    expect(JSON.parse(r.body).real).toBeUndefined();
  });

  it('mock:// 短路：事件顺序 flow:start → flow:response-headers → flow:response-body → flow:end；flow.edited=true', async () => {
    const events: { name: string; payload: any }[] = [];
    // 重新 setup，本 case 需要拿 proxy 引用挂 listener
    const target = http.createServer((_req, res) => { res.writeHead(200); res.end('real'); });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const eng = new RuleEngine();
    eng.add('e2e', '127.0.0.1/m  mock://{"a":1}', true);
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    for (const name of ['flow:start', 'flow:response-headers', 'flow:response-body', 'flow:end']) {
      (proxy as any).on(name, (payload: any) => events.push({ name, payload }));
    }
    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/m`);
    expect(JSON.parse(r.body).a).toBe(1);

    const names = events.map((e) => e.name);
    expect(names.indexOf('flow:start')).toBeLessThan(names.indexOf('flow:response-headers'));
    expect(names.indexOf('flow:response-headers')).toBeLessThan(names.indexOf('flow:response-body'));
    expect(names.indexOf('flow:response-body')).toBeLessThan(names.indexOf('flow:end'));

    // 已编辑标记：flow:start 事件里的 flow 已经带上 edited/matchedRules
    const startFlow = events.find((e) => e.name === 'flow:start')!.payload;
    expect(startFlow.edited).toBe(true);
    expect(startFlow.matchedRules?.length).toBeGreaterThan(0);

    // response-body 里带有 mock 内容
    const bodyEvt = events.find((e) => e.name === 'flow:response-body')!.payload;
    expect(bodyEvt.bodyText).toBe('{"a":1}');
    expect(bodyEvt.bodySize).toBe(7);
  });

  it('statusCode:// 改状态码', async () => {
    const s = await setupWithRules('127.0.0.1/code  statusCode://503');
    const r = await httpViaProxy(s.pp, s.url('/code'));
    expect(r.status).toBe(503);
  });

  it('reqHeaders:// 注入到上游', async () => {
    const s = await setupWithRules('127.0.0.1/auth  reqHeaders://{"Authorization":"Bearer T"}');
    const r = await httpViaProxy(s.pp, s.url('/auth'));
    expect(JSON.parse(r.body).reqAuth).toBe('Bearer T');
  });

  it('resHeaders:// 改响应头', async () => {
    const s = await setupWithRules('127.0.0.1/rh  resHeaders://{"X-Injected":"1"}');
    const r = await httpViaProxy(s.pp, s.url('/rh'));
    expect(r.headers['x-injected']).toBe('1');
  });

  it('resBody:// 改响应体', async () => {
    const s = await setupWithRules('127.0.0.1/rb  resBody://{"replaced":1}');
    const r = await httpViaProxy(s.pp, s.url('/rb'));
    expect(JSON.parse(r.body).replaced).toBe(1);
  });

  it('abort 中断连接', async () => {
    const s = await setupWithRules('127.0.0.1/kill  abort');
    await expect(httpViaProxy(s.pp, s.url('/kill'))).rejects.toBeTruthy();
  });

  it('redirect:// 返回 302', async () => {
    const s = await setupWithRules('127.0.0.1/old  redirect://http://127.0.0.1/new');
    const r = await httpViaProxy(s.pp, s.url('/old'));
    expect(r.status).toBe(302);
    expect(r.headers['location']).toContain('/new');
  });

  it('resDelay:// 增加延迟', async () => {
    const s = await setupWithRules('127.0.0.1/slow  resDelay://120');
    const t0 = Date.now();
    await httpViaProxy(s.pp, s.url('/slow'));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });

  it('禁用的规则集不生效', async () => {
    const s = await setupWithRules('127.0.0.1/mock  mock://{"mocked":true}', false);
    const r = await httpViaProxy(s.pp, s.url('/mock'));
    expect(JSON.parse(r.body).real).toBe(true);   // 走到真实上游
  });

  it('未匹配的路径透传', async () => {
    const s = await setupWithRules('127.0.0.1/only  abort');
    const r = await httpViaProxy(s.pp, s.url('/other'));
    expect(JSON.parse(r.body).real).toBe(true);
  });
});
