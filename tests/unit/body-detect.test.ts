import { describe, it, expect } from 'vitest';
import {
  detectBody,
  parseFormUrlencoded,
  parseMultipart,
  parseGraphQL,
  toHexDump,
} from '../../src/lib/body-detect';

describe('detectBody', () => {
  it('识别 JSON', () => {
    const k = detectBody({ contentType: 'application/json', bodyText: '{"a":1}' });
    expect(k.isJson).toBe(true);
    expect(k.suggested).toBe('json-tree');
  });

  it('识别 HTML', () => {
    const k = detectBody({ contentType: 'text/html', bodyText: '<!doctype html><html></html>' });
    expect(k.isHtml).toBe(true);
    expect(k.suggested).toBe('html');
  });

  it('识别 form-urlencoded', () => {
    const k = detectBody({ contentType: 'application/x-www-form-urlencoded', bodyText: 'a=1&b=2' });
    expect(k.isForm).toBe(true);
    expect(k.suggested).toBe('form');
  });

  it('图片默认到 image 视图', () => {
    const k = detectBody({ contentType: 'image/png', bodyBase64: '', bodySize: 100 });
    expect(k.suggested).toBe('image');
  });

  it('无内容类型的 JSON 也能嗅探', () => {
    const k = detectBody({ bodyText: '{"a":1}' });
    expect(k.isJson).toBe(true);
  });

  it('GraphQL request 识别', () => {
    const k = detectBody({ contentType: 'application/json', bodyText: '{"query":"{ user { id } }"}' });
    expect(k.isGraphQL).toBe(true);
  });
});

describe('parseFormUrlencoded', () => {
  it('解析 kv', () => {
    expect(parseFormUrlencoded('a=1&b=hello%20world')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'hello world' },
    ]);
  });
});

describe('parseMultipart', () => {
  it('解析多段表单', () => {
    const boundary = '----X';
    const ct = `multipart/form-data; boundary=${boundary}`;
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="a"',
      '',
      'value-a',
      `--${boundary}`,
      'Content-Disposition: form-data; name="b"; filename="x.txt"',
      'Content-Type: text/plain',
      '',
      'hello',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const items = parseMultipart(body, ct);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'a', value: 'value-a' });
    expect(items[1]).toMatchObject({ name: 'b', filename: 'x.txt', contentType: 'text/plain', value: 'hello' });
  });
});

describe('parseGraphQL', () => {
  it('单个 query', () => {
    expect(parseGraphQL('{"query":"query X{me{id}}","operationName":"X","variables":{"a":1}}')).toEqual([
      { query: 'query X{me{id}}', operationName: 'X', variables: { a: 1 } },
    ]);
  });
  it('无效返回 null', () => {
    expect(parseGraphQL('{"foo":1}')).toBeNull();
  });
});

describe('toHexDump', () => {
  it('格式化字节', () => {
    const bytes = new Uint8Array([0x48, 0x49, 0x00, 0xff]);
    const dump = toHexDump(bytes);
    expect(dump).toContain('48 49 00 ff');
    expect(dump).toContain('|HI..|');
  });
});
