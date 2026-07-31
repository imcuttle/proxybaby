import * as Tabs from '@radix-ui/react-tabs';
import { useMemo, useState } from 'react';
import { useFlowStore } from '../store/flows';
import { HeadersView } from './tabs/HeadersView';
import { BodyView, PreviewBody, PREVIEW_FORMAT_LABEL } from './tabs/BodyView';
import { SSEView } from './tabs/SSEView';
import { WSView } from './tabs/WSView';
import { ChatView } from './tabs/ChatView';
import { LazyText } from './LazyText';
import { JsonTree } from './JsonTree';
import { methodColor, statusColor } from '../lib/filter';
import { cn } from '../lib/cn';
import { detectProvider } from '../parsers';
import { generateCode, CODE_LANGS, type CodeLang } from '../lib/code-gen';
import { MonacoView, guessMonacoLanguage } from './MonacoView';
import { TabCustomizer } from './TabCustomizer';
import type { PreviewFormat } from '../lib/body-detect';
import type { Flow, Header } from '../../shared/types';

export function DetailPane() {
  const flows = useFlowStore((s) => s.flows);
  const selectedId = useFlowStore((s) => s.selectedId);
  const customTabs = useFlowStore((s) => s.customTabs);
  const flow = useMemo(() => flows.find((f) => f.id === selectedId), [flows, selectedId]);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  if (!flow) {
    return (
      <div className="h-full flex items-center justify-center text-pb-muted text-sm">
        选中一个请求以查看详情
      </div>
    );
  }

  const provider = detectProvider(flow);
  const isSSE = flow.response?.isSSE || flow.sseFrames.length > 0;
  const isWS = flow.isWebSocket || (flow.wsMessages?.length ?? 0) > 0;

  const openCustomizer = () => setCustomizerOpen(true);

  return (
    <div className="h-full flex flex-col bg-pb-bg">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-pb-border bg-pb-panel">
        <span className={cn('method-badge', methodColor(flow.request.method))}>
          {flow.request.method}
        </span>
        {flow.response && (
          <span className={cn('status-badge', statusColor(flow.response.status))}>
            {flow.response.status}
          </span>
        )}
        <span className="text-xs font-mono truncate flex-1">{flow.request.url}</span>
        <CopyCurlBtn flow={flow} />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-2">
        {/* Request */}
        <Tabs.Root defaultValue="headers" className="flex flex-col border-r border-pb-border min-h-0">
          <div className="px-2 py-1 text-xs text-pb-muted border-b border-pb-border">Request</div>
          <Tabs.List className="flex gap-1 px-2 pt-1 border-b border-pb-border text-xs">
            <TabTrigger value="headers">头部</TabTrigger>
            <TabTrigger value="query">查询</TabTrigger>
            <TabTrigger value="body">正文</TabTrigger>
            <TabTrigger value="auth">授权</TabTrigger>
            <TabTrigger value="raw">原始</TabTrigger>
            <TabTrigger value="summary">摘要</TabTrigger>
            <TabTrigger value="code">代码</TabTrigger>
            {customTabs.request.map((fmt) => (
              <TabTrigger key={fmt} value={`custom:${fmt}`}>
                {PREVIEW_FORMAT_LABEL[fmt] ?? fmt}
              </TabTrigger>
            ))}
            <PlusButton onClick={openCustomizer} testId="detail-req-plus" />
          </Tabs.List>
          <div className="flex-1 min-h-0 flex flex-col">
            <Tabs.Content value="headers" className="flex-1 min-h-0 overflow-auto pb-scroll"><HeadersView headers={flow.request.headers} /></Tabs.Content>
            <Tabs.Content value="query" className="flex-1 min-h-0 overflow-auto pb-scroll"><QueryView url={flow.request.url} /></Tabs.Content>
            <Tabs.Content value="body" className="flex-1 min-h-0 overflow-auto pb-scroll">
              <BodyView bodyText={flow.request.bodyText} bodyBase64={flow.request.bodyBase64} contentType={flow.request.contentType} bodySize={flow.request.bodySize} urlPath={flow.request.path} />
            </Tabs.Content>
            <Tabs.Content value="auth" className="flex-1 min-h-0 overflow-auto pb-scroll"><AuthView headers={flow.request.headers} /></Tabs.Content>
            {/* raw / code 内部自带 Monaco 满高布局，外层不要 overflow-auto */}
            <Tabs.Content value="raw" className="flex-1 min-h-0"><RawView flow={flow} which="request" /></Tabs.Content>
            <Tabs.Content value="summary" className="flex-1 min-h-0 overflow-auto pb-scroll"><SummaryView flow={flow} /></Tabs.Content>
            <Tabs.Content value="code" className="flex-1 min-h-0"><CodeGenView flow={flow} /></Tabs.Content>
            {customTabs.request.map((fmt) => (
              <Tabs.Content
                key={fmt}
                value={`custom:${fmt}`}
                className="flex-1 min-h-0 overflow-auto pb-scroll"
                data-testid={`custom-tab-request-${fmt}`}
              >
                <CustomTabBody fmt={fmt} data={flow.request} />
              </Tabs.Content>
            ))}
          </div>
        </Tabs.Root>

        {/* Response */}
        <Tabs.Root
          defaultValue={provider !== 'unknown' ? 'chat' : isWS ? 'ws' : 'headers'}
          className="flex flex-col min-h-0"
        >
          <div className="px-2 py-1 text-xs text-pb-muted border-b border-pb-border">
            {isWS ? 'WebSocket' : 'Response'} {flow.status === 'streaming' && (
              <span className="ml-2 text-pb-accent inline-flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-pb-accent animate-pulse" />
                流式中…
              </span>
            )}
          </div>
          <Tabs.List className="flex gap-1 px-2 pt-1 border-b border-pb-border text-xs">
            <TabTrigger value="headers">头部</TabTrigger>
            {!isWS && <TabTrigger value="body">正文</TabTrigger>}
            {!isWS && <TabTrigger value="setcookie">Set-Cookie</TabTrigger>}
            <TabTrigger value="raw">原始</TabTrigger>
            {isSSE && <TabTrigger value="sse">SSE</TabTrigger>}
            {isWS && <TabTrigger value="ws">消息</TabTrigger>}
            {provider !== 'unknown' && <TabTrigger value="chat">{provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'ACP'}</TabTrigger>}
            {customTabs.response.map((fmt) => (
              <TabTrigger key={fmt} value={`custom:${fmt}`}>
                {PREVIEW_FORMAT_LABEL[fmt] ?? fmt}
              </TabTrigger>
            ))}
            <PlusButton onClick={openCustomizer} testId="detail-resp-plus" />
          </Tabs.List>
          <div className="flex-1 min-h-0 flex flex-col">
            <Tabs.Content value="headers" className="flex-1 min-h-0 overflow-auto pb-scroll">
              {flow.response ? <HeadersView headers={flow.response.headers} /> : <Empty />}
            </Tabs.Content>
            <Tabs.Content value="body" className="flex-1 min-h-0 overflow-auto pb-scroll">
              {flow.response ? (
                <BodyView bodyText={flow.response.bodyText} bodyBase64={flow.response.bodyBase64} contentType={flow.response.contentType} bodySize={flow.response.bodySize} urlPath={flow.request.path} />
              ) : <Empty />}
            </Tabs.Content>
            <Tabs.Content value="setcookie" className="flex-1 min-h-0 overflow-auto pb-scroll">
              {flow.response ? <SetCookieView headers={flow.response.headers} /> : <Empty />}
            </Tabs.Content>
            <Tabs.Content value="raw" className="flex-1 min-h-0"><RawView flow={flow} which="response" /></Tabs.Content>
            {isSSE && (
              <Tabs.Content value="sse" className="flex-1 min-h-0 overflow-auto pb-scroll"><SSEView frames={flow.sseFrames} /></Tabs.Content>
            )}
            {isWS && (
              <Tabs.Content value="ws" className="flex-1 min-h-0 overflow-auto pb-scroll"><WSView messages={flow.wsMessages || []} /></Tabs.Content>
            )}
            {provider !== 'unknown' && (
              // Chat 视图内部两列自带独立滚动，外层不要再 overflow-auto
              <Tabs.Content value="chat" className="flex-1 min-h-0"><ChatView flow={flow} provider={provider} /></Tabs.Content>
            )}
            {customTabs.response.map((fmt) => (
              <Tabs.Content
                key={fmt}
                value={`custom:${fmt}`}
                className="flex-1 min-h-0 overflow-auto pb-scroll"
                data-testid={`custom-tab-response-${fmt}`}
              >
                {flow.response ? (
                  <CustomTabBody fmt={fmt} data={flow.response} />
                ) : <Empty />}
              </Tabs.Content>
            ))}
          </div>
        </Tabs.Root>
      </div>
      <TabCustomizer open={customizerOpen} onClose={() => setCustomizerOpen(false)} />
    </div>
  );
}

function TabTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="px-2 py-1 text-pb-muted data-[state=active]:text-pb-text data-[state=active]:border-b-2 data-[state=active]:border-pb-accent -mb-px"
    >
      {children}
    </Tabs.Trigger>
  );
}

function Empty() {
  return <div className="p-4 text-xs text-pb-muted">暂无数据</div>;
}

function CopyCurlBtn({ flow }: { flow: any }) {
  const [done, setDone] = useState(false);
  const toCurl = (): string => {
    const parts = [`curl '${flow.request.url}'`];
    if (flow.request.method && flow.request.method !== 'GET') parts.push(`  -X ${flow.request.method}`);
    for (const h of flow.request.headers as { name: string; value: string }[]) {
      const lower = h.name.toLowerCase();
      if (lower === 'content-length' || lower === 'host') continue;
      parts.push(`  -H '${h.name}: ${h.value.replace(/'/g, "'\\''")}'`);
    }
    if (flow.request.bodyText) {
      parts.push(`  --data-raw '${String(flow.request.bodyText).replace(/'/g, "'\\''")}'`);
    }
    return parts.join(' \\\n');
  };
  return (
    <button
      className="pb-btn px-2 py-0.5 text-xs shrink-0"
      title="复制为 cURL"
      onClick={() => { navigator.clipboard.writeText(toCurl()); setDone(true); setTimeout(() => setDone(false), 1200); }}
    >
      {done ? '已复制' : '复制 cURL'}
    </button>
  );
}

function QueryView({ url }: { url: string }) {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()];
    if (!params.length) return <Empty />;
    return (
      <table className="w-full text-xs font-mono">
        <tbody>
          {params.map(([k, v], i) => (
            <tr key={i} className="border-b border-pb-border/30">
              <td className="px-2 py-1 text-pb-muted align-top w-1/3 break-all">{k}</td>
              <td className="px-2 py-1 break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } catch {
    return <Empty />;
  }
}

function RawView({ flow, which }: { flow: any; which: 'request' | 'response' }) {
  const head: string[] = [];
  let body = '';
  if (which === 'request') {
    head.push(`${flow.request.method} ${flow.request.path} HTTP/${flow.request.httpVersion}`);
    for (const h of flow.request.headers) head.push(`${h.name}: ${h.value}`);
    body = flow.request.bodyText || '';
  } else if (flow.response) {
    head.push(`HTTP/${flow.response.httpVersion} ${flow.response.status} ${flow.response.statusText}`);
    for (const h of flow.response.headers) head.push(`${h.name}: ${h.value}`);
    body = flow.response.bodyText || '';
  }
  const full = head.join('\n') + '\n\n' + body;
  return (
    <MonacoView
      value={full}
      readOnly
      language="plaintext"
      testId={`raw-${which}`}
      className="h-full"
      height="100%"
    />
  );
}

function PlusButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      title="自定义预览标签"
      onClick={onClick}
      data-testid={testId}
      className="px-2 py-1 text-pb-muted hover:text-pb-text -mb-px"
    >
      +
    </button>
  );
}

/** 在自定义 Tab 中直接渲染指定格式的 body 预览（无格式切换栏）。 */
function CustomTabBody({
  fmt,
  data,
}: {
  fmt: PreviewFormat;
  data: { bodyText?: string; bodyBase64?: string; contentType?: string; bodySize: number };
}) {
  const ct = (data.contentType || '').toLowerCase();
  if (!data.bodyText && !data.bodyBase64 && !data.bodySize) {
    return <div className="p-4 text-xs text-pb-muted">空 body</div>;
  }
  return (
    <PreviewBody
      mode={fmt}
      bodyText={data.bodyText}
      bodyBase64={data.bodyBase64}
      contentType={ct}
    />
  );
}

function AuthView({ headers }: { headers: Header[] }) {
  const auth = headers.find((h) => h.name.toLowerCase() === 'authorization');
  const cookie = headers.find((h) => h.name.toLowerCase() === 'cookie');
  if (!auth && !cookie) return <Empty />;
  return (
    <div className="text-xs font-mono p-3 space-y-2">
      {auth && (
        <div>
          <div className="text-pb-muted mb-1">Authorization</div>
          <div className="break-all">{auth.value}</div>
        </div>
      )}
      {cookie && (
        <div>
          <div className="text-pb-muted mb-1">Cookie</div>
          <div className="break-all">{cookie.value}</div>
        </div>
      )}
    </div>
  );
}

function SummaryView({ flow }: { flow: any }) {
  const rows: [string, React.ReactNode][] = [
    ['方法', flow.request.method],
    ['URL', flow.request.url],
    ['主机', flow.request.host],
    ['状态', flow.response?.status ?? '—'],
    ['开始时间', new Date(flow.request.startedAt).toLocaleString()],
    ['耗时', flow.durationMs != null ? `${flow.durationMs} ms` : '—'],
    ['请求体', `${flow.request.bodySize} B`],
    ['响应体', `${flow.response?.bodySize ?? 0} B`],
    ['应用', flow.app?.name || '—'],
    ['命中规则', (flow.matchedRules || []).map((r: any) => r.pattern).join('\n') || '—'],
  ];
  return (
    <table className="w-full text-xs font-mono">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-pb-border/30">
            <td className="px-2 py-1 text-pb-muted align-top w-1/4">{k}</td>
            <td className="px-2 py-1 break-all whitespace-pre-wrap">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SetCookieView({ headers }: { headers: Header[] }) {
  const items = headers.filter((h) => h.name.toLowerCase() === 'set-cookie');
  if (!items.length) return <Empty />;
  return (
    <div className="text-xs font-mono p-3 space-y-2">
      {items.map((h, i) => (
        <div key={i} className="break-all">
          <span className="text-pb-muted">{h.name}: </span>
          {h.value}
        </div>
      ))}
    </div>
  );
}

function TreeView(_props: { bodyText?: string; contentType?: string }) { return null; }


function CodeGenView({ flow }: { flow: Flow }) {
  const [lang, setLang] = useState<CodeLang>('curl');
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => generateCode(flow, lang), [flow, lang]);
  // 每个语言对应的 Monaco language id
  const monacoLang = lang === 'curl' || lang === 'httpie' ? 'shell'
    : lang === 'python' ? 'python'
    : lang === 'go' ? 'go'
    : 'javascript';
  return (
    <div data-testid="codegen-view" className="text-xs flex flex-col h-full">
      <div className="flex flex-wrap gap-1 px-2 py-1 border-b border-pb-border/50 bg-pb-bg">
        {CODE_LANGS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLang(l.key)}
            data-testid={`codegen-lang-${l.key}`}
            className={cn(
              'pb-btn px-1.5 py-0.5',
              lang === l.key && 'bg-pb-hover text-pb-text',
            )}
          >
            {l.label}
          </button>
        ))}
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="pb-btn px-1.5 py-0.5 ml-auto"
        >{copied ? '已复制' : '复制'}</button>
      </div>
      <div className="flex-1 min-h-[220px]">
        <MonacoView value={code} readOnly language={monacoLang} className="h-full" height="100%" />
      </div>
    </div>
  );
}
