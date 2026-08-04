/**
 * Rule Debug 引擎：给定一个模拟请求，说明每条规则是否命中、为何命中/未命中，
 * 并dry-run 一遍匹配到的 operator middleware，展示改写后的请求/响应快照。
 *
 * 关键设计：
 *   - 遍历所有 rule set（含disabled），逐条给出 reason
 *   - 对危险 operator（有外部依赖：file/script/breakpoint/reqDelay/resDelay/throttle/block/allow/req/res）
 *     使用 stub middleware，只在 executedOps 里记录 skipped，不真的调用实现
 *   - 其他"纯本地"operator 直接复用 buildOpsMiddlewares 里的真实实现
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { Middleware, ProxyContext, runMiddlewares } from './context';
import { matchRule, type Rule, type RuleOperator, type RuleSet } from './rule-parser';
import { buildOpsMiddlewares } from './operators';
import { getSslListStore } from './ssl-list';
import { getAllowBlockStore } from './allow-block';
import { getRecordFilterStore } from './record-filter';
import type {
  Header,
  RuleDebugInput,
  RuleDebugResult,
  RuleMatchDiagnosis,
  RuleDebugOpTrace,
} from '../../shared/types';

/** 只用来读规则列表 —— 允许注入任意 shape 兼容的对象（便于单测）。 */
export interface RuleSource {
  list(): RuleSet[];
}

/** 环境诊断依赖的可选接口 —— 主进程会自动接管，单测可留空。 */
export interface EnvironmentProbes {
  sslWillDecrypt?: (host: string) => {ok: boolean; reason: string };
  allowBlockAllows?: (host: string, url: string, method: string) => { allow: boolean; reason?: string };
  recordFilterAllows?: (host: string, url: string, method: string) => { record: boolean; reason: string };
}

/** 有外部依赖、不能在 dry-run 里安全执行的 operator。 */
const UNSAFE_OPS = new Set([
  'file',
  'script',
  'breakpoint',
  'reqDelay',
  'resDelay',
  'throttle',
  'block',
  'allow',
  'req',
  'res',
]);

/**
 * 主入口。engine 只用来读规则列表，不改任何状态。
 */
export async function debugRules(engine: RuleSource, input: RuleDebugInput, probes: EnvironmentProbes = {}): Promise<RuleDebugResult> {
  const parsed = normalizeInput(input);
  const { url, method, scheme, headers, bodyText } = parsed;
  const hostPath = extractHostPath(url);
  const host = extractHost(url);

  const environment = probeEnvironment(host, url, method, scheme, probes);

  const sets = engine.list();
  const diagnoses: RuleMatchDiagnosis[] = [];
  const matchedRules: Array<{ rule: Rule; setName: string }> = [];

  for (const set of sets) {
    for (const rule of set.rules) {
      const diag = diagnose(rule, url, scheme, hostPath, {
        setId: set.id,
        setName: set.name,
        setEnabled: set.enabled,
      });
      diagnoses.push(diag);
      if (diag.matched && set.enabled) matchedRules.push({ rule, setName: set.name });
    }
  }

  // dry-run
  const executedOps: RuleDebugOpTrace[] = [];
  const middlewares: Middleware[] = [];
  for (const { rule, setName } of matchedRules) {
    for (const op of rule.ops) {
      if (UNSAFE_OPS.has(op.op)) {
        middlewares.push(makeStubMiddleware(op, setName, executedOps));
      } else {
        // 真实 middleware，但用一个 wrapper 记录执行
        const [mw] = buildOpsMiddlewares([op]);
        if (mw) {
          middlewares.push(async (ctx, next) => {
            executedOps.push({ op: op.op, value: op.value, ruleSetName: setName });
            await mw(ctx, next);
          });
        }
      }
    }
  }

  const ctx = makeDryRunContext(parsed);

  let error: string | undefined;
  try {
    await runMiddlewares(ctx, middlewares);
  } catch (err: any) {
    error = err?.message || String(err);
  }

  const shortCircuit = ctx.short
    ? ctx.short.kind === 'respond'
      ? {
          kind: 'respond' as const,
          response: {
            status: ctx.short.response.status,
            statusText: ctx.short.response.statusText,
            headers: ctx.short.response.headers,
            bodyText: ctx.short.response.bodyText,
            bodySize: ctx.short.response.bodySize,
            contentType: ctx.short.response.contentType,
          },
        }
      : {
          kind: 'abort' as const,
          reason: ctx.short.reason,
        }
    : undefined;

  const finalResponse =
    shortCircuit?.kind === 'respond'
      ? {
          status: shortCircuit.response!.status,
          statusText: shortCircuit.response!.statusText,
          headers: shortCircuit.response!.headers,
          bodyText: shortCircuit.response!.bodyText,
        }
      : undefined;

  return {
    input: { url, method, scheme, headers, bodyText },
    environment,
    diagnoses,
    dryRun: {
      shortCircuit,
      finalRequest: {
        method: ctx.request.method,
        url: ctx.request.url,
        headers: ctx.request.headers,
        bodyText: ctx.request.bodyText,
      },
      finalResponse,
      executedOps,
      error,
    },
  };
}

/**
 * 主进程默认 probes：读取当前 SSL/AllowBlock/RecordFilter store 状态。
 * 单测里可以不传，得到全 true 的中性诊断。
 */
export function defaultProbes(): EnvironmentProbes {
  return {
    sslWillDecrypt: (host) => {
      const ssl = getSslListStore();
      if (!ssl) return { ok: true, reason: 'SSL 名单未配置，默认解密' };
      const cfg = ssl.get();
      if (!cfg.enabled) return { ok: false, reason: 'SSL 解密总开关已关闭（面板：SSL Decrypt List）' };
      if (cfg.mode === 'all') return { ok: true, reason: '模式为「全部解密」' };
      const ok = ssl.shouldDecrypt({ host });
      return ok
        ? { ok: true, reason: `模式为「${cfg.mode}」，${host} 命中` }
        : { ok: false, reason: `模式为「${cfg.mode}」，${host} 未命中 —— CONNECT 会直通，规则不会生效` };
    },
    allowBlockAllows: (host, url, method) => {
      const ab = getAllowBlockStore();
      if (!ab) return { allow: true };
      return ab.decide({ host, url, method });
    },
    recordFilterAllows: (host, url, method) => {
      const rf = getRecordFilterStore();
      if (!rf) return { record: true, reason: 'Record filter 未配置' };
      const cfg = rf.get();
      if (cfg.mode === 'all') return { record: true, reason: '模式为「全部记录」' };
      const ok = rf.shouldRecord({ host, url, method });
      return ok
        ? { record: true, reason: `模式为「${cfg.mode}」，命中` }
        : { record: false, reason: `模式为「${cfg.mode}」，未命中 —— 请求正常代理但不会出现在 flow 列表` };
    },
  };
}

function probeEnvironment(
  host: string,
  url: string,
  method: string,
  scheme: 'http' | 'https',
  probes: EnvironmentProbes,
): RuleDebugResult['environment'] {
  // HTTP 无所谓 MITM
  const sslProbe = probes.sslWillDecrypt;
  const ssl = scheme === 'http'
    ? { ok: true, reason: 'HTTP 无需解密' }
    : sslProbe
      ? sslProbe(host)
      : { ok: true, reason: '无 SSL 探针（单测模式）' };

  const abProbe = probes.allowBlockAllows;
  const ab = abProbe ? abProbe(host, url, method) : { allow: true };

  const rfProbe = probes.recordFilterAllows;
  const rf = rfProbe ? rfProbe(host, url, method) : { record: true, reason: '无 record filter 探针' };

  return {
    willDecrypt: ssl.ok,
    willDecryptReason: ssl.reason,
    allowBlockAllows: ab.allow,
    allowBlockReason: ab.reason,
    willRecord: rf.record,
    willRecordReason: rf.reason,
  };
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeInput(input: RuleDebugInput): {
  url: string;
  method: string;
  scheme: 'http' | 'https';
  headers: Header[];
  bodyText: string;
} {
  const url = input.url || '';
  let scheme: 'http' | 'https' = input.scheme || 'https';
  if (!input.scheme) {
    if (url.startsWith('http://')) scheme = 'http';
    else if (url.startsWith('https://')) scheme = 'https';
  }
  return {
    url,
    method: (input.method || 'GET').toUpperCase(),
    scheme,
    headers: input.headers? input.headers.map((h) => ({ name: h.name, value: h.value })) : [],
    bodyText: input.bodyText || '',
  };
}

/** 从 url抽出 host + path，用于 prefix matcher。 */
function extractHostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}${u.search}`;
  } catch {
    // 兼容不带scheme 的输入：直接返回原串（很少见）
    return url.replace(/^https?:\/\//, '');
  }
}

/** 对单条规则给出匹配结论+ 一句话原因。 */
function diagnose(
  rule: Rule,
  url: string,
  scheme: 'http' | 'https',
  hostPath: string,
  set: { setId: string; setName: string; setEnabled: boolean },
): RuleMatchDiagnosis {
  const base = {
    ruleSetId: set.setId,
    ruleSetName: set.setName,
    ruleSetEnabled: set.setEnabled,
    lineNo: rule.lineNo,
    raw: rule.raw,
    pattern: rule.pattern,
    matcherKind: rule.matcher.kind,
    ops: rule.ops.map((o) => ({ op: o.op, value: o.value })),
  };

  if (!set.setEnabled) {
    return { ...base, matched: false, reason: '规则集已禁用' };
  }

  const matched = matchRule(rule, url, scheme, hostPath);
  const reason = explainMatch(rule, url, scheme, hostPath, matched);
  return { ...base, matched, reason };
}

function explainMatch(
  rule: Rule,
  url: string,
  scheme: 'http' | 'https',
  hostPath: string,
  matched: boolean,
): string {
  const m = rule.matcher;
  switch (m.kind) {
    case 'regex':
      return matched
        ? `正则命中（/${m.regex.source}/${m.regex.flags}）`
        : `正则未命中：url="${url}" 不匹配 /${m.regex.source}/${m.regex.flags}`;
    case 'glob':
      return matched
        ? `Glob 命中（${rule.pattern}）`
        : `Glob 未命中：url="${url}" 不匹配 ${rule.pattern}`;
    case 'prefix': {
      if (m.scheme && m.scheme !== scheme) {
        return `Scheme 不匹配：规则要求 ${m.scheme}，请求为 ${scheme}`;
      }
      if (!hostPath.startsWith(m.prefix)) {
        return `路径前缀不匹配：规则 "${m.prefix}" 不是 "${hostPath}" 的前缀`;
      }
      return `前缀命中："${m.prefix}"匹配 "${hostPath}"`;
    }
  }
}

/** 危险 op 的 stub —— 只记录，不执行。 */
function makeStubMiddleware(op: RuleOperator, setName: string, trace: RuleDebugOpTrace[]): Middleware {
  return async (_ctx, next) => {
    trace.push({
      op: op.op,
      value: op.value,
      ruleSetName: setName,
      skipped: '外部依赖，debug 模式已跳过',
    });
    await next();
  };
}

/** 构造一个 dry-run 用的 ProxyContext。clientReq 用最小EventEmitter 桩替代。 */
function makeDryRunContext(input: {
  url: string;
  method: string;
  scheme: 'http' | 'https';
  headers: Header[];
  bodyText: string;
}): ProxyContext {
  let host = '';
  let path = '/';
  try {
    const u = new URL(input.url);
    host = u.hostname;
    path = u.pathname + u.search;
  } catch {
    host = '';
    path = '/';
  }
  const bodyBuffer = Buffer.from(input.bodyText, 'utf8');
  // clientReq 桩：中间件里若访问 headers/method 也能读到点东西；不支持真的读体。
  const stub = new EventEmitter() as unknown as IncomingMessage;
  (stub as any).method = input.method;
  (stub as any).headers = Object.fromEntries(input.headers.map((h) => [h.name.toLowerCase(), h.value]));
  (stub as any).url = path;

  return new ProxyContext({
    request: {
      method: input.method,
      url: input.url,
      host,
      path,
      scheme: input.scheme,
      httpVersion: '1.1',
      headers: input.headers.map((h) => ({ name: h.name, value: h.value })),
      bodySize: bodyBuffer.length,
      bodyText: input.bodyText || undefined,
      bodyBuffer,
      startedAt: Date.now(),
    },
    isTLS: input.scheme === 'https',
    flowId: 'debug',
    clientReq: stub,
  });
}
