import Phaser from 'phaser';
import { CSS, SAFE, TEXT, VIEW } from '../config';
import { isMuted, toggleMute } from '../core/audio';
import { Button } from './button';
import { BUTTON_STYLE, IDENTITY, TIER_RING, tierColor } from './duskChrome';

/**
 * Full-screen pause overlay: dim + "PAUSED" heading, the §14.5 BAG ROW, and
 * Resume / Restart / (Menu) / Mute buttons. Caller owns actually pausing the run
 * (combat + director) before showing this, resuming after `onResume`, and
 * tearing the scene down on `onRestart`/`onMenu` — this module only draws and
 * listens, same contract as `ui/cards.ts`.
 *
 * MENU is the run's exit door and the reason the overlay has four rows: a
 * player who is out of patience with a level must not have to lose it (or
 * reload the page) to get back to the map. It is optional only because a
 * family whose run IS the menu (a single endless surface) has nowhere to go;
 * every slice with its own menu scene passes it, and the row is dropped
 * entirely — not greyed — when it is absent.
 *
 * ## The bag row is the ONLY way into the casket (§5.6, §14.5)
 * `autoPinHighest` is false by law, so a relic reaches the Gravekeeper's Casket
 * only by being tapped HERE. That makes these pips the one tappable pips in the
 * game, and it makes the row load-bearing rather than a readout: without it,
 * every death loses 100% of the haul and the 400-shard casket upgrade buys
 * nothing.
 *
 * ## RESTART / MENU arm while the bag holds loot (§14b confirmation policy)
 * Shards are seconds of play; a carried Dread relic is minutes plus a Warden
 * kill. So both destructive rows take the same 3s two-tap arm the stash's
 * SALVAGE uses — and an empty-bag restart stays instant.
 */
export interface PauseOverlayHandle {
  destroy(): void;
}

/** One carried relic as the bag row needs it — no `RelicDef` dependency. */
export interface PauseBagRelic {
  id: string;
  name: string;
  /** 1-4; drives the pip's ART-LOCKED tier colour. */
  tier: number;
  /** True while it occupies a casket slot — pinned pips read in `gilt`. */
  pinned: boolean;
}

export interface PauseBagActions {
  /**
   * Everything carried right now, casket pins FIRST (the same order
   * `ui/bagPips.ts` draws the HUD in, so the row and the HUD agree). Re-read
   * after every pin, so the row repaints from the bag rather than from a copy
   * it made when it opened.
   */
  read(): readonly PauseBagRelic[];
  /** Tapped pip: (re-)pin it to the casket. The caller owns the toast. */
  pin(relicId: string): void;
  /** Casket capacity, for the row's "n/n PINNED" caption. */
  casketSlots: number;
}

export interface PauseOverlayActions {
  onResume: () => void;
  onRestart: () => void;
  /**
   * Abandons the run for the menu. The caller owns the teardown (stop its own
   * timers/director, then `scene.start(SCENES.menu)`). Absent = no MENU row.
   */
  onMenu?: () => void;
  /** §14.5 bag readout + casket pinning. Absent = no row (a family with no bag). */
  bag?: PauseBagActions;
  /**
   * §14b: while this returns true, RESTART and MENU arm for `ARM_MS` instead of
   * committing. Absent = both commit on the first tap.
   */
  armDestructive?: () => boolean;
}

/** §14b confirmation policy: an arm decays silently after 3s. */
const ARM_MS = 3000;
/** §14b copy for an armed destructive row. */
const ARM_LABEL = 'HAUL IS FORFEIT — TAP AGAIN';

/**
 * §14.5 authors the four button rows as "full-width 640x96, x=40, from y 480,
 * 16px gaps" — i.e. centres at 528 / 640 / 752 / 864 on a 112px pitch — and
 * appends the bag readout below them.
 *
 * `ROW` replaces the template's `VIEW.centerY +/- n` offsets, which drifted the
 * stack to 530 / 660 / 770 / 880 (a 130px first gap against the authored 112)
 * and pushed the bag row so low that the pips' 88px hit rects ran to y=1074 —
 * 14px BELOW `VIEW.height - SAFE.bottom` (1060), where nothing interactive but
 * the joystick zone may live. Found in the Step 5.5 audit.
 *
 * §14.5 puts every tap target at >=88px, and the pip's 88px HIT HEIGHT is kept
 * unconditionally. The horizontal pitch collapses toward the pip art only once
 * a meta-widened bag carries more relics than 88px pitches fit across the safe
 * width — eight pips at 88 exactly fill it, so the common case is the authored
 * one and the degradation only ever affects a bag the player paid to widen.
 */
const ROW = { firstY: 528, pitch: 112, height: 96 } as const;

/**
 * The bag readout, appended under the mute row (which ends at y 912). The pips
 * sit at 1004 so their 88px hit rect spans 960-1048 — 12px clear of the
 * bottom-220 reservation.
 */
const PIP = { hit: 88, maxPitch: 88, radius: 26, y: 1004, labelY: 944 } as const;

export function showPauseOverlay(
  scene: Phaser.Scene,
  actions: PauseOverlayActions,
): PauseOverlayHandle {
  const root = scene.add.container(0, 0).setDepth(2100).setScrollFactor(0);

  const dim = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.65)
    .setScrollFactor(0)
    .setInteractive();
  root.add(dim);

  const heading = scene.add
    .text(VIEW.centerX, ROW.firstY - 148, 'PAUSED', { ...TEXT.title, fontSize: '72px' })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add(heading);

  const buttonWidth = VIEW.width - SAFE.side * 2;
  let resolved = false;
  /** `scene.time.now` the destructive arm expires at; 0 = not armed. */
  let armedUntil = 0;
  const armTimers: Phaser.Time.TimerEvent[] = [];

  /**
   * True when the tap was consumed by ARMING the row rather than by committing
   * it. Idempotent: re-tapping an already-armed row inside the window commits,
   * and an expired arm simply arms again (§14b "no confirm ever stacks").
   */
  const armsInstead = (button: Button, label: string): boolean => {
    if (actions.armDestructive?.() !== true) return false;
    if (armedUntil > scene.time.now) return false;
    armedUntil = scene.time.now + ARM_MS;
    button.setLabel(ARM_LABEL);
    armTimers.push(
      scene.time.delayedCall(ARM_MS, () => {
        armedUntil = 0;
        button.setLabel(label);
      }),
    );
    return true;
  };

  // Rows are ordered by how likely they are to be the reason the player
  // paused, with the destructive ones further from the thumb's resting spot.
  // The stack is centred on the heading either way: dropping MENU closes the
  // gap instead of leaving a hole where it was.
  const onMenu = actions.onMenu;
  // Dropping MENU closes the gap instead of leaving a hole where it was, so the
  // remaining rows take the first three authored slots.
  const resumeY = ROW.firstY;
  const restartY = ROW.firstY + ROW.pitch;
  const muteY = ROW.firstY + ROW.pitch * (onMenu === undefined ? 2 : 3);
  const menuY = ROW.firstY + ROW.pitch * 2;

  const resume = new Button(
    scene,
    VIEW.centerX,
    resumeY,
    'RESUME',
    () => {
      if (resolved) return;
      resolved = true;
      actions.onResume();
    },
    // RESUME is the overlay's primary CTA; every other row is §14.4 `idle`.
    // The template colour-coded RESTART in `primary` green and MENU in
    // `secondary` violet — invented interface direction, and it painted the
    // haul-forfeiting row as the friendly one.
    { width: buttonWidth, height: ROW.height, ...BUTTON_STYLE.primary },
  );
  const restart = new Button(
    scene,
    VIEW.centerX,
    restartY,
    'RESTART',
    () => {
      if (resolved) return;
      if (armsInstead(restart, 'RESTART')) return;
      resolved = true;
      actions.onRestart();
    },
    { width: buttonWidth, height: ROW.height, ...BUTTON_STYLE.idle },
  );
  root.add([resume, restart]);

  if (onMenu !== undefined) {
    const menu = new Button(
      scene,
      VIEW.centerX,
      menuY,
      'MENU',
      () => {
        if (resolved) return;
        if (armsInstead(menu, 'MENU')) return;
        resolved = true;
        onMenu();
      },
      { width: buttonWidth, height: ROW.height, ...BUTTON_STYLE.idle },
    );
    root.add(menu);
  }

  const muteButton = new Button(
    scene,
    VIEW.centerX,
    muteY,
    isMuted() ? 'SOUND: OFF' : 'SOUND: ON',
    () => muteButton.setLabel(toggleMute() ? 'SOUND: OFF' : 'SOUND: ON'),
    { width: buttonWidth, height: 88, ...BUTTON_STYLE.idle, fontSize: '32px' },
  );
  root.add(muteButton);

  const bag = actions.bag;
  if (bag !== undefined) {
    const bagRow = scene.add.container(0, 0).setScrollFactor(0);
    root.add(bagRow);
    paintBagRow(scene, bagRow, bag);
  }

  return {
    destroy(): void {
      for (const timer of armTimers) timer.remove(false);
      armTimers.length = 0;
      root.destroy(true);
    },
  };
}

/**
 * Draws (and redraws) the bag row from the bag itself. A pin reorders the row —
 * the pinned relic moves to the casket group — so the row is rebuilt from
 * `read()` rather than patched, which is also what keeps it honest when a pin
 * displaces an older one.
 *
 * Each pip arms on its OWN pointer-down and disarms on pointer-out, the same
 * gesture rule `scenes/meta.ts` uses for the GEAR cells: a release that merely
 * ENDED over a pip (a stray drag off the RESUME button) must not spend a casket
 * slot.
 */
function paintBagRow(
  scene: Phaser.Scene,
  row: Phaser.GameObjects.Container,
  bag: PauseBagActions,
): void {
  row.removeAll(true);

  const relics = bag.read();
  const pinned = relics.filter((relic) => relic.pinned).length;
  const caption =
    relics.length === 0
      ? 'BAG EMPTY — RELICS YOU CARRY CAN BE PINNED HERE'
      : `TAP A RELIC TO PIN IT · CASKET ${pinned}/${bag.casketSlots}`;
  row.add(
    scene.add
      .text(VIEW.centerX, PIP.labelY, caption, { ...TEXT.label, fontSize: '22px', color: CSS.inkSoft })
      .setOrigin(0.5)
      .setScrollFactor(0),
  );
  if (relics.length === 0) return;

  const safeWidth = VIEW.width - SAFE.side * 2;
  const pitch = Math.min(PIP.maxPitch, safeWidth / relics.length);
  const left = VIEW.centerX - (pitch * (relics.length - 1)) / 2;

  for (let i = 0; i < relics.length; i += 1) {
    const relic = relics[i];
    if (relic === undefined) continue;
    const x = left + i * pitch;

    const swatch = scene.add.graphics().setScrollFactor(0);
    swatch.fillStyle(tierColor(relic.tier), 1);
    swatch.fillCircle(x, PIP.y, PIP.radius);
    // The mandatory tier ring (tier 2 Burnished is 2.91:1 unringed); a pinned
    // pip takes the gilt ring instead, which is the row's whole state readout.
    swatch.lineStyle(relic.pinned ? 4 : TIER_RING.width, relic.pinned ? IDENTITY.gilt : TIER_RING.color, 1);
    swatch.strokeCircle(x, PIP.y, PIP.radius);
    row.add(swatch);

    if (relic.pinned) {
      row.add(
        scene.add
          .text(x, PIP.y + PIP.radius + 16, 'PINNED', {
            ...TEXT.label,
            fontSize: '16px',
            color: CSS.accent,
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      );
      continue;
    }

    const zone = scene.add
      .zone(x, PIP.y, Math.max(PIP.hit, pitch), PIP.hit)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    let armed = false;
    zone.on(Phaser.Input.Events.POINTER_DOWN, () => {
      armed = true;
    });
    zone.on(Phaser.Input.Events.POINTER_OUT, () => {
      armed = false;
    });
    zone.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!armed) return;
      armed = false;
      bag.pin(relic.id);
      paintBagRow(scene, row, bag);
    });
    row.add(zone);
  }
}
