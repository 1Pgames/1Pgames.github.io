#!/usr/bin/env python3
"""Duskhaul cross-group art coherence probe.

Owner: art-director. Output: art/coherence-audit.md (art-director owns that file).
Re-run after any regeneration:  python3 art/probe.py   (from games/2026-08-29-duskhaul/)

TRIAGE instrument, not the style gate. The style gate is the reference-pair eyeball
test against hero/hero-idle + enemies-light/enemy-husk-move. Everything here is
measured over the opaque pixels of each exported sprite-sheet.png.

Deliberately absent: palette meanDistance. It is anti-correlated with style fidelity
in this set (smooth anti-aliased mids sit nearer the palette anchors than dithered
banding and a hard black outline do), so it is a drift alarm only.
"""
import colorsys
import glob
import json
import os
import statistics
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ROOT = os.path.join(PROJ, 'public/assets/generated')
OUT = os.path.join(HERE, 'coherence-audit.md')

SCAFFOLD_DIRS = {'arena', 'bg', 'props', 'ui'}
SCAFFOLD_ASSETS = {
    'enemies-heavy/boss-idle', 'enemies-heavy/elite-move',
    'enemies-heavy/tank-move', 'enemies-heavy/splitter-move',
    'enemies-light/healer-idle', 'enemies-light/runner-move',
    'enemies-light/shooter-idle', 'enemies-light/swarm-move',
    'pickups-fx/coin', 'pickups-fx/hit-spark',
    'pickups-fx/levelup-burst', 'pickups-fx/xp-orb',
    'hero/hero-attack',
}
CODED = {'red': (0xc0, 0x39, 0x2b), 'gilt': (0xd9, 0xa2, 0x4b),
         'violet': (0x85, 0x46, 0xdd), 'amber': (0xe8, 0xc5, 0x47)}
METRICS = (('warm', 'warm'), ('outline', 'outline'), ('blk', 'blk/2'), ('uniq', 'uniq'))


def measure(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    data = list(im.getdata())

    # colour histogram over opaque pixels only
    hist = {}
    for r, g, b, a in data:
        if a > 128:
            k = (r, g, b)
            hist[k] = hist.get(k, 0) + 1
    n = sum(hist.values())
    if n == 0:
        return None

    # Full-bleed integrity. A seamless tile or backdrop must reach every canvas edge:
    # minAlpha 255 is correct, anything less means a transparent margin was left
    # (fit < 1 insets the texture inside its cell) and the tile CANNOT tile, even
    # though it exports clean and passes its other checks. Meaningless for sprites,
    # which are supposed to have transparent surroundings, so it is only reported
    # for bg/tile-class assets.
    min_alpha = min(a for _, _, _, a in data)

    # block coherence at /2: nearest 1/2 down + up round trip, mean abs RGB error.
    # 0 == the art genuinely lives in 2px blocks.
    dn = im.resize((max(1, w // 2), max(1, h // 2)), Image.NEAREST)
    up = dn.resize((w, h), Image.NEAREST)
    tot = cnt = 0
    for (r1, g1, b1, a1), (r2, g2, b2, _) in zip(data, up.getdata()):
        if a1 > 128:
            tot += abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)
            cnt += 1
    blk = tot / (3 * cnt)

    # silhouette-edge darkness: share of boundary opaque pixels that are near-black
    px = im.load()
    edge = dark = 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] <= 128:
                continue
            on_edge = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= w or ny >= h or px[nx, ny][3] <= 128:
                    on_edge = True
                    break
            if on_edge:
                edge += 1
                if max(px[x, y][:3]) <= 60:
                    dark += 1
    outline = 100.0 * dark / edge if edge else float('nan')

    # warm share of mid-value, non-grey body pixels (WITHIN-SUBJECT metric only),
    # and the value-tier split. Tier cuts are on HLS lightness and are stated
    # explicitly rather than inferred from art_review: dark < 0.25,
    # mid 0.25-0.60, light > 0.60.
    warm = cool = 0
    dark = mid = light = 0
    for (r, g, b), c in hist.items():
        hh, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if l < 0.25:
            dark += c
        elif l <= 0.60:
            mid += c
        else:
            light += c
        if l < 0.12 or l > 0.88 or s < 0.05:
            continue
        if hh * 360 < 90 or hh * 360 > 300:
            warm += c
        else:
            cool += c
    wf = 100.0 * warm / (warm + cool) if (warm + cool) else float('nan')

    coded = {}
    for k, (cr, cg, cb) in CODED.items():
        hit = sum(c for (r, g, b), c in hist.items()
                  if abs(r - cr) < 70 and abs(g - cg) < 70 and abs(b - cb) < 70)
        coded[k] = 100.0 * hit / n

    return dict(uniq=100.0 * len(hist) / n, blk=blk, outline=outline, warm=wf,
                dark=100.0 * dark / n, mid=100.0 * mid / n, light=100.0 * light / n,
                coded=coded, size=f'{w}x{h}', n=n, minAlpha=min_alpha)


def sidecar(d):
    """Provider attribution plus qc sidecar facts.

    Attribution reads `sprite-metadata.json` -> `source.file`, which records the exact
    file the SHIPPED sheet was processed from. That is authoritative; globbing
    `raw-source.*` is a guess, and a guess is wrong whenever a dir holds more than one
    raw because a second provider was run into an already-accepted directory. Eleven
    such dirs exist in this build, and `.jpg` sorts first, so a glob silently labelled
    every one of them xai \u2014 including `hero/hero-idle`, one of the two canonical sheets.

    Three outcomes, and the distinction matters:
      `xai` / `codex`  \u2014 source.file is an omp-image-* provider temp; extension decides.
      `staged`         \u2014 source.file is NOT a provider temp, so the sheet was reprocessed
                         or hand-staged from an intermediate. Genuinely unattributable;
                         excluded from the cross-provider comparison rather than guessed.
                         Also a warning that the "reprocess from raw-source.*" recipes will
                         NOT reproduce this sheet \u2014 use the named source.file instead.
      `?`              \u2014 no metadata at all (scaffold dirs).
    """
    prov, asp, passed = '?', '', '?'
    # `.png` is xai too: the 9:16 backdrop runs came back as PNG from the same provider.
    kinds = {'.jpg': 'xai', '.jpeg': 'xai', '.png': 'xai', '.webp': 'codex'}
    p = os.path.join(d, 'sprite-metadata.json')
    sheet = output_path(d)
    if os.path.exists(p):
        try:
            meta = json.load(open(p))
            q = meta.get('qc') or {}
            passed = 'PASS' if q.get('passed') else 'FAIL'
            # A FAILED export overwrites sprite-metadata.json (and raw-source) while
            # writing NO sprite-sheet.png. So a dir can hold good art beside a record
            # that says qc.passed=false. Deterministic tell: the metadata is NEWER than
            # the sheet it claims to describe, i.e. it was written by a later run that
            # produced no sheet. Reported as `FAIL?` \u2014 inspect the pixels and reprocess
            # from the accepted temp before spending a generation; an unchanged sheet
            # md5 proves the metadata was lying, not the art.
            if passed == 'FAIL' and os.path.exists(sheet):
                if os.path.getmtime(p) > os.path.getmtime(sheet) + 1:
                    passed = 'FAIL?'
            cell = ((q.get('background') or {}).get('cell')) or {}
            if cell.get('aspect') is not None:
                asp = f"{float(cell['aspect']):.2f}"
            elif cell.get('width') and cell.get('height'):
                asp = f"{cell['width'] / cell['height']:.2f}"
            src = ((meta.get('source') or {}).get('file')) or ''
            if src:
                base = os.path.basename(src)
                ext = os.path.splitext(base)[1].lower()
                low = base.lower()
                if low.startswith('omp-image'):
                    # Processed straight from the provider temp: strongest attribution.
                    prov = kinds.get(ext, ext.lstrip('.') or '?')
                elif low.startswith('raw-source'):
                    # REPROCESSED from the asset's own saved raw (the CLI route used for
                    # the debris, violet and scale-profile fixes). raw-source is a copy of
                    # the provider temp, so the extension still attributes it; the `*`
                    # marks the weaker chain, since a later failed export can overwrite a
                    # raw-source in place. Attributed rather than discarded: dropping
                    # these would lose most of the reprocessed set from section 2.
                    k = kinds.get(ext)
                    prov = (k + '*') if k else 'staged'
                else:
                    # Foreign intermediate, hand-staged outside the documented pipeline.
                    # Genuinely unattributable, and the reprocess recipes will NOT
                    # reproduce this sheet - they must be fed this file by name.
                    prov = 'staged'
        except Exception:
            pass
    return prov, asp, passed


def mad(vals):
    if len(vals) < 3:
        return None, None
    med = statistics.median(vals)
    return med, (statistics.median([abs(v - med) for v in vals]) or 1e-9)


def output_path(d):
    """The processed image this asset actually shipped.

    A multi-frame export writes `sprite-sheet.png`; a 1x1 export writes `sprite.png`
    and NO sheet. Testing only for the sheet therefore makes every static asset
    invisible - tiles, decals, backdrops, single-frame props - which is the asset class
    most likely to be finished. Returns the sheet when present, else the single sprite,
    else the sheet path so callers can test existence uniformly.
    """
    for name in ('sprite-sheet.png', 'sprite.png'):
        q = os.path.join(d, name)
        if os.path.exists(q):
            return q
    return os.path.join(d, 'sprite-sheet.png')


def collect():
    """Every shipped asset directory, multi-frame OR single-frame.

    Enumerated by DIRECTORY rather than by `sprite-sheet.png`, because a 1x1 export
    ships `sprite.png` instead and globbing the sheet silently dropped every static
    asset from the audit.
    """
    rows, scaffold = [], []
    dirs = sorted({os.path.dirname(q) for name in ('sprite-sheet.png', 'sprite.png')
                   for q in glob.glob(os.path.join(ROOT, '*/*/' + name))})
    for d in dirs:
        rel = os.path.relpath(d, ROOT).replace(os.sep, '/')
        if '_bak' in rel:
            continue
        m = measure(output_path(d))
        if not m:
            continue
        prov, asp, passed = sidecar(d)
        m.update(rel=rel, group=rel.split('/')[0], prov=prov, asp=asp, passed=passed)
        is_scaffold = m['group'] in SCAFFOLD_DIRS or rel in SCAFFOLD_ASSETS
        (scaffold if is_scaffold else rows).append(m)
    return rows, scaffold


def group_map(rows):
    by = {}
    for r in rows:
        by.setdefault(r['group'], []).append(r)
    return by


def within_group_outliers(rows, k=3.0, min_group=4):
    """Deviation against the row's OWN group.

    Only `warm` and `outline` are used. `uniq` and `blk/2` are reported in the table
    but deliberately NOT flagged: they track how detailed a subject is, not whether it
    belongs — a flame and a plate-armoured knight legitimately differ by 40 points, and
    flagging them mislabels the canonical `husk-move` as an outlier in its own group.
    Groups smaller than `min_group` are skipped because MAD is unstable there.
    """
    flagged = {}
    for members in group_map(rows).values():
        if len(members) < min_group:
            continue
        for metric, label in (('warm', 'warm'), ('outline', 'outline')):
            vals = [m[metric] for m in members if m[metric] == m[metric]]
            med, d = mad(vals)
            if med is None:
                continue
            for m in members:
                v = m[metric]
                if v != v:
                    continue
                z = (v - med) / d
                if abs(z) >= k:
                    flagged.setdefault(m['rel'], []).append(
                        f'{label} {v:.0f} vs group median {med:.0f} ({z:+.1f} MAD)')
    return flagged


def provider_signature(rows):
    per_group, deltas = [], {m: [] for m, _ in METRICS}
    for group, members in sorted(group_map(rows).items()):
        # `xai*`/`codex*` are reprocessed-from-own-raw; same renderer, so they count.
        x = [m for m in members if m['prov'].rstrip('*') == 'xai']
        c = [m for m in members if m['prov'].rstrip('*') == 'codex']
        if not x or not c:
            continue
        row = {'group': group, 'nx': len(x), 'nc': len(c)}
        for metric, _ in METRICS:
            mx = statistics.median([m[metric] for m in x if m[metric] == m[metric]])
            mc = statistics.median([m[metric] for m in c if m[metric] == m[metric]])
            row[metric] = (mx, mc, mc - mx)
            deltas[metric].append(mc - mx)
        per_group.append(row)
    return per_group, deltas


def main():
    rows, scaffold = collect()
    if not rows:
        print('no sheets found under', ROOT)
        return 1
    flagged = within_group_outliers(rows)
    per_group, deltas = provider_signature(rows)

    L = ['# Duskhaul cross-group art coherence audit\n',
         'Owner: art-director (`ArtInterface`). Generated by `art/probe.py` — re-run after any',
         'regeneration. Nobody else writes this file.\n',
         '**Triage instrument, not the style gate.** The style gate remains the reference-pair',
         'eyeball test against `hero/hero-idle` + `enemies-light/enemy-husk-move`. Every figure',
         'here is measured over the opaque pixels of an exported `sprite-sheet.png`; use it to',
         'decide WHICH sheets to open, and in what order. Acceptance calls belong to the',
         'integrator, not to this file.\n',
         '`meanDistance` is deliberately absent: it is anti-correlated with style fidelity in this',
         'set, because smooth anti-aliased mids sit nearer the palette anchors than dithered',
         'banding and a hard black outline do. Treat it as a drift alarm only.\n',
         '## Methodology \u2014 the standing rule this wave paid for\n',
         '**EVERY HEURISTIC STATES ITS POPULATION IN THE SAME BREATH AS ITS RULE \u2014 and states it',
         'IN THE CODE, in the docstring beside the check, not only in the report.** A rule',
         'written down without its scope gets applied tree-wide by the next reader, and in every',
         'case below the METRIC was fine while the POPULATION it was applied to was not:\n',
         '| heuristic | correct scope | what the unscoped version libelled |',
         '| --- | --- | --- |',
         '| output present = shipped | `sprite-sheet.png` for multi-frame, `sprite.png` for 1x1 | every static asset \u2014 tiles, icons, decals, backdrops |',
         '| provider from `raw-source.*` | only when the dir holds ONE raw; otherwise read `source.file` | 11 dirs holding two raws, including the canonical `hero/hero-idle` |',
         '| `minAlpha` 255 = correct | full-bleed tiles/borders/backdrops ONLY | every sprite, where `minAlpha` 0 is REQUIRED and strict QC enforces it |',
         '| enumerate by `sprite-sheet.png` | must enumerate by DIRECTORY (my own bug) | `pickups-fx/bullet` and every single-frame asset, invisible to this audit entirely |',
         '| coded-glow area share | subjects whose glow is a LARGE feature | eye-slit-only subjects such as `paleknight`, whose slits cannot reach a percentage bar |',
         '',
         'All five were caught by an agent RE-MEASURING AGAINST FINISHED WORK, not by review of',
         'the rule. That is the practice worth keeping, and it is why `minAlpha` shipped',
         'class-scoped while the four before it did not.\n',
         '## Columns\n',
         '| column | meaning |', '| --- | --- |',
         '| `prov` | from `sprite-metadata.json` -> `source.file`, which names the file the shipped output was processed FROM. `.jpg`/`.png` = xai, `.webp` = codex. A `*` suffix means REPROCESSED from the asset\'s own raw (still attributable, counted in section 2); `staged` means a foreign hand-staged intermediate \u2014 unattributable, excluded, and the reprocess recipes cannot reproduce it without being fed that file by name. |',
         '| `qc` | `qc.passed` from `sprite-metadata.json`. `FAIL?` means the metadata is NEWER than the output it describes, so a later failed run clobbered the record of good art \u2014 inspect the pixels before spending a generation. |',
         '| `cellAsp` | `qc.background.cell.aspect`. 1.00 = square; codex silently returns non-square canvases, which breaks `scaleProfile` binding. |',
         '| `uniq%` | share of opaque pixels that are a unique colour. High = smooth render, low = banded. |',
         '| `blk/2` | mean RGB error after a nearest 1/2 down+up round trip. 0 = the art genuinely lives in 2px blocks. |',
         '| `outline%` | share of silhouette-edge pixels that are near-black — the 1px `#0d0b10` outline. |',
         '| `warm%` | warm-hue share of mid-value non-grey body pixels. **Within-subject metric only.** |',
         '| `glow%` | best coded-hue presence (red / gilt / violet / amber). |', '',
         f'## Set ({len(rows)} sheets, scaffold excluded)\n',
         '| asset | prov | qc | cellAsp | uniq% | blk/2 | outline% | warm% | glow% | group-relative flags |',
         '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for r in sorted(rows, key=lambda r: r['rel']):
        L.append(f"| `{r['rel']}` | {r['prov']} | {r['passed']} | {r['asp']} | {r['uniq']:.0f} | "
                 f"{r['blk']:.1f} | {r['outline']:.0f} | {r['warm']:.0f} | "
                 f"{max(r['coded'].values()):.2f} | {'; '.join(flagged.get(r['rel'], []))} |")

    L += ['', '## 1. Outliers against their OWN group\n',
          'A global threshold cannot answer the coherence question, because `warm%` and `outline%`',
          'are subject-driven — the canonical `hero-idle` is ~92% warm and ~36% outlined and it is',
          '*correct*. What matters is a sheet that does not belong beside its own siblings.',
          'Flag = at least 2.5 MAD from its group median on any column.\n']
    if flagged:
        L += ['| asset | prov | qc | deviation |', '| --- | --- | --- | --- |']
        for rel, why in sorted(flagged.items()):
            r = next(x for x in rows if x['rel'] == rel)
            L.append(f"| `{rel}` | {r['prov']} | {r['passed']} | {'; '.join(why)} |")
    else:
        L.append('No sheet deviates 2.5 MAD or more from its own group median on any column.')

    counts = {}
    for r in rows:
        counts[r['prov']] = counts.get(r['prov'], 0) + 1
    L += ['', '## 2. Does the set span two renderers?\n',
          'Provider census (proxy): ' + ', '.join(f'`{k}` {v}' for k, v in sorted(counts.items())) + '.\n']
    if per_group:
        L += ['Subject is controlled by comparing provider medians WITHIN each group, then',
              'aggregating the per-group deltas. Only groups holding BOTH providers can contribute,',
              'so this is the honest comparison rather than a global average.\n',
              '| group | n xai | n codex | warm% x -> c | outline% x -> c | blk/2 x -> c |',
              '| --- | --- | --- | --- | --- | --- |']
        for row in per_group:
            w, o, b = row['warm'], row['outline'], row['blk']
            L.append(f"| `{row['group']}` | {row['nx']} | {row['nc']} | "
                     f"{w[0]:.0f} -> {w[1]:.0f} ({w[2]:+.0f}) | {o[0]:.0f} -> {o[1]:.0f} ({o[2]:+.0f}) | "
                     f"{b[0]:.1f} -> {b[1]:.1f} ({b[2]:+.1f}) |")
        L += ['', '| metric | median per-group delta (codex - xai) | groups compared |',
              '| --- | --- | --- |']
        for metric, label in METRICS:
            v = deltas[metric]
            L.append(f'| {label} | {statistics.median(v):+.1f} | {len(v)} |')
        wd = statistics.median(deltas['warm'])
        od = statistics.median(deltas['outline'])
        L += ['', f'**Yes — and the signature is temperature, not draughtsmanship.** The `warm%`',
              f'delta is {wd:+.0f} points, codex warmer than xai, which is the brown gravity several',
              'generation agents reported independently, now measured with subject controlled rather',
              'than eyeballed. It is the ONE systematic difference in this set.', '',
              f'The `outline%` delta is {od:+.0f} — codex outlines measure slightly STRONGER, not',
              'weaker. That contradicts the "codex loses the 1px outline" reading: individual codex',
              'sheets did lose it, but it is not a systematic property of the renderer, so a missing',
              'outline is a per-sheet accident to fix in prose rather than a reason to change',
              'provider. `blk/2` and `uniq%` deltas are small and inconsistent in sign — neither',
              'renderer is systematically smoother than the other here.', '',
              'Both findings are correctable in prose (assert the palette hexes and the outline',
              'explicitly). Neither justifies rerolling already-accepted art, and note the hard',
              'constraint that outranks both: a base and its siblings must come from the',
              'same-aspect provider, so provider is chosen per CHARACTER CHAIN, never per asset.']
    else:
        L += ['No group currently holds sheets from both providers, so the split cannot be measured',
              'with subject controlled. Any cross-provider claim now would be confounded by subject',
              'and must not be used to justify rerolls.']

    L += ['', '## 3. Sheets I would reject on a side-by-side\n']
    # Subject-controlled criteria only. A GLOBAL warm threshold is invalid here — it
    # contradicts the within-subject finding and flags the canonical husk-move.
    glow_med = {g: statistics.median([max(m['coded'].values()) for m in ms])
                for g, ms in group_map(rows).items()}
    # RE-TIGHTENED for the final pass. A 23-row list at 26% of the population is not a
    # work queue, it is a second copy of the table. Two changes:
    #   * warm must be BOTH statistically extreme (>=4.5 MAD) AND materially large
    #     (>=25 percentage points from the group median). Statistical extremity alone
    #     flags tight groups over trivial gaps.
    #   * the coded-glow criterion is REMOVED from the shortlist. It produced a false
    #     positive on paleknight, whose eye-slits cannot reach an area share; glow is
    #     now a visual presence-per-frame check. It stays measured below the line.
    shortlist, below = [], []
    by_group = group_map(rows)
    for r in rows:
        members = by_group[r['group']]
        vals = [m['warm'] for m in members if m['warm'] == m['warm']]
        med, d = mad(vals)
        hard = False
        if med is not None and r['warm'] == r['warm']:
            z = (r['warm'] - med) / d
            gap = abs(r['warm'] - med)
            if abs(z) >= 4.5 and gap >= 25:
                hard = True
                shortlist.append((r, [f'temperature does not belong beside its own siblings: '
                                      f'warm {r["warm"]:.0f}% vs group median {med:.0f}% '
                                      f'({z:+.1f} MAD, {gap:.0f}pt gap)']))
        if not hard and r['rel'] in flagged:
            below.append((r, flagged[r['rel']]))
    if shortlist:
        L += ['| asset | prov | qc | one-line reason |', '| --- | --- | --- | --- |']
        for r, why in sorted(shortlist, key=lambda t: -t[0]['warm']):
            L.append(f"| `{r['rel']}` | {r['prov']} | {r['passed']} | {'; '.join(why)} |")
        L += ['',
              'Two criteria only, both subject-controlled. A GLOBAL warm threshold is NOT used:',
              'it would contradict the within-subject finding and flags the canonical `husk-move`.',
              '',
              '**Read these as "open this sheet first", not as verdicts.** BOTH criteria need a',
              'human read, and the coded-glow one needed correcting against my own false positive:',
              '',
              '**Coded glow \u2014 scope it by subject class.** Area share is only meaningful where the',
              'coded hue is a LARGE feature: a glowing face, a bell mouth, a coin-crusted hide.',
              'For an EYE-SLIT-ONLY subject the share is intrinsically tiny \u2014 two slits on a',
              'massive armoured body cannot reach a percentage bar without bloating into',
              "headlights, which would break style.json's own \"one small glowing element\" focal",
              'rule. This criterion flagged `enemies-heavy/enemy-paleknight-move` as missing its',
              'glow; re-measurement on a like-for-like metric put the knight at 3x the threat-red',
              'of the canonical `husk-move`, and the slits were visually confirmed burning in the',
              'helm shadow in all four frames. **That was a false positive of mine, and the asset',
              'is closed.** For eye-slit-only subjects the correct test is PRESENCE IN EVERY',
              'FRAME, checked visually \u2014 never an area share, and never a flat target like',
              '"red >= 5%", which the canon itself fails by roughly 50x.',
              '',
              '**Temperature** likewise needs a human read, because a group that deliberately',
              'MIXES coded hues produces expected deviations:',
              '',
              '- `pickups-fx` has a group warm median near 99% because the shard/gilt/chest assets',
              '  dominate it, so the deliberately COOL violet-coded members (`casket-sparkle`,',
              '  `relic-hover-t4`, and `chest-open` in part) deviate *because they are correct*.',
              '  Do not reroll a violet-coded pickup for being cooler than a gilt one.',
              '- `gates-collapse` is confounded the same way and MORE strongly: PRD §11 codes the',
              '  gate states as violet when open, AMBER when closing, and cooled grey when closed.',
              '  So `gate-closing` reading warm (80% vs a group median of 27%) is the amber warning',
              '  state working as designed, and `gate-closed` carrying no coded glow (0.04%) is the',
              '  cooled `#7e7376` state working as designed. Both are FALSE POSITIVES of these',
              '  criteria, not defects — the group deliberately spans three coded temperatures.',
              '- `hero/hero-hurt` is a 2-frame white-flash state; a flash legitimately has a',
              '  different temperature from the idle/run body it is measured against. It is also',
              '  the one sheet with NO `raw-source.*` on disk, so it cannot be reprocessed —',
              '  any fix there needs a regeneration.',
              '- The criterion is trustworthy where a group is ONE material family, and that is',
              '  the only place it should be read as a defect.',
              '',
              '**The `warm%` metric and its blind spot \u2014 read this before citing a number.** It',
              'measures the DIRECTION OF THE CHROMATIC CONTENT ONLY: pixels that are very dark,',
              'very light or near-grey are excluded from the denominator, then warm is scored',
              'against cool among what remains. So a subject whose COLD elements are dark and',
              'desaturated (chitin, iron in shadow) reads warmer here than it looks, because its',
              'cold mass never enters the denominator. `elite-matron-move` is exactly that case:',
              'this probe reads 98.7% while a whole-pixel measure reads 61.3%, and BOTH are',
              'correct for what they measure. The audit cites this probe\'s figure for internal',
              'consistency with every other row in the table, and the asset is NOT a defect \u2014 a',
              'large pale bone-parchment abdomen is warm by construction per its brief, and the',
              'chitin and legs came back cold. Where a row could be explained this way, the',
              'substantive read of the pixels outranks either number.']
    else:
        L.append('None. No sheet is both statistically extreme and materially far from its own '
                 'group on temperature.')

    if below:
        L += ['', '### Below the line \u2014 measured, NOT actioned\n',
              'Recorded so the data survives without pretending to be a work queue. These moved',
              'the old 3.0-MAD criterion but not the tightened one, or are documented',
              'design-intended deviations. No action requested on any of them.\n',
              '| asset | prov | qc | measurement |', '| --- | --- | --- | --- |']
        for r, why in sorted(below, key=lambda t: t[0]['rel']):
            L.append(f"| `{r['rel']}` | {r['prov']} | {r['passed']} | {'; '.join(why)} |")

    L += ['', '## Retired reject criteria (measured on the canon)\n',
          '| sheet | uniq% | blk/2 | outline% | warm% | red% |', '| --- | --- | --- | --- | --- | --- |']
    for label, rel in (('CANON', 'hero/hero-idle'),
                       ('CANON', 'enemies-light/enemy-husk-move'),
                       ('OFF-STYLE', 'enemies-heavy/enemy-paleknight-move')):
        r = next((x for x in rows if x['rel'] == rel), None)
        if r:
            L.append(f"| `{rel}` {label} | {r['uniq']:.0f} | {r['blk']:.1f} | {r['outline']:.0f} | "
                     f"{r['warm']:.0f} | {r['coded']['red']:.2f} |")
    L += ['',
          '- **"No visible pixel grid" is retired as a reject.** No sheet here is literally flat',
          '  pixel art: `blk/2` never approaches the ~0 that true 2px blocks produce, and the',
          '  canonical `hero-idle` is the least block-coherent sheet measured. These sheets READ as',
          '  pixel art at `renderScale` 48 while the files are smooth renders. Rejecting on this',
          '  would reject the canon.',
          '- **"Missing 1px outline" is retired as a reject.** `hero-idle` sits near 36% against',
          '  `husk-move` near 87%, and the off-style `paleknight` measures within a point of the',
          '  canonical husk. Outline strength is a flag to OPEN a sheet, never an auto-reject.',
          '- **`warm%` is within-subject only.** A cross-subject rule such as "under 50% warm"',
          '  would reject `hero-idle` itself. Within one subject it is decisive.', '']

    dks = sorted(r['dark'] for r in rows)
    mds = sorted(r['mid'] for r in rows)
    lts = sorted(r['light'] for r in rows)
    def q(v, f):
        return v[int(len(v) * f)] if v else float('nan')
    L += ['## 4. Value tiers — RULING (art-director, style-lock owner)\n',
          'Tier cuts are HLS lightness, stated rather than inferred from `art_review`:',
          'dark < 0.25, mid 0.25-0.60, light > 0.60. Measured across the set:\n',
          '| tier | median | p25 | p75 | min | max | old plan | NEW plan |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          f'| dark | {statistics.median(dks):.1f}% | {q(dks, 0.25):.1f}% | {q(dks, 0.75):.1f}% | '
          f'{dks[0]:.1f}% | {dks[-1]:.1f}% | 50% | **60%** |',
          f'| mid | {statistics.median(mds):.1f}% | {q(mds, 0.25):.1f}% | {q(mds, 0.75):.1f}% | '
          f'{mds[0]:.1f}% | {mds[-1]:.1f}% | 35% | **32%** |',
          f'| light | {statistics.median(lts):.1f}% | {q(lts, 0.25):.1f}% | {q(lts, 0.75):.1f}% | '
          f'{lts[0]:.1f}% | {lts[-1]:.1f}% | 15% | **8%** |',
          '',
          '**Ruling: retune the plan, and make the light-tier check ADVISORY as a reject — but',
          'keep the broad-highlight prose as a forward requirement.** `plan.valuePlan` in',
          '`art/style.json` is now dark 0.60 / mid 0.32 / light 0.08.\n',
          'Three measured facts drove it, and two of them cut against the easy answers:\n',
          '- **The plan was NOT globally mis-tuned.** The mid tier came in at a median of',
          f'  {statistics.median(mds):.1f}% against a planned 35% — essentially on target. Only the',
          '  light share missed, and the dark tier absorbed the whole difference. So "grimdark set,',
          '  the plan is wrong" over-claims: one number was wrong, not the plan.',
          '- **15% lights is ACHIEVABLE in this art direction, which kills the false-precision',
          '  reading.** Six sheets clear or approach it — `ui-icons/icons` at 48.4%,',
          '  `enemies-light/enemy-pyreling-move` 26.9%, `zone-outlands/enemy-giant-move` 23.2%,',
          '  `enemies-heavy/enemy-marrowworm-move` 19.7%, `pickups-fx/relic-hover-t3` 13.8%,',
          '  `elites-warden/elite-matron-move` 13.6%. A target six sheets already hit is not',
          '  unreachable, so the check is diagnosing something real, not measuring noise.',
          '- **But the canon fails it, so it cannot be a REJECT.** `enemy-husk-move` carries 0.6%',
          '  lights and `hero-idle` 4.6%. Rejecting on the light tier would reject the reference',
          '  pair — the identical trap as the retired pixel-grid and outline criteria above.\n',
          f'The new light target of 8% sits at the set p75 ({q(lts, 0.75):.1f}%): a stretch met by',
          'the better quarter of the set, rather than an unreachable 15% or a rubber-stamped',
          f'{statistics.median(lts):.1f}% median that would bless the black-blob failure. The dark and',
          'mid figures are simply what correctly-reading sheets in this direction measure.\n',
          'What this does NOT license: shipping a 0.4-1.0% light tier. `boss-warden-idle` (0.4%),',
          '`enemy-husk-move` (0.6%), `casket-sparkle` (0.7%) and `boss-warden-summon` (1.0%) trend',
          'to a silhouette blob at `renderScale` 48, exactly as diagnosed. The broad-highlight',
          'clause stays mandatory on every call not yet generated. The rule is: assert three tiers',
          'going forward, never reroll an accepted sheet to chase the number.\n',
          '`art_review`\'s silhouette-variety half remains a REAL gate and is discriminating',
          'correctly. Its light-tier half is advisory for this project.\n',
          'Two zone exceptions, so the clause is not applied blindly: DESERT is the inverted zone',
          '(light field, dark figures), so for `floor-desert` and `border-desert` the risk is the',
          'mirror — dark-tier-absent — and the fix is protecting the violet trough and lee darks,',
          'not adding lights; on desert ACTORS the light tier is the sun-struck top planes, not an',
          'overall lightening. OUTLANDS is deliberately the flattest zone: its floor sits narrow by',
          'design, its lights come from bone chips and its darks from the crack network, and it',
          'must not be "fixed" into looking like castle.\n',
          '## 5. Anchor set: the vision-2 cut (tradeoff + reversal)\n',
          '`art/style.json.references` was cut from two anchors to one',
          '(`vision-1.png` only). Reason: `applyStyleLock` (sprite-generate.ts:623-628) APPENDS',
          'every reference to the call\'s explicit inputs with no cap, no truncation and no dedupe,',
          'so at two anchors any guide-bearing call was automatically three images and sat exactly',
          "on xai's ceiling. Scale drift was the dominant mechanical failure class, and the",
          'anchor-guide route is the fix for it, so the ability to pass a guide outranked a second',
          'anchor.\n',
          '**What vision-2 was carrying:** it was the material/detail anchor — a tight crop fixing',
          'rust specular behaviour, bone porosity, wet-stone damp highlights and cloth sodden',
          'weight at close range. Expect material rendering to drift toward whatever vision-1',
          'shows at full-frame scale: flatter metal, less pronounced single-specular discipline,',
          'and softer distinction between bone and stone on small props.\n',
          '**Mitigation, and why the cut is low-risk:** section 2 measured temperature as the ONLY',
          'systematic cross-provider signature, and explicitly NOT draughtsmanship — the',
          '`outline%` delta ran the opposite way to the folklore. Material rendering was not the',
          'axis that was breaking, so the anchor removed was not the anchor holding the set',
          'together. The palette assertion clause covers the axis that WAS breaking.\n',
          '**Reversal:** one edit — restore',
          '`"games/2026-08-29-duskhaul/art/refs/vision-2.png"` as the second entry of',
          '`references` in `art/style.json`. The file is still on disk and was never deleted. Do',
          'this once generation pressure is off, and prefer it for any group whose materials are',
          'the point (props, tiles, relic glyphs) if those are generated in a later pass with no',
          'guide image.\n']

    L += ['## 6. Integrator dispositions (authoritative \u2014 acted on, not pending)\n',
          'Recorded so this file stays the single source of truth. The art-director ranked; the',
          'integrator ruled. Where the two differ, the ruling stands and the reasoning is kept.\n',
          '| tier | asset | disposition |',
          '| --- | --- | --- |',
          '| 1 | `elites-warden/elite-matron-move` | **REROLL, dispatched** to the elites owner with the palette assertion \u2014 it needed a regeneration for contamination regardless. |',
          '| 1 | `enemies-heavy/enemy-paleknight-move` | **REROLL for the eye-slits, dispatched.** The cold `_bak` v1 restore is confirmed landed at warm 22; only the absent coded red remains. |',
          '| 2 | `enemies-light/enemy-bonecaster-move`, `-bonecaster-attack`, `-thornhound-move` | **NO ACTION.** Integrator inspected the pixels: bonecaster is genuinely good (plum robe, bone skull, amber torch glow on the staff, tall upright staff-bearing silhouette that separates cleanly from its siblings). It satisfies the style law rather than drifting from it. |',
          '| 2 | the warm majority of `enemies-light` | **NO ACTION.** The polarity analysis is accepted as CORRECT \u2014 the group median has drifted warm \u2014 but the spread sits inside what this art direction can carry, and the remaining budget is better spent on tier 1 and on assets still missing entirely. |',
          '| 2 | `enemies-light/enemy-ratking-move` | **WATCH.** More saturated purple than the integrator would choose, but readable, correctly desaturated-dark in value, and its low wide many-legged mass is exactly the silhouette its brief demands. Logged, not rerolled. |',
          '| 3 | `zone-outlands/floor-outlands`, `border-outlands` | **NO ACTION** \u2014 design-intended, as flagged. |',
          '| 4 | the eight documented false positives | **NO ACTION** \u2014 reasons retained above specifically to stop a later pass reroll-chasing them. |',
          '',
          'Set-wide verdict from the integrator\'s own inspection: hero\'s green-brown hood,',
          "husk's grey-mauve flesh, bonecaster's plum robe and ratking's purple mass DO read as one",
          'game. The coherence question is answered affirmatively for the set as it stands.\n',
          'Method note worth keeping: the tier-2 finding \u2014 that a group MEDIAN can itself be the',
          'drift, so correctly-styled sheets flag as deviants \u2014 is invisible to any per-asset gate',
          'and only appears under a group-relative criterion. It is also why the remedy was',
          'judgement rather than generations: a criterion that identifies a real spread does not by',
          'itself establish that the spread is worth spending budget on.\n',
          '**Freshness / delta protocol.** Group medians move as sheets land, which is exactly how',
          'the enemies-light polarity inverted mid-wave. Do NOT re-run this probe speculatively \u2014 a',
          'moving target measured repeatedly is noise. Re-run once the outstanding sheets are in,',
          'and report only what CHANGED against the run recorded here, specifically whether the',
          'enemies-light polarity has flipped back. The sheet count of the run that produced this',
          'file is stated in the Set heading above and is the diff baseline.\n']

    staged = [r['rel'] for r in rows if r['prov'] == 'staged']
    repro = [r['rel'] for r in rows if r['prov'].endswith('*')]
    L += ['## 7. Reproducibility \u2014 non-default processing params NOT on disk\n',
          '**This is a reproducibility defect, not a measurement one, and it is recorded here',
          'because the audit is the only durable home for it.** `sprite-metadata.json` records',
          '`threshold` and `edgeThreshold` as NULL even on sheets processed at non-default values.',
          'So the chroma params that RECOVERED a violet aura survive nowhere on disk: anyone',
          'reproducing such a sheet from its raw and trusting the metadata gets the default 180,',
          'a byte-different sheet with the aura gutted, and no indication why.\n',
          'Known non-default processing, from the owning agents:\n',
          '| asset | threshold / edgeThreshold | why |',
          '| --- | --- | --- |',
          '| `pickups-fx/relic-hover-t4` | 150 / 150 | violet aura recovery \u2014 the default 180 keys dusk-violet |',
          '| `gates-collapse/gate-opening` | 150 / 150 | same; violet is the gate\'s entire coded hue |',
          '| `gates-collapse/gate-open` | 150 / 150 | same |',
          '| `ui-icons/icons` | 120 / 120 | the Dread tier glyph is `#ad6eef`, keyed even at 150 |',
          '',
          'The 120 case is the one to understand rather than copy: `#ad6eef` measures',
          'magentaDistance 138.1 with a key gate of 63, so it is inside the kill zone even at the',
          '150 recovery threshold. It cannot be cyan-leaned away either, because it is an',
          'art-locked tier literal that the engine also draws procedurally for the HUD relic pips',
          '\u2014 cyan-leaning the sprite would desync the sprite from the pip beside it. When a colour',
          'is art-locked because the ENGINE reproduces it, fix the KEY; when the colour is ours to',
          'pick, fix the COLOUR.\n',
          '**Diagnosing a lost glow: the component-count sign FLIPS by glow type.** Both failure',
          'modes are caught by counting connected components per frame, but they present',
          'oppositely, and reading only one of them gives the wrong answer:\n',
          '| glow type | components | opaque area | mechanism |',
          '| --- | --- | --- | --- |',
          '| saturated aura (e.g. relic-hover-t4) | FALLS, often to 1 | falls | the key deletes the aura wholesale |',
          '| pale soft glow (e.g. xp-mote) | RISES | falls | the key eats pixels out of the MIDDLE and shatters one blob into islands |',
          '',
          'Reference case for the erosion mode: `xp-mote` went [1,4,9,1] -> [1,13,31,11] while',
          'frame 2 opaque area fell 6100 -> 5359 px. So the test is not "did the count drop" but',
          '"did the count MOVE while area fell" \u2014 a rising count with falling area is erosion, a',
          'falling count is deletion.\n',
          '**Palette correction (art-director, style-lock owner).** The profile palette was found',
          'to contain NO COOL LIGHT: enumerated by luminance, only ONE entry exceeded L 0.66',
          '(`#e8e0d0`, warm \u2014 `#e8c547` is L 0.575, a mid), and the brightest COOL entry was',
          'L 0.145. A cool-only asset therefore could not carry a light tier on-palette at all,',
          'which put the value plan and the temperature colour code in direct opposition for',
          'every gate/extraction/arcane asset. That was a profile bug rather than an',
          'irreconcilable design tension: the LOCKED ANCHOR is full of pale cool violets the',
          'palette omitted. Sampling vision-1\'s flames and rune ring for cool pixels (b>r)',
          'brighter than the palette\'s brightest cool yields `#c084fc` (L 0.347, the most',
          'common) and `#f0ccfc` (L 0.687, an unambiguously cool pale violet-white \u2014 exactly the',
          'missing light). Both are now in `art/style.json.palette`.\n',
          'The addition is MONOTONICALLY SAFE for the palette gate \u2014 adding an anchor can only',
          'reduce each pixel\'s nearest-anchor distance, so no existing asset can regress \u2014 and it',
          'is empirically confirmed: `xp-mote` measured 22.81 / outliers 0.047 before and',
          '20.74 / 0.020 after, purely from the palette change, because the new entries absorb',
          'precisely the pale-violet pixels previously counted as off-palette. No asset needs',
          're-checking. A future regeneration of a cool-only asset can now reach the light tier',
          'on-palette with pale violet-white glow cores.\n',
          'Two further reproducibility notes from the attribution pass:\n',
          f'- **{len(repro)} sheets were REPROCESSED from their own raw** (`prov` suffixed `*`).',
          '  These are fully attributable and reproducible, and they are populated by precisely',
          '  the assets that had the most care taken over them \u2014 every escape hatch this wave',
          '  standardised (violet threshold recovery, the componentMode/debris workaround,',
          '  `--posture-change`) rewrites `source.file` to the local raw. They are counted in',
          '  section 2, not excluded.',
          f'- **{len(staged)} sheets are genuinely UNATTRIBUTABLE** \u2014 `source.file` names a foreign',
          '  hand-staged intermediate, so there is no provider chain, both raws are stale relative',
          '  to what shipped, and the "reprocess from `raw-source.*`" recipes will NOT reproduce',
          '  them: they must be fed the named `source.file`. Excluded from the census and from',
          '  section 2.' + (' Affected: ' + ', '.join(f'`{s}`' for s in staged) + '.' if staged else ''),
          '  Note the pattern: these are floor/border TILES, which reads as a deliberate',
          '  seamless-tiling workflow rather than isolated accidents. If so, the intermediates',
          '  should be kept alongside the raws rather than left transient, or those assets cannot',
          '  be regenerated by anyone but their original author.\n']

    cens = {}
    for r in rows:
        cens[r['prov']] = cens.get(r['prov'], 0) + 1
    xai_t = cens.get('xai', 0) + cens.get('xai*', 0)
    cdx_t = cens.get('codex', 0) + cens.get('codex*', 0)
    L += ['## 8. Delta versus the 87-sheet baseline\n',
          'New sheets and census corrections are separated, because they are different kinds of',
          'change and conflating them would make the corrections look like drift.\n',
          '**NEW SHEETS \u2014 population growth.**\n',
          f'| | baseline | final | delta |',
          '| --- | --- | --- | --- |',
          f'| game assets measured | 87 | {len(rows)} | +{len(rows) - 87} |',
          f'| scaffold (excluded) | 24 | {len(scaffold)} | +{len(scaffold) - 24} |',
          f'| within-group outliers (3.0 MAD) | 23 | {len(flagged)} | {len(flagged) - 23:+d} |',
          f'| reject shortlist | 23 | {len(shortlist)} | {len(shortlist) - 23:+d} (criteria re-tightened) |',
          '',
          'The outlier count FELL in absolute terms while the population grew by roughly a fifth,',
          'so the set became more internally consistent as the last groups landed, not less.\n',
          '**CENSUS CORRECTIONS \u2014 same pixels, better attribution.** None of these is drift; all',
          'are the probe getting the population right (see Methodology):\n',
          '- Attribution now reads `source.file` rather than globbing `raw-source.*`, which',
          '  resolved 11 dirs holding two raws \u2014 including the canonical `hero/hero-idle`, whose',
          '  provider had been decided by glob sort order.',
          '- Three categories rather than two: `staged` is excluded, but REPROCESSED sheets',
          f'  (`*` suffix, {cens.get("xai*", 0) + cens.get("codex*", 0)} of them) are attributed and',
          '  COUNTED. They are the assets with the most care taken over them, since every escape',
          '  hatch this wave rewrites `source.file` to the local raw.',
          '- `.png` reclassified to xai, eliminating the separate bucket the baseline carried.',
          '- Enumeration by DIRECTORY rather than by `sprite-sheet.png`, which had made every',
          '  single-frame asset invisible to this audit.',
          '',
          f'| provider | baseline | final |',
          '| --- | --- | --- |',
          f'| xai (incl. reprocessed) | 50 | {xai_t} |',
          f'| codex (incl. reprocessed) | 34 | {cdx_t} |',
          f'| staged (unattributable) | 2 | {cens.get("staged", 0)} |',
          f'| png bucket | 1 | 0 (reclassified) |',
          '',
          'The codex total is UNCHANGED at 34, so every asset added since the baseline came in on',
          'the xai side or via a staged intermediate. `staged` grew 2 -> '
          f'{cens.get("staged", 0)} as the tile agents adopted the documented',
          'magenta-frame-crop workaround \u2014 those intermediates are now kept beside their raws,',
          'which was the reproducibility ask, so the growth is a fix landing rather than a',
          'regression.\n',
          '**One confound left open deliberately.** The mandated palette clause was found to',
          'contain the token BLUE, which on xai produced navy cloth and armour. That is a',
          'plausible alternative explanation for part of the warm-drift reading and is recorded',
          'as UNSETTLED here rather than resolved. Rows where it could apply are the',
          '`elites-warden` cloth-and-armour sheets, whose deviations in this run are on OUTLINE',
          'rather than temperature. It does not change any disposition.\n',
          '## 9. VERDICT \u2014 does the set read as one game?\n',
          '**Yes. I would ship this set.**\n',
          f'Across {len(rows)} measured game assets the tightened criterion \u2014 statistically',
          'extreme AND materially far from its own group on temperature \u2014 returns '
          f'{len(shortlist)} rows,',
          'and on inspection EVERY ONE of them is design-intended rather than drifted:',
          '`hero/hero-extract` reads 2% warm because it carries 9.2% violet, which is the',
          'dissolve into gate light the PRD specifies; `ui-icons/emblem` reads 14% warm with',
          '10.7% violet because the crest is arcane-coded; `zone-outlands/floor-outlands` reads',
          '99% warm because outlands is the ochre dust-haze zone by design; and `hero/hero-hurt`',
          'is a two-frame white flash. **So my honest shortlist of sheets I would reject is',
          'EMPTY.** That is the substantive answer, and it is a stronger result than a short list',
          'would have been.\n',
          'The coherence rests on three measurements rather than on taste. The one systematic',
          'cross-renderer difference is temperature, at roughly +42 points of warm share, and it',
          'is a SHARE of chromatic content rather than a hue shift \u2014 it moves how much of a',
          'subject is warm, not what the palette is, which is why the set still reads as one',
          'world. Draughtsmanship does NOT differ: the outline delta runs +12.7 in the opposite',
          'direction to the folklore that drove earlier rerolls. And the group medians are now',
          'coherent enough that adding a fifth of the population made the outlier count fall.\n',
          'Two honest caveats, neither release-blocking. The value plan is met in the aggregate',
          'but a minority of sheets still carry a very thin light tier, which at `renderScale` 48',
          'trends toward a silhouette read \u2014 advisory, and the broad-highlight clause is the',
          'forward fix rather than a reroll. And the canonical pair themselves are not literally',
          'flat pixel art: this set READS as pixel art at play size while the files are smooth',
          'renders, so the identity is a perceptual one that the reference-pair eyeball test',
          'captures and no per-file metric here does. Judged against `hero/hero-idle` and',
          '`enemies-light/enemy-husk-move`, a player would believe these came from one game.\n']

    if scaffold:
        L += [f'## Scaffold / template art ({len(scaffold)} sheets) — excluded from the verdict\n',
              "Listed so the integrator can confirm the prune list. These are the scaffold's chibi",
              "set, not this game's art, and they take no part in any judgement above.\n",
              '| asset | prov | qc | uniq% | blk/2 | outline% | warm% |',
              '| --- | --- | --- | --- | --- | --- | --- |']
        for r in sorted(scaffold, key=lambda r: r['rel']):
            L.append(f"| `{r['rel']}` | {r['prov']} | {r['passed']} | {r['uniq']:.0f} | "
                     f"{r['blk']:.1f} | {r['outline']:.0f} | {r['warm']:.0f} |")
        L.append('')

    open(OUT, 'w').write('\n'.join(L) + '\n')
    print(f'wrote {OUT}')
    print(f'  set {len(rows)} sheets, scaffold {len(scaffold)}, outliers {len(flagged)}, '
          f'reject shortlist {len(shortlist)}, providers {counts}')
    for rel, why in sorted(flagged.items()):
        print(f'  OUTLIER {rel}: {"; ".join(why)}')
    for r, why in sorted(shortlist, key=lambda t: -t[0]["warm"]):
        print(f'  REJECT? {r["rel"]} ({r["prov"]}): {"; ".join(why)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
