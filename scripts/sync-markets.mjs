#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSources, validateIndex, aggregateMarkets, digest } from './market-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(join(root, 'markets.config.json')));
const sources = validateSources(config);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--source-dir')) throw new Error('Usage: sync-markets.mjs [--source-dir SNAPSHOTS]');
const localSource = args.length ? resolve(args[1]) : null;
const snapshotDir = join(root, 'markets/snapshots');
mkdirSync(snapshotDir, { recursive: true });
const write = (path, value, pretty = false) => {
  const text = JSON.stringify(value, null, pretty ? 2 : undefined) + '\n';
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
  writeFileSync(path + '.tmp', text);
  renameSync(path + '.tmp', path);
};
async function fetchIndex(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'dsh-plugins-sync/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new Error('Index exceeds 20 MiB per-source budget');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const snapshots = [];
const health = [];
let failures = 0;
for (const source of sources) {
  const path = join(snapshotDir, `${source.id}.json`);
  let previous;
  if (existsSync(path)) {
    previous = JSON.parse(readFileSync(path));
    if (previous.url !== source.url || previous.id !== source.id || previous.sha256 !== digest(previous.index)) {
      throw new Error(`Invalid cache identity/integrity: ${source.id}`);
    }
    validateIndex(previous.index, source.url);
  }
  try {
    const index = localSource ? JSON.parse(readFileSync(join(localSource, `${source.id}.json`))) : await fetchIndex(source.url);
    const parsed = validateIndex(index, source.url);
    const sha256 = digest(index);
    const snapshot = { ...source, snapshotAt: previous?.sha256 === sha256 ? previous.snapshotAt : new Date().toISOString(), sha256, index };
    snapshots.push(snapshot);
    write(path, snapshot);
    health.push({ id: source.id, status: 'fresh', plugins: parsed.plugins.length, sha256, snapshotAt: snapshot.snapshotAt });
    console.log(`${source.id}: OK ${parsed.plugins.length} plugins ${sha256.slice(0, 12)}`);
  } catch (error) {
    failures++;
    if (previous) snapshots.push(previous);
    health.push({ id: source.id, status: previous ? 'cached' : 'unavailable', error: error.message,
      ...(previous ? { plugins: previous.index.plugins.length, sha256: previous.sha256, snapshotAt: previous.snapshotAt } : {}) });
    console.error(`${source.id}: ${previous ? 'using cached snapshot' : 'unavailable'} (${error.message})`);
  }
}
// A first-sync failure must not publish an aggregate which silently omits a configured market.
if (snapshots.length === sources.length) {
  const aggregate = aggregateMarkets(snapshots);
  write(join(root, 'market-plugins.json'), aggregate);
  write(join(root, 'markets/status.json'), { sources: health, summary: aggregate.summary }, true);
  const lines = ['# 多市场索引同步', '',
    '| 来源 | 通道 | 状态 | 插件条目 | 内容快照时间 |', '|---|---|---|---:|---|',
    ...health.map((state) => {
      const source = sources.find((item) => item.id === state.id);
      return `| [${source.title}](${source.url}) | ${source.channel} | ${state.status} | ${state.plugins ?? '—'} | ${state.snapshotAt ?? '—'} |`;
    }), '', `合计：${aggregate.summary.plugins} 个包名，${aggregate.summary.listings} 条来源记录，${aggregate.summary.versionRecords} 条版本记录，${aggregate.summary.conflicts} 个版本来源或兼容声明冲突。`, '',
    '快照时间仅在内容变化时更新；每次在线检查见 GitHub Actions 日志。cached 表示本轮失败后保留了上次成功数据。',
    '稳定版与预览版分别保留。同名版本冲突不自动选胜者，完整声明在各来源快照中，聚合文件保留可追溯的记录位置。',
    '这里只收录各市场发布的原生 format-1 索引；其范围可能小于市场网站的全部目录。各来源的标签、实装或安全声明仅代表该来源，未转化为本仓库的验证结论。',
    '维护与同步：[Tangyixiao](https://github.com/tangyixiao)；自动执行：GitHub Actions。',
    '原始目录、翻译、验证声明及插件版权归各来源和原作者。',
    '各来源署名与许可：', '',
    ...sources.map((source) => `- [${source.title}](${source.url})（${source.channel}）：[${source.license}](${source.licenseUrl})。`), '',
    '许可与原始来源见 markets.config.json 和 LICENSE.market-data。', ''];
  const report = lines.join('\n');
  if (!existsSync(join(root, 'markets/README.md')) || readFileSync(join(root, 'markets/README.md'), 'utf8') !== report) writeFileSync(join(root, 'markets/README.md'), report);
  console.log(JSON.stringify(aggregate.summary));
} else {
  write(join(root, 'markets/status.json'), { sources: health, incomplete: true }, true);
}
if (failures) process.exitCode = 1;
