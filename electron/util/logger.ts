/**
 * 统一日志系统（主进程侧）。
 *
 * 特性：
 *   - electron-log v5，dev/prod 都默认 debug 级
 *   - 按天切分 main-YYYY-MM-DD.log，写入 `~/Library/Logs/proxybaby/`（macOS 默认）
 *   - 启动时清理 mtime 超过 7 天的老日志
 *   - `getLogger('scope')` 返回带 `[scope]` 前缀的 scoped logger
 *   - 运行时可用 PROXYBABY_LOG_LEVEL=warn|info|debug|silly 覆盖
 *
 * 格式：
 *   2026-08-04 16:42:03.123 › [scope] › debug › message
 */
import log from 'electron-log/main';
import fs from 'node:fs/promises';
import path from 'node:path';

type Level = 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly';

let initialized = false;
let currentLogDir: string | undefined;
let currentLogFile: string | undefined;

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 幂等初始化。多次调用只会执行一次。
 * 应在 app.whenReady() 之前尽早调用，以便早期日志也能被捕获。
 */
export function initLogger(): void {
  if (initialized) return;
  initialized = true;

  // 允许 PROXYBABY_LOG_LEVEL 覆盖
  const envLevel = (process.env.PROXYBABY_LOG_LEVEL || '').trim().toLowerCase();
  const level: Level = (['error', 'warn', 'info', 'verbose', 'debug', 'silly'] as Level[]).includes(envLevel as Level)
    ? (envLevel as Level)
    : 'debug';

  // 按天切分：resolvePathFn 会在每次写入前被调用，我们据此让 fileName 每天变一次
  log.transports.file.resolvePathFn = (vars) => {
    const dir = vars.libraryDefaultDir; // ~/Library/Logs/<appName>/
    currentLogDir = dir;
    const file = `main-${todayStamp()}.log`;
    currentLogFile = path.join(dir, file);
    return currentLogFile;
  };

  // 关闭 electron-log 内置的按大小旋转（我们按天切分）
  log.transports.file.maxSize = 0;
  log.transports.file.level = level;
  log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s}.{ms} › [{scope}] › {level} › {text}';

  log.transports.console.level = level;
  log.transports.console.format = '{h}:{i}:{s}.{ms} [{scope}] {level} {text}';

  // 捕获未捕获异常 / promise rejection
  log.errorHandler.startCatching({
    showDialog: false,
    onError({ error, processType }: { error: Error; processType: string }) {
      log.scope('crash').error(`uncaught (${processType})`, error);
    },
  });

  // 记一条启动分隔线，方便日志文件里区分会话
  const boot = log.scope('boot');
  boot.info('─'.repeat(60));
  boot.info(`ProxyBaby logger initialized (level=${level})`);

  // 触发一次 resolvePathFn 让 currentLogDir 有值，然后异步清理 retention
  try {
    log.transports.file.getFile();
  } catch {}
  void pruneOldLogs(7).catch((err) => boot.warn('pruneOldLogs failed', err));
}

/**
 * 获取带 scope 前缀的 logger。
 */
export function getLogger(scope: string) {
  // 保证 initLogger 被调用过 —— 早期模块 import 时可能还没 init
  if (!initialized) initLogger();
  return log.scope(scope);
}

/**
 * 当前日志目录（可能未初始化时返回 undefined）。
 */
export function getLogDir(): string | undefined {
  return currentLogDir;
}

/**
 * 当前正在写入的日志文件绝对路径。
 */
export function getCurrentLogFile(): string | undefined {
  return currentLogFile;
}

/**
 * 清理 logDir 下 mtime 超过 retentionDays 天的 main-*.log 文件。
 */
export async function pruneOldLogs(retentionDays: number): Promise<number> {
  if (!currentLogDir) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
  let removed = 0;
  try {
    const entries = await fs.readdir(currentLogDir);
    for (const name of entries) {
      if (!/^main-.*\.log$/.test(name)) continue;
      const full = path.join(currentLogDir, name);
      // 别删今天的当前日志文件
      if (full === currentLogFile) continue;
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs < cutoff) {
          await fs.unlink(full);
          removed++;
        }
      } catch {}
    }
  } catch {}
  return removed;
}

/**
 * 清空所有日志：删除除"当前正在写入的今天日志"外的所有 main-*.log，
 * 并把当前日志文件 truncate 为空。
 */
export async function clearAllLogs(): Promise<{ removed: number; truncated: boolean }> {
  if (!currentLogDir) return { removed: 0, truncated: false };
  let removed = 0;
  try {
    const entries = await fs.readdir(currentLogDir);
    for (const name of entries) {
      if (!/^main-.*\.log$/.test(name)) continue;
      const full = path.join(currentLogDir, name);
      if (full === currentLogFile) continue;
      try {
        await fs.unlink(full);
        removed++;
      } catch {}
    }
  } catch {}
  let truncated = false;
  try {
    if (currentLogFile) {
      await fs.writeFile(currentLogFile, '');
      truncated = true;
    }
  } catch {}
  getLogger('logger').info(`Cleared all logs (removed=${removed}, truncated=${truncated})`);
  return { removed, truncated };
}
