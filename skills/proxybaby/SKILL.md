---
name: proxybaby
description: 通过 `proxybaby` CLI 控制本机 ProxyBaby 抓包 app（启动/关闭、代理开关、录制开关、规则 CRUD、插件启停）。用于让 AI 自主管理抓包会话、注入 mock 规则、改写请求响应、验证接口行为等。
---

# ProxyBaby AI Skill

允许 AI 通过 shell 命令 `proxybaby` 控制运行在本机的 ProxyBaby 抓包 app。

## 前置条件

- app 至少启动过一次（会自动生成 `~/.proxybaby/cli-token`）。
- app 未运行时可 `proxybaby app open` 启动。

## 命令速查

```bash
# 状态
proxybaby status

# app 生命周期
proxybaby app open        # 启动（已运行则前置窗口）
proxybaby app quit

# 系统代理
proxybaby proxy on
proxybaby proxy off

# 记录
proxybaby record on
proxybaby record off
proxybaby record clear    # 清空已抓包列表

# 规则（whistle 兼容语法）
proxybaby rule list
proxybaby rule show <id>
proxybaby rule add <name> --file <path>          # 从文件读入规则文本
proxybaby rule add <name> --text "<inline>"      # 内联规则文本
proxybaby rule add <name> --file rules.txt --disabled
proxybaby rule update <id> --name <n> --file <p> [--enabled|--disabled]
proxybaby rule remove <id>
proxybaby rule enable <id>
proxybaby rule disable <id>

# 插件
proxybaby plugin list
proxybaby plugin enable <id>
proxybaby plugin disable <id>
```

## 规则语法（whistle 兼容子集）

每行一条规则：`<pattern> <op1>[://value] [op2 ...]`

- pattern：URL 前缀（`https://api.example.com/foo`）/ host 前缀（`example.com/api`）/ 通配（`*.example.com/*`）/ 正则（`/foo\/(\d+)/`）
- operator 常用：
  - `statusCode://500`
  - `redirect://https://other.example.com`
  - `abort`
  - `reqHeaders://{"X-Foo":"bar"}` / `resHeaders://{"X-Foo":"bar"}`
  - `reqBody://hello`（替换请求体）
  - `resBody://{"code":0}`（替换响应体）
  - `host://127.0.0.1:8080`（改上游）
  - `file:///abs/path/mock.json`（用本地文件作为响应体）
  - `mock://{"ok":true}`（直接以 JSON 短路响应）
  - `reqDelay://1000` / `resDelay://500`
  - `ua://custom-agent` / `referer://https://ref`
  - `log`

## 常见任务示例

### 1. Mock 一个 API 返回

创建一条规则，让 `https://api.example.com/user` 直接返回本地 JSON：

```bash
proxybaby rule add mock-user --text 'api.example.com/user file:///tmp/user.json'
```

### 2. 短路返回内联 JSON

```bash
proxybaby rule add fake-login --text 'api.example.com/login mock://{"token":"xxx","ok":true}'
```

### 3. 拦截并改 header

```bash
proxybaby rule add force-auth --text '*.internal.com/* reqHeaders://{"Authorization":"Bearer test"}'
```

### 4. 把线上流量重定向到本地

```bash
proxybaby rule add local-dev --text 'api.example.com host://127.0.0.1:3000'
```

### 5. 模拟 500 错误

```bash
proxybaby rule add flaky --text 'api.example.com/checkout statusCode://500'
```

### 6. 停止抓包并清理

```bash
proxybaby record off
proxybaby record clear
```

### 7. 从多规则文件加载

```bash
cat > /tmp/rules.txt <<'EOF'
# 拦截并返回 mock
api.example.com/user  file:///tmp/user.json
api.example.com/list  mock://{"items":[]}

# 把域名劫持到本地
*.internal.com  host://127.0.0.1:3000  reqHeaders://{"X-Env":"dev"}
EOF
proxybaby rule add dev-suite --file /tmp/rules.txt
```

### 8. 排查真实请求 / 响应

```bash
proxybaby app open                # 打开 UI 查看列表
proxybaby record on
# 用户操作触发请求后
proxybaby status                  # 查看当前状态摘要
```

## 输出格式

- 大部分命令返回 JSON，可用 `jq` 继续处理。
- `rule list` / `plugin list` 返回精简列表；`● 启用 / ○ 停用`。

## 边界

- 目前仅 macOS 支持完整功能（系统代理设置依赖 `networksetup`）。
- 首次启动 app 会请求管理员密码（安装 CA 到系统钥匙串），CLI 无法代替此步骤。
- CLI token 位于 `~/.proxybaby/cli-token`，泄露即可控制 app，注意保护。
