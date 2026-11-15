// Links pasted in Downloads → Add links (state/pasted-links.js): which are one download in parts, which are
// downloads of their own, and what the queue gets for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = process.env.JL_REPO || fileURLToPath(new URL('..', import.meta.url));
const { linkName, parseLinks, pastedDownloads, planLinks, volumeOf } = await import(pathToFileURL(path.join(repo, 'app/state/pasted-links.js')).href);

test('links: found in any text, joined or apart, once each, trailing punctuation dropped', () => {
  assert.deepEqual(parseLinks('see https://a.example/x.part1.rar, and\nhttps://a.example/x.part2.rar.'), ['https://a.example/x.part1.rar', 'https://a.example/x.part2.rar']);
  // The console's URL keyboard and a phone's one-line box take no spaces: links arrive joined.
  assert.deepEqual(parseLinks('https://a.example/1.rarhttps://b.example/2magnet:?xt=urn:btih:abc&dn=Game'), ['https://a.example/1.rar', 'https://b.example/2', 'magnet:?xt=urn:btih:abc&dn=Game']);
  assert.deepEqual(parseLinks('https://a.example/x https://a.example/x'), ['https://a.example/x']);
  assert.deepEqual(parseLinks('no links here'), []);
  assert.throws(() => parseLinks(Array.from({ length: 65 }, (_, i) => `https://a.example/${i}`).join(' ')), /At most 64 links/);
});

test('links: a file name from the path, decoded, or a magnet\'s display name', () => {
  assert.equal(linkName('https://h.example/dl/My%20Game.part01.rar?token=1#x'), 'My Game.part01.rar');
  assert.equal(linkName('magnet:?xt=urn:btih:abc&dn=Some+Game+PPSA01234'), 'Some Game PPSA01234');
  assert.equal(linkName('https://vikingfile.com/f/AbC123'), 'AbC123');
  assert.equal(linkName('https://h.example/'), '');
  assert.equal(linkName('https://h.example/a%2F..%2Fb'), 'a_.._b', 'no path separators survive');
});

test('links: volume names, in every common numbering', () => {
  assert.deepEqual(volumeOf('Game.part1.rar'), { base: 'Game', number: 1, scheme: 'part.rar' });
  assert.deepEqual(volumeOf('Game.part012.rar'), { base: 'Game', number: 12, scheme: 'part.rar' });
  assert.deepEqual(volumeOf('Game.rar'), { base: 'Game', number: 1, scheme: 'rnn', lone: true });
  assert.deepEqual(volumeOf('Game.r00'), { base: 'Game', number: 2, scheme: 'rnn' });
  assert.deepEqual(volumeOf('Game.7z.003'), { base: 'Game', number: 3, scheme: 'split.7z' });
  assert.deepEqual(volumeOf('Game.exfat.001'), { base: 'Game.exfat', number: 1, scheme: 'raw' });
  assert.equal(volumeOf('Game.exfat'), null);
  assert.equal(volumeOf('Game.zip'), null);
});

test('links: numbered volumes are one set in volume order, whatever order they were pasted in', () => {
  const plan = planLinks([
    'https://h.example/Game.part3.rar', 'https://h.example/Game.part1.rar', 'https://h.example/Other.zip', 'https://h.example/Game.part2.rar',
    'https://h.example/Old.r00', 'https://h.example/Old.rar', 'https://h.example/Lone.rar', 'https://h.example/Arc.7z.002', 'https://h.example/Arc.7z.001',
  ]);
  assert.deepEqual(plan.loose, []);
  assert.deepEqual(plan.downloads, [
    { name: 'Game', links: ['https://h.example/Game.part1.rar', 'https://h.example/Game.part2.rar', 'https://h.example/Game.part3.rar'], set: true },
    { name: 'Old', links: ['https://h.example/Old.rar', 'https://h.example/Old.r00'], set: true },
    { name: 'Lone', links: ['https://h.example/Lone.rar'], set: false },
    { name: 'Arc', links: ['https://h.example/Arc.7z.001', 'https://h.example/Arc.7z.002'], set: true },
    { name: 'Other.zip', links: ['https://h.example/Other.zip'], set: false },
  ]);
});

test('links: a set missing a part, with one twice, or in pieces of no archive cannot be downloaded, and says why', () => {
  const problem = (links) => planLinks(links).downloads[0].problem;
  assert.equal(problem(['https://h.example/G.part1.rar', 'https://h.example/G.part3.rar']), 'Part 2 of G is missing.');
  assert.equal(problem(['https://h.example/G.part2.rar', 'https://h.example/G.part3.rar']), 'Part 1 of G is missing.');
  assert.equal(problem(['https://h.example/G.part1.rar', 'https://a.example/G.part1.rar']), 'Part 1 was pasted twice.');
  assert.match(problem(['https://h.example/G.exfat.001', 'https://h.example/G.exfat.002']), /only when they are archives/);
  assert.equal(problem(['https://h.example/G.7z.000', 'https://h.example/G.7z.001']), undefined, 'pieces numbered from .000');
  assert.throws(() => pastedDownloads(planLinks(['https://h.example/G.part1.rar', 'https://h.example/G.part3.rar'])), /Part 2 of G is missing/);
});

test('links: several pages whose names say nothing are left to the player: parts of one file, or one download each', () => {
  const links = ['https://vikingfile.com/f/aaa', 'https://vikingfile.com/f/bbb'];
  const plan = planLinks(links);
  assert.deepEqual(plan, { downloads: [], loose: links });
  const [set] = pastedDownloads(plan, { looseAs: 'set' });
  assert.equal(set.release.format, 'archive-set');
  assert.deepEqual(set.release.parts.map((part) => [part.number, part.sources[0].url]), [[1, links[0]], [2, links[1]]]);
  const each = pastedDownloads(plan, { looseAs: 'each' });
  assert.deepEqual(each.map((item) => item.release.url), links);
  // One such link is just that download.
  assert.deepEqual(planLinks([links[0]]), { downloads: [{ name: 'aaa', links: [links[0]], set: false }], loose: [] });
});

test('links: what the queue gets, with a title id from the names, the same ids for the same paste, and debrid when it takes it', () => {
  const links = ['https://h.example/PPSA01234-Game.part1.rar', 'https://h.example/PPSA01234-Game.part2.rar'];
  const [first] = pastedDownloads(planLinks(links));
  const [again] = pastedDownloads(planLinks([...links].reverse()));
  assert.equal(first.game.titleId, 'PPSA01234');
  assert.equal(first.game.title, 'PPSA01234-Game');
  assert.equal(first.release.filename, 'PPSA01234-Game');
  assert.equal(first.release.id, again.release.id, 'the same set, however it was pasted');
  assert.deepEqual(first.release.parts.map((part) => part.sources[0].filename), ['PPSA01234-Game.part1.rar', 'PPSA01234-Game.part2.rar']);
  const [single] = pastedDownloads(planLinks(['https://h.example/Game.exfat']));
  assert.deepEqual([single.release.filename, single.release.url, single.viaDebrid], ['Game.exfat', 'https://h.example/Game.exfat', false]);
  assert.match(single.game.titleId, /^link-/, 'no title id in the name: the download\'s own id stands in');
  const debrid = { supports: (release) => release.provider === 'Torrent', source: (release) => ({ ...release, id: `${release.id}~torbox`, debrid: { service: 'torbox' } }) };
  const [torrent, direct] = pastedDownloads(planLinks(['magnet:?xt=urn:btih:abc&dn=Game.exfat', 'https://h.example/Game.exfat']), { debrid, looseAs: 'each' });
  assert.deepEqual([torrent.viaDebrid, torrent.release.debrid, torrent.release.filename], [true, { service: 'torbox' }, 'Game.exfat']);
  assert.equal(direct.viaDebrid, false);
});
