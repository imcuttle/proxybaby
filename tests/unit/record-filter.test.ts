import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { RecordFilterStore, setRecordFilterStore } from '../../electron/engine/record-filter';

/**
 * RecordFilterStore：include/exclude 语义 + per-entry SSL decrypt。
 * 注意 store 用 app.getPath('userData')，测试环境 mock 已经把它指到临时目录。
 */

describe('RecordFilterStore', () => {
  let store: RecordFilterStore;

  beforeEach(() => {
    // 每次用独立 store（默认 { mode: 'all', entries: [] }）
    store = new RecordFilterStore();
    setRecordFilterStore(store);
    // 清干净现有配置文件
    store.set({ mode: 'all', entries: [] });
  });

  afterAll(() => setRecordFilterStore(null));

  it('mode=all 时任何请求都记录', () => {
    expect(store.shouldRecord({ host: 'a.com' })).toBe(true);
    expect(store.shouldRecord({ host: 'b.example.com' })).toBe(true);
  });

  it('mode=include 只记录命中条目的请求', () => {
    store.set({
      mode: 'include',
      entries: [
        { id: '1', kind: 'host', value: 'api.demo.com', enabled: true },
      ],
    });
    expect(store.shouldRecord({ host: 'api.demo.com', url: 'https://api.demo.com/x' })).toBe(true);
    expect(store.shouldRecord({ host: 'other.com', url: 'https://other.com/x' })).toBe(false);
  });

  it('mode=exclude 不记录命中条目的请求', () => {
    store.set({
      mode: 'exclude',
      entries: [
        { id: '1', kind: 'host', value: 'noisy.com', enabled: true },
      ],
    });
    expect(store.shouldRecord({ host: 'noisy.com', url: 'https://noisy.com/x' })).toBe(false);
    expect(store.shouldRecord({ host: 'other.com', url: 'https://other.com/x' })).toBe(true);
  });

  it('enabled=false 的条目不生效', () => {
    store.set({
      mode: 'exclude',
      entries: [
        { id: '1', kind: 'host', value: 'noisy.com', enabled: false },
      ],
    });
    // exclude 模式下条目 disabled 等于没命中 → 记录
    expect(store.shouldRecord({ host: 'noisy.com' })).toBe(true);
  });

  it('shouldDecrypt: mode=all 一律解密', () => {
    expect(store.shouldDecrypt({ host: 'api.demo.com' })).toBe(true);
  });

  it('shouldDecrypt: mode=include 未命中 → 不解密', () => {
    store.set({
      mode: 'include',
      entries: [{ id: '1', kind: 'host', value: 'api.demo.com', enabled: true }],
    });
    expect(store.shouldDecrypt({ host: 'other.com' })).toBe(false);
    expect(store.shouldDecrypt({ host: 'api.demo.com' })).toBe(true);
  });

  it('shouldDecrypt: mode=include 命中但 decrypt=false → 不解密', () => {
    store.set({
      mode: 'include',
      entries: [{ id: '1', kind: 'host', value: 'api.demo.com', enabled: true, decrypt: false }],
    });
    // 会被记录（因为在 include 列表里），但不 MITM 解密
    expect(store.shouldRecord({ host: 'api.demo.com' })).toBe(true);
    expect(store.shouldDecrypt({ host: 'api.demo.com' })).toBe(false);
  });

  it('shouldDecrypt: mode=exclude 命中 → 不解密（也不记录）', () => {
    store.set({
      mode: 'exclude',
      entries: [{ id: '1', kind: 'host', value: 'noisy.com', enabled: true }],
    });
    expect(store.shouldRecord({ host: 'noisy.com' })).toBe(false);
    expect(store.shouldDecrypt({ host: 'noisy.com' })).toBe(false);
    expect(store.shouldDecrypt({ host: 'other.com' })).toBe(true);
  });

  it('host 通配 *.example.com 匹配子域', () => {
    store.set({
      mode: 'include',
      entries: [{ id: '1', kind: 'host', value: '*.example.com', enabled: true }],
    });
    expect(store.shouldRecord({ host: 'api.example.com', url: 'https://api.example.com/' })).toBe(true);
    expect(store.shouldRecord({ host: 'evil.com', url: 'https://evil.com/' })).toBe(false);
  });

  it('URL glob 条目在请求阶段生效', () => {
    store.set({
      mode: 'include',
      entries: [{ id: '1', kind: 'url', value: '*api.demo.com/v1/*', urlMode: 'glob', enabled: true }],
    });
    expect(store.shouldRecord({ host: 'api.demo.com', url: 'https://api.demo.com/v1/users' })).toBe(true);
    expect(store.shouldRecord({ host: 'api.demo.com', url: 'https://api.demo.com/v2/users' })).toBe(false);
  });

  it('持久化：set 后重新 new 应恢复配置', () => {
    store.set({
      mode: 'include',
      entries: [{ id: '1', kind: 'host', value: 'x.com', enabled: true }],
    });
    const store2 = new RecordFilterStore();
    const cfg = store2.get();
    expect(cfg.mode).toBe('include');
    expect(cfg.entries.length).toBe(1);
    expect(cfg.entries[0].value).toBe('x.com');
  });
});
