# ProxyBaby 设计文档

复刻 Proxyman 的 macOS HTTP(S) 抓包调试工具，核心特性：系统代理、应用程序识别、域名分类、常驻菜单栏图标、以及针对 AI SSE 流的对话美化展示。

日期：2026-07-29

---

## 1. 目标与核心原则

- **开箱即用，零配置**：打开 app 自动完成「生成 CA → 安装并信任证书 → 设置系统代理 → 启动监听」，用户无感知直接抓包；退出时自动还原系统代理。
- **完整 MVP**：一次性打通代理引擎 + MITM + 系统代理 + 进程识别 + 主界面（列表/详情/分组）+ SSE/AI 美化 + 菜单栏图标全链路。
- **实时流式**：请求发出即出现在列表；SSE/AI 流式响应边接收边渲染，连接进行中即可展示，不等响应结束。

## 2. 技术栈

### 主进程（Electron / Node.js）
- 代理引擎（HTTP server + HTTPS CONNECT + MITM）
- MITM：`node-forge` 生成根 CA、动态签发叶子证书
- 系统集成：`networksetup`（系统代理）、`security`（证书信任，osascript 提权）、`lsof`（进程识别）
- 会话存储：内存为主，可选持久化

### 渲染进程（React + TypeScript）
- **Tailwind CSS + Radix UI**：macOS 深色主题 + 无障碍组件（菜单/Tab/右键菜单/分割面板）
- **TanStack Table + TanStack Virtual**：请求列表多列/排序/筛选 + 行虚拟化（支撑上千行流畅滚动）
- **Lucide**：图标库；OpenAI/Anthropic 等厂商 logo 用自备 SVG 补充
- **Zustand**：状态管理（会话流、选中项、筛选条件）
- **react-resizable-panels**：三栏可拖拽分隔

### 目录结构
```
proxybaby/
├─ electron/                # 主进程
│  ├─ proxy/                # 代理引擎 (http/https server, CONNECT, MITM 转发)
│  ├─ mitm/                 # CA 生成、动态签发叶子证书、证书信任安装
│  ├─ system/              # 系统代理设置(networksetup)、进程识别(lsof)
│  ├─ store/                # 会话存储(内存 + 可选持久化)
│  └─ ipc/                  # 与渲染层通信 (事件推送)
├─ src/                     # 渲染进程 (React)
│  ├─ components/           # 列表、详情、侧栏、AI Chat 视图
│  ├─ views/tabs/           # Headers/Body/Query/SSE/OpenAI 等 tab
│  ├─ parsers/              # OpenAI/Anthropic/ACP SSE 解析适配器
│  └─ store/                # Zustand stores
└─ shared/                  # 类型定义 (Flow/Request/Response/ChatMessage)
```

## 3. 代理引擎 + MITM（零配置核心）

### 自启动流程（app 打开即全自动执行）
1. 检查根 CA 是否存在 → 无则用 node-forge 生成
2. 检查 CA 是否已被系统信任 → 未信任则用 osascript 提权执行 `security add-trusted-cert` 装入系统钥匙串（弹一次系统授权，之后不再打扰）
3. 启动本地代理 server（监听 `127.0.0.1:9998`，端口占用时回退随机端口）
4. 用 `networksetup` 设置系统 HTTP/HTTPS 代理指向本地端口
5. 开始抓包

### 退出/关闭抓包
- 自动 `networksetup -setwebproxystate <service> off` 还原系统代理，避免断网

### MITM 工作方式
- 收到 `CONNECT host:443` → 用根 CA **动态签发该域名叶子证书**（缓存）→ 与客户端做 TLS 握手（伪装目标站）→ 同时作为客户端连真实服务器 → 双向解密并记录明文
- 纯 HTTP 直接透传记录
- SSE：识别 `text/event-stream`，**边转发边逐块记录**，不缓冲整个响应

### 容错降级
- 证书信任失败/无权限：降级为仅记录 HTTPS 隧道元数据，UI 提示「点此修复证书」，不阻塞使用

## 4. 证书管理

- 自动优先：默认自动生成 + 安装 + 信任（对应 Proxyman「自动」模式）
- 状态检测：UI 显示「已安装并信任 / 未信任」，提供一键修复
- 手动兜底：提供导出 CA、手动安装指引（备用，非默认路径）

## 5. 进程识别 + 数据分组

### 进程识别（按连接进程）
- 每个被代理连接取客户端 socket 的本地端口
- `lsof -i :端口 -n -P` 将端口映射到 PID → 进程名 → 可执行路径
- 由可执行路径取应用名与图标（`.app` 读 Info.plist + icns；命令行进程如 node 用通用图标）
- 端口→进程映射短期缓存，避免每请求 fork

### 左侧栏数据组织
```
收藏夹
  已固定      ← 用户手动 pin 的域名/请求
  Saved
所有
  应用程序 (n)  ← 按发起进程分组：node / Chrome / Safari...
  域名 (n)      ← 按 host 分组，可展开看路径 (/wwhead, /bizmail)
```
- 顶部快捷过滤条：全部 / HTTP / HTTPS / WebSocket / JSON / 表单 / XML / JS / CSS / GraphQL / 文档 / 媒体 / 其他
- 点击分组 → 列表过滤到该应用/域名

## 6. 主界面布局（对应截图）

- **三栏**：左侧树形侧栏（可折叠分组）+ 中间请求列表 + 底部/右侧详情，分隔条可拖拽
- **请求列表列**：# / 网址 / 客户端(app 图标+名) / 方法 / 状态 / 时间 / 请求大小 / 响应大小 / SSL / 已编辑 / 工具
  - 状态徽章彩色（绿 2xx、蓝方法）
  - 进行中的连接状态标记为 pending
- **详情区 Tab**：
  - Request：头部 / 查询 / 正文 / 授权 / 原始 / 摘要
  - Response：头部 / 正文 / Set-Cookie / 原始 / TreeView / **SSE** / **OpenAI(AI Chat 美化)**
- **底部状态栏**：监听地址、流量速率、选中行数

## 7. 菜单栏（Tray）常驻图标

- 右上角常驻 icon，点击弹出菜单：
  - 显示 ProxyBaby（唤起主窗口）
  - 记录流量（开关）
  - macOS 代理已被覆盖（状态显示）
  - 监听地址（127.0.0.1:9998）
  - 启用/禁用工具
  - 退出（退出前自动还原系统代理）

## 8. SSE / AI 消息美化（重点差异化）

### 8.1 SSE 原始视图
- 识别 `text/event-stream`，逐 `data:` 帧解析并**实时增量渲染**
- 每帧展示时间戳、event 类型、raw payload（可折叠 JSON）
- 原始视图与美化视图共享同一份流式数据源，两个 Tab 均随帧到达实时更新

### 8.2 统一消息模型
```ts
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;                          // Markdown 渲染
  toolCalls?: { name: string; arguments: any }[];
  toolResult?: any;
  reasoning?: string;                        // 思考内容（若有）
}
```

### 8.3 协议适配器（parsers/）
- **OpenAI**
  - 请求：`messages[]`（system/user/assistant/tool）+ `tools[]`
  - 响应：非流式 `choices[].message`；流式 `delta` 增量拼接（content / tool_calls / reasoning_content）
- **Anthropic**
  - 请求：`system` + `messages[]`（content 可为 text/tool_use/tool_result 数组）
  - 响应 SSE：`message_start` / `content_block_delta`(text_delta, input_json_delta) / `message_delta` / `message_stop`
- **ACP（Agent Client Protocol，SSE）**
  - 解析 ACP session/message 事件流，映射到统一模型

### 8.4 展示（直观 chat 视图，全程流式）
- 按角色分色气泡：系统(灰) / 用户(蓝) / 助手(绿) / 工具(橙)
- **美化视图本身即流式渲染**：SSE 流处理过程中，每收到一帧增量就更新对话，不等流结束再解析
  - assistant 文本：打字机式逐字增量出现（拼接 content delta / text_delta）
  - 工具调用：函数名先出现，参数随 `tool_calls delta` / `input_json_delta` 增量拼接展示（JSON 折叠）
  - reasoning/思考内容：同样随帧增量渲染
- 工具结果单独块展示
- 支持 Markdown / 代码高亮（增量渲染时对未闭合代码块做容错）
- 顶部显示模型名、token 用量、温度等元信息（若可从 body 提取）
- 连接进行中 chat 顶部显示「流式中…」指示，结束后补全 finish_reason / usage

### 8.5 降级
- 无法识别为 AI 协议时，OpenAI Tab 隐藏或提示「非 AI 会话」，回退普通 JSON/SSE 视图

## 9. 实时数据流（IPC）

- 请求发出（连接建立、头/体到达）即通过 IPC 推送到渲染层，列表立即出现，状态 pending
- SSE/AI 流式响应边接收边推送增量帧，chat 视图实时渲染
- 连接结束后补全最终状态（状态码、总大小、耗时）

## 10. 洋葱中间件 + 规则引擎 + 插件（v2 扩展）

### 10.1 洋葱式中间件架构
每个 flow 经过 middleware 链，前置阶段可改请求，后置阶段可改响应：
```
type Middleware = (ctx: Context, next: () => Promise<void>) => Promise<void>;
```
- `ctx.request` / `ctx.response` 均可读可写
- `ctx.respond(response)` 短路后续中间件，直接以给定响应返回给客户端（mock 场景）
- `ctx.abort()` 中断连接
- 错误自动捕获记入 flow.errorMessage

### 10.2 whistle rules 兼容
文本规则集（多个），每行：`pattern operator[://value] [operator2...]`
- 匹配器：URL glob（`*.example.com/api/*`）、正则（`/foo\/(\d+)/`）、host、regexp path
- 操作符（内置）：`statusCode`、`redirect`、`abort`、`reqHeaders`/`resHeaders`（JSON 或 kv 文件）、`reqBody`/`resBody`、`req`/`res`（转发到指定 URL）、`host`（hosts 覆盖）、`file`（本地文件返回）、`tpl`（模板）、`reqDelay`/`resDelay`、`log`
- `#` 注释；空行忽略；支持组标题 `[groupName]`

### 10.3 插件系统
`plugins/<id>/` 目录，导出：
```
export default {
  id: string,
  name: string,
  matchers?: Matcher[],
  operators?: Record<string, Operator>,
  middlewares?: Middleware[],
}
```
内置官方插件：
- `whistle-rules`：加载规则集，把匹配到的操作符转换成 middlewares 追加到链上
- `breakpoint`：命中规则时暂停并允许 UI 编辑请求/响应（v2 UI 增强项）
- `mock`：`file://path` / `tpl://path` 直接返回本地内容
- `logger`：结构化日志输出（可选写入文件）

### 10.4 规则管理 UI
- 左侧栏新增「规则」分组，展示所有规则集
- 主界面新增 Rules Tab（列表 + 文本编辑器 + 启用开关 + 语法着色）
- 状态栏显示「N 条规则已启用」

## 11. 官方 CLI + AI Skill

### 11.1 控制通道
- app 侧启动 loopback HTTP server 127.0.0.1:8898（随 app 启动；token 鉴权 token 存 userData/cli-token）
- REST：
  - `GET /status` → 代理状态、规则数
  - `POST /proxy/{on|off}`
  - `POST /proxy/port { port }`
  - `POST /record/{on|off|clear}`
  - `GET/POST/PUT/DELETE /rules`（CRUD 规则集）
  - `POST /rules/{id}/{enable|disable}`
  - `POST /app/{open|quit}`

### 11.2 CLI（`bin/proxybaby.js`，全局 `proxybaby` 命令）
```
proxybaby app open|quit
proxybaby proxy on|off|status
proxybaby proxy port <n>
proxybaby record on|off|clear
proxybaby rule list
proxybaby rule show <id>
proxybaby rule add <name> --file <path>
proxybaby rule update <id> --file <path>
proxybaby rule remove <id>
proxybaby rule enable <id>
proxybaby rule disable <id>
```
未运行时 `app open` 自动启动。

### 11.3 AI Skill
`skills/proxybaby/SKILL.md`：描述 CLI 用法、5-8 个常见任务示例（mock 一个 API、改 header、修改 status、启动/停止代理、导出规则等）。AI 通过 shell 调用 CLI 就能自主管理 app。

## 12. MVP 范围边界（YAGNI）

**v1 包含**：代理引擎、MITM、自动证书、系统代理、进程识别、侧栏分组、请求列表、详情 Tab、SSE 视图、OpenAI/Anthropic/ACP AI 美化、菜单栏图标。

**v2 追加**：洋葱中间件、whistle rules 解析与执行、插件系统 + 内置插件、规则管理 UI、CLI + 本地控制通道、AI Skill。

暂不做：iOS/Android 证书安装、差异对比、持久化历史库、WebSocket 消息深度美化。
