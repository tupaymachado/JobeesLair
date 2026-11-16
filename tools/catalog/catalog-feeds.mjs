#!/usr/bin/env node
// One feed per Pegasus catalog (pegasus-dl.dev/api/catalogs), for the app's Catalog and Compression filters.
//
// The upstream live catalog (live-feed.mjs) mixes every catalog into one file and keeps no trace of where a link
// came from. These feeds keep it: each one says which catalog it is (`catalog: { id, name }`), and the app tags every
// release it brings with that id. The same link in two catalogs is one release with both tags (the app merges
// releases by address, state/release-cache.js), and a link the app already bundles takes the tag too, so a catalog
// that fits whole is listed whole. A catalog too big for one feed (DLPS: ~30 000 links, a feed holds 6 000) brings
// only the links the app does not bundle; the bundled ones carry their catalog already (data/catalogs.js).
//
// Each link also says how it is packed when its name or the game's notes do ("zstd · Data", "Format: LZ4"):
// `compression`, for the Compression filter. A game's technical notes (Format, Region, Firmware, APR, Notes...)
// are taken out of its description and go with its links as `details`, so the store page shows only the game.
//
//   node tools/catalog/catalog-feeds.mjs [--out DIR]
//
// Writes DIR/<catalog>.jlx (JLX1, app/state/jlx.js) and DIR/index.json; DIR/state keeps what a run learns for the
// next (file names read from host pages, store art, the day each game was first listed). DIR defaults to
// $JL_FEEDS_DIR or /srv/jl-feeds. Store ratings and the first records are taken from the upstream lists.

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { encodeJlx, readJlx } = await import(new URL('../../app/state/jlx.js', import.meta.url).href);

const argOut = process.argv.indexOf('--out');
const OUT = argOut > 0 ? process.argv[argOut + 1] : process.env.JL_FEEDS_DIR || '/srv/jl-feeds';
const STATE = join(OUT, 'state');
const API = 'https://pegasus-dl.dev/api/catalogs';
const UPSTREAM = 'https://raw.githubusercontent.com/JVK3R/JobeesLair-Lists/main/ps5/';
const UA = 'JobeesLair-catalog-feeds (+https://github.com/tupaymachado/JobeesLair)';
// A little under the app's limits for one feed (state/feed-format.js, state/feeds.js).
const MAX_GAMES = 1450, MAX_LINKS = 5800, MAX_BYTES = 1.9 * 1024 * 1024;
// Links kept per game when a catalog does not fit whole: every build gets one before any build gets a second.
const NEW_GAME_LINKS = 16, KNOWN_GAME_LINKS = 6;
const TITLE_ID = /^(?:CUSA|PPSA)\d{5}$/;

async function fetchText(url, accept = 'application/json') {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}
const getJSON = async (url) => JSON.parse(await fetchText(url));

function readState(name, fallback) {
  try {
    const text = readFileSync(join(STATE, name), 'utf8');
    return JSON.parse(name.endsWith('.jlx') ? readJlx(text) : text);
  } catch {
    return fallback;
  }
}
function writeAtomic(path, text) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}
// The upstream builder's records, the first time (or when ours is lost): no host page or store asked twice.
async function seed(name) {
  if (existsSync(join(STATE, name))) return;
  try {
    writeAtomic(join(STATE, name), await fetchText(UPSTREAM + name, '*/*'));
    console.log(`seeded state/${name} from the upstream lists`);
  } catch (error) {
    console.warn(`state/${name} not seeded: ${error.message}`);
  }
}

// The bundled catalog: its title IDs and every link its releases hold.
function bundled() {
  const ids = new Set([...readFileSync(join(ROOT, 'app/data/catalog.js'), 'utf8').matchAll(/"id": "((?:CUSA|PPSA)\d{5})"/g)].map((m) => m[1]));
  const urls = new Set();
  const dir = join(ROOT, 'app/data/releases');
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    for (const release of JSON.parse(readJlx(readFileSync(join(dir, name), 'utf8')))) {
      if (release.url) urls.add(release.url);
      if (release.browserUrl) urls.add(release.browserUrl);
    }
  }
  return { ids, urls };
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const plain = (html) => typeof html === 'string'
  ? html.replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e])
  : '';
const clip = (value, max) => (typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max) : '');
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tag = (value) => { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const httpsURL = (value) => typeof value === 'string' && /^https:\/\/[^\s/]+\/\S*$/.test(value) && value.length <= 600;

// "Format: zstd", "Region: USA", "Notes: ...": a release's technical notes, not the game's description.
const NOTE = /^(format|region|firmware|fw|apr|notes?|credits?|updated|size|version|languages?|langs?|backport|requires?|password|dump(?:ed)? by|type)\s*:/i;
function describe(html) {
  const notes = [], about = [];
  for (const line of plain(html).split('\n').map((text) => clip(text, 600)).filter(Boolean))
    (NOTE.test(line) ? notes : about).push(line);
  return { notes, about };
}
// How a link is packed, from its own name first, else the game's "Format:" note.
const COMPRESSION = [['zstd', /\bzstd\b|\bzst\b/i], ['lz4', /\blz4\b/i]];
const compressionOf = (...texts) => {
  for (const text of texts) for (const [name, test] of COMPRESSION) if (test.test(text ?? '')) return name;
  return null;
};

// "EUR 10.xx Base - 1fichier part 2", "zstd · Data - pt.2": one volume of a set; its set is the label without it.
const PART = /\s*(?:[-·]\s*)?\b(?:part|pt)\.?\s*(\d{1,3})\s*$/i;
function setsOf(links) {
  const sets = new Map();
  for (const link of links) {
    const part = PART.exec(link.label);
    const name = part ? link.label.replace(PART, '').trim() : link.label;
    const key = part ? `${link.build}|${name}` : link.url;
    if (!sets.has(key)) sets.set(key, { build: link.build, name, parted: Boolean(part), links: [] });
    sets.get(key).links.push({ ...link, part: part ? Number(part[1]) : 0 });
  }
  return [...sets.values()]
    .map((set) => ({ ...set, links: set.links.sort((a, b) => a.part - b.part) }))
    .filter((set) => !set.parted || set.links.every((link, index) => link.part === index + 1));
}

// AkiraBox and Rootz name a file in the page title; DLPS numbers their links "part 1, 2, 3" in page order whether
// they are volumes or whole files. Those links are read once (state/names.jlx) and regrouped by the names
// (the same rules as live-feed.mjs).
const NAMED_HOST = /^(?:www\.)?(?:akirabox\.(?:com|to)|rootz\.so)$/;
const DEAD = 'dead';
function volumeOf(name) {
  let m = /^(.*)\.part0*(\d{1,3})\.rar$/i.exec(name);
  if (m) return { base: `${m[1]}.rar`, part: Number(m[2]) };
  m = /^(.*\.(?:7z|zip|rar))\.0*(\d{1,3})$/i.exec(name);
  if (m) return { base: m[1], part: Number(m[2]) };
  m = /^(.*)\.r(\d\d)$/i.exec(name);
  if (m) return { base: `${m[1]}.rar`, part: Number(m[2]) + 2, old: true };
  return null;
}
async function pageName(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (response.status === 404 || response.status === 410) return DEAD;
    if (!response.ok) return null;
    const title = (/<title>([^<]*)<\/title>/i.exec(await response.text())?.[1] ?? '').replace(/&amp;/g, '&').replace(/\s*·\s*AkiraBox\s*$/i, '').trim();
    if (/^AkiraBox\b/i.test(title)) return DEAD;
    return /\.[a-z0-9]{2,6}$/i.test(title) && title.length <= 200 ? title : null;
  } catch {
    return null;
  }
}
async function readNames(urls, names) {
  const queue = [...new Set(urls)].filter((url) => !(url in names));
  let looked = 0;
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      const name = await pageName(url);
      if (name) names[url] = name;
      looked++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return looked;
}
function byNames(set, names) {
  if (!set.links.every((link) => names[link.url])) return [set];
  const live = set.links.filter((link) => names[link.url] !== DEAD);
  const groups = new Map();
  for (const link of live) {
    const name = names[link.url];
    const volume = volumeOf(name);
    const key = volume ? `v|${volume.base.toLowerCase()}` : `f|${link.url}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...link, file: name, part: volume ? volume.part : 0 });
  }
  const out = [];
  const kinds = {};
  for (const [key, links] of groups) {
    links.sort((a, b) => a.part - b.part);
    if (key.startsWith('v|') && links[0].part === 2) {
      const first = live.find((link) => names[link.url].toLowerCase() === key.slice(2));
      if (first) links.unshift({ ...first, file: names[first.url], part: 1 });
    }
    if (key.startsWith('f|') && live.some((link) => volumeOf(names[link.url])?.old && volumeOf(names[link.url]).base.toLowerCase() === names[links[0].url].toLowerCase())) continue;
    const parted = key.startsWith('v|') && links.length > 1;
    if (parted && !links.every((link, index) => link.part === index + 1)) continue;
    const kind = (/\.([a-z0-9]+)$/i.exec(links[0].file)?.[1] ?? 'file').toUpperCase();
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    out.push({ build: set.build, name: `${set.name} (${kind}${kinds[kind] > 1 ? ` ${kinds[kind]}` : ''})`, parted, named: true, links: parted ? links : links.map((link) => ({ ...link, part: 0 })) });
  }
  return out;
}
function fileName(game, link, label) {
  if (!link.file) return `${game.id}-${slug(label).slice(0, 60) || link.build}-${tag(link.url)}`;
  const prefix = `${game.id}-${tag(link.url)}-`;
  return prefix + link.file.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-(150 - prefix.length));
}
// Whole sets, every build's first set before any build's second, up to max links.
function pick(sets, max) {
  const byBuild = new Map();
  for (const set of sets) byBuild.set(set.build, [...(byBuild.get(set.build) ?? []), set]);
  const out = [];
  let used = 0;
  for (let round = 0; ; round++) {
    let any = false;
    for (const list of byBuild.values()) {
      const set = list[round];
      if (!set) continue;
      any = true;
      if (used && used + set.links.length > max) continue;
      out.push(set);
      used += set.links.length;
    }
    if (!any || used >= max) break;
  }
  return out;
}

// The pictures of a game the app does not bundle, from the PlayStation Store (as live-feed.mjs).
const STORE = (id) => `https://m.np.playstation.com/api/catalog/v2/titles/${id}_00/concepts?country=US&language=en&age=999`;
const COVERS = ['MASTER', 'GAMEHUB_COVER_ART', 'PORTRAIT_BANNER'], BACKDROPS = ['BACKGROUND_LAYER_ART', 'SIXTEEN_BY_NINE_BANNER', 'FOUR_BY_THREE_BANNER'];
const ART_RETRY_DAYS = 14, ART_PER_RUN = 400;
const STORE_IMAGE = /^https:\/\/image\.api\.playstation\.com\/[^?#\s"]+$/;
async function storeArt(id) {
  try {
    const response = await fetch(STORE(id), { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (response.status === 404) return { none: true };
    if (!response.ok) return null;
    const images = (await response.json())?.[0]?.media?.images;
    if (!Array.isArray(images)) return { none: true };
    const of = (types) => types.flatMap((type) => images.filter((image) => image?.type === type && STORE_IMAGE.test(image.url)).map((image) => image.url));
    const cover = [...new Set(of(COVERS))].slice(0, 3), hero = of(BACKDROPS)[0];
    return cover.length || hero ? { cover, ...(hero ? { hero } : {}) } : { none: true };
  } catch {
    return null;
  }
}
async function readArt(ids, art, today) {
  const stale = (entry) => !entry || entry.none && (Date.parse(today) - Date.parse(entry.at || 0)) / 864e5 >= ART_RETRY_DAYS;
  const queue = [...new Set(ids)].filter((id) => stale(art[id])).slice(0, ART_PER_RUN);
  let asked = 0;
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      const found = await storeArt(id);
      if (found) art[id] = found.none ? { none: true, at: today } : found;
      asked++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return asked;
}
function artOf(game, store) {
  const covers = [...(store?.cover ?? []).map((url) => `${url}?w=384&thumb=false`), ...(game.cover ? [game.cover] : [])];
  return {
    ...(covers.length ? { cover: covers[0] } : {}),
    ...(covers.length > 1 ? { coverFallbacks: covers.slice(1, 5) } : {}),
    ...(store?.hero ? { hero: `${store.hero}?w=1920&thumb=false` } : {}),
  };
}

const jlxSize = (value) => encodeJlx(value).length - 5;

// A catalog's games, one per title ID, every link of every listing of it.
function gamesOf(document) {
  const games = new Map();
  for (const item of Array.isArray(document.packages) ? document.packages : []) {
    const id = clip(item?.titleId, 9).toUpperCase();
    const title = clip(item?.title, 200);
    if (!TITLE_ID.test(id) || !title || !Array.isArray(item.downloadLinks)) continue;
    const at = Date.parse(item.createdAt) || 0;
    let game = games.get(id);
    if (!game) games.set(id, game = { id, title, at, version: '', cover: '', about: [], links: [], seen: new Set() });
    if (at >= game.at) {
      game.at = at;
      game.version = clip(item.version, 32) || game.version;
    }
    const cover = item.originalPosterUrl || item.posterUrl;
    if (!game.cover && httpsURL(cover)) game.cover = cover;
    const { notes, about } = describe(item.description);
    if (!game.about.length) game.about = about.map((line) => clip(line, 1000)).slice(0, 4);
    const format = notes.find((line) => /^format\s*:/i.test(line)) ?? '';
    const details = clip(notes.filter((line) => !/^(updated|credits?)\s*:/i.test(line)).join(' · '), 240);
    const size = Number.isSafeInteger(item.sizeBytes) && item.sizeBytes > 0 ? item.sizeBytes : null;
    for (const link of item.downloadLinks) {
      const url = link?.url;
      if (!httpsURL(url) || game.seen.has(url)) continue;
      game.seen.add(url);
      const build = clip(link?.details?.buildKey, 16).toLowerCase() || 'game';
      const host = clip(link?.details?.hostLabel, 40);
      const label = clip(link?.name, 100) || [build, host].filter(Boolean).join(' - ');
      const compression = compressionOf(label, format);
      game.links.push({ url, build, host, label, version: clip(item.version, 32), compression, details, size });
    }
  }
  return [...games.values()].filter((game) => game.links.length);
}

function releasesOf(game, sets) {
  return sets.flatMap((set) => set.links.map((link) => {
    // Volumes as the app groups them (state/release-sets.js reads "part N" in the label).
    const label = set.parted || set.named ? (link.part ? `${set.name} part ${link.part}` : set.name) : link.label;
    return {
      url: link.url,
      filename: fileName(game, link, label),
      label,
      ...(link.part ? { volume: `part ${link.part}` } : {}),
      ...(link.host ? { provider: link.host.toLowerCase() } : {}),
      ...(link.version ? { version: link.version } : {}),
      // The size a listing names is the whole game's: only a one-link set's file is that size.
      ...(link.size && !set.parted && set.links.length === 1 ? { sizeBytes: link.size } : {}),
      category: link.build === 'dlc' ? 'dlc' : 'game',
      ...(link.build === 'fpkg' ? { format: 'fpkg' } : {}),
      ...(link.compression ? { compression: link.compression } : {}),
      ...(link.details ? { details: link.details } : {}),
      requiresBrowser: true,
      record: set.parted ? `cat-${game.id.toLowerCase()}-${tag(`${set.build}|${set.name}`)}` : `cat-${game.id.toLowerCase()}-${tag(link.url)}`,
    };
  }));
}

async function main() {
  mkdirSync(STATE, { recursive: true });
  await Promise.all(['names.jlx', 'art.json', 'first-seen.json'].map(seed));
  const { ids: bundledIds, urls: bundledUrls } = bundled();
  const { catalogs = [] } = await getJSON(API);
  if (!catalogs.length) throw new Error('pegasus-dl.dev listed no catalogs');

  let ratings = {};
  try {
    ratings = Object.fromEntries(Object.entries(await getJSON(`${UPSTREAM}ratings.json`))
      .filter(([, entry]) => entry.count > 0).map(([id, entry]) => [id, [entry.stars, entry.count]]));
    writeAtomic(join(STATE, 'ratings.json'), JSON.stringify(ratings));
  } catch (error) {
    ratings = readState('ratings.json', {});
    console.warn(`ratings: upstream not read (${error.message}), ${Object.keys(ratings).length} kept from the last run`);
  }
  const names = readState('names.jlx', {});
  const art = readState('art.json', {});
  const firstSeen = readState('first-seen.json', {});
  const today = new Date().toISOString().slice(0, 10);

  const loaded = [];
  for (const catalog of catalogs) {
    if (!httpsURL(catalog.sourceUrl) || !/^[a-z0-9-]{1,24}$/.test(catalog.slug ?? '')) continue;
    try {
      loaded.push({ catalog, games: gamesOf(await getJSON(catalog.sourceUrl)) });
    } catch (error) {
      console.warn(`skipped ${catalog.name}: ${error.message}`);
    }
  }
  // Whether a catalog fits one feed whole (every link, bundled ones too), else only what the app lacks.
  const plans = loaded.map(({ catalog, games }) => {
    const links = games.reduce((sum, game) => sum + game.links.length, 0);
    const whole = games.length <= MAX_GAMES && links <= MAX_LINKS;
    const kept = whole ? games : games.map((game) => ({ ...game, links: game.links.filter((link) => !bundledUrls.has(link.url)) })).filter((game) => game.links.length);
    const ordered = kept.sort((a, b) => Number(bundledIds.has(a.id)) - Number(bundledIds.has(b.id)) || b.at - a.at || a.id.localeCompare(b.id));
    const chosen = ordered.map((game) => ({
      game,
      sets: whole ? setsOf(game.links) : pick(setsOf(game.links), bundledIds.has(game.id) ? KNOWN_GAME_LINKS : NEW_GAME_LINKS),
    }));
    return { catalog, whole, links, chosen };
  });
  // The pages to read and the art to ask for, for everything any feed may list.
  const wanted = plans.flatMap(({ chosen }) => chosen.slice(0, MAX_GAMES + 200)).flatMap(({ sets }) => sets).flatMap((set) => set.links.map((link) => link.url))
    .filter((url) => NAMED_HOST.test(new URL(url).host));
  const looked = await readNames(wanted, names);
  const asked = await readArt(plans.flatMap(({ chosen }) => chosen.slice(0, MAX_GAMES + 200)).map(({ game }) => game.id).filter((id) => !bundledIds.has(id)), art, today);

  // The ratings ride on the smallest feed: every console reads every feed.
  const smallest = plans.reduce((best, plan) => (!best || plan.links < best.links ? plan : best), null);
  mkdirSync(OUT, { recursive: true });
  const index = [];
  for (const plan of plans) {
    const { catalog } = plan;
    const withRatings = plan === smallest ? ratings : {};
    const out = [];
    let links = 0, bytes = 300 + jlxSize(withRatings), regrouped = 0;
    for (const { game, sets } of plan.chosen) {
      if (out.length >= MAX_GAMES || links >= MAX_LINKS) break;
      const known = bundledIds.has(game.id);
      const final = sets.flatMap((set) => {
        if (!set.links.some((link) => NAMED_HOST.test(new URL(link.url).host))) return [set];
        const split = byNames(set, names);
        if (split[0] !== set) regrouped++;
        return split;
      });
      const releases = releasesOf(game, final).slice(0, 64);
      if (!releases.length || links + releases.length > MAX_LINKS) continue;
      const entry = {
        id: game.id,
        title: game.title,
        ...(known ? {} : { art: artOf(game, art[game.id]), summary: game.about.slice(0, 2).join(' ').slice(0, 300), about: game.about, addedAt: firstSeen[game.id] ??= today }),
        releases,
      };
      const size = jlxSize(entry) + 1;
      if (bytes + size > MAX_BYTES) break;
      bytes += size;
      links += releases.length;
      out.push(entry);
    }
    const name = clip(catalog.name, 60) || catalog.slug;
    const feed = { version: 1, name, catalog: { id: catalog.slug, name }, source: 'pegasus-dl.dev', ...(Object.keys(withRatings).length ? { ratings: withRatings } : {}), games: out };
    writeAtomic(join(OUT, `${catalog.slug}.jlx`), `${encodeJlx(feed)}\n`);
    const left = plan.chosen.length - out.length;
    index.push({ id: catalog.slug, name, file: `${catalog.slug}.jlx`, games: out.length, links, whole: plan.whole && !left, updatedAt: new Date().toISOString() });
    console.log(`${catalog.slug}: ${out.length} games, ${links} links, ${(bytes / 1048576).toFixed(2)} MiB, ${plan.whole ? 'whole' : `only links the app lacks (${plan.links} in the catalog)`}${left ? `, ${left} games left out` : ''}${regrouped ? `, ${regrouped} sets regrouped by file name` : ''}`);
  }
  writeAtomic(join(OUT, 'index.json'), `${JSON.stringify({ updatedAt: new Date().toISOString(), feeds: index }, null, 1)}\n`);
  writeAtomic(join(STATE, 'names.jlx'), `${encodeJlx(Object.fromEntries(Object.entries(names).sort()))}\n`);
  writeAtomic(join(STATE, 'first-seen.json'), `${JSON.stringify(Object.fromEntries(Object.entries(firstSeen).sort()), null, 1)}\n`);
  writeAtomic(join(STATE, 'art.json'), `{\n${Object.entries(art).sort(([a], [b]) => a.localeCompare(b)).map(([id, entry]) => `${JSON.stringify(id)}:${JSON.stringify(entry)}`).join(',\n')}\n}\n`);
  console.log(`ratings: ${Object.keys(ratings).length}; host pages read: ${looked}; store art asked: ${asked}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
