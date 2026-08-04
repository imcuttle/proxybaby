/**
 * 通过本地端口反查发起进程（macOS）。
 * 用 lsof 查 TCP 本地端口 → PID → 进程名 / 可执行路径。
 * 结果短期缓存（3s）避免每请求都fork。
 * 图标：从可执行路径向上找.app 根目录，用 Electron `app.getFileIcon` 拿 16x16 icon，
 *      转成 data URL 常驻缓存（按 bundlePath key），避免重复 IO。
 *
 * 日志：通过统一 logger（scope=proc-lookup）打debug。生产环境默认 debug 级已开启。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, nativeImage } from 'electron';
import type { AppInfo } from '../../shared/types';
import { getLogger } from '../util/logger';

const pexec = promisify(execFile);
const log = getLogger('proc-lookup');
const dlog = (...args: unknown[]) => log.debug(...args);

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

/**
 * 只查 in-memory 缓存的同步版本，用于**关键路径**上不能等 lsof 的调用点
 * （例如 onConnect / onRequest —— 阻塞在这里会推迟上游请求发出、拉长首字节 TTFB）。
 * 缓存未命中时返回 null，调用方应把真正的 `lookupByPort` 丢到后台去做，
 * 结果稍后通过独立事件补给 flow。
 */
export function lookupByPortCached(port: number): AppInfo | null {
  const hit = cache.get(port);
  if (hit && hit.expiresAt > Date.now()) return hit.info;
  return null;
}

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
      let bundlePath = execPath ? findAppBundle(execPath) : undefined;
      let ancestorExec: string | undefined;
      let ancestorCmd: string | undefined;
      // 如果自己没 bundle（典型：node/python 这类 CLI 解释器），沿 PPID 链向上找
      // 第一个属于某个 .app bundle 的祖先——CLI 通常是终端 app（iTerm2 / Terminal /
      // cmux 等）启动的子进程，用祖先的图标和 name 展示比 "node" 更有意义。
      if (!bundlePath) {
        const ancestor = await findAncestorAppProcess(pid);
    if (ancestor) {
      bundlePath = ancestor.bundlePath;
          ancestorExec = ancestor.execPath;
        ancestorCmd = ancestor.cmd;
dlog(`pid=${pid} 用祖先 app: pid=${ancestor.pid} bundle=${bundlePath}`);
        }
      }
      const bundleId = bundlePath ? await readBundleId(bundlePath) : undefined;
 const iconDataUrl = await resolveIcon(bundlePath, ancestorExec ?? execPath);
      info = {
        pid,
        name: friendlyAppName(ancestorExec ?? execPath, ancestorCmd ?? cmd, bundlePath),
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
 * 从可执行路径向上找到 bundle 根目录。
 *
 * 策略：
 *   - `.app` 取**最外层**（最左边一个）。这样 Chrome/VSCode/Electron 类应用的
 *     `.../Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/...` 会归到
 *     主 app（Google Chrome.app），拿到主 icon 和主 name，而不是 helper.app 那个
 *     几乎全空的图标外壳。
 *   -其它 bundle（`.xpc` / `.bundle` / `.framework`）保持取最近一层（它们通常独立分发）。
 *   - 都找不到 → undefined（守护进程 / /usr/libexec/xxx）。
 */
export function findAppBundle(execPath: string): string | undefined {
  // 最外层 .app
  const appIdx = execPath.indexOf('.app/');
  if (appIdx >= 0) return execPath.slice(0, appIdx + '.app'.length);
  // 其它 bundle 后缀：仍取最近一层
  for (const suf of ['.xpc/', '.bundle/', '.framework/']) {
    const idx = execPath.lastIndexOf(suf);
    if (idx >= 0) return execPath.slice(0, idx + suf.length - 1);
  }
  return undefined;
}

interface AncestorAppInfo {
  pid: number;
  bundlePath: string;
  execPath: string;
  cmd: string;
}

/**
 * 沿 PPID 链向上找第一个属于 .app bundle 的祖先进程。
 * 用于 node/python 等 CLI 解释器：本身没图标，但它的启动祖先（iTerm2 / Terminal /
 * cmux / VSCode 等 GUI app）有真实图标。
 *
 * 一次 `ps -Ao pid=,ppid=,command=` 拿全表，避免每级 pid 都 fork 一次 ps。
 * 最多走 8 层，防止环状 ppid（理论上不该有，但保险）。
 */
async function findAncestorAppProcess(startPid: number): Promise<AncestorAppInfo | undefined> {
  try {
    const { stdout } = await pexec('ps', ['-Awwo', 'pid=,ppid=,command='], { timeout: 2000 });
    const table = new Map<number, { ppid: number; cmd: string }>();
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
  if (!m) continue;
      table.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
    }
    let pid = table.get(startPid)?.ppid;
    for (let i = 0; i < 8 && pid && pid > 1; i++) {
   const row = table.get(pid);
   if (!row) break;
      const sp = row.cmd.indexOf(' ');
      const execPath = sp > 0 ? row.cmd.slice(0, sp) : row.cmd;
const bundlePath = findAppBundle(execPath);
      if (bundlePath) {
     return { pid, bundlePath, execPath, cmd: row.cmd };
      }
      pid = row.ppid;
}
  } catch (e) {
    dlog(`findAncestorAppProcess(${startPid}) 失败`, (e as Error)?.message);
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
 *   2. bundle 存在但 getFileIcon 返回空/极小 → 手工读 Contents/Resources/*.icns
 *   3. 没 bundle → 尝试 execPath 走 getFileIcon（macOS 会给通用图标）
 *   4. 都失败 → undefined
 *
 * 注意：不做 resize（16x16）——某些 Electron 版本的 nativeImage.resize 会返回空图，
 * 直接把 32x32 的原图 dataURL 交给渲染层用 CSS 控制显示尺寸更稳。
 */
async function resolveIcon(bundlePath: string | undefined, execPath: string | undefined): Promise<string | undefined> {
  if (bundlePath) {
    const cached = iconCache.get(bundlePath);
    if (cached) return cached;
    // 优先手工读 Contents/Resources/*.icns —— app.getFileIcon 在未签名/未授权 TCC 场景下
    // 常常只能拿到"UTType 通用占位图"（macOS 15 上实测每个不同 .app 都是同一张
    // 1634-byte 透明轮廓）。直接读 icns 才拿得到真实图标。
    const icnsUrl = await readIcnsFromBundle(bundlePath);
    if (icnsUrl) {
      iconCache.set(bundlePath, icnsUrl);
   dlog(`readIcnsFromBundle(${bundlePath}) ok len=${icnsUrl.length}`);
      return icnsUrl;
    }
    // 兜底：icns 找不到（比如非常规 bundle 结构），再试 getFileIcon
    try {
      const img = await app.getFileIcon(bundlePath, { size: 'normal' });
      if (!img.isEmpty()) {
        const url = img.toDataURL();
    if (url) {
          iconCache.set(bundlePath, url);
       dlog(`getFileIcon(bundle=${bundlePath}) fallback ok len=${url.length}`);
          return url;
        }
      }
      dlog(`getFileIcon(bundle=${bundlePath}) 返回空 image`);
    } catch (e) {
 dlog(`getFileIcon(bundle=${bundlePath}) 抛错`, (e as Error)?.message);
    }
  }
  if (execPath) {
    const cached = execIconCache.get(execPath);
    if (cached) return cached;
    // execPath 分支只对"能直接读到图标"的可执行文件才有意义。node/python 等解释器
    // 通过 getFileIcon 拿到的都是空占位，不如返回 undefined 让渲染层显示 Package fallback。
    // 只在 execPath 明确是某种"应用主二进制"时才尝试。这里保守起见直接跳过。
  dlog(`skip execPath icon lookup (${execPath}) —— 通常只能拿到占位符`);
  }
  return undefined;
}

/**
 * bundle 内手工找 .icns 并转成 dataURL。
 *
 * 为什么不用 `nativeImage.createFromPath(icns)`？
 *   实测在 macOS 15 + Electron 32 上，某些 app 的 icns（如 Google Chrome/VS Code
 *   等自签发或多分辨率格式）会被 Electron 认为 empty，即便文件本身是完整的 icns。
 *   于是我们退而求其次：手工解析 icns 二进制结构，直接抽出内嵌的第一个 PNG frame。
 *   icns 从 Mac OS X 10.7 起支持 PNG 编码的图标（type=ic07/08/09/10/11/12/13/14），
 *现代 app 的图标基本都是 PNG 内嵌。
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
    const buf = await fs.readFile(icnsFile);
  const pngUrl = extractPngFromIcns(buf);
    if (pngUrl) return pngUrl;
// 若 icns 里没有 PNG frame（老格式），退回 nativeImage
    const img = nativeImage.createFromPath(icnsFile);
    if (img.isEmpty()) {
  dlog(`nativeImage(${icnsFile}) 为空`);
      return undefined;
    }
    return img.toDataURL();
  } catch (e) {
    dlog(`readIcnsFromBundle(${bundlePath}) 失败`, (e as Error)?.message);
    return undefined;
  }
}

/**
 * 从 icns 二进制里抽出**最大**的 PNG frame，编码成 dataURL。
 *
 * icns 结构：
 *   [0..4)   magic = "icns"
 *   [4..8)   total file size (big-endian uint32)
 *   [8..) 一连串 8-byte header + payload：
 *  [0..4)  type (4-char code, e.g. "ic07"/"ic08")
 *         [4..8)  record size including header (big-endian uint32)
 *   [8..) payload
 *
 * PNG-encoded 图标 type: ic04(16), ic05(32), ic07(128), ic08(256), ic09(512),
 *    ic10(1024), ic11(32 retina), ic12(64), ic13(256 retina),
 *        ic14(512 retina)。payload 直接就是完整 PNG 文件（89 50 4E 47 开头）。
 */
function extractPngFromIcns(buf: Buffer): string | undefined {
  if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'icns') return undefined;
  let offset = 8;
  let best: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > buf.length) break;
    const payload = buf.subarray(offset + 8, offset + size);
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    if (
      payload.length > 8 &&
      payload[0] === 0x89 &&
      payload[1] === 0x50 &&
   payload[2] === 0x4e &&
    payload[3] === 0x47
    ) {
      // 挑最大的（通常是最高分辨率）
      if (!best || payload.length > best.length) best = payload;
    }
    offset += size;
  }
  if (!best) return undefined;
  return `data:image/png;base64,${best.toString('base64')}`;
}
