# /release — 一键发包

一键为 ProxyBaby 发新版：写 changeset → apply → commit → tag → push → GitHub Actions 打包发布。

**这是一次真正的发布动作，会 push 到 origin/main 和创建 tag，触发 CI 打包 DMG/zip 并创建 GitHub Release。执行前必须与用户确认。**

## 命令参数

```bash
/release                          # 交互式：会问 major/minor/patch + 说明
/release patch "修复 xxx bug"     # 直接指定
/release minor "新增 xxx 功能"
/release major "重大不兼容变更"
```

## 执行步骤（严格按顺序）

按下面顺序做，每一步失败就停下来问用户：

### 0. 前置检查（**必做**）

```bash
# 1) 工作区必须干净
git status --porcelain
#    → 有输出？先提示用户 commit / stash，中止发版

# 2) 必须在 main 分支且与 origin/main 同步
git rev-parse --abbrev-ref HEAD           # 应该是 main
git fetch origin main
git rev-list --count HEAD..origin/main    # 应该是 0（本地不落后）
git rev-list --count origin/main..HEAD    # 应该是 0（本地不领先）

# 3) 拿到当前版本 + 显示上一版 changelog 头，供用户核对
node -p "require('./package.json').version"
head -20 CHANGELOG.md
```

任一失败 → 打印原因 + 中止。

### 1. 与用户确认

用 AskUserQuestion（或直接问，视上下文而定）：
- **bump 类型**：patch / minor / major（除非命令参数已给）
- **changelog 描述**：一句话/多行；如果用户没给，就基于最近的 `git log <prev-tag>..HEAD --oneline` 生成一份草稿让用户确认

只有用户明确同意后再往下走。

### 2. 生成 changeset

```bash
# 把描述写成 .changeset/<hash>.md
cat > .changeset/$(date +%s)-release.md <<EOF
---
"proxybaby": <BUMP_TYPE>
---

<用户给的 changelog 内容>
EOF
```

### 3. 消费 changeset → 更新版本 + CHANGELOG

```bash
npx changeset version
```

这一步会：
- 根据 `.changeset/*.md` 更新 `package.json` 的 `version`
- 追加到 `CHANGELOG.md`
- 删除已消费的 changeset 文件

**立刻读一次新版本号并告知用户**：
```bash
NEW_VERSION=$(node -p "require('./package.json').version")
echo "→ New version: v$NEW_VERSION"
head -30 CHANGELOG.md
```

再问用户一次：**"确认发布 v$NEW_VERSION 吗？"** 用户说 yes 才继续。

### 4. Commit + push main

```bash
git add package.json CHANGELOG.md .changeset
git commit -m "chore: release v$NEW_VERSION"
git push origin HEAD
```

### 5. 打 tag + push tag（**这一步真正触发发布**）

```bash
git tag "v$NEW_VERSION"
git push origin "v$NEW_VERSION"
```

告诉用户：GitHub Actions release workflow 已被触发，会：
- 在 `macos-latest` 上跑 `npm ci` → typecheck → unit tests → `vite build` → `electron-builder --mac dmg zip`
- 从 `CHANGELOG.md` 抽出 v$NEW_VERSION 段作为 release notes
- `gh release create v$NEW_VERSION` 上传 dmg/zip/blockmap/latest-mac.yml

### 6. 监控发布进度（可选）

```bash
sleep 5
gh run list --repo imcuttle/proxybaby --limit 3 --json databaseId,name,event,status,conclusion,headBranch
# 或直接跟着看：
# gh run watch --exit-status
```

跑完后：
```bash
gh release view "v$NEW_VERSION" --repo imcuttle/proxybaby
```
给用户 release 页面链接：`https://github.com/imcuttle/proxybaby/releases/tag/v$NEW_VERSION`

## 回滚

如果 CI 挂了/需要重发：

```bash
# 删本地/远端 tag
git tag -d v<VER>
git push origin :refs/tags/v<VER>
# 删 release（如果建过）
gh release delete v<VER> --repo imcuttle/proxybaby --yes || true
# 修完再重新 tag / push
git tag v<VER> && git push origin v<VER>
```

## 常见坑

- **npm ci 报 lockfile 不同步**：先本地 `rm -rf node_modules package-lock.json && npm install`，把 lock 提交后再重打 tag
- **electron-builder 需要 code sign**：workflow 已经用 `CSC_IDENTITY_AUTO_DISCOVERY=false` + `-c.mac.identity=null` 出未签名版本，用户首次打开时需要在系统设置里放行
- **workflow 没被触发**：确认 tag 是 `v` 开头（`v0.2.0` 而不是 `0.2.0`）
- **changeset 目录里有旧文件**：`npx changeset version` 会一起消费掉，如果只想发某一部分，先手动挪走无关的 `.changeset/*.md`
