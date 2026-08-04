import { useEffect, useMemo, useState } from 'react';
import type { Header, RuleDebugInput, RuleDebugResult, RuleMatchDiagnosis } from '../../shared/types';
import { cn } from '../lib/cn';
import { HeadersEditor } from '../components/HeadersEditor';
import { BodyEditor } from '../components/BodyEditor';

/**
 * Rule Debug 面板：
 *   - 上半区：请求输入（method / url / headers / body）+ 运行/真实发送按钮
 *   - 下半区：Tabs（诊断 / dry-run / 执行的 operators）
 *
 * 依赖 IPC：
 *   - ruleDebugConsumeInit()：拉取父窗口传入的预填参数
 *   - ruleDebugRun(input)：核心 debug 引擎调用
 *   - composerSend(...)：真实发送时复用（结果会作为一个新 flow 出现在主窗口列表）
 */
export function RuleDebugView() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('');   //一行一个 "Name: Value"
  const [bodyText, setBodyText] = useState('');
  const [actualFlow, setActualFlow] = useState<RuleDebugInput['actualFlow']>(undefined);
  const [result, setResult] = useState<RuleDebugResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'diagnose' | 'dryrun' | 'ops'>('diagnose');
  const [diagFilter, setDiagFilter] = useState<'all' | 'matched' | 'unmatched'>('all');

  useEffect(() => {
    (async () => {
      const p = await window.proxybaby.ruleDebugConsumeInit();
      if (p) {
        if (p.method) setMethod(p.method);
        if (p.url) setUrl(p.url);
        if (p.headers?.length) {
          setHeadersText(p.headers.map((h) => `${h.name}: ${h.value}`).join('\n'));
        }
        if (p.bodyText) setBodyText(p.bodyText);
        if (p.actualFlow) setActualFlow(p.actualFlow);
        // 自动跑一次
        if (p.url) {
          setTimeout(() => {
            (document.querySelector('[data-testid="rd-run"]') as HTMLButtonElement | null)?.click();
          }, 100);
        }
      }
    })();
  }, []);

  const parsedHeaders: Header[] = useMemo(() => parseHeadersText(headersText), [headersText]);

  const buildInput = (): RuleDebugInput => ({
    url: url.trim(),
    method: method.trim() || 'GET',
    headers: parsedHeaders,
    bodyText: bodyText,
  });

  const runDebug = async () => {
    if (!url.trim()) { setError('请输入 URL'); return; }
    setRunning(true);
    setError(null);
    try {
      const r = await window.proxybaby.ruleDebugRun(buildInput());
      setResult(r);
      setTab('diagnose');
    } catch (e: any) {
      setError(e?.message || '运行失败');
    } finally {
      setRunning(false);
    }
  };

  const sendReal = async () => {
    if (!url.trim()) { setError('请输入 URL'); return; }
    setError(null);
    try {
      const r = await window.proxybaby.composerSend({
        method,
        url: url.trim(),
        headers: parsedHeaders,
        bodyText: bodyText || undefined,
      });
      if (!r.ok) setError(r.error || '发送失败');
    } catch (e: any) {
      setError(e?.message || '发送失败');
    }
  };

  return (
    <div className="h-full flex flex-col bg-pb-bg text-pb-text" data-testid="rule-debug-view">
      {/* 上半区：请求输入 */}
      <div className="border-b border-pb-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <select
            className="pb-input px-2 py-1 text-xs font-mono w-24"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            data-testid="rd-method"
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            type="text"
            className="pb-input px-2 py-1 text-xs font-mono flex-1"
            placeholder="https://api.example.com/foo/bar"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !running) runDebug(); }}
            data-testid="rd-url"
          />
          <button
            className="pb-btn pb-btn-primary px-3 py-1 text-xs bg-pb-selected text-white"
            onClick={runDebug}
            disabled={running || !url.trim()}
            data-testid="rd-run"
          >{running ? '运行中…' : '运行匹配'}</button>
          <button
            className="pb-btn px-3 py-1 text-xs border border-pb-border"
            onClick={sendReal}
            disabled={running || !url.trim()}
            data-testid="rd-send"
            title="复用 Composer 真实发送一次，结果作为新 flow 出现在主窗口"
          >真实发送</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-pb-muted mb-1">请求头（每行一个 Name: Value）</div>
            <div className="border border-pb-border rounded overflow-hidden" data-testid="rd-headers">
              <HeadersEditor
                value={headersText}
                onChange={setHeadersText}
                height="120px"
              />
            </div>
          </div>
          <div>
            <div className="text-[10px] text-pb-muted mb-1">Body（可选）</div>
            <div className="border border-pb-border rounded overflow-hidden" data-testid="rd-body">
              <BodyEditor
                value={bodyText}
                onChange={setBodyText}
                contentType={parsedHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value}
                height="120px"
              />
            </div>
          </div>
        </div>
        {error && <div className="text-xs text-red-400" data-testid="rd-error">{error}</div>}
      </div>

      {/* 下半区：结果 */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-1 px-2 py-1 border-b border-pb-border">
          {(['diagnose', 'dryrun', 'ops'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                'px-2 py-0.5 text-xs rounded',
                tab === k ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
              )}
              data-testid={`rd-tab-${k}`}
            >
              {k === 'diagnose' ? '匹配诊断' : k === 'dryrun' ? 'Dry-run 结果' : '执行的 operators'}
              {result && k === 'diagnose' && (
                <span className="ml-1 text-[10px] text-pb-muted">
                  ({result.diagnoses.filter((d) => d.matched).length}/{result.diagnoses.length})
                </span>
              )}
            </button>
          ))}
          {tab === 'diagnose' && result && (
            <div className="ml-auto flex items-center gap-1">
              {(['all', 'matched', 'unmatched'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setDiagFilter(k)}
                  className={cn(
                    'px-2 py-0.5 text-[10px] rounded',
                    diagFilter === k ? 'bg-pb-selected text-white' : 'text-pb-muted hover:bg-pb-hover',
                  )}
                >{k === 'all' ? '全部' : k === 'matched' ? '仅命中' : '仅未命中'}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-auto pb-scroll">
          {!result ? (
            <div className="p-8 text-center text-xs text-pb-muted" data-testid="rd-empty">
              输入 URL 后点击「运行匹配」，看每条规则如何匹配这个请求。
            </div>
          ) : (
            <>
              {actualFlow && <ActualVsSimulated actual={actualFlow} simulatedMatched={result.diagnoses.filter((d) => d.matched)} />}
              {tab === 'diagnose' ? (
                <DiagnoseTab diagnoses={result.diagnoses} filter={diagFilter} environment={result.environment} />
              ) : tab === 'dryrun' ? (
                <DryRunTab result={result} />
              ) : (
                <OpsTab result={result} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DiagnoseTab({ diagnoses, filter, environment }: { diagnoses: RuleMatchDiagnosis[]; filter: 'all' | 'matched' | 'unmatched'; environment: RuleDebugResult['environment'] }) {
  const filtered = diagnoses.filter((d) =>
    filter === 'all' ? true : filter === 'matched' ? d.matched : !d.matched,
  );
  return (
    <div>
      <EnvBanner env={environment} />
      {filtered.length === 0 ? (
        <div className="p-6 text-xs text-pb-muted text-center" data-testid="rd-no-rules">
          {diagnoses.length === 0 ? '当前没有任何规则可匹配。到「规则集」页新建一条试试。' : '当前筛选条件下没有规则。'}
        </div>
      ) : (
        <div className="divide-y divide-pb-border/40" data-testid="rd-diagnose-list">
          {filtered.map((d, i) => (
            <div key={i} className="px-3 py-2 text-xs font-mono" data-testid={d.matched ? 'rd-diag-hit' : 'rd-diag-miss'}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex w-5 h-5 items-center justify-center rounded text-[11px]',
                    d.matched ? 'bg-green-600 text-white' : 'bg-pb-border text-pb-muted',
                  )}
                >{d.matched ? '✓' : '✗'}</span>
                <span className="text-pb-muted shrink-0">{d.ruleSetName} L{d.lineNo}</span>
                <span className="truncate text-pb-text">{d.pattern}</span>
                <span className="ml-auto text-[10px] text-pb-muted shrink-0">{d.matcherKind}</span>
              </div>
              <div className="mt-1 pl-7 text-[11px] text-pb-muted break-all">{d.reason}</div>
              {d.ops.length > 0 && (
                <div className="mt-0.5 pl-7 text-[10px] text-pb-accent/80 break-all">
                  → {d.ops.map((o) => o.value ? `${o.op}://${o.value}` : o.op).join('  ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 环境横幅：命中的时候用户第一时间要看的信息 —— 「规则模拟匹配了，但实际抓包会不会跑到？」
 * 有三个开关：SSL 解密 / Allow-Block / Record filter。任一失败都会在这里高亮警告。
 */
function EnvBanner({ env }: { env: RuleDebugResult['environment'] }) {
  const items: {ok: boolean; label: string; reason: string }[] = [
    { ok: env.willDecrypt, label: 'SSL 解密', reason: env.willDecryptReason },
    { ok: env.allowBlockAllows, label: 'Allow / Block', reason: env.allowBlockReason || '通过' },
    { ok: env.willRecord, label: '记录到列表', reason: env.willRecordReason },
  ];
  const hasIssue = items.some((i) => !i.ok);
  return (
    <div
      className={cn(
        'px-3 py-2 border-b border-pb-border text-[11px]',
        hasIssue ? 'bg-yellow-950/30' : '',
      )}
      data-testid="rd-env-banner"
    >
      <div className="text-pb-muted mb-1">实际抓包会怎样：</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className={cn('inline-block w-2 h-2 rounded-full', it.ok ? 'bg-green-500' : 'bg-yellow-400')} />
            <span className={cn(it.ok ? 'text-pb-text' : 'text-yellow-300')}>{it.label}：{it.reason}</span>
          </div>
        ))}
      </div>
      {hasIssue && (
        <div className="mt-1 text-yellow-300/80">
          ⚠ 规则可能匹配了，但上述条件会阻止规则真正生效或让flow 不可见。请到对应面板检查。
        </div>
      )}
    </div>
  );
}

function DryRunTab({ result }: { result: RuleDebugResult }) {
  const { dryRun, input } = result;
  return (
    <div className="p-3 space-y-3 text-xs font-mono">
      {dryRun.shortCircuit && (
        <section className="border border-pb-accent/40 rounded p-2 bg-pb-panel">
          <div className="text-pb-accent mb-1">
            短路：{dryRun.shortCircuit.kind === 'respond' ? '直接返回响应（不发上游）' : `中断请求（${dryRun.shortCircuit.reason || '无原因'}）`}
          </div>
          {dryRun.shortCircuit.response && (
            <div className="space-y-1">
              <div className="text-pb-muted">状态：<span className="text-pb-text">{dryRun.shortCircuit.response.status} {dryRun.shortCircuit.response.statusText}</span></div>
              <HeadersBlock headers={dryRun.shortCircuit.response.headers} label="响应头" />
              {dryRun.shortCircuit.response.bodyText != null && (
                <BodyBlock label="响应体" text={dryRun.shortCircuit.response.bodyText} />
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <div className="text-pb-muted mb-1">改写后的请求（pre阶段跑完）</div>
        <div className="text-pb-text">{dryRun.finalRequest.method} {dryRun.finalRequest.url}</div>
        <HeadersBlock headers={dryRun.finalRequest.headers} label="请求头" diffAgainst={input.headers} />
        {dryRun.finalRequest.bodyText != null && dryRun.finalRequest.bodyText !== input.bodyText && (
          <BodyBlock label="请求体（已改写）" text={dryRun.finalRequest.bodyText} />
        )}
      </section>

      {dryRun.error && (
        <div className="text-red-400 border border-red-500/40 rounded p-2">
          执行错误：{dryRun.error}
        </div>
      )}
    </div>
  );
}

function OpsTab({ result }: { result: RuleDebugResult }) {
  const ops = result.dryRun.executedOps;
  if (ops.length === 0) {
    return (
      <div className="p-6 text-xs text-pb-muted text-center">没有匹配的 operator 被执行。</div>
    );
  }
  return (
    <div className="divide-y divide-pb-border/40" data-testid="rd-ops-list">
      {ops.map((o, i) => (
        <div key={i} className="px-3 py-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-pb-muted shrink-0">{o.ruleSetName}</span>
            <span className="text-pb-text">{o.op}{o.value != null ? `://${o.value}` : ''}</span>
            {o.skipped ? (
              <span className="ml-auto text-[10px] text-yellow-400/80">skipped: {o.skipped}</span>
            ) : (
              <span className="ml-auto text-[10px] text-green-400/80">executed</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function HeadersBlock({ headers, label, diffAgainst }: { headers: Header[]; label: string; diffAgainst?: Header[] }) {
  const original = new Map<string, string>();
  if (diffAgainst) for (const h of diffAgainst) original.set(h.name.toLowerCase(), h.value);
  return (
    <div className="mt-1">
      <div className="text-pb-muted text-[10px]">{label}</div>
      <div className="pl-2 text-[11px]">
        {headers.length === 0 ? <span className="text-pb-muted">（无）</span> : headers.map((h, i) => {
          const isNew = diffAgainst && !original.has(h.name.toLowerCase());
          const isChanged = diffAgainst && original.has(h.name.toLowerCase()) && original.get(h.name.toLowerCase()) !== h.value;
          return (
            <div key={i} className={cn('break-all', isNew ? 'text-green-400' : isChanged ? 'text-yellow-300' : 'text-pb-text')}>
              <span className="text-pb-muted">{h.name}: </span>{h.value}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BodyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-1">
      <div className="text-pb-muted text-[10px]">{label}</div>
      <pre className="pl-2 text-[11px] text-pb-text whitespace-pre-wrap break-all max-h-64 overflow-auto pb-scroll">{text}</pre>
    </div>
  );
}

function parseHeadersText(text: string): Header[] {
  const out: Header[] = [];
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

/**
 * 实际抓包结果 vs 模拟匹配结果：
 * - 如果实际 matchedRules 为空但模拟命中了 → 强提示原因（多半是SSL 未MITM / 该flow 在规则加入前就发生了）
 * - 如果都命中且集合一致 → 绿色提示"实际生效"
 * - 集合不一致 → 列出差异
 */
function ActualVsSimulated({
  actual,
  simulatedMatched,
}: {
  actual: NonNullable<RuleDebugInput['actualFlow']>;
  simulatedMatched: RuleMatchDiagnosis[];
}) {
  const actualIds = new Set(actual.matchedRules.map((r) => r.ruleId + '::' + r.pattern));
  const simIds = new Set(simulatedMatched.map((d) => d.ruleSetId + '::' + d.pattern));
  const bothCount = [...simIds].filter((k) => actualIds.has(k)).length;
  const onlySim = [...simIds].filter((k) => !actualIds.has(k));
  const onlyActual = [...actualIds].filter((k) => !simIds.has(k));

  let level: 'good' | 'warn' | 'info' = 'info';
  let title = '';
  if (simulatedMatched.length > 0 && actual.matchedRules.length === 0) {
    level = 'warn';
    title = `模拟匹配 ${simulatedMatched.length} 条规则，但实际抓包时该 flow 未命中任何规则`;
  } else if (simulatedMatched.length === 0 && actual.matchedRules.length === 0) {
    level = 'info';
    title = '模拟和实际都没有命中任何规则';
  } else if (onlySim.length === 0 && onlyActual.length === 0) {
    level = 'good';
    title = `模拟和实际完全一致（${bothCount} 条规则命中）`;
  } else {
    level = 'warn';
    title = `模拟与实际有差异：共同 ${bothCount} 条，仅模拟 ${onlySim.length} 条，仅实际 ${onlyActual.length} 条`;
  }

  const cls =
    level === 'good' ? 'bg-green-950/30 border-green-700/40' :
    level === 'warn' ? 'bg-yellow-950/30 border-yellow-700/40' :
    'bg-pb-panel border-pb-border';

  return (
    <div className={cn('px-3 py-2 border-b', cls)} data-testid="rd-actual-banner">
      <div className="text-[11px] font-semibold text-pb-text mb-1">
        对比这个抓到的 flow（{actual.id.slice(0, 8)}…{actual.responseStatus != null ? ` · 响应 ${actual.responseStatus}` : ''}）
      </div>
      <div className="text-[11px] text-pb-muted mb-1">{title}</div>
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <div className="text-pb-muted">实际命中（抓包时记录）</div>
          {actual.matchedRules.length === 0 ? (
            <div className="text-yellow-400/80 pl-2">— 无 —</div>
          ) : (
            <ul className="pl-2 text-pb-text list-disc list-inside">
              {actual.matchedRules.map((r, i) => (
                <li key={i}><span className="text-pb-muted">{r.ruleName}:</span> {r.pattern}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-pb-muted">模拟命中（用当前规则重跑）</div>
          {simulatedMatched.length === 0 ? (
            <div className="text-pb-muted pl-2">— 无 —</div>
          ) : (
            <ul className="pl-2 text-pb-text list-disc list-inside">
              {simulatedMatched.map((d, i) => (
                <li key={i}><span className="text-pb-muted">{d.ruleSetName}:</span> {d.pattern}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {level === 'warn' && simulatedMatched.length > 0 && actual.matchedRules.length === 0 && (
        <div className="mt-2 text-[11px] text-yellow-300/90">
          可能原因：<br />
          1)该 flow 抓到的时候规则还没添加 —— 试着重发一次这个请求（右键 → 再次发送）<br />
          2) SSL 白名单未包含该 host —— CONNECT 阶段就被直通，规则完全不介入（看下面「实际抓包会怎样」）<br />
          3) 该 host 在 mitm-disable-host 列表里（右键 → 不解密该 host）
        </div>
      )}
    </div>
  );
}
