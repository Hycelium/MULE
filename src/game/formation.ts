import { ROAD_Y_MAX, ROAD_Y_MIN, WORLD_H, isWardKind } from "./balance";
import { lanePathX } from "./map";
import type { Team, Unit, Vec2 } from "./types";

function clampHoldY(y: number) {
  return Math.max(ROAD_Y_MIN, Math.min(ROAD_Y_MAX, y));
}

function clampFieldY(y: number) {
  return Math.max(40, Math.min(WORLD_H - 40, y));
}

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
 * Cohesive attack-wave march vector for a barracks troop moving in `assault`:
 *  - Gives each role a clean lateral road slot (Levies wide front, Wards flanking
 *    siege, Runners on outer wings, Archers spread in rear, Rams centered).
 *  - Gently paces Archers behind friendly melee and Wards/Runners around nearby
 *    friendly siege so an attack wave arrives as a cohesive, layered army without
 *    stalling the final charge onto the enemy keep.
 */
export function computeWaveMarchTarget(
  seed: number,
  u: Unit,
  allUnits: Unit[],
): { targetX: number; speedMult: number } {
  const team = u.team;
  const fwd = team === "you" ? -1 : 1;
  const roadX = lanePathX(seed, team, u.lane, u.pos.y);

  // Near the enemy keep gate, charge at full speed in a broad assault line!
  const nearEnemyGate =
    team === "you" ? u.pos.y <= ROAD_Y_MIN + 135 : u.pos.y >= ROAD_Y_MAX - 135;

  const allies = allUnits.filter(
    (a) =>
      a.team === team &&
      a.hp > 0 &&
      a.fromBarracks &&
      a.lane === u.lane &&
      a.kind !== "spy" &&
      Math.abs(a.pos.y - u.pos.y) <= 90,
  );

  const sameRole = allies
    .filter((a) => a.kind === u.kind)
    .sort((a, b) => a.id - b.id);
  const roleIdx = Math.max(0, sameRole.findIndex((a) => a.id === u.id));
  const aheadOfMe = (other: Unit) => (other.pos.y - u.pos.y) * fwd;

  const nearbyTrebs = allies.filter((a) => a.kind === "trebuchet");
  const nearbyRams = allies.filter((a) => a.kind === "rammer");
  const nearbySiege = [...nearbyTrebs, ...nearbyRams];
  const nearbyMelee = allies.filter(
    (a) => a.kind === "levy" || isWardKind(a.kind),
  );

  let lateralOffset = 0;
  let speedMult = 1;

  if (u.kind === "rammer") {
    lateralOffset = nearbyRams.length <= 1 ? 0 : symmetricSlot(roleIdx % 3) * 8;
  } else if (u.kind === "archer") {
    lateralOffset = symmetricSlot(roleIdx % 5) * 8;
    // Stay behind friendly melee vanguard if melee is close behind us.
    if (!nearEnemyGate) {
      const behindMelee = nearbyMelee.some((m) => {
        const rel = aheadOfMe(m);
        return rel < 6 && rel > -48;
      });
      const hasFrontMelee = nearbyMelee.some((m) => aheadOfMe(m) >= 12);
      if (behindMelee && !hasFrontMelee) {
        speedMult = 0.65;
      }
    }
  } else if (u.kind === "ward") {
    if (nearbySiege.length > 0) {
      const side = roleIdx % 2 === 0 ? -1 : 1;
      lateralOffset = side * (13 + (Math.floor(roleIdx / 2) % 2) * 5);
      if (!nearEnemyGate) {
        const nearestSiege = nearbySiege.sort(
          (a, b) => Math.abs(a.pos.y - u.pos.y) - Math.abs(b.pos.y - u.pos.y),
        )[0]!;
        const siegeBehind = -aheadOfMe(nearestSiege);
        if (siegeBehind > 26 && siegeBehind < 75) {
          speedMult = 0.78;
        }
      }
    } else {
      lateralOffset = symmetricSlot(roleIdx % 5) * 8.5;
    }
  } else if (u.kind === "runner") {
    if (nearbyTrebs.length > 0 && !nearEnemyGate) {
      const side = roleIdx % 2 === 0 ? -1 : 1;
      lateralOffset = side * (18 + (Math.floor(roleIdx / 2) % 2) * 5);
      const nearestTreb = nearbyTrebs[0]!;
      const trebBehind = -aheadOfMe(nearestTreb);
      if (trebBehind > 20 && trebBehind < 75) {
        speedMult = 0.72;
      }
    } else {
      const side = roleIdx % 2 === 0 ? -1 : 1;
      lateralOffset = side * (14 + (Math.floor(roleIdx / 2) % 2) * 5);
    }
  } else if (u.kind === "levy" || u.kind === "templar") {
    // Broad front vanguard line moving at full pace!
    lateralOffset = symmetricSlot(roleIdx % 5) * 8;
  } else {
    lateralOffset = symmetricSlot(roleIdx % 4) * 7.5;
  }

  return {
    targetX: roadX + lateralOffset,
    speedMult,
  };
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
