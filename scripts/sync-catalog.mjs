#!/usr/bin/env node
// Refresh upstream metadata, apply reviewed local corrections, then rebuild indexes.
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, dump, JSON_SCHEMA } from 'js-yaml';
import { createHash } from 'node:crypto';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin';
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--source-dir', '--source-ref'].includes(args[i]) || !args[i + 1]) {
    throw new Error('Usage: node scripts/sync-catalog.mjs [--source-dir CHECKOUT --source-ref COMMIT]');
  }
  options[args[i]] = args[i + 1];
}
if (options['--source-ref'] && !/^[a-f0-9]{40}$/.test(options['--source-ref'])) {
  throw new Error('--source-ref must be a full Git commit SHA');
}
const dataDir = join(repoRoot, 'data');
function synchronize() {
let temporary;
try {
  let sourceDir = options['--source-dir'] && resolve(options['--source-dir']);
  let sourceCommit = options['--source-ref'] ?? null;
  if (!sourceDir) {
    const workDir = join(repoRoot, 'work');
    mkdirSync(workDir, { recursive: true });
    temporary = mkdtempSync(join(workDir, 'catalog-sync-'));
    sourceDir = join(temporary, 'upstream');
    execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', upstream, sourceDir], { stdio: 'inherit' });
    execFileSync('git', ['-C', sourceDir, 'sparse-checkout', 'set', 'data'], { stdio: 'inherit' });
    sourceCommit = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  const sourceData = join(sourceDir, 'data');
  const normalize = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
  const sourcePath = normalize(realpathSync(sourceData));
  const destinationPath = normalize(existsSync(dataDir) ? realpathSync(dataDir) : dataDir);
  if (sourcePath === destinationPath || sourcePath.startsWith(destinationPath + sep)) {
    throw new Error('Source must be separate from the destination data directory');
  }
  const overrides = JSON.parse(readFileSync(join(repoRoot, 'catalog-overrides.json'), 'utf8'));
  console.log('Reading and validating upstream metadata...');
  const files = new Map(readdirSync(join(sourceData, 'plugins'))
    .filter((file) => file.endsWith('.yml'))
    .map((file) => [file, readFileSync(join(sourceData, 'plugins', file), 'utf8')]));
  for (const override of overrides) {
    for (const previous of override.replaces ?? []) files.delete(previous);
    files.set(override.file, dump(override.entry, { lineWidth: -1, noRefs: true }));
  }
  const metadata = {};
  for (const file of readdirSync(sourceData).filter((name) => name.endsWith('.json'))) {
    metadata[file] = JSON.parse(readFileSync(join(sourceData, file), 'utf8'));
  }
  const dl = metadata['downloads.json'];
  const st = metadata['stars.json'];
  if (!dl || !st) throw new Error('Missing upstream downloads/stars data');
  const inputHash = createHash('sha256');
  for (const [file, raw] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    inputHash.update(JSON.stringify([file, raw]));
  }
  inputHash.update(JSON.stringify(metadata));
  inputHash.update(JSON.stringify(overrides));
  inputHash.update(readFileSync(fileURLToPath(import.meta.url)));
  const inputSha256 = inputHash.digest('hex');
  const snapshotPath = join(repoRoot, 'catalog-snapshot.json');
  const previousSnapshot = existsSync(snapshotPath) && JSON.parse(readFileSync(snapshotPath, 'utf8'));
  if (previousSnapshot?.inputSha256 === inputSha256) {
    console.log('Catalog content unchanged; keeping existing snapshot timestamps.');
    return;
  }
  const urls = new Set();
  let duplicateUrlCount = 0;
  const plugins = [...files].map(([file, raw]) => {
    const entry = load(raw, { schema: JSON_SCHEMA });
    if (!entry || typeof entry.name !== 'string' || typeof entry.url !== 'string'
      || typeof entry.category !== 'string' || typeof entry.description?.en !== 'string'
      || typeof entry.description?.zh !== 'string') {
      throw new Error(`Invalid plugin metadata: ${file}`);
    }
    if (urls.has(entry.url)) duplicateUrlCount++;
    urls.add(entry.url);
    const previousUrls = overrides.find((item) => item.file === file)?.previousUrls ?? [];
    const cached = (cache, key) => [entry.url, ...previousUrls]
      .map((url) => cache[url]?.[key]).find((value) => value != null) ?? null;
    return { file, name: entry.name, url: entry.url, category: entry.category,
      downloads: cached(dl, 'downloads'), stars: cached(st, 'stars'),
      descEn: entry.description.en, descZh: entry.description.zh };
  });
  plugins.sort((a, b) => ((b.downloads ?? -1) - (a.downloads ?? -1))
    || ((b.stars ?? -1) - (a.stars ?? -1)) || a.file.localeCompare(b.file, 'en'));

  // Validate the entire incoming snapshot before replacing the tracked data.
  console.log(`Validated ${plugins.length} entries; copying snapshot (${duplicateUrlCount} repeated URLs retained)...`);
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
  cpSync(sourceData, dataDir, { recursive: true });
  for (const override of overrides) {
    for (const previous of override.replaces ?? []) rmSync(join(dataDir, 'plugins', previous), { force: true });
    writeFileSync(join(dataDir, 'plugins', override.file), files.get(override.file));
  }
  const generatedAt = new Date().toISOString();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(generatedAt));
  writeFileSync(join(repoRoot, 'plugins.json'), JSON.stringify({ generatedAt, count: plugins.length, plugins }, null, 1) + '\n');
  const lines = ['# DSH 插件排行榜（按下载量，其次 stars）', '',
    `> 快照时间：${date} · 共 ${plugins.length} 个插件`,
    '> 下载/stars 数据沿用上游缓存及其采集时间，并非本次重新采集；空值表示上游未采集。', '',
    '> 维护与同步：[Tangyixiao](https://github.com/tangyixiao)；目录数据：[Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 及原贡献者。',
    '> 条目修正贡献：[@Ultroncn](https://github.com/Ultroncn)（[PR #1](https://github.com/tangyixiao/dsh-plugins-sync/pull/1)）；各插件版权与许可归原作者。', '',
    '| # | 插件 | 下载 | Stars | 分类 |', '|---|------|------|-------|------|'];
  plugins.slice(0, 200).forEach((p, i) => lines.push(
    `| ${i + 1} | [${p.name}](${p.url}) | ${p.downloads ?? '—'} | ${p.stars ?? '—'} | ${p.category} |`));
  writeFileSync(join(repoRoot, 'RANKING.md'), lines.join('\n') + '\n');
  writeFileSync(join(repoRoot, 'catalog-snapshot.json'), JSON.stringify({
    generatedAt, upstream, upstreamCommit: sourceCommit, inputSha256,
    upstreamCount: readdirSync(join(sourceData, 'plugins')).filter((f) => f.endsWith('.yml')).length,
    count: plugins.length, duplicateUrlCount,
    overrides: overrides.map(({ file, source }) => ({ file, source })),
  }, null, 2) + '\n');
  const readmePath = join(repoRoot, 'README.md');
  writeFileSync(readmePath, readFileSync(readmePath, 'utf8').replace(/\d+ 个插件/g, `${plugins.length} 个插件`).replace(/（\d+ 个，/g, `（${plugins.length} 个，`));
  const packagePath = join(repoRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  pkg.description = pkg.description.replace(/\(\d+ plugins\)/, `(${plugins.length} plugins)`);
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Done. upstream=${sourceCommit ?? 'unspecified'} plugins=${plugins.length} overrides=${overrides.length}`);
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
}
synchronize();
