/**
 * 渲染层的 flow store：接收主进程推送的 IPC 事件，维护 flows 列表。
 * 使用 zustand。UI 层订阅。
 */
import { create } from 'zustand';
import type { Flow, SSEFrame, ResponseData, ProxyStatus, CertStatus, WSMessage, RequestData, SystemProxyOverride } from '../../shared/types';
import type { PreviewFormat } from '../lib/body-detect';

export interface ActiveBreakpoint {
  id: string;
  stage: 'request' | 'response';
  request: RequestData;
  response?: ResponseData;
}

export type SearchScope = 'url' | 'reqHeaders' | 'respHeaders' | 'body' | 'method' | 'status';
export type SearchMode = 'contains' | 'equals' | 'regex';

export type SortKey =
  | 'index' | 'url' | 'client' | 'method' | 'status'
  | 'time' | 'duration' | 'reqSize' | 'respSize'
  | 'edited' | 'note';
export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export interface FilterState {
  text: string;
  scope: SearchScope;
  mode: SearchMode;
  enabled: boolean;                 // 搜索栏 checkbox 是否勾选
  type: 'all' | 'http' | 'https' | 'websocket' | 'json' | 'form' | 'xml' | 'js' | 'css' | 'graphql' | 'doc' | 'media' | 'other'
      | '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
  appName?: string;
  host?: string;
  pathPrefix?: string;
  special?: 'pinned' | 'saved';
  advanced?: AdvancedFilter;
}

/** 高级过滤器：多条件 AND/OR 组合。 */
export type AdvancedField =
  | 'url' | 'method' | 'status' | 'host' | 'path'
  | 'reqHeader' | 'respHeader' | 'reqBody' | 'respBody' | 'contentType';

export type AdvancedOp =
  | 'contains' | 'equals' | 'notEquals' | 'regex' | 'startsWith' | 'endsWith' | 'gt' | 'lt';

export interface AdvancedRule {
  field: AdvancedField;
  /** 当 field 是 reqHeader/respHeader 时，指定 header 名（不区分大小写） */
  headerName?: string;
  op: AdvancedOp;
  value: string;
  negate?: boolean;
}

export interface AdvancedFilter {
  combinator: 'AND' | 'OR';
  rules: AdvancedRule[];
}

export interface FilterPreset {
  id: string;
  name: string;
  filter: FilterState;
}

export interface TrafficStat {
  totalBytes: number;
  rxRate: number;
  txRate: number;
}

/** 自定义预览 Tab 偏好：Request/Response 面板各自启用的额外预览格式列表。 */
export interface CustomTabsPref {
  request: PreviewFormat[];
  response: PreviewFormat[];
}

interface FlowState {
  flows: Flow[];
  byId: Record<string, Flow>;
  selectedId: string | null;                    // 主选中（anchor / DetailPane 展示）
  selectedIds: Record<string, true>;            // 多选集合（含主选）
  /** 触发外部（跨窗口）选中时，同时设这个值请求 RequestList 滚动到位；消费后置回 null。 */
  scrollTargetId: string | null;
  filter: FilterState;
  pinnedIds: Record<string, true>;
  /** 按 host 置顶：该 host 的所有 flow 在列表里排到前面（持久化） */
  pinnedHosts: Record<string, true>;
  /** 按 URL 前缀置顶：命中前缀的所有 flow 在列表里排到前面（持久化） */
  pinnedPaths: Record<string, true>;
  savedIds: Record<string, true>;
  noteById: Record<string, string>;
  highlightById: Record<string, string>;      // color: 'red' | 'orange' | 'yellow' | 'green' | 'blue'
  proxyStatus: ProxyStatus | null;
  certStatus: CertStatus | null;
  systemProxyOverride: SystemProxyOverride | null;
  activeBreakpoint: ActiveBreakpoint | null;
  // UI state
  searchOpen: boolean;
  autoFollow: boolean;
  statusChipsExpanded: boolean;
  sidebarQuery: string;                         // Sidebar 底部搜索输入（过滤应用/域名/路径）
  sidebarWidthPx: number;                       // 侧边栏当前渲染宽度（用于底部搜索框宽度对齐）
  leftSidebarCollapsed: boolean;                // 是否收起左侧栏
  traffic: TrafficStat;
  mitmDisabledHosts: Record<string, true>;
  sort: SortState | null;                       // null = 按抓包顺序
  columnWidths: Record<string, number>;         // 覆盖 RequestList 的默认宽度
  customTabs: CustomTabsPref;                   // 用户自定义启用的预览 Tab

  setBreakpoint(bp: ActiveBreakpoint | null): void;
  setSelected(id: string | null): void;
  toggleSelected(id: string): void;                            // Cmd/Ctrl+Click
  rangeSelect(id: string, orderedIds: string[]): void;          // Shift+Click
  clearSelection(): void;
  /** 请求 RequestList 把某条 flow 滚动到可视区（跨窗口联动用） */
  requestScrollTo(id: string | null): void;
  setFilter(patch: Partial<FilterState>): void;
  resetFilter(): void;
  togglePin(id: string): void;
  togglePinHost(host: string): void;
  togglePinPath(prefix: string): void;
  /** 清空某 host 的所有置顶（host + 其下 subpath），统一"取消置顶" */
  unpinHostAll(host: string): void;
  toggleSave(id: string): void;
  setNote(id: string, note: string): void;
  setHighlight(id: string, color: string | null): void;
  toggleSearch(): void;
  setSearchOpen(v: boolean): void;
  toggleAutoFollow(): void;
  toggleStatusChips(): void;
  setSidebarQuery(v: string): void;
  setSidebarWidthPx(v: number): void;
  toggleLeftSidebar(): void;
  toggleMitmDisabledHost(host: string): void;
  cycleSort(key: SortKey): void;               // null → asc → desc → null
  setColumnWidth(key: string, width: number): void;
  resetColumnWidths(): void;
  toggleCustomTab(panel: 'request' | 'response', fmt: PreviewFormat): void;
  setCustomTabs(next: CustomTabsPref): void;
  removeFlow(id: string): void;
  onTraffic(t: TrafficStat): void;
  hydrate(flows: Flow[]): void;
  onFlowStart(f: Flow): void;
  onRequestBody(id: string, bodyText?: string, bodyBase64?: string, bodySize?: number): void;
  onResponseHeaders(id: string, response: ResponseData): void;
  onSSEFrame(id: string, frame: SSEFrame): void;
  onWSMessage(id: string, message: WSMessage): void;
  onResponseBody(id: string, bodyText?: string, bodyBase64?: string, bodySize?: number): void;
  onFlowEnd(id: string, durationMs: number, status: Flow['status'], error?: string): void;
  onAppInfo(id: string, app: NonNullable<Flow['app']>): void;
  clear(): void;
  setProxyStatus(s: ProxyStatus): void;
  setCertStatus(s: CertStatus): void;
  setSystemProxyOverride(s: SystemProxyOverride | null): void;
}

const DEFAULT_FILTER: FilterState = {
  text: '',
  scope: 'url',
  mode: 'contains',
  enabled: true,
  type: 'all',
};

// 表头 UI 偏好持久化（排序、列宽）
const LS_KEY_SORT = 'proxybaby:list-sort';
const LS_KEY_COL_WIDTHS = 'proxybaby:list-col-widths';
const LS_KEY_CUSTOM_TABS = 'proxybaby:custom-tabs';
const LS_KEY_PINNED_HOSTS = 'proxybaby:pinned-hosts';
const LS_KEY_PINNED_PATHS = 'proxybaby:pinned-paths';
const ALL_FORMATS: PreviewFormat[] = [
  'json', 'json-tree', 'form', 'multipart', 'html', 'html-webview',
  'css', 'js', 'xml', 'image', 'hex', 'graphql', 'text',
  'sse', 'openai', 'protobuf', 'msgpack', 'summary',
];
function loadSort(): SortState | null {
  try {
    const v = localStorage.getItem(LS_KEY_SORT);
    if (v === null) {
      // 首次进入：按抓包顺序倒序（最新在最上），符合直觉
      return { key: 'index', dir: 'desc' };
    }
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed.key === 'string' && (parsed.dir === 'asc' || parsed.dir === 'desc')) {
      return parsed as SortState;
    }
  } catch {}
  return { key: 'index', dir: 'desc' };
}
function loadColumnWidths(): Record<string, number> {
  try {
    const v = localStorage.getItem(LS_KEY_COL_WIDTHS);
    if (!v) return {};
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, number> = {};
      for (const [k, w] of Object.entries(parsed)) {
        if (typeof w === 'number' && Number.isFinite(w) && w > 20) out[k] = w;
      }
      return out;
    }
  } catch {}
  return {};
}
function persistSort(sort: SortState | null) {
  try {
    if (sort) localStorage.setItem(LS_KEY_SORT, JSON.stringify(sort));
    else localStorage.removeItem(LS_KEY_SORT);
  } catch {}
}
function persistColumnWidths(widths: Record<string, number>) {
  try { localStorage.setItem(LS_KEY_COL_WIDTHS, JSON.stringify(widths)); } catch {}
}

function loadCustomTabs(): CustomTabsPref {
  try {
    const v = localStorage.getItem(LS_KEY_CUSTOM_TABS);
    if (!v) return { request: [], response: [] };
    const parsed = JSON.parse(v);
    const sanitize = (a: unknown): PreviewFormat[] => {
      if (!Array.isArray(a)) return [];
      return a.filter((x): x is PreviewFormat => typeof x === 'string' && (ALL_FORMATS as string[]).includes(x));
    };
    return {
      request: sanitize(parsed?.request),
      response: sanitize(parsed?.response),
    };
  } catch {
    return { request: [], response: [] };
  }
}
function persistCustomTabs(next: CustomTabsPref) {
  try { localStorage.setItem(LS_KEY_CUSTOM_TABS, JSON.stringify(next)); } catch {}
}

/**
 * 持久化的"置顶集合"：host 名 / URL 前缀。
 * 命中即置顶，跨启动保留。数据规模极小（几十条），直接存 localStorage。
 */
function loadStringSet(key: string): Record<string, true> {
  try {
    const v = localStorage.getItem(key);
    if (!v) return {};
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return {};
    const out: Record<string, true> = {};
    for (const x of parsed) if (typeof x === 'string' && x) out[x] = true;
    return out;
  } catch {
    return {};
  }
}
function persistStringSet(key: string, set: Record<string, true>) {
  try { localStorage.setItem(key, JSON.stringify(Object.keys(set))); } catch {}
}

export const useFlowStore = create<FlowState>((set, get) => ({
  flows: [],
  byId: {},
  selectedId: null,
  selectedIds: {},
  scrollTargetId: null,
  filter: { ...DEFAULT_FILTER },
  pinnedIds: {},
  pinnedHosts: loadStringSet(LS_KEY_PINNED_HOSTS),
  pinnedPaths: loadStringSet(LS_KEY_PINNED_PATHS),
  savedIds: {},
  noteById: {},
  highlightById: {},
  proxyStatus: null,
  certStatus: null,
  systemProxyOverride: null,
  activeBreakpoint: null,
  searchOpen: false,
  autoFollow: false,
  statusChipsExpanded: false,
  sidebarQuery: '',
  sidebarWidthPx: 220,
  leftSidebarCollapsed: false,
  traffic: { totalBytes: 0, rxRate: 0, txRate: 0 },
  mitmDisabledHosts: {},
  sort: loadSort(),
  columnWidths: loadColumnWidths(),
  customTabs: loadCustomTabs(),

  setBreakpoint: (bp) => set({ activeBreakpoint: bp }),
  setSelected: (id) => set({
    selectedId: id,
    selectedIds: id ? { [id]: true } : {},
  }),
  toggleSelected: (id) => set((s) => {
    const next = { ...s.selectedIds };
    if (next[id]) {
      delete next[id];
      // 若移除的是主选，则主选切到集合里剩下的第一个（或 null）
      const nextSelectedId = s.selectedId === id
        ? (Object.keys(next)[0] ?? null)
        : s.selectedId;
      return { selectedIds: next, selectedId: nextSelectedId };
    }
    next[id] = true;
    return { selectedIds: next, selectedId: id };
  }),
  rangeSelect: (id, orderedIds) => set((s) => {
    const anchor = s.selectedId;
    if (!anchor || anchor === id) {
      return { selectedIds: { [id]: true }, selectedId: id };
    }
    const a = orderedIds.indexOf(anchor);
    const b = orderedIds.indexOf(id);
    if (a < 0 || b < 0) {
      return { selectedIds: { [id]: true }, selectedId: id };
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const next: Record<string, true> = {};
    for (let i = lo; i <= hi; i++) next[orderedIds[i]] = true;
    return { selectedIds: next, selectedId: id };
  }),
  clearSelection: () => set({ selectedIds: {}, selectedId: null }),
  requestScrollTo: (id) => set({ scrollTargetId: id }),
  setFilter: (patch) => set({ filter: { ...get().filter, ...patch } }),
  resetFilter: () => set({ filter: { ...DEFAULT_FILTER } }),
  togglePin: (id) => set((s) => {
    const next = { ...s.pinnedIds };
    if (next[id]) delete next[id]; else next[id] = true;
    return { pinnedIds: next };
  }),
  togglePinHost: (host) => set((s) => {
    const next = { ...s.pinnedHosts };
    if (next[host]) delete next[host]; else next[host] = true;
    persistStringSet(LS_KEY_PINNED_HOSTS, next);
    return { pinnedHosts: next };
  }),
  togglePinPath: (prefix) => set((s) => {
    const next = { ...s.pinnedPaths };
    if (next[prefix]) delete next[prefix]; else next[prefix] = true;
    persistStringSet(LS_KEY_PINNED_PATHS, next);
    return { pinnedPaths: next };
  }),
  /** 清空某 host 的所有置顶（host 本身 + 该 host 下所有 pinnedPaths），用于"取消置顶此域名"统一动作 */
  unpinHostAll: (host) => set((s) => {
    const nextHosts = { ...s.pinnedHosts };
    delete nextHosts[host];
    const nextPaths: Record<string, true> = {};
    for (const p of Object.keys(s.pinnedPaths)) {
      // pinnedPaths key 形如 "host/subpath"
      const slash = p.indexOf('/');
      const h = slash > 0 ? p.slice(0, slash) : p;
      if (h !== host) nextPaths[p] = true;
    }
    persistStringSet(LS_KEY_PINNED_HOSTS, nextHosts);
    persistStringSet(LS_KEY_PINNED_PATHS, nextPaths);
    return { pinnedHosts: nextHosts, pinnedPaths: nextPaths };
  }),
  toggleSave: (id) => set((s) => {
    const next = { ...s.savedIds };
    if (next[id]) delete next[id]; else next[id] = true;
    return { savedIds: next };
  }),
  setNote: (id, note) => set((s) => ({ noteById: { ...s.noteById, [id]: note } })),
  setHighlight: (id, color) => set((s) => {
    const next = { ...s.highlightById };
    if (color) next[id] = color; else delete next[id];
    return { highlightById: next };
  }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  setSearchOpen: (v) => set({ searchOpen: v }),
  toggleAutoFollow: () => set((s) => ({ autoFollow: !s.autoFollow })),
  toggleStatusChips: () => set((s) => ({ statusChipsExpanded: !s.statusChipsExpanded })),
  setSidebarQuery: (v) => set({ sidebarQuery: v }),
  setSidebarWidthPx: (v) => set({ sidebarWidthPx: Math.max(0, Math.round(v)) }),
  toggleLeftSidebar: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
  toggleMitmDisabledHost: (host) => set((s) => {
    const next = { ...s.mitmDisabledHosts };
    if (next[host]) delete next[host]; else next[host] = true;
    return { mitmDisabledHosts: next };
  }),
  cycleSort: (key) => set((s) => {
    let next: SortState | null;
    if (!s.sort || s.sort.key !== key) next = { key, dir: 'asc' };
    else if (s.sort.dir === 'asc') next = { key, dir: 'desc' };
    else next = null;
    persistSort(next);
    return { sort: next };
  }),
  setColumnWidth: (key, width) => set((s) => {
    const w = Math.max(30, Math.round(width));
    const next = { ...s.columnWidths, [key]: w };
    persistColumnWidths(next);
    return { columnWidths: next };
  }),
  resetColumnWidths: () => set(() => {
    persistColumnWidths({});
    return { columnWidths: {} };
  }),
  toggleCustomTab: (panel, fmt) => set((s) => {
    const list = s.customTabs[panel];
    const has = list.includes(fmt);
    const nextList = has ? list.filter((x) => x !== fmt) : [...list, fmt];
    const next: CustomTabsPref = { ...s.customTabs, [panel]: nextList };
    persistCustomTabs(next);
    return { customTabs: next };
  }),
  setCustomTabs: (next) => set(() => {
    persistCustomTabs(next);
    return { customTabs: next };
  }),

  removeFlow: (id) => set((s) => {
    const flows = s.flows.filter((f) => f.id !== id);
    const byId = { ...s.byId };
    delete byId[id];
    const pinned = { ...s.pinnedIds }; delete pinned[id];
    const saved = { ...s.savedIds }; delete saved[id];
    const notes = { ...s.noteById }; delete notes[id];
    const hi = { ...s.highlightById }; delete hi[id];
    const selIds = { ...s.selectedIds }; delete selIds[id];
    return {
      flows,
      byId,
      pinnedIds: pinned,
      savedIds: saved,
      noteById: notes,
      highlightById: hi,
      selectedId: s.selectedId === id ? null : s.selectedId,
      selectedIds: selIds,
    };
  }),
  onTraffic: (t) => set({ traffic: t }),

  hydrate: (flows) => {
    const byId: Record<string, Flow> = {};
    for (const f of flows) byId[f.id] = f;
    set({ flows, byId });
  },

  onFlowStart: (f) => {
    set((s) => {
      const next: Partial<FlowState> = { flows: [...s.flows, f], byId: { ...s.byId, [f.id]: f } };
      if (s.autoFollow) {
        next.selectedId = f.id;
        next.selectedIds = { [f.id]: true };
      }
      return next;
    });
  },
  onRequestBody: (id, bodyText, bodyBase64, bodySize) => {
    const f = get().byId[id];
    if (!f) return;
    const next: Flow = {
      ...f,
      request: {
        ...f.request,
        bodyText: bodyText ?? f.request.bodyText,
        bodyBase64: bodyBase64 ?? f.request.bodyBase64,
        bodySize: bodySize ?? f.request.bodySize,
      },
    };
    replaceFlow(set, get, next);
  },
  onResponseHeaders: (id, response) => {
    const f = get().byId[id];
    if (!f) return;
    const next: Flow = { ...f, response, status: response.isSSE ? 'streaming' : 'headers' };
    replaceFlow(set, get, next);
  },
  onSSEFrame: (id, frame) => {
    const f = get().byId[id];
    if (!f) return;
    const next: Flow = { ...f, sseFrames: [...f.sseFrames, frame] };
    replaceFlow(set, get, next);
  },
  onWSMessage: (id, message) => {
    const f = get().byId[id];
    if (!f) return;
    const next: Flow = { ...f, isWebSocket: true, wsMessages: [...(f.wsMessages || []), message] };
    replaceFlow(set, get, next);
  },
  onResponseBody: (id, bodyText, bodyBase64, bodySize) => {
    const f = get().byId[id];
    if (!f || !f.response) return;
    const next: Flow = {
      ...f,
      response: {
        ...f.response,
        bodyText: bodyText ?? f.response.bodyText,
        bodyBase64: bodyBase64 ?? f.response.bodyBase64,
        bodySize: bodySize ?? f.response.bodySize,
      },
    };
    replaceFlow(set, get, next);
  },
  onFlowEnd: (id, durationMs, status, error) => {
    const f = get().byId[id];
    if (!f) return;
    const next: Flow = { ...f, durationMs, status, errorMessage: error };
    replaceFlow(set, get, next);
  },
  onAppInfo: (id, app) => {
    const f = get().byId[id];
    if (!f) return;
    const next: Flow = { ...f, app };
    replaceFlow(set, get, next);
  },
  clear: () => set({ flows: [], byId: {}, selectedId: null, selectedIds: {}, scrollTargetId: null }),

  setProxyStatus: (s) => set({ proxyStatus: s }),
  setCertStatus: (s) => set({ certStatus: s }),
  setSystemProxyOverride: (s) => set({ systemProxyOverride: s }),
}));

function replaceFlow(set: any, get: any, next: Flow) {
  const flows = get().flows.map((x: Flow) => (x.id === next.id ? next : x));
  set({ flows, byId: { ...get().byId, [next.id]: next } });
}
