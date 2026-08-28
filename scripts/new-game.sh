#!/usr/bin/env bash
# Scaffold a new game from template/ into games/<slug>/.
#   scripts/new-game.sh <slug> ["Game Title"] [--family <code>] [--prompt "text"] \
#     [--genre "text"] [--desc "text"] [--prd path/to/PRD.md] [--no-install]
#
# --family picks the gameplay slice (a dir under template/src/slices/, e.g.
#   arena, board, hyper, idle, table, word, side, track). Default: arena.
#   The scaffold keeps only that slice and points src/scenes/game.ts at it.
# --prompt records the ORIGINAL user pitch the game was generated from; it is
#   stored in game.json, shown on the catalog store page and inside the game
#   shell. --genre/--desc feed the catalog card (fall back to family/empty).
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
prompt=""
genre=""
desc=""
install=1
if [[ $# -gt 0 && "$1" != --* ]]; then
  title="$1"
  shift
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prd) prd="${2:-}"; shift 2 ;;
    --family) family="${2:-arena}"; shift 2 ;;
    --prompt) prompt="${2:-}"; shift 2 ;;
    --genre) genre="${2:-}"; shift 2 ;;
    --desc) desc="${2:-}"; shift 2 ;;
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

# Keep only the chosen gameplay slice: point the scene re-export at it, prune
# the other families (their sim counterparts too, when present) and drop every
# generated art group the slice does not load.
python3 - "$dest" "$family" <<'PY'
import pathlib, re, shutil, sys
dest, family = pathlib.Path(sys.argv[1]), sys.argv[2]

slices = dest / 'src' / 'slices'
for d in sorted(p for p in slices.iterdir() if p.is_dir()):
    if d.name != family:
        shutil.rmtree(d)

# Art groups this game loads. The slice's own `ART_GROUPS` export is the source
# of truth; a family that does not declare one yet ships chrome art only (UI
# glyphs + backdrop), which is what its procedural visuals need.
slice_src = (slices / family / 'game.ts').read_text()
declared = re.search(r'export const ART_GROUPS = \[(.*?)\]', slice_src, re.S)
groups = re.findall(r"'([^']+)'", declared.group(1)) if declared else ['ui', 'bg']

game_path = dest / 'src' / 'scenes' / 'game.ts'
if declared:
    game_path.write_text(
        '/** Active gameplay slice (scaffolded with --family %s). */\n'
        "export { GameScene, ART_GROUPS } from '../slices/%s/game';\n" % (family, family)
    )
else:
    game_path.write_text(
        '/** Active gameplay slice (scaffolded with --family %s). */\n'
        "export { GameScene } from '../slices/%s/game';\n"
        '\n'
        '/**\n'
        ' * `art/manifest.json` groups this game loads (see `PreloadScene`). This\n'
        " * family's visuals are procedural apart from chrome, so only the UI glyphs\n"
        ' * and the backdrop ship. When the slice gains generated art, declare\n'
        ' * `ART_GROUPS` in the slice and re-export it from here instead.\n'
        ' */\n'
        'export const ART_GROUPS = [%s] as const;\n'
        % (family, family, ', '.join("'%s'" % g for g in groups))
    )

# Payload: an unloaded group is dead weight in the game's `dist/`. Deleting the
# directories makes `gen-art-registry.mjs` (re-run right after this script's
# python blocks) emit a registry that describes exactly what shipped.
generated = dest / 'public' / 'assets' / 'generated'
if generated.is_dir():
    for d in sorted(p for p in generated.iterdir() if p.is_dir()):
        if d.name not in groups:
            shutil.rmtree(d)

fams = dest / 'src' / 'sim' / 'families'
if fams.is_dir():
    for f in sorted(fams.glob('*.ts')):
        if f.stem not in (family, 'types', 'index'):
            f.unlink()

# Selftests that exercise a pruned slice reference deleted modules and would
# break typecheck — drop any kit selftest importing a slice dir that is gone.
kits = dest / 'src' / 'sim' / 'kits'
if kits.is_dir():
    for f in sorted(kits.glob('*.selftest.ts')):
        for m in re.finditer(r"slices/([a-z]+)/", f.read_text()):
            if not (slices / m.group(1)).is_dir():
                f.unlink()
                break

# Menu how-to line matches the family's verb (PRD refines it further).
howto = {
    'arena': 'Joystick to move. Survive the run.',
    'board': 'Swap gems. Hit every goal before moves run out.',
    'hyper': 'Tap to drop. Stack as high as you can.',
    'idle': 'Tap to collect. Hire managers. Ascend.',
    'table': 'Roll the dice. Complete the set.',
    'word': 'Answer 10 questions before the clock runs out.',
    'side': 'Tap to jump. Reach the exit door.',
    'track': 'Hold left or right to steer. Three laps.',
}.get(family)
if howto:
    menu_path = dest / 'src' / 'scenes' / 'menu.ts'
    menu_path.write_text(menu_path.read_text().replace('Joystick to move. Survive the run.', howto))

sim_dir = dest / 'src' / 'sim'
if sim_dir.is_dir():
    (sim_dir / 'family.ts').write_text(
        "/** Default family for `npm run sim` (written by new-game.sh --family). */\n"
        "export const SIM_FAMILY = '%s';\n" % family
    )
PY

# The pruned asset set is this game's real art set: regenerate src/data/art.ts
# so `node scripts/gen-art-registry.mjs --check` is green inside the game and
# `PreloadScene` never requests a sheet that was deleted.
(cd "$dest" && node scripts/gen-art-registry.mjs >/dev/null)

# Game manifest + deterministic SVG cover + shell page-bar (catalog link and
# the original prompt chip). The catalog is built by scanning game.json files.
python3 - "$dest" "$slug" "$title" "$family" "$prompt" "$genre" "$desc" <<'PY'
import hashlib, html, json, pathlib, sys, datetime
dest, slug, title, family, prompt, genre, desc = pathlib.Path(sys.argv[1]), *sys.argv[2:8]

manifest = {
    'slug': slug,
    'title': title,
    'family': family,
    'genre': genre or family,
    'description': desc,
    'prompt': prompt,
    'date': datetime.date.today().isoformat(),
    'tags': [family],
    'cover': 'cover.svg',
    'screenshots': [],
    # Drafts are excluded from the published catalog until the game clears
    # `node scripts/release-check.mjs <slug>`; flip to 'released' then.
    'status': 'draft',
}
(dest / 'game.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

# Deterministic gradient cover from the slug hash; game-art replaces it with a
# generated cover.png later (update game.json.cover when it does).
h = hashlib.sha256(slug.encode()).digest()
hue1, hue2 = h[0] * 360 // 255, (h[0] * 360 // 255 + 40 + h[1] * 80 // 255) % 360
words = title.upper().split()
half = (len(words) + 1) // 2
line1, line2 = ' '.join(words[:half]), ' '.join(words[half:])
cover = f'''<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl({hue1} 70% 22%)"/>
      <stop offset="1" stop-color="hsl({hue2} 80% 12%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.8">
      <stop offset="0" stop-color="hsl({hue1} 90% 60% / 0.35)"/>
      <stop offset="1" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <rect width="600" height="800" fill="url(#glow)"/>
  <circle cx="{120 + h[2] % 360}" cy="{520 + h[3] % 180}" r="{90 + h[4] % 70}" fill="hsl({hue2} 85% 55% / 0.18)"/>
  <circle cx="{380 + h[5] % 140}" cy="{150 + h[6] % 200}" r="{40 + h[7] % 50}" fill="hsl({hue1} 85% 65% / 0.22)"/>
  <text x="300" y="392" text-anchor="middle" font-family="system-ui, sans-serif" font-size="56" font-weight="800" fill="#f2f6ff" letter-spacing="2">{html.escape(line1)}</text>
  <text x="300" y="458" text-anchor="middle" font-family="system-ui, sans-serif" font-size="56" font-weight="800" fill="#f2f6ff" letter-spacing="2">{html.escape(line2)}</text>
  <text x="300" y="740" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" font-weight="600" fill="#8fa1c7" letter-spacing="6">{html.escape(family.upper())}</text>
</svg>
'''
(dest / 'public' / 'cover.svg').write_text(cover)

# Shell page-bar: back to the catalog + the original prompt.
index_path = dest / 'index.html'
chip = '<a class="pill" href="../../">&larr; Games</a>'
if prompt:
    chip += (
        '<details class="pill prompt"><summary>&#9432; prompt</summary><p>'
        + html.escape(prompt) + '</p></details>'
    )
index_path.write_text(index_path.read_text().replace('<!-- GAME_PAGE_LINKS -->', chip))
PY

if [[ -n "$prd" ]]; then
  cp "$prd" "$dest/PRD.md"
fi

if [[ $install -eq 1 ]]; then
  # npm workspaces: one root install registers the new game workspace.
  (cd "$ROOT" && npm install --silent)
fi

echo "created $dest"
echo "next: cd games/$slug && npm run dev"
