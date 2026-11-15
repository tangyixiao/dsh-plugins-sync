import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
  const snapshotPath = join(dir, 'markets/snapshots/example.json');
  const baseline = readFileSync(snapshotPath, 'utf8');
  assert.equal(invoke().status, 0);
  assert.equal(readFileSync(snapshotPath, 'utf8'), baseline);
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
