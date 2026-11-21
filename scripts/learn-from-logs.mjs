/**
 * Train Doctrine from real Human vs CPU match logs.
 *
 * 1. Drop exported JSON logs into logs/human-matches/, OR pull GitHub issue logs:
 *      npx tsx scripts/learn-from-logs.mjs --pull-github
 * 2. Replays each human match as a "Human Ghost" (matching the human's recorded
 *    build order, upgrades, and unit mix on the same map) and evolves Doctrine
 *    to beat those human strategies while keeping its gauntlet dominance.
 *
 *   npx tsx scripts/learn-from-logs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
const { doctrineTune: currentTune } = await import("../src/game/doctrineTune.ts");

const LOG_DIR = path.resolve("logs/human-matches");
const META_KEY = "roadkeep_meta_v1";
const REPO = "Hycelium/MULE";

function pullGithubIssueLogs() {
  const out = execFileSync(
    "gh",
    ["issue", "list", "--repo", REPO, "--state", "all", "--limit", "100", "--search", "Human Match Log", "--json", "number,title,body"],
    { encoding: "utf8" },
  );
  const issues = JSON.parse(out);
  const extracted = [];
  for (const issue of issues) {
    const match = issue.body?.match(/```json\s*([\s\S]*?)```/);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed?.version === 1 && parsed?.outcome) extracted.push(parsed);
    } catch {
      /* skip malformed issue body */
    }
  }
  const dest = path.join(LOG_DIR, "github-issues.json");
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(
    dest,
    JSON.stringify({ schema: "roadkeep-human-logs-v1", syncedAt: new Date().toISOString(), matches: extracted }, null, 2),
  );
  console.log(`Synced ${extracted.length} human match log(s) from GitHub issues -> ${dest}`);
}

function loadAllLogs() {
  if (!fs.existsSync(LOG_DIR)) return [];
  const byId = new Map();
  for (const name of fs.readdirSync(LOG_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(LOG_DIR, name), "utf8"));
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.matches) ? parsed.matches : parsed.version === 1 ? [parsed] : [];
      for (const entry of list) {
        if (entry?.id && entry?.outcome) byId.set(entry.id, entry);
      }
    } catch {
      /* ignore invalid file */
    }
  }
  return [...byId.values()].sort((a, b) => String(a.playedAt).localeCompare(String(b.playedAt)));
}

function seedMap(level, scoutSalt) {
  mem.clear();
  const xp = level <= 1 ? 0 : (level - 1) * (level - 1) * 40 + 1;
  mem.set(META_KEY, JSON.stringify({ xp, level, wins: 0, matches: 0, scoutSalt }));
}

/** Drive the south team ("you") using a recorded human match's build order & unit mix. */
function stepHumanGhost(sim, log, state) {
  sim.aiAssignWorkers("you");
  const peonGoal = Math.max(2, log.humanPeaks?.maxPeons ?? 8);
  if (sim.peonSlotsUsed("you") < Math.min(peonGoal, sim.peonCap("you"))) sim.enqueuePeon("you");

  const t = sim.getState().time;
  const order = log.humanBuildOrder ?? [];
  while (state.buildIdx < order.length && order[state.buildIdx].t <= t + 2) {
    const step = order[state.buildIdx];
    let done = false;
    if (step.kind === "church") done = sim.aiConsecrate("you");
    else if (step.kind === "barricade") done = sim.aiBuildDefensiveBarricade("you");
    else done = sim.placeAiBuilding(step.kind, 0, "you", step.zone === "road" ? undefined : step.zone);
    if (done) state.buildIdx++;
    else break;
  }

  const up = log.humanUpgrades ?? {};
  if ((up.barracksDamage ?? 0) + (up.barracksRate ?? 0) > 0 && t > 90) sim.aiUpgradeBarracks("you");
  if ((up.towerDamage ?? 0) + (up.towerRate ?? 0) > 0 && t > 60) sim.aiUpgradeDefense("adaptive", "you");

  if (state.unitPool.length > 0 && sim.getBuildings("you").some((b) => b.kind === "barracks")) {
    const pick = state.unitPool[state.trainIdx % state.unitPool.length];
    if (sim.aiEnqueueTrain(pick, "you")) state.trainIdx++;
  }

  const firstCross = log.humanPeaks?.firstCrossSec ?? 120;
  if (t >= firstCross) sim.setDefendLayer("assault", "you");
  else sim.setDefendLayer("home", "you");
}

function playVsGhost(tune, log, maxTime = 640) {
  seedMap(log.map?.keepLevel ?? 1, log.map?.scoutSalt ?? 0);
  const sim = new GameSim();
  sim.setDoctrineTune(tune, "foe");
  sim.setMatchMode("ai");
  sim.setBothCpu(false);
  sim.setCpuStyle("foe", "doctrine");
  sim.startMatch();
  sim.toggleSpeed();

  const unitPool = [];
  for (const [kind, count] of Object.entries(log.humanTrained ?? {})) {
    if (kind === "peon") continue;
    for (let i = 0; i < Math.min(20, Number(count) || 0); i++) unitPool.push(kind);
  }
  const ghost = { buildIdx: 0, trainIdx: 0, unitPool };
  let ghostTimer = 0;
  let steps = 0;
  while (sim.getState().phase === "running" && sim.getState().time < maxTime && steps < maxTime * 25) {
    sim.update(0.1);
    ghostTimer -= 0.1;
    if (ghostTimer <= 0) {
      stepHumanGhost(sim, log, ghost);
      ghostTimer = 1.0;
    }
    steps++;
  }
  const s = sim.getState();
  const docHp = Math.round(s.keeps.foe.hp);
  const humanHp = Math.round(s.keeps.you.hp);
  const docWon = s.phase !== "running" && humanHp <= 0 && docHp > 0;
  const docLost = s.phase !== "running" && docHp <= 0 && humanHp > 0;
  const weight = log.outcome.humanWon ? 2.0 : 1.0;
  const keepPenalty = docHp < 180 ? (180 - docHp) * 3 : 0;
  const score =
    weight * ((docWon ? 1200 : docLost ? -1000 : 0) + (docWon ? (maxTime - s.time) * 1.1 : 0) + (docHp - humanHp) - keepPenalty);
  return { docWon, docLost, docHp, humanHp, time: Math.round(s.time), score };
}

function playVsCpu(tune, opp, side, map = { level: 1, scoutSalt: 0 }, maxTime = 640) {
  seedMap(map.level, map.scoutSalt);
  const sim = new GameSim();
  sim.setDoctrineTune(tune, side);
  sim.setMatchMode("ai");
  sim.setBothCpu(true);
  sim.setCpuStyle("you", side === "you" ? "doctrine" : opp);
  sim.setCpuStyle("foe", side === "foe" ? "doctrine" : opp);
  sim.startMatch();
  sim.toggleSpeed();
  let steps = 0;
  while (sim.getState().phase === "running" && sim.getState().time < maxTime && steps < maxTime * 25) {
    sim.update(0.1);
    steps++;
  }
  const s = sim.getState();
  const docHp = Math.round(s.keeps[side].hp);
  const foeHp = Math.round(s.keeps[side === "you" ? "foe" : "you"].hp);
  const won = s.phase !== "running" && foeHp <= 0 && docHp > 0;
  const lost = s.phase !== "running" && docHp <= 0 && foeHp > 0;
  return { won, lost, docHp, foeHp, time: Math.round(s.time) };
}

const SPACE = {
  attackAt: [8, 12, 16, 20, 24],
  trebGoal: [2, 3, 4, 5, 6],
  ramGoal: [2, 3, 4, 6],
  spyGoal: [0, 1, 2],
  padGuards: [0, 1, 2],
  barracksGoal: [1, 2],
  ballistaGoal: [1, 2],
  wardPct: [20, 35, 45],
  archerPct: [15, 25, 35],
  earlyScreen: [0, 2, 4, 6],
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

if (process.argv.includes("--pull-github")) pullGithubIssueLogs();

const logs = loadAllLogs();
if (logs.length === 0) {
  console.log("No human match logs found in logs/human-matches/.");
  console.log("Play on GitHub Pages, click 'Save Log (.json)' or 'Send to GitHub', then re-run:");
  console.log("  npx tsx scripts/learn-from-logs.mjs --pull-github");
  process.exit(0);
}

const humanWins = logs.filter((l) => l.outcome.humanWon === true).length;
const docWins = logs.filter((l) => l.outcome.humanWon === false).length;
console.log(`Loaded ${logs.length} human match(es): Doctrine ${docWins}W - ${humanWins}L vs Humans.`);

// Prioritize recent human losses + recent wins (up to 12 replays per evaluation).
const trainLogs = [
  ...logs.filter((l) => l.outcome.humanWon === true).slice(-8),
  ...logs.filter((l) => l.outcome.humanWon !== true).slice(-4),
];

function evaluate(tune) {
  let score = 0;
  let ghostWins = 0;
  let ghostLosses = 0;
  for (const log of trainLogs) {
    const r = playVsGhost(tune, log);
    score += r.score;
    if (r.docWon) ghostWins++;
    if (r.docLost) ghostLosses++;
  }
  // Guardrail: must still beat Towers and Army from both keeps.
  let cpuWins = 0;
  let cpuLosses = 0;
  for (const opp of ["towers", "army", "reactive", "siege"]) {
    for (const side of ["you", "foe"]) {
      const r = playVsCpu(tune, opp, side);
      if (r.won) cpuWins++;
      if (r.lost) cpuLosses++;
    }
  }
  return { score: Math.round(score) + cpuWins * 400 - cpuLosses * 1200, ghostWins, ghostLosses, cpuWins, cpuLosses };
}

let champion = { ...currentTune };
let champEval = evaluate(champion);
console.log("BASELINE", JSON.stringify({ ...champEval, ghosts: trainLogs.length }));

for (const [key, values] of Object.entries(SPACE)) {
  for (const val of values) {
    if (champion[key] === val) continue;
    const next = { ...champion, [key]: val };
    const res = evaluate(next);
    const better =
      res.cpuLosses === 0 &&
      res.cpuWins >= champEval.cpuWins &&
      res.ghostLosses <= champEval.ghostLosses &&
      (res.ghostWins > champEval.ghostWins || (res.ghostWins === champEval.ghostWins && res.score > champEval.score + 40));
    if (better) {
      console.log("PROMOTED", JSON.stringify({ key, from: champion[key], to: val, ...res }));
      champion = next;
      champEval = res;
      saveTune(champion);
    }
  }
}

console.log("DONE", JSON.stringify({ champion, result: champEval }, null, 2));
