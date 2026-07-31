import { useMemo, useState, useEffect } from 'react';
import { Copy, Check, Download } from 'lucide-react';
import { JsonTree } from '../JsonTree';
import { LazyText } from '../LazyText';
import { cn } from '../../lib/cn';
import {
  detectBody,
  base64ToBytes,
  utf8ToBytes,
  toHexDump,
  parseFormUrlencoded,
  parseMultipart,
  parseGraphQL,
  type PreviewFormat,
} from '../../lib/body-detect';

const LARGE = 256 * 1024; // 大 body 走懒加载文本

export function BodyView({
  bodyText,
  bodyBase64,
  contentType,
  bodySize,
  urlPath,
}: {
  bodyText?: string;
  bodyBase64?: string;
  contentType?: string;
  bodySize: number;
  urlPath?: string;
}) {
  const [copied, setCopied] = useState(false);
  const ct = (contentType || '').toLowerCase();

  const kind = useMemo(
    () => detectBody({ contentType, bodyText, bodyBase64, bodySize, urlPath }),
    [contentType, bodyText, bodyBase64, bodySize, urlPath],
  );

  // 默认视图跟随内容嗅探；用户切换过后保留选择。
  const [mode, setMode] = useState<PreviewFormat>(kind.suggested);
  useEffect(() => { setMode(kind.suggested); /* 切换到别的 flow 时重置 */ /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind.suggested]);

  const download = () => {
    let blob: Blob;
    if (bodyBase64) {
      const bytes = base64ToBytes(bodyBase64);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      blob = new Blob([buf], { type: ct || 'application/octet-stream' });
    } else {
      blob = new Blob([bodyText || ''], { type: ct || 'text/plain' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proxybaby-body' + extFor(ct);
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!bodyText && bodySize === 0 && !bodyBase64) {
    return <div className="p-4 text-xs text-pb-muted" data-testid="body-empty">空 body</div>;
  }

  const copyAll = () => {
    if (!bodyText) return;
    navigator.clipboard.writeText(bodyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // 可选标签集合：来自内容嗅探，用户可切
  const supported: PreviewFormat[] = kind.supported.includes(mode) ? kind.supported : [...kind.supported, mode];

  return (
    <div data-testid="body-view">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-pb-border/50 text-xs sticky top-0 bg-pb-bg z-10">
        {supported.map((f) => (
          <button
            key={f}
            onClick={() => setMode(f)}
            data-testid={`body-fmt-${f}`}
            className={cn(
              'pb-btn px-1.5 py-0.5 flex items-center gap-1',
              mode === f && 'bg-pb-hover text-pb-text',
            )}
          >
            {LABEL[f] ?? f}
          </button>
        ))}
        <span className="text-pb-muted ml-1">{fmt(bodySize)}</span>
        {bodyText && (
          <button
            onClick={copyAll}
            className="pb-btn px-1.5 py-0.5 ml-auto flex items-center gap-1"
            title="复制全部"
          >
            {copied ? <Check size={12} className="text-pb-success" /> : <Copy size={12} />} 复制
          </button>
        )}
        <button
          onClick={download}
          className={cn('pb-btn px-1.5 py-0.5 flex items-center gap-1', !bodyText && 'ml-auto')}
          title="下载"
        >
          <Download size={12} /> 下载
        </button>
      </div>

      <PreviewBody
        mode={mode}
        bodyText={bodyText}
        bodyBase64={bodyBase64}
        contentType={ct}
      />
    </div>
  );
}

export const PREVIEW_FORMAT_LABEL: Partial<Record<PreviewFormat, string>> = {
  'json-tree': 'JSON Tree',
  json: 'JSON Raw',
  text: 'Text',
  html: 'HTML',
  css: 'CSS',
  js: 'JS',
  xml: 'XML',
  form: 'Form',
  multipart: 'Multipart',
  image: 'Image',
  hex: 'Hex',
  graphql: 'GraphQL',
};

const LABEL = PREVIEW_FORMAT_LABEL;

export function PreviewBody({
  mode,
  bodyText,
  bodyBase64,
  contentType,
}: {
  mode: PreviewFormat;
  bodyText?: string;
  bodyBase64?: string;
  contentType: string;
}) {
  if (mode === 'image') {
    const src = bodyBase64
      ? `data:${contentType || 'image/png'};base64,${bodyBase64}`
      : bodyText
        ? `data:${contentType || 'image/svg+xml'};base64,${btoa(unescape(encodeURIComponent(bodyText)))}`
        : '';
    if (!src) return <Empty />;
    return (
      <div className="p-3">
        <img
          src={src}
          alt="preview"
          data-testid="body-image"
          className="max-w-full rounded border border-pb-border"
        />
      </div>
    );
  }

  if (mode === 'hex') {
    const bytes = bodyBase64 ? base64ToBytes(bodyBase64) : bodyText ? utf8ToBytes(bodyText) : new Uint8Array();
    const dump = toHexDump(bytes);
    return <pre data-testid="body-hex" className="text-xs font-mono p-3 whitespace-pre">{dump}</pre>;
  }

  if (!bodyText) {
    return <div className="p-4 text-xs text-pb-muted">当前视图仅支持文本内容。</div>;
  }

  if (mode === 'json-tree') {
    try {
      const data = JSON.parse(bodyText);
      return <div data-testid="body-json-tree"><JsonTree data={data} /></div>;
    } catch {
      return <div className="p-4 text-xs text-pb-muted">JSON 解析失败。</div>;
    }
  }

  if (mode === 'json') {
    let pretty = bodyText;
    try { pretty = JSON.stringify(JSON.parse(bodyText), null, 2); } catch {}
    return renderPreformatted(pretty, 'body-json-raw');
  }

  if (mode === 'form') {
    const pairs = parseFormUrlencoded(bodyText);
    if (!pairs.length) return <Empty />;
    return (
      <table data-testid="body-form" className="w-full text-xs font-mono">
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i} className="border-b border-pb-border/30">
              <td className="px-2 py-1 text-pb-muted align-top w-1/3 break-all">{p.name}</td>
              <td className="px-2 py-1 break-all">{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (mode === 'multipart') {
    const items = parseMultipart(bodyText, contentType);
    if (!items.length) return <Empty />;
    return (
      <div data-testid="body-multipart" className="p-3 space-y-2">
        {items.map((it, i) => (
          <div key={i} className="border border-pb-border rounded p-2">
            <div className="text-xs text-pb-muted mb-1">
              {it.name}{it.filename ? ` · file: ${it.filename}` : ''}{it.contentType ? ` · ${it.contentType}` : ''}
            </div>
            <div className="text-xs font-mono break-all whitespace-pre-wrap">{it.value}</div>
          </div>
        ))}
      </div>
    );
  }

  if (mode === 'graphql') {
    const ops = parseGraphQL(bodyText);
    if (!ops) return <div className="p-4 text-xs text-pb-muted">未识别为 GraphQL 请求。</div>;
    return (
      <div data-testid="body-graphql" className="p-3 space-y-3">
        {ops.map((op, i) => (
          <div key={i} className="border border-pb-border rounded">
            {op.operationName && (
              <div className="px-2 py-1 bg-pb-panel text-xs text-pb-muted">
                Operation: <span className="text-pb-text font-mono">{op.operationName}</span>
              </div>
            )}
            <pre className="text-xs font-mono p-2 whitespace-pre-wrap break-all">{op.query}</pre>
            {op.variables !== undefined && (
              <div className="px-2 py-1 border-t border-pb-border text-xs text-pb-muted">
                Variables:
                <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-1">{JSON.stringify(op.variables, null, 2)}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (mode === 'html' || mode === 'css' || mode === 'js' || mode === 'xml' || mode === 'text') {
    return renderPreformatted(bodyText, `body-${mode}`);
  }

  return renderPreformatted(bodyText, 'body-text');
}

function renderPreformatted(text: string, testId?: string) {
  if (text.length > LARGE) return <LazyText text={text} className="overflow-visible" />;
  return (
    <pre data-testid={testId} className="text-xs font-mono p-3 whitespace-pre-wrap break-all">{text}</pre>
  );
}

function Empty() {
  return <div className="p-3 text-xs text-pb-muted">暂无内容</div>;
}

function fmt(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function extFor(ct: string): string {
  if (/json/.test(ct)) return '.json';
  if (/html/.test(ct)) return '.html';
  if (/javascript/.test(ct)) return '.js';
  if (/css/.test(ct)) return '.css';
  if (/png/.test(ct)) return '.png';
  if (/jpe?g/.test(ct)) return '.jpg';
  if (/gif/.test(ct)) return '.gif';
  if (/svg/.test(ct)) return '.svg';
  if (/xml/.test(ct)) return '.xml';
  if (/^text\//.test(ct)) return '.txt';
  return '.bin';
}
