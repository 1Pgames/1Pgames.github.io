# Playtest findings — routing protocol (fixed size, not a log)

This file is a PROTOCOL, not a ledger. Findings are never appended here: an
append-only lessons list grows without bound, duplicates itself, and stops
working as a gate. Instead every user playtest finding is ROUTED into exactly
one BOUNDED, load-bearing artifact — merged into the rule it refines, or
added as a new rule in that artifact's own vocabulary.

## Routing table

| Finding kind | Destination (the single source of truth) | Enforced by |
| --- | --- | --- |
| Universal UX / interaction law (modal close, results CTA, list clipping, icon-first economy, stats-match-loop, overlap, readability…) | `template/AGENTS.md` §Non-negotiable rules | Step 5.5 audit walks that section row by row |
| Genre/family design numbers (move economy, board sizes, booster kits, difficulty tiers, mercy…) | the family's playbook (`game-prd/references/casual-playbooks.md` / `genre-playbooks.md`) + `design-heuristics.md` §18.x for calibration | `game-prd` specs from it; family sim gates encode the numbers |
| Engine/runtime trap (z-order, scrollFactor, scene lifecycle, tween leaks, camera id reuse…) | `template/AGENTS.md` §Common Phaser 4 traps | code review against the contract; the trap entry names the failing symptom |
| Reusable behaviour (tutorial system, tooltip, tray, scissor list, pause/gameover contracts…) | a `template/src/**` component + its row in AGENTS.md's file table | inherited by scaffold; `npm run verify` + probe builds |
| Balance/solvability defect | the family's sim gate (`sim/families/<slice>.ts`) and/or a kit selftest fixture | `npm run verify` fails forever after a regression |
| Release/process defect | `scripts/release-check.mjs` check or a game-build SKILL step | the gate script / the orchestrator procedure |

## Merge-first discipline (what keeps every destination bounded)

1. **Search before writing.** Find the existing rule/gate/trap the finding
   refines. Nine findings out of ten sharpen a rule that already exists —
   rewrite THAT rule with the new precision instead of adding a sibling.
2. **One home per finding.** If it seems to belong in two places, the second
   place gets a one-line cross-reference, never a copy.
3. **Rules carry their reference.** Every rule names the file/pattern that
   implements it (`scenes/meta.ts`, `ui/coach.ts`…) — the code is the long
   version, the rule stays short.
4. **Systems beat rules.** If a finding can be fixed once in `template/src/**`
   so the mistake becomes impossible, ship the component and keep the rule to
   one line pointing at it. A rule nobody can violate is the best rule.
5. **Prune on contact.** While routing a new finding, delete or merge any
   destination rule it obsoletes. The contract must fit in one read.

## Loop closure (Step 6.3 duty)

A playtest fix round is DONE only when: the game is fixed AND the finding is
routed per the table above AND the destination artifact's gate would now
catch the regression (audit row, sim gate, selftest, or verify). If the
routing added nothing anywhere, the finding was already covered — say so in
the report and cite the existing rule.
