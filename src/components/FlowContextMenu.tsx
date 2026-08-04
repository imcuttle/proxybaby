import { useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import type { Flow } from '../../shared/types';
import { useFlowStore } from '../store/flows';
import {
  toCurl, rawExchange, headersText, cookiesFromHeaders, toMarkdownTable, toCSV,
} from '../lib/flow-serialize';
import { QuickRuleSubMenu } from './QuickRuleSubMenu';

const HIGHLIGHT_COLORS = [
  { key: 'red', label: '红', className: 'bg-red-500' },
  { key: 'orange', label: '橙', className: 'bg-orange-500' },
  { key: 'yellow', label: '黄', className: 'bg-yellow-500' },
  { key: 'green', label: '绿', className: 'bg-green-500' },
  { key: 'blue', label: '蓝', className: 'bg-blue-500' },
] as const;

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); } catch {}
}

export function FlowContextMenu({
  flow,
  cellValue,
  children,
}: {
  flow: Flow;
  cellValue?: string;
  children: React.ReactNode;
}) {
  const togglePin = useFlowStore((s) => s.togglePin);
  const toggleSave = useFlowStore((s) => s.toggleSave);
  const removeFlow = useFlowStore((s) => s.removeFlow);
  const setNote = useFlowStore((s) => s.setNote);
  const setHighlight = useFlowStore((s) => s.setHighlight);
  const setFilter = useFlowStore((s) => s.setFilter);
  const noteById = useFlowStore((s) => s.noteById);
  const mitmDisabledHosts = useFlowStore((s) => s.mitmDisabledHosts);
  const toggleMitmDisabledHost = useFlowStore((s) => s.toggleMitmDisabledHost);
  const selectedIds = useFlowStore((s) => s.selectedIds);
  const byId = useFlowStore((s) => s.byId);
  const pinnedIds = useFlowStore((s) => s.pinnedIds);
  const savedIds = useFlowStore((s) => s.savedIds);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);

  const api = window.proxybaby;
  const host = flow.request.host;
  const mitmDisabled = !!mitmDisabledHosts[host];

  // 多选：若当前右键行也在选中集合里，则批量作用；否则仅作用于当前行
  const selectedFlows: Flow[] = (() => {
    if (selectedIds[flow.id]) {
      const list: Flow[] = [];
      for (const id of Object.keys(selectedIds)) {
        const f = byId[id];
        if (f) list.push(f);
      }
      return list.length > 0 ? list : [flow];
    }
    return [flow];
  })();
  const multi = selectedFlows.length > 1;
  const n = selectedFlows.length;
  const labelN = multi ? ` ${n} 个` : '';
  const allPinned = selectedFlows.length > 0 && selectedFlows.every((f) => pinnedIds[f.id]);
  const allSaved = selectedFlows.length > 0 && selectedFlows.every((f) => savedIds[f.id]);

  const joinLines = (arr: string[]) => arr.filter(Boolean).join('\n');
  const bulkUrls = () => joinLines(selectedFlows.map((f) => f.request.url));
  const bulkCurls = () => selectedFlows.map((f) => toCurl(f)).join('\n\n');
  const bulkRawExchange = () => selectedFlows.map((f) => rawExchange(f)).join('\n\n----\n\n');
  const bulkReqHeaders = () => selectedFlows.map((f) => headersText(f.request.headers)).join('\n\n----\n\n');
  const bulkReqCookies = () => joinLines(selectedFlows.map((f) => cookiesFromHeaders(f.request.headers, 'cookie')));
  const bulkReqBody = () => selectedFlows.map((f) => f.request.bodyText || '').filter(Boolean).join('\n\n----\n\n');
  const bulkRespHeaders = () => selectedFlows.map((f) => headersText(f.response?.headers || [])).join('\n\n----\n\n');
  const bulkRespSetCookie = () => joinLines(selectedFlows.map((f) => cookiesFromHeaders(f.response?.headers || [], 'set-cookie')));
  const bulkRespBody = () => selectedFlows.map((f) => f.response?.bodyText || '').filter(Boolean).join('\n\n----\n\n');
  const bulkMarkdown = () => selectedFlows.map((f) => toMarkdownTable(f)).join('\n\n');
  const bulkCsv = () => selectedFlows.map((f) => toCSV(f)).join('\n');

  const applyBulk = (fn: (f: Flow) => void) => selectedFlows.forEach(fn);

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="min-w-[240px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50"
          >
            <Item onSelect={() => copy(bulkUrls())} shortcut="⌘C">复制{labelN} URL</Item>
            <Item onSelect={() => copy(bulkCurls())} shortcut="⇧⌘C">复制{labelN} cURL</Item>
            <Item onSelect={() => copy(cellValue ?? '')} disabled={cellValue == null || multi}>复制单元格值</Item>

            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={triggerCls}>
                <span className="flex-1">复制为</span>
                <span className="text-pb-muted">▸</span>
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="min-w-[200px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
                  <Item onSelect={() => copy(bulkRawExchange())}>原始请求与响应</Item>
                  <Sep />
                  <Item onSelect={() => copy(bulkReqHeaders())}>请求头</Item>
                  <Item onSelect={() => copy(bulkReqCookies())}
                        disabled={!selectedFlows.some((f) => hasHeader(f.request.headers, 'cookie'))}>请求 Cookie</Item>
                  <Item onSelect={() => copy(bulkReqBody())}>请求体</Item>
                  <Sep />
                  <Item onSelect={() => copy(bulkRespHeaders())}>响应头</Item>
                  <Item onSelect={() => copy(bulkRespSetCookie())}
                        disabled={!selectedFlows.some((f) => hasHeader(f.response?.headers, 'set-cookie'))}>响应 Set-Cookie</Item>
                  <Item onSelect={() => copy(bulkRespBody())}>响应体</Item>
                  <Sep />
                  <Item onSelect={() => copy(bulkMarkdown())}>Markdown 表格</Item>
                  <Item onSelect={() => copy(bulkCsv())}>CSV</Item>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>

            <Sep />
            <Item
              onSelect={() => setFilter({ host, appName: undefined, pathPrefix: undefined, special: undefined })}
              disabled={multi}
            >
              过滤此主机
            </Item>
            {!multi && <QuickRuleSubMenu pattern={`${host}${flow.request.path.split('?')[0]}`} />}

            <Sep />
            <Item onSelect={() => applyBulk((f) => { api.flowRepeat(f.id); })} shortcut="⌘↩">
              重复{labelN ? `${labelN}选中的请求` : ''}
            </Item>
            <Item onSelect={() => setRepeatOpen(true)} shortcut="⌥⌘↩" disabled={multi}>编辑并重复…</Item>

            <Item
              onSelect={async () => {
                if (selectedFlows.length !== 2) return;
                // 右键触发的 flow 作为 base（左侧），另一条作为对比（右侧）
                const base = flow;
                const other = selectedFlows.find((f) => f.id !== flow.id) || selectedFlows[0];
                await window.proxybaby.openWindow('diff', { title: 'ProxyBaby · Diff', width: 1100, height: 720 });
                setTimeout(() => {
                  window.proxybaby.broadcast('diff:set', { left: base, right: other });
                }, 200);
              }}
              disabled={selectedFlows.length !== 2}
            >
              <span data-testid="ctx-diff">以此为 Base 与另一条 Diff…</span>
            </Item>

            <Sep />
            <Item onSelect={() => applyBulk((f) => togglePin(f.id))}>
              {allPinned ? `取消置顶${labelN}` : `置顶${labelN}`}
            </Item>
            <Item onSelect={() => applyBulk((f) => toggleSave(f.id))} shortcut="⇧⌘S">
              {allSaved ? `取消保存${labelN}` : `保存${labelN} 请求`}
            </Item>

            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={triggerCls}>
                <span className="flex-1">工具</span>
                <span className="text-pb-muted">▸</span>
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="min-w-[200px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
                  <Item onSelect={() => applyBulk((f) => { api.flowRepeat(f.id); })}>再次发送{labelN}</Item>
                  <Item onSelect={() => copy(bulkRawExchange())}>复制为文本</Item>
                  <Item onSelect={() => setRuleOpen(true)} disabled={multi}>应用到规则…</Item>
                  <Item
                    disabled={multi}
                    onSelect={() => {
                      api.ruleDebugOpen({
                        url: flow.request.url,
                        method: flow.request.method,
                        scheme: flow.request.scheme,
                        headers: flow.request.headers,
                        bodyText: flow.request.bodyText,
                        actualFlow: {
                          id: flow.id,
                          edited: !!flow.edited || (flow.matchedRules?.length ?? 0) > 0,
                          matchedRules: flow.matchedRules || [],
                          responseStatus: flow.response?.status,
                        },
                      });
                    }}
                  >用 Rule Debug 打开…</Item>
                  <Item onSelect={() => copy(selectedFlows.map(genMockRule).join('\n'))}>复制为 mock 规则</Item>
                  <Item onSelect={() => copy(selectedFlows.map(genLoggerRule).join('\n'))}>复制为 logger 规则</Item>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>

            <Item onSelect={() => setNoteOpen(true)} shortcut="⌘L" disabled={multi}>
              {noteById[flow.id] ? '编辑备注…' : '添加备注…'}
            </Item>

            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={triggerCls}>
                <span className="flex-1">高亮{labelN}</span>
                <span className="text-pb-muted">▸</span>
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="min-w-[140px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <Item key={c.key} onSelect={() => {
                      applyBulk((f) => {
                        setHighlight(f.id, c.key);
                        api.flowSetHighlight(f.id, c.key);
                      });
                    }}>
                      <span className={`inline-block w-3 h-3 rounded ${c.className} mr-2 align-middle`} />
                      {c.label}
                    </Item>
                  ))}
                  <Sep />
                  <Item onSelect={() => {
                    applyBulk((f) => {
                      setHighlight(f.id, null);
                      api.flowSetHighlight(f.id, null);
                    });
                  }}>清除高亮</Item>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>

            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={triggerCls}>
                <span className="flex-1">导出</span>
                <span className="text-pb-muted">▸</span>
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="min-w-[200px] rounded-md border border-pb-border bg-pb-panel py-1 text-xs shadow-xl z-50">
                  <Item onSelect={() => api.sessionExportFlows('proxybaby', selectedFlows.map((f) => f.id))}>
                    导出{labelN || '选中'} (.proxybaby)
                  </Item>
                  <Item onSelect={() => api.sessionExportFlows('har', selectedFlows.map((f) => f.id))}>
                    导出{labelN || '选中'} (HAR)
                  </Item>
                  <Sep />
                  <Item onSelect={() => api.sessionExport('proxybaby')}>导出全部 (.proxybaby)</Item>
                  <Item onSelect={() => api.sessionExport('har')}>导出全部 (HAR)</Item>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>

            <Sep />
            <Item onSelect={() => {
              toggleMitmDisabledHost(host);
              api.mitmDisableHost(host, !mitmDisabled);
            }} disabled={multi}>
              {mitmDisabled ? '✓ ' : ''}禁用 SSL 代理（{host}）
            </Item>

            <Sep />
            <Item onSelect={() => {
              applyBulk((f) => {
                removeFlow(f.id);
                api.flowRemove(f.id);
              });
            }} destructive shortcut="⌫">
              删除{labelN}
            </Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {repeatOpen && <RepeatEditor flow={flow} onClose={() => setRepeatOpen(false)} />}
      {noteOpen && (
        <NoteEditor
          initial={noteById[flow.id] || flow.note || ''}
          onClose={() => setNoteOpen(false)}
          onSubmit={(v) => {
            setNote(flow.id, v);
            api.flowSetNote(flow.id, v);
            setNoteOpen(false);
          }}
        />
      )}
      {ruleOpen && (
        <RuleEditor
          flow={flow}
          onClose={() => setRuleOpen(false)}
          onSubmit={async (name, text) => {
            await window.proxybaby.rulesAdd(name, text, true);
            setRuleOpen(false);
          }}
        />
      )}
    </>
  );
}

const triggerCls =
  'flex items-center px-3 py-1.5 text-pb-text hover:bg-pb-hover data-[state=open]:bg-pb-hover cursor-default outline-none';

function Item({
  onSelect,
  disabled,
  destructive,
  shortcut,
  children,
}: {
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  shortcut?: string;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={
        'flex items-center px-3 py-1.5 outline-none cursor-default select-none ' +
        (disabled
          ? 'text-pb-muted/60 pointer-events-none'
          : destructive
          ? 'text-pb-error hover:bg-pb-hover data-[highlighted]:bg-pb-hover'
          : 'text-pb-text hover:bg-pb-hover data-[highlighted]:bg-pb-hover')
      }
    >
      <span className="flex-1">{children}</span>
      {shortcut && <span className="ml-4 text-pb-muted text-[13px] font-mono tracking-wide">{shortcut}</span>}
    </ContextMenu.Item>
  );
}

function Sep() {
  return <ContextMenu.Separator className="my-1 h-px bg-pb-border/60" />;
}

function hasHeader(hs: { name: string; value: string }[] | undefined, name: string): boolean {
  if (!hs) return false;
  const t = name.toLowerCase();
  return hs.some((h) => h.name.toLowerCase() === t);
}

/** 由捕获到的 flow 生成一条 mock 规则（如 host+path → mock:// resp-body）。 */
function genMockRule(flow: Flow): string {
  const pattern = `${flow.request.host}${flow.request.path.split('?')[0]}`;
  const body = flow.response?.bodyText || '{}';
  // whistle 语法：pattern  op://value
  return `${pattern}  mock://${escapeMockValue(body)}`;
}

function genLoggerRule(flow: Flow): string {
  const pattern = `${flow.request.host}${flow.request.path.split('?')[0]}`;
  return `${pattern}  log://console`;
}

function escapeMockValue(s: string): string {
  // whistle 规则不支持换行，做 URL-safe 转义
  return s.replace(/\r?\n/g, '\\n').slice(0, 4096);
}

/** 备注编辑器 modal */
function NoteEditor({
  initial,
  onClose,
  onSubmit,
}: {
  initial: string;
  onClose: () => void;
  onSubmit: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-pb-panel border border-pb-border rounded-md w-[520px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-pb-border text-sm">添加备注</div>
        <div className="p-4">
          <textarea
            autoFocus
            className="pb-input py-1 font-mono h-32 w-full resize-y text-xs"
            placeholder="输入备注（Cmd+Enter 保存）"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onSubmit(value);
              }
            }}
          />
        </div>
        <div className="px-4 py-2 border-t border-pb-border flex justify-between items-center gap-2">
          <button
            className="pb-btn px-3 py-1 text-xs text-pb-error"
            onClick={() => onSubmit('')}
          >
            清除
          </button>
          <div className="flex gap-2">
            <button className="pb-btn px-3 py-1 text-xs" onClick={onClose}>取消</button>
            <button
              className="pb-btn px-3 py-1 text-xs bg-pb-accent/20 text-pb-accent"
              onClick={() => onSubmit(value)}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 「应用到规则」modal —— 选择模板并生成规则集 */
function RuleEditor({
  flow,
  onClose,
  onSubmit,
}: {
  flow: Flow;
  onClose: () => void;
  onSubmit: (name: string, text: string) => void | Promise<void>;
}) {
  const pattern = `${flow.request.host}${flow.request.path.split('?')[0]}`;
  const templates = [
    { key: 'mock', label: 'Mock 响应体', build: () => genMockRule(flow) },
    { key: 'status500', label: '改状态码 → 500', build: () => `${pattern}  statusCode://500` },
    { key: 'delay', label: '延迟 2 秒响应', build: () => `${pattern}  resDelay://2000` },
    { key: 'abort', label: '中断请求', build: () => `${pattern}  abort` },
    { key: 'breakpoint', label: '断点编辑', build: () => `${pattern}  breakpoint` },
    { key: 'log', label: 'Log 到 console', build: () => genLoggerRule(flow) },
    { key: 'redirect', label: '重定向到…', build: () => `${pattern}  redirect://https://example.com` },
  ] as const;
  const [selected, setSelected] = useState<string>('mock');
  const [name, setName] = useState(`来自抓包 · ${flow.request.host}`);
  const [text, setText] = useState(templates.find((t) => t.key === selected)!.build());

  const pickTemplate = (k: string) => {
    setSelected(k);
    const t = templates.find((x) => x.key === k);
    if (t) setText(t.build());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-pb-panel border border-pb-border rounded-md w-[720px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-pb-border text-sm">应用到规则</div>
        <div className="p-4 flex flex-col gap-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="w-20 text-pb-muted">规则集名称</span>
            <input className="pb-input py-1 flex-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-pb-muted">选择模板</span>
            <div className="flex flex-wrap gap-1">
              {templates.map((t) => (
                <button
                  key={t.key}
                  onClick={() => pickTemplate(t.key)}
                  className={
                    'px-2 py-0.5 rounded ' +
                    (selected === t.key ? 'bg-pb-accent/20 text-pb-accent' : 'text-pb-muted hover:bg-pb-hover')
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-pb-muted">规则文本（whistle 语法）</span>
            <textarea
              className="pb-input py-1 font-mono h-40 resize-y"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        </div>
        <div className="px-4 py-2 border-t border-pb-border flex justify-end gap-2">
          <button className="pb-btn px-3 py-1 text-xs" onClick={onClose}>取消</button>
          <button
            className="pb-btn px-3 py-1 text-xs bg-pb-accent/20 text-pb-accent"
            onClick={() => onSubmit(name, text)}
          >
            创建并启用
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 编辑并重复 —— 简单的 modal，可改 method/url/headers(text)/body。
 */
function RepeatEditor({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const [method, setMethod] = useState(flow.request.method);
  const [url, setUrl] = useState(flow.request.url);
  const [headersText, setHeadersText] = useState(
    flow.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n'),
  );
  const [body, setBody] = useState(flow.request.bodyText || '');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true);
    try {
      const headers = headersText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const i = l.indexOf(':');
          if (i < 0) return { name: l, value: '' };
          return { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
        });
      await window.proxybaby.flowRepeat(flow.id, { method, url, headers, bodyText: body });
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-pb-panel border border-pb-border rounded-md w-[720px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-pb-border text-sm">编辑并重复</div>
        <div className="p-4 flex flex-col gap-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="w-16 text-pb-muted">方法</span>
            <input className="pb-input py-1 w-32" value={method} onChange={(e) => setMethod(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-16 text-pb-muted">URL</span>
            <input className="pb-input py-1 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-pb-muted">请求头（每行 <code>Name: Value</code>）</span>
            <textarea
              className="pb-input py-1 font-mono h-32 resize-y"
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-pb-muted">请求体</span>
            <textarea
              className="pb-input py-1 font-mono h-32 resize-y"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
        </div>
        <div className="px-4 py-2 border-t border-pb-border flex justify-end gap-2">
          <button className="pb-btn px-3 py-1 text-xs" onClick={onClose}>取消</button>
          <button className="pb-btn px-3 py-1 text-xs bg-pb-accent/20 text-pb-accent" disabled={sending} onClick={submit}>
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
