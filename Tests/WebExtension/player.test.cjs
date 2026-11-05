const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

const source = file => fs.readFileSync(`Extension/Resources/${file}`, "utf8");
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const series = { id: 35641, myAnimeListId: 21, type: "tv", title: "Fixture anime", titles: { ru: "Fixture anime" }, episodes: [
  { id: 388804, seriesId: 35641, episodeInt: 1, episodeType: "tv", isActive: 1, isFirstUploaded: 1 },
  { id: 388805, seriesId: 35641, episodeInt: 2, episodeType: "tv", isActive: 1, isFirstUploaded: 1 }
] };
const translation = { id: 6085601, type: "subRu", authorsSummary: "Studio", seriesId: series.id, episode: series.episodes[0] };
const times = [
  { skipType: "op", interval: { startTime: 30, endTime: 120 }, episodeLength: 1440 },
  { skipType: "ed", interval: { startTime: 1300, endTime: 1390 }, episodeLength: 1440 }
];

async function contentHarness(t, settings = {}, fixture = {}) {
  const dom = new JSDOM('<div class="video-js" id="main-video"><video id="main-video_html5_api"></video></div>', { url: "https://smotret-anime.com/translations/embed/6085601", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window, intervals = [], commands = [], runtimeMessages = [], listeners = [];
  let now = 10000;
  w.Date.now = () => now;
  w.setInterval = fn => { const ref = { fn, active: true }; intervals.push(ref); return ref; };
  w.clearInterval = ref => { if (ref) ref.active = false; };
  w.postMessage = data => {
    commands.push(data);
    w.dispatchEvent(new w.MessageEvent("message", { data, source: w, origin: w.location.origin }));
  };
  w.fetch = async url => {
    const path = new URL(url).pathname;
    const values = { "/api/translations/6085601": fixture.translation || translation, "/api/series/35641": series,
      "/api/episodes/388805": { ...series.episodes[1], translations: [
        { id: 6085602, isActive: 1, type: "subRu", authorsSummary: "Studio", url: "https://smotret-anime.co/catalog/fixture-35641/2-seriya-388805/russkie-subtitry-6085602" }
      ] } };
    return { ok: true, async json() { return { data: values[path] }; } };
  };
  w.browser = {
    runtime: { getURL: name => `safari-web-extension://fixture/${name}`, onMessage: { addListener() {} }, async sendMessage(message) {
      runtimeMessages.push(message);
      if (message.type === "skipTimes") return fixture.response || { found: true, results: times };
      if (message.type === "autoplayIntent") return { play: fixture.autoplayIntent || false };
      return { ok: true };
    } },
    storage: { local: { async get() { return { settings }; } }, onChanged: { addListener(fn) { listeners.push(fn); } } }
  };
  w.eval(source("core.js")); w.eval(source("content.js")); await flush();
  const emit = extra => {
    w.dispatchEvent(new w.MessageEvent("message", { origin: w.location.origin, source: w,
      data: { channel: "aniskip-safari-player-v1", source: "player", type: "state", key: "1", ready: true,
        currentTime: 50, duration: 1440, paused: false, seeking: false, ended: false, ...extra } }));
  };
  return { w, commands, runtimeMessages, emit, shadow: () => w.document.getElementById("aniskip-safari-controls").shadowRoot,
    changeSettings(value) { settings = value; for (const fn of listeners) fn({ settings: { newValue: value } }, "local"); },
    tick(ms) { now += ms; for (const ref of [...intervals]) if (ref.active) ref.fn(); } };
}

test("manual skip button seeks to AniSkip's end, and automatic skipping is opt-in", async t => {
  const h = await contentHarness(t);
  h.emit(); await flush(); h.emit();
  const button = [...h.shadow().querySelectorAll("button")].find(b => b.textContent === "Skip opening");
  assert.equal(button.hidden, false);
  assert.equal(h.commands.some(m => m.command === "seek"), false);
  button.click();
  assert.equal(h.commands.at(-1).seconds, 120);
});
test("automatic skips happen once; seeking back allows replay, and post-credit scenes survive", async t => {
  const h = await contentHarness(t, { autoSkipOpening: true, autoSkipEnding: true });
  h.emit(); await flush(); h.emit(); h.emit();
  assert.equal(h.commands.filter(m => m.command === "seek").length, 1);
  h.emit({ currentTime: 1310 });
  assert.equal(h.commands.at(-1).seconds, 1390);
  h.emit({ currentTime: 1400 });
  assert.equal(h.commands.filter(m => m.command === "seek").length, 2);
  assert.equal(h.runtimeMessages.some(m => m.type === "navigateNext"), false);
});
test("paused, seeking, and disabled players do not skip automatically", async t => {
  const h = await contentHarness(t, { autoSkipOpening: true });
  h.emit({ paused: true }); await flush();
  h.emit({ paused: true }); h.emit({ seeking: true });
  h.changeSettings({ enabled: false, autoSkipOpening: true }); h.emit();
  assert.equal(h.commands.filter(m => m.command === "seek").length, 0);
});
test("ending countdown can be cancelled and never fires on final episode", async t => {
  const h = await contentHarness(t, { autoplay: true });
  h.emit({ currentTime: 1440, ended: true, paused: true });
  const cancel = [...h.shadow().querySelectorAll("button")].find(b => b.textContent === "Cancel autoplay");
  assert.equal(cancel.hidden, false); cancel.click(); h.tick(6000); await flush();
  assert.equal(h.runtimeMessages.some(m => m.type === "openEpisode"), false);
  const last = await contentHarness(t, { autoplay: true }, { translation: { ...translation, episode: series.episodes[1] } });
  last.emit({ currentTime: 1440, ended: true, paused: true }); last.tick(6000); await flush();
  assert.equal(last.shadow().querySelector("button:last-child").hidden, true);
});
test("completed countdown opens the next translation on the current mirror exactly once", async t => {
  const h = await contentHarness(t, { autoplay: true });
  h.emit({ currentTime: 1440, ended: true, paused: true });
  h.tick(5001); await flush(); h.tick(5001); await flush();
  const navigation = h.runtimeMessages.filter(m => m.type === "openEpisode");
  assert.equal(navigation.length, 1);
  assert.equal(navigation[0].episodeID, 388805);
  assert.equal(navigation[0].url, "https://smotret-anime.com/catalog/fixture-35641/2-seriya-388805/russkie-subtitry-6085602");
});
test("missing timings and network errors keep the video usable", async t => {
  const h = await contentHarness(t, {}, { response: { error: "AniSkip is unavailable" } });
  h.emit(); await flush();
  assert.match(h.shadow().textContent, /AniSkip is unavailable/);
  assert.equal([...h.shadow().querySelectorAll("button")].find(b => b.textContent === "Retry").hidden, false);
});
test("next-page playback intent requests play, and rejection offers a user gesture", async t => {
  const h = await contentHarness(t, { autoplay: true }, { autoplayIntent: true });
  h.emit(); await flush();
  assert.equal(h.commands.some(m => m.command === "play"), true);
  h.w.dispatchEvent(new h.w.MessageEvent("message", { source: h.w, origin: h.w.location.origin, data: { channel: "aniskip-safari-player-v1", source: "player", type: "playbackError", command: "play" } }));
  assert.match(h.shadow().textContent, /Safari blocked autoplay/);
});
test("MAIN-world bridge uses the concatenated logical clock and public-ended event", async t => {
  const dom = new JSDOM('<div class="video-js" id="main-video"><video id="main-video_html5_api"></video></div>', { url: "https://smotret-anime.com/translations/embed/1", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window, states = [], events = {};
  let logicalTime = 700;
  const p = { concatenate: { summaryDuration: 1440 }, currentTime(value) { if (value !== undefined) logicalTime = value; return logicalTime; }, duration: () => 1440, paused: () => true, seeking: () => false, on(name, fn) { events[name] = fn; }, off(name) { delete events[name]; } };
  w.videojs = { players: { "main-video": p } };
  w.setInterval = () => 1;
  w.postMessage = value => states.push(value);
  w.eval(source("player-bridge.js"));
  assert.equal(states.at(-1).currentTime, 700);
  assert.equal(states.at(-1).duration, 1440);
  w.document.querySelector("video").dispatchEvent(new w.Event("ended"));
  assert.equal(states.at(-1).ended, false);
  logicalTime = 1440; events["public-ended"]();
  assert.equal(states.at(-1).ended, true);
  w.dispatchEvent(new w.MessageEvent("message", { source: w, origin: w.location.origin,
    data: { channel: "aniskip-safari-player-v1", source: "extension", command: "seek", seconds: 900, key: states.at(-1).key } }));
  assert.equal(logicalTime, 900);
});
