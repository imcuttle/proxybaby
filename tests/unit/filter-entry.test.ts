import { describe, it, expect } from 'vitest';
import {
  matchHostPattern,
  matchAppName,
  matchUrlEntry,
  entryMatches,
  upgradeToEntries,
  makeEntry,
} from '../../electron/engine/filter-entry';

describe('matchHostPattern', () => {
  it('精确匹配', () => {
    expect(matchHostPattern('a.com', 'a.com')).toBe(true);
    expect(matchHostPattern('a.com', 'b.com')).toBe(false);
  });
  it('*.domain 命中 apex 与任意子域', () => {
    expect(matchHostPattern('*.foo.com', 'foo.com')).toBe(true);
    expect(matchHostPattern('*.foo.com', 'x.foo.com')).toBe(true);
    expect(matchHostPattern('*.foo.com', 'a.b.foo.com')).toBe(true);
    expect(matchHostPattern('*.foo.com', 'xfoo.com')).toBe(false);
  });
});

describe('matchAppName', () => {
  it('大小写敏感精确匹配', () => {
    expect(matchAppName('Google Chrome', 'Google Chrome')).toBe(true);
    expect(matchAppName('Google Chrome', 'google chrome')).toBe(false);
    expect(matchAppName('X', undefined)).toBe(false);
  });
});

describe('matchUrlEntry glob', () => {
  it('通配 URL', () => {
    expect(matchUrlEntry('https://api.foo.com/*', 'glob', { url: 'https://api.foo.com/v1/x' })).toBe(true);
    expect(matchUrlEntry('https://api.foo.com/*', 'glob', { url: 'https://other.com/v1/x' })).toBe(false);
  });
  it('可包含 METHOD 前缀', () => {
    expect(matchUrlEntry('POST https://api.foo.com/*', 'glob', { method: 'POST', url: 'https://api.foo.com/x' })).toBe(true);
    expect(matchUrlEntry('POST https://api.foo.com/*', 'glob', { method: 'GET', url: 'https://api.foo.com/x' })).toBe(false);
  });
});

describe('matchUrlEntry regex', () => {
  it('对 url 使用 test', () => {
    expect(matchUrlEntry('^https://api\\.foo\\.com/v[0-9]+/', 'regex', { url: 'https://api.foo.com/v1/users' })).toBe(true);
    expect(matchUrlEntry('^https://api\\.foo\\.com/v[0-9]+/', 'regex', { url: 'https://api.foo.com/xx/users' })).toBe(false);
  });
  it('坏正则不抛异常', () => {
    expect(matchUrlEntry('(', 'regex', { url: 'https://x.com' })).toBe(false);
  });
});

describe('entryMatches', () => {
  it('enabled=false 直接不命中', () => {
    const e = makeEntry('host', 'a.com', { enabled: false });
    expect(entryMatches(e, { host: 'a.com' })).toBe(false);
  });
  it('CONNECT 阶段 URL 类目视为未命中', () => {
    const e = makeEntry('url', 'https://api.foo.com/*');
    expect(entryMatches(e, { host: 'api.foo.com', url: 'https://api.foo.com/x' }, false)).toBe(false);
    expect(entryMatches(e, { host: 'api.foo.com', url: 'https://api.foo.com/x' }, true)).toBe(true);
  });
});

describe('upgradeToEntries', () => {
  it('从 string[] 升级', () => {
    const r = upgradeToEntries(['a.com', '  ', '*.b.com', 'a.com']);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ kind: 'host', value: 'a.com', enabled: true });
    expect(r[1]).toMatchObject({ kind: 'host', value: '*.b.com', enabled: true });
  });
  it('去重同 kind+value', () => {
    const r = upgradeToEntries([
      { kind: 'host', value: 'a.com' },
      { kind: 'host', value: 'a.com' },
      { kind: 'app', value: 'a.com' },
    ]);
    expect(r).toHaveLength(2);
  });
  it('保留 note 与 urlMode', () => {
    const r = upgradeToEntries([{ kind: 'url', value: '.*/foo', urlMode: 'regex', note: 'hi' }]);
    expect(r[0]).toMatchObject({ kind: 'url', value: '.*/foo', urlMode: 'regex', note: 'hi' });
  });
  it('非法 kind 跳过', () => {
    const r = upgradeToEntries([{ kind: 'garbage', value: 'x' }]);
    expect(r).toHaveLength(0);
  });
});
