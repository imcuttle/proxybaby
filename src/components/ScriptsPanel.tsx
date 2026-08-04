/**
 * 脚本（Scripts）管理面板。
 *
 * 之前放在设置窗口，现在移到「规则」页面。作为 whistle 插件运行；
 * 规则中通过 `script://<id-or-name>` 引用；勾选"全局"对所有请求生效。
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Play } from 'lucide-react';
import type { ScriptSummary, ScriptTestCase, ScriptTestResult } from '../../shared/types';
import { cn } from '../lib/cn';
import { MonacoView } from './MonacoView';
import { BodyEditor } from './BodyEditor';

export function ScriptsPanel() {
  const [items, setItems] = useState<ScriptSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; code: string } | null>(null);
  const active = items.find((s) => s.id === activeId);

  const refresh = async () => {
    const l = await window.proxybaby.scriptsList();
    setItems(l);
    if (l.length && !activeId) setActiveId(l[0].id);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    if (active) setDraft({ name: active.name, code: active.code });
  }, [active?.id, active?.code, active?.name]);

  const addOne = async () => {
    const rec = await window.proxybaby.scriptsAdd(`脚本 ${items.length + 1}`);
    setActiveId(rec.id);
    refresh();
  };
  const removeOne = async () => {
    if (!activeId) return;
    await window.proxybaby.scriptsRemove(activeId);
    setActiveId(null);
    refresh();
  };
  const save = async () => {
    if (!activeId || !draft) return;
    await window.proxybaby.scriptsUpdate(activeId, { name: draft.name, code: draft.code });
    refresh();
  };
  const toggleEnabled = async (id: string, enabled: boolean) => {
    await window.proxybaby.scriptsUpdate(id, { enabled });
    refresh();
  };
  const toggleAlways = async (id: string, always: boolean) => {
    await window.proxybaby.scriptsUpdate(id, { always });
    refresh();
  };

  return (
    <div className="h-full flex" data-testid="scripts-panel">
      <div className="w-56 border-r border-pb-border bg-pb-panel flex flex-col">
        <div className="flex items-center gap-1 px-2 py-1 border-b border-pb-border">
          <button data-testid="script-add" onClick={addOne} className="pb-btn px-1.5 py-0.5 text-xs flex items-center gap-1"><Plus size={12} /> 新建</button>
          {activeId && (
            <button onClick={removeOne} className="pb-btn px-1.5 py-0.5 text-xs flex items-center gap-1"><Trash2 size={12} /> 删除</button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pb-scroll">
          {items.length === 0 && <div className="p-3 text-xs text-pb-muted">还没有脚本，点击"新建"创建一个。</div>}
          {items.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              data-testid={`script-item-${s.id}`}
              className={cn('w-full text-left px-2 py-1.5 text-xs border-b border-pb-border/40 hover:bg-pb-hover', activeId === s.id && 'bg-pb-selected/40')}
            >
              <div className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => toggleEnabled(s.id, e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="truncate">{s.name}</span>
                {s.always && <span className="ml-auto text-[10px] text-pb-accent">全局</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {active && draft ? (
          <>
            <div className="flex items-center gap-1 px-2 py-1 border-b border-pb-border">
              <input
                data-testid="script-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="pb-input px-2 py-0.5 text-xs w-56"
              />
              <label className="text-xs text-pb-muted flex items-center gap-1 ml-3">
                <input
                  type="checkbox"
                  data-testid="script-always"
                  checked={!!active.always}
                  onChange={(e) => toggleAlways(active.id, e.target.checked)}
                /> 全局启用（对所有请求生效）
              </label>
              <button data-testid="script-save" onClick={save} className="pb-btn px-1.5 py-0.5 text-xs ml-auto flex items-center gap-1">
                <Save size={12} /> 保存
              </button>
            </div>
            {active.lastError && (
              <div className="px-2 py-1 text-xs text-pb-error bg-pb-error/10 border-b border-pb-border">
                上次执行失败：{active.lastError}
              </div>
            )}
            <textarea
              data-testid="script-code-fallback"
              spellCheck={false}
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              style={{ display: 'none' }}
            />
            <MonacoView
              testId="script-code"
              value={draft.code}
              language="javascript"
              path={`file:///scripts/${active.id}.js`}
              onChange={(v) => setDraft({ ...draft, code: v })}
              className="flex-1 min-h-[220px]"
            />
            <ScriptTestPanel scriptId={active.id} draftCode={draft.code} />
          </>
        ) : (
          <div className="p-3 text-xs text-pb-muted">选择一个脚本进行编辑，或新建。</div>
        )}
      </div>
    </div>
  );
}

// -------- Script Test Panel --------

const DEFAULT_TEST_CASE: ScriptTestCase = {
  request: {
    method: 'GET',
    url: 'https://example.com/api/hello?q=1',
    headers: [{ name: 'user-agent', value: 'ProxyBaby-Test' }],
    bodyText: '',
  },
  response: {
    status: 200,
    statusText: 'OK',
    headers: [{ name: 'content-type', value: 'application/json' }],
    bodyText: '{"ok":true}',
  },
};

function ScriptTestPanel({ scriptId, draftCode }: { scriptId: string; draftCode: string }) {
  const [tc, setTc] = useState<ScriptTestCase>(DEFAULT_TEST_CASE);
  const [result, setResult] = useState<ScriptTestResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      await window.proxybaby.scriptsUpdate(scriptId, { code: draftCode });
      const r = await window.proxybaby.scriptsTest(scriptId, tc);
      setResult(r);
    } finally {
      setRunning(false);
    }
  };

  const headerRow = (
    arr: { name: string; value: string }[] | undefined,
    onChange: (next: { name: string; value: string }[]) => void,
    label: string,
  ) => {
    const list = arr || [];
    return (
      <div>
        <div className="text-pb-muted mb-1">{label}</div>
        <div className="space-y-1">
          {list.map((h, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                className="pb-input px-1 py-0.5 text-xs w-32 font-mono"
                value={h.name}
                onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                className="pb-input px-1 py-0.5 text-xs flex-1 font-mono"
                value={h.value}
                onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
              <button
                className="pb-btn px-1 py-0.5"
                onClick={() => onChange(list.filter((_, j) => j !== i))}
                title="删除该 header"
              ><Trash2 size={11} /></button>
            </div>
          ))}
          <button
            className="pb-btn px-1.5 py-0.5 text-xs flex items-center gap-1"
            onClick={() => onChange([...list, { name: '', value: '' }])}
          ><Plus size={11} /> 添加 Header</button>
        </div>
      </div>
    );
  };

  return (
    <div className="border-t border-pb-border bg-pb-bg text-xs" data-testid="script-test-panel">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-pb-border/60">
        <span className="font-semibold">测试</span>
        <span className="text-pb-muted">对合成的请求/响应运行脚本（不发上游）</span>
        <button
          onClick={run}
          disabled={running}
          className="pb-btn px-2 py-0.5 ml-auto flex items-center gap-1"
          data-testid="script-test-run"
        >
          <Play size={12} /> {running ? '运行中…' : '运行测试'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2">
        <div className="space-y-2 border border-pb-border rounded p-2">
          <div className="font-semibold">Request</div>
          <div className="flex items-center gap-1">
            <select
              className="pb-input px-1 py-0.5 text-xs"
              value={tc.request.method}
              onChange={(e) => setTc({ ...tc, request: { ...tc.request, method: e.target.value } })}
            >
              {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              className="pb-input px-1 py-0.5 text-xs flex-1 font-mono"
              value={tc.request.url}
              placeholder="URL"
              onChange={(e) => setTc({ ...tc, request: { ...tc.request, url: e.target.value } })}
            />
          </div>
          {headerRow(
            tc.request.headers,
            (next) => setTc({ ...tc, request: { ...tc.request, headers: next } }),
            'Headers',
          )}
          <div>
            <div className="text-pb-muted mb-1">Body</div>
            <div className="border border-pb-border rounded overflow-hidden">
              <BodyEditor
                value={tc.request.bodyText || ''}
                onChange={(v) => setTc({ ...tc, request: { ...tc.request, bodyText: v } })}
                contentType={tc.request.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value}
                height="120px"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2 border border-pb-border rounded p-2">
          <div className="flex items-center gap-1">
            <span className="font-semibold flex-1">Response</span>
            <label className="flex items-center gap-1 text-pb-muted">
              <input
                type="checkbox"
                checked={!!tc.response}
                onChange={(e) => setTc({
                  ...tc,
                  response: e.target.checked
                    ? (tc.response || { status: 200, headers: [], bodyText: '' })
                    : undefined,
                })}
              /> 包含响应（触发 onResponse）
            </label>
          </div>
          {tc.response && (
            <>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  className="pb-input px-1 py-0.5 text-xs w-20 font-mono"
                  value={tc.response.status}
                  onChange={(e) => setTc({ ...tc, response: { ...tc.response!, status: Number(e.target.value) || 0 } })}
                />
                <input
                  className="pb-input px-1 py-0.5 text-xs flex-1 font-mono"
                  value={tc.response.statusText || ''}
                  placeholder="statusText"
                  onChange={(e) => setTc({ ...tc, response: { ...tc.response!, statusText: e.target.value } })}
                />
              </div>
              {headerRow(
                tc.response.headers,
                (next) => setTc({ ...tc, response: { ...tc.response!, headers: next } }),
                'Headers',
              )}
              <div>
                <div className="text-pb-muted mb-1">Body</div>
                <div className="border border-pb-border rounded overflow-hidden">
                  <BodyEditor
                    value={tc.response.bodyText || ''}
                    onChange={(v) => setTc({ ...tc, response: { ...tc.response!, bodyText: v } })}
                    contentType={tc.response.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value}
                    height="120px"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {result && (
        <div className="p-2 space-y-2 border-t border-pb-border/60">
          <div className="flex items-center gap-2">
            <span className={cn('font-semibold', result.ok ? 'text-pb-success' : 'text-pb-error')}>
              {result.ok ? '✓ 运行成功' : '✗ 运行失败'}
            </span>
            {result.error && <span className="text-pb-error font-mono break-all">{result.error}</span>}
            {result.aborted && <span className="text-pb-warn">abort: {result.aborted.reason || '(无原因)'}</span>}
            {result.responded && <span className="text-pb-accent">respond → {result.responded.status}</span>}
          </div>
          {result.logs.length > 0 && (
            <div>
              <div className="text-pb-muted mb-1">Console 输出</div>
              <pre className="bg-pb-panel border border-pb-border rounded px-2 py-1 font-mono whitespace-pre-wrap max-h-40 overflow-auto">
                {result.logs.join('\n')}
              </pre>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-pb-muted mb-1">结果 Request</div>
              <pre className="bg-pb-panel border border-pb-border rounded px-2 py-1 font-mono whitespace-pre-wrap max-h-56 overflow-auto">
{`${result.request.method} ${result.request.url}
${result.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}

${result.request.bodyText}`}
              </pre>
            </div>
            <div>
              <div className="text-pb-muted mb-1">结果 Response</div>
              <pre className="bg-pb-panel border border-pb-border rounded px-2 py-1 font-mono whitespace-pre-wrap max-h-56 overflow-auto">
{result.responded
  ? `${result.responded.status} ${result.responded.statusText || ''}
${result.responded.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}

${result.responded.bodyText}`
  : result.response
  ? `${result.response.status} ${result.response.statusText}
${result.response.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}

${result.response.bodyText}`
  : '(无响应)'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
