# 左下角过滤配置入口 + 独立黑白名单窗口 设计

日期：2026-07-31

## 目标

在 Sidebar 左下角新增 `+` 按钮，一键打开一个独立的 Electron 窗口，集中管理两组抓包过滤配置：

1. **SSL 解密清单**（Include / Exclude，对齐 Proxyman "SSL 代理列表"）
2. **允许 / 阻止列表**（Allow / Block）

两组配置均升级为**三维度**条目：应用（App，按进程名匹配）/ 域名（Host，兼容 `*.foo.com` 通配）/ 地址（URL，glob 或 regex）。

现有 `SettingsView` 内 `AllowBlockPanel` / `SslListPanel` 迁出到该独立窗口；其它面板（AI、脚本、网络条件、上游代理）保留在设置页。

## 非目标

- 不改动 whistle 规则引擎、断点、mock 等既有插件行为。
- 不引入云同步 / 多台机器共享。
- 不在此设计里做批量导入导出（后续单独）。
- App 维度不做"bundle id / 图标选择器"（仅进程名字符串匹配，因当前抓包侧 `flow.app.name` 也是进程名）。

## 数据结构

### 迁移前

```ts
// shared/types.ts（当前）
interface AllowBlockConfig { mode: 'off'|'allow'|'block'; hosts: string[] }
interface SslDecryptConfig { mode: 'all'|'include'|'exclude'; hosts: string[] }
```

### 迁移后

```ts
type FilterKind = 'app' | 'host' | 'url';
type UrlMatchMode = 'glob' | 'regex';

interface FilterEntry {
  id: string;              // uuid
  kind: FilterKind;
  value: string;           // 进程名 / host / URL 或正则源
  urlMode?: UrlMatchMode;  // 仅 kind='url' 时有效；未设时默认 glob
  enabled: boolean;        // 单条禁用（不删除）
  note?: string;
}

interface AllowBlockConfig {
  mode: 'off' | 'allow' | 'block';
  entries: FilterEntry[];  // 之前的 hosts 全部归到这里
}

interface SslDecryptConfig {
  enabled: boolean;        // 新增：SSL 代理总开关（默认 true）
  mode: 'all' | 'include' | 'exclude';
  entries: FilterEntry[];
}
```

### 磁盘迁移（幂等）

- `<userData>/lists/allowblock.json`：加载时若字段是 `hosts: string[]`，转成 `entries: [{ kind:'host', value, enabled:true, id }...]`，保存回磁盘。
- `<userData>/lists/ssl-decrypt.json`：同上；缺失 `enabled` 时默认为 `true`。
- 写入时统一新格式；不保留旧字段。

## 匹配语义

给定当前 flow 上下文 `{ host, appName, method, url }`，逐条 entry 判断是否命中：

- `kind='app'`：`entry.value === appName`（大小写敏感，用户抓包 UI 里看到什么就写什么；预留通配 `*` 前后缀）。
- `kind='host'`：沿用现有 `*.foo.com` 后缀通配语义。
- `kind='url'`：
  - `urlMode='glob'`：把 `*` 转为 `.*` 后 `RegExp` 全串匹配（whistle 风格）；匹配对象 `${method} ${fullUrl}`。
  - `urlMode='regex'`：用户直接给正则源（不含 `/`）；`new RegExp(value)` 后 `test(fullUrl)`。正则编译失败则记 warn，视作不匹配。

命中总规则：任一 `enabled` 条目命中即整条 entry-set 命中。

### CONNECT 阶段的 URL 边界

`ssl-list.shouldDecrypt(host)` 在 CONNECT 阶段调用，此时**只知道 host 与 client 端口**，尚不知道后续 URL。此时：

- 只用 `kind='app'` 和 `kind='host'` 条目参与决策。app 通过 `process-lookup` 已可查得。
- `kind='url'` 条目在 CONNECT 阶段**忽略**（等价于"未命中"）。
- 一旦进入 request 阶段（已 MITM 或 HTTP 明文），才用完整 URL 再做一次决策，用于 Allow/Block；SSL 阶段决策不回溯。

在 spec 与代码里这个边界要写清楚，避免用户误以为"URL include 会触发 MITM"。

## 主进程改造

### `electron/engine/allow-block.ts`

- 新增 `entryMatches(entry: FilterEntry, ctx: { host, appName?, method, url }): boolean` 内部函数。
- 更改 `matches` → `matchesCtx(ctx)`；旧 `matches(host)` 保留成简易 shim（内部把 ctx.host 传入，仅 host+app 生效）。
- `decide(ctx)` 签名改为接收 ctx；`plugins.ts:118` 那处调用同步改。
- `load/save` 处理迁移。

### `electron/engine/ssl-list.ts`

- 类似改造；`shouldDecrypt(ctx: { host, appName? })` 明确不消费 URL。
- 新增 `enabled` 字段：`enabled=false` 时 `shouldDecrypt` 恒返回 `false`（等同"关闭 SSL 代理工具"）。

### `electron/proxy/proxy-server.ts`

- `proxy-server.ts:654` 处 `sslList.shouldDecrypt(host)` 改为 `sslList.shouldDecrypt({ host, appName })`（appName 已在同一段代码内从 process-lookup 得到；若拿不到就传 undefined）。

### IPC handler（`main.ts`）

- `allowBlock:get / :set`、`sslList:get / :set` 签名类型改为新 config。渲染层原字段消费点全量更新（见下）。

## 独立窗口

### 生命周期（`electron/windows/filter-config-window.ts`）

- 单例：重复 open 时 `focus()`。
- `BrowserWindow` 参数：`width=760, height=640, minWidth=560, minHeight=420, backgroundColor='#0e0f13', titleBarStyle='hiddenInset'`，主题变量沿用 tailwind `pb-*` 色板。
- 加载：dev 用 `${VITE_DEV_SERVER_URL}#/filter-config`；prod 加载 `dist/index.html#/filter-config`。
- 关闭主窗口不联动关闭此窗口；quit 时统一销毁。
- IPC 新增：`filter-config:open`（主进程内部触发，preload 暴露为 `openFilterConfig()`）。

### 入口 `src/filter-config/main.tsx`

- React root，`<HashRouter>` 匹配 `#/filter-config`；主入口 `<FilterConfigApp />`。
- 不加载完整 flows store，只订阅 `sslList:*` / `allowBlock:*` + 现有已抓包 App 列表（用于 `+` 时下拉选 App）。
- 复用现有 `pb-*` tailwind 主题，与主窗口一致的暗色底。

### 页面结构

```
┌──────────────────────────────────────────────────────┐
│ 过滤配置                                        [ × ] │
├──────────────────────────────────────────────────────┤
│ ┌── SSL 代理列表 ──┬── 允许 / 阻止 ──┐                │
│ │                                                    │
│ │ ☑ 启用 SSL 代理工具                                 │
│ │ 定义 ProxyBaby 解密 HTTPS 的目标（通配符）。        │
│ │ ┌ 包含列表 ┬ 排除列表 ┐                             │
│ │ │ 类型  值                     备注         启用   │
│ │ │ App   Google Chrome                        [x]   │
│ │ │ Host  *.claude.ai                          [x]   │
│ │ │ URL   /api/v1/(users|orders) [regex]       [x]   │
│ │ │ ...                                              │
│ │ └────────────────────────────────────────────┘    │
│ │  [+] [–]                                           │
│ │                                                    │
│ └────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

- 顶部 Tab 二选一：`SSL 代理列表` / `允许 / 阻止`。
- 每个 Tab 内含二级 Tab：SSL → `包含 / 排除`；允许阻止 → `允许 / 阻止 / 关闭`。
- 表格列：`类型 chip` `值` `选项`（URL 有 glob/regex 切换）`备注` `启用`。
- `+` 打开小 Popover：三选一 kind + 值输入 + （URL 时）glob/regex 切换 + 可选备注。
- `-` 删除当前选中行；`Space` 切换 enabled；`Cmd+A` 全选（限当前 Tab）。

### 组件

- `src/filter-config/FilterConfigApp.tsx` — 布局 + Tab 状态。
- `src/filter-config/SslPanel.tsx` — SSL Tab 与 mode 切换（对应总开关 `enabled` + include/exclude 二级 Tab）。
- `src/filter-config/AllowBlockPanel.tsx` — 允许/阻止 Tab 与三态 mode。
- `src/filter-config/EntryTable.tsx` — 表格 + 增删。
- `src/filter-config/EntryEditor.tsx` — Popover 编辑器。
- 复用 `src/lib/ipc.ts`（新增薄封装 `getSsl/setSsl/getAllowBlock/setAllowBlock`）。

## Sidebar 底部 `+` 入口

在 `StatusBar.tsx` 左段搜索输入框**左侧**加入按钮：

```tsx
<button
  data-testid="open-filter-config"
  onClick={() => window.proxybaby.invoke('filter-config:open')}
  title="打开过滤配置"
  className="pb-btn px-1.5 py-0.5"
>
  <Plus size={12} />
</button>
```

不新增任何布局层级（不动 Sidebar.tsx，因为搜索栏本身就住在 StatusBar 里）。

## 与现有 SettingsView 的关系

- 从 `SettingsView.tsx` 中移除 `<AllowBlockPanel />` 和 `<SslListPanel />`，替换为一段小提示：`过滤配置已迁移至左下角 + 按钮`（附一个"立即打开"链接调 `filter-config:open`）。
- 保留 AI / 脚本 / 网络 / 上游代理 面板。

## 测试

### unit（vitest）

- `tests/unit/filter-entry-match.test.ts`
  - `app` 精确匹配；不区分大小写策略（先默认区分，测里断言）。
  - `host` 通配 `*.a.com` 命中 `x.a.com` 与 `a.com`；不命中 `xa.com`。
  - `url` glob：`https://*.foo.com/api/*` 命中/未命中样例。
  - `url` regex：正则源含未转义 `.` 时的表现；坏正则不抛异常。
  - CONNECT 场景下 `url` 条目一律视为未命中。
- `tests/unit/config-migration.test.ts`
  - 旧 `{ hosts: ['a.com'] }` 加载 → `entries: [{ kind:'host', value:'a.com', enabled:true }]`。
  - 加载后二次保存磁盘为新格式。
  - `SslDecryptConfig.enabled` 缺失时默认 `true`。

### integration（vitest）

- `tests/integration/allow-block-app.test.ts`
  - 起真实上游 + ProxyServer；模拟 flow.app.name（用 `PROXYBABY_E2E` 注入 fake process-lookup）；断言 `kind='app'` 的 block 生效。
- `tests/integration/ssl-list-url-boundary.test.ts`
  - `include` 模式下只放了一条 `kind='url'` 白名单，请求 https://foo.com/xxx 应**不被 MITM**（CONNECT 阶段决策不看 URL），走隧道透传。

### e2e（Playwright）

- `tests/e2e/filter-config.e2e.ts`
  - 点击 `data-testid="open-filter-config"` → 出现第二个 Electron BrowserWindow。
  - 在 SSL Tab 添加一条 `kind='host'`，`.proxybaby/lists/ssl-decrypt.json` 落盘正确。
  - 关闭独立窗口后主窗口正常。

## 迁移与兼容

- 用户升级后老配置自动升级为新格式；旧字段 `hosts` 在新代码中不再被读取。
- 官方 CLI（`bin/proxybaby.cjs`）若曾用 `sslList:*` 参数发命令，需要更新 payload 结构；本 spec 附带更新 CLI，但**保留一段读 payload 时兼容旧字段的桥**（收到 `hosts` 数组时转 entries），避免旧脚本失效。
- 无 UI 层面自动打开引导，只在设置页留提示。

## 里程碑（供 writing-plans 拆分）

1. **数据结构与迁移**：`shared/types.ts` + `allow-block.ts` / `ssl-list.ts` 支持新 entries + 磁盘迁移；含 unit test。
2. **主进程 & proxy 消费点更新**：`plugins.ts`、`proxy-server.ts` 改签名；`main.ts` IPC 类型；含 integration test。
3. **独立窗口壳**：`filter-config-window.ts` + 新 vite entry + preload 暴露 `filter-config:open`。
4. **UI 面板**：SslPanel / AllowBlockPanel / EntryTable / EntryEditor；从 SettingsView 移除对应面板。
5. **Sidebar `+` 入口**：StatusBar 加按钮 + e2e。
6. **CLI 兼容桥**：`bin/proxybaby.cjs` payload 升级。

## 风险

- **CONNECT 边界易被误解**：需要在 SSL Tab 顶部加一段说明"URL 类目仅影响进入后的允许/阻止，不影响是否解密"，并在文档里显式写明。
- **App 匹配依赖 process-lookup 命中率**：`lsof` 反查在部分场景（短连接、UDP）可能取不到，此时 `kind='app'` 条目对该 flow 无效——测试里要覆盖 `appName=undefined` 路径。
- **进程名同名冲突**：设计中已知问题，v1 不解决；后续若上 bundle id，只加字段不破坏 schema。
- **正则 DoS**：用户可能写出灾难回溯正则；MVP 不设时间预算，仅用 try/catch；若线上出现问题再引入 `re2` 或 timeout。
