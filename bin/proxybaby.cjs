#!/usr/bin/env node
/**
 * ProxyBaby 官方 CLI。
 *
 * 用法（详见 --help）：
 *   proxybaby status
 *   proxybaby app open|quit
 *   proxybaby proxy on|off
 *   proxybaby record on|off|clear
 *   proxybaby rule list
 *   proxybaby rule show <id>
 *   proxybaby rule add <name> [--file <path>] [--disabled]
 *   proxybaby rule update <id> [--name <n>] [--file <path>] [--enabled|--disabled]
 *   proxybaby rule remove <id>
 *   proxybaby rule enable|disable <id>
 *   proxybaby plugin list
 *   proxybaby plugin enable|disable <id>
 *
 * 与 app 通过 http://127.0.0.1:8898 通信，token 从 ~/.proxybaby/cli-token 读取。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const DEFAULT_CTRL_PORT = 8898;
const CTRL = {
  host: '127.0.0.1',
  // 允许通过 PROXYBABY_CTRL_PORT 覆盖，与 app 的设置保持一致；主要用于 e2e/多实例调试
  port: (() => {
    const env = Number(process.env.PROXYBABY_CTRL_PORT);
    return Number.isInteger(env) && env >= 1 && env <= 65535 ? env : DEFAULT_CTRL_PORT;
  })(),
};
const TOKEN_PATH = path.join(os.homedir(), '.proxybaby', 'cli-token');

function readToken() {
  try { return fs.readFileSync(TOKEN_PATH, 'utf8').trim(); } catch { return null; }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const token = readToken();
    if (!token) return reject(new Error('未找到 CLI token，请先启动 ProxyBaby app'));
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: CTRL.host,
        port: CTRL.port,
        path: urlPath,
        method,
        headers: {
          'x-proxybaby-token': token,
          'content-type': 'application/json',
          ...(data ? { 'content-length': data.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text)); } catch { resolve(text); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${text}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ensureRunning() {
  try {
    await request('GET', '/status');
    return true;
  } catch {
    return false;
  }
}

async function appOpen() {
  if (await ensureRunning()) {
    await request('POST', '/app/open');
    console.log('ProxyBaby 已启动，主窗口已显示');
    return;
  }
  // 尝试打开已安装的 .app（生产）或执行 electron .（开发）
  const bundle = '/Applications/ProxyBaby.app';
  if (fs.existsSync(bundle)) {
    spawn('open', ['-a', bundle], { detached: true, stdio: 'ignore' }).unref();
    console.log('已启动 ProxyBaby.app');
  } else {
    // 开发模式：cd 到项目根跑 electron
    const projectRoot = path.resolve(__dirname, '..');
    spawn('npm', ['run', 'start'], { cwd: projectRoot, detached: true, stdio: 'ignore' }).unref();
    console.log('已在开发模式启动 (npm run start)');
  }
}

function usage() {
  console.log(`ProxyBaby CLI —— AI-friendly HTTP(S) 抓包控制

用法:
  proxybaby status                                  # 打印 app / 代理 / 规则 / 插件全量摘要（JSON）
  proxybaby app open|quit                           # 启动或退出 app
  proxybaby proxy on|off                            # 打开/关闭系统代理
  proxybaby record on|off|clear                     # 记录开关 / 清空列表
  proxybaby session export [--har] [--out <path>]   # 导出会话为 .proxybaby 或 HAR
  proxybaby rule list                               # 列出所有规则集
  proxybaby rule show <id>                          # 查看某规则集详情
  proxybaby rule add <name> [--file <path>] [--text <inline>] [--disabled]
  proxybaby rule update <id> [--name <n>] [--file <path>] [--text <inline>] [--enabled|--disabled]
  proxybaby rule remove <id>
  proxybaby rule enable|disable <id>
  proxybaby plugin list                             # 列出所有插件
  proxybaby plugin enable|disable <id>

规则语法（whistle 兼容）:
  <pattern> <op1>[://value] [op2 ...]
  例：api.example.com/user  mock://{"id":1}
     *.internal.com/*      host://127.0.0.1:3000  reqHeaders://{"X-Env":"dev"}
     api.foo.com/pay       statusCode://500       resDelay://2000

常用 op: statusCode / redirect / abort / reqHeaders / resHeaders / reqBody / resBody
        host / file / mock / reqDelay / resDelay / log / ua / referer / script

AI Skill:
  让 AI agent 自主管理抓包见 skills/proxybaby/SKILL.md
`);
}

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) { flags[k] = true; }
      else { flags[k] = next; i++; }
    } else rest.push(a);
  }
  return { flags, rest };
}

async function main() {
  const [, , ...argv] = process.argv;
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') return usage();

  const cmd = argv[0];
  const sub = argv[1];
  const { flags, rest } = parseFlags(argv.slice(2));

  try {
    switch (cmd) {
      case 'status': {
        const s = await request('GET', '/status');
        console.log(JSON.stringify(s, null, 2));
        return;
      }
      case 'app': {
        if (sub === 'open') return appOpen();
        if (sub === 'quit') return console.log(await request('POST', '/app/quit'));
        return usage();
      }
      case 'proxy': {
        if (sub === 'on' || sub === 'off') {
          const s = await request('POST', `/proxy/${sub}`);
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        return usage();
      }
      case 'record': {
        if (['on', 'off', 'clear'].includes(sub)) {
          const s = await request('POST', `/record/${sub}`);
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        return usage();
      }
      case 'session': {
        if (sub === 'export') {
          const format = flags.har ? 'har' : 'proxybaby';
          const filePath = flags.out ? String(flags.out) : undefined;
          const s = await request('POST', '/session/export', { format, filePath });
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        return usage();
      }
      case 'rule': {
        if (sub === 'list') {
          const s = await request('GET', '/rules');
          for (const r of s) console.log(`${r.enabled ? '●' : '○'} ${r.id}  ${r.name}  (${r.rules.length} 条)`);
          return;
        }
        if (sub === 'show') {
          const id = rest[0];
          if (!id) return usage();
          console.log(JSON.stringify(await request('GET', `/rules/${encodeURIComponent(id)}`), null, 2));
          return;
        }
        if (sub === 'add') {
          const name = rest[0];
          if (!name) return usage();
          const text = flags.file ? fs.readFileSync(flags.file, 'utf8')
                    : flags.text ? String(flags.text)
                    : '';
          const enabled = flags.disabled ? false : true;
          const r = await request('POST', '/rules', { name, text, enabled });
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (sub === 'update') {
          const id = rest[0];
          if (!id) return usage();
          const patch = {};
          if (flags.name) patch.name = String(flags.name);
          if (flags.file) patch.text = fs.readFileSync(flags.file, 'utf8');
          if (flags.text) patch.text = String(flags.text);
          if (flags.enabled) patch.enabled = true;
          if (flags.disabled) patch.enabled = false;
          const r = await request('PUT', `/rules/${encodeURIComponent(id)}`, patch);
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (sub === 'remove') {
          const id = rest[0];
          if (!id) return usage();
          console.log(await request('DELETE', `/rules/${encodeURIComponent(id)}`));
          return;
        }
        if (sub === 'enable' || sub === 'disable') {
          const id = rest[0];
          if (!id) return usage();
          console.log(await request('POST', `/rules/${encodeURIComponent(id)}/${sub}`));
          return;
        }
        return usage();
      }
      case 'plugin': {
        if (sub === 'list') {
          const s = await request('GET', '/plugins');
          for (const p of s) console.log(`${p.enabled ? '●' : '○'} ${p.id}  ${p.name}`);
          return;
        }
        if (sub === 'enable' || sub === 'disable') {
          const id = rest[0];
          if (!id) return usage();
          console.log(await request('POST', `/plugins/${encodeURIComponent(id)}/${sub}`));
          return;
        }
        return usage();
      }
      default:
        return usage();
    }
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}

main();
