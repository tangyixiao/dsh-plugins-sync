#!/usr/bin/env node
// Merge only the exact generated tree validated by this workflow run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const generated = new Set(['plugins.json', 'RANKING.md', 'catalog-snapshot.json',
  'market-plugins.json', 'markets/README.md', 'markets/status.json']);
const normalizeReadme = (text) => text.replace(/\d+ 个插件/g, '<count> 个插件').replace(/（\d+ 个，/g, '（<count> 个，');
const normalizePackage = (text) => {
  const pkg = JSON.parse(text);
  pkg.description = pkg.description.replace(/\(\d+ plugins\)/g, '(<count> plugins)');
  return pkg;
};

export function assertGeneratedChanges(paths, readBase, readHead, sourceIds) {
  assert.ok(paths.length, 'No generated changes to merge');
  for (const path of paths) {
    assert.ok(!path.split('/').includes('..'), `Unsafe path: ${path}`);
    if (path === 'README.md') {
      assert.equal(normalizeReadme(readHead(path)), normalizeReadme(readBase(path)), 'README changed beyond generated counts');
    } else if (path === 'package.json') {
      assert.deepEqual(normalizePackage(readHead(path)), normalizePackage(readBase(path)), 'Package changed beyond generated counts');
    } else {
      assert.ok(generated.has(path) || /^data\/(?:[^/]+\.json|plugins\/[^/]+\.yml|icons\/[^/]+\.(?:png|jpg|jpeg|webp|svg))$/.test(path)
        || sourceIds.some((id) => path === `markets/snapshots/${id}.json`), `Not generated data: ${path}`);
    }
  }
}

export function assertMergeContext(pr, { repo, base, currentBase, head, status, sourceIds }) {
  assert.equal(pr.state, 'open');
  assert.equal(pr.draft, false);
  assert.equal(pr.head.repo.full_name, repo);
  assert.equal(pr.base.repo.full_name, repo);
  assert.equal(pr.head.ref, 'automation/catalog-sync');
  assert.equal(pr.base.ref, 'main');
  assert.equal(pr.head.sha, head, 'PR head changed after validation');
  // PR base.sha may retain the creation-time SHA; only the live ref proves drift.
  assert.equal(currentBase, base, 'Main changed after validation; rerun sync');
  assert.equal(status.incomplete, undefined);
  assert.deepEqual(status.sources.map((s) => s.id), sourceIds);
  assert.ok(status.sources.every((s) => s.status === 'fresh'), 'Cached or unavailable source: keep PR open');
}

function main() {
  const [number, base, head] = process.argv.slice(2);
  const repo = process.env.GH_REPO;
  assert.match(number ?? '', /^\d+$/);
  assert.match(base ?? '', /^[a-f0-9]{40}$/);
  assert.match(head ?? '', /^[a-f0-9]{40}$/);
  assert.match(repo ?? '', /^[\w.-]+\/[\w.-]+$/);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trimEnd();
  const api = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
  const read = (ref, path) => git('show', `${ref}:${path}`);
  const sourceIds = JSON.parse(read(head, 'markets.config.json')).sources.map((s) => s.id);
  const paths = git('diff', '--name-only', '-z', base, head).split('\0').filter(Boolean);
  assertGeneratedChanges(paths, (path) => read(base, path), (path) => read(head, path), sourceIds);
  const modes = git('diff', '--raw', '--no-abbrev', base, head);
  assert.ok(!modes.split('\n').some((line) => /^:\d+ (?:120000|160000) /.test(line)), 'Symlink or submodule in generated changes');
  const pr = api(`repos/${repo}/pulls/${number}`);
  const currentBase = api(`repos/${repo}/git/ref/heads/main`).object.sha;
  assertMergeContext(pr, { repo, base, currentBase, head, sourceIds,
    status: JSON.parse(read(head, 'markets/status.json')) });
  // No --admin or protection bypass. Bind the merge to the checked commit.
  execFileSync('gh', ['pr', 'merge', number, '--repo', repo, '--merge', '--match-head-commit', head,
    '--subject', 'chore(sync): automatically update catalog and markets',
    '--body-file', 'work/sync-pr-body.md'], { stdio: 'inherit' });
  const merged = api(`repos/${repo}/pulls/${number}`);
  assert.equal(merged.merged, true, 'Merge was queued or blocked; main has not been updated');
  console.log(`Automatically merged PR #${number}: ${merged.merge_commit_sha}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
