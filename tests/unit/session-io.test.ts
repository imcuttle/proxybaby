import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportProxybaby, importProxybaby, exportHAR } from '../../electron/store/session-io';
import { mkFlow, mkReq } from '../fixtures';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-io-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const flows = [
  mkFlow({
    id: 'ex1',
    request: mkReq({ method: 'GET', url: 'https://api.test.com/x?a=1', host: 'api.test.com', path: '/x?a=1', headers: [{ name: 'Accept', value: 'application/json' }] }),
    response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [{ name: 'Content-Type', value: 'application/json' }], bodySize: 12, bodyText: '{"ok":true}', contentType: 'application/json', isSSE: false },
    durationMs: 42,
  }),
];

describe('会话导出/导入', () => {
  it('.proxybaby 往返保真', () => {
    const file = path.join(tmpDir, 's.proxybaby');
    exportProxybaby(flows, file);
    const back = importProxybaby(file);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe('ex1');
    expect(back[0].response?.bodyText).toBe('{"ok":true}');
  });

  it('HAR 1.2 导出结构正确', () => {
    const file = path.join(tmpDir, 's.har');
    exportHAR(flows, file);
    const har = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0].request.queryString[0].name).toBe('a');
    expect(har.log.entries[0].response.content.text).toBe('{"ok":true}');
  });
});
