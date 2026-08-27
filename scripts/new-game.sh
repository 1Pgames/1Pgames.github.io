#!/usr/bin/env bash
# Scaffold a new game from template/ into games/<slug>/.
#
#   scripts/new-game.sh <slug> ["Game Title"] [--prd path/to/PRD.md] [--no-install]
#
# Idempotent-ish: refuses to overwrite an existing game folder.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/template"
GAMES="$ROOT/games"

slug="${1:-}"
if [[ -z "$slug" ]]; then
  echo "usage: scripts/new-game.sh <slug> [\"Game Title\"] [--prd PRD.md] [--no-install]" >&2
  exit 2
fi
shift

title=""
prd=""
install=1
if [[ $# -gt 0 && "$1" != --* ]]; then
  title="$1"
  shift
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prd) prd="${2:-}"; shift 2 ;;
    --no-install) install=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$title" ]] || title="$slug"

dest="$GAMES/$slug"
if [[ -e "$dest" ]]; then
  echo "error: $dest already exists" >&2
  exit 1
fi

mkdir -p "$GAMES"
# `art/exports` holds the raw generations, frame dumps and GIFs: reference
# material, not shipped assets. The exported sheets under `public/` are.
rsync -a \
  --exclude node_modules --exclude dist --exclude .vite --exclude .DS_Store \
  --exclude 'art/exports' \
  "$TEMPLATE/" "$dest/"

# Project identity: package name + HTML title.
python3 - "$dest" "$slug" "$title" <<'PY'
import json, pathlib, sys
dest, slug, title = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]

pkg_path = dest / 'package.json'
pkg = json.loads(pkg_path.read_text())
pkg['name'] = slug
pkg['description'] = f'{title} — daily generated Phaser 4 game'
pkg_path.write_text(json.dumps(pkg, indent=2) + '\n')

html_path = dest / 'index.html'
html_path.write_text(html_path.read_text().replace('GAME_TITLE', title))

menu_path = dest / 'src' / 'scenes' / 'menu.ts'
words = title.upper().split()
half = (len(words) + 1) // 2
stacked = '\\n'.join([' '.join(words[:half]), ' '.join(words[half:])]).strip('\\n')
menu_path.write_text(menu_path.read_text().replace("'GAME\\nTITLE'", f"'{stacked}'"))

# Namespace localStorage so games on the same host never share saves.
store_path = dest / 'src' / 'core' / 'storage.ts'
store_path.write_text(store_path.read_text().replace("const NS = 'gt:';", f"const NS = '{slug}:';"))
PY

if [[ -n "$prd" ]]; then
  cp "$prd" "$dest/PRD.md"
fi

if [[ $install -eq 1 ]]; then
  (cd "$dest" && npm install --silent)
fi

echo "created $dest"
echo "next: cd games/$slug && npm run dev"
