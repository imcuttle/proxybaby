/**
 * 通过本地端口反查发起进程（macOS）。
 * 用 lsof 查 TCP 本地端口 → PID → 进程名 / 可执行路径。
 * 结果短期缓存（3s）避免每请求都 fork。
 * 图标：从可执行路径向上找 .app 根目录，用 Electron `app.getFileIcon` 拿 16x16 icon，
 *      转成 data URL 常驻缓存（按 bundlePath key），避免重复 IO。
 *
 * 环境变量 PROXYBABY_DEBUG_PROC=1 会把每一步失败/结果打印到 stdout，方便定位
 * "app icon 拿不到" / "客户端识别为未知" 之类的问题。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, nativeImage } from 'electron';
import type { AppInfo } from '../../shared/types';

const pexec = promisify(execFile);

const DEBUG = process.env.PROXYBABY_DEBUG_PROC === '1';
function dlog(...args: unknown[]) { if (DEBUG) console.log('[proc-lookup]', ...args); }

interface CacheEntry {
  info: AppInfo | null;
  expiresAt: number;
}

const cache = new Map<number, CacheEntry>();
const TTL = 3000;

// bundlePath -> icon data URL (long-lived; icons rarely change)
const iconCache = new Map<string, string>();
// bundlePath -> bundleId (long-lived)
const bundleIdCache = new Map<string, string | undefined>();
// execPath -> icon data URL（bundle 不存在时的兜底缓存）
const execIconCache = new Map<string, string>();

export async function lookupByPort(port: number): Promise<AppInfo | null> {
  const now = Date.now();
  const hit = cache.get(port);
  if (hit && hit.expiresAt > now) return hit.info;

  let info: AppInfo | null = null;
  try {
    // 第一轮：只看 ESTABLISHED（最准）；若无结果再放宽（TIME_WAIT / CLOSE_WAIT 情况）
    let stdout = await runLsof(['-nP', '-iTCP:' + port, '-sTCP:ESTABLISHED', '-Fpcn']);
    if (!stdout) {
      dlog(`port=${port} 首轮 ESTABLISHED 无结果，放宽再查`);
      stdout = await runLsof(['-nP', '-iTCP:' + port, '-Fpcn']);
    }
    // 解析 -F 输出：以 p<pid> 开一组，后面跟 c<command>、多个 n<local->remote>。
    // 关键点：同一个端口会被通信的两端都持有 —— 我们（ProxyBaby）也有一条到该端口的 ESTABLISHED 连接。
    // 需要：① 排除我们自己的 PID；② 选择「本地端口 == port」的那个进程，而不是对端。
    const selfPid = process.pid;
    interface Entry { pid: number; cmd: string; localMatches: boolean }
    const entries: Entry[] = [];
    let cur: Entry | null = null;
    for (const raw of (stdout || '').split('\n')) {
      if (!raw) continue;
      const tag = raw[0];
      const val = raw.slice(1);
      if (tag === 'p') {
        cur = { pid: Number(val), cmd: '', localMatches: false };
        entries.push(cur);
      } else if (tag === 'c' && cur) {
        cur.cmd = val;
      } else if (tag === 'n' && cur) {
        // n 字段形如 127.0.0.1:54321->127.0.0.1:9998
        // 本地是 -> 左侧；若左侧端口等于 port，说明这个进程是「本地端口 = port」的一方，
        // 也就是发起连接的真实客户端进程。
        const arrow = val.indexOf('->');
        if (arrow > 0) {
          const localPart = val.slice(0, arrow);
          const colon = localPart.lastIndexOf(':');
          const lp = colon >= 0 ? Number(localPart.slice(colon + 1)) : NaN;
          if (lp === port) cur.localMatches = true;
        }
      }
    }
    dlog(`port=${port} entries=`, entries.map((e) => ({ pid: e.pid, cmd: e.cmd, localMatches: e.localMatches })), 'self=', selfPid);
    // 首选：本地端口匹配 且 不是我们自己
    let picked = entries.find((e) => e.localMatches && e.pid && e.pid !== selfPid);
    // 兜底：非我们自己的任意一个（老逻辑，兼容 lsof 未输出方向信息的情况）
    if (!picked) picked = entries.find((e) => e.pid && e.pid !== selfPid);
    if (picked && picked.pid) {
      const pid = picked.pid;
      const cmd = picked.cmd;
      // 拿真实可执行路径：直接查 kernel 记录的 txt 段（绝对路径，永不截断，也不含 argv 参数）。
      // 相较 `ps -o comm=` 更稳（后者在 macOS 默认会按行宽截断长路径）。
      let execPath: string | undefined;
      try {
        const { stdout: p2 } = await pexec('lsof', ['-p', String(pid), '-Fn', '-a', '-d', 'txt'], { timeout: 2000 });
        for (const line of p2.split('\n')) {
          if (line.startsWith('n/')) {
            execPath = line.slice(1);
            break;
          }
        }
      } catch (e) {
        dlog(`pid=${pid} lsof -d txt 失败`, (e as Error)?.message);
      }
      // 兜底：lsof -d txt 失败时退回 ps。用 -ww 关行宽截断，再切掉参数。
      if (!execPath) {
        try {
          const { stdout: p3 } = await pexec('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { timeout: 2000 });
          const line = p3.split('\n')[0]?.trim();
          if (line) {
            const sp = line.indexOf(' ');
            execPath = sp > 0 ? line.slice(0, sp) : line;
          }
        } catch (e) {
          dlog(`pid=${pid} ps 兜底失败`, (e as Error)?.message);
        }
      }
      const bundlePath = execPath ? findAppBundle(execPath) : undefined;
      const bundleId = bundlePath ? await readBundleId(bundlePath) : undefined;
      const iconDataUrl = await resolveIcon(bundlePath, execPath);
      info = {
        pid,
        name: friendlyAppName(execPath, cmd, bundlePath),
        execPath,
        bundlePath,
        bundleId,
        iconDataUrl,
      };
      dlog(`port=${port} → pid=${pid} exec=${execPath} bundle=${bundlePath} icon=${iconDataUrl ? 'ok' : 'MISSING'}`);
    } else {
      dlog(`port=${port} 无匹配进程（可能连接已关闭 / lsof 权限不足）`);
    }
  } catch (e) {
    dlog(`port=${port} lookup 顶层异常`, (e as Error)?.message);
    info = null;
  }

  cache.set(port, { info, expiresAt: now + TTL });
  return info;
}

/** 包装 lsof：吞掉超时/EAGAIN，只返回 stdout。 */
async function runLsof(args: string[]): Promise<string> {
  try {
    const { stdout } = await pexec('lsof', args, { timeout: 2000 });
    return stdout;
  } catch (e: any) {
    // lsof 在无匹配时会以 exit=1 退出，err 里带 stdout（可能为空）
    if (e && typeof e === 'object' && 'stdout' in e) return String((e as any).stdout || '');
    dlog('lsof 调用失败:', e?.message);
    return '';
  }
}

function friendlyAppName(execPath: string | undefined, fallback: string, bundlePath?: string): string {
  // 有 bundle 就以 bundle 名（.app / .xpc / .framework 目录名去掉后缀）作为显示名。
  if (bundlePath) {
    const base = path.basename(bundlePath);
    return base.replace(/\.(app|xpc|framework|bundle)$/i, '');
  }
  if (execPath) return path.basename(execPath);
  return fallback || 'unknown';
}

/**
 * 从可执行路径向上找到最近的 bundle 根目录。
 * 依次匹配：
 *   - *.app  （GUI 应用）
 *   - *.xpc  （XPC service，也有 Info.plist / 图标）
 *   - *.bundle
 *   - *.framework
 * 找不到 → undefined（守护进程 / /usr/libexec/xxx）。
 */
function findAppBundle(execPath: string): string | undefined {
  const SUFFIXES = ['.app/', '.xpc/', '.bundle/', '.framework/'];
  for (const suf of SUFFIXES) {
    const idx = execPath.lastIndexOf(suf);
    if (idx >= 0) return execPath.slice(0, idx + suf.length - 1);
  }
  return undefined;
}

async function readBundleId(bundlePath: string): Promise<string | undefined> {
  if (bundleIdCache.has(bundlePath)) return bundleIdCache.get(bundlePath);
  let id: string | undefined;
  try {
    const infoPlist = path.join(bundlePath, 'Contents', 'Info.plist');
    const txt = await fs.readFile(infoPlist, 'utf8');
    const m = txt.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
    if (m) id = m[1].trim();
  } catch {
    id = undefined;
  }
  bundleIdCache.set(bundlePath, id);
  return id;
}

/**
 * 尝试拿 icon dataURL：
 *   1. 优先按 bundlePath 走 app.getFileIcon（cache）
 *   2. bundle 存在但 getFileIcon 返回空 → 手工读 Contents/Resources/*.icns
 *   3. 没 bundle → 尝试 execPath 走 getFileIcon（macOS 会给通用图标）
 *   4. 都失败 → undefined
 */
async function resolveIcon(bundlePath: string | undefined, execPath: string | undefined): Promise<string | undefined> {
  if (bundlePath) {
    const cached = iconCache.get(bundlePath);
    if (cached) return cached;
    try {
      const img = await app.getFileIcon(bundlePath, { size: 'normal' });
      if (!img.isEmpty()) {
        const url = img.resize({ width: 16, height: 16 }).toDataURL();
        iconCache.set(bundlePath, url);
        return url;
      }
      dlog(`getFileIcon(bundle=${bundlePath}) 返回空 image，尝试读 .icns`);
    } catch (e) {
      dlog(`getFileIcon(bundle=${bundlePath}) 抛错`, (e as Error)?.message);
    }
    // 手工读 icns 兜底
    const icnsUrl = await readIcnsFromBundle(bundlePath);
    if (icnsUrl) {
      iconCache.set(bundlePath, icnsUrl);
      return icnsUrl;
    }
  }
  if (execPath) {
    const cached = execIconCache.get(execPath);
    if (cached) return cached;
    try {
      const img = await app.getFileIcon(execPath, { size: 'normal' });
      if (!img.isEmpty()) {
        const url = img.resize({ width: 16, height: 16 }).toDataURL();
        execIconCache.set(execPath, url);
        return url;
      }
      dlog(`getFileIcon(exec=${execPath}) 返回空 image`);
    } catch (e) {
      dlog(`getFileIcon(exec=${execPath}) 抛错`, (e as Error)?.message);
    }
  }
  return undefined;
}

/**
 * bundle 内手工找 .icns 并转成 16x16 dataURL。
 * getFileIcon 在沙盒/权限不足时可能失败，此路径直接读文件。
 */
async function readIcnsFromBundle(bundlePath: string): Promise<string | undefined> {
  try {
    // 首选 Info.plist 里指定的 CFBundleIconFile / CFBundleIconName
    let iconName: string | undefined;
    try {
      const info = await fs.readFile(path.join(bundlePath, 'Contents', 'Info.plist'), 'utf8');
      const m = info.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/)
        || info.match(/<key>CFBundleIconName<\/key>\s*<string>([^<]+)<\/string>/);
      if (m) iconName = m[1].trim();
    } catch {}
    const resDir = path.join(bundlePath, 'Contents', 'Resources');
    let icnsFile: string | undefined;
    if (iconName) {
      const cand = iconName.endsWith('.icns') ? iconName : iconName + '.icns';
      try {
        await fs.access(path.join(resDir, cand));
        icnsFile = path.join(resDir, cand);
      } catch {}
    }
    if (!icnsFile) {
      // 兜底：Resources 下第一个 .icns
      try {
        const entries = await fs.readdir(resDir);
        const first = entries.find((f) => f.toLowerCase().endsWith('.icns'));
        if (first) icnsFile = path.join(resDir, first);
      } catch {}
    }
    if (!icnsFile) return undefined;
    const img = nativeImage.createFromPath(icnsFile);
    if (img.isEmpty()) {
      dlog(`nativeImage(${icnsFile}) 为空`);
      return undefined;
    }
    return img.resize({ width: 16, height: 16 }).toDataURL();
  } catch (e) {
    dlog(`readIcnsFromBundle(${bundlePath}) 失败`, (e as Error)?.message);
    return undefined;
  }
}
