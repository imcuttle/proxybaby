/**
 * 内容嗅探：把 (contentType, bodyText, bodyBase64) 映射到"最合适的默认预览格式"，
 * 并暴露出**当前 body 支持哪些子标签**（在 UI 里对无关格式做 disable，一目了然）。
 */

export type PreviewFormat =
  | 'auto'
  | 'json'
  | 'json-tree'
  | 'form'
  | 'multipart'
  | 'html'
  | 'html-webview'
  | 'css'
  | 'js'
  | 'xml'
  | 'image'
  | 'hex'
  | 'text'
  | 'graphql'
  | 'sse'
  | 'openai'
  | 'protobuf'
  | 'msgpack'
  | 'summary';

export interface BodyKind {
  supported: PreviewFormat[];
  suggested: PreviewFormat;
  isText: boolean;
  isJson: boolean;
  isImage: boolean;
  isForm: boolean;
  isMultipart: boolean;
  isHtml: boolean;
  isCss: boolean;
  isJs: boolean;
  isXml: boolean;
  isGraphQL: boolean;
}

export function detectBody(input: {
  contentType?: string;
  bodyText?: string;
  bodyBase64?: string;
  bodySize?: number;
  urlPath?: string;
}): BodyKind {
  const ct = (input.contentType || '').toLowerCase();
  const text = input.bodyText;

  const isImage = /^image\//.test(ct);
  const isHtml = /text\/html|application\/xhtml\+xml/.test(ct) || (!!text && /^\s*<!doctype\s+html/i.test(text));
  const isXml = /xml/.test(ct) && !isHtml;
  const isCss = /text\/css/.test(ct);
  const isJs = /javascript|ecmascript/.test(ct);
  const isForm = /application\/x-www-form-urlencoded/.test(ct);
  const isMultipart = /multipart\/form-data/.test(ct);

  let isJson = /json/.test(ct);
  if (!isJson && text) {
    const t = text.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { JSON.parse(t); isJson = true; } catch {}
    }
  }

  let isGraphQL = /graphql/.test(ct) || /\/graphql/.test(input.urlPath || '');
  if (!isGraphQL && isJson && text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
        isGraphQL = arr.every((it) => it && typeof it === 'object' && 'query' in it && typeof (it as any).query === 'string');
      }
    } catch {}
  }

  const isText = !!text && (
    isJson || isHtml || isXml || isCss || isJs || isForm || isGraphQL ||
    /^(text\/|application\/(json|xml|graphql|xhtml\+xml|x-www-form-urlencoded))/.test(ct) ||
    ct === '' /* 可能就是纯文本 */
  );

  const supported: PreviewFormat[] = [];
  if (isJson) { supported.push('json-tree', 'json'); }
  if (isHtml) supported.push('html');
  if (isCss) supported.push('css');
  if (isJs) supported.push('js');
  if (isXml) supported.push('xml');
  if (isForm) supported.push('form');
  if (isMultipart) supported.push('multipart');
  if (isImage) supported.push('image');
  if (isGraphQL) supported.push('graphql');
  if (isText) supported.push('text');
  supported.push('hex');       // 任何 body 都可以看 hex

  let suggested: PreviewFormat = 'text';
  if (isImage) suggested = 'image';
  else if (isJson) suggested = 'json-tree';
  else if (isGraphQL) suggested = 'graphql';
  else if (isForm) suggested = 'form';
  else if (isMultipart) suggested = 'multipart';
  else if (isHtml) suggested = 'html';
  else if (isXml) suggested = 'xml';
  else if (isCss) suggested = 'css';
  else if (isJs) suggested = 'js';
  else if (!isText) suggested = 'hex';

  return { supported, suggested, isText, isJson, isImage, isForm, isMultipart, isHtml, isCss, isJs, isXml, isGraphQL };
}

/** base64 → Uint8Array（浏览器环境） */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** utf8 字符串 → Uint8Array */
export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** 把字节数组格式化成 hex dump（默认 16 列） */
export function toHexDump(bytes: Uint8Array, columns = 16, maxBytes = 64 * 1024): string {
  const cap = Math.min(bytes.length, maxBytes);
  const lines: string[] = [];
  for (let i = 0; i < cap; i += columns) {
    const slice = bytes.subarray(i, Math.min(i + columns, cap));
    const hex: string[] = [];
    let ascii = '';
    for (let j = 0; j < slice.length; j++) {
      hex.push(slice[j].toString(16).padStart(2, '0'));
      const c = slice[j];
      ascii += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.';
    }
    while (hex.length < columns) hex.push('  ');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii}|`);
  }
  if (bytes.length > cap) lines.push(`... (+${bytes.length - cap} bytes, truncated)`);
  return lines.join('\n');
}

/** urlencoded 分析成 kv 列表 */
export function parseFormUrlencoded(text: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const params = new URLSearchParams(text);
  for (const [k, v] of params.entries()) out.push({ name: k, value: v });
  return out;
}

/** 极简 multipart/form-data 解析：从 content-type 里提 boundary，把 body 按段拆分 */
export function parseMultipart(text: string, contentType: string): { name: string; filename?: string; contentType?: string; value: string }[] {
  const m = /boundary=("?)([^";]+)\1/i.exec(contentType);
  if (!m) return [];
  const boundary = `--${m[2]}`;
  const parts = text.split(boundary).slice(1, -1);
  const out: { name: string; filename?: string; contentType?: string; value: string }[] = [];
  for (const part of parts) {
    const trimmed = part.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    const headerEnd = trimmed.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headerBlock = trimmed.slice(0, headerEnd);
    const body = trimmed.slice(headerEnd + 4);
    let name = '', filename: string | undefined, ct: string | undefined;
    for (const line of headerBlock.split(/\r?\n/)) {
      const cd = /content-disposition:\s*form-data;(.*)/i.exec(line);
      if (cd) {
        const nm = /\bname="([^"]*)"/i.exec(cd[1]); if (nm) name = nm[1];
        const fn = /\bfilename="([^"]*)"/i.exec(cd[1]); if (fn) filename = fn[1];
      }
      const c = /content-type:\s*(.+)/i.exec(line); if (c) ct = c[1].trim();
    }
    out.push({ name, filename, contentType: ct, value: body });
  }
  return out;
}

/**
 * 尝试识别 body 是否属于 GraphQL 请求。返回归一化后的操作。
 * 支持单请求或数组 batch。
 */
export interface GraphQLOp {
  operationName?: string;
  query: string;
  variables?: unknown;
}
export function parseGraphQL(bodyText: string): GraphQLOp[] | null {
  try {
    const parsed = JSON.parse(bodyText);
    const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
    const ops: GraphQLOp[] = [];
    for (const it of arr) {
      if (it && typeof it === 'object' && typeof it.query === 'string') {
        ops.push({ query: it.query, operationName: it.operationName, variables: it.variables });
      } else {
        return null;
      }
    }
    return ops.length ? ops : null;
  } catch { return null; }
}
