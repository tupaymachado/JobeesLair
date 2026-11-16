// Downloads from links the player pastes (Downloads → Add links), outside any catalog: one link, or several.
// Links whose file names number them as volumes of one archive ("x.part1.rar", "x.part2.rar"; "x.rar",
// "x.r00", "x.r01"; "x.7z.001", "x.7z.002") become one download in parts, extracted as one set (while it
// downloads for RAR, deleting each part once extracted when that setting is on). Several links whose names
// say nothing (a host's pages) are `loose`: the player says whether they are the parts of one file, in the
// order pasted, or separate downloads. Each link goes through the same resolver as a catalog source: a direct
// file downloads, a host's page through its check in the browser, and a TorBox or AllDebrid key takes the hosts
// and torrents it supports (pastedDownloads' `debrid`).

  var MAX_LINKS = 64;
  var MAX_NAME = 160;
  // A link ends at whitespace or a quote, or where the next one starts: the console's URL keyboard and a phone's
  // one-line box take no spaces, so links pasted there arrive joined.
  var LINK = /(?:https?:\/\/|magnet:\?)[^\s"'<>]+?(?=https?:\/\/|magnet:\?|[\s"'<>]|$)/gi;
  var TRAILING = /[),.;\]]+$/;
  function parseLinks(text) {
    const found = [];
    for (const match of String(text ?? "").matchAll(LINK)) {
      const link = match[0].replace(TRAILING, "");
      if (link.length > 12 && !found.includes(link)) found.push(link);
    }
    if (found.length > MAX_LINKS) throw new Error(`At most ${MAX_LINKS} links at a time.`);
    return found;
  }
  var safeName = (value) => value.replace(/[\x00-\x1f/\\:*?"<>|]+/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, MAX_NAME);
  function decoded(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  // The file a link names: a magnet's display name, else its path's last part; "" when it names none.
  function linkName(link) {
    if (/^magnet:/i.test(link)) {
      const name = /[?&]dn=([^&]*)/i.exec(link)?.[1];
      return name ? safeName(decoded(name.replace(/\+/g, " "))) : "";
    }
    const path = link.replace(/^[a-z]+:\/\/[^/?#]*/i, "").replace(/[?#].*$/, "");
    return safeName(decoded(path.slice(path.lastIndexOf("/") + 1)));
  }
  function hostOf(link) {
    if (/^magnet:/i.test(link)) return "Torrent";
    return (/^[a-z]+:\/\/([^/?#:@]+)/i.exec(link)?.[1] ?? "link").toLowerCase().replace(/^www\./, "");
  }
  // Where a file name puts it in a set of volumes: { base, number, scheme }, numbers from 1; null for a whole file.
  // "x.rar" is the first of "x.r00", "x.r01", … (old RAR naming), so only a set when those are pasted with it.
  function volumeOf(name) {
    let match = /^(.+)\.part0*(\d{1,4})\.(rar|7z|zip)$/i.exec(name);
    if (match) return { base: match[1], number: Number(match[2]), scheme: `part.${match[3].toLowerCase()}` };
    if ((match = /^(.+)\.r(\d{2,3})$/i.exec(name))) return { base: match[1], number: Number(match[2]) + 2, scheme: "rnn" };
    if ((match = /^(.+)\.rar$/i.exec(name))) return { base: match[1], number: 1, scheme: "rnn", lone: true };
    if ((match = /^(.+)\.(7z|zip|rar)\.(\d{3})$/i.exec(name))) return { base: match[1], number: Number(match[3]), scheme: `split.${match[2].toLowerCase()}` };
    if ((match = /^(.+)\.(\d{3})$/.exec(name))) return { base: match[1], number: Number(match[2]), scheme: "raw" };
    return null;
  }
  var RAW_SPLIT = "Files cut into numbered pieces (.001, .002, …) download only when they are archives (.7z.001, .zip.001, .rar.001).";
  /**
   * What `links` download as: `downloads` [{ name, links, set, problem }] (a set's links in volume order; `problem`
   * when it cannot be downloaded: a part missing, pieces of no archive), and `loose`, the links whose names say
   * nothing, left to the player when there are several.
   */
  function planLinks(links) {
    const groups = /* @__PURE__ */ new Map();
    const downloads = [];
    const loose = [];
    for (const link of links) {
      const name = linkName(link);
      const volume = name ? volumeOf(name) : null;
      if (!volume) {
        loose.push(link);
        continue;
      }
      const key = `${volume.scheme}\n${volume.base.toLowerCase()}`;
      if (!groups.has(key)) {
        const group = { name: volume.base, scheme: volume.scheme, members: [] };
        groups.set(key, group);
        downloads.push(group);
      }
      groups.get(key).members.push({ link, number: volume.number, lone: volume.lone });
    }
    const out = downloads.map((group) => {
      // A ".rar" pasted without its ".r00", … is a whole archive.
      if (group.scheme === "rnn" && group.members.length === 1 && group.members[0].lone) return { name: group.name, links: [group.members[0].link], set: false };
      const members = [...group.members].sort((a, b) => a.number - b.number);
      const first = members[0].number;
      let problem = group.scheme === "raw" ? RAW_SPLIT : "";
      const repeated = members.find((member, index) => index && member.number === members[index - 1].number);
      if (!problem && repeated) problem = `Part ${repeated.number - first + 1} was pasted twice.`;
      // 7-Zip numbers pieces from .001, some tools from .000; parts and RAR volumes from 1.
      if (!problem && first !== 1 && !(first === 0 && group.scheme.startsWith("split."))) problem = `Part 1 of ${group.name} is missing.`;
      // The first number not pasted, counted from 1.
      const gap = problem ? -1 : members.findIndex((member, index) => member.number !== first + index);
      if (gap >= 0) problem = `Part ${gap + 1} of ${group.name} is missing.`;
      return { name: group.name, links: members.map((member) => member.link), set: true, ...problem ? { problem } : {} };
    });
    // One link with a name that says nothing is simply that download.
    if (loose.length === 1) {
      out.push({ name: linkName(loose[0]) || hostOf(loose[0]), links: loose, set: false });
      return { downloads: out, loose: [] };
    }
    return { downloads: out, loose };
  }
  // A short, stable key for a list of links: the same paste is the same download (the queue keeps one job per id).
  function linksKey(links) {
    const text = links.join("\n");
    let first = 2166136261, second = 5381;
    for (let index = 0; index < text.length; index++) {
      first = Math.imul(first ^ text.charCodeAt(index), 16777619);
      second = Math.imul(second, 33) ^ text.charCodeAt(index);
    }
    return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
  }
  var TITLE_ID = /\b(PPSA|CUSA)[-_ ]?(\d{5})\b/i;
  function linkSource(link, id) {
    const name = linkName(link);
    return { id, provider: hostOf(link), url: link, filename: name || hostOf(link), label: name || link, source: "link" };
  }
  /**
   * The queue's (game, release) pairs for a plan's downloads, with `loose` taken as `looseAs`: "set" (the parts of
   * one file, in the order pasted) or "each" (a download each). `debrid` (state/debrid.js), when given, turns a
   * release its service supports into that service's form. Downloads with a `problem` throw it.
   */
  function pastedDownloads(plan, { looseAs = "each", debrid = null } = {}) {
    const downloads = [...plan.downloads];
    if (plan.loose.length) {
      if (looseAs === "set") downloads.push({ name: linkName(plan.loose[0]).replace(/\.[^.]+$/, "") || hostOf(plan.loose[0]), links: plan.loose, set: true });
      else for (const link of plan.loose) downloads.push({ name: linkName(link) || hostOf(link), links: [link], set: false });
    }
    const problem = downloads.find((item) => item.problem)?.problem;
    if (problem) throw new Error(problem);
    return downloads.map((item) => {
      const key = linksKey(item.links);
      const id = `link-${key}`;
      const names = item.links.map(linkName).join(" ");
      const titleId = TITLE_ID.exec(`${item.name} ${names}`);
      const game = { id, titleId: titleId ? `${titleId[1].toUpperCase()}${titleId[2]}` : id, title: item.name };
      let release;
      if (item.set) {
        release = {
          id: `links-${key}`,
          provider: hostOf(item.links[0]),
          filename: safeName(item.name) || id,
          label: item.name,
          format: "archive-set",
          source: "link",
          parts: item.links.map((link, index) => ({ number: index + 1, name: linkName(link), sources: [linkSource(link, `${id}-${index + 1}`)] }))
        };
      } else {
        release = linkSource(item.links[0], `link-${key}`);
      }
      const routed = debrid?.supports(release) ? debrid.source(release) : release;
      return { game, release: routed, viaDebrid: routed !== release };
    });
  }

// MODIFIED (tupay): what a paste sent from the phone becomes (companion/remote-download.js startRemoteLinks): the
// queue's items, or `asking` when several links' names say nothing and no `looseAs` says how to take them.
function pastedText(text, { looseAs = null, debrid = null } = {}) {
  const links = parseLinks(text);
  if (!links.length) throw new Error("No link found: send http(s) or magnet links.");
  const plan = planLinks(links);
  const problem = plan.downloads.find((item) => item.problem)?.problem;
  if (problem) throw new Error(problem);
  if (plan.loose.length > 1 && looseAs !== "set" && looseAs !== "each") return { asking: true, loose: plan.loose.length, links: links.length };
  return { items: pastedDownloads(plan, { looseAs: looseAs ?? "each", debrid }) };
}

export { MAX_LINKS, linkName, parseLinks, pastedDownloads, pastedText, planLinks, volumeOf };
