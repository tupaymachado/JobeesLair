// MODIFIED (tupay): a catalog refresh says what it is doing (state/feeds.js subscribeFeedRun) and the toast says it
// (ui/FeedToast.jsx toastOf): which catalog while it runs, then what changed or what failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeJlx } from '../app/state/jlx.js';

test('a refresh tells its progress, then which catalogs changed and which failed', async () => {
  const core = await import('@ps5-react/core');
  const feeds = await import('../app/state/feeds.js');
  const kept = { files: globalThis.__stubFiles, request: core.Http.request };
  globalThis.__stubFiles = new Map();
  const feed = encodeJlx(JSON.stringify({ version: 1, name: 'PFS Catalog', catalog: { id: 'pfs', name: 'PFS Catalog' }, games: [
    { id: 'PPSA10000', title: 'Sample', releases: [{ url: 'https://example.com/a.exfat' }] }] }));
  core.Http.request = async (url) => url.endsWith('/zer0.jlx')
    ? { ok: false, status: 503, headers: {}, text: async () => '' }
    : { ok: true, status: 200, headers: { etag: '"a"' }, text: async () => feed };
  const runs = [];
  const stop = feeds.subscribeFeedRun((run) => runs.push(run));
  try {
    await feeds.refreshFeeds();
    const n = feeds.CATALOG_FEEDS.length;
    assert.deepEqual(runs.slice(0, n).map((run) => [run.phase, run.done, run.total]), feeds.CATALOG_FEEDS.map((_, i) => ['running', i, n]));
    assert.deepEqual(runs.slice(0, n).map((run) => run.name), ['DLPSGame', 'Pippo .exFAT', 'PFS', 'ZER0GAME'], 'named by catalog before any copy is kept');
    const done = runs.at(-1);
    assert.equal(done.phase, 'done');
    assert.deepEqual(done.changed, ['DLPSGame', 'Pippo .exFAT', 'PFS'], 'a first copy is a change');
    assert.deepEqual(done.failed, [{ name: 'ZER0GAME', error: 'HTTP 503' }]);
    assert.equal(feeds.feedRun(), done);
    // The same copies again: nothing changed (the cache already holds them), and the failure is still told.
    runs.length = 0;
    await feeds.refreshFeeds();
    assert.deepEqual(runs.at(-1).changed, ['DLPSGame', 'Pippo .exFAT', 'PFS'], 'still not shown: this launch loaded none of them');
  } finally {
    stop();
    globalThis.__stubFiles = kept.files;
    core.Http.request = kept.request;
  }
});

test('the toast: progress while running, then the result', async () => {
  const { toastOf } = await import('../app/ui/feed-toast.js');
  const t = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`;
  const [running, stays] = toastOf(t, { phase: 'running', done: 1, total: 4, name: 'Pippo' });
  assert.equal(running.status, 'feeds.toast.running{"done":"2","total":"4"}');
  assert.equal(running.title, 'Pippo');
  assert.equal(stays, null, 'it stays while the run goes on');
  const [changed] = toastOf(t, { phase: 'done', total: 4, changed: ['PFS', 'DLPSGame'], failed: [] });
  assert.equal(changed.title, 'feeds.toast.changedTitle');
  assert.equal(changed.detail, 'PFS, DLPSGame');
  assert.ok(!changed.failed);
  const [same, sameMs] = toastOf(t, { phase: 'done', total: 4, changed: [], failed: [] });
  assert.equal(same.status, 'feeds.toast.same');
  assert.ok(sameMs < 6000, 'brief');
  const [failed] = toastOf(t, { phase: 'done', total: 4, changed: ['PFS'], failed: [{ name: 'ZER0GAME', error: 'HTTP 503' }, { name: 'Pippo', error: 'Not JSON.' }] });
  assert.equal(failed.failed, true);
  assert.equal(failed.title, 'ZER0GAME: HTTP 503 · Pippo');
  assert.equal(failed.detail, 'feeds.toast.changed: PFS', 'what did change is still said');
});
