import { describe, it, expect } from 'vitest';
import { parseRuleSet, type RuleSet } from '../../electron/engine/rule-parser';
import { debugRules, type RuleSource } from '../../electron/engine/rule-debug';

/** 轻量 RuleSource：绕开 RuleEngine 的磁盘依赖。 */
function makeSource(sets: RuleSet[]): RuleSource {
  return { list: () => sets };
}

function parse(id: string, text: string, enabled = true): RuleSet {
  return parseRuleSet(id, `set-${id}`, text, enabled);
}

describe('debugRules ·匹配诊断', () => {
  it('prefix 命中，reason 说明命中', async () => {
    const src = makeSource([parse('a', 'api.example.com/foo  mock://{"ok":true}')]);
    const r = await debugRules(src, { url: 'https://api.example.com/foo/bar', method: 'GET' });
    expect(r.diagnoses).toHaveLength(1);
    expect(r.diagnoses[0].matched).toBe(true);
    expect(r.diagnoses[0].reason).toMatch(/前缀命中/);
  });

  it('prefix 未命中：scheme 不一致', async () => {
    const src = makeSource([parse('a', 'https://api.example.com/foo  mock://{}')]);
    const r = await debugRules(src, { url: 'http://api.example.com/foo/bar', method: 'GET', scheme: 'http' });
    expect(r.diagnoses[0].matched).toBe(false);
    expect(r.diagnoses[0].reason).toMatch(/Scheme 不匹配/);
  });

  it('prefix 未命中：路径不匹配', async () => {
    const src = makeSource([parse('a', 'api.example.com/foo  mock://{}')]);
    const r = await debugRules(src, { url: 'https://api.example.com/bar', method: 'GET' });
    expect(r.diagnoses[0].matched).toBe(false);
    expect(r.diagnoses[0].reason).toMatch(/路径前缀不匹配/);
  });

  it('regex 命中/未命中', async () => {
    const src = makeSource([parse('a', '/\\/api\\/v\\d+\\//  mock://{}')]);
    const hit = await debugRules(src, { url: 'https://x.com/api/v1/users', method: 'GET' });
    expect(hit.diagnoses[0].matched).toBe(true);
    expect(hit.diagnoses[0].matcherKind).toBe('regex');

    const miss = await debugRules(src, { url: 'https://x.com/other', method: 'GET' });
    expect(miss.diagnoses[0].matched).toBe(false);
    expect(miss.diagnoses[0].reason).toMatch(/正则未命中/);
  });

  it('glob 命中/未命中', async () => {
    const src = makeSource([parse('a', '*.example.com/*  mock://{}')]);
    const hit = await debugRules(src, { url: 'https://api.example.com/foo', method: 'GET' });
    expect(hit.diagnoses[0].matched).toBe(true);
    expect(hit.diagnoses[0].matcherKind).toBe('glob');

    const miss = await debugRules(src, { url: 'https://other.com/foo', method: 'GET' });
    expect(miss.diagnoses[0].matched).toBe(false);
    expect(miss.diagnoses[0].reason).toMatch(/Glob 未命中/);
  });

  it('规则集禁用时reason=已禁用 且不参与dry-run', async () => {
    const src = makeSource([parse('a', 'api.example.com/foo  mock://{}', false)]);
    const r = await debugRules(src, { url: 'https://api.example.com/foo', method: 'GET' });
    expect(r.diagnoses[0].matched).toBe(false);
    expect(r.diagnoses[0].reason).toBe('规则集已禁用');
    expect(r.dryRun.executedOps).toHaveLength(0);
  });
});

describe('debugRules · 环境诊断', () => {
  it('SSL 未 MITM 时给出警告 reason', async () => {
    const src = makeSource([parse('a', 'api.example.com/foo  mock://{}')]);
    const r = await debugRules(src, { url: 'https://api.example.com/foo', method: 'GET' }, {
      sslWillDecrypt: () => ({ ok: false, reason: '模式为「include」，未命中' }),
    });
    expect(r.environment.willDecrypt).toBe(false);
    expect(r.environment.willDecryptReason).toMatch(/未命中/);
  });

  it('HTTP 请求默认无需 MITM', async () => {
    const src = makeSource([]);
    const r = await debugRules(src, { url: 'http://api.example.com/foo', method: 'GET' });
    expect(r.environment.willDecrypt).toBe(true);
    expect(r.environment.willDecryptReason).toMatch(/HTTP 无需解密/);
  });

  it('Allow-Block block 命中时allow=false 且带 reason', async () => {
    const src = makeSource([]);
    const r = await debugRules(src, { url: 'https://blocked.com/x', method: 'GET' }, {
      allowBlockAllows: () => ({ allow: false, reason: 'blocked-by-list' }),
    });
    expect(r.environment.allowBlockAllows).toBe(false);
    expect(r.environment.allowBlockReason).toBe('blocked-by-list');
  });

  it('未提供 probes 时默认全部 ok', async () => {
    const src = makeSource([]);
    const r = await debugRules(src, { url: 'https://x.com/y', method: 'GET' });
    expect(r.environment.willDecrypt).toBe(true);
    expect(r.environment.allowBlockAllows).toBe(true);
    expect(r.environment.willRecord).toBe(true);
  });
});

describe('debugRules · dry-run', () => {
  it('mock 短路：finalResponse status=200，bodyText 与规则值一致', async () => {
    const src = makeSource([parse('a', 'api.example.com/foo  mock://{"ok":true}')]);
    const r = await debugRules(src, { url: 'https://api.example.com/foo', method: 'GET' });
    expect(r.dryRun.shortCircuit?.kind).toBe('respond');
    expect(r.dryRun.shortCircuit?.response?.status).toBe(200);
    expect(r.dryRun.shortCircuit?.response?.bodyText).toBe('{"ok":true}');
    expect(r.dryRun.finalResponse?.bodyText).toBe('{"ok":true}');
  });

  it('reqHeaders 改写：finalRequest.headers 出现新头', async () => {
    const src = makeSource([parse('a', 'api.example.com/foo  reqHeaders://{"X-Foo":"Bar"}')]);
    const r = await debugRules(src, { url: 'https://api.example.com/foo', method: 'GET' });
    const found = r.dryRun.finalRequest.headers.find((h) => h.name.toLowerCase() === 'x-foo');
    expect(found?.value).toBe('Bar');
  });

  it('file operator 被stub，executedOps 里标记 skipped', async () => {
    const src = makeSource([parse('a', 'api.example.com/foo  file:///tmp/notexist.json')]);
    const r = await debugRules(src, { url: 'https://api.example.com/foo', method: 'GET' });
    const traces = r.dryRun.executedOps.filter((o) => o.op === 'file');
    expect(traces.length).toBe(1);
    expect(traces[0].skipped).toBeTruthy();
    // 因为被 stub，不会短路
    expect(r.dryRun.shortCircuit).toBeUndefined();
  });

  it('无规则匹配：executedOps 空，finalRequest 与输入一致', async () => {
    const src = makeSource([parse('a', 'other.com/foo  mock://{}')]);
    const r = await debugRules(src, {
      url: 'https://api.example.com/foo',
      method: 'POST',
      headers: [{ name: 'X-Test', value: '1' }],
      bodyText: 'hello',
    });
    expect(r.dryRun.executedOps).toHaveLength(0);
    expect(r.dryRun.shortCircuit).toBeUndefined();
    expect(r.dryRun.finalRequest.method).toBe('POST');
    expect(r.dryRun.finalRequest.headers).toEqual([{ name: 'X-Test', value: '1' }]);
    expect(r.dryRun.finalRequest.bodyText).toBe('hello');
  });

  it('statusCode operator 单独：dry-run 无short-circuit（post 阶段无response 可改）', async () => {
    // statusCode 是 post middleware，dry-run 里不真的发上游，所以 ctx.response 不存在，op 静默 no-op
    const src = makeSource([parse('a', 'api.example.com/foo  statusCode://500')]);
    const r = await debugRules(src, { url: 'https://api.example.com/foo', method: 'GET' });
    expect(r.dryRun.shortCircuit).toBeUndefined();
    // 但 executedOps 里应该记录它被执行了
    expect(r.dryRun.executedOps.find((o) => o.op === 'statusCode')).toBeDefined();
  });

  it('多规则命中：ops 顺序 + 都能执行', async () => {
    const src = makeSource([
      parse('a', 'api.example.com/foo  reqHeaders://{"X-A":"1"}'),
      parse('b', 'api.example.com/foo  reqHeaders://{"X-B":"2"}'),
    ]);
    const r = await debugRules(src, { url: 'https://api.example.com/foo', method: 'GET' });
    expect(r.diagnoses.filter((d) => d.matched)).toHaveLength(2);
    const hA = r.dryRun.finalRequest.headers.find((h) => h.name.toLowerCase() === 'x-a');
    const hB = r.dryRun.finalRequest.headers.find((h) => h.name.toLowerCase() === 'x-b');
    expect(hA?.value).toBe('1');
    expect(hB?.value).toBe('2');
  });
});
