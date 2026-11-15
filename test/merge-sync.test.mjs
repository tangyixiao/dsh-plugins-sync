import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertGeneratedChanges, assertMergeContext } from '../scripts/merge-sync.mjs';

const base = { 'README.md': '共 10 个插件（10 个，元数据）',
  'package.json': JSON.stringify({ description: '(10 plugins)', dependencies: { example: '1' }, top20: ['fixed'] }) };
const head = { 'README.md': '共 12 个插件（12 个，元数据）',
  'package.json': JSON.stringify({ description: '(12 plugins)', dependencies: { example: '1' }, top20: ['fixed'] }) };
const check = (paths, next = head) => assertGeneratedChanges(paths, (p) => base[p], (p) => next[p], ['awesome']);

test('generated data and counts may merge; executable/configuration changes may not', () => {
  check(['README.md', 'package.json', 'data/plugins/中文.yml', 'markets/snapshots/awesome.json', 'market-plugins.json']);
  for (const path of ['scripts/sync-catalog.mjs', '.github/workflows/sync.yml', 'catalog-overrides.json',
    'package-lock.json', 'markets.config.json', 'data/plugins/run.mjs', 'data/../scripts/run.json', 'markets/snapshots/unknown.json']) {
    assert.throws(() => check([path]), /Not generated data|Unsafe path/);
  }
  assert.throws(() => check(['README.md'], { ...head, 'README.md': head['README.md'] + ' arbitrary edit' }));
  const changedPackage = JSON.parse(head['package.json']);
  changedPackage.dependencies.example = '2';
  assert.throws(() => check(['package.json'], { ...head, 'package.json': JSON.stringify(changedPackage) }));
  changedPackage.dependencies.example = '1';
  changedPackage.top20 = ['new version'];
  assert.throws(() => check(['package.json'], { ...head, 'package.json': JSON.stringify(changedPackage) }));
});

test('merge requires the validated head/base, same-repo automation branch and every source fresh', () => {
  const repo = 'owner/catalog';
  const pr = { state: 'open', draft: false, head: { ref: 'automation/catalog-sync', sha: 'head', repo: { full_name: repo } },
    base: { ref: 'main', sha: 'base', repo: { full_name: repo } } };
  const context = { repo, base: 'base', currentBase: 'base', head: 'head', sourceIds: ['awesome'], status: { sources: [{ id: 'awesome', status: 'fresh' }] } };
  assertMergeContext(pr, context);
  // Existing PRs can keep their creation-time base SHA after main advances.
  assertMergeContext({ ...pr, base: { ...pr.base, sha: 'old creation-time SHA' } }, context);
  for (const state of ['cached', 'unavailable']) {
    assert.throws(() => assertMergeContext(pr, { ...context, status: { sources: [{ id: 'awesome', status: state }] } }));
  }
  assert.throws(() => assertMergeContext(pr, { ...context, head: 'unvalidated' }));
  assert.throws(() => assertMergeContext(pr, { ...context, base: 'new main' }));
  assert.throws(() => assertMergeContext(pr, { ...context, currentBase: 'main advanced during sync' }));
  assert.throws(() => assertMergeContext(pr, { ...context, sourceIds: ['awesome', 'missing'] }));
  assert.throws(() => assertMergeContext({ ...pr, head: { ...pr.head, ref: 'feature' } }, context));
  assert.throws(() => assertMergeContext({ ...pr, head: { ...pr.head, repo: { full_name: 'fork/catalog' } } }, context));
});
