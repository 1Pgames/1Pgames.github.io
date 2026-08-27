#!/usr/bin/env bash
# Scaffold a new game from template/ into games/<slug>/.
#   scripts/new-game.sh <slug> ["Game Title"] [--family <code>] [--prd path/to/PRD.md] [--no-install]
#
# --family picks the gameplay slice (a dir under template/src/slices/, e.g.
#   arena, board, hyper, idle, table, word, side, track). Default: arena.
#   The scaffold keeps only that slice and points src/scenes/game.ts at it.
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
family="arena"
install=1
if [[ $# -gt 0 && "$1" != --* ]]; then
  title="$1"
  shift
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prd) prd="${2:-}"; shift 2 ;;
    --family) family="${2:-arena}"; shift 2 ;;
    --no-install) install=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$title" ]] || title="$slug"

if [[ ! -d "$TEMPLATE/src/slices/$family" ]]; then
  echo "error: unknown family '$family'; available: $(ls "$TEMPLATE/src/slices" | tr '\n' ' ')" >&2
  exit 2
fi

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

# Keep only the chosen gameplay slice: point the scene re-export at it and
# prune the other families (their sim counterparts too, when present).
python3 - "$dest" "$family" <<'PY'
import pathlib, shutil, sys
dest, family = pathlib.Path(sys.argv[1]), sys.argv[2]

slices = dest / 'src' / 'slices'
for d in sorted(p for p in slices.iterdir() if p.is_dir()):
    if d.name != family:
        shutil.rmtree(d)

game_path = dest / 'src' / 'scenes' / 'game.ts'
game_path.write_text(
    '/** Active gameplay slice (scaffolded with --family %s). */\n'
    "export { GameScene } from '../slices/%s/game';\n" % (family, family)
)

fams = dest / 'src' / 'sim' / 'families'
if fams.is_dir():
    for f in sorted(fams.glob('*.ts')):
        if f.stem not in (family, 'types', 'index'):
            f.unlink()

sim_dir = dest / 'src' / 'sim'
if sim_dir.is_dir():
    (sim_dir / 'family.ts').write_text(
        "/** Default family for `npm run sim` (written by new-game.sh --family). */\n"
        "export const SIM_FAMILY = '%s';\n" % family
    )
PY

if [[ -n "$prd" ]]; then
  cp "$prd" "$dest/PRD.md"
fi

if [[ $install -eq 1 ]]; then
  (cd "$dest" && npm install --silent)
fi

echo "created $dest"
echo "next: cd games/$slug && npm run dev"
