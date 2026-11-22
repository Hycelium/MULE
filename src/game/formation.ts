import { ROAD_Y_MAX, ROAD_Y_MIN, WORLD_H, isWardKind } from "./balance";
import { lanePathX } from "./map";
import type { Team, Unit, Vec2 } from "./types";

export type FormationId = "line" | "stagger" | "box" | "split";

export const FORMATION_OPTIONS: { id: FormationId; label: string; hint: string }[] = [
  { id: "line", label: "Line", hint: "Single rank facing the enemy" },
  { id: "stagger", label: "Stagger", hint: "Checkerboard double rank" },
  { id: "box", label: "Box", hint: "Hollow rectangle around the anchor" },
  { id: "split", label: "Split", hint: "Two wings with a clear center gap" },
];

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

function roleRank(u: Unit): number {
  if (u.kind === "levy" || u.kind === "templar" || u.kind === "brute" || u.kind === "raider" || u.kind === "soldier")
    return 0;
  if (u.kind === "ward") return 1;
  if (u.kind === "rammer") return 2;
  if (u.kind === "trebuchet") return 3;
  if (u.kind === "runner") return 4;
  if (u.kind === "archer") return 5;
  return 6;
}

function sortSquad(squad: Unit[]) {
  return [...squad].sort((a, b) => roleRank(a) - roleRank(b) || a.id - b.id);
}

function slotStep(u: Unit, tight: boolean) {
  if (u.kind === "trebuchet") return tight ? 16 : 18;
  if (u.kind === "rammer") return tight ? 12 : 14;
  return tight ? 10 : 11;
}

function place(
  out: Map<number, Vec2>,
  u: Unit,
  anchor: Vec2,
  dx: number,
  dy: number,
  clampY: (y: number) => number,
) {
  out.set(u.id, { x: anchor.x + dx, y: clampY(anchor.y + dy) });
}

/** Line: role-sorted single rank facing the enemy; archers sit one step behind. */
function layoutLine(
  out: Map<number, Vec2>,
  squad: Unit[],
  anchor: Vec2,
  fwd: number,
  tight: boolean,
  clampY: (y: number) => number,
) {
  const sorted = sortSquad(squad);
  const front = sorted.filter((u) => u.kind !== "archer");
  const archers = sorted.filter((u) => u.kind === "archer");
  front.forEach((u, idx) => {
    const step = slotStep(u, tight);
    place(out, u, anchor, symmetricSlot(idx) * step, 0, clampY);
  });
  archers.forEach((u, idx) => {
    place(out, u, anchor, symmetricSlot(idx) * (tight ? 10 : 11), -12 * fwd, clampY);
  });
}

/** Stagger: two checkerboard ranks. */
function layoutStagger(
  out: Map<number, Vec2>,
  squad: Unit[],
  anchor: Vec2,
  fwd: number,
  tight: boolean,
  clampY: (y: number) => number,
) {
  const sorted = sortSquad(squad);
  const xStep = tight ? 10 : 12;
  const yStep = tight ? 11 : 13;
  sorted.forEach((u, idx) => {
    const row = idx % 2;
    const col = Math.floor(idx / 2);
    const dx = symmetricSlot(col) * xStep + (row === 1 ? xStep * 0.5 : 0);
    const dy = -row * yStep * fwd;
    place(out, u, anchor, dx, dy, clampY);
  });
}

/** Box: hollow rectangle; siege sits in the pocket. */
function layoutBox(
  out: Map<number, Vec2>,
  squad: Unit[],
  anchor: Vec2,
  fwd: number,
  tight: boolean,
  clampY: (y: number) => number,
) {
  const sorted = sortSquad(squad);
  const core = sorted.filter((u) => u.kind === "trebuchet" || u.kind === "rammer");
  const rim = sorted.filter((u) => u.kind !== "trebuchet" && u.kind !== "rammer");
  const halfW = Math.max(tight ? 16 : 20, Math.ceil(rim.length / 4) * (tight ? 10 : 11));
  const halfD = Math.max(tight ? 14 : 16, Math.ceil(rim.length / 4) * (tight ? 10 : 11));

  // Perimeter walk: front → right → rear → left
  const perimeter: Vec2[] = [];
  const step = tight ? 10 : 11;
  for (let x = -halfW; x <= halfW; x += step) perimeter.push({ x, y: halfD * fwd });
  for (let y = halfD - step; y >= -halfD; y -= step) perimeter.push({ x: halfW, y: y * fwd });
  for (let x = halfW - step; x >= -halfW; x -= step) perimeter.push({ x, y: -halfD * fwd });
  for (let y = -halfD + step; y < halfD; y += step) perimeter.push({ x: -halfW, y: y * fwd });

  rim.forEach((u, idx) => {
    const pt = perimeter[idx % Math.max(1, perimeter.length)] ?? { x: 0, y: 0 };
    place(out, u, anchor, pt.x, pt.y, clampY);
  });
  core.forEach((u, idx) => {
    place(out, u, anchor, symmetricSlot(idx) * (tight ? 14 : 16), 0, clampY);
  });
}

/** Split: left and right wings with a clear center gap. */
function layoutSplit(
  out: Map<number, Vec2>,
  squad: Unit[],
  anchor: Vec2,
  fwd: number,
  tight: boolean,
  clampY: (y: number) => number,
) {
  const sorted = sortSquad(squad);
  const gap = tight ? 18 : 22;
  const step = tight ? 10 : 11;
  const left: Unit[] = [];
  const right: Unit[] = [];
  sorted.forEach((u, idx) => (idx % 2 === 0 ? left : right).push(u));

  left.forEach((u, idx) => {
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    place(out, u, anchor, -(gap + col * step), -row * 11 * fwd, clampY);
  });
  right.forEach((u, idx) => {
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    place(out, u, anchor, gap + col * step, -row * 11 * fwd, clampY);
  });
}

/**
 * Assigns non-overlapping tactical formation rally coordinates around `anchor`
 * for a squad of friendly units.
 */
export function computeSquadFormation(
  anchor: Vec2,
  team: Team,
  squad: Unit[],
  opts?: {
    hasNearbySiege?: boolean;
    tightBridge?: boolean;
    formation?: FormationId;
    fieldClamp?: boolean;
  },
): Map<number, Vec2> {
  const out = new Map<number, Vec2>();
  if (squad.length === 0) return out;

  const fwd = team === "you" ? -1 : 1;
  const tight = opts?.tightBridge ?? false;
  const formation = opts?.formation ?? "line";
  const clampY = opts?.fieldClamp ? clampFieldY : clampHoldY;

  switch (formation) {
    case "stagger":
      layoutStagger(out, squad, anchor, fwd, tight, clampY);
      break;
    case "box":
      layoutBox(out, squad, anchor, fwd, tight, clampY);
      break;
    case "split":
      layoutSplit(out, squad, anchor, fwd, tight, clampY);
      break;
    case "line":
    default:
      layoutLine(out, squad, anchor, fwd, tight, clampY);
      break;
  }

  return out;
}

/**
 * Cohesive attack-wave march vector for a barracks troop moving in `assault`.
 */
export function computeWaveMarchTarget(
  seed: number,
  u: Unit,
  allUnits: Unit[],
): { targetX: number; speedMult: number } {
  const team = u.team;
  const fwd = team === "you" ? -1 : 1;
  const roadX = lanePathX(seed, team, u.lane, u.pos.y);

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

  const sameRole = allies.filter((a) => a.kind === u.kind).sort((a, b) => a.id - b.id);
  const roleIdx = Math.max(0, sameRole.findIndex((a) => a.id === u.id));
  const aheadOfMe = (other: Unit) => (other.pos.y - u.pos.y) * fwd;

  const nearbyTrebs = allies.filter((a) => a.kind === "trebuchet");
  const nearbyRams = allies.filter((a) => a.kind === "rammer");
  const nearbySiege = [...nearbyTrebs, ...nearbyRams];
  const nearbyMelee = allies.filter((a) => a.kind === "levy" || isWardKind(a.kind));

  let lateralOffset = 0;
  let speedMult = 1;

  if (u.kind === "rammer") {
    lateralOffset = nearbyRams.length <= 1 ? 0 : symmetricSlot(roleIdx % 3) * 10;
  } else if (u.kind === "archer") {
    lateralOffset = symmetricSlot(roleIdx % 5) * 10;
    if (!nearEnemyGate) {
      const behindMelee = nearbyMelee.some((m) => {
        const rel = aheadOfMe(m);
        return rel < 6 && rel > -48;
      });
      const hasFrontMelee = nearbyMelee.some((m) => aheadOfMe(m) >= 12);
      if (behindMelee && !hasFrontMelee) speedMult = 0.65;
    }
  } else if (u.kind === "ward") {
    if (nearbySiege.length > 0) {
      const side = roleIdx % 2 === 0 ? -1 : 1;
      lateralOffset = side * (14 + (Math.floor(roleIdx / 2) % 2) * 6);
      if (!nearEnemyGate) {
        const nearestSiege = nearbySiege.sort(
          (a, b) => Math.abs(a.pos.y - u.pos.y) - Math.abs(b.pos.y - u.pos.y),
        )[0]!;
        const siegeBehind = -aheadOfMe(nearestSiege);
        if (siegeBehind > 26 && siegeBehind < 75) speedMult = 0.78;
      }
    } else {
      lateralOffset = symmetricSlot(roleIdx % 5) * 10;
    }
  } else if (u.kind === "runner") {
    if (nearbyTrebs.length > 0 && !nearEnemyGate) {
      const side = roleIdx % 2 === 0 ? -1 : 1;
      lateralOffset = side * (20 + (Math.floor(roleIdx / 2) % 2) * 6);
      const nearestTreb = nearbyTrebs[0]!;
      const trebBehind = -aheadOfMe(nearestTreb);
      if (trebBehind > 20 && trebBehind < 75) speedMult = 0.72;
    } else {
      const side = roleIdx % 2 === 0 ? -1 : 1;
      lateralOffset = side * (16 + (Math.floor(roleIdx / 2) % 2) * 6);
    }
  } else if (u.kind === "levy" || u.kind === "templar") {
    lateralOffset = symmetricSlot(roleIdx % 5) * 10;
  } else {
    lateralOffset = symmetricSlot(roleIdx % 4) * 9;
  }

  return {
    targetX: roadX + lateralOffset,
    speedMult,
  };
}

/**
 * Soft separation so friendlies never stack. Skips units that are parked on a
 * hold rally (within 2u) so formation lines stay still instead of flashing.
 */
export function separateFriendlyUnits(
  units: Unit[],
  dt: number,
  possessedId: number | null,
) {
  const n = units.length;
  if (n < 2) return;
  const maxStep = 22 * dt;

  for (let i = 0; i < n; i++) {
    const a = units[i]!;
    if (a.hp <= 0 || a.id === possessedId) continue;
    if (a.playerOrdered && a.rallyPoint && Math.hypot(a.pos.x - a.rallyPoint.x, a.pos.y - a.rallyPoint.y) <= 2)
      continue;
    const aFrozen = a.kind === "trebuchet" && a.siegePhase !== "packed";
    const aParked =
      !!a.rallyPoint &&
      !a.playerOrdered &&
      Math.hypot(a.pos.x - a.rallyPoint.x, a.pos.y - a.rallyPoint.y) <= 2.2;

    for (let j = i + 1; j < n; j++) {
      const b = units[j]!;
      if (b.hp <= 0 || b.team !== a.team || b.id === possessedId) continue;
      if (a.kind === "spy" || b.kind === "spy") continue;
      if (b.playerOrdered && b.rallyPoint && Math.hypot(b.pos.x - b.rallyPoint.x, b.pos.y - b.rallyPoint.y) <= 2)
        continue;
      const bFrozen = b.kind === "trebuchet" && b.siegePhase !== "packed";
      if (aFrozen && bFrozen) continue;
      const bParked =
        !!b.rallyPoint &&
        !b.playerOrdered &&
        Math.hypot(b.pos.x - b.rallyPoint.x, b.pos.y - b.rallyPoint.y) <= 2.2;
      // Both holding formation slots — leave them alone so the line does not jitter.
      if (aParked && bParked) continue;

      const minSep =
        a.kind === "trebuchet" || b.kind === "trebuchet"
          ? 16
          : a.kind === "rammer" || b.kind === "rammer"
            ? 12
            : 10;
      let dx = b.pos.x - a.pos.x;
      let dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minSep * minSep) continue;

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
      const push = Math.min(maxStep, overlap * 0.4);
      const nx = (dx / d) * push;
      const ny = nearGate ? 0 : (dy / d) * push;

      if (aFrozen || aParked) {
        b.pos.x += nx;
        if (ny !== 0) b.pos.y = clampFieldY(b.pos.y + ny);
      } else if (bFrozen || bParked) {
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
