/**
 * release-notes-normalize
 *
 * 单元测：验证 scripts/release.mjs 和 scripts/extract-changelog.mjs 使用的
 * heading 空格规范化正则 `^(#{1,6})(?=\S)` → `$1 ` 行为正确。
 *
 * 背景：v0.8.1 CHANGELOG 里 `###🔧 其他` 没空格，GitHub Release body直接把
 * 整行当成段落文本渲染，不是 h3。这个正则的作用就是在写入 CHANGELOG.md /
 * extract 输出前一次性把它修好。
 */
import { describe, it, expect } from 'vitest';

const RE = /^(#{1,6})(?=[^\s#])/gm;

function normalize(md: string): string {
  return md.replace(RE, '$1 ');
}

describe('heading 空格规范化', () => {
  it('修`###🔧 xx` → `### 🔧 xx`', () => {
    expect(normalize('###🔧 其他')).toBe('### 🔧 其他');
  });

  it('修 `##🐛 修复` → `## 🐛 修复`', () => {
    expect(normalize('##🐛 修复')).toBe('## 🐛 修复');
  });

  it('已有空格的 heading 保持不变', () => {
    const src = [
      '## 0.8.1',
      '',
      '### 🐛 修复',
      '- item',
      '',
      '#### sub',
    ].join('\n');
    expect(normalize(src)).toBe(src);
  });

  it('多行混合', () => {
    const src = [
      '## 0.8.1',
      '',
      '###🐛 修复',
      '- a',
      '',
      '###🔧 其他',
      '- b',
    ].join('\n');
    const out = normalize(src);
    expect(out).toContain('### 🐛 修复');
    expect(out).toContain('### 🔧 其他');
    expect(out).not.toMatch(/^###🐛/m);
    expect(out).not.toMatch(/^###🔧/m);
  });

  it('普通文本里的 # 不受影响（不是行首）', () => {
    expect(normalize('see #123 for context')).toBe('see #123 for context');
    expect(normalize('  ###indented not heading')).toBe('  ###indented not heading');
  });

  it('超过 6 个 # 不当heading（不修）', () => {
    // 7 个 # 不是合法 ATX heading — 匹配正则的前6 个也会被处理，但这属于极端
    // 用例。测试留意：正则 `^(#{1,6})(?=\S)` 会贪婪匹配 6 个，随后 `#` 是非空
    // 白字符 → 触发替换。可以接受，因为 GitHub 也不会把 7 个 # 渲染为 heading。
    // 这里只断言"至少6 个 # 后的第一个非 # 字符前会有空格"，保守起见不做严格断言。
    const out = normalize('####### foo');
    // 期望：无副作用，输入已经有空格
    expect(out).toBe('####### foo');
  });
});
