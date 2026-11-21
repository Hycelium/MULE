import { loadHumanLogs, type HumanMatchLog } from "./matchLog";

export type OpponentTag =
  | "none"
  | "balanced"
  | "fortress"
  | "rusher"
  | "greed"
  | "siege"
  | "wards"
  | "archers";

export interface OpponentTendency {
  sampleSize: number;
  tag: OpponentTag;
  fortressRate: number;
  ballistaRate: number;
  earlyRushRate: number;
  greedRate: number;
  siegeRate: number;
  wardRate: number;
  archerRate: number;
  humanWinRate: number;
}

const EMPTY_PROFILE: OpponentTendency = {
  sampleSize: 0,
  tag: "none",
  fortressRate: 0,
  ballistaRate: 0,
  earlyRushRate: 0,
  greedRate: 0,
  siegeRate: 0,
  wardRate: 0,
  archerRate: 0,
  humanWinRate: 0,
};

/**
 * Computes a fair cross-match tendency profile from completed historical human
 * logs (never peeks into the current match's hidden queues). Requires >= 2
 * completed matches so a single game never over-biases Doctrine's opening.
 */
export function buildOpponentProfile(logs: HumanMatchLog[]): OpponentTendency {
  const recent = logs.slice(-10);
  if (recent.length < 2) return EMPTY_PROFILE;

  let wSum = 0;
  let fortressW = 0;
  let ballistaW = 0;
  let rushW = 0;
  let greedW = 0;
  let siegeW = 0;
  let wardW = 0;
  let archerW = 0;
  let humanWinW = 0;

  // Exponential recency weighting so recent adaptations matter more than stale games.
  for (let i = 0; i < recent.length; i++) {
    const log = recent[i]!;
    const age = recent.length - 1 - i;
    const w = Math.pow(0.84, age);
    wSum += w;

    const builds = log.humanBuildOrder ?? [];
    const towers = builds.filter(
      (b) => b.kind === "watchtower" || b.kind === "ballista" || b.kind === "catapult",
    ).length;
    const ballistas = builds.filter((b) => b.kind === "ballista").length;
    const earlyTowers = builds.filter(
      (b) =>
        b.t <= 150 &&
        (b.kind === "watchtower" || b.kind === "ballista" || b.kind === "catapult"),
    ).length;
    const earlyEco = builds.filter(
      (b) => b.t <= 150 && (b.kind === "house" || b.kind === "church"),
    ).length;

    if (towers >= 3) fortressW += w;
    if (ballistas >= 2) ballistaW += w;
    if (log.humanPeaks?.firstCrossSec != null && log.humanPeaks.firstCrossSec <= 95) {
      rushW += w;
    }
    if (earlyEco >= 3 && earlyTowers <= 1) greedW += w;

    const tr = log.humanTrained ?? {};
    const trebs = Number(tr.trebuchet ?? 0);
    const rams = Number(tr.rammer ?? 0);
    const wards = Number(tr.ward ?? 0);
    const archers = Number(tr.archer ?? 0);
    const levies = Number(tr.levy ?? 0);
    const runners = Number(tr.runner ?? 0);
    const infTotal = Math.max(1, wards + archers + levies + runners);

    if (trebs >= 1 || rams >= 4) siegeW += w;
    if (wards / infTotal >= 0.38 && wards >= 4) wardW += w;
    if (archers / infTotal >= 0.38 && archers >= 5) archerW += w;
    if (log.outcome?.humanWon === true) humanWinW += w;
  }

  const inv = 1 / Math.max(1e-6, wSum);
  const fortressRate = fortressW * inv;
  const ballistaRate = ballistaW * inv;
  const earlyRushRate = rushW * inv;
  const greedRate = greedW * inv;
  const siegeRate = siegeW * inv;
  const wardRate = wardW * inv;
  const archerRate = archerW * inv;
  const humanWinRate = humanWinW * inv;

  // Pick strongest dominant tendency if clearly above 50%.
  const candidates: Array<[OpponentTag, number]> = [
    ["rusher", earlyRushRate],
    ["fortress", fortressRate],
    ["siege", siegeRate],
    ["greed", greedRate],
    ["wards", wardRate],
    ["archers", archerRate],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  const tag: OpponentTag = candidates[0]![1] >= 0.52 ? candidates[0]![0] : "balanced";

  return {
    sampleSize: recent.length,
    tag,
    fortressRate,
    ballistaRate,
    earlyRushRate,
    greedRate,
    siegeRate,
    wardRate,
    archerRate,
    humanWinRate,
  };
}

export function loadLocalOpponentProfile(): OpponentTendency {
  return buildOpponentProfile(loadHumanLogs());
}
