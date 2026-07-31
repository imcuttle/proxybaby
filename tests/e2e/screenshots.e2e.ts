/**
 * 截图 e2e：启动打包后的 app，注入一批合成 flow 让界面丰满，然后截图到 docs/screenshots/。
 * 只做截图、不做断言（除了 "文件生成了"）。
 * 跑法：
 *   npm run build:dir  # 或至少 vite build
 *   npx playwright test tests/e2e/screenshots.e2e.ts
 */
import { test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.join(root, 'docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });

let app: ElectronApplication;
let page: Page;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-shot-'));

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(root, 'dist-electron/main.js'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PROXYBABY_E2E: '1', NODE_ENV: 'production' },
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!(window as any).__pbE2E && !!(window as any).proxybaby, null, { timeout: 15000 });
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

async function injectFlow(flow: any, events: { event: string; payload: any }[] = []) {
  await page.evaluate(async ({ flow, events }) => {
    const e = (window as any).__pbE2E;
    await e.emit('flow:start', flow);
    for (const ev of events) await e.emit(ev.event, ev.payload);
  }, { flow, events });
}

test('inject flows + take screenshots', async () => {
  test.setTimeout(120000);
  const now = Date.now();

  // 一批多样化 flow
  await injectFlow(
    {
      id: 'fx-1', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'Google Chrome', pid: 501 },
      request: { method: 'GET', url: 'https://api.github.com/repos/imcuttle/proxybaby', host: 'api.github.com', path: '/repos/imcuttle/proxybaby', scheme: 'https', httpVersion: '2.0', headers: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'User-Agent', value: 'Chrome/120' }], bodySize: 0, startedAt: now - 8000, contentType: 'application/json' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'fx-1', response: { status: 200, statusText: 'OK', httpVersion: '2.0', headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Ratelimit-Remaining', value: '4972' }], bodySize: 0, isSSE: false, contentType: 'application/json' } } },
      { event: 'flow:response-body', payload: { id: 'fx-1', bodyText: JSON.stringify({ id: 1, name: 'proxybaby', full_name: 'imcuttle/proxybaby', private: false, description: 'Free & open-source HTTP(S) inspector with AI beautifier', stargazers_count: 1234, language: 'TypeScript', topics: ['proxy', 'mitm', 'macos', 'ai', 'sse'] }, null, 2), bodySize: 240 } },
      { event: 'flow:end', payload: { id: 'fx-1', durationMs: 128, status: 'completed' } },
    ],
  );
  await injectFlow(
    {
      id: 'fx-2', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'Google Chrome', pid: 501 },
      request: { method: 'POST', url: 'https://api.stripe.com/v1/charges', host: 'api.stripe.com', path: '/v1/charges', scheme: 'https', httpVersion: '2.0', headers: [{ name: 'Authorization', value: 'Bearer sk_test_***' }, { name: 'Idempotency-Key', value: 'ch_abc' }], bodySize: 0, startedAt: now - 7000, contentType: 'application/x-www-form-urlencoded', bodyText: 'amount=1999&currency=usd&source=tok_visa' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'fx-2', response: { status: 201, statusText: 'Created', httpVersion: '2.0', headers: [{ name: 'Content-Type', value: 'application/json' }], bodySize: 0, isSSE: false, contentType: 'application/json' } } },
      { event: 'flow:response-body', payload: { id: 'fx-2', bodyText: JSON.stringify({ id: 'ch_3P1', amount: 1999, currency: 'usd', paid: true, status: 'succeeded' }, null, 2), bodySize: 80 } },
      { event: 'flow:end', payload: { id: 'fx-2', durationMs: 246, status: 'completed' } },
    ],
  );
  await injectFlow(
    {
      id: 'fx-3', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'Slack', pid: 812 },
      request: { method: 'POST', url: 'https://slack.com/api/chat.postMessage', host: 'slack.com', path: '/api/chat.postMessage', scheme: 'https', httpVersion: '2.0', headers: [], bodySize: 0, startedAt: now - 6000, contentType: 'application/json', bodyText: '{"channel":"C123","text":"hello"}' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'fx-3', response: { status: 200, statusText: 'OK', httpVersion: '2.0', headers: [{ name: 'Content-Type', value: 'application/json' }], bodySize: 0, isSSE: false, contentType: 'application/json' } } },
      { event: 'flow:response-body', payload: { id: 'fx-3', bodyText: '{"ok":true,"ts":"1727700000.000100"}', bodySize: 40 } },
      { event: 'flow:end', payload: { id: 'fx-3', durationMs: 88, status: 'completed' } },
    ],
  );
  await injectFlow(
    {
      id: 'fx-4', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'node', pid: 302 },
      request: { method: 'POST', url: 'https://api.demo.com/graphql', host: 'api.demo.com', path: '/graphql', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: now - 5500, contentType: 'application/json', bodyText: JSON.stringify({ query: 'query User($id:ID!){ user(id:$id){ id name email } }', variables: { id: '42' } }) },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'fx-4', response: { status: 200, statusText: 'OK', httpVersion: '1.1', headers: [{ name: 'Content-Type', value: 'application/json' }], bodySize: 0, isSSE: false, contentType: 'application/json' } } },
      { event: 'flow:response-body', payload: { id: 'fx-4', bodyText: JSON.stringify({ data: { user: { id: '42', name: 'Alice', email: 'a@b.co' } } }, null, 2), bodySize: 100 } },
      { event: 'flow:end', payload: { id: 'fx-4', durationMs: 54, status: 'completed' } },
    ],
  );
  await injectFlow(
    {
      id: 'fx-5', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'Safari', pid: 622 },
      request: { method: 'GET', url: 'https://cdn.demo.com/static/hero.jpg', host: 'cdn.demo.com', path: '/static/hero.jpg', scheme: 'https', httpVersion: '2.0', headers: [], bodySize: 0, startedAt: now - 4000, contentType: 'image/jpeg' },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'fx-5', response: { status: 304, statusText: 'Not Modified', httpVersion: '2.0', headers: [], bodySize: 0, isSSE: false, contentType: 'image/jpeg' } } },
      { event: 'flow:end', payload: { id: 'fx-5', durationMs: 12, status: 'completed' } },
    ],
  );
  await injectFlow(
    {
      id: 'fx-6', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'node', pid: 302 },
      request: { method: 'DELETE', url: 'https://api.demo.com/users/999', host: 'api.demo.com', path: '/users/999', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: now - 3000 },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'fx-6', response: { status: 404, statusText: 'Not Found', httpVersion: '1.1', headers: [{ name: 'Content-Type', value: 'application/json' }], bodySize: 0, isSSE: false, contentType: 'application/json' } } },
      { event: 'flow:response-body', payload: { id: 'fx-6', bodyText: '{"error":"user not found"}', bodySize: 26 } },
      { event: 'flow:end', payload: { id: 'fx-6', durationMs: 41, status: 'completed' } },
    ],
  );
  // AI 明星流：OpenAI 流式
  await injectFlow(
    {
      id: 'fx-ai', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'Google Chrome', pid: 501 },
      request: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', host: 'api.openai.com', path: '/v1/chat/completions', scheme: 'https', httpVersion: '2.0', headers: [], bodySize: 0, startedAt: now - 2000, contentType: 'application/json', bodyText: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: '用一句话解释什么是 MITM 代理' }] }) },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'fx-ai', response: { status: 200, statusText: 'OK', httpVersion: '2.0', headers: [{ name: 'Content-Type', value: 'text/event-stream' }], bodySize: 0, isSSE: true, contentType: 'text/event-stream' } } },
      ...['MITM 代理', '（中间人代理）', '在客户端和服务器之间', '解密并观察 HTTPS 流量，', '常用于抓包、调试与安全测试。'].map((t) => ({ event: 'flow:sse-frame', payload: { id: 'fx-ai', frame: { data: JSON.stringify({ choices: [{ delta: { content: t } }] }), raw: '', receivedAt: Date.now() } } })),
      { event: 'flow:sse-frame', payload: { id: 'fx-ai', frame: { data: JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }), raw: '', receivedAt: Date.now() } } },
      { event: 'flow:end', payload: { id: 'fx-ai', durationMs: 620, status: 'completed' } },
    ],
  );
  // Anthropic 带 tool_use
  await injectFlow(
    {
      id: 'fx-anth', status: 'completed', isTLS: true, sseFrames: [],
      app: { name: 'node', pid: 302 },
      request: { method: 'POST', url: 'https://api.anthropic.com/v1/messages', host: 'api.anthropic.com', path: '/v1/messages', scheme: 'https', httpVersion: '2.0', headers: [], bodySize: 0, startedAt: now - 1500, contentType: 'application/json', bodyText: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: '帮我查一下今天北京天气' }] }) },
    },
    [
      { event: 'flow:response-headers', payload: { id: 'fx-anth', response: { status: 200, statusText: 'OK', httpVersion: '2.0', headers: [{ name: 'Content-Type', value: 'text/event-stream' }], bodySize: 0, isSSE: true, contentType: 'text/event-stream' } } },
      { event: 'flow:sse-frame', payload: { id: 'fx-anth', frame: { data: `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}`, raw: '', receivedAt: Date.now() } } },
      { event: 'flow:sse-frame', payload: { id: 'fx-anth', frame: { data: `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好的，我调用天气工具查询。' } })}`, raw: '', receivedAt: Date.now() } } },
      { event: 'flow:sse-frame', payload: { id: 'fx-anth', frame: { data: `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} } })}`, raw: '', receivedAt: Date.now() } } },
      { event: 'flow:sse-frame', payload: { id: 'fx-anth', frame: { data: `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":"Beijing"}' } })}`, raw: '', receivedAt: Date.now() } } },
      { event: 'flow:end', payload: { id: 'fx-anth', durationMs: 480, status: 'completed' } },
    ],
  );
  // WebSocket
  await injectFlow(
    {
      id: 'fx-ws', status: 'streaming', isTLS: true, isWebSocket: true, sseFrames: [], wsMessages: [],
      app: { name: 'Google Chrome', pid: 501 },
      request: { method: 'GET', url: 'wss://echo.demo.com/ws', host: 'echo.demo.com', path: '/ws', scheme: 'https', httpVersion: '1.1', headers: [], bodySize: 0, startedAt: now - 1000 },
    },
    [
      { event: 'flow:ws-message', payload: { id: 'fx-ws', message: { direction: 'send', type: 'text', text: '{"type":"subscribe","channel":"trades"}', size: 40, receivedAt: Date.now() } } },
      { event: 'flow:ws-message', payload: { id: 'fx-ws', message: { direction: 'recv', type: 'text', text: '{"channel":"trades","price":68420.5,"vol":0.03}', size: 46, receivedAt: Date.now() } } },
      { event: 'flow:ws-message', payload: { id: 'fx-ws', message: { direction: 'recv', type: 'text', text: '{"channel":"trades","price":68422.1,"vol":0.11}', size: 46, receivedAt: Date.now() } } },
    ],
  );

  await page.waitForTimeout(600);

  // 1. 主界面
  await page.locator('[data-testid="flow-row"][data-flow-id="fx-1"]').click();
  await page.getByRole('tab', { name: '正文' }).nth(1).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '01-main.png') });
  console.log('shot 01-main.png');

  // 2. AI OpenAI
  await page.locator('[data-testid="flow-row"][data-flow-id="fx-ai"]').click();
  await page.getByRole('tab', { name: 'OpenAI' }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '02-ai-openai.png') });
  console.log('shot 02-ai-openai.png');

  // 3. AI Anthropic
  await page.locator('[data-testid="flow-row"][data-flow-id="fx-anth"]').click();
  await page.getByRole('tab', { name: 'Anthropic' }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '03-ai-anthropic.png') });
  console.log('shot 03-ai-anthropic.png');

  // 4. WS
  await page.locator('[data-testid="flow-row"][data-flow-id="fx-ws"]').click();
  await page.getByRole('tab', { name: '消息' }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '04-websocket.png') });
  console.log('shot 04-websocket.png');

  // 5. 规则页
  await page.getByRole('button', { name: '规则', exact: true }).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '05-rules.png') });
  console.log('shot 05-rules.png');
});
