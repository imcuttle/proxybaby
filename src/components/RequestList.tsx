import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Lock, LockOpen, Pin, Bookmark, ArrowUp, ArrowDown } from 'lucide-react';
import { useFlowStore, type SortKey, type SortState } from '../store/flows';
import { matchFilter, methodColor, statusColor, isFlowActive, isFlowPinned } from '../lib/filter';
import { formatSize, formatTime, formatDuration } from '../lib/format';
import { cn } from '../lib/cn';
import type { Flow } from '../../shared/types';
import { FlowContextMenu } from './FlowContextMenu';
import { AppInfoTooltip } from './AppInfoTooltip';

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
  { key: 'edited', label: '已编辑', width: 52, sortKey: 'edited', resizable: true },
  { key: 'note', label: '备注', width: 60, sortKey: 'note', resizable: true },
];

// 表头与数据行共用同一列宽定义，保证对齐
function colStyle(c: Column, override?: number): React.CSSProperties {
  if (c.flex) return { flex: '1 1 auto', minWidth: 0 };
  const w = override ?? c.width;
  return { width: w, flexShrink: 0 };
}

function isFlowEdited(f: Flow): boolean {
  return !!f.edited || (f.matchedRules?.length ?? 0) > 0;
}

function compareFlows(a: Flow, b: Flow, key: SortKey, noteById: Record<string, string>): number {
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
    case 'edited': {
      // 首次点击（asc）把「已编辑」置顶；再次点击（desc）置底；第三次取消
      const av = isFlowEdited(a) ? 1 : 0;
      const bv = isFlowEdited(b) ? 1 : 0;
      return bv - av;
    }
    case 'note': {
      // 空备注视为最小；有备注按字符串比较
      const an = noteById[a.id] ?? a.note ?? '';
      const bn = noteById[b.id] ?? b.note ?? '';
      if (!an && !bn) return 0;
      if (!an) return -1;
      if (!bn) return 1;
      return an.localeCompare(bn);
    }
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
      arr.sort((a, b) => compareFlows(a, b, sort.key, noteById));
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
  }, [filtered, sort, pinnedIds, pinnedHosts, pinnedPaths, noteById]);

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

  const ROW_SIZE = 26;
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_SIZE,
    overscan: 20,
  });

  // 抑制"顶部插入新行导致 viewport 抖动"：
  // 默认排序 index desc → 新抓包会插到列表最上面，所有已有行 index+1，
  // translateY 全部下移 ROW_SIZE 而 scrollTop 不变，用户看的行就"往下溜"一格。
  // 做法：在 orderedIds 变化时，找视口顶部锚点行在新列表中的新位置，
  // 用 delta * ROW_SIZE 补偿 scrollTop，让锚点行保持在原来的像素位置。
  //仅当用户不在顶部（scrollTop > 0）时补偿；若锚点已被从列表移除则不补偿。
  const prevOrderedIdsRef = useRef<string[]>(orderedIds);
  useEffect(() => {
    const prev = prevOrderedIdsRef.current;
    prevOrderedIdsRef.current = orderedIds;
    const el = parentRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    //顶部：新条目本来就该露出来，不需要补偿
    if (scrollTop <= 0) return;
    // 只在长度变大（新增）时补偿，删除/排序切换等场景交给用户手动
    if (orderedIds.length <= prev.length) return;
    // 找视口顶部当前可见的锚点行（在旧列表里的 index）
    const anchorOldIdx = Math.floor(scrollTop / ROW_SIZE);
    const anchorId = prev[anchorOldIdx];
    if (!anchorId) return;
    const anchorNewIdx = orderedIds.indexOf(anchorId);
    if (anchorNewIdx < 0) return;
    const delta = anchorNewIdx - anchorOldIdx;
    if (delta === 0) return;
    // 立即（同步）修正 scrollTop，避免下一帧渲染出现视觉跳动
    el.scrollTop = scrollTop + delta * ROW_SIZE;
  }, [orderedIds]);

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
        {COLUMNS.map((c, idx) => (
          <HeaderCell
            key={c.key}
            col={c}
            width={columnWidths[c.key]}
            sort={sort}
            isLast={idx === COLUMNS.length - 1}
            onSortClick={c.sortKey ? () => cycleSort(c.sortKey!) : undefined}
            onResize={c.resizable && !c.flex ? (w) => setColumnWidth(c.key, w) : undefined}
          />
        ))}
      </div>
      <div ref={parentRef} data-testid="flow-list-scroller" className="flex-1 overflow-y-scroll overflow-x-hidden pb-scroll">
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
                note={noteById[flow.id] ?? flow.note}
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
  isLast,
  onSortClick,
  onResize,
}: {
  col: Column;
  width?: number;
  sort: SortState | null;
  isLast?: boolean;
  onSortClick?: () => void;
  onResize?: (width: number) => void;
}) {
  const active = sort && col.sortKey && sort.key === col.sortKey;
  const startResize = useCallback(
    (fromLeft: boolean) => (e: React.MouseEvent) => {
      if (!onResize) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = width ?? col.width ?? 80;
      // 左边界handle：向右拖 = 缩窄；右边界 handle：向右拖 = 增宽
      const sign = fromLeft ? -1 : 1;
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
    [onResize, width, col.width],
  );
  const pxCls = col.key === 'url' ? 'px-1' : 'px-2';
  return (
    <div
      className={cn(
        // 列间竖分隔线：与 Proxyman 一致（最后一列不加，避免贴到滚动条边）
        'relative py-1 truncate flex items-center justify-start gap-1 text-left',
        !isLast && 'border-r border-pb-border',
        pxCls,
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
        <>
          {/* 主handle：默认在右边；resizeFromLeft列（如客户端）主handle 在左边 */}
          <span
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startResize(!!col.resizeFromLeft)}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'absolute top-0 h-full w-1.5 cursor-col-resize hover:bg-pb-accent/40',
              col.resizeFromLeft ? 'left-0 -ml-0.5' : 'right-0 -mr-0.5',
            )}
          />
          {/* resizeFromLeft 列同时也提供右边界 handle，
              避免客户端 ↔ 方法 之间的列缝没有可拖动区域 */}
          {col.resizeFromLeft && (
            <span
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startResize(false)}
              onClick={(e) => e.stopPropagation()}
              className="absolute top-0 h-full w-1.5 cursor-col-resize hover:bg-pb-accent/40 right-0 -mr-0.5"
            />
          )}
        </>
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
        </div>
        <div className="px-2 py-0.5 truncate text-xs flex items-center gap-1 text-left" style={cs(2)}>
          {flow.app ? (
            <AppInfoTooltip
              info={{
                name: flow.app.name || '—',
                pid: flow.app.pid,
                bundleId: flow.app.bundleId,
                bundlePath: flow.app.bundlePath,
                execPath: flow.app.execPath,
                iconDataUrl: flow.app.iconDataUrl,
              }}
              className="flex items-center gap-1 min-w-0 max-w-full"
            >
              {flow.app.iconDataUrl && (
                <img src={flow.app.iconDataUrl} alt="" className="w-3 h-3 shrink-0 rounded-[22%]" />
              )}
              <span className="truncate">{flow.app.name || '—'}</span>
            </AppInfoTooltip>
          ) : (
            <span className="truncate">—</span>
          )}
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
        <div className="px-2 py-0.5 text-xs flex items-center justify-start text-left" style={cs(10)}>
          {edited ? (
            <MatchedRulesBadge matched={flow.matchedRules || []} />
          ) : null}
        </div>
        <div className="px-2 py-0.5 text-xs text-pb-muted truncate text-left" style={cs(11)} title={note || ''}>
          {note || ''}
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

/**
 * "已编辑" 单元格：hover 出现自定义 tooltip，展示所有命中规则；
 * 点击某条规则 → 切到规则页并 focus 到具体行。
 *
 * - 使用 portal 让 tooltip 脱离虚拟滚动裁剪。
 * - 点击行为通过 window.proxybaby.broadcast 发送 `nav:goto` + `rules:focus-line`
 *   两个事件，主窗口对应订阅器会切tab + 定位光标。
 */
function MatchedRulesBadge({
  matched,
}: {
  matched: {ruleId: string; ruleName: string; pattern: string; lineNo?: number }[];
}) {
  // 记录锚点位置 + 展开方向；translateX 用负100% 让 tooltip 右对齐 badge（避免右侧溢出被遮挡）
  const [pos, setPos] = useState<{ x: number; y: number; rightAlign: boolean } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  // 用 timer 做 hover 意图判定：离开 badge → 短暂延迟后关闭，允许鼠标"斜穿"进入 tooltip
  const closeTimer = useRef<number | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const openTooltip = useCallback(() => {
    cancelClose();
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 估算 tooltip 宽度：min-w-[220]；如果右侧空间不足 240 则右对齐 badge 的右边缘
    const spaceRight = window.innerWidth - r.right;
    const rightAlign = spaceRight < 240;
    setPos({ x: rightAlign ? r.right : r.left, y: r.bottom + 4, rightAlign });
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setPos(null), 150);
  }, [cancelClose]);
  useEffect(() => () => cancelClose(), [cancelClose]);
  const gotoRule = useCallback(async (ruleSetId: string, lineNo?: number) => {
    // 脚本类 ruleId 形如 `script:xxx`，暂不支持定位到行，跳过。
    if (ruleSetId.startsWith('script:')) return;
    const api = (window as any).proxybaby;
    if (!api?.broadcast) return;
    await api.broadcast('nav:goto', { page: 'rules' });
    await api.broadcast('rules:focus-line', { ruleSetId, lineNo: lineNo || 1 });
    setPos(null);
  }, []);
  return (
    <>
      <span
        ref={anchorRef}
        data-testid="edited-badge"
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleClose}
        onClick={(e) => { e.stopPropagation(); openTooltip(); }}
        className="inline-flex items-center justify-center px-1 rounded text-pb-accent hover:bg-pb-accent/10 cursor-help select-none"
        title=""
      >
        ✓
      </span>
      {pos && matched.length > 0 && createPortal(
        <div
          className="fixed z-[9999] min-w-[220px] max-w-[380px] rounded border border-pb-border bg-pb-panel text-xs shadow-lg py-1"
          style={{
            left: pos.x,
            top: pos.y,
            // 右对齐场景下用 translateX(-100%) 把 tooltip 从锚点右缘向左展开
            transform: pos.rightAlign ? 'translateX(-100%)' : undefined,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="px-2 py-1 text-pb-muted border-b border-pb-border/60">命中规则</div>
          {matched.map((m, i) => (
            <button
              key={`${m.ruleId}:${m.lineNo ?? i}`}
              data-testid="matched-rule-item"
              onClick={(e) => { e.stopPropagation(); gotoRule(m.ruleId, m.lineNo); }}
              className="w-full text-left px-2 py-1 hover:bg-pb-hover flex items-baseline gap-2"
              title="点击跳转到规则行"
            >
              <span className="text-pb-text shrink-0">{m.ruleName}</span>
              <span className="text-pb-muted truncate font-mono">{m.pattern}</span>
              {typeof m.lineNo === 'number' && (
                <span className="ml-auto text-pb-muted shrink-0">L{m.lineNo}</span>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
