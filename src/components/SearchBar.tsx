import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X, Plus, Trash2, Save, Pencil, ChevronRight } from 'lucide-react';
import {
  useFlowStore,
  type SearchScope,
  type SearchMode,
  type AdvancedField,
  type AdvancedOp,
  type AdvancedRule,
  type AdvancedFilter,
  type FilterPreset,
  type FilterState,
} from '../store/flows';
import { matchFilter } from '../lib/filter';
import { cn } from '../lib/cn';

const SCOPES: { key: SearchScope; label: string }[] = [
  { key: 'url', label: 'URL' },
  { key: 'reqHeaders', label: '请求头' },
  { key: 'respHeaders', label: '响应头' },
  { key: 'body', label: '正文' },
  { key: 'method', label: '方法' },
  { key: 'status', label: '状态' },
];

const MODES: { key: SearchMode; label: string }[] = [
  { key: 'contains', label: '包含' },
  { key: 'equals', label: '等于' },
  { key: 'regex', label: '正则' },
];

const FIELDS: { key: AdvancedField; label: string }[] = [
  { key: 'url', label: 'URL' },
  { key: 'host', label: 'Host' },
  { key: 'path', label: 'Path' },
  { key: 'method', label: 'Method' },
  { key: 'status', label: 'Status' },
  { key: 'contentType', label: 'Content-Type' },
  { key: 'reqHeader', label: 'Req Header' },
  { key: 'respHeader', label: 'Resp Header' },
  { key: 'reqBody', label: 'Req Body' },
  { key: 'respBody', label: 'Resp Body' },
];

const OPS: { key: AdvancedOp; label: string }[] = [
  { key: 'contains', label: '包含' },
  { key: 'equals', label: '等于' },
  { key: 'notEquals', label: '不等于' },
  { key: 'regex', label: '正则' },
  { key: 'startsWith', label: '前缀' },
  { key: 'endsWith', label: '后缀' },
  { key: 'gt', label: '>' },
  { key: 'lt', label: '<' },
];

const LS_PRESETS = 'proxybaby:filter-presets';

function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function savePresetsLS(list: FilterPreset[]) {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(list)); } catch {}
}

export function SearchBar({ onNavigate }: { onNavigate?: (dir: 'next' | 'prev') => void }) {
  const filter = useFlowStore((s) => s.filter);
  const setFilter = useFlowStore((s) => s.setFilter);
  const setSearchOpen = useFlowStore((s) => s.setSearchOpen);
  const flows = useFlowStore((s) => s.flows);
  const pinnedIds = useFlowStore((s) => s.pinnedIds);
  const savedIds = useFlowStore((s) => s.savedIds);

  // 当前过滤下的命中数：决定"上一条 / 下一条"按钮是否可点
  const hitCount = useMemo(
    () => flows.reduce((acc, f) => acc + (matchFilter(f, filter, { pinnedIds, savedIds }) ? 1 : 0), 0),
    [flows, filter, pinnedIds, savedIds],
  );
  const canNavigate = hitCount > 0;

  const adv: AdvancedFilter = filter.advanced || { combinator: 'AND', rules: [] };
  const [showAdvanced, setShowAdvanced] = useState<boolean>(adv.rules.length > 0);
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>(() => loadPresets());
  const [presetName, setPresetName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => { savePresetsLS(presets); }, [presets]);

  const setAdv = (patch: Partial<AdvancedFilter>) => setFilter({ advanced: { ...adv, ...patch } });
  const addRule = () => setAdv({ rules: [...adv.rules, { field: 'url', op: 'contains', value: '' }] });
  const updateRule = (idx: number, patch: Partial<AdvancedRule>) => {
    setAdv({ rules: adv.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  };
  const removeRule = (idx: number) => setAdv({ rules: adv.rules.filter((_, i) => i !== idx) });
  const clearAll = () => setAdv({ combinator: 'AND', rules: [] });

  const advCount = adv.rules.length;

  // 预设：保存 = 快照当前 FilterState；应用 = 覆盖当前 FilterState
  const saveAsPreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const snapshot: FilterState = { ...filter };
    const id = `p_${Date.now().toString(36)}`;
    setPresets([...presets, { id, name, filter: snapshot }]);
    setPresetName('');
  };
  const overwritePreset = (id: string) => {
    setPresets(presets.map((p) => (p.id === id ? { ...p, filter: { ...filter } } : p)));
  };
  const applyPreset = (p: FilterPreset) => {
    setFilter({ ...p.filter });
    const rules = p.filter.advanced?.rules?.length ?? 0;
    if (rules > 0) setShowAdvanced(true);
  };
  const removePreset = (id: string) => setPresets(presets.filter((p) => p.id !== id));
  const startRename = (p: FilterPreset) => { setEditingId(p.id); setEditingName(p.name); };
  const commitRename = () => {
    if (!editingId) return;
    const nm = editingName.trim();
    if (nm) setPresets(presets.map((p) => (p.id === editingId ? { ...p, name: nm } : p)));
    setEditingId(null); setEditingName('');
  };

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (filter.text) parts.push(`${filter.scope}:${filter.mode}:"${filter.text}"`);
    if (advCount) parts.push(`${advCount} 条${adv.combinator}规则`);
    return parts.join(' · ');
  }, [filter, advCount, adv.combinator]);

  return (
    <div className="border-b border-pb-border bg-pb-panel">
      {/* 主搜索行 */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
        <input
          type="checkbox"
          className="accent-pb-accent"
          checked={filter.enabled}
          onChange={(e) => setFilter({ enabled: e.target.checked })}
          title="启用/停用当前过滤"
        />
        <select
          className="pb-input py-0.5 text-xs bg-pb-bg"
          value={filter.scope}
          onChange={(e) => setFilter({ scope: e.target.value as SearchScope })}
        >
          {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select
          className="pb-input py-0.5 text-xs bg-pb-bg"
          value={filter.mode}
          onChange={(e) => setFilter({ mode: e.target.value as SearchMode })}
        >
          {MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <div className="flex-1 relative">
          <Search size={12} className="text-pb-muted absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            data-testid="searchbar-input"
            autoFocus
            className={cn('pb-input py-1 pl-6 pr-2 w-full text-xs')}
            placeholder="文本"
            value={filter.text}
            onChange={(e) => setFilter({ text: e.target.value })}
          />
        </div>
        <button
          className="pb-btn px-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          title={canNavigate ? '上一条 ⌘↑' : '当前过滤无命中'}
          disabled={!canNavigate}
          onClick={() => canNavigate && onNavigate?.('prev')}
        >
          <ChevronUp size={14} />
        </button>
        <button
          className="pb-btn px-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          title={canNavigate ? '下一条 ⌘↓' : '当前过滤无命中'}
          disabled={!canNavigate}
          onClick={() => canNavigate && onNavigate?.('next')}
        >
          <ChevronDown size={14} />
        </button>
        <button
          data-testid="searchbar-toggle-adv"
          onClick={() => setShowAdvanced((v) => !v)}
          className={cn('pb-btn px-2 py-0.5 flex items-center gap-1', advCount > 0 && 'bg-pb-accent/20 text-pb-accent')}
          title="展开/收起 高级条件（AND/OR/NOT）"
        >
          {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          高级 {advCount > 0 && <span>({advCount})</span>}
        </button>
        <button
          data-testid="searchbar-toggle-presets"
          onClick={() => setShowPresets((v) => !v)}
          className={cn('pb-btn px-2 py-0.5 flex items-center gap-1', presets.length > 0 && 'text-pb-text')}
          title="预设：保存/切换/编辑/删除"
        >
          {showPresets ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          预设 {presets.length > 0 && <span>({presets.length})</span>}
        </button>
        <button className="pb-btn px-1.5" title="关闭 ESC" onClick={() => setSearchOpen(false)}>
          <X size={14} />
        </button>
      </div>

      {/* 高级：AND/OR + 多条件 + NOT（取反） */}
      {showAdvanced && (
        <div className="px-3 pb-2 border-t border-pb-border/60 text-xs space-y-1.5">
          <div className="flex items-center gap-2 pt-2">
            <span className="text-pb-muted">组合：</span>
            {(['AND', 'OR'] as const).map((c) => (
              <label key={c} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="searchbar-comb"
                  data-testid={`adv-comb-${c}`}
                  checked={adv.combinator === c}
                  onChange={() => setAdv({ combinator: c })}
                /> {c}
              </label>
            ))}
            <button
              data-testid="adv-add"
              onClick={addRule}
              className="pb-btn px-1.5 py-0.5 flex items-center gap-1 ml-auto"
            ><Plus size={12} /> 添加条件</button>
            <button
              data-testid="adv-clear"
              onClick={clearAll}
              disabled={!adv.rules.length}
              className="pb-btn px-1.5 py-0.5"
            >清空</button>
          </div>

          {adv.rules.length === 0 && (
            <div className="text-pb-muted italic px-2 py-2 text-center border border-dashed border-pb-border rounded">
              还没有条件，点击"添加条件"开始。支持每条 NOT（取反）。
            </div>
          )}

          {adv.rules.map((r, i) => (
            <div
              key={i}
              className="flex flex-wrap gap-1 items-center border border-pb-border rounded p-1"
              data-testid={`adv-rule-${i}`}
            >
              {i > 0 && (
                <span className="text-[10px] font-mono text-pb-muted px-1">{adv.combinator}</span>
              )}
              <label className="flex items-center gap-1 px-1 text-pb-muted" title="NOT：取反当前条件">
                <input
                  type="checkbox"
                  checked={!!r.negate}
                  onChange={(e) => updateRule(i, { negate: e.target.checked })}
                />
                <span className={cn('text-[10px] font-mono', r.negate && 'text-pb-warn')}>NOT</span>
              </label>
              <select
                value={r.field}
                onChange={(e) => updateRule(i, { field: e.target.value as AdvancedField })}
                className="pb-input px-1 py-0.5"
                data-testid={`adv-field-${i}`}
              >
                {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              {(r.field === 'reqHeader' || r.field === 'respHeader') && (
                <input
                  className="pb-input px-1 py-0.5 w-32"
                  placeholder="Header 名"
                  value={r.headerName || ''}
                  onChange={(e) => updateRule(i, { headerName: e.target.value })}
                  data-testid={`adv-header-${i}`}
                />
              )}
              <select
                value={r.op}
                onChange={(e) => updateRule(i, { op: e.target.value as AdvancedOp })}
                className="pb-input px-1 py-0.5"
                data-testid={`adv-op-${i}`}
              >
                {OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <input
                className="pb-input px-1 py-0.5 flex-1 min-w-[120px] font-mono"
                placeholder="值"
                value={r.value}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                data-testid={`adv-value-${i}`}
              />
              <button
                className="pb-btn px-1.5 py-0.5"
                onClick={() => removeRule(i)}
                data-testid={`adv-remove-${i}`}
                title="删除该条件"
              ><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* 预设 */}
      {showPresets && (
        <div className="px-3 pb-2 border-t border-pb-border/60 text-xs space-y-1.5">
          <div className="flex items-center gap-2 pt-2">
            <span className="text-pb-muted shrink-0">保存当前为：</span>
            <input
              className="pb-input px-1 py-0.5 flex-1"
              placeholder="预设名称"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveAsPreset(); }}
              data-testid="adv-preset-name"
            />
            <button
              className="pb-btn px-1.5 py-0.5 flex items-center gap-1"
              onClick={saveAsPreset}
              disabled={!presetName.trim()}
              data-testid="adv-preset-save"
            ><Save size={12} /> 保存</button>
          </div>
          {summary && (
            <div className="text-pb-muted italic text-[11px] pl-1">当前：{summary}</div>
          )}
          {presets.length === 0 ? (
            <div className="text-pb-muted italic px-2 py-2 text-center border border-dashed border-pb-border rounded">
              尚无预设。命名后点"保存"即可创建。
            </div>
          ) : (
            <div className="space-y-0.5">
              {presets.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-1 py-0.5 hover:bg-pb-hover rounded px-1"
                  data-testid={`adv-preset-${p.id}`}
                >
                  {editingId === p.id ? (
                    <input
                      className="pb-input px-1 py-0.5 flex-1"
                      value={editingName}
                      autoFocus
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        else if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                      }}
                    />
                  ) : (
                    <button
                      className="flex-1 text-left px-1 py-0.5 truncate"
                      onClick={() => applyPreset(p)}
                      title="应用预设"
                    >{p.name}</button>
                  )}
                  <button
                    className="pb-btn px-1.5 py-0.5"
                    title="覆盖为当前过滤"
                    onClick={() => overwritePreset(p.id)}
                  ><Save size={12} /></button>
                  <button
                    className="pb-btn px-1.5 py-0.5"
                    title="重命名"
                    onClick={() => startRename(p)}
                  ><Pencil size={12} /></button>
                  <button
                    className="pb-btn px-1.5 py-0.5"
                    title="删除"
                    onClick={() => removePreset(p.id)}
                  ><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 快捷键提示（低干扰） */}
      <div className="px-3 pb-1.5 text-[11px] text-pb-muted font-mono flex items-center gap-3">
        <span>显示: ⌘F</span>
        <span>新建: ⌘N</span>
        <span>删除: ⇧⌘N</span>
        <span>向上: ⌘↑</span>
        <span>向下: ⌘↓</span>
        <span>开/关: ⌘B</span>
        <span>隐藏: ESC</span>
      </div>
    </div>
  );
}
