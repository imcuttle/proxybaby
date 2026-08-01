import { useState } from 'react';
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * 可折叠 JSON tree view，每个对象/数组节点可局部复制。
 */
export function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="text-xs font-mono p-2 leading-relaxed">
      <Node k={null} value={data} depth={0} defaultOpen />
    </div>
  );
}

function Node({
  k,
  value,
  depth,
  defaultOpen,
}: {
  k: string | number | null;
  value: unknown;
  depth: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(depth < 2 || !!defaultOpen);
  const isObj = value !== null && typeof value === 'object';
  const keyLabel = k !== null ? <span className="text-pb-accent">{typeof k === 'number' ? k : `"${k}"`}</span> : null;

  if (!isObj) {
    return (
      <div className="group pl-4 flex items-baseline gap-1 hover:bg-pb-hover/40 rounded">
        <span>
          {keyLabel}
          {keyLabel && <span className="text-pb-muted">: </span>}
          <ValueLeaf value={value} />
        </span>
        <CopyBtn
          getText={() =>
            typeof value === 'string' ? value : JSON.stringify(value)
          }
          title="复制值"
        />
      </div>
    );
  }

  const entries: [string | number, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const bracket = Array.isArray(value) ? ['[', ']'] : ['{', '}'];

  return (
    <div className="pl-2">
      <div className="group flex items-start gap-1 hover:bg-pb-hover/40 rounded">
        <button className="mt-0.5 text-pb-muted" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <div className="flex-1">
          {keyLabel}
          {keyLabel && <span className="text-pb-muted">: </span>}
          <span className="text-pb-muted">
            {bracket[0]}
            {!open && <span className="opacity-60"> {entries.length} 项 </span>}
            {!open && bracket[1]}
          </span>
          <CopyBtn getText={() => JSON.stringify(value, null, 2)} title="复制此节点" />
          {open && (
            <>
              <div>
                {entries.map(([ck, cv]) => (
                  <Node key={String(ck)} k={ck} value={cv} depth={depth + 1} />
                ))}
              </div>
              <div className="text-pb-muted">{bracket[1]}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ValueLeaf({ value }: { value: unknown }) {
  if (typeof value === 'string') return <span className="text-pb-success break-all">"{value}"</span>;
  if (typeof value === 'number') return <span className="text-pb-warn">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-purple-400">{String(value)}</span>;
  if (value === null) return <span className="text-pb-muted">null</span>;
  return <span>{String(value)}</span>;
}

function CopyBtn({ getText, title = '复制' }: { getText: () => string; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="opacity-0 group-hover:opacity-100 ml-1 inline-flex align-middle text-pb-muted hover:text-pb-text"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(getText());
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={11} className="text-pb-success" /> : <Copy size={11} />}
    </button>
  );
}
