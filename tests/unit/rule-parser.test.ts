import { describe, it, expect } from 'vitest';
import { parseRuleSet, matchRule } from '../../electron/engine/rule-parser';

describe('规则解析', () => {
  it('解析多规则、跳过错误行、记录错误、组名', () => {
    const rs = parseRuleSet('r', 'n', [
      '# comment',
      '[组A]',
      'a.com/x  statusCode://404  resHeaders://{"X":"1"}',
      'badop  unknownop',
      'https://s.com/  redirect://https://t.com',
    ].join('\n'));
    expect(rs.rules).toHaveLength(2);
    expect(rs.errors).toHaveLength(1);
    expect(rs.rules[0].group).toBe('组A');
    expect(rs.rules[0].ops).toHaveLength(2);
  });

  it('前缀匹配器区分 scheme', () => {
    const rs = parseRuleSet('r', 'n', 'https://s.com/  abort');
    expect(rs.rules[0].matcher.kind).toBe('prefix');
    expect(matchRule(rs.rules[0], 'http://s.com/', 'http', 's.com/')).toBe(false);
    expect(matchRule(rs.rules[0], 'https://s.com/a', 'https', 's.com/a')).toBe(true);
  });

  it('glob 匹配', () => {
    const rs = parseRuleSet('r', 'n', '*.foo.com/*  abort');
    expect(rs.rules[0].matcher.kind).toBe('glob');
    expect(matchRule(rs.rules[0], 'https://a.foo.com/x', 'https', 'a.foo.com/x')).toBe(true);
  });

  it('正则匹配', () => {
    const rs = parseRuleSet('r', 'n', '/bar\\/(\\d+)/  abort');
    expect(rs.rules[0].matcher.kind).toBe('regex');
    expect(matchRule(rs.rules[0], 'https://z.com/bar/123', 'https', 'z.com/bar/123')).toBe(true);
  });

  it('不匹配其他 host', () => {
    const rs = parseRuleSet('r', 'n', 'api.example.com/user  abort');
    expect(matchRule(rs.rules[0], 'https://other.com/user', 'https', 'other.com/user')).toBe(false);
  });

  it('操作符值含空格（JSON）不被切断', () => {
    const rs = parseRuleSet('r', 'n', 'a.com  reqHeaders://{"Authorization":"Bearer T","X-A":"1"}');
    expect(rs.errors).toHaveLength(0);
    expect(rs.rules[0].ops).toHaveLength(1);
    expect(rs.rules[0].ops[0].op).toBe('reqHeaders');
    expect(JSON.parse(rs.rules[0].ops[0].value!)).toEqual({ Authorization: 'Bearer T', 'X-A': '1' });
  });

  it('一行多操作符含 JSON 值', () => {
    const rs = parseRuleSet('r', 'n', 'a.com  statusCode://201  resHeaders://{"X":"y z"}  log');
    expect(rs.rules[0].ops.map((o) => o.op)).toEqual(['statusCode', 'resHeaders', 'log']);
    expect(JSON.parse(rs.rules[0].ops[1].value!)).toEqual({ X: 'y z' });
  });
});
