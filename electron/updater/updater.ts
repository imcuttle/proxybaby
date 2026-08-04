/**
 * App更新检查（GitHub Release）
 *
 * 当前实现：仅"查询有无新版本 → 展示 changelog → 打开 Release 页手动下载"。
 * 不做自动下载/安装（macOS 未签名+ 未公证时 electron-updater 走不通）。
 *
 * 未来扩展点：
 *   若项目开始进行 Developer ID 签名 + notarize，可以把 AUTO_UPDATE_ENABLED 切成 true，
 *   在 checkForUpdates/downloadAndInstall 内分支到 electron-updater：
 *     autoUpdater.autoDownload = false;
 *     autoUpdater.on('update-available', ...);
 *     autoUpdater.checkForUpdates();
 *     ... user confirms ... autoUpdater.downloadUpdate(); autoUpdater.quitAndInstall();
 */
import { app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import https from 'node:https';
import type { UpdateInfo, UpdateCheckResult } from '../../shared/types';

/** 未来切换到 electron-updater 时改为 true，并在下方相关函数里加分支 */
export const AUTO_UPDATE_ENABLED = false;

const REPO_OWNER = 'imcuttle';
const REPO_NAME = 'proxybaby';
const RELEASES_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const REQUEST_TIMEOUT_MS = 5000;
/** 手动检查以外的两次自动检查最小间隔 */
const AUTO_CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

interface PersistedState {
  skippedVersion?: string;
  lastCheckAt?: number;
  lastResult?: UpdateInfo | null;
}

let statePath: string | null = null;
let memState: PersistedState = {};
let loaded = false;

function getStatePath(): string {
  if (statePath) return statePath;
  // electron mock 在 tests/mocks/electron.ts 里返回 tmp dir，OK
  statePath = path.join(app.getPath('userData'), 'updater.json');
  return statePath;
}

async function loadState(): Promise<PersistedState> {
  if (loaded) return memState;
  loaded = true;
  try {
    const raw = await fs.readFile(getStatePath(), 'utf-8');
    memState = JSON.parse(raw) as PersistedState;
  } catch {
    memState = {};
  }
  return memState;
}

async function saveState(): Promise<void> {
  try {
    await fs.writeFile(getStatePath(), JSON.stringify(memState, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
}

// ============ 版本比较 ============

interface ParsedVersion {
  x: number;
  y: number;
  z: number;
  pre: string;
}

export function parseVersion(v: string): ParsedVersion {
  const s = (v || '').trim().replace(/^v/i, '');
  const [core, ...preParts] = s.split('-');
  const pre = preParts.join('-');
  const [xStr, yStr, zStr] = (core || '').split('.');
  return {
    x: parseInt(xStr ?? '0', 10) || 0,
    y: parseInt(yStr ?? '0', 10) || 0,
    z: parseInt(zStr ?? '0', 10) || 0,
    pre: pre || '',
  };
}

/** latest 严格新于 current返回 true */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (a.x !== b.x) return a.x > b.x;
  if (a.y !== b.y) return a.y > b.y;
  if (a.z !== b.z) return a.z > b.z;
  // 相同 core：正式版 > 预发布
  if (!a.pre && b.pre) return true;
  if (a.pre && !b.pre) return false;
  if (!a.pre && !b.pre) return false;
  // 都是预发布，按字符串比（够用）
  return a.pre > b.pre;
}

// ============ GitHub Release 查询 ============

interface GithubReleaseAsset { name?: string; browser_download_url?: string }
interface GithubReleaseResponse {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubReleaseAsset[];
}

/** 允许测试注入 mock fetcher */
type Fetcher = (url: string) => Promise<GithubReleaseResponse>;
let fetcher: Fetcher = defaultFetch;

export function __setFetcherForTest(f: Fetcher | null): void {
  fetcher = f ?? defaultFetch;
}

function defaultFetch(url: string): Promise<GithubReleaseResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'ProxyBaby-Updater',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`GitHub API HTTP ${status}`));
            return;
          }
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve(json as GithubReleaseResponse);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
    );
    req.on('error', (err) => reject(err));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('GitHub API request timeout'));
    });
    req.end();
  });
}

// ============ 主流程 ============

function getCurrentVersion(): string {
  try {
    // electron mock 环境下 app.getVersion 可能不存在
    const anyApp = app as unknown as { getVersion?: () => string };
    if (typeof anyApp.getVersion === 'function') return anyApp.getVersion();
  } catch { /* ignore */ }
  //兜底：读 package.json（仅测试环境走到这里）
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(path.join(process.cwd(), 'package.json'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export interface CheckOptions {
  silent?: boolean;
  /** true =忽略冷却时间 */
  force?: boolean;
}

export async function checkForUpdates(opts: CheckOptions = {}): Promise<UpdateCheckResult> {
  const state = await loadState();
  const now = Date.now();
  if (!opts.force && opts.silent && state.lastCheckAt && now - state.lastCheckAt < AUTO_CHECK_COOLDOWN_MS) {
    // 冷却期内直接返回上次结果
    return { ok: true, info: state.lastResult ?? null };
  }
  const current = getCurrentVersion();
  let release: GithubReleaseResponse;
  try {
    release = await fetcher(RELEASES_URL);
  } catch (err) {
    return { ok: false, info: null, error: err instanceof Error ? err.message : String(err) };
  }
  const latestRaw = release.tag_name || release.name || '';
  const latestVersion = latestRaw.replace(/^v/i, '');
  const isPrerelease = release.prerelease === true;
  const isDraft = release.draft === true;
  const hasUpdate = !isDraft && !isPrerelease && !!latestVersion && isNewer(latestVersion, current);
  const isSkipped = !!(hasUpdate && state.skippedVersion && state.skippedVersion === latestVersion);

  const info: UpdateInfo = {
    currentVersion: current,
    latestVersion,
    hasUpdate,
    isSkipped,
    releaseName: release.name || latestVersion,
    releaseNotes: release.body || '',
    htmlUrl: release.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
    publishedAt: release.published_at || '',
    checkedAt: now,
  };
  memState.lastCheckAt = now;
  memState.lastResult = info;
  await saveState();
  return { ok: true, info };
}

export async function getLastResult(): Promise<UpdateInfo | null> {
  const s = await loadState();
  return s.lastResult ?? null;
}

export async function skipVersion(version: string): Promise<boolean> {
  await loadState();
  memState.skippedVersion = (version || '').replace(/^v/i, '');
  if (memState.lastResult && memState.lastResult.latestVersion === memState.skippedVersion) {
    memState.lastResult.isSkipped = true;
  }
  await saveState();
  return true;
}

export async function remindLater(): Promise<boolean> {
  // no-op：不改状态，下次冷却后自然再弹
  return true;
}

export async function openReleasePage(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    //只允许 http(s)
    if (!/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}

/** 仅测试用：清空内存状态，强制下一次从磁盘/网络取*/
export function __resetForTest(): void {
  loaded = false;
  memState = {};
  statePath = null;
}
