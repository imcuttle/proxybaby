import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SslListStore } from '../../electron/engine/ssl-list';
import { makeEntry } from '../../electron/engine/filter-entry';

const listsDir = path.join(os.tmpdir(), 'proxybaby-test', 'lists');
beforeEach(() => { fs.rmSync(listsDir, { recursive: true, force: true }); });

describe('SSL decrypt list', () => {
  it('默认全部解密', () => {
    const s = new SslListStore();
    expect(s.shouldDecrypt({ host: 'api.example.com' })).toBe(true);
  });

  it('include 模式仅解密列表内的 host', () => {
    const s = new SslListStore();
    s.set({
      enabled: true,
      mode: 'include',
      entries: [makeEntry('host', 'api.example.com'), makeEntry('host', '*.gateway.io')],
    });
    expect(s.shouldDecrypt({ host: 'api.example.com' })).toBe(true);
    expect(s.shouldDecrypt({ host: 'x.gateway.io' })).toBe(true);
    expect(s.shouldDecrypt({ host: 'other.com' })).toBe(false);
  });

  it('exclude 模式跳过列表内的', () => {
    const s = new SslListStore();
    s.set({ enabled: true, mode: 'exclude', entries: [makeEntry('host', 'secure.bank')] });
    expect(s.shouldDecrypt({ host: 'secure.bank' })).toBe(false);
    expect(s.shouldDecrypt({ host: 'other.com' })).toBe(true);
  });

  it('*.domain 通配 apex 与子域', () => {
    const s = new SslListStore();
    s.set({ enabled: true, mode: 'include', entries: [makeEntry('host', '*.foo.com')] });
    expect(s.shouldDecrypt({ host: 'foo.com' })).toBe(true);
    expect(s.shouldDecrypt({ host: 'a.b.foo.com' })).toBe(true);
    expect(s.shouldDecrypt({ host: 'xfoo.com' })).toBe(false);
  });

  it('enabled=false 时不 MITM', () => {
    const s = new SslListStore();
    s.set({ enabled: false, mode: 'all', entries: [] });
    expect(s.shouldDecrypt({ host: 'any.com' })).toBe(false);
  });

  it('include 模式支持 kind=app', () => {
    const s = new SslListStore();
    s.set({
      enabled: true,
      mode: 'include',
      entries: [makeEntry('app', 'Google Chrome')],
    });
    expect(s.shouldDecrypt({ host: 'x.com', appName: 'Google Chrome' })).toBe(true);
    expect(s.shouldDecrypt({ host: 'x.com', appName: 'Firefox' })).toBe(false);
    expect(s.shouldDecrypt({ host: 'x.com' })).toBe(false); // 无 appName
  });

  it('CONNECT 阶段 URL 类目视为未命中', () => {
    const s = new SslListStore();
    s.set({
      enabled: true,
      mode: 'include',
      entries: [makeEntry('url', 'https://api.foo.com/*')],
    });
    // shouldDecrypt 内部 allowUrl=false，所以即使 host 是 api.foo.com 也未命中
    expect(s.shouldDecrypt({ host: 'api.foo.com' })).toBe(false);
  });

  it('持久化：新实例加载', () => {
    const s = new SslListStore();
    s.set({ enabled: true, mode: 'include', entries: [makeEntry('host', 'api.demo.com')] });
    const s2 = new SslListStore();
    expect(s2.get().mode).toBe('include');
    expect(s2.get().entries).toEqual([expect.objectContaining({ kind: 'host', value: 'api.demo.com', enabled: true })]);
  });

  it('从旧格式 hosts: string[] 自动迁移', () => {
    // 手写旧格式到磁盘
    fs.mkdirSync(listsDir, { recursive: true });
    fs.writeFileSync(
      path.join(listsDir, 'ssl-decrypt.json'),
      JSON.stringify({ mode: 'include', hosts: ['a.com', '*.b.com'] }),
    );
    const s = new SslListStore();
    const cfg = s.get();
    expect(cfg.enabled).toBe(true); // 缺 enabled 时默认 true
    expect(cfg.mode).toBe('include');
    expect(cfg.entries).toHaveLength(2);
    expect(cfg.entries[0]).toMatchObject({ kind: 'host', value: 'a.com', enabled: true });
    expect(cfg.entries[1]).toMatchObject({ kind: 'host', value: '*.b.com', enabled: true });
    // 加载后二次落盘为新格式
    const raw = JSON.parse(fs.readFileSync(path.join(listsDir, 'ssl-decrypt.json'), 'utf8'));
    expect(Array.isArray(raw.entries)).toBe(true);
    expect(raw.hosts).toBeUndefined();
  });
});
