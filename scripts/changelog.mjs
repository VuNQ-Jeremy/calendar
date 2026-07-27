#!/usr/bin/env node
/**
 * Add a CHANGELOG entry for the commit you are about to make.
 *
 *   node scripts/changelog.mjs "Extract i18n strings into shared/"
 *   node scripts/changelog.mjs --major "Mobile app ships to students"
 *
 * The build number is derived from the git commit count (see scripts/git-version.mjs), so
 * this script does not store it — it computes count+1, the number the pending commit will
 * have. Run it as part of your FINAL commit before pushing; if a push carries several
 * commits the recorded number trails the real one, which is harmless because the SHA
 * shipped alongside is the authoritative identifier.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gitBuild } from './git-version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = join(root, 'shared', 'version.json');
const CHANGELOG = join(root, 'CHANGELOG.md');

const args = process.argv.slice(2);
const isMajor = args.includes('--major');
const message = args.filter((a) => a !== '--major').join(' ').trim();

if (!message) {
  console.error('Usage: node scripts/changelog.mjs [--major] "1-2 line summary of the change"');
  process.exit(1);
}

const version = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
if (isMajor) {
  version.major += 1;
  // Re-baseline so the new major starts at .0000 on the next commit.
  version.buildOffset = gitBuild() + 1;
  writeFileSync(VERSION_FILE, JSON.stringify(version, null, 2) + '\n');
}

// +1: the commit carrying this entry does not exist yet.
const build = Math.max(0, gitBuild() + 1 - version.buildOffset);
const label = `v${version.major}.${String(build).padStart(4, '0')}`;
const date = new Date().toISOString().slice(0, 10);

const HEADER = `# Changelog

One entry per push to \`main\`. Newest first. Add one with:
\`node scripts/changelog.mjs "what changed"\`

Version is \`v{major}.{build}\`. \`major\` lives in \`shared/version.json\`; the build number is
derived from the git commit count and is never stored.
`;

let existing = '';
try {
  const current = readFileSync(CHANGELOG, 'utf8');
  const marker = '\n## ';
  const at = current.indexOf(marker);
  existing = at === -1 ? '' : current.slice(at + 1);
} catch {
  // First run — no CHANGELOG yet.
}

writeFileSync(CHANGELOG, `${HEADER}\n## ${label} — ${date}\n${message}\n\n${existing}`.trimEnd() + '\n');

const staged = ['CHANGELOG.md', ...(isMajor ? ['shared/version.json'] : [])];
execSync(`git add ${staged.join(' ')}`, { cwd: root, stdio: 'inherit' });

console.log(`${label} — ${message}`);
console.log(`staged: ${staged.join(', ')}`);
