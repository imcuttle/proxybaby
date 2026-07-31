/**
 * 内置插件的 README 文档（Markdown）。
 * 键为插件 id，与 electron/engine/plugins.ts 中 registerBuiltin 的 id 对应。
 */

export const PLUGIN_DOCS: Record<string, string> = {
  'whistle-rules': `# Whistle Rules

兼容 [whistle](https://github.com/avwo/whistle) 语法的文本规则集，负责把「模式 → 操作」翻译成中间件链，在请求/响应经过代理时执行改写。

## 规则语法

每一行一条规则：

\`\`\`
[组名]                            # 可选，只作分组标记
pattern  op1[://value]  [op2 ...] # 一条规则可挂多个 op
# 行注释
\`\`\`

### pattern 支持

| 形式 | 示例 | 说明 |
|------|------|------|
| 完整 URL 前缀 | \`https://api.example.com/foo\` | 严格前缀匹配 |
| host 前缀 | \`example.com/foo\` | 忽略 scheme |
| 通配 | \`*.example.com/*\` | \`*\` → \`.*\` |
| 正则 | \`/^https?:\\/\\/api/\` | \`/正则/[flags]\` |

### 内置 operators

| op | 值 | 作用 |
|----|-----|------|
| \`statusCode\` | \`200\` | 覆盖响应状态码 |
| \`redirect\` | \`https://target\` | 302 跳转 |
| \`abort\` | – | 立即断开连接 |
| \`reqHeaders\` | \`{"K":"V"}\` | 合并/添加请求头 |
| \`resHeaders\` | \`{"K":"V"}\` | 合并/添加响应头 |
| \`reqBody\` | 文本或 JSON | 替换请求体 |
| \`resBody\` | 文本或 JSON | 替换响应体 |
| \`host\` | \`127.0.0.1:3000\` | 域名劫持到指定 host:port |
| \`file\` | 绝对路径 | 用本地文件内容作为响应体 |
| \`mock\` | 文本 | 内联返回，短路上游 |
| \`reqDelay\` \`resDelay\` | 毫秒 | 请求/响应延迟 |
| \`ua\` \`referer\` | 字符串 | 替换对应请求头 |
| \`log\` | – | 命中时打印日志 |
| \`breakpoint\` | – | 命中时暂停，允许 UI 编辑 |

## 示例

\`\`\`
# 短路返回 mock
api.example.com/user   mock://{"id":1,"name":"test"}

# 把线上域名指到本地
api.example.com        host://127.0.0.1:3000

# 慢网络模拟
*.example.com/*        resDelay://2000

# 需要手动改的请求
api.example.com/edit   breakpoint
\`\`\`

## 提示

- 值中可以包含空格：\`{...}\` / \`[...]\` 会做括号平衡，\`"..."\` 视作带引号字符串。
- 多规则可命中同一请求，按声明顺序串成洋葱式中间件。
- 想临时禁用整个规则集，点侧栏左侧电源图标即可。
`,

  'logger': `# Request Logger

把每个经过代理的请求打印到主进程 stdout，格式：

\`\`\`
[flow] <METHOD> <STATUS> <URL> (<durationMs>ms)
\`\`\`

## 何时启用

- 需要在终端跟踪流量而不是 UI（如自动化、CI 排查）时。
- 默认关闭，避免正常抓包时刷屏。

## 何时不启用

- 请求量大 (>100 req/s) 且不需要实时追踪：日志会拖慢体感。
- 若你只想过滤某些 host / 路径的日志，用规则引擎的 \`log\` 操作符：

\`\`\`
api.example.com/*    log
\`\`\`

这样只对命中规则的请求打印，粒度更细。

## 输出位置

- 开发模式：\`npm run dev\` 的 electron 主进程窗口。
- 打包后：可从 \`~/Library/Logs/ProxyBaby/main.log\` 查看（macOS）。
`,

  'mock': `# Mock Responder

Mock 插件负责让规则里的 \`file://\` 与 \`mock://\` 操作符能直接短路返回本地内容，无需真实上游。

## 支持的操作符

### \`mock://<value>\`

内联返回。value 是字符串或 JSON：

\`\`\`
api.example.com/user   mock://{"id":1,"name":"test"}
api.example.com/hello  mock://Hello World
\`\`\`

- 若 value 以 \`{\` 或 \`[\` 开头，会自动补 \`Content-Type: application/json\`。
- 否则默认 \`text/plain\`。
- 状态码默认 200，可与 \`statusCode://\` 叠加。

### \`file://<absolute-path>\`

用本地文件作为响应体：

\`\`\`
cdn.example.com/logo.png   file:///Users/me/Desktop/logo.png
api.example.com/data       file:///tmp/data.json
\`\`\`

- 路径必须是绝对路径。
- Content-Type 会按扩展名推断（json/js/css/html/png/jpg/svg…）。

## 与规则引擎的关系

Mock 插件本身不解析规则文本；它只是把 \`mock://\`/\`file://\` 的执行能力挂给规则引擎。真正的匹配、优先级都由 **Whistle Rules** 处理。所以：

- 关掉 Mock Responder → 所有 \`mock://\` \`file://\` 规则失效（其他 op 仍工作）。
- 关掉 Whistle Rules → 整套文本规则不生效，Mock Responder 也就没什么可做的了。

## 提示

- 大文件建议直接 \`file://\`，别塞进 \`mock://\`。
- 想边写边预览 JSON mock 的返回，可以先 \`mock://\`，再叠一个 \`resDelay://\` 模拟弱网。
`,

  'breakpoint': `# Breakpoint

命中带 \`breakpoint\` 操作符的规则时，请求/响应会被暂停在代理内，弹出编辑窗口让你手动改 headers/body/状态码，再决定继续或中止。

## 使用步骤

1. 启用本插件（侧栏电源图标）。
2. 在规则里加一行：

   \`\`\`
   api.example.com/edit   breakpoint
   \`\`\`

3. 触发该请求时会自动弹出 **Breakpoint** 模态框：
   - \`request\` 阶段：可改方法、URL、headers、body。
   - \`response\` 阶段：可改 status、headers、body。
4. 点「继续」放行，或「中止」直接断开。

## 值语法（可选）

\`\`\`
breakpoint            # 默认在 request 与 response 都断
breakpoint://req      # 只在请求阶段断
breakpoint://res      # 只在响应阶段断
breakpoint://both     # 显式两阶段都断
\`\`\`

## 注意

- **SSE / WebSocket 只在 request 阶段可断**：流式帧一旦开始就无法回改。
- 断点会阻塞该请求直到你处理；如果窗口卡住，可以在状态栏点「恢复所有断点」。
- 关掉本插件后，规则里的 \`breakpoint\` 会被静默忽略（不会真的暂停）。

## 与「编辑并重复」的区别

| 特性 | Breakpoint | 编辑并重复 |
|------|-----------|-----------|
| 触发方式 | 规则命中时自动 | 抓包后右键手动 |
| 时机 | 请求正在进行中 | 请求已完成后 |
| 影响客户端 | 客户端看到的是编辑后的响应 | 客户端不知情，只是重发一份 |
| 用途 | 调试线上问题、灰度验证 | 复现、调参、排查 |
`,
};

export function getPluginDoc(id: string): string | undefined {
  return PLUGIN_DOCS[id];
}
