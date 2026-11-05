# aniskip

A macOS **27.0+** SwiftUI app and Safari Web Extension with opening/ending skip controls and optional next-episode autoplay.

Supports **smotret-anime.co**, **smotretanime.co**, **smotret-anime.com**, **smotret-anime.org**, and **smotret-anime.app**, including subdomains. Safari needs website access for the watch page **and** the embedded player’s mirror, which may differ.

## Build and enable

Requires macOS 27+, Xcode with the macOS 27 SDK (Xcode 27+), and Safari 27+. There are no third-party Swift dependencies. Node is only needed for browser-side tests.

1. Open [AniSkipSafari.xcodeproj](AniSkipSafari.xcodeproj) in Xcode.
2. Select the **AniSkipSafari** scheme and **My Mac** destination.
3. Choose your development team under **Signing & Capabilities** for **both** targets. If you change bundle IDs, also update the extension ID in `App/AniSkipSafariApp.swift` and the application ID in `Extension/Resources/background.js`.
4. Build and run. Select **Open Safari Extension Settings** in the companion app, enable **aniskip**, and allow access to the supported websites. Reload existing episode tabs.
5. Open an episode and use the **aniskip** toolbar popup to choose playback options.

For local unsigned development, Safari’s **Develop → Allow Unsigned Extensions** may be required. Enable developer features under Safari → Settings → Advanced if the Develop menu is hidden. A developer-signed build is recommended. Distribution requires signing/notarization or App Store submission; no development identity is committed here.

Compile without signing for a packaging check on a Mac with the required SDK:

```sh
xcodebuild -project AniSkipSafari.xcodeproj -scheme AniSkipSafari \
  -configuration Debug -destination 'generic/platform=macOS' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

The output is `build/Build/Products/Debug/aniskip.app`. Use Xcode signing for normal installation. Both targets set `MACOSX_DEPLOYMENT_TARGET = 27.0`.

## Playback

- **Manual skip:** a “Skip opening” or “Skip ending” button appears during a matching AniSkip interval. Manual controls are enabled by default.
- **Automatic skipping:** opening and ending toggles are independent and off by default. An automatic skip runs once per segment per loaded player, so seeking backward lets you rewatch it.
- **Post-credit scenes:** an ending skip seeks to the end of its interval. It does not immediately navigate to another episode.
- **Autoplay:** off by default. After the full video ends, a cancellable five-second countdown opens the next released episode of the same series and episode type. It prefers the same translation language/kind and provider, keeps the current mirror, and stops at the last available episode.
- **Starting the next video:** the extension requests playback on the new page. Safari may require **Settings for This Website → Auto-Play → Allow All Auto-Play**. If Safari denies playback, a **Play episode** button provides a user gesture. Anime365’s login, player activation, availability, and advertising requirements still apply.

Missing timings leave normal playback available. Substantially different release lengths are rejected rather than stretching timestamps. Missing MyAnimeList mappings, attached specials with different numbering, and split-season/absolute-numbering mismatches may have no supported timings. No title guessing or season-number remapping is performed.

## Implementation and privacy

`App/` contains the SwiftUI companion. `Extension/SafariWebExtensionHandler.swift` receives native messages and calls `Sources/AniSkipCore/AniSkipClient.swift`. Only this Swift client contacts AniSkip’s v2 endpoint using the MyAnimeList ID, episode number, `types[]=op`, `types[]=ed`, and full video duration. It validates inputs, uses ephemeral HTTPS sessions, and reports network failures without interrupting playback.

`Extension/Resources/` contains the Safari Manifest V3 extension:

- `content.js` resolves metadata through same-origin `/api/translations/{id}`, `/api/episodes/{id}`, and `/api/series/{id}`, and supplies controls in a shadow root.
- `player-bridge.js` uses Anime365’s video.js logical clock and `public-ended` event in the page’s main world. Individual video files may represent only part of an episode. Plain HTML players use the standard video API.
- `background.js` validates and caches native lookups, and relays iframe navigation to the top frame. Playback intent is scoped to the tab and next episode and expires after two minutes.
- The toolbar popup stores preferences in `browser.storage.local` and updates open player frames.

Permissions are `storage` and `nativeMessaging`, with content scripts limited to the five mirrors. Only MyAnimeList ID, episode number, and duration go to AniSkip. Anime365 metadata requests use the website’s normal session. No analytics, account, API key, remote executable code, or video downloading is included. Preferences and playback intent stay in Safari’s extension storage.

## Tests

```sh
npm ci --ignore-scripts
npm run check
npm test
```

The Node tests cover routing, release and translation selection, intervals, settings, caching, native errors, player controls, countdown cancellation, autoplay fallback, and the concatenated-player clock. They use API-shaped fixtures and simulated player events; they do not replace Safari testing.

On macOS 27+ with Xcode, test the Swift client with deterministic URLProtocol fixtures:

```sh
swift test
```

Before distributing, also test a signed app in Safari: mirror permissions, real episodes with known timings, manual/automatic skips, post-credit scenes, cancelled/completed countdowns, translation selection, and autoplay allowed/denied. The cloud machine is Linux: **native compilation, Swift tests, signing, and live Safari playback have not been verified there**.

The checked-in Xcode project needs no generator to build. To regenerate the project or refresh the bundled Anime365 assets, run `python3 scripts/generate-project.py` and `python3 scripts/generate-artwork.py` (asset resizing requires Pillow). The project generator replaces the project and scheme; preserve intentional Xcode configuration changes in the generator too. Original logo sources and the green accent are recorded in [Branding/README.md](Branding/README.md).

References: [AniSkip OpenAPI](https://api.aniskip.com/openapi.json), [Anime365 series API example](https://smotret-anime.com/api/series/35641), [translation API example](https://smotret-anime.com/api/translations/6085601). Integration may need updates if Anime365 changes its APIs or player.

Licensed under [MPL-2.0](LICENSE).
