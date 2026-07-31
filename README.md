<div align="center">

# 🍼 ProxyBaby

**macOS 上免费开源的 HTTP(S) 抓包调试工具，内置 AI / SSE 消息美化。**

零配置、开箱即用、**全功能免费**。功能对标 Proxyman PRO / Charles / Fiddler / whistle，额外内置业界独家的 **AI 对话可视化**（OpenAI / Anthropic / ACP）。

**Read in English → [README.en.md](./README.en.md)**

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

### 抓包与解密
- 自动生成根 CA (node-forge)、静默装入系统钥匙串并置为受信任
- 动态签发叶子证书（按 SNI），带 LRU 缓存
- 全 HTTPS MITM 解密（含 HTTP/2 over TLS）
- `CONNECT` 隧道 + 内嵌 TLS server
- `Upgrade` 升级到 WebSocket，抓取原始帧
- SSE (`text/event-stream`) 增量帧解析（跨 chunk / 空行分隔 / event & id 字段）
- WebSocket 帧解析（RFC6455：mask / 分片 / 控制帧）
- gzip / brotli / deflate / chunked 自动解压（异步、不阻塞 event loop）
- 系统代理自动开关（`networksetup`），退出还原
- 外部把系统代理"抢走"时状态栏告警并一键切回
- 按发起进程识别应用名（`lsof` 反查端口 → PID → app，带缓存）
- 上游代理（Upstream proxy）配置
- 网络条件模拟：3G / 4G / DSL / offline
- Allow / Block 列表（host / glob / regex，可按 App 维度）
- SSL 白名单（哪些域名走 MITM，哪些直通）

### 展示
- 三栏布局：侧栏（收藏夹/应用/域名+subpath）+ 请求列表 + 详情面板
- TanStack Virtual 虚拟滚动，几万条也不卡
- 列表状态：`pending` / `streaming` / `completed` / `error`，颜色标识
- 侧栏树状：按 App 分组、按 Host 分组（同 Host 展开可看 subpath）
- Pin（置顶）+ Save（收藏），提供独立过滤视图
- 高级过滤器：多条件 AND、保存/加载预设
- 文本搜索、类型过滤条（HTTP/HTTPS/JSON/XML/JS/CSS/GraphQL/文档/媒体/WebSocket…）
- 详情面板 Tabs：
  - Request: 头部 / 查询 / 正文 / 授权 / 原始 / 摘要 / 代码
  - Response: 头部 / 正文 / Set-Cookie / 原始 / SSE / OpenAI / Anthropic / ACP …
- 正文视图：JSON Tree（可折叠、局部复制） / JSON Raw / Text / Hex / Form / Multipart / GraphQL / 图片 / 二进制下载
- 大文本 LazyText 懒渲染
- Monaco 编辑器渲染 headers/body（语法高亮）
- 复制 cURL / 复制正文 / 下载正文
- 状态栏：证书状态、监听地址 + 系统代理开关、请求数、选中行统计、总流量速率

### AI 会话美化（核心差异化）
- **OpenAI** `/v1/chat/completions`：流式 delta 合并回 `messages`，支持 tool call / function call
- **Anthropic** `/v1/messages`：`content_block_start` / `content_block_delta` 流式，支持 `text` / `tool_use` / `thinking` 块
- **ACP (Agent Client Protocol)**：over WebSocket / SSE，兼容 codebuddy / cursor 等 agent
- 角色分色气泡（system / user / assistant / tool）
- 工具调用可视化（参数增量拼接、结果单独气泡）
- Markdown / 代码块 / 图片渲染
- 打字机式流式渲染（新帧到达 → 就地追加，不整体重渲染）
- 内嵌 AI 侧边栏：直接在抓包窗口内跑 `codebuddy --acp` agent，Slate.js 编辑器 + `kind:id` mention 语法

### 请求 / 响应改写
- 洋葱式中间件链：pre → upstream → post；`respond()` 短路做 mock、`abort()` 中断
- 100% 兼容 [whistle](https://wproxy.org/whistle/) 规则语法，多规则集
- 18+ 内置操作符：
  - `statusCode://` / `redirect://` / `abort://`
  - `reqHeaders://` / `resHeaders://` / `reqBody://` / `resBody://`
  - `host://` / `file://` / `mock://` / `dust://`
  - `reqDelay://` / `resDelay://`
  - `log://` / `ua://` / `referer://`
  - `script://`（自定义 JS 脚本）
  - `breakpoint://`
- 规则文本编辑器（Monaco + 语法高亮 + 示例点击插入）
- 多规则集 CRUD + 磁盘持久化（`userData/rules/*.rules`）
- 插件系统：内置 `whistle-rules` / `mock` / `logger` / `breakpoint` / `allow-block` / `ssl-list` / `scripts`

### 断点
- 请求断点：暂停在 pre 阶段，UI 里改 method / URL / headers / body 后放行
- 响应断点：暂停在 post 阶段，改 status / headers / body 后放行
- 断点条件（host / URL 匹配）

### 会话
- 内存 FIFO 会话（可配上限）
- 导出/导入 `.proxybaby`（原生格式）
- 导出/导入标准 HAR
- 会话页签切换

### 生产力工具
- **Composer**：手动构造 HTTP 请求发出去（method / URL / headers / body），支持"复制到 Composer"
- **代码生成**：cURL / fetch / axios / Python `requests` / Python `httpx` / Go / Node http / Java OkHttp …
- **Diff 对比**：多选两条 flow，右键打开对比窗口
- **自定义预览 Tab**：用户配置额外的展示 Tab
- 独立窗体：设置、编辑器、Diff 都是独立 BrowserWindow

### 集成
- **CLI (`proxybaby`)**：控制运行中的 app（记录开关 / 规则管理 / 插件开关 / 应用启停 / 会话导出）
- **AI Skill (`skills/proxybaby/SKILL.md`)**：让 AI agent 通过 CLI 自主 mock、改写、劫持
- **本地控制通道**：`127.0.0.1:8898`，token 存于 `~/.proxybaby/cli-token`
- **Menu-bar Tray**：常驻菜单栏

### 平台
- 目前 macOS（Apple Silicon + Intel 通用）
- Windows / Linux 在 Roadmap

---

## 🤖 面向 AI 的完整 CLI + Skill

ProxyBaby 是**唯一为 AI agent 时代**设计的抓包工具。它的每一项 UI 能力都对应一条 CLI 命令，而 CLI 又配套了 [`SKILL.md`](skills/proxybaby/SKILL.md)，让 codebuddy / Claude Code / Cursor / Aider 等 agent **不用读源码就能自主操作**。

### 一句 prompt 让 AI 帮你装好 skill

复制下面这段话粘贴给你的 AI 助手（codebuddy / Claude Code / Cursor 等），它会自动帮你装好 ProxyBaby skill：

```
请帮我安装 ProxyBaby 的 AI Skill：
1. 从 https://github.com/imcuttle/proxybaby 的 skills/proxybaby/SKILL.md 读取内容
2. 保存到我本地：
   - 如果我用的是 codebuddy → ~/.codebuddy/skills/proxybaby/SKILL.md
   - 如果我用的是 Claude Code → ~/.claude/skills/proxybaby/SKILL.md
   - 如果我用的是 Cursor → 项目里的 .cursor/rules/proxybaby.mdc
3. 确认 ProxyBaby app 已安装（如没有，提示我到 https://github.com/imcuttle/proxybaby 下载）
4. 装完后跑一次 `proxybaby status` 验证 CLI 能连上 app
5. 告诉我可以直接对你说"帮我 mock xxx 接口"了
```

之后你就可以直接对 AI 说：**"帮我 mock 掉 api.example.com/user 让它返回 `{ok:true}`"** —— 它会自动调用 `proxybaby rule add` 完成。

### 你能让 AI 干什么

一切都是普通 shell 命令，agent 只需要 Bash 权限：

- **Mock 一个接口**：`proxybaby rule add mock-user --text 'api.example.com/user mock://{"id":1,"ok":true}'`
- **把线上流量劫持到本地**：`proxybaby rule add local-dev --text 'api.example.com host://127.0.0.1:3000'`
- **注入 header 做鉴权测试**：`proxybaby rule add force-auth --text '*.internal.com/* reqHeaders://{"Authorization":"Bearer test"}'`
- **模拟 500 / 网络慢**：`proxybaby rule add flaky --text 'api.foo.com/pay statusCode://500 resDelay://2000'`
- **抓取 & 分析线上流量**：`proxybaby record on` → 操作 → `proxybaby session export --har --out /tmp/x.har` → agent 读 HAR
- **调试 AI 应用自身**：让 agent 抓自己发出的 OpenAI / Anthropic 请求，UI 里直接看到对话

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
