# AI 对话侧边栏（内置 codebuddy ACP）设计

日期：2026-07-31

## 目标

在 ProxyBaby 内置一个右侧常驻 AI 对话侧边栏，默认后端为本机 `codebuddy` CLI（ACP over stdio）。
AI 可通过工具直接：开关代理/录制、读写规则、允许阻止名单、切换插件、查询抓包详情、执行任意 shell。

## 顶层架构

```
Renderer (React + Slate)          Main (electron/ai/)
─────────────────────           ─────────────────────
Toolbar ✨ 按钮 → ai.panelOpen
ChatSidebar
  SessionList  ←──── ai:*  ────  AiManager
  MessageList  (Slate)              ├─ AcpClient (spawn codebuddy --acp)
  Composer     (Slate)              ├─ SessionIndex (userData/ai/index.json)
                                    └─ ToolBridge → RuleEngine/PluginMgr/FlowStore/shell
```

## 组件

- 顶栏 `Toolbar` 加 `data-testid="toggle-ai"` 按钮
- 新增 `App.tsx` 第三 Panel: `<AiPanel />`（可折叠，默认宽 380）
- 设置页新增「AI 助手」卡片：总开关（默认开）/ CLI 路径 / model / effort / permissionMode
- `src/components/ai/`: `ChatSidebar`, `SessionList`, `MessageList`, `Composer`, `MentionPopover`, `ToolCallCard`, `mentions/*Chip`
- `src/store/ai.ts`: zustand（panelOpen, enabled, sessions[], currentId, liveMessages, streaming）
- `electron/ai/`: `manager.ts`, `acp-client.ts`, `tool-bridge.ts`
- `src/lib/ai/md-to-slate.ts` + `slate-to-md.ts`

## 数据模型

- 消息**只存 markdown 字符串** + `toolCalls[]` 结构化字段
- 会话索引 `userData/ai/index.json`：`{sessions: [{id,cbcSessionId,title,updatedAt,pinnedFlowIds}], currentId}`
- messages 由 codebuddy 侧持久化，我们只在**当前 app 生命周期**内保留 `liveMessages: Record<sessionId, AiMessage[]>`

## 特殊语法（markdown 内嵌）

| 类型 | 语法 | Slate 渲染 |
|---|---|---|
| flow | `` `flow:<id>` `` | FlowChip |
| 文件 | `` `file:<abs>` `` | FileChip |
| 规则 | `` `rule:<id>` `` | RuleChip |
| 插件 | `` `plugin:<id>` `` | PluginChip |
| skill | `` `skill:<name>` `` | SkillChip |

Composer 首字符 `/` 触发斜杠命令：`/clear`, `/new`, `/attach-selected`, `/rename`。斜杠不入 markdown。

## ACP 集成

`spawn('codebuddy', ['--acp', '--acp-transport', 'stdio', '--session-id', <uuid>, '--permission-mode', 'bypassPermissions'])`

- ndJson JSON-RPC over stdio
- 输入方向：user message
- 输出方向：assistant text delta / tool_use / tool_result / end

**关键决策**：一次一个活跃 acp 子进程。切会话 kill/respawn（`-r <id>` 恢复）。

## Tools（ProxyBaby 侧提供给 AI）

通过一份运行时生成的 `mcp.json` 挂载，也支持退化为**内置 skill 指导 AI 走 shell + `proxybaby` CLI**（等价能力）。

| 工具 | 参数 | 实现 |
|---|---|---|
| `pb_status` | – | proxy/cert/rules/plugins 摘要 |
| `pb_flows_list` | `{limit?,filter?}` | flowStore 摘要 |
| `pb_flow_get` | `{id}` | 完整 flow |
| `pb_proxy_toggle` | `{on}` | setSystemProxy |
| `pb_record_toggle` | `{on}` | setRecording |
| `pb_record_clear` | – | flowStore.clear |
| `pb_rule_add` | `{name,text,enabled?}` | ruleEngine.add |
| `pb_rule_update` | `{id,...}` | ruleEngine.update |
| `pb_rule_remove` | `{id}` | ruleEngine.remove |
| `pb_allow_block` | `{allow?[],block?[]}` | allow-block |
| `pb_plugin_toggle` | `{id,on}` | pluginManager.setEnabled |
| `shell` | `{cmd,cwd?,timeoutMs?}` | 直接 spawn |

## IPC

```
preload:
  ai.listSessions()
  ai.createSession(title?)
  ai.switchSession(id)
  ai.renameSession(id,title)
  ai.deleteSession(id)
  ai.send(markdown, attachedFlowIds)
  ai.interrupt()
  ai.getConfig() / ai.setConfig(...)

事件:
  ai:sessions        # 索引变化
  ai:message-start   { sessionId, messageId, role }
  ai:text-delta      { sessionId, messageId, delta }
  ai:tool-call       { sessionId, messageId, toolCall }
  ai:tool-result     { sessionId, messageId, toolCallId, result|error }
  ai:message-end     { sessionId, messageId }
  ai:error           { sessionId, error }
```

## E2E（PROXYBABY_E2E=1 特殊路径）

真实 `codebuddy --acp` 需要模型密钥，且不确定 ACP 消息 schema —— E2E 里不用真进程。

- `PROXYBABY_E2E=1` 时 AcpClient 不 spawn，改为 **FakeAcpClient**：接受 `send()`，产生一段合成 text-delta + 一个 tool_call + tool_result + end
- 暴露 `window.__pbE2E.aiEmit(event, payload)` 供 Playwright 直接注入 assistant 事件，验证 UI 反应
- 覆盖：面板开关 / 新建切换会话 / 发送后收到消息 / mention chip 渲染 / tool-call 卡片渲染 / 设置页开关

## 测试计划

Unit:
- `md-to-slate.ts`：识别 `` `flow:xxx` `` / `` `file:xxx` `` 等 → mention 节点
- `slate-to-md.ts`：mention → 反引号语法回写
- SessionIndex：新建/切换/重命名/删除的原子性

E2E:
1. AI 总开关默认打开，顶栏可见 ✨ 按钮
2. 关闭总开关后 ✨ 按钮消失
3. 点 ✨ 按钮切换面板可见性
4. 新建会话 → 输入文本 → 发送 → 收到（合成）assistant 回复
5. 切换会话保留独立消息流
6. mention 语法在消息中渲染成 chip
7. tool-call 卡片显示 name + state
8. 删除会话
