/**
 * 会话导出/导入。
 * - .proxybaby：自有格式，直接序列化 Flow[]（含 SSE 帧、WS 消息，可完整回放）
 * - .har：标准 HTTP Archive 1.2（便于与其他工具互通；WS/SSE 仅存 body 文本）
 */
import fs from 'node:fs';
import type { Flow } from '../../shared/types';

export function exportProxybaby(flows: Flow[], filePath: string): void {
  const payload = { format: 'proxybaby', version: 1, exportedAt: Date.now(), flows };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

export function importProxybaby(filePath: string): Flow[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(text);
  if (parsed?.format === 'proxybaby' && Array.isArray(parsed.flows)) return parsed.flows;
  if (Array.isArray(parsed)) return parsed; // 宽松兼容裸数组
  throw new Error('不是有效的 .proxybaby 文件');
}

export function exportHAR(flows: Flow[], filePath: string): void {
  const entries = flows.map((f) => {
    const reqHeaders = f.request.headers.map((h) => ({ name: h.name, value: h.value }));
    const resHeaders = f.response?.headers.map((h) => ({ name: h.name, value: h.value })) || [];
    let queryString: { name: string; value: string }[] = [];
    try {
      const u = new URL(f.request.url);
      queryString = [...u.searchParams.entries()].map(([name, value]) => ({ name, value }));
    } catch {}
    return {
      startedDateTime: new Date(f.request.startedAt).toISOString(),
      time: f.durationMs || 0,
      request: {
        method: f.request.method,
        url: f.request.url,
        httpVersion: `HTTP/${f.request.httpVersion}`,
        headers: reqHeaders,
        queryString,
        headersSize: -1,
        bodySize: f.request.bodySize,
        postData: f.request.bodyText
          ? { mimeType: f.request.contentType || 'text/plain', text: f.request.bodyText }
          : undefined,
      },
      response: {
        status: f.response?.status || 0,
        statusText: f.response?.statusText || '',
        httpVersion: `HTTP/${f.response?.httpVersion || '1.1'}`,
        headers: resHeaders,
        content: {
          size: f.response?.bodySize || 0,
          mimeType: f.response?.contentType || '',
          text: f.response?.bodyText ?? sseToText(f),
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: f.response?.bodySize || 0,
      },
      cache: {},
      timings: { send: 0, wait: f.durationMs || 0, receive: 0 },
    };
  });

  const har = {
    log: {
      version: '1.2',
      creator: { name: 'ProxyBaby', version: '0.1.0' },
      entries,
    },
  };
  fs.writeFileSync(filePath, JSON.stringify(har, null, 2));
}

function sseToText(f: Flow): string {
  if (f.sseFrames.length) return f.sseFrames.map((x) => x.raw || x.data).join('\n\n');
  if (f.wsMessages?.length) return f.wsMessages.map((m) => `[${m.direction}] ${m.text ?? '<binary>'}`).join('\n');
  return '';
}
