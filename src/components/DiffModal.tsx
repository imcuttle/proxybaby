import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { DiffEditor } from '@monaco-editor/react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import type { Flow } from '../../shared/types';
// 引入一次 MonacoView 以触发 Monaco worker / 主题的初始化（DiffEditor 与它共用同一实例）
import './MonacoView';

type Section = 'req-headers' | 'resp-headers' | 'req-body' | 'resp-body';

const SECTIONS: { key: Section; title: string; lang: (f: Flow | null) => string }[] = [
  { key: 'req-headers', title: '请求头', lang: () => 'http' },
  { key: 'resp-headers', title: '响应头', lang: () => 'http' },
  { key: 'req-body', title: '请求体', lang: guessBodyLang },
  { key: 'resp-body', title: '响应体', lang: guessBodyLang },
];

function guessBodyLang(f: Flow | null): string {
  const ct = ((f as any)?.response?.contentType || (f as any)?.request?.contentType || '').toLowerCase();
  if (/json/.test(ct)) return 'json';
  if (/xml/.test(ct)) return 'xml';
  if (/html/.test(ct)) return 'html';
  if (/javascript|ecmascript/.test(ct)) return 'javascript';
  if (/typescript/.test(ct)) return 'typescript';
  if (/css/.test(ct)) return 'css';
  if (/yaml|yml/.test(ct)) return 'yaml';
  if (/graphql/.test(ct)) return 'graphql';
  return 'plaintext';
}

/**
 * 左右分栏 Diff（Monaco DiffEditor，风格与 VS Code 一致）。
 *
 * 约定：
 * - `left` = base（右键触发的那一条 flow）
 * - `right` = 对比对象（另一条选中的 flow）
 * - 顶部 Tab 切换：请求头 / 响应头 / 请求体 / 响应体
 */
export function DiffModal({
  open,
  onClose,
  left,
  right,
  embedded,
}: {
  open: boolean;
  onClose: () => void;
  left: Flow | null;
  right: Flow | null;
  embedded?: boolean;
}) {
  const [section, setSection] = useState<Section>('req-headers');
  const canDiff = !!left && !!right;

  const buildText = (f: Flow | null, part: Section): string => {
    if (!f) return '';
    if (part === 'req-headers') return f.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n');
    if (part === 'resp-headers') return (f.response?.headers || []).map((h) => `${h.name}: ${h.value}`).join('\n');
    if (part === 'req-body') return f.request.bodyText || '';
    return f.response?.bodyText || '';
  };

  const currentDef = SECTIONS.find((s) => s.key === section)!;
  const originalText = useMemo(() => buildText(left, section), [left, section]);
  const modifiedText = useMemo(() => buildText(right, section), [right, section]);
  const language = useMemo(() => {
    if (section === 'req-body' || section === 'resp-body') {
      // 两侧 body 各自的 content-type 若不一致，以 base（left）优先
      return currentDef.lang(left) || currentDef.lang(right);
    }
    return currentDef.lang(left);
  }, [section, left, right, currentDef]);

  const body = (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="diff-body">
      {/* 分区 Tab */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-pb-border/60 text-xs">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            data-testid={`diff-tab-${s.key}`}
            onClick={() => setSection(s.key)}
            className={cn(
              'px-2 py-0.5 rounded',
              section === s.key
                ? 'bg-pb-selected text-white'
                : 'text-pb-muted hover:bg-pb-hover',
            )}
          >
            {s.title}
          </button>
        ))}
        <div className="ml-auto text-pb-muted flex items-center gap-3">
          <span><span className="text-pb-accent">◼</span> Base</span>
          <span><span className="text-pb-success">◼</span> 对比</span>
        </div>
      </div>

      {/* 双列标题 */}
      <div className="shrink-0 grid grid-cols-2 text-[11px] border-b border-pb-border/60 bg-pb-panel/40">
        <div className="px-3 py-1 border-r border-pb-border/60 truncate">
          <span className="text-pb-accent mr-1">Base</span>
          <span className="text-pb-muted font-mono truncate">
            {left ? `${left.request.method} ${left.request.url}` : '—'}
          </span>
        </div>
        <div className="px-3 py-1 truncate">
          <span className="text-pb-success mr-1">对比</span>
          <span className="text-pb-muted font-mono truncate">
            {right ? `${right.request.method} ${right.request.url}` : '—'}
          </span>
        </div>
      </div>

      {/* Monaco DiffEditor */}
      {canDiff ? (
        <div
          className="flex-1 min-h-0"
          data-testid={`diff-section-${section}`}
        >
          <DiffEditor
            original={originalText}
            modified={modifiedText}
            language={language}
            theme="proxybaby-dark"
            height="100%"
            options={{
              readOnly: true,
              renderSideBySide: true,
              fontSize: 12,
              fontFamily: 'ui-monospace, Menlo, Monaco, "SF Mono", monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'on',
              renderWhitespace: 'boundary',
              ignoreTrimWhitespace: false,
              renderIndicators: true,
              unicodeHighlight: {
                ambiguousCharacters: false,
                invisibleCharacters: false,
                nonBasicASCII: false,
              },
            }}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-pb-muted">
          请选择两个请求（Cmd + 点击 后 右键 → Diff）再打开。
        </div>
      )}
    </div>
  );

  if (embedded) {
    // 独立子窗口下，直接把内容渲染在窗口容器里（不再包 Dialog）
    return <div data-testid="diff-embedded" className="flex flex-col h-full">{body}</div>;
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
        <Dialog.Content
          data-testid="diff-modal"
          className="fixed inset-4 z-50 flex flex-col bg-pb-bg border border-pb-border rounded shadow-xl"
        >
          <div className="flex items-center gap-2 border-b border-pb-border px-3 py-2">
            <div className="text-sm font-semibold">Diff</div>
            <div className="ml-2 text-xs text-pb-muted truncate flex-1">
              {left ? `Base: ${left.request.method} ${left.request.url}` : 'Base: —'}
              {' '}·{' '}
              {right ? `对比: ${right.request.method} ${right.request.url}` : '对比: —'}
            </div>
            <button className="pb-btn px-1.5 py-0.5" onClick={onClose} data-testid="diff-close"><X size={12} /></button>
          </div>
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
