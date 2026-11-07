import * as THREE from "three";
import { cloneAnimatedModel } from "../assets3d";
import type { Team } from "../types";
import { TEAM_CLOTH } from "./materials";
import type { UnitAnimInput } from "./units";

/** Authored Levy (public/models/levy). Meters → game units: 1 / 0.13944. */
const SCALE = 7.172;
const FPS = 30;
const CONTACT = 9 / FPS;
const WALK_SPEED = 1.4;
const M_PER_UNIT = 0.13944;
const FADE_LOCO = 0.2;
const FADE_ATTACK = 0.05;

const teamMats = new Map<Team, THREE.MeshStandardMaterial>();

function teamMaterial(src: THREE.MeshStandardMaterial, team: Team) {
  let m = teamMats.get(team);
  if (m) return m;
  m = src.clone();
  const teamColor = { value: new THREE.Color(TEAM_CLOTH[team]) };
  m.userData.teamColor = teamColor;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.teamColor = teamColor;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform vec3 teamColor;\nvoid main() {")
      .replace(
        "#include <map_fragment>",
        "#ifdef USE_MAP\n\tvec4 s = texture2D( map, vMapUv );\n\tdiffuseColor.rgb *= mix( s.rgb, s.rgb * teamColor, s.a );\n#endif",
      );
  };
  m.customProgramCacheKey = () => "levy-team";
  teamMats.set(team, m);
  return m;
}

type State = "idle" | "walk" | "attack";

interface LevyAnim {
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  thrust: THREE.AnimationAction;
  state: State;
  lastNow: number;
  lx: number;
  ly: number;
  movedAt: number;
  speed: number;
}

/** Null until levy.glb is loaded; callers fall back to the procedural Levy. */
export function buildLevyGlb(team: Team): THREE.Group | null {
  const made = cloneAnimatedModel("levy");
  if (!made) return null;
  const clip = (n: string) => THREE.AnimationClip.findByName(made.clips, n);
  const idleClip = clip("Idle_Guard");
  const walkClip = clip("Walk_Carry");
  const thrustClip = clip("Thrust_High");
  if (!idleClip || !walkClip || !thrustClip) return null;

  const root = new THREE.Group();
  made.object.scale.setScalar(SCALE);
  root.add(made.object);
  made.object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (/_LOD[12]$/.test(mesh.name)) mesh.visible = false;
    // Lunges and the raised fork leave the bind-pose bounds.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.material = teamMaterial(mesh.material as THREE.MeshStandardMaterial, team);
  });

  const mixer = new THREE.AnimationMixer(made.object);
  const idle = mixer.clipAction(idleClip);
  const walk = mixer.clipAction(walkClip);
  const thrust = mixer.clipAction(thrustClip);
  thrust.setLoop(THREE.LoopOnce, 1);
  thrust.clampWhenFinished = true;
  idle.play();
  const anim: LevyAnim = { mixer, idle, walk, thrust, state: "idle", lastNow: -1, lx: 0, ly: 0, movedAt: -99, speed: 0 };
  root.userData.levyAnim = anim;
  root.userData.unitKind = "levy";
  return root;
}

function enter(a: LevyAnim, next: State, fade: number) {
  const from = a.state === "idle" ? a.idle : a.state === "walk" ? a.walk : a.thrust;
  const to = next === "idle" ? a.idle : next === "walk" ? a.walk : a.thrust;
  a.state = next;
  if (from === to) return;
  to.reset().play();
  if (fade > 0) from.crossFadeTo(to, fade, false);
  else from.stop();
}

/** Mirrors `animateUnit`'s timing: the sim hit lands when the attack timer resets, so contact plays at timer = 0. */
export function animateLevyGlb(root: THREE.Object3D, now: number, input: UnitAnimInput) {
  const a = root.userData.levyAnim as LevyAnim | undefined;
  if (!a) return false;
  const dt = a.lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, now - a.lastNow));
  a.lastNow = now;

  const d = Math.hypot(input.x - a.lx, input.y - a.ly);
  if (d > 0.02) {
    if (dt > 0) a.speed = (d / dt) * M_PER_UNIT;
    a.movedAt = now;
    a.lx = input.x;
    a.ly = input.y;
  }
  const moving = now - a.movedAt < 0.25;
  const timer = input.timer;
  const fighting = input.fighting ?? timer > -0.35;

  if (a.state === "attack") {
    if (!a.thrust.isRunning()) enter(a, moving ? "walk" : "idle", FADE_LOCO);
  } else if (fighting && timer > 0 && timer <= CONTACT) {
    enter(a, "attack", FADE_ATTACK);
    a.thrust.time = Math.max(0, CONTACT - timer - dt);
  } else if (moving && a.state !== "walk") {
    enter(a, "walk", FADE_LOCO);
  } else if (!moving && a.state === "walk") {
    enter(a, "idle", FADE_LOCO);
  }
  if (a.state === "walk") a.walk.timeScale = THREE.MathUtils.clamp(a.speed / WALK_SPEED, 0.8, 1.25);

  a.mixer.update(dt);
  return true;
}
