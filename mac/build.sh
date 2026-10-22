#!/bin/sh
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out=$root/build/Keystroke.app
node=${KEYSTROKE_NODE:-$(command -v node)}
port=${KEYSTROKE_APP_PORT:-7778}
version=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$root/package.json")

rm -rf "$out"
mkdir -p "$out/Contents/MacOS" "$out/Contents/Resources"
sdks="$(xcrun --show-sdk-path 2>/dev/null || true) $(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX[0-9]*.sdk 2>/dev/null | sort -rV)"
for sdk in $sdks; do
  if SDKROOT=$sdk swiftc -O "$root/mac/Keystroke.swift" -o "$out/Contents/MacOS/Keystroke" \
    -framework Cocoa -framework WebKit 2>/dev/null; then
    export SDKROOT=$sdk
    break
  fi
done
if [ ! -x "$out/Contents/MacOS/Keystroke" ]; then
  echo "swiftc could not build against any installed sdk" >&2
  exit 1
fi

cat > "$out/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Keystroke</string>
  <key>CFBundleDisplayName</key><string>Keystroke</string>
  <key>CFBundleIdentifier</key><string>com.iteratedcomputing.keystroke</string>
  <key>CFBundleExecutable</key><string>Keystroke</string>
  <key>CFBundleIconFile</key><string>Keystroke</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>KeystrokeRoot</key><string>$root</string>
  <key>KeystrokeNode</key><string>$node</string>
  <key>KeystrokePort</key><string>$port</string>
</dict>
</plist>
PLIST

iconset=$(mktemp -d)/Keystroke.iconset
mkdir -p "$iconset"
swift "$root/mac/icon.swift" "$root/public/favicon.svg" "$iconset"
iconutil -c icns "$iconset" -o "$out/Contents/Resources/Keystroke.icns"

codesign --force --sign - "$out" >/dev/null 2>&1
echo "built $out"
