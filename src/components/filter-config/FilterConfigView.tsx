import { useEffect, useState } from 'react';
import { Plus, Trash2, Ban, Filter } from 'lucide-react';
import type {
  AllowBlockConfig,
  RecordFilterConfig,
  FilterEntry,
  FilterKind,
} from '../../../shared/types';
import { cn } from '../../lib/cn';

/**
 * 过滤配置总视图：两个 Tab
 *   1. 抓包记录过滤 (record filter)：决定哪些请求进 flow list（对 HTTP + HTTPS 都生效，不影响请求本身）。
 *      每条 include/exclude 条目还有一个"SSL 解密"开关：勾了就 MITM 该条目的 HTTPS，否则直通不解密。
 *   2. 允许 / 阻止：决定哪些请求被 abort（真正拒绝访问）
 *
 * 数据流：所有变更走 IPC 的 recordFilter:set / allowBlock:set，主进程即时落盘并返回新配置。
 */
export function FilterConfigView() {
  const [tab, setTab] = useState<'record' | 'allow-block'>('record');
  return (
    <div className="h-full flex flex-col bg-pb-bg text-pb-text overflow-hidden">
      <div className="flex border-b border-pb-border bg-pb-panel px-2 pt-1.5 gap-1 text-xs">
        <TabButton active={tab === 'record'} onClick={() => setTab('record')} testId="tab-record">
          <Filter size={12} /> 抓包记录过滤
        </TabButton>
        <TabButton active={tab === 'allow-block'} onClick={() => setTab('allow-block')} testId="tab-allowblock">
          <Ban size={12} /> 允许 / 阻止
        </TabButton>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-scroll">
        {tab === 'record' ? <RecordFilterTab /> : <AllowBlockTab />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'px-3 py-1.5 rounded-t border-b-2 -mb-px inline-flex items-center gap-1',
        active ? 'border-pb-accent text-pb-accent bg-pb-bg' : 'border-transparent text-pb-muted hover:text-pb-text',
      )}
    >
      {children}
    </button>
  );
}

// ============ Record filter Tab (抓包记录过滤) ============
function RecordFilterTab() {
  const [cfg, setCfg] = useState<RecordFilterConfig>({ mode: 'all', entries: [] });

  const refresh = async () => setCfg(await window.proxybaby.recordFilterGet());
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const off = window.proxybaby.onEvent('filter-entry-editor:committed' as any, (p: any) => {
      if (p?.scope === 'record') refresh();
    });
    return () => off();
  }, []);

  const save = async (next: RecordFilterConfig) => setCfg(await window.proxybaby.recordFilterSet(next));
  const setMode = (mode: RecordFilterConfig['mode']) => save({ ...cfg, mode });
  const setEntries = (entries: FilterEntry[]) => save({ ...cfg, entries });

  return (
    <div className="p-4 space-y-3" data-testid="record-filter-panel">
      <div className="text-xs text-pb-muted">
        决定哪些请求会被抓到列表里显示。<b>只影响 UI 记录，不影响请求本身</b>——命中"不记录"的请求依然会正常代理到上游。
        对 HTTP 和 HTTPS 都生效。
      </div>

      <div className="flex text-xs items-center gap-3" data-testid="record-mode">
        {(['all', 'include', 'exclude'] as const).map((m) => (
          <label key={m} className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="record-mode"
              data-testid={`record-mode-${m}`}
              checked={cfg.mode === m}
              onChange={() => setMode(m)}
            />
            {m === 'all' ? '全部记录' : m === 'include' ? '仅记录以下列表' : '排除以下列表'}
          </label>
        ))}
      </div>

      <div className="text-xs text-pb-muted">
        {cfg.mode === 'all'
          ? '当前是"全部记录"模式：所有请求都会显示在列表里。'
          : cfg.mode === 'include'
            ? '仅命中下方列表的请求会被记录，其他请求仍会代理但不显示。'
            : '命中下方列表的请求不会显示，其他请求正常记录。'}
      </div>

      <EntryTable
        entries={cfg.entries}
        onChange={setEntries}
        scope="record"
        allowUrl
        testIdPrefix="record"
      />
    </div>
  );
}

// ============ Allow / Block Tab ============
function AllowBlockTab() {
  const [cfg, setCfg] = useState<AllowBlockConfig>({ mode: 'off', entries: [] });
  const refresh = async () => setCfg(await window.proxybaby.allowBlockGet());
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const off = window.proxybaby.onEvent('filter-entry-editor:committed' as any, (p: any) => {
      if (p?.scope === 'allow-block') refresh();
    });
    return () => off();
  }, []);
  const save = async (next: AllowBlockConfig) => setCfg(await window.proxybaby.allowBlockSet(next));

  const setMode = (mode: AllowBlockConfig['mode']) => save({ ...cfg, mode });
  const setEntries = (entries: FilterEntry[]) => save({ ...cfg, entries });

  return (
    <div className="p-4 space-y-3" data-testid="allowblock-panel">
      <div className="text-xs text-pb-muted">
        按 App / 域名 / URL 允许或阻止请求。命中"阻止"列表的请求直接中断；"允许"模式下仅命中的请求放行。
      </div>
      <div className="flex text-xs items-center gap-3" data-testid="allowblock-mode">
        {(['off', 'allow', 'block'] as const).map((m) => (
          <label key={m} className="inline-flex items-center gap-1">
            <input
              type="radio"
              name="ab-mode"
              data-testid={`allowblock-mode-${m}`}
              checked={cfg.mode === m}
              onChange={() => setMode(m)}
            />
            {m === 'off' ? '关闭' : m === 'allow' ? '仅允许列表' : '阻止列表'}
          </label>
        ))}
      </div>

      <EntryTable entries={cfg.entries} onChange={setEntries} scope="allow-block" allowUrl testIdPrefix="allowblock" />
    </div>
  );
}

// ============ EntryTable ============
function EntryTable({
  entries,
  onChange,
  scope,
  allowUrl,
  showUrlHint,
  testIdPrefix,
}: {
  entries: FilterEntry[];
  onChange: (next: FilterEntry[]) => void;
  scope: 'record' | 'allow-block';
  allowUrl: boolean;
  showUrlHint?: boolean;
  testIdPrefix: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const showDecrypt = scope === 'record';

  const updateEntry = (id: string, patch: Partial<FilterEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const removeEntry = (id: string) => onChange(entries.filter((e) => e.id !== id));

  const openEditor = () => {
    void window.proxybaby.filterEntryEditorOpen({ scope, allowUrl });
  };

  // record scope 多一列"SSL 解密"
  const gridCls = showDecrypt
    ? 'grid grid-cols-[70px_1fr_90px_70px_1fr_50px] text-xs border-b border-pb-border/50 items-center'
    : 'grid grid-cols-[70px_1fr_100px_1fr_50px] text-xs border-b border-pb-border/50 items-center';
  const headerCls = showDecrypt
    ? 'grid grid-cols-[70px_1fr_90px_70px_1fr_50px] text-xs bg-pb-panel border-b border-pb-border'
    : 'grid grid-cols-[70px_1fr_100px_1fr_50px] text-xs bg-pb-panel border-b border-pb-border';

  return (
    <div className="border border-pb-border rounded overflow-hidden">
      <div className={headerCls}>
        <div className="px-2 py-1">类型</div>
        <div className="px-2 py-1">值</div>
        <div className="px-2 py-1">选项</div>
        {showDecrypt && (
          <div className="px-2 py-1 text-center" title="是否 MITM 解密该条目命中的 HTTPS 流量">SSL 解密</div>
        )}
        <div className="px-2 py-1">备注</div>
        <div className="px-2 py-1 text-center">启用</div>
      </div>
      <div className="max-h-[400px] overflow-y-auto pb-scroll">
        {entries.length === 0 ? (
          <div className="px-3 py-6 text-xs text-pb-muted text-center">
            列表为空。点击下方 + 添加规则。
            {showUrlHint && (
              <div className="mt-1 text-[10px]">
                提示：URL 类目仅在请求进入后的允许/阻止阶段生效，不影响是否触发 MITM。
              </div>
            )}
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={cn(gridCls, 'cursor-pointer', selectedId === e.id && 'bg-pb-accent/10')}
              data-testid={`${testIdPrefix}-row-${e.kind}-${e.value}`}
            >
              <div className="px-2 py-1"><KindChip kind={e.kind} /></div>
              <div className="px-2 py-1 font-mono truncate" title={e.value}>{e.value}</div>
              <div className="px-2 py-1 text-pb-muted">
                {e.kind === 'url' ? (e.urlMode ?? 'glob') : '—'}
              </div>
              {showDecrypt && (
                <div className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={e.decrypt !== false}
                    onChange={(ev) => updateEntry(e.id, { decrypt: ev.target.checked })}
                    onClick={(ev) => ev.stopPropagation()}
                    data-testid={`${testIdPrefix}-decrypt-${e.id}`}
                    title="勾选：命中此条目的 HTTPS 走 MITM 解密；不勾：直通不解密，UI 里只能看到 CONNECT。"
                  />
                </div>
              )}
              <div className="px-2 py-1 text-pb-muted truncate" title={e.note}>{e.note || ''}</div>
              <div className="px-2 py-1 text-center">
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={(ev) => updateEntry(e.id, { enabled: ev.target.checked })}
                  onClick={(ev) => ev.stopPropagation()}
                  data-testid={`${testIdPrefix}-toggle-${e.id}`}
                />
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-1 px-2 py-1 bg-pb-panel border-t border-pb-border">
        <button
          className="pb-btn px-1.5 py-0.5"
          data-testid={`${testIdPrefix}-add`}
          onClick={openEditor}
        >
          <Plus size={12} />
        </button>
        <button
          className="pb-btn px-1.5 py-0.5"
          data-testid={`${testIdPrefix}-remove`}
          disabled={!selectedId}
          onClick={() => { if (selectedId) { removeEntry(selectedId); setSelectedId(null); } }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function KindChip({ kind }: { kind: FilterKind }) {
  const label = kind === 'app' ? 'App' : kind === 'host' ? 'Host' : 'URL';
  const cls =
    kind === 'app'
      ? 'bg-pb-accent/20 text-pb-accent'
      : kind === 'host'
        ? 'bg-emerald-500/20 text-emerald-400'
        : 'bg-amber-500/20 text-amber-400';
  return (
    <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold', cls)}>{label}</span>
  );
}
