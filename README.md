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

For local unsigned development, Safari’s **Develop → Allow Unsigned Extensions** may be required. Enable developer features under Safari → Settings → Advanced if the Develop menu is hidden. A developer-signed build is recommended. No development identity is committed here.

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

Missing timings leave normal playback available, and the notice hides after five seconds. Substantially different release lengths are rejected rather than stretching timestamps. Missing MyAnimeList mappings, attached specials with different numbering, and split-season/absolute-numbering mismatches may have no supported timings. No title guessing or season-number remapping is performed.

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

Release planning and version stamping tests:

```sh
python3 -m unittest discover -s Tests/Release -v
```

Before distributing, also test a signed app in Safari: mirror permissions, real episodes with known timings, manual/automatic skips, post-credit scenes, cancelled/completed countdowns, translation selection, and autoplay allowed/denied. The cloud machine is Linux; native compilation and Swift tests run on macOS through GitHub Actions. Live Safari playback still requires manual validation.

## Automatic releases

Every push to **main**, including PR merges, runs `.github/workflows/release.yml`. It can also be rerun manually from Actions on main after a failed attempt. There is no release PR or manual version bump required.

1. Determine the next version from reachable `vMAJOR.MINOR.PATCH` tags. The first release uses `VERSION` (currently `0.1.0`). Later releases increment major for `type!:` or a `BREAKING CHANGE:` footer, minor for `feat:` / `feat(scope):`, and patch for other changes. Use these prefixes in squash-merge PR titles or commit messages.
2. Inject that version into both native bundles, the extension manifest, and npm metadata in the build checkout. The Actions run number supplies `CFBundleVersion`. Tags are the release version history; generated build changes are not pushed to main.
3. Run the browser, release-helper, and Swift tests. Build a universal **arm64 + x86_64** Release archive containing the app and extension on GitHub’s [`xcode-27` runner](https://github.com/actions/runner-images/issues/14404), which includes macOS 27 and its SDK. A `MACOS_RUNNER` repository variable can select another compatible runner. Both host and SDK are checked before building. PRs also run the native checks and verify development signing/packaging, attaching a development ZIP to the workflow run. The checks workflow can also be run manually; main invokes it through the release workflow to avoid duplicate native builds.
4. Sign and package the tested archive. Only after all checks and packaging pass, tag the exact main commit and create a draft GitHub Release with GitHub-generated notes since the previous release. Upload the app ZIP, dSYM ZIP when available, and `SHA256SUMS`, then publish the complete release.

Release runs are serialized. Retrying the same commit reuses its tag, can complete a draft interrupted during upload, and skips an already published release. Existing tags are never force-moved. If repository rules restrict tag creation, allow the Actions token to create the `v*` release tags. Only the publish job requests `contents: write`; no PAT is required.

Without Apple signing credentials, the release contains an **ad-hoc signed development build**, explicitly labeled as not notarized in its notes. It requires developer installation and Safari’s **Allow Unsigned Extensions**; it is not a Gatekeeper-ready distribution.

For Developer ID signed and notarized releases, add **all five** repository Actions secrets under Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_BASE64` | Base64 of a `.p12` containing exactly one Developer ID Application certificate and its private key |
| `MACOS_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `APPLE_API_KEY_BASE64` | Base64 of the App Store Connect API private `.p8` key used for notarization |
| `APPLE_API_KEY_ID` | That API key’s ID |
| `APPLE_API_ISSUER_ID` | Its issuer ID |

The workflow imports the certificate into a temporary keychain, signs the app and extension with the hardened runtime, submits to Apple, waits for acceptance, and staples the ticket before creating the final ZIP. Incomplete credentials, failed signing, or rejected notarization fail the run before publication. Temporary keychain and key files are removed even on failure. Credentials belong in GitHub secrets, never source files.

To reproduce a tagged build locally, stamp its tag version before building:

```sh
python3 scripts/release.py stamp --version 0.1.0 --build-number 1
```

This changes the current checkout’s version files and regenerates the project; CI does this in its disposable checkout. Regular development uses the checked-in base version.

The checked-in Xcode project needs no generator to build. To regenerate the project or refresh the bundled Anime365 assets, run `python3 scripts/generate-project.py` and `python3 scripts/generate-artwork.py` (asset resizing requires Pillow). The project generator replaces the project and scheme; preserve intentional Xcode configuration changes in the generator too. Original logo sources and the green accent are recorded in [Branding/README.md](Branding/README.md).

References: [AniSkip OpenAPI](https://api.aniskip.com/openapi.json), [Anime365 series API example](https://smotret-anime.com/api/series/35641), [translation API example](https://smotret-anime.com/api/translations/6085601). Integration may need updates if Anime365 changes its APIs or player.

Licensed under [MPL-2.0](LICENSE).
