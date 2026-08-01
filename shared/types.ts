/**
 * ProxyBaby 共享类型定义（主进程 + 渲染进程共用）
 */

export type FlowStatus = 'pending' | 'headers' | 'streaming' | 'completed' | 'error';

export interface AppInfo {
  name: string;
  pid: number;
  execPath?: string;
  bundleId?: string;
  iconDataUrl?: string;
  bundlePath?: string;
}

export interface Header {
  name: string;
  value: string;
}

export interface RequestData {
  method: string;
  url: string;
  host: string;
  path: string;
  scheme: 'http' | 'https';
  httpVersion: string;
  headers: Header[];
  bodySize: number;
  bodyText?: string;
  bodyBase64?: string;
  contentType?: string;
  startedAt: number;
}

export interface ResponseData {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: Header[];
  bodySize: number;
  bodyText?: string;
  bodyBase64?: string;
  contentType?: string;
  isSSE: boolean;
  endedAt?: number;
}

export interface SSEFrame {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
  raw: string;
  receivedAt: number;
}

export type WSDirection = 'send' | 'recv';
export type WSMessageType = 'text' | 'binary' | 'ping' | 'pong' | 'close';

export interface WSMessage {
  direction: WSDirection;
  type: WSMessageType;
  text?: string;          // 文本帧内容
  base64?: string;        // 二进制帧内容
  size: number;
  receivedAt: number;
}

export interface Flow {
  id: string;
  status: FlowStatus;
  app?: AppInfo;
  request: RequestData;
  response?: ResponseData;
  sseFrames: SSEFrame[];
  wsMessages?: WSMessage[];
  isWebSocket?: boolean;
  errorMessage?: string;
  isTLS: boolean;
  durationMs?: number;
  matchedRules?: { ruleId: string; ruleName: string; pattern: string }[];
  edited?: boolean;                 // 是否被规则/断点改写
  note?: string;                    // 用户备注
  highlight?: string;               // 用户标记的高亮色（'red'|'orange'|'yellow'|'green'|'blue'）
  repeatOfId?: string;              // 重复请求的来源 flow id
}

// ============ IPC events ============
export interface IpcEvents {
  'flow:start': Flow;
  'flow:request-body': { id: string; bodyText?: string; bodyBase64?: string; bodySize: number };
  'flow:response-headers': { id: string; response: ResponseData };
  'flow:sse-frame': { id: string; frame: SSEFrame };
  'flow:ws-open': { id: string };
  'flow:ws-message': { id: string; message: WSMessage };
  'flow:breakpoint': { id: string; stage: 'request' | 'response'; request: RequestData; response?: ResponseData };
  'flow:response-body': { id: string; bodyText?: string; bodyBase64?: string; bodySize: number };
  'flow:end': { id: string; durationMs: number; status: FlowStatus; error?: string };
  'flow:app-info': { id: string; app: AppInfo };
  'flow:remove': { id: string };
  'proxy:status': ProxyStatus;
  'proxy:traffic': { totalBytes: number; rxRate: number; txRate: number };
  'proxy:override': SystemProxyOverride | null;
  'cert:status': CertStatus;
}

export interface ProxyStatus {
  running: boolean;
  host: string;
  port: number;
  systemProxyApplied: boolean;
  recording: boolean;
}

/**
 * 检测到系统代理被其他工具（Proxyman / Charles 等）改写指向非 ProxyBaby 的 host:port 时的信息。
 * null 表示当前系统代理归属正常（未被覆盖）。
 */
export interface SystemProxyOverride {
  host: string;              // 当前系统代理指向的 host
  port: number;              // 当前系统代理指向的 port
  service?: string;          // 命中的网络服务名（如 Wi-Fi）
  proxybabyHost: string;     // ProxyBaby 期望的 host
  proxybabyPort: number;     // ProxyBaby 期望的 port
  detectedAt: number;        // 检测到的时间戳（ms）
}

export interface CertStatus {
  generated: boolean;
  trusted: boolean;
  caPath?: string;
}

// ============ AI chat 归一化模型 ============
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatToolCall {
  id?: string;
  name: string;
  argumentsText: string;         // 增量拼接的原始 JSON 文本
  argumentsParsed?: unknown;      // 若最终 JSON 完整可解析
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;                // Markdown 文本，流式拼接
  reasoning?: string;             // 思考内容（若有）
  toolCalls?: ChatToolCall[];
  toolCallId?: string;            // tool 消息的关联 id
  toolName?: string;              // tool 消息的关联函数名
  finishReason?: string;
  streaming: boolean;
  source?: 'request' | 'response'; // 来自请求 body 的历史消息 vs 来自响应的模型输出
}

export interface ChatToolDefinition {
  name: string;
  description?: string;
  parameters?: unknown;           // JSON Schema
}

export interface ChatSession {
  provider: 'openai' | 'anthropic' | 'acp' | 'unknown';
  model?: string;
  temperature?: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    // 缓存命中（OpenAI: prompt_tokens_details.cached_tokens；Anthropic: cache_read_input_tokens）
    cachedTokens?: number;
    // Anthropic 独有：本轮写入缓存的 token 数
    cacheCreationTokens?: number;
  };
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];   // 请求侧声明的可调用工具定义
  streaming: boolean;
}

// ============ Preload bridge API ============
export interface RuleSetSummary {
  id: string;
  name: string;
  enabled: boolean;
  text: string;
  errors: { lineNo: number; message: string }[];
  rules: { raw: string; lineNo: number; pattern: string; group?: string }[];
  /** 临时规则集：由 Sidebar 右键"快速规则"创建 */
  temporary?: boolean;
}

/** 快速规则输入子窗口的初始参数 */
export interface RuleQuickInputParams {
  operator: 'mapRemote' | 'mock' | 'statusCode' | 'resDelay' | 'resBody' | 'mapLocal';
  pattern: string;
  /** 该 operator 的显示名，用于窗口标题（如 "响应延迟"）*/
  label: string;
  /** 输入字段类型 */
  inputKind: 'text' | 'textarea' | 'number' | 'file';
  placeholder?: string;
}

export interface PluginSummary {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

// ============ Scripts ============
export interface ScriptSummary {
  id: string;
  name: string;
  enabled: boolean;
  code: string;
  always?: boolean;
  lastError?: string;
}

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
  request: { method: string; url: string; headers: { name: string; value: string }[]; bodyText: string };
  response?: { status: number; statusText: string; headers: { name: string; value: string }[]; bodyText: string };
}

// ============ Filter Entry (App/Host/URL) ============
export type FilterKind = 'app' | 'host' | 'url';
export type UrlMatchMode = 'glob' | 'regex';

export interface FilterEntry {
  id: string;
  kind: FilterKind;
  value: string;
  urlMode?: UrlMatchMode;
  enabled: boolean;
  note?: string;
  /**
   * 仅用于抓包过滤（record filter）的条目：是否 MITM 解密该条目命中的 HTTPS 流量。
   *   - undefined / true → 解密（默认）
   *   - false          → 不解密（保持 CONNECT 隧道直通，UI 里能看到条目但内容不可见）
   * 对 HTTP 请求无意义。对 allow-block / ssl-list 面板忽略。
   */
  decrypt?: boolean;
}

export interface FilterMatchCtx {
  host: string;
  appName?: string;
  method?: string;
  url?: string;
}

// ============ Allow/Block List ============
export type AllowBlockMode = 'off' | 'allow' | 'block';
export interface AllowBlockConfig {
  mode: AllowBlockMode;
  entries: FilterEntry[];
}

// ============ Recording Filter (抓包记录过滤) ============
// 与 SSL / Allow-Block 完全独立：只决定"是否记录进 flow list 让 UI 显示"，
// 请求本身正常代理。HTTP + HTTPS 都生效。
export type RecordFilterMode = 'all' | 'include' | 'exclude';
export interface RecordFilterConfig {
  mode: RecordFilterMode;
  entries: FilterEntry[];
}

// FilterEntry 编辑器子窗口的初始参数。
// scope 用于窗口提交时决定写哪个 store，以及告诉编辑器要不要展示 URL 类目。
export interface FilterEntryEditorParams {
  scope: 'ssl' | 'allow-block' | 'record';
  allowUrl: boolean;  // ssl 也允许 url 类目（虽然 CONNECT 阶段不生效，仍允许配置）
  title?: string;
}

// ============ SSL Decrypt List ============
export type SslDecryptMode = 'all' | 'include' | 'exclude';
export interface SslDecryptConfig {
  enabled: boolean;
  mode: SslDecryptMode;
  entries: FilterEntry[];
}

// ============ Network Conditions ============
export type NetworkProfileKey = 'off' | 'offline' | 'gprs' | '2g' | '3g' | '4g' | '5g' | 'wifi' | string;

// ============ Upstream proxy ============
export type UpstreamProxyKind = 'off' | 'http' | 'socks5';
export interface UpstreamProxyConfig {
  kind: UpstreamProxyKind;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface ProxyBabyBridge {
  onEvent<K extends keyof IpcEvents>(event: K, handler: (payload: IpcEvents[K]) => void): () => void;
  getProxyStatus(): Promise<ProxyStatus>;
  getCertStatus(): Promise<CertStatus>;
  toggleRecording(recording: boolean): Promise<ProxyStatus>;
  setSystemProxy(on: boolean): Promise<ProxyStatus>;
  setProxyPort(port: number): Promise<ProxyStatus>;
  querySystemProxy(): Promise<SystemProxyOverride | null>;
  restoreSystemProxyOverride(): Promise<ProxyStatus>;
  clearFlows(): Promise<void>;
  reinstallCert(): Promise<CertStatus>;
  getFlows(): Promise<Flow[]>;
  // rules
  rulesList(): Promise<RuleSetSummary[]>;
  rulesAdd(name: string, text: string, enabled: boolean): Promise<RuleSetSummary>;
  rulesUpdate(id: string, patch: { name?: string; text?: string; enabled?: boolean }): Promise<RuleSetSummary | null>;
  rulesRemove(id: string): Promise<boolean>;
  rulesSetEnabled(id: string, enabled: boolean): Promise<boolean>;
  rulesQuickAdd(args: { pattern: string; operator: string; value?: string }): Promise<RuleSetSummary | null>;
  rulesQuickAddCustom(args: { pattern: string }): Promise<{ ruleSetId: string; lineNo: number } | null>;
  rulesClearTemp(): Promise<number>;
  ruleQuickInputOpen(params: RuleQuickInputParams): Promise<boolean>;
  ruleQuickInputConsumeInit(): Promise<RuleQuickInputParams | null>;
  dialogPickFile(): Promise<string | null>;
  // plugins
  pluginsList(): Promise<PluginSummary[]>;
  pluginsSetEnabled(id: string, enabled: boolean): Promise<boolean>;
  // scripts
  scriptsList(): Promise<ScriptSummary[]>;
  scriptsAdd(name: string, code?: string): Promise<ScriptSummary>;
  scriptsUpdate(id: string, patch: { name?: string; code?: string; enabled?: boolean; always?: boolean }): Promise<ScriptSummary | null>;
  scriptsRemove(id: string): Promise<boolean>;
  scriptsTest(id: string, testCase: ScriptTestCase): Promise<ScriptTestResult>;
  // Allow/Block List
  allowBlockGet(): Promise<AllowBlockConfig>;
  allowBlockSet(cfg: AllowBlockConfig): Promise<AllowBlockConfig>;
  recordFilterGet(): Promise<RecordFilterConfig>;
  recordFilterSet(cfg: RecordFilterConfig): Promise<RecordFilterConfig>;
  // SSL Decrypt list
  sslListGet(): Promise<SslDecryptConfig>;
  sslListSet(cfg: SslDecryptConfig): Promise<SslDecryptConfig>;
  // Network conditions
  networkGetProfile(): Promise<string | null>;
  networkSetProfile(key: string | null): Promise<string | null>;
  // Upstream proxy
  upstreamProxyGet(): Promise<UpstreamProxyConfig>;
  upstreamProxySet(cfg: UpstreamProxyConfig): Promise<UpstreamProxyConfig>;
  // Composer
  composerSend(req: { method: string; url: string; headers: Header[]; bodyText?: string }): Promise<{ ok: boolean; id?: string; error?: string }>;
  // 独立子窗口（Settings / Diff / FilterConfig / FilterEntryEditor）
  openWindow(route: 'settings' | 'diff' | 'filter-config' | 'filter-entry-editor', opts?: { width?: number; height?: number; title?: string }): Promise<boolean>;
  closeSelfWindow(): Promise<void>;
  broadcast(channel: string, payload: unknown): Promise<void>;
  // 过滤规则编辑器子窗口：父窗口 open 时把 params 放在 latch；子窗口 mount 后 consume 拉取。
  filterEntryEditorOpen(params: FilterEntryEditorParams): Promise<boolean>;
  filterEntryEditorConsumeInit(): Promise<FilterEntryEditorParams | null>;
  // breakpoint
  breakpointResume(payload: BreakpointResume): Promise<void>;
  // session
  sessionExport(format: 'proxybaby' | 'har'): Promise<{ ok: boolean; filePath?: string; count?: number }>;
  sessionExportFlows(format: 'proxybaby' | 'har', ids: string[]): Promise<{ ok: boolean; filePath?: string; count?: number }>;
  sessionImport(): Promise<{ ok: boolean; count?: number; flows?: Flow[] }>;
  // flow ops
  flowRemove(id: string): Promise<boolean>;
  flowRepeat(id: string, patch?: FlowRepeatPatch): Promise<{ ok: boolean; id?: string; error?: string }>;
  flowSetNote(id: string, note: string): Promise<boolean>;
  flowSetHighlight(id: string, color: string | null): Promise<boolean>;
  mitmDisableHost(host: string, disabled: boolean): Promise<boolean>;
  showInFinder(filePath: string): Promise<boolean>;
  fsListDir(dirPath: string): Promise<FsListDirResult>;
  // ---- AI ----
  aiListSessions(): Promise<AiSessionMeta[]>;
  aiGetCurrent(): Promise<string | null>;
  aiCreateSession(title?: string): Promise<AiSessionMeta>;
  aiSwitchSession(id: string): Promise<AiSessionMeta | null>;
  aiRenameSession(id: string, title: string): Promise<AiSessionMeta | null>;
  aiDeleteSession(id: string): Promise<boolean>;
  aiSend(markdown: string, attachedFlowIds?: string[]): Promise<AiSessionMeta | null>;
  aiInterrupt(): Promise<void>;
  aiGetConfig(): Promise<AiConfig>;
  aiSetConfig(patch: Partial<AiConfig>): Promise<AiConfig>;
  aiListSkills(): Promise<{ name: string; description?: string; source: string }[]>;
  aiPickFile(): Promise<string | null>;
}

// ============ AI ============
export interface AiSessionMeta {
  id: string;
  cbcSessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinnedFlowIds?: string[];
}

export interface AiConfig {
  enabled: boolean;
  cliPath: string;
  model?: string;
  permissionMode?: string;
  effort?: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  args: unknown;
  state: 'pending' | 'ok' | 'error';
  result?: unknown;
  error?: string;
}

export interface AiMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  createdAt: number;
  content: string;
  toolCalls?: AiToolCall[];
}

export interface AiEvents {
  'ai:sessions': AiSessionMeta[];
  'ai:message-start': { sessionId: string; messageId: string; role: 'user' | 'assistant' | 'tool' };
  'ai:text-delta':    { sessionId: string; messageId: string; delta: string };
  'ai:tool-call':     { sessionId: string; messageId: string; toolCall: AiToolCall };
  'ai:tool-result':   { sessionId: string; messageId: string; toolCallId: string; result?: unknown; error?: string };
  'ai:message-end':   { sessionId: string; messageId: string };
  'ai:error':         { sessionId: string; error: string };
}

export interface FsListDirResult {
  dir: string;
  entries: { name: string; isDir: boolean }[];
}

export interface FlowRepeatPatch {
  method?: string;
  url?: string;
  headers?: Header[];
  bodyText?: string;
}

export interface BreakpointResume {
  id: string;
  stage: 'request' | 'response';
  action: 'continue' | 'abort';
  // 编辑后的字段（仅 continue 时使用）
  headers?: Header[];
  bodyText?: string;
  status?: number;      // response 阶段可改状态码
}

declare global {
  interface Window {
    proxybaby: ProxyBabyBridge;
  }
}
