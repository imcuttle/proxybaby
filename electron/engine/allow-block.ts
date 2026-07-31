/**
 * Allow/Block 名单持久化。
 *
 * 存储：`<userData>/lists/allowblock.json`
 *   { mode: 'off'|'allow'|'block', entries: FilterEntry[] }
 *
 * 兼容旧格式 `{ mode, hosts: string[] }`，加载时自动迁移到新 entries。
 *
 * 语义：
 *   - mode='off'   → 不生效
 *   - mode='allow' → 仅命中 entries 的请求通过，其余 abort
 *   - mode='block' → 命中 entries 的请求 abort，其余通过
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AllowBlockConfig, AllowBlockMode, FilterEntry, FilterMatchCtx } from '../../shared/types';
import { entriesMatch, upgradeToEntries } from './filter-entry';

const DIR = 'lists';
const FILE = 'allowblock.json';

export class AllowBlockStore {
  private dir: string;
  private file: string;
  private cfg: AllowBlockConfig = { mode: 'off', entries: [] };

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
        if (parsed && (parsed.mode === 'off' || parsed.mode === 'allow' || parsed.mode === 'block')) {
          const rawSource = Array.isArray(parsed.entries) ? parsed.entries : parsed.hosts;
          const entries = upgradeToEntries(rawSource);
          this.cfg = { mode: parsed.mode as AllowBlockMode, entries };
          if (parsed.hosts && !Array.isArray(parsed.entries)) migrated = true;
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

  get(): AllowBlockConfig {
    return { mode: this.cfg.mode, entries: this.cfg.entries.map((e) => ({ ...e })) };
  }

  set(cfg: AllowBlockConfig): AllowBlockConfig {
    const entries = upgradeToEntries(cfg.entries as unknown);
    this.cfg = { mode: cfg.mode, entries };
    this.save();
    return this.get();
  }

  /** 请求阶段决策；ctx 至少含 host。 */
  decide(ctx: FilterMatchCtx): { allow: boolean; reason?: string } {
    if (this.cfg.mode === 'off') return { allow: true };
    const hit = entriesMatch(this.cfg.entries, ctx, /* allowUrl */ true);
    if (this.cfg.mode === 'block') return hit ? { allow: false, reason: 'blocked-by-list' } : { allow: true };
    return hit ? { allow: true } : { allow: false, reason: 'not-in-allowlist' };
  }
}

let storeRef: AllowBlockStore | null = null;
export function setAllowBlockStore(s: AllowBlockStore | null) {
  storeRef = s;
}
export function getAllowBlockStore(): AllowBlockStore | null {
  return storeRef;
}

export type { AllowBlockConfig, AllowBlockMode, FilterEntry };
