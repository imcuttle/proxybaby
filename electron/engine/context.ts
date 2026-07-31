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
  matched: { ruleId: string; ruleName: string; pattern: string }[] = [];
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

export type Middleware = (ctx: ProxyContext, next: () => Promise<void>) => Promise<void> | void;

export async function runMiddlewares(ctx: ProxyContext, mws: Middleware[]): Promise<void> {
  let i = -1;
  const dispatch = async (idx: number): Promise<void> => {
    if (idx <= i) throw new Error('next() called multiple times');
    i = idx;
    const mw = mws[idx];
    if (!mw) return;
    if (ctx.short) return;
    await mw(ctx, () => dispatch(idx + 1));
  };
  await dispatch(0);
}
