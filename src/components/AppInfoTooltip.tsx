import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 悬浮显示应用/进程详细信息的通用 tooltip：
 * - 用 portal 挂在 <body>，绕开 sidebar /虚拟滚动的裁剪。
 * - hover 意图判定：离开 anchor → 短延时后关闭，允许"斜穿"进入 tooltip 本体（比如复制路径）。
 * - 靠近右边缘时右对齐，避免长文本溢出。
 *
 * 使用者传入 `children` 作为锚点（icon + name 那一小块），并提供进程字段。
 */
export interface AppInfoDetails {
  name: string;
  pid?: number;
  pids?: number[];            // Sidebar 里同名app 可能有多个 pid
  bundleId?: string;
  bundlePath?: string;
  execPath?: string;
  iconDataUrl?: string;
}

interface Props {
  info: AppInfoDetails;
  children: React.ReactNode;
  /** 传给锚点 wrapper 的 className（保持外层布局） */
  className?: string;
  /** 附加到 tooltip 元素的 data-testid，便于 e2e 断言 */
  tooltipTestId?: string;
}

export function AppInfoTooltip({ info, children, className, tooltipTestId }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number; rightAlign: boolean } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);
  // hover 意图判定：进入 anchor 后延迟 2s 才弹出，避免在 sidebar 快速滑过时刷屏。
  // 用户中途移出/点击/右键都会取消 openTimer。
  const openTimer = useRef<number | null>(null);
  const OPEN_DELAY_MS = 2000;

  const cancelClose = useCallback(() => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const cancelOpen = useCallback(() => {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
  }, []);
  const doOpen = useCallback(() => {
    cancelClose();
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 预估 tooltip 宽度：min-w-[260]，若右侧空间不足 320 则右对齐锚点右缘
    const spaceRight = window.innerWidth - r.right;
    const rightAlign = spaceRight < 320;
    setPos({ x: rightAlign ? r.right : r.left, y: r.bottom + 4, rightAlign });
  }, [cancelClose]);
  const scheduleOpen = useCallback(() => {
    cancelClose();
    cancelOpen();
  // 已经打开的情况下（比如鼠标从 tooltip 又回到 anchor），直接保持
    if (pos) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      doOpen();
    }, OPEN_DELAY_MS);
  }, [cancelClose, cancelOpen, doOpen, pos]);
  const scheduleClose = useCallback(() => {
    // 离开 anchor：既取消待开的 openTimer，也安排关闭
    cancelOpen();
    cancelClose();
    closeTimer.current = window.setTimeout(() => setPos(null), 150);
  }, [cancelClose, cancelOpen]);
  useEffect(() => () => { cancelClose(); cancelOpen(); }, [cancelClose, cancelOpen]);

  // 是否有可展示的进程信息（除了 name 本身），否则不弹（避免空tooltip）
  const hasDetails =
    !!info.bundleId ||
    !!info.bundlePath ||
    !!info.execPath ||
    (info.pids && info.pids.length > 0) ||
    typeof info.pid === 'number';

  return (
    <>
      <span
        ref={anchorRef}
  onMouseEnter={hasDetails ? scheduleOpen : undefined}
        onMouseLeave={hasDetails ? scheduleClose : undefined}
        className={className}
        data-testid="app-info-anchor"
      >
        {children}
      </span>
      {pos && hasDetails && createPortal(
        <div
          data-testid={tooltipTestId || 'app-info-tooltip'}
          className="fixed z-[9999] min-w-[260px] max-w-[520px] rounded border border-pb-border bg-pb-panel text-xs shadow-lg py-2 px-2 space-y-1 pointer-events-auto"
          style={{
            left: pos.x,
            top: pos.y,
            transform: pos.rightAlign ? 'translateX(-100%)' : undefined,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="flex items-center gap-1.5 pb-1 border-b border-pb-border/60">
            {info.iconDataUrl && (
              <img src={info.iconDataUrl} alt="" className="w-4 h-4 rounded-[22%] shrink-0" />
            )}
            <span className="font-medium text-pb-text truncate">{info.name}</span>
          </div>
          {info.bundleId && (
            <Row label="Bundle ID" value={info.bundleId} mono />
          )}
          {(typeof info.pid === 'number' || (info.pids && info.pids.length > 0)) && (
            <Row
              label="PID"
              value={
                info.pids && info.pids.length > 0
                  ? info.pids.join(', ')
                  : String(info.pid)
              }
              mono
            />
          )}
          {info.execPath && (
            <Row label="可执行文件" value={info.execPath} mono wrap />
          )}
          {info.bundlePath && (
            <Row label="Bundle 路径" value={info.bundlePath} mono wrap />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function Row({ label, value, mono, wrap }: { label: string; value: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-pb-muted shrink-0 min-w-[64px]">{label}</span>
      <span
        className={
   (mono ? 'font-mono ' : '') +
    (wrap ? 'break-all ' : 'truncate ') +
          // min-w-0 让 flex child 允许收缩到 max-w-[520px] 而不是 max-content，
          // 否则长路径会把整个 tooltip 撑破。
          'min-w-0 flex-1 text-pb-text'
        }
      >
        {value}
    </span>
    </div>
  );
}
