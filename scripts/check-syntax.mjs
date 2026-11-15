import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

for (const directory of ['scripts', 'test']) {
  for (const file of readdirSync(new URL(`../${directory}/`, import.meta.url)).filter((name) => name.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(`../${directory}/${file}`, import.meta.url))], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
for (const file of ['ci.yml', 'sync.yml']) {
  const workflow = load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));
  if (!workflow.on || !workflow.jobs) throw new Error(`Invalid workflow: ${file}`);
}
console.log('JavaScript syntax and workflow YAML passed.');
