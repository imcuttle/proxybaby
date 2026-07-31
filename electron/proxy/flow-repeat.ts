/**
 * 重发一个已捕获的 Flow。
 *
 * 用 Node 的 http/https 模块直接向目标发起同样的请求（不走本进程代理链，避免自环），
 * 复用同一套 flow:* 事件通道 emit 出去，让主进程 FlowStore & UI 一路更新。
 *
 * 参数可选传入 patch 覆盖 method/url/headers/bodyText，用于「编辑并重复」。
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Flow, FlowRepeatPatch, Header, RequestData, ResponseData } from '../../shared/types';

interface Emitter {
  emit(event: string, payload: any): void;
}

const MAX_BODY_TEXT = 2 * 1024 * 1024;

export async function repeatFlow(
  src: Flow,
  patch: FlowRepeatPatch | undefined,
  emitter: Emitter,
): Promise<Flow> {
  const method = patch?.method || src.request.method;
  const urlStr = patch?.url || src.request.url;
  const headers: Header[] = patch?.headers
    ? patch.headers
    : src.request.headers.map((h) => ({ name: h.name, value: h.value }));
  const bodyText = patch?.bodyText ?? src.request.bodyText;
  const bodyBuf = bodyText != null ? Buffer.from(bodyText, 'utf8') : Buffer.alloc(0);

  const u = new URL(urlStr);
  const startedAt = Date.now();
  const flowId = randomUUID();

  const request: RequestData = {
    method,
    url: u.toString(),
    host: u.hostname,
    path: u.pathname + u.search,
    scheme: u.protocol === 'https:' ? 'https' : 'http',
    httpVersion: '1.1',
    headers,
    bodySize: bodyBuf.length,
    bodyText: bodyText,
    contentType: findHeader(headers, 'content-type'),
    startedAt,
  };

  const flow: Flow = {
    id: flowId,
    status: 'pending',
    request,
    sseFrames: [],
    isTLS: request.scheme === 'https',
    app: { name: 'proxybaby (repeat)', pid: 0 },
    repeatOfId: src.id,
  };

  emitter.emit('flow:start', flow);
  emitter.emit('flow:request-body', {
    id: flowId,
    bodyText,
    bodySize: bodyBuf.length,
  });

  const forwardHeaders: Record<string, string> = {};
  for (const h of headers) {
    const lower = h.name.toLowerCase();
    if (lower === 'proxy-connection' || lower === 'proxy-authorization') continue;
    if (lower === 'content-length') continue; // 我们重新计算
    if (lower === 'host') continue;
    forwardHeaders[h.name] = h.value;
  }
  if (bodyBuf.length) forwardHeaders['Content-Length'] = String(bodyBuf.length);

  return new Promise<Flow>((resolve) => {
    const requester = u.protocol === 'https:' ? https.request : http.request;
    const upReq = requester(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        method,
        path: u.pathname + u.search,
        headers: forwardHeaders as any,
        rejectUnauthorized: false,
      } as any,
      (upRes) => {
        const respHeaders: Header[] = [];
        for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
          respHeaders.push({ name: upRes.rawHeaders[i], value: upRes.rawHeaders[i + 1] });
        }
        const contentType = String(upRes.headers['content-type'] || '');
        const response: ResponseData = {
          status: upRes.statusCode || 0,
          statusText: upRes.statusMessage || '',
          httpVersion: upRes.httpVersion,
          headers: respHeaders,
          bodySize: 0,
          contentType,
          isSSE: /text\/event-stream/i.test(contentType),
        };
        flow.response = response;
        emitter.emit('flow:response-headers', { id: flowId, response });

        let bodyBufOut = Buffer.alloc(0);
        let truncated = false;
        upRes.on('data', (chunk: Buffer) => {
          if (truncated) return;
          if (bodyBufOut.length + chunk.length > MAX_BODY_TEXT) truncated = true;
          else bodyBufOut = Buffer.concat([bodyBufOut, chunk]);
        });
        upRes.on('end', () => {
          response.bodySize = bodyBufOut.length;
          const text = safeText(bodyBufOut, contentType);
          if (text !== undefined) response.bodyText = text;
          else response.bodyBase64 = bodyBufOut.toString('base64');
          response.endedAt = Date.now();
          emitter.emit('flow:response-body', {
            id: flowId,
            bodyText: response.bodyText,
            bodyBase64: response.bodyBase64,
            bodySize: bodyBufOut.length,
          });
          flow.status = 'completed';
          flow.durationMs = Date.now() - startedAt;
          emitter.emit('flow:end', {
            id: flowId,
            durationMs: flow.durationMs,
            status: 'completed',
          });
          resolve(flow);
        });
        upRes.on('error', (err: any) => {
          flow.status = 'error';
          emitter.emit('flow:end', {
            id: flowId,
            durationMs: Date.now() - startedAt,
            status: 'error',
            error: err?.message || String(err),
          });
          resolve(flow);
        });
      },
    );
    upReq.on('error', (err: any) => {
      flow.status = 'error';
      emitter.emit('flow:end', {
        id: flowId,
        durationMs: Date.now() - startedAt,
        status: 'error',
        error: err?.message || String(err),
      });
      resolve(flow);
    });
    if (bodyBuf.length) upReq.write(bodyBuf);
    upReq.end();
  });
}

function findHeader(headers: Header[], name: string): string | undefined {
  const target = name.toLowerCase();
  for (const h of headers) if (h.name.toLowerCase() === target) return h.value;
  return undefined;
}

function safeText(buf: Buffer, contentType?: string): string | undefined {
  if (!buf.length) return '';
  const ct = (contentType || '').toLowerCase();
  const isTextual =
    /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|xhtml\+xml))/.test(ct) ||
    /\+json/.test(ct) ||
    /\+xml/.test(ct) ||
    /event-stream/.test(ct) ||
    ct === '';
  if (!isTextual) return undefined;
  try { return buf.toString('utf8'); } catch { return undefined; }
}
