/**
 * AI 侧边栏渲染层状态。
 *
 * - panelOpen / enabled 是 UI 层的偏好（enabled 从主进程 config 同步）
 * - sessions[] 是主进程索引的镜像
 * - liveMessages 只在当前 app 生命周期内保存（app 重启后由 codebuddy 侧持久化，切回来时是空数组）
 */
import { create } from 'zustand';
import type { AiSessionMeta, AiConfig, AiMessage, AiToolCall } from '../../shared/types';

interface AiState {
  panelOpen: boolean;
  enabled: boolean;
  cliPath: string;
  model?: string;
  permissionMode?: string;
  sessions: AiSessionMeta[];
  currentId: string | null;
  liveMessages: Record<string, AiMessage[]>;
  streaming: boolean;
  errorMessage: string | null;

  setPanelOpen(open: boolean): void;
  togglePanel(): void;
  setConfig(cfg: AiConfig): void;
  setSessions(s: AiSessionMeta[]): void;
  setCurrent(id: string | null): void;

  onMessageStart(sessionId: string, messageId: string, role: 'user' | 'assistant' | 'tool'): void;
  onTextDelta(sessionId: string, messageId: string, delta: string): void;
  onToolCall(sessionId: string, messageId: string, toolCall: AiToolCall): void;
  onToolResult(sessionId: string, messageId: string, toolCallId: string, result?: unknown, error?: string): void;
  onMessageEnd(sessionId: string, messageId: string): void;
  onError(sessionId: string, error: string): void;

  appendUserMessage(sessionId: string, content: string): AiMessage;
  clearMessagesFor(sessionId: string): void;
}

export const useAiStore = create<AiState>((set, get) => ({
  panelOpen: false,
  enabled: true,
  cliPath: 'codebuddy',
  model: undefined,
  permissionMode: 'bypassPermissions',
  sessions: [],
  currentId: null,
  liveMessages: {},
  streaming: false,
  errorMessage: null,

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setConfig: (cfg) => set({ enabled: cfg.enabled, cliPath: cfg.cliPath, model: cfg.model, permissionMode: cfg.permissionMode }),
  setSessions: (sessions) => set({ sessions }),
  setCurrent: (currentId) => set({ currentId }),

  appendUserMessage(sessionId, content) {
    const msg: AiMessage = {
      id: 'msg_' + Math.random().toString(36).slice(2, 10),
      sessionId,
      role: 'user',
      createdAt: Date.now(),
      content,
    };
    set((s) => {
      const arr = s.liveMessages[sessionId] || [];
      return { liveMessages: { ...s.liveMessages, [sessionId]: [...arr, msg] } };
    });
    return msg;
  },

  onMessageStart(sessionId, messageId, role) {
    set((s) => {
      const arr = s.liveMessages[sessionId] || [];
      if (arr.some((m) => m.id === messageId)) return s;
      const msg: AiMessage = { id: messageId, sessionId, role, createdAt: Date.now(), content: '', toolCalls: [] };
      return { liveMessages: { ...s.liveMessages, [sessionId]: [...arr, msg] }, streaming: true };
    });
  },

  onTextDelta(sessionId, messageId, delta) {
    set((s) => {
      const arr = s.liveMessages[sessionId] || [];
      const idx = arr.findIndex((m) => m.id === messageId);
      if (idx < 0) {
        // 若没有 start 事件，兜底新建
        const msg: AiMessage = { id: messageId, sessionId, role: 'assistant', createdAt: Date.now(), content: delta };
        return { liveMessages: { ...s.liveMessages, [sessionId]: [...arr, msg] }, streaming: true };
      }
      const next = arr.slice();
      next[idx] = { ...next[idx], content: next[idx].content + delta };
      return { liveMessages: { ...s.liveMessages, [sessionId]: next }, streaming: true };
    });
  },

  onToolCall(sessionId, messageId, toolCall) {
    set((s) => {
      const arr = s.liveMessages[sessionId] || [];
      const idx = arr.findIndex((m) => m.id === messageId);
      if (idx < 0) {
        const msg: AiMessage = { id: messageId, sessionId, role: 'assistant', createdAt: Date.now(), content: '', toolCalls: [toolCall] };
        return { liveMessages: { ...s.liveMessages, [sessionId]: [...arr, msg] }, streaming: true };
      }
      const next = arr.slice();
      const tcs = (next[idx].toolCalls || []).slice();
      tcs.push(toolCall);
      next[idx] = { ...next[idx], toolCalls: tcs };
      return { liveMessages: { ...s.liveMessages, [sessionId]: next }, streaming: true };
    });
  },

  onToolResult(sessionId, messageId, toolCallId, result, error) {
    set((s) => {
      const arr = s.liveMessages[sessionId] || [];
      const idx = arr.findIndex((m) => m.id === messageId);
      if (idx < 0) return s;
      const next = arr.slice();
      const tcs = (next[idx].toolCalls || []).map((tc) =>
        tc.id === toolCallId ? { ...tc, state: (error ? 'error' : 'ok') as 'ok' | 'error', result, error } : tc,
      );
      next[idx] = { ...next[idx], toolCalls: tcs };
      return { liveMessages: { ...s.liveMessages, [sessionId]: next } };
    });
  },

  onMessageEnd(_sessionId, _messageId) {
    set({ streaming: false });
  },

  onError(sessionId, error) {
    set({ streaming: false, errorMessage: error });
    void sessionId;
  },

  clearMessagesFor(sessionId) {
    set((s) => ({ liveMessages: { ...s.liveMessages, [sessionId]: [] } }));
  },
}));
