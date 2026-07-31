/**
 * whistle 兼容规则文本解析器。
 *
 * 语法（简化并兼容 whistle 主要形态）：
 *   # 行注释
 *   [组名]                              可选，仅分组
 *   <pattern> <op1>[://value] [op2 ...]  一条规则
 *
 * pattern 支持:
 *   - 完整 URL 前缀:   https://api.example.com/foo
 *   - host 前缀:       example.com/foo
 *   - 通配:            *.example.com  或  path glob 结尾 /*
 *   - 正则:            /regex/[flags]
 *
 * operator 支持（内置）:
 *   statusCode://<n>
 *   redirect://<url>
 *   abort
 *   reqHeaders://<json>       merge 请求头
 *   resHeaders://<json>       merge 响应头
 *   reqBody://<text>          替换请求体
 *   resBody://<text>          替换响应体
 *   host://<ip[:port]>        改上游 host
 *   file://<abs-path>         用本地文件替代响应体
 *   reqDelay://<ms>
 *   resDelay://<ms>
 *   log                       记录日志
 *   mock://<json>             json.stringify 后返回
 *   ua://<value>              替换 User-Agent
 *   referer://<value>
 */

export type PatternMatcher =
  | { kind: 'regex'; regex: RegExp }
  | { kind: 'prefix'; prefix: string; scheme?: 'http' | 'https' }
  | { kind: 'glob'; regex: RegExp };

export interface RuleOperator {
  op: string;
  value?: string;
}

export interface Rule {
  raw: string;
  lineNo: number;
  group?: string;
  pattern: string;
  matcher: PatternMatcher;
  ops: RuleOperator[];
}

export interface RuleSet {
  id: string;
  name: string;
  enabled: boolean;
  text: string;
  rules: Rule[];
  errors: { lineNo: number; message: string }[];
  /** 临时规则集：由 Sidebar 右键"快速规则"创建，规则页独立 sub-tab 展示 */
  temporary?: boolean;
}

const KNOWN_OPS = new Set([
  'statusCode', 'redirect', 'abort',
  'reqHeaders', 'resHeaders',
  'reqBody', 'resBody',
  'host', 'file', 'mock', 'tpl',
  'reqDelay', 'resDelay',
  'log',
  'ua', 'referer',
  'req', 'res',                      // 转发到其他 URL
  'breakpoint',                      // 断点：暂停并允许 UI 编辑
  'script',                          // 用户脚本：script://<id-or-name>
  'throttle',                        // 限速预设：throttle://3g
  'block',                           // 阻止（黑名单模式）：block  或 block://reason
  'allow',                           // 允许（白名单模式，配合 allow-list 使用）
]);

export function parseRuleSet(id: string, name: string, text: string, enabled = true): RuleSet {
  const rules: Rule[] = [];
  const errors: RuleSet['errors'] = [];
  let group: string | undefined;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      group = line.slice(1, -1).trim();
      continue;
    }
    try {
      const rule = parseLine(raw, i, group);
      if (rule) rules.push(rule);
    } catch (err: any) {
      errors.push({ lineNo: i + 1, message: err.message });
    }
  }
  return { id, name, enabled, text, rules, errors };
}

function parseLine(raw: string, lineNo: number, group?: string): Rule | null {
  const line = raw.trim();
  // pattern = 第一个空白前的 token
  const firstWs = line.search(/\s/);
  if (firstWs < 0) throw new Error('规则至少需要 pattern + 一个 operator');
  const pattern = line.slice(0, firstWs);
  const matcher = compileMatcher(pattern);
  const rest = line.slice(firstWs).trim();

  const ops = tokenizeOps(rest);
  if (ops.length === 0) throw new Error('规则至少需要一个 operator');
  for (const o of ops) {
    if (!KNOWN_OPS.has(o.op)) throw new Error(`未知操作符: ${o.op}`);
  }
  return { raw, lineNo: lineNo + 1, group, pattern, matcher, ops };
}

/**
 * 解析操作符序列。支持值中含空格：
 * - 值以 { 或 [ 开头 → 消费到括号平衡（JSON，允许空格）
 * - 值以 " 开头 → 消费到闭合引号
 * - 否则消费到下一个空白
 */
function tokenizeOps(s: string): RuleOperator[] {
  const ops: RuleOperator[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    // 读 op 名（到 :// 或空白）
    let j = i;
    while (j < n && !/\s/.test(s[j]) && s.slice(j, j + 3) !== '://') j++;
    const op = s.slice(i, j);
    let value: string | undefined;
    if (s.slice(j, j + 3) === '://') {
      j += 3;
      const start = j;
      const first = s[j];
      if (first === '{' || first === '[') {
        // 括号平衡
        const open = first, close = first === '{' ? '}' : ']';
        let depth = 0, inStr = false, esc = false;
        for (; j < n; j++) {
          const c = s[j];
          if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
          else if (c === '"') inStr = true;
          else if (c === open) depth++;
          else if (c === close) { depth--; if (depth === 0) { j++; break; } }
        }
        value = s.slice(start, j);
      } else if (first === '"') {
        j++;
        let esc = false;
        for (; j < n; j++) { const c = s[j]; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') { j++; break; } }
        value = s.slice(start + 1, j - 1);
      } else {
        while (j < n && !/\s/.test(s[j])) j++;
        value = s.slice(start, j);
      }
    }
    ops.push({ op, value });
    i = j;
  }
  return ops;
}

function compileMatcher(pattern: string): PatternMatcher {
  // 正则形式 /regex/flags
  if (pattern.startsWith('/') && pattern.length > 2) {
    const last = pattern.lastIndexOf('/');
    if (last > 0) {
      const body = pattern.slice(1, last);
      const flags = pattern.slice(last + 1);
      return { kind: 'regex', regex: new RegExp(body, flags || undefined) };
    }
  }

  // 含 * 的 glob
  if (pattern.includes('*')) {
    const src = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return { kind: 'glob', regex: new RegExp('^' + src) };
  }

  // 前缀
  let scheme: 'http' | 'https' | undefined;
  let prefix = pattern;
  if (pattern.startsWith('https://')) { scheme = 'https'; prefix = pattern.slice(8); }
  else if (pattern.startsWith('http://')) { scheme = 'http'; prefix = pattern.slice(7); }
  return { kind: 'prefix', prefix, scheme };
}

export function matchRule(rule: Rule, url: string, scheme: 'http' | 'https', hostPath: string): boolean {
  switch (rule.matcher.kind) {
    case 'regex': return rule.matcher.regex.test(url);
    case 'glob': return rule.matcher.regex.test(url);
    case 'prefix':
      if (rule.matcher.scheme && rule.matcher.scheme !== scheme) return false;
      return hostPath.startsWith(rule.matcher.prefix);
  }
}
