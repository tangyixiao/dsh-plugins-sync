import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;

export function validateSources(config) {
  if (!Array.isArray(config.sources) || !config.sources.length) throw new Error('No market sources configured');
  const ids = new Set();
  for (const source of config.sources) {
    if (typeof source.id !== 'string' || !/^[a-z0-9-]+$/.test(source.id) || ids.has(source.id)) throw new Error(`Invalid/duplicate source ID: ${source.id}`);
    ids.add(source.id);
    if (new URL(source.url).protocol !== 'https:' || !source.title || !source.license || !source.licenseUrl
      || !['stable', 'preview'].includes(source.channel)) throw new Error(`Invalid source configuration: ${source.id}`);
  }
  return config.sources;
}

export function validateIndex(index, url) {
  const parsed = parseMarketIndex(index, url);
  if (!parsed.plugins.length) throw new Error('Refusing an empty market index');
  return parsed;
}

// Retain source pointers and every version claim; never choose one market's target over another.
export function aggregateMarkets(snapshots) {
  const packages = new Map();
  let listings = 0;
  let versionRecords = 0;
  for (const snapshot of snapshots) {
    const parsed = validateIndex(snapshot.index, snapshot.url);
    parsed.plugins.forEach((plugin, pluginIndex) => {
      let entry = packages.get(plugin.name);
      if (!entry) {
        entry = { name: plugin.name, listings: [], versions: new Map() };
        packages.set(plugin.name, entry);
      }
      entry.listings.push({ sourceId: snapshot.id, pluginIndex });
      listings++;
      plugin.versions.forEach((version, versionIndex) => {
        versionRecords++;
        const candidates = entry.versions.get(version.version) ?? [];
        candidates.push({ sourceId: snapshot.id, pluginIndex, versionIndex,
          signature: JSON.stringify(canonical({ source: version.source, engines: version.engines })) });
        entry.versions.set(version.version, candidates);
      });
    });
  }
  const conflicts = [];
  const plugins = [...packages.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map((entry) => {
    for (const [version, candidates] of entry.versions) {
      if (new Set(candidates.map((candidate) => candidate.signature)).size > 1) {
        conflicts.push({ name: entry.name, version,
          candidates: candidates.map(({ signature, ...pointer }) => pointer) });
      }
    }
    return { name: entry.name, listings: entry.listings, versionCount: entry.versions.size };
  });
  return { kind: 'market-catalog-provenance', schemaVersion: 1,
    sources: snapshots.map(({ id, url, sha256, channel }) => ({ id, url, sha256, channel, snapshot: `markets/snapshots/${id}.json` })),
    summary: { sources: snapshots.length, plugins: plugins.length, listings, versionRecords, conflicts: conflicts.length },
    plugins, conflicts };
}
