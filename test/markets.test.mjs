import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateParsedMarkets, parseSnapshotPlugins, validateSources, validateIndex } from '../scripts/market-data.mjs';

const plugin = (version, dsh, registry = 'https://registry.npmjs.org/') => ({
  name: 'example-plugin', title: 'Example',
  versions: [{ version, publishTimestamp: 1790000000, source: { type: 'npm', registry }, engines: { dsh } }],
});
const snapshot = (id, p, channel = 'stable') => ({ id, channel, url: `https://${id}.example/index.json`, sha256: id,
  index: { format: 1, title: id, plugins: [p] } });
const aggregateMarkets = (snapshots) => aggregateParsedMarkets(snapshots.map((source) => ({
  ...source, plugins: parseSnapshotPlugins(source.index, source.url),
})));

test('same-version install and compatibility conflicts retain all source claims', () => {
  const stable = snapshot('stable', plugin('1.0.0', '^0.2.0'));
  const other = snapshot('other', plugin('1.0.0', '^0.1.0', 'https://other.example/'));
  const result = aggregateMarkets([stable, other]);
  assert.equal(result.plugins.length, 1);
  assert.equal(result.summary.listings, 2);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].candidates.map((p) => p.sourceId), ['stable', 'other']);
  assert.equal(stable.index.plugins[0].versions[0].engines.dsh, '^0.2.0');
  assert.equal(other.index.plugins[0].versions[0].engines.dsh, '^0.1.0');
});

test('conflict offsets resolve in the original snapshot, including exact build identifiers', () => {
  const stable = snapshot('stable', plugin('1.0.0+first', '^1.0.0'));
  const other = snapshot('other', plugin('1.0.0+second', '^2.0.0'));
  stable.index.plugins[0].versions.push(...plugin('2.0.0', '^1.0.0').versions,
    ...plugin('1.0.0+second', '^1.0.0').versions);
  other.index.plugins[0].versions.push(...plugin('1.0.0+first', '^2.0.0').versions);
  stable.index.plugins.unshift({ ...plugin('1.0.0', '*'), name: 'another-plugin' });
  const sources = [stable, other];
  const { conflicts } = aggregateMarkets(sources);
  assert.deepEqual(conflicts.map((entry) => entry.version).sort(), ['1.0.0+first', '1.0.0+second']);
  for (const conflict of conflicts) {
    assert.equal(conflict.candidates.length, 2);
    for (const pointer of conflict.candidates) {
      const source = sources.find((entry) => entry.id === pointer.sourceId);
      const rawPlugin = source.index.plugins[pointer.pluginIndex];
      assert.equal(rawPlugin.name, conflict.name);
      assert.equal(rawPlugin.versions[pointer.versionIndex].version, conflict.version);
    }
  }
});

test('preview remains a distinct source and cannot replace stable pins', () => {
  const result = aggregateMarkets([snapshot('stable', plugin('1.0.0', '^0.2.0')),
    snapshot('preview', plugin('1.1.0-beta.1', '^0.2.0'), 'preview')]);
  assert.equal(result.plugins[0].versionCount, 2);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.sources[1].channel, 'preview');
  assert.deepEqual(result.plugins[0].listings.map((p) => p.sourceId), ['stable', 'preview']);
});

test('malformed indexes and unsafe source IDs fail validation', () => {
  assert.throws(() => validateIndex({ format: 1, title: 'empty', plugins: [] }, 'https://example.org/index.json'));
  assert.throws(() => validateSources({ sources: [{ id: '../escape' }] }));
  assert.throws(() => aggregateMarkets([snapshot('bad', plugin('latest', '^0.2.0'))]));
  const duplicate = plugin('1.0.0', '^0.2.0');
  duplicate.versions.push(...plugin('1.0.0', '^0.1.0').versions);
  assert.throws(() => aggregateMarkets([snapshot('dup', duplicate)]), /duplicates 1\.0\.0/);
});
