# Flow audit — Outpost Aurelia (PRD §14b / §3)

2026-09-27 · ux-flow-designer (FlowAudit) · 20-minute timebox (hard). This file lists what was covered and what was not.

**Rig:** `npx vite build --outDir /tmp/aurelia-flowaudit` → `vite preview --port 5403 --strictPort`. Headless Chromium via playwright-core, viewport 540×960 (canvas 720×1280, scale 0.75). Every load used `?mute=1&debug`. After every load the driver asserted `__AUDIO__().forcedByUrl === true && played === 0`, and it threw otherwise. That assertion passed on every load (`contextState: null`, `requested: 0`). Wiped runs cleared only `2026-09-26-outpost-aurelia:*` keys. Hide was simulated by overriding `document.hidden`/`visibilityState` and dispatching `visibilitychange`; blur by dispatching a `window` `blur`. No page errors were logged in any session. Driver scripts were throwaway (`/tmp/fa/a*.mjs`). Screenshots are in `shots/flow/`.

## Deviations (routing)

| # | Sev | Where | Expected (PRD) | Observed (live) | Route | Shot |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Major | First Landing: `dock` hint live → tap ALL | §14b law 3: non-pausing hints are not owners. ALL → BuildSheet in 1 tap (§3: undocked = 3 taps) | The first ALL tap is swallowed: it dismisses the `dock` hint (`coach.current` goes from `dock` to `null`) and opens nothing. The second tap opens the sheet. Measured twice (a7, a9). The hint panel is also not visible in the screenshot while it swallows the tap: the text objects exist but nothing is on screen, so the player gets no cue | ui-engineer (`ui/colony/coachBeats.ts`: a non-pausing beat must not consume input aimed at the dock) | `50-all-tap1.png`, `52-all-tap3.png` |
| F2 | Major | Landing pick (Draft at t=0, Landing 2+) | "Draft pick 1" (tap-depth table) | The first tap on a card centre (x=140) does not pick, even 2.5 s after LAUNCH. The second identical tap picks. Measured in a5, a8 and a9. Returning boot → first placed building is therefore **5 taps, not 4**. Cause is `[INFERENCE]` (the `enterPinningHitArea` entrance or the scrim claiming the first pointer) | ui-engineer (`ui/colony/draftOverlay.ts`) | `55-draft-tap1.png` |
| F3 | Minor | BuildMode armed, stock drops below cost | §14b edge "armed building becomes unaffordable mid-mode: auto-disarm + strip shows the missing good" | Rime Borer (12 Fe) armed, every stock set to 0: it is still armed 600 ms later, with the strip reading "tap tiles · 1 valid" | gameplay/ui-engineer (`view/buildMode.ts` / tray sync) | — (log a6) |
| F4 | Minor | Hub LAND locked kit / rung toast | "LAUNCH is never dead" | The toast (with GO for kits) sits over the LAUNCH button for as long as it is up (~1.5 s), hiding it | ui-engineer (`scenes/hub/landTab.ts` toast anchor) | `24-locked-rung.png`, `25-locked-kit.png` |
| F5 | Minor | Hub LAND layout | §14 bands | The kit row overlaps the site panel's bottom border, and the "◆ 30 Data · ★ 0 / Daily streak" plate sits half outside the panel | ui-engineer | `16-hub-after-abandoned.png` |
| F6 | Cosmetic | Draft card synergy line | copy | "2 Hearth Commonss → Infirmary": the plural is doubled | ui-engineer (`protoPieceName` plural) | `55-draft-tap1.png` |
| F7 | Cosmetic | Game HUD | map text stays under the status band | The world label "OUTSIDE / THE GRID" shows through the gaps between ResourceStrip chips at y≈200 on the first frame | fx/ui-engineer (map label depth vs. HUD) | `01-first-boot.png` |

## Node / edge walk

| Node / edge | Expected (PRD) | Observed | Verdict | Shot |
| --- | --- | --- | --- | --- |
| Boot → Preload → HubEntry (first boot) → Game | auto-start Halcyon R1, 0 taps, `ore` hint on the nearest deposit | `scenes: ["Game"]` straight after load; "Tap the glowing ore to drill it." with a pointer on the deposit | PASS | `01-first-boot.png` |
| Game → DepositChip → place | 2 taps: deposit → BUILD chip | Tap 1 shows "BUILD Ferrite Drill · 12 Fe" in the tray. Tap 2 raises the building count from 2 to 3 | PASS (**2 taps**) | `02-first-deposit-chip.png`, `03-first-placed-2taps.png` |
| HubEntry (checkpoint) → GameOver | reload mid-Landing → ABANDONED + "Signal lost — settled at sol N"; banked once; checkpoint cleared | After reload: `["GameOver"]`, "ABANDONED", "Signal lost — settled at sol 0", +30 Data. Meta `currency 30, runs 1`, one log row, `colony:activeLanding = null` | PASS | `15-reload-abandoned.png` |
| GameOver → Hub (ESC) | ESC = HUB | → `["Hub"]`, LAND tab selected, Data 30 | PASS | `16-hub-after-abandoned.png` |
| Returning boot → HubLand | LAND tab selected by default | Plain reload → `["Hub"]`, LAND | PASS | — |
| HubLand ↔ HubArk ↔ HubLog | 1 tap each; ESC on ARK/LOG → LAND | Tab taps switch tabs. ESC from ARK → LAND | PASS | `20-hub-ark-0data.png`, `21-hub-log.png` |
| Hub gear → HubSettings | opens; close / scrim / ESC | Settings sheet opens (Music, SFX, Sound, Reduce motion, RESET SAVE). ESC was sent; that the sheet closed was not confirmed with a screenshot | PASS (open) / UNVERIFIED (close) | `22-hub-settings.png` |
| HubLand locked site | toast "Needs N ★"; selection unchanged | Tap on Prism Reach: selection stays on Halcyon (the toast was not captured in text) | PARTIAL | `23-locked-site.png` |
| HubLand locked rung | toast "Win rung r−1" | "Win rung 1 on Halcyon Flats first" | PASS (copy differs, meaning same) | `24-locked-rung.png` |
| HubLand locked kit | toast "Unlock on ARK" + GO | "Tinker Crate: unlock on the ARK" + GO | PASS (GO not tapped) | `25-locked-kit.png` |
| HubLand → LAUNCH → Game → Draft (landing pick) | 1 tap; Draft at t=0 on Landing 2+ | "DAWN · SOL 1 — CHOOSE A DIRECTIVE", 3 cards, REROLL · 1 | PASS | `26-launch-landing-pick.png` |
| Draft → Game (pick) | 1 tap | 2 taps (F2) | FAIL | `55-draft-tap1.png` |
| Game → BuildMode (dock slot) | armed, strip "tap tiles · N valid", DONE | armed `ferrite_drill`; "Ferrite Drill · 12 Fe / tap tiles · 1 valid / DONE" | PASS | `07-buildmode.png` |
| BuildMode → Game (ESC) | disarm | ESC with armed → `armed:null` | PASS | log a4 |
| BuildMode → Game (re-tap slot) | disarm | First re-tap was eaten by the live `dock` hint (same cause as F1). The next re-tap disarmed | PASS after F1 | log a4 |
| Game → BuildSheet (ALL) | 1 tap | 2 taps on the first Landing (F1). Sheet shows ALL/MINE/POWER/MAKE/GRID/HOME/DEF filters and locked cards dimmed with "Sol N" | FAIL (F1) / edge PASS | `52-all-tap3.png` |
| Game → Ledger (ResourceStrip) → ESC | 2 taps round trip | LEDGER rows per good + Power; ESC closes | PASS | `36-ledger.png` |
| Game → ORBIT at sol 1 | dimmed "Sol 3", no-op | "Sol 3" label; the tap changes nothing | PASS | `11-orbit-sol1.png` |
| Game → BuildingCard (tap building) | card with UPGRADE / PAUSE / DEMOLISH | "Ferrite Drill · Mk I · Crew 1/1 · UPGRADE 14 Fe · PAUSE · DEMOLISH" | PASS | `42-drill-card.png` |
| Card → DEMOLISH → UNDO toast → UNDO | never confirms; 3 s UNDO restores | Demolish: n goes 3 → 2 and the toast "Ferrite Drill demolished · UNDO" appears. UNDO: n back to 3 (1 tap) | PASS | `43-demolish-toast.png` |
| Game → Pause (II / Space / ESC with nothing open) | opens Pause | All three open "PAUSED · RESUME · SETTINGS · ABANDON LANDING". ESC and Space resume | PASS | `06-pause.png` |
| Pause → Settings → ESC | back to Pause | `pmChild` goes true, then false with Pause still open | PASS | `13-pause-settings.png` |
| Pause → AbandonConfirm → ESC | ESC = CANCEL → Pause | "ABANDON THIS LANDING? · CANCEL · ABANDON". ESC → Pause | PASS | `14-abandon-confirm.png` |
| AbandonConfirm → CONFIRM → Ceremony | law 5 order: bank, then clear checkpoint, then ceremony | 200 ms after CONFIRM: `ended:true`, meta `currency 30`, log row written, `activeLanding = null`, all while the ceremony is still on screen | PASS | `44-abandon-ceremony.png` |
| Ceremony → reload | already banked → next boot = Hub, no double payout | Reload → `["Hub"]`; currency still 30; log has 1 row | PASS | `45-reload-mid-ceremony.png` |
| HubArk → buy → UNDO toast | never confirms; toast; ESC closes toast, purchase stands | Bunk Racks → OWNED, 300 → 280 Data, toast "Bunk Racks — … · UNDO". ESC → LAND with the purchase standing. The UNDO button itself was **not** tapped (the driver hit the header copy "UNDO on the toast" instead) | PASS / UNVERIFIED (refund) | `47-ark-undo.png` |

## Tap-depth (measured)

| Path | PRD | Measured | Verdict |
| --- | --- | --- | --- |
| First-ever boot → first placed building | 2 | **2** (deposit → BUILD chip) | PASS |
| Returning boot → Landing running | 1 | 1 (LAUNCH) | PASS |
| Returning boot → first placed building | 4 | **5** (LAUNCH → pick ×2 → slot → tile) | FAIL (F2) |
| Place docked building | 2 | 2 (slot → tile; the slot arms, and 1 valid tile was reported) | PASS (arm measured; tile placement via Enter hit an invalid centre tile) |
| Undocked building, first Landing | 3 | 4 (ALL ×2 → card → tile) | FAIL (F1) |
| Undo demolish | 1 | 1 | PASS |
| Abandon | 3 | 3 (II → ABANDON LANDING → ABANDON) | PASS |
| Pause / resume | 1 / 1 | 1 / 1 | PASS |
| Results → Hub | 1 | 1 (ESC; the HUB button was seen but not tapped) | PASS |
| Hub tab ↔ tab | 1 | 1 | PASS |

## Interruption matrix (cells exercised)

| State | Cell | Expected | Observed | Verdict |
| --- | --- | --- | --- | --- |
| Game, `ore` hint showing | Hide | Pause | `pm:true, paused:true`; still on Pause after show | PASS (`04-hide-during-ore-hint.png`) |
| Game, `ore` hint showing | Blur | Pause | `pm:true` | PASS |
| BuildMode armed | Hide | Pause, armed kept | `pm:true`, `armed:"ferrite_drill"`; after RESUME still armed | PASS |
| BuildMode armed | ESC | disarm | `armed:null` | PASS |
| BuildSheet open | Blur | close it, open Pause | only the Pause texts remain; `pm:true` | PASS (`35-blur-sheet.png`) |
| BuildingCard open | Hide | close it, open Pause | `card:null, pm:true` | PASS (`32-hide-card.png`) |
| Pause | ESC | resume | resumes | PASS |
| Settings (in-game) | ESC | → Pause | → Pause | PASS |
| AbandonConfirm | ESC | CANCEL → Pause | → Pause | PASS |
| Game (any) | Reload | settled ABANDONED at the checkpoint | yes (sol 0, +30) | PASS |
| Terminal Ceremony | Reload | already banked; next boot = Hub | yes | PASS |
| GameOver | ESC | HUB | Hub | PASS |
| HubArk, UNDO toast live | ESC | toast closes, purchase stands → LAND | yes | PASS |

Not exercised (timebox): Preload hide; Hub hide; the demolish-toast freeze under Pause; ship/placement animation hide; dawn ceremony; CoachDusk; Draft hide/ESC; Evolution; BeaconConfirm; beacon charging; the RETRY/LAUNCH transition.

## Edge states

| Surface / state | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| Hub ARK 0 affordable (30 Data) | nodes dim, "need N Data", header "Next: 50 Data — land again", no badge | Nodes dimmed with `◆N`, ring 2+ locked; header matches | PASS. **§14b amended**: the copy is the cost chip |
| Hub LAND first visit after Landing 1 | one site open, locked sites "Needs N ★", LAUNCH preselected on R1 | "Prism Reach · 2★" etc. locked; "LAUNCH · Halcyon Flats R1" | PASS |
| Locked site / rung / kit | toasts | see the walk | PASS (+F4) |
| Hub LOG after only a reload-settle | settled Landing shown | "Halcyon Flats R1 · sol 0 · ABANDONED · ◆30" | PASS |
| Dock slot unaffordable | 0.45 α, no arm, strip "Need N" | "Need 15 Fe", `armed:null` | PASS (`37-unaffordable.png`) |
| Armed → unaffordable | auto-disarm | stays armed | FAIL (F3) |
| Storage at cap | chip full tick; Ledger "FULL · wasting N/min" | Ledger: Ferrite "FULL · wasting 36/min". Goods with no production show only "±0.0/s". The `grant` cheat pushes stock past the cap (99999/200), so this cell is only partly valid | PARTIAL (`39-ledger-full.png`) |
| ORBIT sols 1-2 | dimmed "Sol 3", no-op | yes | PASS |
| Build sheet locked card | "Sol N", dimmed | yes | PASS |
| Build mode 0 valid tiles | strip "0 valid · extend…" | not reached (only 1 valid observed) | NOT REACHED |
| Orders board empty / Draft reroll 0 / Tray BEACON / Spire | — | not reached in timebox | NOT REACHED |

## Confirmations / undo

| Action | Policy | Observed |
| --- | --- | --- |
| ABANDON LANDING | confirm | confirm dialog; CANCEL/ESC/ABANDON all behave as mapped |
| DEMOLISH | never confirm; UNDO toast | as mapped; UNDO restores |
| ARK purchase | never confirm; UNDO until tab change | no confirm, toast shown; the refund was not verified |
| Place / BUILD chip | never confirm | as mapped |
| RETRY / HUB / LAUNCH | never confirm | LAUNCH as mapped; RETRY not tapped |
| Settings RESET SAVE | confirms | button present; not tapped |
| BEACON / UPGRADE ALL >100 | confirm | not reached |

## Map reconciliation

**Reachable nodes and edges missing from §14b** (now added, with a provenance note): `DepositChip` (Game → deposit tap → BUILD chip → place / tap elsewhere / ESC); HubLand locked-kit toast **GO → HubArk**; HubSettings **RESET SAVE → ResetConfirm**. Two more are live but not graph nodes, by design: the `dock` coach panel ("Build from the dock… TAP TO CONTINUE") is a non-pausing hint under law 3 but behaves as an input owner (F1); and the "N idle crew" alert pill appeared live (its tap edge `Game → BuildingCard` is already mapped, but was not driven).

**§14b nodes not reached in this pass** (these are not proven unreachable; the timebox did not get to them): CoachDusk, Draft at dawn (sol 2+), Evolution, BeaconConfirm, UpgradeAllConfirm, OrdersSheet, win/loss Ceremony, GameOver RETRY, DAILY.

## PRD sections amended in this pass

| Section | Old claim | Measured claim |
| --- | --- | --- |
| §14b graph | no deposit-chip node | `Game → DepositChip → Game` (2 taps, measured) |
| §14b graph | locked toast is a self-loop only | + `HubLand → HubArk` via the GO on the locked-kit toast |
| §14b graph | HubSettings has close edges only | + `HubSettings → ResetConfirm → HubSettings` |
| §14b edge inventory, Hub ARK 0 Data | nodes show "need N Data" | nodes show the dimmed `◆N` cost (+ lock on ring 2+) |
| §14b provenance note | — | records F1/F2/F3 as game defects, with the map kept as law |

§3 and the §14b tap-depth table are unchanged. The measured 5 taps on returning → first placement and 4 on undocked-first come from defects (F1, F2), not from the map being wrong.
