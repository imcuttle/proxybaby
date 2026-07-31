#!/usr/bin/env node
/**
 * 本地安装：把 electron-builder 产出的 ProxyBaby.app 覆盖复制到 /Applications。
 * 由 `npm run install:mac` 在 build 之后调用。
 *
 * 流程：
 *   1. 找到 release/ 下的 ProxyBaby.app
 *   2. 若旧版本正在运行，quit 它并**等待进程真正退出**（避免覆盖时文件被占用 /
 *      open -a 复用了残留进程）
 *   3. rm 旧的 /Applications/ProxyBaby.app → ditto 复制新的
 *   4. open -a 重启 app
 *
 * 查找顺序（electron-builder 默认 output=release）：
 *   release/mac-arm64/ProxyBaby.app
 *   release/mac/ProxyBaby.app
 *   release/mac-universal/ProxyBaby.app
 *   release/*.app（兜底遍历）
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const APP_NAME = 'ProxyBaby.app';
const PROC_NAME = 'ProxyBaby';
const DEST = path.join('/Applications', APP_NAME);

function findApp() {
  const candidates = [
    path.join(releaseDir, 'mac-arm64', APP_NAME),
    path.join(releaseDir, 'mac', APP_NAME),
    path.join(releaseDir, 'mac-universal', APP_NAME),
    path.join(releaseDir, 'mac-x64', APP_NAME),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // 兜底：遍历 release 一层子目录
  if (fs.existsSync(releaseDir)) {
    for (const entry of fs.readdirSync(releaseDir)) {
      const p = path.join(releaseDir, entry, APP_NAME);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function isRunning() {
  // pgrep -x 精确匹配进程名。ProxyBaby 主进程名就是 "ProxyBaby"。
  const r = spawnSync('pgrep', ['-x', PROC_NAME], { stdio: 'ignore' });
  return r.status === 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function quitAndWait() {
  if (!isRunning()) return;
  console.log('检测到 ProxyBaby 正在运行，先退出旧版本…');

  // 优先请求 GUI 退出（保存状态、触发 will-quit 钩子）
  try {
    execFileSync('osascript', ['-e', `tell application "${PROC_NAME}" to quit`], { stdio: 'ignore' });
  } catch {}

  // 轮询等待进程消失，最多 5 秒
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isRunning()) {
      console.log('旧进程已退出');
      return;
    }
    await sleep(150);
  }

  // 兜底：强杀（含所有派生子进程）
  console.log('旧进程未在 5s 内退出，发送 SIGTERM…');
  try { execFileSync('pkill', ['-x', PROC_NAME], { stdio: 'ignore' }); } catch {}
  await sleep(300);
  if (isRunning()) {
    console.log('仍在运行，发送 SIGKILL…');
    try { execFileSync('pkill', ['-9', '-x', PROC_NAME], { stdio: 'ignore' }); } catch {}
    await sleep(300);
  }
  if (isRunning()) {
    console.warn('警告：ProxyBaby 进程仍未退出，覆盖可能失败');
  } else {
    console.log('旧进程已退出');
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    console.error('install:mac 仅支持 macOS');
    process.exit(1);
  }
  const app = findApp();
  if (!app) {
    console.error(`未找到构建产物 ${APP_NAME}，请先运行 npm run build`);
    console.error(`已查找目录: ${releaseDir}`);
    process.exit(1);
  }

  console.log(`发现构建产物: ${app}`);

  // 若目标应用正在运行，先退出并等待
  await quitAndWait();

  // 覆盖安装
  if (fs.existsSync(DEST)) {
    console.log(`移除旧版本: ${DEST}`);
    fs.rmSync(DEST, { recursive: true, force: true });
  }
  console.log(`复制到: ${DEST}`);
  // 用 ditto 保留签名/权限/资源分叉
  execFileSync('ditto', [app, DEST], { stdio: 'inherit' });

  console.log('✅ 已覆盖安装到 /Applications/ProxyBaby.app');

  // 自动启动新版本
  try {
    // -n 强制启动新实例（防止 LaunchServices 复用可能残留的旧进程句柄）
    execFileSync('open', ['-n', '-a', DEST], { stdio: 'ignore' });
    console.log('🚀 已启动新版本 ProxyBaby');
  } catch (e) {
    console.error('启动失败，可手动 `open -a ProxyBaby`');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
