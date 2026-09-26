import Phaser from 'phaser';
import { TUNING } from '../config';
import { TEX } from '../core/keys';
import { Rng } from '../core/rng';
import type { ArtSlot } from '../data/art';
import { enemiesForZone, exclusiveEnemies, type EnemyDef } from '../data/enemies';
import type { GeneratedMap } from '../data/types-v2';
import type { ZoneDef, ZoneHazardKind } from '../data/zones';
import { IDENTITY } from '../ui/duskChrome';

/**
 * Applies one `ZoneDef` (PRD-V2 §5.29 / §16.1 E6) to the live run: the
 * spawn-table bias that lets the zone's exclusive archetypes in, and the zone
 * hazard as a REAL mechanic placed on the map's `hazardAnchors` (§3.9 — mapgen
 * places them algorithmically: braziers/pits/ice off-road with spacing, ash
 * zones and winter torches ON roads). Gates are no longer here: they are
 * `GeneratedMap.gates`.
 *
 * There is no mid-run zone travel (§5.7), so a `ZoneSystem` is constructed
 * once in the scene's `create` and torn down with the scene.
 *
 * Performance contract (§15): hazard node DATA is allocated up front (up to
 * 1,296 in winter); their images exist only near the subject (`syncVisuals`),
 * and `update` allocates nothing,
 * creates no tweens and redraws no Graphics: field rings are pre-sized
 * `Image`s whose alpha/visibility is written numerically, and `pickSpawnId`
 * runs off cached, pre-sorted tables.
 *
 * Balance discipline: every number a hazard uses comes from
 * `ZoneDef.hazard.params` (content, `data/zones.ts`) or `TUNING`. A missing
 * required param THROWS — an unauthored hazard number is a content bug and
 * must be loud, never silently defaulted into a different game.
 */

export type { ZoneHazardKind } from '../data/zones';

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
  // Hazards are amber (PRD-V2 §13.2): red is reserved for hostiles and the
  // brazier's own strike frame (`STRIKE_FLASH_MS`).
  braziers: IDENTITY.hazardAmber,
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
 * Lazy hazard visuals (24576² map: up to 1,296 sites): a node gets its glyph
 * and field only within `VISUAL_IN_PX` of the subject and loses them beyond
 * `VISUAL_OUT_PX`; the check runs every `VISUAL_SYNC_MS`. The mechanics
 * (timers, containment tests) run for every node regardless — they are plain
 * arithmetic — but telegraph/strike hooks fire only for visible nodes, so the
 * slice never sells a brazier the player cannot see.
 */
const VISUAL_IN_PX = 2400;
const VISUAL_OUT_PX = 3000;
const VISUAL_SYNC_MS = 250;
/** The brazier strike frame: the ring flashes hostile red this long after it fires, then goes dark. */
const STRIKE_FLASH_MS = 160;
const STRIKE_FLASH_ALPHA = 0.6;

/**
 * One hazard site. Threat nodes (braziers, pits, ash, ice) and safe nodes
 * (torches) share the record: `field` is the radius ring, `glyph` the prop.
 */
interface HazardNode {
  /** Visuals exist only while the node is within `VISUAL_IN_PX` of the subject (lazy, see `syncVisuals`). */
  glyph: Phaser.GameObjects.Image | null;
  field: Phaser.GameObjects.Image | null;
  /** A safe site (winter torch) rather than a threat. */
  haven: boolean;
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

export class ZoneSystem {
  readonly zone: ZoneDef;

  private readonly scene: Phaser.Scene;
  private readonly rng: Rng;
  private readonly map: GeneratedMap;
  private readonly hooks: ZoneHooks;
  /** The mover hazards act on; hazards idle until `setSubject` (the player exists after combat). */
  private subject: ZoneSubject | null = null;
  /** Next road anchor an ash zone rises from (bonestorm streams along roads). */
  private ashCursor = 0;
  private syncMs = VISUAL_SYNC_MS;

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

  /** §16.1 E6. The hazard's own draws use `Rng(\`zone:${zone}:${map.seed}\`)` so a seed replays exactly. */
  constructor(scene: Phaser.Scene, zone: ZoneDef, map: GeneratedMap, hooks: ZoneHooks) {
    this.scene = scene;
    this.rng = new Rng(`zone:${zone.id}:${map.seed}`);
    this.map = map;
    this.zone = zone;
    this.hooks = hooks;

    const table = enemiesForZone(zone.id);
    for (const def of table) this.byId[def.id] = def;
    this.exclusiveSorted = [...exclusiveEnemies(zone.id)].sort((a, b) => a.firstSeenS - b.firstSeenS);
    this.exclusiveIds = new Set(this.exclusiveSorted.map((def) => def.id));
    this.sharedSorted = table
      .filter(
        (def) =>
          !this.exclusiveIds.has(def.id) && def.rank === 'trash',
      )
      .sort((a, b) => a.firstSeenS - b.firstSeenS);

    this.buildHazard();
  }

  /**
   * Advances the hazard and the spawn-table eligibility clock. Called once per
   * TICKING frame from the slice — never while paused or drafting, so a hazard
   * cannot pulse behind an upgrade overlay.
   */
  /** Binds the mover hazards act on (the player). Until bound, hazards animate but touch nobody. */
  setSubject(subject: ZoneSubject): void {
    this.subject = subject;
  }

  update(deltaMs: number, elapsedS: number): void {
    this.advanceEligibility(elapsedS);
    if (this.subject === null) return;
    this.syncMs += deltaMs;
    if (this.syncMs >= VISUAL_SYNC_MS) {
      this.syncMs = 0;
      this.syncVisuals();
    }

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
   * tuning dial, because the share IS the roster composition. Mid-bosses, the
   * zone boss, ids that are already exclusive, and unknown ids pass through.
   *
   * Allocation-free: both tables are pre-sorted and eligibility is an index.
   */
  pickSpawnId(requestedId: string): string {
    if (this.exclusiveEligible === 0) return requestedId;
    if (this.exclusiveIds.has(requestedId)) return requestedId;
    const def = this.byId[requestedId];
    if (def === undefined || def.rank !== 'trash') return requestedId;
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
    this.subject?.stats.removeBySource(ZONE_SLOW_SOURCE);
    this.subject = null;
    for (const node of this.nodes) this.hideNode(node);
    for (const node of this.havens) this.hideNode(node);
    this.nodes.length = 0;
    this.havens.length = 0;
  }

  // === construction =========================================================

  /**
   * Builds the hazard on `map.hazardAnchors` in the order mapgen documents:
   * braziers / ash-zone road anchors / pits in one list; winter lists its
   * `iceSheets` ice anchors first, then its `torches` torch anchors. A map
   * with fewer anchors than the param (a best-effort reseed map) builds fewer.
   */
  private buildHazard(): void {
    const zone = this.zone;
    const anchors = this.map.hazardAnchors;
    let cursor = 0;
    const take = (n: number): Array<{ x: number; y: number }> => {
      const out = anchors.slice(cursor, cursor + n);
      cursor += out.length;
      return out;
    };
    switch (zone.hazard.kind) {
      case 'braziers': {
        const sites = take(requireParam(zone, 'count'));
        const radius = requireParam(zone, 'radius');
        const periodMs = requireParam(zone, 'intervalS') * 1000;
        sites.forEach((p, i) => {
          // Even phase spread: the field pulses as a rolling wave, so there is
          // always somewhere safe and the player reads rhythm, not luck.
          this.addNode(p, radius, (periodMs * i) / sites.length);
        });
        break;
      }
      case 'bonestorm': {
        const radius = requireParam(zone, 'dotRadius');
        for (const p of take(requireParam(zone, 'dotZones'))) {
          this.addNode(p, radius, 0).live = false;
        }
        break;
      }
      case 'sinksand': {
        const radius = requireParam(zone, 'radius');
        for (const p of take(requireParam(zone, 'pits'))) this.addNode(p, radius, 0);
        // Shade (§5.29 scorch): every blocking prop the map placed casts it.
        for (const prop of this.map.props) this.shade.push(prop.x, prop.y);
        break;
      }
      case 'gale': {
        const iceRadius = requireParam(zone, 'iceRadius');
        for (const p of take(requireParam(zone, 'iceSheets'))) this.addNode(p, iceRadius, 0);
        const torchRadius = requireParam(zone, 'torchRadius');
        for (const p of take(requireParam(zone, 'torches'))) this.addHaven(p, torchRadius);
        break;
      }
    }
  }

  /** One threat site on a mapgen anchor (anchors already keep off spawn, gates and POIs). */
  private addNode(p: { x: number; y: number }, radius: number, phaseMs: number): HazardNode {
    const node: HazardNode = {
      glyph: null,
      field: null,
      haven: false,
      x: p.x,
      y: p.y,
      radius,
      phaseMs,
      cycle: 0,
      armed: false,
      live: true,
    };
    this.nodes.push(node);
    return node;
  }

  /** One SAFE site (a winter torch on a road): standing in it lifts the gale slow. */
  private addHaven(p: { x: number; y: number }, radius: number): HazardNode {
    const node: HazardNode = {
      glyph: null,
      field: null,
      haven: true,
      x: p.x,
      y: p.y,
      radius,
      phaseMs: 0,
      cycle: 0,
      armed: false,
      live: true,
    };
    this.havens.push(node);
    return node;
  }

  /** Creates visuals for nodes near the subject, destroys those far away. */
  private syncVisuals(): void {
    const s = this.subject!;
    const inSq = VISUAL_IN_PX * VISUAL_IN_PX;
    const outSq = VISUAL_OUT_PX * VISUAL_OUT_PX;
    const sync = (node: HazardNode): void => {
      const dx = node.x - s.x;
      const dy = node.y - s.y;
      const d = dx * dx + dy * dy;
      if (node.glyph === null && d <= inSq) this.showNode(node);
      else if (node.glyph !== null && d > outSq) this.hideNode(node);
    };
    for (const node of this.nodes) sync(node);
    for (const node of this.havens) sync(node);
  }

  /** Builds a node's glyph + field in its resting state for this hazard. */
  private showNode(node: HazardNode): void {
    const kind = this.zone.hazard.kind;
    if (node.haven) {
      node.glyph = this.placeGlyph(GALE_TORCH_ART, node.x, node.y);
      node.field = this.placeField(node.x, node.y, node.radius, IDENTITY.hazardAmber);
      return;
    }
    node.glyph = this.placeGlyph(HAZARD_NODE_ART[kind], node.x, node.y);
    node.field = this.placeField(node.x, node.y, node.radius, HAZARD_FALLBACK_TINT[kind]);
    if (kind === 'braziers') {
      this.setGlyphArt(node.glyph, BRAZIER_COLD);
      node.field.setVisible(false);
      // Re-diff the telegraph on the next tick so a node that appears mid-arming lights up.
      node.armed = false;
    } else if (kind === 'bonestorm') {
      node.glyph.setVisible(node.live);
      node.field.setVisible(node.live);
    }
  }

  private hideNode(node: HazardNode): void {
    node.glyph?.destroy();
    node.field?.destroy();
    node.glyph = null;
    node.field = null;
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

  // === hazards ==============================================================

  /**
   * Cursed braziers (castle): each site pulses on its own phase of the shared
   * cycle, arming a telegraph `telegraphS` before it fires. The telegraph is a
   * broad AMBER ring of light swelling out of the brazier — light, never
   * notation: the player reads WHERE the heat will land. Only the strike frame
   * flashes hostile red, so at a glance braziers never read as enemies.
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
      // Strike frame: the first STRIKE_FLASH_MS of a cycle that followed a real strike.
      const flashing = cycle > 0 && node.cycle >= cycle - 1 && intoCycle < STRIKE_FLASH_MS && nowMs >= STRIKE_FLASH_MS;

      const glyph = node.glyph;
      const field = node.field;
      if (glyph !== null && field !== null) {
        if (armed !== node.armed) {
          node.armed = armed;
          field.setVisible(armed || flashing);
          if (armed) {
            this.setGlyphArt(glyph, HAZARD_NODE_ART.braziers);
            this.hooks.onHazardTelegraph('braziers', node.x, node.y);
          } else {
            this.setGlyphArt(glyph, BRAZIER_COLD);
          }
        }
        // Telegraph intensity, written numerically — no tween, no Graphics.
        if (armed) {
          const into = (intoCycle - (periodMs - telegraphMs)) / telegraphMs;
          field.setTint(IDENTITY.hazardAmber).setAlpha(TELEGRAPH_ALPHA_BASE + TELEGRAPH_ALPHA_SWELL * into);
        } else if (flashing) {
          field.setVisible(true).setTint(IDENTITY.threat).setAlpha(STRIKE_FLASH_ALPHA);
        } else if (field.visible) {
          field.setVisible(false);
        }
      } else {
        node.armed = armed;
      }

      if (cycle <= node.cycle) continue;
      node.cycle = cycle;
      if (glyph !== null) this.hooks.onHazardStrike('braziers', node.x, node.y);
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
        node.glyph?.setVisible(false);
        node.field?.setVisible(false);
      }
    }
    if (!this.gusting) return;

    // The gust itself: a steady lateral shove the player has to lean against.
    this.displace(push * dt, 0);

    for (const node of this.nodes) {
      if (!node.live) continue;
      node.x += push * dt;
      if (node.glyph !== null) node.glyph.x = node.x;
      if (node.field !== null) node.field.x = node.x;
      if (this.withinSq(node.x, node.y, node.radius)) this.hooks.onHazardDrain(dps * dt);
    }
  }

  /**
   * Raises the gust's ash zones from the road anchors (§3.9: ash streams
   * along roads). Each gust rotates which anchor feeds which zone, so the
   * pattern shifts between gusts while staying on the roads.
   */
  private startGust(): void {
    const anchors = this.map.hazardAnchors;
    this.ashCursor += 1;
    this.nodes.forEach((node, i) => {
      const a = anchors[(i + this.ashCursor) % Math.max(1, anchors.length)];
      if (a !== undefined) {
        node.x = a.x;
        node.y = a.y;
      }
      node.live = true;
      node.glyph?.setPosition(node.x, node.y).setVisible(true);
      node.field?.setPosition(node.x, node.y).setVisible(true);
    });
    // Visuals follow the zones' new positions right away.
    this.syncVisuals();
    // The warning points at the ash zone nearest the subject.
    const s = this.subject!;
    let lead: HazardNode | null = null;
    let best = Infinity;
    for (const node of this.nodes) {
      const d = (node.x - s.x) ** 2 + (node.y - s.y) ** 2;
      if (d < best) {
        best = d;
        lead = node;
      }
    }
    this.hooks.onHazardTelegraph('bonestorm', lead?.x ?? this.map.spawn.x, lead?.y ?? this.map.spawn.y);
  }

  /**
   * Sinking sand (desert): the pits on their anchors slow anything standing
   * in them; the midday scorch burns everything out of shade.
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
      if (!this.withinSq(node.x, node.y, node.radius)) continue;
      inPit = true;
      break;
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
    const body = this.subject!.body;
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
    const dx = this.subject!.x - x;
    const dy = this.subject!.y - y;
    return dx * dx + dy * dy <= radius * radius;
  }

  /** Moves the subject by an environmental displacement, clamped inside the border band. */
  private displace(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const subject = this.subject!;
    const lo = TUNING.mapgen.borderBand + TUNING.player.bodyRadius;
    this.displaced.x = Phaser.Math.Clamp(subject.x + dx, lo, this.map.width - lo);
    this.displaced.y = Phaser.Math.Clamp(subject.y + dy, lo, this.map.height - lo);
    subject.x = this.displaced.x;
    subject.y = this.displaced.y;
  }

  /** Sets the zone's movement penalty. Re-applied only when the value changes. */
  private applySlow(pct: number): void {
    if (pct === this.slowPct) return;
    this.slowPct = pct;
    const subject = this.subject!;
    subject.stats.removeBySource(ZONE_SLOW_SOURCE);
    if (pct > 0) {
      subject.stats.addModifier({
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
