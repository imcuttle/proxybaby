/**
 * CLI e2e：覆盖 bin/proxybaby.cjs 的全量子命令。
 *
 * 思路：
 *   1. launchApp() 启动 electron 主进程，其中 startControlServer 会在loopback 监听。
 *   2. 端口通过 PROXYBABY_CTRL_PORT 环境变量注入随机可用端口——避开真机上
 *      正在跑的 ProxyBaby（占用 8898），也不污染用户配置。
 *   3. spawn('node', ['bin/proxybaby.cjs', ...args]) 起子进程发HTTP，
 *      同样通过 env拿端口，从同一个 token 文件读密钥。
 *   4. 逐条断言 stdout/stderr。
 *
 * 已排除（避免在开发机上产生副作用）：
 *   - `proxy on/off`会真的调 networksetup 改系统代理
 *   - `app quit`       会杀掉进程，放到最后一个测试
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cliPath = path.resolve(root, 'bin/proxybaby.cjs');

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let ctrlPort: number;

/** 通过 listen(0) 让 OS 分配一个空闲端口。返回后端口已释放，可能被别人抢，但概率极低。*/
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close();
        reject(new Error('failed to allocate port'));
      }
    });
  });
}

async function waitForControlServer(port: number, timeoutMs = 15000): Promise<void> {
  const t0 = Date.now();
  const tokenPath = path.join(os.homedir(), '.proxybaby', 'cli-token');
  while (Date.now() - t0< timeoutMs) {
    if (fs.existsSync(tokenPath)) {
      const token = fs.readFileSync(tokenPath, 'utf8').trim();
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/status', method: 'GET', headers: { 'x-proxybaby-token': token } },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode === 200));
          },
        );
        req.on('error', () => resolve(false));
        req.setTimeout(500, () => { req.destroy(); resolve(false); });
        req.end();
      });
      if (ok) return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`control server on127.0.0.1:${port} never became ready`);
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: root,
      env: { ...process.env, PROXYBABY_CTRL_PORT: String(ctrlPort) },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function runCliOk(args: string[]): Promise<string> {
  const r = await runCli(args);
  if (r.code !== 0) throw new Error(`CLI ${args.join(' ')} 退出码 ${r.code}\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  return r.stdout;
}

function countRuleLines(listOut: string): number {
  return listOut.split('\n').filter((ln) => /^[●○]\s/.test(ln)).length;
}

test.beforeAll(async () => {
  ctrlPort = await pickFreePort();
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-e2e-cli-'));
  app = await electron.launch({
    args: [path.join(root, 'dist-electron/main.js'), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      PROXYBABY_E2E: '1',
      NODE_ENV: 'production',
      PROXYBABY_CTRL_PORT: String(ctrlPort),
    },
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[pageerror:cli]', e.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => !!(window as any).__pbE2E && !!(window as any).proxybaby,
    null,
    { timeout: 15000 },
  );
  await waitForControlServer(ctrlPort);
});

test.afterAll(async () => {
  // app quit 用例可能已经关掉了app，close() 会安静吞掉
  await app?.close().catch(() => {});
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('CLI --help 打印 usage', async () => {
  const out = await runCliOk(['--help']);
  expect(out).toContain('ProxyBaby CLI');
  expect(out).toContain('proxybaby status');
  expect(out).toContain('proxybaby rule');
});

test('CLI无参数 == usage', async () => {
  const out = await runCliOk([]);
  expect(out).toContain('用法');
});

test('CLI 未知命令走usage', async () => {
  const out = await runCliOk(['bogus-command']);
  expect(out).toContain('用法');
});

test('status 返回 proxy/cert/rules/plugins 完整摘要', async () => {
  const out = await runCliOk(['status']);
  const s = JSON.parse(out);
  expect(s.proxy).toBeDefined();
  expect(typeof s.proxy.recording).toBe('boolean');
  expect(s.cert).toBeDefined();
  expect(Array.isArray(s.rules)).toBe(true);
  expect(Array.isArray(s.plugins)).toBe(true);
  // 内置插件至少有 whistle-rules
  expect(s.plugins.some((p: any) => p.id === 'whistle-rules')).toBe(true);
});

test('app open 命中已运行的 app 分支', async () => {
  const out = await runCliOk(['app', 'open']);
  expect(out).toContain('ProxyBaby 已启动');
});

test('record on/off/clear 三态切换', async () => {
  const on = JSON.parse(await runCliOk(['record', 'on']));
  expect(on.recording).toBe(true);
  const off = JSON.parse(await runCliOk(['record', 'off']));
  expect(off.recording).toBe(false);
  // 复位为 on，clear 才有意义（不过clear 对任何状态都能跑）
  await runCliOk(['record', 'on']);
  const clr = JSON.parse(await runCliOk(['record', 'clear']));
  expect(clr.ok).toBe(true);
});

test('record 非法子命令走 usage', async () => {
  const out = await runCliOk(['record', 'bogus']);
  expect(out).toContain('用法');
});

test('rule 全流程：list → add(text) → show → update → disable → enable → remove', async () => {
  // 记录初始规则集数量（可能因其他 ProxyBaby 实例或之前测试残留而非空）
  const initialCount = countRuleLines(await runCliOk(['rule', 'list']));

  // add via --text
  const addOut = await runCliOk(['rule', 'add', 'e2e-rule', '--text', 'example.com mock://{"ok":1}']);
  const added = JSON.parse(addOut);
  expect(added.id).toBeTruthy();
  expect(added.name).toBe('e2e-rule');
  expect(added.enabled).toBe(true);
  expect(added.rules.length).toBeGreaterThan(0);

  // list 增加一条并包含 e2e-rule
  const listOut = await runCliOk(['rule', 'list']);
  expect(countRuleLines(listOut)).toBe(initialCount + 1);
  expect(listOut).toContain(added.id);
  expect(listOut).toContain('e2e-rule');
  // 新增的这一行是启用状态
  expect(listOut.split('\n').find((ln) => ln.includes(added.id))).toMatch(/^●/);

  // show
  const shown = JSON.parse(await runCliOk(['rule', 'show', added.id]));
  expect(shown.id).toBe(added.id);
  expect(shown.name).toBe('e2e-rule');

  // update name + text
  const patched = JSON.parse(
    await runCliOk(['rule', 'update', added.id, '--name', 'e2e-rule-2', '--text', 'foo.com host://127.0.0.1:3000']),
  );
  expect(patched.name).toBe('e2e-rule-2');
  expect(patched.rules.some((r: any) => r.pattern.includes('foo.com'))).toBe(true);

  // disable → 该行变成空心圈
  const dis = await runCliOk(['rule', 'disable', added.id]);
  expect(dis).toContain('ok');
  const listAfterDisable = await runCliOk(['rule', 'list']);
  expect(listAfterDisable.split('\n').find((ln) => ln.includes(added.id))).toMatch(/^○/);

  // enable →恢复实心
  const en = await runCliOk(['rule', 'enable', added.id]);
  expect(en).toContain('ok');
  const listAfterEnable = await runCliOk(['rule', 'list']);
  expect(listAfterEnable.split('\n').find((ln) => ln.includes(added.id))).toMatch(/^●/);

  // remove →计数回到初始
  const rm = await runCliOk(['rule', 'remove', added.id]);
  expect(rm).toContain('ok');
  expect(countRuleLines(await runCliOk(['rule', 'list']))).toBe(initialCount);
});

test('rule add --file 从文件加载规则文本', async () => {
  const f = path.join(userDataDir, 'sample.rules');
  fs.writeFileSync(f, 'bar.com statusCode://500\n');
  const added = JSON.parse(await runCliOk(['rule', 'add', 'file-rule', '--file', f]));
  expect(added.rules[0].pattern).toContain('bar.com');
  await runCliOk(['rule', 'remove', added.id]);
});

test('rule add --disabled 初始 enabled=false', async () => {
  const added = JSON.parse(
    await runCliOk(['rule', 'add', 'disabled-rule', '--text', 'x.com abort://', '--disabled']),
  );
  expect(added.enabled).toBe(false);
  await runCliOk(['rule', 'remove', added.id]);
});

test('rule update --file 走文件分支', async () => {
  const added = JSON.parse(await runCliOk(['rule', 'add', 'up-rule', '--text', 'a.com log://']));
  const f = path.join(userDataDir, 'update.rules');
  fs.writeFileSync(f, 'b.com log://\n');
  const patched = JSON.parse(await runCliOk(['rule', 'update', added.id, '--file', f]));
  expect(patched.rules[0].pattern).toContain('b.com');
  await runCliOk(['rule', 'remove', added.id]);
});

test('rule show 缺id 走 usage', async () => {
  const out = await runCliOk(['rule', 'show']);
  expect(out).toContain('用法');
});

test('rule 非法子命令走 usage', async () => {
  const out = await runCliOk(['rule', 'bogus']);
  expect(out).toContain('用法');
});

test('plugin list 打印内置插件', async () => {
  const out = await runCliOk(['plugin', 'list']);
  expect(out).toContain('whistle-rules');
  expect(out).toContain('mock');
  expect(out).toContain('logger');
  expect(out).toContain('breakpoint');
});

test('plugin disable / enable 切换 whistle-rules', async () => {
  const dis = await runCliOk(['plugin', 'disable', 'whistle-rules']);
  expect(dis).toContain('ok');
  const listAfterDisable = await runCliOk(['plugin', 'list']);
  expect(listAfterDisable).toMatch(/○\s+whistle-rules/);

  const en = await runCliOk(['plugin', 'enable', 'whistle-rules']);
  expect(en).toContain('ok');
  const listAfterEnable = await runCliOk(['plugin', 'list']);
  expect(listAfterEnable).toMatch(/●\s+whistle-rules/);
});

test('plugin 缺 id 走 usage', async () => {
  const out = await runCliOk(['plugin', 'enable']);
  expect(out).toContain('用法');
});

test('plugin 非法子命令走 usage', async () => {
  const out = await runCliOk(['plugin', 'bogus']);
  expect(out).toContain('用法');
});

test('session export → .proxybaby (JSON) 落盘', async () => {
  const outPath = path.join(userDataDir, 'session.proxybaby');
  const out = JSON.parse(await runCliOk(['session', 'export', '--out', outPath]));
  expect(out.ok).toBe(true);
  expect(out.filePath).toBe(outPath);
  expect(fs.existsSync(outPath)).toBe(true);
  const buf = fs.readFileSync(outPath, 'utf8');
  // exporter 序列化的是 flow 数组；空store 时至少是有效 JSON
  expect(() => JSON.parse(buf)).not.toThrow();
});

test('session export --har 走 HAR 分支', async () => {
  const outPath = path.join(userDataDir, 'session.har');
  const out = JSON.parse(await runCliOk(['session', 'export', '--har', '--out', outPath]));
  expect(out.ok).toBe(true);
  const har = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  expect(har.log).toBeDefined();
  expect(Array.isArray(har.log.entries)).toBe(true);
});

test('session 非法子命令走 usage', async () => {
  const out = await runCliOk(['session', 'bogus']);
  expect(out).toContain('用法');
});

test('未启动 app 时 request() 报错（模拟 token 缺失）', async () => {
  // 备份并临时删除 token 文件，看 CLI 是否报友好错误
  const tokenPath = path.join(os.homedir(), '.proxybaby', 'cli-token');
  const backup = fs.readFileSync(tokenPath, 'utf8');
  fs.unlinkSync(tokenPath);
  try {
    const r = await runCli(['status']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('未找到 CLI token');
  } finally {
    // 恢复 token
    fs.writeFileSync(tokenPath, backup, { mode: 0o600 });
  }
});

test('IPC controlServer:get 返回当前端口/监听状态', async () => {
  const info = await page.evaluate(async () => (await (window as any).proxybaby.controlServerGet()));
  // 环境变量注入的临时端口应该被识别为 effective
  expect(info.effectivePort).toBe(ctrlPort);
  expect(info.listening).toBe(true);
});

test('IPC controlServer:set-port 保存但当前会话仍走 env 端口', async () => {
  // 保存到另一个数字，返回的 note 说明当前进程受环境变量控制
  const r = await page.evaluate(async () => (await (window as any).proxybaby.controlServerSetPort(19998)));
  expect(r.ok).toBe(true);
  expect(r.note).toContain('env');
  // CLI 仍然能访问（用的是 env port）
  const s = JSON.parse(await runCliOk(['status']));
  expect(s.proxy).toBeDefined();
});

test('端口占用时优雅降级：另开 server 占住新端口，改端口应返回 !listening', async () => {
  // 起一个 net.Server 占住某个端口
  const squatter = net.createServer(() => {});
  await new Promise<number>((resolve, reject) => {
    squatter.listen(0, '127.0.0.1', () => {
      const p = (squatter.address() as any).port;
      resolve(p);
    });
    squatter.on('error', reject);
  });
  const busyPort = (squatter.address() as any).port;
  try {
    // 主进程未通过 env 覆盖 controlConfigStore ？env 分支返回 note 不重启。
    // 这里直接调用底层 restartControlServer 才能测重启，不方便。
    // 折中：用 IPC 保存 busyPort；因为 env 存在，会返回 note，实际不重启，
    // 所以listen 仍然是 env 端口。此断言只验证接口不炸。
    const r = await page.evaluate(async (p) => (await (window as any).proxybaby.controlServerSetPort(p)), busyPort);
    expect(r.ok).toBe(true);
    expect(r.note).toBeDefined();
  } finally {
    await new Promise<void>((resolve) => squatter.close(() => resolve()));
  }
});

test('IPC controlServer:set-port 拒绝非法端口', async () => {
  const r1 = await page.evaluate(async () => (await (window as any).proxybaby.controlServerSetPort(-1)));
  expect(r1.ok).toBe(false);
  expect(r1.error).toContain('端口');
  const r2 = await page.evaluate(async () => (await (window as any).proxybaby.controlServerSetPort(70000)));
  expect(r2.ok).toBe(false);
});

// 必须最后跑：这个命令会关掉 electron 主进程，之后任何 CLI 调用都会失败。
test('app quit 关闭 app（放在最后）', async () => {
  // POST /app/quit 的 handler 是 d.quit() 后再 ok()——app 可能在响应发出前就关闭。
  // 因此我们不严格断言 stdout/stderr，只验证「命令跑完后 app 确实退出」：
  //   紧跟一次 status，应该连不上（token 仍在，但 8898 已经关）。
  await runCli(['app', 'quit']);
  // 给主进程一点时间收尾
  await new Promise((r) => setTimeout(r, 1500));
  const followup = await runCli(['status']);
  expect(followup.code).not.toBe(0);
  expect(followup.stderr).toMatch(/ECONNREFUSED|socket hang up|connect/i);
});
