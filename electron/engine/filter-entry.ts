/**
 * FilterEntry 匹配 & 旧格式（string[] hosts）迁移工具。
 *
 * 语义详见 docs/superpowers/specs/2026-07-31-filter-config-window-design.md。
 *
 * 使用场景：
 *   - AllowBlockStore.decide(ctx)：请求阶段，ctx 含 host/appName/method/url，url 类目参与。
 *   - SslListStore.shouldDecrypt(ctx)：CONNECT 阶段，ctx 只含 host/appName，url 类目视为未命中。
 */
import { randomUUID } from 'node:crypto';
import type { FilterEntry, FilterMatchCtx, FilterKind, UrlMatchMode } from '../../shared/types';

/** 主机名后缀通配：`*.foo.com` 命中 foo.com 与任意子域。 */
export function matchHostPattern(pattern: string, host: string): boolean {
  if (!pattern || !host) return false;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".foo.com"
    return host === pattern.slice(2) || host.endsWith(suffix);
  }
  return pattern === host;
}

/** App 名称精确匹配，暂不做通配（预留）。 */
export function matchAppName(pattern: string, appName?: string): boolean {
  if (!pattern || !appName) return false;
  return pattern === appName;
}

function globToRegex(pattern: string): RegExp {
  // 转义除 * 外的正则元字符，再把 * 换成 .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$');
}

/** URL 类目匹配。匹配对象：`${METHOD} ${url}`；只有 url 时以 url 为准。 */
export function matchUrlEntry(
  value: string,
  mode: UrlMatchMode | undefined,
  ctx: { method?: string; url?: string },
): boolean {
  if (!value || !ctx.url) return false;
  const target = ctx.method ? `${ctx.method.toUpperCase()} ${ctx.url}` : ctx.url;
  try {
    if (mode === 'regex') {
      return new RegExp(value).test(ctx.url);
    }
    // glob 默认：同时尝试对完整 "METHOD URL" 与仅 URL 匹配，用户写起来更自由
    const re = globToRegex(value);
    return re.test(target) || re.test(ctx.url);
  } catch {
    return false;
  }
}

/** 判断一条 entry 是否命中 ctx。`allowUrl=false` 时（例如 CONNECT 阶段）URL 类目一律视为未命中。 */
export function entryMatches(entry: FilterEntry, ctx: FilterMatchCtx, allowUrl = true): boolean {
  if (!entry.enabled) return false;
  switch (entry.kind) {
    case 'host':
      return matchHostPattern(entry.value, ctx.host);
    case 'app':
      return matchAppName(entry.value, ctx.appName);
    case 'url':
      if (!allowUrl) return false;
      return matchUrlEntry(entry.value, entry.urlMode, ctx);
    default:
      return false;
  }
}

/** 数组任一命中即整体命中。 */
export function entriesMatch(entries: FilterEntry[], ctx: FilterMatchCtx, allowUrl = true): boolean {
  for (const e of entries) if (entryMatches(e, ctx, allowUrl)) return true;
  return false;
}

/** 从任意（旧 `hosts: string[]` 或新 `entries: FilterEntry[]`）载入的原始值升级为 FilterEntry[]。 */
export function upgradeToEntries(raw: unknown): FilterEntry[] {
  if (Array.isArray(raw)) {
    const out: FilterEntry[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        const value = item.trim();
        if (!value) continue;
        out.push({ id: randomUUID(), kind: 'host', value, enabled: true });
      } else if (item && typeof item === 'object') {
        const it = item as Record<string, unknown>;
        const kind = (it.kind as FilterKind) || 'host';
        if (kind !== 'app' && kind !== 'host' && kind !== 'url') continue;
        const value = typeof it.value === 'string' ? it.value.trim() : '';
        if (!value) continue;
        out.push({
          id: typeof it.id === 'string' && it.id ? it.id : randomUUID(),
          kind,
          value,
          urlMode: kind === 'url'
            ? (it.urlMode === 'regex' ? 'regex' : 'glob')
            : undefined,
          enabled: it.enabled === false ? false : true,
          note: typeof it.note === 'string' ? it.note : undefined,
        });
      }
    }
    // 去重（id 冲突 / 同 kind+value 重复）
    const seen = new Set<string>();
    const dedup: FilterEntry[] = [];
    for (const e of out) {
      const key = `${e.kind}|${e.value}|${e.urlMode ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(e);
    }
    return dedup;
  }
  return [];
}

/** 生成一条空 entry，供 UI 新增使用。 */
export function makeEntry(kind: FilterKind, value: string, opts?: Partial<FilterEntry>): FilterEntry {
  return {
    id: randomUUID(),
    kind,
    value: value.trim(),
    urlMode: kind === 'url' ? (opts?.urlMode ?? 'glob') : undefined,
    enabled: opts?.enabled !== false,
    note: opts?.note,
  };
}
