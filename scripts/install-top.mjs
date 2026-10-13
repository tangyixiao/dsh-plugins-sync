#!/usr/bin/env node
// install-top.mjs — install the ranked Top-N plugins into a dsh profile.
// Usage: node scripts/install-top.mjs [--profile web] [--all]
//   Reads package.json "top20" (pinned specs). Skips entries with skip:true
//   and any package already present in the profile's package.json.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const profileArg = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : 'web';
const forceAll = args.includes('--all');

const profileDir = join(os.homedir(), '.dsh', 'profiles', profileArg);
if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`Profile not found: ${profileDir}`);
  process.exit(1);
}
const profilePkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
const installed = Object.keys(profilePkg.dependencies || {});

const entries = pkg.top20.filter((e) => {
  if (forceAll) return true;
  if (e.skip) { console.log(`SKIP (pinned): ${e.name}`); return false; }
  const npmName = e.spec.startsWith('npm:')
    ? e.spec.slice(4).replace(/@[^@]+$/, '')
    : null;
  if (npmName && installed.includes(npmName)) {
    console.log(`SKIP (already installed): ${e.name} (${npmName})`);
    return false;
  }
  return true;
});

console.log(`Installing ${entries.length} plugin(s) into profile "${profileArg}"...`);
let ok = 0, failed = [];
for (const e of entries) {
  const spec = e.spec.replace(/^npm:/, '');
  console.log(`\n=== ${e.name} => ${spec} ===`);
  try {
    execFileSync('dsh', ['plugin', 'add', '--profile', profileArg, spec],
      { stdio: 'inherit', shell: process.platform === 'win32' });
    ok++;
  } catch (err) {
    console.error(`FAILED: ${e.name} (${spec})`);
    failed.push(`${e.name} :: ${spec}`);
  }
}

console.log(`\nDone. ok=${ok} failed=${failed.length}`);
if (failed.length) { console.log('Failed list:'); failed.forEach((f) => console.log('  ' + f)); }
