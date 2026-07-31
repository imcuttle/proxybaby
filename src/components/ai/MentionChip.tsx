import { useFlowStore } from '../../store/flows';
import { MentionKind } from '../../lib/ai/md-slate';
import { cn } from '../../lib/cn';

interface Props { kind: MentionKind; refId: string; }

const COLORS: Record<MentionKind, string> = {
  flow:   'bg-sky-500/20 text-sky-300 border-sky-500/40',
  file:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  rule:   'bg-amber-500/20 text-amber-300 border-amber-500/40',
  plugin: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  skill:  'bg-pink-500/20 text-pink-300 border-pink-500/40',
};

const LABELS: Record<MentionKind, string> = {
  flow: '抓包', file: '文件', rule: '规则', plugin: '插件', skill: '技能',
};

export function MentionChip({ kind, refId }: Props) {
  const byId = useFlowStore((s) => s.byId);
  const flow = kind === 'flow' ? byId[refId] : null;
  let text = refId;
  if (flow) text = `${flow.request.method} ${flow.request.host}${flow.request.path}`.slice(0, 60);
  return (
    <span
      data-testid={`mention-chip-${kind}`}
      data-mention-kind={kind}
      data-mention-id={refId}
      className={cn(
        'inline-flex align-middle items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]',
        COLORS[kind],
      )}
      title={`${LABELS[kind]}: ${refId}`}
    >
      <span className="opacity-70">{LABELS[kind]}</span>
      <span className="truncate max-w-[200px]">{text}</span>
    </span>
  );
}
