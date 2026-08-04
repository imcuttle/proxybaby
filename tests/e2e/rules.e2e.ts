/**
 * E2E — 规则集/临时规则/quick-rule 侧栏与抓包列表右键、Scripts 子标签、Rule Debug 窗口。
 * 从原 app.e2e.ts 拆出，独立启动 electron 实例，与其他 spec 隔离。
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchApp,
  disposeApp,
  injectFlow as injectFlowShared,
  ensureBaseFlows as ensureBaseFlowsShared,
  resetFilters as resetFiltersShared,
} from './_shared';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.beforeAll(async () => {
  const ctx = await launchApp('rules');
  app = ctx.app;
  page = ctx.page;
  userDataDir = ctx.userDataDir;
});

test.afterAll(async () => {
  await disposeApp({ app, userDataDir });
});

async function injectFlow(flow: any, events: { event: string; payload: any }[] = []) {
  await injectFlowShared(page, flow, events);
}
async function ensureBaseFlows() { await ensureBaseFlowsShared(page); }
async function resetFilters() { await resetFiltersShared(page); }

// ---------------- 规则页基础 ----------------

test('规则页：新建规则集并编辑保存', async () => {
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await expect(page.getByText('规则集', { exact: true })).toBeVisible();
  await page.locator('button[title="新建"]').click();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.locator('.view-lines').click();
  await page.keyboard.type('api.demo.com/users  mock://{"e2e":true}');
  await page.locator('button[title^="保存"]').click();
  await expect(page.getByText('新规则集').first()).toBeVisible();
});

test('插件列表可见并可切换', async () => {
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await expect(page.getByText('Whistle Rules').first()).toBeVisible();
  await expect(page.getByText('Breakpoint').first()).toBeVisible();
});

test('规则页：示例点击插入编辑器', async () => {
  await page.getByRole('button', { name: '规则', exact: true }).click();
  const hasSet = await page.getByText('新规则集').first().isVisible().catch(() => false);
  if (!hasSet) {
    await page.locator('button[title="新建"]').click();
  }
  await page.getByText('新规则集').first().click();
  await expect(page.getByText('示例（点击插入）')).toBeVisible();
  await page.getByText('Mock JSON 响应').click();
  await expect(page.locator('.monaco-editor .view-line').getByText(/mock:\/\//).first()).toBeVisible();
});

// ---------------- 侧栏 / 抓包列表 右键 → 快速规则 ----------------

test('侧栏右键：规则 → 禁止访问，生成临时规则；再点即删除（toggle）', async () => {
  await resetFilters();
  await page.evaluate(async () => await (window as any).proxybaby.rulesClearTemp());
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]');
  await hostRow.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  await page.locator('[data-testid="quick-rule-abort"]').click();
  const list = await page.evaluate(async () => await (window as any).proxybaby.rulesList());
  const temps = list.filter((s: any) => s.temporary);
  expect(temps.length).toBeGreaterThanOrEqual(1);
  expect(temps.some((s: any) => s.text.includes('api.demo.com') && s.text.includes('abort'))).toBe(true);
  await hostRow.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  const abortItem = page.locator('[data-testid="quick-rule-abort"]');
  await expect(abortItem).toHaveAttribute('data-active', 'true');
  await abortItem.click({ force: true });
  const list2 = await page.evaluate(async () => await (window as any).proxybaby.rulesList());
  expect(list2.filter((s: any) => s.temporary && s.text.includes('api.demo.com') && s.text.includes('abort')).length).toBe(0);
});

test('侧栏右键：自定义规则 → 跳规则页 + 临时 sub-tab 出现，编辑器聚焦', async () => {
  await resetFilters();
  await page.evaluate(async () => await (window as any).proxybaby.rulesClearTemp());
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]');
  await hostRow.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  await page.locator('[data-testid="quick-rule-custom"]').click();
  await expect(page.locator('[data-testid="rules-mode-tabs"]')).toBeVisible();
  await expect(page.locator('[data-testid="rules-subtab-temporary"]')).toBeVisible();
  const list = await page.evaluate(async () => await (window as any).proxybaby.rulesList());
  const custom = list.find((s: any) => s.temporary && s.name === '[临时] 自定义');
  expect(custom).toBeTruthy();
  expect(custom.text.includes('api.demo.com')).toBe(true);
});

test('抓包列表右键：规则 → 禁止访问，pattern 为 host+path 且可 toggle 删除', async () => {
  await page.getByRole('button', { name: '抓包' }).click();
  await resetFilters();
  await ensureBaseFlows();
  await page.evaluate(async () => await (window as any).proxybaby.rulesClearTemp());
  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-http"]');
  await row.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  await page.locator('[data-testid="quick-rule-abort"]').click();
  const list = await page.evaluate(async () => await (window as any).proxybaby.rulesList());
  const hit = list.filter((s: any) => s.temporary && s.text.includes('api.demo.com/users') && s.text.includes('abort'));
  expect(hit.length).toBeGreaterThanOrEqual(1);
  await row.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  const abortItem = page.locator('[data-testid="quick-rule-abort"]');
  await expect(abortItem).toHaveAttribute('data-active', 'true');
  await abortItem.click({ force: true });
  const list2 = await page.evaluate(async () => await (window as any).proxybaby.rulesList());
  expect(list2.filter((s: any) => s.temporary && s.text.includes('api.demo.com/users') && s.text.includes('abort')).length).toBe(0);
});

test('抓包列表右键：toggle 只删对应 quick-rule 那一行，不误删用户在临时集里追加的其他规则行', async () => {
  await page.getByRole('button', { name: '抓包' }).click();
  await resetFilters();
  await ensureBaseFlows();
  await page.evaluate(async () => await (window as any).proxybaby.rulesClearTemp());

  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-http"]');
  await row.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  await page.locator('[data-testid="quick-rule-abort"]').click();

  const rsId = await page.evaluate(async () => {
    const list = await (window as any).proxybaby.rulesList();
    const rs = list.find((s: any) => s.temporary && s.text.includes('api.demo.com/users') && s.text.includes('abort'));
    if (!rs) return null;
    const nextText = rs.text.trimEnd() + '\n' + 'api.demo.com/users  statusCode://500';
    await (window as any).proxybaby.rulesUpdate(rs.id, { text: nextText });
    return rs.id;
  });
  expect(rsId).toBeTruthy();

  await row.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  const abortItem = page.locator('[data-testid="quick-rule-abort"]');
  await expect(abortItem).toHaveAttribute('data-active', 'true');
  await abortItem.click({ force: true });

  const after = await page.evaluate(async (id) => {
    const list = await (window as any).proxybaby.rulesList();
    return list.find((s: any) => s.id === id) || null;
  }, rsId!);
  expect(after).toBeTruthy();
  expect(String(after.text)).toContain('statusCode://500');
  expect(/(^|\n)\S+\s+abort\s*$/m.test(String(after.text))).toBe(false);
});

// ---------------- 临时 sub-tab ----------------

test('规则页临时 sub-tab: 清空按钮工作', async () => {
  await page.evaluate(async () => {
    await (window as any).proxybaby.rulesQuickAdd({ pattern: 'demo.com', operator: 'abort', value: '' });
  });
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await expect(page.locator('[data-testid="rules-subtab-temporary"]')).toBeVisible();
  await page.locator('[data-testid="rules-subtab-temporary"]').click();
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-testid="rules-clear-temp"]').click();
  await expect(page.locator('[data-testid="rules-subtab-temporary"]')).toHaveCount(0, { timeout: 3000 });
});

test('临时 sub-tab: 无临时规则时可通过"切换到常规规则"按钮回到常规', async () => {
  // 场景：用户先切到临时 tab，然后其他路径（如右键 toggle-off）把临时规则清空 →
  // 之前的实现里 sub-tab 直接消失、空态只显示文字，用户没有从"临时"切回"常规"的入口。
  await page.evaluate(async () => await (window as any).proxybaby.rulesClearTemp());
  await page.evaluate(async () => {
    await (window as any).proxybaby.rulesQuickAdd({ pattern: 'demo.com', operator: 'abort', value: '' });
  });
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await page.locator('[data-testid="rules-subtab-temporary"]').click();
  await page.evaluate(async () => await (window as any).proxybaby.rulesClearTemp());
  await expect(page.locator('[data-testid="rules-subtab-temporary"]')).toBeVisible();
  const switchBtn = page.locator('[data-testid="rules-switch-to-normal"]');
  await expect(switchBtn).toBeVisible();
  await switchBtn.click();
  await expect(page.locator('[data-testid="rules-subtab-temporary"]')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('[data-testid="rules-subtab-normal"]')).toHaveCount(0, { timeout: 3000 });
});

test('右键 toggle-off 快速规则后，规则页临时 tab UI 同步刷新（不残留幽灵条目）', async () => {
  await page.getByRole('button', { name: '抓包' }).click();
  await resetFilters();
  await page.evaluate(async () => await (window as any).proxybaby.rulesClearTemp());
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await page.getByRole('button', { name: '抓包' }).click();
  const hostRow = page.locator('[data-testid="host-row"][data-host="api.demo.com"]');
  await hostRow.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  await page.locator('[data-testid="quick-rule-abort"]').click();
  await hostRow.click({ button: 'right' });
  await page.locator('[data-testid="quick-rule-trigger"]').click();
  const abortItem = page.locator('[data-testid="quick-rule-abort"]');
  await expect(abortItem).toHaveAttribute('data-active', 'true');
await abortItem.click({ force: true });
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await expect(page.locator('[data-testid="rules-subtab-temporary"]')).toHaveCount(0, { timeout: 3000 });
});

// ---------------- 脚本子标签 ----------------

test('规则页：脚本子标签中创建脚本 → 编辑并保存 → 勾选全局', async () => {
  await page.getByRole('button', { name: '规则', exact: true }).click();
  await page.getByTestId('rules-tab-scripts').click();
  await expect(page.getByTestId('scripts-panel')).toBeVisible();
  await page.getByTestId('script-add').click();
  await page.getByTestId('script-name').fill('e2e-script');
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.type('module.exports = { onRequest(pb){ pb.setReqHeader("X-E2E", "1"); } }');
  await page.getByTestId('script-save').click();
  await page.getByTestId('script-always').check();
  await page.getByTestId('rules-tab-rules').click();
  await page.getByRole('button', { name: '抓包', exact: true }).click();
});

// ---------------- Rule Debug 独立窗口 ----------------

test('Rule Debug：规则页顶部按钮打开独立窗口 → 输入 URL → 匹配诊断出现', async () => {
  await page.evaluate(async () => {
    await (window as any).proxybaby.rulesAdd(
    'debug-test',
      'api.debug.com/hello  mock://{"e2e":true}',
   true,
    );
  });

  await page.getByRole('button', { name: '规则', exact: true }).click();
  const before = app.windows().length;
  await page.getByTestId('rules-open-debug').click();
  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#rule-debug'));
  if (!win) throw new Error('rule-debug 窗口未打开');
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByTestId('rule-debug-window')).toBeVisible();

  await win.getByTestId('rd-url').fill('https://api.debug.com/hello');
  await win.getByTestId('rd-run').click();

await expect(win.getByTestId('rd-diagnose-list')).toBeVisible();
  await expect(win.locator('[data-testid="rd-diag-hit"]').first()).toContainText('debug-test');
  await expect(win.getByTestId('rd-env-banner')).toBeVisible();

  await win.getByTestId('rd-tab-dryrun').click();
  await expect(win.locator('body')).toContainText('短路');
  await expect(win.locator('body')).toContainText('{"e2e":true}');

  await win.getByTestId('close-self').click();
});

test('Rule Debug：从抓包 flow 右键 → 打开后显示"实际 vs 模拟"对比横幅', async () => {
  await page.evaluate(async () => {
    await (window as any).proxybaby.rulesAdd(
 'debug-actual',
      'actual.debug.com/x  mock://{"from":"rule"}',
 true,
    );
  });

  await injectFlow({
 id: 'f-rd-actual', status: 'completed', isTLS: true, sseFrames: [],
    app: { name: 'node', pid: 99 },
    request: {
      method: 'GET',
      url: 'https://actual.debug.com/x',
      host: 'actual.debug.com',
      path: '/x',
      scheme: 'https',
    httpVersion: '1.1',
      headers: [],
      bodySize: 0,
      startedAt: Date.now(),
      contentType: '',
    },
  }, [
    { event: 'flow:end', payload: { id: 'f-rd-actual', durationMs: 10, status: 'completed' } },
  ]);

  await page.getByRole('button', { name: '抓包' }).click();
  const row = page.locator('[data-testid="flow-row"][data-flow-id="f-rd-actual"]');
  await expect(row).toBeVisible();
  const before = app.windows().length;
  await page.evaluate(() => {
    (window as any).proxybaby.ruleDebugOpen({
      url: 'https://actual.debug.com/x',
      method: 'GET',
      scheme: 'https',
      headers: [],
      actualFlow: {
id: 'f-rd-actual',
      edited: false,
        matchedRules: [],
      },
});
  });

  const t0 = Date.now();
  while (app.windows().length <= before && Date.now() - t0 < 10000) {
    await page.waitForTimeout(100);
  }
  const win = app.windows().find((w) => w !== page && w.url().includes('#rule-debug'));
  if (!win) throw new Error('rule-debug 窗口未打开');
  await win.waitForLoadState('domcontentloaded');

  await expect(win.getByTestId('rd-url')).toHaveValue('https://actual.debug.com/x');
  await expect(win.getByTestId('rd-actual-banner')).toBeVisible({ timeout: 5000 });
  await expect(win.getByTestId('rd-actual-banner')).toContainText('实际抓包时该 flow 未命中任何规则');

  await win.getByTestId('close-self').click();
});
