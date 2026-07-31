import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleEngine } from '../../electron/engine/rule-engine';
import { PluginManager } from '../../electron/engine/plugins';
import { ProxyServer } from '../../electron/proxy/proxy-server';
import { ScriptStore, setScriptStore } from '../../electron/engine/scripts';

function httpViaProxy(proxyPort: number, targetUrl: string, opts: { method?: string; headers?: any; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: any }>((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: opts.method || 'GET',
      path: targetUrl,
      headers: { Host: u.host, ...(opts.headers || {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const rulesDir = path.join(os.tmpdir(), 'proxybaby-test', 'rules');
const scriptsDir = path.join(os.tmpdir(), 'proxybaby-test', 'scripts');
beforeEach(() => {
  fs.rmSync(rulesDir, { recursive: true, force: true });
  fs.rmSync(scriptsDir, { recursive: true, force: true });
});
afterEach(() => {
  fs.rmSync(rulesDir, { recursive: true, force: true });
  fs.rmSync(scriptsDir, { recursive: true, force: true });
  setScriptStore(null);
});

async function setupTarget() {
  const target = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        real: true,
        path: req.url,
        headers: {
          authorization: req.headers['authorization'] || null,
          'x-script': req.headers['x-script'] || null,
        },
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const tp = (target.address() as any).port;
  return {
    tp,
    stop: () => new Promise<void>((r) => target.close(() => r())),
    url: (p: string) => `http://127.0.0.1:${tp}${p}`,
  };
}

describe('scripts plugin — script:// 操作符', () => {
  it('可修改请求头与响应体', async () => {
    const target = await setupTarget();

    const scripts = new ScriptStore();
    setScriptStore(scripts);
    const s = scripts.add('inject', `
module.exports = {
  onRequest(pb) {
    pb.setReqHeader('X-Script', 'yes');
  },
  onResponse(pb) {
    if (pb.response) {
      const parsed = JSON.parse(pb.response.bodyText || '{}');
      parsed.rewritten = true;
      pb.response.bodyText = JSON.stringify(parsed);
    }
  },
};
`);

    const eng = new RuleEngine();
    eng.add('with-script', `127.0.0.1/test  script://${s.id}`, true);
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;

    try {
      const r = await httpViaProxy(pp, target.url('/test'));
      const body = JSON.parse(r.body);
      expect(body.rewritten).toBe(true);        // onResponse 改成功
      expect(body.headers['x-script']).toBe('yes'); // 上游确实收到脚本注入的头
    } finally {
      await proxy.stop();
      await target.stop();
    }
  });

  it('respond() 短路直接返回，不打上游', async () => {
    const target = await setupTarget();

    const scripts = new ScriptStore();
    setScriptStore(scripts);
    const s = scripts.add('short', `
module.exports = {
  onRequest(pb) {
    pb.respond({ status: 418, bodyText: '{"teapot":true}' });
  },
};
`);
    const eng = new RuleEngine();
    eng.add('short', `127.0.0.1  script://${s.id}`, true);
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    try {
      const r = await httpViaProxy(pp, target.url('/x'));
      expect(r.status).toBe(418);
      expect(JSON.parse(r.body).teapot).toBe(true);
    } finally { await proxy.stop(); await target.stop(); }
  });

  it('通过 name 引用；disabled 时透传', async () => {
    const target = await setupTarget();
    const scripts = new ScriptStore();
    setScriptStore(scripts);
    scripts.add('by-name', `
module.exports = {
  onResponse(pb) { pb.response.bodyText = '{"named":true}'; }
};
`);
    // 手动禁用
    const rec = scripts.list()[0];
    scripts.update(rec.id, { enabled: false });

    const eng = new RuleEngine();
    eng.add('n', '127.0.0.1  script://by-name', true);
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    try {
      const r = await httpViaProxy(pp, target.url('/x'));
      expect(JSON.parse(r.body).real).toBe(true);    // 透传，脚本未生效
      expect(JSON.parse(r.body).named).toBeUndefined();
    } finally { await proxy.stop(); await target.stop(); }
  });

  it('语法错误的脚本不会阻塞请求', async () => {
    const target = await setupTarget();
    const scripts = new ScriptStore();
    setScriptStore(scripts);
    const s = scripts.add('bad', `this is not valid javascript !!!`);

    const eng = new RuleEngine();
    eng.add('bad', `127.0.0.1  script://${s.id}`, true);
    const pm = new PluginManager(eng);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: pm });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    try {
      const r = await httpViaProxy(pp, target.url('/x'));
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).real).toBe(true);
    } finally { await proxy.stop(); await target.stop(); }
  });
});
