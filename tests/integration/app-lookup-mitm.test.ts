import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { ProxyServer } from '../../electron/proxy/proxy-server';
import * as procLookup from '../../electron/system/process-lookup';
import { ensureRootCA, issueLeaf } from '../../electron/mitm/ca';

/**
 * 回归：MITM (HTTPS) 场景下 lookupByPort 拿到的必须是**真实外部客户端** remotePort，
 * 而不是内部 127.0.0.1 环回 socket 的端口（后者属于 ProxyBaby 自身进程，lsof 无法反查发起应用）。
 *
 * 参考 plan `stellar-cascade-babbage`：修复"HTTPS 请求应用程序来源一直拿不到"。
 */
let caPem = '';
beforeAll(async () => { caPem = (await ensureRootCA()).certPem; });

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  vi.restoreAllMocks();
});

function httpsViaProxy(proxyPort: number, host: string, port: number, path: string) {
  return new Promise<{ status: number; body: string; clientLocalPort: number }>((resolve, reject) => {
    const connectReq = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `${host}:${port}` });
    connectReq.on('connect', (_res, socket) => {
      // 记下发起 CONNECT 的客户端 socket 的本地端口—— 这就是从 ProxyBaby 视角看到的外部 remotePort
      const clientLocalPort = (socket as net.Socket).localPort?? 0;
      const t = tls.connect({ socket, servername: host, ca: [caPem] }, () => {
        t.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      });
      const chunks: Buffer[] = [];
      t.on('data', (d) => chunks.push(d));
      t.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const [head, ...rest] = raw.split('\r\n\r\n');
        const status = Number(head.split('\r\n')[0].split(' ')[1]) || 0;
        try { t.destroy(); socket.destroy(); } catch {}
        resolve({ status, body: rest.join('\r\n\r\n'), clientLocalPort });
      });
      t.on('error', reject);
    });
    connectReq.on('error', reject);
    connectReq.end();
  });
}

describe('MITM 场景下的 app 反查 remotePort', () => {
  it('lookupByPort 传入的端口应等于真实外部客户端 remotePort，而非内部环回端口', async () => {
    const lookupPorts: number[] = [];
    vi.spyOn(procLookup, 'lookupByPort').mockImplementation(async (port: number) => {
      lookupPorts.push(port);
      return { pid: 4242, name: 'test-client' };
    });

    // 起https target
    const leaf = issueLeaf('localhost');
    const target = https.createServer({ key: leaf.keyPem, cert: leaf.certPem }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;

    // 起代理
    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpsViaProxy(pp, 'localhost', tp, '/hi');
    expect(r.status).toBe(200);
    // 等异步 lookup 触发
    await new Promise((r) => setTimeout(r, 60));

    expect(lookupPorts.length).toBeGreaterThan(0);
    // 关键断言：lookup 被调用的 port 应该是**发起 CONNECT 的客户端 socket 的 localPort**
    // （即从 ProxyBaby 视角看外部 clientSocket.remotePort），而不是任何内部临时端口。
    expect(lookupPorts).toContain(r.clientLocalPort);
  });

  it('flow.app 会通过 flow:app-info 事件补上（含 iconDataUrl，MITM 通道）', async () => {
    const FAKE_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    vi.spyOn(procLookup, 'lookupByPort').mockResolvedValue({
      pid: 9999,
      name: 'my-app',
      execPath: '/Applications/MyApp.app/Contents/MacOS/MyApp',
      bundlePath: '/Applications/MyApp.app',
      bundleId: 'com.example.myapp',
      iconDataUrl: FAKE_ICON,
    });

    const leaf = issueLeaf('localhost');
    const target = https.createServer({ key: leaf.keyPem, cert: leaf.certPem }, (_req, res) => {
      res.writeHead(200); res.end('ok');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const tp = (target.address() as any).port;

    const proxy = new ProxyServer({ host: '127.0.0.1', port: 0 });
    await proxy.start();
    const pp = (proxy as any).server.address().port;
    const appInfos: any[] = [];
    proxy.on('flow:app-info', (p: any) => appInfos.push(p));
    cleanups.push(async () => { await proxy.stop(); target.close(); });

    const r = await httpsViaProxy(pp, 'localhost', tp, '/hi');
    expect(r.status).toBe(200);
    await new Promise((r) => setTimeout(r, 60));

    expect(appInfos.length).toBeGreaterThanOrEqual(1);
    expect(appInfos[0].app.name).toBe('my-app');
    // icon 必须原样透传到渲染层（Sidebar/RequestList 靠它显示 app 图标）
    expect(appInfos[0].app.iconDataUrl).toBe(FAKE_ICON);
    expect(appInfos[0].app.bundlePath).toBe('/Applications/MyApp.app');
    expect(appInfos[0].app.bundleId).toBe('com.example.myapp');
  });
});
