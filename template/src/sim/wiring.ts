/**
 * Connectedness manifest — the PAYLOADS this game promises the player, each of
 * which must reach a reader in RUN code. Checked by
 * `src/sim/kits/wiring.selftest.ts` (verify stage 5).
 *
 * The defect it exists for: code and data that exist but are wired to nothing.
 * A paid meta node folded into `RunLoadout.startLevel` that no run code read
 * ("Start at level 2" did nothing), a shop perk with no reader, a pause action
 * the overlay never calls. Every one of them typechecks and passes a sim.
 *
 * RUN code = every `.ts` under `src/` except `src/sim/**` and `*.selftest.ts`
 * (a sim or selftest reader proves the model, not the game), minus the
 * payload's `producers`, restricted to its `readers` when given. Comments never
 * count. Paths are `src/`-relative; a trailing `/` means a directory prefix.
 *
 * A GAME APPENDS ITS OWN PAYLOADS HERE: its run-loadout interface (`fields`,
 * receiver `loadout`), its meta-node ids (`ids`, reader = the loadout builder),
 * its mutator/modifier params, any TUNING subtree a card or node pays for.
 * Keep the template rows. `exempt` takes a reason per name and is printed on
 * every run — it is for names that are keys/metadata, never for a paid effect.
 */
import { PLAYER_BASE_STATS, TUNING } from '../config';
import { metaCatalogFor } from '../data/metaCatalog';

interface PayloadScope {
  /** Label printed with every finding. */
  label: string;
  /** Only these paths count as readers (default: all run code). */
  readers?: readonly string[];
  /** Paths that WRITE the payload and therefore never count as its reader. */
  producers?: readonly string[];
  /** name → why it needs no reader. Printed every run. */
  exempt?: Readonly<Record<string, string>>;
}

/** Every field of an interface / object type alias is read through a receiver. */
export interface FieldsPayload extends PayloadScope {
  kind: 'fields';
  /** File declaring `interface <type> {` or `type <type> = {`. */
  file: string;
  type: string;
  /**
   * Names a reader accesses the payload through: `loadout.startLevel`,
   * `loadout?.mercy`, `const { mercy } = loadout`. An inline object field
   * (`extras: { a: number }`) is checked as `extras.a`, read as `.a` in a
   * reader file that also names `extras`.
   */
  receivers: readonly string[];
}

/** Every id is spelled by a reader — a string literal by default. */
export interface IdsPayload extends PayloadScope {
  kind: 'ids';
  ids: readonly string[];
  /** Custom read pattern per id (default: the id as a quoted string literal). */
  reader?: (id: string) => RegExp;
}

/** Every leaf under `root.path` is read as `root.<path>…` (or through a read of an ancestor). */
export interface TuningPayload extends PayloadScope {
  kind: 'tuning';
  /** The identifier code reads it through (default `TUNING`; `BOARD_TUNING` etc. for a slice). */
  root?: string;
  /** Dotted path of `tree` inside `root` (`''` = the whole root). */
  path: string;
  tree: object;
}

export type WiringPayload = FieldsPayload | IdsPayload | TuningPayload;

/**
 * The payloads for the family slices present in `src/slices/` (all of them in
 * the template, the chosen one in a scaffolded game).
 */
export function wiringPayloads(families: readonly string[]): WiringPayload[] {
  const payloads: WiringPayload[] = [
    {
      kind: 'fields',
      label: 'results payload (every field a slice hands GameOverScene is shown or used)',
      file: 'scenes/gameover.ts',
      type: 'GameOverData',
      receivers: ['result'],
      readers: ['scenes/gameover.ts'],
    },
    {
      kind: 'fields',
      label: 'pause actions (every pause control reaches its callback)',
      file: 'ui/pauseOverlay.ts',
      type: 'PauseOverlayActions',
      receivers: ['actions'],
      readers: ['ui/pauseOverlay.ts'],
    },
    {
      kind: 'fields',
      label: 'HUD model (every field the scene feeds is drawn)',
      file: 'ui/hud.ts',
      type: 'HudModel',
      receivers: ['model'],
      readers: ['ui/hud.ts'],
    },
    {
      kind: 'fields',
      label: 'player settings (every setting reaches the system it controls)',
      file: 'core/audio.ts',
      type: 'PlayerSettings',
      receivers: ['settings', 'next', 'playerSettings()'],
      // The Settings sheet writes them; reading a value to flip its toggle is not applying it.
      producers: ['ui/sheet.ts'],
    },
  ];

  for (const family of families) {
    const catalog = metaCatalogFor(family);
    // A perk is applied by the slice that sells it (`metaCatalog.ts` `perk`
    // contract): the shop and the catalog are its producers, not its reader.
    const perks = catalog.filter((entry) => entry.kind === 'perk').map((entry) => entry.id);
    if (perks.length > 0) {
      payloads.push({ kind: 'ids', label: `${family} paid meta perks`, ids: perks, readers: [`slices/${family}/`] });
    }
    const boosters = catalog.filter((entry) => entry.kind === 'booster').map((entry) => entry.boosterId ?? entry.id);
    if (boosters.length > 0) {
      payloads.push({ kind: 'ids', label: `${family} paid boosters`, ids: boosters, readers: [`slices/${family}/`] });
    }
  }

  if (families.includes('arena')) {
    // Level-up cards and `META_UPGRADES` buy these; `validateUpgradeStats`
    // proves a modifier names one, this proves the run reads it.
    payloads.push({
      kind: 'ids',
      label: 'player stats (cards and meta upgrades buy them)',
      ids: Object.keys(PLAYER_BASE_STATS),
      reader: (id) => new RegExp(`\\.get\\(\\s*['"\`]${id}['"\`]\\s*\\)`),
      producers: ['config.ts', 'data/'],
    });
    // The numbers behind the legendary effect cards and the weapon unlock/boost cards.
    payloads.push(
      { kind: 'tuning', label: 'effect-card numbers', path: 'effects', tree: TUNING.effects, producers: ['config.ts'] },
      { kind: 'tuning', label: 'weapon-card numbers', path: 'weapons', tree: TUNING.weapons, producers: ['config.ts'] },
    );
  }
  return payloads;
}
