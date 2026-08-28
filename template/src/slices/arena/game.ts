import Phaser from 'phaser';
import { PALETTE, SAFE, TUNING, VIEW } from '../../config';
import { EVENTS, SCENES } from '../../core/keys';
import { Controls } from '../../core/controls';
import { Joystick } from '../../ui/joystick';
import { Rng } from '../../core/rng';
import { setDamageClock } from '../../core/damage';
import { RunDirector, type EventSpec } from '../../core/run';
import { metaModifiers } from '../../core/progression';
import { rollUpgradeChoices, type UpgradeDef, type UpgradeRollContext } from '../../data/upgrades';
import { PHASES, WAVES, TIMELINE_EVENTS } from '../../data/waves';
import { ANIM } from '../../data/art';
import type { EnemyDef } from '../../data/enemies';
import { applyEffect } from '../../core/effects';
import { sfx } from '../../core/audio';
import { startMusic, setMusicIntensity, setMusicLayer } from '../../core/music';
import { burst, flash, floatText, hitstop, playFx, shake } from '../../core/juice';
import { Arena } from '../../systems/arena';
import { CombatSystem } from '../../systems/combat';
import { Hud, type HudModel } from '../../ui/hud';
import { showUpgradeCards, type UpgradeCardsHandle } from '../../ui/cards';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { Button } from '../../ui/button';

/**
 * `art/manifest.json` groups this slice loads. `PreloadScene` downloads only
 * these, so a game never ships another family's art. Names must match the
 * manifest `group` fields exactly; adding art for this slice means adding its
 * group here too.
 */
export const ART_GROUPS = [
  'hero',
  'enemies-light',
  'enemies-heavy',
  'pickups-fx',
  'ui',
  'props',
  'arena',
  'bg',
] as const;

/**
 * Integrator scene: owns nothing gameplay-specific itself, wires the systems
 * together and translates their callbacks into feedback and UI.
 *
 * Replaceable per game: the systems it constructs (`CombatSystem`, wave data)
 * and the reward handling. Keep the shape — director drives time, a system owns
 * entities, the HUD is fed a model, the draft pauses the run.
 */
export class GameScene extends Phaser.Scene {
  private rng!: Rng;
  private seed = '';
  private simTimeMs = 0;
  private arena!: Arena;
  private controls!: Controls;
  private joystick!: Joystick;
  private combat!: CombatSystem;
  private director!: RunDirector;
  private hud!: Hud;
  private pauseButton!: Button;

  private kills = 0;
  private score = 0;
  private scoreCarry = 0;
  private currency = 0;
  private taken: string[] = [];
  private drafting = false;
  private paused = false;
  private ended = false;
  private cards: UpgradeCardsHandle | null = null;
  private pauseOverlay: PauseOverlayHandle | null = null;
  private rerollUsedThisDraft = false;
  private bossActive = false;
  private floatBudget = TUNING.caps.floatTextPerSecond;
  private floatWindowMs = 0;
  private readonly model: HudModel = {
    hp: TUNING.player.maxHp,
    hpMax: TUNING.player.maxHp,
    level: 1,
    xp: 0,
    xpNeeded: 1,
    timeMs: 0,
    runSeconds: TUNING.runSeconds,
    currency: 0,
    kills: 0,
    phase: '',
  };

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, { seed })` reruns the exact same run; omit for a fresh one. */
  init(data: { seed?: string } = {}): void {
    this.seed = data.seed ?? Date.now().toString(36);
  }

  create(): void {
    this.kills = 0;
    this.score = 0;
    this.scoreCarry = 0;
    this.currency = 0;
    this.taken = [];
    this.drafting = false;
    this.paused = false;
    this.ended = false;
    this.cards = null;
    this.pauseOverlay = null;
    this.rerollUsedThisDraft = false;
    this.bossActive = false;
    this.simTimeMs = 0;

    // One seed drives the entire run — arena layout, spawns and upgrade rolls —
    // so the same seed always replays identically.
    this.rng = new Rng(this.seed);
    // The damage clock ticks only while the run is actually advancing (see
    // `update`), so i-frames can't be swallowed by wall-clock time passing
    // during a paused run or an upgrade draft.
    setDamageClock(() => this.simTimeMs);

    // The arena owns the field: floor, walls, props and the world/camera bounds.
    this.arena = new Arena(this, this.seed);

    // === BEGIN replaceable gameplay ===
    this.combat = new CombatSystem(
      this,
      this.rng,
      this.arena,
      {
        onEnemyKilled: (def, x, y) => this.onEnemyKilled(def, x, y),
        onPlayerHit: (ratio) => this.onPlayerHit(ratio),
        onPlayerDied: () => this.finish(false),
        onLevelUp: (level, gained) => this.onLevelUp(level, gained),
        onPlayerAttack: () => sfx('tap', { volume: 0.25 }),
        onBossSpawned: () => this.onBossSpawned(),
        onBossKilled: () => this.finish(true),
        onWeaponEvolved: (name) => this.onWeaponEvolved(name),
        onCoinCollected: (value) => this.onCoinCollected(value),
      },
      metaModifiers(),
    );

    this.cameras.main.startFollow(
      this.combat.player,
      true,
      TUNING.arena.cameraLerp,
      TUNING.arena.cameraLerp,
    );
    // Bias the view upward so the player sits below the HUD band instead of
    // disappearing behind it at the arena's top edge.
    this.cameras.main.setFollowOffset(0, TUNING.arena.cameraOffsetY);

    this.hud = new Hud(this);

    this.director = new RunDirector(
      this,
      WAVES,
      PHASES,
      (id, _index, _total, pattern) => this.combat.spawn(id, this.director.difficulty, pattern),
      {
        durationSeconds: TUNING.runSeconds,
        onPhaseChange: (phase) => {
          this.model.phase = phase.name;
          this.game.events.emit(EVENTS.phaseChanged, phase);
          sfx('whoosh', { volume: 0.5 });
        },
        onEvent: (event) => this.onScriptedEvent(event),
        events: TIMELINE_EVENTS,
      },
    );
    // Grace window: the director starts immediately, but data/waves.ts keeps the
    // first wave after TUNING.graceSeconds so the player can learn the verb.
    // === END replaceable gameplay ===

    // Movement is the joystick; `Controls` stays for keyboard parity and for
    // any tap/swipe actions a game adds on top.
    this.joystick = new Joystick(this);
    this.controls = new Controls(this);

    this.pauseButton = new Button(this, VIEW.width - SAFE.side - 44, SAFE.top / 2, 'II', () => this.togglePause(), {
      width: 88,
      height: 88,
      fill: PALETTE.bgTop,
      stroke: PALETTE.primary,
      textColor: '#e8ecf6',
      fontSize: '36px',
    });
    this.pauseButton.setDepth(1500);

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());

    this.game.events.emit(EVENTS.runStarted);
    this.cameras.main.fadeIn(220, 0, 0, 0);

    startMusic('run');
    setMusicIntensity(0.25);
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;

    this.controls.update();
    const player = this.combat.player;
    // Keyboard wins while a key is held; otherwise the stick drives movement.
    if (this.controls.axisX !== 0 || this.controls.axisY !== 0) {
      player.setAxis(this.controls.axisX, this.controls.axisY);
    } else {
      player.setAxis(this.joystick.vector.x, this.joystick.vector.y);
    }

    if (!this.drafting && !this.paused) {
      this.director.update(delta);
      this.combat.update(delta, this.director.difficulty);

      this.scoreCarry += (TUNING.economy.scorePerSecond * delta) / 1000;
      if (this.scoreCarry >= 1) {
        const whole = Math.floor(this.scoreCarry);
        this.scoreCarry -= whole;
        this.score += whole;
      }

      setMusicIntensity(0.25 + 0.75 * Math.min(1, this.director.difficulty / 2.6));

      if ((this.director.remainingSeconds ?? 1) <= 0) {
        this.finish(true);
        return;
      }
    }

    // Sim time backs the damage clock's i-frames: it must not advance while
    // paused or drafting, or a pause/draft would silently expire i-frames.
    if (!this.drafting && !this.paused && !this.director.isPaused) {
      this.simTimeMs += delta;
    }

    this.floatWindowMs += delta;
    if (this.floatWindowMs >= 1000) {
      this.floatWindowMs = 0;
      this.floatBudget = TUNING.caps.floatTextPerSecond;
    }

    this.model.hp = Math.ceil(player.health.hp);
    this.model.hpMax = player.health.max;
    this.model.level = player.level;
    this.model.xp = player.xp;
    this.model.xpNeeded = player.xpNeeded();
    this.model.timeMs = this.director.elapsedSeconds * 1000;
    this.model.currency = this.currency;
    this.model.kills = this.kills;
    this.hud.set(this.model);
  }

  /** Rewards, feedback and the effect caps that keep 200+ entities at 60fps. */
  private onEnemyKilled(def: EnemyDef, x: number, y: number): void {
    this.kills += 1;
    this.score += TUNING.economy.scorePerKill;

    if (def.id === 'boss') this.currency += TUNING.economy.currencyPerBoss;
    // Elites drop `TUNING.economy.currencyPerElite` as pooled coin pickups
    // (see `CombatSystem.dropCoins`) instead of a lump instant grant, so this
    // tally only adds the small flat per-kill bonus every kill gets.
    else this.currency += TUNING.economy.currencyPerKill;

    const big = def.id === 'boss' || def.id === 'elite';
    burst(this, x, y, def.tint, big ? 26 : 8, big ? 460 : 260);
    if (big) {
      this.punch(0.014, 220);
      sfx('levelup', { volume: 0.7 });
      floatText(this, x, y, def.id.toUpperCase(), '#ffd166', 52);
    } else if (this.floatBudget > 0) {
      this.floatBudget -= 1;
      floatText(this, x, y, `+${TUNING.economy.scorePerKill}`, '#8fa1c7', 34);
    }
  }

  private onCoinCollected(value: number): void {
    this.currency += value;
    sfx('pickup', { volume: 0.35 });
  }

  private onPlayerHit(ratio: number): void {
    this.hud.flashDamage();
    flash(this, PALETTE.bad, ratio < 0.3 ? 200 : 110);
    this.punch(0.012, 180);
    hitstop(this, 55);
    sfx('hit');
  }

  /** Shake is suppressed at high entity counts — it reads as noise, not impact. */
  private punch(intensity: number, durationMs: number): void {
    if (this.combat.aliveEnemies() > TUNING.caps.shakeEntityLimit) return;
    shake(this, intensity, durationMs);
  }

  private onLevelUp(level: number, gained: number): void {
    this.game.events.emit(EVENTS.levelUp, level);
    sfx('levelup');
    flash(this, PALETTE.accent, 140);
    playFx(this, ANIM.levelUpBurst, this.combat.player.x, this.combat.player.y, 320);
    if (this.drafting) return;
    this.openDraft(gained);
  }

  private onBossSpawned(): void {
    this.bossActive = true;
    setMusicLayer('boss', true);
  }

  private onWeaponEvolved(name: string): void {
    sfx('levelup', { volume: 0.8 });
    floatText(this, this.combat.player.x, this.combat.player.y - 80, `${name.toUpperCase()}!`, '#ffd166', 46);
  }

  /** Chest/breather/elite-rush timeline events, wired into `RunDirector.onEvent`. */
  private onScriptedEvent(event: EventSpec): void {
    switch (event.kind) {
      case 'chest':
        sfx('pickup', { volume: 0.6 });
        floatText(this, this.combat.player.x, this.combat.player.y - 100, 'CHEST!', '#ffd166', 48);
        this.openDraft(1);
        break;
      case 'breather':
        sfx('whoosh', { volume: 0.4 });
        floatText(this, this.combat.player.x, this.combat.player.y - 100, 'BREATHER', '#8fe3a5', 40);
        this.combat.player.health.heal(this.combat.player.health.max * TUNING.events.breatherHealRatio);
        this.combat.silenceSpawns(TUNING.events.breatherSilenceMs);
        break;
      case 'elite-rush': {
        sfx('die', { volume: 0.3 });
        floatText(this, this.combat.player.x, this.combat.player.y - 100, 'ELITE RUSH', '#ff6b6b', 44);
        const baseAngle = this.rng.float(0, Math.PI * 2);
        const count = TUNING.events.eliteRushCount;
        for (let i = 0; i < count; i += 1) {
          const angle = baseAngle + (i - (count - 1) / 2) * 0.5;
          const dist = VIEW.width / 2 + TUNING.enemy.spawnMargin + 60;
          this.combat.spawnAtPosition(
            'elite',
            this.combat.player.x + Math.cos(angle) * dist,
            this.combat.player.y + Math.sin(angle) * dist,
            this.director.difficulty,
          );
        }
        break;
      }
    }
  }

  /** Pauses the run (not the scene) and shows the pick-1-of-N overlay. */
  private openDraft(pendingLevels: number): void {
    const context: UpgradeRollContext = {
      ownedWeapons: this.combat.equippedWeapons().map((w) => w.id),
      hasFreeWeaponSlot: this.combat.hasFreeWeaponSlot(),
    };
    const choices = rollUpgradeChoices(this.rng, this.taken, TUNING.draft.choices, context);
    if (choices.length === 0) return;

    this.drafting = true;
    this.rerollUsedThisDraft = false;
    this.combat.setPaused(true);
    this.director.pause();
    this.joystick.setEnabled(false);

    this.cards = showUpgradeCards(
      this,
      choices,
      (choice: UpgradeDef) => {
        this.applyUpgrade(choice);
        this.cards?.destroy();
        this.cards = null;
        if (pendingLevels > 1) {
          this.openDraft(pendingLevels - 1);
          return;
        }
        this.drafting = false;
        this.combat.setPaused(false);
        this.director.resume();
        this.joystick.setEnabled(true);
      },
      {
        rerollCost: TUNING.draft.rerollCost,
        canReroll: () => !this.rerollUsedThisDraft && this.currency >= TUNING.draft.rerollCost,
        onReroll: () => {
          this.rerollUsedThisDraft = true;
          this.currency -= TUNING.draft.rerollCost;
          const excluded = [...this.taken, ...choices.map((c) => c.id)];
          return rollUpgradeChoices(this.rng, excluded, TUNING.draft.choices, context);
        },
      },
    );
  }

  private applyUpgrade(choice: UpgradeDef): void {
    this.taken.push(choice.id);
    if (choice.kind === 'weapon-unlock' && choice.weapon !== undefined) {
      this.combat.unlockWeapon(choice.weapon);
    } else if (choice.kind === 'weapon-boost' && choice.weapon !== undefined) {
      this.combat.boostWeapon(choice.weapon);
    }
    for (const mod of choice.modifiers) {
      this.combat.player.applyModifier({ ...mod, source: `card:${choice.id}:${this.taken.length}` });
    }
    if (choice.effect !== undefined) {
      applyEffect(choice.effect, { player: this.combat.player }, this.combat.effects);
    }
    burst(this, VIEW.centerX, VIEW.centerY, PALETTE.accent, 18, 340);
  }

  private togglePause(): void {
    if (this.ended || this.drafting) return;
    if (this.paused) {
      this.resumeFromPause();
    } else {
      this.paused = true;
      this.director.pause();
      this.combat.setPaused(true);
      this.joystick.setEnabled(false);
      this.game.events.emit(EVENTS.paused);
      this.pauseOverlay = showPauseOverlay(
        this,
        () => this.resumeFromPause(),
        () => {
          this.pauseOverlay?.destroy();
          this.pauseOverlay = null;
          this.scene.start(SCENES.game);
        },
      );
    }
  }

  private resumeFromPause(): void {
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.director.resume();
    this.combat.setPaused(false);
    this.joystick.setEnabled(true);
    this.game.events.emit(EVENTS.resumed);
  }

  private finish(won: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.cards?.destroy();
    this.pauseOverlay?.destroy();
    this.combat.setPaused(true);
    this.director.pause();
    this.joystick.setEnabled(false);

    sfx(won ? 'levelup' : 'die');
    flash(this, won ? PALETTE.good : PALETTE.bad, 260);
    shake(this, 0.02, 300);

    if (this.bossActive) setMusicLayer('boss', false);
    setMusicIntensity(0.2);

    const timeMs = this.director.elapsedSeconds * 1000;
    const currencyEarned = this.currency + (won ? TUNING.economy.winBonus : 0);
    this.game.events.emit(EVENTS.runEnded, { won, score: this.score });

    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.time.delayedCall(360, () => {
      this.scene.start(SCENES.gameOver, {
        won,
        timeMs,
        kills: this.kills,
        score: this.score,
        currencyEarned,
        level: this.combat.player.level,
        seed: this.seed,
      });
    });
  }
}
