import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AiManager } from '../../electron/ai/manager';

// electron 已被 vitest mock 到 tests/mocks/electron.ts，其 getPath 指向 os.tmpdir()/proxybaby-test。
const indexFile = path.join(os.tmpdir(), 'proxybaby-test', 'ai', 'index.json');

describe('AiManager (session index)', () => {
  beforeEach(() => {
    try { fs.rmSync(path.dirname(indexFile), { recursive: true, force: true }); } catch {}
  });

  it('无数据时初始化默认 config', () => {
    const m = new AiManager({ disableSpawn: true });
    expect(m.listSessions()).toEqual([]);
    expect(m.currentId()).toBeNull();
    expect(m.getConfig().enabled).toBe(true);
    expect(m.getConfig().cliPath).toBe('codebuddy');
  });

  it('createSession/renameSession/deleteSession/switchSession 落盘', () => {
    let m = new AiManager({ disableSpawn: true });
    const a = m.createSession();
    const b = m.createSession('第二个');
    expect(m.listSessions()).toHaveLength(2);
    expect(m.currentId()).toBe(b.id);

    m.renameSession(a.id, 'A 重命名');
    m.switchSession(a.id);
    expect(m.currentId()).toBe(a.id);

    // 重新 new，应该从磁盘恢复
    m = new AiManager({ disableSpawn: true });
    expect(m.listSessions()).toHaveLength(2);
    const found = m.listSessions().find((s) => s.id === a.id)!;
    expect(found.title).toBe('A 重命名');
    expect(m.currentId()).toBe(a.id);

    // 删除后 current 迁移
    const ok = m.deleteSession(a.id);
    expect(ok).toBe(true);
    expect(m.listSessions()).toHaveLength(1);
    expect(m.currentId()).toBe(b.id);
  });

  it('send 会以首行为默认 title', () => {
    const m = new AiManager({ disableSpawn: true });
    const s = m.send('帮我 mock user 接口\n第二行');
    expect(s.title).toBe('帮我 mock user 接口');
  });

  it('setConfig 持久化', () => {
    let m = new AiManager({ disableSpawn: true });
    m.setConfig({ cliPath: '/opt/codebuddy', model: 'claude-opus-4.7' });
    m = new AiManager({ disableSpawn: true });
    expect(m.getConfig().cliPath).toBe('/opt/codebuddy');
    expect(m.getConfig().model).toBe('claude-opus-4.7');
  });
});
