import * as THREE from "three";
import { WORLD_H, WORLD_W } from "./balance";
import type { MapDef, Team, UnitKind } from "./types";
import { crenellate, flaredRoof, materials, roundTower, tiledBox } from "./models/materials";

/** Gun-game ladder: peon → levy → archer → ward → runner. Death drops one (floor peon). */
export const ARENA_LADDER: UnitKind[] = ["peon", "levy", "archer", "ward", "runner"];
/** Kills needed on each rung before promote (runner's 5 clears the ladder / wins). */
export const ARENA_KILLS_NEEDED = [1, 1, 2, 3, 5] as const;
export const ARENA_BOT_COUNT = 6;
/** Half-extent of the playable courtyard (sim units). */
export const ARENA_HALF = 108;
export const ARENA_CX = WORLD_W / 2;
export const ARENA_CY = WORLD_H / 2;
export const ARENA_RESPAWN_DELAY = 2.4;
/** Courtyard wall half-width in model units (oversized keep footprint). */
export const ARENA_COURTYARD_W = 92;

export const ARENA_SEED = 424242;

export function arenaMap(): MapDef {
  return {
    id: "arena-gun",
    seed: ARENA_SEED,
    name: "The Courtyard",
    tagline: "Gun game · free-for-all practice",
    lanes: 1,
    pads: [{ id: "yard", x: ARENA_CX, y: ARENA_CY, laneCoverage: [0], zone: "combat" }],
    nodes: [],
    startTowerPad: "yard",
  };
}

export function arenaSpawnPoints(count: number): { x: number; y: number }[] {
  const n = Math.max(1, count);
  const radius = ARENA_HALF * 0.72;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push({
      x: ARENA_CX + Math.cos(a) * radius,
      y: ARENA_CY + Math.sin(a) * radius,
    });
  }
  return out;
}

export function clampToArena(pos: { x: number; y: number }, margin = 6) {
  const lim = ARENA_HALF - margin;
  pos.x = Math.max(ARENA_CX - lim, Math.min(ARENA_CX + lim, pos.x));
  pos.y = Math.max(ARENA_CY - lim, Math.min(ARENA_CY + lim, pos.y));
}

export function arenaRungKind(rung: number): UnitKind {
  const i = Math.max(0, Math.min(ARENA_LADDER.length - 1, Math.floor(rung)));
  return ARENA_LADDER[i];
}

export function arenaKillsNeeded(rung: number) {
  const i = Math.max(0, Math.min(ARENA_KILLS_NEEDED.length - 1, Math.floor(rung)));
  return ARENA_KILLS_NEEDED[i];
}

/** Rung index for a duel life stage. */
export function duelRung(life: "runner" | "ward") {
  return life === "runner" ? ARENA_LADDER.indexOf("runner") : ARENA_LADDER.indexOf("ward");
}

export function demoteRung(rung: number) {
  return Math.max(0, rung - 1);
}

export function promoteRung(rung: number) {
  return Math.min(ARENA_LADDER.length - 1, rung + 1);
}

/** Empty keep courtyard: curtain walls + corner towers, no donjon. */
export function buildArenaCourtyardModel(team: Team = "you") {
  const g = new THREE.Group();
  const W = ARENA_COURTYARD_W;
  const wallH = 8;
  const t = 2.2;
  const baseY = 0.4;

  const floor = tiledBox(W - 2, 0.6, W - 2, materials.stone, 24);
  floor.position.set(0, 0.2, 0);
  floor.receiveShadow = true;
  g.add(floor);
  g.add(buildArenaBloodStains(W - 6));

  for (const [w, d, x, z] of [
    [W, t, 0, W / 2],
    [W, t, 0, -W / 2],
    [t, W, W / 2, 0],
    [t, W, -W / 2, 0],
  ] as const) {
    const wall = tiledBox(w, wallH, d, materials.stone);
    wall.position.set(x, baseY + wallH / 2, z);
    g.add(wall);
  }
  g.add(crenellate(W, W, baseY + wallH));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tw = roundTower(4.2, 16);
      tw.position.set((sx * W) / 2, baseY + 8, (sz * W) / 2);
      const roof = flaredRoof(5, 9, team);
      roof.position.set((sx * W) / 2, baseY + 16, (sz * W) / 2);
      g.add(tw, roof);
    }
  }

  // Gate gaps on +Z and −Z so the yard reads open
  for (const z of [W / 2, -W / 2]) {
    const gate = tiledBox(14, 11, 4.5, materials.stone);
    gate.position.set(0, baseY + 5.5, z + Math.sign(z) * 0.4);
    g.add(gate);
  }

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // Decals should never cast; keep them glued to the flagstones.
  g.getObjectByName("arena-blood")?.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return g;
}

export function arenaCameraFrame() {
  return {
    yaw: 0.35,
    pitch: 1.05,
    dist: 320,
    lookX: 0,
    lookY: 8,
    lookZ: 0,
  };
}

/** Deterministic blotches so the courtyard feels fought-over without gore spam. */
function buildArenaBloodStains(span: number) {
  const group = new THREE.Group();
  group.name = "arena-blood";
  // Fixed layout in courtyard local space (x, z, scale, rotationY, texture seed).
  const spots: [number, number, number, number, number][] = [
    [-22, 14, 11, 0.4, 1],
    [18, -8, 9, -0.9, 2],
    [6, 28, 7.5, 1.2, 3],
    [-31, -19, 13, 0.15, 4],
    [29, 22, 8, -1.5, 5],
    [-8, -32, 10, 2.1, 6],
    [12, 4, 6, 0.7, 7],
    [-15, 2, 5.5, -0.35, 8],
    [34, -26, 9.5, 1.7, 9],
    [-4, 18, 4.8, -2.4, 10],
    [21, 31, 7, 0.95, 11],
    [-26, 30, 6.2, -1.1, 12],
  ];
  const lim = span * 0.48;
  for (const [x, z, scale, rot, seed] of spots) {
    const mesh = makeBloodStainMesh(seed);
    mesh.position.set(
      Math.max(-lim, Math.min(lim, x)),
      0.52,
      Math.max(-lim, Math.min(lim, z)),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rot;
    mesh.scale.setScalar(scale);
    group.add(mesh);
  }
  return group;
}

function makeBloodStainMesh(seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const rnd = mulberry32(0xb100d ^ (seed * 0x9e3779b9));
  ctx.clearRect(0, 0, 128, 128);

  // Soft main pool
  const blobs = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < blobs; i++) {
    const cx = 48 + rnd() * 32;
    const cy = 48 + rnd() * 32;
    const rx = 18 + rnd() * 28;
    const ry = 14 + rnd() * 24;
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(rx, ry));
    const a0 = 0.42 + rnd() * 0.22;
    grad.addColorStop(0, `rgba(92, 14, 18, ${a0})`);
    grad.addColorStop(0.55, `rgba(58, 8, 12, ${a0 * 0.72})`);
    grad.addColorStop(1, "rgba(40, 6, 8, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Satellite drips / flecks
  const flecks = 10 + Math.floor(rnd() * 10);
  for (let i = 0; i < flecks; i++) {
    const fx = 20 + rnd() * 88;
    const fy = 20 + rnd() * 88;
    const r = 1.2 + rnd() * 4.5;
    ctx.fillStyle = `rgba(70, 10, 14, ${0.28 + rnd() * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(fx, fy, r, r * (0.55 + rnd() * 0.7), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.88,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.renderOrder = 1;
  return mesh;
}

function mulberry32(a: number) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
