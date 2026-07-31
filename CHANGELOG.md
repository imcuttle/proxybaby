# proxybaby

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

## ## 0.1.0

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
