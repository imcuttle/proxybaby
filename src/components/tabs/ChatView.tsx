/**
 * AI Chat 美化视图 —— 全程流式渲染。
 *
 * 每次父组件重渲染（因为 store 中 flow 增量更新）都会重新调用 parseSession，
 * 由于 parse 逻辑幂等，输出的 ChatSession 内容会自然增长，UI 直接展示即完成
 * 「打字机式流式效果」。
 */
import { useMemo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Bot, User, Cog, Wrench, Brain, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { parseSession, type Provider } from '../../parsers';
import type { ChatMessage, ChatToolCall, ChatToolDefinition, Flow } from '../../../shared/types';
import { JsonTree } from '../JsonTree';

export function ChatView({ flow, provider, side = 'both' }: { flow: Flow; provider: Provider; side?: 'request' | 'response' | 'both' }) {
  const session = useMemo(() => parseSession(flow, provider), [flow, provider]);
  // 用户显式切换过的消息（true=折叠 / false=展开）。未记录的消息走默认规则。
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // 按 source 分区：请求侧（输入 = 历史 + system + user 的最新一轮）与响应侧（模型输出）。
  // 兼容旧数据：没有 source 字段时，assistant 视作响应，其余视作请求。
  const { inputMessages, outputMessages } = useMemo(() => {
    const inp: ChatMessage[] = [];
    const out: ChatMessage[] = [];
    for (const m of session.messages) {
      const isResponse = m.source === 'response' || (m.source == null && m.role === 'assistant');
      (isResponse ? out : inp).push(m);
    }
    return { inputMessages: inp, outputMessages: out };
  }, [session.messages]);

  const totalIn = inputMessages.length;
  const totalOut = outputMessages.length;

  // 默认规则（每列独立）：≤ 阈值全部展开；否则只展开该列最后 KEEP_OPEN 条。
  const AUTO_COLLAPSE_THRESHOLD = 6;
  const KEEP_OPEN = 2;
  const isCollapsed = useCallback(
    (id: string, index: number, listTotal: number) => {
      const dflt = listTotal > AUTO_COLLAPSE_THRESHOLD && index < listTotal - KEEP_OPEN;
      return overrides[id] ?? dflt;
    },
    [overrides],
  );
  const toggleOne = useCallback(
    (id: string, index: number, listTotal: number) => {
      setOverrides((prev) => {
        const dflt = listTotal > AUTO_COLLAPSE_THRESHOLD && index < listTotal - KEEP_OPEN;
        const current = prev[id] ?? dflt;
        return { ...prev, [id]: !current };
      });
    },
    [],
  );
  const collapseAll = useCallback(() => {
    setOverrides(Object.fromEntries(session.messages.map((m) => [m.id, true])));
  }, [session.messages]);
  const expandAll = useCallback(() => {
    setOverrides(Object.fromEntries(session.messages.map((m) => [m.id, false])));
  }, [session.messages]);
  const anyCollapsed = session.messages.some((m, i) => {
    const list = m.source === 'response' || (m.source == null && m.role === 'assistant')
      ? outputMessages : inputMessages;
    const idx = list.indexOf(m);
    return isCollapsed(m.id, idx, list.length);
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶部固定：会话元信息 + 工具面板 + 折叠/展开控制 */}
      <div className="shrink-0 border-b border-pb-border/50 p-3 space-y-2">
        <SessionMeta session={session} />
        {session.tools && session.tools.length > 0 && (
          <ToolsPanel tools={session.tools} />
        )}
        {(totalIn + totalOut) > 0 && (
          <div className="flex items-center gap-2 text-xs text-pb-muted">
            <button
              className="px-2 py-0.5 border border-pb-border/50 rounded hover:bg-pb-hover hover:text-pb-text"
              onClick={anyCollapsed ? expandAll : collapseAll}
            >
              {anyCollapsed ? '全部展开' : '全部折叠'}
            </button>
            <span>请求 {totalIn} · 响应 {totalOut}</span>
            {(totalIn > AUTO_COLLAPSE_THRESHOLD || totalOut > AUTO_COLLAPSE_THRESHOLD) && (
              <span className="text-pb-muted/70">（默认折叠早期消息）</span>
            )}
          </div>
        )}
      </div>

      {/* 主体：两列独立滚动。中间一根细分隔线。side 用于让 Request/Response 分栏各自内嵌本视图。 */}
      <div className={cn('flex-1 min-h-0 grid', side === 'both' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}>
        {side !== 'response' && (
          <ChatColumn
            title="输入（请求）"
            hint="发送给模型的 messages"
            accent="text-pb-accent"
            messages={inputMessages}
            isCollapsed={isCollapsed}
            onToggle={toggleOne}
            className={side === 'both' ? 'lg:border-r border-pb-border/50' : ''}
          />
        )}
        {side !== 'request' && (
          <ChatColumn
            title="输出（响应）"
            hint={session.streaming ? '● 流式接收中…' : '模型返回'}
            accent="text-pb-success"
            streamingHint={session.streaming}
            messages={outputMessages}
            isCollapsed={isCollapsed}
            onToggle={toggleOne}
          />
        )}
      </div>

      {!session.messages.length && (
        <div className="shrink-0 text-xs text-pb-muted p-3">等待消息…</div>
      )}
    </div>
  );
}

function ChatColumn({
  title,
  hint,
  accent,
  streamingHint,
  messages,
  isCollapsed,
  onToggle,
  className,
}: {
  title: string;
  hint?: string;
  accent: string;
  streamingHint?: boolean;
  messages: ChatMessage[];
  isCollapsed: (id: string, index: number, listTotal: number) => boolean;
  onToggle: (id: string, index: number, listTotal: number) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col min-w-0 min-h-0 h-full', className)}>
      {/* 列头（不滚动） */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-pb-border/60 bg-pb-panel/40">
        <span className={cn('text-xs uppercase tracking-wide font-medium', accent)}>{title}</span>
        {hint && (
          <span className={cn('text-xs text-pb-muted', streamingHint && 'text-pb-accent animate-pulse')}>
            {hint}
          </span>
        )}
      </div>
      {/* 列内容（独立滚动） */}
      <div className="flex-1 min-h-0 overflow-auto pb-scroll px-3 py-2">
        {messages.length === 0 ? (
          <div className="text-xs text-pb-muted italic px-1 py-4">暂无</div>
        ) : (
          <div className="space-y-2">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                collapsed={isCollapsed(m.id, i, messages.length)}
                onToggle={() => onToggle(m.id, i, messages.length)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionMeta({ session }: { session: ReturnType<typeof parseSession> }) {
  if (!session.model && !session.usage && session.temperature === undefined && !session.provider) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-pb-muted border border-pb-border/40 rounded px-2 py-1">
      {session.provider !== 'unknown' && (
        <span className="text-pb-accent uppercase">{session.provider}</span>
      )}
      {session.model && <span>模型: <span className="text-pb-text">{session.model}</span></span>}
      {session.temperature !== undefined && <span>温度: {session.temperature}</span>}
      {session.usage && (
        <span>
          tokens: {session.usage.promptTokens ?? '?'} + {session.usage.completionTokens ?? '?'} = {session.usage.totalTokens ?? '?'}
        </span>
      )}
      {session.usage?.cachedTokens != null && session.usage.cachedTokens > 0 && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-pb-success/15 text-pb-success"
          title={
            session.usage.promptTokens
              ? `缓存命中率 ${Math.round((session.usage.cachedTokens / session.usage.promptTokens) * 100)}%`
              : '缓存命中'
          }
        >
          缓存 {session.usage.cachedTokens}
          {session.usage.promptTokens
            ? ` (${Math.round((session.usage.cachedTokens / session.usage.promptTokens) * 100)}%)`
            : ''}
        </span>
      )}
      {session.usage?.cacheCreationTokens != null && session.usage.cacheCreationTokens > 0 && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-pb-accent/15 text-pb-accent"
          title="本轮写入缓存的 token 数（Anthropic）"
        >
          缓存写入 {session.usage.cacheCreationTokens}
        </span>
      )}
    </div>
  );
}

function ToolsPanel({ tools }: { tools: ChatToolDefinition[] }) {
  const [open, setOpen] = useState(false);
  const [openIdx, setOpenIdx] = useState<Record<number, boolean>>({});
  return (
    <div className="border border-pb-warn/40 rounded">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-xs bg-pb-warn/10 text-pb-warn hover:brightness-110 text-left"
        aria-expanded={open}
      >
        {open
          ? <ChevronDown size={12} className="shrink-0 opacity-70" />
          : <ChevronRight size={12} className="shrink-0 opacity-70" />}
        <Wrench size={12} />
        <span className="uppercase tracking-wide font-medium">可用工具</span>
        <span className="text-pb-muted font-normal normal-case tracking-normal">
          共 {tools.length} 个{!open && '：' + tools.slice(0, 4).map((t) => t.name).join(', ') + (tools.length > 4 ? ' …' : '')}
        </span>
      </button>
      {open && (
        <div className="p-2 space-y-1">
          {tools.map((t, i) => {
            const expanded = !!openIdx[i];
            return (
              <div key={`${t.name}-${i}`} className="border border-pb-border/40 rounded">
                <button
                  type="button"
                  onClick={() => setOpenIdx((prev) => ({ ...prev, [i]: !prev[i] }))}
                  className="w-full flex items-center gap-2 px-2 py-1 text-xs text-left hover:bg-pb-hover"
                  aria-expanded={expanded}
                >
                  {expanded
                    ? <ChevronDown size={12} className="shrink-0 opacity-60" />
                    : <ChevronRight size={12} className="shrink-0 opacity-60" />}
                  <span className="font-mono text-pb-warn shrink-0">{t.name}</span>
                  {t.description && (
                    <span className="text-pb-muted truncate min-w-0 flex-1">
                      {t.description}
                    </span>
                  )}
                </button>
                {expanded && (
                  <div className="p-2 space-y-1 text-xs">
                    {t.description && (
                      <div className="text-pb-muted whitespace-pre-wrap">{t.description}</div>
                    )}
                    {t.parameters !== undefined && (
                      <div className="rounded border border-pb-border/40 bg-pb-panel/50">
                        <JsonTree data={t.parameters} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  collapsed,
  onToggle,
}: {
  message: ChatMessage;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const meta = ROLE_META[message.role];
  const preview = collapsed ? buildPreview(message) : '';
  const copyableText = [
    message.reasoning ? `<think>\n${message.reasoning}\n</think>` : '',
    message.content || '',
    ...(message.toolCalls?.map((tc) => `[Tool ${tc.name}(${tc.argumentsText || ''})]`) ?? []),
  ].filter(Boolean).join('\n\n');
  return (
    <div className={cn('group rounded border relative', meta.border)}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1 text-xs text-left',
          meta.header,
          'hover:brightness-110',
        )}
        aria-expanded={!collapsed}
      >
        {collapsed
          ? <ChevronRight size={12} className="shrink-0 opacity-70" />
          : <ChevronDown size={12} className="shrink-0 opacity-70" />}
        {meta.icon}
        <span className="uppercase tracking-wide font-medium shrink-0">{meta.title}</span>
        {message.toolName && <span className="text-pb-muted shrink-0">· {message.toolName}</span>}
        {collapsed && preview && (
          <span className="text-pb-muted truncate min-w-0 flex-1 font-normal normal-case tracking-normal">
            {preview}
          </span>
        )}
        {message.finishReason && (
          <span className="ml-auto shrink-0 text-pb-muted">finish: {message.finishReason}</span>
        )}
        {message.streaming && (
          <span className="ml-auto shrink-0 text-pb-accent animate-pulse">流式中…</span>
        )}
      </button>
      {copyableText && (
        <MessageCopyBtn text={copyableText} />
      )}
      {!collapsed && (
        <div className="p-2 space-y-2">
          {message.reasoning && (
            <details className="border border-pb-border/40 rounded px-2 py-1 bg-pb-panel/40" open>
              <summary className="text-xs text-pb-muted flex items-center gap-1 cursor-pointer">
                <Brain size={12} /> 思考过程
              </summary>
              <div className="mt-1 text-xs opacity-80">
                <MarkdownStreaming text={message.reasoning} />
              </div>
            </details>
          )}
          {message.content && (
            message.role === 'tool'
              ? <ToolResultContent text={message.content} />
              : <MarkdownStreaming text={message.content} />
          )}
          {message.toolCalls?.map((tc, i) => <ToolCallBlock key={tc.id || i} call={tc} />)}
          {!message.content && !message.toolCalls?.length && !message.reasoning && (
            <div className="text-xs text-pb-muted">（空）</div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageCopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className={cn(
        'absolute top-1 right-1 p-1 rounded text-pb-muted hover:text-pb-text hover:bg-pb-hover/60',
        'opacity-0 group-hover:opacity-100 transition-opacity',
      )}
      title="复制此条消息 Markdown"
    >
      {done ? <Check size={12} className="text-pb-success" /> : <Copy size={12} />}
    </button>
  );
}

/** 折叠时展示的一行摘要：优先 content 首行，其次 reasoning，其次 tool call 名字 */
function buildPreview(m: ChatMessage): string {
  const pick = (s?: string) =>
    s ? s.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const c = pick(m.content);
  if (c) return c;
  const r = pick(m.reasoning);
  if (r) return `[思考] ${r}`;
  if (m.toolCalls?.length) {
    return `[工具] ${m.toolCalls.map((t) => t.name || '?').join(', ')}`;
  }
  return '';
}

function ToolCallBlock({ call }: { call: ChatToolCall }) {
  // 优先解析：若 argumentsParsed 已有则直接用；否则尝试实时把 argumentsText 当 JSON 解一次
  const parsed = useMemo(() => {
    if (call.argumentsParsed !== undefined) return call.argumentsParsed;
    if (!call.argumentsText) return undefined;
    try { return JSON.parse(call.argumentsText); } catch { return undefined; }
  }, [call.argumentsParsed, call.argumentsText]);
  const [mode, setMode] = useState<'tree' | 'raw'>(parsed !== undefined ? 'tree' : 'raw');
  const argsPretty = parsed !== undefined
    ? JSON.stringify(parsed, null, 2)
    : call.argumentsText;
  return (
    <div className="border border-pb-warn/40 rounded overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 text-xs bg-pb-warn/10 text-pb-warn">
        <Wrench size={12} />
        <span className="font-medium">工具调用</span>
        <span className="text-pb-text font-mono">{call.name || '<未知>'}</span>
        {parsed !== undefined && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMode('tree')}
              className={cn(
                'rounded border border-pb-warn/40 px-1.5 py-0.5 text-[10px]',
                mode === 'tree' ? 'bg-pb-warn/30 text-pb-text' : 'text-pb-muted hover:bg-pb-hover',
              )}
            >Tree</button>
            <button
              type="button"
              onClick={() => setMode('raw')}
              className={cn(
                'rounded border border-pb-warn/40 px-1.5 py-0.5 text-[10px]',
                mode === 'raw' ? 'bg-pb-warn/30 text-pb-text' : 'text-pb-muted hover:bg-pb-hover',
              )}
            >Raw</button>
          </div>
        )}
        {parsed === undefined && (
          <span className="ml-auto text-xs text-pb-muted animate-pulse">参数流式中…</span>
        )}
      </div>
      {mode === 'tree' && parsed !== undefined
        ? <JsonTree data={parsed} />
        : <pre className="text-xs font-mono p-2 whitespace-pre-wrap break-all">{argsPretty || '{}'}</pre>
      }
    </div>
  );
}

/** tool 消息 content 若是 JSON，用 tree 展示；否则原样文本 + Tree/Raw 切换 */
function ToolResultContent({ text }: { text: string }) {
  const parsed = useMemo(() => {
    const t = text.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
    try { return JSON.parse(t); } catch { return undefined; }
  }, [text]);
  const [mode, setMode] = useState<'tree' | 'raw'>(parsed !== undefined ? 'tree' : 'raw');
  if (parsed === undefined) {
    return <pre className="text-xs font-mono p-2 whitespace-pre-wrap break-all bg-pb-panel/40 border border-pb-border/40 rounded">{text}</pre>;
  }
  return (
    <div className="border border-pb-border/40 rounded overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1 text-[10px] bg-pb-panel/60">
        <span className="text-pb-muted">Tool 返回值</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode('tree')}
            className={cn('rounded border border-pb-border/60 px-1.5 py-0.5', mode === 'tree' ? 'bg-pb-hover text-pb-text' : 'text-pb-muted hover:bg-pb-hover')}
          >Tree</button>
          <button
            type="button"
            onClick={() => setMode('raw')}
            className={cn('rounded border border-pb-border/60 px-1.5 py-0.5', mode === 'raw' ? 'bg-pb-hover text-pb-text' : 'text-pb-muted hover:bg-pb-hover')}
          >Raw</button>
        </div>
      </div>
      {mode === 'tree'
        ? <JsonTree data={parsed} />
        : <pre className="text-xs font-mono p-2 whitespace-pre-wrap break-all">{JSON.stringify(parsed, null, 2)}</pre>
      }
    </div>
  );
}

const ROLE_META: Record<ChatMessage['role'], {
  title: string;
  icon: React.ReactNode;
  header: string;
  border: string;
}> = {
  system: {
    title: 'System',
    icon: <Cog size={12} />,
    header: 'bg-pb-muted/10 text-pb-muted',
    border: 'border-pb-muted/30',
  },
  user: {
    title: 'User',
    icon: <User size={12} />,
    header: 'bg-pb-accent/10 text-pb-accent',
    border: 'border-pb-accent/30',
  },
  assistant: {
    title: 'Assistant',
    icon: <Bot size={12} />,
    header: 'bg-pb-success/10 text-pb-success',
    border: 'border-pb-success/30',
  },
  tool: {
    title: 'Tool Result',
    icon: <Wrench size={12} />,
    header: 'bg-pb-warn/10 text-pb-warn',
    border: 'border-pb-warn/30',
  },
};

/**
 * 流式 Markdown 渲染：
 * - 支持 GFM
 * - 对未闭合代码块做容错（若 ``` 数量为奇数，追加一个 ``` 让 remark 能正确渲染）
 */
function MarkdownStreaming({ text }: { text: string }) {
  const safeText = useMemo(() => {
    const fences = (text.match(/```/g) || []).length;
    return fences % 2 === 1 ? text + '\n```' : text;
  }, [text]);

  return (
    <div className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // react-markdown v9 移除了 `inline` prop —— 需要自己判断：
          // 有 language-* class 或者内容包含换行 → 认为是 fenced/block；否则是 inline。
          code({ className, children, ...props }: any) {
            const raw = String(children ?? '');
            const match = /language-(\w+)/.exec(className || '');
            const isBlock = !!match || /\n/.test(raw);
            if (!isBlock) {
              return (
                <code
                  className="bg-pb-panel/80 border border-pb-border/50 px-1 py-0.5 rounded text-[0.85em] font-mono text-pb-accent"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <SyntaxHighlighter
                language={match?.[1] || 'text'}
                style={oneDark as any}
                customStyle={{ margin: 0, borderRadius: 4, fontSize: 12 }}
                PreTag="div"
              >
                {raw.replace(/\n$/, '')}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {safeText}
      </ReactMarkdown>
    </div>
  );
}
