#!/usr/bin/env node
/**
 * Doctrine League & Adversarial Self-Play Trainer (100% Fair 1x Rules).
 *
 * Trains specialized 1-Lane, 2-Lane, and 3-Lane Doctrine profiles (including
 * adaptive strategy knobs) against:
 *  - 5 adversarial "cheese" bots (runner-rush, ballista-turtle, ward-deathball,
 *    greed-church, siege-push)
 *  - All recorded real Human Ghost replays (logs/human-matches/github-issues.json)
 *  - Classic CPU gauntlet (reactive, army, siege, towers)
 *  - Hall-of-Fame self-play mirrors (logs/doctrine-hof.json)
 *
 * Usage:
 *   npx tsx scripts/doctrine-league.mjs [--rounds 8] [--apply] [--eval-only]
 */
import fs from "node:fs";
import path from "node:path";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => {
    mem.set(k, String(v));
  },
  removeItem: (k) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
  key: (i) => Array.from(mem.keys())[i] ?? null,
  get length() {
    return mem.size;
  },
};

const { GameSim } = await import("../src/game/sim.ts");
const { doctrineProfiles, doctrineTune } = await import("../src/game/doctrineTune.ts");
const { buildOpponentProfile } = await import("../src/game/opponentProfile.ts");
const { doctrineStanceOf } = await import("../src/game/ai.ts");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const EVAL_ONLY = args.includes("--eval-only");
const roundsIdx = args.indexOf("--rounds");
const ROUNDS = roundsIdx >= 0 ? Math.max(1, Number(args[roundsIdx + 1]) || 6) : 6;

const META_KEY = "roadkeep_meta_v1";
const LOG_PATH = path.resolve("logs/human-matches/github-issues.json");
const HOF_PATH = path.resolve("logs/doctrine-hof.json");
const TUNE_PATH = path.resolve("src/game/doctrineTune.ts");

const MAPS_BY_LANES = {
  1: [
    { name: "Cinder Wold (1L)", level: 4, scoutSalt: 0, holdout: false },
    { name: "Ember Crossing (1L dry)", level: 3, scoutSalt: 1, holdout: true },
  ],
  2: [
    { name: "Crimson Chase (2L)", level: 2, scoutSalt: 0, holdout: false },
    { name: "Night Hollow (2L)", level: 1, scoutSalt: 2, holdout: true },
  ],
  3: [
    { name: "Night Crossing (3L)", level: 1, scoutSalt: 0, holdout: false },
    { name: "Dusk Glade (3L)", level: 1, scoutSalt: 1, holdout: true },
  ],
};

const ALL_MAPS = [...MAPS_BY_LANES[3], ...MAPS_BY_LANES[2], ...MAPS_BY_LANES[1]];
const CLASSIC_OPPS = ["reactive", "army", "siege", "towers"];
const CHEESE_BOTS = ["runner-rush", "ballista-turtle", "ward-deathball", "greed-church", "siege-push"];

function setMapMeta(level, scoutSalt) {
  mem.clear();
  const xp = level <= 1 ? 0 : (level - 1) * (level - 1) * 40 + 1;
  mem.set(META_KEY, JSON.stringify({ xp, level, wins: 0, matches: 0, scoutSalt }));
}

function loadHumanLogsFile() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
    return Array.isArray(parsed.matches) ? parsed.matches : [];
  } catch {
    return [];
  }
}

function loadHof() {
  if (!fs.existsSync(HOF_PATH)) {
    return {
      version: 1,
      champions: [
        {
          id: "seed-v1",
          savedAt: new Date().toISOString(),
          profiles: {
            1: { ...doctrineProfiles[1] },
            2: { ...doctrineProfiles[2] },
            3: { ...doctrineProfiles[3] },
          },
        },
      ],
    };
  }
  return JSON.parse(fs.readFileSync(HOF_PATH, "utf8"));
}

/**
 * 5 Fair 1x Adversarial Cheese Sparring Partners (playing team "you" using only
 * standard player actions: workers, buildings, upgrades, training, stances).
 */
function stepCheeseBot(sim, kind, st) {
  const team = "you";
  sim.aiAssignWorkers(team);
  const s = sim.getState();
  const t = s.time;
  const blds = sim.getBuildings(team);
  const houses = blds.filter((b) => b.kind === "house").length;
  const bars = blds.filter((b) => b.kind === "barracks").length;
  const ballistas = blds.filter((b) => b.kind === "ballista").length;
  const watches = blds.filter((b) => b.kind === "watchtower").length;
  const cats = blds.filter((b) => b.kind === "catapult").length;
  const churches = blds.filter((b) => b.kind === "church").length;
  const army = sim.armySlotsUsed(team);
  const peonGoal = kind === "runner-rush" ? 5 : 10;
  if (sim.peonSlotsUsed(team) < Math.min(peonGoal, sim.peonCap(team))) sim.enqueuePeon(team);

  if (kind === "runner-rush") {
    if (houses < 1) sim.placeAiBuilding("house", 0, team, "eco");
    else if (bars < 1) sim.placeAiBuilding("barracks", 0, team);
    else if (bars < 2 && t > 70) sim.placeAiBuilding("barracks", 0, team);
    else if (houses < 2 && t > 90) sim.placeAiBuilding("house", 0, team, "midEco");
    if (bars > 0) {
      const rot = ["runner", "runner", "levy", "runner", "rammer"];
      if (sim.aiEnqueueTrain(rot[st.ti % rot.length], team)) st.ti++;
    }
    if (t > 80) sim.aiUpgradeBarracks(team);
    sim.setDefendLayer(army >= 6 || t >= 48 ? "assault" : "home", team);
    return;
  }

  if (kind === "ballista-turtle") {
    if (houses < 2) sim.placeAiBuilding("house", 0, team, "eco");
    else if (ballistas < 2) sim.placeAiBuilding("ballista", 0, team);
    else if (bars < 1) sim.placeAiBuilding("barracks", 0, team);
    else if (ballistas < 4) sim.placeAiBuilding("ballista", 0, team);
    else if (houses + churches < 4) sim.placeAiBuilding("house", 0, team, "midEco");
    else if (churches < 2) sim.aiConsecrate(team);
    else if (cats < 1) sim.placeAiBuilding("catapult", 0, team);
    if (ballistas >= 2) sim.aiBuildDefensiveBarricade(team);
    if (t > 60 && s.gold[team] >= 120) sim.aiUpgradeDefense("adaptive", team);
    if (t > 120) sim.aiUpgradeBarracks(team);
    if (bars > 0) {
      const rot = ["trebuchet", "spy", "ward", "levy", "rammer", "archer", "ward"];
      if (sim.aiEnqueueTrain(rot[st.ti % rot.length], team)) st.ti++;
    }
    sim.setDefendLayer(army >= 26 ? "assault" : "home", team);
    return;
  }

  if (kind === "ward-deathball") {
    if (houses < 2) sim.placeAiBuilding("house", 0, team, "eco");
    else if (bars < 1) sim.placeAiBuilding("barracks", 0, team);
    else if (watches < 1) sim.placeAiBuilding("watchtower", 0, team);
    else if (bars < 2) sim.placeAiBuilding("barracks", 0, team);
    else if (houses + churches < 4) sim.placeAiBuilding("house", 0, team, "midEco");
    else if (churches < 1) sim.aiConsecrate(team);
    if (t > 75) sim.aiUpgradeBarracks(team);
    if (bars > 0) {
      const rot = ["ward", "ward", "archer", "ward", "rammer", "archer"];
      for (let i = 0; i < bars; i++) {
        if (sim.aiEnqueueTrain(rot[st.ti % rot.length], team)) st.ti++;
      }
    }
    sim.setDefendLayer(army >= 24 ? "assault" : "mid", team);
    return;
  }

  if (kind === "greed-church") {
    if (houses < 2) sim.placeAiBuilding("house", 0, team, "eco");
    else if (houses + churches < 4) sim.placeAiBuilding("house", 0, team, "midEco");
    else if (churches < 2) sim.aiConsecrate(team);
    else if (bars < 2) sim.placeAiBuilding("barracks", 0, team);
    else if (watches < 1) sim.placeAiBuilding("watchtower", 0, team);
    if (t > 110) sim.aiUpgradeBarracks(team);
    if (bars > 0) {
      const rot = ["levy", "ward", "rammer", "archer", "levy", "trebuchet"];
      for (let i = 0; i < bars; i++) {
        if (sim.aiEnqueueTrain(rot[st.ti % rot.length], team)) st.ti++;
      }
    }
    sim.setDefendLayer(army >= 28 ? "assault" : "home", team);
    return;
  }

  // siege-push
  if (houses < 2) sim.placeAiBuilding("house", 0, team, "eco");
  else if (bars < 1) sim.placeAiBuilding("barracks", 0, team);
  else if (cats < 1) sim.placeAiBuilding("catapult", 0, team);
  else if (ballistas < 1) sim.placeAiBuilding("ballista", 0, team);
  else if (houses + churches < 4) sim.placeAiBuilding("house", 0, team, "midEco");
  else if (churches < 1) sim.aiConsecrate(team);
  if (t > 90) sim.aiUpgradeBarracks(team);
  if (bars > 0) {
    const rot = ["trebuchet", "rammer", "rammer", "runner", "ward", "spy"];
    if (sim.aiEnqueueTrain(rot[st.ti % rot.length], team)) st.ti++;
  }
  sim.setDefendLayer(army >= 18 ? "assault" : "home", team);
}

function stepHumanGhost(sim, log, st) {
  sim.aiAssignWorkers("you");
  const peonGoal = Math.max(2, log.humanPeaks?.maxPeons ?? 8);
  if (sim.peonSlotsUsed("you") < Math.min(peonGoal, sim.peonCap("you"))) sim.enqueuePeon("you");
  const t = sim.getState().time;
  const order = log.humanBuildOrder ?? [];
  while (st.bi < order.length && order[st.bi].t <= t + 2) {
    const step = order[st.bi];
    const ok =
      step.kind === "church"
        ? sim.aiConsecrate("you")
        : step.kind === "barricade"
          ? sim.aiBuildDefensiveBarricade("you")
          : sim.placeAiBuilding(step.kind, 0, "you", step.zone === "road" ? undefined : step.zone);
    if (ok) st.bi++;
    else break;
  }
  const up = log.humanUpgrades ?? {};
  if ((up.barracksDamage ?? 0) + (up.barracksRate ?? 0) > 0 && t > 90) sim.aiUpgradeBarracks("you");
  if ((up.towerDamage ?? 0) + (up.towerRate ?? 0) > 0 && t > 60) sim.aiUpgradeDefense("adaptive", "you");
  if (st.pool.length > 0 && sim.getBuildings("you").some((b) => b.kind === "barracks")) {
    if (sim.aiEnqueueTrain(st.pool[st.ti % st.pool.length], "you")) st.ti++;
  }
  if (t >= (log.humanPeaks?.firstCrossSec ?? 120)) sim.setDefendLayer("assault", "you");
  else sim.setDefendLayer("home", "you");
}

function runCheeseMatch(map, cheeseKind, tune) {
  setMapMeta(map.level, map.scoutSalt);
  const sim = new GameSim();
  sim.setMatchMode("ai");
  sim.setBothCpu(false);
  sim.setCpuStyle("foe", "doctrine");
  sim.setDoctrineTune(tune, "foe");
  sim.startMatch();
  sim.toggleSpeed();
  const st = { ti: 0 };
  const stances = new Set();
  let gt = 0;
  let n = 0;
  while (sim.getState().phase === "running" && sim.getState().time < 640 && n < 16000) {
    sim.update(0.1);
    gt -= 0.1;
    if (gt <= 0) {
      stepCheeseBot(sim, cheeseKind, st);
      stances.add(doctrineStanceOf("foe"));
      gt = 1.0;
    }
    n++;
  }
  const s = sim.getState();
  const docHp = Math.round(s.keeps.foe.hp);
  const oppHp = Math.round(s.keeps.you.hp);
  const win = s.phase !== "running" && oppHp <= 0 && docHp > 0;
  const loss = s.phase !== "running" && docHp <= 0;
  return { win, loss, time: Math.round(s.time), docHp, oppHp, stances: [...stances] };
}

function runCpuMatch(map, oppStyle, side, tune, oppTune = null) {
  setMapMeta(map.level, map.scoutSalt);
  const sim = new GameSim();
  sim.setMatchMode("ai");
  sim.setBothCpu(true);
  const other = side === "you" ? "foe" : "you";
  sim.setCpuStyle(side, "doctrine");
  sim.setCpuStyle(other, oppStyle);
  sim.setDoctrineTune(tune, side);
  if (oppTune) sim.setDoctrineTune(oppTune, other);
  sim.startMatch();
  sim.toggleSpeed();
  let n = 0;
  while (sim.getState().phase === "running" && sim.getState().time < 640 && n < 16000) {
    sim.update(0.1);
    n++;
  }
  const s = sim.getState();
  const docHp = Math.round(s.keeps[side].hp);
  const oppHp = Math.round(s.keeps[other].hp);
  const win = s.phase !== "running" && oppHp <= 0 && docHp > 0;
  const loss = s.phase !== "running" && docHp <= 0;
  return { win, loss, time: Math.round(s.time), docHp, oppHp };
}

function runHumanGhostMatch(log, tune) {
  setMapMeta(log.map?.keepLevel ?? 1, log.map?.scoutSalt ?? 0);
  const sim = new GameSim();
  sim.setMatchMode("ai");
  sim.setBothCpu(false);
  sim.setCpuStyle("foe", "doctrine");
  sim.setDoctrineTune(tune, "foe");
  sim.startMatch();
  sim.toggleSpeed();
  const pool = [];
  for (const [k, c] of Object.entries(log.humanTrained ?? {})) {
    if (k === "peon") continue;
    for (let i = 0; i < Math.min(20, Number(c) || 0); i++) pool.push(k);
  }
  const st = { bi: 0, ti: 0, pool };
  let gt = 0;
  let n = 0;
  while (sim.getState().phase === "running" && sim.getState().time < 640 && n < 16000) {
    sim.update(0.1);
    gt -= 0.1;
    if (gt <= 0) {
      stepHumanGhost(sim, log, st);
      gt = 1.0;
    }
    n++;
  }
  const s = sim.getState();
  const docHp = Math.round(s.keeps.foe.hp);
  const humHp = Math.round(s.keeps.you.hp);
  const win = s.phase !== "running" && humHp <= 0 && docHp > 0;
  const loss = s.phase !== "running" && docHp <= 0;
  return { win, loss, time: Math.round(s.time), docHp, humHp };
}

function scoreResult(r, weight = 1) {
  if (r.win) return weight * (1000 + r.docHp * 1.4 - r.time * 0.45);
  if (r.loss) return weight * (-1600 - (280 - r.oppHp) * 0.5);
  return weight * ((r.docHp - r.oppHp) * 1.5 - 120);
}

/**
 * Evaluate a single lane-archetype candidate against:
 *  - All 5 adversarial cheese bots on its training map
 *  - Classic CPU styles (both sides) on its training map
 *  - Hall-of-Fame mirrors (both sides) on its training map
 *  - Up to 3 matching-lane real Human Ghost logs
 */
function evalArchetype(lanes, cand, hofPeers, humanLogs) {
  const trainMap = MAPS_BY_LANES[lanes][0];
  let score = 0;
  let wins = 0;
  let losses = 0;
  let total = 0;
  let mirrorWins = 0;
  let mirrorTotal = 0;

  for (const cheese of CHEESE_BOTS) {
    const r = runCheeseMatch(trainMap, cheese, cand);
    score += scoreResult(r, 1.4);
    total++;
    if (r.win) wins++;
    if (r.loss) losses++;
  }

  for (const opp of CLASSIC_OPPS) {
    for (const side of ["you", "foe"]) {
      const r = runCpuMatch(trainMap, opp, side, cand);
      score += scoreResult(r, 1.0);
      total++;
      if (r.win) wins++;
      if (r.loss) losses++;
    }
  }

  for (const peer of hofPeers) {
    for (const side of ["you", "foe"]) {
      const r = runCpuMatch(trainMap, "doctrine", side, cand, peer);
      score += scoreResult(r, 1.25);
      mirrorTotal++;
      if (r.win) mirrorWins++;
      if (r.loss) losses += 0.25; // mirrors aren't fatal losses, just rank signal
    }
  }

  const laneHumans = humanLogs.filter((l) => (l.map?.lanes ?? 2) === lanes).slice(0, 3);
  for (const log of laneHumans) {
    const r = runHumanGhostMatch(log, cand);
    score += scoreResult({ ...r, oppHp: r.humHp }, 1.6);
    total++;
    if (r.win) wins++;
    if (r.loss) losses++;
  }

  return { score: Math.round(score), wins, losses, total, mirrorWins, mirrorTotal };
}

const KNOB_BOUNDS = {
  attackAt: [14, 28, 2],
  trebGoal: [2, 3, 1],
  ramGoal: [4, 7, 1],
  spyGoal: [1, 3, 1],
  escortGap: [28, 44, 4],
  standoff: [165, 185, 5],
  wardPct: [20, 50, 5],
  archerPct: [10, 35, 5],
  earlyScreen: [1, 5, 1],
  churchGoal: [1, 2, 1],
  midStageAt: [8, 18, 2],
  fortressPush: [24, 34, 2],
  retreatKeepHp: [0.3, 0.6, 0.08],
  greedDrop: [3, 9, 2],
  churchSaveAt: [220, 380, 40],
  siegeTrebCap: [2, 3, 1],
};

function mutateTune(base, rng) {
  const next = { ...base };
  const keys = Object.keys(KNOB_BOUNDS);
  const picks = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < picks; i++) {
    const k = keys[Math.floor(rng() * keys.length)];
    const [lo, hi, step] = KNOB_BOUNDS[k];
    const dir = rng() < 0.5 ? -1 : 1;
    let val = Number(next[k]) + dir * step;
    val = Math.max(lo, Math.min(hi, val));
    next[k] = step < 1 ? Math.round(val * 100) / 100 : Math.round(val);
  }
  return next;
}

function makeRng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

function fullVerification(profiles, humanLogs, baselineProfiles) {
  // 1. All 11 Human Ghosts
  let hWins = 0, hLosses = 0;
  const hRows = [];
  for (const log of humanLogs) {
    const lanes = log.map?.lanes <= 1 ? 1 : log.map?.lanes >= 3 ? 3 : 2;
    const r = runHumanGhostMatch(log, profiles[lanes]);
    if (r.win) hWins++;
    if (r.loss) hLosses++;
    hRows.push({ map: log.map.name, lanes, origHumanWon: log.outcome.humanWon, win: r.win, loss: r.loss, t: r.time, docHp: r.docHp });
  }

  // 2. All 15 Adversarial Cheese matches (5 cheese bots x 1L/2L/3L)
  let cWins = 0, cLosses = 0;
  const cRows = [];
  for (const lanes of [1, 2, 3]) {
    const map = MAPS_BY_LANES[lanes][0];
    for (const cheese of CHEESE_BOTS) {
      const r = runCheeseMatch(map, cheese, profiles[lanes]);
      if (r.win) cWins++;
      if (r.loss) cLosses++;
      cRows.push({ lanes, map: map.name, cheese, win: r.win, loss: r.loss, t: r.time, docHp: r.docHp, oppHp: r.oppHp, stances: r.stances });
    }
  }

  // 3. Full 48-game Fair CPU Gauntlet (6 maps — 3 train + 3 unseen holdout)
  let gWins = 0, gLosses = 0, gMinHp = 280, gTime = 0;
  const gDraws = [];
  for (const map of ALL_MAPS) {
    const lanes = map.name.includes("(1L") ? 1 : map.name.includes("(2L") ? 2 : 3;
    for (const opp of CLASSIC_OPPS) {
      for (const side of ["you", "foe"]) {
        const r = runCpuMatch(map, opp, side, profiles[lanes]);
        gMinHp = Math.min(gMinHp, r.docHp);
        if (r.win) { gWins++; gTime += r.time; }
        else if (r.loss) gLosses++;
        else gDraws.push(`${map.name} ${side} vs ${opp} (${r.docHp}/${r.oppHp})`);
      }
    }
  }

  // 4. Mirror vs Prior Baseline (6 games: 1L/2L/3L x you/foe)
  let mWins = 0, mLosses = 0;
  for (const lanes of [1, 2, 3]) {
    const map = MAPS_BY_LANES[lanes][1]; // unseen holdout map!
    for (const side of ["you", "foe"]) {
      const r = runCpuMatch(map, "doctrine", side, profiles[lanes], baselineProfiles[lanes]);
      if (r.win) mWins++;
      if (r.loss) mLosses++;
    }
  }

  return {
    humanGhosts: { record: `${hWins}/${humanLogs.length}`, losses: hLosses, rows: hRows },
    cheeseBots: { record: `${cWins}/${cRows.length}`, losses: cLosses, rows: cRows },
    cpuGauntlet: { record: `${gWins}/48`, losses: gLosses, minHp: gMinHp, avgWinTime: Math.round(gTime / Math.max(1, gWins)), draws: gDraws },
    holdoutMirrorVsBaseline: { wins: mWins, losses: mLosses, total: 6 },
  };
}

function writeDoctrineTuneTs(profiles) {
  const fmt = (obj, indent = "  ") =>
    Object.entries(obj)
      .map(([k, v]) => `${indent}${k}: ${v},`)
      .join("\n");

  const src = `/** Knobs the doctrine feedback loop & league trainer are allowed to evolve. */
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
${fmt(profiles[2], "  ")}
};

/**
 * Specialized profiles per map geometry (1-lane choke, 2-lane skirmish, 3-lane wide).
 * Trained by \`scripts/doctrine-league.mjs\`.
 */
export const doctrineProfiles: Record<1 | 2 | 3, DoctrineTune> = {
  1: {
${fmt(profiles[1], "    ")}
  },
  2: {
${fmt(profiles[2], "    ")}
  },
  3: {
${fmt(profiles[3], "    ")}
  },
};

export function doctrineProfileForLanes(lanes: number): DoctrineTune {
  const key: 1 | 2 | 3 = lanes <= 1 ? 1 : lanes >= 3 ? 3 : 2;
  return { ...doctrineProfiles[key] };
}
`;
  fs.writeFileSync(TUNE_PATH, src, "utf8");
}

// --- Main ---
const humanLogs = loadHumanLogsFile();
const hof = loadHof();
const humanProfileSummary = buildOpponentProfile(humanLogs);

console.log("=== Human Log Cross-Match Profile ===");
console.log(JSON.stringify(humanProfileSummary, null, 2));

const baselineProfiles = {
  1: { ...doctrineProfiles[1] },
  2: { ...doctrineProfiles[2] },
  3: { ...doctrineProfiles[3] },
};

if (EVAL_ONLY) {
  const report = fullVerification(baselineProfiles, humanLogs, baselineProfiles);
  console.log("=== Full Evaluation (Current Profiles) ===");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const bestProfiles = {
  1: { ...doctrineProfiles[1] },
  2: { ...doctrineProfiles[2] },
  3: { ...doctrineProfiles[3] },
};

const rng = makeRng(20261121);
const recentHof = hof.champions.slice(-2);

for (const lanes of [1, 2, 3]) {
  const peers = recentHof.map((c) => c.profiles[lanes] ?? doctrineTune);
  let best = bestProfiles[lanes];
  let bestEval = evalArchetype(lanes, best, peers, humanLogs);
  console.log(`\n[League ${lanes}L] Base: score=${bestEval.score} W=${bestEval.wins}/${bestEval.total} L=${bestEval.losses} mirrors=${bestEval.mirrorWins}/${bestEval.mirrorTotal}`);

  for (let r = 1; r <= ROUNDS; r++) {
    const cand = mutateTune(best, rng);
    const ev = evalArchetype(lanes, cand, peers, humanLogs);
    const better =
      ev.losses <= bestEval.losses &&
      (ev.wins > bestEval.wins || (ev.wins === bestEval.wins && ev.score > bestEval.score + 20));
    console.log(
      `  round ${r}/${ROUNDS}: score=${ev.score} W=${ev.wins}/${ev.total} L=${ev.losses} mirrors=${ev.mirrorWins}/${ev.mirrorTotal}${better ? "  <-- PROMOTED" : ""}`,
    );
    if (better) {
      best = cand;
      bestEval = ev;
    }
  }
  bestProfiles[lanes] = best;
}

console.log("\n=== Running Full Verification (Human Ghosts + 15 Cheese Bots + 48 CPU Gauntlet + Holdout Mirrors) ===");
const finalReport = fullVerification(bestProfiles, humanLogs, baselineProfiles);
console.log(JSON.stringify(finalReport, null, 2));

if (APPLY) {
  const promoted =
    finalReport.humanGhosts.losses === 0 &&
    finalReport.cpuGauntlet.losses === 0 &&
    finalReport.cheeseBots.losses === 0;
  if (promoted) {
    writeDoctrineTuneTs(bestProfiles);
    hof.champions.push({
      id: `league-${new Date().toISOString().slice(0, 19)}`,
      savedAt: new Date().toISOString(),
      summary: {
        humanGhosts: finalReport.humanGhosts.record,
        cheeseBots: finalReport.cheeseBots.record,
        cpuGauntlet: finalReport.cpuGauntlet.record,
        holdoutMirrors: finalReport.holdoutMirrorVsBaseline,
      },
      profiles: bestProfiles,
    });
    fs.mkdirSync(path.dirname(HOF_PATH), { recursive: true });
    fs.writeFileSync(HOF_PATH, JSON.stringify(hof, null, 2), "utf8");
    console.log("\n✅ Promoted new 1L/2L/3L Doctrine profiles into src/game/doctrineTune.ts and updated logs/doctrine-hof.json!");
  } else {
    console.log("\n⚠️ Verification had a loss — keeping prior profiles safe. Inspect rows above!");
  }
}
