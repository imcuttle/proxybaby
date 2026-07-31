import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import type { PluginSummary } from '../../shared/types';
import { getPluginDoc } from '../data/plugin-docs';
import { cn } from '../lib/cn';

/**
 * 插件详情 modal：展示对应插件的 README（Markdown）。
 * 若 `plugin-docs.ts` 中没有该插件的文档，则回退到显示 description。
 */
export function PluginDocModal({
  plugin,
  onClose,
}: {
  plugin: PluginSummary;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doc = getPluginDoc(plugin.id);
  const body = doc ?? `# ${plugin.name}\n\n${plugin.description ?? '暂无说明。'}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-pb-panel border border-pb-border rounded-md w-[760px] max-w-full max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-pb-border shrink-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'inline-block w-2 h-2 rounded-full',
              plugin.enabled ? 'bg-pb-success' : 'bg-pb-muted',
            )} />
            <span className="text-sm text-pb-text">{plugin.name}</span>
            <span className="text-[11px] text-pb-muted font-mono">#{plugin.id}</span>
          </div>
          <button
            onClick={onClose}
            className="text-pb-muted hover:text-pb-text"
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto pb-scroll px-6 py-4 text-sm text-pb-text leading-relaxed">
          <div className="pb-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {body}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
