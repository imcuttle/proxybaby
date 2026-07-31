import { describe, it, expect } from 'vitest';
import { generateCodeFromRequest, CODE_LANGS } from '../../src/lib/code-gen';

const REQ = {
  method: 'POST',
  url: 'https://api.example.com/v1/users',
  headers: [{ name: 'Authorization', value: 'Bearer x' }, { name: 'Content-Length', value: '5' /* should be skipped */ }],
  bodyText: '{"name":"alice"}',
};

describe('generateCode', () => {
  for (const l of CODE_LANGS) {
    it(`generates ${l.key}`, () => {
      const out = generateCodeFromRequest(REQ, l.key);
      expect(out).toContain('api.example.com');
      // Content-Length 应被跳过
      expect(out.includes('Content-Length')).toBe(false);
    });
  }

  it('curl includes -X POST for non-GET', () => {
    const out = generateCodeFromRequest(REQ, 'curl');
    expect(out).toMatch(/curl/);
    expect(out).toMatch(/POST/);
    expect(out).toMatch(/--data-raw/);
  });

  it('python emits requests.post', () => {
    const out = generateCodeFromRequest(REQ, 'python');
    expect(out).toContain('requests.post');
  });

  it('go emits http.NewRequest', () => {
    const out = generateCodeFromRequest(REQ, 'go');
    expect(out).toContain('http.NewRequest');
  });

  it('skips content-encoding / transfer-encoding (body 已解压，保留会让服务端按 gzip 解失败)', () => {
    const req = {
      method: 'POST',
      url: 'https://api.example.com/x',
      headers: [
        { name: 'Content-Encoding', value: 'gzip' },
        { name: 'Transfer-Encoding', value: 'chunked' },
        { name: 'Authorization', value: 'Bearer x' },
      ],
      bodyText: '{"a":1}',
    };
    for (const l of CODE_LANGS) {
      const out = generateCodeFromRequest(req, l.key);
      expect(out.toLowerCase()).not.toContain('content-encoding');
      expect(out.toLowerCase()).not.toContain('transfer-encoding');
    }
  });
});
