/**
 * 规则文本 normalization：把用户输入里可能出现的裸换行压平成单行。
 *
 * 背景：whistle规则语法是"一行一条"，parser 直接 `text.split(/\r?\n/)` 逐行解析。
 * 但用户在快速规则表单里编辑 JSON （mock/resBody/reqBody/reqHeaders/resHeaders）
 * 时，Monaco JSON 编辑器可能带pretty-print 换行；如果直接拼进规则文本，parser 会
 * 把第二行当独立规则报未知操作符错，导致该 mock 完全不生效。
 *
 * 这里提供两类工具：
 *
 *   1. normalizeInlineValue(op, value)：单个 operator 的 value 压平。JSON 类
 *      operator 尝试 `JSON.parse` + `JSON.stringify` 得到最紧凑的单行形式；
 *      失败则退化为「移除所有换行 + 折叠后续空白」。
 *
 *   2. normalizeRuleText(text)：整段规则文本压平。逐行扫描，识别每一行末尾
 *      是否有未闭合的 `{...}` / `[...]` / `"..."`，若有则把后续续行合并进来
 *      再 minify。这样即使用户手动在 RulesView 里Enter 拆行 JSON，也能保存
 *      成有效的单行规则。
 *
 * 注意：只对 JSON 类 operator 做parse；其他类型 operator 的 value（URL、路径、
 * 数字等）不应该出现换行，遇到也一律清掉换行。
 */

const JSON_OPS = new Set([
  'mock',
  'resBody',
  'reqBody',
  'reqHeaders',
  'resHeaders',
  'raw', // rules:quick-add 的一键CORS 走 raw，value 本身是完整 operator 段
]);

/**
 * 对单个 operator value 做换行规范化。
 *
 * @param op   quick-add 的 operator 名（含 'raw' 和 'mapRemote'等特殊值）
 * @param value 用户输入的 value（可能含换行）
 * @returns 规范化后的单行 value；null/undefined 原样返回
 */
export function normalizeInlineValue(op: string, value?: string): string | undefined {
  if (value == null) return value;
  const s = String(value);
  if (s === '') return s;
  //raw 类型 value 可能是形如 `resHeaders://{...}` 的完整 operator 段：尝试拆出
  // op 段再对内部 JSON 做 minify
  if (op === 'raw') {
    const m = s.match(/^(\w+):\/\/([\s\S]*)$/);
    if (m) {
      const innerOp = m[1];
      const innerVal = m[2];
      const norm = normalizeInlineValue(innerOp, innerVal);
      return `${innerOp}://${norm ?? ''}`;
    }
    // 没匹配到就 fall through到通用去换行
  }
  if (JSON_OPS.has(op)) {
    try {
      return JSON.stringify(JSON.parse(s));
    } catch {
      // fallthrough
    }
  }
  //所有非 JSON 类 value：清掉所有 CRLF/LF 及紧随的空白折叠
  return s.replace(/\r?\n\s*/g, '');
}

/**
 * 对整段规则文本做换行规范化。用于 RulesView 里用户手动输入的规则集在保存前
 * （rules:add / rules:update）做兜底：合并跨行的 `{...}` / `[...]` / `"..."` 值。
 *
 * 算法：
 *   - 逐行；空行/注释/组标签直接透传
 *   - 其他行视为规则行：检测该行是否有「未闭合的 JSON/quoted 值」（用 `{`/`[`/`"`
 *     的括号平衡状态判定）；如果有，就把后续行也concat 进来，直到平衡为止
 *   - concat 时把 `\n` 及紧随的空白都吞掉
 *   - 最后对合并后的行做 `String.trimEnd()`
 */
export function normalizeRuleText(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    // 空行/注释/组标签：透传
    if (trimmed === '' || trimmed.startsWith('#') || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      out.push(raw);
      i++;
      continue;
    }
    let acc = raw;
    // 若当前行括号/引号不平衡，继续吞后续行
    while (!isBalanced(acc) && i + 1 < lines.length) {
      i++;
      acc = acc + lines[i].replace(/^\s+/, '');
    }
    out.push(acc);
    i++;
  }
  return out.join('\n');
}

/**
 * 检测字符串里 `{}` / `[]` / `"..."` 是否成对闭合。
 * 用于判断规则行末尾是否有未闭合的 JSON/quoted 段。
 */
function isBalanced(s: string): boolean {
  let curly = 0;
  let square = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') curly++;
    else if (c === '}') curly--;
    else if (c === '[') square++;
    else if (c === ']') square--;
  }
  return !inStr && curly === 0 && square === 0;
}
