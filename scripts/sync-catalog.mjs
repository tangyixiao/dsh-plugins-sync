#!/usr/bin/env node
// sync-catalog.mjs — refresh the catalog snapshot from upstream awesome-dsh-plugin.
// Usage: node scripts/sync-catalog.mjs
//   Re-clones (shallow) awesome-dsh-plugin into a temp dir, replaces ./data,
//   regenerates plugins.json (flattened index with downloads/stars/category)
//   and RANKING.md (top 200 by downloads then stars).
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin';
const tmp = join(tmpdir(), `awesome-dsh-sync-${Date.now()}`);

console.log('Cloning upstream catalog...');
execFileSync('git', ['clone', '--depth', '1', upstream, tmp], { stdio: 'inherit' });

console.log('Replacing ./data ...');
const dataDir = join(repoRoot, 'data');
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
cpSync(join(tmp, 'data'), dataDir, { recursive: true });

console.log('Building plugins.json + RANKING.md ...');
const dl = JSON.parse(readFileSync(join(dataDir, 'downloads.json'), 'utf8'));
const st = JSON.parse(readFileSync(join(dataDir, 'stars.json'), 'utf8'));
const pluginFiles = readdirSync(join(dataDir, 'plugins')).filter((f) => f.endsWith('.yml'));

const plugins = pluginFiles.map((f) => {
  const raw = readFileSync(join(dataDir, 'plugins', f), 'utf8');
  const url = raw.match(/^url:\s*(\S+)/m)?.[1] ?? null;
  const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const category = raw.match(/^category:\s*(\S+)/m)?.[1] ?? null;
  const dEn = raw.match(/(?:^|\n)\s*en:\s*(.+)/)?.[1]?.trim() ?? '';
  const dZh = raw.match(/(?:^|\n)\s*zh:\s*(.+)/)?.[1]?.trim() ?? '';
  const downloads = url && dl[url] ? dl[url].downloads : null;
  const stars = url && st[url] ? st[url].stars : null;
  return { file: f, name, url, category, downloads, stars, descEn: dEn, descZh: dZh };
});

const rank = (a, b) =>
  ((b.downloads ?? -1) - (a.downloads ?? -1)) || ((b.stars ?? -1) - (a.stars ?? -1));
plugins.sort(rank);
writeFileSync(join(repoRoot, 'plugins.json'), JSON.stringify({ generatedAt: new Date().toISOString(), count: plugins.length, plugins }, null, 1));

const lines = [
  '# DSH 插件排行榜（按下载量，其次 stars）', '',
  `> 快照时间：${new Date().toISOString().slice(0, 10)} · 共 ${plugins.length} 个插件`,
  '> 下载/stars 数据来自上游 data/downloads.json 与 data/stars.json，空值表示上游未采集。', '',
  '| # | 插件 | 下载 | Stars | 分类 |',
  '|---|------|------|-------|------|',
];
plugins.slice(0, 200).forEach((p, i) => {
  const u = p.url ?? '';
  lines.push(`| ${i + 1} | [${p.name}](${u}) | ${p.downloads ?? '—'} | ${p.stars ?? '—'} | ${p.category ?? '—'} |`);
});
writeFileSync(join(repoRoot, 'RANKING.md'), lines.join('\n') + '\n');

rmSync(tmp, { recursive: true, force: true });
console.log(`Done. ${plugins.length} plugins indexed; RANKING.md shows top 200.`);
