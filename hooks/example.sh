#!/bin/sh
set -e

dest=${KEYSTROKE_OUT_DIR:-$HOME/posts}
mkdir -p "$dest"
cp "$1" "$dest/"
echo "saved to $dest/$(basename "$1")"
