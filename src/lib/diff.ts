/**
 * 轻量 diff（Myers）：给定两段文本，按行返回 diff 段。
 * 用于 UI 里对比两个 flow 的 headers/body。
 */

export type DiffOp = 'eq' | 'add' | 'del';
export interface DiffLine {
  op: DiffOp;
  a?: string;    // 原始行（del/eq）
  b?: string;    // 目标行（add/eq）
}

/** 单向 LCS，做行级 diff。文本量大时可以 fallback 到简单相等比较。 */
export function diffLines(aText: string, bText: string): DiffLine[] {
  const a = aText.split(/\r?\n/);
  const b = bText.split(/\r?\n/);
  const n = a.length, m = b.length;
  // 大文件退化：直接逐行相等对比，避免 O(nm) 爆内存
  if (n * m > 400_000) {
    const out: DiffLine[] = [];
    const len = Math.max(n, m);
    for (let i = 0; i < len; i++) {
      const x = a[i]; const y = b[i];
      if (x === y) out.push({ op: 'eq', a: x, b: y });
      else {
        if (x !== undefined) out.push({ op: 'del', a: x });
        if (y !== undefined) out.push({ op: 'add', b: y });
      }
    }
    return out;
  }
  // LCS 动态规划
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: 'eq', a: a[i], b: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: 'del', a: a[i] }); i++; }
    else { out.push({ op: 'add', b: b[j] }); j++; }
  }
  while (i < n) { out.push({ op: 'del', a: a[i++] }); }
  while (j < m) { out.push({ op: 'add', b: b[j++] }); }
  return out;
}
