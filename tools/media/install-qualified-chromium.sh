#!/usr/bin/env bash
# Read-only test tooling. The pinned 154 build contains Chromium fix 909a0222
# for SQLite-backed FileSystemHandle reads in Incognito. Not an app workaround.
set -euo pipefail

output="${1:?Usage: install-qualified-chromium.sh EVIDENCE_DIRECTORY}"
version=154.0.8037.57
# Independently recorded by both successful profile jobs in run 36482009156.
# This is an observed official-archive digest, not a vendor-signed checksum.
archive_sha=ceee2972074d441ea7c4ba8bcc0eaab77e7e87680f6653d73d3065851fe10302
binary_sha=e528b77a8b250c48a5bbd7aeeabbc2813940c0a2fe39b1b11fbaf1f01fb04f18
cache=".cache/qualified-chromium/$version"
archive="$cache/chrome-linux64.zip"
mkdir -p "$cache" "$output"

curl --fail --location --retry 3 --max-time 120 \
  "https://storage.googleapis.com/chrome-for-testing-public/$version/linux64/chrome-linux64.zip" \
  --output "$archive"
printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum --check
sha256sum "$archive" > "$output/browser-archive-sha256.txt"
unzip -qo "$archive" -d "$cache"
browser="$PWD/$cache/chrome-linux64/chrome"
printf '%s  %s\n' "$binary_sha" "$browser" | sha256sum --check
"$browser" --version | tee "$output/browser-version.txt"
test "$(awk '{print $NF}' "$output/browser-version.txt")" = "$version"
sha256sum "$browser" > "$output/browser-binary-sha256.txt"
# This environment variable is honored by both the full app and native runners.
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'CHROMIUM=%s\n' "$browser" >> "$GITHUB_ENV"
else
  printf 'CHROMIUM=%s\n' "$browser"
fi
