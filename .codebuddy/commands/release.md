# /release — 一键发包（AI 自动分析 commit）

一键为 ProxyBaby 发新版：**AI 分析 `git log` 自动决定版本号 + 起草 changelog** → commit → tag → push → GitHub Actions 打包发布。

**这是一次真正的发布动作，会 push 到 origin/main 和创建 tag，触发 CI 打包 DMG/zip 并创建 GitHub Release。执行前必须与用户确认。**

## 命令参数

```bash
/release                          # 全自动：AI 分析 commit 决定 bump + 起草 changelog，用户确认后发布
/release patch                    # 强制 patch，AI 只负责起草 changelog
/release minor
/release major
/release "自定义 changelog 描述"    # 用户直接给 changelog，AI 只判断 bump
/release patch "自定义描述"        # 全部指定
```

**关键设计**：不用手写 changeset，一切基于 commit history。

## 执行步骤（严格按顺序）

### 0. 前置检查

```bash
git status --porcelain            # 必须空
git rev-parse --abbrev-ref HEAD   # 必须是 main
git fetch origin main
git rev-list --count HEAD..origin/main   # 必须 0（本地不落后 origin）
```

任一失败 → 打印原因 + 中止。

### 1. 拿到上一个 release tag + 提取 commit range

```bash
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
CURR_VERSION=$(node -p "require('./package.json').version")

# 提取自上次发版以来的所有 commits
if [ -n "$LAST_TAG" ]; then
  git log --no-merges --pretty=format:'%h|%s|%b---END---' "$LAST_TAG..HEAD"
else
  git log --no-merges --pretty=format:'%h|%s|%b---END---'
fi
```

### 2. AI 分析 commits 决定 bump 类型

**规则（Conventional Commits）**：

| commit 前缀 | bump |
|---|---|
| `feat!:` / `fix!:` / body 含 `BREAKING CHANGE:` | **major** |
| `feat:` / `feat(scope):` | **minor** |
| `fix:` / `perf:` / `refactor:` | **patch** |
| `chore:` / `docs:` / `test:` / `ci:` / `style:` | 通常不触发发版；如果只有这些，问用户"确定要发新版吗？" |

如果 commit 不用 Conventional Commits：
- 从 subject 里找关键词判断（"新增"/"支持" → feat；"修复"/"fix" → patch；"重构"/"废弃"/"不兼容" → 考虑 major）
- 拿不准 → 保守选 patch

**除非用户在参数里已经指定了 bump，否则做完分析后要向用户确认。**

### 3. AI 起草 changelog

把 commits 分类整理成 markdown。示例结构：

```markdown
### ✨ 新功能
- feat(rules): 支持正则表达式 pattern (`abc123`)
- feat(ui): 添加 Diff 视图右键菜单 (`def456`)

### 🐛 修复
- fix(proxy): SSE 帧跨 chunk 时丢帧 (`ghi789`)

### 🔧 其他
- refactor(engine): 抽取 middleware helper (`jkl012`)
- chore: bump electron to 32.4 (`mno345`)
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

**每条 commit 尾巴带 `(hash)` 让用户能查到。** commit message 中的 subject 如果太长（> 80 字）可以在 changelog 里精简。

用户如果自己传了 changelog 描述，AI 就用他的，不要重写。

### 4. 保存 changelog 草稿到临时文件 + 展示给用户

```bash
NOTES_FILE=$(mktemp -t proxybaby-notes-XXXX.md)
cat > "$NOTES_FILE" <<'EOF'
<刚才起草的内容>
EOF
```

展示给用户：
```
→ Bump: 0.1.0 → 0.1.1 (patch)
→ Changelog:
    <草稿>
→ NOTES_FILE: /tmp/proxybaby-notes-xxxx.md

是否发布？可以让我：
  ✅ 直接发（yes / y）
  📝 让我编辑一下 changelog（说 "改一下: xxx"）
  🔀 换 bump 类型（说 "改成 minor"）
  ❌ 取消（no / n）
```

**必须等用户明确 yes 才继续**。用户如果说"改一下 X"，AI 就在 `$NOTES_FILE` 里编辑后重新展示。

### 5. 一条命令完成 bump + commit + tag + push

```bash
node scripts/release.mjs --type <BUMP> --notes "$NOTES_FILE"
```

这个脚本会：
1. 再次确认 workspace 干净、在 main 分支
2. bump `package.json` 的 version
3. 把 changelog 段落 prepend 到 `CHANGELOG.md`
4. `git commit -m "chore: release vX.Y.Z"`
5. `git push origin main`
6. `git tag vX.Y.Z && git push origin vX.Y.Z`
7. 输出 CI 追踪命令

先跑一次 `--dry` 让用户预览也可以：
```bash
node scripts/release.mjs --type patch --notes "$NOTES_FILE" --dry
git diff package.json CHANGELOG.md    # 让用户看
git checkout package.json CHANGELOG.md  # 回滚（如果用户不满意）
```

### 6. 跟踪 CI

```bash
sleep 6
gh run list --repo imcuttle/proxybaby --limit 2 --json databaseId,name,status,conclusion,headBranch
# 或
gh run watch --repo imcuttle/proxybaby --exit-status
```

CI 通过后：
```bash
gh release view "v$NEW_VERSION" --repo imcuttle/proxybaby
```
给用户 release 链接：`https://github.com/imcuttle/proxybaby/releases/tag/v$NEW_VERSION`

## 完整示例

```
用户: /release

AI: 让我看看自上次 v0.1.0 以来有什么改动…

    → 最近 8 个 commits:
      abc1234 feat(rules): 支持正则 pattern
      def5678 fix(sse): 帧跨 chunk 丢字节
      ghi9012 refactor(engine): 抽 middleware helper
      jkl3456 docs: 更新 README
      ... (4 more)

    → 我建议：0.1.0 → 0.2.0（minor：包含 feat）

    → Changelog 草稿：
      ### ✨ 新功能
      - feat(rules): 支持正则表达式 pattern (`abc1234`)
      ### 🐛 修复
      - fix(sse): SSE 帧跨 chunk 时丢字节 (`def5678`)
      ### ♻️ 重构
      - refactor(engine): 抽取 middleware helper (`ghi9012`)
      ### 📝 文档
      - docs: 更新 README (`jkl3456`)

    确认发 v0.2.0？

用户: yes

AI: [跑 node scripts/release.mjs --type minor --notes /tmp/xxx.md]
    ✅ 已 push v0.2.0，CI 正在打包，5 分钟内会出现在 releases 页。
```

## 回滚

CI 挂了 / 需要重发：

```bash
git tag -d v<VER>
git push origin :refs/tags/v<VER>
gh release delete v<VER> --repo imcuttle/proxybaby --yes || true
# 修好之后再重新
git tag v<VER> && git push origin v<VER>   # 直接复用同一个 tag，不用改版本号
```

## 常见坑

- **npm 装依赖失败 (esbuild optional deps)**：CI 已用 `npm install --no-audit --no-fund` 兜底，不用 `npm ci`
- **vite build OOM**：`NODE_OPTIONS='--max-old-space-size=8192'` 已在 workflow 里
- **electron-builder 找不到签名证书**：workflow 已用 `-c.mac.identity=null` 出未签名版
- **workflow 没触发**：确认 tag 是 `v` 开头
- **AI 拿 conventional commits 拿不准 bump**：保守选 patch，让用户 override
