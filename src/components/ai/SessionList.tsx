import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, X, Edit2, MoreHorizontal } from 'lucide-react';
import { useAiStore } from '../../store/ai';
import type { AiSessionMeta } from '../../../shared/types';

export function SessionList() {
  const sessions = useAiStore((s) => s.sessions);
  const currentId = useAiStore((s) => s.currentId);
  const setSessions = useAiStore((s) => s.setSessions);
  const setCurrent = useAiStore((s) => s.setCurrent);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [visibleCount, setVisibleCount] = useState(sessions.length);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    const list = await window.proxybaby.aiListSessions();
    setSessions(list);
    const cur = await window.proxybaby.aiGetCurrent();
    setCurrent(cur);
  };

  const createNew = async () => {
    const s = await window.proxybaby.aiCreateSession();
    if (s) { setCurrent(s.id); await refresh(); }
  };
  const switchTo = async (id: string) => {
    await window.proxybaby.aiSwitchSession(id);
    setCurrent(id);
    setOverflowOpen(false);
  };
  const del = async (id: string) => {
    await window.proxybaby.aiDeleteSession(id);
    await refresh();
  };
  const commitRename = async (id: string) => {
    if (draft.trim()) await window.proxybaby.aiRenameSession(id, draft.trim());
    setEditing(null); setDraft('');
    await refresh();
  };

  // 计算能塞下多少条：先把所有 item 渲成隐藏度量，再按容器宽度截断
  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const items = itemsRef.current;
      if (!container || !items) return;
      // 预留：新建按钮 32 + 「...」按钮 32 + gaps
      const RESERVED = 80;
      const available = container.clientWidth - RESERVED;
      const children = Array.from(items.children) as HTMLElement[];
      let total = 0;
      let fit = 0;
      for (const child of children) {
        total += child.getBoundingClientRect().width + 4;
        if (total <= available) fit++;
        else break;
      }
      setVisibleCount(Math.max(1, fit));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [sessions]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-testid="ai-overflow-menu"]') && !t.closest('[data-testid="ai-overflow-toggle"]')) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const visible = sessions.slice(0, visibleCount);
  const overflow = sessions.slice(visibleCount);

  // 若当前会话被挤到 overflow 里，把它换到 visible 末尾（保证选中项总能看见）
  const displayed: AiSessionMeta[] = (() => {
    if (!currentId) return visible;
    if (visible.some((s) => s.id === currentId)) return visible;
    const cur = overflow.find((s) => s.id === currentId);
    if (!cur) return visible;
    return [...visible.slice(0, -1), cur];
  })();
  const displayedIds = new Set(displayed.map((s) => s.id));
  const overflowFinal = sessions.filter((s) => !displayedIds.has(s.id));

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1 border-b border-pb-border bg-pb-panel px-2 py-1"
      data-testid="ai-session-list"
    >
      <button
        onClick={createNew}
        title="新建会话"
        data-testid="ai-new-session"
        className="pb-btn text-xs shrink-0"
      >
        <Plus size={14} />
      </button>
      <div ref={itemsRef} className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
        {sessions.length === 0 && (
          <div className="text-[10px] text-pb-muted px-1">尚无会话</div>
        )}
        {displayed.map((s) => (
          <SessionChip
            key={s.id}
            s={s}
            active={currentId === s.id}
            editing={editing === s.id}
            draft={draft}
            setDraft={setDraft}
            onClick={() => editing === s.id ? undefined : switchTo(s.id)}
            onEdit={() => { setEditing(s.id); setDraft(s.title); }}
            onCommit={() => commitRename(s.id)}
            onCancel={() => { setEditing(null); setDraft(''); }}
            onDelete={() => del(s.id)}
          />
        ))}
      </div>
      {overflowFinal.length > 0 && (
        <div className="relative shrink-0">
          <button
            data-testid="ai-overflow-toggle"
            title={`更多会话 (${overflowFinal.length})`}
            onClick={() => setOverflowOpen((v) => !v)}
            className="pb-btn text-xs"
          >
            <MoreHorizontal size={14} />
            <span className="ml-1">{overflowFinal.length}</span>
          </button>
          {overflowOpen && (
            <div
              data-testid="ai-overflow-menu"
              className="absolute right-0 top-full z-20 mt-1 min-w-[220px] max-h-72 overflow-auto rounded border border-pb-border bg-pb-panel shadow-lg"
            >
              {overflowFinal.map((s) => (
                <div
                  key={s.id}
                  data-testid="ai-overflow-item"
                  data-session-id={s.id}
                  data-active={currentId === s.id ? 'true' : 'false'}
                  className={`group flex items-center gap-2 px-2 py-1 text-xs cursor-pointer ${currentId === s.id ? 'bg-pb-selected/40 text-white' : 'text-pb-fg hover:bg-pb-hover'}`}
                  onClick={() => switchTo(s.id)}
                >
                  <span className="flex-1 truncate">{s.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); del(s.id); }}
                    className="opacity-0 group-hover:opacity-100"
                    title="删除"
                  ><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionChip({
  s, active, editing, draft, setDraft, onClick, onEdit, onCommit, onCancel, onDelete,
}: {
  s: AiSessionMeta; active: boolean; editing: boolean; draft: string;
  setDraft(v: string): void;
  onClick(): void; onEdit(): void; onCommit(): void; onCancel(): void; onDelete(): void;
}) {
  return (
    <div
      data-testid="ai-session-item"
      data-session-id={s.id}
      data-active={active ? 'true' : 'false'}
      className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs cursor-pointer ${active ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover'}`}
      onClick={onClick}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel(); }}
          className="bg-transparent outline-none border-b border-pb-border text-xs w-24"
        />
      ) : (
        <span className="max-w-[120px] truncate">{s.title}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="opacity-60 hover:opacity-100"
        title="重命名"
      ><Edit2 size={10} /></button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-60 hover:opacity-100"
        title="删除"
      ><X size={12} /></button>
    </div>
  );
}
