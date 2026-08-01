import { useEffect } from 'react';
import { useFlowStore } from '../store/flows';

/**
 * 全局快捷键：
 *   ⌘F / Ctrl+F   → 切换搜索栏（打开时聚焦第一个输入框）
 *   ⌘B / Ctrl+B   → 同上（开/关）
 *   ESC          → 关闭搜索栏
 *   ⌘↓ / ⌘↑      → 命中列表下/上一条
 *   ⌥⌘O          → 切换系统代理开关（对齐 Proxyman）
 *   ⌥⌘R          → 切换抓包录制（暂停/继续）
 *
 * 焦点在 input/textarea/contenteditable 里的普通字符键不拦截；但 ⌘F/⌘B/ESC 仍处理，
 * 因为搜索栏本身的输入框需要用 ESC 关闭。
 */
export function useShortcuts(opts: {
  onNavigateHit?: (dir: 'next' | 'prev') => void;
}) {
  const setSearchOpen = useFlowStore((s) => s.setSearchOpen);
  const toggleSearch = useFlowStore((s) => s.toggleSearch);
  const setProxyStatus = useFlowStore((s) => s.setProxyStatus);

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
      // ⌥⌘O：开/关系统代理（对齐 Proxyman 的 Switch On/Off 快捷键）
      // 注意 macOS 上 Option 会把 e.key 转成特殊字符（如 'ø'），因此改用 e.code 判断物理键位。
      if (mod && e.altKey && e.code === 'KeyO') {
        e.preventDefault();
        const cur = useFlowStore.getState().proxyStatus;
        if (!cur) return;
        void (async () => {
          try {
            const s = await window.proxybaby.setSystemProxy(!cur.systemProxyApplied);
            if (s) setProxyStatus(s);
          } catch {}
        })();
        return;
      }
      // ⌥⌘R：开/关抓包录制
      if (mod && e.altKey && e.code === 'KeyR') {
        e.preventDefault();
        const cur = useFlowStore.getState().proxyStatus;
        if (!cur) return;
        void (async () => {
          try {
            const s = await window.proxybaby.toggleRecording(!cur.recording);
            if (s) setProxyStatus(s);
          } catch {}
        })();
        return;
      }
      if (key === 'escape') {
        if (useFlowStore.getState().searchOpen) {
          e.preventDefault();
          // 与关闭按钮保持一致：关闭时清空搜索条件
          useFlowStore.getState().setFilter({ text: '', advanced: undefined });
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
  }, [setSearchOpen, toggleSearch, setProxyStatus, opts]);
}
