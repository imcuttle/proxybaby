import { useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useFlowStore } from './store/flows';
import { useAiStore } from './store/ai';
import { Sidebar } from './components/Sidebar';
import { RequestList } from './components/RequestList';
import { DetailPane } from './components/DetailPane';
import { Toolbar } from './components/Toolbar';
import { SearchBar } from './components/SearchBar';
import { StatusBar } from './components/StatusBar';
import { RulesView } from './components/RulesView';
import { SettingsView } from './components/SettingsView';
import { FilterConfigView } from './components/filter-config/FilterConfigView';
import { FilterEntryEditorView } from './components/filter-config/FilterEntryEditorView';
import { RuleQuickInputView } from './windows/RuleQuickInputView';
import { ComposerView } from './components/ComposerView';
import { DiffModal } from './components/DiffModal';
import { BreakpointModal } from './components/BreakpointModal';
import { ChatSidebar } from './components/ai/ChatSidebar';
import { useShortcuts } from './hooks/useShortcuts';
import { matchFilter } from './lib/filter';
import { cn } from './lib/cn';
import { Sparkles, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Flow } from '../shared/types';

/** 根据 hash 判断当前渲染的是主窗口还是子窗口。 */
type RouteName = 'main' | 'settings' | 'diff' | 'filter-config' | 'filter-entry-editor' | 'rule-quick-input';
const CHILD_ROUTES: readonly RouteName[] = ['settings', 'diff', 'filter-config', 'filter-entry-editor', 'rule-quick-input'] as const;

function useRoute(): RouteName {
  const parse = (): RouteName => {
    const h = (window.location.hash || '').replace('#', '');
    return (CHILD_ROUTES as readonly string[]).includes(h) ? (h as RouteName) : 'main';
  };
  const [route, setRoute] = useState<RouteName>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  if (route === 'settings') return <SettingsWindow />;
  if (route === 'diff') return <DiffWindow />;
  if (route === 'filter-config') return <FilterConfigWindow />;
  if (route === 'filter-entry-editor') return <FilterEntryEditorWindow />;
  if (route === 'rule-quick-input') return <RuleQuickInputWindow />;
  return <MainWindow />;
}

/**
 * 独立子窗口共用的黑底自定义标题栏。
 *  - `titleBarStyle: 'hiddenInset'` 隐藏系统 title，只留红绿灯 → pl-20 让位。
 *  - 整条 header 设为可拖拽区，交互元素（按钮/文本）用 `no-drag` 关掉拖拽。
 *  - showCloseButton=true 时右侧显示"关闭"按钮（原生红绿灯已经能关，这里给键盘友好 fallback）。
 */
function ChildWindowHeader({
  title,
  right,
  extra,
  showCloseButton = true,
}: {
  title: string;
  right?: React.ReactNode;
  extra?: React.ReactNode;
  showCloseButton?: boolean;
}) {
  return (
    <div
      className="border-b border-pb-border bg-pb-bg pl-20 pr-2 py-1.5 text-sm flex items-center"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="font-semibold text-pb-text">{title}</span>
      {extra && (
        <span
          className="ml-3 text-xs text-pb-muted truncate flex-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {extra}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {right}
        {showCloseButton && (
          <button
            className="pb-btn px-2 py-0.5 text-xs"
            onClick={() => window.proxybaby.closeSelfWindow()}
            data-testid="close-self"
          >关闭</button>
        )}
      </span>
    </div>
  );
}

/** 独立过滤规则编辑窗口。 */
function FilterEntryEditorWindow() {
  return (
    <div className="h-full w-full flex flex-col bg-pb-bg text-pb-text" data-testid="filter-entry-editor-window">
      <ChildWindowHeader title="新增过滤规则" />
      <div className="flex-1 min-h-0">
        <FilterEntryEditorView />
      </div>
    </div>
  );
}

/** 快速规则输入子窗口。 */
function RuleQuickInputWindow() {
  return (
    <div className="h-full w-full flex flex-col bg-pb-bg text-pb-text" data-testid="rule-quick-input-window">
      <ChildWindowHeader title="快速规则" />
      <div className="flex-1 min-h-0">
        <RuleQuickInputView />
      </div>
    </div>
  );
}

/** 独立过滤配置窗口。 */
function FilterConfigWindow() {
  return (
    <div className="h-full w-full flex flex-col bg-pb-bg text-pb-text" data-testid="filter-config-window">
      <ChildWindowHeader title="过滤配置" />
      <div className="flex-1 min-h-0">
        <FilterConfigView />
      </div>
    </div>
  );
}

/** 独立设置窗口：只渲染 SettingsView + 一个关闭按钮。 */
function SettingsWindow() {
  return (
    <div className="h-full w-full flex flex-col bg-pb-bg text-pb-text">
      <ChildWindowHeader title="设置" />
      <div className="flex-1 min-h-0">
        <SettingsView />
      </div>
    </div>
  );
}

/** 独立 Diff 窗口：读取主窗口传来的两个 flow id。 */
function DiffWindow() {
  const [left, setLeft] = useState<Flow | null>(null);
  const [right, setRight] = useState<Flow | null>(null);
  useEffect(() => {
    const api = window.proxybaby;
    // 打开时，主窗口会在 window:open 之后 broadcast 一个 diff:set 事件（含两个 flow 完整数据）
    const off = api.onEvent('diff:set' as any, (p: any) => {
      setLeft(p?.left ?? null);
      setRight(p?.right ?? null);
    });
    return () => off();
  }, []);
  return (
    <div className="h-full w-full flex flex-col bg-pb-bg text-pb-text" data-testid="diff-window">
      <ChildWindowHeader
        title="Diff"
        extra={
          <>
            {left ? `A: ${left.request.method} ${left.request.url}` : 'A: —'}
            {' · '}
            {right ? `B: ${right.request.method} ${right.request.url}` : 'B: —'}
          </>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto">
        <DiffModal open onClose={() => window.proxybaby.closeSelfWindow()} left={left} right={right} embedded />
      </div>
    </div>
  );
}

function MainWindow() {
  const hydrate = useFlowStore((s) => s.hydrate);
  const onFlowStart = useFlowStore((s) => s.onFlowStart);
  const onRequestBody = useFlowStore((s) => s.onRequestBody);
  const onResponseHeaders = useFlowStore((s) => s.onResponseHeaders);
  const onSSEFrame = useFlowStore((s) => s.onSSEFrame);
  const onWSMessage = useFlowStore((s) => s.onWSMessage);
  const onResponseBody = useFlowStore((s) => s.onResponseBody);
  const onFlowEnd = useFlowStore((s) => s.onFlowEnd);
  const onAppInfo = useFlowStore((s) => s.onAppInfo);
  const setProxyStatus = useFlowStore((s) => s.setProxyStatus);
  const setCertStatus = useFlowStore((s) => s.setCertStatus);
  const setSystemProxyOverride = useFlowStore((s) => s.setSystemProxyOverride);
  const setBreakpoint = useFlowStore((s) => s.setBreakpoint);
  const onTraffic = useFlowStore((s) => s.onTraffic);
  const removeFlow = useFlowStore((s) => s.removeFlow);
  const searchOpen = useFlowStore((s) => s.searchOpen);

  useEffect(() => {
    const api = window.proxybaby;
    if (!api) return;

    // 让 E2E 测试可以直接调用 store（例如清空 filter/多选，避免通过 UI 逐步点击的不稳定）
    (window as any).__pbStore = useFlowStore;
    (window as any).__pbAiStore = useAiStore;
    api.getFlows().then(hydrate);
    api.getProxyStatus().then(setProxyStatus);
    api.getCertStatus().then(setCertStatus);
    // 初始加载 AI 配置 & 会话，避免依赖 ChatSidebar mount
    if (api.aiGetConfig) {
      api.aiGetConfig().then((cfg) => { if (cfg) useAiStore.getState().setConfig(cfg); });
    }
    if (api.aiListSessions) {
      api.aiListSessions().then((list) => useAiStore.getState().setSessions(list || []));
    }
    if (api.aiGetCurrent) {
      api.aiGetCurrent().then((cur) => useAiStore.getState().setCurrent(cur || null));
    }

    const off1 = api.onEvent('flow:start', onFlowStart);
    const off2 = api.onEvent('flow:request-body', (p) =>
      onRequestBody(p.id, p.bodyText, p.bodyBase64, p.bodySize),
    );
    const off3 = api.onEvent('flow:response-headers', (p) => onResponseHeaders(p.id, p.response));
    const off4 = api.onEvent('flow:sse-frame', (p) => onSSEFrame(p.id, p.frame));
    const offWs = api.onEvent('flow:ws-message', (p) => onWSMessage(p.id, p.message));
    const off5 = api.onEvent('flow:response-body', (p) =>
      onResponseBody(p.id, p.bodyText, p.bodyBase64, p.bodySize),
    );
    const off6 = api.onEvent('flow:end', (p) =>
      onFlowEnd(p.id, p.durationMs, p.status, p.error),
    );
    const offAppInfo = api.onEvent('flow:app-info', (p) => onAppInfo(p.id, p.app));
    const off7 = api.onEvent('proxy:status', setProxyStatus);
    const off8 = api.onEvent('cert:status', setCertStatus);
    const offOverride = api.onEvent('proxy:override', setSystemProxyOverride);
    const offBp = api.onEvent('flow:breakpoint', (p) =>
      setBreakpoint({ id: p.id, stage: p.stage, request: p.request, response: p.response }),
    );
    const offTraffic = api.onEvent('proxy:traffic', onTraffic);
    const offRemove = api.onEvent('flow:remove', (p) => removeFlow(p.id));
    // AI 事件订阅（放在顶层，无论侧边栏是否打开都需要接收）
    const offAi1 = api.onEvent('ai:sessions' as any, (list: any) => useAiStore.getState().setSessions(list));
    const offAi2 = api.onEvent('ai:message-start' as any, (p: any) => useAiStore.getState().onMessageStart(p.sessionId, p.messageId, p.role));
    const offAi3 = api.onEvent('ai:text-delta' as any, (p: any) => useAiStore.getState().onTextDelta(p.sessionId, p.messageId, p.delta));
    const offAi4 = api.onEvent('ai:tool-call' as any, (p: any) => useAiStore.getState().onToolCall(p.sessionId, p.messageId, p.toolCall));
    const offAi5 = api.onEvent('ai:tool-result' as any, (p: any) => useAiStore.getState().onToolResult(p.sessionId, p.messageId, p.toolCallId, p.result, p.error));
    const offAi6 = api.onEvent('ai:message-end' as any, (p: any) => useAiStore.getState().onMessageEnd(p.sessionId, p.messageId));
    const offAi7 = api.onEvent('ai:error' as any, (p: any) => useAiStore.getState().onError(p.sessionId, p.error));
    return () => {
      off1(); off2(); off3(); off4(); offWs(); off5(); off6(); off7(); off8(); offBp();
      offTraffic(); offRemove(); offOverride(); offAppInfo();
      offAi1(); offAi2(); offAi3(); offAi4(); offAi5(); offAi6(); offAi7();
    };
  }, [
    hydrate,
    onFlowStart,
    onRequestBody,
    onResponseHeaders,
    onSSEFrame,
    onWSMessage,
    onResponseBody,
    onFlowEnd,
    onAppInfo,
    setProxyStatus,
    setCertStatus,
    setSystemProxyOverride,
    setBreakpoint,
    onTraffic,
    removeFlow,
  ]);

  // 快捷键：⌘F 切搜索栏；⌘↑↓ 跳命中
  const navigateHit = (dir: 'next' | 'prev') => {
    const s = useFlowStore.getState();
    const filtered = s.flows.filter((f) => matchFilter(f, s.filter, { pinnedIds: s.pinnedIds, savedIds: s.savedIds }));
    if (!filtered.length) return;
    const curIdx = filtered.findIndex((f) => f.id === s.selectedId);
    const nextIdx = curIdx < 0
      ? (dir === 'next' ? 0 : filtered.length - 1)
      : Math.max(0, Math.min(filtered.length - 1, curIdx + (dir === 'next' ? 1 : -1)));
    s.setSelected(filtered[nextIdx].id);
    // 滚动到可视区
    const row = document.querySelector(`[data-flow-id="${filtered[nextIdx].id}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  useShortcuts({ onNavigateHit: navigateHit });

  const [tab, setTab] = useState<'flows' | 'rules' | 'composer'>('flows');

  // 订阅 "nav:goto" 事件：Sidebar 右键"自定义规则"等场景需要切页
  useEffect(() => {
    const off = window.proxybaby.onEvent('nav:goto' as any, (p: any) => {
      if (p?.page === 'rules') setTab('rules');
      else if (p?.page === 'flows') setTab('flows');
      else if (p?.page === 'composer') setTab('composer');
    });
    return () => off();
  }, []);

  const flows = useFlowStore((s) => s.flows);
  const byId = useFlowStore((s) => s.byId);
  const selectedIds = useFlowStore((s) => s.selectedIds);
  // 保留 diff 相关状态：右键 Diff 走独立窗口，不再有 modal 入口
  void flows; void byId; void selectedIds;

  const openSettingsWindow = () => {
    window.proxybaby.openWindow('settings', { title: 'ProxyBaby · 设置', width: 900, height: 700 });
  };

  const aiPanelOpen = useAiStore((s) => s.panelOpen);
  const aiEnabled = useAiStore((s) => s.enabled);
  const toggleAiPanel = useAiStore((s) => s.togglePanel);
  const leftCollapsed = useFlowStore((s) => s.leftSidebarCollapsed);

  return (
    <div className="h-full w-full flex flex-col">
      <div
        className="flex items-center gap-1 border-b border-pb-border bg-pb-panel py-1.5 text-sm"
        // 留出左侧交通灯位置，并让标题栏可拖拽
        style={{ paddingLeft: 84, paddingRight: 12, ['WebkitAppRegion' as any]: 'drag' }}
      >
        <div className="flex items-center gap-1 flex-1" style={{ ['WebkitAppRegion' as any]: 'no-drag' }}>
          <TopTab active={tab === 'flows'} onClick={() => setTab('flows')}>抓包</TopTab>
          <TopTab active={tab === 'rules'} onClick={() => setTab('rules')}>规则</TopTab>
          <TopTab active={tab === 'composer'} onClick={() => setTab('composer')}>编写</TopTab>
          <button
            data-testid="open-settings"
            onClick={openSettingsWindow}
            className="ml-2 px-2 py-1 rounded text-pb-muted hover:bg-pb-hover"
            style={{ ['WebkitAppRegion' as any]: 'no-drag' }}
            title="打开设置窗口"
          >设置</button>
        </div>
        {aiEnabled && (
          <div style={{ ['WebkitAppRegion' as any]: 'no-drag' }}>
            <button
              data-testid="toggle-ai"
              data-open={aiPanelOpen ? 'true' : 'false'}
              onClick={toggleAiPanel}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded',
                aiPanelOpen ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
              )}
              title="AI 助手"
            >
              <Sparkles size={14} />
              <span className="text-xs">AI</span>
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          {tab === 'flows' ? (
            <div className="h-full">
              {leftCollapsed ? (
                <div className="h-full flex">
                  <CollapsedLeftRail />
                  <div className="flex-1 min-w-0 h-full flex flex-col">
                    <Toolbar />
                    {searchOpen && <SearchBar onNavigate={navigateHit} />}
                    <div className="flex-1 min-h-0">
                      <PanelGroup direction="vertical">
                        <Panel defaultSize={45} minSize={20}>
                          <RequestList />
                        </Panel>
                        <PanelResizeHandle className="h-px bg-pb-border hover:bg-pb-accent transition-colors" />
                        <Panel defaultSize={55} minSize={20}>
                          <DetailPane />
                        </Panel>
                      </PanelGroup>
                    </div>
                  </div>
                </div>
              ) : (
                <PanelGroup direction="horizontal">
                  <Panel defaultSize={20} minSize={12}>
                    <SidebarPanel />
                  </Panel>
                  <PanelResizeHandle className="w-px bg-pb-border hover:bg-pb-accent transition-colors" />
                  <Panel defaultSize={80} minSize={40}>
                    <div className="h-full flex flex-col">
                      <Toolbar />
                      {searchOpen && <SearchBar onNavigate={navigateHit} />}
                      <div className="flex-1 min-h-0">
                        <PanelGroup direction="vertical">
                          <Panel defaultSize={45} minSize={20}>
                            <RequestList />
                          </Panel>
                          <PanelResizeHandle className="h-px bg-pb-border hover:bg-pb-accent transition-colors" />
                          <Panel defaultSize={55} minSize={20}>
                            <DetailPane />
                          </Panel>
                        </PanelGroup>
                      </div>
                    </div>
                  </Panel>
                </PanelGroup>
              )}
            </div>
          ) : tab === 'rules' ? (
            <div className="h-full">
              <RulesView />
            </div>
          ) : (
            <div className="h-full">
              <ComposerView />
            </div>
          )}
        </div>
        {aiPanelOpen && aiEnabled && (
          <div className="w-[380px] shrink-0 border-l border-pb-border">
            <ChatSidebar />
          </div>
        )}
      </div>
      <StatusBar />
      <BreakpointModal />
    </div>
  );
}

function TopTab({
  active,
  onClick,
  children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 rounded transition-colors',
        active ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
      )}
    >
      {children}
    </button>
  );
}

/** 收起后的左侧薄条：只保留一个展开按钮。 */
function CollapsedLeftRail() {
  const toggle = useFlowStore((s) => s.toggleLeftSidebar);
  return (
    <div
      className="w-8 shrink-0 border-r border-pb-border bg-pb-panel flex flex-col items-center py-2"
      data-testid="left-collapsed-rail"
    >
      <button
        onClick={toggle}
        className="pb-btn"
        data-testid="expand-left-sidebar"
        title="展开左侧栏"
      >
        <PanelLeftOpen size={14} />
      </button>
    </div>
  );
}

/** Sidebar 容器：用 ResizeObserver 同步真实像素宽度到 store，供底部搜索框对齐。 */
function SidebarPanel() {
  const ref = useRef<HTMLDivElement>(null);
  const setSidebarWidthPx = useFlowStore((s) => s.setSidebarWidthPx);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSidebarWidthPx(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setSidebarWidthPx(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [setSidebarWidthPx]);
  return (
    <div ref={ref} className="h-full w-full">
      <Sidebar />
    </div>
  );
}
