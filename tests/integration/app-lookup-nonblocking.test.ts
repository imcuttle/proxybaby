import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { ProxyServer } from '../../electron/proxy/proxy-server';
import * as procLookup from '../../electron/system/process-lookup';

/**
 * 回归：lookupByPort 不应该阻塞 flow:start（关键路径不能等 lsof）。
 * 参考 plan `stellar-aurora-darwin-xQ2qj6Tn`：修复"开启代理后首字节 TTFB 明显变长"。
 */
describe('proxy: app 反查不阻塞关键路径', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    vi.restoreAllMocks();
  });

  async function setup() {
    const target = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });
    return { proxy, tp, pp };
  }

  function httpViaProxy(proxyPort: number, targetUrl: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const u = new URL(targetUrl);
      const req = http.request({
        host: '127.0.0.1', port: proxyPort, method: 'GET', path: targetUrl,
        headers: { Host: u.host },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('flow:start 在 lookupByPort 未完成前就 emit（无阻塞）', async () => {
    // 让 lookupByPort 挂起 500ms 才返回，模拟 lsof 慢的情况
    let resolveLookup: ((v: any) => void) | null = null;
    const lookupSpy = vi.spyOn(procLookup, 'lookupByPort').mockImplementation(() => {
      return new Promise((resolve) => { resolveLookup = resolve; });
    });

    const { proxy, tp, pp } = await setup();
    const startTimes: number[] = [];
    const appInfoTimes: number[] = [];
    proxy.on('flow:start', () => startTimes.push(Date.now()));
    proxy.on('flow:app-info', () => appInfoTimes.push(Date.now()));

    const t0 = Date.now();
    // 发个请求 —— 不能等 lookupByPort，应立即通过
    const r = await httpViaProxy(pp, `http://127.0.0.1:${tp}/hi`);
    expect(r.status).toBe(200);
    // 请求返回时间应远小于 lookup 挂起的 500ms（说明关键路径没等 lookup）
    expect(Date.now() - t0).toBeLessThan(400);
    expect(startTimes.length).toBe(1);
    // 此时 lookup 还没释放，flow:app-info 不应该 emit
    expect(appInfoTimes.length).toBe(0);

    // 现在释放 lookup —— 期待 flow:app-info 事件后到
    resolveLookup!({ pid: 1234, name: 'curl' });
    await new Promise((r) => setTimeout(r, 50));
    expect(appInfoTimes.length).toBe(1);
    // 时序：flow:app-info 在 flow:start 之后
    expect(appInfoTimes[0]).toBeGreaterThanOrEqual(startTimes[0]);

    expect(lookupSpy).toHaveBeenCalled();
  });

  it('lookupByPort 返回 null 时不 emit flow:app-info', async () => {
    vi.spyOn(procLookup, 'lookupByPort').mockResolvedValue(null);

    const { proxy, tp, pp } = await setup();
    const appInfoTimes: number[] = [];
    proxy.on('flow:app-info', () => appInfoTimes.push(Date.now()));

    await httpViaProxy(pp, `http://127.0.0.1:${tp}/hi`);
    await new Promise((r) => setTimeout(r, 30));
    expect(appInfoTimes.length).toBe(0);
  });
});
