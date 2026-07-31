/**
 * ProxyBaby 代理引擎。
 *
 * 结构：
 *   - HTTP server 监听 127.0.0.1:port
 *     - 处理 request：作为正向代理转发到目标（http）
 *     - 处理 CONNECT：动态签发目标域名证书 → 内嵌 TLS server 与客户端完成 TLS →
 *       之后再交给同一个 HTTP server 处理请求（走 https 出口）
 *   - 每个 flow：连接建立即 emit('flow:start')；请求头/体、响应头、SSE 每帧、响应结束
 *     全程 emit 事件，供 IPC 层转发给渲染层实现流式 UI。
 */
import http, { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

import { ensureRootCA, issueLeaf } from '../mitm/ca';
import { lookupByPort } from '../system/process-lookup';
import { SSEParser } from './sse-parser';
import { WSParser } from './ws-parser';
import { ProxyContext, runMiddlewares, type Middleware } from '../engine/context';
import type { PluginManager } from '../engine/plugins';
import { setBreakpointRuntime } from '../engine/operators';
import type { BreakpointController } from '../engine/breakpoint';
import { getSslListStore } from '../engine/ssl-list';
import { getUpstreamProxy } from '../engine/upstream-proxy';
import type {
  Flow,
  Header,
  RequestData,
  ResponseData,
  SSEFrame,
} from '../../shared/types';

/**
 * body 镜像的硬上限。**注意**：这不是"上游转发"的限制——代理默认对未命中改写规则的
 * 请求/响应做**字节完整流式透传**，转发不受此值影响。此值仅影响 UI 侧的 body 镜像：
 * 完整的 bodyText/bodyBase64 会附在 flow 上供全量展示、复制、下载；只有极端大 body
 * （如视频流）超过 HARD_BODY_MIRROR_LIMIT 才会退化为"过大未预览"占位。
 */
const HARD_BODY_MIRROR_LIMIT = 128 * 1024 * 1024;

export interface ProxyServerOptions {
  host: string;
  port: number;
  plugins?: PluginManager;
  breakpointController?: BreakpointController;
}

export class ProxyServer extends EventEmitter {
  private server: http.Server;
  private tlsServers = new Map<string, tls.Server>();
  private opts: ProxyServerOptions;
  private recording = true;
  private plugins?: PluginManager;
  // 累积字节数（重启进程清零）；采样时算差值得到瞬时速率
  private totalBytes = 0;
  private rxBytes = 0;              // 上游 → 我们（下行）
  private txBytes = 0;              // 客户端 → 我们（上行）
  private lastSampleAt = Date.now();
  private lastRxAt0 = 0;
  private lastTxAt0 = 0;
  // 用户禁用 MITM 的 host（CONNECT 直连不解密）
  private mitmDisabledHosts = new Set<string>();

  setHostMitmDisabled(host: string, disabled: boolean) {
    if (disabled) this.mitmDisabledHosts.add(host);
    else this.mitmDisabledHosts.delete(host);
  }

  sampleTraffic(): { totalBytes: number; rxRate: number; txRate: number } {
    const now = Date.now();
    const dt = Math.max(1, now - this.lastSampleAt) / 1000;
    const rxRate = Math.max(0, this.rxBytes - this.lastRxAt0) / dt;
    const txRate = Math.max(0, this.txBytes - this.lastTxAt0) / dt;
    this.lastSampleAt = now;
    this.lastRxAt0 = this.rxBytes;
    this.lastTxAt0 = this.txBytes;
    return { totalBytes: this.totalBytes, rxRate, txRate };
  }

  private accTx(n: number) { this.txBytes += n; this.totalBytes += n; }
  private accRx(n: number) { this.rxBytes += n; this.totalBytes += n; }

  emit(event: string | symbol, ...args: any[]): boolean {
    // 侧录字节数用于 traffic 采样。EventEmitter.emit 会被大量调用，这里做最小分支。
    if (event === 'flow:request-body') {
      const size = (args[0] && args[0].bodySize) || 0;
      if (size) this.accTx(size);
    } else if (event === 'flow:response-body') {
      const size = (args[0] && args[0].bodySize) || 0;
      if (size) this.accRx(size);
    } else if (event === 'flow:sse-frame') {
      const raw = args[0]?.frame?.raw;
      if (raw) this.accRx(Buffer.byteLength(raw, 'utf8'));
    } else if (event === 'flow:ws-message') {
      const m = args[0]?.message;
      if (m) {
        if (m.direction === 'send') this.accTx(m.size || 0);
        else this.accRx(m.size || 0);
      }
    }
    return super.emit(event as any, ...args);
  }

  constructor(opts: ProxyServerOptions) {
    super();
    this.opts = opts;
    this.plugins = opts.plugins;
    if (opts.breakpointController) {
      setBreakpointRuntime({
        controller: opts.breakpointController,
        emitPause: (flowId, stage, request, response) => {
          this.emit('flow:breakpoint', { id: flowId, stage, request, response });
        },
      });
    }
    this.server = http.createServer();
    this.server.on('request', (req, res) => this.onRequest(req, res, false));
    this.server.on('connect', (req, socket, head) => this.onConnect(req, socket as net.Socket, head));
    this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket as net.Socket, head, false));
    this.server.on('clientError', (err, socket) => {
      try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
    });
  }

  setRecording(recording: boolean) {
    this.recording = recording;
  }

  async start(): Promise<void> {
    await ensureRootCA();
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.opts.port, this.opts.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    // 先强制断开所有活动连接（含 MITM/长连接/SSE/WebSocket），
    // 避免 server.close() 因保持连接的 socket 挂起。
    try { (this.server as any).closeAllConnections?.(); } catch {}
    for (const s of this.tlsServers.values()) {
      try { (s as any).closeAllConnections?.(); } catch {}
      try { s.close(); } catch {}
    }
    this.tlsServers.clear();
    // 加一个 1s 超时兜底，close 卡住不影响进程退出。
    await Promise.race([
      new Promise<void>((resolve) => this.server.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1000)),
    ]);
  }

  // ---------- HTTP 明文 / MITM 后的 request ----------
  private async onRequest(req: IncomingMessage, res: ServerResponse, isTLS: boolean) {
    if (!this.recording) {
      return this.passthrough(req, res, isTLS);
    }

    const flow = await this.buildFlow(req, isTLS);
    this.emit('flow:start', flow);

    const plugins = this.plugins;
    const pluginOut = plugins
      ? plugins.collectMiddlewares(flow.request.url, flow.request.scheme, `${flow.request.host}${flow.request.path}`)
      : { middlewares: [], matched: [], hints: { needsReqBodyBuffer: false, needsResBodyBuffer: false } };
    flow.matchedRules = pluginOut.matched;
    if (pluginOut.matched.length > 0) flow.edited = true;

    const needsReqBuf = pluginOut.hints?.needsReqBodyBuffer ?? false;
    const needsResBuf = pluginOut.hints?.needsResBodyBuffer ?? false;

    // 请求体处理：
    //   - 命中改写规则 → 完整读入 buffer，供中间件读/改，然后 forwardUpstream 用改后 buffer 写上游。
    //   - 未命中 → 保持 IncomingMessage 未消费，交由 forwardUpstream 直接 pipe 到上游，实现字节完整透传。
    //     同时旁路侧录到镜像 buffer 用于 UI 展示（不影响转发）。
    let reqBodyBuf: Buffer | undefined;
    if (needsReqBuf) {
      reqBodyBuf = await readAllBody(req);
      const reqCE = String(req.headers['content-encoding'] || '');
      const decompressed = reqCE ? await decompressBody(reqBodyBuf, reqCE) : reqBodyBuf;
      const bodyText = safeDecode(decompressed, flow.request.contentType);
      const bodyBase64 = bodyText === undefined ? decompressed.toString('base64') : undefined;
      flow.request.bodySize = reqBodyBuf.length;
      flow.request.bodyText = bodyText;
      flow.request.bodyBase64 = bodyBase64;
      this.emit('flow:request-body', {
        id: flow.id,
        bodyText,
        bodyBase64,
        bodySize: reqBodyBuf.length,
      });
    }
    // 流式路径下，flow:request-body 会在 clientReq end 后由 forwardUpstream 补 emit（此时已知 size）。

    const startedAt = Date.now();

    // 构建洋葱链
    const ctx = new ProxyContext({
      request: { ...flow.request, bodyBuffer: reqBodyBuf },
      isTLS,
      flowId: flow.id,
      clientReq: req,
      appName: flow.app?.name,
    });
    (ctx as any).__downstreamRes = res;
    ctx.meta.needsResBodyBuffer = needsResBuf;

    const upstreamMw: Middleware = async (c, next) => {
      // 真正发出上游请求
      try {
        await this.forwardUpstream(c);
      } catch (err: any) {
        c.short = { kind: 'abort', reason: err.message };
      }
      await next();
    };

    const chain: Middleware[] = [...pluginOut.middlewares, upstreamMw];

    try {
      await runMiddlewares(ctx, chain);
    } catch (err: any) {
      flow.status = 'error';
      flow.errorMessage = err.message;
      if (!res.headersSent) { try { res.writeHead(502); } catch {} }
      try { res.end(); } catch {}
      this.emit('flow:end', {
        id: flow.id,
        durationMs: Date.now() - startedAt,
        status: 'error' as const,
        error: err.message,
      });
      return;
    }

    // 短路：abort
    if (ctx.short?.kind === 'abort') {
      try { res.destroy(); } catch {}
      flow.status = 'error';
      flow.errorMessage = ctx.short.reason || 'aborted';
      this.emit('flow:end', {
        id: flow.id,
        durationMs: Date.now() - startedAt,
        status: 'error' as const,
        error: flow.errorMessage,
      });
      return;
    }

    // 若有响应（可能来自 respond 短路，或 forwardUpstream 已回填）
    if (ctx.short?.kind === 'respond') {
      ctx.response = ctx.short.response;
    }
    const response = ctx.response;
    if (!response) {
      if (!res.headersSent) { try { res.writeHead(502); } catch {} }
      try { res.end('ProxyBaby: no response produced'); } catch {}
      this.emit('flow:end', {
        id: flow.id,
        durationMs: Date.now() - startedAt,
        status: 'error' as const,
      });
      return;
    }

    // 流式请求路径下，clientReq 侧录的 body 字段最终写在 ctx.request 上，需要同步到 flow.request
    // 以便读取 flow 的调用方（UI、导出、测试）能看到完整的请求 body。
    flow.request.bodySize = ctx.request.bodySize;
    flow.request.bodyText = ctx.request.bodyText;
    flow.request.bodyBase64 = ctx.request.bodyBase64;

    // 若 SSE 已流式写入下游，只需补一个 flow:end；否则由此处写最终响应（含后置改写）。
    if (ctx.meta.responseBodyWritten === true) {
      flow.response = response;
      flow.status = 'completed';
      flow.durationMs = Date.now() - startedAt;
      this.emit('flow:end', { id: flow.id, durationMs: flow.durationMs, status: 'completed' as const });
      return;
    }

    const buf = response.bodyBuffer || (response.bodyText ? Buffer.from(response.bodyText, 'utf8') : Buffer.alloc(0));
    if (!res.headersSent) {
      const headerMap: Record<string, string> = {};
      for (const h of response.headers) {
        const lower = h.name.toLowerCase();
        // 由我们重新计算长度、去掉分块编码，避免与改写后的 body 冲突
        if (lower === 'content-length' || lower === 'transfer-encoding') continue;
        headerMap[h.name] = h.value;
      }
      headerMap['Content-Length'] = String(buf.length);
      try {
        res.writeHead(response.status, response.statusText || undefined, headerMap);
      } catch {}
    }
    try { res.end(buf); } catch {}
    flow.response = response;
    flow.status = 'completed';
    flow.durationMs = Date.now() - startedAt;
    this.emit('flow:response-body', {
      id: flow.id,
      bodyText: response.bodyText,
      bodyBase64: response.bodyText ? undefined : buf.toString('base64'),
      bodySize: buf.length,
    });
    this.emit('flow:end', {
      id: flow.id,
      durationMs: flow.durationMs,
      status: 'completed' as const,
    });
  }

  /**
   * 上游请求的核心逻辑：读取 ctx.request，发出请求，把响应回填到 ctx.response，
   * 同时把响应流式写入客户端 res。若响应是 SSE，逐帧推事件。
   *
   * 双路径设计（详见 `feedback_transparent_forwarding`）：
   *  - 请求侧：ctx.request.bodyBuffer 已存在 → 用它写上游（命中改写规则）；否则将 clientReq
   *    直接 pipe 到上游（字节完整透传），同时旁路侧录镜像。
   *  - 响应侧：SSE 或未命中响应改写 → 流式 pipe 上游 → 下游（保证 byte-for-byte 完整）；
   *    命中响应改写 → 缓冲完整响应体，交由 onRequest 在后置中间件跑完后写下游。
   */
  private forwardUpstream(ctx: ProxyContext): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const target = (ctx.meta.overrideUrl as string) || ctx.request.url;
      const targetUrl = new URL(target);
      const forwardHeaders: Record<string, string> = {};
      for (const h of ctx.request.headers) forwardHeaders[h.name] = h.value;
      delete forwardHeaders['proxy-connection'];
      delete forwardHeaders['Proxy-Connection'];
      delete forwardHeaders['proxy-authorization'];
      delete forwardHeaders['Proxy-Authorization'];

      // 请求体来源：命中改写规则 → 用 buffer；否则 → 直接 pipe clientReq（流式透传）。
      const useReqBuffer = ctx.request.bodyBuffer !== undefined;
      if (useReqBuffer) {
        // 中间件可能改过 body，需重算 content-length（避免与 header 里旧值冲突）
        const bufLen = ctx.request.bodyBuffer!.length;
        for (const key of Object.keys(forwardHeaders)) {
          if (key.toLowerCase() === 'content-length' || key.toLowerCase() === 'transfer-encoding') {
            delete forwardHeaders[key];
          }
        }
        if (bufLen > 0 || ctx.request.method !== 'GET') {
          forwardHeaders['Content-Length'] = String(bufLen);
        }
      }

      const upstreamHost = ctx.meta.upstreamHost as string | undefined;
      const [hostOverride, portOverride] = upstreamHost ? upstreamHost.split(':') : [undefined, undefined];

      const needsResBuf = ctx.meta.needsResBodyBuffer === true;
      const upstreamProxy = getUpstreamProxy();
      const requester = targetUrl.protocol === 'https:' ? https.request : http.request;

      // 用户配置了外部 HTTP 代理时：改由代理转发。
      //   - http 目标：直接把绝对 URL 作为 path 发给 HTTP 代理
      //   - https 目标：CONNECT + 明文 TLS 出去（简化实现；不做客户端证书）
      let reqOpts: any = {
        protocol: targetUrl.protocol,
        hostname: hostOverride || targetUrl.hostname,
        port: portOverride ? Number(portOverride) : (targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80)),
        method: ctx.request.method,
        path: targetUrl.pathname + targetUrl.search,
        headers: forwardHeaders as any,
        servername: targetUrl.hostname,
        rejectUnauthorized: false,
      };
      if (upstreamProxy?.kind === 'http' && upstreamProxy.host && upstreamProxy.port) {
        if (targetUrl.protocol === 'http:') {
          reqOpts = {
            ...reqOpts,
            protocol: 'http:',
            hostname: upstreamProxy.host,
            port: upstreamProxy.port,
            path: targetUrl.toString(),
          };
          if (upstreamProxy.username) {
            const token = Buffer.from(`${upstreamProxy.username}:${upstreamProxy.password || ''}`).toString('base64');
            reqOpts.headers = { ...reqOpts.headers, 'Proxy-Authorization': `Basic ${token}` };
          }
        } else {
          reqOpts = {
            ...reqOpts,
            createConnection: () => this.upstreamHttpTunnel(upstreamProxy.host!, upstreamProxy.port!, targetUrl.hostname, Number(reqOpts.port), upstreamProxy.username, upstreamProxy.password),
          };
        }
      }

      const upReq = (requester as any)(
        reqOpts,
        (upRes: any) => {
          // 记录响应头，转发给下游
          const respHeaders: Header[] = [];
          for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
            respHeaders.push({ name: upRes.rawHeaders[i], value: upRes.rawHeaders[i + 1] });
          }
          const contentType = String(upRes.headers['content-type'] || '');
          const isSSE = /text\/event-stream/i.test(contentType);
          ctx.response = {
            status: upRes.statusCode || 0,
            statusText: upRes.statusMessage || '',
            httpVersion: upRes.httpVersion,
            headers: respHeaders,
            bodySize: 0,
            contentType,
            isSSE,
          };
          const boundRes: ServerResponse | undefined = (ctx as any).__downstreamRes;
          const contentEncoding = String(upRes.headers['content-encoding'] || '');

          const streamPath = isSSE || !needsResBuf;

          if (streamPath) {
            // 流式透传：byte-for-byte 写下游，旁路镜像用于 UI 展示（完整保留）
            if (boundRes && !boundRes.headersSent) {
              try { boundRes.writeHead(ctx.response.status, ctx.response.statusText || undefined, upRes.headers as any); } catch {}
            }
            this.emit('flow:response-headers', { id: ctx.flowId, response: ctx.response });
            const mirror = new BodyMirror(HARD_BODY_MIRROR_LIMIT);
            const sseParser = isSSE ? new SSEParser() : null;
            upRes.on('data', (chunk: Buffer) => {
              try { boundRes?.write(chunk); } catch {}
              mirror.push(chunk);
              if (sseParser) {
                const frames = sseParser.push(chunk.toString('utf8'));
                for (const f of frames) this.emit('flow:sse-frame', { id: ctx.flowId, frame: f });
              }
            });
            upRes.on('end', async () => {
              if (sseParser) {
                const tail = sseParser.flush();
                for (const f of tail) this.emit('flow:sse-frame', { id: ctx.flowId, frame: f });
              }
              // 先解码/解压镜像（异步），保证 flow.response 就绪后再关闭下游；
              // 这样等待者（例如测试或 UI）在收到 flow:end 时能读到完整 bodyText。
              await this.finalizeStreamed(ctx, mirror, contentEncoding, contentType);
              try { boundRes?.end(); } catch {}
              ctx.meta.responseBodyWritten = true;
              resolve();
            });
          } else {
            // 缓冲路径：整个响应体先入内存 → 后置中间件改 → onRequest 写下游
            // 用于 statusCode/resBody/resHeaders/breakpoint/resDelay 等改写场景。
            this.emit('flow:response-headers', { id: ctx.flowId, response: ctx.response });
            const chunks: Buffer[] = [];
            let bodySize = 0;
            upRes.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
              bodySize += chunk.length;
            });
            upRes.on('end', async () => {
              if (ctx.response) {
                const bodyBuf = Buffer.concat(chunks, bodySize);
                // bodyBuffer 保留原始（可能是压缩后）字节，用于写回下游；
                // 展示用的 bodyText 先异步解压再按内容类型解码。
                ctx.response.bodyBuffer = bodyBuf;
                ctx.response.bodySize = bodyBuf.length;
                const decompressed = await decompressBody(bodyBuf, contentEncoding);
                const text = safeDecode(decompressed, contentType);
                if (text !== undefined) ctx.response.bodyText = text;
                else ctx.response.bodyBase64 = decompressed.toString('base64');
                ctx.response.endedAt = Date.now();
              }
              // 注意：不 set responseBodyWritten，交由 onRequest 写下游
              resolve();
            });
          }
          upRes.on('error', (err: any) => reject(err));
        },
      );
      upReq.on('error', (err: any) => reject(err));

      // 发请求体
      if (useReqBuffer) {
        const buf = ctx.request.bodyBuffer!;
        if (buf.length) upReq.write(buf);
        upReq.end();
      } else {
        // 流式：clientReq 直接 pipe 到上游，同时旁路镜像
        const reqMirror = new BodyMirror(HARD_BODY_MIRROR_LIMIT);
        const clientReq = ctx.clientReq;
        clientReq.on('data', (chunk: Buffer) => reqMirror.push(chunk));
        clientReq.on('end', async () => {
          const contentTypeReq = ctx.request.contentType;
          const reqCE = findHeaderValue(ctx.request.headers, 'content-encoding') || '';
          const finalized = await reqMirror.finalizeAsync(contentTypeReq, reqCE);
          ctx.request.bodySize = finalized.bodySize;
          ctx.request.bodyText = finalized.bodyText;
          ctx.request.bodyBase64 = finalized.bodyBase64;
          this.emit('flow:request-body', {
            id: ctx.flowId,
            bodyText: finalized.bodyText,
            bodyBase64: finalized.bodyBase64,
            bodySize: finalized.bodySize,
          });
        });
        clientReq.on('error', () => { try { upReq.destroy(); } catch {} });
        clientReq.pipe(upReq);
      }
    });
  }

  private async finalizeStreamed(
    ctx: ProxyContext,
    mirror: BodyMirror,
    contentEncoding: string,
    contentType: string,
  ) {
    if (!ctx.response) return;
    const raw = mirror.buffer();
    ctx.response.bodySize = mirror.size;
    if (!mirror.truncated) {
      const decompressed = await decompressBody(raw, contentEncoding);
      const text = safeDecode(decompressed, contentType);
      if (text !== undefined) ctx.response.bodyText = text;
      else ctx.response.bodyBase64 = decompressed.toString('base64');
    }
    ctx.response.endedAt = Date.now();
    this.emit('flow:response-body', {
      id: ctx.flowId,
      bodyText: ctx.response.bodyText,
      bodyBase64: ctx.response.bodyBase64,
      bodySize: mirror.size,
    });
    // 不 emit flow:end —— 由 onRequest 统一 emit，避免重复。
  }

  // ---------- WebSocket 升级：透传并抓帧 ----------
  private async onUpgrade(req: IncomingMessage, clientSocket: net.Socket, head: Buffer, isTLS: boolean) {
    if (!this.recording) {
      return this.passthroughUpgrade(req, clientSocket, head, isTLS);
    }

    const flow = await this.buildFlow(req, isTLS);
    flow.isWebSocket = true;
    flow.wsMessages = [];
    flow.status = 'streaming';
    this.emit('flow:start', flow);

    const targetUrl = this.buildTargetURL(req, isTLS);
    const wsScheme = isTLS ? 'wss:' : 'ws:';
    const port = targetUrl.port || (isTLS ? 443 : 80);

    // 与上游建立底层 TCP/TLS 连接，转发原始升级请求
    const connectUpstream = () =>
      isTLS
        ? tls.connect({ host: targetUrl.hostname, port: Number(port), servername: targetUrl.hostname, rejectUnauthorized: false })
        : net.connect(Number(port), targetUrl.hostname);

    const upstream = connectUpstream();

    upstream.on(isTLS ? 'secureConnect' : 'connect', () => {
      // 重放升级请求行 + 头
      const headerLines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(headerLines.join('\r\n') + '\r\n\r\n');
      if (head && head.length) upstream.write(head);

      const sendParser = new WSParser('send');   // client → server
      const recvParser = new WSParser('recv');   // server → client
      let handshakeDone = false;
      let recvPrelude = Buffer.alloc(0);

      // client → upstream
      clientSocket.on('data', (chunk: Buffer) => {
        try { upstream.write(chunk); } catch {}
        if (handshakeDone) {
          for (const m of sendParser.push(chunk)) {
            flow.wsMessages!.push(m);
            this.emit('flow:ws-message', { id: flow.id, message: m });
          }
        }
      });

      // upstream → client
      upstream.on('data', (chunk: Buffer) => {
        try { clientSocket.write(chunk); } catch {}
        if (!handshakeDone) {
          recvPrelude = Buffer.concat([recvPrelude, chunk]);
          const idx = recvPrelude.indexOf('\r\n\r\n');
          if (idx >= 0) {
            handshakeDone = true;
            this.emit('flow:ws-open', { id: flow.id });
            const rest = recvPrelude.subarray(idx + 4);
            if (rest.length) {
              for (const m of recvParser.push(rest)) {
                flow.wsMessages!.push(m);
                this.emit('flow:ws-message', { id: flow.id, message: m });
              }
            }
          }
        } else {
          for (const m of recvParser.push(chunk)) {
            flow.wsMessages!.push(m);
            this.emit('flow:ws-message', { id: flow.id, message: m });
          }
        }
      });

      const finish = () => {
        if (flow.status !== 'completed') {
          flow.status = 'completed';
          this.emit('flow:end', { id: flow.id, durationMs: Date.now() - flow.request.startedAt, status: 'completed' as const });
        }
      };
      const teardown = () => { try { upstream.destroy(); } catch {} try { clientSocket.destroy(); } catch {} finish(); };
      clientSocket.on('close', teardown);
      clientSocket.on('error', teardown);
      upstream.on('close', teardown);
      upstream.on('error', teardown);
    });

    upstream.on('error', () => {
      try { clientSocket.destroy(); } catch {}
      flow.status = 'error';
      this.emit('flow:end', { id: flow.id, durationMs: Date.now() - flow.request.startedAt, status: 'error' as const, error: 'ws upstream error' });
    });
  }

  private passthroughUpgrade(req: IncomingMessage, clientSocket: net.Socket, head: Buffer, isTLS: boolean) {
    const targetUrl = this.buildTargetURL(req, isTLS);
    const port = targetUrl.port || (isTLS ? 443 : 80);
    const upstream = isTLS
      ? tls.connect({ host: targetUrl.hostname, port: Number(port), servername: targetUrl.hostname, rejectUnauthorized: false })
      : net.connect(Number(port), targetUrl.hostname);
    upstream.on(isTLS ? 'secureConnect' : 'connect', () => {
      const headerLines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(headerLines.join('\r\n') + '\r\n\r\n');
      if (head && head.length) upstream.write(head);
      clientSocket.pipe(upstream).pipe(clientSocket);
    });
    upstream.on('error', () => { try { clientSocket.destroy(); } catch {} });
    clientSocket.on('error', () => { try { upstream.destroy(); } catch {} });
  }

  // ---------- CONNECT: 建立 MITM ----------
  private async onConnect(req: IncomingMessage, clientSocket: net.Socket, head: Buffer) {
    const [host, portStr] = (req.url || '').split(':');
    const port = Number(portStr) || 443;
    if (!host) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    // 用户禁用了此 host 的 MITM：直连隧道，不解密
    const sslList = getSslListStore();
    let appName: string | undefined;
    const remotePort = clientSocket.remotePort;
    if (remotePort && sslList) {
      // 仅在 sslList 存在时才做反查，避免不必要 lsof 开销
      try { appName = (await lookupByPort(remotePort))?.name; } catch {}
    }
    const bypassMitm = this.mitmDisabledHosts.has(host) || (sslList && !sslList.shouldDecrypt({ host, appName }));
    if (bypassMitm) {
      try {
        const upstream = net.connect(port, host, () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head && head.length) upstream.write(head);
          clientSocket.pipe(upstream).pipe(clientSocket);
        });
        upstream.on('error', () => { try { clientSocket.destroy(); } catch {} });
        clientSocket.on('error', () => { try { upstream.destroy(); } catch {} });
      } catch {
        try { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
      }
      return;
    }
    try {
      const tlsServer = await this.getOrCreateTlsServer(host, port);
      const address = tlsServer.address() as net.AddressInfo;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const upstream = net.connect(address.port, '127.0.0.1', () => {
        if (head && head.length) upstream.write(head);
        clientSocket.pipe(upstream).pipe(clientSocket);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    } catch (err) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
  }

  private async getOrCreateTlsServer(host: string, targetPort: number): Promise<tls.Server> {
    const cacheKey = `${host}:${targetPort}`;
    const cached = this.tlsServers.get(cacheKey);
    if (cached) return cached;

    const leaf = issueLeaf(host);
    const ca = await ensureRootCA();
    const tlsServer = tls.createServer({
      key: leaf.keyPem,
      cert: leaf.certPem + '\n' + ca.certPem,
    });

    // 每个 (host,port) 对应一个内部 http server；把解密后的 socket 交给它处理。
    // 在 socket 上记录真实目标 host:port，供 onRequest 转发时使用（Host 头可能缺端口）。
    const innerHttp = http.createServer();
    innerHttp.on('request', (req, res) => this.onRequest(req, res, true));
    innerHttp.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket as net.Socket, head, true));
    tlsServer.on('secureConnection', (tlsSocket) => {
      (tlsSocket as any).__pbTarget = { host, port: targetPort };
      (innerHttp as any).emit('connection', tlsSocket);
    });

    await new Promise<void>((resolve, reject) => {
      tlsServer.once('error', reject);
      tlsServer.listen(0, '127.0.0.1', () => resolve());
    });

    this.tlsServers.set(cacheKey, tlsServer);
    return tlsServer;
  }

  private buildTargetURL(req: IncomingMessage, isTLS: boolean): URL {
    // 明文正向代理：req.url 是绝对 URL
    // MITM 后：req.url 是相对路径，host 从 headers 拿
    if (req.url && /^https?:\/\//.test(req.url)) {
      return new URL(req.url);
    }
    const scheme = isTLS ? 'https' : 'http';
    // MITM 后优先用 CONNECT 阶段记录的真实 host:port（Host 头可能缺端口）
    const target = (req.socket as any)?.__pbTarget as { host: string; port: number } | undefined;
    if (isTLS && target) {
      return new URL(`https://${target.host}:${target.port}${req.url || '/'}`);
    }
    const host = req.headers.host || 'unknown';
    return new URL(`${scheme}://${host}${req.url || '/'}`);
  }

  private async buildFlow(req: IncomingMessage, isTLS: boolean): Promise<Flow> {
    const url = this.buildTargetURL(req, isTLS);
    const reqHeaders: Header[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      reqHeaders.push({ name: req.rawHeaders[i], value: req.rawHeaders[i + 1] });
    }
    const contentType = String(req.headers['content-type'] || '');
    const request: RequestData = {
      method: req.method || 'GET',
      url: url.toString(),
      host: url.hostname,
      path: url.pathname + url.search,
      scheme: isTLS ? 'https' : 'http',
      httpVersion: req.httpVersion,
      headers: reqHeaders,
      bodySize: 0,
      contentType,
      startedAt: Date.now(),
    };
    const remotePort = req.socket.remotePort;
    let app;
    if (remotePort) {
      app = (await lookupByPort(remotePort)) || undefined;
    }
    return {
      id: randomUUID(),
      status: 'pending',
      app,
      request,
      sseFrames: [],
      isTLS,
    };
  }

  // 通过上游 HTTP 代理建立到 targetHost:targetPort 的隧道，然后包一层 TLS 出去。
  private upstreamHttpTunnel(proxyHost: string, proxyPort: number, targetHost: string, targetPort: number, user?: string, pass?: string): net.Socket {
    const socket = net.connect(proxyPort, proxyHost);
    const tlsSocket = new tls.TLSSocket(socket, { rejectUnauthorized: false, servername: targetHost, isServer: false } as any);
    // 用一个未启动 TLS 的原始 socket 先发送 CONNECT，再升级。
    // 这里为了简洁，我们让调用方通过 http.request 的 createConnection 返回 tls socket；
    // 因此手动组装：先在明文 socket 上写 CONNECT，握手成功后 emit 'secureConnect' 前完成 TLS。
    let handshakeSent = false;
    const sendConnect = () => {
      if (handshakeSent) return;
      handshakeSent = true;
      let hdr = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (user) {
        const token = Buffer.from(`${user}:${pass || ''}`).toString('base64');
        hdr += `Proxy-Authorization: Basic ${token}\r\n`;
      }
      hdr += '\r\n';
      socket.write(hdr);
    };
    socket.once('connect', sendConnect);
    // 收到 CONNECT 200 响应后再升级 TLS
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buf.slice(0, idx).toString('utf8');
      socket.off('data', onData);
      if (!/^HTTP\/1\.[01] 200/.test(head)) {
        tlsSocket.destroy(new Error('Upstream proxy CONNECT failed'));
        return;
      }
      (tlsSocket as any).emit('connect');
    };
    socket.on('data', onData);
    return tlsSocket as unknown as net.Socket;
  }

  // ---------- passthrough (recording=false) ----------
  private passthrough(req: IncomingMessage, res: ServerResponse, isTLS: boolean) {
    const url = this.buildTargetURL(req, isTLS);
    const requester = url.protocol === 'https:' ? https.request : http.request;
    const upstream = requester(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: url.pathname + url.search,
        headers: req.headers as any,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.statusMessage, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on('error', () => { try { res.writeHead(502); res.end(); } catch {} });
    req.pipe(upstream);
  }
}

function readAllBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
    });
    req.on('end', () => resolve(Buffer.concat(chunks, size)));
    req.on('error', (err) => reject(err));
  });
}

/**
 * 旁路 body 镜像：**流式转发路径**下用于全量记录 body 供 UI 展示、复制、下载。
 * 只在超过 hardLimit（默认 128MB，避免极端流量撑爆进程）时才停止累积，标记 truncated。
 * 转发本身完全不受这里影响 —— 数据已经写给下游。
 */
class BodyMirror {
  private chunks: Buffer[] = [];
  size = 0;
  truncated = false;
  private hardLimit: number;

  constructor(hardLimit: number) {
    this.hardLimit = hardLimit;
  }

  push(chunk: Buffer) {
    this.size += chunk.length;
    if (this.truncated) return;
    if (this.size > this.hardLimit) {
      this.truncated = true;
      this.chunks = []; // 释放已缓冲的
      return;
    }
    this.chunks.push(chunk);
  }

  buffer(): Buffer {
    if (this.truncated) return Buffer.alloc(0);
    // size 可能超过 chunks 之和？不会：truncated 前 size === Σ chunks.length
    return Buffer.concat(this.chunks, this.size);
  }

  finalize(contentType?: string): { bodyText?: string; bodyBase64?: string; bodySize: number } {
    if (this.truncated) {
      // 保留 size；UI 显示"过大未预览"
      return { bodySize: this.size };
    }
    const buf = this.buffer();
    const text = safeDecode(buf, contentType);
    if (text !== undefined) return { bodyText: text, bodySize: this.size };
    return { bodyBase64: buf.toString('base64'), bodySize: this.size };
  }

  async finalizeAsync(contentType?: string, contentEncoding?: string):
    Promise<{ bodyText?: string; bodyBase64?: string; bodySize: number }> {
    if (this.truncated) return { bodySize: this.size };
    const raw = this.buffer();
    const decompressed = contentEncoding ? await decompressBody(raw, contentEncoding) : raw;
    const text = safeDecode(decompressed, contentType);
    if (text !== undefined) return { bodyText: text, bodySize: this.size };
    return { bodyBase64: decompressed.toString('base64'), bodySize: this.size };
  }
}

function findHeaderValue(headers: { name: string; value: string }[], name: string): string | undefined {
  const t = name.toLowerCase();
  for (const h of headers) if (h.name.toLowerCase() === t) return h.value;
  return undefined;
}

// 按 Content-Encoding 异步解压（避免同步阻塞主进程 event loop）。失败返回原 buffer。
function decompressBody(buf: Buffer, encoding?: string): Promise<Buffer> {
  if (!buf.length) return Promise.resolve(buf);
  const enc = (encoding || '').toLowerCase().trim();
  const run = (fn: (b: Buffer, cb: (e: Error | null, r: Buffer) => void) => void): Promise<Buffer> =>
    new Promise((resolve) => fn(buf, (err, res) => resolve(err ? buf : res)));
  if (enc === 'gzip' || enc === 'x-gzip') return run(zlib.gunzip);
  if (enc === 'deflate') {
    return new Promise((resolve) => {
      zlib.inflate(buf, (e, r) => {
        if (!e) return resolve(r);
        zlib.inflateRaw(buf, (e2, r2) => resolve(e2 ? buf : r2));
      });
    });
  }
  if (enc === 'br') return run(zlib.brotliDecompress);
  if (enc === 'zstd' && (zlib as any).zstdDecompress) return run((zlib as any).zstdDecompress);
  return Promise.resolve(buf);
}

// utf-8 安全解码；对二进制类型返回 undefined
function safeDecode(buf: Buffer, contentType?: string): string | undefined {
  if (!buf.length) return '';
  const ct = (contentType || '').toLowerCase();
  const isTextual =
    /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|xhtml\+xml))/.test(ct) ||
    /\+json/.test(ct) ||
    /\+xml/.test(ct) ||
    /event-stream/.test(ct) ||
    ct === '';
  if (!isTextual) return undefined;
  try {
    return buf.toString('utf8');
  } catch {
    return undefined;
  }
}
