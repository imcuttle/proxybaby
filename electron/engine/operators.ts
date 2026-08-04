/**
 * 内置操作符 → middleware 生成器。
 * 每个操作符返回一个 middleware，被 rule engine 加入洋葱链。
 */
import fs from 'node:fs/promises';
import type { Middleware, MutableResponse, ProxyContext } from './context';
import { tagMw } from './context';
import type { RuleOperator } from './rule-parser';
import type { BreakpointController } from './breakpoint';
import { scriptMiddleware } from './scripts';
import { getNetworkProfile } from './network-conditions';
import type { RequestData, ResponseData } from '../../shared/types';
import { getLogger } from '../util/logger';

const logRuleLog = getLogger('rule:log');

export type OperatorFactory = (value: string | undefined, ctx: OperatorContext) => Middleware;

export interface OperatorContext {
  ruleFile?: string;
}

/**
 * 断点运行时：由 ProxyServer 注入。operators 里的 breakpoint 操作符使用它来
 * 挂起并等待 UI 决策。
 */
export interface BreakpointRuntime {
  controller: BreakpointController;
  emitPause: (flowId: string, stage: 'request' | 'response', request: RequestData, response?: ResponseData) => void;
}

let breakpointRuntime: BreakpointRuntime | null = null;
export function setBreakpointRuntime(rt: BreakpointRuntime | null) {
  breakpointRuntime = rt;
}

function applyResume(ctx: ProxyContext, r: { action: string; headers?: any[]; bodyText?: string; status?: number }, stage: 'request' | 'response') {
  if (r.action === 'abort') { ctx.abort('breakpoint:abort'); return; }
  if (stage === 'request') {
    if (r.headers) ctx.request.headers = r.headers;
    if (r.bodyText !== undefined) {
      const buf = Buffer.from(r.bodyText, 'utf8');
      ctx.request.bodyBuffer = buf;
      ctx.request.bodyText = r.bodyText;
      ctx.request.bodySize = buf.length;
    }
  } else if (ctx.response) {
    if (r.headers) ctx.response.headers = r.headers;
    if (r.status !== undefined) ctx.response.status = r.status;
    if (r.bodyText !== undefined) {
      const buf = Buffer.from(r.bodyText, 'utf8');
      ctx.response.bodyBuffer = buf;
      ctx.response.bodyText = r.bodyText;
      ctx.response.bodySize = buf.length;
    }
  }
}

// 请求前置阶段执行
function pre(fn: (ctx: ProxyContext) => Promise<void> | void): Middleware {
  return async (ctx, next) => {
    await fn(ctx);
    if (!ctx.short) await next();
  };
}

// 响应后置阶段执行
function post(fn: (ctx: ProxyContext) => Promise<void> | void): Middleware {
  return async (ctx, next) => {
    await next();
    if (ctx.response) await fn(ctx);
  };
}

export const OPERATORS: Record<string, OperatorFactory> = {
  statusCode: (value) =>
    post((ctx) => {
      if (!value || !ctx.response) return;
      const code = Number(value);
      if (!Number.isFinite(code)) return;
      ctx.response.status = code;
      ctx.response.statusText = '';
    }),

  redirect: (value) =>
    pre((ctx) => {
      if (!value) return;
      const resp: MutableResponse = {
        status: 302,
        statusText: 'Found',
        httpVersion: '1.1',
        headers: [{ name: 'Location', value }],
        bodySize: 0,
        contentType: '',
        isSSE: false,
      };
      ctx.respond(resp);
    }),

  abort: () => pre((ctx) => ctx.abort('rule:abort')),

  reqHeaders: (value) =>
    pre((ctx) => {
      const obj = safeJson(value);
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj as Record<string, string>)) {
        ctx.setReqHeader(k, String(v));
      }
    }),

  resHeaders: (value) =>
    post((ctx) => {
      const obj = safeJson(value);
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj as Record<string, string>)) {
        ctx.setResHeader(k, String(v));
      }
    }),

  reqBody: (value) =>
    pre((ctx) => {
      if (value === undefined) return;
      const buf = Buffer.from(value, 'utf8');
      ctx.request.bodyBuffer = buf;
      ctx.request.bodyText = value;
      ctx.request.bodySize = buf.length;
    }),

  resBody: (value) =>
    post((ctx) => {
      if (value === undefined || !ctx.response) return;
      const buf = Buffer.from(value, 'utf8');
      ctx.response.bodyBuffer = buf;
      ctx.response.bodyText = value;
      ctx.response.bodySize = buf.length;
    }),

  host: (value) =>
    pre((ctx) => {
      if (!value) return;
      ctx.meta.upstreamHost = value;
    }),

  file: (value) => async (ctx, next) => {
    if (!value) return next();
    try {
      const buf = await fs.readFile(value);
      ctx.respond({
        status: 200,
        statusText: 'OK',
        httpVersion: '1.1',
        headers: [{ name: 'content-type', value: guessMime(value) }, { name: 'content-length', value: String(buf.length) }],
        bodySize: buf.length,
        bodyBuffer: buf,
        bodyText: isText(value) ? buf.toString('utf8') : undefined,
        contentType: guessMime(value),
        isSSE: false,
      });
    } catch {
      // 读文件失败：放行
      return next();
    }
  },

  mock: (value) =>
    pre((ctx) => {
      if (!value) return;
      const buf = Buffer.from(value, 'utf8');
      ctx.respond({
        status: 200,
        statusText: 'OK',
        httpVersion: '1.1',
        headers: [
          { name: 'content-type', value: 'application/json' },
          { name: 'content-length', value: String(buf.length) },
        ],
        bodySize: buf.length,
        bodyBuffer: buf,
        bodyText: value,
        contentType: 'application/json',
        isSSE: false,
      });
    }),

  tpl: (value) => OPERATORS.file(value, {}),  // tpl 简化为直接 file

  reqDelay: (value) => async (ctx, next) => {
    const ms = Number(value);
    if (Number.isFinite(ms) && ms > 0) await sleep(ms);
    await next();
  },

  resDelay: (value) => async (ctx, next) => {
    await next();
    const ms = Number(value);
    if (Number.isFinite(ms) && ms > 0) await sleep(ms);
  },

  // 断点：value 可为 'req' | 'res' | 'both'（默认 both）
  breakpoint: (value) => async (ctx, next) => {
    const rt = breakpointRuntime;
    const mode = value || 'both';
    if (rt && rt.controller.isEnabled() && (mode === 'req' || mode === 'both')) {
      rt.emitPause(ctx.flowId, 'request', ctx.request);
      const r = await rt.controller.pause(ctx.flowId, 'request');
      applyResume(ctx, r, 'request');
      if (ctx.short) return;
    }
    await next();
    if (rt && rt.controller.isEnabled() && ctx.response && (mode === 'res' || mode === 'both')) {
      rt.emitPause(ctx.flowId, 'response', ctx.request, ctx.response);
      const r = await rt.controller.pause(ctx.flowId, 'response');
      applyResume(ctx, r, 'response');
    }
  },

  log: () => async (ctx, next) => {
    logRuleLog.info(`${ctx.request.method} ${ctx.request.url}`);
    await next();
    if (ctx.response) logRuleLog.info(`→ ${ctx.response.status} ${ctx.request.url}`);
  },

  ua: (value) =>
    pre((ctx) => {
      if (value) ctx.setReqHeader('User-Agent', value);
    }),

  referer: (value) =>
    pre((ctx) => {
      if (value) ctx.setReqHeader('Referer', value);
    }),

  req: (value) =>
    pre((ctx) => {
      if (!value) return;
      // 把请求转发到另一个 URL
      try {
        const u = new URL(value);
        ctx.meta.overrideUrl = u.toString();
      } catch {}
    }),

  res: (value) => OPERATORS.redirect(value, {}),

  script: (value) => scriptMiddleware(value),

  throttle: (value) => async (ctx, next) => {
    const profile = getNetworkProfile(value);
    if (!profile) return next();
    if (profile.latencyMs > 0) await sleep(profile.latencyMs);
    if (profile.kind === 'offline') { ctx.abort('network:offline'); return; }
    await next();
    // 根据下载速率延时：response body 越大等越久（粗粒度模拟）
    if (ctx.response && profile.downloadBps > 0) {
      const size = ctx.response.bodySize || 0;
      const extraMs = Math.min(60_000, Math.round((size / profile.downloadBps) * 1000));
      if (extraMs > 5) await sleep(extraMs);
    }
  },

  block: (value) => async (ctx) => {
    ctx.abort(value || 'blocked');
  },

  allow: () => async (_ctx, next) => {
    // allow 本身不产生副作用；配合 allow-list 插件识别。这里透传。
    await next();
  },
};

function safeJson(text?: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function guessMime(p: string): string {
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.html')) return 'text/html';
  if (p.endsWith('.js')) return 'application/javascript';
  if (p.endsWith('.css')) return 'text/css';
  if (p.endsWith('.txt')) return 'text/plain';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function isText(p: string): boolean {
  return /\.(json|html|js|css|txt|svg|xml|md)$/i.test(p);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function buildOpsMiddlewares(
  ops: RuleOperator[],
  meta?: { ruleId?: string; pattern?: string },
): Middleware[] {
  const mws: Middleware[] = [];
  for (const o of ops) {
    const factory = OPERATORS[o.op];
    if (factory) {
      const mw = factory(o.value, {});
      mws.push(tagMw(mw, { name: `op:${o.op}`, ruleId: meta?.ruleId, pattern: meta?.pattern }));
    }
  }
  return mws;
}

/**
 * 静态分析表：某个 op 是否需要在**发上游前**把请求体完整缓冲进内存。
 * 默认（不在表里）= 不需要，代理走请求体流式 pipe 路径，字节完整透传。
 */
export const OP_NEEDS_REQ_BODY: Record<string, true> = {
  reqBody: true,      // 直接改写请求体
  breakpoint: true,   // 用户可能在暂停时编辑请求体（保守）
  script: true,       // 脚本可能读/改请求体
};

/**
 * 静态分析表：某个 op 是否需要在**写下游前**把响应体（含 status/headers）完整缓冲。
 * 默认（不在表里）= 不需要，走响应流式 pipe 路径，字节完整透传下游。
 * 说明：
 *   - redirect/mock/file/abort 都是 pre 阶段短路（不走上游），不影响响应流式路径
 *   - resDelay 只是延时不改 body：为保持"响应结束再关闭下游"的语义，将其标记为需要缓冲，
 *     否则流式路径下没有统一的"响应结束"时刻可以延迟。
 */
export const OP_MUTATES_RESPONSE: Record<string, true> = {
  statusCode: true,
  resHeaders: true,
  resBody: true,
  breakpoint: true,
  resDelay: true,
  script: true,       // 脚本可能改响应
  throttle: true,     // throttle 依据 body 大小延时，需要 body 完整
};

export function opsRequireBuffering(ops: RuleOperator[]): {
  needsReqBodyBuffer: boolean;
  needsResBodyBuffer: boolean;
} {
  let req = false;
  let res = false;
  for (const o of ops) {
    if (OP_NEEDS_REQ_BODY[o.op]) req = true;
    if (OP_MUTATES_RESPONSE[o.op]) res = true;
    if (req && res) break;
  }
  return { needsReqBodyBuffer: req, needsResBodyBuffer: res };
}
