import Phaser from 'phaser';
import { TUNING } from '../config';
import { TEX } from '../core/keys';
import type { Rng } from '../core/rng';
import type { ArtSlot } from '../data/art';
import { enemiesForZone, exclusiveEnemies, type EnemyDef } from '../data/enemies';
import { DECALS_BY_ZONE, PROPS_BY_ZONE } from '../data/props';
import { ZONE_DESIGN_SIZE, type ZoneDef } from '../data/zones';
import { FLOOR_GRADE, IDENTITY } from '../ui/duskChrome';
import type { Arena, ArenaLayout } from './arena';
import type { GateSpec } from './extraction';

/**
 * Applies one `ZoneDef` (PRD §5.7 / §16.1) to the live arena for the whole
 * run: floor art, gate positions scaled out of the PRD's 1600x1600 design
 * space, the spawn-table bias that lets the zone's two exclusive archetypes
 * in, and the zone hazard as a REAL mechanic rather than a decal.
 *
 * There is no mid-run zone travel (§5.7), so a `ZoneSystem` is constructed
 * once in the scene's `create` and torn down with the scene.
 *
 * Performance contract (§15): every hazard node is allocated up front — six
 * braziers, three ash zones, five pits, or four ice sheets plus five torches,
 * so the worst zone costs 9 extra sprites plus 9 field rings against a
 * 300-sprite budget. `update` allocates nothing, creates no tweens and redraws
 * no Graphics: field rings are pre-sized `Image`s whose alpha/visibility is
 * written numerically, and `pickSpawnId` runs off cached, pre-sorted tables.
 *
 * Balance discipline: every number a hazard uses comes from
 * `ZoneDef.hazard.params` (content, `data/zones.ts`) or `TUNING`. A missing
 * required param THROWS — an unauthored hazard number is a content bug and
 * must be loud, never silently defaulted into a different game.
 */

export type ZoneHazardKind = ZoneDef['hazard']['kind'];

/**
 * How a hazard reaches the rest of the run. The zone system never plays sfx,
 * shakes the camera or touches the bag itself — the slice owns feedback, and
 * the extraction channel needs to know a hazard hit counts as a hit.
 */
export interface ZoneHooks {
  /**
   * A discrete hazard strike landed on the player. Routed through `Health` by
   * the slice, so i-frames apply and the extraction channel reacts (PRD §2A).
   */
  onHazardHit(amount: number, x: number, y: number): void;
  /**
   * Continuous environmental drain (ash dots, the desert scorch): hp already
   * multiplied by the frame's delta. Bypasses i-frames — a damage-over-time
   * field that i-frames swallow is not a field, it is a decoration.
   */
  onHazardDrain(amount: number): void;
  /** A hazard armed its telegraph — the slice's cue to warn, once per arming. */
  onHazardTelegraph(kind: ZoneHazardKind, x: number, y: number): void;
  /** A hazard fired, whether or not it connected — the slice's cue to sell it. */
  onHazardStrike(kind: ZoneHazardKind, x: number, y: number): void;
}

/** The moving thing a hazard acts on. `Player` satisfies this structurally. */
export interface ZoneSubject {
  x: number;
  y: number;
  readonly body: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | null;
  readonly stats: {
    addModifier(mod: { stat: string; mul: number; source: string }): void;
    removeBySource(source: string): void;
  };
}

/** Modifier tag every zone slow is pushed under, so one removal clears them all. */
const ZONE_SLOW_SOURCE = 'zone:slow';

/**
 * Hazard art, addressed through the registry keys `art/manifest.json` defines.
 * Each zone's prop sheet is a 3x3 icon sheet, so a hazard node is one frame of
 * it. Absent art falls back to a tinted procedural disc — the §11 crash-safety
 * path, never the shipping look.
 */
const HAZARD_NODE_ART: Record<ZoneHazardKind, ArtSlot> = {
  braziers: { key: 'props-castle-a', frame: 0 }, // brazier-lit
  bonestorm: { key: 'props-outlands-a', frame: 7 }, // mudpool, reads as an ash slick
  sinksand: { key: 'props-desert-a', frame: 4 }, // pit
  gale: { key: 'props-winter-a', frame: 3 }, // icesheet
};
/** The cold frame a brazier sits on between pulses. */
const BRAZIER_COLD: ArtSlot = { key: 'props-castle-a', frame: 1 };
/** Winter's torches — the only hazard node that is a SAFE island, not a threat. */
const GALE_TORCH_ART: ArtSlot = { key: 'props-winter-a', frame: 0 }; // torchring

/** Node fallback tint per hazard kind, used only when the prop sheet is absent. */
const HAZARD_FALLBACK_TINT: Record<ZoneHazardKind, number> = {
  braziers: IDENTITY.threat,
  bonestorm: IDENTITY.cooled,
  sinksand: IDENTITY.gilt,
  gale: IDENTITY.gateOpen,
};

/** Display size of a hazard's prop glyph; its FIELD is drawn at the real radius. */
const NODE_GLYPH_PX = 96;
/** Field rings sit under actors and props but over the floor decals. */
const FIELD_DEPTH = 4;
const NODE_DEPTH = 6;
/** Resting alpha of a persistent hazard field (pits, ice, ash, torchlight). */
const FIELD_ALPHA = 0.22;
/** Brazier telegraph: alpha at arming, and how much it swells before the strike. */
const TELEGRAPH_ALPHA_BASE = 0.15;
const TELEGRAPH_ALPHA_SWELL = 0.5;

/**
 * One hazard site. Threat nodes (braziers, pits, ash, ice) and safe nodes
 * (torches) share the record: `field` is the radius ring, `glyph` the prop.
 */
interface HazardNode {
  glyph: Phaser.GameObjects.Image;
  field: Phaser.GameObjects.Image;
  x: number;
  y: number;
  radius: number;
  /** Cycle offset in ms so sites do not pulse in unison. */
  phaseMs: number;
  /** Last completed cycle index — how a strike is detected exactly once. */
  cycle: number;
  /** Telegraph currently armed (braziers) — diffed so the cue fires once. */
  armed: boolean;
  /** Drifting nodes (ash) are only live during a gust. */
  live: boolean;
}

/** Reads a required hazard param. Absent = content bug, and it must be loud. */
function requireParam(zone: ZoneDef, key: string): number {
  const value = zone.hazard.params[key];
  if (value === undefined) {
    throw new Error(`Zone "${zone.id}" hazard "${zone.hazard.kind}" is missing param "${key}"`);
  }
  return value;
}

/**
 * The `ArenaLayout` a zone implies: the same field size as always, but the
 * zone's own floor tile, its own edge band, its own per-zone lighting grade
 * and its own prop/decal cells (`data/props.ts`), so a castle run scatters
 * castle masses and a desert run desert ones. `Arena` already falls back to
 * the template floor and then to a procedural tile, and to a tinted square
 * per prop, so a zone whose art has not landed still renders.
 *
 * `grade` is the Step 5.5 ground-lighting pass: the generated floor tiles came
 * out LIT rather than shadowed, so each zone multiplies its ground layer down
 * to a measured value. The table and its contrast reasoning live in
 * `ui/duskChrome.ts#FLOOR_GRADE` — this is the single consumer.
 */
export function zoneArenaLayout(zone: ZoneDef): ArenaLayout {
  return {
    width: TUNING.arena.width,
    height: TUNING.arena.height,
    floorKey: `floor-${zone.id}`,
    borderKey: `border-${zone.id}`,
    grade: FLOOR_GRADE[zone.id],
    propSet: PROPS_BY_ZONE[zone.id],
    decalSet: DECALS_BY_ZONE[zone.id],
  };
}

/**
 * The zone's three gates in LIVE arena coordinates. Authored coordinates are
 * in the PRD's 1600x1600 design space (§5.7), so the layout survives arena
 * resizing instead of drifting off the field.
 */
export function zoneGates(zone: ZoneDef): [GateSpec, GateSpec, GateSpec] {
  const sx = TUNING.arena.width / ZONE_DESIGN_SIZE;
  const sy = TUNING.arena.height / ZONE_DESIGN_SIZE;
  const scale = (gate: GateSpec): GateSpec => ({ ...gate, x: gate.x * sx, y: gate.y * sy });
  return [scale(zone.gates[0]), scale(zone.gates[1]), scale(zone.gates[2])];
}

export class ZoneSystem {
  readonly zone: ZoneDef;
  readonly gates: [GateSpec, GateSpec, GateSpec];

  private readonly scene: Phaser.Scene;
  private readonly rng: Rng;
  private readonly arena: Arena;
  private readonly subject: ZoneSubject;
  private readonly hooks: ZoneHooks;

  /** Threat sites: braziers / pits / ice sheets / ash zones. */
  private readonly nodes: HazardNode[] = [];
  /** Safe sites: winter's torches. Empty in every other zone. */
  private readonly havens: HazardNode[] = [];
  /** Prop centres that count as shade for the desert scorch (x,y interleaved). */
  private readonly shade: number[] = [];

  // --- spawn-bias tables, sorted by entry time so eligibility is an index ---
  private readonly sharedSorted: EnemyDef[];
  private readonly exclusiveSorted: EnemyDef[];
  private readonly exclusiveIds: Set<string>;
  private readonly byId: Record<string, EnemyDef> = {};
  private sharedEligible = 0;
  private exclusiveEligible = 0;

  // --- live hazard state ----------------------------------------------------
  private slowPct = 0;
  private gustMs = 0;
  private gusting = false;
  private slideVx = 0;
  private slideVy = 0;
  private onIce = false;
  /** Scratch for the clamped push/slide displacement — never reallocated. */
  private readonly displaced = { x: 0, y: 0 };

  constructor(
    scene: Phaser.Scene,
    rng: Rng,
    arena: Arena,
    zone: ZoneDef,
    subject: ZoneSubject,
    hooks: ZoneHooks,
  ) {
    this.scene = scene;
    this.rng = rng;
    this.arena = arena;
    this.zone = zone;
    this.subject = subject;
    this.hooks = hooks;
    this.gates = zoneGates(zone);

    const table = enemiesForZone(zone.id);
    for (const def of table) this.byId[def.id] = def;
    this.exclusiveSorted = [...exclusiveEnemies(zone.id)].sort((a, b) => a.firstSeenS - b.firstSeenS);
    this.exclusiveIds = new Set(this.exclusiveSorted.map((def) => def.id));
    this.sharedSorted = table
      .filter(
        (def) =>
          !this.exclusiveIds.has(def.id) && def.behaviour !== 'elite' && def.behaviour !== 'boss',
      )
      .sort((a, b) => a.firstSeenS - b.firstSeenS);

    this.buildHazard();
  }

  /**
   * Advances the hazard and the spawn-table eligibility clock. Called once per
   * TICKING frame from the slice — never while paused or drafting, so a hazard
   * cannot pulse behind an upgrade overlay.
   */
  update(deltaMs: number, elapsedS: number): void {
    this.advanceEligibility(elapsedS);

    switch (this.zone.hazard.kind) {
      case 'braziers':
        this.tickBraziers(elapsedS);
        break;
      case 'bonestorm':
        this.tickBonestorm(deltaMs);
        break;
      case 'sinksand':
        this.tickSinksand(deltaMs, elapsedS);
        break;
      case 'gale':
        this.tickGale(deltaMs);
        break;
    }
  }

  /**
   * The archetype a scheduled spawn actually becomes in this zone (§5.7
   * exclusivity). A TRASH spawn is re-rolled onto one of the zone's two
   * exclusives in proportion to how much of the live table they are — no
   * tuning dial, because the share IS the roster composition. Elites, the
   * Warden, ids that are already exclusive, and unknown ids pass through.
   *
   * Allocation-free: both tables are pre-sorted and eligibility is an index.
   */
  pickSpawnId(requestedId: string): string {
    if (this.exclusiveEligible === 0) return requestedId;
    if (this.exclusiveIds.has(requestedId)) return requestedId;
    const def = this.byId[requestedId];
    if (def === undefined || def.behaviour === 'elite' || def.behaviour === 'boss') return requestedId;
    const pool = this.sharedEligible + this.exclusiveEligible;
    if (pool === 0) return requestedId;
    if (!this.rng.chance(this.exclusiveEligible / pool)) return requestedId;
    const pick = this.exclusiveSorted[this.rng.int(0, this.exclusiveEligible - 1)];
    return pick === undefined ? requestedId : pick.id;
  }

  /** True while the subject stands on ground that slows it (pits, gale). */
  get slowed(): boolean {
    return this.slowPct > 0;
  }

  destroy(): void {
    this.subject.stats.removeBySource(ZONE_SLOW_SOURCE);
    for (const node of this.nodes) {
      node.glyph.destroy();
      node.field.destroy();
    }
    for (const node of this.havens) {
      node.glyph.destroy();
      node.field.destroy();
    }
    this.nodes.length = 0;
    this.havens.length = 0;
  }

  // === construction =========================================================

  private buildHazard(): void {
    const zone = this.zone;
    switch (zone.hazard.kind) {
      case 'braziers': {
        const count = requireParam(zone, 'count');
        const radius = requireParam(zone, 'radius');
        const periodMs = requireParam(zone, 'intervalS') * 1000;
        for (let i = 0; i < count; i += 1) {
          // Even phase spread: the field pulses as a rolling wave, so there is
          // always somewhere safe and the player reads rhythm, not luck.
          const node = this.addNode(radius, (periodMs * i) / count);
          this.setGlyphArt(node.glyph, BRAZIER_COLD);
          node.field.setVisible(false);
        }
        break;
      }
      case 'bonestorm': {
        const count = requireParam(zone, 'dotZones');
        const radius = requireParam(zone, 'dotRadius');
        for (let i = 0; i < count; i += 1) {
          const node = this.addNode(radius, 0);
          node.live = false;
          node.glyph.setVisible(false);
          node.field.setVisible(false);
        }
        break;
      }
      case 'sinksand': {
        const count = requireParam(zone, 'pits');
        const radius = requireParam(zone, 'radius');
        for (let i = 0; i < count; i += 1) this.addNode(radius, 0);
        this.cacheShadeProps();
        break;
      }
      case 'gale': {
        const sheets = requireParam(zone, 'iceSheets');
        const iceRadius = requireParam(zone, 'iceRadius');
        for (let i = 0; i < sheets; i += 1) this.addNode(iceRadius, 0);
        const torches = requireParam(zone, 'torches');
        const torchRadius = requireParam(zone, 'torchRadius');
        for (let i = 0; i < torches; i += 1) this.addHaven(torchRadius);
        break;
      }
    }
  }

  /**
   * Places one threat site, rejecting the run's starting pocket so the player
   * never spawns already standing in the zone's teeth.
   */
  private addNode(radius: number, phaseMs: number): HazardNode {
    const point = this.scatter(radius);
    const node: HazardNode = {
      glyph: this.placeGlyph(HAZARD_NODE_ART[this.zone.hazard.kind], point.x, point.y),
      field: this.placeField(point.x, point.y, radius, HAZARD_FALLBACK_TINT[this.zone.hazard.kind]),
      x: point.x,
      y: point.y,
      radius,
      phaseMs,
      cycle: 0,
      armed: false,
      live: true,
    };
    this.nodes.push(node);
    return node;
  }

  /** Places one SAFE site (a winter torch): standing in it lifts the gale slow. */
  private addHaven(radius: number): HazardNode {
    const point = this.scatter(radius);
    const node: HazardNode = {
      glyph: this.placeGlyph(GALE_TORCH_ART, point.x, point.y),
      field: this.placeField(point.x, point.y, radius, IDENTITY.hazardAmber),
      x: point.x,
      y: point.y,
      radius,
      phaseMs: 0,
      cycle: 0,
      armed: false,
      live: true,
    };
    this.havens.push(node);
    return node;
  }

  /** A seeded in-bounds point outside the start pocket. Deterministic per seed. */
  private scatter(radius: number): { x: number; y: number } {
    const edge = TUNING.arena.wallThickness + radius * 0.5;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const x = this.rng.float(edge, this.arena.width - edge);
      const y = this.rng.float(edge, this.arena.height - edge);
      const dx = x - this.arena.centerX;
      const dy = y - this.arena.centerY;
      if (Math.hypot(dx, dy) < TUNING.arena.spawnClearRadius + radius) continue;
      return { x, y };
    }
    // Exhausted: park it on the pocket's rim rather than inside it.
    const angle = this.rng.float(0, Math.PI * 2);
    const dist = TUNING.arena.spawnClearRadius + radius;
    const out = { x: 0, y: 0 };
    this.arena.clamp(
      this.arena.centerX + Math.cos(angle) * dist,
      this.arena.centerY + Math.sin(angle) * dist,
      edge,
      out,
    );
    return out;
  }

  private placeGlyph(art: ArtSlot, x: number, y: number): Phaser.GameObjects.Image {
    const hasArt = this.scene.textures.exists(art.key);
    const image = this.scene.add
      .image(x, y, hasArt ? art.key : TEX.disc, hasArt ? art.frame : undefined)
      .setDisplaySize(NODE_GLYPH_PX, NODE_GLYPH_PX)
      .setDepth(NODE_DEPTH);
    // Generated art carries its own colour; the tint is the fallback's only cue.
    if (!hasArt) image.setTint(HAZARD_FALLBACK_TINT[this.zone.hazard.kind]);
    return image;
  }

  private setGlyphArt(glyph: Phaser.GameObjects.Image, art: ArtSlot): void {
    if (!this.scene.textures.exists(art.key)) return;
    glyph.setTexture(art.key, art.frame);
  }

  /** The radius ring. One pre-sized image; `update` only writes alpha/position. */
  private placeField(x: number, y: number, radius: number, tint: number): Phaser.GameObjects.Image {
    return this.scene.add
      .image(x, y, TEX.ring)
      .setTint(tint)
      .setDisplaySize(radius * 2, radius * 2)
      .setAlpha(FIELD_ALPHA)
      .setDepth(FIELD_DEPTH);
  }

  /**
   * Caches the arena's impassable props as the desert's shade. "Outside shade
   * props" (§5.7) means the field the arena already scattered — inventing a
   * second set of shade objects would put shade where the art has none. Walls
   * are plain rectangles in the same group and are filtered out.
   */
  private cacheShadeProps(): void {
    for (const child of this.arena.obstacles.getChildren()) {
      if (!(child instanceof Phaser.GameObjects.Sprite)) continue;
      this.shade.push(child.x, child.y);
    }
  }

  // === hazards ==============================================================

  /**
   * Cursed braziers (castle): each site pulses on its own phase of the shared
   * cycle, arming a telegraph `telegraphS` before it fires. The telegraph is a
   * broad ring of light swelling out of the brazier — light, never notation:
   * the player reads WHERE the heat will land, not a diagram of it.
   */
  private tickBraziers(elapsedS: number): void {
    const zone = this.zone;
    const damage = requireParam(zone, 'damage');
    const periodMs = requireParam(zone, 'intervalS') * 1000;
    const telegraphMs = requireParam(zone, 'telegraphS') * 1000;
    const nowMs = elapsedS * 1000;

    for (const node of this.nodes) {
      const local = nowMs + node.phaseMs;
      const cycle = Math.floor(local / periodMs);
      const intoCycle = local - cycle * periodMs;
      const armed = intoCycle >= periodMs - telegraphMs;

      if (armed !== node.armed) {
        node.armed = armed;
        node.field.setVisible(armed);
        if (armed) {
          this.setGlyphArt(node.glyph, HAZARD_NODE_ART.braziers);
          this.hooks.onHazardTelegraph('braziers', node.x, node.y);
        } else {
          this.setGlyphArt(node.glyph, BRAZIER_COLD);
        }
      }
      // Telegraph intensity, written numerically — no tween, no Graphics.
      if (armed) {
        const into = (intoCycle - (periodMs - telegraphMs)) / telegraphMs;
        node.field.setAlpha(TELEGRAPH_ALPHA_BASE + TELEGRAPH_ALPHA_SWELL * into);
      }

      if (cycle <= node.cycle) continue;
      node.cycle = cycle;
      this.hooks.onHazardStrike('braziers', node.x, node.y);
      if (this.withinSq(node.x, node.y, node.radius)) this.hooks.onHazardHit(damage, node.x, node.y);
    }
  }

  /**
   * Bonestorm (outlands): every `intervalS` a `gustS` window shoves everything
   * left-to-right and drags three ash-dot zones across the field with it.
   */
  private tickBonestorm(deltaMs: number): void {
    const zone = this.zone;
    const periodMs = requireParam(zone, 'intervalS') * 1000;
    const gustMs = requireParam(zone, 'gustS') * 1000;
    const push = requireParam(zone, 'pushPxPerS');
    const dps = requireParam(zone, 'dotDps');
    const dt = deltaMs / 1000;

    this.gustMs += deltaMs;
    if (!this.gusting && this.gustMs >= periodMs) {
      this.gustMs = 0;
      this.gusting = true;
      this.startGust();
    } else if (this.gusting && this.gustMs >= gustMs) {
      this.gustMs = 0;
      this.gusting = false;
      for (const node of this.nodes) {
        node.live = false;
        node.glyph.setVisible(false);
        node.field.setVisible(false);
      }
    }
    if (!this.gusting) return;

    // The gust itself: a steady lateral shove the player has to lean against.
    this.displace(push * dt, 0);

    for (const node of this.nodes) {
      if (!node.live) continue;
      node.x += push * dt;
      node.glyph.x = node.x;
      node.field.x = node.x;
      if (this.withinSq(node.x, node.y, node.radius)) this.hooks.onHazardDrain(dps * dt);
    }
  }

  /** Places the gust's ash zones on the upwind edge at fresh heights. */
  private startGust(): void {
    const margin = TUNING.arena.wallThickness;
    for (const node of this.nodes) {
      node.x = this.rng.float(margin, margin + node.radius);
      node.y = this.rng.float(margin + node.radius, this.arena.height - margin - node.radius);
      node.live = true;
      node.glyph.setPosition(node.x, node.y).setVisible(true);
      node.field.setPosition(node.x, node.y).setVisible(true);
    }
    const lead = this.nodes[0];
    this.hooks.onHazardTelegraph(
      'bonestorm',
      lead?.x ?? this.arena.centerX,
      lead?.y ?? this.arena.centerY,
    );
  }

  /**
   * Sinking sand (desert): pits slow anything standing in them and shift when
   * nobody is watching; the midday scorch burns everything out of shade.
   */
  private tickSinksand(deltaMs: number, elapsedS: number): void {
    const zone = this.zone;
    const slowPct = requireParam(zone, 'slowPct');
    const scorchFromS = requireParam(zone, 'scorchFromS');
    const scorchToS = requireParam(zone, 'scorchToS');
    const scorchDps = requireParam(zone, 'scorchDps');
    const shadeRadius = requireParam(zone, 'shadeRadius');

    let inPit = false;
    for (const node of this.nodes) {
      if (this.withinSq(node.x, node.y, node.radius)) {
        inPit = true;
        continue;
      }
      // "Shifting pits": a pit only relocates while it is a whole field away,
      // so the sand changes between visits instead of teleporting underfoot.
      if (this.withinSq(node.x, node.y, node.radius + this.arena.width)) continue;
      const point = this.scatter(node.radius);
      node.x = point.x;
      node.y = point.y;
      node.glyph.setPosition(point.x, point.y);
      node.field.setPosition(point.x, point.y);
    }
    this.applySlow(inPit ? slowPct : 0);

    if (elapsedS < scorchFromS || elapsedS > scorchToS) return;
    if (this.inShade(shadeRadius)) return;
    this.hooks.onHazardDrain((scorchDps * deltaMs) / 1000);
  }

  private inShade(radius: number): boolean {
    for (let i = 0; i < this.shade.length; i += 2) {
      const x = this.shade[i];
      const y = this.shade[i + 1];
      if (x === undefined || y === undefined) continue;
      if (this.withinSq(x, y, radius)) return true;
    }
    return false;
  }

  /**
   * Freezing gale (winter): everything outside a torch's light is slowed, and
   * the ice sheets replace the player's grip with momentum.
   */
  private tickGale(deltaMs: number): void {
    const zone = this.zone;
    const slowPct = requireParam(zone, 'slowPct');
    const friction = requireParam(zone, 'iceFriction');

    let sheltered = false;
    for (const haven of this.havens) {
      if (!this.withinSq(haven.x, haven.y, haven.radius)) continue;
      sheltered = true;
      break;
    }
    this.applySlow(sheltered ? 0 : slowPct);

    let onIce = false;
    for (const node of this.nodes) {
      if (!this.withinSq(node.x, node.y, node.radius)) continue;
      onIce = true;
      break;
    }
    this.tickIce(onIce, friction, deltaMs / 1000);
  }

  /**
   * Ice momentum. The player's body velocity is rewritten every frame by
   * `Player.tick`, so grip is removed by DISPLACING the player by the gap
   * between the velocity it asked for and the velocity ice actually grants —
   * stopping on ice keeps gliding, turning on ice arcs wide.
   */
  private tickIce(onIce: boolean, friction: number, dt: number): void {
    const body = this.subject.body;
    const vx = body === null ? 0 : body.velocity.x;
    const vy = body === null ? 0 : body.velocity.y;
    if (!onIce) {
      this.onIce = false;
      this.slideVx = vx;
      this.slideVy = vy;
      return;
    }
    if (!this.onIce) {
      this.onIce = true;
      this.slideVx = vx;
      this.slideVy = vy;
    }
    this.slideVx = this.slideVx * friction + vx * (1 - friction);
    this.slideVy = this.slideVy * friction + vy * (1 - friction);
    this.displace((this.slideVx - vx) * dt, (this.slideVy - vy) * dt);
  }

  // === shared helpers =======================================================

  /** Squared-distance containment test against the subject. No allocation. */
  private withinSq(x: number, y: number, radius: number): boolean {
    const dx = this.subject.x - x;
    const dy = this.subject.y - y;
    return dx * dx + dy * dy <= radius * radius;
  }

  /** Moves the subject by an environmental displacement, clamped in-bounds. */
  private displace(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.arena.clamp(
      this.subject.x + dx,
      this.subject.y + dy,
      TUNING.arena.wallThickness + TUNING.player.size * 0.5,
      this.displaced,
    );
    this.subject.x = this.displaced.x;
    this.subject.y = this.displaced.y;
  }

  /** Sets the zone's movement penalty. Re-applied only when the value changes. */
  private applySlow(pct: number): void {
    if (pct === this.slowPct) return;
    this.slowPct = pct;
    this.subject.stats.removeBySource(ZONE_SLOW_SOURCE);
    if (pct > 0) {
      this.subject.stats.addModifier({
        stat: 'moveSpeed',
        mul: -pct / 100,
        source: ZONE_SLOW_SOURCE,
      });
    }
  }

  /** Advances how much of each table has entered play (§5.7 entry times). */
  private advanceEligibility(elapsedS: number): void {
    while (this.sharedEligible < this.sharedSorted.length) {
      const next = this.sharedSorted[this.sharedEligible];
      if (next === undefined || next.firstSeenS > elapsedS) break;
      this.sharedEligible += 1;
    }
    while (this.exclusiveEligible < this.exclusiveSorted.length) {
      const next = this.exclusiveSorted[this.exclusiveEligible];
      if (next === undefined || next.firstSeenS > elapsedS) break;
      this.exclusiveEligible += 1;
    }
  }
}
