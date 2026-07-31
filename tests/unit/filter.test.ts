import { describe, it, expect } from 'vitest';
import { matchFilter } from '../../src/lib/filter';
import { mkFlow, mkReq } from '../fixtures';

const base = (over = {}) => mkFlow({ request: mkReq({ url: 'https://api.demo.com/v2/users?q=1', host: 'api.demo.com', path: '/v2/users?q=1', ...over }) });

describe('matchFilter', () => {
  it('文本搜索按 URL 过滤', () => {
    const f = base();
    expect(matchFilter(f, { text: 'users', type: 'all' })).toBe(true);
    expect(matchFilter(f, { text: 'orders', type: 'all' })).toBe(false);
  });

  it('host 过滤', () => {
    const f = base();
    expect(matchFilter(f, { text: '', type: 'all', host: 'api.demo.com' })).toBe(true);
    expect(matchFilter(f, { text: '', type: 'all', host: 'other.com' })).toBe(false);
  });

  it('pathPrefix（域名 subpath）过滤', () => {
    const f = base();
    expect(matchFilter(f, { text: '', type: 'all', pathPrefix: 'api.demo.com/v2' })).toBe(true);
    expect(matchFilter(f, { text: '', type: 'all', pathPrefix: 'api.demo.com/v3' })).toBe(false);
  });

  it('appName 过滤', () => {
    const f = mkFlow({ app: { name: 'node', pid: 1 } });
    expect(matchFilter(f, { text: '', type: 'all', appName: 'node' })).toBe(true);
    expect(matchFilter(f, { text: '', type: 'all', appName: 'Chrome' })).toBe(false);
  });

  it('special=pinned 只匹配已固定', () => {
    const f = mkFlow({ id: 'p1' });
    expect(matchFilter(f, { text: '', type: 'all', special: 'pinned' }, { pinnedIds: { p1: true } })).toBe(true);
    expect(matchFilter(f, { text: '', type: 'all', special: 'pinned' }, { pinnedIds: {} })).toBe(false);
  });

  it('special=saved 只匹配已保存', () => {
    const f = mkFlow({ id: 's1' });
    expect(matchFilter(f, { text: '', type: 'all', special: 'saved' }, { savedIds: { s1: true } })).toBe(true);
    expect(matchFilter(f, { text: '', type: 'all', special: 'saved' }, { savedIds: {} })).toBe(false);
  });

  it('type=https 过滤', () => {
    const https = base();
    const httpFlow = mkFlow({ request: mkReq({ scheme: 'http' }) });
    expect(matchFilter(https, { text: '', type: 'https' })).toBe(true);
    expect(matchFilter(httpFlow, { text: '', type: 'https' })).toBe(false);
  });

  it('组合过滤：host + text', () => {
    const f = base();
    expect(matchFilter(f, { text: 'users', type: 'all', host: 'api.demo.com' })).toBe(true);
    expect(matchFilter(f, { text: 'users', type: 'all', host: 'x.com' })).toBe(false);
  });

  it('高级过滤器：AND 组合', () => {
    const f = base({
      // 手工塞点响应头 + 请求头
    });
    // 强类型：注入 headers
    (f as any).request.headers = [{ name: 'Authorization', value: 'Bearer x' }];
    (f as any).response = { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [{ name: 'Content-Type', value: 'application/json' }], bodySize: 0, isSSE: false };
    const flt = {
      text: '', type: 'all',
      advanced: {
        combinator: 'AND', rules: [
          { field: 'url', op: 'contains', value: 'users' },
          { field: 'reqHeader', headerName: 'Authorization', op: 'startsWith', value: 'Bearer ' },
        ],
      },
    } as any;
    expect(matchFilter(f, flt)).toBe(true);
    flt.advanced.rules[0].value = 'orders';
    expect(matchFilter(f, flt)).toBe(false);
  });

  it('高级过滤器：OR 组合与 negate', () => {
    const f = base();
    const flt = {
      text: '', type: 'all',
      advanced: {
        combinator: 'OR', rules: [
          { field: 'method', op: 'equals', value: 'DELETE' },
          { field: 'url', op: 'contains', value: 'users', negate: true },
        ],
      },
    } as any;
    // url 包含 users，negate=true → false；method !== DELETE → false；OR → false
    expect(matchFilter(f, flt)).toBe(false);
    flt.advanced.rules[1].negate = false;
    // url 包含 users → true；OR → true
    expect(matchFilter(f, flt)).toBe(true);
  });

  it('高级过滤器：正则', () => {
    const f = base();
    const flt = {
      text: '', type: 'all',
      advanced: { combinator: 'AND', rules: [{ field: 'path', op: 'regex', value: '/v\\d+/users' }] },
    } as any;
    expect(matchFilter(f, flt)).toBe(true);
  });

  it('高级过滤器：status gt/lt', () => {
    const f = base();
    (f as any).response = { status: 404, statusText: '', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false };
    expect(matchFilter(f, { text: '', type: 'all', advanced: { combinator: 'AND', rules: [{ field: 'status', op: 'gt', value: '400' }] } } as any)).toBe(true);
    expect(matchFilter(f, { text: '', type: 'all', advanced: { combinator: 'AND', rules: [{ field: 'status', op: 'lt', value: '400' }] } } as any)).toBe(false);
  });
});
