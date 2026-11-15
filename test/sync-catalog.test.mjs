import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const work = join(root, 'work');
mkdirSync(work, { recursive: true });
function fixture(run) {
  const dir = mkdtempSync(join(work, 'catalog-test-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'source/data/plugins'), { recursive: true });
    mkdirSync(join(dir, 'data'));
    cpSync(join(root, 'scripts/sync-catalog.mjs'), join(dir, 'scripts/sync-catalog.mjs'));
    cpSync(join(root, 'catalog-overrides.json'), join(dir, 'catalog-overrides.json'));
    writeFileSync(join(dir, 'data/previous.txt'), 'preserve if validation fails');
    writeFileSync(join(dir, 'README.md'), '目录（4579 个插件）；全量清单（4579 个，逐插件元数据）');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', description: '(4579 plugins)' }));
    writeFileSync(join(dir, 'source/data/downloads.json'), JSON.stringify({
      'https://github.com/Ultronen/dsh-archived-chats': { downloads: 642 },
    }));
    writeFileSync(join(dir, 'source/data/stars.json'), '{}');
    const invoke = (source = join(dir, 'source')) => spawnSync(process.execPath,
      [join(dir, 'scripts/sync-catalog.mjs'), '--source-dir', source], { encoding: 'utf8' });
    run({ dir, invoke });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('full sync parses multiline Chinese YAML and preserves PR corrections and renamed cache keys', () => fixture(({ dir, invoke }) => {
  writeFileSync(join(dir, 'source/data/plugins/example.yml'), [
    'url: https://github.com/example/plugin', 'name: example/plugin', 'category: session',
    'description:', '  en: >-', '    Conversation search', '    and backups.',
    '  zh: "中文描述：支持搜索与备份。"', '',
  ].join('\n'));
  writeFileSync(join(dir, 'source/data/plugins/Ultronen__dsh-archived-chats.yml'), 'outdated: true');
  const result = invoke();
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(readFileSync(join(dir, 'plugins.json')));
  assert.equal(index.count, 2);
  const corrected = index.plugins.find((p) => p.name === 'Ultroncn/dsh-archived-chats');
  assert.equal(corrected.downloads, 642);
  assert.match(corrected.descZh, /0\.2\.2-rc\.3/);
  assert.equal(index.plugins.find((p) => p.name === 'example/plugin').descEn, 'Conversation search and backups.');
  assert.equal(existsSync(join(dir, 'data/plugins/Ultronen__dsh-archived-chats.yml')), false);
  assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /2 个插件/);
  assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /（2 个，/);
}));

test('invalid incoming metadata fails before replacing the previous snapshot', () => fixture(({ dir, invoke }) => {
  writeFileSync(join(dir, 'source/data/plugins/bad.yml'), 'name: missing-required-fields');
  const result = invoke();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid plugin metadata/);
  assert.equal(readFileSync(join(dir, 'data/previous.txt'), 'utf8'), 'preserve if validation fails');
  assert.equal(existsSync(join(dir, 'plugins.json')), false);
}));

test('source cannot be the destination snapshot', () => fixture(({ dir, invoke }) => {
  const result = invoke(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Source must be separate/);
  assert.equal(readFileSync(join(dir, 'data/previous.txt'), 'utf8'), 'preserve if validation fails');
}));
