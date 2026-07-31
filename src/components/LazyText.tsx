import { useEffect, useRef, useState } from 'react';

/**
 * 大文本滚动懒加载渲染：初始只渲染前 CHUNK 字符，滚动接近底部时增量追加，
 * 避免一次性渲染超大字符串导致主线程卡顿。
 */
const CHUNK = 64 * 1024;

export function LazyText({ text, className }: { text: string; className?: string }) {
  const [limit, setLimit] = useState(Math.min(CHUNK, text.length));
  const ref = useRef<HTMLDivElement>(null);

  // 文本变化（切换请求）时重置
  useEffect(() => {
    setLimit(Math.min(CHUNK, text.length));
    if (ref.current) ref.current.scrollTop = 0;
  }, [text]);

  const onScroll = () => {
    const el = ref.current;
    if (!el || limit >= text.length) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 400;
    if (nearBottom) {
      // 用 rAF 让本次滚动先完成再扩容，滚动更顺
      requestAnimationFrame(() => setLimit((l) => Math.min(l + CHUNK, text.length)));
    }
  };

  const shown = limit >= text.length ? text : text.slice(0, limit);
  const remaining = text.length - limit;

  return (
    <div ref={ref} onScroll={onScroll} className={className ?? 'h-full overflow-auto pb-scroll'}>
      <pre className="text-xs font-mono p-3 whitespace-pre-wrap break-all">{shown}</pre>
      {remaining > 0 && (
        <div className="px-3 pb-3 text-xs text-pb-muted">
          继续滚动加载更多…（剩余 {fmt(remaining)}）
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
