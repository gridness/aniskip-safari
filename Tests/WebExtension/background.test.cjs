const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function harness() {
  let listener, nativeCount = 0, nativeResult = { found: true, results: [] };
  const storage = {}, forwarded = [], navigations = [];
  const browser = {
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendNativeMessage(app, message) { nativeCount++; assert.equal(app, "com.gridness.AniSkipSafari"); return typeof nativeResult === "function" ? nativeResult(message) : nativeResult; }
    },
    storage: { local: { async get(key) { return { [key]: storage[key] }; }, async set(values) { Object.assign(storage, values); }, async remove(key) { delete storage[key]; } } },
    tabs: { async sendMessage(...args) { forwarded.push(args); return { ok: true }; }, async update(...args) { navigations.push(args); }, onRemoved: { addListener() {} } }
  };
  const context = vm.createContext({ URL, browser });
  for (const file of ["core.js", "background.js"]) vm.runInContext(fs.readFileSync(`Extension/Resources/${file}`, "utf8"), context);
  const sender = { url: "https://smotret-anime.com/translations/embed/1", tab: { id: 7 }, frameId: 1 };
  return { send: (message, from = sender) => listener(message, from), sender, storage, forwarded, navigations,
    count: () => nativeCount, result: value => { nativeResult = value; } };
}
const request = { type: "skipTimes", malID: 21, episode: 1, duration: 1500 };
test("untrusted origins and invalid native inputs never reach the Swift handler", async () => {
  const h = harness();
  assert.equal(h.send(request, { ...h.sender, url: "https://example.com" }), undefined);
  assert.match((await h.send({ ...request, duration: -1 })).error, /Invalid/);
  assert.match((await h.send({ ...request, malID: "21" })).error, /Invalid/);
  assert.equal(h.count(), 0);
});
test("simultaneous lookups are coalesced and successful responses cached", async () => {
  const h = harness();
  await Promise.all([h.send(request), h.send(request)]);
  await h.send(request);
  assert.equal(h.count(), 1);
});
test("native failures remain retryable", async () => {
  const h = harness();
  h.result({ error: "HTTP 429" });
  assert.match((await h.send(request)).error, /429/);
  h.result({ found: false, results: [] });
  assert.equal((await h.send(request)).found, false);
  assert.equal(h.count(), 2);
});
test("embedded player navigation is forwarded to frame zero", async () => {
  const h = harness();
  await h.send({ type: "navigateNext", episodeID: 1, seriesID: 2 });
  assert.equal(h.forwarded[0][0], 7);
  assert.equal(h.forwarded[0][2].frameId, 0);
});
test("playback intent is tab scoped, episode scoped, expires, and requires the top frame to write", async () => {
  const h = harness();
  const next = { type: "openEpisode", episodeID: 2, seriesID: 10, url: "https://smotret-anime.com/catalog/series-10/2-seriya-2/sub-30" };
  await h.send(next);
  assert.equal(Object.keys(h.storage).length, 0);
  await h.send(next, { ...h.sender, frameId: 0 });
  assert.equal(h.navigations.length, 1);
  assert.equal(h.navigations[0][1].url, next.url);
  assert.equal((await h.send({ type: "autoplayIntent", episodeID: 2 })).play, true);
  assert.equal((await h.send({ type: "autoplayIntent", episodeID: 1 })).play, false);
  h.storage["autoplay:7"].expires = 1;
  assert.equal((await h.send({ type: "autoplayIntent", episodeID: 2 })).play, false);
  assert.equal(Object.keys(h.storage).length, 0);
});
test("navigation cannot escape the current mirror or series", async () => {
  const h = harness(), top = { ...h.sender, frameId: 0, url: "https://smotret-anime.com/catalog/show-10/1-seriya-1" };
  const msg = { type: "openEpisode", episodeID: 2, seriesID: 10 };
  for (const url of ["https://evil.test/catalog/show-10/2-seriya-2", "https://smotret-anime.org/catalog/show-10/2-seriya-2", "https://smotret-anime.com/catalog/show-11/2-seriya-2"]) {
    assert.ok((await h.send({ ...msg, url }, top)).error);
  }
  assert.equal(h.navigations.length, 0);
});
