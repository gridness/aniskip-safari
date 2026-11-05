(() => {
  "use strict";
  const A = globalThis.AniSkip, channel = "aniskip-safari-player-v1";
  let preferences = { ...A.defaults }, context = null, metadataError = "", timingStatus = "";
  let snapshot = null, rawTimes = [], requestKey = "", epoch = 0, pageKey = "", timingError = false;
  let host, ui, countdown = null, countdownCancelled = false, navigationPending = false;
  let autoplayAttempted = false, playBlocked = false;
  const autoSkipped = new Set();
  const command = (name, extra = {}) => window.postMessage({ channel, source: "extension", command: name, key: snapshot?.key, ...extra }, location.origin);
  async function api(path) {
    const response = await fetch(new URL(path, location.origin), { credentials: "same-origin", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Anime365 metadata is unavailable (${response.status}).`);
    const value = await response.json();
    if (!value.data || typeof value.data !== "object") throw new Error("Anime365 returned invalid episode metadata.");
    return value.data;
  }
  function currentRoute() {
    const route = A.route(location.href);
    if (!route) return null;
    if (window === window.top && !route.translationID) {
      const source = document.querySelector("#videoFrame")?.src;
      const id = source && A.route(source)?.translationID;
      if (id) return { ...route, translationID: id };
    }
    return route;
  }
  async function loadContext(route) {
    const version = ++epoch;
    context = null; metadataError = ""; rawTimes = []; requestKey = ""; timingError = false;
    stopCountdown(); countdownCancelled = false; navigationPending = false; autoplayAttempted = false; autoSkipped.clear();
    if (!route) { render(); return; }
    try {
      let episode, series, translation;
      if (!route.episodeID) {
        translation = await api(`/api/translations/${route.translationID}`);
        episode = translation.episode;
        if (!episode || !A.positiveID(translation.seriesId)) throw new Error("The player has no episode metadata.");
        series = await api(`/api/series/${translation.seriesId}`);
      } else {
        [episode, series] = await Promise.all([api(`/api/episodes/${route.episodeID}`), api(`/api/series/${route.seriesID}`)]);
        translation = episode.translations?.find(t => Number(t.id) === route.translationID) || null;
      }
      if (version !== epoch) return;
      if (!A.positiveID(episode.id) || episode.seriesId !== series.id || !Number.isFinite(Number(episode.episodeInt))) {
        throw new Error("Anime365 episode and series metadata do not match.");
      }
      context = { episode, series, translation, next: A.nextEpisode(series.episodes, episode),
        // A special attached to a TV season does not use that season's regular MAL episode numbering.
        malID: episode.episodeType === series.type && A.positiveID(series.myAnimeListId) ? Number(series.myAnimeListId) : null };
      timingStatus = context.malID ? "Waiting for video…" : "No matching MyAnimeList episode.";
      await updateTimes();
      await tryAutoplay();
    } catch (error) { if (version === epoch) metadataError = error.message; }
    render();
  }
  async function updateTimes() {
    if (!preferences.enabled || !context?.malID || !snapshot?.ready) return;
    const key = `${epoch}:${context.malID}:${context.episode.episodeInt}:${Math.round(snapshot.duration)}`;
    if (requestKey === key) return;
    requestKey = key; rawTimes = []; timingError = false; timingStatus = "Loading timings…";
    try {
      const response = await browser.runtime.sendMessage({ type: "skipTimes", malID: context.malID,
        episode: Number(context.episode.episodeInt), duration: snapshot.duration });
      if (requestKey !== key) return;
      if (!response || response.error) throw new Error(response?.error || "The Safari extension did not respond.");
      rawTimes = response.results || [];
      timingStatus = A.intervals(rawTimes, snapshot.duration).length ? "" : "No timings for this release.";
    } catch (error) {
      if (requestKey === key) { timingStatus = error.message; timingError = true; }
    }
    render();
  }
  function stopCountdown() {
    if (countdown) clearInterval(countdown.timer);
    countdown = null;
  }
  function beginCountdown() {
    if (countdown || countdownCancelled || navigationPending || !context?.next || !preferences.enabled || !preferences.autoplay) return;
    countdown = { deadline: Date.now() + 5000, timer: null };
    countdown.timer = setInterval(() => {
      if (Date.now() >= countdown.deadline) { stopCountdown(); void navigateNext(); }
      render();
    }, 200);
    render();
  }
  async function performNavigation(episodeID, seriesID) {
    if (!preferences.enabled || !preferences.autoplay || !context?.next ||
        context.episode.id !== episodeID || context.series.id !== seriesID) return { error: "The episode changed before navigation." };
    const original = context;
    try {
      const next = await api(`/api/episodes/${original.next.id}`);
      if (context !== original) return { error: "The episode changed before navigation." };
      if (next.seriesId !== seriesID || next.id !== original.next.id || Number(next.isActive) !== 1) throw new Error("The next episode is unavailable.");
      const translation = A.translationFor(next, original.translation);
      if (!translation) throw new Error("No playable translation for the next episode.");
      const url = A.nextURL(translation, location.origin, next.id);
      if (!preferences.autoplay || !preferences.enabled) return { error: "Autoplay was cancelled." };
      const result = await browser.runtime.sendMessage({ type: "openEpisode", episodeID: next.id, seriesID, url });
      if (!result?.ok) throw new Error(result?.error || "Could not prepare autoplay.");
      return { ok: true };
    } catch (error) { return { error: error.message }; }
  }
  async function navigateNext() {
    if (navigationPending || !context) return;
    navigationPending = true;
    const message = { type: "navigateNext", episodeID: context.episode.id, seriesID: context.series.id };
    try {
      const result = window === window.top ? await performNavigation(message.episodeID, message.seriesID) : await browser.runtime.sendMessage(message);
      if (result?.error || !result?.ok) throw new Error(result?.error || "Could not open the next episode.");
    } catch (error) {
      timingStatus = error.message; navigationPending = false; countdownCancelled = true; render();
    }
  }
  async function tryAutoplay() {
    if (autoplayAttempted || !snapshot?.ready || !context || !preferences.enabled || !preferences.autoplay) return;
    autoplayAttempted = true;
    try {
      const result = await browser.runtime.sendMessage({ type: "autoplayIntent", episodeID: context.episode.id });
      if (result?.play) command("play");
    } catch { playBlocked = true; render(); }
  }
  function ensureUI() {
    const video = document.querySelector("video#main-video, #main-video video, video[data-page-url]") ||
      (document.querySelectorAll("video").length === 1 ? document.querySelector("video") : null);
    if (!video) return;
    const parent = video.closest(".video-js") || video.parentElement;
    if (host?.parentElement === parent) return;
    host?.remove();
    host = document.createElement("div"); host.id = "aniskip-safari-controls";
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = document.createElement("link"); sheet.rel = "stylesheet"; sheet.href = browser.runtime.getURL("overlay.css");
    shadow.append(sheet);
    const panel = document.createElement("section"); panel.setAttribute("aria-label", "aniskip controls");
    const status = document.createElement("span"); status.setAttribute("role", "status");
    const button = label => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; panel.append(b); return b; };
    panel.append(status);
    const skip = button("Skip opening"), retry = button("Retry"), play = button("Play episode"), cancel = button("Cancel autoplay");
    skip.onclick = () => { const active = activeNow(); if (active) command("seek", { seconds: active.end }); };
    retry.onclick = () => { requestKey = ""; metadataError = ""; void loadContext(currentRoute()); };
    play.onclick = () => { playBlocked = false; command("play"); render(); };
    cancel.onclick = () => { countdownCancelled = true; stopCountdown(); render(); };
    shadow.append(panel); parent.append(host);
    // Anime365's .video-js container is already positioned; this also supports plain HTML players.
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    ui = { panel, status, skip, retry, play, cancel };
  }
  function activeNow() {
    return snapshot?.ready ? A.activeInterval(A.intervals(rawTimes, snapshot.duration), snapshot.currentTime) : null;
  }
  function render() {
    ensureUI(); if (!ui) return;
    host.hidden = !preferences.enabled;
    const active = activeNow();
    ui.skip.hidden = !active;
    if (active) ui.skip.textContent = active.type === "op" ? "Skip opening" : "Skip ending";
    ui.cancel.hidden = !countdown;
    ui.play.hidden = !playBlocked;
    ui.retry.hidden = !metadataError && !timingError;
    const label = countdown ? `Next episode in ${Math.max(1, Math.ceil((countdown.deadline - Date.now()) / 1000))}…` :
      playBlocked ? "Safari blocked autoplay." : metadataError || timingStatus;
    if (ui.status.textContent !== label) ui.status.textContent = label;
    ui.status.hidden = !label;
    ui.panel.hidden = !active && !label && !playBlocked;
  }
  window.addEventListener("message", event => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== channel || m.source !== "player") return;
    if (m.type === "playbackError") {
      if (m.command === "play") playBlocked = true;
      else { timingStatus = "Could not seek this video."; timingError = true; }
      render(); return;
    }
    if (m.type !== "state" || typeof m.key !== "string" || !Number.isFinite(m.currentTime) || !Number.isFinite(m.duration)) return;
    if (snapshot?.key !== m.key) { autoSkipped.clear(); autoplayAttempted = false; playBlocked = false; }
    snapshot = m;
    if (!m.ended && countdown) { stopCountdown(); countdownCancelled = true; }
    if (m.ended) beginCountdown();
    if (preferences.enabled && m.ready && !m.paused && !m.seeking) {
      playBlocked = false;
      const active = activeNow();
      if (active && (active.type === "op" ? preferences.autoSkipOpening : preferences.autoSkipEnding) && !autoSkipped.has(active.type)) {
        autoSkipped.add(active.type); command("seek", { seconds: active.end });
      }
    }
    void updateTimes(); void tryAutoplay(); render();
  });
  browser.runtime.onMessage.addListener(message => {
    if (message.type === "getContext") return Promise.resolve(context ? {
      title: context.series.titles?.ru || context.series.title, episode: context.episode.episodeInt,
      malID: context.malID, hasNext: Boolean(context.next)
    } : { error: metadataError || "Open an Anime365 episode to connect." });
    if (message.type === "navigateNext" && window === window.top) return performNavigation(message.episodeID, message.seriesID);
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    preferences = A.settings(changes.settings.newValue);
    if (!preferences.enabled || !preferences.autoplay) { stopCountdown(); countdownCancelled = true; }
    render(); void updateTimes();
  });
  async function refresh() {
    const route = currentRoute(), key = JSON.stringify(route);
    if (key !== pageKey) { pageKey = key; await loadContext(route); }
    render();
  }
  void (async () => {
    preferences = A.settings((await browser.storage.local.get("settings")).settings);
    await refresh(); command("probe");
    setInterval(() => { void refresh(); }, 1000);
  })();
})();
