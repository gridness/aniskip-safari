/* MAIN world: use Anime365's logical video.js clock for concatenated video files. */
(() => {
  "use strict";
  if (window.__aniSkipPlayerBridge) return;
  window.__aniSkipPlayerBridge = true;
  const channel = "aniskip-safari-player-v1";
  let video, player, generation = 0, ended = false, holdingEnd = false;
  const send = data => window.postMessage({ channel, source: "player", ...data }, location.origin);
  // Anime365 may rewind before public-ended. Keep completion until the controls
  // acknowledge it, so queued clock samples cannot erase it.
  const onEnded = () => { ended = true; publish(); };
  function releaseEnd() { ended = false; holdingEnd = false; }
  function onPlayerInput(event) {
    if (event.isTrusted) releaseEnd();
  }
  function findPlayer(element) {
    const players = (window.videojs || window.vjs)?.players || {};
    return players[element.closest(".video-js")?.id] || players[element.id] || players[element.id.replace(/_html5_api$/, "")];
  }
  function discover() {
    const videos = document.querySelectorAll("video");
    const next = document.querySelector("video#main-video, #main-video video, video[data-page-url]") ||
      (videos.length === 1 ? videos[0] : null);
    const nextPlayer = next ? findPlayer(next) : null;
    if (next === video && nextPlayer === player) return;
    if (player?.off) player.off("public-ended", onEnded);
    video?.removeEventListener("ended", onNativeEnded);
    const previousControls = video?.closest(".video-js") || video;
    previousControls?.removeEventListener("pointerdown", onPlayerInput, true);
    previousControls?.removeEventListener("keydown", onPlayerInput, true);
    video = next; player = nextPlayer; generation++; releaseEnd();
    video?.addEventListener("ended", onNativeEnded);
    const controls = video?.closest(".video-js") || video;
    controls?.addEventListener("pointerdown", onPlayerInput, true);
    controls?.addEventListener("keydown", onPlayerInput, true);
    player?.on?.("public-ended", onEnded);
  }
  function onNativeEnded() {
    // The native 'ended' event also fires at the end of each individual file.
    if (!player?.concatenate) onEnded();
  }
  function state() {
    if (!video) return null;
    const concatenate = player?.concatenate;
    const ready = concatenate ? concatenate.summaryDuration > 0 && (!concatenate.requireActivation || concatenate.activated) :
      video.readyState >= 1 && (!video.closest(".video-js") || Boolean(player));
    const currentTime = player ? Number(player.currentTime()) : video.currentTime;
    const duration = player ? Number(player.duration()) : video.duration;
    if (holdingEnd && !(player ? player.paused() : video.paused)) {
      if (player) player.pause(); else video.pause();
    }
    const paused = player ? player.paused() : video.paused;
    const seeking = player ? player.seeking() : video.seeking;
    return { key: String(generation), currentTime, duration, paused, seeking, ended,
      ready: Boolean(ready && Number.isFinite(duration) && duration > 0 && !video.closest(".vjs-ad-playing, .vjs-ad-loading")) };
  }
  function publish() {
    try {
      discover(); const s = state();
      if (!s) return;
      send({ type: "state", ...s });
    }
    catch { /* A disposed player will be rediscovered on the next sample. */ }
  }
  window.addEventListener("message", async event => {
    const m = event.data;
    // ASVS 3.5.5: only accept commands from this window and origin.
    if (event.source !== window || event.origin !== location.origin || m?.channel !== channel || m.source !== "extension") return;
    if (m.command === "probe") return publish();
    try {
      const s = state();
      if (!s || m.key !== s.key) return;
      if (m.command === "releaseEnd") { releaseEnd(); return publish(); }
      if (!s.ready) return;
      if (m.command === "seek" && Number.isFinite(m.seconds)) {
        releaseEnd();
        const time = Math.max(0, Math.min(s.duration, m.seconds));
        if (player) player.currentTime(time); else video.currentTime = time;
      } else if (m.command === "play") {
        releaseEnd();
        if (player) player.play();
        // Older video.js does not return the native play promise. Observe it too
        // so Safari's autoplay denial reaches the controls.
        await video.play();
      } else if (m.command === "holdEnd") {
        ended = true; holdingEnd = true;
        if (player) player.pause(); else video.pause();
      }
      publish();
    } catch { send({ type: "playbackError", command: m.command }); }
  });
  setInterval(publish, 250);
  publish();
})();
