import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

let app: ElectronApplication;
let page: Page;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-e2e-ai-'));

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
  await page.waitForFunction(
    () => !!(window as any).__pbE2E && !!(window as any).proxybaby && !!(window as any).__pbAiStore,
    null,
    { timeout: 15000 },
  );
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

async function resetAi() {
  // 通过 IPC 逐个删除
  await page.evaluate(async () => {
    const api = (window as any).proxybaby;
    const list = await api.aiListSessions();
    for (const s of list) await api.aiDeleteSession(s.id);
  });
}

async function openPanel() {
  const btn = page.getByTestId('toggle-ai');
  const open = await btn.getAttribute('data-open');
  if (open !== 'true') await btn.click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
}

test('AI 默认启用：顶栏可见 ✨ 按钮', async () => {
  await expect(page.getByTestId('toggle-ai')).toBeVisible();
});

test('点击顶栏按钮切换 AI 侧边栏可见性', async () => {
  await resetAi();
  const btn = page.getByTestId('toggle-ai');
  // 初始应为关闭
  await expect(btn).toHaveAttribute('data-open', 'false');
  await btn.click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
  await expect(btn).toHaveAttribute('data-open', 'true');
  // 再点关闭
  await btn.click();
  await expect(page.getByTestId('ai-panel')).toHaveCount(0);
});

test('新建会话 → 出现在会话列表', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();
  await expect.poll(async () => await page.evaluate(() => (window as any).__pbAiStore.getState().sessions.length)).toBe(1);
  const items = page.getByTestId('ai-session-item');
  await expect(items.first()).toHaveAttribute('data-active', 'true');
});

test('发送消息 → 用户气泡出现；注入 assistant 事件后出现 assistant 气泡与 tool-call', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();

  // 使用 store 直接注入 user 消息（避免 Slate 输入的时序不稳定），并调用 aiSend
  await page.evaluate(async () => {
    const s = (window as any).__pbAiStore.getState();
    const cur = s.currentId;
    s.appendUserMessage(cur, '帮我 mock user 接口');
    await (window as any).proxybaby.aiSend('帮我 mock user 接口', []);
  });

  const userMsg = page.locator('[data-testid="ai-message"][data-role="user"]');
  await expect(userMsg.first()).toBeVisible();
  await expect(userMsg.first()).toContainText('帮我 mock user 接口');

  // 灌入 assistant text-delta + tool-call
  await page.evaluate(async () => {
    const e = (window as any).__pbE2E;
    await e.aiEmit({ type: 'message-start', messageId: 'a1', role: 'assistant' });
    await e.aiEmit({ type: 'text-delta', messageId: 'a1', text: '好的，正在为你添加规则… ' });
    await e.aiEmit({ type: 'text-delta', messageId: 'a1', text: '完成。' });
    await e.aiEmit({ type: 'tool-call', messageId: 'a1', id: 'tc1', name: 'pb_rule_add', args: { name: 'mock-user', text: 'api.example.com/user mock://{"ok":true}' } });
    await e.aiEmit({ type: 'tool-result', messageId: 'a1', tool_use_id: 'tc1', output: { ok: true, id: 'r_1' } });
    await e.aiEmit({ type: 'message-end', messageId: 'a1' });
  });

  const asstMsg = page.locator('[data-testid="ai-message"][data-role="assistant"]');
  await expect(asstMsg.first()).toBeVisible();
  await expect(asstMsg.first()).toContainText('正在为你添加规则');
  await expect(asstMsg.first()).toContainText('完成');

  const toolCard = page.getByTestId('ai-tool-call').first();
  await expect(toolCard).toBeVisible();
  await expect(toolCard).toHaveAttribute('data-tool-name', 'pb_rule_add');
  await expect(toolCard).toHaveAttribute('data-tool-state', 'ok');
});

test('消息包含 mention 语法 → 渲染成 chip', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();

  // 直接把一条 user 消息塞进去，内容里含 flow: 语法
  await page.evaluate(() => {
    const s = (window as any).__pbAiStore.getState();
    s.appendUserMessage(s.currentId, '请看下 `flow:f-http` 的响应');
  });
  await expect(page.getByTestId('mention-chip-flow').first()).toBeVisible();
});

test('切换会话消息独立', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();
  // 记住 A 的 id
  const aId = await page.evaluate(() => (window as any).__pbAiStore.getState().currentId);
  // 会话 A
  await page.evaluate(() => {
    const s = (window as any).__pbAiStore.getState();
    s.appendUserMessage(s.currentId, 'A 的消息');
  });
  await expect(page.locator('[data-testid="ai-message"]').first()).toContainText('A 的消息');

  // 新建 B
  await page.getByTestId('ai-new-session').click();
  await expect(page.locator('[data-testid="ai-message"]')).toHaveCount(0);
  await page.evaluate(() => {
    const s = (window as any).__pbAiStore.getState();
    s.appendUserMessage(s.currentId, 'B 的消息');
  });
  await expect(page.locator('[data-testid="ai-message"]').first()).toContainText('B 的消息');

  // 切回 A（在 chip 列表或 overflow 菜单里找）
  await page.evaluate(async (id) => {
    await (window as any).proxybaby.aiSwitchSession(id);
    (window as any).__pbAiStore.getState().setCurrent(id);
  }, aId);
  await expect(page.locator('[data-testid="ai-message"]').first()).toContainText('A 的消息');
});

test('关闭 AI 总开关后 ✨ 按钮消失', async () => {
  await page.evaluate(async () => {
    await (window as any).proxybaby.aiSetConfig({ enabled: false });
    // 同步 store
    const s = (window as any).__pbAiStore.getState();
    s.setConfig({ enabled: false, cliPath: 'codebuddy' });
  });
  await expect(page.getByTestId('toggle-ai')).toHaveCount(0);

  // 恢复
  await page.evaluate(async () => {
    await (window as any).proxybaby.aiSetConfig({ enabled: true });
    const s = (window as any).__pbAiStore.getState();
    s.setConfig({ enabled: true, cliPath: 'codebuddy' });
  });
  await expect(page.getByTestId('toggle-ai')).toBeVisible();
});

test('删除会话', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();
  await page.getByTestId('ai-new-session').click();
  // 会话可能出现在 chip 列表或 overflow 菜单，用 store 计数更稳
  const before = await page.evaluate(() => (window as any).__pbAiStore.getState().sessions.length);
  expect(before).toBe(2);
  // 删除第一条 chip
  await page.locator('[data-testid="ai-session-item"] button[title="删除"]').first().click();
  await expect.poll(async () => await page.evaluate(() => (window as any).__pbAiStore.getState().sessions.length)).toBe(1);
});

test('左右对话布局：user 靠右、assistant 靠左', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();
  await page.evaluate(() => {
    const s = (window as any).__pbAiStore.getState();
    s.appendUserMessage(s.currentId, '你好');
    s.onMessageStart(s.currentId, 'a-align', 'assistant');
    s.onTextDelta(s.currentId, 'a-align', '你好呀');
    s.onMessageEnd(s.currentId, 'a-align');
  });
  const user = page.locator('[data-testid="ai-message"][data-role="user"]');
  const asst = page.locator('[data-testid="ai-message"][data-role="assistant"]');
  await expect(user.first()).toHaveClass(/justify-end/);
  await expect(asst.first()).toHaveClass(/justify-start/);
});

test('流式：多段 text-delta 依次累加显示', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();
  await page.evaluate(() => {
    (window as any).__pbAiStore.getState().onMessageStart(
      (window as any).__pbAiStore.getState().currentId, 'stream1', 'assistant',
    );
  });
  const msg = page.locator('[data-testid="ai-message"][data-role="assistant"]').first();
  const deltas = ['第一段…', '第二段…', '第三段完成。'];
  for (const d of deltas) {
    await page.evaluate((delta) => {
      const s = (window as any).__pbAiStore.getState();
      s.onTextDelta(s.currentId, 'stream1', delta);
    }, d);
  }
  await expect(msg).toContainText('第一段…第二段…第三段完成。');
});

test('图片：markdown ![alt](data:) 渲染为 <img>', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  await page.evaluate((url) => {
    const s = (window as any).__pbAiStore.getState();
    s.appendUserMessage(s.currentId, `请看：\n\n![shot](${url})`);
  }, png);
  await expect(page.getByTestId('ai-image').first()).toBeVisible();
});

test('Composer：发送按钮同行 + 附件流：程序化附加图片附件后可发送', async () => {
  await resetAi();
  await openPanel();
  await page.getByTestId('ai-new-session').click();
  // 发送按钮和输入框应在同一 flex 行；文件/图片合到一个 📎 按钮里
  await expect(page.getByTestId('ai-send')).toBeVisible();
  await expect(page.getByTestId('ai-attach')).toBeVisible();
  // 展开附件菜单，看到两个选项
  await page.getByTestId('ai-attach').click();
  await expect(page.getByTestId('ai-attach-menu')).toBeVisible();
  await expect(page.getByTestId('ai-attach-file')).toBeVisible();
  await expect(page.getByTestId('ai-attach-image')).toBeVisible();
  // 关掉菜单
  await page.getByTestId('ai-attach').click();

  // 通过 input[type=file] 灌入一个 1x1 png
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d494441545801637cff0f00030100014a2e28c60000000049454e44ae426082', 'hex');
  await page.getByTestId('ai-image-input').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByTestId('ai-attachment')).toBeVisible();
  await expect(page.getByTestId('ai-attachment').first()).toHaveAttribute('data-kind', 'image');
  // 发送
  await page.getByTestId('ai-send').click();
  // user 消息应包含图片
  const userMsg = page.locator('[data-testid="ai-message"][data-role="user"]').first();
  await expect(userMsg).toBeVisible();
  await expect(userMsg.getByTestId('ai-image').first()).toBeVisible();
});

test('会话溢出：新建多个后出现 ... 下拉，可切换', async () => {
  await resetAi();
  await openPanel();
  // 建 15 个会话
  for (let i = 0; i < 15; i++) {
    await page.getByTestId('ai-new-session').click();
  }
  // ... 溢出按钮应出现
  await expect(page.getByTestId('ai-overflow-toggle')).toBeVisible();
  await page.getByTestId('ai-overflow-toggle').click();
  const menu = page.getByTestId('ai-overflow-menu');
  await expect(menu).toBeVisible();
  const items = menu.getByTestId('ai-overflow-item');
  await expect(items.first()).toBeVisible();
  // 点第一个溢出项，切换成功
  const firstId = await items.first().getAttribute('data-session-id');
  await items.first().click();
  await expect(page.locator(`[data-testid="ai-session-item"][data-session-id="${firstId}"], [data-testid="ai-overflow-item"][data-session-id="${firstId}"]`).first()).toBeVisible();
});

test('左侧栏可以收起/展开', async () => {
  // 切到抓包页
  await page.getByRole('button', { name: '抓包', exact: true }).click();
  const toggle = page.getByTestId('toggle-left-sidebar');
  await expect(toggle).toBeVisible();
  // 收起
  await toggle.click();
  await expect(page.getByTestId('left-collapsed-rail')).toBeVisible();
  // 展开
  await page.getByTestId('expand-left-sidebar').click();
  await expect(page.getByTestId('left-collapsed-rail')).toHaveCount(0);
});
