/**
 * 应用菜单（中文）。
 * 通过 `Menu.setApplicationMenu(buildAppMenu(deps))` 装载。
 *
 * 大多数项通过给主窗口 send 一个 IPC 事件让渲染层触发，避免主/渲染耦合。
 * 少数项（打开日志目录、清空日志）直接在主进程实现。
 */
import { app, Menu, MenuItemConstructorOptions, BrowserWindow, shell, dialog } from 'electron';
import { getLogDir, getCurrentLogFile, clearAllLogs } from './util/logger';

export interface MenuDeps {
  /** 主窗口访问器，用来发菜单驱动的 IPC 事件到渲染层 */
  getMainWindow: () => BrowserWindow | null;
  /** 打开子窗口（settings/filter-config/rule-debug 等） */
  openChildWindow: (route: 'settings' | 'filter-config' | 'rule-debug' | 'diff' | 'ai-session') => void;
  /** 抓包相关操作 */
  toggleRecording: () => boolean;
  clearFlows: () => void;
  restartProxy: () => Promise<void>;
  /** 会话导入导出（走已有 IPC 逻辑） */
  triggerExport: (format: 'proxybaby' | 'har') => void;
  triggerImport: () => void;
  /** 生成诊断信息 */
  copyDiagnostic: () => Promise<void>;
  /** 手动检查更新（弹独立窗口 or 提示已是最新） */
  checkUpdate: () => Promise<void>;
}

/**
 * 发送简单事件给主窗口渲染进程。渲染层可自选是否处理。
 */
function sendToMain(deps: MenuDeps, channel: string,...args: unknown[]) {
  const w = deps.getMainWindow();
  if (!w || w.isDestroyed()) return;
  w.webContents.send(channel, ...args);
}

export function buildAppMenu(deps: MenuDeps): Menu {
  const isMac = process.platform === 'darwin';

  const appMenu: MenuItemConstructorOptions = {
    label: 'ProxyBaby',
    submenu: [
      { role: 'about', label: '关于 ProxyBaby' },
      { type: 'separator' },
      {
        label: '偏好设置…',
        accelerator: 'CmdOrCtrl+,',
        click: () => deps.openChildWindow('settings'),
      },
      { type: 'separator' },
      { role: 'services', label: '服务' },
      { type: 'separator' },
      { role: 'hide', label: '隐藏 ProxyBaby' },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      { role: 'quit', label: '退出 ProxyBaby' },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: '文件',
    submenu: [
      {
        label: '新建会话',
        accelerator: 'CmdOrCtrl+N',
        click: () => deps.clearFlows(),
      },
      { type: 'separator' },
      {
        label: '导入会话…',
        accelerator: 'CmdOrCtrl+O',
        click: () => deps.triggerImport(),
      },
      {
        label: '导出会话…',
        accelerator: 'CmdOrCtrl+S',
        click: () => deps.triggerExport('proxybaby'),
      },
      {
        label: '导出 HAR…',
        click: () => deps.triggerExport('har'),
      },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '拷贝' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: '视图',
    submenu: [
      {
        label: '显示 / 隐藏侧边栏',
        accelerator: 'CmdOrCtrl+B',
        click: () => sendToMain(deps, 'menu:toggle-sidebar'),
      },
      { type: 'separator' },
      { role: 'reload', label: '重新加载' },
      { role: 'forceReload', label: '强制重新加载' },
      { role: 'toggleDevTools', label: '切换开发者工具' },
      { type: 'separator' },
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '进入 / 退出全屏' },
    ],
  };

  const captureMenu: MenuItemConstructorOptions = {
    label: '抓包',
    submenu: [
      {
        label: '暂停 / 继续抓包',
        accelerator: 'CmdOrCtrl+E',
        click: () => {
          const rec = deps.toggleRecording();
          sendToMain(deps, 'menu:recording-changed', rec);
        },
      },
      {
        label: '清空流量',
        accelerator: 'CmdOrCtrl+K',
        click: () => deps.clearFlows(),
      },
      { type: 'separator' },
      {
        label: '重启代理',
        click: async () => {
          try { await deps.restartProxy(); } catch {}
        },
      },
      {
        label: '监听设置…',
        click: () => sendToMain(deps, 'menu:open-listen-popover'),
      },
    ],
  };

  const rulesMenu: MenuItemConstructorOptions = {
    label: '规则',
    submenu: [
      {
        label: '打开规则与插件',
        accelerator: 'CmdOrCtrl+R',
        click: () => sendToMain(deps, 'menu:switch-tab', 'rules'),
      },
      {
        label: '规则调试…',
        click: () => deps.openChildWindow('rule-debug'),
      },
      {
        label: '过滤配置…',
        click: () => deps.openChildWindow('filter-config'),
      },
    ],
  };

  const debugMenu: MenuItemConstructorOptions = {
    label: '调试',
    submenu: [
      {
        label: '打开日志目录',
        accelerator: 'CmdOrCtrl+Shift+L',
        click: async () => {
          const dir = getLogDir();
          if (dir) await shell.openPath(dir);
        },
      },
      {
        label: '显示当前日志文件',
        click: () => {
          const f = getCurrentLogFile();
          if (f) shell.showItemInFolder(f);
        },
      },
      { type: 'separator' },
      {
        label: '清空所有日志…',
        click: async () => {
          const win = deps.getMainWindow();
          const res = await dialog.showMessageBox(win ?? undefined!, {
            type: 'warning',
            buttons: ['取消', '清空'],
            defaultId: 0,
            cancelId: 0,
            message: '确定要清空所有 ProxyBaby 日志吗？',
            detail: '将删除所有历史日志文件，并将当前日志文件清空。',
          });
          if (res.response === 1) {
            await clearAllLogs();
          }
        },
      },
      { type: 'separator' },
      {
        label: '复制诊断信息',
        click: () => deps.copyDiagnostic(),
      },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: '窗口',
    role: 'windowMenu',
    submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      { type: 'separator' },
      { role: 'front', label: '全部前置' },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: '帮助',
    role: 'help',
    submenu: [
      {
        label: '检查更新…',
        click: () => { deps.checkUpdate().catch(() => {}); },
      },
      { type: 'separator' },
      {
        label: 'ProxyBaby 官网',
        click: () => shell.openExternal('https://github.com/imcuttle/proxybaby'),
      },
      {
        label: 'GitHub Issues',
        click: () => shell.openExternal('https://github.com/imcuttle/proxybaby/issues'),
      },
      {
        label: '查看文档',
        click: () => shell.openExternal('https://github.com/imcuttle/proxybaby#readme'),
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    captureMenu,
    rulesMenu,
    debugMenu,
    windowMenu,
    helpMenu,
  ];

  return Menu.buildFromTemplate(template);
}
