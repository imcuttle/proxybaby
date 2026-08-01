/**
 * AI Sessions 独立子窗口视图。
 *
 * 左侧：Session → Turn → Request 三级树，随抓包实时刷新。
 * 右侧：选中 request 的 chat 预览（复用 ChatView）。
 * 交互：单击某 request 行 → 通过 broadcast 通知主窗口选中并滚动到该 flow。
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Bot, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { cn } from '../lib/cn';
import { buildSessionTree, type SessionNode, type RequestRef } from '../lib/ai-session';
import { detectProvider, parseSession } from '../parsers';
import { ChatView } from '../components/tabs/ChatView';
import { formatTime, formatDuration } from '../lib/format';
import { statusColor, methodColor } from '../lib/filter';
import type { Flow } from '../../shared/types';

export function AiSessionView() {
  // 本地维护 flowsById 的快照 + version 计数触发 memo 重算
  const [flowsById, setFlowsById] = useState<Map<string, Flow>>(new Map());
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [collapsedTurns, setCollapsedTurns] = useState<Record<string, boolean>>({});
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>({});

  const upsertFlow = useCallback((flow: Flow) => {
    setFlowsById((prev) => {
      const next = new Map(prev);
      next.set(flow.id, flow);
      return next;
    });
  }, []);

  const patchFlow = useCallback((id: string, patcher: (f: Flow) => Flow) => {
    setFlowsById((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(id, patcher(cur));
      return next;
    });
  }, []);

  const removeFlow = useCallback((id: string) => {
    setFlowsById((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // 初始拉快照 + 订阅事件
  useEffect(() => {
    const api = window.proxybaby;
    if (!api) return;
    let mounted = true;
    api.getFlows().then((list) => {
      if (!mounted) return;
      const m = new Map<string, Flow>();
      for (const f of list) m.set(f.id, f);
      setFlowsById(m);
    });

    const off1 = api.onEvent('flow:start', (flow: Flow) => upsertFlow(flow));
    const off2 = api.onEvent('flow:request-body', (p) =>
      patchFlow(p.id, (f) => ({
        ...f,
        request: { ...f.request, bodyText: p.bodyText, bodyBase64: p.bodyBase64, bodySize: p.bodySize },
      })),
    );
    const off3 = api.onEvent('flow:response-headers', (p) =>
      patchFlow(p.id, (f) => ({ ...f, response: p.response })),
    );
    const off4 = api.onEvent('flow:sse-frame', (p) =>
      patchFlow(p.id, (f) => ({ ...f, sseFrames: [...f.sseFrames, p.frame] })),
    );
    const off5 = api.onEvent('flow:response-body', (p) =>
      patchFlow(p.id, (f) => ({
        ...f,
        response: f.response
          ? { ...f.response, bodyText: p.bodyText, bodyBase64: p.bodyBase64, bodySize: p.bodySize }
          : f.response,
      })),
    );
    const off6 = api.onEvent('flow:end', (p) =>
      patchFlow(p.id, (f) => ({
        ...f,
        durationMs: p.durationMs,
        status: p.status,
        errorMessage: p.error,
      })),
    );
    const off7 = api.onEvent('flow:remove', (p) => removeFlow(p.id));
    // 主窗口 ChatView 点击"Session 视图"按钮打开本窗口时，会广播想要预选的 flow id
    const offPreselect = api.onEvent('ai-session:preselect-flow' as any, (p: any) => {
      if (p?.id) setSelectedFlowId(p.id);
    });

    return () => {
      mounted = false;
      off1(); off2(); off3(); off4(); off5(); off6(); off7(); offPreselect();
    };
  }, [upsertFlow, patchFlow, removeFlow]);

  // 派生树
  const tree = useMemo(() => buildSessionTree(Array.from(flowsById.values())), [flowsById]);

  // 统计
  const { totalTurns, totalRequests } = useMemo(() => {
    let t = 0;
    let r = 0;
    for (const s of tree) {
      t += s.turns.length;
      for (const tn of s.turns) r += tn.requests.length;
    }
    return { totalTurns: t, totalRequests: r };
  }, [tree]);

  const selectedFlow = selectedFlowId ? flowsById.get(selectedFlowId) ?? null : null;

  const handleSelect = useCallback((flowId: string) => {
    setSelectedFlowId(flowId);
    // 广播到主窗口，触发主窗口选中并滚动
    try { window.proxybaby.broadcast('ai-session:select-flow', { id: flowId }); } catch {}
  }, []);

  const toggleTurn = (key: string) =>
    setCollapsedTurns((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleSession = (key: string) =>
    setCollapsedSessions((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="h-full w-full flex flex-col bg-pb-bg text-pb-text" data-testid="ai-session-window">
      <div
        className="border-b border-pb-border bg-pb-bg pl-20 pr-2 py-1.5 text-sm flex items-center"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="font-semibold text-pb-text flex items-center gap-1.5">
          <Layers size={14} />
          AI Sessions
        </span>
        <span
          className="ml-3 text-xs text-pb-muted flex-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          data-testid="ai-session-summary"
        >
          {tree.length} 个会话 · {totalTurns} 轮 · {totalRequests} 个请求
        </span>
        <span className="ml-auto flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            className="pb-btn px-2 py-0.5 text-xs"
            onClick={() => window.proxybaby.closeSelfWindow()}
            data-testid="close-self"
          >关闭</button>
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" autoSaveId="proxybaby:ai-session-split">
          {/* 左侧：Session 树 */}
          <Panel defaultSize={40} minSize={20}>
            <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden pb-scroll">
              {tree.length === 0 ? (
                <div className="p-4 text-xs text-pb-muted">
                  暂无可展示的 AI 会话。
                  <div className="mt-2 text-pb-muted/70">
                    （需要请求同时带 Session Header（X-Conversation-Id 等）与 X-Root-Request-Id）
                  </div>
                </div>
              ) : (
                <div className="py-1">
                  {tree.map((s) => (
                    <SessionRow
                      key={s.sessionId}
                      session={s}
                      collapsed={!!collapsedSessions[s.sessionId]}
                      onToggle={() => toggleSession(s.sessionId)}
                      collapsedTurns={collapsedTurns}
                      onToggleTurn={toggleTurn}
                      selectedFlowId={selectedFlowId}
                      onSelectRequest={handleSelect}
                    />
                  ))}
                </div>
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="w-px bg-pb-border hover:bg-pb-accent transition-colors" />

          {/* 右侧：选中 flow 的 chat 预览 */}
          <Panel defaultSize={60} minSize={30}>
            <div className="h-full min-h-0 flex flex-col">
              {selectedFlow ? (
                <RightPreview flow={selectedFlow} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-pb-muted">
                  选择左侧一条请求以查看会话内容
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  collapsed,
  onToggle,
  collapsedTurns,
  onToggleTurn,
  selectedFlowId,
  onSelectRequest,
}: {
  session: SessionNode;
  collapsed: boolean;
  onToggle: () => void;
  collapsedTurns: Record<string, boolean>;
  onToggleTurn: (key: string) => void;
  selectedFlowId: string | null;
  onSelectRequest: (flowId: string) => void;
}) {
  const totalReq = session.turns.reduce((n, t) => n + t.requests.length, 0);
  return (
    <div className="border-b border-pb-border/40">
      <button
        onClick={onToggle}
        className="w-full min-w-0 max-w-full flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-pb-hover text-left"
        data-testid="ai-session-row"
        data-session-id={session.sessionId}
      >
        {collapsed ? <ChevronRight size={12} className="text-pb-muted shrink-0" /> : <ChevronDown size={12} className="text-pb-muted shrink-0" />}
        <span className="text-pb-accent font-mono truncate min-w-0 flex-1" title={session.sessionId}>
          {session.sessionId}
        </span>
        <span className="text-pb-muted shrink-0">{session.host}</span>
        <span className="text-pb-muted shrink-0">· {session.turns.length} 轮 · {totalReq} 请求</span>
        <span className="text-pb-muted/70 shrink-0 ml-2">{formatTime(session.firstSeenAt)}</span>
      </button>
      {!collapsed && (
        <div className="pl-4">
          {session.turns.map((t, ti) => {
            const key = `${session.sessionId}::${t.rootRequestId}`;
            const tCollapsed = !!collapsedTurns[key];
            return (
              <div key={key} className="border-t border-pb-border/30">
                <button
                  onClick={() => onToggleTurn(key)}
                  className="w-full min-w-0 max-w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-pb-hover text-left"
                  data-testid="ai-turn-row"
                  data-root-request-id={t.rootRequestId}
                >
                  {tCollapsed ? <ChevronRight size={11} className="text-pb-muted shrink-0" /> : <ChevronDown size={11} className="text-pb-muted shrink-0" />}
                  <span className="text-pb-warn shrink-0">Turn {ti + 1}</span>
                  <span className="text-pb-muted font-mono truncate min-w-0 flex-1" title={t.rootRequestId}>
                    {t.rootRequestId}
                  </span>
                  <span className="text-pb-muted shrink-0">{t.requests.length} 请求</span>
                </button>
                {!tCollapsed && (
                  <div className="pl-4">
                    {t.requests.map((r) => (
                      <RequestRow
                        key={r.flowId}
                        r={r}
                        selected={selectedFlowId === r.flowId}
                        onSelect={() => onSelectRequest(r.flowId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RequestRow({ r, selected, onSelect }: { r: RequestRef; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full min-w-0 max-w-full flex items-center gap-2 px-2 py-1 text-xs text-left border-t border-pb-border/20 hover:bg-pb-hover',
        selected && 'bg-pb-selected text-white hover:brightness-125',
      )}
      data-testid="ai-request-row"
      data-flow-id={r.flowId}
    >
      <span className="text-pb-muted font-mono shrink-0">{formatTime(r.startedAt)}</span>
      <span className={cn('method-badge shrink-0', methodColor(r.method))}>{r.method}</span>
      {typeof r.status === 'number' && (
        <span className={cn('status-badge shrink-0', statusColor(r.status))}>{r.status}</span>
      )}
      {r.streaming && <span className="text-pb-accent shrink-0">●</span>}
      {r.model && <span className="text-pb-muted shrink-0 truncate max-w-[80px]" title={r.model}>{r.model}</span>}
      {typeof r.totalTokens === 'number' && (
        <span className="text-pb-muted shrink-0">{r.totalTokens} tok</span>
      )}
      <span className="text-pb-muted shrink-0">{formatDuration(r.durationMs)}</span>
      <span className="min-w-0 flex-1 truncate font-mono" title={r.path}>{r.path}</span>
    </button>
  );
}

function RightPreview({ flow }: { flow: Flow }) {
  const provider = detectProvider(flow);
  if (provider === 'unknown') {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-pb-muted p-4 text-center">
        <div>
          此请求不在已支持的 AI 协议识别范围内（非 openai/anthropic/acp）。
          <div className="mt-2 font-mono">{flow.request.method} {flow.request.url}</div>
        </div>
      </div>
    );
  }
  // 只做只读渲染，用 side="both"
  void parseSession; // 保留 import 便于以后拓展
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-1.5 border-b border-pb-border text-xs flex items-center gap-2">
        <Bot size={12} className="text-pb-success" />
        <span className="font-mono truncate">{flow.request.url}</span>
      </div>
      <div className="flex-1 min-h-0">
        <ChatView flow={flow} provider={provider} side="both" hideSessionButton />
      </div>
    </div>
  );
}
