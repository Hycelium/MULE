import { ROAD_Y_MAX, ROAD_Y_MIN, WORLD_H, WORLD_W, isWardKind } from "./balance";
import { lanePathX } from "./map";
import type { Team, Unit, UnitKind, Vec2 } from "./types";

function clampHoldY(y: number) {
  return Math.max(ROAD_Y_MIN, Math.min(ROAD_Y_MAX, y));
}

function clampFieldY(y: number) {
  return Math.max(40, Math.min(WORLD_H - 40, y));
}

function clampSpawnX(x: number) {
  return Math.max(50, Math.min(WORLD_W - 50, x));
}

function clampGuardX(x: number) {
  return Math.max(44, Math.min(WORLD_W - 44, x));
}

function isVanguardKind(kind: UnitKind) {
  return (
    kind === "levy" ||
    kind === "templar" ||
    kind === "brute" ||
    kind === "raider" ||
    kind === "soldier"
  );
}

const VANGUARD_PRIORITY: Partial<Record<UnitKind, number>> = {
  templar: 0,
  brute: 1,
  levy: 2,
  soldier: 3,
  raider: 4,
};

/** Spread index `i` symmetrically around 0: 0, -1, +1, -2, +2, ... */
function symmetricSlot(i: number) {
  if (i === 0) return 0;
  const k = Math.ceil(i / 2);
  return i % 2 === 1 ? -k : k;
}

/**
 * Assigns non-overlapping tactical formation rally coordinates around `anchor`
 * for a squad of friendly units:
 *  - Levies / Templars: front vanguard line facing the enemy
 *  - Rams / Trebuchets: protected center pocket
 *  - Wards: protective shield ring flanking the siege (or heavy frontline if no siege)
 *  - Runners: outer skirmish flanks / rear-guard wings around siege
 *  - Archers: rear volley ranks behind melee & siege
 */
export function computeSquadFormation(
  anchor: Vec2,
  team: Team,
  squad: Unit[],
  opts?: { hasNearbySiege?: boolean; tightBridge?: boolean },
): Map<number, Vec2> {
  const out = new Map<number, Vec2>();
  if (squad.length === 0) return out;

  // Forward direction toward enemy keep: south ("you") marches toward y=0 (-1); north ("foe") toward +1.
  const fwd = team === "you" ? -1 : 1;
  const tight = opts?.tightBridge ?? false;
  const xStep = tight ? 10 : 11;
  const maxCols = tight ? 5 : 6;

  const sorted = [...squad].sort((a, b) => a.id - b.id);
  const vanguard = sorted.filter(
    (u) => u.kind === "levy" || u.kind === "templar" || u.kind === "brute" || u.kind === "raider",
  );
  const rams = sorted.filter((u) => u.kind === "rammer");
  const trebs = sorted.filter((u) => u.kind === "trebuchet");
  const wards = sorted.filter((u) => u.kind === "ward");
  const runners = sorted.filter((u) => u.kind === "runner");
  const archers = sorted.filter((u) => u.kind === "archer");
  const others = sorted.filter(
    (u) =>
      !vanguard.includes(u) &&
      !rams.includes(u) &&
      !trebs.includes(u) &&
      !wards.includes(u) &&
      !runners.includes(u) &&
      !archers.includes(u),
  );

  const hasSiege = (opts?.hasNearbySiege ?? false) || trebs.length > 0 || rams.length > 0;

  // 1. Front Vanguard (Levies / Templars) — broad shield wall up front.
  const frontDepth = hasSiege ? 24 : 15;
  vanguard.forEach((u, idx) => {
    const row = Math.floor(idx / maxCols);
    const col = idx % maxCols;
    const dx = symmetricSlot(col) * xStep;
    const dy = (frontDepth - row * 10) * fwd;
    out.set(u.id, { x: anchor.x + dx, y: clampHoldY(anchor.y + dy) });
  });

  // 2. Siege Core — Rams just behind vanguard, Trebs centered in pocket.
  rams.forEach((u, idx) => {
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    const dx = symmetricSlot(col) * 13;
    const dy = (7 - row * 12) * fwd;
    out.set(u.id, { x: anchor.x + dx, y: clampHoldY(anchor.y + dy) });
  });
  trebs.forEach((u, idx) => {
    const row = Math.floor(idx / 2);
    const col = idx % 2;
    const dx = trebs.length === 1 ? 0 : (col === 0 ? -11 : 11);
    const dy = (-9 - row * 16) * fwd;
    out.set(u.id, { x: anchor.x + dx, y: clampHoldY(anchor.y + dy) });
  });

  // 3. Wards — surround siege on flanks & front corners when siege is present,
  //    or anchor the heavy front rank alongside Levies when no siege is present.
  wards.forEach((u, idx) => {
    if (hasSiege) {
      const side = idx % 2 === 0 ? -1 : 1;
      const ringIdx = Math.floor(idx / 2);
      const radiusX = (tight ? 18 : 20) + (ringIdx % 2) * 10;
      const ringDepth = 6 - ringIdx * 11;
      out.set(u.id, {
        x: anchor.x + side * radiusX,
        y: clampHoldY(anchor.y + ringDepth * fwd),
      });
    } else {
      const row = Math.floor(idx / maxCols);
      const col = idx % maxCols;
      const dx = symmetricSlot(col) * (xStep + 1);
      const dy = (25 - row * 10) * fwd;
      out.set(u.id, { x: anchor.x + dx, y: clampHoldY(anchor.y + dy) });
    }
  });

  // 4. Runners — outer skirmish wings & siege flank/rear-guard interceptors.
  runners.forEach((u, idx) => {
    const side = idx % 2 === 0 ? -1 : 1;
    const wingRow = Math.floor(idx / 2);
    const wingX = (tight ? 31 : 34) + (wingRow % 2) * 10;
    const wingDepth = hasSiege ? -2 - wingRow * 11 : 6 - wingRow * 10;
    out.set(u.id, {
      x: anchor.x + side * wingX,
      y: clampHoldY(anchor.y + wingDepth * fwd),
    });
  });

  // 5. Archers — disciplined back ranks safely behind frontline & siege pocket.
  const backStart = hasSiege ? -24 : -13;
  archers.forEach((u, idx) => {
    const row = Math.floor(idx / maxCols);
    const col = idx % maxCols;
    const dx = symmetricSlot(col) * xStep;
    const dy = (backStart - row * 10.5) * fwd;
    out.set(u.id, { x: anchor.x + dx, y: clampHoldY(anchor.y + dy) });
  });

  // 6. Any remaining non-special units spread neatly around anchor.
  others.forEach((u, idx) => {
    const dx = symmetricSlot(idx) * xStep;
    out.set(u.id, { x: anchor.x + dx, y: clampHoldY(anchor.y) });
  });

  return out;
}

/**
 * Computes cohesive tactical spawn coordinates around a lane staging `anchor`
 * for an ordered wave batch `kinds`. Returns a `Vec2[]` matching `kinds` by index:
 *  - Vanguard (templar, brute, levy, soldier, raider): front rank(s)
 *  - Siege (rammer, trebuchet): centered behind vanguard
 *  - Wards: flanking the siege pocket (or bolstering the front rank if no siege)
 *  - Runners: outer skirmish wings
 *  - Archers: cleanly spaced in rear volley ranks
 * Coordinates are clamped safely inside the map (`x` in `[50, WORLD_W - 50]`, `y` in `[40, WORLD_H - 40]`).
 */
export function computeWaveSpawnFormation(
  anchor: Vec2,
  team: Team,
  kinds: UnitKind[],
  opts?: { tightBridge?: boolean },
): Vec2[] {
  const n = kinds.length;
  if (n === 0) return [];

  const out: Vec2[] = new Array<Vec2>(n);
  const fwd = team === "you" ? -1 : 1;
  const tight = opts?.tightBridge ?? false;
  const xStep = tight ? 9.5 : 11;
  const maxCols = tight ? 5 : 6;

  const vanguardIdx: number[] = [];
  const ramIdx: number[] = [];
  const trebIdx: number[] = [];
  const wardIdx: number[] = [];
  const runnerIdx: number[] = [];
  const archerIdx: number[] = [];
  const otherIdx: number[] = [];

  for (let i = 0; i < n; i++) {
    const k = kinds[i]!;
    if (isVanguardKind(k)) vanguardIdx.push(i);
    else if (k === "rammer") ramIdx.push(i);
    else if (k === "trebuchet") trebIdx.push(i);
    else if (k === "ward") wardIdx.push(i);
    else if (k === "runner") runnerIdx.push(i);
    else if (k === "archer") archerIdx.push(i);
    else otherIdx.push(i);
  }

  // Keep heavier vanguard (templar, brute) on the leading front rows even if input is unsorted.
  vanguardIdx.sort(
    (a, b) => (VANGUARD_PRIORITY[kinds[a]!] ?? 5) - (VANGUARD_PRIORITY[kinds[b]!] ?? 5) || a - b,
  );

  const hasSiege = ramIdx.length > 0 || trebIdx.length > 0;
  const place = (origIdx: number, dx: number, depth: number) => {
    out[origIdx] = {
      x: clampSpawnX(anchor.x + dx),
      y: clampFieldY(anchor.y + depth * fwd),
    };
  };

  // 1. Vanguard front rank(s).
  const frontDepth = hasSiege ? 24 : 16;
  const vanguardRows = Math.ceil(vanguardIdx.length / maxCols);
  for (let i = 0; i < vanguardIdx.length; i++) {
    const row = Math.floor(i / maxCols);
    const col = i % maxCols;
    place(vanguardIdx[i]!, symmetricSlot(col) * xStep, frontDepth - row * 9.5);
  }
  const vanguardBack = vanguardRows > 0 ? frontDepth - (vanguardRows - 1) * 9.5 : frontDepth;

  // 2. Siege core centered behind vanguard.
  const ramStart = vanguardRows > 0 ? Math.min(8, vanguardBack - 11) : 10;
  const ramRows = Math.ceil(ramIdx.length / 3);
  for (let i = 0; i < ramIdx.length; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    place(ramIdx[i]!, symmetricSlot(col) * 13, ramStart - row * 12);
  }
  const ramBack = ramRows > 0 ? ramStart - (ramRows - 1) * 12 : vanguardBack;

  const trebStart = ramRows > 0 ? ramBack - 14 : Math.min(-6, vanguardBack - 14);
  const trebRows = Math.ceil(trebIdx.length / 2);
  for (let i = 0; i < trebIdx.length; i++) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const rowRemaining = trebIdx.length - row * 2;
    const dx = rowRemaining === 1 ? 0 : col === 0 ? -12 : 12;
    place(trebIdx[i]!, dx, trebStart - row * 16);
  }
  const siegeBack = trebRows > 0 ? trebStart - (trebRows - 1) * 16 : ramBack;

  // 3. Wards — flank the siege pocket when siege is present, or bolster the front line otherwise.
  for (let i = 0; i < wardIdx.length; i++) {
    if (hasSiege) {
      const side = i % 2 === 0 ? -1 : 1;
      const ringIdx = Math.floor(i / 2);
      const radiusX = (tight ? 18 : 21) + (ringIdx % 2) * 9;
      const anchorDepth = ramIdx.length > 0 ? ramStart : trebStart + 6;
      place(wardIdx[i]!, side * radiusX, anchorDepth - ringIdx * 10);
    } else {
      const row = Math.floor(i / maxCols);
      const col = i % maxCols;
      const wardFront = vanguardRows > 0 ? frontDepth + 9.5 : 16;
      place(wardIdx[i]!, symmetricSlot(col) * (xStep + 1), wardFront - row * 9.5);
    }
  }

  // 4. Runners — outer skirmish wings.
  for (let i = 0; i < runnerIdx.length; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const wingRow = Math.floor(i / 2);
    const wingX = (tight ? 28 : 33) + (wingRow % 2) * 9;
    const wingBaseDepth = hasSiege ? (ramIdx.length > 0 ? ramStart - 4 : trebStart + 4) : 8;
    place(runnerIdx[i]!, side * wingX, wingBaseDepth - wingRow * 10);
  }

  // 5. Archers — cleanly spaced in rear volley ranks (or centered if archer-only wave).
  const hasFrontUnits = vanguardIdx.length > 0 || hasSiege || wardIdx.length > 0;
  const archerStart = !hasFrontUnits
    ? 6
    : hasSiege
      ? Math.min(-22, siegeBack - 13)
      : Math.min(-12, vanguardBack - 13);
  for (let i = 0; i < archerIdx.length; i++) {
    const row = Math.floor(i / maxCols);
    const col = i % maxCols;
    place(archerIdx[i]!, symmetricSlot(col) * xStep, archerStart - row * 10);
  }

  // 6. Any remaining unit kinds spread neatly around anchor.
  for (let i = 0; i < otherIdx.length; i++) {
    place(otherIdx[i]!, symmetricSlot(i) * xStep, 0);
  }

  return out;
}

/**
 * Cohesive march vector for both wave squads (`waveBatchId`) and barracks squads:
 *  - Gives each role a clean lateral road slot (vanguard wide front, siege centered,
 *    wards flanking siege, runners on outer skirmish wings, archers spaced in rear).
 *  - Paces units in the same squad so vanguard leads, siege rolls behind vanguard,
 *    wards flank siege, runners hold the wings instead of suiciding ahead, and archers
 *    stay behind the melee line instead of outrunning levies.
 *  - Never stalls near keep gates or road edges.
 */
export function computeWaveMarchTarget(
  seed: number,
  u: Unit,
  allUnits: Unit[],
): { targetX: number; speedMult: number } {
  const team = u.team;
  const fwd = team === "you" ? -1 : 1;
  const roadX = lanePathX(seed, team, u.lane, u.pos.y);

  // Near the enemy keep gate, charge at full speed in a broad assault line.
  const nearEnemyGate =
    team === "you" ? u.pos.y <= ROAD_Y_MIN + 135 : u.pos.y >= ROAD_Y_MAX - 135;
  // Near own keep gate, keep healthy exit momentum so freshly spawned waves never jam.
  const nearOwnGate =
    team === "you" ? u.pos.y >= ROAD_Y_MAX - 40 : u.pos.y <= ROAD_Y_MIN + 40;

  const hasBatch = u.waveBatchId !== undefined;
  const maxSquadSpan = hasBatch ? 180 : 95;

  let roleIdx = 0;
  let ramCount = 0;
  let trebCount = 0;
  let nearestSiegeRel = 0;
  let nearestSiegeDist = Infinity;
  let nearestTrebRel = 0;
  let nearestTrebDist = Infinity;

  let hasFrontMelee = false;
  let hasBehindMelee = false;
  let hasFrontVanguard = false;
  let hasBehindVanguard = false;
  let hasBehindRam = false;

  let meleeYAcc = 0;
  let meleeCount = 0;
  let heavyYAcc = 0;
  let heavyCount = 0;

  for (let i = 0; i < allUnits.length; i++) {
    const a = allUnits[i]!;
    if (a.hp <= 0 || a.team !== team || a.lane !== u.lane || a.kind === "spy") continue;
    if (hasBatch) {
      if (a.waveBatchId !== u.waveBatchId) continue;
    } else if (a.fromBarracks !== u.fromBarracks) {
      continue;
    }
    const absDy = Math.abs(a.pos.y - u.pos.y);
    if (absDy > maxSquadSpan) continue;

    if (a.kind === u.kind && a.id < u.id) {
      roleIdx++;
    }

    const rel = (a.pos.y - u.pos.y) * fwd; // positive = ahead of u, negative = behind u

    if (a.kind === "rammer") {
      ramCount++;
      if (absDy < nearestSiegeDist) {
        nearestSiegeDist = absDy;
        nearestSiegeRel = rel;
      }
      if (a.id !== u.id && rel < 4 && rel > -65) hasBehindRam = true;
    } else if (a.kind === "trebuchet") {
      trebCount++;
      if (absDy < nearestSiegeDist) {
        nearestSiegeDist = absDy;
        nearestSiegeRel = rel;
      }
      if (absDy < nearestTrebDist) {
        nearestTrebDist = absDy;
        nearestTrebRel = rel;
      }
    }

    const isMelee = isVanguardKind(a.kind) || isWardKind(a.kind);
    if (isMelee) {
      meleeYAcc += a.pos.y;
      meleeCount++;
      if (a.id !== u.id) {
        if (rel >= 12) hasFrontMelee = true;
        if (rel < 8 && rel > -65) hasBehindMelee = true;
      }
    }

    if (isVanguardKind(a.kind) && a.id !== u.id) {
      if (rel >= 8) hasFrontVanguard = true;
      if (rel < 4 && rel > -65) hasBehindVanguard = true;
    }

    if (
      a.kind === "brute" ||
      a.kind === "templar" ||
      a.kind === "ward" ||
      a.kind === "soldier" ||
      a.kind === "rammer"
    ) {
      heavyYAcc += a.pos.y;
      heavyCount++;
    }
  }

  const hasSiege = ramCount > 0 || trebCount > 0;
  let lateralOffset = 0;
  let speedMult = 1;

  if (u.kind === "trebuchet") {
    lateralOffset = trebCount <= 1 ? 0 : (roleIdx % 2 === 0 ? -9 : 9);
  } else if (u.kind === "rammer") {
    lateralOffset = ramCount <= 1 ? 0 : symmetricSlot(roleIdx % 3) * 8;
    // Roll behind friendly vanguard when vanguard is closely trailing.
    if (!nearEnemyGate && hasBehindVanguard && !hasFrontVanguard) {
      speedMult = 0.72;
    }
  } else if (u.kind === "archer") {
    lateralOffset = symmetricSlot(roleIdx % 5) * 8;
    // Stay safely behind friendly melee vanguard (or rams) instead of outrunning them.
    if (!nearEnemyGate) {
      if ((hasBehindMelee || hasBehindRam) && !hasFrontMelee) {
        speedMult = 0.56;
      } else if (meleeCount > 0) {
        const meleeCenterRel = (meleeYAcc / meleeCount - u.pos.y) * fwd;
        if (meleeCenterRel < 10 && meleeCenterRel > -65) {
          speedMult = 0.72;
        }
      }
    }
  } else if (u.kind === "ward") {
    if (hasSiege) {
      const side = roleIdx % 2 === 0 ? -1 : 1;
      lateralOffset = side * (13 + (Math.floor(roleIdx / 2) % 2) * 5);
      if (!nearEnemyGate) {
        const siegeBehind = -nearestSiegeRel;
        if (siegeBehind > 22 && siegeBehind < 90) {
          speedMult = trebCount > 0 ? 0.62 : 0.74;
        }
      }
    } else {
      lateralOffset = symmetricSlot(roleIdx % 5) * 8.5;
    }
  } else if (u.kind === "runner") {
    const side = roleIdx % 2 === 0 ? -1 : 1;
    if (trebCount > 0 && !nearEnemyGate) {
      lateralOffset = side * (18 + (Math.floor(roleIdx / 2) % 2) * 5);
      const trebBehind = -nearestTrebRel;
      if (trebBehind > 20 && trebBehind < 90) {
        speedMult = 0.58;
      }
    } else {
      lateralOffset = side * (15 + (Math.floor(roleIdx / 2) % 2) * 5);
      // Pace outer wings alongside the squad's frontline instead of bolting solo.
      if (!nearEnemyGate && meleeCount > 0) {
        const meleeBehind = -((meleeYAcc / meleeCount - u.pos.y) * fwd);
        if (meleeBehind > 24 && meleeBehind < 95) {
          speedMult = 0.58;
        }
      }
    }
  } else if (isVanguardKind(u.kind)) {
    lateralOffset = symmetricSlot(roleIdx % 5) * 8;
    // Fast vanguard (raiders / levies) gently wait up for heavier frontline/rams in the same wave batch.
    if (!nearEnemyGate && hasBatch && heavyCount > 0 && (u.kind === "raider" || u.kind === "levy")) {
      const heavyBehind = -((heavyYAcc / heavyCount - u.pos.y) * fwd);
      if (heavyBehind > 28 && heavyBehind < 95) {
        speedMult = u.kind === "raider" ? 0.68 : 0.8;
      }
    }
  } else {
    lateralOffset = symmetricSlot(roleIdx % 4) * 7.5;
  }

  if (nearEnemyGate) {
    speedMult = 1;
  } else if (nearOwnGate && speedMult < 0.8) {
    speedMult = 0.8;
  }

  return {
    targetX: clampGuardX(roadX + lateralOffset),
    speedMult,
  };
}

/**
 * Computes non-overlapping tactical guard positions around a friendly `guarded`
 * unit (e.g. a Trebuchet or Ram) for its assigned `escorts`:
 *  - Vanguard (levy, templar, brute, raider, soldier): protective front arc (+18..+26 forward)
 *  - Other siege (rammer, trebuchet): just ahead of the guarded unit
 *  - Wards: tight protective shield flanks on both sides (±18..22 lateral)
 *  - Runners: outer flank/rear interceptor wings (±28..34 lateral, slightly beside/behind)
 *  - Archers: safe rear rank behind the guarded unit (-18..-28 behind)
 * Coordinates are clamped safely inside `[44, WORLD_W - 44]` × `[40, WORLD_H - 40]`.
 */
export function computeGuardFormation(guarded: Unit, escorts: Unit[]): Map<number, Vec2> {
  const out = new Map<number, Vec2>();
  if (escorts.length === 0) return out;

  const fwd = guarded.team === "you" ? -1 : 1;
  const sorted = escorts.filter((e) => e.id !== guarded.id).sort((a, b) => a.id - b.id);
  if (sorted.length === 0) return out;

  const vanguard: Unit[] = [];
  const otherSiege: Unit[] = [];
  const wards: Unit[] = [];
  const runners: Unit[] = [];
  const archers: Unit[] = [];
  const others: Unit[] = [];

  for (const e of sorted) {
    if (isVanguardKind(e.kind)) vanguard.push(e);
    else if (e.kind === "rammer" || e.kind === "trebuchet") otherSiege.push(e);
    else if (e.kind === "ward") wards.push(e);
    else if (e.kind === "runner") runners.push(e);
    else if (e.kind === "archer") archers.push(e);
    else others.push(e);
  }

  const place = (u: Unit, dx: number, depth: number) => {
    out.set(u.id, {
      x: clampGuardX(guarded.pos.x + dx),
      y: clampFieldY(guarded.pos.y + depth * fwd),
    });
  };

  // 1. Other siege units (e.g. Ram guarding a Trebuchet) hold just ahead of the guarded unit.
  for (let i = 0; i < otherSiege.length; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    place(otherSiege[i]!, symmetricSlot(col) * 13, 14 + row * 11);
  }

  // 2. Vanguard forms a protective front arc (+18..+26 forward).
  const frontCols = 5;
  const baseFront = otherSiege.length > 0 ? 25.5 : 23.5;
  for (let i = 0; i < vanguard.length; i++) {
    const row = Math.floor(i / frontCols);
    const col = i % frontCols;
    const slot = symmetricSlot(col);
    const arcPullback = Math.abs(slot) * 2.2;
    const depth = baseFront - arcPullback + row * 9;
    place(vanguard[i]!, slot * 10.5, depth);
  }

  // 3. Wards form tight protective shield flanks on both sides (±18..22 lateral).
  for (let i = 0; i < wards.length; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const ringIdx = Math.floor(i / 2);
    const lateral = 18 + (ringIdx % 2) * 4;
    const depth = 6 - ringIdx * 10;
    place(wards[i]!, side * lateral, depth);
  }

  // 4. Runners hold outer flank/rear interceptor wings (±28..34 lateral).
  for (let i = 0; i < runners.length; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const wingRow = Math.floor(i / 2);
    const lateral = 28 + (wingRow % 2) * 6;
    const depth = -3 - wingRow * 10;
    place(runners[i]!, side * lateral, depth);
  }

  // 5. Archers hold the safe rear rank (-18..-28 behind).
  const rearCols = 5;
  for (let i = 0; i < archers.length; i++) {
    const row = Math.floor(i / rearCols);
    const col = i % rearCols;
    const slot = symmetricSlot(col);
    const depth = -20 - Math.abs(slot) * 1.5 - row * 9.5;
    place(archers[i]!, slot * 10, depth);
  }

  // 6. Any other escort kinds tuck neatly beside/behind the guarded unit.
  for (let i = 0; i < others.length; i++) {
    place(others[i]!, symmetricSlot(i + 1) * 14, -12);
  }

  return out;
}

/**
 * Lightweight, deterministic soft separation pass so friendly units never
 * collapse into a single overlapping pixel on bridges, rallies, or fights.
 * Near keep gates, separates purely laterally (`x`) so the full melee line
 * stays engaged against the keep instead of pushing teammates out of range.
 */
export function separateFriendlyUnits(
  units: Unit[],
  dt: number,
  possessedId: number | null,
) {
  const n = units.length;
  if (n < 2) return;
  const maxStep = 28 * dt;

  for (let i = 0; i < n; i++) {
    const a = units[i]!;
    if (a.hp <= 0 || a.id === possessedId) continue;
    const aFrozen = a.kind === "trebuchet" && a.siegePhase !== "packed";

    for (let j = i + 1; j < n; j++) {
      const b = units[j]!;
      if (b.hp <= 0 || b.team !== a.team || b.id === possessedId) continue;
      if (a.kind === "spy" || b.kind === "spy") continue;
      const bFrozen = b.kind === "trebuchet" && b.siegePhase !== "packed";
      if (aFrozen && bFrozen) continue;

      const minSep =
        a.kind === "trebuchet" || b.kind === "trebuchet"
          ? 14.5
          : a.kind === "rammer" || b.kind === "rammer"
            ? 11
            : 8;
      let dx = b.pos.x - a.pos.x;
      let dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minSep * minSep) continue;

      // Near either keep gate, fan out sideways only so melee never gets shoved back from the keep!
      const nearGate =
        a.pos.y <= ROAD_Y_MIN + 48 ||
        a.pos.y >= ROAD_Y_MAX - 48 ||
        b.pos.y <= ROAD_Y_MIN + 48 ||
        b.pos.y >= ROAD_Y_MAX - 48;

      let d = Math.sqrt(d2);
      if (d < 0.05) {
        const angle = ((a.id * 73 + b.id * 137) % 360) * (Math.PI / 180);
        dx = Math.cos(angle);
        dy = nearGate ? 0 : Math.sin(angle);
        d = Math.hypot(dx, dy) || 1;
      }
      const overlap = minSep - d;
      const push = Math.min(maxStep, overlap * 0.45);
      const nx = (dx / d) * push;
      const ny = nearGate ? 0 : (dy / d) * push;

      if (aFrozen) {
        b.pos.x += nx;
        if (ny !== 0) b.pos.y = clampFieldY(b.pos.y + ny);
      } else if (bFrozen) {
        a.pos.x -= nx;
        if (ny !== 0) a.pos.y = clampFieldY(a.pos.y - ny);
      } else {
        a.pos.x -= nx * 0.5;
        if (ny !== 0) a.pos.y = clampFieldY(a.pos.y - ny * 0.5);
        b.pos.x += nx * 0.5;
        if (ny !== 0) b.pos.y = clampFieldY(b.pos.y + ny * 0.5);
      }
    }
  }
}
