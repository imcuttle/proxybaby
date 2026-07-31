<div align="center">

<img src="assets/icon-rounded.png" alt="ProxyBaby" width="200" height="200" />

# 🍼 ProxyBaby

**macOS / Windows / Linux 上免费开源的 HTTP(S) 抓包调试工具，内置 AI / SSE 消息美化。**

零配置、开箱即用、**全功能免费**。功能对标 Proxyman PRO / Charles / Fiddler / whistle，额外内置业界独家的 **AI 对话可视化**（OpenAI / Anthropic / ACP）。

[![Release](https://img.shields.io/github/v/release/imcuttle/proxybaby?color=%23ff6b9d&label=Download&logo=github&style=for-the-badge)](https://github.com/imcuttle/proxybaby/releases/latest)
[![License](https://img.shields.io/github/license/imcuttle/proxybaby?style=for-the-badge)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/imcuttle/proxybaby?style=for-the-badge)](https://github.com/imcuttle/proxybaby/stargazers)

### 📥 [下载最新版](https://github.com/imcuttle/proxybaby/releases/latest) · [中文](./README.md) · [English](./README.en.md)

<sub>macOS `.dmg` / `.zip`  ·  Windows `.exe` / `.zip`  ·  Linux `.AppImage` / `.deb`</sub>

<br/>

![main](docs/screenshots/01-main.png)

</div>

---

## 目录

[为什么用它](#-为什么用它) · [截图](#-截图) · [和主流抓包工具的完整对比](#-和主流抓包工具的完整对比) · [完整功能清单](#-完整功能清单) · [面向-AI-的完整-CLI--Skill](#-面向-ai-的完整-cli--skill) · [快速开始](#快速开始) · [测试覆盖](#测试覆盖) · [架构](#架构) · [开发](#开发)

---

## 🎯 为什么用它

- **🤖 AI-friendly, first-class** — 唯一为 AI agent 时代设计的抓包器
  - AI 会话（OpenAI / Anthropic / ACP）原生美化，不用再对着一堆 SSE 帧眯眼
  - 完整 CLI（`proxybaby`）覆盖 app **全部**能力：状态 / 代理 / 记录 / 规则 CRUD / 插件 / 会话导出
  - 内嵌 AI 侧边栏：直接在 app 里跑 `codebuddy --acp` agent，让 AI 看着流量改代码
  - 配套 [SKILL.md](skills/proxybaby/SKILL.md)：Claude Code / codebuddy / Cursor 等 agent 可复制即用
- **免费开源** — 全功能免费；不像 Proxyman 把断点/映射/脚本锁在付费墙后，也不像 Charles 只给 30 天试用
- **whistle 生态** — 100% 兼容 whistle 规则语法，能把 whistle 用户平滑迁到 GUI 上
- **原生 macOS** — 不是 Java Swing，不是 Electron 里塞浏览器；Tray、独立窗口、拖拽等 macOS 原生交互

---

## 📸 截图

<table>
<tr>
<td width="50%">
<b>抓包列表 + JSON Tree（主界面）</b><br/>
<img src="docs/screenshots/01-main.png" />
</td>
<td width="50%">
<b>AI 会话美化（OpenAI）</b><br/>
<img src="docs/screenshots/02-ai-openai.png" />
</td>
</tr>
<tr>
<td width="50%">
<b>AI 会话美化（Anthropic + tool_use）</b><br/>
<img src="docs/screenshots/03-ai-anthropic.png" />
</td>
<td width="50%">
<b>WebSocket 双向消息</b><br/>
<img src="docs/screenshots/04-websocket.png" />
</td>
</tr>
<tr>
<td colspan="2">
<b>whistle 规则编辑器</b><br/>
<img src="docs/screenshots/05-rules.png" />
</td>
</tr>
</table>

> 以上截图由 `tests/e2e/screenshots.e2e.ts` 自动生成，跑 `npx playwright test tests/e2e/screenshots.e2e.ts` 可复现。

---

## 🥊 和主流抓包工具的完整对比

图例：✅ 支持 · ⚠️ 部分支持 / 付费 · ❌ 无

| 功能 | **ProxyBaby** | Proxyman | Charles | Fiddler Classic | mitmproxy | whistle |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 价格 / License | 🆓 MIT 免费 | 💰 PRO 付费 | 💰 30 天试用 | 🆓 (Win) | 🆓 开源 | 🆓 开源 |
| 平台 | macOS | mac / Win / Linux | 全平台 | Windows | 全平台 (CLI) | 全平台 (Web) |
| UI 类型 | 原生 Electron | 原生 | Java Swing | .NET WinForms | 终端 / Web | 浏览器 |
| 零配置装 CA / MITM | ✅ 自动装信任 | ✅ | ⚠️ 手动 | ⚠️ | ⚠️ CLI | ⚠️ |
| 系统代理自动开关 | ✅ 启动即开、退出还原 | ✅ | ✅ | ⚠️ | ❌ | ❌ |
| 按进程识别应用 | ✅ `lsof` 反查 | ✅ | ❌ | ⚠️ | ❌ | ❌ |
| 域名 / 应用侧栏分组 | ✅ | ✅ | ⚠️ 树状 | ⚠️ | ❌ | ⚠️ |
| 实时流式列表 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SSE 帧实时逐条渲染 | ✅ 打字机效果 | ⚠️ 只显示原始 | ⚠️ | ⚠️ | ✅ 文本 | ⚠️ |
| **AI 会话美化 (OpenAI)** | ✅ 独家 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **AI 会话美化 (Anthropic tool_use / thinking)** | ✅ 独家 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **ACP (Agent Client Protocol)** | ✅ 独家 | ❌ | ❌ | ❌ | ❌ | ❌ |
| WebSocket 收发帧 | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| HTTP/2 | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| gzip / brotli / deflate 自动解压 | ✅ 全部 | ✅ | ✅ | ✅ | ✅ | ✅ |
| JSON Tree 视图 | ✅ 可折叠 + 局部复制 | ✅ | ✅ | ⚠️ | ❌ | ⚠️ |
| Hex / Form / Multipart / GraphQL 视图 | ✅ 全 | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| 图片 / 媒体预览 | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ |
| 响应改写（headers / body / status） | ✅ | 💰 PRO | ✅ | ✅ | ✅ | ✅ |
| Map Local / File Replace | ✅ `file://` 操作符 | 💰 PRO | ✅ | ✅ | ✅ 脚本 | ✅ |
| Mock / 短路响应 | ✅ `mock://` | 💰 PRO | ✅ | ✅ | ✅ | ✅ |
| Breakpoint（暂停编辑） | ✅ | 💰 PRO | ✅ | ✅ | ✅ | ⚠️ |
| whistle 规则语法 | ✅ 100% 兼容 | ❌ | ❌ | ❌ | ❌ | ✅ 原生 |
| 多规则集切换 | ✅ 磁盘持久化 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ |
| 脚本 / Script Hook（JS） | ✅ `script://` | 💰 PRO | ⚠️ | ✅ | ✅ Python | ✅ |
| 上游代理 / Upstream | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 网络限速 3G/4G/Offline | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Allow / Block list | ✅ host/glob/regex | 💰 PRO | ✅ | ✅ | ✅ | ✅ |
| SSL 白名单精细控制 | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| 高级过滤器（多条件 AND + 预设） | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Pin / Save 单条请求 | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| Diff / 对比两条请求 | ✅ 右键菜单 | 💰 PRO | ❌ | ⚠️ | ❌ | ❌ |
| 代码生成（cURL/fetch/Python/Go/Java…） | ✅ 10+ 语言 | ✅ | ⚠️ 只 cURL | ⚠️ | ❌ | ❌ |
| Composer / 手动发请求 | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| 自定义预览 Tab | ✅ 用户可扩展 | ❌ | ❌ | ✅ 插件 | ❌ | ❌ |
| HAR 导入 / 导出 | ✅ 标准 HAR | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| 原生会话格式 | ✅ `.proxybaby` | ✅ `.proxymanlogs` | ✅ `.chls` | ✅ `.saz` | ✅ flow | ❌ |
| **CLI 覆盖全部能力** | ✅ `proxybaby` | ⚠️ | ❌ | ⚠️ | ✅ CLI 本身 | ✅ |
| **AI Agent 可自主操作** | ✅ SKILL.md | ❌ | ❌ | ❌ | ⚠️ | ❌ |
| Menu-bar Tray | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 独立窗体（不用 modal） | ✅ 设置/编辑器/Diff | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| 单测 + e2e 覆盖 | ✅ 20+ 单元 · 5 集成 · 50+ e2e | 🚫 闭源 | 🚫 | 🚫 | ✅ 开源 | ✅ 开源 |

---

## 📋 完整功能清单

<details>
<summary>点开查看完整列表</summary>

**抓包与解密**：零配置根 CA 自动装信任 · 动态叶子证书（SNI + LRU） · HTTPS/HTTP2 MITM · WebSocket 抓帧（RFC6455）· SSE 增量帧解析 · gzip/br/deflate 异步解压 · 系统代理自动开关（退出还原、被抢占时告警） · `lsof` 按进程识别应用名 · 上游代理 · 3G/4G/offline 网络限速 · Allow/Block/SSL 白名单

**UI**：三栏布局 + 虚拟滚动几万条不卡 · 侧栏按 App/Host+subpath 树状分组 · Pin/Save 独立视图 · 高级过滤器（多条件 AND + 预设） · 详情面板 JSON Tree/Hex/Form/Multipart/GraphQL/Image 多格式 · Monaco 编辑器 · 大文本懒渲染 · 复制 cURL

**AI 会话美化**（核心差异）：OpenAI `chat/completions` · Anthropic `v1/messages`（`tool_use`/`thinking`） · ACP · 角色分色气泡 · 工具调用可视化 · 打字机式流式渲染 · 内嵌 AI 侧边栏（跑 `codebuddy --acp`）

**规则改写**：洋葱式中间件（`respond` 短路 / `abort` 中断） · 100% whistle 兼容 · 18+ 操作符：`statusCode` `redirect` `abort` `reqHeaders` `resHeaders` `reqBody` `resBody` `host` `file` `mock` `reqDelay` `resDelay` `log` `ua` `referer` `script` `breakpoint` · 多规则集 · 插件系统（whistle-rules / mock / logger / breakpoint / allow-block / ssl-list / scripts）

**断点**：请求/响应双阶段暂停编辑 · 断点条件匹配

**生产力**：Composer 手动发请求 · 代码生成 10+ 语言 · Diff 对比 · 自定义预览 Tab · HAR 与 `.proxybaby` 会话导入导出 · 独立窗体（不用 modal）

**集成**：CLI 覆盖 app 全部能力 · AI Skill · 本地控制通道（`127.0.0.1:8898`） · Menu-bar Tray

**平台**：macOS（universal）· Windows/Linux 在 Roadmap

</details>

---

## 🤖 AI Skill —— 让 AI 直接开抓包

这是 **ProxyBaby 与其他抓包工具最大的区别**。别的工具你要点几十下鼠标：开抓包 → 找规则页 → 新建规则集 → 输入模式 → 输入操作符 → 保存 → 启用。ProxyBaby 你只要**对 AI 说一句人话**：

> "帮我 mock 掉 `api.example.com/user`，让它返回 `{id:1, name:'Alice'}`"

AI 就会自动跑：`proxybaby rule add mock-user --text 'api.example.com/user mock://{"id":1,"name":"Alice"}'`

### 🚀 一句话装好 Skill（复制给你的 AI 就行）

```
请帮我安装 ProxyBaby 的 AI Skill：
1. 从 https://raw.githubusercontent.com/imcuttle/proxybaby/main/skills/proxybaby/SKILL.md 拉取
2. 存到本地：
   - codebuddy → ~/.codebuddy/skills/proxybaby/SKILL.md
   - Claude Code → ~/.claude/skills/proxybaby/SKILL.md
   - Cursor → 当前项目的 .cursor/rules/proxybaby.mdc
3. 跑 `proxybaby status` 验证连接
4. 完成后告诉我可以直接说"帮我 mock xxx"了
```

装完就能用，不需要任何 API key、不需要额外配置。

### 💡 能解决什么真实问题？

不是玩具 demo，是每天写代码会遇到的场景：

#### 场景 1：后端接口还没好，前端要开工
> **你说**：后端说 `/api/orders/list` 明天才出，先给我 mock 20 条订单，字段有 id/user/amount/status
>
> **AI 做**：
> ```bash
> proxybaby rule add mock-orders --text '/api/orders/list mock://{"data":[{"id":1,"user":"A","amount":100,"status":"paid"},...20条]}'
> ```
> 前端刷新页面直接看到列表。

#### 场景 2：复现线上 500 bug
> **你说**：QA 反馈支付偶尔 500，我要在本地稳定复现
>
> **AI 做**：
> ```bash
> proxybaby rule add repro-pay-500 --text 'api.mycompany.com/pay statusCode://500 resDelay://2000 resBody://{"error":"timeout"}'
> ```
> 每次调支付都稳定超时 + 500，跟着复现 UI 错误处理。

#### 场景 3：调试第三方 SDK 到底发了啥
> **你说**：帮我看看 Stripe SDK 具体调用了什么接口，参数是什么
>
> **AI 做**：
> ```bash
> proxybaby record clear && proxybaby record on
> # → 你在 app 里点几下购买
> proxybaby session export --har --out /tmp/stripe.har
> ```
> AI 读 HAR，直接告诉你："SDK 调了 3 个接口：`/v1/payment_intents` (POST amount=1999), `/v1/customers` (GET)..."

#### 场景 4：验证前端在鉴权失效时的行为
> **你说**：模拟登录态过期，看看前端会不会正确跳登录页
>
> **AI 做**：
> ```bash
> proxybaby rule add expired-auth --text 'api.mycompany.com/* statusCode://401 resBody://{"code":"TOKEN_EXPIRED"}'
> ```
> 所有接口秒变 401，验证跳转逻辑。改回来：`proxybaby rule disable expired-auth`

#### 场景 5：把生产域名劫持到本地开发服务
> **你说**：让 `api.mycompany.com` 指向我本地的 `localhost:3000`，但请求原样透传
>
> **AI 做**：
> ```bash
> proxybaby rule add local-dev --text 'api.mycompany.com host://127.0.0.1:3000'
> ```
> 生产 App 一行代码不改，流量全打到本地。

#### 场景 6：调试你自己的 AI 应用
> **你说**：我在写一个 Claude 集成，帮我看看请求体到底发对了没
>
> **AI 做**：
> ```bash
> proxybaby app open
> proxybaby record on
> ```
> 你运行 AI 应用 → **UI 里直接看到 Anthropic 请求被渲染成完整对话气泡**（含 tool_use / thinking 块），不用手动 parse SSE。

#### 场景 7：慢网络下的 UX 测试
> **你说**：模拟 3G 网络看看首屏
>
> **AI 做**：调 `proxybaby` CLI 打开 3G 限速 + 加规则给静态资源加 500ms 延迟。

#### 场景 8：一键清场
> **你说**：不 mock 了，恢复正常
>
> **AI 做**：`proxybaby record clear && proxybaby rule list | ...` 批量 disable 所有 mock 规则。

### 为什么这个组合特别强

- **CLI 覆盖 100% 能力** — UI 能做的，CLI 都能做；不像 Charles/Proxyman 只有部分脚本 API
- **一切都是 shell 命令** — agent 只需要 Bash 权限，不需要装任何 SDK、不吃 token
- **SKILL.md 讲清了每个操作符怎么用** — AI 不用瞎猜、不用读源码
- **本地闭环** — 通过 `127.0.0.1:8898` 通信，全程不出你机器
- **和 UI 双向** — AI 加的规则你能在 UI 看到并微调；UI 里改的 AI 也能读

### CLI 全集

`proxybaby` CLI 覆盖 app **全部**运行时能力：

```bash
# App 生命周期
proxybaby app open                     # 启动 app（已运行则前置）
proxybaby app quit                     # 退出 app
proxybaby status                       # 全量状态摘要 JSON（代理/证书/规则/插件）

# 系统代理
proxybaby proxy on                     # 打开系统代理
proxybaby proxy off                    # 关闭

# 抓包记录
proxybaby record on                    # 开始记录
proxybaby record off                   # 暂停记录
proxybaby record clear                 # 清空所有已抓 flow

# 会话导出
proxybaby session export               # 导出为 .proxybaby（默认 ~/proxybaby-session.proxybaby）
proxybaby session export --har         # 导出为标准 HAR
proxybaby session export --har --out /tmp/x.har

# 规则集（whistle 兼容语法）
proxybaby rule list                    # 列出所有规则集：● 启用 / ○ 停用
proxybaby rule show <id>               # 查看某规则集内容
proxybaby rule add <name> --file rules.txt
proxybaby rule add <name> --text 'api.example.com mock://{"ok":true}'
proxybaby rule add <name> --file rules.txt --disabled
proxybaby rule update <id> --name <n> --file <p>
proxybaby rule update <id> --enabled | --disabled
proxybaby rule remove <id>
proxybaby rule enable <id>
proxybaby rule disable <id>

# 插件
proxybaby plugin list                  # whistle-rules / mock / logger / breakpoint / allow-block / ssl-list / scripts
proxybaby plugin enable <id>
proxybaby plugin disable <id>
```

跑 `proxybaby --help` 看全量帮助。

### 底层协议

- CLI ↔ app 走 **loopback HTTP** `127.0.0.1:8898`
- Bearer token 由 app 首次启动生成，写入 `~/.proxybaby/cli-token`（`chmod 0600`）
- 每个请求带 `X-ProxyBaby-Token` header，只监听 loopback，最小暴露
- 端点见 `electron/control/control-server.ts`，都是简单 REST — 你也可以直接 `curl`

### SKILL.md 里都写了什么

`skills/proxybaby/SKILL.md` 是给 AI agent 的操作手册，包含：

- **前置条件**：app 至少启动一次生成 token
- **命令速查**：每条命令的用法 + 例子
- **规则语法**：whistle 兼容子集 + 18+ 操作符
- **8 个常见任务的完整命令示例**
- **输出格式**：哪些命令返回 JSON，能被 `jq` 继续处理
- **边界与安全**：token 保护、macOS 依赖、首次装 CA 需要密码

---

## 快速开始

需要 macOS。**装完 app 就即用，无需额外操作**：

- **下载 DMG**（推荐）：到 [Releases](https://github.com/imcuttle/proxybaby/releases) 下载最新 `.dmg`，拖进 `/Applications`，双击打开
- 首次启动会：
  1. 弹一次管理员密码，把根 CA 装进系统钥匙串（之后启动无提示）
  2. 自动把 `proxybaby` CLI 装到 `/usr/local/bin/`（用户可写就静默完成；如果不可写会在设置里显示"用管理员权限安装 CLI"按钮）
- 之后你在任意终端里都能：`proxybaby status` / `proxybaby rule add ...`
- 想让 AI 也会用？把 [README 上面那段 prompt](#-面向-ai-的完整-cli--skill) 丢给你的 agent，它会自动从 GitHub 拉 `skills/proxybaby/SKILL.md` 到本地

从源码开发：

```bash
git clone https://github.com/imcuttle/proxybaby.git
cd proxybaby
npm install
npm run dev             # dev（vite + electron，热重载）
# 或直接打包安装到 /Applications：
npm run install:mac
```

首次运行会弹一次系统管理员密码框，把根 CA 加入系统钥匙串并置为受信任。之后启动无需再确认。

---

## 测试覆盖

三层测试，全部用正式框架（Vitest + Playwright）：

### Unit — `tests/unit/`

| File | Covers |
|------|--------|
| `sse-parser.test.ts` | 增量 SSE 帧解析（跨 chunk / 空行分隔 / event & id 字段） |
| `ws-parser.test.ts`  | WebSocket 帧（RFC6455 mask / 分片 / 控制帧） |
| `parsers.test.ts`    | OpenAI / Anthropic / ACP → 统一 `ChatSession` + `detectProvider` |
| `ai-md-slate.test.ts` | AI 消息 Markdown ↔ Slate.js 双向序列化 |
| `ai-acp-client.test.ts` | ACP 客户端（disable-spawn 握手/消息路由） |
| `ai-manager.test.ts` | AI 侧边栏会话索引 CRUD |
| `rule-parser.test.ts` | whistle 规则 tokenizer（含空格 JSON/引号值） |
| `operators.test.ts`   | 18+ 操作符 middleware：statusCode / redirect / reqHeaders / resHeaders / body / mock / delay / log / ua / referer |
| `body-detect.test.ts` | 正文类型识别 + form-urlencoded / multipart / GraphQL / hexdump |
| `filter.test.ts` + `filter-entry.test.ts` | 主过滤器 + entry 匹配（host / app / glob / regex） |
| `code-gen.test.ts`    | cURL / fetch / axios / Python / Go / Node / Java 代码生成 |
| `session-io.test.ts`  | `.proxybaby` + HAR 导出/导入 |
| `diff.test.ts`        | 行级 diff 算法 |
| `network-conditions.test.ts` | 3G / 4G / offline 限速模拟 |
| `ssl-list.test.ts`    | SSL 解密白名单/黑名单 |

### Integration — `tests/integration/`（起真实端口）

- `proxy.test.ts` — 起真实 target server + `ProxyServer`，跑 HTTP/HTTPS MITM、SSE 流式、WS 抓帧
- `content-types.test.ts` — 各种 content-type / 编码（gzip / br / deflate / chunked / JSON / form / multipart / 图片）
- `whistle-rules.test.ts` — 规则 CRUD 持久化 + 经代理端到端生效
- `allow-block.test.ts` — allow / block list 插件
- `scripts.test.ts` — `script://` 操作符

### E2E — `tests/e2e/`（Playwright + Electron）

`_electron.launch` 起打包后的 app，`PROXYBABY_E2E=1` 打开 `__pbE2E.emit` 注入通道，向真实 UI 灌合成 flow 后断言 UI 行为。

- `app.e2e.ts`（40+ case）：主界面 / 注入普通请求 / SSE Tab / WebSocket 双向 / OpenAI 流式 → chat 气泡 / 侧栏分组 / 规则页 CRUD / 插件开关 / 状态栏 / JSON Tree Raw / cURL 复制 / 监听地址 popover / 抓包↔规则来回切换 / 文本 类型 应用 subpath pin save 过滤 / 正文 Form Hex Image / 代码生成多语言 / 高级过滤器预设 / Allow Block SSL 配置窗口 / 脚本编辑窗口 / 网络条件切换 / 上游代理 / Composer / 多选 Diff / 自定义预览 Tab / 系统代理被覆盖告警
- `ai-chat.e2e.ts`：AI 侧边栏可见性 / 新建 切换 删除会话 / mention chip 渲染 / 多段 text-delta 流式累加 / 图片渲染 / 附件流 / 会话溢出下拉 / 左侧栏收起
- `screenshots.e2e.ts`：README 用的宣传截图自动生成

跑测试：

```bash
npm test                  # unit + integration
npm run test:unit
npm run test:integration
npm run test:e2e          # 自动 vite build 后启 Playwright
npm run test:all
```

单条：

```bash
npx vitest run tests/unit/parsers.test.ts -t 'OpenAI 解析'
npx playwright test tests/e2e --grep '文本搜索'
```

---

## 架构

主进程 (`electron/`) 抓包 + 系统集成；渲染进程 (`src/`) 展示 UI；通过 preload 桥 `window.proxybaby` + 事件推送通信；共享类型放在 `shared/types.ts`。

```
proxybaby/
├─ electron/                # main process
│  ├─ main.ts               # 入口, 生命周期, tray
│  ├─ preload.ts            # 上下文桥 (built to preload.cjs)
│  ├─ proxy/                # 代理引擎 + SSE / WS 解析
│  ├─ engine/               # 规则/操作符/中间件/插件/断点
│  ├─ mitm/                 # 根 CA + 叶子证书 + 信任安装
│  ├─ system/               # 系统代理 + lsof 进程识别
│  ├─ store/                # 内存 flow store + 会话 IO
│  └─ control/              # 本地控制 HTTP server (CLI + AI skill)
├─ src/                     # renderer
│  ├─ App.tsx
│  ├─ components/           # UI + tabs (Headers/Body/SSE/WS/Chat)
│  ├─ parsers/              # OpenAI / Anthropic / ACP 适配器 (纯函数、幂等)
│  └─ store/                # zustand
├─ shared/                  # 主/渲染共享类型
├─ skills/proxybaby/        # AI skill 定义
├─ bin/proxybaby.cjs        # CLI
└─ tests/                   # unit / integration / e2e
```

**一次抓包的数据流**：`onRequest` 建 Flow → `flow:start` → 读请求体 → 洋葱中间件（规则/断点/mock）→ `forwardUpstream` → `flow:response-headers` → 非 SSE 缓冲+异步解压 / SSE 逐帧 `flow:sse-frame` → `flow:response-body` + `flow:end`；每步都写 FlowStore 并 broadcast 给渲染层。

---

## 开发

```bash
npm install
npm run dev              # vite + electron (HMR)
npm run typecheck        # tsc --noEmit (改动后必须过)
npm run build            # dmg + zip
npm run build:dir        # 只出解包 .app（更快）
npm run install:mac      # build:dir → 覆盖安装到 /Applications
```

### 关键约束

- 主进程 IO 一律异步（禁 `*Sync`），否则会阻塞代理和 UI
- preload 是 CommonJS（sandboxed preload 不支持 ESM），被单独打成 `preload.cjs`
- IPC 载荷必须可结构化克隆（不能含函数或 RegExp）
- 响应体 `bodyBuffer` 保留原始字节（可能是压缩后的）用于回传下游；`bodyText` 仅供展示解压
- e2e 环境变量 `PROXYBABY_E2E=1` 会跳过证书安装/系统代理并开放 `__pbE2E.emit` 注入通道

详见 [`CODEBUDDY.md`](./CODEBUDDY.md)。

---

## 发版流程 / Release

用 [changesets](https://github.com/changesets/changesets) + GitHub Actions。
**只有你在本地明确执行 `npm run release` 才会真的发布**，光 push 到 main 不会自动发。

```bash
# 1. 写这次改动的 changeset（会问你 major / minor / patch，写 changelog 描述）
npx changeset

# 2. 提交 changeset 文件到 main
git add .changeset && git commit -m "docs: changeset for xxx" && git push

# 3. 想发版时（可以攒好几个 changeset 一起发）
npm run release
#    ↑ 本地做：apply changesets → bump package.json → 更新 CHANGELOG.md
#              → commit → push main → tag vX.Y.Z → push tag
#    tag 一到 GitHub，Actions 会自动打包 dmg/zip 并创建 GitHub Release
```

CI 上有两个 workflow：

- `.github/workflows/ci.yml` — 每次 push/PR 跑 typecheck + unit + integration 测试
- `.github/workflows/release.yml` — 收到 `v*` tag 或 `workflow_dispatch` 才跑；在 `macos-latest` 上打 unsigned DMG/zip 并 `gh release create`

---

## Roadmap

- Windows / Linux
- iOS / Android 设备证书安装向导
- WebSocket 消息深度美化（协议自动识别、Protobuf 反序列化）
- 更多 AI 协议适配（Google Gemini、Cohere、Mistral、OpenRouter…）
- 云同步规则集

---

## License

MIT © [imcuttle](https://github.com/imcuttle)

如果 ProxyBaby 帮到你，欢迎 ⭐ Star — 对开源项目真的很有帮助。
