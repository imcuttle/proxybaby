#!/usr/bin/env node
/**
 * 本地 release 命令：把 pending changesets 消费掉，更新 package.json 版本 + CHANGELOG.md，
 * 提交后打 tag 并 push tag —— CI 上的 release workflow 收到 tag 后开始打包 & 发 GitHub Release。
 *
 * 运行前提：
 *   1. .changeset/*.md 里至少有一个 changeset（`npx changeset` 生成）
 *   2. 工作区干净（未提交改动请先 commit / stash）
 *
 * 用法：
 *   npm run release             # 走完整流程
 *   npm run release -- --dry    # 只本地更新版本 + changelog，不打 tag、不 push
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dry = process.argv.includes('--dry');

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function output(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

// 1. workspace clean check
const dirty = output('git status --porcelain');
if (dirty) {
  console.error('❌ Workspace is not clean. Commit or stash your changes first.');
  console.error(dirty);
  process.exit(1);
}

// 2. 有 changeset 吗？
const csDir = path.resolve('.changeset');
const pending = fs.readdirSync(csDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
if (pending.length === 0) {
  console.error('❌ No pending changesets. Run `npx changeset` first to describe the release.');
  process.exit(1);
}

// 3. changeset version → 更新 package.json + CHANGELOG.md，删掉 consumed changesets
run('npx changeset version');

// 4. 读取新版本
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
console.log(`\n→ New version: ${tag}\n`);

if (dry) {
  console.log('DRY mode: stopping here. package.json + CHANGELOG.md updated locally.');
  process.exit(0);
}

// 5. commit
run('git add package.json CHANGELOG.md .changeset');
run(`git commit -m "chore: release ${tag}"`);

// 6. push main first (so tag has a commit visible on origin)
run('git push origin HEAD');

// 7. tag + push tag → 触发 CI release workflow
run(`git tag ${tag}`);
run(`git push origin ${tag}`);

console.log(`\n✅ Pushed ${tag}. GitHub Actions release workflow will build & publish.`);
console.log(`   Watch it: gh run watch --exit-status`);
