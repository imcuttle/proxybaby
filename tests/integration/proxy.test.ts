import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { ProxyServer } from '../../electron/proxy/proxy-server';
import { buildOpsMiddlewares } from '../../electron/engine/operators';
import { BreakpointController } from '../../electron/engine/breakpoint';
import { ensureRootCA, issueLeaf } from '../../electron/mitm/ca';
import type { PluginManager } from '../../electron/engine/plugins';

function fakePlugins(mws: any[], hints?: { needsReqBodyBuffer?: boolean; needsResBodyBuffer?: boolean }): PluginManager {
  return {
    collectMiddlewares: () => ({
      middlewares: mws,
      matched: [],
      hints: {
        needsReqBodyBuffer: hints?.needsReqBodyBuffer ?? true,
        needsResBodyBuffer: hints?.needsResBodyBuffer ?? true,
      },
    }),
  } as unknown as PluginManager;
}

function httpViaProxy(proxyPort: number, targetUrl: string, opts: { method?: string; headers?: any; body?: string | Buffer } = {}) {
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

function httpsViaProxy(proxyPort: number, host: string, port: number, path: string, caPem: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const connectReq = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `${host}:${port}` });
    connectReq.on('connect', (_res, socket) => {
      const t = tls.connect({ socket, servername: host, ca: [caPem] }, () => {
        t.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      });
      const chunks: Buffer[] = [];
      t.on('data', (d) => chunks.push(d));
      t.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const [head, ...rest] = raw.split('\r\n\r\n');
        const status = Number(head.split('\r\n')[0].split(' ')[1]) || 0;
        const m = rest.join('\r\n\r\n').match(/\{[\s\S]*\}/);
        try { t.destroy(); socket.destroy(); } catch {}
        resolve({ status, body: m ? m[0] : '' });
      });
      t.on('error', reject);
    });
    connectReq.on('error', reject);
    connectReq.end();
  });
}

let caPem = '';
beforeAll(async () => { caPem = (await ensureRootCA()).certPem; });

// 每个用例自己起 server，afterEach 收尾在各 it 内 await stop。
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

describe('代理引擎集成', () => {
  it('HTTP 透传', async () => {
    const target = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ real: true, url: req.url })); });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/hello`);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).real).toBe(true);
  });

  it('HTTPS MITM 全解密', async () => {
    const leaf = issueLeaf('localhost');
    const target = https.createServer({ key: leaf.keyPem, cert: leaf.certPem }, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ secure: true, path: req.url })); });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    const bodies: any[] = [];
    proxy.on('flow:response-body', (p: any) => bodies.push(p));
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpsViaProxy(pp, 'localhost', tp, '/secure', caPem);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).secure).toBe(true);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
  });

  it('SSE 逐帧流式转发', async () => {
    const target = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      let n = 0;
      const t = setInterval(() => { n++; res.write(`data: {"chunk":${n}}\n\n`); if (n >= 3) { clearInterval(t); res.write('data: [DONE]\n\n'); res.end(); } }, 15);
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    const frames: any[] = [];
    proxy.on('flow:sse-frame', (p: any) => frames.push(p.frame));
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/stream`);
    expect(r.status).toBe(200);
    expect(frames.length).toBe(4);
    expect(frames[0].data).toBe('{"chunk":1}');
  });

  it('SSE + 大请求体（3MB POST）：请求体透传上游后 SSE 帧正常', async () => {
    // 回归：AI chat 场景，POST 请求体常 > 2MB（对话历史/系统 prompt/附件），
    // 上游据此生成 SSE 响应。旧实现请求体被截断 → 上游 400 → SSE 建不起来。
    const size = 3 * 1024 * 1024;
    const payload = Buffer.alloc(size, 0x43); // 3MB 'C'
    let received: Buffer | null = null;
    const target = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received = Buffer.concat(chunks);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write('data: {"chunk":1}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    const frames: any[] = [];
    proxy.on('flow:sse-frame', (p: any) => frames.push(p.frame));
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(size) },
      body: payload,
    });
    expect(r.status).toBe(200);
    expect(received).not.toBeNull();
    expect(received!.length).toBe(size);           // 请求体字节完整
    expect(frames.length).toBe(2);                 // SSE 帧全部收到
    expect(frames[0].data).toBe('{"chunk":1}');
  });

  it('操作符：statusCode/resHeaders/resBody 改写响应', async () => {
    const target = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ orig: true })); });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: fakePlugins(buildOpsMiddlewares([{ op: 'statusCode', value: '201' }, { op: 'resHeaders', value: '{"X-Added":"1"}' }, { op: 'resBody', value: '{"replaced":true}' }])) });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/a`);
    expect(r.status).toBe(201);
    expect(r.headers['x-added']).toBe('1');
    expect(JSON.parse(r.body).replaced).toBe(true);
  });

  it('操作符：ua/reqBody 注入到上游', async () => {
    const echo = http.createServer((req, res) => { const c: Buffer[] = []; req.on('data', (x) => c.push(x)); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ua: req.headers['user-agent'], reqBody: Buffer.concat(c).toString() })); }); });
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
    const tp = (echo.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: fakePlugins(buildOpsMiddlewares([{ op: 'ua', value: 'CustomUA' }, { op: 'reqBody', value: 'INJECTED' }])) });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); echo.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/b`, { method: 'POST', body: 'orig' });
    const j = JSON.parse(r.body);
    expect(j.ua).toBe('CustomUA');
    expect(j.reqBody).toBe('INJECTED');
  });

  it('操作符：abort 中断连接', async () => {
    const target = http.createServer((_req, res) => res.end('x'));
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: fakePlugins(buildOpsMiddlewares([{ op: 'abort' }])) });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    await expect(httpViaProxy(pp, `http://127.0.0.1:${tp}/d`)).rejects.toBeTruthy();
  });

  it('操作符：mock 短路不打上游', async () => {
    let hit = 0;
    const target = http.createServer((_req, res) => { hit++; res.end('real'); });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: fakePlugins(buildOpsMiddlewares([{ op: 'mock', value: '{"mock":1}' }])) });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/m`);
    expect(JSON.parse(r.body).mock).toBe(1);
    expect(hit).toBe(0);
  });

  it('断点：请求阶段注入 header', async () => {
    const echo = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ injected: req.headers['x-injected'] || null })); });
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
    const tp = (echo.address() as any).port;
    const bp = new BreakpointController(); bp.setEnabled(true);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: fakePlugins(buildOpsMiddlewares([{ op: 'breakpoint', value: 'req' }])), breakpointController: bp });
    proxy.on('flow:breakpoint', (p: any) => setTimeout(() => bp.resume({ id: p.id, stage: p.stage, action: 'continue', headers: [...p.request.headers, { name: 'x-injected', value: 'yes' }] }), 20));
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); echo.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/bp`);
    expect(JSON.parse(r.body).injected).toBe('yes');
  });

  it('断点：响应阶段改状态码', async () => {
    const echo = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
    const tp = (echo.address() as any).port;
    const bp = new BreakpointController(); bp.setEnabled(true);
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, plugins: fakePlugins(buildOpsMiddlewares([{ op: 'breakpoint', value: 'res' }])), breakpointController: bp });
    proxy.on('flow:breakpoint', (p: any) => setTimeout(() => bp.resume({ id: p.id, stage: p.stage, action: 'continue', status: 418, headers: p.response?.headers }), 20));
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); echo.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/bp2`);
    expect(r.status).toBe(418);
  });

  it('录制关闭：透传且不产出 flow', async () => {
    const target = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ url: req.url })); });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    proxy.setRecording(false);
    let started = 0;
    proxy.on('flow:start', () => started++);
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/g`);
    expect(JSON.parse(r.body).url).toBe('/g');
    expect(started).toBe(0);
  });

  it('WebSocket 双向抓帧', async () => {
    const crypto = await import('node:crypto');
    const wsServer = http.createServer();
    wsServer.on('upgrade', (req, socket) => {
      const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const payload = Buffer.from('pong-from-server');
      socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
    });
    await new Promise<void>((r) => wsServer.listen(0, '127.0.0.1', r));
    const wp = (wsServer.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    const msgs: any[] = [];
    proxy.on('flow:ws-message', (p: any) => msgs.push(p.message));
    cleanups.push(async () => {
      try { (wsServer as any).closeAllConnections?.(); } catch {}
      try { wsServer.close(); } catch {}
      // WS 隧道的上游 socket 不受 server 管理，stop 可能挂起 → 加超时兜底
      await Promise.race([proxy.stop(), new Promise<void>((r) => setTimeout(r, 800))]);
    });

    await new Promise<void>((resolve) => {
      const client = net.connect(pp, '127.0.0.1', () => {
        client.write(`GET http://127.0.0.1:${wp}/ws HTTP/1.1\r\nHost: 127.0.0.1:${wp}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        let got = false;
        client.on('data', (d) => {
          if (!got && d.includes(Buffer.from('101'))) {
            got = true;
            const p = Buffer.from('hi-from-client');
            const k = Buffer.from([9, 8, 7, 6]);
            const mp = Buffer.alloc(p.length);
            for (let i = 0; i < p.length; i++) mp[i] = p[i] ^ k[i % 4];
            client.write(Buffer.concat([Buffer.from([0x81, 0x80 | p.length]), k, mp]));
          }
        });
        setTimeout(() => { client.destroy(); resolve(); }, 300);
      });
    });
    expect(msgs.some((m) => m.direction === 'recv' && m.text === 'pong-from-server')).toBe(true);
    expect(msgs.some((m) => m.direction === 'send' && m.text === 'hi-from-client')).toBe(true);
  });
});
