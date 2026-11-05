#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo "The native build requires macOS 27+ and Xcode with the macOS 27 SDK." >&2
  exit 1
fi
sdk_version="$(xcrun --sdk macosx --show-sdk-version)"
host_version="$(sw_vers -productVersion)"
if [[ "${sdk_version%%.*}" -lt 27 || "${host_version%%.*}" -lt 27 ]]; then
  echo "Required: macOS 27+ and macOS SDK 27+. Found host $host_version, SDK $sdk_version." >&2
  echo "Use GitHub's xcode-27 runner or set the MACOS_RUNNER repository variable to a compatible runner label." >&2
  exit 1
fi
xcodebuild -version
echo "macOS $host_version; SDK $sdk_version"
