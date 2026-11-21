/**
 * Both keeps play. Each game pits two styles. Wins are written back into
 * src/game/selfPlayBook.ts, which the live foe reads.
 *
 *   npx tsx scripts/self-play.mjs
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

const STYLES = ["reactive", "army", "siege", "towers", "doctrine"];
const SIM_CAP = 240;
const STEP = 0.1;

function play(south, north) {
  const sim = new GameSim();
  sim.setMatchMode("ai");
  sim.setBothCpu(true);
  sim.setCpuStyle("you", south);
  sim.setCpuStyle("foe", north);
  sim.startMatch();
  sim.toggleSpeed();
  let steps = 0;
  while (sim.getState().phase === "running" && sim.getState().time < SIM_CAP && steps < 6000) {
    sim.update(STEP);
    steps++;
  }
  const s = sim.getState();
  const you = s.keeps.you.hp;
  const foe = s.keeps.foe.hp;
  let winner = "draw";
  if (foe <= 0 && you > 0) winner = south;
  else if (you <= 0 && foe > 0) winner = north;
  else if (s.time >= SIM_CAP && you !== foe) winner = you > foe ? south : north;
  return {
    south,
    north,
    winner,
    time: Math.round(s.time),
    youHp: Math.round(you),
    foeHp: Math.round(foe),
    southBuild: sim.getBuildings("you").map((b) => b.kind).join(">"),
    northBuild: sim.getBuildings("foe").map((b) => b.kind).join(">"),
  };
}

const rows = [];
for (const south of STYLES) {
  for (const north of STYLES) {
    if (south === north) continue;
    rows.push(play(south, north));
  }
}

const wins = { reactive: 0, army: 0, siege: 0, towers: 0, doctrine: 0 };
for (const row of rows) if (wins[row.winner] != null) wins[row.winner] += 1;

const book = `/** Win counts from headless CPU vs CPU. The live foe uses the leading style. */
export type AiStyle = "reactive" | "army" | "siege" | "towers" | "doctrine";

export const selfPlayBook: { games: number; wins: Record<AiStyle, number> } = {
  games: ${rows.length},
  wins: { reactive: ${wins.reactive}, army: ${wins.army}, siege: ${wins.siege}, towers: ${wins.towers}, doctrine: ${wins.doctrine} },
};

export function bestSelfPlayStyle(): AiStyle {
  const entries = Object.entries(selfPlayBook.wins) as [AiStyle, number][];
  const best = Math.max(...entries.map(([, n]) => n));
  const leaders = entries.filter(([, n]) => n === best).map(([name]) => name);
  if (best <= 0 || leaders.length !== 1) return "reactive";
  return leaders[0];
}
`;
fs.writeFileSync(new URL("../src/game/selfPlayBook.ts", import.meta.url), book);
console.log(JSON.stringify({ wins, rows }, null, 2));
