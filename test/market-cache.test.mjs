import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { digest } from '../scripts/market-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(run) {
  mkdirSync(join(root, 'work'), { recursive: true });
  const dir = mkdtempSync(join(root, 'work/market-cache-test-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'source'));
    for (const file of ['sync-markets.mjs', 'market-data.mjs']) cpSync(join(root, 'scripts', file), join(dir, 'scripts', file));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dir, 'markets.config.json'), JSON.stringify({ sources: [{
      id: 'example', title: 'Example', url: 'https://example.org/index.json', channel: 'stable',
      license: 'fixture', licenseUrl: 'https://example.org/license',
    }] }));
    writeFileSync(join(dir, 'source/example.json'), JSON.stringify({ format: 1, title: 'Example', plugins: [{
      name: 'example-plugin', title: 'Example', versions: [{ version: '1.0.0', publishTimestamp: 1790000000, source: { type: 'npm' } }],
    }] }));
    const invoke = () => spawnSync(process.execPath, [join(dir, 'scripts/sync-markets.mjs'), '--source-dir', join(dir, 'source')], { encoding: 'utf8' });
    run({ dir, invoke });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('unchanged content is stable, while failed fetch retains validated cache and reports failure', () => fixture(({ dir, invoke }) => {
  const first = invoke();
  assert.equal(first.status, 0, first.stderr);
  const report = readFileSync(join(dir, 'markets/README.md'), 'utf8');
  assert.match(report, /Tangyixiao/);
  assert.match(report, /原始目录、翻译、验证声明及插件版权归各来源和原作者/);
  assert.doesNotMatch(report, /Ultroncn/);
  assert.match(report, /\[Example\]\(https:\/\/example.org\/index.json\)/);
  assert.match(report, /\[fixture\]\(https:\/\/example.org\/license\)/);
  const snapshotPath = join(dir, 'markets/snapshots/example.json');
  const baseline = readFileSync(snapshotPath, 'utf8');
  assert.equal(invoke().status, 0);
  assert.equal(readFileSync(snapshotPath, 'utf8'), baseline);
  assert.equal(readFileSync(join(dir, 'markets/README.md'), 'utf8'), report);
  writeFileSync(join(dir, 'source/example.json'), '{broken');
  const failed = invoke();
  assert.equal(failed.status, 1);
  assert.equal(readFileSync(snapshotPath, 'utf8'), baseline);
  assert.equal(JSON.parse(readFileSync(join(dir, 'markets/status.json'))).sources[0].status, 'cached');
  assert.equal(JSON.parse(readFileSync(join(dir, 'market-plugins.json'))).summary.plugins, 1);
}));

test('first-sync failure cannot publish an incomplete aggregate', () => fixture(({ dir, invoke }) => {
  writeFileSync(join(dir, 'source/example.json'), '{broken');
  assert.equal(invoke().status, 1);
  assert.equal(existsSync(join(dir, 'market-plugins.json')), false);
  const status = JSON.parse(readFileSync(join(dir, 'markets/status.json')));
  assert.equal(status.incomplete, true);
  assert.equal(status.sources[0].status, 'unavailable');
}));

test('changed indexes replace the aggregate only after schema validation', () => fixture(({ dir, invoke }) => {
  assert.equal(invoke().status, 0);
  const inputPath = join(dir, 'source/example.json');
  const aggregatePath = join(dir, 'market-plugins.json');
  const index = JSON.parse(readFileSync(inputPath));
  index.plugins[0].name = 'renamed-plugin';
  writeFileSync(inputPath, JSON.stringify(index));
  const changed = invoke();
  assert.equal(changed.status, 0, changed.stderr);
  const aggregate = readFileSync(aggregatePath, 'utf8');
  assert.deepEqual(JSON.parse(aggregate).plugins.map((plugin) => plugin.name), ['renamed-plugin']);
  index.plugins[0].versions[0].version = 'invalid';
  writeFileSync(inputPath, JSON.stringify(index));
  assert.equal(invoke().status, 1);
  assert.equal(readFileSync(aggregatePath, 'utf8'), aggregate);
  assert.equal(JSON.parse(readFileSync(join(dir, 'markets/status.json'))).sources[0].status, 'cached');

  const snapshotPath = join(dir, 'markets/snapshots/example.json');
  const snapshot = JSON.parse(readFileSync(snapshotPath));
  writeFileSync(snapshotPath, JSON.stringify({ ...snapshot, index, sha256: digest(index) }));
  const invalidCache = invoke();
  assert.equal(invalidCache.status, 1);
  assert.equal(readFileSync(aggregatePath, 'utf8'), aggregate);
  assert.doesNotMatch(invalidCache.stderr, /using cached snapshot/);
}));

test('equal serialized digests cannot hide an invalid sort value', () => fixture(({ dir, invoke }) => {
  const inputPath = join(dir, 'source/example.json');
  const index = JSON.parse(readFileSync(inputPath));
  index.metadata = { sortKeys: { rank: { title: 'Rank', order: 'asc' } } };
  index.plugins[0].metadata = { sortKeys: { rank: null } };
  const valid = JSON.stringify(index);
  writeFileSync(inputPath, valid);
  const initial = invoke();
  assert.equal(initial.status, 0, initial.stderr);
  const overflow = valid.replace('"rank":null', '"rank":1e400');
  assert.equal(digest(JSON.parse(overflow)), digest(index));
  writeFileSync(inputPath, overflow);
  const failed = invoke();
  assert.equal(failed.status, 1, failed.stdout);
  assert.match(failed.stderr, /finite number/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'markets/status.json'))).sources[0].status, 'cached');
}));
