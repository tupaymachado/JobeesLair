// MODIFIED (tupay): the catalogs a release is listed in, for the store's Catalog filter and the source picker.
//
// A bundled release says where the app's catalog took it from (`source`): the Pegasus catalogs in their order
// (pegasus-0 is DLPSGame, 1 Pippo, 2 PFS, 3 ZER0GAME), Orbit, BlackBox, or links found on Archive.org. A feed
// release carries its feed's catalog (state/feed-format.js `catalogs`). The same link listed twice (two catalogs,
// or a catalog feed and the bundled data) is one release with every catalog that lists it: mergeReleases.
// The bundled games' catalogs are worked out once by tools/catalog/catalogs.mjs (data/catalogs.js).

  var SOURCE_CATALOGS = {
    "pegasus-0": "dlps",
    "pegasus-1": "pippo",
    "pegasus-2": "pfs",
    "pegasus-3": "zer0",
    orbit: "orbit",
    blackbox: "blackbox",
    "archive-discovery": "archive"
  };
  // Names for the catalogs the bundled data knows; a feed's own name is used for any other (catalogName).
  var CATALOG_NAMES = {
    dlps: "DLPSGame",
    pippo: "Pippo .exFAT",
    pfs: "PFS",
    zer0: "ZER0GAME",
    orbit: "Orbit",
    blackbox: "BlackBox",
    archive: "Archive.org"
  };
  var COMPRESSION_NAMES = { zstd: "zstd", lz4: "LZ4" };
  var feedNames = /* @__PURE__ */ new Map();
  // A feed's catalog name, as the feed gives it (state/feeds.js, as the feeds load).
  function nameCatalog(id, name) {
    if (id && name && !CATALOG_NAMES[id]) feedNames.set(id, name);
  }
  var catalogName = (id) => CATALOG_NAMES[id] ?? feedNames.get(id) ?? id;
  var compressionName = (id) => COMPRESSION_NAMES[id] ?? id;
  // The catalogs one release is listed in: its own list, else what its source says.
  function catalogsOf(release) {
    if (Array.isArray(release?.catalogs)) return release.catalogs;
    const fromSource = SOURCE_CATALOGS[release?.source];
    return fromSource ? [fromSource] : [];
  }
  // One release per link (its url, or its page's when it has no file link): a later copy adds its catalogs to the
  // first, and its compression and notes when the first has none. The first keeps its place and everything else.
  function mergeReleases(releases) {
    const byLink = /* @__PURE__ */ new Map();
    const out = [];
    for (const release of releases) {
      const link = release.url || release.browserUrl;
      const first = link ? byLink.get(link) : void 0;
      if (!first) {
        const own = catalogsOf(release);
        const copy = own.length && !Array.isArray(release.catalogs) ? { ...release, catalogs: own } : release;
        if (link) byLink.set(link, copy);
        out.push(copy);
        continue;
      }
      const index = out.indexOf(first);
      const catalogs = [.../* @__PURE__ */ new Set([...catalogsOf(first), ...catalogsOf(release)])];
      const merged = {
        ...first,
        catalogs,
        ...!first.compression && release.compression ? { compression: release.compression } : {},
        ...!first.details && release.details ? { details: release.details } : {}
      };
      byLink.set(link, merged);
      out[index] = merged;
    }
    return out;
  }

export { CATALOG_NAMES, SOURCE_CATALOGS, catalogName, catalogsOf, compressionName, mergeReleases, nameCatalog };
