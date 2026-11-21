/**
 * Doctrine vs Doctrine. A new knob set is kept only when it beats the
 * current set from both keeps combined.
 *   npx tsx scripts/doctrine-mirror.mjs
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

function play(southTune, northTune) {
  mem.clear();
  const sim = new GameSim();
  sim.setDoctrineTune(southTune, "you");
  sim.setDoctrineTune(northTune, "foe");
  sim.setMatchMode("ai");
  sim.setBothCpu(true);
  sim.setCpuStyle("you", "doctrine");
  sim.setCpuStyle("foe", "doctrine");
  sim.startMatch();
  sim.toggleSpeed();
  let n = 0;
  while (sim.getState().phase === "running" && sim.getState().time < 640 && n < 16000) {
    sim.update(0.1);
    n++;
  }
  const s = sim.getState();
  return {
    you: Math.round(s.keeps.you.hp),
    foe: Math.round(s.keeps.foe.hp),
    ended: s.phase !== "running",
  };
}

/** Positive when the challenger takes more keep health than it loses, both seats. */
function evaluate(challenger, champion) {
  const south = play(challenger, champion);
  const north = play(champion, challenger);
  const southMargin = south.you - south.foe;
  const northMargin = north.foe - north.you;
  const southWin = south.ended && south.foe <= 0 && south.you > 0;
  const northWin = north.ended && north.you <= 0 && north.foe > 0;
  return {
    score: southMargin + northMargin + (southWin ? 400 : 0) + (northWin ? 400 : 0),
    south,
    north,
    southWin,
    northWin,
  };
}

const base = { attackAt: 12, trebGoal: 5, escortGap: 34, standoff: 175 };
let best = { ...base };
let bestScore = evaluate(best, best);
console.log(JSON.stringify({ mirror: true, tune: best, ...bestScore, score: Math.round(bestScore.score) }));
const history = [{ tune: { ...best }, score: bestScore.score }];

const neighbors = (tune) => [
  ["attackAt", Math.max(6, tune.attackAt - 4)],
  ["attackAt", tune.attackAt + 4],
  ["trebGoal", Math.max(3, tune.trebGoal - 1)],
  ["trebGoal", tune.trebGoal + 1],
  ["escortGap", Math.max(16, tune.escortGap - 12)],
  ["escortGap", tune.escortGap + 12],
];

for (let gen = 1; gen <= 3; gen++) {
  let improved = false;
  for (const [key, value] of neighbors(best)) {
    if (best[key] === value) continue;
    const next = { ...best, [key]: value };
    const result = evaluate(next, best);
    const kept = result.score > bestScore.score;
    history.push({ gen, tune: next, score: result.score, kept, southWin: result.southWin, northWin: result.northWin });
    console.log(JSON.stringify({ gen, tune: next, score: Math.round(result.score), kept, south: result.south, north: result.north }));
    if (kept) {
      best = next;
      bestScore = result;
      improved = true;
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
console.log(JSON.stringify({ best, score: Math.round(bestScore.score), history }, null, 2));
