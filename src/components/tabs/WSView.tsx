import { ArrowDown, ArrowUp, Circle } from 'lucide-react';
import type { WSMessage } from '../../../shared/types';
import { formatTime, formatSize } from '../../lib/format';
import { cn } from '../../lib/cn';

export function WSView({ messages }: { messages: WSMessage[] }) {
  if (!messages.length) return <div className="p-4 text-xs text-pb-muted">等待 WebSocket 消息…</div>;
  return (
    <div className="p-2 space-y-1">
      {messages.map((m, i) => <MessageRow key={i} m={m} />)}
    </div>
  );
}

function MessageRow({ m }: { m: WSMessage }) {
  const isSend = m.direction === 'send';
  const isControl = m.type === 'ping' || m.type === 'pong' || m.type === 'close';
  const content = m.text ?? (m.base64 ? `<binary ${formatSize(m.size)}>` : '');
  const pretty = tryPretty(content);
  return (
    <div className={cn('border rounded overflow-hidden', isSend ? 'border-pb-accent/30' : 'border-pb-success/30')}>
      <div className={cn('flex items-center gap-2 px-2 py-0.5 text-xs', isSend ? 'bg-pb-accent/10 text-pb-accent' : 'bg-pb-success/10 text-pb-success')}>
        {isControl ? <Circle size={11} /> : isSend ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
        <span className="font-medium">{isSend ? '发送' : '接收'}</span>
        <span className="text-pb-muted uppercase">{m.type}</span>
        <span className="ml-auto text-pb-muted font-mono">{formatTime(m.receivedAt)} · {formatSize(m.size)}</span>
      </div>
      {content && <pre className="p-2 text-xs font-mono whitespace-pre-wrap break-all">{pretty}</pre>}
    </div>
  );
}

function tryPretty(text: string): string {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch {}
  }
  return text;
}
