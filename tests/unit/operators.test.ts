import { describe, it, expect } from 'vitest';
import { buildOpsMiddlewares } from '../../electron/engine/operators';
import { ProxyContext, runMiddlewares } from '../../electron/engine/context';
import { mkReq } from '../fixtures';

async function runOp(ops: { op: string; value?: string }[]) {
  const ctx = new ProxyContext({ request: { ...mkReq() } as any, isTLS: true, flowId: 'x', clientReq: {} as any });
  const mws = buildOpsMiddlewares(ops);
  const upstream = async (_c: any, next: any) => {
    if (!ctx.response) {
      ctx.response = { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, contentType: 'application/json', isSSE: false, bodyText: 'orig' };
    }
    await next();
  };
  await runMiddlewares(ctx, [...mws, upstream]);
  return ctx;
}

describe('操作符 middleware', () => {
  it('statusCode 改写响应状态', async () => {
    const ctx = await runOp([{ op: 'statusCode', value: '503' }]);
    expect(ctx.response?.status).toBe(503);
  });

  it('redirect 短路 302', async () => {
    const ctx = await runOp([{ op: 'redirect', value: 'https://z.com' }]);
    expect(ctx.short).toMatchObject({ kind: 'respond' });
    expect((ctx.short as any).response.status).toBe(302);
  });

  it('abort 短路', async () => {
    const ctx = await runOp([{ op: 'abort' }]);
    expect(ctx.short?.kind).toBe('abort');
  });

  it('reqHeaders 注入', async () => {
    const ctx = await runOp([{ op: 'reqHeaders', value: '{"X-Test":"v"}' }]);
    expect(ctx.getReqHeader('X-Test')).toBe('v');
  });

  it('resHeaders 注入', async () => {
    const ctx = await runOp([{ op: 'resHeaders', value: '{"X-R":"1"}' }]);
    expect(ctx.response?.headers.some((h) => h.name === 'X-R')).toBe(true);
  });

  it('reqBody 替换', async () => {
    const ctx = await runOp([{ op: 'reqBody', value: 'newbody' }]);
    expect(ctx.request.bodyText).toBe('newbody');
  });

  it('resBody 替换', async () => {
    const ctx = await runOp([{ op: 'resBody', value: 'RB' }]);
    expect(ctx.response?.bodyText).toBe('RB');
  });

  it('mock 短路返回 JSON', async () => {
    const ctx = await runOp([{ op: 'mock', value: '{"m":1}' }]);
    expect((ctx.short as any).response.bodyText).toBe('{"m":1}');
  });

  it('host 记录到 meta', async () => {
    const ctx = await runOp([{ op: 'host', value: '127.0.0.1:9' }]);
    expect(ctx.meta.upstreamHost).toBe('127.0.0.1:9');
  });

  it('ua/referer 设置请求头', async () => {
    const ctx = await runOp([{ op: 'ua', value: 'UA1' }, { op: 'referer', value: 'R1' }]);
    expect(ctx.getReqHeader('User-Agent')).toBe('UA1');
    expect(ctx.getReqHeader('Referer')).toBe('R1');
  });
});
