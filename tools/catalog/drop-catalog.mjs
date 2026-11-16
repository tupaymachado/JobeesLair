#!/usr/bin/env node
// MODIFIED (tupay): takes one Pegasus catalog out of the bundled data (DLPSGame: badly kept, its links mostly dead).
//
//   node tools/catalog/drop-catalog.mjs [slug]        (default dlps)
//
// Each of its releases (app/data/releases, `source` pegasus-N) goes, unless another Pegasus catalog lists the
// same link: that one stays, as the other catalog's. A game left with no release goes from data/catalog.js
// (its release and page files too, and its screen-saver slides); a game that keeps some has its providers and
// `direct` worked out again from what is left. Then run catalogs.mjs and formats.mjs (tests check both).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { readJlx, encodeJlx } = await import(pathToFileURL(path.join(repo, 'app/state/jlx.js')).href);
const { SOURCE_CATALOGS } = await import(pathToFileURL(path.join(repo, 'app/state/catalogs.js')).href);
const { sourceKind } = await import(pathToFileURL(path.join(repo, 'app/state/download-sources.js')).href);

const DROP = process.argv[2] || 'dlps';
const sourceOf = Object.fromEntries(Object.entries(SOURCE_CATALOGS).map(([source, slug]) => [slug, source]));
const dropped = sourceOf[DROP];
if (!dropped) throw new Error(`no bundled source for catalog ${DROP}`);

// The links every other catalog lists, by the catalog that lists them.
const { catalogs } = await (await fetch('https://pegasus-dl.dev/api/catalogs')).json();
const elsewhere = new Map();
for (const catalog of catalogs) {
  if (catalog.slug === DROP || !sourceOf[catalog.slug]) continue;
  const document = await (await fetch(catalog.sourceUrl)).json();
  for (const item of document.packages ?? []) for (const link of item.downloadLinks ?? []) {
    if (link?.url && !elsewhere.has(link.url)) elsewhere.set(link.url, sourceOf[catalog.slug]);
  }
}
if (elsewhere.size < 1000) throw new Error(`only ${elsewhere.size} links in the other catalogs; not trusting that`);

const hostName = (url) => {
  const host = new URL(url).host.replace(/^www\./, '');
  return host === 'archive.org' || host.endsWith('.archive.org') ? 'archive.org' : host.replace(/\.[a-z]+$/, '');
};
const direct = (release) => { try { return sourceKind(release) === 'direct'; } catch { return false; } };

const dir = path.join(repo, 'app/data/releases');
const removed = new Set(), changed = new Map();
let gone = 0, moved = 0;
for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.json'))) {
  const id = name.slice(0, -5);
  const file = path.join(dir, name);
  const text = fs.readFileSync(file, 'utf8');
  const releases = JSON.parse(readJlx(text));
  if (!releases.some((release) => release.source === dropped)) continue;
  const kept = releases.flatMap((release) => {
    if (release.source !== dropped) return [release];
    const other = elsewhere.get(release.url) ?? elsewhere.get(release.browserUrl);
    if (!other) { gone++; return []; }
    moved++;
    return [{ ...release, source: other }];
  });
  if (!kept.length) {
    removed.add(id);
    fs.rmSync(file);
    fs.rmSync(path.join(repo, 'app/data/pages', name), { force: true });
    continue;
  }
  fs.writeFileSync(file, text.startsWith('JLX1:') ? `${encodeJlx(kept)}\n` : `${JSON.stringify(kept)}\n`);
  changed.set(id, {
    providers: [...new Set(kept.map((release) => hostName(release.url)))].sort(),
    direct: kept.some(direct),
  });
}

// data/catalog.js lists a game a line.
const catalogFile = path.join(repo, 'app/data/catalog.js');
const lines = fs.readFileSync(catalogFile, 'utf8').split('\n').flatMap((line) => {
  const id = /^\s*\{ "id": "((?:CUSA|PPSA)\d{5})"/.exec(line)?.[1];
  if (!id) return [line];
  if (removed.has(id)) return [];
  const update = changed.get(id);
  if (!update) return [line];
  let out = line.replace(/"providers": \[[^\]]*\]/, `"providers": ${JSON.stringify(update.providers).replace(/","/g, '", "')}`);
  out = out.replace(/"direct": true, /, '');
  if (update.direct) out = out.replace(/("providers": \[[^\]]*\], )/, '$1"direct": true, ');
  return [out];
});
// The last game of a list keeps no trailing comma.
const fixed = lines.join('\n').replace(/\},\n(\s*\];)/g, '}\n$1').replace(/\}\n(\s*\{ "id")/g, '},\n$1');
fs.writeFileSync(catalogFile, fixed);

const saverFile = path.join(repo, 'app/data/screensaver.js');
const saver = fs.readFileSync(saverFile, 'utf8').split('\n')
  .filter((line) => !removed.has(/^\s*\{"id":"((?:CUSA|PPSA)\d{5})"/.exec(line)?.[1]));
fs.writeFileSync(saverFile, saver.join('\n').replace(/\},\n(\s*\];)/g, '}\n$1'));

console.log(`${DROP}: ${gone} links gone, ${moved} kept as another catalog's; ${removed.size} games gone, ${changed.size} changed`);
