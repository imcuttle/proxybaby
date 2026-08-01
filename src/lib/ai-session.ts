/**
 * AI Session 聚合：把 Flow 数组按 header 聚合为 Session → Turn → Request 三级树。
 *
 * 判定策略（严格：完全依赖请求头，无 fallback）：
 *   Session key: X-Conversation-Id / X-Session-Id / X-Chat-Id / Conversation-Id / Session-Id
 *   Turn key:    X-Root-Request-Id
 *
 * 无 sessionId 的 flow 直接丢弃（不进入 Session 视图）。
 * 无 rootRequestId 的 flow 也直接丢弃（不属于任何 turn）。
 */
import type { Flow } from '../../shared/types';

/** 请求头查找（大小写不敏感）；返回首个非空值 */
function getHeader(flow: Flow, ...names: string[]): string | null {
  const lower = names.map((n) => n.toLowerCase());
  for (const h of flow.request.headers) {
    if (lower.includes(h.name.toLowerCase()) && h.value) return h.value;
  }
  return null;
}

/** 从请求头中提取 session id；找不到返回 null */
export function extractSessionId(flow: Flow): string | null {
  return getHeader(
    flow,
    'X-Conversation-Id',
    'X-Session-Id',
    'X-Chat-Id',
    'Conversation-Id',
    'Session-Id',
  );
}

/** 从请求头中提取 root request id（turn key）；缺失返回 null（此 flow 将被排除） */
export function extractRootRequestId(flow: Flow): string | null {
  return getHeader(flow, 'X-Root-Request-Id');
}

export interface RequestRef {
  flowId: string;
  startedAt: number;
  method: string;
  url: string;
  host: string;
  path: string;
  status?: number;
  streaming: boolean;
  durationMs?: number;
  model?: string;
  totalTokens?: number;
}

export interface TurnNode {
  rootRequestId: string;
  firstSeenAt: number;
  requests: RequestRef[];
}

export interface SessionNode {
  sessionId: string;
  host: string;
  firstSeenAt: number;
  turns: TurnNode[];
}

/** 尝试从请求体里读 model 字段（openai/anthropic 通用） */
function extractModel(flow: Flow): string | undefined {
  const t = flow.request.bodyText;
  if (!t) return undefined;
  try {
    const obj = JSON.parse(t);
    return typeof obj?.model === 'string' ? obj.model : undefined;
  } catch {
    return undefined;
  }
}

/** 尝试从响应里读 usage.total_tokens；不做重解析 SSE 帧，简单读非流式 body */
function extractTotalTokens(flow: Flow): number | undefined {
  const t = flow.response?.bodyText;
  if (t) {
    try {
      const obj = JSON.parse(t);
      const n = obj?.usage?.total_tokens ?? obj?.usage?.totalTokens;
      if (typeof n === 'number') return n;
    } catch {}
  }
  // SSE：扫最后几帧看是否有 usage
  const frames = flow.sseFrames;
  for (let i = frames.length - 1; i >= 0 && i >= frames.length - 8; i--) {
    const d = frames[i].data;
    if (!d || !d.includes('usage')) continue;
    try {
      const obj = JSON.parse(d);
      const n = obj?.usage?.total_tokens ?? obj?.usage?.totalTokens;
      if (typeof n === 'number') return n;
    } catch {}
  }
  return undefined;
}

function toRequestRef(flow: Flow): RequestRef {
  return {
    flowId: flow.id,
    startedAt: flow.request.startedAt,
    method: flow.request.method,
    url: flow.request.url,
    host: flow.request.host,
    path: flow.request.path,
    status: flow.response?.status,
    streaming: flow.status === 'streaming',
    durationMs: flow.durationMs,
    model: extractModel(flow),
    totalTokens: extractTotalTokens(flow),
  };
}

/**
 * 从 flows 派生 Session 树。
 * - 无 sessionId 的 flow 被跳过。
 * - 无 rootRequestId 的 flow 也被跳过（不属于任何 turn）。
 * - Session 按 firstSeenAt 正序（时间轴视角）。
 * - Turn 在 Session 内按 firstSeenAt 正序。
 * - Request 在 Turn 内按 startedAt 正序。
 */
export function buildSessionTree(flows: Flow[]): SessionNode[] {
  const sessions = new Map<string, SessionNode>();
  for (const f of flows) {
    const sid = extractSessionId(f);
    if (!sid) continue;
    const tid = extractRootRequestId(f);
    if (!tid) continue; // 无 root header 的 flow 完全排除
    const startedAt = f.request.startedAt;
    let session = sessions.get(sid);
    if (!session) {
      session = { sessionId: sid, host: f.request.host, firstSeenAt: startedAt, turns: [] };
      sessions.set(sid, session);
    } else {
      if (startedAt < session.firstSeenAt) session.firstSeenAt = startedAt;
    }
    let turn = session.turns.find((t) => t.rootRequestId === tid);
    if (!turn) {
      turn = { rootRequestId: tid, firstSeenAt: startedAt, requests: [] };
      session.turns.push(turn);
    } else if (startedAt < turn.firstSeenAt) {
      turn.firstSeenAt = startedAt;
    }
    turn.requests.push(toRequestRef(f));
  }
  const result = Array.from(sessions.values());
  // 排序
  for (const s of result) {
    s.turns.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
    for (const t of s.turns) t.requests.sort((a, b) => a.startedAt - b.startedAt);
  }
  result.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  return result;
}
