/**
 * Colony balance numbers (PRD §7). KEY SET FROZEN at the contract wave:
 * ContentDev (W3) edits values; a new key goes through the orchestrator.
 * Phaser-free and data-only: the model, the threat sim, the scene and the sim
 * all read this module (it stays here; it is NOT lifted into `src/config.ts`).
 */
export const COLONY_TUNING = {
  map: {
    /** Greybox site (PRD Frontier is 72 × 96; §1c). */
    /** PRD §1c Frontier: 72 × 96 = 30.7 screens. */
    cols: 72,
    rows: 96,
    tilePx: 64,
    /** Clear radius around the core with no rock. */
    coreClearing: 5,
    /** Rock clusters seeded per map. */
    rockClusters: 90,
    deposits: { ore: 10, ice: 8, crystal: 6, vent: 5 },
    /** Purity by core distance: [maxDistTiles, impure, normal, pure] bands (PRD §5.2). */
    purityBands: [
      [8, 0.2, 0.8, 0],
      [14, 0.3, 0.6, 0.1],
      [999, 0.1, 0.5, 0.4],
    ],
    /** Deposits never spawn closer than this (the guaranteed ring excepted). */
    minDepositSpacing: 4,
    /** PRD §1c: Expanse 90 × 120, Continent 120 × 160 against the 72 × 96 Frontier. */
    sizeScale: { frontier: 1, expanse: 1.25, continent: 5 / 3 },
    /** PRD §15: `buildFlowFieldWindow` radius for the Continent. */
    continentNavWindow: 40,
    /** PRD §1c density: target props per 720 × 1280 screen. */
    propsPerScreen: 6,
    /** Tiles between any two props (80 px draw + 60 px gap). */
    propSpacingTiles: 3,
    /** Same prop kind ≥ 900 px apart. */
    propSameKindTiles: 15,
    /** Prop vs blocker centre distance² floor (tiles²). */
    propBlockerD2: 5,
    /** Relic Sites spread: best of this many candidates by distance to the nearest other relic. */
    relicCandidates: 24,
    /** Chokepoint sites: cliff ridges on this core-distance band, one pass each. */
    ridge: { radius: [13, 22], halfSpanRad: [0.45, 0.75], passHalfTiles: 1.5 },
  },
  sol: {
    firstDaySec: 60,
    daySec: 36,
    duskSec: 10,
    nightBaseSec: 12,
    nightPerSolSec: 2,
    count: 10,
    longNightDeadlineSec: 120,
    difficultyBySol: [1.0, 1.1, 1.25, 1.4, 1.6, 1.8, 2.05, 2.3, 2.4, 2.7],
  },
  temp: {
    nightBaseC: -20,
    perSolC: -6,
    longNightStepC: -2,
    longNightStepSec: 10,
    dayC: -4,
    /** PRD §5.4 Severity: night temp per rung above 1. */
    perRungC: -8,
  },
  field: {
    heatKwPerTilePerDeg: 0.001,
    coreRadius: 6,
    relayRadius: 4,
    shedIntervalSec: 2,
    freezeAfterSec: 8,
    freezeHpShare: 0.2,
    fogRevealTiles: 3,
    pingRadiusTiles: 8,
  },
  power: {
    coreKw: 8,
    tickSec: 0.25,
    overdriveMul: 1.5,
    overdriveSec: 10,
    overdriveStress: 0.34,
    stressDecayPerDawn: 0.34,
    stressBreakDamage: 600,
  },
  production: {
    purityMul: [0.5, 1, 2],
    mkRateMul: [1, 1.5, 2],
    mkCostMul: [1, 1.2, 2.0],
    mkHpMul: [1, 1.4, 1.9],
    coreStorage: 200,
    siloStorage: 150,
    lowMoraleMul: 0.75,
    lowMoraleAt: 20,
    /** Lumen Foundry cycle floor after `foundry.cycleSec` stacking. */
    foundryMinCycleSec: 0.5,
    /** Processors never draw an input good below this stock (critic build1: smelters drained Fe to 0 → soft-lock). */
    reserve: { ferrite: 25, ice: 0, aurelite: 0, rations: 0, alloy: 10, prism: 0, cell: 0 },
    /** Seconds a player's wanted build (armed / denied for cost) holds processor inputs. */
    wantHoldSec: 30,
  },
  colonists: {
    start: 6,
    startMorale: 50,
    rationPerSec: 0.05,
    arrivalsBase: 2,
    arrivalsPerMorale: 25,
    coldDeathEverySec: 10,
    starveDeathPer: 4,
    moraleDeath: -15,
    moraleFedDawn: 3,
    moraleCleanNight: 10,
    moraleStarve: -10,
    commonsCountMax: 3,
    commonsMorale: 4,
  },
  start: { ferrite: 60, alloy: 30, rations: 36 },
  /** `mkMul`: noise × this per Mk above I (PRD §5.2). */
  noise: { capBase: 8, capPerSol: 4, scaleFloor: 0.4, mkMul: 1.25 },
  hud: { rateWindowSec: 5 },
  swarm: {
    /** Seconds after dusk starts before the first fauna emerges. */
    emergeDelaySec: 3,
    /** Spawn ring: this many tiles beyond the lit field edge (§18: 16 → 10). */
    spawnBeyondFieldTiles: 10,
    dripShare: 0.7,
    chorusSec: 60,
    titanDelaySec: 20,
    longNightSkitterEverySec: 0.8,
    longNightBruteEverySec: 12,
    /** Chorus skitter / ram counts (PRD §5.4); moths, leeches and the Titan are in `data/swarms.ts:CHORUS`. */
    chorus: { skitter: 60, brute: 8 },
    retreatSpeedMul: 1.6,
    retreatDespawnSec: 6,
    matronBroodEverySec: 6,
    matronBroodCount: 3,
    /** Critic2 #3 off-axis trickle: opens on `trickleFromSol`, takes `trickleShare` of the non-alpha units (≥ `trickleMin`). */
    trickleFromSol: 2,
    trickleShare: 0.25,
    trickleMin: 2,
    /** PRD §5.4 Severity: +1 edge per night from this rung. */
    rungExtraEdgeFrom: 4,
  },
  fauna: {
    dmgScaleShare: 0.5,
    attackReachPx: 40,
    /** Spore Bloat burst damage to buildings in `rangeTiles`, plus this many skitters. */
    burstDamage: 40,
    burstBrood: 4,
    /** Dusk Howler aura multipliers; the Howler holds this many tiles from any turret. */
    rallySpeedMul: 1.3,
    rallyDmgMul: 1.2,
    howlerKeepTiles: 5,
    /** Chorus Titan: one stomp (dps × period) every this many seconds. */
    stompEverySec: 5,
    /** Static Leech: bank kJ drained per second per latched leech. */
    leechDrainKjPerSec: 1,
    /** PRD §5.4 Severity: fauna hp step per rung above 1. */
    rungHpStep: 0.1,
    /** `ColonyView.canSkipNight`: none within this many tiles of the field. */
    nearFieldTiles: 8,
    /** Tunnel Grub surfaces unconditionally after this many × its dig length. */
    burrowMaxMul: 3,
  },
  /** Turret rules from PRD §5.3 prose (Pulse Lattice, Arc hops, Pylon Sentries, Choir Spire). */
  defense: { latticeTiles: 3, arcHopTiles: 2, sentryRangeTiles: 2.5, sentryPeriodSec: 0.5, choirRangeTiles: 6, choirEverySec: 8 },
  /** Dawn mend pays `dawnFeEfficiency` × the building's Fe value for a full repair; the core counts as `coreFeValue`. */
  mend: { dawnFeEfficiency: 0.5, maxStockShare: 0.5, singleRepairShare: 0.5, rebuildCostRatio: 0.6, coreFeValue: 600, alloyFeValue: 2, prismFeValue: 4 },
  beacon: { unlockSol: 6, cellsToCharge: 12, chargeSec: 60, chargeKw: 5 },
  requests: { slots: 3, expirySols: 2, firstSol: 3 },
  draft: { choices: 3, freeRerolls: 1, primeWeight: 0.3, firstSol: 2, newTagDrafts: 3 },
  camera: {
    zoomStops: [0.7, 1.0, 1.4],
    swarmZoomFloor: 0.9,
    panInertia: 0.92,
    alertPanMs: 320,
    boundsPadTiles: 2,
    keyPanPxPerSec: 720,
  },
  /** `upgradeAllConfirmFe`: UPGRADE ALL above this Fe-equivalent asks to confirm (PRD §14b). */
  input: { hitMinPx: 88, doubleTapMs: 280, doubleTapPx: 24, undoDemolishSec: 3, upgradeAllConfirmFe: 100 },
  drones: { maxInFlight: 40, flightMs: 900 },
  speed: { fastMul: 2 },
  /** Data payout per settled Landing (`model/score.ts:settleLanding` → `LandingResult.data`). */
  meta: { dataBase: 30, dataPerSol: 8, dataWin: 60, dataMatron: 40, severityDataStep: 0.15, starColonistShare: 0.75, refitBase: 900, refitGrowth: 1.18, refitDataPerLevel: 0.02, refitProdPerLevel: 0.01 },
} as const;
