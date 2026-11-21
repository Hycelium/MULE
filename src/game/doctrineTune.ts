/** Knobs the doctrine feedback loop & league trainer are allowed to evolve. */
export type DoctrineTune = {
  attackAt: number;
  trebGoal: number;
  ramGoal: number;
  spyGoal: number;
  escortGap: number;
  standoff: number;
  padGuards: number;
  barracksGoal: number;
  ballistaGoal: number;
  wardPct: number;
  archerPct: number;
  earlyScreen: number;
  ecoFirst: number;
  barricades: number;
  churchGoal: number;
  /** Army slot count where Doc advances from Home to Mid/Bridge to hold midfield. */
  midStageAt: number;
  /** Minimum army slots required before assaulting a >= 3-tower fortress. */
  fortressPush: number;
  /** Enemy keep HP ratio above which Doc aborts a stalled push if all siege dies. */
  retreatKeepHp: number;
  /** How many slots to lower pushFloor when punishing a greedy low-defense boom. */
  greedDrop: number;
  /** Gold floor where Doc starts reserving gold for a 500g Church. */
  churchSaveAt: number;
  /** Max trebuchets Doc will bank for against heavy fortresses. */
  siegeTrebCap: number;
};

/** Default balanced profile (used as fallback and 2-lane baseline). */
export const doctrineTune: DoctrineTune = {
  attackAt: 20,
  trebGoal: 2,
  ramGoal: 6,
  spyGoal: 1,
  escortGap: 30,
  standoff: 175,
  padGuards: 0,
  barracksGoal: 1,
  ballistaGoal: 1,
  wardPct: 45,
  archerPct: 25,
  earlyScreen: 2,
  ecoFirst: 1,
  barricades: 1,
  churchGoal: 2,
  midStageAt: 12,
  fortressPush: 28,
  retreatKeepHp: 0.45,
  greedDrop: 6,
  churchSaveAt: 320,
  siegeTrebCap: 3,
};

/**
 * Specialized profiles per map geometry (1-lane choke, 2-lane skirmish, 3-lane wide).
 * Trained by `scripts/doctrine-league.mjs`.
 */
export const doctrineProfiles: Record<1 | 2 | 3, DoctrineTune> = {
  1: {
    attackAt: 20,
    trebGoal: 2,
    ramGoal: 6,
    spyGoal: 2,
    escortGap: 38,
    standoff: 175,
    padGuards: 0,
    barracksGoal: 1,
    ballistaGoal: 1,
    wardPct: 35,
    archerPct: 25,
    earlyScreen: 2,
    ecoFirst: 1,
    barricades: 1,
    churchGoal: 2,
    midStageAt: 12,
    fortressPush: 28,
    retreatKeepHp: 0.45,
    greedDrop: 5,
    churchSaveAt: 220,
    siegeTrebCap: 3,
  },
  2: {
    attackAt: 20,
    trebGoal: 2,
    ramGoal: 6,
    spyGoal: 1,
    escortGap: 30,
    standoff: 175,
    padGuards: 0,
    barracksGoal: 1,
    ballistaGoal: 1,
    wardPct: 45,
    archerPct: 25,
    earlyScreen: 2,
    ecoFirst: 1,
    barricades: 1,
    churchGoal: 2,
    midStageAt: 12,
    fortressPush: 28,
    retreatKeepHp: 0.45,
    greedDrop: 6,
    churchSaveAt: 320,
    siegeTrebCap: 3,
  },
  3: {
    attackAt: 17,
    trebGoal: 2,
    ramGoal: 4,
    spyGoal: 1,
    escortGap: 34,
    standoff: 175,
    padGuards: 0,
    barracksGoal: 1,
    ballistaGoal: 1,
    wardPct: 40,
    archerPct: 25,
    earlyScreen: 2,
    ecoFirst: 1,
    barricades: 1,
    churchGoal: 2,
    midStageAt: 11,
    fortressPush: 27,
    retreatKeepHp: 0.42,
    greedDrop: 9,
    churchSaveAt: 280,
    siegeTrebCap: 3,
  },
};

export function doctrineProfileForLanes(lanes: number): DoctrineTune {
  const key: 1 | 2 | 3 = lanes <= 1 ? 1 : lanes >= 3 ? 3 : 2;
  return { ...doctrineProfiles[key] };
}
