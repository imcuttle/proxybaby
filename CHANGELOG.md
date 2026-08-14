# proxybaby

## 0.9.2

### 🐛 修复
- fix(ai): AI Tab「可用工具」展开后列表撑高固定顶栏、无法滚动 —— 工具较多（如 24 个）时看不到全部；现在展开列表在自身内部滚动 (`e09d708`)

## 0.9.1

### 🐛 修复
- fix(updater): 检查更新时 GitHub REST API 匿名限流走302 fallback 后，追加一次 `raw.githubusercontent.com/imcuttle/proxybaby/<tag>/CHANGELOG.md` 二次拉取（无鉴权、无匿名限流），按 `## <version>` 抽出对应版本段填`releaseNotes`；不再出现"（本次发布没有提供changelog）" (`67ea7e5`)
- fix(release): `scripts/release.mjs` 和 `scripts/extract-changelog.mjs` 写入 CHANGELOG.md / 输出前统一跑一次 heading 空格规范化 (`^(#{1,6})(?=[^\s#])` → `$1 `)，防止 `###🔧 其他` 这种无空格 heading 进GitHub Release body 后被当成纯文本 (`67ea7e5`)
- fix(changelog): 修正 v0.8.1 段里`###🔧 其他` 缺失的空格（本地修正，GitHub 上已发布的 release body 保持不动）(`67ea7e5`)

### 🧪 测试
- 新增 `tests/unit/release-notes-normalize.test.ts`：覆盖 heading 空格规范化正则，含 `#### sub` 不误伤的负面用例 (`67ea7e5`)
- `tests/unit/updater.test.ts` 补`extractVersionSection` 6 个 case + fallback 拉 raw CHANGELOG / 拉失败 两条路径 (`67ea7e5`)

## 0.9.0

### ✨ 新功能
- **CLI 控制通道端口可配置**：设置面板新增「CLI 控制通道」section，可修改本地控制端口（默认 8898）。支持通过 `PROXYBABY_CTRL_PORT` 环境变量运行时覆盖，方便在同一台机器并行跑多实例 / e2e 隔离。(`4b90d8f`)
- **端口占用优雅降级**：`startControlServer` 挂了 `error` handler，EADDRINUSE 时不再让主进程崩溃，只是 CLI 通道不启动，抓包主链路不受影响。(`4b90d8f`)

### 🧪 测试
- 新增 `tests/e2e/cli.e2e.ts`：spawn `bin/proxybaby.cjs` 子进程，覆盖 status / app / record / rule 全流程 / plugin / session export / controlServer IPC 全部命令，共 26 个用例。beforeAll 用随机空闲端口 + `PROXYBABY_CTRL_PORT` env 注入避开用户本机 8898 冲突。(`00af8a4`)
- 设置窗口 e2e 补齐控制通道端口面板可视化 case。(`4b90d8f`)

## 0.8.1

### 🐛 修复
- fix(updater): 检查更新时，GitHub REST API 触发匿名限流（403 rate limit）或网络受限，会自动降级到 `github.com/…/releases/latest` 的 302 重定向兜底通道抽取版本号；两个源都失败时给出可读的中文原因；失败弹窗新增 "打开发布页" 按钮，直接跳到releases 页面 (`438da9f`)

### 🔧 其他
- chore(ui): 移除 ListenPopover 里多余的 `export http_proxy=…` 提示行，保留复制按钮即可 (`d723da6`)
- docs(release): `/release` 命令内置 commit 阶段说明 (`7862e5a`)

## 0.8.0

### ✨ 新功能

- feat(app): 应用内自动更新 + 统一 logger + 原生菜单栏 —— 启动后轮询 GitHub Releases，有新版弹独立窗口展示 changelog；electron-log 统一日志出口；中文原生菜单栏（`9bc9e13`）
- feat(rules): Rule Debug 独立窗口 —— 模拟请求 dry-run 看每条规则命中/未命中原因 + 环境诊断 + operator 改写快照；JSON 规则文本 normalize（Monaco pretty JSON 自动压平成单行）；中间件链 trace 日志（`d8d3088`）
- feat(ui): Monaco headers/body 编辑器 —— HTTP header 名/值 IntelliSense，Composer / 断点 / Rule Debug / Scripts 共用；App Info 悬浮 tooltip 展示 pid/bundleId/execPath（`cebb0ff`）

### 🐛 修复

- fix(system,proxy): HTTPS(MITM) 请求的 App 来源终于能识别了 —— 通过 CONNECT 阶段建立 externalPort 映射解决内部环回 socket 问题；CLI 进程（node/python）沿 PPID 链找终端 App 图标；Chrome Helper / Code Helper 等归并到主 App；紧急退出时系统代理更稳的还原逻辑；短路规则命中后 UI「已编辑」标记不显示的问题（`b0cca0a`）

### 🧪 测试

- test(e2e): 抽出 `_shared` 启动器 + 拆分规则 spec + 覆盖 updater / rule-debug / 菜单栏（`e0d2f09`）

### 🔧 其他

- chore(integration): 把 updater / rule-debug / menu / UI 编辑器接入主流程 —— 类型 / IPC 桥 / 路由 / 主进程 whenReady 连线（`aed5e1e`）

### 📝 文档

- docs(screenshots): 重新截图 —— 新菜单栏 / Rule Debug / App Info tooltip / Monaco 编辑器（`a87466e`）

## 0.7.0

### ✨ 新功能
- feat(rules): 快速规则子菜单抽独立组件，抓包列表右键也可用；命中项 ✓ toggle 一键删除 (`1706a41`)

### 📝 文档
- docs(readme): 重新生成截图 —— OpenAI/Anthropic chat 视图 + 规则页 + 新增 AI Sessions 截图 (`9deb264`)

### 🐛 修复
- fix(release): CHANGELOG 版本标题被反复叠加 `## ` 前缀 (`45fe74b`)

## 0.6.0

### ✨ 新功能
- feat(ai): 新增独立「AI Sessions」子窗口，Chat 视图右上角提供入口，跨窗口预选并回滚主窗口列表 (`1fb16ef`)
- feat(sidebar): 「已置顶」右键"取消置顶此域名"统一清空 host + 其所有 subpath；host pin 状态判定同时考虑 subpath (`1fb16ef`)
- feat(list): RequestList 支持方向键 / Home / End 切换选中，非输入框焦点下生效 (`1fb16ef`)
- feat(ipc): allowBlock / recordFilter 变更时主动 broadcast，供侧边栏等实时刷新 (`1fb16ef`)

### 🔧 其他
- refactor(parsers): 增强 Anthropic 检测（header + body 结构启发：`input_schema`、`tool_use/tool_result/thinking` 块），去掉"messages 兜底判 openai"的误判 (`1fb16ef`)

## 0.5.0

### 新特性

- **侧栏 path 支持无穷下钻分组**：域名下的 subpath 从"仅一级"改为**递归树**。/v2 展开后显示 /v2/chat、/v2/report；/v2/chat 再展开显示 /v2/chat/completions……直到叶子路径。所有层级都支持点击过滤、右键完整菜单（置顶/快速规则/删除…）。
- **收藏夹「Saved」变为 tree**：与「已置顶」结构一致，按 App 分组，展开显示该 app 关联的 host 子节点，host 再展开显示 subpath tree。

## 0.4.0

### 新特性

- **OpenAI / Anthropic 视图请求响应分栏**：Request tab 和 Response tab 都会显示 chat 视图，分别只展示输入 messages 和输出 messages（不再挤在同一个视图里）。
- **消息 Markdown 一键复制**：ChatView 每条消息 hover 后右上角出现复制按钮，复制 reasoning + content + tool calls 的合并 Markdown。
- **缓存命中可视化**：SessionMeta 里显示 `缓存 N (X%)` 徽标——OpenAI 用 `prompt_tokens_details.cached_tokens`，Anthropic 兼容 `cache_read_input_tokens` 和 `cache_creation_input_tokens`。
- **JsonTree 值也支持 hover 复制**：叶子节点 hover 显示复制按钮，字符串按原文复制，其他类型按 `JSON.stringify` 结果复制。
- **快速规则子菜单显示已有规则并支持切换启停**：右键 → 快速规则，顶部列出当前 pattern 命中的临时规则，checkbox 切换启用/禁用（底层等价规则集级别 `setEnabled`，不再是删除），子菜单头显示"生效/总数"徽标。

### 改进

- **FlowContextMenu "置顶/保存" label 反映当前状态**：已置顶/已保存时显示"取消置顶/取消保存"，多选按 all-selected 判断。
- **PinnedTree 已置顶行 header 缩进对齐**：Pin 图标与 Saved 的 Bookmark 图标同列。
- **右键菜单快捷键字体加大**（text-xs → 13px + tracking），贴近 macOS 系统菜单风格。
- **Radix Popper 首帧闪现修复**：全局 CSS 兜底，未定位完成的 Content 全部透明不可交互。

## 0.3.3

### 修复

- **右键菜单/Popover 首帧闪到左上角**：Radix Popper 只在 useLayoutEffect 完成测量后才在 Content 上写入 `data-side`，未测量前可能出现"闪一下"的旧位置。加了一层全局 CSS 兜底：未定位完成的 Content 全部透明且不可交互。

## 0.3.2

### 改进

- **已置顶树右键复用完整菜单**：置顶的 App/Host/Path 现在使用与正常侧栏一致的完整右键菜单（置顶/取消置顶、SSL、抓包过滤、快速规则、导出、删除…），不再是右键就取消置顶。
- **置顶 App 支持展开子树**：置顶的应用展开后显示该 app 关联的 host 子节点，host 再可展开显示 subpath——与正常「应用程序」分组的行为一致。

## 0.3.1

### 修复

- **置顶域名/应用后"已置顶"计数不变**：此前只统计 `pinnedIds`（单条 flow 置顶），忽略了 `pinnedHosts` / `pinnedPaths`。现在按 `isFlowPinned` 完整遍历。

### 新特性

- **收藏夹「已置顶」改为树状展开**：展开后按分组显示置顶的应用和域名，域名节点可再展开显示置顶的路径前缀。子节点点击切换 filter，右键取消置顶。

## 0.3.0

### 新特性

- **抓包过滤（Record Filter）独立于 SSL 列表**：新增独立的"哪些请求进 UI 列表"过滤（all / include / exclude），对 HTTP + HTTPS 都生效，命中项不显示但依然会正常代理到上游。
- **每条目 SSL 解密开关**：在录制过滤条目上直接勾选是否解密，CONNECT 阶段命中 `decrypt=false` 的条目会走隧道直通，不再 MITM。
- **侧栏右键菜单语义修正**：`仅抓取此 App/域名` / `抓包时排除此 App/域名` 现在写入 record-filter（include / exclude），不会像旧版那样把请求 abort 掉。

### 修复

- `upgradeToEntries` 迁移时未保留 `decrypt` 字段，导致老配置升级后 per-entry SSL 决策失效。

### 测试

- 新增 `tests/unit/record-filter.test.ts`（11 个用例覆盖 shouldRecord / shouldDecrypt / URL glob / disabled）。
- 更新 e2e：`过滤配置窗口：录制过滤添加 App 维度条目`、`侧栏右键：将域名加入抓包排除/包含列表（record-filter）`。

## 0.2.0

### ✨ 新功能

- feat(sidebar): 侧栏右键新增 "nav:goto" 事件与快速规则菜单入口，"自定义规则…" 一键跳到规则页临时 Tab 并在编辑器插入待补全的 pattern 行 (`6cce3b9`)

### 🐛 修复

- fix(ssl): 过滤配置 SSL 面板改成三向单选（全部 / 仅包含 / 排除外全部），修复 sidebar 右键"仅抓取此域名"把 mode 切走后无法切回 all 的坑 (`04e697d`)

### 🔧 其他

- chore(release): `/release` 命令全流程自动化，前置检查通过后无中间确认直接 bump + tag + push (`99611db`)

## 0.1.0

首次发布 🎉

- **抓包引擎**：Electron 主进程 MITM 代理，全 HTTPS 解密、HTTP/2、WebSocket、SSE 帧实时解析；`CONNECT` 隧道 + 动态叶子证书 + gzip/br/deflate 异步解压
- **系统集成**：自动生成并信任根 CA、`networksetup` 系统代理开关（退出还原）、`lsof` 按发起进程识别应用名、菜单栏 Tray
- **UI**：三栏布局 + TanStack Virtual 虚拟列表 + JSON Tree / Hex / Form / Multipart / GraphQL / Image 多格式正文视图 + Monaco headers/body 编辑器 + 高级过滤器 + Pin/Save + 独立设置窗口
- **AI 会话美化**（业界独家）：OpenAI `chat/completions`、Anthropic `v1/messages`（含 `tool_use` / `thinking`）、ACP 三大 AI 协议原生美化，打字机式流式渲染
- **内嵌 AI 侧边栏**：直接在抓包窗口跑 `codebuddy --acp` agent，Slate.js 编辑器 + `kind:id` mention 语法
- **whistle 兼容规则**：18+ 操作符（`statusCode` / `redirect` / `reqHeaders` / `resHeaders` / `reqBody` / `resBody` / `host` / `file` / `mock` / `reqDelay` / `resDelay` / `log` / `ua` / `referer` / `script` / `breakpoint`），多规则集磁盘持久化
- **插件系统**：`whistle-rules` / `mock` / `logger` / `breakpoint` / `allow-block` / `ssl-list` / `scripts` 内置插件，可按需启停
- **断点调试**：请求/响应双阶段暂停、UI 里改 headers/body 后放行
- **生产力**：Diff 对比 / Composer 手动发请求 / 10+ 语言代码生成 / 自定义预览 Tab / HAR 与 `.proxybaby` 导入导出
- **AI-friendly CLI**：`proxybaby` CLI 覆盖 app 全部运行时能力（状态/代理/记录/会话导出/规则 CRUD/插件开关），并配套 `skills/proxybaby/SKILL.md`，让 codebuddy / Claude Code / Cursor 等 agent 一键操作
- **测试覆盖**：16 unit + 5 integration（起真实端口）+ 50+ e2e（Playwright + Electron）

平台：macOS（universal，Apple Silicon + Intel），未签名版本，首次打开需在系统设置里允许。
