/* Shared pure logic. No page globals, network access, or title guessing. */
(() => {
  "use strict";
  const hosts = ["smotret-anime.co", "smotretanime.co", "smotret-anime.com", "smotret-anime.org", "smotret-anime.app"];
  const defaults = Object.freeze({ enabled: true, autoSkipOpening: false, autoSkipEnding: false, autoplay: false });
  const positiveID = value => (typeof value === "number" || typeof value === "string" && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  function supportedURL(value) {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password && !u.port &&
        hosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
    } catch { return false; }
  }
  function route(value) {
    if (!supportedURL(value)) return null;
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    if (parts[0] === "translations" && parts[1] === "embed" && positiveID(parts[2])) {
      return { translationID: Number(parts[2]) };
    }
    if (parts[0] !== "catalog" || parts.length < 3) return null;
    const id = part => Number(part?.match(/-(\d+)$/)?.[1]);
    const seriesID = id(parts[1]), episodeID = id(parts[2]), translationID = id(parts[3]);
    if (!positiveID(seriesID) || !positiveID(episodeID)) return null;
    return { seriesID, episodeID, ...(positiveID(translationID) ? { translationID } : {}) };
  }
  function settings(raw = {}) {
    if (!raw || typeof raw !== "object") raw = {};
    const result = { ...defaults };
    for (const key of ["enabled", "autoSkipOpening", "autoSkipEnding", "autoplay"]) {
      if (typeof raw[key] === "boolean") result[key] = raw[key];
    }
    return result;
  }
  function nextEpisode(episodes, current) {
    // Keep specials, recaps and other episode types out of the regular sequence.
    return (episodes || []).filter(e => positiveID(e.id) && e.seriesId === current.seriesId &&
      e.episodeType === current.episodeType && Number(e.episodeInt) > Number(current.episodeInt) &&
      Number(e.isActive) === 1 && Number(e.isFirstUploaded) === 1)
      .sort((a, b) => Number(a.episodeInt) - Number(b.episodeInt))[0] || null;
  }
  function translationFor(episode, preferred) {
    const candidates = (episode.translations || []).filter(t => Number(t.isActive) === 1 && supportedURL(t.url));
    const score = t => (preferred && t.type === preferred.type ? 100 : 0) +
      (preferred && t.authorsSummary === preferred.authorsSummary ? 20 : 0);
    return candidates.sort((a, b) => score(b) - score(a) || Number(b.priority || 0) - Number(a.priority || 0))[0] || null;
  }
  function nextURL(translation, origin, episodeID) {
    if (!supportedURL(origin) || !supportedURL(translation?.url)) throw new Error("Unsupported next-episode URL.");
    const path = route(translation.url);
    if (path?.episodeID !== episodeID) throw new Error("Next-episode metadata did not match.");
    return new URL(new URL(translation.url).pathname, new URL(origin).origin).href;
  }
  function intervals(results, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return [];
    const selected = new Map();
    for (const r of results || []) {
      if (!["op", "ed"].includes(r.skipType)) continue;
      const start = r.interval?.startTime, end = r.interval?.endTime;
      const length = r.episodeLength;
      if (![start, end, length].every(Number.isFinite) || start < 0 || end <= start || length <= 0) continue;
      // Different releases may have different cuts. Never stretch timestamps to fit.
      const difference = Math.abs(length - duration);
      if (difference > Math.max(15, duration * 0.02) || end > length + 2) continue;
      const s = start, e = Math.min(duration, end);
      if (e <= s) continue;
      const candidate = { type: r.skipType, start: s, end: e, difference };
      if (!selected.has(r.skipType) || difference < selected.get(r.skipType).difference) selected.set(r.skipType, candidate);
    }
    return [...selected.values()].sort((a, b) => a.start - b.start);
  }
  const activeInterval = (items, time) => items.find(i => time >= i.start && time < i.end - 0.15) || null;
  globalThis.AniSkip = Object.freeze({ hosts, defaults, positiveID, supportedURL, route, settings, nextEpisode, translationFor, nextURL, intervals, activeInterval });
})();
