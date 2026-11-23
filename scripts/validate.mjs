#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { load, JSON_SCHEMA } from 'js-yaml';
import { validateSources, validateIndex, digest } from './market-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const inventory = json('profiles/public-plugins.json');
const fields = (record, names) => assert.deepEqual(Object.keys(record).sort(), [...names].sort());
fields(inventory, ['schemaVersion', 'profiles']);
assert.equal(inventory.schemaVersion, 1);
assert.ok(Array.isArray(inventory.profiles) && inventory.profiles.length);
const profileNames = new Set();
for (const profile of inventory.profiles) {
  fields(profile, ['profile', 'plugins']);
  assert.match(profile.profile, /^(?:desktop|web|im-setup|qqbot|headless|profile-[1-9][0-9]*)$/);
  assert.ok(!profileNames.has(profile.profile));
  profileNames.add(profile.profile);
  assert.ok(Array.isArray(profile.plugins));
  const names = new Set();
  for (const plugin of profile.plugins) {
    fields(plugin, ['name', 'version', 'source', 'status', 'origin']);
    assert.match(plugin.name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
    assert.match(plugin.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
    assert.ok(!names.has(plugin.name), `Duplicate ${plugin.name} in ${profile.profile}`);
    names.add(plugin.name);
    assert.ok(['installed', 'enabled', 'disabled'].includes(plugin.status));
    assert.ok(['direct', 'bundle', 'host'].includes(plugin.origin));
    const { source } = plugin;
    if (source.type === 'tarball') {
      fields(source, ['type', 'spec', 'integrity']);
      assert.match(source.spec, /^https:\/\/(?:registry\.npmjs\.org\/(?:@[\w.-]+\/)?[\w.-]+\/-\/[\w.+-]+\.tgz|github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/[\w.+-]+\/[\w.+-]+\.tgz)$/);
      assert.match(source.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    } else {
      fields(source, ['type', 'spec']);
      if (source.type === 'npm') assert.equal(source.spec, `${plugin.name}@${plugin.version}`);
      else {
        assert.equal(source.type, 'git');
        assert.match(source.spec, /^github:[\w.-]+\/[\w.-]+#[a-f0-9]{40}$/);
      }
    }
  }
}
const index = json('plugins.json');
const files = readdirSync(join(root, 'data/plugins')).filter((file) => file.endsWith('.yml'));
assert.equal(files.length, index.count);
assert.equal(index.plugins.length, index.count);
assert.deepEqual([...new Set(index.plugins.map((p) => p.file))].sort(), files.sort());
for (const file of readdirSync(join(root, 'data')).filter((name) => name.endsWith('.json'))) json(`data/${file}`);
for (let i = 0; i < index.plugins.length; i++) {
  const p = index.plugins[i];
  const raw = load(readFileSync(join(root, 'data/plugins', p.file), 'utf8'), { schema: JSON_SCHEMA });
  assert.deepEqual([p.name, p.url, p.category, p.descEn, p.descZh],
    [raw.name, raw.url, raw.category, raw.description.en, raw.description.zh], p.file);
  if (i) {
    const previous = index.plugins[i - 1];
    assert.ok((previous.downloads ?? -1) > (p.downloads ?? -1)
      || ((previous.downloads ?? -1) === (p.downloads ?? -1) && (previous.stars ?? -1) >= (p.stars ?? -1)), p.file);
  }
}
for (const override of json('catalog-overrides.json')) {
  assert.deepEqual(load(readFileSync(join(root, 'data/plugins', override.file), 'utf8')), override.entry);
  for (const previous of override.replaces ?? []) assert.equal(existsSync(join(root, 'data/plugins', previous)), false);
}
assert.equal(json('catalog-snapshot.json').count, index.count);
const ranking = readFileSync(join(root, 'RANKING.md'), 'utf8');
assert.equal(ranking.split('\n').filter((line) => /^\| \d+ \|/.test(line)).length, Math.min(index.count, 200));
for (const p of index.plugins.slice(0, 200)) assert.ok(ranking.includes(`[${p.name}](${p.url})`));
const sources = validateSources(json('markets.config.json'));
const snapshots = new Map();
for (const source of sources) {
  const snapshot = json(`markets/snapshots/${source.id}.json`);
  assert.equal(snapshot.id, source.id);
  assert.equal(snapshot.url, source.url);
  assert.equal(snapshot.channel, source.channel);
  assert.equal(snapshot.sha256, digest(snapshot.index));
  validateIndex(snapshot.index, source.url);
  snapshots.set(source.id, snapshot.index);
}
const aggregate = json('market-plugins.json');
const status = json('markets/status.json');
assert.equal(status.incomplete, undefined);
assert.deepEqual(status.sources.map((s) => s.id), sources.map((s) => s.id));
assert.equal(aggregate.summary.sources, sources.length);
assert.equal(aggregate.summary.plugins, aggregate.plugins.length);
assert.equal(new Set(aggregate.plugins.map((p) => p.name)).size, aggregate.plugins.length);
let listingCount = 0;
for (const plugin of aggregate.plugins) {
  for (const pointer of plugin.listings) {
    assert.equal(snapshots.get(pointer.sourceId).plugins[pointer.pluginIndex].name, plugin.name);
    listingCount++;
  }
}
assert.equal(listingCount, [...snapshots.values()].reduce((count, snapshot) => count + snapshot.plugins.length, 0));
assert.equal(aggregate.summary.listings, listingCount);
for (const conflict of aggregate.conflicts) {
  for (const pointer of conflict.candidates) {
    const plugin = snapshots.get(pointer.sourceId).plugins[pointer.pluginIndex];
    assert.equal(plugin.name, conflict.name);
    assert.equal(plugin.versions[pointer.versionIndex].version, conflict.version);
  }
}
for (const source of aggregate.sources) assert.equal(source.sha256, json(source.snapshot).sha256);
assert.deepEqual(status.summary, aggregate.summary);
console.log(`PASS: ${index.count} catalog entries; ${sources.length} official-parser-validated market snapshots; ${listingCount} source pointers; ${aggregate.conflicts.length} preserved conflicts.`);
