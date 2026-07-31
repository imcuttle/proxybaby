# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

ProxyBaby 是一个 macOS 上的 HTTP(S) 抓包调试工具（对标 Proxyman + whistle），核心差异是内置 AI/SSE 消息美化视图与 whistle 兼容的请求/响应改写。

## 常用命令

```bash
npm install              # 安装依赖（electron 二进制在 node_modules/electron/dist）
npm run dev              # 开发：同时启动 vite 渲染层 + electron 主进程（热重载）
npm run typecheck        # tsc --noEmit，改动后必须跑
npm run build            # vite build + electron-builder（出 dmg/zip）
npm run build:dir        # vite build + electron-builder --dir（只出解包 .app，更快）
npm run install:mac      # build:dir → 覆盖安装到 /Applications 并自动打开

# 测试（三层，Vitest + Playwright）
npm test                 # 全部 vitest（unit + integration）
npm run test:unit        # 仅单元
npm run test:integration # 仅代理引擎集成（起真实端口）
npm run test:e2e         # 先 vite build，再 Playwright 启动打包 app 做 UI e2e
npm run test:all         # vitest + e2e

# 跑单个测试文件 / 单个用例
npx vitest run tests/unit/parsers.test.ts
npx vitest run tests/integration/whistle-rules.test.ts -t 'mock:// 短路'
npx playwright test tests/e2e --grep '文本搜索'
```

## 关键约束（务必遵守）

- **主进程 IO 一律异步**：禁止在热路径用 `*Sync`（如 `gunzipSync`、`readFileSync`）。同步 IO 会阻塞 Electron 主进程 event loop 导致 UI 卡顿、代理停摆。解压、文件读写等用异步 API。
- **preload 必须是 CommonJS**：sandboxed preload 不支持 ESM。`vite.config.ts` 已将 `electron/preload.ts` 单独打成 `dist-electron/preload.cjs`（`formats: ['cjs']`），`main.ts` 引用的是 `preload.cjs`。改动 preload 后若手动 build，记得删除残留的 `dist-electron/preload.js`。
- **IPC 载荷必须可结构化克隆**：不能把含函数（插件对象）或 RegExp（规则 matcher）的对象直接 `ipcMain.handle` 返回。`plugins:list` / `rules:*` 的 handler 在 `main.ts` 里已转成纯数据摘要，新增类似接口需照做。
- **响应体的 bodyBuffer 保留原始字节**（可能是压缩后的）用于写回下游客户端；解压只用于展示的 `bodyText`。非 SSE 响应先缓冲完再写下游，以便后置中间件改写 status/body/headers 生效；SSE 实时流式转发（不可被后置改写）。
- 端到端测试环境变量 `PROXYBABY_E2E=1`：跳过证书安装/系统代理（避免 sudo 弹窗），并开放 `__e2e:emit` 注入通道供 Playwright 灌入合成 flow。

## 架构总览

Electron 应用，主进程（`electron/`，Node.js）负责抓包与系统集成，渲染进程（`src/`，React + TS）负责 UI。两者通过 preload 桥（`window.proxybaby`）+ 事件推送通信。类型定义集中在 `shared/types.ts`（主/渲染共用）。

### 主进程 `electron/`
- `main.ts` — 生命周期入口：ready 时生成 CA→装信任→启动代理→设系统代理→建 Tray/窗口；退出还原系统代理。集中注册所有 `ipcMain.handle`。端口默认 9998（`PROXY_PORT`，可运行时改）。
- `proxy/proxy-server.ts` — 代理引擎核心：HTTP 转发 + `CONNECT` 隧道 + 内嵌 TLS server 做 MITM 全解密 + `upgrade` 处理 WebSocket。每个请求经**洋葱式中间件链**（`[...插件中间件, upstreamMw]`）。捕获后 emit 一系列 `flow:*` 事件。
- `proxy/sse-parser.ts`、`proxy/ws-parser.ts` — 增量式 SSE 帧 / WebSocket 帧（RFC6455，含 mask/分片/控制帧）解析器。
- `engine/` — 请求/响应改写子系统：
  - `context.ts`：`ProxyContext` + 洋葱 `runMiddlewares`（`ctx.respond()` 短路、`ctx.abort()` 中断）。
  - `rule-parser.ts`：whistle 兼容规则文本解析。**注意 tokenizer 支持含空格的 JSON/引号值**（`reqHeaders://{"A":"B c"}`）。
  - `operators.ts`：内置操作符 → middleware（statusCode/redirect/abort/reqHeaders/resHeaders/reqBody/resBody/host/file/mock/reqDelay/resDelay/log/ua/referer/breakpoint 等）。断点运行时通过模块级 `setBreakpointRuntime` 注入。
  - `rule-engine.ts`：多规则集 CRUD + 磁盘持久化（`userData/rules/*.rules`）+ 为某 URL 构建匹配的 middleware 链。
  - `plugins.ts`：插件系统，内置 whistle-rules/mock/logger/breakpoint；`collectMiddlewares` 汇总所有启用插件的中间件。
  - `breakpoint.ts`：断点控制器，pause 返回 Promise 挂起直到渲染层 `breakpoint:resume`。
- `mitm/` — `ca.ts`（node-forge 根 CA + 动态签发叶子证书，LRU 缓存）、`trust.ts`（osascript 提权装信任 / 检测状态）。
- `system/` — `system-proxy.ts`（`networksetup` 设/还原系统代理）、`process-lookup.ts`（`lsof` 按本地端口反查发起进程，带缓存）。
- `store/` — `flow-store.ts`（内存会话，上限 FIFO）、`session-io.ts`（导出/导入 `.proxybaby` 与 HAR）。
- `control/control-server.ts` — 本地控制 HTTP server（127.0.0.1:8898，token 鉴权），供官方 CLI（`bin/proxybaby.cjs`）与 AI Skill（`skills/proxybaby/SKILL.md`）远程控制 app。

### 渲染进程 `src/`
- `App.tsx` — 顶层布局：顶部「抓包 / 规则 & 插件」标签切换；抓包页是三栏（Sidebar + RequestList + DetailPane）。在此订阅所有 `flow:*` IPC 事件并写入 store。
- `store/flows.ts` — Zustand store：flows/byId、选中、filter（text/type/appName/host/pathPrefix/special）、pinnedIds/savedIds、proxyStatus/certStatus、activeBreakpoint。
- `components/` — `Toolbar`（暂停/清空/导出导入/搜索框/类型过滤条/`ListenPopover`）、`Sidebar`（收藏夹/应用/域名+subpath 分组过滤）、`RequestList`（TanStack Virtual 虚拟滚动 + pin/save）、`DetailPane`（Request/Response Tabs + 复制 cURL）、`StatusBar`（证书未信任引导）、`BreakpointModal`、`JsonTree`（可折叠+局部复制）、`LazyText`（大文本滚动懒加载）。
- `components/tabs/` — HeadersView / BodyView（复制/下载/JSON tree/图片预览）/ SSEView / WSView / ChatView（AI 美化）。
- `parsers/` — AI 协议归一化为统一 `ChatSession`：`index.ts`（`detectProvider`/`parseSession`）+ `openai.ts` / `anthropic.ts` / `acp.ts`（支持 SSE 与 ACP-over-WebSocket）。这些是**纯函数、幂等**，每次 flow 增量更新后重新解析即得到"流式增长"效果，实现打字机式渲染。

### 数据流（一次抓包）
`onRequest` 建 Flow → emit `flow:start` → 读完请求体 → 跑洋葱中间件（规则改写/断点/mock）→ `forwardUpstream` 发上游 → emit `flow:response-headers` → 非SSE缓冲+异步解压 / SSE 逐帧 emit `flow:sse-frame` → emit `flow:response-body` + `flow:end`。主进程每个事件同时写 `FlowStore` 并 `broadcast` 给渲染层；渲染层 store 就地更新对应 flow，UI 响应式刷新。

### 测试组织
- `tests/unit/` — 解析器、规则、操作符、过滤、会话 IO（纯逻辑）。
- `tests/integration/` — 起真实 target server + ProxyServer，发真实请求断言（含各 content-type/编码、whistle rules 端到端、MITM）。
- `tests/e2e/app.e2e.ts` — Playwright `_electron` 启动打包 app，用 `__pbE2E.emit` 注入合成 flow 驱动真实 UI。
- `tests/mocks/electron.ts` — vitest 里把 `electron` 别名成轻量 mock（只提供 `app.getPath`），见 `vitest.config.ts`。
- `tests/fixtures.ts` — `mkFlow`/`mkReq`/`sse` 构造器。
