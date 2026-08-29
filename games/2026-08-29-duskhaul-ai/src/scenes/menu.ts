import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, VIEW, bareText } from '../config';
import { SCENES } from '../core/keys';
import { isMuted, sfx, toggleMute, unlockAudio } from '../core/audio';
import { startMusic } from '../core/music';
import { enterPinningHitArea } from '../ui/entrance';
import { hasUnlock, grantUnlock, loadMeta, spendCurrency } from '../core/progression';
import { isDailyMode, setDailyMode } from '../core/daily';
import { track } from '../core/telemetry';
import { load, save } from '../core/storage';
import { Button } from '../ui/button';
import { addBackground } from '../ui/background';
import { ICON, TEXTURE } from '../data/art';
import { paintPanel, paintPill } from '../ui/primitives';
import {
  BUTTON_STYLE,
  DEEP_INK_CSS,
  DISABLED_ALPHA,
  IDENTITY,
  PANEL,
  drawDuskPanel,
  paintScrim,
  panelStyle,
  tierColor,
} from '../ui/duskChrome';
import { ZONES, STARTING_ZONE, type ZoneDef } from '../data/zones';
import { TIER_NAMES } from '../data/relics';

/**
 * Title screen and ZONE SELECT (§14.5 "Zone select", §14b: zone select lives
 * in the menu, not in a scene of its own — that is what keeps boot -> playing
 * at one tap).
 *
 * Four cards, 640x150, stacked from y 420 with 16px gaps. A card carries the
 * zone's name, its threat base and its loot bias; a locked card additionally
 * carries a lock glyph and its shard price as a real, tappable UNLOCK pill.
 *
 * The unlock affordance is the one place §14b needs reading rather than
 * quoting. The flow map gives the locked-card tap exactly one outcome —
 * "shake + price pulse", no modal, no navigation — and §10 says zone unlocks
 * are shard-purchased, but no purchase NODE exists. Resolved without adding a
 * node: the card body is the refusal (shake + `warn` price pulse), and the
 * price PILL is the purchase, bought in place and saved per action exactly like
 * a meta purchase. Menu -> Menu either way, so the graph is unchanged, and the
 * §14b confirmation policy already exempts purchases from confirming.
 */

/** The zone the player last took into a run — so PLAY is always one tap. */
const LAST_ZONE_KEY = 'zone:last';

/** §14.5: 4 cards 640x150 stacked from y 420 (16px gaps), y = card CENTRE. */
const CARD = { width: 640, height: 150, firstY: 420, gap: 16 } as const;

/** §14.5: PLAY 640x110 at y 1060. The bottom-220 reservation is Game-scene only. */
const PLAY = { width: 640, height: 110, y: 1060 } as const;

/** The row of three secondary controls under PLAY. All >= 88px tap targets. */
const FOOTER = { y: 1190, height: 88, gap: 16 } as const;

/** §14.5 pins the shard total top-right at (680, 24) — right of the shell corner. */
const SHARDS = { x: 680, y: 24 } as const;

const UNLOCK_PILL = { width: 200, height: 88 } as const;

/** `zone:<id>` — the unlock id shape §10 stores in `MetaSave.unlocks`. */
function unlockId(zone: ZoneDef): string {
  return `zone:${zone.id}`;
}

function isUnlocked(zone: ZoneDef): boolean {
  return zone.unlockShards === 0 || hasUnlock(unlockId(zone));
}

/**
 * "+8% BURNISHED · +4% GILDED" — the loot bias in the player's language. §11 is
 * explicit that tier NAMES render in ink, never in the tier colour, so the
 * colour lives in the swatch beside the line and not in the words.
 */
function lootBiasLine(zone: ZoneDef): string {
  const parts: string[] = [];
  for (const [tier, shift] of Object.entries(zone.lootBias)) {
    const name = TIER_NAMES[Number(tier) - 1];
    if (name !== undefined) parts.push(`+${shift}% ${name.toUpperCase()}`);
  }
  return parts.length === 0 ? 'NO LOOT BIAS' : parts.join('  ·  ');
}

/**
 * The tier a card wears as its swatch. On a TIE the HIGHER tier wins:
 * Widow's Crown biases Gilded and Dread by the same +6, and its identity is
 * unambiguously Dread — a card that advertised the lesser of two equal biases
 * would undersell the zone the player pays 1600 shards to reach.
 */
function headlineTier(zone: ZoneDef): number {
  let best = 1;
  let bestShift = -1;
  for (const [tier, shift] of Object.entries(zone.lootBias)) {
    if (shift >= bestShift) {
      bestShift = shift;
      best = Math.max(best, Number(tier));
    }
  }
  return best;
}

/**
 * Shrinks a label until it fits `maxWidth`. The zone names are content, not
 * layout, so the layout has to absorb them: "ASHEN OUTLANDS" at 36px runs
 * straight under the unlock pill, and clipping or wrapping a two-word name in a
 * 150px card is worse than one size step down.
 */
function fitLabel(text: Phaser.GameObjects.Text, maxWidth: number, from: number): void {
  let size = from;
  text.setFontSize(size);
  while (text.width > maxWidth && size > 22) {
    size -= 2;
    text.setFontSize(size);
  }
}

interface ZoneCard {
  zone: ZoneDef;
  container: Phaser.GameObjects.Container;
  panel: Phaser.GameObjects.Graphics;
  unlockPill: Phaser.GameObjects.Graphics | null;
  unlockText: Phaser.GameObjects.Text | null;
  /** The padlock. Cleared for good the moment the zone is bought. */
  lock: Phaser.GameObjects.Graphics | null;
  shakeUntil: number;
}

export class MenuScene extends Phaser.Scene {
  private cards: ZoneCard[] = [];
  private selectedId = STARTING_ZONE.id;
  private shardText!: Phaser.GameObjects.Text;
  /** Null when the icon sheet is unloaded — the count alone still reads. */
  private shardIcon: Phaser.GameObjects.Image | null = null;

  constructor() {
    super(SCENES.menu);
  }

  create(): void {
    // A Scene INSTANCE survives scene.start() round-trips: every field above
    // outlives the children it described. Reset per-visit state at the top.
    this.cards = [];

    addBackground(this);
    const meta = loadMeta();

    // Pre-select the last zone played (run 1 = castle), so PLAY is one tap and
    // the tap-depth budget holds.
    const remembered = load<string>(LAST_ZONE_KEY, STARTING_ZONE.id);
    const rememberedZone = ZONES.find((z) => z.id === remembered);
    this.selectedId =
      rememberedZone !== undefined && isUnlocked(rememberedZone)
        ? rememberedZone.id
        : STARTING_ZONE.id;

    // The generated wordless crest sits above the wordmark, inside the band
    // between the shell's reserved top-left 315x75 and the y=200 titling line,
    // so it clears both. Titling itself stays below y=200 and centred.
    if (this.textures.exists(TEXTURE.logo)) {
      this.add.image(VIEW.centerX, 150, TEXTURE.logo).setDisplaySize(100, 100);
    }
    this.add
      .text(VIEW.centerX, 232, 'DUSKHAUL', { ...TEXT.title, fontSize: '76px', color: CSS.ink })
      .setOrigin(0.5);
    this.add
      .text(VIEW.centerX, 300, 'Rob the dark. Get out before it closes.', {
        ...TEXT.label,
        color: CSS.inkSoft,
      })
      .setOrigin(0.5);

    // Shard total, pinned top-right at its authored coordinate. The count is
    // right-aligned to 680 so its LEFT edge moves with the digit count: the
    // glyph is therefore placed against the measured edge, not at a fixed
    // 680-96, which left a 68px hole beside a 1-digit total.
    this.shardText = this.add
      .text(SHARDS.x, SHARDS.y, `${meta.currency}`, {
        ...TEXT.heading,
        fontSize: '34px',
        color: CSS.accent,
      })
      .setOrigin(1, 0);
    this.shardIcon =
      this.textures.exists(ICON.shard.key)
        ? this.add.image(0, SHARDS.y + 18, ICON.shard.key, ICON.shard.frame).setDisplaySize(30, 30)
        : null;
    this.layoutShardCluster();

    // The shipped `bg-menu` backdrop was measured: luma 15 across its top 30%
    // and its bottom 30%, but a BRIGHT BAND peaking at luma 181 across 45-60%.
    // Cards 3 and 4 span that band, so they get the §14.4 scrim (`#03040b` at
    // 0.80, measured to hold `ink` and `inkSoft` above 4.5:1 over surfaces up
    // to pure white). Cards 1-2 and the title sit over luma 15 and need none —
    // veiling the whole frame would throw away art that is already correct.
    const brightFirst = 2;
    const brightTop = CARD.firstY + brightFirst * (CARD.height + CARD.gap) - CARD.height / 2;
    const brightBottom = CARD.firstY + 3 * (CARD.height + CARD.gap) + CARD.height / 2;
    paintScrim(
      this,
      VIEW.centerX,
      (brightTop + brightBottom) / 2,
      // `paintScrim` adds its own 16px pad on every side, so the band is asked
      // for 32px narrower than the safe width and lands exactly on 40-680.
      CARD.width - 32,
      brightBottom - brightTop,
    );

    ZONES.forEach((zone, index) => {
      this.cards.push(this.buildCard(zone, CARD.firstY + index * (CARD.height + CARD.gap)));
    });

    const play = new Button(this, VIEW.centerX, PLAY.y, 'PLAY', () => this.startRun(), {
      width: PLAY.width,
      height: PLAY.height,
      ...BUTTON_STYLE.primary,
    });

    // Three secondary controls share the footer row: STASH is the §14b door to
    // the shop, and the two toggles are state the player must be able to see.
    const footerWidth = (PLAY.width - FOOTER.gap * 2) / 3;
    const footerStyle = {
      width: footerWidth,
      height: FOOTER.height,
      ...BUTTON_STYLE.idle,
      fontSize: '28px',
    };
    const stash = new Button(
      this,
      VIEW.centerX - footerWidth - FOOTER.gap,
      FOOTER.y,
      'STASH',
      () => this.scene.start(SCENES.meta),
      footerStyle,
    );
    const muteButton = new Button(
      this,
      VIEW.centerX,
      FOOTER.y,
      isMuted() ? 'SOUND OFF' : 'SOUND ON',
      () => muteButton.setLabel(toggleMute() ? 'SOUND OFF' : 'SOUND ON'),
      footerStyle,
    );
    const dailyButton = new Button(
      this,
      VIEW.centerX + footerWidth + FOOTER.gap,
      FOOTER.y,
      isDailyMode() ? 'DAILY ON' : 'DAILY OFF',
      () => {
        setDailyMode(!isDailyMode());
        dailyButton.setLabel(isDailyMode() ? 'DAILY ON' : 'DAILY OFF');
      },
      footerStyle,
    );

    // THE ENTRANCE MOVES PIXELS, NEVER HIT AREAS. Every control here slides in
    // through `enterPinningHitArea`, which offsets each hit rect by the inverse
    // of the slide so the target is live at its FINAL position from frame one.
    // The measured cost of not doing that was 1-3 taps to start a run across
    // four cold starts, and one automated attempt that tapped PLAY's final
    // position and then sat on the menu for 300s.
    //
    // PLAY also leads the stagger instead of trailing it. It used to enter at
    // +220ms, dead last, so the one control the whole screen exists to offer
    // was the last thing to arrive; the zone cards it was waiting for are a
    // refinement of a choice that is already remembered and pre-selected.
    this.cards.forEach((card, index) =>
      enterPinningHitArea(this, card.container, 60 + index * 40),
    );
    enterPinningHitArea(this, play, 0);
    enterPinningHitArea(this, stash, 220);
    enterPinningHitArea(this, muteButton, 220);
    enterPinningHitArea(this, dailyButton, 220);

    this.refresh();

    // SPACE mirrors PLAY exactly — keyboard and touch must never start
    // different things.
    this.input.keyboard?.once('keydown-SPACE', () => this.startRun());
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => {
      unlockAudio();
      sfx('ui', { volume: 0.5 });
    });

    this.cameras.main.fadeIn(240, 0, 0, 0);
    startMusic('menu');
  }

  private buildCard(zone: ZoneDef, centerY: number): ZoneCard {
    const container = this.add.container(VIEW.centerX, centerY);
    const panel = drawDuskPanel(this, CARD.width, CARD.height);
    container.add(panel);

    const left = -CARD.width / 2;

    // The card's tier swatch: identity colour with its mandatory 2px ring
    // (tier 2 Burnished is 2.91:1 unringed, below the graphical floor).
    const tier = headlineTier(zone);
    const swatch = this.add.graphics();
    swatch.fillStyle(tierColor(tier), 1);
    swatch.fillCircle(left + 46, -34, 16);
    swatch.lineStyle(2, IDENTITY.cooled, 1);
    swatch.strokeCircle(left + 46, -34, 16);
    container.add(swatch);

    // Every label here sits on the card's own panel, so all of them go BARE:
    // the panel is the measured contrast surface and doubled armour at this
    // size reads as grime.
    const name = this.add
      .text(left + 78, -58, zone.name.toUpperCase(), {
        ...TEXT.button,
        color: CSS.ink,
        ...bareText(),
      })
      .setOrigin(0, 0);
    // A locked card's name shares the row with the unlock pill, which starts at
    // x = width/2 - pillWidth - 20. Fit the name inside what is left, or
    // "ASHEN OUTLANDS" runs under the price.
    const nameRoom =
      (zone.unlockShards > 0 ? CARD.width / 2 - UNLOCK_PILL.width - 32 : CARD.width / 2 - 24) -
      (left + 78);
    fitLabel(name, nameRoom, 36);
    const threat = this.add
      .text(left + 24, -4, `THREAT x${zone.threatBase.toFixed(2)}`, {
        ...TEXT.body,
        fontSize: '26px',
        color: CSS.warn,
        ...bareText(),
      })
      .setOrigin(0, 0);
    const loot = this.add
      .text(left + 24, 34, lootBiasLine(zone), {
        ...TEXT.label,
        fontSize: '24px',
        color: CSS.inkSoft,
        ...bareText(),
      })
      .setOrigin(0, 0);
    container.add([name, threat, loot]);

    let unlockPill: Phaser.GameObjects.Graphics | null = null;
    let unlockText: Phaser.GameObjects.Text | null = null;
    let lock: Phaser.GameObjects.Graphics | null = null;
    if (zone.unlockShards > 0) {
      const pillX = CARD.width / 2 - UNLOCK_PILL.width / 2 - 20;

      // §14.5 requires a LOCK GLYPH, not only a price: a bare number reads as
      // a cost you may pay now, where a padlock says the door is shut. Drawn
      // with primitives — generated art in the UI is limited to icon glyphs,
      // the emblem and the backdrop, and no padlock glyph is in the sheet.
      lock = this.add.graphics({ x: pillX - UNLOCK_PILL.width / 2 - 24, y: 0 });
      lock.fillStyle(PALETTE.inkSoft, 0.9);
      lock.fillRoundedRect(-11, -2, 22, 17, 3);
      lock.lineStyle(3, PALETTE.inkSoft, 0.9);
      lock.beginPath();
      lock.arc(0, -2, 7, Math.PI, 0);
      lock.strokePath();

      unlockPill = this.add.graphics({ x: pillX, y: 0 });
      unlockText = this.add
        .text(pillX, 0, '', { ...TEXT.button, fontSize: '30px', ...bareText() })
        .setOrigin(0.5);
      container.add([lock, unlockPill, unlockText]);

      // Its own hit zone rather than a `Button`, because this pill lives inside
      // a container whose card body is ALSO interactive: an explicit zone in
      // front keeps the two taps from fighting, and the pill must win.
      const pillZone = this.add
        .zone(pillX, 0, UNLOCK_PILL.width, UNLOCK_PILL.height)
        .setInteractive({ useHandCursor: true });
      // Click semantics, not release semantics: arm on our own POINTER_DOWN and
      // disarm on POINTER_OUT, or letting go of a drag over this pill buys a
      // zone the player never chose.
      let armed = false;
      pillZone.on(Phaser.Input.Events.POINTER_DOWN, () => {
        armed = true;
      });
      pillZone.on(Phaser.Input.Events.POINTER_OUT, () => {
        armed = false;
      });
      pillZone.on(Phaser.Input.Events.POINTER_UP, () => {
        if (!armed) return;
        armed = false;
        this.tryUnlock(zone);
      });
      container.add(pillZone);
    }

    // The card body: selects when unlocked, refuses visibly when not.
    const body = this.add
      .zone(0, 0, CARD.width, CARD.height)
      .setInteractive({ useHandCursor: true });
    let bodyArmed = false;
    body.on(Phaser.Input.Events.POINTER_DOWN, () => {
      bodyArmed = true;
    });
    body.on(Phaser.Input.Events.POINTER_OUT, () => {
      bodyArmed = false;
    });
    body.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!bodyArmed) return;
      bodyArmed = false;
      this.tapCard(zone);
    });
    // Behind the unlock pill in the display list, so the pill keeps its tap:
    // Phaser hands the pointer to the TOPMOST interactive object only.
    container.addAt(body, 1);

    return { zone, container, panel, unlockPill, unlockText, lock, shakeUntil: 0 };
  }

  private tapCard(zone: ZoneDef): void {
    if (isUnlocked(zone)) {
      if (this.selectedId === zone.id) return;
      this.selectedId = zone.id;
      sfx('ui');
      this.refresh();
      return;
    }
    // §14b: locked card tapped -> shake + price pulse in `warn`. No modal, no
    // navigation, and no silent nothing — a refusal that says nothing is a bug.
    sfx('hit', { volume: 0.5 });
    this.refuse(zone);
  }

  private refuse(zone: ZoneDef): void {
    const card = this.cards.find((c) => c.zone.id === zone.id);
    if (card === undefined) return;
    // Guard against a stacked shake: re-tapping a locked card mid-shake would
    // otherwise leave the container off its baseline x.
    if (this.time.now < card.shakeUntil) return;
    card.shakeUntil = this.time.now + 260;

    this.tweens.add({
      targets: card.container,
      x: { from: VIEW.centerX - 12, to: VIEW.centerX },
      duration: 240,
      ease: 'Elastic.easeOut',
    });
    if (card.unlockText !== null) {
      this.tweens.add({
        targets: card.unlockText,
        scale: { from: 1.22, to: 1 },
        duration: 260,
        ease: 'Quad.easeOut',
      });
    }
  }

  private tryUnlock(zone: ZoneDef): void {
    if (isUnlocked(zone)) return;
    const result = spendCurrency(zone.unlockShards);
    if (!result.ok) {
      sfx('hit', { volume: 0.5 });
      this.refuse(zone);
      return;
    }
    grantUnlock(unlockId(zone));
    sfx('levelup', { volume: 0.6 });
    // Buying a zone selects it: nobody spends 1600 shards to keep playing the
    // old one.
    this.selectedId = zone.id;
    this.refresh();
  }

  /**
   * Keeps the shard glyph welded to the left edge of the count, which moves
   * with the digit count because the number is right-aligned to (680, 24).
   */
  private layoutShardCluster(): void {
    if (this.shardIcon === null) return;
    this.shardIcon.setX(this.shardText.getBounds().left - 8 - this.shardIcon.displayWidth / 2);
  }

  /** Repaints every card's lock/selection state and the shard total. */
  private refresh(): void {
    const meta = loadMeta();
    this.shardText.setText(`${meta.currency}`);
    this.layoutShardCluster();

    for (const card of this.cards) {
      const unlocked = isUnlocked(card.zone);
      const selected = unlocked && card.zone.id === this.selectedId;

      // A selected card is stroked in `primary` at full alpha; a locked one
      // dims but keeps its price legible (state honesty: never hide the goal).
      paintPanel(
        card.panel,
        CARD.width,
        CARD.height,
        panelStyle(CARD.width, {
          stroke: selected ? PALETTE.primary : PANEL.stroke,
          strokeAlpha: selected ? 0.95 : PANEL.strokeAlpha,
          strokeWidth: selected ? 4 : PANEL.strokeWidth,
        }),
      );
      // A locked card dims, but only slightly: 0.72 stacked on a 0.4 price
      // alpha measured at 0.29 effective, which is not "legible but dimmed",
      // it is hidden. The lock state is carried by the padlock and the pill,
      // not by drowning the card.
      card.container.setAlpha(unlocked ? 1 : 0.88);

      if (card.unlockPill === null || card.unlockText === null) continue;
      if (unlocked) {
        // §14b: once every zone is unlocked the locks and prices VANISH and the
        // cards are pure selectors.
        card.unlockPill.clear();
        card.unlockText.setVisible(false);
        card.lock?.clear();
        continue;
      }

      const affordable = meta.currency >= card.zone.unlockShards;
      card.unlockText.setVisible(true);
      card.unlockText.setText(`${card.zone.unlockShards}`);
      // Affordable: an `accent` FILL carrying a deep-ink label (§11's route for
      // a saturated tone at size). Unaffordable: the disabled chrome, but the
      // PRICE ITSELF stays at full alpha in `ink` — §14b's state-honesty rule
      // is "prices stay legible", and a 40% number on an already-dimmed card
      // is exactly the goal-hiding it forbids. The 40% goes on the pill's
      // housing, which is the part that means "not yet".
      card.unlockText.setColor(affordable ? DEEP_INK_CSS : CSS.ink);
      card.unlockText.setAlpha(1);
      paintPill(card.unlockPill, UNLOCK_PILL.width, UNLOCK_PILL.height, {
        fill: affordable ? PALETTE.accent : PANEL.fill,
        fillAlpha: affordable ? 0.92 : 0.75,
        stroke: affordable ? PALETTE.accent : PANEL.stroke,
        strokeAlpha: affordable ? 1 : 0.7,
        strokeWidth: 2,
      });
      card.unlockPill.setAlpha(affordable ? 1 : DISABLED_ALPHA + 0.35);
    }
  }

  private startRun(): void {
    track(isDailyMode() ? 'daily-start' : 'session-start');
    save(LAST_ZONE_KEY, this.selectedId);
    this.cameras.main.fadeOut(180, 0, 0, 0);
    // The zone is passed EXPLICITLY and the rest of the payload left empty:
    // Phaser keeps the previous start's settings.data when none is passed, so a
    // bare start after RETRY ({seed}) would silently replay that seed and
    // bypass this screen entirely.
    this.time.delayedCall(190, () => this.scene.start(SCENES.game, { zone: this.selectedId }));
  }
}
