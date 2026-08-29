#!/usr/bin/env bash
# Center-crop a cover into the 1200x630 og:image social frame.
#
#   scripts/og-crop.sh games/<slug>/public/cover.png games/<slug>/shots/og.png
#
# Replaces the inline python snippet that used to live in game-art skill
# prose. Uses macOS `sips` when present, else ImageMagick (`magick`/
# `convert`); fails loudly when neither exists so nobody ships a silently
# uncropped og image.
set -euo pipefail

src="${1:-}"; out="${2:-}"
if [[ -z "$src" || -z "$out" ]]; then
  echo "usage: scripts/og-crop.sh <cover.png> <out-og.png>" >&2
  exit 2
fi
[[ -f "$src" ]] || { echo "error: $src not found" >&2; exit 1; }

mkdir -p "$(dirname "$out")"

if command -v sips >/dev/null; then
  w=$(sips -g pixelWidth "$src" | awk '/pixelWidth/ {print $2}')
  h=$(sips -g pixelHeight "$src" | awk '/pixelHeight/ {print $2}')
  # Scale so the 1200x630 frame is covered, then center-crop.
  scale_w=$(( w * 630 >= h * 1200 ? 0 : 1 ))
  cp "$src" "$out"
  if [[ $scale_w -eq 1 ]]; then
    sips --resampleWidth 1200 "$out" >/dev/null   # width-bound: height overflows
  else
    sips --resampleHeight 630 "$out" >/dev/null   # height-bound: width overflows
  fi
  sips -c 630 1200 "$out" >/dev/null
elif command -v magick >/dev/null || command -v convert >/dev/null; then
  im=$(command -v magick || command -v convert)
  # ^ resize-to-cover, then center-crop to the exact frame.
  "$im" "$src" -resize 1200x630^ -gravity center -extent 1200x630 "$out"
else
  echo "error: neither sips nor ImageMagick available; crop $src to 1200x630 manually" >&2
  exit 1
fi
echo "wrote $out (1200x630)"
