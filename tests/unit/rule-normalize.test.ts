import { describe, it, expect } from 'vitest';
import { normalizeInlineValue, normalizeRuleText } from '../../electron/engine/rule-normalize';

describe('normalizeInlineValue', () => {
  it('mock：pretty JSON → 单行', () => {
    expect(normalizeInlineValue('mock', '{\n  "a": 1,\n  "b": 2\n}')).toBe('{"a":1,"b":2}');
  });

  it('resBody / reqBody / reqHeaders / resHeaders：同上', () => {
    for (const op of ['resBody', 'reqBody', 'reqHeaders', 'resHeaders']) {
      expect(normalizeInlineValue(op, '{\n  "x": [1, 2]\n}')).toBe('{"x":[1,2]}');
    }
  });

  it('JSON 语法错：退化为清换行+ 折叠空白', () => {
    expect(normalizeInlineValue('mock', 'not-json\n  still-value')).toBe('not-jsonstill-value');
  });

  it('非 JSON operator：只清换行', () => {
    expect(normalizeInlineValue('redirect', 'https://a\n/b')).toBe('https://a/b');
    expect(normalizeInlineValue('host', '127.0.0.1\n:3000')).toBe('127.0.0.1:3000');
  });

  it('raw：拆内层 op 再 minify JSON', () => {
    const raw = 'resHeaders://{\n  "Access-Control-Allow-Origin": "*"\n}';
    expect(normalizeInlineValue('raw', raw)).toBe('resHeaders://{"Access-Control-Allow-Origin":"*"}');
  });

  it('空/ null / undefined 原样', () => {
    expect(normalizeInlineValue('mock', '')).toBe('');
    expect(normalizeInlineValue('mock', undefined)).toBeUndefined();
  });
});

describe('normalizeRuleText', () => {
  it('单行规则透传', () => {
    const t = 'example.com  abort\nx.com  mock://{"a":1}';
    expect(normalizeRuleText(t)).toBe(t);
  });

  it('跨行 JSON 合并成单行', () => {
    const input = 'x.com  mock://{\n  "a": 1,\n  "b": 2\n}';
    // 合并后应该是单行文本；parser 应该能识别
    const out = normalizeRuleText(input);
    expect(out.split('\n').length).toBe(1);
    expect(out).toContain('mock://{');
    expect(out).toContain('"a": 1');
    expect(out).toContain('}');
  });

  it('注释/空行/组标签 透传，跨行 JSON 只合并规则行', () => {
    const input = [
      '# 一个注释',
      '[分组]',
      '',
      'x.com  mock://{',
      '  "a": 1',
      '}',
      'y.com  abort',
    ].join('\n');
    const out = normalizeRuleText(input);
    const lines = out.split('\n');
    expect(lines[0]).toBe('# 一个注释');
    expect(lines[1]).toBe('[分组]');
    expect(lines[2]).toBe('');
    // 第 4 行是合并后的规则
    expect(lines[3]).toMatch(/^x\.com\s+mock:\/\/\{/);
    expect(lines[3]).toContain('}');
    // 最后是 y.com abort
    expect(lines[4]).toBe('y.com  abort');
  });

  it('多条跨行规则', () => {
    const input = [
      'a.com  mock://{',
      '  "x": 1',
      '}',
      'b.com  resBody://{',
      '  "y": 2',
      '}',
    ].join('\n');
    const out = normalizeRuleText(input);
    expect(out.split('\n')).toHaveLength(2);
  });

  it('跨行数组也合并', () => {
    const input = 'x.com  mock://[\n  1,\n  2\n]';
    const out = normalizeRuleText(input);
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toContain('[');
    expect(out).toContain(']');
  });

  it('引号内的换行也合并（防守）', () => {
    // 目前 parser 不支持带真实换行的字符串，但normalize 应该把它们合并成单行
    const input = 'x.com  reqBody://"line1\nline2"';
    const out = normalizeRuleText(input);
    expect(out.split('\n')).toHaveLength(1);
  });

  it('合并后与 rule-parser 兼容：跨行 mock JSON 可正常解析', async () => {
    const { parseRuleSet } = await import('../../electron/engine/rule-parser');
    const input = 'x.com/api  mock://{\n  "a": 1\n}';
    const normalized = normalizeRuleText(input);
    const rs = parseRuleSet('t', 'test', normalized);
    expect(rs.errors).toHaveLength(0);
    expect(rs.rules).toHaveLength(1);
    expect(rs.rules[0].ops[0].op).toBe('mock');
  });
});
