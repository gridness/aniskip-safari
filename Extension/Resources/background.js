/* Safari's nonpersistent background page. Persistent playback intent lives in storage. */
(() => {
  "use strict";
  const cache = new Map(), pending = new Map();
  const A = globalThis.AniSkip;
  async function skipTimes(message) {
    const { malID, episode, duration } = message;
    if (!A.positiveID(malID) || typeof malID !== "number" || !Number.isFinite(episode) || episode < 0 ||
        episode > 100000 || !Number.isFinite(duration) || duration <= 0 || duration > 86400) {
      throw new Error("Invalid episode metadata.");
    }
    const key = `${malID}:${episode}:${Math.round(duration)}`;
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return saved.value;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      const response = await browser.runtime.sendNativeMessage("com.gridness.AniSkipSafari", { action: "skipTimes", malID, episode, duration });
      if (!response || response.error) throw new Error(response?.error || "The Safari companion extension did not respond.");
      if (!Array.isArray(response.results)) throw new Error("AniSkip returned an invalid response.");
      cache.delete(key);
      cache.set(key, { value: response, expires: Date.now() + (response.found ? 1800000 : 300000) });
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      return response;
    })();
    pending.set(key, request);
    try { return await request; } finally { pending.delete(key); }
  }
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!A.supportedURL(sender.url) || !Number.isInteger(sender.tab?.id)) return;
    return (async () => {
      try {
        if (message.type === "skipTimes") return await skipTimes(message);
        if (message.type === "navigateNext") {
          return await browser.tabs.sendMessage(sender.tab.id, message, { frameId: 0 });
        }
        const key = `autoplay:${sender.tab.id}`;
        if (message.type === "openEpisode" && sender.frameId === 0) {
          const next = A.route(message.url);
          const current = A.route(sender.url);
          if (!next || next.seriesID !== message.seriesID || next.episodeID !== message.episodeID ||
              !A.positiveID(message.episodeID) || next.episodeID === current?.episodeID ||
              new URL(message.url).origin !== new URL(sender.url).origin ||
              (current?.seriesID && current.seriesID !== next.seriesID)) throw new Error("Invalid next-episode destination.");
          await browser.storage.local.set({ [key]: { episodeID: message.episodeID, expires: Date.now() + 120000 } });
          await browser.tabs.update(sender.tab.id, { url: message.url });
          return { ok: true };
        }
        if (message.type === "autoplayIntent") {
          const value = (await browser.storage.local.get(key))[key];
          if (value && value.expires <= Date.now()) await browser.storage.local.remove(key);
          return { play: Boolean(value && value.expires > Date.now() && value.episodeID === message.episodeID) };
        }
      } catch (error) { return { error: error.message || "AniSkip is temporarily unavailable." }; }
    })();
  });
  browser.tabs.onRemoved.addListener(tabID => { void browser.storage.local.remove(`autoplay:${tabID}`); });
})();
