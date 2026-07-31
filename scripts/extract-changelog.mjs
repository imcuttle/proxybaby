#!/usr/bin/env node
/**
 * Extract the changelog section for a given version from CHANGELOG.md.
 * Usage: node scripts/extract-changelog.mjs 0.1.0
 * Prints the section body (without the `## X.Y.Z` header) to stdout, so the
 * GitHub Release page shows the actual notes instead of just "Release vX.Y.Z".
 *
 * Robust to:
 *   - CHANGELOG.md missing → falls back to "Release vX.Y.Z"
 *   - Version not found in file → same fallback
 *   - Version being the last one in file (no trailing `## next`)
 *   - Windows CRLF line endings
 *
 * Note: JS RegExp doesn't support \Z (Perl-style end-of-string). We split the
 * file on top-level `## ` headers manually to avoid that trap.
 */
import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('Usage: extract-changelog.mjs <version>');
  process.exit(1);
}

const fallback = `Release v${version}`;
const p = path.resolve(process.cwd(), 'CHANGELOG.md');
if (!fs.existsSync(p)) {
  console.log(fallback);
  process.exit(0);
}

const raw = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// Split into (header)(rest) pairs on `## ` at line start.
// First chunk is the file preamble (e.g. "# proxybaby\n"), the rest are sections.
const parts = raw.split(/^## +/m);
// parts[0] = preamble; parts[1..] = "0.1.0\n\n<body>", "0.0.9\n\n<body>", ...
for (let i = 1; i < parts.length; i++) {
  const chunk = parts[i];
  // The section's title is the first line (up to \n)
  const nl = chunk.indexOf('\n');
  const title = nl === -1 ? chunk : chunk.slice(0, nl);
  // Normalize the title: strip trailing whitespace and any date suffix (e.g. " - 2024-01-01")
  const tv = title.trim().split(/\s+/)[0];
  if (tv === version) {
    const body = (nl === -1 ? '' : chunk.slice(nl + 1)).trimEnd();
    console.log(body || fallback);
    process.exit(0);
  }
}

console.log(fallback);
