// MODIFIED (tupay): the Catalog and Compression filters. A catalog feed names its catalog, its releases say how
// they are packed, the same link listed twice is one release with both catalogs, and the store filters on both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { parseFeed, feedDocument, stableKey } = await import('../app/state/feed-format.js');
const { mergeReleases, catalogsOf, catalogName } = await import('../app/state/catalogs.js');

const PFS = 'https://files.tupay.dev.br/jl/pfs.jlx';
const pfsFeed = () => ({
  version: 1,
  name: 'PFS Catalog',
  catalog: { id: 'pfs', name: 'PFS Catalog' },
  games: [
    { id: 'PPSA99001', title: 'Zstd Game', about: ['A game.'], releases: [
      { url: 'https://datanodes.to/aaa', label: 'zstd · Data part 1', volume: 'part 1', compression: 'zstd', details: 'Region: USA · Firmware: 10.xx+', record: 'cat-a' },
      { url: 'https://datanodes.to/bbb', label: 'zstd · Data part 2', volume: 'part 2', compression: 'zstd', record: 'cat-a' },
      { url: 'https://vikingfile.com/f/ccc', label: 'LZ4 · Viki' },
      { url: 'https://vikingfile.com/f/ddd', label: 'FPKG · Viki', compression: 'brotli' },
    ] },
  ],
});

test('a catalog feed tags its releases and games with its catalog, compression and notes', () => {
  const feed = parseFeed(pfsFeed(), PFS);
  assert.deepEqual(feed.catalog, { id: 'pfs', name: 'PFS Catalog' });
  const [{ game, releases }] = feed.games;
  assert.deepEqual(game.catalogs, ['pfs']);
  assert.deepEqual(game.compressions, ['zstd', 'lz4']);
  assert.deepEqual(releases.map((r) => r.catalogs), [['pfs'], ['pfs'], ['pfs'], ['pfs']]);
  assert.deepEqual(releases.map((r) => r.compression ?? null), ['zstd', 'zstd', 'lz4', null], 'from the feed, else the label; nothing unknown');
  assert.equal(releases[0].details, 'Region: USA · Firmware: 10.xx+');
  // The cache keeps the catalog: what it parses back to is the same.
  const again = parseFeed(JSON.parse(JSON.stringify(feedDocument(feed))), PFS);
  assert.deepEqual(again.catalog, feed.catalog);
  assert.deepEqual(again.games[0].releases.map((r) => [r.id, r.catalogs, r.compression ?? null]), releases.map((r) => [r.id, r.catalogs, r.compression ?? null]));
});

test('a feed without a catalog, or with a bad one, tags nothing; a Pegasus catalog is its own', () => {
  for (const catalog of [undefined, null, 'pfs', { id: '../x' }, { id: '' }]) {
    const feed = parseFeed({ ...pfsFeed(), catalog }, PFS);
    assert.equal(feed.catalog, null);
    assert.equal(feed.games[0].game.catalogs, undefined);
    assert.equal(feed.games[0].releases[0].catalogs, undefined);
  }
  const pegasus = parseFeed({ name: 'PFS Catalog', packages: [{ titleId: 'PPSA99002', title: 'P', downloadLinks: [{ name: 'zstd · Data', url: 'https://datanodes.to/x' }] }] }, 'https://pegasus-dl.dev/catalogs/pfs.json');
  assert.deepEqual(pegasus.catalog, { id: 'pfs-catalog', name: 'PFS Catalog' });
  assert.equal(pegasus.games[0].releases[0].compression, 'zstd');
});

test('the same link listed twice is one release with every catalog that lists it', () => {
  const bundled = { id: 'r1', url: 'https://datanodes.to/aaa', label: 'Data', provider: 'DataNodes', source: 'pegasus-2' };
  const other = { id: 'r2', url: 'https://mediafire.com/x', label: 'Mediafire', provider: 'MediaFire', source: 'pegasus-0' };
  const fromPfs = { id: 'f1', url: 'https://datanodes.to/aaa', label: 'zstd · Data', provider: 'datanodes', catalogs: ['pfs'], compression: 'zstd', details: 'Region: USA' };
  const fromDlps = { id: 'f2', url: 'https://mediafire.com/x', label: 'Mediafire', provider: 'mediafire', catalogs: ['dlps'] };
  const fromPippo = { id: 'f3', url: 'https://mediafire.com/x', label: 'Mediafire', provider: 'mediafire', catalogs: ['pippo'] };
  const merged = mergeReleases([bundled, other, fromPfs, fromDlps, fromPippo]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'r1', 'the first keeps its place and identity');
  assert.deepEqual(merged[0].catalogs, ['pfs']);
  assert.equal(merged[0].compression, 'zstd');
  assert.equal(merged[0].details, 'Region: USA');
  assert.equal(merged[0].label, 'Data');
  assert.deepEqual(merged[1].catalogs, ['dlps', 'pippo']);
  assert.equal(bundled.catalogs, undefined, 'nothing it was given is changed');
  assert.deepEqual(catalogsOf({ source: 'orbit' }), ['orbit']);
  assert.deepEqual(catalogsOf({ source: 'feed' }), []);
  assert.equal(catalogName('pfs'), 'PFS');
});

test('catalogs: data/catalogs.js is current with the bundled releases (run tools/catalog/catalogs.mjs)', async () => {
  const { buildCatalogs, catalogsModule } = await import('../tools/catalog/catalogs.mjs');
  const shipped = readFileSync(new URL('../app/data/catalogs.js', import.meta.url), 'utf8');
  assert.equal(shipped, catalogsModule(buildCatalogs()));
});

test('the store filters by catalog and by compression, bundled games and feed games alike', async () => {
  const { CATALOG_FEEDS } = await import('../app/state/feeds.js');
  const url = CATALOG_FEEDS.find((item) => item.endsWith('/pfs.jlx'));
  const feed = parseFeed(pfsFeed(), url);
  // PPSA01285 is bundled and listed by PFS among others; the feed adds a zstd link to it.
  feed.games.push(parseFeed({ version: 1, name: 'x', catalog: { id: 'pfs', name: 'PFS Catalog' }, games: [
    { id: 'PPSA01285', title: 'Known', releases: [{ url: 'https://datanodes.to/known', label: 'zstd · Data' }] }] }, url).games[0]);
  feed.logos = { PPSA31246: { logo: 'https://image.api.playstation.com/x/l.png', logoAspect: 2, logoDark: true } };
  const document = feedDocument(feed);
  globalThis.__stubFiles = new Map([[`/download0/JobeesLair/feeds/${stableKey(url)}.json`, JSON.stringify({ url, hash: 'h', name: feed.name, games: feed.games.length, document })]]);
  const catalog = await import('../app/state/catalog.js');
  const facet = (key) => catalog.FACETS.find((item) => item.key === key);
  assert.deepEqual(catalog.FACETS.slice(0, 3).map((item) => item.key), ['platform', 'catalog', 'compression']);
  assert.ok(facet('catalog').options.some((option) => option.value === 'pfs' && option.name === 'PFS'));
  assert.deepEqual(facet('compression').options.map((option) => option.value).sort(), ['lz4', 'zstd']);
  const state = (filters) => ({ filters: { ...catalog.NO_FILTERS, ...filters }, query: '', wishlist: [] });
  const zstd = catalog.filterGames(state({ compression: ['zstd'] })).map((game) => game.id).sort();
  assert.deepEqual(zstd, ['PPSA01285', 'PPSA99001']);
  const pfs = catalog.filterGames(state({ catalog: ['pfs'] })).map((game) => game.id);
  assert.ok(pfs.includes('PPSA99001') && pfs.includes('PPSA01285'));
  assert.ok(!catalog.filterGames(state({ catalog: ['dlps'] })).some((game) => game.id === 'PPSA99001'), 'a PFS-only game is not DLPS');
  assert.ok(catalog.filterGames(state({ catalog: ['dlps'] })).length > 500, 'the bundled games carry their catalogs');
  assert.equal(catalog.facetLabel('catalog', 'pfs'), 'PFS');
  assert.equal(catalog.facetLabel('compression', 'lz4'), 'LZ4');
  const plain = catalog.getGame('PPSA31246');
  assert.equal(plain.art.logo, 'https://image.api.playstation.com/x/l.png', 'a bundled game without a logo takes the feed\'s');
  assert.equal(plain.art.logoAspect, 2);
  assert.equal(plain.art.logoDark, true);
  assert.match(catalog.getGame('PPSA01285').art.logo, /steamstatic/, 'one with its own keeps it');
});

test('a feed brings store logos: in a game\'s art, and for games it does not list', () => {
  const LOGO = 'https://image.api.playstation.com/vulcan/x/logo.png?w=640&thumb=false';
  const feed = parseFeed({ ...pfsFeed(), logos: {
    PPSA01285: [LOGO, 2.5, 1], PPSA00001: [LOGO, 99, 0], CUSA00002: ['javascript:x', 2, 0], bad: [LOGO, 2, 0], PPSA00003: 'x' },
    games: [{ ...pfsFeed().games[0], art: { cover: LOGO, logo: LOGO, logoAspect: 3.1, logoDark: false } }] }, PFS);
  assert.deepEqual(feed.games[0].game.art, { cover: LOGO, logo: LOGO, logoAspect: 3.1 });
  assert.deepEqual(feed.logos, { PPSA01285: { logo: LOGO, logoAspect: 2.5, logoDark: true }, PPSA00001: { logo: LOGO } });
  const again = parseFeed(JSON.parse(JSON.stringify(feedDocument(feed))), PFS);
  assert.deepEqual(again.logos, feed.logos, 'the cache keeps them');
});
