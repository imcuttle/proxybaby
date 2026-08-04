/**
 * 洋葱式中间件的 Context 对象。
 *
 * 中间件通过 ctx.request / ctx.response 读写，通过 ctx.respond() 短路。
 * 引擎在 middleware 链前后阶段负责把真正的上游请求发出去、把响应回填到 ctx。
 */
import type { IncomingMessage } from 'node:http';
import type { Header, RequestData, ResponseData, Flow } from '../../shared/types';

export interface MutableRequest extends RequestData {
  bodyBuffer?: Buffer;
}

export interface MutableResponse extends ResponseData {
  bodyBuffer?: Buffer;
}

/**
 * 修改动作，运行后引擎读取并应用。
 */
export type ShortCircuit =
  | { kind: 'respond'; response: MutableResponse }
  | { kind: 'abort'; reason?: string };

export class ProxyContext {
  request: MutableRequest;
  response?: MutableResponse;
  short?: ShortCircuit;
  meta: Record<string, unknown> = {};
  flowId: string;
  isTLS: boolean;
  clientReq: IncomingMessage;
  matched: { ruleId: string; ruleName: string; pattern: string; lineNo?: number }[] = [];
  appName?: string;

  constructor(init: {
    request: MutableRequest;
    isTLS: boolean;
    flowId: string;
    clientReq: IncomingMessage;
    appName?: string;
  }) {
    this.request = init.request;
    this.isTLS = init.isTLS;
    this.flowId = init.flowId;
    this.clientReq = init.clientReq;
    this.appName = init.appName;
  }

  respond(response: MutableResponse) {
    this.short = { kind: 'respond', response };
  }

  abort(reason?: string) {
    this.short = { kind: 'abort', reason };
  }

  getReqHeader(name: string): string | undefined {
    const lower = name.toLowerCase();
    return this.request.headers.find((h) => h.name.toLowerCase() === lower)?.value;
  }

  setReqHeader(name: string, value: string) {
    const lower = name.toLowerCase();
    const idx = this.request.headers.findIndex((h) => h.name.toLowerCase() === lower);
    if (idx >= 0) this.request.headers[idx].value = value;
    else this.request.headers.push({ name, value });
  }

  removeReqHeader(name: string) {
    const lower = name.toLowerCase();
    this.request.headers = this.request.headers.filter((h) => h.name.toLowerCase() !== lower);
  }

  setResHeader(name: string, value: string) {
    if (!this.response) return;
    const lower = name.toLowerCase();
    const idx = this.response.headers.findIndex((h) => h.name.toLowerCase() === lower);
    if (idx >= 0) this.response.headers[idx].value = value;
    else this.response.headers.push({ name, value });
  }

  removeResHeader(name: string) {
    if (!this.response) return;
    const lower = name.toLowerCase();
    this.response.headers = this.response.headers.filter((h) => h.name.toLowerCase() !== lower);
  }
}

export type Middleware =((ctx: ProxyContext, next: () => Promise<void>) => Promise<void> | void) & {
  __mwName?: string;
  __ruleId?: string;
  __rulePattern?: string;
};

/**
 * 给 Middleware 打上元数据，供 runMiddlewares 打trace 日志用。
 * 用法：`tag(fn, { name: 'reqHeaders', ruleId, pattern })`
 */
export function tagMw(
  fn: (ctx: ProxyContext, next: () => Promise<void>) => Promise<void> | void,
  meta: { name: string; ruleId?: string; pattern?: string },
): Middleware {
  const m = fn as Middleware;
  m.__mwName = meta.name;
  if (meta.ruleId) m.__ruleId = meta.ruleId;
  if (meta.pattern) m.__rulePattern = meta.pattern;
  return m;
}

//日志开关：PROXYBABY_LOG_MW=off 时完全跳过 trace 记录
const MW_TRACE_ENABLED = process.env.PROXYBABY_LOG_MW !== 'off';

/**
 * 用于快照 header列表以计算 diff。
 */
function headerMap(hs: Header[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!hs) return out;
  for (const h of hs) out[h.name.toLowerCase()] = h.value;
  return out;
}

function diffHeaders(before: Record<string, string>, after: Record<string, string>): string | null {
  const changed: string[] = [];
  for (const k of Object.keys(after)) {
    if (before[k] !== after[k]) changed.push(`+${k}=${truncate(after[k], 60)}`);
  }
  for (const k of Object.keys(before)) {
    if (!(k in after)) changed.push(`-${k}`);
  }
  return changed.length ? changed.join(' ') : null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export async function runMiddlewares(ctx: ProxyContext, mws: Middleware[]): Promise<void> {
  // 惰性加载 logger（避免 context.ts 被单测/工具类直接引入时依赖 electron）
  let logger: { debug: (...a: any[]) => void; info: (...a: any[]) => void; warn: (...a: any[]) => void } | null = null;
  if (MW_TRACE_ENABLED) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getLogger } = require('../util/logger');
      logger = getLogger('mw');
    } catch {
      logger = null;
    }
  }
  const flowShort = ctx.flowId.slice(0, 8);

  let i = -1;
  const dispatch = async (idx: number): Promise<void> => {
    if (idx <= i) throw new Error('next() called multiple times');
    i = idx;
    const mw = mws[idx];
    if (!mw) return;
    if (ctx.short) return;

    const name = mw.__mwName || `mw#${idx}`;
    const rule = mw.__ruleId ? ` rule=${mw.__ruleId}${mw.__rulePattern ? `(${mw.__rulePattern})` : ''}` : '';

    if (!logger) {
      await mw(ctx, () => dispatch(idx + 1));
      return;
    }

    const reqHdrBefore = headerMap(ctx.request.headers);
    const reqBodyBefore = ctx.request.bodySize;
    const t0 = Date.now();
    logger.debug(`→ [${flowShort}] enter ${name}${rule}`);

    try {
      await mw(ctx, () => dispatch(idx + 1));
    } catch (err) {
      logger.warn(`✗ [${flowShort}] ${name} threw`, (err as Error)?.message);
      throw err;
    }

    const ms = Date.now() - t0;
    const shortNow = ctx.short as ShortCircuit | undefined;
    if (shortNow) {
      logger.info(`⏹ [${flowShort}] SHORT-CIRCUIT ${shortNow.kind} by ${name}${rule} (${ms}ms)`);
    } else {
      const reqHdrDiff = diffHeaders(reqHdrBefore, headerMap(ctx.request.headers));
      const reqBodyDiff = ctx.request.bodySize !== reqBodyBefore
        ? `bodySize:${reqBodyBefore}→${ctx.request.bodySize}`
        : null;
      const resDiff = ctx.response
        ? `status=${ctx.response.status} bodySize=${ctx.response.bodySize}`
        : null;
      const parts = [reqHdrDiff && `reqHdr[${reqHdrDiff}]`, reqBodyDiff, resDiff].filter(Boolean);
      logger.debug(`← [${flowShort}] exit  ${name} (${ms}ms) ${parts.join(' ')}`);
    }
  };
  await dispatch(0);
}
