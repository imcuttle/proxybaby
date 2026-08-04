# /release — 一键发包（AI 全自动，无需确认）

一键为 ProxyBaby 发新版：**AI 先把工作区里所有 pending 改动按主题分组 commit → 分析 `git log` 自动决定版本号 + 起草 changelog → tag → push → GitHub Actions 打包发布**。

⚡ **全自动**：不问用户确认，一路跑到底。除非前置检查失败（不在 main / 落后 origin），否则不停下来。用户想要中间确认？用 `--dry` 或 `/release-dry`。

`/release` 现在包含 **commit 阶段 + release 阶段** 两段：工作区脏也能直接跑，AI 会先把改动按主题拆分成合理的 commits，再进入发布流程。

## 命令参数

```bash
/release      # 全自动（脏工作区也可以）
/release patch      # 强制 patch，其余全自动
/release minor
/release major
/release "自定义 changelog 描述"    # 用户直接给 changelog，AI 只判断 bump
/release patch "自定义描述"        # 全部指定
/release --dry        # 只本地更新 package.json + CHANGELOG.md，不 tag/push（让用户查看）
/release --skip-commit            # 跳过 commit 阶段（要求工作区干净）
```

**关键设计**：不用手写 changeset，一切基于 commit history；工作区脏了 AI 自己 commit。

## 执行步骤（严格按顺序，无中间停顿）

### 0. 前置检查

```bash
git rev-parse --abbrev-ref HEAD   # 必须是 main
git fetch origin main
git rev-list --count HEAD..origin/main   # 必须 0（本地不落后 origin）
```

**不再要求工作区干净** —— pending 改动会在第 1 步 commit 掉。任一其他检查失败 → 打印原因 + 中止。

传了 `--skip-commit` 时，工作区必须干净，否则中止。

### 1. Commit 阶段：把工作区 pending 改动分主题 commit

```bash
git status --porcelain
```

**如果工作区干净 → 直接跳到第 2 步。**

否则 AI 分析所有 modified / untracked 文件，按下面的原则分组：

#### 1.1 分组原则

- **按功能主题分组**，不按文件类型或时间顺序。目标是每个 commit 讲一个清晰的故事。
- **典型主题**（按 ProxyBaby 的模块结构）：
  - `feat(system|proxy): ...` — 主进程代理引擎、system 集成（app-lookup / system-proxy / mitm）
  - `feat(rules): ...` — engine/rule-*、operators、plugins、Rule Debug/Quick Input 相关 UI
  - `feat(ui): ...` — 通用组件、Monaco 编辑器、tooltip、样式
  - `feat(app): ...` — 应用级设施（updater、logger、菜单栏、独立子窗口 route）
  - `feat(ai): ...` — AI 侧边栏、Chat/Session 视图、parsers
  - `fix(...): ...` — 明确的 bug 修复；标题里点明现象+根因
  - `test: ...` — 测试专属改动（新增 spec / harness 抽取 / mock 增强）
  - `chore(integration): ...` — 只是把新特性接入主流程的连线代码（IPC 桥、类型、路由、主进程 wire-up）—— 拆不动的跨切文件放这里
  - `docs: ...` / `docs(screenshots): ...`
- **每个 commit 尽量能独立 typecheck**。跨切文件（`shared/types.ts` / `electron/main.ts` / `electron/preload.ts` / `src/App.tsx`）如果同时被多个主题触碰，一般集中到一个 `chore(integration)` commit，不硬拆。
- **测试文件跟对应功能同一 commit**（回归 + 覆盖捆绑在一起）。**独立新增的 e2e harness / spec 拆分** 才单独走 `test:` commit。
- 图片/screenshot 单独 `docs(screenshots)` commit。
- **锁文件（package-lock.json）跟 package.json 走同一个 commit。**

#### 1.2 分组算法

1. 列出所有变更文件：`git status --porcelain`
2. 用 `git diff --stat HEAD` 看规模，识别大改动集中在哪些模块
3. 对不确定的文件用 `git diff HEAD -- <file> | head -80` 采样，判定主题归属
4. 输出分组计划（每个 commit 的：type/scope、要包含哪些文件、简要说明）
5. **不 ask user 确认，直接开始 commit**

#### 1.3 commit 提交

对每一组：

```bash
git add <file1> <file2> ...
git commit -m "$(cat <<'EOF'
<type>(<scope>): <一句话概括>

<空行 + 详细正文：为什么改 / 怎么改 / 影响什么 / 覆盖了哪些测试>
关键点用短划线列出，中文，尽量点明 root cause。
EOF
)"
```

**commit message 规范**：
- 首行 `<type>(<scope>): <subject>`，遵循 Conventional Commits。中文 subject OK，type/scope 用英文。
- 首行 ≤ 80 字符能读清即可，不硬凑。
- **正文必写**：解释「为什么」而不是「改了什么」（后者看 diff 就知道）。修复类必须点明现象 + 根因。
- **不要**加"🤖 Generated with"之类的尾巴，也不 sign-off。

#### 1.4 跨切文件的处理

`shared/types.ts` / `electron/main.ts` / `electron/preload.ts` / `src/App.tsx` 常被多个特性同时改：

- 优先方案：**集中到最后一个 `chore(integration)` commit**，把所有新特性的类型/IPC/路由/wiring 一次性接入。
- 次优方案：如果某个特性 90% 独占某文件的改动，就跟着那个 feat commit 走，不追求纯洁。
- 不要用 `git add -p` 拆 hunk，太慢且易碎。

#### 1.5 commit 完成后的确认

```bash
git status --porcelain         # 必须空
npm run typecheck 2>&1 | tail -5  # 最后一个 commit 后必须 pass
```

typecheck 失败 → **中止 release**，让用户看错误自己修（这时 commits 已在本地，用户可以 `git reset --mixed <first-new-commit>^` 回滚）。

### 2. 提取 commit range

```bash
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  COMMITS=$(git log --no-merges --pretty=format:'%h|%s|%b---END---' "$LAST_TAG..HEAD")
else
  COMMITS=$(git log --no-merges --pretty=format:'%h|%s|%b---END---')
fi
```

如果 `$COMMITS` 空（没有新提交），报错中止。

### 3. AI 分析 commits 决定 bump 类型

**规则（Conventional Commits）**：

| commit 前缀 | bump |
|---|---|
| `feat!:` / `fix!:` / body 含 `BREAKING CHANGE:` | **major** |
| `feat:` / `feat(scope):` | **minor** |
| `fix:` / `perf:` / `refactor:` | **patch** |
| `chore:` / `docs:` / `test:` / `ci:` / `style:` | **patch**（不再问用户，最小 bump） |

如果 commit 不用 Conventional Commits：
- 从 subject 里找关键词判断（"新增"/"支持" → feat；"修复"/"fix" → patch；"重构"/"废弃"/"不兼容" → major）
- 拿不准 → 保守选 patch

**如果用户在参数里指定了 bump，直接用；否则用上面的规则自动定。不问用户。**

### 4. AI 起草 changelog

把 commits 分类整理成 markdown：

```markdown
### ✨ 新功能
- feat(rules): 支持正则表达式 pattern (`abc123`)
- feat(ui): 添加 Diff 视图右键菜单 (`def456`)

### 🐛 修复
- fix(proxy): SSE 帧跨 chunk 时丢帧 (`ghi789`)

### 🔧 其他
- refactor(engine): 抽取 middleware helper (`jkl012`)
```

分类映射：
- `feat` → ✨ 新功能
- `fix` → 🐛 修复
- `perf` → ⚡ 性能
- `refactor` → ♻️ 重构
- `docs` → 📝 文档
- `test` → 🧪 测试
- `ci` / `build` → 👷 CI/构建
- 其他 → 🔧 其他

每条 commit 尾巴带 `` (`hash`) `` 让用户能查到。commit subject 太长（> 80 字）就精简。

用户如果自己传了 changelog 描述，就用他的，不要重写。

### 5. 保存 changelog 到临时文件

```bash
NOTES_FILE=$(mktemp -t proxybaby-notes-XXXX.md)
cat > "$NOTES_FILE" <<'EOF'
<刚才起草的内容>
EOF
```

### 6. 直接跑 release 脚本（不停下）

```bash
node scripts/release.mjs --type <BUMP> --notes "$NOTES_FILE"
```

这个脚本会：
1. 再次校验 workspace 干净、在 main 分支
2. bump `package.json` 的 version
3. 把 changelog 段落 prepend 到 `CHANGELOG.md`
4. `git commit -m "chore: release vX.Y.Z"`
5. `git push origin main`
6. `git tag vX.Y.Z && git push origin vX.Y.Z`
7. tag 一到 GitHub，Actions release workflow 会自动打包三平台产物 + 建 GitHub Release

**注意**：`--dry` 模式下只跑到步骤 3 就停下，让用户查看 `git diff` 再自己决定 commit/push。

### 7. 打印结果

```
✅ 已发布 v<NEW_VERSION>
   Tag pushed to origin. GitHub Actions release workflow is now building
   dmg (macOS) + exe/zip (Windows) + AppImage/deb (Linux).

   Watch:   gh run watch --repo imcuttle/proxybaby --exit-status
   Release: https://github.com/imcuttle/proxybaby/releases/tag/v<NEW_VERSION>
```

## 完整示例：脏工作区 + 一次搞定

```
用户: /release

AI: 前置检查通过（main / 同步 origin）
    ↓ 工作区脏（36 modified + 17 untracked）
    分析改动，按主题分成 7 个 commits：
      1. fix(system,proxy): MITM App 来源识别 + 系统代理还原
      2. feat(rules): Rule Debug 独立窗口 + 规则 normalize + 中间件 trace
      3. feat(app): 应用内自动更新 + 统一 logger + 原生菜单栏
      4. feat(ui): Monaco headers/body 编辑器 + AppInfo tooltip
      5. chore(integration): updater/rule-debug/menu/UI 接入主流程
   6. test(e2e): _shared 启动器 + updater/rule-debug/菜单栏 覆盖
      7. docs(screenshots): 重新截图
    ↓ 各自 git add + commit（跳过 -p 拆 hunk）
    ↓ typecheck 通过
    ↓
    自 v0.7.0 以来 7 个 commits，检测到 3 个 feat → 决定 minor (0.7.0 → 0.8.0)
    ↓
    起草 changelog、写入 /tmp/proxybaby-notes-xxxx.md
    ↓
    node scripts/release.mjs --type minor --notes ...
    ✏️ package.json + CHANGELOG.md updated
    $ git commit -m "chore: release v0.8.0"
    $ git push origin main
    $ git tag v0.8.0 && git push origin v0.8.0
    ↓
    ✅ 已发布 v0.8.0
       https://github.com/imcuttle/proxybaby/releases/tag/v0.8.0
```

## 回滚

CI 挂了 / 需要重发：

```bash
git tag -d v<VER>
git push origin :refs/tags/v<VER>
gh release delete v<VER> --repo imcuttle/proxybaby --yes || true
# 修好之后再重新
git tag v<VER> && git push origin v<VER>
```

如果连 commit 阶段都想撤销：

```bash
git reset --mixed <last-tag>       # 例：git reset --mixed v0.7.0
# 改动回到工作区，AI 打的 commits 全部撤销，可以重新 /release
```

## 常见坑

- **commit 阶段跨切文件识别错**：AI 会把某文件（如 shared/types.ts）分到错误的主题。用 `git reset --mixed HEAD~N` 回滚指定数量的 commits 后重新 `/release`。
- **typecheck 失败卡在 commit 阶段末尾**：意味着 AI 分组时把某个类型定义跟它的使用方拆到了不同 commit。修好之后再手动 amend 或重新 commit。
- **npm 装依赖失败 (esbuild optional deps)**：CI 用 `npm install --no-audit --no-fund` 兜底，不用 `npm ci`
- **vite build OOM**：`NODE_OPTIONS='--max-old-space-size=8192'` 已在 workflow 里
- **electron-builder 找不到签名证书**：workflow 已用 `-c.mac.identity=null` 出未签名版
- **workflow 没触发**：确认 tag 是 `v` 开头
- **AI 拿 conventional commits 拿不准 bump**：保守选 patch
