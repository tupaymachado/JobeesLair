#!/usr/bin/env node
// One feed per Pegasus catalog (pegasus-dl.dev/api/catalogs), for the app's Catalog and Compression filters.
//
// The upstream live catalog (live-feed.mjs) mixes every catalog into one file and keeps no trace of where a link
// came from. These feeds keep it: each one says which catalog it is (`catalog: { id, name }`), and the app tags every
// release it brings with that id. The same link in two catalogs is one release with both tags (the app merges
// releases by address, state/release-cache.js); the bundled links carry their catalog already (data/catalogs.js).
// Every feed stays in the console's script heap while the app runs, so all of them share BUDGET: zstd and LZ4
// links first, then the games the app lacks, then links the app lacks for games it bundles (main).
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
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { encodeJlx, readJlx } = await import(new URL('../../app/state/jlx.js', import.meta.url).href);

const argOut = process.argv.indexOf('--out');
const OUT = argOut > 0 ? process.argv[argOut + 1] : process.env.JL_FEEDS_DIR || '/srv/jl-feeds';
const STATE = join(OUT, 'state');
const API = 'https://pegasus-dl.dev/api/catalogs';
const UPSTREAM = 'https://raw.githubusercontent.com/JVK3R/JobeesLair-Lists/main/ps5/';
const UA = 'JobeesLair-catalog-feeds (+https://github.com/tupaymachado/JobeesLair)';
// Screenshots and whole descriptions only in a catalog that fits whole: in one that does not, the room goes to more games.
// A little under the app's limits for one feed (state/feed-format.js, state/feeds.js).
const MAX_GAMES = 1450, MAX_LINKS = 5800, MAX_RELEASES = 64;
// The room for every feed together, and for one (its refresh holds its text, its JSON and the parsed copy at once).
const BUDGET = (Number(process.env.JL_FEEDS_MIB) || 1.2) * 1024 * 1024, FEED_BYTES = 0.6 * 1024 * 1024;
const MAX_LOGOS = 400;
// Links kept per game beyond its zstd and LZ4 ones: every build gets one before any build gets a second.
const NEW_GAME_LINKS = 6, KNOWN_GAME_LINKS = 2;
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
const ART_RETRY_DAYS = 14, ART_PER_RUN = Number(process.env.JL_ART_PER_RUN) || 600;
// v2: the store's logo (with its proportions and whether it is dark, logoInfo) and screenshots too.
const ART_VERSION = 2;
const STORE_IMAGE = /^https:\/\/image\.api\.playstation\.com\/[^?#\s"]+$/;
async function storeArt(id) {
  try {
    const response = await fetch(STORE(id), { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (response.status === 404) return { none: true };
    if (!response.ok) return null;
    const images = (await response.json())?.[0]?.media?.images;
    if (!Array.isArray(images)) return { none: true };
    const of = (types) => types.flatMap((type) => images.filter((image) => image?.type === type && STORE_IMAGE.test(image.url)).map((image) => image.url));
    const cover = [...new Set(of(COVERS))].slice(0, 3), hero = of(BACKDROPS)[0], logo = of(['LOGO'])[0], shots = of(['SCREENSHOT']).slice(0, 8);
    if (!cover.length && !hero && !logo) return { none: true };
    const out = { v: ART_VERSION, cover, ...(hero ? { hero } : {}), ...(shots.length ? { shots } : {}) };
    if (logo) {
      const info = await logoInfo(`${logo}?w=640`);
      if (info) Object.assign(out, { logo, logoAspect: info.aspect, ...(info.dark ? { logoDark: true } : {}) });
    }
    return out;
  } catch {
    return null;
  }
}
// A logo's proportions and whether it is dark (the app draws a dark one in the text colour, ui/GameLogo.jsx): a PNG
// read here, 8 bits a channel, any colour type. null when it cannot be read (the logo is then left out).
async function logoInfo(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) return null;
    const png = Buffer.from(await response.arrayBuffer());
    if (png.length > 8e6 || png.toString('latin1', 1, 4) !== 'PNG') return null;
    let at = 8, width = 0, height = 0, depth = 0, type = 0, palette = null, alphas = null;
    const data = [];
    while (at + 8 <= png.length) {
      const length = png.readUInt32BE(at), kind = png.toString('latin1', at + 4, at + 8), body = png.subarray(at + 8, at + 8 + length);
      if (kind === 'IHDR') [width, height, depth, type] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9]];
      else if (kind === 'PLTE') palette = body;
      else if (kind === 'tRNS') alphas = body;
      else if (kind === 'IDAT') data.push(body);
      else if (kind === 'IEND') break;
      at += 12 + length;
    }
    if (!width || !height) return null;
    const aspect = Math.round((width / height) * 1000) / 1000;
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    if (depth !== 8 || !channels || png.length && type === 3 && !palette) return { aspect, dark: false };
    const raw = inflateSync(Buffer.concat(data));
    const stride = width * channels;
    let previous = Buffer.alloc(stride), sum = 0, weight = 0;
    for (let y = 0; y < height; y++) {
      const start = y * (stride + 1), filter = raw[start], line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? line[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
      }
      for (let x = 0; x < width; x += 2) {
        const i = x * channels;
        let r, g, bl, alpha = 255;
        if (type === 3) {
          const k = line[i];
          [r, g, bl] = [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]];
          if (alphas && k < alphas.length) alpha = alphas[k];
        } else if (type === 0 || type === 4) {
          r = g = bl = line[i];
          if (type === 4) alpha = line[i + 1];
        } else {
          [r, g, bl] = [line[i], line[i + 1], line[i + 2]];
          if (type === 6) alpha = line[i + 3];
        }
        if (alpha < 128) continue;
        sum += (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
        weight++;
      }
      previous = line;
    }
    return { aspect, dark: weight > 0 && sum / weight < 0.3 };
  } catch {
    return null;
  }
}
async function readArt(ids, art, today) {
  const stale = (entry) => !entry || (entry.none ? (Date.parse(today) - Date.parse(entry.at || 0)) / 864e5 >= ART_RETRY_DAYS : entry.v !== ART_VERSION);
  // New games first: a bundled game asked only for its logo waits behind them.
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
    ...logoOf(store),
  };
}
// The store's logo, as the carousel and the game page draw it (ui/GameLogo.jsx), or nothing.
const logoOf = (store) => (store?.logo ? { logo: `${store.logo}?w=640&thumb=false`, logoAspect: store.logoAspect, ...(store.logoDark ? { logoDark: true } : {}) } : {});
// The bundled games with no logo of their own (app/data/catalog.js lists a game a line).
function bundledWithoutLogo() {
  const out = new Set();
  for (const line of readFileSync(join(ROOT, 'app/data/catalog.js'), 'utf8').split('\n')) {
    const id = /"id": "((?:CUSA|PPSA)\d{5})"/.exec(line)?.[1];
    if (id && !line.includes('"logo":')) out.add(id);
  }
  return out;
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
  // What goes in, in order, while the room lasts (BUDGET for every feed together, FEED_BYTES for one):
  //   1. every zstd and LZ4 link, bundled links too (the app knows how a link is packed only from a feed);
  //   2. the games the app does not bundle, newest first, with their pictures and a few links;
  //   3. links the app lacks for the games it bundles, newest first, two a game.
  // A feed's games stay in the console's script heap for as long as the app runs (about seven times the file's
  // size), and the app bundles 2 000 games already: all the catalogs whole (4 MiB) ran it out of memory.
  const plans = loaded.map(({ catalog, games }) => ({ catalog, games, entries: new Map(), bytes: 0, links: 0, regrouped: 0 }));
  const regroup = (plan, sets) => sets.flatMap((set) => {
    if (!set.links.some((link) => NAMED_HOST.test(new URL(link.url).host))) return [set];
    const split = byNames(set, names);
    if (split[0] !== set) plan.regrouped++;
    return split;
  });
  const isNew = (id) => !bundledIds.has(id);
  const newest = (a, b) => b.at - a.at || a.id.localeCompare(b.id);
  const tier = (filter, max) => plans.flatMap((plan) => [...plan.games].sort(newest).map((game) => {
    const links = game.links.filter((link) => filter(game, link));
    return links.length ? { plan, game, sets: max ? pick(setsOf(links), max) : setsOf(links) } : null;
  }).filter(Boolean));
  const tiers = [
    tier((game, link) => Boolean(link.compression)),
    tier((game, link) => isNew(game.id) && !link.compression, NEW_GAME_LINKS).sort((a, b) => newest(a.game, b.game)),
    tier((game, link) => !isNew(game.id) && !link.compression && !bundledUrls.has(link.url), KNOWN_GAME_LINKS).sort((a, b) => newest(a.game, b.game)),
  ];
  // The pages to read and the art to ask for, for everything a feed may list.
  const candidates = tiers.flat().slice(0, 6000);
  const wanted = candidates.flatMap(({ sets }) => sets).flatMap((set) => set.links.map((link) => link.url))
    .filter((url) => NAMED_HOST.test(new URL(url).host));
  const looked = await readNames(wanted, names);
  const noLogo = bundledWithoutLogo();
  const asked = await readArt([
    ...new Set(candidates.map(({ game }) => game.id).filter(isNew)),
    ...[...noLogo].filter((id) => id.startsWith('PPSA')),
    ...[...noLogo].filter((id) => !id.startsWith('PPSA')),
  ], art, today);
  // The store logos of bundled games that have none, for the carousel: { id: [url, aspect, dark] }, the best known first.
  const logos = Object.fromEntries([...noLogo].filter((id) => art[id]?.logo)
    .sort((a, b) => (ratings[b]?.[1] ?? 0) - (ratings[a]?.[1] ?? 0) || a.localeCompare(b)).slice(0, MAX_LOGOS).map((id) => {
      const logo = logoOf(art[id]);
      return [id, [logo.logo, logo.logoAspect, logo.logoDark ? 1 : 0]];
    }));
  // The ratings and logos ride on the smallest feed (chosen once the feeds are filled): every console reads every feed.
  let total = jlxSize(ratings) + jlxSize(logos) + plans.length * 300;
  // A game the app does not bundle is described once, in the first feed that lists it (the app takes the first).
  const described = new Set();
  const page = (game) => ({
    art: artOf(game, art[game.id]),
    ...(art[game.id]?.shots?.length ? { shots: art[game.id].shots.slice(0, 3).map((url) => `${url}?w=1280&thumb=false`) } : {}),
    summary: game.about.slice(0, 2).join(' ').slice(0, 300),
    about: game.about.slice(0, 3).map((line) => line.slice(0, 600)),
    addedAt: firstSeen[game.id] ??= today,
  });
  let full = false;
  for (const candidates of tiers) {
    for (const { plan, game, sets } of candidates) {
      const releases = releasesOf(game, regroup(plan, sets)).slice(0, 64);
      const entry = plan.entries.get(game.id);
      const room = MAX_RELEASES - (entry?.releases.length ?? 0);
      const adding = releases.filter((release) => !entry?.releases.some((kept) => kept.url === release.url)).slice(0, room);
      if (!adding.length || plan.links + adding.length > MAX_LINKS || (!entry && plan.entries.size >= MAX_GAMES)) continue;
      const describe = isNew(game.id) && !described.has(game.id);
      const size = adding.reduce((sum, release) => sum + jlxSize(release) + 1, 0)
        + (entry ? 0 : jlxSize({ id: game.id, title: game.title, releases: [] }) + 1)
        + (describe ? jlxSize(page(game)) : 0);
      if (total + size > BUDGET) { full = true; continue; }
      if (plan.bytes + size > FEED_BYTES) continue;
      total += size;
      plan.bytes += size;
      plan.links += adding.length;
      if (describe) described.add(game.id);
      if (entry) entry.releases.push(...adding);
      else plan.entries.set(game.id, { id: game.id, title: game.title, releases: adding });
    }
  }
  // A feed with no games is refused by the app: one the room left empty lists its newest game's links anyway.
  for (const plan of plans) {
    if (plan.entries.size) continue;
    const game = [...plan.games].sort(newest)[0];
    if (!game) continue;
    const releases = releasesOf(game, regroup(plan, pick(setsOf(game.links), KNOWN_GAME_LINKS)));
    plan.entries.set(game.id, { id: game.id, title: game.title, releases });
    plan.links += releases.length;
    total += jlxSize(plan.entries.get(game.id));
  }
  // Pages go to the first feed (in the app's order) that lists the game.
  const first = new Map();
  for (const plan of plans) for (const id of plan.entries.keys()) if (isNew(id) && !first.has(id)) first.set(id, plan);
  const byId = new Map(plans.flatMap((plan) => plan.games.map((game) => [game.id, game])));

  const smallest = plans.filter((plan) => plan.entries.size).reduce((best, plan) => (!best || plan.bytes < best.bytes ? plan : best), null);
  mkdirSync(OUT, { recursive: true });
  const index = [];
  for (const plan of plans) {
    const { catalog } = plan;
    const out = [...plan.entries.values()].map((entry) => (first.get(entry.id) === plan
      ? { id: entry.id, title: entry.title, ...page(byId.get(entry.id)), releases: entry.releases }
      : entry));
    const name = clip(catalog.name, 60) || catalog.slug;
    const withExtras = plan === smallest;
    const feed = { version: 1, name, catalog: { id: catalog.slug, name }, source: 'pegasus-dl.dev', ...(withExtras && Object.keys(ratings).length ? { ratings } : {}), ...(withExtras && Object.keys(logos).length ? { logos } : {}), games: out };
    const text = `${encodeJlx(feed)}\n`;
    writeAtomic(join(OUT, `${catalog.slug}.jlx`), text);
    const compressed = out.reduce((sum, entry) => sum + entry.releases.filter((release) => release.compression).length, 0);
    const fresh = out.filter((entry) => isNew(entry.id)).length;
    index.push({ id: catalog.slug, name, file: `${catalog.slug}.jlx`, games: out.length, links: plan.links, compressed, newGames: fresh, updatedAt: new Date().toISOString() });
    console.log(`${catalog.slug}: ${out.length} games (${fresh} not bundled), ${plan.links} links (${compressed} zstd/LZ4), ${(text.length / 1048576).toFixed(2)} MiB${plan.regrouped ? `, ${plan.regrouped} sets regrouped by file name` : ''}`);
  }
  const notBundled = new Set(plans.flatMap((plan) => plan.games.map((game) => game.id)).filter(isNew));
  console.log(`all feeds: ${(total / 1048576).toFixed(2)} of ${(BUDGET / 1048576).toFixed(2)} MiB${full ? ' (full)' : ''}; games not bundled: ${described.size} of ${notBundled.size}`);
  writeAtomic(join(OUT, 'index.json'), `${JSON.stringify({ updatedAt: new Date().toISOString(), feeds: index }, null, 1)}\n`);
  writeAtomic(join(STATE, 'names.jlx'), `${encodeJlx(Object.fromEntries(Object.entries(names).sort()))}\n`);
  writeAtomic(join(STATE, 'first-seen.json'), `${JSON.stringify(Object.fromEntries(Object.entries(firstSeen).sort()), null, 1)}\n`);
  writeAtomic(join(STATE, 'art.json'), `{\n${Object.entries(art).sort(([a], [b]) => a.localeCompare(b)).map(([id, entry]) => `${JSON.stringify(id)}:${JSON.stringify(entry)}`).join(',\n')}\n}\n`);
  console.log(`ratings: ${Object.keys(ratings).length}; logos for bundled games: ${Object.keys(logos).length}; host pages read: ${looked}; store art asked: ${asked}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
