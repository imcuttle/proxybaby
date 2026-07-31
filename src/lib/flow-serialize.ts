import type { Flow, Header } from '../../shared/types';

export function toCurl(flow: Flow): string {
  const parts = [`curl '${flow.request.url}'`];
  if (flow.request.method && flow.request.method !== 'GET') parts.push(`  -X ${flow.request.method}`);
  for (const h of flow.request.headers) {
    const lower = h.name.toLowerCase();
    if (lower === 'content-length' || lower === 'host') continue;
    parts.push(`  -H '${h.name}: ${escapeSingle(h.value)}'`);
  }
  if (flow.request.bodyText) {
    parts.push(`  --data-raw '${escapeSingle(flow.request.bodyText)}'`);
  }
  return parts.join(' \\\n');
}

export function rawRequest(flow: Flow): string {
  const head: string[] = [];
  head.push(`${flow.request.method} ${flow.request.path} HTTP/${flow.request.httpVersion}`);
  for (const h of flow.request.headers) head.push(`${h.name}: ${h.value}`);
  return head.join('\r\n') + '\r\n\r\n' + (flow.request.bodyText || '');
}

export function rawResponse(flow: Flow): string {
  if (!flow.response) return '';
  const head: string[] = [];
  head.push(`HTTP/${flow.response.httpVersion} ${flow.response.status} ${flow.response.statusText}`);
  for (const h of flow.response.headers) head.push(`${h.name}: ${h.value}`);
  return head.join('\r\n') + '\r\n\r\n' + (flow.response.bodyText || '');
}

export function rawExchange(flow: Flow): string {
  return rawRequest(flow) + '\r\n\r\n' + rawResponse(flow);
}

export function headersText(hs: Header[]): string {
  return hs.map((h) => `${h.name}: ${h.value}`).join('\r\n');
}

export function cookiesFromHeaders(hs: Header[], name: string): string {
  return hs.filter((h) => h.name.toLowerCase() === name.toLowerCase())
    .map((h) => h.value).join('\r\n');
}

export function toMarkdownTable(flow: Flow): string {
  const lines: string[] = [];
  lines.push('| 字段 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| Method | ${flow.request.method} |`);
  lines.push(`| URL | ${flow.request.url} |`);
  lines.push(`| Status | ${flow.response?.status ?? ''} |`);
  lines.push(`| Duration (ms) | ${flow.durationMs ?? ''} |`);
  lines.push(`| Req Size | ${flow.request.bodySize} |`);
  lines.push(`| Resp Size | ${flow.response?.bodySize ?? ''} |`);
  return lines.join('\n');
}

export function toCSV(flow: Flow): string {
  const esc = (v: string | number | undefined) => {
    const s = String(v ?? '');
    return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = 'method,url,status,duration_ms,req_size,resp_size';
  const row = [
    flow.request.method,
    flow.request.url,
    flow.response?.status ?? '',
    flow.durationMs ?? '',
    flow.request.bodySize,
    flow.response?.bodySize ?? '',
  ].map(esc).join(',');
  return header + '\n' + row;
}

function escapeSingle(s: string): string {
  return s.replace(/'/g, "'\\''");
}
