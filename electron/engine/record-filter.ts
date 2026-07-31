/**
 * 抓包记录过滤（Recording filter）持久化。
 *
 * 存储：`<userData>/lists/record-filter.json`
 *   { mode: 'all'|'include'|'exclude', entries: FilterEntry[] }
 *
 * 语义（跟 SSL 白名单、Allow/Block 都不同）：
 *   - mode='all'      → 全部请求都记录到 flow store 里（默认）
 *   - mode='include'  → **只记录**命中 entries 的请求；其他请求正常代理但不进 flow store（UI 看不见）
 *   - mode='exclude'  → **不记录**命中 entries 的请求；其他请求正常记录
 *
 * 关键差别：
 *   - SSL 白名单：决定 HTTPS 是否 MITM 解密，仅对 HTTPS 生效
 *   - Allow/Block：决定请求是否放行（block 会 abort 请求）
 *   - Record filter：不影响请求本身，只影响 UI 记录（HTTP + HTTPS 都生效）
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { FilterEntry, FilterMatchCtx } from '../../shared/types';
import { entriesMatch, upgradeToEntries } from './filter-entry';

const DIR = 'lists';
const FILE = 'record-filter.json';

export type RecordFilterMode = 'all' | 'include' | 'exclude';
export interface RecordFilterConfig {
  mode: RecordFilterMode;
  entries: FilterEntry[];
}

export class RecordFilterStore {
  private dir: string;
  private file: string;
  private cfg: RecordFilterConfig = { mode: 'all', entries: [] };

  constructor() {
    this.dir = path.join(app.getPath('userData'), DIR);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, FILE);
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (parsed && (parsed.mode === 'all' || parsed.mode === 'include' || parsed.mode === 'exclude')) {
          this.cfg = {
            mode: parsed.mode as RecordFilterMode,
            entries: upgradeToEntries(parsed.entries),
          };
        }
      }
    } catch {}
  }

  private save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.cfg, null, 2), 'utf8');
    } catch {}
  }

  get(): RecordFilterConfig {
    return { mode: this.cfg.mode, entries: this.cfg.entries.map((e) => ({ ...e })) };
  }

  set(cfg: RecordFilterConfig): RecordFilterConfig {
    this.cfg = { mode: cfg.mode, entries: upgradeToEntries(cfg.entries) };
    this.save();
    return this.get();
  }

  /**
   * 请求阶段决策：是否把这条请求记录进 flow store。
   * 返回 true → 记录；false → 忽略（请求本身继续走上游）。
   */
  shouldRecord(ctx: FilterMatchCtx): boolean {
    if (this.cfg.mode === 'all') return true;
    const hit = entriesMatch(this.cfg.entries, ctx, /* allowUrl */ true);
    return this.cfg.mode === 'include' ? hit : !hit;
  }

  /**
   * CONNECT 阶段决策：是否应该 MITM 解密该 host 的 HTTPS。
   *   - mode='all'                  → 一律解密
   *   - mode='include' 未命中       → 不解密（该请求根本不会被记录）
   *   - mode='include' 命中的条目 → 看条目 decrypt 开关（未显式 false 都视为 true）
   *   - mode='exclude' 命中的条目 → 命中 = 不记录 → 不解密
   *   - mode='exclude' 未命中       → 解密
   * ctx 只含 host/appName，URL 类目条目视为未命中。
   */
  shouldDecrypt(ctx: FilterMatchCtx): boolean {
    if (this.cfg.mode === 'all') return true;
    // 只在 host/app 维度里找命中；URL 类目在 CONNECT 阶段拿不到路径，跳过
    const hitEntry = this.cfg.entries.find(
      (e) =>
        e.enabled &&
        e.kind !== 'url' &&
        ((e.kind === 'host' && this.hostMatch(e.value, ctx.host)) ||
          (e.kind === 'app' && !!ctx.appName && ctx.appName === e.value)),
    );
    if (this.cfg.mode === 'include') {
      // include：未命中 → 不记录也不解密；命中 → 看 entry.decrypt
      if (!hitEntry) return false;
      return hitEntry.decrypt !== false;
    }
    // exclude：命中 → 不记录也不解密；未命中 → 解密
    return !hitEntry;
  }

  private hostMatch(pattern: string, host: string): boolean {
    if (pattern === host) return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix);
    }
    return false;
  }
}

let ref: RecordFilterStore | null = null;
export function setRecordFilterStore(s: RecordFilterStore | null) {
  ref = s;
}
export function getRecordFilterStore(): RecordFilterStore | null {
  return ref;
}
