import { TEX } from '../../core/keys';
import type { ArtSlot } from '../../data/art';
import type { EconomySpec, GeneratorDef, ManagerDef } from '../../core/economy';
import { IDLE_TUNING, type IdleGeneratorId, type IdleManagerGeneratorId } from './tuning';

/**
 * Content for the idle-tycoon starter: eight tiers of a wizard's holdings, six
 * managers and the prestige spec, assembled into the `EconomySpec` the kit
 * consumes. Data records only — no `if` chains, no numbers (those live in
 * `tuning.ts`), and no Phaser: the same spec is what a headless sim would tick.
 */

/** Row presentation: which procedural texture + tint stands in for the tier. */
export interface GeneratorView {
  tex: string;
  tint: number;
  /** One-line fantasy flavour shown while the tier is still locked. */
  blurb: string;
  /**
   * Generated icon for this tier. `null` keeps the procedural `tex` + `tint`;
   * a resolved slot is drawn UNTINTED, so an icon sheet has to carry its own
   * colour separation between the eight tiers.
   */
  art: ArtSlot | null;
}

interface GeneratorContent {
  id: IdleGeneratorId;
  name: string;
  view: GeneratorView;
}

const GENERATOR_CONTENT: readonly GeneratorContent[] = [
  {
    id: 'glowcap',
    name: 'Glowcap Farm',
    view: { tex: TEX.disc, tint: 0x5df2a0, blurb: 'Mushrooms that pay rent.', art: null },
  },
  {
    id: 'copper',
    name: 'Copper Delve',
    view: { tex: TEX.square, tint: 0xffd166, blurb: 'Shallow seams, deep pockets.', art: null },
  },
  {
    id: 'still',
    name: "Herbalist's Still",
    view: { tex: TEX.ring, tint: 0x4de1ff, blurb: 'Tonics for adventurers, sold by the crate.', art: null },
  },
  {
    id: 'forge',
    name: 'Rune Forge',
    view: { tex: TEX.spike, tint: 0xff5da2, blurb: 'Stamped sigils, guaranteed to spark.', art: null },
  },
  {
    id: 'roost',
    name: 'Gryphon Roost',
    view: { tex: TEX.star, tint: 0xf2f6ff, blurb: 'Freight, courier work, and one very loud tenant.', art: null },
  },
  {
    id: 'well',
    name: 'Mana Well',
    view: { tex: TEX.disc, tint: 0x4de1ff, blurb: 'Bottled ley-line, tapped on a schedule.', art: null },
  },
  {
    id: 'hoard',
    name: 'Dragon Hoard',
    view: { tex: TEX.star, tint: 0xffd166, blurb: 'A lease agreement nobody dares audit.', art: null },
  },
  {
    id: 'mint',
    name: 'Astral Mint',
    view: { tex: TEX.ring, tint: 0xff5da2, blurb: 'Coins struck from tomorrow.', art: null },
  },
];

/** Manager names per automated tier — flavour for the AUTOMATE button. */
const MANAGER_NAMES: Record<IdleManagerGeneratorId, string> = {
  glowcap: 'Tilda the Tender',
  copper: 'Foreman Grum',
  still: 'Sister Ilva',
  forge: 'Smith Kaldar',
  roost: 'Roostmaster Vey',
  well: 'Warden Sol',
};

export const MANAGER_ID_PREFIX = 'mgr-';

const GENERATORS: readonly GeneratorDef[] = GENERATOR_CONTENT.map((entry) => {
  const t = IDLE_TUNING.generators[entry.id];
  return {
    id: entry.id,
    name: entry.name,
    baseCost: t.baseCost,
    costGrowth: t.costGrowth,
    baseIncomePerSec: t.incomePerSec,
    cycleMs: t.cycleMs,
    unlockAtTotalEarned: t.unlockAtTotalEarned,
  } satisfies GeneratorDef;
});

const MANAGERS: readonly ManagerDef[] = (
  Object.keys(MANAGER_NAMES) as IdleManagerGeneratorId[]
).map((generatorId) => ({
  id: MANAGER_ID_PREFIX + generatorId,
  generatorId,
  name: MANAGER_NAMES[generatorId],
  cost: IDLE_TUNING.managers[generatorId],
}));

export const ECONOMY_SPEC: EconomySpec = {
  generators: GENERATORS,
  managers: MANAGERS,
  prestige: IDLE_TUNING.prestige,
};

/** Display metadata by generator id, in the same order as the spec's rows. */
export const GENERATOR_VIEW: Record<string, GeneratorView> = Object.fromEntries(
  GENERATOR_CONTENT.map((entry) => [entry.id, entry.view]),
);

/** Manager (if any) that automates a generator — the row's AUTOMATE button. */
export const MANAGER_BY_GENERATOR: Record<string, ManagerDef | undefined> = Object.fromEntries(
  MANAGERS.map((def) => [def.generatorId, def]),
);
