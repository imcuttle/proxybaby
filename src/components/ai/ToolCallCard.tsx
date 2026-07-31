import { useState } from 'react';
import type { AiToolCall } from '../../../shared/types';
import { cn } from '../../lib/cn';

interface Props { toolCall: AiToolCall; }

export function ToolCallCard({ toolCall }: Props) {
  const [open, setOpen] = useState(false);
  const state = toolCall.state;
  return (
    <div
      data-testid="ai-tool-call"
      data-tool-name={toolCall.name}
      data-tool-state={state}
      className="my-1 rounded border border-pb-border bg-pb-panel/60"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left text-xs"
      >
        <span
          className={cn(
            'inline-flex h-2 w-2 rounded-full',
            state === 'ok' ? 'bg-emerald-400'
              : state === 'error' ? 'bg-red-400'
                : 'bg-yellow-400 animate-pulse',
          )}
        />
        <span className="font-mono text-pb-fg">{toolCall.name}</span>
        <span className="text-pb-muted">{state}</span>
      </button>
      {open && (
        <div className="border-t border-pb-border p-2 text-[11px] font-mono">
          <div className="mb-1 text-pb-muted">args:</div>
          <pre className="mb-2 whitespace-pre-wrap break-all">{JSON.stringify(toolCall.args, null, 2)}</pre>
          {toolCall.error && <div className="text-red-400">error: {toolCall.error}</div>}
          {toolCall.result !== undefined && (
            <>
              <div className="mb-1 text-pb-muted">result:</div>
              <pre className="whitespace-pre-wrap break-all">{typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
