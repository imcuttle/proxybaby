import { useEffect, useState } from 'react';
import { useFlowStore } from '../store/flows';
import type { Header } from '../../shared/types';

/**
 * 断点编辑弹窗：命中 breakpoint 规则时弹出，可编辑 headers/body（响应阶段还可改状态码），
 * 提交后继续或中止请求。
 */
export function BreakpointModal() {
  const bp = useFlowStore((s) => s.activeBreakpoint);
  const setBreakpoint = useFlowStore((s) => s.setBreakpoint);

  const [headersText, setHeadersText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [status, setStatus] = useState<number | ''>('');

  useEffect(() => {
    if (!bp) return;
    const src = bp.stage === 'response' ? bp.response : bp.request;
    const headers = src?.headers || [];
    setHeadersText(headers.map((h) => `${h.name}: ${h.value}`).join('\n'));
    setBodyText((src as any)?.bodyText || '');
    setStatus(bp.stage === 'response' ? bp.response?.status ?? '' : '');
  }, [bp]);

  if (!bp) return null;

  const parseHeaders = (): Header[] =>
    headersText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const idx = l.indexOf(':');
        return idx >= 0
          ? { name: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim() }
          : { name: l, value: '' };
      });

  const cont = () => {
    window.proxybaby.breakpointResume({
      id: bp.id,
      stage: bp.stage,
      action: 'continue',
      headers: parseHeaders(),
      bodyText,
      status: bp.stage === 'response' && status !== '' ? Number(status) : undefined,
    });
    setBreakpoint(null);
  };
  const abort = () => {
    window.proxybaby.breakpointResume({ id: bp.id, stage: bp.stage, action: 'abort' });
    setBreakpoint(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[720px] max-h-[80vh] flex flex-col rounded-lg border border-pb-border bg-pb-panel shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-pb-border">
          <span className="text-pb-warn">● 断点</span>
          <span className="text-sm">
            {bp.stage === 'request' ? '请求已暂停' : '响应已暂停'} —— {bp.request.method} {bp.request.url}
          </span>
        </div>
        <div className="flex-1 overflow-auto pb-scroll p-4 space-y-3">
          {bp.stage === 'response' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-pb-muted w-16">状态码</label>
              <input
                className="pb-input w-24"
                value={status}
                onChange={(e) => setStatus(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>
          )}
          <div>
            <label className="text-xs text-pb-muted">Headers（每行 name: value）</label>
            <textarea
              className="w-full h-40 bg-pb-bg border border-pb-border rounded p-2 font-mono text-xs mt-1 pb-scroll"
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div>
            <label className="text-xs text-pb-muted">Body</label>
            <textarea
              className="w-full h-40 bg-pb-bg border border-pb-border rounded p-2 font-mono text-xs mt-1 pb-scroll"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-pb-border">
          <button className="pb-btn text-pb-error" onClick={abort}>中止</button>
          <button className="pb-btn bg-pb-accent text-white px-4" onClick={cont}>继续</button>
        </div>
      </div>
    </div>
  );
}
