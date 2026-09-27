# Outpost Aurelia — Interface direction (game-art Step 1c)

Owner: art-director. ui-engineer implements these values **verbatim**. If you disagree, send it
back to the art-director; do not invent values in code. This file supersedes the PRD §11 palette
table and the §14 rects wherever they differ. Style lock: `art/style.json` (`aurelia-retro-nasa`).
Vision anchor: `art/refs/vision-1.png`.

Contrast math: `python3 art/tools/colour.py contrast <bg> <fg>...` (WCAG 2.x relative luminance).
Every text colour below was checked with that command against `bgTop` and against `bgDeep`.

## 1. PALETTE / CSS (replaces the scaffold values in `src/config.ts`)

| Key | Hex | Source in the anchor | vs bgTop #2b2230 | vs bgDeep #1a1418 |
| --- | --- | --- | --- | --- |
| bgDeep | `#1a1418` | ink outline around every object (sampled #27161f / #161213, taken slightly darker) | — | — |
| bgTop | `#2b2230` | dusk-violet cast shadow under the crystals (sampled #2e1f34, desaturated) | — | — |
| bgBottom | `#1f181f` | midpoint between bgDeep and bgTop, used for the gradient foot | — | — |
| ink | `#efe6d4` | specular cream on the dome hull (sampled #d9d5ba, lifted to paper white) | 12.33 PASS | 14.64 PASS |
| inkSoft | `#a79f8f` | hull shade band (sampled #a78f75, neutralised) | 5.82 PASS | 6.91 PASS |
| primary | `#e2b450` | sodium-amber window glow (sampled #e2b450) | 7.92 PASS | 9.40 PASS |
| secondary | `#6f9fa6` | teal hatch and turret base (PRD value; the anchor's pale teal is #98b8c0) | 5.23 PASS | 6.21 PASS |
| accent | `#d9c27a` | brass trim / reward (PRD value; sits between the dome trim #c38935 and the amber highlights) | 8.69 PASS | 10.33 PASS |
| good | `#8fb573` | sage (PRD). The anchor has no green; this is a UI-only state colour | 6.57 PASS | — |
| bad | `#de6a4f` | rust, **lightened from the PRD's #c8553d**: #c8553d measures 3.51:1 on bgTop and 4.17:1 on bgDeep and FAILS as text | 4.57 PASS | 5.43 PASS |
| badFill | `#8f3a28` | dark rust, fill only (danger button and alert pill), with ink text at 6.04:1 | fill | fill |
| cold | `#7d93b8` | frost (PRD value; the Rime biome's identity hue, also in the style palette) | 4.90 PASS | — |
| night | `#2c2640` at alpha 0.55 | dusk violet (sampled #372947 / #423957) | overlay | overlay |
| lime | `#c9e08a` | fauna lens eyes. **Art only. Never a UI colour**, so the alien read stays the fauna's | — | — |

Gameplay identity colours are **not** palette references. They stay as art-locked literals in the
slice tuning: fauna outline `#3a1712` (3/4/5 px), boss glow `#3a0000`, drone outline `#10302f`,
field edge `#e0a458` at alpha 0.6, deposit tints from PRD §5.2.

**Biome ground (revised; PRD §11 hexes were outside the floor band).** Floor tiles must sit at
L* 18-32. The PRD's hexes measured Glass Steppe #5a5048 at L*34.8, Rime #4a5360 at 35.0 and Nacre
#5c5856 at 37.7. The targets are now: Glass Steppe `#4d361b` (the accepted tile's mean, L* p5/mean/p95
21.0/24.6/29.0), Rime Basin `#3e4652` (29.4), Ember Mire `#4e4038` (28.3), Nacre Coast `#4a4644` (30.0).

## 2. Chrome spec (ui/primitives.ts; chrome is geometry and is never generated)

Shape language (PRD §11): colony = capsules and chamfered rectangles.

| Element | Fill | Stroke | Radius | Notes |
| --- | --- | --- | --- | --- |
| Panel (cards, sheets, dialogs) | bgTop `#2b2230` at alpha 0.94 | outer 3 px bgDeep `#1a1418`, plus a 1 px inner hairline accent `#d9c27a` at alpha 0.35 inset 4 px | 18 | the "NASA placard" look: dark plate with a brass pin-line |
| HUD chip / pill (ResourceStrip chip, AlertRail pill) | bgDeep `#1a1418` at alpha 0.82 | 2 px `#3b3040` | height/2 (capsule) | icon 32 px on the left, numeral 26 px bold ink |
| Primary button | primary `#e2b450`; pressed `#c38935` (y +2 px); disabled alpha 0.45 | 3 px bgDeep | 16 | label bgDeep `#1a1418` (9.40:1), no text stroke |
| Secondary button | `#3a4a52` (secondary, darkened); pressed `#2e3b42` | 3 px bgDeep | 16 | label ink (7.43:1) |
| Danger button (DEMOLISH, ABANDON) | badFill `#8f3a28`; pressed `#74301f` | 3 px bgDeep | 16 | label ink (6.04:1) |
| Progress bar housing | bgDeep at alpha 0.9 | 2 px `#3b3040` | height/2 | fill primary (supply), inkSoft tick for the forecast; deficit fill `bad` |
| Sol dial ring | track `#3b3040` 8 px | — | circle | amber `primary` by day, `#8a6fa0` violet by night |
| Tag chip (directive card) | tag hue at alpha 0.25 over panel | 2 px tag hue | capsule | tag hues: hearth `#e2b450`, forge `#c7783f`, bul `#de6a4f`, fr `#6f9fa6`, kin `#8fb573`, orb `#7d93b8` |
| Synergy / EVOLUTION READY rim | — | 4 px accent `#d9c27a`, alpha 0.6→1.0 over 900 ms | card radius | the only pulsing stroke in the UI |

**Armour tone** = bgDeep `#1a1418`, the darkest anchor tone.

## 3. Text armour rule

- **Text over live art** (map floaters, `+1` float text, banners, coach cards without a panel):
  `stroke: '#1a1418'`, `strokeThickness: 6` for display sizes ≥ 40 px and 4 for smaller sizes, plus
  `shadow: { offsetX: 0, offsetY: 2, color: '#1a1418', blur: 0, fill: true, stroke: true }`.
  These go into the `TEXT` presets in `src/config.ts`.
- **Text on its own pill, panel, disc or button strips the armour** (`strokeThickness: 0`, no
  shadow). A stroke on a solid plate only muddies the letterforms.
- Minimum sizes: body 26-32 px, HUD numerals 26 px bold, never below 22 px (timer suffixes).
- Negative numbers (net kW < 0) use `bad` #de6a4f and never the PRD's #c8553d.

## 4. Scrims

| Surface | Scrim |
| --- | --- |
| Draft overlay | bgDeep `#1a1418` at alpha 0.72 over the live map (PRD value kept) |
| Sheets (`openSheet`) | bgDeep at alpha 0.45 above the sheet, over the map; the sheet itself is a panel |
| Pause / confirm dialogs | bgDeep at alpha 0.6 |
| Results (GameOver) | the backdrop gets a vertical gradient scrim from bgDeep alpha 0.2 (top) to 0.75 (behind the button band) |
| Menu / Hub over `bg-arena` or `hub-planet-map` | bgDeep alpha 0.35 flat, plus a 0.6 band behind every text block that sits on art |
| Night grade | `night` #2c2640 at alpha 0.55 on the **world camera only**; the HUD camera is never graded |

**Text-over-art surfaces flagged for ui-engineer:** menu title and logo over the backdrop,
hub site cards over the planet map, postcard captions, dawn and "+N colonists" floaters, the Alpha
banner, coach cards, and results headlines over the backdrop. Each one either gets the armour or
sits on a panel.

## 5. HUD plan: PRD §14 revision (SAFE + shell corner)

**Blocking finding.** `src/config.ts` defines `SAFE = { top: 140, bottom: 220, side: 40 }`, and the
site shell overlays the **top-left 315×75** (`src/ui/hud.ts` header). The PRD §14 plan puts
`ResourceStrip` at (40, 36), inside both the shell corner and the unsafe top band. It also puts
`TimeControls` at y 40 and the `ContextStrip`/`BuildDock` at y 968-1192, which runs past
SAFE.bottom (y 1060). The usable rect is **x 40-680, y 140-1060 (640 × 920)**. Revised plan:

| Band | y-range | Owner widget | Rects | Arbitration (unchanged from PRD) |
| --- | --- | --- | --- | --- |
| Status | 140-232 | `ResourceStrip` + `TimeControls` | ResourceStrip x 40, y 144, 448 × 84: 2 rows × 4 capsule chips of 106 × 38 (gap 8). Pause x 496, y 144, 88 × 88. Speed x 592, y 144, 88 × 88 | (b) merge as a chip (max 8) |
| Banner | 240-328 | `SolBanner` | x 40, y 240, 640 × 88: dial 80 × 80 at (44, 244); text x 136-570; ORBIT x 584, y 240, 96 × 88 | (b) merge a line or (c) replace text ≤ 3 s |
| Alert rail | 336-424 | `AlertRail` (≤ 2 pills) | pills 312 × 88 at (40, 336) and (368, 336) | (c) overlay only; a 3rd alert queues |
| Playfield (clear) | 432-868 | colony map | the map renders full-screen behind the HUD; this is the unobstructed read window | (c) transient overlay with stated dismissal |
| Tray | 872-956 | `ContextStrip` | x 40, y 872, 640 × 84; DONE / BEACON / OVERDRIVE 160 × 84 at x 520 (the hit area extends 2 px into each neighbouring band, so the target is 88) | replace the contents, never overlap |
| Controls | 964-1056 | `BuildDock` | 5 slots 120 × 92 at x 40, 170, 300, 430, 560: icon 56 + cost 22 px | full-width only |
| Unsafe foot | 1060-1280 | nothing interactive | the map keeps rendering here; no HUD | — |

Juice reservations: `floatText` rises inside the playfield band only; the dusk edge arrows sit at
the playfield band edges (y 432-868, x 40-680). Coach cards anchor to y 440 with max height 180, so
they never cover the tray or the dock. Widget count stays ≤ 7, with one scrim or panel per overlay.

Overlays moved to fit SAFE:

| Overlay | PRD rect | Revised rect |
| --- | --- | --- |
| `BuildingCard` | y 700, 640 × 260 | x 40, y 600, 640 × 260 (camera eases the building to y ≈ 480) |
| Build / Orders / Ledger sheets | `openSheet` to y 1280 | the sheet spans y 540-1060 (height 520); Orders 560 → y 500-1060 |
| Draft | cards y 360; reroll (240, 960) | cards 200 × 420 at x 40/260/480, y 340; protocol card 640 × 140 at y 772; reroll 240 × 88 at (240, 928) |
| Results | RETRY/HUB y 1100 | RETRY and HUB 300 × 100 at y 944 |
| Hub TabBar | bottom 160 px (y 1120-1280) | y 964-1056, 3 tabs of 208 × 92 |
| Hub LAUNCH / DAILY | LAUNCH y 960; DAILY (380, 850) | LAUNCH 640 × 112 at (40, 836); DAILY 300 × 88 at (380, 736) |

Status: every rect above is arithmetic-checked against SAFE, the shell corner (all x ≥ 40 widgets
start at y ≥ 144 > 75) and the band table. None is pixel-validated, because no build exists. They
stay `[unvalidated]` until the first running build is screenshotted or its display list dumped.
The ux-flow-designer (§14b) should confirm the Hub tab move.
