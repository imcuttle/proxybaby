/**
 * SSL 解密白名单持久化。
 *
 * 存储：`<userData>/lists/ssl-decrypt.json`
 *   { enabled: boolean, mode: 'all'|'include'|'exclude', entries: FilterEntry[] }
 *
 * 兼容旧格式 `{ mode, hosts: string[] }`；缺失 `enabled` 时默认 true。
 *
 * 语义：
 *   - enabled=false → 一律不 MITM（等同 "关闭 SSL 代理工具"）
 *   - mode='all'      → 所有 host 都尝试 MITM（不查 entries）
 *   - mode='include'  → 仅 entries 命中的 host/app 做 MITM，其余透传
 *   - mode='exclude'  → 除了命中的，其余都 MITM
 *
 * 注意：本决策在 CONNECT 阶段调用，此时不知道后续请求 URL，因此 URL 类目条目视为未命中。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SslDecryptConfig, SslDecryptMode, FilterEntry, FilterMatchCtx } from '../../shared/types';
import { entriesMatch, upgradeToEntries } from './filter-entry';

const DIR = 'lists';
const FILE = 'ssl-decrypt.json';

export class SslListStore {
  private dir: string;
  private file: string;
  private cfg: SslDecryptConfig = { enabled: true, mode: 'all', entries: [] };

  constructor() {
    this.dir = path.join(app.getPath('userData'), DIR);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, FILE);
    this.load();
  }

  private load() {
    let migrated = false;
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (parsed && ['all', 'include', 'exclude'].includes(parsed.mode)) {
          const rawSource = Array.isArray(parsed.entries) ? parsed.entries : parsed.hosts;
          const entries = upgradeToEntries(rawSource);
          const enabled = parsed.enabled === false ? false : true;
          this.cfg = { enabled, mode: parsed.mode as SslDecryptMode, entries };
          if ((parsed.hosts && !Array.isArray(parsed.entries)) || parsed.enabled === undefined) {
            migrated = true;
          }
        }
      }
    } catch {}
    if (migrated) this.save();
  }

  private save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.cfg, null, 2), 'utf8');
    } catch {}
  }

  get(): SslDecryptConfig {
    return { enabled: this.cfg.enabled, mode: this.cfg.mode, entries: this.cfg.entries.map((e) => ({ ...e })) };
  }

  set(cfg: SslDecryptConfig): SslDecryptConfig {
    const entries = upgradeToEntries(cfg.entries as unknown);
    this.cfg = {
      enabled: cfg.enabled === false ? false : true,
      mode: cfg.mode,
      entries,
    };
    this.save();
    return this.get();
  }

  /** CONNECT 阶段决策；ctx 只含 host/appName，URL 类目条目会被跳过。 */
  shouldDecrypt(ctx: FilterMatchCtx): boolean {
    if (!this.cfg.enabled) return false;
    if (this.cfg.mode === 'all') return true;
    const hit = entriesMatch(this.cfg.entries, ctx, /* allowUrl */ false);
    return this.cfg.mode === 'include' ? hit : !hit;
  }
}

let ref: SslListStore | null = null;
export function setSslListStore(s: SslListStore | null) {
  ref = s;
}
export function getSslListStore(): SslListStore | null {
  return ref;
}

export type { SslDecryptConfig, SslDecryptMode, FilterEntry };
