#!/bin/bash
# Sign and package the already-tested universal archive. Never print secret values.
set -euo pipefail
umask 077

version="$(tr -d '\n' < VERSION)"
app="$PWD/build/aniskip.xcarchive/Products/Applications/aniskip.app"
extension="$app/Contents/PlugIns/aniskip Extension.appex"
[[ -d "$app" && -d "$extension" ]] || { echo "App or embedded extension missing from archive." >&2; exit 1; }
python3 - "$version" "$app" "$extension" <<'PY'
import pathlib, plistlib, sys
for bundle in sys.argv[2:]:
    with (pathlib.Path(bundle) / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    assert info["CFBundleShortVersionString"] == sys.argv[1], "Bundle release version mismatch"
    assert info["LSMinimumSystemVersion"] == "27.0", "Unexpected minimum macOS version"
PY
for binary in "$app/Contents/MacOS/aniskip" "$extension/Contents/MacOS/aniskip Extension"; do
  architectures="$(lipo -archs "$binary")"
  python3 - "$architectures" <<'PY'
import sys
architectures = set(sys.argv[1].split())
if not {"arm64", "x86_64"}.issubset(architectures):
    raise SystemExit("Expected a universal binary; found: " + sys.argv[1])
print("Verified binary architectures: " + sys.argv[1])
PY
done

secret_names=(MACOS_CERTIFICATE_BASE64 MACOS_CERTIFICATE_PASSWORD APPLE_API_KEY_BASE64 APPLE_API_KEY_ID APPLE_API_ISSUER_ID)
configured=0
for name in "${secret_names[@]}"; do
  if [[ -n "${!name:-}" ]]; then configured=$((configured + 1)); fi
done
if [[ "$configured" != 0 && "$configured" != "${#secret_names[@]}" ]]; then
  echo "Signing configuration is incomplete. Set all five signing/notarization secrets, or remove them all for a development build." >&2
  exit 1
fi

temporary="$(mktemp -d "${RUNNER_TEMP:-/tmp}/aniskip-signing.XXXXXX")"
keychain=""
cleanup() {
  if [[ -n "$keychain" ]]; then security delete-keychain "$keychain" >/dev/null 2>&1 || true; fi
  rm -rf "$temporary"
}
trap cleanup EXIT

if [[ "$configured" == 0 ]]; then
  codesign --force --sign - --timestamp=none --entitlements Extension/Extension.entitlements "$extension"
  codesign --force --sign - --timestamp=none --entitlements App/App.entitlements "$app"
  signing=development
else
  python3 - "$temporary" <<'PY'
import base64, os, pathlib, sys
root = pathlib.Path(sys.argv[1])
for name, filename in [("MACOS_CERTIFICATE_BASE64", "certificate.p12"), ("APPLE_API_KEY_BASE64", "notary-key.p8")]:
    # Support base64 copied with line wrapping while rejecting invalid characters.
    value = "".join(os.environ[name].split())
    (root / filename).write_bytes(base64.b64decode(value, validate=True))
PY
  keychain="$temporary/signing.keychain-db"
  keychain_password="$(openssl rand -base64 32)"
  security create-keychain -p "$keychain_password" "$keychain"
  security set-keychain-settings -lut 21600 "$keychain"
  security unlock-keychain -p "$keychain_password" "$keychain"
  security import "$temporary/certificate.p12" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
  identity="$(security find-identity -v -p codesigning "$keychain" | python3 -c 'import re,sys; ids=re.findall(r"([0-9A-F]{40}) \"Developer ID Application:",sys.stdin.read()); assert len(ids)==1,"Expected exactly one Developer ID Application identity"; print(ids[0])')"
  codesign --force --sign "$identity" --keychain "$keychain" --options runtime --timestamp --entitlements Extension/Extension.entitlements "$extension"
  codesign --force --sign "$identity" --keychain "$keychain" --options runtime --timestamp --entitlements App/App.entitlements "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
  ditto -c -k --sequesterRsrc --keepParent "$app" "$temporary/notarization.zip"
  xcrun notarytool submit "$temporary/notarization.zip" --key "$temporary/notary-key.p8" \
    --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID" \
    --wait --timeout 30m --output-format json > "$temporary/notarization.json"
  python3 - "$temporary/notarization.json" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    result = json.load(stream)
if result.get("status") != "Accepted":
    raise SystemExit("Apple notarization was not accepted; no release will be published.")
print("Apple notarization accepted.")
PY
  xcrun stapler staple "$app"
  xcrun stapler validate "$app"
  signing=notarized
fi

codesign --verify --deep --strict --verbose=2 "$app"
mkdir -p dist
ditto -c -k --sequesterRsrc --keepParent "$app" "dist/aniskip-${version}-macos.zip"
if [[ -d build/aniskip.xcarchive/dSYMs ]]; then
  ditto -c -k --sequesterRsrc --keepParent build/aniskip.xcarchive/dSYMs "dist/aniskip-${version}-dSYMs.zip"
fi
(cd dist && shasum -a 256 ./*.zip > SHA256SUMS)
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "signing=$signing" >> "$GITHUB_OUTPUT"; fi
echo "Packaged aniskip $version ($signing)."
