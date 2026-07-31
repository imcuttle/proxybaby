import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import { ProxyServer } from '../../electron/proxy/proxy-server';
import type { Flow } from '../../shared/types';

/**
 * 真实发请求经代理，验证各种 content-type / 编码 / 状态 的抓取与解析。
 */

interface Captured { flow?: Flow }

function httpViaProxy(proxyPort: number, targetUrl: string, opts: { method?: string; headers?: any; body?: string | Buffer } = {}) {
  return new Promise<{ status: number; body: Buffer; headers: any }>((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: opts.method || 'GET', path: targetUrl, headers: { Host: u.host, ...(opts.headers || {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

// 起一个可返回多种内容的目标 server + 抓包代理，返回工具集
async function setup(handler: http.RequestListener) {
  const target = http.createServer(handler);
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const tp = (target.address() as any).port;
  const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
  await proxy.start();
  const pp = (proxy as any).server.address().port;
  const flows: Flow[] = [];
  proxy.on('flow:start', (f: Flow) => flows.push(f));
  cleanups.push(async () => { await proxy.stop(); target.close(); });
  // 请求发起后，flow 对象会被后续事件就地更新；直接读取即可
  return { tp, pp, proxy, flows, url: (p: string) => `http://127.0.0.1:${tp}${p}` };
}

describe('各类型抓包', () => {
  it('JSON 响应正确解析为文本', async () => {
    const s = await setup((_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, n: 42 })); });
    await httpViaProxy(s.pp, s.url('/json'));
    const f = s.flows.find((x) => x.request.path === '/json')!;
    expect(f.response?.bodyText).toContain('"ok":true');
  });

  it('gzip 响应自动解压', async () => {
    const payload = JSON.stringify({ gz: 'x'.repeat(500) });
    const s = await setup((_q, res) => {
      const gz = zlib.gzipSync(Buffer.from(payload));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(gz);
    });
    await httpViaProxy(s.pp, s.url('/gz'));
    const f = s.flows.find((x) => x.request.path === '/gz')!;
    expect(f.response?.bodyText).toBe(payload);       // 解压后与原文一致
    expect(f.response?.bodyText).not.toContain('\u0000'); // 不是乱码
  });

  it('brotli 响应自动解压', async () => {
    const payload = JSON.stringify({ br: 'y'.repeat(400) });
    const s = await setup((_q, res) => {
      const br = zlib.brotliCompressSync(Buffer.from(payload));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'br' });
      res.end(br);
    });
    await httpViaProxy(s.pp, s.url('/br'));
    const f = s.flows.find((x) => x.request.path === '/br')!;
    expect(f.response?.bodyText).toBe(payload);
  });

  it('deflate 响应自动解压', async () => {
    const payload = 'deflate-body-' + 'z'.repeat(300);
    const s = await setup((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'deflate' });
      res.end(zlib.deflateSync(Buffer.from(payload)));
    });
    await httpViaProxy(s.pp, s.url('/df'));
    const f = s.flows.find((x) => x.request.path === '/df')!;
    expect(f.response?.bodyText).toBe(payload);
  });

  it('图片二进制存为 base64 而非文本', async () => {
    // 1x1 PNG
    const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' + '01f15c4890000000a49444154789c6360000002000154a24f9f0000000049454e44ae426082', 'hex');
    const s = await setup((_q, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); });
    await httpViaProxy(s.pp, s.url('/img.png'));
    const f = s.flows.find((x) => x.request.path === '/img.png')!;
    expect(f.response?.contentType).toContain('image/png');
    expect(f.response?.bodyBase64).toBeTruthy();
    expect(f.response?.bodyText).toBeUndefined();
  });

  it('HTML/JS/CSS content-type 保留', async () => {
    const s = await setup((q, res) => {
      const ct = q.url === '/a.js' ? 'application/javascript' : q.url === '/a.css' ? 'text/css' : 'text/html';
      res.writeHead(200, { 'content-type': ct }); res.end('body');
    });
    for (const p of ['/a.html', '/a.js', '/a.css']) await httpViaProxy(s.pp, s.url(p));
    expect(s.flows.find((x) => x.request.path === '/a.js')?.response?.contentType).toContain('javascript');
    expect(s.flows.find((x) => x.request.path === '/a.css')?.response?.contentType).toContain('css');
    expect(s.flows.find((x) => x.request.path === '/a.html')?.response?.contentType).toContain('html');
  });

  it('POST 表单请求体被捕获', async () => {
    const s = await setup((_q, res) => { res.writeHead(200); res.end('ok'); });
    await httpViaProxy(s.pp, s.url('/form'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1&b=2' });
    const f = s.flows.find((x) => x.request.path === '/form')!;
    expect(f.request.bodyText).toBe('a=1&b=2');
  });

  it('404 / 500 状态被记录', async () => {
    const s = await setup((q, res) => { res.writeHead(q.url === '/e500' ? 500 : 404); res.end(); });
    await httpViaProxy(s.pp, s.url('/e404'));
    await httpViaProxy(s.pp, s.url('/e500'));
    expect(s.flows.find((x) => x.request.path === '/e404')?.response?.status).toBe(404);
    expect(s.flows.find((x) => x.request.path === '/e500')?.response?.status).toBe(500);
  });

  it('query string 保留在 url', async () => {
    const s = await setup((_q, res) => { res.writeHead(200); res.end('ok'); });
    await httpViaProxy(s.pp, s.url('/search?q=hello&page=2'));
    const f = s.flows.find((x) => x.request.path.startsWith('/search'))!;
    expect(f.request.url).toContain('q=hello');
    expect(f.request.url).toContain('page=2');
  });

  it('并发多请求全部捕获', async () => {
    const s = await setup((q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: q.url })); });
    await Promise.all(Array.from({ length: 10 }, (_, i) => httpViaProxy(s.pp, s.url(`/c${i}`))));
    for (let i = 0; i < 10; i++) expect(s.flows.some((x) => x.request.path === `/c${i}`)).toBe(true);
  });

  it('大响应体被完整捕获（1MB）', async () => {
    const big = 'A'.repeat(1024 * 1024);
    const s = await setup((_q, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(big); });
    const r = await httpViaProxy(s.pp, s.url('/big'));
    expect(r.body.length).toBe(big.length);          // 客户端收到完整
    const f = s.flows.find((x) => x.request.path === '/big')!;
    expect(f.response?.bodySize).toBe(big.length);
  });

  it('大请求体字节完整透传上游（3MB POST，不被截断）', async () => {
    // 回归历史 bug：readAllBody 超过 2MB 后截断，但仍将残缺 body 发上游 →
    // AI chat 请求（含长上下文）触发此路径，SSE 建不起来。
    const size = 3 * 1024 * 1024;
    const payload = Buffer.alloc(size, 0x41); // 3MB 'A'
    let received: Buffer | null = null;
    const s = await setup((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received = Buffer.concat(chunks);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });
    const r = await httpViaProxy(s.pp, s.url('/big-post'), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) },
      body: payload,
    });
    expect(r.status).toBe(200);
    // 关键断言：上游收到的字节数 = 客户端发的字节数
    expect(received).not.toBeNull();
    expect(received!.length).toBe(size);
    // flow.request.bodySize 反映真实大小
    const f = s.flows.find((x) => x.request.path === '/big-post')!;
    expect(f.request.bodySize).toBe(size);
  });

  it('大响应体字节完整转发（3MB，不被截断）', async () => {
    const size = 3 * 1024 * 1024;
    const payload = Buffer.alloc(size, 0x42); // 3MB 'B'
    const s = await setup((_q, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(size) });
      res.end(payload);
    });
    const r = await httpViaProxy(s.pp, s.url('/big-resp'));
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(size);
    const f = s.flows.find((x) => x.request.path === '/big-resp')!;
    expect(f.response?.bodySize).toBe(size);
  });
});
