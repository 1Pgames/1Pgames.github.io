# QA2 — verification round 2 (after fix rounds 3-4, balance round 3)

Build: `npx vite build --outDir /tmp/aurelia-qa2-dist` → `vite preview --port 5433 --strictPort` (named service, stopped at the end). Headless Chromium (playwright-core, `--mute-audio`), viewport 540×960 (canvas 720×1280; every coordinate below is in game px). Every load used `?mute=1&debug`, and every load asserted `__AUDIO__().forcedByUrl === true && played === 0`. Each session was a fresh browser context, so every save was wiped, and only `2026-09-26-outpost-aurelia:*` keys were ever written. State was read from the live `Game` scene: `model`, `director`, `build`, `widgets` (hud / alerts / tray / dock), `camera`. `camera.flyTo` and `fx.edgePing` were wrapped with counters. Screenshots are in `shots/qa2/`. Driver scripts were throwaway and have been deleted. Timebox: 30 min, overrun by about 3 min. Anything not reached is listed under coverage debt, not as a pass.

## Regression sweep: `review/qa.md`

| # | Old sev | Verdict | Evidence |
|---|---|---|---|
| 1 | MAJOR | NOT RE-VERIFIED | The vent beat needs Landing 2 with the vent on screen. I did not reach it. |
| 2 | MAJOR | NOT RE-VERIFIED | No extractor ruin was produced in this pass (night 1 lost 1 building, n 7→6, but that was not an extractor on a deposit). |
| 3 | MINOR | NOT RE-VERIFIED | — |
| 4 | MINOR | NOT RE-VERIFIED | — |
| 5 | MINOR | **FIXED** | The dawn draft title "DAWN · SOL 2 — CHOOSE A DIRECTIVE" now sits on an opaque plate over the banner, so nothing overlaps (`19-draft.png`). |
| 6 | MINOR | NOT RE-VERIFIED | — |
| 7 | MINOR | **FIXED** | Ferrite Drill armed from slot 1 by day → `skipTime()` to dusk → the dock becomes `[pulse_turret, relay_pylon, ferrite_drill, hydro_terrace]`. The armed highlight moves with the drill to slot 3, and the tray reads "Ferrite Drill · 12 Fe". Highlight and armed building agree (`10-dusk-coach-dock.png`). |
| 8 | MINOR (dev) | **FIXED** | `unlockAll()` → "skipped to sol 6 day; every building unlocked; auto-picked 4 draft card(s) …; the sol 6 draft is open". When a coach overlay held the clock it reported "(stopped early: clock held by an overlay)", which is honest. |
| 9 | MINOR (dev) | **FIXED** | `grant(400)` → "+400 of every good (clamped to storage caps)". Every stock ended at 200 on a 200 cap, and the invariant scan found 0 violations. |
| 10 | MINOR | **STILL (variant)** | The ledger was not reopened. The same mixed-minus problem is live in the HUD, though: the banner shows `Tonight -20 °C` / `-26 °C` with an ASCII hyphen, while the tray shows `night −4.8` with U+2212 (`hud.ts:211`: `Math.round(tonight)` is interpolated with no `−` replace). |

## Regression sweep: `review/flow-audit.md`

| # | Old sev | Verdict | Evidence |
|---|---|---|---|
| F1 | Major | **FIXED** | Wiped save, ore placed, `dock` hint live → one tap on ALL (620,1011) opens the build sheet (MINE/POWER/GRID tabs present) (`05-all-tap1.png`). The hint re-queues after ESC, which is harmless. |
| F2 | Major | **FIXED** | Sol-2 dawn draft: **one** tap on the card centre (140,600) picks it (`owned: ["hearth_insulate"]`, draft closed). |
| F3 | Minor | NOT RE-VERIFIED | — |
| F4 | Minor | NOT RE-VERIFIED | — |
| F5 | Minor | NOT RE-VERIFIED | Hub LAND texts: "◆ 30 Data · ★ 0" at y 772 and "Daily streak —" at y 808. The panel bounds were not checked. |
| F6 | Cosmetic | **FIXED** (in the instances seen) | Synergy lines read "4 Hab Domes → Warren Dome (1/4)", "6 Pulse Turrets → Pulse Lattice (2/6)" and "4 Aurel Harvesters → Geode Rig (0/4)". No doubled plural. |
| F7 | Cosmetic | NOT RE-VERIFIED | The world label "OUTSIDE / THE GRID" is still emitted at many screen positions, including y 970 (the dock band) and off-canvas. Whether it draws above the HUD was not checked by eye. |

## New surfaces

| Surface | Verdict | Measured / evidence |
|---|---|---|
| Dock slots across day → dusk → day | PASS | Sol 1 day (rations falling): `[hydro_terrace, relay_pylon, rime_borer, ferrite_drill]`. Dusk: `[pulse_turret, relay_pylon, ferrite_drill, hydro_terrace]`. Sol 2 day (rations rising): `[ferrite_drill, relay_pylon, pulse_turret, hydro_terrace]`. The Relay stays pinned in slot 2 throughout. MRU slots 3-4 follow the arms. Re-tapping an armed slot disarms it. |
| Dusk beat → turret from slot 1 | PASS | After the TAP-TO-CONTINUE step, slot 1 arms `pulse_turret` (20 Fe · 5 Alloy). 2 placements. The RESUME button releases the clock (`dpaused: false`). Framing flyTo z 0.55 ran instantly (first dusk) (`14-dusk-turret.png`). |
| Core N% in banner | PASS | Core hp set to 40 % → banner shows "Core 40% ·". Night 1 natural hit → "Core 99% ·" together with the "Core hit" pill (`20-core40.png`). |
| "−N crew" flash | PASS | Colonists 6 → 4 → the banner flashes "−2 crew" and line 2 reads "4/10 crew" (`21-minus-crew.png`). |
| GOAL line live numbers | PASS | "◈ GOAL sol 6 · Alloy 30/100 · Prism 0/20 · Cells 0/12" drops to "Alloy 20/100" after the turret spent 10 Alloy. At sol 6 it becomes "◈ SPIRE · Alloy 100/100 · Prism 20/20 · Cells 200/12". |
| GOAL sheet | PASS | A tap on the GOAL line opens "GOAL · CALL THE ARK" with 4 steps (Survive to sol 6 / Build the Beacon Spire · 100 Alloy · 20 Prism / Stock 12 Lumen Cells / Tap BEACON · 10 kW for 60 s). ESC closes it (`22-goal-sheet.png`). |
| PIN LIT during brownout | PASS | Sol 6 night, `kwNightForecast` −4.8. The relay card reads "Sheds first in a brownout" and the status line "SHED in a brownout — add power or a Charge Bank". PIN LIT → `pinned: true`, "Pinned: never shed · Working", and the button reads UNPIN (`26-pin-lit.png`). |
| UPGRADE ALL | PASS (no-confirm branch) | 2 Pulse Turrets → "UPGRADE ALL · 2" → both go to mk 2 at once with no dialog. The total was 48 Fe · 12 Alloy, which is under the confirm threshold (confirm is for >100 only, per §14b). The confirm branch is coverage debt. |
| Building card reason lines | PARTIAL | Seen: "Working · crew 1/1", "Powers, heats and stores the colony", "SHED in a brownout — …", "N beds · a/b colonists". Not reached: reserve, no colonists, no beds, "DARK — outside the grid". My probes for those were invalidated (a coach overlay blocked the placement; a colonists=0 mutation ended the Landing). |
| Night camera re-framing | PASS (partial) | Nightfall fires `flyTo` (z 1, 320 ms). Whether any fight is hidden under the HUD was not measured: the model has no per-fauna position list (`faunaNearField` only). |
| Camera freeze while armed | PASS | At night with `ferrite_drill` armed, 10 s of sim (5 × `skipTime(2)`): **0** `flyTo` calls and the camera stayed at `{z:1,x:-2004,y:-2570}`. After disarm, no catch-up snap within 1.5 s. |
| Off-screen loss pings | PARTIAL | One `edgePing` fired on the night-1 building loss (screen 300,758). No loss happened outside the read band, so the directional off-screen case was not isolated. |
| DAILY launch | PASS | Hub LAND → DAILY (530,788) → `Game` in 1 tap, site `halcyon` (`35-daily.png`). |
| Rations / power / ORBIT nudges | NOT REACHED | Rations stock set to 2 while the rate stayed positive, so the nudge correctly did not show. No negative-rate state was produced. The power nudge was not observed by day. The ORBIT badge was not reached. |
| Deny line tap-to-look | NOT REACHED | With stock low, the strip shows "Need 12 Fe" / "Need 32 Fe" first. With stock granted, every tried building had ≥1 valid tile. |
| Dawn mend toast | NOT REACHED | No building was damaged at a dawn, so there was nothing to mend. |
| SKIP TO DAWN | NOT REACHED | At sol 1 and sol 6 nights the tray action showed OVERDRIVE or nothing. The SKIP control never appeared while fauna were alive. |
| Spire footprint nudge | NOT REACHED | The sol-6 draft was open while the Spire was armed, so the test was invalid. |
| Hub ARK buy + UNDO refund | NOT REACHED | The fresh-context session had 30 Data and was in `Game` when `grantCurrency` ran. |

## New findings

| # | Severity | Screen / state | Repro | Expected vs actual | Shot | Owning area |
|---|---|---|---|---|---|---|
| N1 | MINOR | Dawn draft | Reach the sol-2 dawn draft | **Expected:** the REROLL button clears the tray and the dock. **Actual:** the REROLL · 1 plate (centre y ≈ 972) sits over the ContextStrip and the top of dock slots 2-4, cutting their icons. | `19-draft.png` | ui (`ui/colony/draftOverlay.ts`) |
| N2 | MINOR | HUD banner line 2 | Any Landing | **Expected:** the minus sign matches the rest of the HUD. **Actual:** "Tonight -20 °C" uses a hyphen-minus; the tray's "night −4.8" uses U+2212. This is the same class as QA#10. | `01-wiped-boot.png` | ui (`ui/colony/hud.ts:211`) |

No BLOCKER or MAJOR finding was observed in the surfaces exercised.

## Runtime invariants and audio

- Page exceptions and `console.error`: **0** across all 6 game sessions. One driver crash came from my own invalid `arm('ember_vent_tap')` id, and the game threw its own "no building row" guard; that is not a game defect.
- Invariant scan after every section (stock ≤ cap, core alive or Landing ended): **0 violations**.
- Audio on every load: `forcedByUrl: true`, `played: 0`, `storedPreference: false` (never written), and `contextState` / `masterGain` both `null` (the correct muted marks). `requested` per session: 51, 80, 151, 16 (all > 0). `lastRequested` values seen: `ui`, `drone`, `die`, `draft`.

## Probe table

| Probe | Measured | Budget | Verdict |
|---|---|---|---|
| ALL → sheet with `dock` hint live | 1 tap | 1 tap | PASS |
| Draft pick | 1 tap | 1 tap | PASS |
| Returning boot → first placement | [INFERENCE] 4 (LAUNCH → pick → slot → tile; each step measured individually) | 4 | PASS |
| Auto-camera moves while armed | 0 in 10 s | 0 | PASS |
| `played` while muted | 0 | 0 | PASS |
| `requested` after gameplay | 16–151 | > 0 | PASS |
| Stored mute preference | untouched (`false`) | untouched | PASS |
| Console / page errors | 0 | 0 | PASS |

## Coverage debt (carried to the next pass)

- QA #1, #2, #3, #4, #6 and flow F3, F4, F5, F7 were not re-verified.
- Not reached (see the table above): rations, power and ORBIT nudges; deny-line tap-to-look; dawn mend toast; SKIP TO DAWN; Spire footprint nudge; UPGRADE ALL confirm (>100); card reason lines for reserve, no colonists, no beds and dark; ARK buy + UNDO refund; fight-under-HUD measurement; directional off-screen loss ping.
- Not run: the unmuted audio pass and the win path to LAUNCHED.
