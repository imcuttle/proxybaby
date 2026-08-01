import { useMemo, useRef, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Lock, LockOpen, Pin, Bookmark, MoreHorizontal, Pencil, ArrowUp, ArrowDown } from 'lucide-react';
import { useFlowStore, type SortKey, type SortState } from '../store/flows';
import { matchFilter, methodColor, statusColor, isFlowActive, isFlowPinned } from '../lib/filter';
import { formatSize, formatTime, formatDuration } from '../lib/format';
import { cn } from '../lib/cn';
import type { Flow } from '../../shared/types';
import { FlowContextMenu } from './FlowContextMenu';

interface Column { key: string; label: string; width?: number; flex?: boolean; sortKey?: SortKey; resizable?: boolean; resizeFromLeft?: boolean }
const COLUMNS: Column[] = [
  { key: 'index', label: '#', width: 44, sortKey: 'index', resizable: true },
  { key: 'url', label: '网址', flex: true, sortKey: 'url' },
  // 客户端 紧跟 flex 列，从左侧 resize（拖动左边界改变自身宽度 → 网址列自动伸缩）
  { key: 'client', label: '客户端', width: 110, sortKey: 'client', resizable: true, resizeFromLeft: true },
  { key: 'method', label: '方法', width: 60, sortKey: 'method', resizable: true },
  { key: 'status', label: '状态', width: 60, sortKey: 'status', resizable: true },
  { key: 'time', label: '时间', width: 96, sortKey: 'time', resizable: true },
  { key: 'duration', label: '持续时间', width: 76, sortKey: 'duration', resizable: true },
  { key: 'reqSize', label: '请求', width: 60, sortKey: 'reqSize', resizable: true },
  { key: 'respSize', label: '响应', width: 60, sortKey: 'respSize', resizable: true },
  { key: 'ssl', label: 'SSL', width: 34, resizable: true },
  { key: 'edited', label: '已编辑', width: 52, resizable: true },
  { key: 'tools', label: '工具', width: 40 },
];

// 表头与数据行共用同一列宽定义，保证对齐
function colStyle(c: Column, override?: number): React.CSSProperties {
  if (c.flex) return { flex: '1 1 auto', minWidth: 0 };
  const w = override ?? c.width;
  return { width: w, flexShrink: 0 };
}

function compareFlows(a: Flow, b: Flow, key: SortKey): number {
  switch (key) {
    case 'index': return 0; // 默认顺序，asc/desc 通过外层 reverse 实现
    case 'url': return a.request.url.localeCompare(b.request.url);
    case 'client': return (a.app?.name || '').localeCompare(b.app?.name || '');
    case 'method': return a.request.method.localeCompare(b.request.method);
    case 'status': return (a.response?.status || 0) - (b.response?.status || 0);
    case 'time': return a.request.startedAt - b.request.startedAt;
    case 'duration': return (a.durationMs || 0) - (b.durationMs || 0);
    case 'reqSize': return a.request.bodySize - b.request.bodySize;
    case 'respSize': return (a.response?.bodySize || 0) - (b.response?.bodySize || 0);
    default: return 0;
  }
}

const HIGHLIGHT_BG: Record<string, string> = {
  red: 'bg-red-500/15',
  orange: 'bg-orange-500/15',
  yellow: 'bg-yellow-500/15',
  green: 'bg-green-500/15',
  blue: 'bg-blue-500/15',
};

export function RequestList() {
  const flows = useFlowStore((s) => s.flows);
  const filter = useFlowStore((s) => s.filter);
  const selectedId = useFlowStore((s) => s.selectedId);
  const selectedIds = useFlowStore((s) => s.selectedIds);
  const setSelected = useFlowStore((s) => s.setSelected);
  const toggleSelected = useFlowStore((s) => s.toggleSelected);
  const rangeSelect = useFlowStore((s) => s.rangeSelect);
  const pinnedIds = useFlowStore((s) => s.pinnedIds);
  const pinnedHosts = useFlowStore((s) => s.pinnedHosts);
  const pinnedPaths = useFlowStore((s) => s.pinnedPaths);
  const savedIds = useFlowStore((s) => s.savedIds);
  const togglePin = useFlowStore((s) => s.togglePin);
  const toggleSave = useFlowStore((s) => s.toggleSave);
  const noteById = useFlowStore((s) => s.noteById);
  const highlightById = useFlowStore((s) => s.highlightById);
  const sort = useFlowStore((s) => s.sort);
  const cycleSort = useFlowStore((s) => s.cycleSort);
  const columnWidths = useFlowStore((s) => s.columnWidths);
  const setColumnWidth = useFlowStore((s) => s.setColumnWidth);
  const parentRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => flows.filter((f) => matchFilter(f, filter, { pinnedIds, savedIds, pinnedHosts, pinnedPaths })),
    [flows, filter, pinnedIds, savedIds, pinnedHosts, pinnedPaths],
  );

  const sorted = useMemo(() => {
    // 先按 sort 决策基础顺序
    let base: typeof filtered;
    if (!sort) {
      base = filtered;
    } else if (sort.key === 'index') {
      base = sort.dir === 'asc' ? filtered : [...filtered].reverse();
    } else {
      const arr = [...filtered];
      arr.sort((a, b) => compareFlows(a, b, sort.key));
      if (sort.dir === 'desc') arr.reverse();
      base = arr;
    }
    // 再把 pinned（含 host/path 命中）稳定提到最前
    const hasAnyPin =
      Object.keys(pinnedIds).length +
        Object.keys(pinnedHosts).length +
        Object.keys(pinnedPaths).length > 0;
    if (!hasAnyPin) return base;
    const pinnedRows: typeof base = [];
    const rest: typeof base = [];
    for (const f of base) {
      if (isFlowPinned(f, { pinnedIds, pinnedHosts, pinnedPaths })) pinnedRows.push(f);
      else rest.push(f);
    }
    return pinnedRows.concat(rest);
  }, [filtered, sort, pinnedIds, pinnedHosts, pinnedPaths]);

  const orderedIds = useMemo(() => sorted.map((f) => f.id), [sorted]);

  const onRowClick = useCallback((id: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      rangeSelect(id, orderedIds);
    } else if (e.metaKey || e.ctrlKey) {
      toggleSelected(id);
    } else {
      setSelected(id);
    }
  }, [orderedIds, rangeSelect, toggleSelected, setSelected]);

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 20,
  });

  // 跨窗口联动：当 scrollTargetId 被设置（如 AI Sessions 子窗口触发选中），滚动到该行
  const scrollTargetId = useFlowStore((s) => s.scrollTargetId);
  const requestScrollTo = useFlowStore((s) => s.requestScrollTo);
  useEffect(() => {
    if (!scrollTargetId) return;
    const idx = orderedIds.indexOf(scrollTargetId);
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
    requestScrollTo(null);
  }, [scrollTargetId, orderedIds, rowVirtualizer, requestScrollTo]);

  // 方向键切换选中的抓包 item（焦点不在输入框时生效）
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      // Monaco / CodeMirror 内部 textarea 也在此命中
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return;
      if (isEditable(e.target)) return;
      if (orderedIds.length === 0) return;
      const currentIdx = selectedId ? orderedIds.indexOf(selectedId) : -1;
      let nextIdx = currentIdx;
      if (key === 'ArrowUp') nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
      else if (key === 'ArrowDown') nextIdx = currentIdx < 0 ? 0 : Math.min(orderedIds.length - 1, currentIdx + 1);
      else if (key === 'Home') nextIdx = 0;
      else if (key === 'End') nextIdx = orderedIds.length - 1;
      if (nextIdx === currentIdx && currentIdx >= 0) return;
      e.preventDefault();
      const nextId = orderedIds[nextIdx];
      setSelected(nextId);
      // 滚到可视区
      rowVirtualizer.scrollToIndex(nextIdx, { align: 'auto' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orderedIds, selectedId, setSelected, rowVirtualizer]);

  return (
    <div className="h-full flex flex-col bg-pb-bg">
      <div className="flex items-center border-b border-pb-border bg-pb-panel text-xs text-pb-muted select-none pr-2">
        {COLUMNS.map((c) => (
          <HeaderCell
            key={c.key}
            col={c}
            width={columnWidths[c.key]}
            sort={sort}
            onSortClick={c.sortKey ? () => cycleSort(c.sortKey!) : undefined}
            onResize={c.resizable && !c.flex ? (w) => setColumnWidth(c.key, w) : undefined}
          />
        ))}
      </div>
      <div ref={parentRef} className="flex-1 overflow-y-scroll overflow-x-hidden pb-scroll">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((v) => {
            const flow = sorted[v.index];
            const isSelected = !!selectedIds[flow.id];
            const isPrimary = selectedId === flow.id;
            return (
              <Row
                key={flow.id}
                flow={flow}
                index={v.index}
                selected={isSelected}
                primary={isPrimary}
                pinned={isFlowPinned(flow, { pinnedIds, pinnedHosts, pinnedPaths })}
                saved={!!savedIds[flow.id]}
                note={noteById[flow.id]}
                highlight={highlightById[flow.id] || flow.highlight}
                onSelect={onRowClick}
                onTogglePin={togglePin}
                onToggleSave={toggleSave}
                columnWidths={columnWidths}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: v.size,
                  transform: `translateY(${v.start}px)`,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HeaderCell({
  col,
  width,
  sort,
  onSortClick,
  onResize,
}: {
  col: Column;
  width?: number;
  sort: SortState | null;
  onSortClick?: () => void;
  onResize?: (width: number) => void;
}) {
  const active = sort && col.sortKey && sort.key === col.sortKey;
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (!onResize) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = width ?? col.width ?? 80;
      const sign = col.resizeFromLeft ? -1 : 1;   // 左侧 handle：向右拖动缩窄，向左拖动增宽
      const onMove = (ev: MouseEvent) => {
        const next = startW + sign * (ev.clientX - startX);
        onResize(Math.max(40, next));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [onResize, width, col.width, col.resizeFromLeft],
  );
  return (
    <div
      className={cn(
        'relative px-2 py-1 truncate flex items-center justify-start gap-1 text-left',
        onSortClick && 'cursor-pointer hover:text-pb-text',
      )}
      style={colStyle(col, width)}
      onClick={onSortClick}
      title={onSortClick ? '点击切换排序' : undefined}
    >
      <span className="truncate">{col.label}</span>
      {active && (
        sort!.dir === 'asc'
          ? <ArrowUp size={10} className="text-pb-accent shrink-0" />
          : <ArrowDown size={10} className="text-pb-accent shrink-0" />
      )}
      {onResize && (
        <span
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startResize}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute top-0 h-full w-1.5 cursor-col-resize hover:bg-pb-accent/40',
            col.resizeFromLeft ? 'left-0 -ml-0.5' : 'right-0 -mr-0.5',
          )}
        />
      )}
    </div>
  );
}

function Row({
  flow,
  index,
  selected,
  primary,
  pinned,
  saved,
  note,
  highlight,
  onSelect,
  onTogglePin,
  onToggleSave,
  columnWidths,
  style,
}: {
  flow: Flow;
  index: number;
  selected: boolean;
  primary: boolean;
  pinned: boolean;
  saved: boolean;
  note?: string;
  highlight?: string;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string) => void;
  onToggleSave: (id: string) => void;
  columnWidths: Record<string, number>;
  style: React.CSSProperties;
}) {
  const highlightCls = highlight ? HIGHLIGHT_BG[highlight] : '';
  const edited = flow.edited || (flow.matchedRules?.length ?? 0) > 0;
  const active = isFlowActive(flow);
  const cs = (i: number) => colStyle(COLUMNS[i], columnWidths[COLUMNS[i].key]);
  return (
    <FlowContextMenu flow={flow} cellValue={flow.request.url}>
      <div
        style={style}
        data-testid="flow-row"
        data-flow-id={flow.id}
        onClick={(e) => onSelect(flow.id, e)}
        className={cn(
          'group flex items-center text-sm cursor-default border-b border-pb-border/40',
          selected
            ? 'bg-pb-selected text-white hover:brightness-125'
            : cn('hover:bg-pb-hover', highlightCls),
          primary && selected && 'ring-1 ring-inset ring-pb-accent/60',
        )}
      >
        <div className="px-2 py-0.5 truncate text-pb-muted text-left" style={cs(0)}>
          {index + 1}
        </div>
        <div className="px-1 py-0.5 truncate font-mono text-xs flex items-center gap-1 text-left" style={cs(1)}>
          <StatusDot status={flow.status} />
          <button
            data-testid="pin-btn"
            onClick={(e) => { e.stopPropagation(); onTogglePin(flow.id); }}
            className={cn('shrink-0', pinned ? 'text-pb-accent' : 'text-transparent group-hover:text-pb-muted hover:!text-pb-accent')}
            title={pinned ? '取消固定' : '固定'}
          >
            <Pin size={11} />
          </button>
          <button
            data-testid="save-btn"
            onClick={(e) => { e.stopPropagation(); onToggleSave(flow.id); }}
            className={cn('shrink-0', saved ? 'text-pb-warn' : 'text-transparent group-hover:text-pb-muted hover:!text-pb-warn')}
            title={saved ? '取消保存' : '保存'}
          >
            <Bookmark size={11} />
          </button>
          <span className="truncate">{flow.request.url}</span>
          {note && (
            <span title={note} className="shrink-0 text-pb-muted">
              <Pencil size={10} />
            </span>
          )}
        </div>
        <div className="px-2 py-0.5 truncate text-xs flex items-center gap-1 text-left" style={cs(2)}>
          {flow.app?.iconDataUrl && (
            <img src={flow.app.iconDataUrl} alt="" className="w-3 h-3 shrink-0 rounded-[22%]" />
          )}
          <span className="truncate">{flow.app?.name || '—'}</span>
        </div>
        <div className="px-2 py-0.5 flex items-center justify-start text-left" style={cs(3)}>
          <span className={cn('method-badge', methodColor(flow.request.method))}>
            {flow.request.method}
          </span>
        </div>
        <div className="px-2 py-0.5 flex items-center justify-start text-left" style={cs(4)}>
          {flow.response ? (
            <span className={cn('status-badge', statusColor(flow.response.status))}>
              {flow.response.status || '—'}
            </span>
          ) : active ? (
            <span
              title="连接活跃中（尚未关闭）"
              className="status-badge bg-pb-accent/20 text-pb-accent inline-flex items-center gap-1"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-pb-accent animate-pulse" />
              活跃
            </span>
          ) : (
            <span className="text-pb-muted text-xs">—</span>
          )}
        </div>
        <div className="px-2 py-0.5 text-xs text-pb-muted font-mono text-left" style={cs(5)}>
          {formatTime(flow.request.startedAt)}
        </div>
        <div className="px-2 py-0.5 text-xs text-pb-muted font-mono text-left" style={cs(6)}>
          {formatDuration(flow.durationMs)}
        </div>
        <div className="px-2 py-0.5 text-xs text-pb-muted truncate text-left" style={cs(7)}>
          {formatSize(flow.request.bodySize)}
        </div>
        <div className="px-2 py-0.5 text-xs text-pb-muted truncate text-left" style={cs(8)}>
          {formatSize(flow.response?.bodySize)}
        </div>
        <div className="px-2 py-0.5 text-xs flex items-center justify-start text-left" style={cs(9)}>
          {flow.isTLS ? <Lock size={12} className="text-pb-success" /> : <LockOpen size={12} className="text-pb-muted" />}
        </div>
        <div className="px-2 py-0.5 text-xs text-pb-muted text-left" style={cs(10)}>
          {edited ? '✓' : ''}
        </div>
        <div className="px-1 py-0.5 flex justify-start" style={cs(11)}>
          <button
            className="text-pb-muted hover:text-pb-text opacity-0 group-hover:opacity-100"
            title="更多操作（或右键）"
            onClick={(e) => {
              // 触发同一个 ContextMenu：合成右键事件到自身
              e.stopPropagation();
              const target = e.currentTarget.closest('[data-flow-id]') as HTMLElement | null;
              if (!target) return;
              const rect = target.getBoundingClientRect();
              target.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: rect.right - 8,
                clientY: rect.bottom - 4,
                button: 2,
              }));
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    </FlowContextMenu>
  );
}

function StatusDot({ status }: { status: Flow['status'] }) {
  const color =
    status === 'completed' ? 'bg-pb-success'
    : status === 'streaming' ? 'bg-pb-accent animate-pulse'
    : status === 'error' ? 'bg-pb-error'
    : 'bg-pb-muted';
  return <span className={cn('inline-block w-2 h-2 rounded-full mr-1 align-middle shrink-0', color)} />;
}
