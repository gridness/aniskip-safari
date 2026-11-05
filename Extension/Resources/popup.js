(() => {
  "use strict";
  const A = globalThis.AniSkip;
  void (async () => {
    const preferences = A.settings((await browser.storage.local.get("settings")).settings);
    for (const key of Object.keys(A.defaults)) {
      const input = document.getElementById(key);
      input.checked = preferences[key];
      input.addEventListener("change", async () => {
        try {
          const latest = A.settings((await browser.storage.local.get("settings")).settings);
          const updated = A.settings({ ...latest, [key]: input.checked });
          await browser.storage.local.set({ settings: updated });
          document.getElementById("error").hidden = true;
        } catch {
          const error = document.getElementById("error");
          error.textContent = "Could not save settings.";
          error.hidden = false;
        }
      });
    }
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const info = await browser.tabs.sendMessage(tab.id, { type: "getContext" }, { frameId: 0 });
      document.getElementById("context").textContent = info?.title ? `${info.title} · Episode ${info.episode}` : "No episode detected";
    } catch {
      document.getElementById("context").textContent = "No episode detected";
    }
  })();
})();
