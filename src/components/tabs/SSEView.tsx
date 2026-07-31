import type { SSEFrame } from '../../../shared/types';
import { formatTime } from '../../lib/format';

export function SSEView({ frames }: { frames: SSEFrame[] }) {
  if (!frames.length) return <div className="p-4 text-xs text-pb-muted">等待事件流…</div>;
  return (
    <div className="p-2 space-y-1.5">
      {frames.map((f, i) => (
        <div key={i} className="border border-pb-border/40 rounded overflow-hidden">
          <div className="flex items-center gap-2 px-2 py-0.5 text-xs bg-pb-panel">
            <span className="text-pb-muted font-mono">{formatTime(f.receivedAt)}</span>
            {f.event && <span className="text-pb-accent">event: {f.event}</span>}
            {f.id && <span className="text-pb-muted">id: {f.id}</span>}
          </div>
          <pre className="p-2 text-xs font-mono whitespace-pre-wrap break-all">{f.data}</pre>
        </div>
      ))}
    </div>
  );
}
