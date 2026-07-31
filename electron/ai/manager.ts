/**
 * AI 会话管理器：维护索引 + 当前活跃的 AcpClient。
 *
 * 索引落盘：userData/ai/index.json
 * 消息不落盘：由 codebuddy 侧持久化。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';
import { AcpClient } from './acp-client';

export interface AiSessionMeta {
  id: string;                 // 我们本地 UUID
  cbcSessionId: string;       // 传给 codebuddy --session-id
  title: string;
  createdAt: number;
  updatedAt: number;
  pinnedFlowIds?: string[];
}

export interface AiConfig {
  enabled: boolean;
  cliPath: string;            // 默认 'codebuddy'
  model?: string;
  permissionMode?: string;    // 默认 bypassPermissions
  effort?: string;
}

interface IndexFile {
  version: 1;
  sessions: AiSessionMeta[];
  currentId: string | null;
  config: AiConfig;
}

const DEFAULT_CONFIG: AiConfig = {
  enabled: true,
  cliPath: 'codebuddy',
  permissionMode: 'bypassPermissions',
};

export class AiManager {
  private index: IndexFile;
  private active: AcpClient | null = null;
  private disableSpawn: boolean;

  constructor(opts: { disableSpawn?: boolean } = {}) {
    this.disableSpawn = !!opts.disableSpawn;
    this.index = this.load();
  }

  private indexPath(): string {
    const dir = path.join(app.getPath('userData'), 'ai');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'index.json');
  }

  private load(): IndexFile {
    const p = this.indexPath();
    if (!fs.existsSync(p)) {
      return { version: 1, sessions: [], currentId: null, config: { ...DEFAULT_CONFIG } };
    }
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw) as Partial<IndexFile>;
      return {
        version: 1,
        sessions: parsed.sessions || [],
        currentId: parsed.currentId ?? null,
        config: { ...DEFAULT_CONFIG, ...(parsed.config || {}) },
      };
    } catch {
      return { version: 1, sessions: [], currentId: null, config: { ...DEFAULT_CONFIG } };
    }
  }

  private save(): void {
    try { fs.writeFileSync(this.indexPath(), JSON.stringify(this.index, null, 2)); } catch {}
  }

  listSessions(): AiSessionMeta[] { return this.index.sessions.slice(); }
  currentId(): string | null { return this.index.currentId; }
  getConfig(): AiConfig { return { ...this.index.config }; }

  setConfig(patch: Partial<AiConfig>): AiConfig {
    this.index.config = { ...this.index.config, ...patch };
    this.save();
    return this.getConfig();
  }

  createSession(title?: string): AiSessionMeta {
    const now = Date.now();
    const meta: AiSessionMeta = {
      id: 'sess_' + crypto.randomBytes(6).toString('hex'),
      cbcSessionId: crypto.randomUUID(),
      title: title || '新对话',
      createdAt: now,
      updatedAt: now,
    };
    this.index.sessions.unshift(meta);
    this.index.currentId = meta.id;
    this.save();
    return meta;
  }

  renameSession(id: string, title: string): AiSessionMeta | null {
    const s = this.index.sessions.find((x) => x.id === id);
    if (!s) return null;
    s.title = title;
    s.updatedAt = Date.now();
    this.save();
    return s;
  }

  deleteSession(id: string): boolean {
    const before = this.index.sessions.length;
    this.index.sessions = this.index.sessions.filter((x) => x.id !== id);
    if (this.index.currentId === id) {
      this.index.currentId = this.index.sessions[0]?.id ?? null;
      if (this.active) { this.active.stop(); this.active = null; }
    }
    this.save();
    return this.index.sessions.length < before;
  }

  /** 切换到指定 session，spawn/respawn 对应 acp 子进程。返回是否成功。 */
  switchSession(id: string): AiSessionMeta | null {
    const s = this.index.sessions.find((x) => x.id === id);
    if (!s) return null;
    if (this.index.currentId !== id) {
      this.index.currentId = id;
      this.save();
    }
    if (this.active) { this.active.stop(); this.active = null; }
    return s;
  }

  /**
   * 确保 active AcpClient 存在。返回当前 client（若无 session 则先创建默认会话）。
   */
  ensureActive(): { session: AiSessionMeta; client: AcpClient } {
    let sid = this.index.currentId;
    if (!sid || !this.index.sessions.some((s) => s.id === sid)) {
      const created = this.createSession();
      sid = created.id;
    }
    const meta = this.index.sessions.find((s) => s.id === sid)!;
    if (!this.active || this.active.sessionId !== meta.cbcSessionId) {
      if (this.active) this.active.stop();
      this.active = new AcpClient(meta.cbcSessionId, {
        cliPath: this.index.config.cliPath,
        model: this.index.config.model,
        permissionMode: this.index.config.permissionMode,
        disableSpawn: this.disableSpawn,
        cwd: app.getPath('home'),
      });
      // 首个 session-ready 时把服务端 sessionId 落到 meta.cbcSessionId
      this.active.once('session-ready', (p: { sessionId: string }) => {
        if (p?.sessionId && meta.cbcSessionId !== p.sessionId) {
          meta.cbcSessionId = p.sessionId;
          meta.updatedAt = Date.now();
          this.save();
        }
      });
      this.active.start();
    }
    return { session: meta, client: this.active };
  }

  activeClient(): AcpClient | null { return this.active; }

  send(markdown: string): AiSessionMeta {
    const { session, client } = this.ensureActive();
    session.updatedAt = Date.now();
    if (session.title === '新对话' && markdown.trim()) {
      session.title = markdown.trim().split('\n')[0].slice(0, 24) || '新对话';
    }
    this.save();
    if (!this.disableSpawn) {
      client.send(markdown);
    }
    return session;
  }

  interrupt(): void {
    if (this.active) { this.active.stop(); this.active = null; }
  }
}
