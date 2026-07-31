# /release — 一键发包（AI 全自动，无需确认）

一键为 ProxyBaby 发新版：**AI 分析 `git log` 自动决定版本号 + 起草 changelog → 直接 commit → tag → push → GitHub Actions 打包发布**。

⚡ **全自动**：不问用户确认，一路跑到底。除非前置检查失败（工作区脏 / 不在 main / 落后 origin），否则不停下来。用户想要中间确认？用 `--dry` 或 `/release-dry`。

## 命令参数

```bash
/release                          # 全自动
/release patch                    # 强制 patch，其余全自动
/release minor
/release major
/release "自定义 changelog 描述"    # 用户直接给 changelog，AI 只判断 bump
/release patch "自定义描述"        # 全部指定
/release --dry                    # 只本地更新 package.json + CHANGELOG.md，不 tag/push（让用户查看）
```

**关键设计**：不用手写 changeset，一切基于 commit history。

## 执行步骤（严格按顺序，无中间停顿）

### 0. 前置检查

```bash
git status --porcelain            # 必须空
git rev-parse --abbrev-ref HEAD   # 必须是 main
git fetch origin main
git rev-list --count HEAD..origin/main   # 必须 0（本地不落后 origin）
```

任一失败 → 打印原因 + 中止（这是唯一会中断的场景）。

### 1. 提取 commit range

```bash
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  COMMITS=$(git log --no-merges --pretty=format:'%h|%s|%b---END---' "$LAST_TAG..HEAD")
else
  COMMITS=$(git log --no-merges --pretty=format:'%h|%s|%b---END---')
fi
```

如果 `$COMMITS` 空（没有新提交），报错中止。

### 2. AI 分析 commits 决定 bump 类型

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

### 3. AI 起草 changelog

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

### 4. 保存 changelog 到临时文件

```bash
NOTES_FILE=$(mktemp -t proxybaby-notes-XXXX.md)
cat > "$NOTES_FILE" <<'EOF'
<刚才起草的内容>
EOF
```

### 5. 直接跑 release 脚本（不停下）

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

### 6. 打印结果

```
✅ 已发布 v<NEW_VERSION>
   Tag pushed to origin. GitHub Actions release workflow is now building
   dmg (macOS) + exe/zip (Windows) + AppImage/deb (Linux).

   Watch:   gh run watch --repo imcuttle/proxybaby --exit-status
   Release: https://github.com/imcuttle/proxybaby/releases/tag/v<NEW_VERSION>
```

## 完整示例（现在只跑一次，从头跑到底）

```
用户: /release

AI: 前置检查通过（干净、main、同步）
    ↓
    自 v0.1.0 以来 8 个 commits，检测到 feat → 决定 minor (0.1.0 → 0.2.0)
    ↓
    起草 changelog、写入 /tmp/proxybaby-notes-xxxx.md
    ↓
    node scripts/release.mjs --type minor --notes /tmp/proxybaby-notes-xxxx.md
    ✏️ package.json + CHANGELOG.md updated
    $ git add ...
    $ git commit ...
    $ git push origin main
    $ git tag v0.2.0
    $ git push origin v0.2.0
    ↓
    ✅ 已发布 v0.2.0
       https://github.com/imcuttle/proxybaby/releases/tag/v0.2.0
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

## 常见坑

- **npm 装依赖失败 (esbuild optional deps)**：CI 用 `npm install --no-audit --no-fund` 兜底，不用 `npm ci`
- **vite build OOM**：`NODE_OPTIONS='--max-old-space-size=8192'` 已在 workflow 里
- **electron-builder 找不到签名证书**：workflow 已用 `-c.mac.identity=null` 出未签名版
- **workflow 没触发**：确认 tag 是 `v` 开头
- **AI 拿 conventional commits 拿不准 bump**：保守选 patch
