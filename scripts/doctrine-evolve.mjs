/**
 * Multi-map evolutionary self-improvement feedback loop for Doctrine.
 * Trains across 1-road, 2-road, and 3-road maps against all 4 commanders
 * (reactive, army, siege, towers) from both keeps AND head-to-head against
 * the current Champion and Hall of Fame. Certifies on 3 unseen holdout maps.
 *
 *   npx tsx scripts/doctrine-evolve.mjs
 */
import fs from "node:fs";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const { GameSim } = await import("../src/game/sim.ts");
const { doctrineTune: initialTune } = await import("../src/game/doctrineTune.ts");

const META_KEY = "roadkeep_meta_v1";
const OPPONENTS = ["reactive", "army", "siege", "towers"];

// 3-lane, 2-lane, 1-lane training maps
const TRAIN_MAPS = [
  { name: "Night Crossing (3L)", level: 1, scoutSalt: 0 },
  { name: "Crimson Chase (2L)", level: 2, scoutSalt: 0 },
  { name: "Cinder Wold (1L)", level: 4, scoutSalt: 0 },
];

// 3-lane, 2-lane, 1-lane unseen holdout maps
const HOLDOUT_MAPS = [
  { name: "Dusk Glade (3L)", level: 1, scoutSalt: 1 },
  { name: "Night Hollow (2L)", level: 1, scoutSalt: 2 },
  { name: "Ember Crossing (1L)", level: 3, scoutSalt: 1 },
];

function seedMap(level, scoutSalt) {
  mem.clear();
  const xp = level <= 1 ? 0 : (level - 1) * (level - 1) * 40 + 1;
  mem.set(META_KEY, JSON.stringify({ xp, level, wins: 0, matches: 0, scoutSalt }));
}

function playMatch(southStyle, northStyle, southTune, northTune, map, maxTime = 640) {
  seedMap(map.level, map.scoutSalt);
  const sim = new GameSim();
  if (southTune) sim.setDoctrineTune(southTune, "you");
  if (northTune) sim.setDoctrineTune(northTune, "foe");
  sim.setMatchMode("ai");
  sim.setBothCpu(true);
  sim.setCpuStyle("you", southStyle);
  sim.setCpuStyle("foe", northStyle);
  sim.startMatch();
  sim.toggleSpeed();
  let steps = 0;
  const maxSteps = Math.ceil(maxTime * 25);
  while (sim.getState().phase === "running" && sim.getState().time < maxTime && steps < maxSteps) {
    sim.update(0.1);
    steps++;
  }
  const s = sim.getState();
  return {
    ended: s.phase !== "running",
    time: Math.round(s.time),
    you: Math.round(s.keeps.you.hp),
    foe: Math.round(s.keeps.foe.hp),
  };
}

function scoreSide(match, docSide, maxTime = 640) {
  const docHp = docSide === "you" ? match.you : match.foe;
  const foeHp = docSide === "you" ? match.foe : match.you;
  const won = match.ended && foeHp <= 0 && docHp > 0;
  const lost = match.ended && docHp <= 0 && foeHp > 0;
  const speedBonus = won ? (maxTime - match.time) * 1.1 : 0;
  // Penalize reckless greed that leaves our keep below 200 HP.
  const keepPenalty = docHp < 200 ? (200 - docHp) * 3 : 0;
  const score = (won ? 1000 : lost ? -900 : 0) + speedBonus + (docHp - foeHp) - keepPenalty;
  return { won, lost, docHp, foeHp, time: match.time, score };
}

function evalMaps(tune, maps) {
  let total = 0;
  let wins = 0;
  let losses = 0;
  let winTimeSum = 0;
  let minKeepHp = 280;
  const perMap = [];
  for (const map of maps) {
    let mScore = 0;
    let mWins = 0;
    let mLosses = 0;
    let mTime = 0;
    const breakdown = {};
    for (const opp of OPPONENTS) {
      const south = scoreSide(playMatch("doctrine", opp, tune, null, map), "you");
      const north = scoreSide(playMatch(opp, "doctrine", null, tune, map), "foe");
      mScore += south.score + north.score;
      minKeepHp = Math.min(minKeepHp, south.docHp, north.docHp);
      if (south.won) {
        mWins++;
        mTime += south.time;
      }
      if (north.won) {
        mWins++;
        mTime += north.time;
      }
      if (south.lost) mLosses++;
      if (north.lost) mLosses++;
      breakdown[opp] = {
        south: `${south.won ? "W" : south.lost ? "L" : "D"}(${south.docHp}/${south.foeHp}@${south.time}s)`,
        north: `${north.won ? "W" : north.lost ? "L" : "D"}(${north.docHp}/${north.foeHp}@${north.time}s)`,
      };
    }
    total += mScore;
    wins += mWins;
    losses += mLosses;
    winTimeSum += mTime;
    perMap.push({
      map: map.name,
      wins: `${mWins}/8`,
      losses: mLosses,
      avgWinTime: mWins > 0 ? Math.round(mTime / mWins) : 640,
      score: Math.round(mScore),
      breakdown,
    });
  }
  return {
    score: Math.round(total),
    wins,
    games: maps.length * OPPONENTS.length * 2,
    losses,
    minKeepHp,
    avgWinTime: wins > 0 ? Math.round(winTimeSum / wins) : 640,
    perMap,
  };
}

function evalMirrorSuite(challenger, opponents) {
  let wins = 0;
  let losses = 0;
  let delta = 0;
  for (const oppTune of opponents) {
    for (const map of [TRAIN_MAPS[0], TRAIN_MAPS[1]]) {
      const south = scoreSide(playMatch("doctrine", "doctrine", challenger, oppTune, map), "you");
      const north = scoreSide(playMatch("doctrine", "doctrine", oppTune, challenger, map), "foe");
      wins += (south.won ? 1 : 0) + (north.won ? 1 : 0);
      losses += (south.lost ? 1 : 0) + (north.lost ? 1 : 0);
      delta += south.score + north.score;
    }
  }
  return { wins, losses, delta: Math.round(delta) };
}

const SPACE = {
  attackAt: [12, 16, 20, 24, 28],
  trebGoal: [2, 3, 4, 5, 6],
  ramGoal: [2, 3, 4, 5, 6],
  spyGoal: [0, 1, 2],
  escortGap: [22, 34, 46],
  standoff: [165, 175, 185],
  padGuards: [0, 1, 2],
  barracksGoal: [1, 2, 3],
  ballistaGoal: [1, 2],
  wardPct: [20, 30, 35, 45],
  archerPct: [15, 25, 35],
  earlyScreen: [0, 2, 4],
  ecoFirst: [0, 1],
  barricades: [0, 1],
  churchGoal: [0, 1, 2],
};

function saveTune(tune) {
  const file = `/** Knobs the doctrine feedback loop is allowed to change. */
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
};

export const doctrineTune: DoctrineTune = {
  attackAt: ${tune.attackAt},
  trebGoal: ${tune.trebGoal},
  ramGoal: ${tune.ramGoal},
  spyGoal: ${tune.spyGoal},
  escortGap: ${tune.escortGap},
  standoff: ${tune.standoff},
  padGuards: ${tune.padGuards},
  barracksGoal: ${tune.barracksGoal},
  ballistaGoal: ${tune.ballistaGoal},
  wardPct: ${tune.wardPct},
  archerPct: ${tune.archerPct},
  earlyScreen: ${tune.earlyScreen},
  ecoFirst: ${tune.ecoFirst},
  barricades: ${tune.barricades},
  churchGoal: ${tune.churchGoal},
};
`;
  fs.writeFileSync(new URL("../src/game/doctrineTune.ts", import.meta.url), file);
}

let champion = { ...initialTune };
let champEval = evalMaps(champion, TRAIN_MAPS);
const hallOfFame = [{ ...champion }];
console.log(
  "START",
  JSON.stringify({
    wins: `${champEval.wins}/${champEval.games}`,
    losses: champEval.losses,
    avgWinTime: champEval.avgWinTime,
    minKeepHp: champEval.minKeepHp,
    score: champEval.score,
    champion,
  }),
);

let rngState = 0x9e3779b9;
const rand = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};

const keys = Object.keys(SPACE);
const tried = new Set([JSON.stringify(champion)]);

function tryCandidate(tag, next) {
  const sig = JSON.stringify(next);
  if (tried.has(sig)) return false;
  tried.add(sig);

  // Fast pre-screen on Map 0 before running the full 3-map suite.
  const screen = evalMaps(next, [TRAIN_MAPS[0]]);
  if (screen.losses > 0 || screen.wins < champEval.perMap[0].wins.split("/")[0] * 1) return false;
  if (screen.score < champEval.perMap[0].score - 250) return false;

  const full = evalMaps(next, TRAIN_MAPS);
  if (full.losses > champEval.losses) return false;
  if (full.wins < champEval.wins) return false;
  if (full.wins === champEval.wins && full.score <= champEval.score + 40) return false;

  // Must hold its own against the current champion and recent Hall of Fame.
  const recentHof = hallOfFame.slice(-2);
  const mirror = evalMirrorSuite(next, recentHof);
  const promoted = mirror.losses <= mirror.wins && mirror.delta >= -150;
  console.log(
    JSON.stringify({
      tag,
      promoted,
      wins: `${full.wins}/${full.games}`,
      losses: full.losses,
      avgWinTime: full.avgWinTime,
      minKeepHp: full.minKeepHp,
      score: full.score,
      prevScore: champEval.score,
      mirror: `${mirror.wins}W-${mirror.losses}L (${mirror.delta})`,
      diff: Object.fromEntries(keys.filter((k) => next[k] !== champion[k]).map((k) => [k, `${champion[k]}->${next[k]}`])),
    }),
  );
  if (promoted) {
    champion = next;
    champEval = full;
    hallOfFame.push({ ...champion });
    saveTune(champion);
    return true;
  }
  return false;
}

const order = [
  "attackAt",
  "ballistaGoal",
  "barracksGoal",
  "churchGoal",
  "padGuards",
  "trebGoal",
  "ramGoal",
  "spyGoal",
  "wardPct",
  "archerPct",
  "earlyScreen",
  "barricades",
  "ecoFirst",
  "escortGap",
];

// Phase 1: Coordinate sweep across all knobs (2 passes).
for (let pass = 1; pass <= 2; pass++) {
  let improved = false;
  for (const key of order) {
    for (const val of SPACE[key]) {
      if (champion[key] === val) continue;
      if (tryCandidate(`coord-p${pass}:${key}=${val}`, { ...champion, [key]: val })) {
        improved = true;
      }
    }
  }
  if (!improved) break;
}

// Phase 2: Multi-knob mutations (2-3 simultaneous edits) to escape local optima.
for (let m = 1; m <= 24; m++) {
  const next = { ...champion };
  const nMut = 2 + (m % 2);
  for (let i = 0; i < nMut; i++) {
    const k = order[Math.floor(rand() * order.length)];
    const vals = SPACE[k];
    next[k] = vals[Math.floor(rand() * vals.length)];
  }
  tryCandidate(`mut-${m}`, next);
}

// Phase 3: Unseen Holdout Certification across 3 completely separate maps (24 matches).
const holdout = evalMaps(champion, HOLDOUT_MAPS);
const vsInitial = evalMirrorSuite(champion, [initialTune]);

console.log(
  "FINAL",
  JSON.stringify(
    {
      champion,
      train: {
        wins: `${champEval.wins}/${champEval.games}`,
        losses: champEval.losses,
        avgWinTime: champEval.avgWinTime,
        minKeepHp: champEval.minKeepHp,
        score: champEval.score,
        perMap: champEval.perMap,
      },
      holdout: {
        wins: `${holdout.wins}/${holdout.games}`,
        losses: holdout.losses,
        avgWinTime: holdout.avgWinTime,
        minKeepHp: holdout.minKeepHp,
        score: holdout.score,
        perMap: holdout.perMap,
      },
      vsInitialMirror: vsInitial,
    },
    null,
    2,
  ),
);
