/**
 * ProxyBaby 主进程入口。
 *
 * 生命周期：
 *   ready → 生成 CA、静默安装并信任 → 启动代理 server → 设置系统代理 → 建立 Tray + 窗口
 *   before-quit → 还原系统代理 → 关闭代理 server
 */
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { ensureRootCA } from './mitm/ca';
import { getCertStatus, installAndTrustCert } from './mitm/trust';
import { applySystemProxy, revertSystemProxy, revertSystemProxySync, cleanupStaleProxyPointingAt, getCurrentSystemProxy } from './system/system-proxy';
import { ProxyServer } from './proxy/proxy-server';
import { FlowStore } from './store/flow-store';
import { RuleEngine } from './engine/rule-engine';
import { PluginManager } from './engine/plugins';
import { BreakpointController } from './engine/breakpoint';
import { ScriptStore, setScriptStore } from './engine/scripts';
import { AllowBlockStore, setAllowBlockStore } from './engine/allow-block';
import { SslListStore, setSslListStore } from './engine/ssl-list';
import { UpstreamProxyStore, setUpstreamProxyStore } from './engine/upstream-proxy';
import { setGlobalThrottle, getGlobalThrottle } from './engine/network-conditions';
import { startControlServer, stopControlServer } from './control/control-server';
import { installCliLink, installCliLinkWithSudo } from './system/cli-install';
import { exportProxybaby, importProxybaby, exportHAR } from './store/session-io';
import { repeatFlow } from './proxy/flow-repeat';
import { AiManager } from './ai/manager';
import type {
  ProxyStatus, CertStatus, BreakpointResume, FlowRepeatPatch,
  AllowBlockConfig, SslDecryptConfig, UpstreamProxyConfig, ScriptSummary,
  SystemProxyOverride, FilterEntryEditorParams,
} from '../shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROXY_HOST = '127.0.0.1';
let PROXY_PORT = 9998;

// E2E 模式：跳过证书安装/系统代理（避免 sudo 弹窗），并开放测试注入通道。
const E2E = process.env.PROXYBABY_E2E === '1';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let proxyServer: ProxyServer | null = null;
const store = new FlowStore();
let ruleEngine: RuleEngine | null = null;
let pluginManager: PluginManager | null = null;
let scriptStore: ScriptStore | null = null;
let allowBlockStore: AllowBlockStore | null = null;
let sslListStore: SslListStore | null = null;
let upstreamProxyStore: UpstreamProxyStore | null = null;
const breakpointController = new BreakpointController();
let proxyStatus: ProxyStatus = {
  running: false,
  host: PROXY_HOST,
  port: PROXY_PORT,
  systemProxyApplied: false,
  recording: true,
};
let certStatus: CertStatus = { generated: false, trusted: false };
let aiManager: AiManager | null = null;

// ---- 兜底：无论走何种非正常退出路径，都尽力关掉我们设过的系统代理 ----
// 已应用系统代理时才需要清理；未应用（如 E2E / 用户手动关）时下面调用是 no-op。
let emergencyCleanupDone = false;
function emergencyCleanupProxySync() {
  if (emergencyCleanupDone) return;
  emergencyCleanupDone = true;
  try { revertSystemProxySync(); } catch {}
}
// 收到常见致命信号：SIGINT (Ctrl+C)、SIGTERM (kill / launchd 关机)、SIGHUP (终端断开)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    emergencyCleanupProxySync();
    // Electron 会在 signal 时走 before-quit —— 但如果没走到，这里保证代理已被清
    app.exit(0);
  });
}
// 主进程未捕获异常 / rejection：至少把代理清了再挂
process.on('uncaughtException', (err) => {
  try { console.error('[proxybaby] uncaughtException', err); } catch {}
  emergencyCleanupProxySync();
});
process.on('unhandledRejection', (err) => {
  try { console.error('[proxybaby] unhandledRejection', err); } catch {}
  // 不清代理 —— 未处理的 promise 拒绝不一定是致命的
});
// 进程即将退出：最后一次机会（此时 event loop 已空）
process.on('exit', () => {
  emergencyCleanupProxySync();
});

async function bootstrapProxy() {
  await ensureRootCA();
  if (E2E) {
    certStatus = { generated: true, trusted: true, caPath: 'e2e' };
  } else {
    certStatus = await getCertStatus();
    if (!certStatus.trusted) {
      // 静默尝试安装（会弹一次系统授权）
      certStatus = await installAndTrustCert();
    }
  }

  ruleEngine = new RuleEngine();
  scriptStore = new ScriptStore();
  setScriptStore(scriptStore);
  allowBlockStore = new AllowBlockStore();
  setAllowBlockStore(allowBlockStore);
  sslListStore = new SslListStore();
  setSslListStore(sslListStore);
  upstreamProxyStore = new UpstreamProxyStore();
  setUpstreamProxyStore(upstreamProxyStore);
  pluginManager = new PluginManager(ruleEngine);

  // 断点默认跟随 breakpoint 插件的启停
  breakpointController.setEnabled(pluginManager.list().find((p) => p.id === 'breakpoint')?.enabled ?? false);

  proxyServer = new ProxyServer({
    host: PROXY_HOST,
    port: PROXY_PORT,
    plugins: pluginManager,
    breakpointController,
  });
  wireProxyEvents(proxyServer);
  await proxyServer.start();
  proxyStatus.running = true;

  if (E2E) {
    proxyStatus.systemProxyApplied = false;   // 不改系统代理
  } else {
    // 自愈：如果上次是崩溃/强杀退出的，系统代理可能还残留指向 host:port，
    // 先把这些残留清掉，避免下面 applySystemProxy 再往上叠。
    try {
      const cleaned = await cleanupStaleProxyPointingAt(PROXY_HOST, PROXY_PORT);
      if (cleaned.length) {
        console.log(`[proxybaby] cleaned stale proxy on: ${cleaned.join(', ')}`);
      }
    } catch (err) {
      console.warn('[proxybaby] cleanupStaleProxy failed', err);
    }
    const applied = await applySystemProxy(PROXY_HOST, PROXY_PORT);
    proxyStatus.systemProxyApplied = applied.length > 0;
  }

  // 启动 CLI 控制通道
  startControlServer({
    getProxyStatus: () => proxyStatus,
    getCertStatus: () => certStatus,
    setRecording: async (v: boolean) => {
      proxyStatus.recording = v;
      proxyServer?.setRecording(v);
      broadcast('proxy:status', proxyStatus);
      refreshTrayMenu();
      return proxyStatus;
    },
    clearFlows: async () => store.clear(),
    setSystemProxy: async (on: boolean) => {
      if (on) {
        const svcs = await applySystemProxy(PROXY_HOST, PROXY_PORT);
        proxyStatus.systemProxyApplied = svcs.length > 0;
      } else {
        await revertSystemProxy();
        proxyStatus.systemProxyApplied = false;
      }
      broadcast('proxy:status', proxyStatus);
      refreshTrayMenu();
      return proxyStatus;
    },
    ruleEngine: () => ruleEngine,
    pluginManager: () => pluginManager,
    exportSession: (format, filePath) => {
      const flows = store.all();
      if (format === 'har') exportHAR(flows, filePath);
      else exportProxybaby(flows, filePath);
      return flows.length;
    },
    openWindow: () => showMainWindow(),
    quit: () => app.quit(),
  });

  broadcast('proxy:status', proxyStatus);
  broadcast('cert:status', certStatus);

  // 每秒广播一次流量速率
  setInterval(() => {
    const t = proxyServer?.sampleTraffic();
    if (t) broadcast('proxy:traffic', t);
  }, 1000);

  // 每 5 秒检测一次系统代理是否被其他工具（Proxyman/Charles 等）改写指向非 ProxyBaby。
  // E2E 模式下跳过（避免调 networksetup 触发 sudo）。
  if (!E2E) {
    setInterval(() => { void checkSystemProxyOverride(); }, 5000);
    // 首次立即跑一次
    void checkSystemProxyOverride();
  }
}

let lastOverrideKey: string | null = null;
async function checkSystemProxyOverride() {
  try {
    if (!proxyStatus.systemProxyApplied) {
      // 我们没申请系统代理时，也不主张覆盖检测；只在申请过之后才有意义
      if (lastOverrideKey) {
        lastOverrideKey = null;
        broadcast('proxy:override', null);
      }
      return;
    }
    const cur = await getCurrentSystemProxy();
    const isUs =
      cur && cur.host === proxyStatus.host && cur.port === proxyStatus.port;
    if (!cur || isUs) {
      if (lastOverrideKey) {
        lastOverrideKey = null;
        broadcast('proxy:override', null);
      }
      return;
    }
    const override: SystemProxyOverride = {
      host: cur.host,
      port: cur.port,
      service: cur.service,
      proxybabyHost: proxyStatus.host,
      proxybabyPort: proxyStatus.port,
      detectedAt: Date.now(),
    };
    const key = `${cur.host}:${cur.port}`;
    if (key !== lastOverrideKey) {
      lastOverrideKey = key;
      broadcast('proxy:override', override);
    }
  } catch {
    // ignore
  }
}

function wireProxyEvents(p: ProxyServer) {
  p.on('flow:start', (flow) => {
    store.add(flow);
    broadcast('flow:start', flow);
  });
  p.on('flow:request-body', (payload) => {
    store.updateRequestBody(payload.id, payload.bodyText, payload.bodyBase64, payload.bodySize);
    broadcast('flow:request-body', payload);
  });
  p.on('flow:response-headers', (payload) => {
    store.updateResponseHeaders(payload.id, payload.response);
    broadcast('flow:response-headers', payload);
  });
  p.on('flow:sse-frame', (payload) => {
    store.appendSSEFrame(payload.id, payload.frame);
    broadcast('flow:sse-frame', payload);
  });
  p.on('flow:ws-open', (payload) => {
    broadcast('flow:ws-open', payload);
  });
  p.on('flow:ws-message', (payload) => {
    store.appendWSMessage(payload.id, payload.message);
    broadcast('flow:ws-message', payload);
  });
  p.on('flow:breakpoint', (payload) => {
    broadcast('flow:breakpoint', payload);
  });
  p.on('flow:response-body', (payload) => {
    store.updateResponseBody(payload.id, payload.bodyText, payload.bodyBase64, payload.bodySize);
    broadcast('flow:response-body', payload);
  });
  p.on('flow:end', (payload) => {
    store.finalize(payload.id, payload.durationMs, payload.status, payload.error);
    broadcast('flow:end', payload);
  });
  p.on('flow:app-info', (payload) => {
    store.updateAppInfo(payload.id, payload.app);
    broadcast('flow:app-info', payload);
  });
}

function broadcast(event: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(event, payload);
  }
}

function createTray() {
  // createFromPath 会自动加载同目录的 tray@2x.png 作为 Retina 变体
  const iconPath = path.join(__dirname, '../assets/tray.png');
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    // 兜底：避免图标缺失导致崩溃
    tray = new Tray(nativeImage.createEmpty());
  } else {
    // 模板图：menubar 会按明暗主题自动着色
    image.setTemplateImage(true);
    tray = new Tray(image);
  }
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示 ProxyBaby', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '记录流量',
      type: 'checkbox',
      checked: proxyStatus.recording,
      click: (mi) => {
        proxyStatus.recording = mi.checked;
        proxyServer?.setRecording(mi.checked);
        broadcast('proxy:status', proxyStatus);
      },
    },
    {
      label: proxyStatus.systemProxyApplied ? '✓ macOS 代理已被覆盖' : 'macOS 代理未设置',
      enabled: false,
    },
    {
      label: `监听在 ${proxyStatus.host}:${proxyStatus.port}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: certStatus.trusted ? '✓ 证书已安装并信任' : '⚠ 修复证书信任',
      click: async () => {
        certStatus = await installAndTrustCert();
        broadcast('cert:status', certStatus);
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    { label: '退出', role: 'quit' },
  ]);
  tray.setToolTip('ProxyBaby');
  tray.setContextMenu(menu);
}

function showMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** 通用子窗口打开：hash 路由到 App 里的独立视图（settings/diff） */
const childWindows = new Map<string, BrowserWindow>();
function openChildWindow(route: 'settings' | 'diff' | 'filter-config' | 'filter-entry-editor', opts: { width?: number; height?: number; title?: string } = {}) {
  const existing = childWindows.get(route);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const isSmallDialog = route === 'filter-entry-editor';
  const win = new BrowserWindow({
    width: opts.width ?? 900,
    height: opts.height ?? 700,
    minWidth: isSmallDialog ? 360 : 500,
    minHeight: isSmallDialog ? 260 : 400,
    // 全黑主题：隐藏 macOS 原生标题栏，只留红绿灯；标题由自定义头部承担
    backgroundColor: '#0e0f13',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    title: opts.title ?? route,
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devServerUrl) {
    win.loadURL(`${devServerUrl}#${route}`);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: route });
  }
  win.on('closed', () => childWindows.delete(route));
  childWindows.set(route, win);
}

/**
 * 扫描本地 codebuddy skill 目录，返回 { name, description }[]。
 * 只扫顶层 SKILL.md，不递归 plugins 缓存里的所有 skill（避免 IO 过多）。
 * 目录约定：~/.codebuddy/skills/<name>/SKILL.md
 */
async function listSkills(): Promise<{ name: string; description?: string; source: string }[]> {
  const home = os.homedir();
  const root = path.join(home, '.codebuddy', 'skills');
  const out: { name: string; description?: string; source: string }[] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch { return out; }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const skillMd = path.join(root, name, 'SKILL.md');
    try {
      const st = await fs.stat(skillMd);
      if (!st.isFile()) continue;
      // 只读前 4KB 拿 frontmatter
      const fh = await fs.open(skillMd, 'r');
      try {
        const buf = Buffer.alloc(4096);
        const { bytesRead } = await fh.read(buf, 0, 4096, 0);
        const head = buf.slice(0, bytesRead).toString('utf8');
        const m = /^---[\s\S]*?description:\s*([^\n]+)/m.exec(head);
        const desc = m?.[1]?.trim();
        out.push({ name, description: desc, source: skillMd });
      } finally {
        await fh.close();
      }
    } catch { /* skip */ }
  }
  return out;
}

function setupIpc() {
  const scriptSummary = (s: any): ScriptSummary | null => s ? {
    id: s.id, name: s.name, enabled: s.enabled, code: s.code, always: !!s.always, lastError: s.lastError,
  } : null;

  ipcMain.handle('proxy:get-status', () => proxyStatus);
  ipcMain.handle('cert:get-status', async () => (certStatus = await getCertStatus()));
  ipcMain.handle('proxy:toggle-recording', (_e, recording: boolean) => {
    proxyStatus.recording = recording;
    proxyServer?.setRecording(recording);
    refreshTrayMenu();
    broadcast('proxy:status', proxyStatus);
    return proxyStatus;
  });
  ipcMain.handle('flow:clear', () => {
    store.clear();
  });

  // 取消/启用系统代理
  ipcMain.handle('proxy:set-system', async (_e, on: boolean) => {
    if (E2E) {
      // E2E 模式下不真的操作 networksetup（避免污染宿主机的系统代理）；
      // 只更新内存里的 proxyStatus 并广播，供渲染层断言。
      proxyStatus.systemProxyApplied = on;
    } else if (on) {
      const svcs = await applySystemProxy(PROXY_HOST, PROXY_PORT);
      proxyStatus.systemProxyApplied = svcs.length > 0;
    } else {
      await revertSystemProxy();
      proxyStatus.systemProxyApplied = false;
    }
    refreshTrayMenu();
    broadcast('proxy:status', proxyStatus);
    return proxyStatus;
  });

  // 查询"当前"系统代理指向。如果不是 ProxyBaby，说明被抢占，返回 SystemProxyOverride，否则返回 null。
  ipcMain.handle('proxy:query-system', async (): Promise<SystemProxyOverride | null> => {
    try {
      const cur = await getCurrentSystemProxy();
      if (!cur) return null;
      if (cur.host === proxyStatus.host && cur.port === proxyStatus.port) return null;
      return {
        host: cur.host,
        port: cur.port,
        service: cur.service,
        proxybabyHost: proxyStatus.host,
        proxybabyPort: proxyStatus.port,
        detectedAt: Date.now(),
      };
    } catch {
      return null;
    }
  });

  // 一键切回：把系统代理重新指到 ProxyBaby（覆盖 Proxyman 等工具的设置）。
  ipcMain.handle('proxy:restore-override', async () => {
    try {
      const svcs = await applySystemProxy(PROXY_HOST, PROXY_PORT);
      proxyStatus.systemProxyApplied = svcs.length > 0;
    } catch {
      // ignore
    }
    lastOverrideKey = null;
    refreshTrayMenu();
    broadcast('proxy:status', proxyStatus);
    broadcast('proxy:override', null);
    return proxyStatus;
  });

  // 修改监听端口：还原旧代理 → 换端口重启 → 重设系统代理
  ipcMain.handle('proxy:set-port', async (_e, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === PROXY_PORT) return proxyStatus;
    const wasSystem = proxyStatus.systemProxyApplied;
    try {
      if (wasSystem) await revertSystemProxy();
      await proxyServer?.stop();
      PROXY_PORT = port;
      proxyServer = new ProxyServer({ host: PROXY_HOST, port: PROXY_PORT, plugins: pluginManager!, breakpointController });
      wireProxyEvents(proxyServer);
      await proxyServer.start();
      proxyStatus.port = PROXY_PORT;
      proxyStatus.running = true;
      if (wasSystem && !E2E) {
        const svcs = await applySystemProxy(PROXY_HOST, PROXY_PORT);
        proxyStatus.systemProxyApplied = svcs.length > 0;
      }
    } catch (err) {
      proxyStatus.running = false;
    }
    refreshTrayMenu();
    broadcast('proxy:status', proxyStatus);
    return proxyStatus;
  });
  ipcMain.handle('cert:reinstall', async () => {
    certStatus = await installAndTrustCert();
    refreshTrayMenu();
    broadcast('cert:status', certStatus);
    return certStatus;
  });

  // CLI wrapper 安装（用户在设置界面点"安装 CLI"时触发）
  ipcMain.handle('cli:install', async () => installCliLink({ force: false }));
  ipcMain.handle('cli:install-sudo', async () => installCliLinkWithSudo());

  ipcMain.handle('flow:all', () => store.all());

  // 单个 flow 操作
  ipcMain.handle('flow:remove', (_e, id: string) => {
    const ok = store.remove(id);
    if (ok) broadcast('flow:remove', { id });
    return ok;
  });
  ipcMain.handle('flow:set-note', (_e, id: string, note: string) => store.setNote(id, note));
  ipcMain.handle('flow:set-highlight', (_e, id: string, color: string | null) =>
    store.setHighlight(id, color),
  );
  ipcMain.handle('flow:repeat', async (_e, id: string, patch?: FlowRepeatPatch) => {
    const src = store.all().find((f) => f.id === id);
    if (!src) return { ok: false, error: 'flow not found' };
    try {
      const flow = await repeatFlow(src, patch, {
        emit: (event, payload) => {
          if (event === 'flow:start') store.add(payload);
          if (event === 'flow:response-headers') store.updateResponseHeaders(payload.id, payload.response);
          if (event === 'flow:response-body') store.updateResponseBody(payload.id, payload.bodyText, payload.bodyBase64, payload.bodySize);
          if (event === 'flow:end') store.finalize(payload.id, payload.durationMs, payload.status, payload.error);
          broadcast(event, payload);
        },
      });
      return { ok: true, id: flow.id };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  ipcMain.handle('mitm:disable-host', (_e, host: string, disabled: boolean) => {
    proxyServer?.setHostMitmDisabled(host, disabled);
    return true;
  });
  ipcMain.handle('shell:show-in-finder', (_e, filePath: string) => {
    try { shell.showItemInFolder(filePath); return true; } catch { return false; }
  });
  // 目录列举：给 RulesView 的 file:// 路径补全用。
  //   仅返回**存在**目录的直接子项；不递归；对权限错误静默返回空数组。
  //   支持 ~ 展开。
  ipcMain.handle('fs:list-dir', async (_e, dirPath: string) => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    try {
      let p = dirPath || '/';
      if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
      const st = await fs.stat(p).catch(() => null);
      if (!st || !st.isDirectory()) return { dir: p, entries: [] };
      const items = await fs.readdir(p, { withFileTypes: true });
      return {
        dir: p,
        entries: items
          .filter((d) => !d.name.startsWith('.'))
          .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
          .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)),
      };
    } catch {
      return { dir: dirPath, entries: [] };
    }
  });

  // 规则管理（序列化时去掉 matcher 里的 RegExp，避免 IPC 克隆失败）
  const ruleSetSummary = (rs: any) => rs && ({
    id: rs.id,
    name: rs.name,
    enabled: rs.enabled,
    text: rs.text,
    errors: rs.errors,
    rules: rs.rules.map((r: any) => ({ raw: r.raw, lineNo: r.lineNo, pattern: r.pattern, group: r.group })),
  });
  ipcMain.handle('rules:list', () => (ruleEngine?.list() ?? []).map(ruleSetSummary));
  ipcMain.handle('rules:get', (_e, id: string) => ruleSetSummary(ruleEngine?.get(id)));
  ipcMain.handle('rules:add', (_e, name: string, text: string, enabled: boolean) =>
    ruleSetSummary(ruleEngine?.add(name, text, enabled)),
  );
  ipcMain.handle('rules:update', (_e, id: string, patch: any) => ruleSetSummary(ruleEngine?.update(id, patch)));
  ipcMain.handle('rules:remove', (_e, id: string) => ruleEngine?.remove(id));
  ipcMain.handle('rules:set-enabled', (_e, id: string, enabled: boolean) =>
    ruleEngine?.setEnabled(id, enabled),
  );

  // 插件管理
  ipcMain.handle('plugins:list', () => pluginManager?.list() ?? []);
  ipcMain.handle('plugins:set-enabled', (_e, id: string, enabled: boolean) => {
    const ok = pluginManager?.setEnabled(id, enabled);
    if (id === 'breakpoint') breakpointController.setEnabled(enabled);
    return ok;
  });

  // 断点
  ipcMain.handle('breakpoint:resume', (_e, payload: BreakpointResume) => {
    breakpointController.resume(payload);
  });

  // 子窗口
  ipcMain.handle('window:open', (_e, route: 'settings' | 'diff' | 'filter-config' | 'filter-entry-editor', opts?: any) => {
    openChildWindow(route, opts || {});
    return true;
  });
  ipcMain.handle('window:close-self', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w !== mainWindow) w.close();
  });
  // 子窗口把选中的 flow ids 转给 Diff 窗口
  ipcMain.handle('window:broadcast', (_e, channel: string, payload: any) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(channel, payload);
    }
  });

  // ---- FilterEntry 编辑器子窗口 ----
  // "打开一次性编辑窗口" 的初始参数用 latch 传递：父窗口 open → 主进程存 params →
  // 子窗口 mount 后 consume。避免异步 loadFile 导致的事件订阅竞态。
  let pendingEntryEditorParams: FilterEntryEditorParams | null = null;
  ipcMain.handle('filterEntryEditor:open', (_e, params: FilterEntryEditorParams) => {
    pendingEntryEditorParams = params;
    openChildWindow('filter-entry-editor', {
      title: 'ProxyBaby · 新增过滤规则',
      width: 480,
      height: 320,
    });
    return true;
  });
  ipcMain.handle('filterEntryEditor:consumeInit', () => {
    const p = pendingEntryEditorParams;
    pendingEntryEditorParams = null;
    return p;
  });

  // ---- Scripts ----
  ipcMain.handle('scripts:list', (): ScriptSummary[] =>
    (scriptStore?.list() || []).map((s) => scriptSummary(s)!)
  );
  ipcMain.handle('scripts:add', (_e, name: string, code?: string) => scriptSummary(scriptStore?.add(name, code)));
  ipcMain.handle('scripts:update', (_e, id: string, patch: any) => scriptSummary(scriptStore?.update(id, patch)));
  ipcMain.handle('scripts:remove', (_e, id: string) => scriptStore?.remove(id) ?? false);
  // 脚本测试：在一次性沙盒中运行脚本，返回被脚本改动后的合成请求/响应（不真的发上游）
  ipcMain.handle('scripts:test', async (_e, id: string, testCase: {
    request: { method: string; url: string; headers?: { name: string; value: string }[]; bodyText?: string };
    response?: { status: number; statusText?: string; headers?: { name: string; value: string }[]; bodyText?: string };
  }) => {
    try {
      const rec = scriptStore?.get(id);
      if (!rec) return { ok: false, error: 'script not found' };
      const { runScriptTest } = await import('./engine/scripts');
      return await runScriptTest(rec, testCase);
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ---- Allow / Block List ----
  ipcMain.handle('allowBlock:get', () => allowBlockStore?.get() ?? { mode: 'off', entries: [] });
  ipcMain.handle('allowBlock:set', (_e, cfg: AllowBlockConfig) => allowBlockStore?.set(cfg) ?? { mode: 'off', entries: [] });

  // ---- SSL Decrypt list ----
  ipcMain.handle('sslList:get', () => sslListStore?.get() ?? { enabled: true, mode: 'all', entries: [] });
  ipcMain.handle('sslList:set', (_e, cfg: SslDecryptConfig) => sslListStore?.set(cfg) ?? { enabled: true, mode: 'all', entries: [] });

  // ---- Network conditions ----
  ipcMain.handle('network:get', () => getGlobalThrottle());
  ipcMain.handle('network:set', (_e, key: string | null) => { setGlobalThrottle(key || null); return getGlobalThrottle(); });

  // ---- Upstream Proxy ----
  ipcMain.handle('upstreamProxy:get', () => upstreamProxyStore?.get() ?? { kind: 'off' });
  ipcMain.handle('upstreamProxy:set', (_e, cfg: UpstreamProxyConfig) => upstreamProxyStore?.set(cfg) ?? { kind: 'off' });

  // ---- Composer：直接从主进程发出请求（复用 flow-repeat 的能力） ----
  ipcMain.handle('composer:send', async (_e, req: { method: string; url: string; headers: { name: string; value: string }[]; bodyText?: string }) => {
    try {
      const fakeSrc: any = {
        id: `composer-${Date.now()}`,
        request: {
          method: req.method || 'GET',
          url: req.url,
          host: '', path: '/', scheme: 'https',
          httpVersion: '1.1',
          headers: req.headers || [],
          bodySize: req.bodyText ? Buffer.byteLength(req.bodyText, 'utf8') : 0,
          bodyText: req.bodyText,
          startedAt: Date.now(),
        },
        sseFrames: [],
        isTLS: false,
        status: 'completed',
      };
      const flow = await repeatFlow(fakeSrc, undefined, {
        emit: (event, payload) => {
          if (event === 'flow:start') store.add(payload);
          if (event === 'flow:response-headers') store.updateResponseHeaders(payload.id, payload.response);
          if (event === 'flow:response-body') store.updateResponseBody(payload.id, payload.bodyText, payload.bodyBase64, payload.bodySize);
          if (event === 'flow:end') store.finalize(payload.id, payload.durationMs, payload.status, payload.error);
          broadcast(event, payload);
        },
      });
      return { ok: true, id: flow.id };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // E2E 测试注入通道：把合成事件直接灌入 store 并广播，供 UI 端到端测试使用
  if (E2E) {
    ipcMain.handle('__e2e:emit', (_e, event: string, payload: any) => {
      switch (event) {
        case 'flow:start': store.add(payload); break;
        case 'flow:response-headers': store.updateResponseHeaders(payload.id, payload.response); break;
        case 'flow:sse-frame': store.appendSSEFrame(payload.id, payload.frame); break;
        case 'flow:ws-message': store.appendWSMessage(payload.id, payload.message); break;
        case 'flow:response-body': store.updateResponseBody(payload.id, payload.bodyText, payload.bodyBase64, payload.bodySize); break;
        case 'flow:end': store.finalize(payload.id, payload.durationMs, payload.status, payload.error); break;
        case 'flow:app-info': store.updateAppInfo(payload.id, payload.app); break;
        case 'flow:breakpoint': break;
      }
      broadcast(event, payload);
    });
  }

  // 会话导出/导入
  ipcMain.handle('session:export', async (_e, format: 'proxybaby' | 'har') => {
    const ext = format === 'har' ? 'har' : 'proxybaby';
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `session-${Date.now()}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return { ok: false };
    const flows = store.all();
    if (format === 'har') exportHAR(flows, filePath);
    else exportProxybaby(flows, filePath);
    return { ok: true, filePath, count: flows.length };
  });

  // 导出指定 id 集合的 flows（右键菜单「导出选中」）
  ipcMain.handle('session:export-flows', async (_e, format: 'proxybaby' | 'har', ids: string[]) => {
    const ext = format === 'har' ? 'har' : 'proxybaby';
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `flows-${Date.now()}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return { ok: false };
    const idSet = new Set(ids);
    const flows = store.all().filter((f) => idSet.has(f.id));
    if (format === 'har') exportHAR(flows, filePath);
    else exportProxybaby(flows, filePath);
    return { ok: true, filePath, count: flows.length };
  });

  ipcMain.handle('session:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'ProxyBaby', extensions: ['proxybaby', 'json'] }],
    });
    if (canceled || !filePaths[0]) return { ok: false };
    const flows = importProxybaby(filePaths[0]);
    store.clear();
    for (const f of flows) store.add(f);
    return { ok: true, count: flows.length, flows };
  });

  // ---------- AI ----------
  aiManager = new AiManager({ disableSpawn: E2E });
  const wireAi = (client: ReturnType<AiManager['activeClient']>) => {
    if (!client) return;
    // 每次切换 client 后重新绑定
    const emit = (name: string, payload: any) => broadcast(name, payload);
    client.on('message-start', (p: any) => emit('ai:message-start', { sessionId: aiManager?.currentId(), ...p }));
    client.on('text-delta',    (p: any) => emit('ai:text-delta',    { sessionId: aiManager?.currentId(), ...p }));
    client.on('tool-call',     (p: any) => emit('ai:tool-call',     { sessionId: aiManager?.currentId(), ...p }));
    client.on('tool-result',   (p: any) => emit('ai:tool-result',   { sessionId: aiManager?.currentId(), ...p }));
    client.on('message-end',   (p: any) => emit('ai:message-end',   { sessionId: aiManager?.currentId(), ...p }));
    client.on('error',         (p: any) => emit('ai:error',         { sessionId: aiManager?.currentId(), ...p }));
  };
  ipcMain.handle('ai:list-sessions', () => aiManager?.listSessions() ?? []);
  ipcMain.handle('ai:get-current', () => aiManager?.currentId() ?? null);
  ipcMain.handle('ai:create-session', (_e, title?: string) => {
    const s = aiManager!.createSession(title);
    broadcast('ai:sessions', aiManager!.listSessions());
    return s;
  });
  ipcMain.handle('ai:switch-session', (_e, id: string) => {
    const s = aiManager!.switchSession(id);
    broadcast('ai:sessions', aiManager!.listSessions());
    return s;
  });
  ipcMain.handle('ai:rename-session', (_e, id: string, title: string) => {
    const s = aiManager!.renameSession(id, title);
    broadcast('ai:sessions', aiManager!.listSessions());
    return s;
  });
  ipcMain.handle('ai:delete-session', (_e, id: string) => {
    const ok = aiManager!.deleteSession(id);
    broadcast('ai:sessions', aiManager!.listSessions());
    return ok;
  });
  ipcMain.handle('ai:send', (_e, markdown: string, _attachedFlowIds?: string[]) => {
    const s = aiManager!.send(markdown);
    // 确保当前 client 事件已 wire
    wireAi(aiManager!.activeClient());
    broadcast('ai:sessions', aiManager!.listSessions());
    return s;
  });
  ipcMain.handle('ai:interrupt', () => { aiManager?.interrupt(); });
  ipcMain.handle('ai:get-config', () => aiManager?.getConfig());
  ipcMain.handle('ai:set-config', (_e, patch: any) => aiManager?.setConfig(patch || {}));

  // 列出用户已安装的 skill（用于 @ mention）
  ipcMain.handle('ai:list-skills', async () => {
    return listSkills().catch(() => []);
  });
  // 让用户选一个本地文件（用于 @file mention 附加）
  ipcMain.handle('ai:pick-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择要引用的文件',
    });
    if (canceled || !filePaths[0]) return null;
    return filePaths[0];
  });

  // E2E：直接把 acp 事件灌入当前 active client
  if (E2E) {
    ipcMain.handle('__e2e:ai-emit', (_e, obj: any) => {
      // ensureActive so client exists
      const active = aiManager!.activeClient() || (() => { aiManager!.ensureActive(); wireAi(aiManager!.activeClient()); return aiManager!.activeClient()!; })();
      wireAi(active);
      active.injectServerEvent(obj);
    });
  }
}

app.whenReady().then(async () => {
  // 设置 Dock 图标（开发/未打包时 builder 图标不生效，运行时补上）
  try {
    const dockIcon = nativeImage.createFromPath(path.join(__dirname, '../assets/icon-rounded.png'));
    if (!dockIcon.isEmpty() && app.dock) app.dock.setIcon(dockIcon);
  } catch {}
  // 首次启动 / 每次启动都幂等地把 CLI wrapper 装到 /usr/local/bin，让 `proxybaby` 命令
  // 在 shell 里可用。写不进去（需要 sudo）时静默跳过——UI 可以再暴露一个"提权安装"按钮。
  try {
    const r = await installCliLink();
    if (r.ok && (r.created || r.updated)) {
      console.log(`[proxybaby] CLI ${r.created ? 'installed' : 'updated'} at ${r.path}`);
    } else if (!r.ok && !/开发模式|仅支持 macOS/.test(r.reason)) {
      console.log('[proxybaby] CLI install skipped:', r.reason);
    }
  } catch (err) {
    console.warn('[proxybaby] CLI install error', err);
  }
  setupIpc();
  createTray();
  showMainWindow();
  try {
    await bootstrapProxy();
    refreshTrayMenu();
  } catch (err) {
    console.error('bootstrapProxy error', err);
  }
});

app.on('window-all-closed', () => {
  // 保持后台运行（Tray 常驻），不退出
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;         // 允许再次点击时立即硬退出
  quitting = true;
  e.preventDefault();
  // 硬性超时：无论清理是否完成，2s 后强制退出。
  // 之前若某个 TCP 连接仍在，proxyServer.stop() 里的 server.close() 会永远挂起，
  // 导致 Dock 右键→退出 无反应。
  const timer = setTimeout(() => {
    try { console.warn('[proxybaby] shutdown timed out, forcing exit'); } catch {}
    // 超时说明异步 revert 没跑完 —— 用同步兜底再清一次
    emergencyCleanupProxySync();
    app.exit(0);
  }, 2000);
  try {
    try { stopControlServer(); } catch {}
    try { await revertSystemProxy(); } catch {}
    try { await proxyServer?.stop(); } catch {}
  } finally {
    clearTimeout(timer);
    // 走到这里说明异步 revert 已成功，emergency 就不必再跑一次
    emergencyCleanupDone = true;
    app.exit(0);
  }
});
