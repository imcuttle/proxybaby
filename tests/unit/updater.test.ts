/**
 * updater 模块单元测试
 * - 版本比较逻辑（isNewer）
 * - checkForUpdates 完整流程 + skipVersion
 */
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  isNewer,
  parseVersion,
  checkForUpdates,
  skipVersion,
  getLastResult,
  extractVersionSection,
  __setFetcherForTest,
  __setFallbackFetcherForTest,
  __setChangelogFetcherForTest,
  __resetForTest,
} from '@electron/updater/updater';

const stateFile = path.join(os.tmpdir(), 'proxybaby-test', 'updater.json');

async function clean() {
  try { await fs.rm(stateFile, { force: true }); } catch {}
  __resetForTest();
  __setFetcherForTest(null);
  __setFallbackFetcherForTest(null);
  __setChangelogFetcherForTest(null);
}

describe('parseVersion', () => {
  it('strips v prefix', () => {
    expect(parseVersion('v1.2.3')).toEqual({ x: 1, y: 2, z: 3, pre: '' });
    expect(parseVersion('1.2.3')).toEqual({ x: 1, y: 2, z: 3, pre: '' });
  });
  it('handles pre-release', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual({ x: 1, y: 2, z: 3, pre: 'beta.1' });
  });
  it('bad input tolerated', () => {
    expect(parseVersion('')).toEqual({ x: 0, y: 0, z: 0, pre: '' });
    expect(parseVersion('abc')).toEqual({ x: 0, y: 0, z: 0, pre: '' });
  });
});

describe('isNewer', () => {
  it('major bump', () => {
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '2.0.0')).toBe(false);
  });
  it('minor bump', () => {
    expect(isNewer('1.3.0', '1.2.9')).toBe(true);
  });
  it('patch bump', () => {
    expect(isNewer('0.7.1', '0.7.0')).toBe(true);
    expect(isNewer('0.7.0', '0.7.0')).toBe(false);
  });
  it('v-prefix', () => {
    expect(isNewer('v0.8.0', '0.7.0')).toBe(true);
    expect(isNewer('v0.7.0', 'v0.7.0')).toBe(false);
  });
  it('prerelease vs release', () => {
    // 相同 core：正式 > 预发布
    expect(isNewer('1.0.0', '1.0.0-beta.1')).toBe(true);
    expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false);
    // 两个都是预发布，按字符串
    expect(isNewer('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true);
  });
});

describe('checkForUpdates', () => {
  beforeEach(async () => {
    await clean();
  });

  it('returns hasUpdate=true when remote is newer', async () => {
    __setFetcherForTest(async () => ({
      tag_name: 'v99.0.0',
      name: 'Release 99',
      body: '# what\'s new\n- foo',
      html_url: 'https://github.com/imcuttle/proxybaby/releases/tag/v99.0.0',
      published_at: '2026-01-01T00:00:00Z',
      draft: false,
      prerelease: false,
    }));
    const r = await checkForUpdates({ force: true });
    expect(r.ok).toBe(true);
    expect(r.info?.hasUpdate).toBe(true);
    expect(r.info?.latestVersion).toBe('99.0.0');
    expect(r.info?.releaseNotes).toContain('foo');
    expect(r.info?.isSkipped).toBe(false);
  });

  it('hasUpdate=false when remote is same or older', async () => {
    __setFetcherForTest(async () => ({
      tag_name: 'v0.0.0-test',
      draft: false,
      prerelease: false,
    }));
    const r = await checkForUpdates({ force: true });
    expect(r.info?.hasUpdate).toBe(false);
  });

  it('ignores draft/prerelease as hasUpdate=false', async () => {
    __setFetcherForTest(async () => ({
      tag_name: 'v99.0.0',
      draft: true,
    }));
    const r = await checkForUpdates({ force: true });
    expect(r.info?.hasUpdate).toBe(false);
  });

  it('skipVersion marks isSkipped', async () => {
    __setFetcherForTest(async () => ({
      tag_name: 'v99.0.0',
      body: 'x',
      draft: false,
      prerelease: false,
    }));
    await checkForUpdates({ force: true });
    await skipVersion('99.0.0');
    const r2 = await checkForUpdates({ force: true });
    expect(r2.info?.hasUpdate).toBe(true);
    expect(r2.info?.isSkipped).toBe(true);
  });

  it('network error returns ok=false', async () => {
    __setFetcherForTest(async () => {
      throw new Error('boom');
    });
    __setFallbackFetcherForTest(async () => {
      throw new Error('offline');
    });
    const r = await checkForUpdates({ force: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('offline');
  });

  it('falls back to redirect when API fails; changelog fetcher fills body', async () => {
    __setFetcherForTest(async () => {
      throw Object.assign(new Error('GitHub API rate limited'), { code: 'RATE_LIMITED' });
    });
    __setFallbackFetcherForTest(async () => ({ tag: 'v99.0.0' }));
    __setChangelogFetcherForTest(async (tag) => {
      expect(tag).toBe('v99.0.0');
      return '### 🐛 修复\n- fix something';
    });
    const r = await checkForUpdates({ force: true });
    expect(r.ok).toBe(true);
    expect(r.info?.latestVersion).toBe('99.0.0');
    expect(r.info?.hasUpdate).toBe(true);
    expect(r.info?.releaseNotes).toContain('fix something');
  });

  it('fallback keeps releaseNotes empty when raw CHANGELOG unavailable', async () => {
    __setFetcherForTest(async () => {
      throw Object.assign(new Error('GitHub API rate limited'), { code: 'RATE_LIMITED' });
    });
    __setFallbackFetcherForTest(async () => ({ tag: 'v99.0.0' }));
    __setChangelogFetcherForTest(async () => '');
    const r = await checkForUpdates({ force: true });
    expect(r.ok).toBe(true);
    expect(r.info?.releaseNotes).toBe('');
  });

  it('getLastResult returns persisted info', async () => {
    __setFetcherForTest(async () => ({
      tag_name: 'v99.0.0',
      body: 'notes',
      draft: false,
      prerelease: false,
    }));
    await checkForUpdates({ force: true });
    const last = await getLastResult();
    expect(last?.latestVersion).toBe('99.0.0');
  });
});

describe('extractVersionSection', () => {
  const sample = [
    '# proxybaby',
    '',
    '## 0.9.0',
    '',
    '### ✨ 新功能',
    '- shiny',
    '',
    '## 0.8.1',
    '',
    '### 🐛 修复',
    '- fix a',
    '',
    '###🔧 其他',   // 无空格 heading
    '- chore b',
    '',
    '## 0.8.0',
    '',
    'legacy',
    '',
  ].join('\n');

  it('extracts the section for the requested version', () => {
    const s = extractVersionSection(sample, '0.8.1');
    expect(s).toContain('### 🐛 修复');
    expect(s).toContain('- fix a');
    expect(s).toContain('- chore b');
    // 相邻版本段不能被包进来
    expect(s).not.toContain('shiny');
    expect(s).not.toContain('legacy');
  });

  it('normalizes headings without space (`###🔧` → `### 🔧`)', () => {
    const s = extractVersionSection(sample, '0.8.1');
    expect(s).toContain('### 🔧 其他');
    expect(s).not.toMatch(/^###🔧/m);
  });

  it('accepts v-prefixed version', () => {
    const s = extractVersionSection(sample, 'v0.8.1');
    expect(s).toContain('- fix a');
  });

  it('returns "" when version not found', () => {
    expect(extractVersionSection(sample, '9.9.9')).toBe('');
  });

  it('handles trailing version (last section in file)', () => {
    const s = extractVersionSection(sample, '0.8.0');
    expect(s).toContain('legacy');
  });

  it('returns "" on empty inputs', () => {
    expect(extractVersionSection('', '0.8.1')).toBe('');
    expect(extractVersionSection(sample, '')).toBe('');
  });
});
