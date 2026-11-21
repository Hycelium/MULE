/**
 * Hill-climb Doctrine's knobs against Towers, then save the best set.
 *   npx tsx scripts/doctrine-loop.mjs
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
const line = (b) => b.hp > 0 && (b.kind === "watchtower" || b.kind === "ballista" || b.kind === "catapult");

function play(tune, south, north) {
  mem.clear();
  const sim = new GameSim();
  sim.setDoctrineTune(tune);
  sim.setMatchMode("ai");
  sim.setBothCpu(true);
  sim.setCpuStyle("you", south);
  sim.setCpuStyle("foe", north);
  sim.startMatch();
  sim.toggleSpeed();
  let n = 0;
  const enemy = south === "doctrine" ? "foe" : "you";
  while (sim.getState().phase === "running" && sim.getState().time < 640 && n < 16000) {
    sim.update(0.1);
    n++;
  }
  const s = sim.getState();
  const you = s.keeps.you.hp;
  const foe = s.keeps.foe.hp;
  const doctrineHp = south === "doctrine" ? you : foe;
  const enemyHp = south === "doctrine" ? foe : you;
  const towers = sim.getBuildings(enemy).filter(line);
  const towerHp = towers.reduce((n, b) => n + b.hp, 0);
  const broken = s.phase !== "running" && enemyHp <= 0 && doctrineHp > 0;
  const score = (broken ? 800 : 0) + (doctrineHp - enemyHp) + (200 - towerHp);
  return { score, broken, doctrineHp: Math.round(doctrineHp), enemyHp: Math.round(enemyHp), towers: towers.length };
}

function evaluate(tune) {
  const rows = [play(tune, "doctrine", "towers"), play(tune, "towers", "doctrine")];
  return { score: rows.reduce((n, r) => n + r.score, 0), rows };
}

const base = { attackAt: 12, trebGoal: 3, escortGap: 34, standoff: 175 };
let best = { ...base };
let bestScore = evaluate(best);
const history = [{ tune: { ...best }, score: bestScore.score, rows: bestScore.rows }];
const won = (result) => result.rows.every((row) => row.broken);
const neighbors = (tune) => [
  ["attackAt", Math.max(4, tune.attackAt - 2)],
  ["attackAt", tune.attackAt + 2],
  ["trebGoal", Math.max(1, tune.trebGoal - 1)],
  ["trebGoal", tune.trebGoal + 1],
  ["escortGap", Math.max(12, tune.escortGap - 8)],
  ["escortGap", tune.escortGap + 8],
  ["standoff", tune.standoff - 10],
  ["standoff", tune.standoff + 10],
];
for (let gen = 1; gen <= 8 && !won(bestScore); gen++) {
  let improved = false;
  for (const [key, value] of neighbors(best)) {
    if (best[key] === value) continue;
    const next = { ...best, [key]: value };
    const result = evaluate(next);
    const kept = result.score > bestScore.score;
    history.push({ gen, tune: next, score: result.score, kept, rows: result.rows });
    console.log(JSON.stringify({ gen, tune: next, score: Math.round(result.score), kept, rows: result.rows }));
    if (kept) {
      best = next;
      bestScore = result;
      improved = true;
      if (won(bestScore)) break;
    }
  }
  if (!improved) break;
}

const file = `/** Knobs the doctrine feedback loop is allowed to change. */
export type DoctrineTune = {
  attackAt: number;
  trebGoal: number;
  escortGap: number;
  standoff: number;
};

export const doctrineTune: DoctrineTune = {
  attackAt: ${best.attackAt},
  trebGoal: ${best.trebGoal},
  escortGap: ${best.escortGap},
  standoff: ${best.standoff},
};
`;
fs.writeFileSync(new URL("../src/game/doctrineTune.ts", import.meta.url), file);
console.log(JSON.stringify({ best, bestScore, history }, null, 2));
