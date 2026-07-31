import { useAiStore } from '../../store/ai';
import { MarkdownSlateView } from './MarkdownSlateView';
import { ToolCallCard } from './ToolCallCard';
import { cn } from '../../lib/cn';
import { useEffect, useMemo, useRef } from 'react';
import type { AiMessage } from '../../../shared/types';

const EMPTY: AiMessage[] = [];

export function MessageList() {
  const currentId = useAiStore((s) => s.currentId);
  const liveMessages = useAiStore((s) => s.liveMessages);
  const streaming = useAiStore((s) => s.streaming);
  const messages = useMemo(
    () => (currentId ? liveMessages[currentId] || EMPTY : EMPTY),
    [currentId, liveMessages],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-auto pb-scroll p-3 space-y-3"
      data-testid="ai-message-list"
    >
      {messages.length === 0 && (
        <div className="text-center text-xs text-pb-muted mt-8">
          输入你的问题，或用 @ 引用当前抓包/规则/插件
        </div>
      )}
      {messages.map((m) => {
        const isUser = m.role === 'user';
        return (
          <div
            key={m.id}
            data-testid="ai-message"
            data-role={m.role}
            className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-1.5 text-sm break-words',
                isUser
                  ? 'bg-pb-accent text-white rounded-tr-sm'
                  : m.role === 'assistant'
                    ? 'bg-pb-hover text-pb-fg rounded-tl-sm'
                    : 'bg-pb-panel text-pb-muted',
              )}
            >
              {m.content && <MarkdownSlateView markdown={m.content} />}
              {m.toolCalls?.map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
              {!m.content && !m.toolCalls?.length && m.role === 'assistant' && (
                <span className="inline-block h-4 w-1 align-middle bg-pb-fg/60 animate-pulse" />
              )}
            </div>
          </div>
        );
      })}
      {streaming && (
        <div data-testid="ai-streaming" className="text-xs text-pb-muted italic px-2">正在生成…</div>
      )}
    </div>
  );
}
