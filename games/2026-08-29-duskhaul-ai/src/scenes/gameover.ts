import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW, bareText } from '../config';
import { SCENES } from '../core/keys';
import { countTo, enterFromBottom } from '../core/juice';
import { enterPinningHitArea } from '../ui/entrance';
import { sfx, sfxArp } from '../core/audio';
import { shareResult } from '../core/share';
import { track } from '../core/telemetry';
import { drawPill } from '../ui/primitives';
import { Button } from '../ui/button';
import { addBackground } from '../ui/background';
import { ICON } from '../data/art';
import {
  BUTTON_STYLE,
  DEEP_INK_CSS,
  IDENTITY,
  PANEL,
  SCRIM,
  drawDuskPanel,
  tierColor,
} from '../ui/duskChrome';
import { TIER_NAMES } from '../data/relics';
import type { ResultStat } from '../core/session';

/**
 * Run results — one scene, two variants (§14.5, §14b).
 *
 * THE HAUL IS THE HERO NUMBER. That is a correction of a measured defect, not
 * a style choice: the previous screen crowned an arcade `score = kills*10 +
 * seconds`, so a run that died holding 448 shards and 8 relics printed a giant
 * "NEW BEST SCORE" directly above "you lost everything", and a deliberate 2:14
 * bail was congratulated with "ALL CLEAR!". Two scoreboards pointing in
 * opposite directions at the exact moment the game teaches what it rewards.
 * So: banked shards get the large type and the count-up ceremony, the relic
 * rows carry their tier colours, the arcade score does not appear at all, and
 * `bestScore` persists the best BANKED HAUL — a run that lost its loot can
 * never set a record.
 *
 * The extracted headline NAMES THE GATE, because which door you chose IS the
 * achievement: leaving through Gate A at 2:00 and through Gate C at 7:00 are
 * different games, and the screen should say which one you played.
 */

/** One relic as the results screen needs it — no `RelicDef` dependency in the data. */
export interface HaulRelic {
  id: string;
  name: string;
  /** 1-4. Drives the row's swatch colour (ART-LOCKED ladder). */
  tier: number;
}

/** Data `GameScene` passes via `scene.start(SCENES.gameOver, data)`. */
export interface GameOverData {
  won: boolean;
  timeMs: number;
  kills: number;
  level: number;
  /** Run seed. RETRY replays it exactly; RUN AGAIN deliberately does not. */
  seed: string;
  /** Zone id, so both CTAs return to the zone the player was actually in. */
  zone: string;
  /**
   * Shards that ACTUALLY reached the stash: the full carry on an extraction,
   * or the Rot Tithe fraction on a death. This is the hero number and the
   * value `bestScore` competes on.
   */
  bankedShards: number;
  /** What was in the bag when the run ended — the size of the risk taken. */
  carriedShards: number;
  /** Relics that landed in the stash. `GameScene` has already banked their ids. */
  banked: readonly HaulRelic[];
  /** Relics lost to the dark. Display only. */
  lost: readonly HaulRelic[];
  /**
   * The casket-pinned survivor(s) — a SUBSET of `banked`, highlighted in
   * `accent`. The casket is manual-pin-only and starts empty, so this is
   * routinely empty on a death and the screen must read correctly that way.
   */
  casketSaved: readonly HaulRelic[];
  /** Which gate the player extracted through, or `null` on a death. */
  gateUsed: 'a' | 'b' | 'c' | null;
  /**
   * True when this run's banked haul beat the previous `stats.bestScore`,
   * decided by `GameScene` BEFORE it wrote the meta save — this scene can no
   * longer measure it, because by the time it runs the new best is already
   * stored.
   */
  bestHaul: boolean;
  /**
   * EXTRA stat rows, appended after the loop-fit line. Rows that merely restate
   * the hero number or the relic list in abbreviations do not belong here: the
   * screen already says those in English, and "BANKED 408sh 0rl" next to a
   * 92px "408" and a labelled relic list was measured as pure noise.
   */
  stats?: readonly ResultStat[];
}

/**
 * §14.5 authored y positions, with the tally block re-flowed for the WORST
 * case rather than the typical one.
 *
 * The worst case is a death holding a full bag: 8 LOST rows plus an "AND n
 * MORE" line, nine lines in all. Laid out at the first pass's 34px pitch from
 * y=540 that block ran to y=812 and collided with both the stat row and the
 * footer hint — measured on screen, not predicted. At a 32px pitch from 518 it
 * ends at 774 with the stats at 796 and the hint at 834, clearing the primary
 * CTA's top edge (852) by 6px.
 *
 * §14.5 puts the stat row at 620; it moves to 796 because the relic block above
 * it grew when the haul was promoted to the hero number. Every other y on the
 * screen keeps its authored value.
 */
const LAYOUT = {
  /**
   * The best-haul crown, ABOVE the header. It used to be jammed into the right
   * margin beside the 92px hero number, where 640-safe minus the number left
   * ~90px of room and "BEST HAUL YET" wrapped over three stacked lines in a
   * 20px font — the single loudest thing that can happen on this screen,
   * rendered as the most cramped. The full-width row above the header costs
   * nothing (the band was empty) and gives the celebration one line.
   */
  bestHaul: 238,
  header: 300,
  verdict: 356,
  hero: 430,
  heroLabel: 484,
  rowsTop: 518,
  rowPitch: 32,
  stats: 796,
  note: 834,
  primary: 900,
  secondary: 1012,
} as const;

/** The crown's own pill: an `accent` fill carrying a deep-ink label (§11-legal). */
const BEST_HAUL = { height: 34, padX: 48, fontSize: '22px' } as const;

/**
 * The §14.4 scrim band: verdict row (356) down to the footer hint (834), padded
 * out to the rows the tally can actually reach. It stops short of the CTAs,
 * which carry their own button chrome.
 */
const RESULT_SCRIM = { top: 336, bottom: 856 } as const;

/** §14.5: the LOST list is capped at 8 rows. */
const MAX_ROWS = 8;

const CTA = { width: VIEW.width - SAFE.side * 2, height: 96, gap: 24 } as const;
const ROW = { width: VIEW.width - SAFE.side * 2, height: 28 } as const;

/** How long SHARE holds 'COPIED!' before it turns back into SHARE. */
const SHARE_FLASH_MS = 1200;
const SHARE_FAIL_FLASH_MS = 900;

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

export class GameOverScene extends Phaser.Scene {
  private result: GameOverData = {
    won: false,
    timeMs: 0,
    kills: 0,
    level: 1,
    seed: '',
    zone: 'castle',
    bankedShards: 0,
    carriedShards: 0,
    banked: [],
    lost: [],
    casketSaved: [],
    gateUsed: null,
    bestHaul: false,
  };

  /**
   * §13's extraction tally is a 700ms ceremony, and it is the ONLY ceremony a
   * player sees after every single run — so it is the first thing that becomes
   * a toll rather than a payoff. These two carry the tap-to-skip: the tween
   * being skipped, and the full-screen zone that catches the tap.
   */
  private tally: Phaser.Tweens.Tween | null = null;
  private skipZone: Phaser.GameObjects.Zone | null = null;

  constructor() {
    super(SCENES.gameOver);
  }

  init(data: Partial<GameOverData>): void {
    this.result = {
      won: data.won ?? false,
      timeMs: data.timeMs ?? 0,
      kills: data.kills ?? 0,
      level: data.level ?? 1,
      seed: data.seed ?? '',
      zone: data.zone ?? 'castle',
      bankedShards: data.bankedShards ?? 0,
      carriedShards: data.carriedShards ?? 0,
      banked: data.banked ?? [],
      lost: data.lost ?? [],
      casketSaved: data.casketSaved ?? [],
      gateUsed: data.gateUsed ?? null,
      bestHaul: data.bestHaul ?? false,
      stats: data.stats,
    };
  }

  create(): void {
    addBackground(this, false);
    // §14.4 scrim. §14.5 calls Results "a panelled screen over a dimmed field,
    // so the header takes armour and the rows do not" — but the shipped screen
    // was neither panelled nor scrimmed, and the `bg-menu` backdrop's bright
    // band (measured luma peaking at 181 across 45-60% of the frame, i.e. y
    // 576-768) ran straight under the tally, the LOST rows and the stat line.
    // One veil from the verdict row to the footer hint restores the >= 4.5:1
    // backing those rows are already written to assume, and the header at
    // y 300 keeps its armour over the backdrop's dark top third.
    this.add.rectangle(
      VIEW.centerX,
      (RESULT_SCRIM.top + RESULT_SCRIM.bottom) / 2,
      VIEW.width - SAFE.side * 2 + SCRIM.pad * 2,
      RESULT_SCRIM.bottom - RESULT_SCRIM.top,
      SCRIM.fill,
      SCRIM.alpha,
    );
    const result = this.result;

    // The meta write happens in `GameScene.finish()` BEFORE the run journal is
    // cleared (SETTLE FIRST, CLEAR LAST): between clearing the journal and
    // writing the save there is a window in which the haul exists nowhere, and
    // a throw there destroys the run with nothing to recover from. So this
    // scene DISPLAYS the settlement and never performs it — a second write here
    // would double-pay the currency — and `bestHaul` arrives already decided,
    // because by now the new best is what is stored.

    const extracted = result.won;
    const header = this.add
      .text(VIEW.centerX, LAYOUT.header, extracted ? 'HAULED OUT' : 'SWALLOWED BY THE DARK', {
        ...TEXT.heading,
        fontSize: extracted ? '64px' : '42px',
        color: extracted ? CSS.accent : CSS.ink,
        align: 'center',
      })
      .setOrigin(0.5);

    // Results is a panelled screen over a dimmed field, so the HEADER takes
    // armour (§14.5) and rows that sit on their own panel do not.
    const verdict = this.add
      .text(VIEW.centerX, LAYOUT.verdict, this.verdictLine(), {
        ...TEXT.body,
        fontSize: '28px',
        color: extracted ? CSS.primary : CSS.inkSoft,
        align: 'center',
      })
      .setOrigin(0.5);

    this.buildHero();
    const rows = extracted ? this.buildBankedRows() : this.buildLostRows();

    const stats = this.add
      .text(VIEW.centerX, LAYOUT.stats, this.statLine(), {
        ...TEXT.label,
        fontSize: '24px',
        color: CSS.inkSoft,
        align: 'center',
      })
      .setOrigin(0.5);

    const note = this.add
      .text(VIEW.centerX, LAYOUT.note, this.noteLine(), {
        ...TEXT.label,
        fontSize: '24px',
        color: CSS.warn,
        align: 'center',
      })
      .setOrigin(0.5);

    // CTA law (§14b): an extraction offers RUN AGAIN (same zone, FRESH seed) —
    // nobody replays a run they already banked — and a death offers RETRY
    // (same zone, SAME seed), the "one more go at that layout" tap.
    const onPrimary = (): void => {
      if (!extracted) track('retry');
      this.scene.start(SCENES.game, {
        zone: result.zone,
        ...(extracted ? {} : { seed: result.seed }),
      });
    };

    const primary = new Button(
      this,
      VIEW.centerX,
      LAYOUT.primary,
      extracted ? 'RUN AGAIN' : 'RETRY',
      onPrimary,
      { width: CTA.width, height: CTA.height, ...BUTTON_STYLE.primary },
    );

    const pairWidth = (CTA.width - CTA.gap) / 2;
    const pairStyle = { width: pairWidth, height: CTA.height, ...BUTTON_STYLE.idle };
    const stash = new Button(
      this,
      VIEW.centerX - (pairWidth + CTA.gap) / 2,
      LAYOUT.secondary,
      'STASH',
      () => this.scene.start(SCENES.meta),
      pairStyle,
    );
    const share = new Button(
      this,
      VIEW.centerX + (pairWidth + CTA.gap) / 2,
      LAYOUT.secondary,
      'SHARE',
      () => {
        void shareResult({ score: `${result.bankedShards} shards`, won: extracted }).then(
          (outcome) => {
            // The promise settles when the OS sheet closes, which can be long
            // after the player left this screen.
            if (!this.scene.isActive()) return;
            if (outcome === 'shared') return;
            const copied = outcome === 'copied';
            share.setLabel(copied ? 'COPIED!' : 'NO SHARE');
            this.time.delayedCall(copied ? SHARE_FLASH_MS : SHARE_FAIL_FLASH_MS, () =>
              share.setLabel('SHARE'),
            );
          },
        );
      },
      pairStyle,
    );

    enterFromBottom(this, header, 0);
    enterFromBottom(this, verdict, 60);
    rows.forEach((row, index) => enterFromBottom(this, row, 120 + index * 30));
    enterFromBottom(this, stats, 200);
    enterFromBottom(this, note, 220);
    // The CTAs slide but keep their hit areas at their final rects: the primary
    // on this screen is the one control every run ends on, and 240ms of dead
    // pixels there is a swallowed tap.
    enterPinningHitArea(this, primary, 240);
    enterPinningHitArea(this, stash, 280);
    enterPinningHitArea(this, share, 280);

    // §12/§13: extraction is the game's biggest positive moment and gets the
    // arp; a death keeps `die`. They used to share the loud `levelup`, so a
    // ruinous run and a perfect haul announced themselves identically.
    if (extracted) sfxArp('combo', 6, { volume: 0.8 });
    else sfx('die', { volume: 0.7 });

    // §13: the 700ms tally is skippable. The zone sits at depth -1, UNDER every
    // CTA — Phaser hit-tests topmost-only, so a tap on RUN AGAIN reaches the
    // button and a tap anywhere else reaches this. There is no frame in which
    // one tap both skips the tally and starts the next run.
    if (this.tally !== null) {
      this.skipZone = this.add
        .zone(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height)
        .setDepth(-1)
        .setInteractive({ useHandCursor: false });
      this.skipZone.on('pointerdown', () => this.skipTally());
    }

    // SPACE mirrors the primary exactly — keyboard and touch must never start
    // different things. While the tally runs it skips first, for the same
    // reason the zone does: the first press should never cost the player the
    // numbers they are waiting to read.
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.skipTally()) return;
      onPrimary();
    });
    this.cameras.main.fadeIn(240, 0, 0, 0);
  }

  /**
   * Lands the tally instantly. `tween.complete()` runs the tween's own
   * `onComplete`, which is where `countTo` writes the final value — so the
   * skipped ceremony resolves through exactly the code path it would have
   * finished on, rather than a second place that also knows the number.
   *
   * Returns true when it actually skipped something, so the SPACE handler can
   * tell "skip" from "start the next run".
   */
  private skipTally(): boolean {
    const tally = this.tally;
    if (tally === null) return false;
    this.tally = null;
    this.skipZone?.destroy();
    this.skipZone = null;
    if (tally.isPlaying()) tally.complete();
    sfx('ui', { volume: 0.5 });
    return true;
  }

  /** The hero number: shards that actually reached the stash, counted up. */
  private buildHero(): void {
    const result = this.result;
    const value = this.add
      .text(VIEW.centerX + 22, LAYOUT.hero, '0', {
        ...TEXT.title,
        fontSize: '92px',
        color: CSS.accent,
      })
      .setOrigin(0.5);
    // Held so `skipTally` can land it. A zero haul has nothing to count, and
    // arming a skip target for a number that is already final would put a dead
    // tap-to-skip on the most demoralising screen in the game.
    const tally = countTo(this, value, 0, result.bankedShards, 700);
    if (result.bankedShards > 0) this.tally = tally;

    if (this.textures.exists(ICON.shard.key)) {
      this.add
        .image(VIEW.centerX - 100, LAYOUT.hero, ICON.shard.key, ICON.shard.frame)
        .setDisplaySize(52, 52);
    }

    // On a death the label tells the truth about the gap between carried and
    // banked — that gap is the whole lesson of the screen.
    const lostShards = result.carriedShards - result.bankedShards;
    const label =
      !result.won && lostShards > 0
        ? `SHARDS BANKED  ·  ${lostShards} LOST`
        : 'SHARDS BANKED';
    this.add
      .text(VIEW.centerX, LAYOUT.heroLabel, label, {
        ...TEXT.label,
        fontSize: '24px',
        color: CSS.inkSoft,
      })
      .setOrigin(0.5);

    // A record can only ever be set by loot that actually reached the stash.
    // ONE LINE, on its own pill, in the empty band above the header: the crown
    // is the loudest thing that can happen on this screen and it gets room to
    // be it. It used to be right-anchored beside the 92px hero number, where
    // the ~90px of margin left over wrapped "BEST HAUL YET" into three
    // stacked lines against the safe edge.
    if (result.bestHaul && result.bankedShards > 0) {
      const crown = this.add
        .text(VIEW.centerX, LAYOUT.bestHaul, 'BEST HAUL YET', {
          ...TEXT.label,
          fontSize: BEST_HAUL.fontSize,
          // The pill IS the contrast surface (an `accent` fill carrying a
          // deep-ink label), so the label goes bare.
          color: DEEP_INK_CSS,
          ...bareText(),
        })
        .setOrigin(0.5);
      // The pill is measured from the label, so it is created second and then
      // pushed under it by depth rather than by display-list order.
      const pill = drawPill(this, Math.ceil(crown.width) + BEST_HAUL.padX, BEST_HAUL.height, {
        fill: PALETTE.accent,
        fillAlpha: 0.92,
        stroke: PALETTE.accent,
        strokeAlpha: 1,
        strokeWidth: 2,
      })
        .setPosition(VIEW.centerX, LAYOUT.bestHaul)
        .setDepth(1);
      crown.setDepth(2);
      this.tweens.add({
        targets: [crown, pill],
        scale: { from: 0.86, to: 1 },
        duration: 320,
        delay: 120,
        ease: 'Back.easeOut',
      });
    }
  }

  /**
   * The extracted variant's relic tally. §14b: extracting with zero relics
   * collapses the block entirely rather than showing an empty frame.
   */
  private buildBankedRows(): Phaser.GameObjects.Container[] {
    const saved = new Set(this.result.casketSaved.map((relic) => relic.id));
    return this.result.banked
      .slice(0, MAX_ROWS)
      .map((relic, index) => this.buildRow(relic, index, saved.has(relic.id), false));
  }

  /**
   * The died variant's LOST list, capped at 8, with any casket survivor above
   * it. With manual-pin-only casketing an unpinned death saves nothing, so the
   * survivor row is genuinely optional and its absence is the common case.
   */
  private buildLostRows(): Phaser.GameObjects.Container[] {
    const rows: Phaser.GameObjects.Container[] = [];
    let slot = 0;
    for (const relic of this.result.casketSaved.slice(0, MAX_ROWS)) {
      rows.push(this.buildRow(relic, slot, true, false));
      slot += 1;
    }

    // The 8-row cap counts LINES, not relics: when the loss overflows, the last
    // slot is spent on the "AND n MORE" line rather than on a ninth line
    // squeezed under it. A ninth line landed 11px from the stat row.
    const room = Math.max(0, MAX_ROWS - slot);
    const overflows = this.result.lost.length > room;
    const lostShown = this.result.lost.slice(0, overflows ? Math.max(0, room - 1) : room);
    for (const relic of lostShown) {
      rows.push(this.buildRow(relic, slot, false, true));
      slot += 1;
    }

    // A capped list must SAY it is capped, or eight names read as the whole
    // loss when it was eleven.
    const hidden = this.result.lost.length - lostShown.length;
    if (hidden > 0) {
      const more = this.add.container(VIEW.centerX, LAYOUT.rowsTop + slot * LAYOUT.rowPitch);
      more.add(
        this.add
          .text(0, 0, `AND ${hidden} MORE`, { ...TEXT.label, fontSize: '22px', color: CSS.inkSoft })
          .setOrigin(0.5),
      );
      rows.push(more);
    }
    return rows;
  }

  /**
   * One relic row: tier swatch (ART-LOCKED colour plus its mandatory 2px ring),
   * name, tier name. A saved row is highlighted in `accent` on its own panel; a
   * lost row reads in `inkSoft`.
   */
  private buildRow(
    relic: HaulRelic,
    index: number,
    saved: boolean,
    lost: boolean,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(VIEW.centerX, LAYOUT.rowsTop + index * LAYOUT.rowPitch);

    if (saved) {
      // The survivor gets a real panel: it is the one row on a death screen
      // that is good news, and `accent` type alone would not carry it.
      container.add(
        // +2 rather than +8: at a 32px pitch a fatter panel touches the row
        // above it, and touching panels read as one broken block.
        drawDuskPanel(this, ROW.width, ROW.height + 2, {
          stroke: PALETTE.accent,
          strokeAlpha: 0.9,
        }),
      );
    }

    const left = -ROW.width / 2;
    const swatch = this.add.graphics();
    swatch.fillStyle(tierColor(relic.tier), lost ? 0.55 : 1);
    swatch.fillCircle(left + 22, 0, 9);
    // The mandatory tier ring: tier 2 Burnished is 2.91:1 unringed, below the
    // 3:1 graphical floor.
    swatch.lineStyle(2, saved ? IDENTITY.gilt : PANEL.stroke, 1);
    swatch.strokeCircle(left + 22, 0, 9);
    container.add(swatch);

    const tone = saved ? CSS.accent : lost ? CSS.inkSoft : CSS.ink;
    container.add(
      this.add
        .text(left + 44, 0, relic.name, {
          ...TEXT.body,
          fontSize: '23px',
          color: tone,
          // Only the saved row sits on its own panel, so only it strips armour.
          ...(saved ? bareText() : {}),
        })
        .setOrigin(0, 0.5),
    );
    container.add(
      this.add
        .text(ROW.width / 2 - 22, 0, (TIER_NAMES[relic.tier - 1] ?? '').toUpperCase(), {
          ...TEXT.label,
          fontSize: '20px',
          color: saved ? CSS.accent : CSS.inkSoft,
          ...(saved ? bareText() : {}),
        })
        .setOrigin(1, 0.5),
    );
    if (saved) {
      container.add(
        this.add
          .text(60, 0, 'CASKET SAVED', {
            ...TEXT.label,
            fontSize: '18px',
            color: CSS.accent,
            ...bareText(),
          })
          .setOrigin(0, 0.5),
      );
    }
    return container;
  }

  /** The line under the header. On a win it NAMES THE GATE. */
  private verdictLine(): string {
    const result = this.result;
    if (result.won) {
      return result.gateUsed === null
        ? `OUT AT ${formatClock(result.timeMs)}`
        : `OUT THROUGH GATE ${result.gateUsed.toUpperCase()} AT ${formatClock(result.timeMs)}`;
    }
    // §14b: a death with an empty bag AND an empty casket gets its own line
    // rather than empty list chrome.
    if (result.lost.length === 0 && result.casketSaved.length === 0 && result.carriedShards === 0) {
      return "It took nothing you hadn't already lost.";
    }
    return `FELL AT ${formatClock(result.timeMs)}`;
  }

  /**
   * The stat row. The loop-fit line is UNCONDITIONAL and the slice's `stats`
   * rows are APPENDED to it, rather than replacing it: the slice's rows used to
   * be the whole line, and what they said was
   * "BANKED 408sh 0rl   LOST 0sh 0rl" — the hero number and the relic list
   * restated in abbreviations, directly under a 92px "408" and a labelled
   * "SHARDS BANKED · n LOST". The row's job is the facts the rest of the screen
   * does NOT carry, so the derived line owns it and extras (the Collapse's
   * DUSK TITHE) ride behind.
   *
   * Rows match THIS loop: a real-time extraction run has no moves and no
   * stars, so neither appears.
   */
  private statLine(): string {
    const result = this.result;
    const loop = `SURVIVED ${formatClock(result.timeMs)}   KILLS ${result.kills}   LEVEL ${result.level}`;
    const extra = (result.stats ?? []).map((row) => `${row.label} ${row.value}`);
    return extra.length === 0 ? loop : `${loop}   ${extra.join('   ')}`;
  }

  /** The teaching line. On an unpinned death this is the most useful text on screen. */
  private noteLine(): string {
    const result = this.result;
    if (result.won) return '';
    if (result.casketSaved.length > 0) return '';
    if (result.lost.length === 0) return '';
    return 'Pin a relic to the casket from pause.';
  }
}
