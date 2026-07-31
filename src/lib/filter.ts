import type { Flow } from '../../shared/types';
import type { FilterState, SearchScope, SearchMode, AdvancedFilter, AdvancedRule } from '../store/flows';

export function matchFilter(
  flow: Flow,
  filter: FilterState,
  sets?: { pinnedIds?: Record<string, true>; savedIds?: Record<string, true> },
): boolean {
  if (filter.special === 'pinned' && !sets?.pinnedIds?.[flow.id]) return false;
  if (filter.special === 'saved' && !sets?.savedIds?.[flow.id]) return false;
  if (filter.appName) {
    const name = flow.app?.name;
    if (filter.appName === '未知') {
      // "未知" 分组对应没有 app.name 的 flow
      if (name) return false;
    } else if (name !== filter.appName) {
      return false;
    }
  }
  if (filter.host && flow.request.host !== filter.host) return false;
  if (filter.pathPrefix) {
    const hp = `${flow.request.host}${flow.request.path}`;
    if (!hp.startsWith(filter.pathPrefix)) return false;
  }

  const ct = (flow.response?.contentType || flow.request.contentType || '').toLowerCase();
  const scheme = flow.request.scheme;
  const status = flow.response?.status ?? -1;
  switch (filter.type) {
    case 'all':
      break;
    case 'http':
      if (scheme !== 'http') return false;
      break;
    case 'https':
      if (scheme !== 'https') return false;
      break;
    case 'websocket':
      if (!flow.isWebSocket && !/websocket/i.test(ct)) return false;
      break;
    case 'json':
      if (!/json/i.test(ct)) return false;
      break;
    case 'form':
      if (!/x-www-form-urlencoded|multipart\/form-data/i.test(ct)) return false;
      break;
    case 'xml':
      if (!/xml/i.test(ct)) return false;
      break;
    case 'js':
      if (!/javascript|ecmascript/i.test(ct)) return false;
      break;
    case 'css':
      if (!/text\/css/i.test(ct)) return false;
      break;
    case 'graphql':
      if (!/graphql/i.test(ct) && !/\/graphql/i.test(flow.request.path)) return false;
      break;
    case 'doc':
      if (!/text\/html|application\/pdf/i.test(ct)) return false;
      break;
    case 'media':
      if (!/^(image|audio|video)\//i.test(ct)) return false;
      break;
    case 'other':
      break;
    case '1xx':
      if (!(status >= 100 && status < 200)) return false;
      break;
    case '2xx':
      if (!(status >= 200 && status < 300)) return false;
      break;
    case '3xx':
      if (!(status >= 300 && status < 400)) return false;
      break;
    case '4xx':
      if (!(status >= 400 && status < 500)) return false;
      break;
    case '5xx':
      if (!(status >= 500 && status < 600)) return false;
      break;
  }

  if (filter.enabled !== false && filter.text) {
    const scope = filter.scope || 'url';
    const mode = filter.mode || 'contains';
    if (!matchText(flow, filter.text, scope, mode)) return false;
  }
  if (filter.advanced && filter.advanced.rules.length) {
    if (!evalAdvanced(flow, filter.advanced)) return false;
  }
  return true;
}

function evalAdvanced(flow: Flow, adv: AdvancedFilter): boolean {
  const results = adv.rules.map((r) => evalRule(flow, r));
  if (adv.combinator === 'AND') return results.every(Boolean);
  return results.some(Boolean);
}

function evalRule(flow: Flow, r: AdvancedRule): boolean {
  const values = fieldValues(flow, r);
  const hit = values.some((v) => opMatch(v, r.op, r.value));
  return r.negate ? !hit : hit;
}

function fieldValues(flow: Flow, r: AdvancedRule): string[] {
  switch (r.field) {
    case 'url': return [flow.request.url];
    case 'method': return [flow.request.method];
    case 'status': return [String(flow.response?.status ?? '')];
    case 'host': return [flow.request.host];
    case 'path': return [flow.request.path];
    case 'contentType':
      return [flow.request.contentType || '', flow.response?.contentType || ''];
    case 'reqBody': return [flow.request.bodyText || ''];
    case 'respBody': return [flow.response?.bodyText || ''];
    case 'reqHeader': {
      const name = (r.headerName || '').toLowerCase();
      if (!name) return flow.request.headers.map((h) => `${h.name}: ${h.value}`);
      return flow.request.headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
    }
    case 'respHeader': {
      const name = (r.headerName || '').toLowerCase();
      const headers = flow.response?.headers || [];
      if (!name) return headers.map((h) => `${h.name}: ${h.value}`);
      return headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
    }
  }
}

function opMatch(value: string, op: AdvancedRule['op'], target: string): boolean {
  switch (op) {
    case 'contains': return value.toLowerCase().includes(target.toLowerCase());
    case 'equals': return value === target;
    case 'notEquals': return value !== target;
    case 'startsWith': return value.startsWith(target);
    case 'endsWith': return value.endsWith(target);
    case 'regex': try { return new RegExp(target, 'i').test(value); } catch { return false; }
    case 'gt': return Number(value) > Number(target);
    case 'lt': return Number(value) < Number(target);
  }
}

function matchText(flow: Flow, query: string, scope: SearchScope, mode: SearchMode): boolean {
  const targets = getScopeValues(flow, scope);
  return targets.some((t) => matchOne(t, query, mode));
}

function getScopeValues(flow: Flow, scope: SearchScope): string[] {
  switch (scope) {
    case 'url':
      return [flow.request.url];
    case 'reqHeaders':
      return flow.request.headers.map((h) => `${h.name}: ${h.value}`);
    case 'respHeaders':
      return (flow.response?.headers || []).map((h) => `${h.name}: ${h.value}`);
    case 'body':
      return [flow.request.bodyText || '', flow.response?.bodyText || ''];
    case 'method':
      return [flow.request.method];
    case 'status':
      return [String(flow.response?.status ?? '')];
  }
}

function matchOne(value: string, query: string, mode: SearchMode): boolean {
  if (!value) return false;
  if (mode === 'equals') return value === query;
  if (mode === 'regex') {
    try { return new RegExp(query, 'i').test(value); }
    catch { return false; }
  }
  return value.toLowerCase().includes(query.toLowerCase());
}

export function statusColor(status: number): string {
  if (status >= 500) return 'bg-pb-error/20 text-pb-error';
  if (status >= 400) return 'bg-pb-warn/20 text-pb-warn';
  if (status >= 300) return 'bg-pb-accent/20 text-pb-accent';
  if (status >= 200) return 'bg-pb-success/20 text-pb-success';
  return 'bg-pb-muted/20 text-pb-muted';
}

export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'bg-pb-success/20 text-pb-success';
    case 'POST': return 'bg-pb-accent/20 text-pb-accent';
    case 'PUT': return 'bg-yellow-600/20 text-yellow-400';
    case 'DELETE': return 'bg-pb-error/20 text-pb-error';
    case 'PATCH': return 'bg-purple-600/20 text-purple-400';
    default: return 'bg-pb-muted/20 text-pb-muted';
  }
}

/**
 * flow 是否仍处于「活跃」状态（连接未关闭 / 正在传输）。
 *  - CONNECT 隧道：只要还没 end 就活跃（durationMs 会在 end 时被写入）
 *  - WebSocket：response 已回但连接持续；status !== 'completed' | 'error' 视为活跃
 *  - SSE / 普通 HTTP：status 为 pending/headers/streaming 视为活跃
 */
export function isFlowActive(flow: Flow): boolean {
  if (flow.status === 'completed' || flow.status === 'error') return false;
  return true;
}
