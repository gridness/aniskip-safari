const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync("Extension/Resources/core.js", "utf8"), context);
const A = context.AniSkip;
const plain = value => JSON.parse(JSON.stringify(value));
const segment = (type, start, end, length = 1440) => ({ skipType: type, interval: { startTime: start, endTime: end }, episodeLength: length });

test("all five mirrors and their player subdomains are supported over HTTPS", () => {
  assert.equal(A.hosts.length, 5);
  for (const host of A.hosts) {
    assert.equal(A.supportedURL(`https://${host}/catalog/example-1/1-seriya-2`), true);
    assert.equal(A.supportedURL(`https://www.${host}/translations/embed/3`), true);
  }
  for (const url of ["http://smotret-anime.com", "https://smotret-anime.com.evil.test", "https://evilsmotret-anime.com", "javascript:alert(1)", "https://user:password@smotret-anime.com", "https://smotret-anime.com:8443"]) assert.equal(A.supportedURL(url), false, url);
});
test("catalog and embedded URLs resolve numeric site IDs, not episode title numbers", () => {
  assert.deepEqual(plain(A.route("https://smotret-anime.co/catalog/season-2-35641/5-seriya-388804/russkie-subtitry-6085601?play=1")), { seriesID: 35641, episodeID: 388804, translationID: 6085601 });
  assert.deepEqual(plain(A.route("https://smotretanime.co/translations/embed/6085601")), { translationID: 6085601 });
  assert.equal(A.route("https://smotret-anime.co/catalog/search"), null);
  assert.equal(A.route("https://example.com/catalog/a-1/b-2"), null);
});
test("settings are opt-in and type checked", () => {
  assert.equal(A.settings().autoplay, false);
  assert.equal(A.settings(null).enabled, true);
  assert.equal(A.settings({ enabled: "false" }).enabled, true);
  assert.equal(A.positiveID(true), false);
});
test("next episode excludes specials, inactive, unreleased and other series", () => {
  const current = { id: 10, seriesId: 1, episodeType: "tv", episodeInt: 1 };
  const next = (id, episodeInt, extra = {}) => ({ id, seriesId: 1, episodeType: "tv", episodeInt, isActive: 1, isFirstUploaded: 1, ...extra });
  const candidates = [next(11, 2, { episodeType: "special" }), next(12, 2, { isFirstUploaded: 0 }), next(13, 2, { isActive: 0 }), next(14, 2, { seriesId: 9 }), next(16, 4), next(15, 3)];
  assert.equal(A.nextEpisode(candidates, current).id, 15);
  assert.equal(A.nextEpisode([current], current), null);
});
test("translation selection preserves language, kind and provider when available", () => {
  const t = (id, type, authorsSummary, priority) => ({ id, type, authorsSummary, priority, isActive: 1, url: `https://smotret-anime.co/catalog/test-1/2-seriya-20/sub-${id}` });
  const episode = { translations: [t(30, "voiceRu", "A", 1000), t(31, "subRu", "B", 100), t(32, "subRu", "A", 10)] };
  const chosen = A.translationFor(episode, { type: "subRu", authorsSummary: "A" });
  assert.equal(chosen.id, 32);
  assert.equal(A.nextURL(chosen, "https://smotretanime.co", 20), "https://smotretanime.co/catalog/test-1/2-seriya-20/sub-32");
  assert.throws(() => A.nextURL(chosen, "https://smotretanime.co", 999));
  assert.equal(A.translationFor({ translations: [] }), null);
});
test("manual skip is available only within the returned interval", () => {
  const intervals = A.intervals([segment("op", 30, 120)], 1440);
  assert.equal(A.activeInterval(intervals, 29.9), null);
  assert.equal(A.activeInterval(intervals, 30).type, "op");
  assert.equal(A.activeInterval(intervals, 120), null);
});
test("different release lengths, malformed ranges, and unsupported types are rejected", () => {
  const input = [segment("op", 20, 110, 1500), segment("op", -2, 80), segment("op", 80, 10), segment("recap", 0, 90), segment("ed", 1300, Infinity), segment("ed", 1300, 1500)];
  assert.equal(A.intervals(input, 1440).length, 0);
  assert.equal(A.intervals(input, Infinity).length, 0);
});
test("closest release wins without losing post-credit scenes", () => {
  const selected = A.intervals([segment("op", 0, 90, 1430), segment("op", 20, 110), segment("ed", 1300, 1390)], 1440);
  assert.equal(selected[0].start, 20);
  assert.equal(selected[0].end, 110);
  assert.equal(selected[1].end, 1390);
  assert.ok(selected[1].end < 1440);
});
