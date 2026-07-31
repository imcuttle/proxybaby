/**
 * Scripts 存储（whistle-scripts 插件的数据层）。
 *
 * 每个脚本一个文件：`<userData>/scripts/<id>__<name>__<enabled>.js`。
 * 通过 `script://<id>` 或 `script://<name>` 引用；执行时用 node:vm 建立独立 sandbox，
 * 暴露一个 `pb` 全局，包含 request / response 读写 API。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { app } from 'electron';
import type { Middleware, ProxyContext } from './context';

const SCRIPTS_DIR_NAME = 'scripts';

export interface ScriptRecord {
  id: string;
  name: string;
  enabled: boolean;
  always?: boolean;
  code: string;
  lastError?: string;
}

const DEFAULT_TEMPLATE = `// ProxyBaby Script
// 每个脚本导出 onRequest(pb) / onResponse(pb)，两阶段都可选。
// pb.request: { method, url, host, path, headers[], bodyText }
// pb.response: { status, statusText, headers[], bodyText }
// pb.setReqHeader(name, value) / pb.setResHeader(name, value)
// pb.abort(reason)   —— 立即中断请求
// pb.respond({ status, headers, bodyText })  —— 直接返回给客户端（不发上游）

/** @type {PBScriptModule} */
module.exports = {
  /** @param {PB} pb */
  onRequest(pb) {
    // 例：给所有请求加一个 header
    // pb.setReqHeader('X-ProxyBaby', 'hi');
  },
  /** @param {PB} pb */
  onResponse(pb) {
    // 例：修改响应体
    // if (pb.response) pb.response.bodyText = 'hello';
  },
};
`;

export class ScriptStore {
  private scripts: Map<string, ScriptRecord> = new Map();
  private dir: string;

  constructor() {
    this.dir = path.join(app.getPath('userData'), SCRIPTS_DIR_NAME);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this.loadFromDisk();
  }

  private loadFromDisk() {
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.js'));
    for (const f of files) {
      const abs = path.join(this.dir, f);
      const code = fs.readFileSync(abs, 'utf8');
      const meta = parseFileName(f);
      const always = /^\/\/\s*@always\b/m.test(code.split(/\r?\n/, 1)[0] || '');
      this.scripts.set(meta.id, { id: meta.id, name: meta.name, enabled: meta.enabled, code, always });
    }
  }

  private saveOne(rec: ScriptRecord) {
    for (const f of fs.readdirSync(this.dir)) {
      const m = parseFileName(f);
      if (m.id === rec.id) {
        try { fs.unlinkSync(path.join(this.dir, f)); } catch {}
      }
    }
    const fname = `${rec.id}__${encodeURIComponent(rec.name)}__${rec.enabled ? '1' : '0'}.js`;
    // 把 always 编码为首行注释，随代码文本保存
    const lines = rec.code.split(/\r?\n/);
    const first = lines[0] || '';
    if (rec.always && !/^\/\/\s*@always\b/.test(first)) {
      lines.unshift('// @always');
    } else if (!rec.always && /^\/\/\s*@always\b/.test(first)) {
      lines.shift();
    }
    fs.writeFileSync(path.join(this.dir, fname), lines.join('\n'));
  }

  list(): ScriptRecord[] {
    return [...this.scripts.values()];
  }

  get(idOrName: string): ScriptRecord | undefined {
    const byId = this.scripts.get(idOrName);
    if (byId) return byId;
    for (const s of this.scripts.values()) if (s.name === idOrName) return s;
    return undefined;
  }

  add(name: string, code?: string, enabled = true): ScriptRecord {
    const id = `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const rec: ScriptRecord = { id, name, enabled, code: code ?? DEFAULT_TEMPLATE };
    this.scripts.set(id, rec);
    this.saveOne(rec);
    return rec;
  }

  update(id: string, patch: Partial<Pick<ScriptRecord, 'name' | 'code' | 'enabled' | 'always'>>): ScriptRecord | undefined {
    const cur = this.scripts.get(id);
    if (!cur) return undefined;
    const next: ScriptRecord = { ...cur, ...patch, id };
    this.scripts.set(id, next);
    this.saveOne(next);
    return next;
  }

  remove(id: string): boolean {
    const cur = this.scripts.get(id);
    if (!cur) return false;
    this.scripts.delete(id);
    for (const f of fs.readdirSync(this.dir)) {
      const m = parseFileName(f);
      if (m.id === id) {
        try { fs.unlinkSync(path.join(this.dir, f)); } catch {}
      }
    }
    return true;
  }
}

function parseFileName(f: string): { id: string; name: string; enabled: boolean } {
  const base = f.replace(/\.js$/, '');
  const [id, encoded, enabled] = base.split('__');
  return {
    id: id || 'sc_unknown',
    name: encoded ? decodeURIComponent(encoded) : 'unnamed',
    enabled: enabled !== '0',
  };
}

/**
 * 全局 ScriptStore 引用。ProxyBaby 只需一份实例，operators.script 通过它按 id/name 取脚本。
 */
let storeRef: ScriptStore | null = null;
export function setScriptStore(store: ScriptStore | null) { storeRef = store; }
export function getScriptStore(): ScriptStore | null { return storeRef; }

// -------- 沙盒运行 --------

interface CompiledScript {
  onRequest?: (pb: PBApi) => any | Promise<any>;
  onResponse?: (pb: PBApi) => any | Promise<any>;
}

const compiledCache = new WeakMap<ScriptRecord, { code: string; compiled?: CompiledScript; err?: string }>();

function compile(rec: ScriptRecord): CompiledScript | null {
  const cached = compiledCache.get(rec);
  if (cached && cached.code === rec.code) return cached.compiled || null;
  const moduleObj: { exports: any } = { exports: {} };
  const sandbox: any = {
    module: moduleObj,
    exports: moduleObj.exports,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    JSON,
  };
  try {
    vm.createContext(sandbox);
    const script = new vm.Script(rec.code, { filename: `pb-script:${rec.name}.js` });
    script.runInContext(sandbox, { timeout: 1000 });
    const exp = moduleObj.exports || {};
    const compiled: CompiledScript = {
      onRequest: typeof exp.onRequest === 'function' ? exp.onRequest.bind(exp) : undefined,
      onResponse: typeof exp.onResponse === 'function' ? exp.onResponse.bind(exp) : undefined,
    };
    compiledCache.set(rec, { code: rec.code, compiled });
    rec.lastError = undefined;
    return compiled;
  } catch (err: any) {
    const msg = err?.message || String(err);
    compiledCache.set(rec, { code: rec.code, err: msg });
    rec.lastError = msg;
    return null;
  }
}

interface PBApi {
  request: {
    method: string;
    url: string;
    host: string;
    path: string;
    headers: { name: string; value: string }[];
    bodyText?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: { name: string; value: string }[];
    bodyText?: string;
  };
  setReqHeader(name: string, value: string): void;
  removeReqHeader(name: string): void;
  setResHeader(name: string, value: string): void;
  removeResHeader(name: string): void;
  abort(reason?: string): void;
  respond(response: { status: number; statusText?: string; headers?: { name: string; value: string }[]; bodyText: string }): void;
}

function buildApi(ctx: ProxyContext): PBApi {
  // 用 Proxy 把 pb.response.bodyText/pb.request.bodyText 的赋值同步到底层 buffer/size，
  // 避免用户改了 text 之后 bodyBuffer 还是旧值，被 onRequest 阶段用旧值写下游。
  const wrapReq = new Proxy(ctx.request as any, {
    set(t, p, v) {
      if (p === 'bodyText') {
        const buf = Buffer.from(String(v ?? ''), 'utf8');
        t.bodyText = String(v ?? '');
        t.bodyBuffer = buf;
        t.bodySize = buf.length;
        return true;
      }
      (t as any)[p] = v; return true;
    },
  });
  const wrapResp = ctx.response ? new Proxy(ctx.response as any, {
    set(t, p, v) {
      if (p === 'bodyText') {
        const buf = Buffer.from(String(v ?? ''), 'utf8');
        t.bodyText = String(v ?? '');
        t.bodyBuffer = buf;
        t.bodySize = buf.length;
        return true;
      }
      (t as any)[p] = v; return true;
    },
  }) : undefined;
  return {
    request: wrapReq,
    response: wrapResp,
    setReqHeader: (n, v) => ctx.setReqHeader(n, v),
    removeReqHeader: (n) => ctx.removeReqHeader(n),
    setResHeader: (n, v) => ctx.setResHeader(n, v),
    removeResHeader: (n) => ctx.removeResHeader(n),
    abort: (reason) => ctx.abort(reason),
    respond: (r) => {
      const buf = Buffer.from(r.bodyText, 'utf8');
      ctx.respond({
        status: r.status,
        statusText: r.statusText || '',
        httpVersion: '1.1',
        headers: r.headers || [{ name: 'content-type', value: 'text/plain; charset=utf-8' }],
        bodySize: buf.length,
        bodyBuffer: buf,
        bodyText: r.bodyText,
        contentType: '',
        isSSE: false,
      });
    },
  };
}

/**
 * script:// 操作符对应的 middleware。
 * value 是脚本 id 或 name；脚本被 disabled 或不存在时直接透传。
 */
export function scriptMiddleware(value: string | undefined): Middleware {
  return async (ctx, next) => {
    const store = getScriptStore();
    if (!store || !value) return next();
    const rec = store.get(value);
    if (!rec || !rec.enabled) return next();
    const compiled = compile(rec);
    if (!compiled) return next();
    const api = buildApi(ctx);
    try {
      if (compiled.onRequest) await compiled.onRequest(api);
    } catch (err: any) { rec.lastError = err?.message || String(err); }
    if (ctx.short) return;
    await next();
    if (ctx.response) {
      const api2 = buildApi(ctx);
      try {
        if (compiled.onResponse) await compiled.onResponse(api2);
      } catch (err: any) { rec.lastError = err?.message || String(err); }
    }
  };
}

/**
 * Scripts 需要缓冲响应体（onResponse 可能改 body）；请求体也保守缓冲以便脚本读/改。
 */
export const SCRIPT_HINTS = { needsReqBodyBuffer: true, needsResBodyBuffer: true };

// -------- 测试运行 --------

export interface ScriptTestCase {
  request: { method: string; url: string; headers?: { name: string; value: string }[]; bodyText?: string };
  response?: { status: number; statusText?: string; headers?: { name: string; value: string }[]; bodyText?: string };
}

export interface ScriptTestResult {
  ok: boolean;
  error?: string;
  logs: string[];
  aborted?: { reason?: string };
  responded?: { status: number; statusText?: string; headers: { name: string; value: string }[]; bodyText: string };
  request: {
    method: string;
    url: string;
    headers: { name: string; value: string }[];
    bodyText: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: { name: string; value: string }[];
    bodyText: string;
  };
}

/**
 * 在受限沙盒里跑一次脚本，用于设置页"测试"功能。
 * 不发起真实上游请求，只对合成的请求/响应对象跑 onRequest / onResponse。
 */
export async function runScriptTest(rec: ScriptRecord, tc: ScriptTestCase): Promise<ScriptTestResult> {
  const logs: string[] = [];
  const capturedConsole = {
    log: (...args: any[]) => logs.push(args.map((a) => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
    warn: (...args: any[]) => logs.push('[warn] ' + args.map((a) => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
    error: (...args: any[]) => logs.push('[error] ' + args.map((a) => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
    info: (...args: any[]) => logs.push(args.map((a) => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
  };
  // 编译（复用 buildApi 的语义，但用一个轻量 ctx-like 结构）
  const moduleObj: { exports: any } = { exports: {} };
  const sandbox: any = {
    module: moduleObj,
    exports: moduleObj.exports,
    console: capturedConsole,
    Buffer, setTimeout, clearTimeout, URL, URLSearchParams, JSON,
  };
  try {
    vm.createContext(sandbox);
    const script = new vm.Script(rec.code, { filename: `pb-script-test:${rec.name}.js` });
    script.runInContext(sandbox, { timeout: 1000 });
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
      logs,
      request: { method: tc.request.method, url: tc.request.url, headers: tc.request.headers || [], bodyText: tc.request.bodyText || '' },
      response: tc.response ? {
        status: tc.response.status, statusText: tc.response.statusText || '',
        headers: tc.response.headers || [], bodyText: tc.response.bodyText || '',
      } : undefined,
    };
  }
  const exp = moduleObj.exports || {};
  const onRequest: any = typeof exp.onRequest === 'function' ? exp.onRequest : null;
  const onResponse: any = typeof exp.onResponse === 'function' ? exp.onResponse : null;

  // 构造一个"迷你 ctx"：仅覆盖 API 需要的字段
  let aborted: ScriptTestResult['aborted'] = undefined;
  let responded: ScriptTestResult['responded'] = undefined;
  const req = {
    method: tc.request.method || 'GET',
    url: tc.request.url || '',
    host: safeHost(tc.request.url),
    path: safePath(tc.request.url),
    headers: [...(tc.request.headers || [])],
    bodyText: tc.request.bodyText || '',
  };
  const res = tc.response ? {
    status: tc.response.status,
    statusText: tc.response.statusText || '',
    headers: [...(tc.response.headers || [])],
    bodyText: tc.response.bodyText || '',
  } : undefined;

  const setHeader = (arr: { name: string; value: string }[], name: string, value: string) => {
    const i = arr.findIndex((h) => h.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) arr[i] = { name, value }; else arr.push({ name, value });
  };
  const removeHeader = (arr: { name: string; value: string }[], name: string) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].name.toLowerCase() === name.toLowerCase()) arr.splice(i, 1);
    }
  };
  const api: PBApi = {
    request: req,
    response: res,
    setReqHeader: (n, v) => setHeader(req.headers, n, v),
    removeReqHeader: (n) => removeHeader(req.headers, n),
    setResHeader: (n, v) => { if (res) setHeader(res.headers, n, v); },
    removeResHeader: (n) => { if (res) removeHeader(res.headers, n); },
    abort: (reason) => { aborted = { reason }; },
    respond: (r) => {
      responded = {
        status: r.status,
        statusText: r.statusText || '',
        headers: r.headers || [],
        bodyText: r.bodyText,
      };
    },
  };

  try {
    if (onRequest) await Promise.resolve(onRequest(api));
    if (res && onResponse && !aborted && !responded) await Promise.resolve(onResponse(api));
    return { ok: true, logs, aborted, responded, request: req, response: res };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err), logs, aborted, responded, request: req, response: res };
  }
}

function safeStringify(x: any) {
  try { return JSON.stringify(x); } catch { return String(x); }
}
function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}
function safePath(url: string): string {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return '/'; }
}
