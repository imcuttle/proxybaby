import { useMemo, useState } from 'react';
import { Send, Copy } from 'lucide-react';
import { generateCodeFromRequest, CODE_LANGS, type CodeLang } from '../lib/code-gen';
import { MonacoView } from './MonacoView';
import { HeadersEditor } from './HeadersEditor';
import { BodyEditor } from './BodyEditor';
import type { Header } from '../../shared/types';
import { cn } from '../lib/cn';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

/**
 * Composer：手工编写 RESTful 请求并发送。
 * 结果会作为一个 flow 出现在抓包列表里（主进程通过 flow:start/end 广播）。
 */
export function ComposerView() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://httpbin.org/get');
  const [headersText, setHeadersText] = useState('Accept: application/json');
  const [bodyText, setBodyText] = useState('');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<string>('');
  const [lang, setLang] = useState<CodeLang>('curl');
  const [showCode, setShowCode] = useState(false);

  const parseHeaders = (): Header[] => {
    return headersText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const idx = l.indexOf(':');
        if (idx < 0) return { name: l, value: '' };
        return { name: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim() };
      });
  };

  // BodyEditor 根据 Content-Type 头切语言（json/xml/html/...）
  const bodyContentType = useMemo(
    () => parseHeaders().find((h) => h.name.toLowerCase() === 'content-type')?.value,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [headersText],
  );

  const send = async () => {
    setSending(true);
    try {
      const res = await window.proxybaby.composerSend({
        method,
        url,
        headers: parseHeaders(),
        bodyText: bodyText || undefined,
      });
      if (res.ok) setLastResult(`✓ 请求已发送，flow id: ${res.id}（切回“抓包”页查看）`);
      else setLastResult(`✗ 发送失败：${res.error}`);
    } finally {
      setSending(false);
    }
  };

  const code = generateCodeFromRequest({ method, url, headers: parseHeaders(), bodyText: bodyText || undefined }, lang);

  return (
    <div className="h-full flex flex-col overflow-y-auto pb-scroll" data-testid="composer-view">
      <div className="p-4 max-w-4xl space-y-3">
        <div className="text-sm font-semibold">编写请求 (Composer)</div>

        <div className="flex gap-2">
          <select
            data-testid="composer-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="pb-input px-2 py-1 text-xs"
          >
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <input
            data-testid="composer-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL"
            className="pb-input px-2 py-1 text-xs flex-1 font-mono"
          />
          <button
            data-testid="composer-send"
            onClick={send}
            disabled={sending || !url}
            className="pb-btn px-3 py-1 text-xs flex items-center gap-1"
          >
            <Send size={12} /> {sending ? '发送中…' : '发送'}
          </button>
        </div>

        <div>
          <label className="text-xs text-pb-muted">请求头（每行一个 Name: Value）</label>
          <div className="mt-1 border border-pb-border rounded overflow-hidden">
            <HeadersEditor
              testId="composer-headers"
              value={headersText}
              onChange={setHeadersText}
              height="160px"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-pb-muted">请求体</label>
          <div className="mt-1 border border-pb-border rounded overflow-hidden">
            <BodyEditor
              testId="composer-body"
              value={bodyText}
              onChange={setBodyText}
              contentType={bodyContentType}
              height="200px"
            />
          </div>
        </div>

        {lastResult && (
          <div data-testid="composer-result" className="text-xs px-2 py-1 border border-pb-border rounded bg-pb-panel">
            {lastResult}
          </div>
        )}

        <div className="border-t border-pb-border pt-3">
          <div className="flex items-center gap-2">
            <button
              data-testid="composer-toggle-code"
              className="pb-btn px-2 py-0.5 text-xs"
              onClick={() => setShowCode((v) => !v)}
            >{showCode ? '收起' : '生成代码'}</button>
            {showCode && CODE_LANGS.map((l) => (
              <button
                key={l.key}
                data-testid={`composer-lang-${l.key}`}
                onClick={() => setLang(l.key)}
                className={cn('pb-btn px-1.5 py-0.5 text-xs', lang === l.key && 'bg-pb-hover text-pb-text')}
              >{l.label}</button>
            ))}
            {showCode && (
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="pb-btn px-1.5 py-0.5 text-xs ml-auto flex items-center gap-1"
              ><Copy size={12} /> 复制</button>
            )}
          </div>
          {showCode && (
            <div data-testid="composer-code" className="mt-2 h-56 border border-pb-border rounded overflow-hidden">
              <MonacoView value={code} readOnly language={lang === 'python' ? 'python' : lang === 'go' ? 'go' : lang === 'curl' || lang === 'httpie' ? 'shell' : 'javascript'} className="h-full" height="100%" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
