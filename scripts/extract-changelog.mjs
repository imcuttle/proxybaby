#!/usr/bin/env node
/**
 * Extract the changelog section for a given version from CHANGELOG.md.
 * Usage: node scripts/extract-changelog.mjs 0.1.0
 * Prints the section (without the version header) to stdout.
 */
import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('Usage: extract-changelog.mjs <version>');
  process.exit(1);
}

const p = path.resolve(process.cwd(), 'CHANGELOG.md');
if (!fs.existsSync(p)) {
  console.log(`Release v${version}`);
  process.exit(0);
}

const md = fs.readFileSync(p, 'utf8');
// Changesets writes: `## 0.1.0` sections
const re = new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}\\b[\\s\\S]*?(?=^##\\s+\\d|\\Z)`, 'm');
const m = md.match(re);
if (!m) {
  console.log(`Release v${version}`);
  process.exit(0);
}
// strip the top `## X.Y.Z` line — release title already shows the version
const body = m[0].replace(/^##\s+\S+\s*\n/, '').trim();
console.log(body || `Release v${version}`);
