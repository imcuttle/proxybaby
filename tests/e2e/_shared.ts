import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

/**
 * 每个 spec 文件调用一次，返回一个独立的 electron app + 主窗口 + 临时 userDataDir。
 * 传入 tag 用于区分不同 spec 的临时目录（便于失败时定位）。
 * `extraReadyCheck` 用于 AI 场景等待 __pbAiStore 之类的额外桥就绪。
 */
export async function launchApp(tag: string, extraReadyCheck?: (page: Page) => Promise<void>) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `pb-e2e-${tag}-`));
  const app: ElectronApplication = await electron.launch({
    args: [path.join(root, 'dist-electron/main.js'), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      PROXYBABY_E2E: '1',
      NODE_ENV: 'production',
    },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log(`[pageerror:${tag}]`, e.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => !!(window as any).__pbE2E && !!(window as any).proxybaby,
    null,
    { timeout: 15000 },
  );
  if (extraReadyCheck) await extraReadyCheck(page);
  return { app, page, userDataDir };
}

export async function disposeApp(ctx: { app?: ElectronApplication; userDataDir?: string }) {
  await ctx.app?.close().catch(() => {});
  if (ctx.userDataDir) fs.rmSync(ctx.userDataDir, { recursive: true, force: true });
}

/** 通过 E2E 通道按事件序列灌入 flow */
export async function injectFlow(
  page: Page,
  flow: any,
  events: { event: string; payload: any }[] = [],
) {
  await page.evaluate(
    async ({ flow, events }) => {
      const e = (window as any).__pbE2E;
      await e.emit('flow:start', flow);
      for (const ev of events) await e.emit(ev.event, ev.payload);
    },
    { flow, events },
  );
}

/**
 * 保证测试所需的三个 base flow 已经在 store 中；重复调用幂等。
 * 有些测试可能因前一个 test 出错而丢失 fixture，这里做兜底。
 */
export async function ensureBaseFlows(page: Page) {
  const flowsPresent = await page.evaluate(() => {
    const s = (window as any).__pbStore?.getState?.();
    if (!s) return 0;
    return s.flows.filter((f: any) => f.id === 'f-http').length;
  });
  if (flowsPresent > 0) return;
  await injectFlow(
    page,
    {
      id: 'f-http', status: 'pending', isTLS: true, sseFrames: [],
      app: { name: 'node', pid: 1 },
      request: { method: 'POST', url: 'https://api.demo.com/users', host: 'api.demo.com', path: '/users', scheme: 'https', httpVersion: '1.1', headers: [{ name: 'Accept', value: 'application/json' }], bodySize: 0, startedAt: Date.now(), contentType: 'application/json', bodyText: '{"name":"alice"}' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-http', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [{ name: 'Content-Type', value: 'application/json' }], bodySize: 0, isSSE: false, contentType: 'application/json' } } },
      { event: 'flow:response-body', payload: { id: 'f-http', bodyText: '{"id":1,"name":"alice"}', bodySize: 22 } },
      { event: 'flow:end', payload: { id: 'f-http', durationMs: 33, status: 'completed' } },
    ],
  );
  await injectFlow(
    page,
    {
      id: 'f-ai', status: 'streaming', isTLS: true, sseFrames: [],
      app: { name: 'node', pid: 2 },
      request: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', host: 'api.openai.com', path: '/v1/chat/completions', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now(), contentType: 'application/json', bodyText: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: '你好' }] }) },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-ai', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: true, contentType: 'text/event-stream' } } },
      { event: 'flow:end', payload: { id: 'f-ai', durationMs: 120, status: 'completed' } },
    ],
  );
  await injectFlow(
    page,
    {
      id: 'f-ws', status: 'streaming', isTLS: true, isWebSocket: true, sseFrames: [], wsMessages: [],
      app: { name: 'Chrome', pid: 3 },
      request: { method: 'GET', url: 'wss://echo.demo.com/ws', host: 'echo.demo.com', path: '/ws', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now() },
    },
    [],
  );
}

/**
 * 切回抓包页+ 清空所有 filter/pin/save/搜索。前置 ensureBaseFlows 兜底注入 fixture。
 */
export async function resetFilters(page: Page) {
  await page.getByRole('button', { name: '抓包' }).click();
  await ensureBaseFlows(page);
  await page.evaluate(() => {
    const anyWin = window as any;
    if (anyWin.__pbStore?.getState) {
      anyWin.__pbStore.getState().resetFilter();
      anyWin.__pbStore.setState({ selectedIds: {}, selectedId: null, pinnedHosts: {}, pinnedPaths: {}, pinnedIds: {} });
    }
    try { localStorage.removeItem('proxybaby:pinned-hosts'); } catch {}
    try { localStorage.removeItem('proxybaby:pinned-paths'); } catch {}
  });
  const bar = page.getByTestId('searchbar-input');
  if (!(await bar.isVisible().catch(() => false))) {
    await page.evaluate(() => (window as any).__pbStore?.getState().setSearchOpen(true));
  }
  await page.getByTestId('searchbar-input').fill('');
}

export function aiFlow(opts: {
  id: string;
  sessionId?: string;
  rootRequestId?: string;
  startedAt: number;
  model?: string;
}) {
  const headers: { name: string; value: string }[] = [];
  if (opts.sessionId) headers.push({ name: 'X-Conversation-Id', value: opts.sessionId });
  if (opts.rootRequestId) headers.push({ name: 'X-Root-Request-Id', value: opts.rootRequestId });
  return {
    id: opts.id,
    status: 'completed' as const,
    isTLS: true,
    sseFrames: [],
    app: { name: 'cbc', pid: 999 },
    request: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      host: 'api.openai.com',
      path: '/v1/chat/completions',
      scheme: 'https' as const,
      httpVersion: '1.1',
      headers,
      bodySize: 0,
      startedAt: opts.startedAt,
      contentType: 'application/json',
      bodyText: JSON.stringify({ model: opts.model || 'gpt-4o', messages: [{ role: 'user', content: 'q' }] }),
    },
  };
}

export async function openSettingsWindow(app: ElectronApplication, page: Page) {
  const before = app.windows().length;
  await page.getByTestId('open-settings').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#settings'));
  if (!win) throw new Error('settings 子窗口没有开出来');
  await win.waitForLoadState('domcontentloaded');
  return win;
}

export async function openFilterConfigWindow(app: ElectronApplication, page: Page) {
  const before = app.windows().length;
  await page.getByTestId('open-filter-config').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find(
    (w) => w !== page && w.url().includes('filter-config') && !w.url().includes('filter-entry-editor'),
  );
  if (!win) throw new Error('filter-config 子窗口没有开出来');
  await win.waitForLoadState('domcontentloaded');
  return win;
}

export async function waitForEntryEditorWindow(app: ElectronApplication, page: Page) {
  const t0 = Date.now();
  let win: any = null;
  while (Date.now() - t0 < 10000) {
    win = app.windows().find((w) => w.url().includes('filter-entry-editor'));
    if (win) break;
    await page.waitForTimeout(50);
  }
  if (!win) throw new Error('filter-entry-editor 子窗口没有开出来');
  await win.waitForLoadState('domcontentloaded');
  await win.getByTestId('filter-entry-editor').waitFor({ state: 'visible' });
  return win;
}
