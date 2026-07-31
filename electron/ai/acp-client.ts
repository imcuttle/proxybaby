/**
 * ACP client：spawn `codebuddy --acp --acp-transport stdio` 子进程，
 * 与之进行 JSON-RPC 2.0 (Agent Client Protocol) 通信。
 *
 * 真实协议序列（探测得到）：
 *   → initialize { protocolVersion:1, clientCapabilities:{fs:{...}} }
 *   ← result { protocolVersion, agentCapabilities, authMethods }
 *   → session/new { cwd, mcpServers:[] }
 *   ← result { sessionId, models, modes, configOptions }
 *   → session/prompt { sessionId, prompt:[{type:'text',text:'...'}] }
 *   ← notif session/update { update: { sessionUpdate:'agent_message_chunk', content:{type:'text', text:'...'} } }
 *   ← notif session/update { update: { sessionUpdate:'tool_call', ...} } / 'tool_call_update'
 *   ← result { stopReason:'end_turn', userMessageId }
 *
 * 对外仍暴露和之前一致的 EventEmitter 事件名：
 *   message-start / text-delta / tool-call / tool-result / message-end / error / exit
 *
 * disableSpawn=true 时不真的 spawn，用 injectServerEvent() 灌入事件供 E2E/单测。
 * injectServerEvent 兼容两种形态：ACP notification 与老式 `{type:'text-delta',...}`。
 */
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface AcpEvents {
  'message-start': { messageId: string; role: 'assistant' | 'tool' };
  'text-delta':    { messageId: string; delta: string };
  'tool-call':     { messageId: string; toolCall: { id: string; name: string; args: unknown; state: 'pending' } };
  'tool-result':   { messageId: string; toolCallId: string; result?: unknown; error?: string };
  'message-end':   { messageId: string };
  'error':         { error: string };
  'exit':          { code: number | null };
  'session-ready': { sessionId: string };
}

export type AcpEventName = keyof AcpEvents;

interface Pending {
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

/** 老式 injected 事件形态（保留给 e2e 用） */
interface LegacyEvent {
  type?: string;
  event?: string;
  messageId?: string;
  message_id?: string;
  id?: string;
  role?: string;
  text?: string;
  delta?: string;
  name?: string;
  args?: unknown;
  input?: unknown;
  tool_use_id?: string;
  toolCallId?: string;
  output?: unknown;
  result?: unknown;
  error?: string;
  message?: string;
}

export class AcpClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** 服务端生成的 session id；session/new 完成后可用 */
  private serverSessionId: string | null = null;
  /** 是否已完成 initialize + session/new */
  private ready = false;
  /** ready 之前排队的用户 prompt */
  private queuedPrompts: string[] = [];
  /** 当前 prompt 请求 id → 用于关联最终 result */
  private activePromptId: number | null = null;
  /** 当前 assistant message 是否已 emit message-start（每次 prompt 独立） */
  private assistantOpen = false;
  private currentMessageId: string = '';

  constructor(
    /**
     * 该字段保留仅为兼容旧调用点（AiManager 会把 meta.cbcSessionId 传进来）。
     * 真实的 ACP sessionId 由 server 生成后写入 serverSessionId。
     */
    public readonly localSessionId: string,
    private opts: {
      cliPath?: string;
      model?: string;
      permissionMode?: string;
      disableSpawn?: boolean;
      /** cwd 传给 session/new；默认 process.cwd() */
      cwd?: string;
    } = {},
  ) {
    super();
  }

  /** 便于 AiManager 兼容旧读取点：外部叫 sessionId */
  get sessionId(): string {
    return this.serverSessionId || this.localSessionId;
  }

  /** 启动子进程。disableSpawn=true 时不真的 spawn，仅保持通道等 injectServerEvent。 */
  start(): void {
    if (this.opts.disableSpawn) {
      // E2E 模式：直接置 ready，injectServerEvent 会跳过 result 关联
      this.ready = true;
      return;
    }
    const cli = this.opts.cliPath || 'codebuddy';
    const args = ['--acp', '--acp-transport', 'stdio'];
    if (this.opts.model) args.push('--model', this.opts.model);
    if (this.opts.permissionMode) args.push('--permission-mode', this.opts.permissionMode);
    try {
      this.proc = spawn(cli, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err: any) {
      this.emit('error', { error: `spawn failed: ${err?.message || err}` });
      return;
    }
    this.proc.stdout?.setEncoding('utf8');
    this.proc.stdout?.on('data', (chunk: string) => this.onStdout(chunk));
    this.proc.stderr?.setEncoding('utf8');
    this.proc.stderr?.on('data', (_: string) => { /* silence */ });
    this.proc.on('exit', (code) => {
      this.emit('exit', { code });
      this.proc = null;
      // 拒绝所有未完成请求
      for (const [, p] of this.pending) {
        try { p.reject(new Error('acp process exited')); } catch {}
      }
      this.pending.clear();
    });
    this.proc.on('error', (err) => {
      this.emit('error', { error: `acp process error: ${err?.message || String(err)}` });
    });

    // 启动握手
    void this.handshake().catch((err) => {
      this.emit('error', { error: `acp handshake failed: ${err?.message || String(err)}` });
    });
  }

  private async handshake(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    const cwd = this.opts.cwd || process.cwd();
    const res = await this.request('session/new', { cwd, mcpServers: [] });
    const sid = (res && typeof res === 'object' && (res as any).sessionId) as string | undefined;
    if (!sid) throw new Error('session/new returned no sessionId');
    this.serverSessionId = sid;
    this.ready = true;
    this.emit('session-ready', { sessionId: sid });
    // flush 排队
    const q = this.queuedPrompts.splice(0);
    for (const md of q) this.doSendPrompt(md);
  }

  private onStdout(chunk: string) {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let obj: any;
      try { obj = JSON.parse(t); } catch { continue; }
      this.handleJsonRpc(obj);
    }
  }

  private handleJsonRpc(obj: any): void {
    // 响应
    if (obj && typeof obj.id === 'number' && ('result' in obj || 'error' in obj)) {
      const p = this.pending.get(obj.id);
      if (p) {
        this.pending.delete(obj.id);
        if (obj.error) p.reject(new Error(obj.error?.message || 'rpc error'));
        else p.resolve(obj.result);
      }
      // 若是当前 prompt 的最终 result，close 掉 assistant 消息
      if (this.activePromptId === obj.id) {
        this.activePromptId = null;
        if (this.assistantOpen) {
          this.emit('message-end', { messageId: this.currentMessageId });
          this.assistantOpen = false;
        }
      }
      return;
    }
    // 通知（无 id 或 id 为 null）
    if (obj && typeof obj.method === 'string') {
      this.handleNotification(obj.method, obj.params || {});
      return;
    }
  }

  private handleNotification(method: string, params: any): void {
    if (method !== 'session/update') return;
    const upd = params?.update;
    if (!upd || typeof upd !== 'object') return;
    const kind = upd.sessionUpdate;
    const meta = params?._meta || {};
    // 尽量拿一个稳定的 messageId：优先服务端 messageId，否则用 requestId
    const mid = (meta['codebuddy.ai/messageId'] as string | undefined)
      || (meta['codebuddy.ai/requestId'] as string | undefined)
      || 'assistant';

    if (kind === 'agent_message_chunk') {
      const content = upd.content || {};
      const text = typeof content.text === 'string' ? content.text : '';
      if (!text) return;
      this.ensureAssistantOpen(mid);
      this.emit('text-delta', { messageId: this.currentMessageId, delta: text });
      return;
    }
    if (kind === 'agent_thought_chunk') {
      // reasoning：目前忽略（未来可加 reasoning 展示）
      return;
    }
    if (kind === 'tool_call') {
      this.ensureAssistantOpen(mid);
      const id = String(upd.toolCallId || upd.id || Math.random().toString(36).slice(2, 10));
      this.emit('tool-call', {
        messageId: this.currentMessageId,
        toolCall: {
          id,
          name: String(upd.title || upd.kind || upd.toolName || 'tool'),
          args: upd.rawInput ?? upd.input ?? upd.args ?? null,
          state: 'pending',
        },
      });
      return;
    }
    if (kind === 'tool_call_update') {
      const id = String(upd.toolCallId || upd.id || '');
      if (!id) return;
      const status = upd.status;
      if (status === 'completed' || status === 'success' || status === 'failed' || status === 'error') {
        this.emit('tool-result', {
          messageId: this.currentMessageId,
          toolCallId: id,
          result: upd.rawOutput ?? upd.output ?? upd.result ?? undefined,
          error: (status === 'failed' || status === 'error') ? (upd.error || 'tool error') : undefined,
        });
      }
      return;
    }
    // 其它 session_info_update / usage_update / available_commands_update / config_option_update
    // 都不映射到对外事件
  }

  private ensureAssistantOpen(messageId: string): void {
    if (!this.assistantOpen) {
      this.currentMessageId = messageId;
      this.assistantOpen = true;
      this.emit('message-start', { messageId, role: 'assistant' });
    }
  }

  /** 发送 JSON-RPC 请求，返回 result Promise。 */
  private request(method: string, params: any): Promise<any> {
    if (!this.proc || !this.proc.stdin) {
      return Promise.reject(new Error('acp process not running'));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.proc!.stdin!.write(payload);
      } catch (err: any) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /** 发送用户消息（markdown 字符串）。 */
  send(markdown: string): void {
    if (this.opts.disableSpawn) {
      // E2E：不真发；tests 通过 injectServerEvent 灌入
      return;
    }
    if (!this.proc) {
      this.emit('error', { error: 'acp process not running' });
      return;
    }
    if (!this.ready || !this.serverSessionId) {
      this.queuedPrompts.push(markdown);
      return;
    }
    this.doSendPrompt(markdown);
  }

  private doSendPrompt(markdown: string): void {
    if (!this.serverSessionId || !this.proc || !this.proc.stdin) return;
    const id = this.nextId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'session/prompt',
      params: {
        sessionId: this.serverSessionId,
        prompt: [{ type: 'text', text: markdown }],
      },
    }) + '\n';
    this.activePromptId = id;
    this.assistantOpen = false;
    this.currentMessageId = '';
    this.pending.set(id, {
      resolve: () => { /* 关闭动作在 handleJsonRpc 里做 */ },
      reject: (err: any) => {
        this.emit('error', { error: `session/prompt failed: ${err?.message || String(err)}` });
        if (this.assistantOpen) {
          this.emit('message-end', { messageId: this.currentMessageId });
          this.assistantOpen = false;
        }
      },
    });
    try {
      this.proc.stdin.write(payload);
    } catch (err: any) {
      this.pending.delete(id);
      this.emit('error', { error: `write failed: ${err?.message || String(err)}` });
    }
  }

  /**
   * 兼容 E2E：接受两种形态
   *   1) 老 schema：{type:'message-start'|'text-delta'|'tool-call'|'tool-result'|'message-end'|'error', ...}
   *   2) ACP notification：{jsonrpc,method:'session/update',params:{...}}
   */
  injectServerEvent(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    // ACP 形态
    if (obj.jsonrpc && obj.method === 'session/update') {
      this.handleNotification(obj.method, obj.params || {});
      return;
    }
    // 老 schema
    const t = obj.type || obj.event;
    if (!t) return;
    const legacy = obj as LegacyEvent;
    const mid = legacy.messageId || legacy.message_id || legacy.id || 'assistant';
    if (t === 'message-start' || t === 'message.start') {
      this.assistantOpen = true;
      this.currentMessageId = mid;
      this.emit('message-start', { messageId: mid, role: (legacy.role as any) || 'assistant' });
      return;
    }
    if (t === 'text-delta' || t === 'text' || t === 'message.delta') {
      this.ensureAssistantOpen(mid);
      this.emit('text-delta', { messageId: this.currentMessageId, delta: legacy.text || legacy.delta || '' });
      return;
    }
    if (t === 'tool-call' || t === 'tool_use') {
      this.ensureAssistantOpen(mid);
      this.emit('tool-call', {
        messageId: this.currentMessageId,
        toolCall: {
          id: String(legacy.tool_use_id || legacy.id || Math.random().toString(36).slice(2, 10)),
          name: legacy.name || 'tool',
          args: legacy.args ?? legacy.input ?? null,
          state: 'pending',
        },
      });
      return;
    }
    if (t === 'tool-result' || t === 'tool_result') {
      this.emit('tool-result', {
        messageId: this.currentMessageId || mid,
        toolCallId: String(legacy.tool_use_id || legacy.toolCallId || ''),
        result: legacy.output ?? legacy.result,
        error: legacy.error,
      });
      return;
    }
    if (t === 'message-end' || t === 'message.end') {
      const emitMid = this.currentMessageId || mid;
      this.emit('message-end', { messageId: emitMid });
      this.assistantOpen = false;
      return;
    }
    if (t === 'error') {
      this.emit('error', { error: legacy.error || legacy.message || 'unknown' });
      return;
    }
  }

  stop(): void {
    try { this.proc?.kill('SIGTERM'); } catch {}
    this.proc = null;
    this.ready = false;
    this.serverSessionId = null;
    this.pending.clear();
    this.queuedPrompts.length = 0;
  }

  isRunning(): boolean { return !!this.proc; }
}
