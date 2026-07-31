import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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

// 注入一个 flow 的辅助：通过 E2E 通道按事件序列灌入
async function injectFlow(flow: any, events: { event: string; payload: any }[] = []) {
  await page.evaluate(async ({ flow, events }) => {
    const e = (window as any).__pbE2E;
    await e.emit('flow:start', flow);
    for (const ev of events) await e.emit(ev.event, ev.payload);
  }, { flow, events });
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
  await page.getByRole('tab', { name: 'OpenAI' }).click();
  // 用户消息 + 助手拼接后的内容
  await expect(page.getByText('你好', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('，我能帮你', { exact: false }).first()).toBeVisible();
  // 角色标签
  await expect(page.getByText('User', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Assistant', { exact: false }).first()).toBeVisible();
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

test('规则页：新建规则集并编辑保存', async () => {
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await expect(page.getByText('规则集', { exact: true })).toBeVisible();
  await page.locator('button[title="新建"]').click();
  // Monaco 编辑器出现
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.locator('.view-lines').click();
  await page.keyboard.type('api.demo.com/users  mock://{"e2e":true}');
  // 让 dirty 变 true：改一下 draftName input（同时保存按钮启用）
  // Save 按钮 title 前缀是 "保存"，用 startsWith
  await page.locator('button[title^="保存"]').click();
  await expect(page.getByText('新规则集').first()).toBeVisible();
});

test('插件列表可见并可切换', async () => {
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await expect(page.getByText('Whistle Rules').first()).toBeVisible();
  await expect(page.getByText('Breakpoint').first()).toBeVisible();
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

test('规则页：示例点击插入编辑器', async () => {
  await page.getByRole('button', { name: '规则', exact: true }).click();
  // 如果没有规则集，就新建一个
  const hasSet = await page.getByText('新规则集').first().isVisible().catch(() => false);
  if (!hasSet) {
    await page.locator('button[title="新建"]').click();
  }
  // 选中已有规则集
  await page.getByText('新规则集').first().click();
  // 帮助面板示例可见
  await expect(page.getByText('示例（点击插入）')).toBeVisible();
  // 点击一个示例
  await page.getByText('Mock JSON 响应').click();
  // Monaco 编辑器里出现 mock:// —— 检查 .view-line 里的文本
  await expect(page.locator('.monaco-editor .view-line').getByText(/mock:\/\//).first()).toBeVisible();
});

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

// ============ 过滤/搜索/侧栏 完整覆盖 ============
async function resetFilters() {
  await page.getByRole('button', { name: '抓包' }).click();
  await ensureBaseFlows();
  // 通过桥直接把 filter 全部重置（比逐个 UI 点击更稳）
  await page.evaluate(() => {
    const anyWin = window as any;
    if (anyWin.__pbStore?.getState) {
      anyWin.__pbStore.getState().resetFilter();
      anyWin.__pbStore.setState({ selectedIds: {}, selectedId: null });
    }
  });
  const bar = page.getByTestId('searchbar-input');
  if (!(await bar.isVisible().catch(() => false))) {
    // 底部搜索输入已下沉到 StatusBar 常驻；高级 SearchBar 弹层通过 store 桥打开更稳定（避免依赖 ⌘F 被系统菜单拦截）。
    await page.evaluate(() => (window as any).__pbStore?.getState().setSearchOpen(true));
  }
  await page.getByTestId('searchbar-input').fill('');
}

/**
 * 保证测试所需的三个 flow 已经在 store 中；重复调用是幂等的：主进程 store 是 Set 语义。
 * 有些测试可能因前一个 test 出错而丢失 fixture，这里做兜底。
 */
async function ensureBaseFlows() {
  // 用 store 里的 flows 计数判定，而不是 DOM（DOM 会被过滤影响）
  const flowsPresent = await page.evaluate(() => {
    const s = (window as any).__pbStore?.getState?.();
    if (!s) return 0;
    return s.flows.filter((f: any) => f.id === 'f-http').length;
  });
  if (flowsPresent > 0) return;
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
  await injectFlow(
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
    {
      id: 'f-ws', status: 'streaming', isTLS: true, isWebSocket: true, sseFrames: [], wsMessages: [],
      app: { name: 'Chrome', pid: 3 },
      request: { method: 'GET', url: 'wss://echo.demo.com/ws', host: 'echo.demo.com', path: '/ws', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: Date.now() },
    },
    [],
  );
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

async function openFilterConfigWindow() {
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

async function waitForEntryEditorWindow() {
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

test('过滤配置窗口：SSL 添加 App 维度条目', async () => {
  const w = await openFilterConfigWindow();
  await expect(w.getByTestId('ssl-panel')).toBeVisible();
  await w.getByTestId('ssl-add').click();
  const editor = await waitForEntryEditorWindow();
  await editor.getByTestId('fee-kind-app').click();
  await editor.getByTestId('fee-value').fill('Google Chrome');
  await editor.getByTestId('fee-save').click();
  await expect(w.getByTestId('ssl-panel')).toContainText('Google Chrome');
  await w.getByTestId('close-self').click();
});

test('规则页：脚本子标签中创建脚本 → 编辑并保存 → 勾选全局', async () => {
  // 切到主界面「规则」页
  await page.getByRole('button', { name: '规则', exact: true }).click();
  // 切到「脚本（Scripts）」子标签
  await page.getByTestId('rules-tab-scripts').click();
  await expect(page.getByTestId('scripts-panel')).toBeVisible();
  await page.getByTestId('script-add').click();
  await page.getByTestId('script-name').fill('e2e-script');
  // Monaco 里输入代码：点击 view-lines 激活后键入
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.type('module.exports = { onRequest(pb){ pb.setReqHeader("X-E2E", "1"); } }');
  await page.getByTestId('script-save').click();
  await page.getByTestId('script-always').check();
  // 切回抓包页免影响后续测试
  await page.getByTestId('rules-tab-rules').click();
  await page.getByRole('button', { name: '抓包', exact: true }).click();
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
  await page.getByTestId('composer-headers').fill('Accept: application/json');
  await page.getByTestId('composer-body').fill('{"hello":"world"}');
  await page.getByTestId('composer-toggle-code').click();
  await page.getByTestId('composer-lang-python').click();
  await expect(page.getByTestId('composer-code')).toContainText('requests.post');
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
