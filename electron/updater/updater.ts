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
/** 无鉴权、无限流的备用源：github.com 会302 到 /releases/tag/<version> */
const RELEASES_HTML_LATEST = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASES_HTML_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
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

/** 允许测试注入 302 fallback */
type FallbackFetcher = () => Promise<{ tag: string }>;
let fallbackFetcher: FallbackFetcher = fetchLatestViaRedirect;

export function __setFallbackFetcherForTest(f: FallbackFetcher | null): void {
  fallbackFetcher = f ?? fetchLatestViaRedirect;
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
            //区分限流：403 + rate limit
            const body = Buffer.concat(chunks).toString('utf-8');
            const isRateLimit = status === 403 && /rate limit/i.test(body);
            const err = new Error(
              isRateLimit
                ? 'GitHub API rate limited'
                : `GitHub API HTTP ${status}`,
            );
            (err as Error & { code?: string }).code = isRateLimit ? 'RATE_LIMITED' : `HTTP_${status}`;
            reject(err);
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

/**
 * 无鉴权、无限流的备用抓取：只请求 github.com/…/releases/latest 的 302 头，
 * 从 Location 里提取 tag 名 (v0.8.0 之类)。拿不到 release body/assets。
 */
function fetchLatestViaRedirect(): Promise<{ tag: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      RELEASES_HTML_LATEST,
      {
        method: 'HEAD',
        headers: { 'User-Agent': 'ProxyBaby-Updater' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location || '';
        // 消费/丢弃 body
        res.resume();
        if (status >= 300 && status < 400 && loc) {
          const m = /\/releases\/tag\/([^/?#]+)/.exec(loc);
          if (m) {
            resolve({ tag: decodeURIComponent(m[1]) });
            return;
          }
          reject(new Error(`Unexpected redirect: ${loc}`));
          return;
        }
        // 有 releases 但没跳过（无发布）或异常
        reject(new Error(`GitHub releases HTTP ${status}`));
      },
    );
    req.on('error', (err) => reject(err));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('GitHub releases request timeout'));
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
  let release: GithubReleaseResponse | null = null;
  let apiError: Error | null = null;
  try {
    release = await fetcher(RELEASES_URL);
  } catch (err) {
    apiError = err instanceof Error ? err : new Error(String(err));
  }

  //API 失败（限流/网络）时用 302 兜底：只能拿到版本号，body 留空
  if (!release) {
    try {
      const { tag } = await fallbackFetcher();
      release = { tag_name: tag, html_url: `${RELEASES_HTML_BASE}/tag/${tag}` };
    } catch (fallbackErr) {
      // 两个源都失败：优先报告更能给用户帮助的错误
      const errMsg = friendlyErrorMessage(apiError, fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr)));
      return { ok: false, info: null, error: errMsg };
    }
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

/** 组合两个源的错误，输出用户可读的中文提示 */
function friendlyErrorMessage(apiErr: Error | null, fallbackErr: Error): string {
  const code = (apiErr as (Error & { code?: string }) | null)?.code;
  if (code === 'RATE_LIMITED') {
    return 'GitHub 匿名接口触发限流；也无法访问发布页，请稍后重试或检查网络。';
  }
  const detail = fallbackErr.message || apiErr?.message || '未知错误';
  return `无法连接 GitHub 获取更新信息：${detail}`;
}
