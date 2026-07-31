/**
 * Code Generator：把一个 flow 的请求生成成不同语言/工具的等价代码。
 * 纯函数，无副作用，便于单测。
 */
import type { Flow, Header } from '../../shared/types';

export type CodeLang = 'curl' | 'httpie' | 'fetch' | 'node' | 'python' | 'go';

export function generateCode(flow: Flow, lang: CodeLang): string {
  switch (lang) {
    case 'curl': return curl(flow);
    case 'httpie': return httpie(flow);
    case 'fetch': return fetchJs(flow);
    case 'node': return nodeAxios(flow);
    case 'python': return python(flow);
    case 'go': return goHttp(flow);
  }
}

function skipHeader(name: string): boolean {
  const l = name.toLowerCase();
  // content-encoding / transfer-encoding 描述的是线上编码（gzip/br/chunked 等）；
  // 重放时 body 已是解压后明文，保留会导致服务端按压缩格式解码失败。
  return (
    l === 'content-length' ||
    l === 'host' ||
    l === 'proxy-connection' ||
    l === 'connection' ||
    l === 'content-encoding' ||
    l === 'transfer-encoding'
  );
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function curl(flow: Flow): string {
  const lines: string[] = [];
  lines.push(`curl ${shellQuote(flow.request.url)}`);
  if (flow.request.method && flow.request.method !== 'GET') lines.push(`  -X ${flow.request.method}`);
  for (const h of flow.request.headers) {
    if (skipHeader(h.name)) continue;
    lines.push(`  -H ${shellQuote(`${h.name}: ${h.value}`)}`);
  }
  if (flow.request.bodyText) lines.push(`  --data-raw ${shellQuote(flow.request.bodyText)}`);
  return lines.join(' \\\n');
}

function httpie(flow: Flow): string {
  const parts: string[] = ['http'];
  if (flow.request.method && flow.request.method !== 'GET') parts.push(flow.request.method);
  parts.push(flow.request.url);
  for (const h of flow.request.headers) {
    if (skipHeader(h.name)) continue;
    parts.push(`${h.name}:${JSON.stringify(h.value)}`);
  }
  const body = flow.request.bodyText;
  let cmd = parts.join(' ');
  if (body) cmd = `echo ${shellQuote(body)} | ${cmd}`;
  return cmd;
}

function fetchJs(flow: Flow): string {
  const headers: Record<string, string> = {};
  for (const h of flow.request.headers) if (!skipHeader(h.name)) headers[h.name] = h.value;
  const opts: any = {
    method: flow.request.method,
    headers,
  };
  if (flow.request.bodyText) opts.body = flow.request.bodyText;
  return `fetch(${JSON.stringify(flow.request.url)}, ${JSON.stringify(opts, null, 2)})
  .then(res => res.text())
  .then(console.log);`;
}

function nodeAxios(flow: Flow): string {
  const headers: Record<string, string> = {};
  for (const h of flow.request.headers) if (!skipHeader(h.name)) headers[h.name] = h.value;
  const cfg: any = {
    method: flow.request.method,
    url: flow.request.url,
    headers,
  };
  if (flow.request.bodyText) cfg.data = flow.request.bodyText;
  return `import axios from 'axios';\n\naxios(${JSON.stringify(cfg, null, 2)}).then(r => console.log(r.data));`;
}

function python(flow: Flow): string {
  const lines: string[] = ['import requests', ''];
  lines.push(`url = ${JSON.stringify(flow.request.url)}`);
  const headers: Record<string, string> = {};
  for (const h of flow.request.headers) if (!skipHeader(h.name)) headers[h.name] = h.value;
  lines.push(`headers = ${JSON.stringify(headers, null, 2)}`);
  if (flow.request.bodyText) lines.push(`data = ${JSON.stringify(flow.request.bodyText)}`);
  const m = (flow.request.method || 'GET').toLowerCase();
  const dataArg = flow.request.bodyText ? ', data=data' : '';
  lines.push(`resp = requests.${m}(url, headers=headers${dataArg})`);
  lines.push('print(resp.text)');
  return lines.join('\n');
}

function goHttp(flow: Flow): string {
  const lines: string[] = [
    'package main',
    '',
    'import (',
    '  "bytes"',
    '  "fmt"',
    '  "io"',
    '  "net/http"',
    ')',
    '',
    'func main() {',
  ];
  if (flow.request.bodyText) {
    lines.push(`  body := bytes.NewBufferString(${JSON.stringify(flow.request.bodyText)})`);
    lines.push(`  req, _ := http.NewRequest(${JSON.stringify(flow.request.method)}, ${JSON.stringify(flow.request.url)}, body)`);
  } else {
    lines.push(`  req, _ := http.NewRequest(${JSON.stringify(flow.request.method)}, ${JSON.stringify(flow.request.url)}, nil)`);
  }
  for (const h of flow.request.headers) {
    if (skipHeader(h.name)) continue;
    lines.push(`  req.Header.Set(${JSON.stringify(h.name)}, ${JSON.stringify(h.value)})`);
  }
  lines.push('  resp, err := http.DefaultClient.Do(req)');
  lines.push('  if err != nil { panic(err) }');
  lines.push('  defer resp.Body.Close()');
  lines.push('  b, _ := io.ReadAll(resp.Body)');
  lines.push('  fmt.Println(string(b))');
  lines.push('}');
  return lines.join('\n');
}

export const CODE_LANGS: { key: CodeLang; label: string }[] = [
  { key: 'curl', label: 'cURL' },
  { key: 'httpie', label: 'HTTPie' },
  { key: 'fetch', label: 'Fetch (JS)' },
  { key: 'node', label: 'Node (axios)' },
  { key: 'python', label: 'Python' },
  { key: 'go', label: 'Go' },
];

/** 允许仅传 request-like 对象，方便单测和 Composer 复用 */
export function generateCodeFromRequest(
  req: { method?: string; url: string; headers?: Header[]; bodyText?: string },
  lang: CodeLang,
): string {
  const fakeFlow: any = {
    request: {
      method: req.method || 'GET',
      url: req.url,
      headers: req.headers || [],
      bodyText: req.bodyText,
    },
  };
  return generateCode(fakeFlow as Flow, lang);
}
