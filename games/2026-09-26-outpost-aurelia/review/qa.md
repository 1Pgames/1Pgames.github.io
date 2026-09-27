# QA — golden-path E2E sweep (wiped save)

Build: `npx vite build --outDir /tmp/aurelia-qa` → `vite preview --port 5401`, headless Chrome at 720×1280 with DPR 1, driven over raw CDP (mouse input at game px; the scene model was read for state, and every control was hit at the centre of its real hit area). Every URL used `?mute=1`. The recovery reload and the dev-hook runs used `?mute=1&debug`. Wiped save = only keys prefixed `2026-09-26-outpost-aurelia:` removed, from a same-origin non-game page, before loading. Screenshots are in `shots/qa/`. The session ran past the 30-min timebox. The win path was not reached (see Coverage debt).

## Findings

| # | Severity | Screen / state | Repro | Expected vs actual | Screenshot | Owning area |
|---|---|---|---|---|---|---|
| 1 | **MAJOR** | Landing, `vent` coach hint (any Landing where `tut:vent` is unset and an Ember Vent is on screen) | Wiped save → finish ore/dock/dusk → pan until the vent is in the playfield (Landing 2: vent 5 tiles from the core) → tap the dock `ALL`, or tap anywhere on the map | **Expected:** "TAP TO CONTINUE" dismisses the hint, or the tap reaches the control under it. **Actual:** the full-screen tap catcher (depth 2600) swallows the tap and calls `finish()`. The beat is still queued and the vent is still visible, so `poll()` shows it again on the next tick. Measured: `current.since` reset on each of 4 taps (500 ms apart), and each time `coachId` stayed `vent` and the sheet stayed shut. Dock, sheet and every tap in the playfield are dead while the vent is on screen. The clock keeps running, so night 2 arrived while I was locked out (shot 23). The only way out I found is to tap the vent deposit in the ~TAP_ARM_MS window before the catcher arms. That opens the BUILD chip. | `22-vent-beat.png`, `23-all-tap-swallowed-by-vent-hint.png`, `23-after-all-taps.png`, `49-landing2-vent-beat.png`, `50-vent-after-dock-tap.png` | ui (`ui/colony/coachBeats.ts` poll/show + `ui/coach.ts` tap catcher) |
| 2 | **MAJOR** | Landing, ruin of a destroyed extractor | Let night 2 destroy the Rime Borer (it happened naturally on sol 2) → tap its ruin | **Expected (§14b):** the ruin toast with REBUILD at the discounted `rebuildCostRatio` price. **Actual:** an extractor ruin always sits on its deposit. `onMapTap` checks "open deposit patch" before ruins, and `occ` is 0 on a ruin, so the tap opens the full-price `BUILD Rime Borer · 12 Fe` chip. REBUILD cannot be reached for any extractor ruin. `model.ruins` still holds `{def:'rime_borer',col:40,row:47}`. | `25-ruin-rebuild-toast.png`, `26-ruin-tap2.png` | ui/view (`slices/colony/game.ts` `onMapTap` priority) |
| 3 | MINOR | Pause → SETTINGS during a Landing | Pause → SETTINGS → toggle "Reduce motion" | **Expected:** the setting applies to the live Landing. **Actual:** `savePlayerSettings` flips (`reduceMotion: true`) but `WorldFx.calm` stays `false`. `game.ts:247` reads it only in `create()`, so the change waits until the next Landing. | `15-settings-reduce-on.png` | view (`slices/colony/game.ts`) |
| 4 | MINOR | Settings sheet (in-Landing and Hub gear); Hub tab bar | Open Settings | **Expected:** nothing interactive in the bottom 220 px except the full-width dock. **Actual:** Settings rows `Sound` (y 1094) and `Reduce motion` (y 1194), plus `RESET SAVE` (y 1190) in the Hub gear sheet, sit inside y > 1060. Hub tabs LAND/ARK/LOG have 160-px hit zones at y 964–1124. The tab bar was already reported by the integrator. | `14-settings.png`, `39-hub-gear.png`, `38-hub-land.png` | ui (`ui/sheet.ts` settings layout, `ui/tabBar.ts`) |
| 5 | MINOR | Dawn draft (sol 2+) | Reach any dawn draft | The title "DAWN · SOL 2 — CHOOSE A DIRECTIVE" (y ≈ 290) is drawn over the dimmed HUD sol strip ("SOL 2 · DAY 0:26"), so the two lines of text overlap and the title reads worse. | `18-draft-sol2-coach.png` | ui (`ui/colony/draftOverlay.ts`) |
| 6 | MINOR | Hub LAND site map | Open the Hub | Site labels at the top of the map are cut off by the DATA-pill band ("Frostcrown · 9★" is half hidden at y 124). "Rimewater · 4★" floats with its node off-view. | `38-hub-land.png` | ui (`scenes/hub/landTab.ts`) |
| 7 | MINOR | Dock after dusk re-slot | Wiped save → at the first dusk, with a Ferrite Drill armed from dock slot 0 | Slot 0 changes to the Pulse Turret, but the armed highlight stays on slot 0 and the tray still says "Ferrite Drill · 12 Fe". The highlighted slot and the armed building disagree. Seen once (shot 05-dock-slot1). I did not minimize it. | `05-dock-slot1.png` | ui (`ui/colony/dock.ts`) |
| 8 | MINOR (dev) | `?debug` `__DEV__.unlockAll()` | Fresh Landing → `__DEV__.unlockAll()` | It returns "skipped to sol 2 (every building unlocked)", but `director.skip` stops at the sol-2 draft, so the Spire is still locked. It took 5 calls (with a draft pick between each) to reach sol 6. The message is false. | — | sim/dev (`slices/colony/game.ts` registerDev) |
| 9 | MINOR (dev) | `?debug` `__DEV__.grant(n)` | `__DEV__.grant(200)` with 60 Fe on a 200 cap | Stock goes past its cap (`stock ferrite 215.6 > cap 200`), so the stock invariant fails. The next production tick clamps it. | — | dev (`slices/colony/game.ts`) |
| 10 | MINOR | Ledger sheet | Open the ledger (tap the stock bar) | The minus sign is inconsistent: `−0.3/s` (U+2212) sits next to `-18/min` (hyphen). | `35-ledger-sheet.png` | ui (`ui/colony/ledgerSheet.ts`) |

Not filed, because it is unverified: after I built the Vent Tap from the deposit BUILD chip in Landing 2, `tut:vent` was still `"false"` right before the reload, even though the beat had gone. I could not confirm that the placement landed before the reload. Recheck this: whether a placement from the chip emits `placed` with `vent_tap`.

## Golden path — what was walked (all 0 page errors, 0 console errors)

| Step | Result |
|---|---|
| Wiped save → first boot | Landing 1 at 0 taps; Game was live 556 ms after navigation (`01`) |
| FTUE ore (2 steps: deposit → BUILD chip) | Works; buildings 2 → 3; `tut:ore` is `false` on show and `true` on completion (`01–03`) |
| dock hint | Shown after ore and dismissed by a tap. The flag is written on completion (2nd placement) (`04`) |
| dusk beat | Clock held (`userPaused`), real arrow + ×6, panel "Place a turret from slot 1, then RESUME". Turret placed, RESUME → `tut:dusk=true`, build disarmed (`05-slot1`, `06`, `07`) |
| draft beat + REROLL + pick | Coach shown; REROLL 1 → new 3 cards, then "REROLL · 0 left" is disabled; pick → `owned:[orb_pods]` (`18–20`) |
| grid beat (sol 4 dawn) | Shown and dismissed by a tap (`36b`) |
| vent beat | **Finding 1** |
| Build chains | Drill, borer, turret, vent, sail, terrace, bank, smelter, relay, spire all armed from the dock or sheet and placed on legal tiles. Harvester/cutter unlock at sol 3; I reached them via the sheet tabs but did not place them separately. |
| Night 1–2 | Ran at 60 fps. Borer lost on night 2 (ruin → finding 2). A brownout was not induced on this save (night was +2.6 to +3.9 kW). **SKIP TO DAWN** was shown in the tray at night (`13`) but not pressed. **PIN LIT** was not reached (no relay card opened). Both are coverage debt. |
| Building card | RANGE toggles `rangeUid` 4→0→4; UPGRADE mk1→2 (24 Fe 6 Alloy); PAUSE ↔ RESUME flips `paused`; DEMOLISH → 3-s UNDO toast → restored at mk2, 0 invariant violations (`27–32`). UPGRADE ALL is hidden with only one turret, so it was not exercised. |
| Orders sheet SHIP | 2 SHIP rows; shipping cost 20 Aurelite and paid out +Fe (capped) and +10 alloy (Supply Pods) (`33–34`) |
| Ledger | Per-good stock/cap/rate; "FULL · wasting 48/min" shows (`35`) |
| Pause / settings / abandon | II → PAUSED; SETTINGS sheet; the music slider wrote 0.51 → 1.0; a tap on RESUME behind the ABANDON confirm is blocked; ABANDON → results in 1996 ms incl. fade (`13–14`, `36`, `36c`, `37`) |
| Results (abandoned) | Sols 3/10, Data +64, RETRY/HUB; `activeLanding` = `null` after banking (`37`) |
| Hub LAND | Site/rung/kit chips; locked R2 → toast "Win rung 1 on Halcyon Flats first"; Warden chip → LAUNCH label "· Warden"; gear opens Settings (`38–41`) |
| ARK buy + UNDO | Bunk Racks: Data 64 → 14, UNDO → 64; re-buy → OWNED, `unlocks:[hab_bunks]` (`42–45`) |
| Paid effect in run | After the Bunk Racks buy, the next Landing starts with beds = 7 and colonists = 7 (the earlier Landing had 6) |
| LOG | Records render (`46`) |
| LAUNCH | 283 ms to Landing 2, landing-pick draft first (`47`) |
| Reload mid-Landing (`?mute=1&debug`) | Boots to GameOver ABANDONED "Signal lost — settled at sol 1"; Data banked (14 → 52); `activeLanding` cleared (`51`) |
| RETRY | 281–360 ms to Game and 669 ms to playable after the fade (budget ≤ 2 s) ✓ (`52`) |
| Loss | Core lost during the Chorus at sol 6 → "CORE LOST" results (`57–59`). `__DEV__.spawnBoss()` → "Hive Matron spawned", fauna 13 → 14 |
| Win (Spire → BEACON → LAUNCHED) | Spire placed, BEACON → CANCEL/CHARGE confirm → `charging` (`53–55`). **LAUNCHED was not reached.** Even with every building's HP reset each 100 ms sim tick, the core fell at sol 8 with the charge at 81 %. Charge went 76 % → 81 % over sols 6–8. Balance round territory; see coverage debt. |

## Runtime invariants and audio

- Page exceptions and `console.error` were captured across the whole session: **0**.
- Invariant scan (occupancy ↔ buildings, stock ≤ cap, core alive, every building uid covered by a MapView Map, no orphan view): 0 violations after each settled action. The only exception was my own over-cap stock injection and the `grant` hook (finding 9).
- One overlay owner: abandon confirm (d3050) over pause (d2100); taps outside are refused. Pause blocks ESC stacking. No stuck overlay after draft, sheet, card, toast or confirm closed.
- Audio (every load): `forcedByUrl: true`, `played: 0`, `storedPreference: false` unchanged (no mute key ever written), `contextState/masterGain: null` (the correct muted marks). `requested` went 1 → 932 over the session; `lastRequested` seen: `ui`, `loss`. sfx requests/s at the charge peak were 16–27/s with 26–56 fauna.

## Probe table

| Probe | Measured | Budget | Verdict |
|---|---|---|---|
| Boot → Landing 1 playable, wiped save | 556 ms, 0 taps | 0 taps (§14b) | PASS |
| RETRY → playable | 669 ms | ≤ 2 s | PASS |
| LAUNCH → Game | 283 ms | ≤ 400 ms transition | PASS |
| ABANDON confirm → results | 1996 ms (fade + ceremony) | — | note |
| FPS, night 1 / sol-6 dusk-night, 26–100 live fauna | 60–61 fps (`loop.frame` delta) | ≥ 55 at peak | PASS (the 180-fauna Chorus peak was not reached) |
| sfx requests/s in combat | 16–27/s | ≥ 5/s | PASS |
| `played` while muted | 0 | 0 | PASS |
| Stored mute preference | untouched | untouched | PASS |
| Tap targets (HUD, dock, card, sheet, draft, hub) | all ≥ 88 px tall (dock slots 120×92, sheet tabs 88×88) | ≥ 88 px | PASS |
| Host shell top-left 315×75 | the HUD starts at y 150; Hub DATA pill at x 340–576, y 50–115 | clear | PASS |
| Interactive in bottom 220 px | Settings rows, RESET SAVE, Hub tabs | only the dock | FAIL (finding 4) |
| Masked sheet rows below the fold | a tap at a hidden row (y 1230) did not arm anything | no hidden hits | PASS |

## Coverage debt (not exercised; not passing)

- The **win path to LAUNCHED** was not reached (finding-level evidence above). The balance round owns this.
- **Brownout**, **PIN LIT** (relay card) and pressing **SKIP TO DAWN** were not exercised.
- **UPGRADE ALL** was not exercised (it needs 2 of one kind).
- **Aurel Harvester** and **Prism Cutter** were not placed separately.
- **DAILY** / practice banking was not tapped.
- The input-ack ms probe (rAF / screenshot pair) was not run; acks were only observed as state deltas under 250 ms.
- The unmuted audio pass and the music-gain-on-live-track check were not done.
