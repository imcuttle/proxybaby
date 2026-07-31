import { useEffect, useMemo, useState } from 'react';
import type { FilterEntry, FilterEntryEditorParams, FilterKind, UrlMatchMode } from '../../../shared/types';
import { cn } from '../../lib/cn';

/**
 * 独立子窗口视图：新增一条 FilterEntry。
 * 通过 filterEntryEditorConsumeInit 拉取父窗口塞入的 scope；提交时直接写目标 store 并 broadcast。
 */
export function FilterEntryEditorView() {
  const [params, setParams] = useState<FilterEntryEditorParams | null>(null);
  const [kind, setKind] = useState<FilterKind>('host');
  const [value, setValue] = useState('');
  const [urlMode, setUrlMode] = useState<UrlMatchMode>('glob');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = await window.proxybaby.filterEntryEditorConsumeInit();
      setParams(p);
      // 若不允许 url，且默认 kind 恰好是 url，切回 host（当前默认就是 host 所以无需处理）
    })();
  }, []);

  const placeholder = useMemo(() => {
    if (kind === 'app') return '例如：Google Chrome';
    if (kind === 'host') return '例如：*.example.com';
    return urlMode === 'regex' ? '例如：^https://api\\.foo\\.com/v[0-9]+/' : '例如：https://api.foo.com/*';
  }, [kind, urlMode]);

  const kinds: FilterKind[] = useMemo(() => {
    const base: FilterKind[] = ['host', 'app'];
    if (params?.allowUrl) base.push('url');
    return base;
  }, [params]);

  const closeSelf = () => window.proxybaby.closeSelfWindow();

  const save = async () => {
    if (!params) return;
    const v = value.trim();
    if (!v) { setError('值不能为空'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const entry: FilterEntry = {
        id: crypto.randomUUID(),
        kind,
        value: v,
        urlMode: kind === 'url' ? urlMode : undefined,
        enabled: true,
        note: note.trim() || undefined,
      };
      if (params.scope === 'ssl') {
        const cur = await window.proxybaby.sslListGet();
        await window.proxybaby.sslListSet({ ...cur, entries: [...cur.entries, entry] });
      } else if (params.scope === 'record') {
        const cur = await window.proxybaby.recordFilterGet();
        await window.proxybaby.recordFilterSet({ ...cur, entries: [...cur.entries, entry] });
      } else {
        const cur = await window.proxybaby.allowBlockGet();
        await window.proxybaby.allowBlockSet({ ...cur, entries: [...cur.entries, entry] });
      }
      // 通知父窗口刷新
      await window.proxybaby.broadcast('filter-entry-editor:committed', { scope: params.scope });
      closeSelf();
    } catch (e: any) {
      setError(e?.message || '保存失败');
      setSubmitting(false);
    }
  };

  if (!params) {
    return (
      <div className="p-4 text-xs text-pb-muted" data-testid="filter-entry-editor-loading">
        加载中…
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 text-sm" data-testid="filter-entry-editor">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-pb-muted">类型</span>
        <div className="flex gap-1">
          {kinds.map((k) => (
            <button
              key={k}
              className={cn('pb-btn px-2 py-0.5', kind === k && 'bg-pb-accent/20 text-pb-accent')}
              onClick={() => setKind(k)}
              data-testid={`fee-kind-${k}`}
            >
              {k === 'app' ? 'App' : k === 'host' ? '域名' : '地址'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-pb-muted">值</span>
        <input
          className="pb-input px-2 py-1 flex-1 text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          data-testid="fee-value"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim() && !submitting) save();
            if (e.key === 'Escape') closeSelf();
          }}
        />
      </div>

      {kind === 'url' && (
        <div className="flex items-center gap-2 text-xs">
          <span className="w-14 text-pb-muted">匹配</span>
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              checked={urlMode === 'glob'}
              onChange={() => setUrlMode('glob')}
              data-testid="fee-urlmode-glob"
            /> 通配（*）
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              checked={urlMode === 'regex'}
              onChange={() => setUrlMode('regex')}
              data-testid="fee-urlmode-regex"
            /> 正则
          </label>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-pb-muted">备注</span>
        <input
          className="pb-input px-2 py-1 flex-1 text-xs"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="可选"
        />
      </div>

      {error && <div className="text-xs text-pb-warn" data-testid="fee-error">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button className="pb-btn px-3 py-1 text-xs" onClick={closeSelf} data-testid="fee-cancel">
          取消
        </button>
        <button
          className="pb-btn px-3 py-1 text-xs bg-pb-accent/20 text-pb-accent"
          disabled={!value.trim() || submitting}
          onClick={save}
          data-testid="fee-save"
        >
          {submitting ? '保存中…' : '添加'}
        </button>
      </div>
    </div>
  );
}
