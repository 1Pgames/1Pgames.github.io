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
| Golden-path / spec gap a script can measure (a step the machine playtest never drove, a budget it never asserted, a PRD section left hollow) | a budget/adapter in `scripts/cert-driver.mjs` or a PRD check in `scripts/audit-check.mjs` | the cert report (`release-check.mjs` `checkCert` demands `passed === true`) / `node scripts/audit-check.mjs <slug>` |
| **Orchestration / coordination defect** (a broadcast destroyed a result, a cause of death was guessed, a gate ran unbounded, two ownership maps disagreed, a provider policy flipped mid-wave) | `game-build` SKILL.md §Orchestrator conduct + §Checkpoints and dead agents | the Step 7 wave record: every `dead`/`taken-over` row needs a machine `cause`, and the ownership recipe must print no unexplained UNOWNED/COLLISION line |
| **Dispatch / agent-capability defect** (an agent lacked the tool its job requires, the wrong specialist held a seam, an agent's own prompt never carried the duty it was judged on) | the agent definition in `.claude/agents/<agent>.md` — the duty belongs in the agent's system prompt, not in the dispatch text | §Dispatch preflight item 1 (tools named per agent) + the agent's own contract section |
| **Input/probe harness defect** (a bot drove input geometry it hard-coded instead of reading `TUNING`, or probed an input in a UI state where it is legitimately disabled and filed a false BLOCKER) | `.claude/agents/game-qa.md` §Harness preconditions & input probing | the probe resolves geometry from `TUNING` at probe time and asserts the UI state before probing |
| **Unrequested side effect on the USER's machine** (a driven tab made sound, stole focus, opened a window, or wrote outside the workspace — the user had to interrupt a live run to stop it) | `game-build` SKILL.md §Side effects on the user's machine for the orchestrator's dispatch duty + `.claude/agents/<agent>.md` §Harness preconditions for the driving agent's own duty | every driven URL carries `?mute=1` and the run asserts `window.__AUDIO__().forcedByUrl === true`; silence is proven by assertion, never by listening |
| **Measurement / criterion defect** (a reject criterion wrong on POPULATION rather than on metric, a metric anti-correlated with what it claims to measure, provider folklore) | the criterion's own home (script check, audit heuristic, agent rule) — rewritten with the population it is valid for | re-measure the criterion against work already ACCEPTED; if it rejects the canon, the criterion is the defect |
| **Cross-gate blindness** (two or more systems described one player-visible fact in different vocabularies and nobody joined them) | `game-build` SKILL.md Step 5.8 reconciliation table — a new row/vocabulary mapping, not a new gate | Step 5.8 must show zero unexplained pairs and zero unproven content before "green" |

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
6. **A retraction carries its provenance.** When a rule is CORRECTED by
   measurement, keep exactly one line saying so, with the numbers and the date:
   *"measured 2026-08-29: accepted canon fails this at 0.4% lights — floor
   retracted"*. Without it the next agent helpfully restores the version that
   was already proven wrong. One line, in the rule's own home; never a
   changelog.

## Loop closure (Step 6.3 duty)

A playtest fix round is DONE only when: the game is fixed AND the finding is
routed per the table above AND the destination artifact's gate would now
catch the regression (audit row, sim gate, selftest, or verify). If the
routing added nothing anywhere, the finding was already covered — say so in
the report and cite the existing rule.
