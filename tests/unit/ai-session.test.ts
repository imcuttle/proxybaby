import { describe, it, expect } from 'vitest';
import { extractSessionId, extractRootRequestId, buildSessionTree } from '../../src/lib/ai-session';
import { mkFlow, mkReq } from '../fixtures';

describe('extractSessionId', () => {
  it('优先级 1: X-Conversation-Id', () => {
    const f = mkFlow({ request: mkReq({ headers: [{ name: 'X-Conversation-Id', value: 'c1' }, { name: 'X-Session-Id', value: 's1' }] }) });
    expect(extractSessionId(f)).toBe('c1');
  });
  it('大小写不敏感', () => {
    const f = mkFlow({ request: mkReq({ headers: [{ name: 'x-session-id', value: 's-lower' }] }) });
    expect(extractSessionId(f)).toBe('s-lower');
  });
  it('回退到 X-Chat-Id', () => {
    const f = mkFlow({ request: mkReq({ headers: [{ name: 'X-Chat-Id', value: 'chat-abc' }] }) });
    expect(extractSessionId(f)).toBe('chat-abc');
  });
  it('无相关 header 返回 null', () => {
    const f = mkFlow({ request: mkReq({ headers: [{ name: 'Authorization', value: 'Bearer x' }] }) });
    expect(extractSessionId(f)).toBeNull();
  });
  it('空 value 视为无', () => {
    const f = mkFlow({ request: mkReq({ headers: [{ name: 'X-Session-Id', value: '' }] }) });
    expect(extractSessionId(f)).toBeNull();
  });
});

describe('extractRootRequestId', () => {
  it('存在时返回 header 值', () => {
    const f = mkFlow({ request: mkReq({ headers: [{ name: 'X-Root-Request-Id', value: 'root-1' }] }) });
    expect(extractRootRequestId(f)).toBe('root-1');
  });
  it('大小写不敏感', () => {
    const f = mkFlow({ request: mkReq({ headers: [{ name: 'x-root-request-id', value: 'r2' }] }) });
    expect(extractRootRequestId(f)).toBe('r2');
  });
  it('缺失时返回 null（该 flow 将被排除）', () => {
    const f = mkFlow({ request: mkReq({ headers: [] }) });
    expect(extractRootRequestId(f)).toBeNull();
  });
});

describe('buildSessionTree', () => {
  const mk = (opts: { id: string; session?: string; root?: string; startedAt: number; body?: any }) =>
    mkFlow({
      id: opts.id,
      request: mkReq({
        startedAt: opts.startedAt,
        headers: [
          ...(opts.session ? [{ name: 'X-Conversation-Id', value: opts.session }] : []),
          ...(opts.root ? [{ name: 'X-Root-Request-Id', value: opts.root }] : []),
        ],
        bodyText: opts.body ? JSON.stringify(opts.body) : undefined,
      }),
    });

  it('空数组返回 []', () => {
    expect(buildSessionTree([])).toEqual([]);
  });

  it('无 session header 的 flow 被跳过', () => {
    const f = mk({ id: 'x', startedAt: 100 });
    expect(buildSessionTree([f])).toEqual([]);
  });

  it('无 root header 的 flow 也被跳过（不属于任何 turn）', () => {
    const f = mk({ id: 'x', session: 'S1', startedAt: 100 });
    expect(buildSessionTree([f])).toEqual([]);
  });

  it('同 sessionId 不同 rootRequestId → 多 turn', () => {
    const flows = [
      mk({ id: 'a', session: 'S1', root: 'r1', startedAt: 100 }),
      mk({ id: 'b', session: 'S1', root: 'r2', startedAt: 200 }),
    ];
    const tree = buildSessionTree(flows);
    expect(tree).toHaveLength(1);
    expect(tree[0].sessionId).toBe('S1');
    expect(tree[0].turns).toHaveLength(2);
    expect(tree[0].turns[0].rootRequestId).toBe('r1');
    expect(tree[0].turns[1].rootRequestId).toBe('r2');
  });

  it('同 sessionId 同 rootRequestId → 单 turn 多 request，按 startedAt 排序', () => {
    const flows = [
      mk({ id: 'b', session: 'S1', root: 'r1', startedAt: 300 }),
      mk({ id: 'a', session: 'S1', root: 'r1', startedAt: 100 }),
      mk({ id: 'c', session: 'S1', root: 'r1', startedAt: 200 }),
    ];
    const tree = buildSessionTree(flows);
    expect(tree).toHaveLength(1);
    expect(tree[0].turns).toHaveLength(1);
    expect(tree[0].turns[0].requests.map((r) => r.flowId)).toEqual(['a', 'c', 'b']);
  });

  it('Session 按 firstSeenAt 正序', () => {
    const flows = [
      mk({ id: 'b', session: 'S2', root: 'r', startedAt: 500 }),
      mk({ id: 'a', session: 'S1', root: 'r', startedAt: 100 }),
    ];
    const tree = buildSessionTree(flows);
    expect(tree.map((s) => s.sessionId)).toEqual(['S1', 'S2']);
  });

  it('Turn 内 firstSeenAt = 最早的 request', () => {
    const flows = [
      mk({ id: 'a', session: 'S1', root: 'r', startedAt: 300 }),
      mk({ id: 'b', session: 'S1', root: 'r', startedAt: 100 }),
    ];
    const tree = buildSessionTree(flows);
    expect(tree[0].turns[0].firstSeenAt).toBe(100);
  });

  it('从请求体解析 model', () => {
    const f = mk({ id: 'a', session: 'S1', root: 'r', startedAt: 100, body: { model: 'gpt-4o', messages: [] } });
    const tree = buildSessionTree([f]);
    expect(tree[0].turns[0].requests[0].model).toBe('gpt-4o');
  });
});
