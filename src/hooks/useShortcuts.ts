import { useEffect } from 'react';
import { useFlowStore } from '../store/flows';

/**
 * 全局快捷键：
 *   ⌘F / Ctrl+F → 切换搜索栏（打开时聚焦第一个输入框）
 *   ⌘B / Ctrl+B → 同上（开/关）
 *   ESC        → 关闭搜索栏
 *   ⌘↓ / ⌘↑    → 命中列表下/上一条
 *
 * 焦点在 input/textarea/contenteditable 里的普通字符键不拦截；但 ⌘F/⌘B/ESC 仍处理，
 * 因为搜索栏本身的输入框需要用 ESC 关闭。
 */
export function useShortcuts(opts: {
  onNavigateHit?: (dir: 'next' | 'prev') => void;
}) {
  const setSearchOpen = useFlowStore((s) => s.setSearchOpen);
  const toggleSearch = useFlowStore((s) => s.toggleSearch);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' ||
        (e.target as HTMLElement | null)?.isContentEditable;

      if (mod && key === 'f') {
        e.preventDefault();
        toggleSearch();
        // 展开后聚焦
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLInputElement>('[data-testid="searchbar-input"]');
          if (el && useFlowStore.getState().searchOpen) el.focus();
        });
        return;
      }
      if (mod && key === 'b') {
        e.preventDefault();
        toggleSearch();
        return;
      }
      if (key === 'escape') {
        if (useFlowStore.getState().searchOpen) {
          e.preventDefault();
          setSearchOpen(false);
        }
        return;
      }
      if (mod && (key === 'arrowdown' || key === 'arrowup')) {
        if (isEditable && tag !== 'input') return; // textarea 里 ⌘↑↓ 有原生用途
        e.preventDefault();
        opts.onNavigateHit?.(key === 'arrowdown' ? 'next' : 'prev');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setSearchOpen, toggleSearch, opts]);
}
