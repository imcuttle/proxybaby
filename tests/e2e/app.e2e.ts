import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  injectFlow as _injectFlow,
  ensureBaseFlows as _ensureBaseFlows,
  resetFilters as _resetFilters,
  aiFlow as _aiFlow,
  openSettingsWindow as _openSettingsWindow,
  openFilterConfigWindow as _openFilterConfigWindow,
  waitForEntryEditorWindow as _waitForEntryEditorWindow,
} from './_shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

let app: ElectronApplication;
let page: Page;

// 每次跑用独立 userData，避免污染真实配置
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-e2e-'));

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(root, 'dist-electron/main.js'), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      PROXYBABY_E2E: '1',
      NODE_ENV: 'production',
    },
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  // 等待 preload 桥接就绪
  await page.waitForFunction(() => !!(window as any).__pbE2E && !!(window as any).proxybaby, null, { timeout: 15000 });
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

// 注入一个 flow 的辅助：通过 E2E 通道按事件序列灌入（delegates to _shared）
async function injectFlow(flow: any, events: { event: string; payload: any }[] = []) {
  await _injectFlow(page, flow, events);
}

test('应用启动并显示主界面（工具栏+抓包标签）', async () => {
  await expect(page.getByText('ProxyBaby |')).toBeVisible();
  await expect(page.getByRole('button', { name: '抓包' })).toBeVisible();
  await expect(page.getByRole('button', { name: '规则', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编写', exact: true })).toBeVisible();
  // 设置按钮打开独立窗口；Diff 已移入右键菜单
  await expect(page.getByTestId('open-settings')).toBeVisible();
  await expect(page.getByTestId('open-diff')).toHaveCount(0);
});

test('抓包：注入普通请求后出现在列表并可查看详情', async () => {
  await injectFlow(
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

  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-http"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('api.demo.com/users');
  await expect(row).toContainText('POST');
  await expect(row).toContainText('200');
  await expect(row).toContainText('node');

  // 选中查看详情
  await row.click();
  await expect(page.getByText('https://api.demo.com/users').first()).toBeVisible();
  // Request headers Tab（默认 headers）
  await expect(page.getByText('Accept').first()).toBeVisible();
});

test('mock 规则命中：Response Body 显示 mock 内容 + 列表出现「已编辑」✓标记', async () => {
  // 覆盖历史 bug：短路路径（respond）不发flow:response-headers 导致 UI 上 flow.response 为
  // undefined，Body/原始 tab 显示"暂无数据"；同时 flow:start 提前于 edited 赋值导致列表看不到
  // 已编辑标记。这里以事件序列复现 fix 后的真实主进程行为并做断言。
  await injectFlow(
    {
      id: 'f-mock',
      status: 'pending',
      isTLS: true,
      sseFrames: [],
      edited: true,
      matchedRules: [{ruleSetId: 'rs-1', ruleSetName: '测试集', lineNo: 1, pattern: 'demo.com', ops: [{ op: 'mock', value: '{"a":1}' }] } as any],
      app: { name: 'node', pid: 42 },
      request: { method: 'GET', url: 'https://demo.com/mocked', host: 'demo.com', path: '/mocked', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now(), contentType: '' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-mock', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [{ name: 'content-type', value: 'application/json' }], bodySize: 7, isSSE: false, contentType: 'application/json' } } },
      { event: 'flow:response-body', payload: { id: 'f-mock', bodyText: '{"a":1}', bodySize: 7 } },
      { event: 'flow:end', payload: { id: 'f-mock', durationMs: 5, status: 'completed' } },
    ],
  );

  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-mock"]');
  await expect(row).toBeVisible();
  // 已编辑标记（RequestList 里用 ✓ 显示在edited 列）
  await expect(row).toContainText('✓');

  await row.click();
  // Response 区的「正文」tab
  await page.getByRole('tab', { name: '正文' }).last().click();
  // 不能是"空body"
  await expect(page.getByTestId('body-empty')).toHaveCount(0);
  // 展示的是mock 内容
  await expect(page.getByTestId('body-view').getByText(/"a"/).first()).toBeVisible();
});

test('已编辑标记：hover 展示命中规则 tooltip + 点击跳转规则页并focus 到规则行', async () => {
  // 1) 先在规则页新建一个规则集，拿到真实的 ruleSetId
  await page.getByRole('button', { name: '规则', exact: true }).click();
  const created = await page.evaluate(async () => {
    const api = (window as any).proxybaby;
    return await api.rulesAdd('e2e-matched', 'example.com/x foo://bar\n', true);
  });
  const ruleSetId: string = (created as any)?.id;
  expect(ruleSetId).toBeTruthy();

  // 2) 回抓包页，注入一个带 matchedRules 的flow
  await page.getByRole('button', { name: '抓包' }).click();
  await injectFlow(
    {
      id: 'f-hover',
      status: 'completed',
      isTLS: true,
      sseFrames: [],
      edited: true,
      note: '测试备注文本',
      matchedRules: [{ ruleId: ruleSetId, ruleName: 'e2e-matched', pattern: 'example.com/x', lineNo: 1 }],
      app: { name: 'node', pid: 42 },
      request: { method: 'GET', url: 'https://example.com/x', host: 'example.com', path: '/x', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now(), contentType: '' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-hover', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false, contentType: 'text/plain' } } },
      { event: 'flow:end', payload: { id: 'f-hover', durationMs: 1, status: 'completed' } },
    ],
  );

  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-hover"]');
  await expect(row).toBeVisible();

  // 3) 备注单元格应该显示文本（不是 icon）
  await expect(row).toContainText('测试备注文本');

  // 4) hover 已编辑 badge →弹自定义 tooltip，包含规则名 + pattern
  const badge = row.getByTestId('edited-badge');
  await expect(badge).toBeVisible();
  await badge.hover();
  const item = page.getByTestId('matched-rule-item').first();
  await expect(item).toBeVisible();
  await expect(item).toContainText('e2e-matched');
  await expect(item).toContainText('example.com/x');

  // 5) 点击→ 应切到规则页，并选中该规则集
  await item.click();
  await expect(page.getByTestId('rules-mode-tabs')).toBeVisible();
  // 编辑器内容应加载出目标规则集
  await expect(page.locator('.monaco-editor .view-line').getByText(/example\.com\/x/).first()).toBeVisible();

  // 清理
  await page.evaluate(async (id) => await (window as any).proxybaby.rulesRemove(id), ruleSetId);
});

test('列排序：已编辑 / 备注 两列表头点击后按值排序', async () => {
  // 前一个测试结束在规则页，切回抓包页。
  await page.getByRole('button', { name: '抓包' }).click();

  // 注入 3 个 flow：
  //  f-sort-a: 无edited、无 note
  //  f-sort-b: edited=true、note='alpha'
  //  f-sort-c: edited=false、note='zeta'
  // 默认按抓包顺序 [a, b, c]。
  const now = Date.now();
  await injectFlow(
    { id: 'f-sort-a', status: 'completed', isTLS: false, sseFrames: [],
      app: { name: 'node', pid: 501 },
      request: { method: 'GET', url: 'https://sort.test/a', host: 'sort.test', path: '/a', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: now, contentType: '' } },
    [
      { event: 'flow:response-headers', payload: { id: 'f-sort-a', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false, contentType: 'text/plain' } } },
      { event: 'flow:end', payload: { id: 'f-sort-a', durationMs: 1, status: 'completed' } },
    ],
  );
  await injectFlow(
    { id: 'f-sort-b', status: 'completed', isTLS: false, sseFrames: [], edited: true, note: 'alpha',
      app: { name: 'node', pid: 502 },
      request: { method: 'GET', url: 'https://sort.test/b', host: 'sort.test', path: '/b', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: now + 1, contentType: '' } },
    [
      { event: 'flow:response-headers', payload: { id: 'f-sort-b', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false, contentType: 'text/plain' } } },
      { event: 'flow:end', payload: { id: 'f-sort-b', durationMs: 1, status: 'completed' } },
    ],
  );
  await injectFlow(
    { id: 'f-sort-c', status: 'completed', isTLS: false, sseFrames: [], note: 'zeta',
      app: { name: 'node', pid: 503 },
      request: { method: 'GET', url: 'https://sort.test/c', host: 'sort.test', path: '/c', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: now + 2, contentType: '' } },
    [
      { event: 'flow:response-headers', payload: { id: 'f-sort-c', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false, contentType: 'text/plain' } } },
      { event: 'flow:end', payload: { id: 'f-sort-c', durationMs: 1, status: 'completed' } },
    ],
  );

  // 借助 store 上的 sort 状态直接触发 cycleSort，绕开 header 元素定位（表头无 testid）。
  // 用URL 过滤，只留下这 3 条待排序 flow，避免受其他测试注入 flow 干扰。
  await page.evaluate(() => {
    const store = (window as any).__pbStore;
    store.getState().setFilter({ ...store.getState().filter, text: 'sort.test', scope: 'url', mode: 'contains', enabled: true, type: 'all' });
  });

  const idsInOrder = async () =>
    await page.$$eval('[data-testid="flow-row"]', (rows) => rows.map((r) => (r as HTMLElement).getAttribute('data-flow-id')));

  // 首次点击（asc）：已编辑在前（b），未编辑在后（a, c）
  await page.evaluate(() => (window as any).__pbStore.getState().cycleSort('edited'));
  await expect.poll(async () => (await idsInOrder())[0]).toBe('f-sort-b');

  // 再点一次 → 降序：未编辑在前（c, a），已编辑在后（b）
  await page.evaluate(() => (window as any).__pbStore.getState().cycleSort('edited'));
  await expect.poll(idsInOrder).toEqual(['f-sort-c', 'f-sort-a', 'f-sort-b']);

  // 再点一次 → 恢复无排序
  await page.evaluate(() => (window as any).__pbStore.getState().cycleSort('edited'));
  await expect.poll(idsInOrder).toEqual(['f-sort-a', 'f-sort-b', 'f-sort-c']);

  // 备注升序：空备注视为最小 → a在前，然后 alpha(b)、zeta(c)
  await page.evaluate(() => (window as any).__pbStore.getState().cycleSort('note'));
  await expect.poll(idsInOrder).toEqual(['f-sort-a', 'f-sort-b', 'f-sort-c']);

  // 再点一次 → 降序：zeta、alpha、空
  await page.evaluate(() => (window as any).__pbStore.getState().cycleSort('note'));
  await expect.poll(idsInOrder).toEqual(['f-sort-c', 'f-sort-b', 'f-sort-a']);

  // 清理：取消排序 + 清 filter
  await page.evaluate(() => (window as any).__pbStore.getState().cycleSort('note'));
  await page.evaluate(() => {
    const store = (window as any).__pbStore;
    store.getState().setFilter({ ...store.getState().filter, text: '', enabled: false });
  });
});

test('抓包列表「客户端」列 hover：显示进程信息 tooltip（PID / bundleId / 路径）', async () => {
  // 保证在抓包页
  await page.getByRole('button', { name: '抓包' }).click();
  await injectFlow(
    {
      id: 'f-app-info',
      status: 'completed',
      isTLS: true,
      sseFrames: [],
      app: {
        name: 'SiriSuggestionsBookkeepingService',
        pid: 12345,
        bundleId: 'com.apple.SiriSuggestionsBookkeepingService',
        execPath: '/System/Library/PrivateFrameworks/SiriSuggestionsSupport.framework/Versions/A/XPCServices/SiriSuggestionsBookkeepingService.xpc/Contents/MacOS/SiriSuggestionsBookkeepingService',
        bundlePath: '/System/Library/PrivateFrameworks/SiriSuggestionsSupport.framework/Versions/A/XPCServices/SiriSuggestionsBookkeepingService.xpc',
      },
      request: {
        method: 'GET',
        url: 'https://apple.com/siri',
        host: 'apple.com',
        path: '/siri',
        scheme: 'https',
        httpVersion: '1.1',
        headers: [],
        bodySize: 0,
        startedAt: Date.now(),
        contentType: '',
      },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-app-info', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false, contentType: 'text/plain' } } },
      { event: 'flow:end', payload: { id: 'f-app-info', durationMs: 1, status: 'completed' } },
    ],
  );

  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-app-info"]');
  await expect(row).toBeVisible();

  // hover 客户端列的锚点 → 弹 tooltip
  const anchor = row.getByTestId('app-info-anchor').first();
  await expect(anchor).toBeVisible();
  await anchor.hover();

  const tooltip = page.getByTestId('app-info-tooltip').first();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('SiriSuggestionsBookkeepingService');
  await expect(tooltip).toContainText('com.apple.SiriSuggestionsBookkeepingService');
  await expect(tooltip).toContainText('12345');
  await expect(tooltip).toContainText('SiriSuggestionsBookkeepingService.xpc');

  // 鼠标移出 → 释放 tooltip 状态，避免影响后续测试
  await page.mouse.move(0, 0);
});

test('AI 美化：注入 OpenAI 流式响应，OpenAI Tab 呈现 chat 气泡', async () => {
  await injectFlow(
    {
      id: 'f-ai', status: 'streaming', isTLS: true, sseFrames: [],
      app: { name: 'node', pid: 2 },
      request: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', host: 'api.openai.com', path: '/v1/chat/completions', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now(), contentType: 'application/json', bodyText: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: '你好' }] }) },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-ai', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: true, contentType: 'text/event-stream' } } },
      { event: 'flow:sse-frame', payload: { id: 'f-ai', frame: { data: '{"choices":[{"delta":{"content":"你好"}}]}', raw: '', receivedAt: Date.now() } } },
      { event: 'flow:sse-frame', payload: { id: 'f-ai', frame: { data: '{"choices":[{"delta":{"content":"，我能帮你"}}]}', raw: '', receivedAt: Date.now() } } },
      { event: 'flow:sse-frame', payload: { id: 'f-ai', frame: { data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}', raw: '', receivedAt: Date.now() } } },
      { event: 'flow:end', payload: { id: 'f-ai', durationMs: 120, status: 'completed' } },
    ],
  );

  await page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]').click();
  // 切到 OpenAI Tab
  await page.getByRole('tab', { name: 'OpenAI' }).last().click();
  // 用户消息 + 助手拼接后的内容
  await expect(page.getByText('你好', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('，我能帮你', { exact: false }).first()).toBeVisible();
  // 角色标签
  await expect(page.getByText('User', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Assistant', { exact: false }).first()).toBeVisible();
});

test('AI 元信息按侧过滤：请求 Tab 无 tokens/缓存/工具本体；响应 Tab 无 模型/温度/可用工具', async () => {
  await injectFlow(
    {
      id: 'f-ai-meta', status: 'streaming', isTLS: true, sseFrames: [],
      app: { name: 'node', pid: 21 },
      request: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions', host: 'api.openai.com', path: '/v1/chat/completions',
        scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now(),
        contentType: 'application/json',
        bodyText: JSON.stringify({
          model: 'gpt-4o', temperature: 0.5,
          messages: [{ role: 'user', content: 'q' }],
          tools: [{ type: 'function', function: { name: 'ToolA', parameters: {} } }],
        }),
      },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-ai-meta', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: true, contentType: 'text/event-stream' } } },
      { event: 'flow:sse-frame', payload: { id: 'f-ai-meta', frame: { data: '{"choices":[{"delta":{"content":"a"}}]}', raw: '', receivedAt: Date.now() } } },
      { event: 'flow:sse-frame', payload: { id: 'f-ai-meta', frame: { data: '{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":22,"total_tokens":33,"prompt_tokens_details":{"cached_tokens":7}}}', raw: '', receivedAt: Date.now() } } },
      { event: 'flow:end', payload: { id: 'f-ai-meta', durationMs: 50, status: 'completed' } },
    ],
  );
  await page.locator('[data-testid="flow-row"][data-flow-id="f-ai-meta"]').click();

  // 请求侧 OpenAI Tab（左）
  await page.getByRole('tab', { name: 'OpenAI' }).first().click();
  const reqPanel = page.locator('[role="tabpanel"][data-state="active"]').first();
  await expect(reqPanel).toContainText('模型');
  await expect(reqPanel).toContainText('gpt-4o');
  await expect(reqPanel).toContainText('温度');
  await expect(reqPanel).toContainText('可用工具');
  await expect(reqPanel).not.toContainText('tokens:');
  await expect(reqPanel).not.toContainText('缓存 ');

  // 响应侧 OpenAI Tab（右）
  await page.getByRole('tab', { name: 'OpenAI' }).last().click();
  const respPanel = page.locator('[role="tabpanel"][data-state="active"]').last();
  await expect(respPanel).toContainText('tokens:');
  await expect(respPanel).toContainText('缓存 7');
  await expect(respPanel).not.toContainText('模型:');
  await expect(respPanel).not.toContainText('温度:');
  await expect(respPanel).not.toContainText('可用工具');
});

// ============ AI Sessions 独立子窗口 ============

/** 构造一条带 session/turn header 的 AI flow */
function aiFlow(opts: {
  id: string;
  sessionId?: string;
  rootRequestId?: string;
  startedAt: number;
  model?: string;
}) {
  return _aiFlow(opts);
}

test('AI Sessions 窗口：Toolbar 按钮打开，展示 Session/Turn/Request 三级树', async () => {
  // 注入 3 条 flow：sess-A/turn-1 两次、sess-A/turn-2 一次
  await injectFlow(aiFlow({ id: 'f-sess-1', sessionId: 'sess-A', rootRequestId: 'turn-1', startedAt: 1000, model: 'gpt-4o' }), [
    { event: 'flow:end', payload: { id: 'f-sess-1', durationMs: 10, status: 'completed' } },
  ]);
  await injectFlow(aiFlow({ id: 'f-sess-2', sessionId: 'sess-A', rootRequestId: 'turn-1', startedAt: 2000, model: 'gpt-4o' }), [
    { event: 'flow:end', payload: { id: 'f-sess-2', durationMs: 10, status: 'completed' } },
  ]);
  await injectFlow(aiFlow({ id: 'f-sess-3', sessionId: 'sess-A', rootRequestId: 'turn-2', startedAt: 3000, model: 'gpt-4o' }), [
    { event: 'flow:end', payload: { id: 'f-sess-3', durationMs: 10, status: 'completed' } },
  ]);

  const before = app.windows().length;
  await page.getByTestId('open-ai-sessions').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#ai-session'));
  if (!win) throw new Error('ai-session 窗口未打开');
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByTestId('ai-session-window')).toBeVisible();

  // 断言树结构
  await expect(win.locator('[data-testid="ai-session-row"][data-session-id="sess-A"]')).toBeVisible();
  await expect(win.locator('[data-testid="ai-turn-row"][data-root-request-id="turn-1"]')).toBeVisible();
  await expect(win.locator('[data-testid="ai-turn-row"][data-root-request-id="turn-2"]')).toBeVisible();
  await expect(win.locator('[data-testid="ai-request-row"]')).toHaveCount(3);
  // 顶部统计
  await expect(win.getByTestId('ai-session-summary')).toContainText('1 个会话');
  await expect(win.getByTestId('ai-session-summary')).toContainText('2 轮');
  await expect(win.getByTestId('ai-session-summary')).toContainText('3 个请求');

  await win.getByTestId('close-self').click();
});

test('AI Sessions 窗口：单击请求行 → 主窗口选中对应 flow', async () => {
  const before = app.windows().length;
  await page.getByTestId('open-ai-sessions').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#ai-session'));
  if (!win) throw new Error('ai-session 窗口未打开');
  await win.waitForLoadState('domcontentloaded');

  // 单击第二条 request 行（f-sess-2）
  await win.locator('[data-testid="ai-request-row"][data-flow-id="f-sess-2"]').click();
  // 主窗口 selectedId 应变为 f-sess-2
  const selected = await page.evaluate(() => (window as any).__pbStore.getState().selectedId);
  expect(selected).toBe('f-sess-2');

  await win.getByTestId('close-self').click();
});

test('AI Sessions 窗口：无 session header 的 flow 不出现在树里', async () => {
  // 注入一条没有 session header 的 AI flow
  await injectFlow(aiFlow({ id: 'f-no-sess', startedAt: 5000 }), [
    { event: 'flow:end', payload: { id: 'f-no-sess', durationMs: 10, status: 'completed' } },
  ]);

  const before = app.windows().length;
  await page.getByTestId('open-ai-sessions').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#ai-session'));
  if (!win) throw new Error('ai-session 窗口未打开');
  await win.waitForLoadState('domcontentloaded');

  // 无 session header 的 flow 不应出现
  await expect(win.locator('[data-testid="ai-request-row"][data-flow-id="f-no-sess"]')).toHaveCount(0);
  // 仍能看到之前的 sess-A 三条
  await expect(win.locator('[data-testid="ai-request-row"]')).toHaveCount(3);

  await win.getByTestId('close-self').click();
});

test('AI Sessions 窗口：仅有 session header、缺 X-Root-Request-Id 的 flow 也被排除', async () => {
  // 只带 X-Conversation-Id，没有 X-Root-Request-Id
  await injectFlow(aiFlow({ id: 'f-no-root', sessionId: 'sess-A', startedAt: 5500 }), [
    { event: 'flow:end', payload: { id: 'f-no-root', durationMs: 10, status: 'completed' } },
  ]);

  const before = app.windows().length;
  await page.getByTestId('open-ai-sessions').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#ai-session'));
  if (!win) throw new Error('ai-session 窗口未打开');
  await win.waitForLoadState('domcontentloaded');

  // f-no-root 不应出现
  await expect(win.locator('[data-testid="ai-request-row"][data-flow-id="f-no-root"]')).toHaveCount(0);
  // 之前的 sess-A 三条仍在
  await expect(win.locator('[data-testid="ai-request-row"]')).toHaveCount(3);

  await win.getByTestId('close-self').click();
});

test('AI Sessions 窗口：左右两栏可 resize（存在 PanelResizeHandle）', async () => {
  const before = app.windows().length;
  await page.getByTestId('open-ai-sessions').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#ai-session'));
  if (!win) throw new Error('ai-session 窗口未打开');
  await win.waitForLoadState('domcontentloaded');
  // react-resizable-panels 会给 handle 元素加 data-panel-resize-handle-* 属性
  const handle = win.locator('[data-panel-resize-handle-id], [data-panel-resize-handle-enabled]').first();
  await expect(handle).toBeVisible();
  await win.getByTestId('close-self').click();
});

test('AI Sessions 窗口：子窗口内嵌 ChatView 不再显示"Session 视图"按钮', async () => {
  const before = app.windows().length;
  await page.getByTestId('open-ai-sessions').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#ai-session'));
  if (!win) throw new Error('ai-session 窗口未打开');
  await win.waitForLoadState('domcontentloaded');
  // 选中一条 request，让右侧 ChatView 挂载
  await win.locator('[data-testid="ai-request-row"][data-flow-id="f-sess-2"]').click();
  // ChatView 内的"Session 视图"按钮不应存在
  await expect(win.getByTestId('chatview-open-session')).toHaveCount(0);
  await win.getByTestId('close-self').click();
});

test('AI Sessions 窗口：从主窗口 ChatView 打开 → 自动预选对应 flow', async () => {
  // 先选中带 session header 的抓包
  await page.locator('[data-testid="flow-row"][data-flow-id="f-sess-2"]').click();
  // 切到 OpenAI Tab（左侧 Request 侧）
  await page.getByRole('tab', { name: 'OpenAI' }).first().click();
  // 点击"Session 视图"按钮
  const btn = page.getByTestId('chatview-open-session').first();
  await expect(btn).toBeEnabled();
  const before = app.windows().length;
  await btn.click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#ai-session'));
  if (!win) throw new Error('ai-session 窗口未打开');
  await win.waitForLoadState('domcontentloaded');
  // 等 preselect broadcast 到达，f-sess-2 应被选中（selected 行会带蓝底且 bg 变化）
  const row = win.locator('[data-testid="ai-request-row"][data-flow-id="f-sess-2"]');
  await expect(row).toBeVisible();
  // 断言右侧 ChatView 已加载（说明 selectedFlowId 已被设置）
  await expect(win.locator('.method-badge, .status-badge, .font-mono').first()).toBeVisible();
  await win.getByTestId('close-self').click();
});

test('AI Sessions 窗口：新抓包实时刷新（订阅 flow:* 事件）', async () => {
  const before = app.windows().length;
  await page.getByTestId('open-ai-sessions').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#ai-session'));
  if (!win) throw new Error('ai-session 窗口未打开');
  await win.waitForLoadState('domcontentloaded');

  const beforeCount = await win.locator('[data-testid="ai-request-row"]').count();
  // 在打开窗口后，往主进程注入一条新的 session flow
  await injectFlow(aiFlow({ id: 'f-sess-4', sessionId: 'sess-A', rootRequestId: 'turn-3', startedAt: 6000, model: 'gpt-4o' }), [
    { event: 'flow:end', payload: { id: 'f-sess-4', durationMs: 10, status: 'completed' } },
  ]);
  // 等子窗口树刷新
  await expect(win.locator('[data-testid="ai-request-row"][data-flow-id="f-sess-4"]')).toBeVisible({ timeout: 5000 });
  const afterCount = await win.locator('[data-testid="ai-request-row"]').count();
  expect(afterCount).toBe(beforeCount + 1);

  await win.getByTestId('close-self').click();
});

test('SSE Tab：呈现原始事件帧', async () => {
  await page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]').click();
  await page.getByRole('tab', { name: 'SSE' }).click();
  await expect(page.getByText('{"choices":[{"delta":{"content":"你好"}}]}', { exact: false }).first()).toBeVisible();
});

test('WebSocket：注入双向消息，消息 Tab 呈现收发', async () => {
  await injectFlow(
    {
      id: 'f-ws', status: 'streaming', isTLS: true, isWebSocket: true, sseFrames: [], wsMessages: [],
      app: { name: 'Chrome', pid: 3 },
      request: { method: 'GET', url: 'wss://echo.demo.com/ws', host: 'echo.demo.com', path: '/ws', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now() },
    },
    [
      { event: 'flow:ws-message', payload: { id: 'f-ws', message: { direction: 'send', type: 'text', text: 'ping-msg', size: 8, receivedAt: Date.now() } } },
      { event: 'flow:ws-message', payload: { id: 'f-ws', message: { direction: 'recv', type: 'text', text: 'pong-msg', size: 8, receivedAt: Date.now() } } },
    ],
  );
  await page.locator('[data-testid="flow-row"][data-flow-id="f-ws"]').click();
  await page.getByRole('tab', { name: '消息' }).click();
  await expect(page.getByText('ping-msg').first()).toBeVisible();
  await expect(page.getByText('pong-msg').first()).toBeVisible();
  await expect(page.getByText('发送').first()).toBeVisible();
  await expect(page.getByText('接收').first()).toBeVisible();
});

test('侧栏：按域名/应用分组，点击过滤列表', async () => {
  // 已注入 api.demo.com / api.openai.com / echo.demo.com；应用 node / Chrome
  await expect(page.getByText('api.openai.com').first()).toBeVisible();
  // 点击某域名过滤
  await page.getByText('echo.demo.com').first().click();
  // 过滤后仅 ws flow 可见
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ws"]')).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]')).toHaveCount(0);
  // 再次点击取消过滤
  await page.getByText('echo.demo.com').first().click();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]')).toBeVisible();
});

// 规则页基础/插件列表 已拆到 tests/e2e/rules.e2e.ts

test('flow:app-info 事件可后补 app 元数据', async () => {
  await page.getByRole('button', { name: '抓包' }).click();
  // 注入一个不带 app 的 flow
  await injectFlow(
    {
      id: 'f-lateapp', status: 'pending', isTLS: true, sseFrames: [],
      app: undefined,
      request: { method: 'GET', url: 'https://late.example.com/x', host: 'late.example.com', path: '/x', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now(), contentType: '' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-lateapp', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false, contentType: 'text/plain' } } },
      { event: 'flow:end', payload: { id: 'f-lateapp', durationMs: 5, status: 'completed' } },
    ],
  );
  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-lateapp"]');
  await expect(row).toBeVisible();
  // 初始还没 app —— 通过 store 直接断言（比 UI 更稳）
  const initialApp = await page.evaluate(() => {
    const s = (window as any).__pbStore?.getState?.();
    return s?.byId?.['f-lateapp']?.app || null;
  });
  expect(initialApp).toBeNull();

  // 补 app-info
  await page.evaluate(async () => {
    await (window as any).__pbE2E.emit('flow:app-info', {
      id: 'f-lateapp',
      app: { name: 'LateApp', pid: 999 },
    });
  });
  await page.waitForFunction(() => {
    const s = (window as any).__pbStore?.getState?.();
    return s?.byId?.['f-lateapp']?.app?.name === 'LateApp';
  }, null, { timeout: 3000 });
});

test('回到抓包页，状态栏显示请求数', async () => {
  await page.getByRole('button', { name: '抓包' }).click();
  await ensureBaseFlows();
  await expect(page.getByText(/选中 \d+\/\d+ 行/).first()).toBeVisible();
});

test('JSON 正文：Tree/Raw 切换 + 复制 + cURL', async () => {
  await page.getByRole('button', { name: '抓包' }).click();
  await ensureBaseFlows();
  // 选中之前注入的普通请求（有 JSON 响应体）
  await page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').click();
  // Response 默认头部，切到正文
  await page.getByRole('tab', { name: '正文' }).nth(1).click();
  // 新的多格式子标签：JSON Tree 默认显示
  await expect(page.getByTestId('body-fmt-json-tree').first()).toBeVisible();
  // 切 JSON Raw
  await page.getByTestId('body-fmt-json').first().click();
  await expect(page.getByText('"name"', { exact: false }).first()).toBeVisible();
  // Hex 视图
  await page.getByTestId('body-fmt-hex').first().click();
  await expect(page.getByTestId('body-hex').first()).toBeVisible();
  // 复制按钮存在
  await page.getByTestId('body-fmt-json').first().click();
  await expect(page.getByRole('button', { name: /复制/ }).first()).toBeVisible();
  // 复制 cURL 按钮存在
  await expect(page.getByRole('button', { name: '复制 cURL' })).toBeVisible();
});

test('监听地址气泡：打开并可切换系统代理', async () => {
  await page.getByText(/正在监听|未启动/).first().click();
  await expect(page.getByText('代理端口')).toBeVisible();
  await expect(page.getByText('回环')).toBeVisible();
  // 系统代理开关存在
  await expect(page.getByText(/系统代理/)).toBeVisible();
  // 关闭气泡
  await page.keyboard.press('Escape');
});

// 规则页示例点击 已拆到 tests/e2e/rules.e2e.ts

test('界面切换顺畅：抓包<->规则 多次切换无报错', async () => {
  await ensureBaseFlows();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '抓包' }).click();
    await expect(page.locator('[data-testid="flow-row"]').first()).toBeVisible();
    await page.getByRole('button', { name: '规则', exact: true }).click();
    await expect(page.getByText('规则集', { exact: true })).toBeVisible();
  }
  expect(errors).toHaveLength(0);
});

test('顶部tab 切换保留各页 UI state（组件不卸载）', async () => {
  // 1) 进规则页，切到"脚本（Scripts）"子 tab —— 这是 RulesView 的本地 useState
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await expect(page.getByTestId('rules-mode-tabs')).toBeVisible();
  await page.getByTestId('rules-tab-scripts').click();
  await expect(page.getByTestId('rules-tab-scripts')).toHaveAttribute('data-active', 'true');

  // 2) 切到抓包页，再切到编写页，再切回规则页
  await page.getByRole('button', { name: '抓包' }).click();
  await expect(page.locator('[data-testid="flow-row"]').first()).toBeVisible().catch(() => {});
  await page.getByRole('button', { name: '编写', exact: true }).click();
  await page.getByRole('button', { name: '规则', exact: true }).click();

  // 3) 规则页应仍停留在 scripts 子 tab（若组件被卸载则会回到默认 rules）
  await expect(page.getByTestId('rules-tab-scripts')).toHaveAttribute('data-active', 'true');

  // 恢复默认，避免污染后续用例
  await page.getByTestId('rules-tab-rules').click();
});

// ============ 过滤/搜索/侧栏 完整覆盖 ============
async function resetFilters() {
  await _resetFilters(page);
}

/** 兜底注入 base flows（delegates to _shared） */
async function ensureBaseFlows() {
  await _ensureBaseFlows(page);
}

test('文本搜索：按 URL 过滤列表', async () => {
  await resetFilters();
  // 已注入 f-http(api.demo.com/users), f-ai(openai .../chat/completions), f-ws(echo.demo.com/ws)
  await page.getByTestId('searchbar-input').fill('users');
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]')).toHaveCount(0);
  await page.getByTestId('searchbar-input').fill('completions');
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]')).toHaveCount(0);
  await page.getByTestId('searchbar-input').fill('');
});

test('关闭搜索栏（X 按钮）应清空搜索条件并恢复完整列表', async () => {
  await resetFilters();
  // 输入一个只有 f-http 匹配的关键词
  await page.getByTestId('searchbar-input').fill('users');
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]')).toHaveCount(0);
  // 点关闭按钮
  await page.locator('button[title^="关闭 ESC"]').click();
  // 列表恢复：其他 flow 重新出现
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ws"]').first()).toBeVisible();
  // store 里 filter.text 也已清空
  const filterText = await page.evaluate(() => (window as any).__pbStore.getState().filter.text);
  expect(filterText).toBe('');
});

test('关闭搜索栏（ESC）应清空搜索条件并恢复完整列表', async () => {
  await resetFilters();
  await page.getByTestId('searchbar-input').fill('users');
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]')).toHaveCount(0);
  // 焦点在输入框上按 ESC
  await page.getByTestId('searchbar-input').press('Escape');
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]').first()).toBeVisible();
  const filterText = await page.evaluate(() => (window as any).__pbStore.getState().filter.text);
  expect(filterText).toBe('');
});

test('方向键切换选中抓包 item：↓/↑/Home/End', async () => {
  await resetFilters();
  // 收起搜索栏，避免焦点落在 input 上导致方向键被输入框吃掉
  await page.evaluate(() => (window as any).__pbStore?.getState().setSearchOpen(false));
  // 点击列表第一行（DOM 顺序），获得当前选中 id
  const rows = page.locator('[data-testid="flow-row"]');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  const firstId = await page.evaluate(() => (window as any).__pbStore.getState().selectedId);
  expect(firstId).toBeTruthy();
  // 焦点放到 body，防止 row 上的 focus 阻塞
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // ArrowDown → 选中应变化
  await page.keyboard.press('ArrowDown');
  const afterDown = await page.evaluate(() => (window as any).__pbStore.getState().selectedId);
  expect(afterDown).not.toBe(firstId);
  // ArrowUp → 回到第一条
  await page.keyboard.press('ArrowUp');
  const afterUp = await page.evaluate(() => (window as any).__pbStore.getState().selectedId);
  expect(afterUp).toBe(firstId);
  // End → 最后一条（DOM 顺序）
  await rows.last().waitFor();
  const lastId = await rows.last().getAttribute('data-flow-id');
  await page.keyboard.press('End');
  const afterEnd = await page.evaluate(() => (window as any).__pbStore.getState().selectedId);
  expect(afterEnd).toBe(lastId);
  // Home → 回第一条
  await page.keyboard.press('Home');
  const afterHome = await page.evaluate(() => (window as any).__pbStore.getState().selectedId);
  expect(afterHome).toBe(firstId);
});

test('方向键在输入框内不切换选中', async () => {
  await resetFilters();
  const rows = page.locator('[data-testid="flow-row"]');
  await rows.first().click();
  const firstId = await page.evaluate(() => (window as any).__pbStore.getState().selectedId);
  // 焦点放到搜索输入框
  await page.getByTestId('searchbar-input').click();
  await page.keyboard.press('ArrowDown');
  const stillSame = await page.evaluate(() => (window as any).__pbStore.getState().selectedId);
  expect(stillSame).toBe(firstId);
});


test('新抓包插入到列表顶部时，不抖动当前 viewport（scrollTop 补偿）', async () => {
  await resetFilters();
  // 清空所有已注入的 flow，保证列表初始状态干净、可预期
  await page.evaluate(() => (window as any).__pbStore.getState().clear());
  // 确认默认排序仍是 index desc（最新在上），这是产生"抖动"的前提场景
  await page.evaluate(() => {
    (window as any).__pbStore.setState({ sort: { key: 'index', dir: 'desc' } });
  });

  // 灌 60 条 flow，使列表足够长可以滚动
  await page.evaluate(async () => {
    const e = (window as any).__pbE2E;
    for (let i = 0; i < 60; i++) {
      await e.emit('flow:start', {
        id: `scroll-${i}`,
        status: 'completed',
        isTLS: false,
        sseFrames: [],
        request: {
          method: 'GET',
          url: `https://example.com/api/${i}`,
          host: 'example.com',
          path: `/api/${i}`,
          scheme: 'https',
          httpVersion: '1.1',
          headers: [],
          bodySize: 0,
          startedAt: Date.now() - (60 - i) * 1000,
        },
      });
      await e.emit('flow:end', { id: `scroll-${i}`, durationMs: 10, status: 'completed' });
    }
  });

  await expect(page.locator('[data-testid="flow-row"]').first()).toBeVisible();

  // 滚到列表中间（不是顶部），使补偿逻辑生效
  const scrollerSel = '[data-testid="flow-list-scroller"]';
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLDivElement;
    el.scrollTop = 400;
  }, scrollerSel);
  const before = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLDivElement;
    return el.scrollTop;
  }, scrollerSel);
  expect(before).toBeGreaterThan(0);

  // 灌入一条新 flow，它会插入到 desc 列表顶部
  await page.evaluate(async () => {
    const e = (window as any).__pbE2E;
    await e.emit('flow:start', {
      id: 'scroll-new',
      status: 'completed',
      isTLS: false,
      sseFrames: [],
      request: {
        method: 'GET',
        url: 'https://example.com/api/new',
        host: 'example.com',
        path: '/api/new',
        scheme: 'https',
        httpVersion: '1.1',
        headers: [],
        bodySize: 0,
        startedAt: Date.now(),
      },
    });
    await e.emit('flow:end', { id: 'scroll-new', durationMs: 10, status: 'completed' });
  });

  await page.waitForFunction(() => {
    const s = (window as any).__pbStore.getState();
    return s.flows.some((f: any) => f.id === 'scroll-new');
  });

  // 核心断言：新行插到顶部后，scrollTop 应补偿一行高度（26px），
  // 保证锚点行仍停在原视口位置，视觉上无抖动。
  const after = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLDivElement;
    return el.scrollTop;
  }, scrollerSel);
  expect(after).toBe(before + 26);

  // 清理：本用例注入了大量 scroll-* flow，避免污染后续用例的过滤/计数断言。
  // resetFilters() 内 ensureBaseFlows() 会在下一 test 重新灌入 f-http/f-ai/f-ws。
  await page.evaluate(() => (window as any).__pbStore.getState().clear());
});


test('类型过滤条：HTTPS/全部', async () => {
  await resetFilters();
  await page.getByRole('button', { name: 'HTTPS', exact: true }).click();
  // 全部注入的都是 https/wss(标记 https)，仍可见
  await expect(page.locator('[data-testid="flow-row"]').first()).toBeVisible();
  await page.getByRole('button', { name: '全部' }).click();
});

test('应用程序分组过滤', async () => {
  await resetFilters();
  // 点击 Chrome（f-ws 的 app）
  await page.getByText('Chrome', { exact: true }).first().click();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ws"]')).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]')).toHaveCount(0);
  // 取消
  await page.getByText('Chrome', { exact: true }).first().click();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]')).toBeVisible();
});

test('域名 subpath 过滤', async () => {
  await resetFilters();
  // 展开 api.demo.com 的 subpath（点箭头），选择 /users
  const hostRow = page.getByText('api.demo.com', { exact: true }).first();
  await hostRow.click();  // 先按域名过滤
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]')).toBeVisible();
  await page.getByText('api.demo.com', { exact: true }).first().click(); // 取消
});

test('侧栏右键：将域名加入抓包排除列表（record-filter exclude）', async () => {
  await resetFilters();
  // 先清空 record-filter，避免脏数据
  await page.evaluate(async () => {
    await (window as any).proxybaby.recordFilterSet({ mode: 'all', entries: [] });
  });
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]');
  await expect(hostRow).toBeVisible();
  await hostRow.click({ button: 'right' });
  await page.getByText(/抓包时排除此域名/).click();
  const cfg = await page.evaluate(async () => await (window as any).proxybaby.recordFilterGet());
  expect(cfg.mode).toBe('exclude');
  expect(cfg.entries.some((e: any) => e.kind === 'host' && e.value === 'api.demo.com')).toBe(true);
});

test('侧栏右键：将域名加入抓包包含列表（record-filter include）', async () => {
  await resetFilters();
  await page.evaluate(async () => {
    await (window as any).proxybaby.recordFilterSet({ mode: 'all', entries: [] });
  });
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]');
  await expect(hostRow).toBeVisible();
  await hostRow.click({ button: 'right' });
  await page.getByText(/^仅抓取此域名$/).click();
  const cfg = await page.evaluate(async () => await (window as any).proxybaby.recordFilterGet());
  expect(cfg.mode).toBe('include');
  expect(cfg.entries.some((e: any) => e.kind === 'host' && e.value === 'api.demo.com')).toBe(true);
});

test('侧栏右键：应用程序 item 打开菜单（回归 asChild 不透传 ref）', async () => {
  // 曾出现 Item 未 forwardRef → Radix ContextMenu asChild 拿不到 dom → 右键无反应。
  await resetFilters();
  const appRow = page.locator('[data-testid="app-row"]').first();
  await expect(appRow).toBeVisible();
  await appRow.click({ button: 'right' });
  // 菜单里的"复制应用名"是 AppContextMenu 独有的稳定项
  await expect(page.getByText(/^复制应用名$/)).toBeVisible();
  // 关掉菜单
  await page.keyboard.press('Escape');
});

test('底部状态栏：record-filter 生效时显示常驻 tip', async () => {
  // 设置 record filter 为 include 一条 host
  await page.evaluate(async () => {
    await (window as any).proxybaby.recordFilterSet({
      mode: 'include',
      entries: [{ kind: 'host', value: 'demo.com', enabled: true }],
    });
  });
  await expect(page.getByTestId('filter-active-tip')).toBeVisible();
  await expect(page.getByTestId('record-filter-tip')).toContainText('抓包记录过滤已生效');
  await expect(page.getByTestId('record-filter-tip')).toContainText('仅记录');
  // 关闭 record filter → tip 消失
  await page.evaluate(async () => {
    await (window as any).proxybaby.recordFilterSet({ mode: 'all', entries: [] });
  });
  await expect(page.getByTestId('filter-active-tip')).toHaveCount(0);
});

test('底部状态栏：allow-block 生效时显示常驻 tip', async () => {
  await page.evaluate(async () => {
    await (window as any).proxybaby.allowBlockSet({
      mode: 'block',
      entries: [{ kind: 'host', value: 'ban.example.com', enabled: true }],
    });
  });
  await expect(page.getByTestId('filter-active-tip')).toBeVisible();
  await expect(page.getByTestId('allow-block-tip')).toContainText('允许/阻止列表已生效');
  await expect(page.getByTestId('allow-block-tip')).toContainText('阻止');
  await page.evaluate(async () => {
    await (window as any).proxybaby.allowBlockSet({ mode: 'off', entries: [] });
  });
  await expect(page.getByTestId('filter-active-tip')).toHaveCount(0);
});

test('底部状态栏：两个都生效时同时显示 + 点击打开过滤配置窗口', async () => {
  await page.evaluate(async () => {
    await (window as any).proxybaby.recordFilterSet({
      mode: 'exclude',
      entries: [{ kind: 'host', value: 'noise.com', enabled: true }],
    });
    await (window as any).proxybaby.allowBlockSet({
      mode: 'allow',
      entries: [{ kind: 'host', value: 'only.com', enabled: true }],
    });
  });
  await expect(page.getByTestId('record-filter-tip')).toBeVisible();
  await expect(page.getByTestId('allow-block-tip')).toBeVisible();

  const before = app.windows().length;
  await page.getByTestId('filter-active-tip-open').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#filter-config'));
  if (!win) throw new Error('filter-config 窗口未打开');
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByTestId('filter-config-window')).toBeVisible();
  await win.getByTestId('close-self').click();

  // 恢复干净
  await page.evaluate(async () => {
    await (window as any).proxybaby.recordFilterSet({ mode: 'all', entries: [] });
    await (window as any).proxybaby.allowBlockSet({ mode: 'off', entries: [] });
  });
});

test('侧栏右键：置顶此域名 → 出现在收藏夹已置顶分组', async () => {
  await resetFilters();
  // 先清掉可能残留的 pinnedHosts
  await page.evaluate(() => {
    localStorage.removeItem('proxybaby:pinned-hosts');
    localStorage.removeItem('proxybaby:pinned-paths');
    (window as any).__pbStore?.setState({ pinnedHosts: {}, pinnedPaths: {}, pinnedIds: {} });
  });
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]');
  await expect(hostRow).toBeVisible();
  await hostRow.click({ button: 'right' });
  await page.getByText(/^置顶此域名$/).click();
  // 收藏夹"已置顶" chip 计数 > 0
  const pinned = await page.evaluate(() => {
    const v = localStorage.getItem('proxybaby:pinned-hosts');
    return v ? JSON.parse(v) : [];
  });
  expect(pinned).toContain('api.demo.com');
  // 侧栏"已置顶"计数应该 > 0（api.demo.com 下至少有 1 条 flow）
  const pinnedHeader = page.locator('[data-testid="pinned-tree-header"]');
  await expect(pinnedHeader).toContainText(/[1-9]/);
  // tree 展开后应该看到 api.demo.com 的 host 子节点（复用 HostItem 组件，
  // 侧栏里同时会有两个 host-row：正常"域名"分组 + 已置顶 tree 下的）
  await expect(page.locator('[data-testid="host-row"][data-host="api.demo.com"]')).toHaveCount(2);
});

test('侧栏右键：已置顶域名的右键菜单显示"取消置顶此域名"', async () => {
  // 依赖上一个测试留下的置顶状态；若上一个失败或此用例被单独跑，兜底置顶一次
  await resetFilters();
  const pinnedBefore = await page.evaluate(() => (window as any).__pbStore.getState().pinnedHosts['api.demo.com']);
  if (!pinnedBefore) {
    await page.evaluate(() => {
      (window as any).__pbStore.getState().togglePinHost('api.demo.com');
    });
  }
  // "域名"分组下的那个 host-row（非"已置顶"树里的）
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]').last();
  await hostRow.click({ button: 'right' });
  // 应显示"取消置顶此域名"，且不再有独立的"置顶此域名"
  await expect(page.getByText(/^取消置顶此域名$/)).toBeVisible();
  await expect(page.getByText(/^置顶此域名$/)).toHaveCount(0);
  // 点击取消置顶
  await page.getByText(/^取消置顶此域名$/).click();
  const pinnedAfter = await page.evaluate(() => (window as any).__pbStore.getState().pinnedHosts['api.demo.com']);
  expect(pinnedAfter).toBeUndefined();
});

test('侧栏右键：仅 subpath 被 pin 的 host，域名分组的右键菜单只操作 host 层（不误清 subpath）', async () => {
  await resetFilters();
  // 先清干净
  await page.evaluate(() => {
    (window as any).__pbStore.setState({ pinnedHosts: {}, pinnedPaths: {}, pinnedIds: {} });
    localStorage.removeItem('proxybaby:pinned-hosts');
    localStorage.removeItem('proxybaby:pinned-paths');
  });
  // orphan：只 pin 了 subpath
  await page.evaluate(() => {
    (window as any).__pbStore.getState().togglePinPath('api.demo.com/users');
  });
  // "域名"分组下的 api.demo.com host 本身未 pin → 菜单应显示"置顶此域名"
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]').last();
  await hostRow.click({ button: 'right' });
  await expect(page.getByText(/^置顶此域名$/)).toBeVisible();
  // 点击后应只加 host pin，不动 subpath
  await page.getByText(/^置顶此域名$/).click();
  const state = await page.evaluate(() => {
    const s = (window as any).__pbStore.getState();
    return { hosts: s.pinnedHosts, paths: s.pinnedPaths };
  });
  expect(state.hosts['api.demo.com']).toBe(true);
  expect(state.paths['api.demo.com/users']).toBe(true);
});

test('侧栏右键：已置顶树下的 host 右键"取消置顶"，一次性清空 host + 其下所有 subpath', async () => {
  await resetFilters();
  await page.evaluate(() => {
    (window as any).__pbStore.setState({ pinnedHosts: { 'api.demo.com': true }, pinnedPaths: { 'api.demo.com/users': true }, pinnedIds: {} });
  });
  // "已置顶"树下会出现同 host（第一处），点击右键 → 菜单"取消置顶此域名"
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]').first();
  await hostRow.click({ button: 'right' });
  await expect(page.getByText(/^取消置顶此域名$/)).toBeVisible();
  await page.getByText(/^取消置顶此域名$/).click();
  const state = await page.evaluate(() => {
    const s = (window as any).__pbStore.getState();
    return { hosts: s.pinnedHosts, paths: s.pinnedPaths };
  });
  expect(state.hosts['api.demo.com']).toBeUndefined();
  expect(Object.keys(state.paths).some((p) => p.startsWith('api.demo.com/'))).toBe(false);
});

// 规则相关：侧栏/抓包列表右键 → 快速规则、临时 sub-tab 已拆到 tests/e2e/rules.e2e.ts

test('侧栏选中项 hover 时保持蓝色底（不被 hover 灰色覆盖）', async () => {
  await resetFilters();
  const hostRow = page.getByText('api.demo.com', { exact: true }).first();
  // 选中该域名
  await hostRow.click();
  // 目标：hover 时行背景仍是选中蓝（#094771），而不是灰色 hover（#333）
  // 找承载 bg-pb-selected 的父级 div
  const parent = hostRow.locator('xpath=ancestor::div[contains(@class,"bg-pb-selected")][1]');
  await parent.hover();
  const bg = await parent.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
  // rgb(9, 71, 113) === #094771
  expect(bg).toBe('rgb(9, 71, 113)');
  // 取消选中，恢复现场
  await hostRow.click();
});

test('pin 后已固定过滤', async () => {
  await resetFilters();
  // pin f-http
  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-http"]');
  await row.hover();
  await row.getByTestId('pin-btn').click();
  // 点已置顶
  await page.getByText('已置顶').first().click();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]')).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]')).toHaveCount(0);
  // 取消已置顶过滤
  await page.getByText('已置顶').first().click();
});

test('save 后 Saved 过滤', async () => {
  await resetFilters();
  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]');
  await row.hover();
  await row.getByTestId('save-btn').click();
  await page.getByText('Saved').first().click();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]')).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]')).toHaveCount(0);
  await page.getByText('Saved').first().click();
});

// ============ 新特性：正文多格式预览 + Code Generator ============

test('正文多格式预览：Form + Hex + Image', async () => {
  await injectFlow(
    {
      id: 'f-form', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'node', pid: 4 },
      request: { method: 'POST', url: 'https://api.demo.com/form', host: 'api.demo.com', path: '/form', scheme: 'https', httpVersion: '1.1', headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }], bodySize: 7, startedAt: Date.now(), contentType: 'application/x-www-form-urlencoded', bodyText: 'a=1&b=2' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'f-form', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [], bodySize: 0, isSSE: false, contentType: 'application/octet-stream' } } },
      { event: 'flow:response-body', payload: { id: 'f-form', bodyBase64: Buffer.from([0x48, 0x49, 0x00, 0xff]).toString('base64'), bodySize: 4 } },
      { event: 'flow:end', payload: { id: 'f-form', durationMs: 10, status: 'completed' } },
    ],
  );
  await page.locator('[data-testid="flow-row"][data-flow-id="f-form"]').click();
  // Request Body → Form 视图
  await page.getByRole('tab', { name: '正文' }).first().click();
  await expect(page.getByTestId('body-form')).toBeVisible();
  await expect(page.getByTestId('body-form')).toContainText('a');
  await expect(page.getByTestId('body-form')).toContainText('b');
  // Response Body → Hex 视图（二进制无 bodyText）
  await page.getByRole('tab', { name: '正文' }).nth(1).click();
  // 二进制 body 自动进入 hex
  await expect(page.getByTestId('body-hex').first()).toBeVisible();
});

test('代码生成：多语言切换', async () => {
  await resetFilters();
  await ensureBaseFlows();
  await page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').click();
  await page.getByRole('tab', { name: '代码' }).click();
  await expect(page.getByTestId('codegen-view')).toBeVisible();
  await expect(page.getByTestId('codegen-lang-curl')).toBeVisible();
  await page.getByTestId('codegen-lang-python').click();
  // 代码渲染到 Monaco 里，直接读 model 的文本
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = (window as any).monaco;
      return w?.editor?.getModels?.().map((m: any) => m.getValue()).join('\n') || '';
    });
  }, { timeout: 8000 }).toContain('requests.post');
  await page.getByTestId('codegen-lang-go').click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = (window as any).monaco;
      return w?.editor?.getModels?.().map((m: any) => m.getValue()).join('\n') || '';
    });
  }, { timeout: 8000 }).toContain('http.NewRequest');
});

// ============ 新特性：高级过滤器（现已并入 ⌘F 搜索栏） ============

test('高级过滤器：多条件 AND + 保存/加载预设', async () => {
  await resetFilters();
  // 打开高级面板（在 SearchBar 里）
  await page.getByTestId('searchbar-toggle-adv').click();
  await page.getByTestId('adv-comb-AND').click();
  await page.getByTestId('adv-add').click();
  // 第一个条件：host = api.demo.com
  await page.getByTestId('adv-field-0').selectOption('host');
  await page.getByTestId('adv-op-0').selectOption('equals');
  await page.getByTestId('adv-value-0').fill('api.demo.com');
  // 结果：只有 f-http 命中
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]')).toHaveCount(0);

  // 保存预设（切换到预设区）
  await page.getByTestId('searchbar-toggle-presets').click();
  await page.getByTestId('adv-preset-name').fill('demo-only');
  await page.getByTestId('adv-preset-save').click();

  // 清空 → 结果所有请求可见
  await page.getByTestId('adv-clear').click();
  await expect(page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]').first()).toBeVisible();
});

// ============ 新特性：设置窗口 - Scripts / Allow-Block / SSL / Network / Upstream ============
// 设置改为独立子窗口，测试里点开 → 在新窗口里完成所有子面板校验

async function openSettingsWindow() {
  return _openSettingsWindow(app, page);
}

async function openFilterConfigWindow() {
  return _openFilterConfigWindow(app, page);
}

async function waitForEntryEditorWindow() {
  return _waitForEntryEditorWindow(app, page);
}

test('过滤配置窗口：Allow/Block 添加 host 条目（编辑器为独立窗口）', async () => {
  const w = await openFilterConfigWindow();
  await w.getByTestId('tab-allowblock').click();
  await expect(w.getByTestId('allowblock-panel')).toBeVisible();
  await w.getByTestId('allowblock-mode-block').click();
  await w.getByTestId('allowblock-add').click();
  const editor = await waitForEntryEditorWindow();
  await editor.getByTestId('fee-value').fill('bad.example.com');
  await editor.getByTestId('fee-save').click();
  // 编辑器窗口保存后自关；父窗口应刷新出现新条目
  await expect(w.getByTestId('allowblock-panel')).toContainText('bad.example.com');
  await w.getByTestId('close-self').click();
});

test('过滤配置窗口：录制过滤添加 App 维度条目', async () => {
  const w = await openFilterConfigWindow();
  await expect(w.getByTestId('record-filter-panel')).toBeVisible();
  await w.getByTestId('record-add').click();
  const editor = await waitForEntryEditorWindow();
  await editor.getByTestId('fee-kind-app').click();
  await editor.getByTestId('fee-value').fill('Google Chrome');
  await editor.getByTestId('fee-save').click();
  await expect(w.getByTestId('record-filter-panel')).toContainText('Google Chrome');
  await w.getByTestId('close-self').click();
});

test('设置窗口：网络条件切换 3G', async () => {
  const w = await openSettingsWindow();
  await w.getByTestId('network-preset-3g').click();
  await expect(w.getByTestId('network-panel')).toContainText('3g');
  await w.getByTestId('network-preset-off').click();
  await w.getByTestId('close-self').click();
});

test('设置窗口：上游代理编辑并保存', async () => {
  const w = await openSettingsWindow();
  await w.getByTestId('upstream-kind-http').click();
  await w.getByTestId('upstream-host').fill('127.0.0.1');
  await w.getByTestId('upstream-port').fill('8080');
  await w.getByTestId('upstream-save').click();
  await expect(w.getByTestId('upstream-panel')).toContainText('127.0.0.1:8080');
  await w.getByTestId('upstream-kind-off').click();
  await w.getByTestId('upstream-save').click();
  await w.getByTestId('close-self').click();
});

// ============ 新特性：Composer ============

test('Composer：填表并生成代码', async () => {
  await page.getByRole('button', { name: '编写', exact: true }).click();
  await expect(page.getByTestId('composer-view')).toBeVisible();
  await page.getByTestId('composer-method').selectOption('POST');
  await page.getByTestId('composer-url').fill('https://api.example.com/x');
  // Composer 的 headers/body 用了 Monaco，textarea.fill() 不生效；直接通过 model.setValue 灌入
  await page.evaluate(() => {
    const mo = (window as any).monaco;
    const models: any[] = mo.editor.getModels();
    //匹配 http-headers 语言的model作为headers 编辑器
    const h = models.find((mm) => mm.getLanguageId?.() === 'http-headers');
    if (h) h.setValue('Accept: application/json');
    // body 编辑器：找剩余里 plaintext/json 的
    const bodyCandidates = models.filter((mm) => mm.getLanguageId?.() !== 'http-headers');
    // Composer body 默认没内容，找 value 为空的
    const b = bodyCandidates.find((mm) => mm.getValue() === '') || bodyCandidates[0];
    if (b) b.setValue('{"hello":"world"}');
  });
  await page.getByTestId('composer-toggle-code').click();
  await page.getByTestId('composer-lang-python').click();
  await expect(page.getByTestId('composer-code')).toContainText('requests.post');
});

test('Composer：HeadersEditor 补全 -输入 Cont 提示 Content-Type', async () => {
  await page.getByRole('button', { name: '编写', exact: true }).click();
  await expect(page.getByTestId('composer-view')).toBeVisible();
  // 清空 headers editor
  await page.evaluate(() => {
    const mo = (window as any).monaco;
    const h = mo.editor.getModels().find((mm: any) => mm.getLanguageId?.() === 'http-headers');
    if (h) h.setValue('');
  });
  // 点击 headers 编辑器区域激活光标
  await page.locator('[data-testid="composer-headers"] .monaco-editor .view-lines').click();
  await page.keyboard.type('Cont');
  // suggest widget 应包含 Content-Type
  await expect(page.locator('.monaco-editor .suggest-widget').getByText('Content-Type', { exact: true }).first())
    .toBeVisible({ timeout: 3000 });
});

// ============ Diff（右键菜单入口） ============

test('Diff：多选两条 flow 后右键菜单打开对比窗口', async () => {
  await page.getByRole('button', { name: '抓包' }).click();
  await resetFilters();
  await ensureBaseFlows();
  // 主选 f-http，Cmd 点 f-ai 加入多选
  await page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').click();
  await page.locator('[data-testid="flow-row"][data-flow-id="f-ai"]').click({ modifiers: ['Meta'] });
  const initialCount = app.windows().length;
  // 右键菜单里点 Diff
  await page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').click({ button: 'right' });
  await page.getByTestId('ctx-diff').click();
  const t0 = Date.now();
  while (app.windows().length <= initialCount && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page);
  if (!win) throw new Error('diff 子窗口没开出来');
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByTestId('diff-window')).toBeVisible();
  await expect(win.getByTestId('diff-section-req-headers')).toBeVisible({ timeout: 15000 });
  await win.getByTestId('close-self').click();
});

test('顶栏不再暴露 Diff 按钮', async () => {
  await expect(page.getByTestId('open-diff')).toHaveCount(0);
});

// ============ 新特性：自定义预览 Tab（对标 Proxyman Custom Preview Tabs） ============

test('自定义预览 Tab：勾选后 Request/Response 面板出现新 Tab 并正确渲染', async () => {
  await page.getByRole('button', { name: '抓包' }).click();
  await resetFilters();
  await ensureBaseFlows();
  // 先重置 customTabs（避免上一次 e2e 残留干扰）
  await page.evaluate(() => {
    const anyWin = window as any;
    anyWin.__pbStore?.getState?.().setCustomTabs?.({ request: [], response: [] });
  });

  // 选中一个 JSON 请求
  await page.locator('[data-testid="flow-row"][data-flow-id="f-http"]').click();

  // 打开 Request 侧 + 弹层
  await page.getByTestId('detail-req-plus').click();
  await expect(page.getByTestId('tab-customizer')).toBeVisible();

  // 勾选 Request：Hex + JSON Tree
  await page.getByTestId('tab-customizer-request-checkbox-hex').check();
  await page.getByTestId('tab-customizer-request-checkbox-json-tree').check();
  // 勾选 Response：Hex
  await page.getByTestId('tab-customizer-response-checkbox-hex').check();

  // 关闭弹层
  await page.getByTestId('tab-customizer-close').click();
  await expect(page.getByTestId('tab-customizer')).toHaveCount(0);

  // Request 侧新 Tab 出现：JSON Tree / Hex
  const reqPane = page.locator('[role="tablist"]').first();
  await expect(reqPane.getByRole('tab', { name: 'JSON Tree' })).toBeVisible();
  await expect(reqPane.getByRole('tab', { name: 'Hex' })).toBeVisible();

  // 点 JSON Tree tab（Request 侧）→ 显示 body-json-tree
  await reqPane.getByRole('tab', { name: 'JSON Tree' }).click();
  await expect(page.getByTestId('custom-tab-request-json-tree').getByTestId('body-json-tree')).toBeVisible();

  // 点 Hex tab（Request 侧）
  await reqPane.getByRole('tab', { name: 'Hex' }).click();
  await expect(page.getByTestId('custom-tab-request-hex').getByTestId('body-hex')).toBeVisible();

  // Response 侧 Hex 也出现
  const respPane = page.locator('[role="tablist"]').nth(1);
  await expect(respPane.getByRole('tab', { name: 'Hex' })).toBeVisible();
  await respPane.getByRole('tab', { name: 'Hex' }).click();
  await expect(page.getByTestId('custom-tab-response-hex').getByTestId('body-hex')).toBeVisible();
});

test('自定义预览 Tab：偏好持久化 + 取消勾选后 Tab 消失', async () => {
  // 上一个测试已经写入了 localStorage: request=[hex,json-tree], response=[hex]
  // 通过重新读取 localStorage 校验持久化生效
  const persisted = await page.evaluate(() => localStorage.getItem('proxybaby:custom-tabs'));
  expect(persisted).toBeTruthy();
  const parsed = JSON.parse(persisted!);
  expect(parsed.request).toEqual(expect.arrayContaining(['hex', 'json-tree']));
  expect(parsed.response).toEqual(expect.arrayContaining(['hex']));

  // 打开弹层，取消 Request 的 Hex
  await page.getByTestId('detail-req-plus').click();
  await page.getByTestId('tab-customizer-request-checkbox-hex').uncheck();
  await page.getByTestId('tab-customizer-close').click();

  const reqPane = page.locator('[role="tablist"]').first();
  await expect(reqPane.getByRole('tab', { name: 'Hex' })).toHaveCount(0);
  // JSON Tree 仍然在
  await expect(reqPane.getByRole('tab', { name: 'JSON Tree' })).toBeVisible();

  // 清理：把偏好重置为空，避免影响后续测试执行顺序
  await page.evaluate(() => {
    const anyWin = window as any;
    anyWin.__pbStore?.getState?.().setCustomTabs?.({ request: [], response: [] });
  });
});

// ============ 新特性：系统代理被抢占检测（对标 Proxyman "代理已被覆盖" 提示） ============

test('系统代理被覆盖：状态栏出现警告按钮，popover 显示对方 IP:Port 并可一键切回', async () => {
  // 通过 __pbE2E 广播 proxy:override 事件（走 IPC + broadcast → App 订阅 → store）
  await page.evaluate(async () => {
    const e = (window as any).__pbE2E;
    await e.emit('proxy:override', {
      host: '127.0.0.1',
      port: 8899,
      service: 'Wi-Fi',
      proxybabyHost: '127.0.0.1',
      proxybabyPort: 9998,
      detectedAt: Date.now(),
    });
  });

  // 警告按钮出现
  const btn = page.getByTestId('proxy-override-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('代理已被覆盖');

  // 点击展开 popover
  await btn.click();
  const pop = page.getByTestId('proxy-override-popover');
  await expect(pop).toBeVisible();
  await expect(page.getByTestId('override-current')).toHaveText('127.0.0.1:8899');
  await expect(pop).toContainText('127.0.0.1:9998');
  await expect(pop).toContainText('Wi-Fi');

  // 点 Switch Back：会调 IPC restoreSystemProxyOverride，主进程会 broadcast proxy:override=null。
  // E2E 模式下 applySystemProxy 也不会真的跑（我们的 handler 直接 catch），最终 override 应被清空。
  await page.getByTestId('switch-back-btn').click();
  await expect(page.getByTestId('proxy-override-btn')).toHaveCount(0);
});

test('系统代理被覆盖：override 清空后按钮消失', async () => {
  // 先注入一次
  await page.evaluate(async () => {
    const e = (window as any).__pbE2E;
    await e.emit('proxy:override', {
      host: '10.0.0.1',
      port: 7777,
      proxybabyHost: '127.0.0.1',
      proxybabyPort: 9998,
      detectedAt: Date.now(),
    });
  });
  await expect(page.getByTestId('proxy-override-btn')).toBeVisible();

  // 再发一次 null，模拟"用户已经把系统代理切回来了"
  await page.evaluate(async () => {
    const e = (window as any).__pbE2E;
    await e.emit('proxy:override', null);
  });
  await expect(page.getByTestId('proxy-override-btn')).toHaveCount(0);
});

// ============ 新特性：快捷键 ⌥⌘O 切换系统代理 / ⌥⌘R 切换抓包 ============

test('快捷键 ⌥⌘O 切换系统代理；⌥⌘R 切换抓包录制', async () => {
  // 拿到当前 proxyStatus 作为基线
  await page.waitForFunction(() => !!(window as any).__pbStore?.getState?.().proxyStatus, null, { timeout: 5000 });
  const before = await page.evaluate(() => (window as any).__pbStore.getState().proxyStatus);
  expect(before).toBeTruthy();

  // ⌥⌘O：切换 systemProxyApplied（E2E 模式下 main 会跳过真实 networksetup，仅更新内存状态）
  const targetSys = !before.systemProxyApplied;
  await page.keyboard.press('Meta+Alt+o');
  await expect
    .poll(() => page.evaluate(() => (window as any).__pbStore.getState().proxyStatus.systemProxyApplied))
    .toBe(targetSys);
  // 状态栏图标应同步（data-system 属性反映）
  await expect(page.getByTestId('proxy-status-btn')).toHaveAttribute('data-system', targetSys ? 'true' : 'false');

  // 再按一次 ⌥⌘O：切回原值
  await page.keyboard.press('Meta+Alt+o');
  await expect
    .poll(() => page.evaluate(() => (window as any).__pbStore.getState().proxyStatus.systemProxyApplied))
    .toBe(before.systemProxyApplied);

  // ⌥⌘R：切换 recording
  const beforeRec = (await page.evaluate(() => (window as any).__pbStore.getState().proxyStatus.recording)) as boolean;
  await page.keyboard.press('Meta+Alt+r');
  await expect
    .poll(() => page.evaluate(() => (window as any).__pbStore.getState().proxyStatus.recording))
    .toBe(!beforeRec);
  await expect(page.getByTestId('proxy-status-btn')).toHaveAttribute('data-recording', !beforeRec ? 'true' : 'false');

  // 复原 recording 为原值，避免影响后续测试
  await page.keyboard.press('Meta+Alt+r');
  await expect
    .poll(() => page.evaluate(() => (window as any).__pbStore.getState().proxyStatus.recording))
    .toBe(beforeRec);
});


// ---------- 日志系统& 应用菜单 ----------

test('应用菜单：中文顶级菜单项齐全（文件/编辑/视图/抓包/规则/调试/窗口/帮助）', async () => {
  const labels = await app.evaluate(async ({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return [];
    return m.items.map((it: any) => it.label);
  });
  for (const expected of ['文件', '编辑', '视图', '抓包', '规则', '调试', '窗口', '帮助']) {
    expect(labels).toContain(expected);
  }
});

test('调试菜单：包含"打开日志目录 / 清空所有日志"等项', async () => {
  const debugItems = await app.evaluate(async ({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return [];
    const debugMenu = m.items.find((it: any) => it.label === '调试');
    if (!debugMenu || !debugMenu.submenu) return [];
    return debugMenu.submenu.items.map((it: any) => it.label);
  });
  expect(debugItems).toEqual(expect.arrayContaining(['打开日志目录', '显示当前日志文件', '清空所有日志…', '复制诊断信息']));
});

test('IPC app:open-logs-folder / app:clear-logs 有效', async () => {
  // 直接在主进程验证 handler 逻辑 —— 通过 ipcMain.emit 触发注册的 handler
  const opened = await app.evaluate(async ({ ipcMain, shell }) => {
    // 探测 handler 是否已注册（通过 ipcMain._invokeHandlers 私有 map）
    const map = (ipcMain as any)._invokeHandlers as Map<string, Function>;
    const openLogs = map.get('app:open-logs-folder');
    const clearLogs = map.get('app:clear-logs');
    if (!openLogs || !clearLogs) return { ok: false, reason: 'handlers not registered' };
    // stub 掉 shell.openPath 避免测试机真的打开 Finder
    (shell as any).openPath = async () => '';
    const openRes = await openLogs({});
    const clearRes = await clearLogs({});
    return { openRes, clearRes };
  });
  expect((opened as any).openRes).toMatchObject({ ok: true });
  expect((opened as any).clearRes).toMatchObject({ ok: true });
});

test('监听气泡：一键复制 shell 环境变量', async () => {
  // 先清空剪贴板，避免其它用例污染
  await app.evaluate(async ({ clipboard }) => clipboard.writeText(''));

  // 顶部工具栏那颗 "ProxyBaby | 正在监听 ..." 按钮
  await page.getByText(/ProxyBaby \|/).first().click();

  const copyBtn = page.getByTestId('copy-shell-env');
  await expect(copyBtn).toBeVisible();
  await copyBtn.click();

  // 反馈变成"已复制"
  await expect(copyBtn).toContainText('已复制');

  const text = await app.evaluate(async ({ clipboard }) => clipboard.readText());
  // 三行export，且用回环地址（不是 status.host）
  expect(text).toMatch(/^export http_proxy=http:\/\/127\.0\.0\.1:\d+$/m);
  expect(text).toMatch(/^export https_proxy=http:\/\/127\.0\.0\.1:\d+$/m);
  expect(text).toMatch(/^export all_proxy=http:\/\/127\.0\.0\.1:\d+$/m);

  // 收起弹层，避免影响后续用例
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
});

test('监听气泡：回环地址可编辑并被复制命令采用', async () => {
  await app.evaluate(async ({ clipboard }) => clipboard.writeText(''));

  await page.getByText(/ProxyBaby \|/).first().click();

  // 进入回环编辑
  await page.getByTestId('copy-host-edit').click();
  const input = page.getByTestId('copy-host-input');
  await expect(input).toBeVisible();
  await input.fill('192.168.1.100');
  await input.press('Enter');

  // 展示值应更新
  await expect(page.getByTestId('copy-host-value')).toHaveText('192.168.1.100');

  // 点复制，剪贴板里应是新的 host
  await page.getByTestId('copy-shell-env').click();
  const text = await app.evaluate(async ({ clipboard }) => clipboard.readText());
  expect(text).toMatch(/^export http_proxy=http:\/\/192\.168\.1\.100:\d+$/m);
  expect(text).toMatch(/^export https_proxy=http:\/\/192\.168\.1\.100:\d+$/m);
  expect(text).toMatch(/^export all_proxy=http:\/\/192\.168\.1\.100:\d+$/m);

  // 还原成 127.0.0.1，避免影响后续用例（如果加了别的用例）
  await page.getByTestId('copy-host-edit').click();
  await page.getByTestId('copy-host-input').fill('127.0.0.1');
  await page.getByTestId('copy-host-input').press('Enter');

  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
});

// ============ 更新提示（Updater）============

test('更新提示：通过 IPC 弹出独立窗口并渲染 changelog', async () => {
  const before = app.windows().length;
  await page.evaluate(async () => {
    await (window as any).proxybaby.openWindow('updater', { title: '更新' });
  });
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#updater'));
  if (!win) throw new Error('updater 窗口未打开');
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!(window as any).__pbE2E && !!(window as any).proxybaby);

  // 注入 update info 事件（走 __e2e:emit → broadcast 'updater:info'）
  await win.evaluate(async () => {
    await (window as any).__pbE2E.emit('updater:info', {
      currentVersion: '0.7.0',
      latestVersion: '9.9.9',
      hasUpdate: true,
      isSkipped: false,
      releaseName: 'Release 9.9.9',
      releaseNotes: '## 更新内容\n\n- 全新更新提示能力\n- 修复若干问题',
      htmlUrl: 'https://github.com/imcuttle/proxybaby/releases/tag/v9.9.9',
      publishedAt: '2026-01-01T00:00:00Z',
      checkedAt: Date.now(),
    });
  });

  await expect(win.getByTestId('updater-view')).toBeVisible();
  await expect(win.getByTestId('updater-title')).toContainText('9.9.9');
  await expect(win.getByTestId('updater-notes')).toContainText('全新更新提示能力');
  await expect(win.getByTestId('updater-skip')).toBeVisible();
  await expect(win.getByTestId('updater-later')).toBeVisible();
  await expect(win.getByTestId('updater-open-release')).toBeVisible();

  // 点"稍后提醒"应关闭窗口
  await win.getByTestId('updater-later').click();
  const t1 = Date.now();
  while (app.windows().some((w) => w.url().includes('#updater')) && Date.now() - t1 < 5000) {
    await page.waitForTimeout(100);
  }
  expect(app.windows().some((w) => w.url().includes('#updater'))).toBe(false);
});
