#!/usr/bin/env node
/**
 * 本地一键发版：更新 package.json 版本 + CHANGELOG.md，commit，打 tag 并 push tag。
 * push tag 一到，GitHub Actions release workflow 会自动打包 & 建 Release。
 *
 * 通常由 `/release` slash command 调用，AI 会先基于 `git log <lastTag>..HEAD`
 * 分析 commitmsg 自动决定 bump 类型（feat → minor / fix → patch / BREAKING → major），
 * 然后把 changelog 内容写进一个临时文件传进来。
 *
 * 用法：
 *   node scripts/release.mjs --type <patch|minor|major> --notes <path-to-notes.md>
 *   node scripts/release.mjs --type patch --notes /tmp/notes.md --dry
 *
 * --dry: 只本地更新版本 + changelog，不 commit / 不 tag / 不 push。
 *
 * 前提：
 *   1) 工作区干净
 *   2) 在 main 分支且与 origin/main 同步
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const type = flag('type');
const notesPath = flag('notes');
const dry = argv.includes('--dry');

if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('❌ Missing --type <patch|minor|major>');
  console.error('   Usage: node scripts/release.mjs --type patch --notes /tmp/notes.md [--dry]');
  process.exit(1);
}
if (!notesPath || typeof notesPath !== 'string' || !fs.existsSync(notesPath)) {
  console.error(`❌ Missing or invalid --notes <file>: ${notesPath}`);
  process.exit(1);
}

function run(cmd) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit' });
}
function output(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

// 1. clean workspace
if (output('git status --porcelain')) {
  console.error('❌ Workspace is not clean. Commit or stash your changes first.');
  process.exit(1);
}

// 2. on main + synced
const branch = output('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
  console.error(`❌ Not on main (current: ${branch})`);
  process.exit(1);
}
try { execSync('git fetch origin main', { stdio: 'ignore' }); } catch {}
const behind = parseInt(output('git rev-list --count HEAD..origin/main') || '0', 10);
const ahead = parseInt(output('git rev-list --count origin/main..HEAD') || '0', 10);
if (behind > 0) {
  console.error(`❌ Local main is behind origin by ${behind} commit(s). Pull first.`);
  process.exit(1);
}
if (ahead > 0) {
  console.warn(`⚠️  Local main is ahead of origin by ${ahead} commit(s). Push them first? (proceeding — main will be pushed before tag)`);
}

// 3. bump version
const pkgPath = path.resolve('package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
let next;
if (type === 'major') next = `${maj + 1}.0.0`;
else if (type === 'minor') next = `${maj}.${min + 1}.0`;
else next = `${maj}.${min}.${pat + 1}`;

console.log(`\n→ Bump: ${pkg.version} → ${next} (${type})\n`);

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 4. prepend to CHANGELOG.md
const notes = fs.readFileSync(notesPath, 'utf8').trim();
const clPath = path.resolve('CHANGELOG.md');
const oldChangelog = fs.existsSync(clPath) ? fs.readFileSync(clPath, 'utf8') : '# proxybaby\n\n';
// 用行首二级标题 `^## ` 切段（lookahead 保留分隔符不被吃掉）；对每段各自 trimEnd 再拼回。
// 注意：`^## ` 必须严格锚定行首二级标题，避免匹配 `notes` 里的 `### ` 三级标题。
const sections = oldChangelog.split(/\n(?=^## )/m);
const header = sections.shift() ?? '# proxybaby\n';
const newSection = `## ${next}\n\n${notes}`;
const nextChangelog = [header.trimEnd(), newSection, ...sections.map((s) => s.trimEnd())].join('\n\n') + '\n';
fs.writeFileSync(clPath, nextChangelog);

console.log('✏️  package.json + CHANGELOG.md updated.\n');

if (dry) {
  console.log('DRY mode: stopping here. Review the diff and manually commit / tag if needed.');
  process.exit(0);
}

// 5. commit
run('git add package.json CHANGELOG.md');
run(`git commit -m "chore: release v${next}"`);

// 6. push main
run('git push origin HEAD');

// 7. tag + push tag → 触发 CI release workflow
run(`git tag v${next}`);
run(`git push origin v${next}`);

console.log(`\n✅ Pushed v${next}. GitHub Actions release workflow will build & publish.`);
console.log(`   Watch: gh run watch --repo imcuttle/proxybaby --exit-status`);
