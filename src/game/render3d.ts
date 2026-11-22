import * as THREE from "three";
import {
  BUILD_RANGE,
  dogRange,
  POSSESS_FOV_TIGHT,
  POSSESS_FOV_WIDE,
  POSSESS_PULL_MAX,
  POSSESS_VISION_SCORE,
  STARTER_GUARD_RANGE,
  TREB_POSSESS_AHEAD,
  TREB_POSSESS_BACK,
  TREB_POSSESS_FOV,
  TREB_POSSESS_HEIGHT,
  WORLD_H,
  WORLD_W,
} from "./balance";
import { ARENA_HALF, arenaCameraFrame, buildArenaCourtyardModel } from "./arena";
import { homeCameraFrame } from "./homeCamera";
import { mapBounds } from "./map";
import { cloneModel, ensureModelsLoaded, setSharedAnisotropy } from "./assets3d";
import { buildSkyEnvironment } from "./skyEnvironment";
import type { Barricade, Building, CommandMarker, GameState, RectHit, Team, Unit, UnitKind } from "./types";
import {
  buildScenery,
  buildTerrain,
} from "./worldMesh";
import { buildKeepModel } from "./models/keep";
import { configureStructureMaterials } from "./models/materials";
import { buildTree } from "./models/nature";
import { buildGoldMine } from "./models/mine";
import { configureUnitMaterials } from "./models/unitKit";
import { animateTrebuchet, animateUnit, buildPeonModel, buildUnitModel, setPeonGear } from "./models/units";
import {
  buildBallistaModel,
  buildBarracksModel,
  buildCatapultModel,
  buildChurchModel,
  buildHouseModel,
  buildWatchtowerModel,
} from "./models/buildings";
import { CHURCH_AURA_RANGE } from "./balance";



/** Map 2D sim coords (y down) â†’ Three.js XZ ground (Y up). Allocates â€” use only off the hot path. */
function to3(x: number, y: number, h = 0) {
  return new THREE.Vector3(x - WORLD_W / 2, h, y - WORLD_H / 2);
}

/** Allocation-free variant of to3 for per-frame placement. */
function setPos3(obj: { position: THREE.Vector3 }, x: number, y: number, h = 0) {
  obj.position.set(x - WORLD_W / 2, h, y - WORLD_H / 2);
}

type EntityKey = string;

export type QualityTier = "low" | "medium" | "high";
export type QualitySetting = "auto" | QualityTier;
export type TouchDragMode = "select" | "camera";

export interface QualityInfo {
  setting: QualitySetting;
  tier: QualityTier;
  fps: number;
}

const QUALITY_KEY = "roadkeep.quality";

const TIER_PROFILE: Record<
  QualityTier,
  { dpr: number; shadows: boolean; shadowMap: number; particles: number; fog: boolean; pointLights: boolean; shadowEvery: number }
> = {
  low: { dpr: 1.0, shadows: false, shadowMap: 1024, particles: 120, fog: false, pointLights: false, shadowEvery: 1 },
  medium: { dpr: 1.5, shadows: true, shadowMap: 1024, particles: 260, fog: true, pointLights: true, shadowEvery: 2 },
  high: { dpr: 2.0, shadows: true, shadowMap: 2048, particles: 420, fog: true, pointLights: true, shadowEvery: 1 },
};

export function loadQualitySetting(): QualitySetting {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === "low" || v === "medium" || v === "high" || v === "auto") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse || navigator.maxTouchPoints > 0;
}

/** Phones and tablets. Their lit shader fails once too many lights are baked in. */
export function isMobileGpu() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    isTouchDevice() ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/** Static capability guess â€” refined by frame-time sampling once the game runs. */
export function detectQualityTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 0;
  const ua = nav.userAgent || "";
  const mobile =
    nav.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS desktop UA
  if (mobile) {
    if (cores <= 4 || (memory > 0 && memory <= 3)) return "low";
    return "medium";
  }
  if (cores <= 4 || (memory > 0 && memory <= 4)) return "medium";
  return "high";
}

const MAX_COMMAND_LINES = 64;
const MAX_GUARD_TETHERS = 96;

/** Unified 3D screen-space pick result (extends RectHit with barricades). */
export type ScreenPickHit = RectHit | { kind: "barricade"; id: string };

/** Tactical ring base radius matched to each unit's 3D footprint. */
function unitFootprintRadius(kind: UnitKind): number {
  switch (kind) {
    case "trebuchet":
      return 16.5;
    case "rammer":
      return 13.5;
    case "brute":
    case "templar":
      return 9.8;
    case "ward":
      return 9.2;
    default:
      return 7.4;
  }
}

/**
 * Three.js battlefield renderer â€” same public API as the old Canvas2D GameRenderer.
 * Simulation stays 2D; this is presentation only.
 */
export class GameRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private root = new THREE.Group();
  private staticRoot = new THREE.Group();
  private dynamicRoot = new THREE.Group();
  private commandLineRoot = new THREE.Group();
  private tacticalRingRoot = new THREE.Group();
  private floatRoot = new THREE.Group();

  private entityMap = new Map<EntityKey, THREE.Object3D>();
  private animationMap = new Map<
    EntityKey,
    {
      mixer: THREE.AnimationMixer;
      clips: THREE.AnimationClip[];
      actions: Map<string, THREE.AnimationAction>;
      current?: string;
      root: THREE.Object3D;
      accum: number;
      frame: number;
    }
  >();
  private scratchLive = new Set<string>();
  private scratchIds = new Set<number>();
  private scratchPads = new Set<string>();
  private scratchSelectedUnitIds = new Set<number>();
  private scratchGuardedIds = new Set<number>();
  private scratchTargetKeys = new Set<string>();
  private scratchUnitById = new Map<number, Unit>();
  // Pooled command-line visuals (updated in place, never re-created per frame)
  private commandLines: THREE.LineSegments;
  private commandLinePos: Float32Array;
  private commandLineCol: Float32Array;
  private rallyLine: THREE.Line;
  private rallyLinePos: Float32Array;
  // Pooled AoE2 tactical visuals: barracks selection rings, emerald guard rings/tethers, crimson target rings
  private guardTetherLines: THREE.LineSegments;
  private guardLinePos: Float32Array;
  private guardLineDist: Float32Array;
  private unitRingGlowGeo: THREE.RingGeometry;
  private unitRingCoreGeo: THREE.RingGeometry;
  private unitSelGlowMat: THREE.MeshBasicMaterial;
  private unitSelCoreMat: THREE.MeshBasicMaterial;
  private guardRingGlowMat: THREE.MeshBasicMaterial;
  private guardRingCoreMat: THREE.MeshBasicMaterial;
  private targetRingGlowMat: THREE.MeshBasicMaterial;
  private targetRingCoreMat: THREE.MeshBasicMaterial;
  private damageYellowGlowMat: THREE.MeshBasicMaterial;
  private damageYellowCoreMat: THREE.MeshBasicMaterial;
  private damageRedGlowMat: THREE.MeshBasicMaterial;
  private damageRedCoreMat: THREE.MeshBasicMaterial;
  private unitSelRingPool: THREE.Group[] = [];
  private guardRingPool: THREE.Group[] = [];
  private targetRingPool: THREE.Group[] = [];
  private damageYellowRingPool: THREE.Group[] = [];
  private damageRedRingPool: THREE.Group[] = [];
  // Shared command marker geometries (prevent per-marker geometry leaks)
  private cmdRingGeo: THREE.RingGeometry;
  private cmdGuardOuterGeo: THREE.RingGeometry;
  private cmdGuardShieldGeo: THREE.RingGeometry;
  private padMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private rangeRingFor = "";
  private dogRangeRing: THREE.Mesh | null = null;
  // Quality
  private qualitySetting: QualitySetting = "auto";
  private tier: QualityTier = "high";
  private detectedTier: QualityTier = "high";
  private autoDrops = 0;
  private frameSamples = 0;
  private frameAccum = 0;
  private frameCount = 0;
  private fpsEstimate = 60;
  private shadowFrame = 0;
  private onQualityChange: ((info: QualityInfo) => void) | null = null;
  private touchDragMode: TouchDragMode = "select";
  private pinchStartAngle = 0;
  private pinchCenter = { x: 0, y: 0 };
  private tmpV = new THREE.Vector3();
  private pickV0 = new THREE.Vector3();
  private pickV1 = new THREE.Vector3();
  private pickRayPt = new THREE.Vector3();
  private pickSegPt = new THREE.Vector3();
  private lastMapId = "";
  /** Gun-game courtyard — frame the yard, hide keeps. */
  private arenaView = false;
  private worldGroup = new THREE.Group();
  private torchLights: THREE.PointLight[] = [];
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyEnv: THREE.Texture | null = null;
  private rangeRing: THREE.Mesh | null = null;
  private floatSprites: { mesh: THREE.Sprite; life: number; id: number }[] = [];
  private floatIdSeen = new Set<number>();
  private knownUnits = new Map<number, { x: number; y: number; team: Team }>();
  private knownKeepFlash = { you: 0, foe: 0 };
  private knownKeepAttack = { you: 0, foe: 0 };
  private knownKick = new Map<number, number>();
  private knownCombatEvents = new Set<number>();
  private arrows: {
    mesh: THREE.Mesh;
    start: THREE.Vector3;
    end: THREE.Vector3;
    life: number;
    max: number;
  }[] = [];
  private wallClock = performance.now();
  private particles: {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    max: number;
    color: THREE.Color;
    size: number;
  }[] = [];
  private particleGeo = new THREE.BufferGeometry();
  private particleMat: THREE.PointsMaterial;
  private particlePoints: THREE.Points;
  /** Spherical orbit â€” pitch from Y (0=top-down, Ï€/2=horizon). */
  private camDist = 520;
  private camYaw = 0.12;
  private camPitch = 1.12; // ~64Â° from top â†’ proper RTS angle, not bird's-eye
  private camLook = new THREE.Vector3(0, 14, 240);
  private homeSide: Team = "you";
  /** Battlefield width in sim units. 3-road maps are wider than the default 400. */
  private mapWidth = WORLD_W;
  private readonly camDistMin = 38;
  private readonly camDistMax = 1500;
  private readonly camPitchMin = 0.4;
  private readonly camPitchMax = 1.42;
  private camShake = new THREE.Vector3();
  private camKeys = new Set<string>();
  private camGlide: { x: number; z: number; dist: number | null } | null = null;
  private pointers = new Map<number, { x: number; y: number; ox: number; oy: number }>();
  private dragMode: "none" | "orbit" | "pan" | "pinch" | "select" = "none";
  private dragMoved = false;
  private pointerButton = 0;
  private pointerType = "mouse";
  private lastPtr = { x: 0, y: 0 };
  private pinchStartDist = 0;
  private pinchStartCamDist = 520;
  private suppressClick = false;
  private fpsLive = false;
  private fpsYaw = 0;
  private fpsPitch = 0.08;
  private fpsSwing = 0;
  private fpsPull = 0;
  private fpsMaxPull = 0;
  private trebView = false;
  private fpsHead: THREE.Object3D | null = null;
  private fpsEye = new THREE.Vector3();
  private fpsAt = new THREE.Vector3();
  private fpsHands = new THREE.Group();
  private fpsSword = new THREE.Group();
  private fpsBow = new THREE.Group();

  constructor(private canvas: HTMLCanvasElement) {
    this.qualitySetting = loadQualitySetting();
    this.detectedTier = detectQualityTier();
    this.tier = this.qualitySetting === "auto" ? this.detectedTier : this.qualitySetting;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Antialias is fixed at context creation; low tier skips it entirely.
      antialias: this.tier !== "low",
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x6a90b8, 1);
    this.renderer.shadowMap.enabled = true;
    // Soft shadows add a large chunk to every lit program. On mobile that program
    // fails to link, so the color pass is skipped while the depth pass still draws.
    this.renderer.shadowMap.type = isMobileGpu() ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    // Before any procedural building/unit material is created: separate bump
    // maps (and disable them on touch / low tier) so mobile GPUs keep the color pass.
    this.configureProceduralMaterials();

    this.camera = new THREE.PerspectiveCamera(42, 1, 5, 3200);
    this.scene.fog = new THREE.FogExp2(0x8eb4d0, 0.00055);
    this.scene.background = new THREE.Color(0x7aa0c0);

    this.hemi = new THREE.HemisphereLight(0xfff0e0, 0x6a8a70, 1.35);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.35);
    this.sun.position.set(60, 380, 220);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1400;
    this.sun.shadow.camera.left = -420;
    this.sun.shadow.camera.right = 420;
    this.sun.shadow.camera.top = 620;
    this.sun.shadow.camera.bottom = -620;
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0xc8d8f0, 0.85));
    // Two extra directional lights push the mobile lit shader over the link limit.
    if (!isMobileGpu()) {
      // The env map sampler also grows the lit program, so phones skip it too.
      this.skyEnv = buildSkyEnvironment(this.renderer);
      this.scene.environmentIntensity = 0.3;
      const fill = new THREE.DirectionalLight(0xb0d0ff, 0.75);
      fill.position.set(-140, 120, -40);
      this.scene.add(fill);
      const rim = new THREE.DirectionalLight(0xffe8c0, 0.45);
      rim.position.set(40, 60, 300);
      this.scene.add(rim);
    }

    this.scene.add(this.root);
    this.root.add(this.staticRoot);
    this.staticRoot.add(this.worldGroup);
    this.root.add(this.dynamicRoot);
    this.dynamicRoot.add(this.commandLineRoot);
    this.dynamicRoot.add(this.tacticalRingRoot);
    this.root.add(this.floatRoot);

    this.particleMat = new THREE.PointsMaterial({
      size: 3.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
    this.particlePoints.frustumCulled = false;
    this.root.add(this.particlePoints);
    this.allocateParticleBuffers(TIER_PROFILE.high.particles);

    // Pooled command lines: one LineSegments for all peon order lines, one dashed Line for rally.
    this.commandLinePos = new Float32Array(MAX_COMMAND_LINES * 2 * 3);
    this.commandLineCol = new Float32Array(MAX_COMMAND_LINES * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(this.commandLinePos, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setAttribute("color", new THREE.BufferAttribute(this.commandLineCol, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setDrawRange(0, 0);
    this.commandLines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.58 }),
    );
    this.commandLines.frustumCulled = false;
    this.commandLineRoot.add(this.commandLines);
    this.rallyLinePos = new Float32Array(6);
    const rallyGeo = new THREE.BufferGeometry();
    rallyGeo.setAttribute("position", new THREE.BufferAttribute(this.rallyLinePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rallyLine = new THREE.Line(rallyGeo, new THREE.LineDashedMaterial({ color: 0xffd475, dashSize: 5, gapSize: 3 }));
    this.rallyLine.frustumCulled = false;
    this.rallyLine.visible = false;
    this.commandLineRoot.add(this.rallyLine);

    // Pooled emerald guard tether lines (dashed green, updated in place with pre-allocated lineDistance).
    this.guardLinePos = new Float32Array(MAX_GUARD_TETHERS * 2 * 3);
    this.guardLineDist = new Float32Array(MAX_GUARD_TETHERS * 2);
    const guardLineGeo = new THREE.BufferGeometry();
    guardLineGeo.setAttribute("position", new THREE.BufferAttribute(this.guardLinePos, 3).setUsage(THREE.DynamicDrawUsage));
    guardLineGeo.setAttribute(
      "lineDistance",
      new THREE.BufferAttribute(this.guardLineDist, 1).setUsage(THREE.DynamicDrawUsage),
    );
    guardLineGeo.setDrawRange(0, 0);
    this.guardTetherLines = new THREE.LineSegments(
      guardLineGeo,
      new THREE.LineDashedMaterial({
        color: 0x3ef59c,
        dashSize: 4.5,
        gapSize: 3.5,
        transparent: true,
        opacity: 0.82,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.guardTetherLines.frustumCulled = false;
    this.guardTetherLines.visible = false;
    this.guardTetherLines.renderOrder = 22;
    this.commandLineRoot.add(this.guardTetherLines);

    // Shared normalized-radius ring geometries & materials for AoE2 unit selection / guard / focus-target rings.
    this.unitRingGlowGeo = new THREE.RingGeometry(0.72, 1.15, 36);
    this.unitRingGlowGeo.rotateX(-Math.PI / 2);
    this.unitRingCoreGeo = new THREE.RingGeometry(0.84, 1.0, 36);
    this.unitRingCoreGeo.rotateX(-Math.PI / 2);

    this.unitSelGlowMat = new THREE.MeshBasicMaterial({
      color: 0x26ecff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.unitSelCoreMat = new THREE.MeshBasicMaterial({
      color: 0xffe45e,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.guardRingGlowMat = new THREE.MeshBasicMaterial({
      color: 0x12c970,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.guardRingCoreMat = new THREE.MeshBasicMaterial({
      color: 0x3ef59c,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.targetRingGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff1e2d,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.targetRingCoreMat = new THREE.MeshBasicMaterial({
      color: 0xff4550,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    // Shared materials for always-visible structure damage rings (yellow: slightly damaged, red: critically damaged).
    this.damageYellowGlowMat = new THREE.MeshBasicMaterial({
      color: 0xf4c842,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.damageYellowCoreMat = new THREE.MeshBasicMaterial({
      color: 0xf4c842,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.damageRedGlowMat = new THREE.MeshBasicMaterial({
      color: 0xe84848,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.damageRedCoreMat = new THREE.MeshBasicMaterial({
      color: 0xe84848,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    // Shared geometries for command markers (material disposed cleanly on prune).
    this.cmdRingGeo = new THREE.RingGeometry(3.5, 5.0, 24);
    this.cmdRingGeo.rotateX(-Math.PI / 2);
    this.cmdGuardOuterGeo = new THREE.RingGeometry(3.8, 5.4, 32);
    this.cmdGuardOuterGeo.rotateX(-Math.PI / 2);
    this.cmdGuardShieldGeo = new THREE.RingGeometry(1.9, 3.1, 6);
    this.cmdGuardShieldGeo.rotateX(-Math.PI / 2);

    this.buildSky();
    this.buildFpsRig();
    this.fitCamera();
    this.applyTier(this.tier, false);
    void ensureModelsLoaded().then(() => {
      // Force one remesh pass so trees and props pick up loaded models.
      this.lastMapId = "";
    });
  }

  private hideTacticalOverlays() {
    for (const r of this.unitSelRingPool) r.visible = false;
    for (const r of this.guardRingPool) r.visible = false;
    for (const r of this.targetRingPool) r.visible = false;
    for (const r of this.damageYellowRingPool) r.visible = false;
    for (const r of this.damageRedRingPool) r.visible = false;
    this.guardTetherLines.geometry.setDrawRange(0, 0);
    this.guardTetherLines.visible = false;
  }

  private disposeCommandMarkerObject(obj: THREE.Object3D) {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    });
  }

  private rebuildBattlefield(state: GameState) {
    this.rebuildMapProps(state);
    this.lastMapId = state.mapId;
    this.knownUnits.clear();
    this.knownCombatEvents.clear();
    this.particles.length = 0;
    this.rangeRingFor = "";
    this.disposeRangeRings();
    this.hideTacticalOverlays();
    for (const [k, obj] of [...this.entityMap]) {
      this.dynamicRoot.remove(obj);
      if (k.startsWith("cmd-")) this.disposeCommandMarkerObject(obj);
      this.clearAnimation(k);
      this.entityMap.delete(k);
    }
  }

  private buildFpsRig() {
    this.fpsHands.visible = false;
    this.camera.add(this.fpsHands);
    this.scene.add(this.camera);

    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.82 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9d4e0, metalness: 0.72, roughness: 0.28 });
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.22, 6), wood);
    hilt.rotation.z = Math.PI / 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.95), steel);
    blade.position.z = -0.52;
    this.fpsSword.add(hilt, blade);
    this.fpsSword.position.set(0.38, -0.32, -0.55);
    this.fpsSword.rotation.set(-0.35, 0.15, -0.55);

    const limb = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.025, 6, 12, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x6b3d1f, roughness: 0.75 }),
    );
    limb.rotation.y = Math.PI / 2;
    this.fpsBow.add(limb);
    this.fpsBow.position.set(0.28, -0.22, -0.62);
    this.fpsBow.rotation.set(0.1, 0, -0.2);

    this.fpsHands.add(this.fpsSword, this.fpsBow);
  }

  private findUnitHead(obj: THREE.Object3D, kind: string) {
    if (kind === "rammer") return obj.getObjectByName("c0.head") ?? obj.getObjectByName("head") ?? null;
    return obj.getObjectByName("head") ?? null;
  }

  private applyTrebuchetCamera(body: Unit, shake: number) {
    const yaw = this.fpsYaw;
    const pitch = THREE.MathUtils.clamp(this.fpsPitch, -0.62, 0.18);
    const lx = Math.sin(yaw);
    const lz = -Math.cos(yaw);
    const x = body.pos.x - WORLD_W / 2;
    const z = body.pos.y - WORLD_H / 2;
    const jx = shake > 0 ? (Math.random() - 0.5) * 1.4 : 0;
    const jy = shake > 0 ? (Math.random() - 0.5) * 0.6 : 0;
    const jz = shake > 0 ? (Math.random() - 0.5) * 1.4 : 0;
    if (Math.abs(this.camera.fov - TREB_POSSESS_FOV) > 0.2 || this.camera.near !== 2.4) {
      this.camera.fov = TREB_POSSESS_FOV;
      this.camera.near = 2.4;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(
      x - lx * TREB_POSSESS_BACK + jx,
      TREB_POSSESS_HEIGHT + pitch * -36 + jy,
      z - lz * TREB_POSSESS_BACK + jz,
    );
    this.camera.lookAt(x + lx * TREB_POSSESS_AHEAD, 10 + pitch * 48, z + lz * TREB_POSSESS_AHEAD);
  }

  private applyFpsCamera(eye: THREE.Vector3, shake: number) {
    const cp = Math.cos(this.fpsPitch);
    const sp = Math.sin(this.fpsPitch);
    const lx = Math.sin(this.fpsYaw) * cp;
    const ly = sp;
    const lz = -Math.cos(this.fpsYaw) * cp;
    const pull = this.fpsPull;
    const jx = shake > 0 ? (Math.random() - 0.5) * 1.1 : 0;
    const jy = shake > 0 ? (Math.random() - 0.5) * 0.5 : 0;
    const jz = shake > 0 ? (Math.random() - 0.5) * 1.1 : 0;
    // Tight FPS sits just in front of the eyes; earned pull sits behind the soldier.
    this.fpsEye.set(
      eye.x - lx * pull + lx * 0.42 + jx,
      eye.y - ly * pull + 0.28 + pull * 0.12 + jy,
      eye.z - lz * pull + lz * 0.42 + jz,
    );
    this.fpsAt.set(eye.x + lx * (8 + pull * 0.15), eye.y + ly * 8, eye.z + lz * (8 + pull * 0.15));
    this.camera.position.copy(this.fpsEye);
    this.camera.lookAt(this.fpsAt);
  }

  private buildSky() {
    const skyGeo = new THREE.SphereGeometry(1400, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld).y;
          vec3 top = vec3(0.35, 0.55, 0.85);
          vec3 mid = vec3(0.55, 0.72, 0.92);
          vec3 hor = vec3(0.95, 0.78, 0.55);
          vec3 col = mix(hor, mid, smoothstep(-0.05, 0.25, h));
          col = mix(col, top, smoothstep(0.2, 0.75, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
  }

  private fitCamera() {
    this.resetCamera();
  }

  /** Best default RTS framing — oblique, on the local keep's side of the map. */
  resetCamera() {
    this.camGlide = null;
    const frame = this.arenaView ? arenaCameraFrame() : homeCameraFrame(this.homeSide);
    // Pull back a little on wide maps so the outer roads start in view.
    this.camDist = this.arenaView
      ? frame.dist
      : frame.dist * Math.sqrt(Math.max(1, this.mapWidth / WORLD_W));
    this.camYaw = frame.yaw;
    this.camPitch = frame.pitch;
    this.camLook.set(frame.lookX, frame.lookY, frame.lookZ);
    this.applyCamera();
  }

  private clampCamLook() {
    const panX = this.mapWidth / 2 + 60;
    const panZ = WORLD_H / 2 + 130;
    this.camLook.x = THREE.MathUtils.clamp(this.camLook.x, -panX, panX);
    this.camLook.z = THREE.MathUtils.clamp(this.camLook.z, -panZ, panZ);
  }

  private groundHitAt(screenX: number, screenY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this.pointer.x = (screenX / rect.width) * 2 - 1;
    this.pointer.y = -(screenY / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  /** Smoothly glide the camera target onto a sim-space world point (and optional close-up distance). */
  focusWorld(worldX: number, worldY: number, targetDist?: number) {
    if (this.fpsLive) return;
    this.camGlide = {
      x: worldX - WORLD_W / 2,
      z: worldY - WORLD_H / 2,
      dist: targetDist != null ? THREE.MathUtils.clamp(targetDist, this.camDistMin, this.camDistMax) : null,
    };
  }

  /** Jump to the hottest active battle (or furthest frontline squad) for close-up viewing. */
  focusBattle(state: GameState) {
    if (this.fpsLive) return;
    const combat = state.units.filter((u) => u.hp > 0 && u.fromBarracks);
    const youUnits = combat.filter((u) => u.team === "you");
    const foeUnits = combat.filter((u) => u.team === "foe");
    let bestPairDist = Infinity;
    let targetX = WORLD_W / 2;
    let targetY = WORLD_H / 2;
    let found = false;

    for (const a of youUnits) {
      for (const b of foeUnits) {
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        if (d < bestPairDist) {
          bestPairDist = d;
          targetX = (a.pos.x + b.pos.x) / 2;
          targetY = (a.pos.y + b.pos.y) / 2;
          found = true;
        }
      }
    }

    if (!found || bestPairDist > 190) {
      // No active clash yet — focus the most forward friendly squad, else center of the battlefield.
      const own = state.units.filter((u) => u.hp > 0 && u.team === this.homeSide && u.fromBarracks);
      if (own.length > 0) {
        own.sort((a, b) => (this.homeSide === "you" ? a.pos.y - b.pos.y : b.pos.y - a.pos.y));
        targetX = own[0]!.pos.x;
        targetY = own[0]!.pos.y;
      }
    }
    this.focusWorld(targetX, targetY, Math.min(this.camDist, 185));
  }

  setCamKey(key: string, down: boolean) {
    const k = key.toLowerCase();
    if (down) {
      this.camKeys.add(k);
      this.camGlide = null;
    } else {
      this.camKeys.delete(k);
    }
  }

  clearCamKeys() {
    this.camKeys.clear();
  }

  private stepCamera(dt: number) {
    if (this.fpsLive) return;
    let dirty = false;

    // Continuous smooth WASD / Arrow panning and Q/E orbiting.
    let moveRight = 0;
    let moveBack = 0;
    if (this.camKeys.has("a") || this.camKeys.has("arrowleft")) moveRight -= 1;
    if (this.camKeys.has("d") || this.camKeys.has("arrowright")) moveRight += 1;
    if (this.camKeys.has("w") || this.camKeys.has("arrowup")) moveBack -= 1;
    if (this.camKeys.has("s") || this.camKeys.has("arrowdown")) moveBack += 1;
    if (moveRight !== 0 || moveBack !== 0) {
      const len = Math.hypot(moveRight, moveBack);
      const nx = moveRight / len;
      const nz = moveBack / len;
      const speed = Math.max(130, this.camDist * 0.95) * dt;
      const forward = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
      const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      this.camLook.addScaledVector(right, nx * speed);
      this.camLook.addScaledVector(forward, nz * speed);
      this.clampCamLook();
      dirty = true;
    }

    let orbitDir = 0;
    if (this.camKeys.has("q")) orbitDir += 1;
    if (this.camKeys.has("e")) orbitDir -= 1;
    if (orbitDir !== 0) {
      this.camYaw -= orbitDir * 1.45 * dt;
      dirty = true;
    }

    if (this.camGlide) {
      const k = 1 - Math.exp(-8 * dt);
      this.camLook.x += (this.camGlide.x - this.camLook.x) * k;
      this.camLook.z += (this.camGlide.z - this.camLook.z) * k;
      if (this.camGlide.dist != null) {
        this.camDist += (this.camGlide.dist - this.camDist) * k;
      }
      this.clampCamLook();
      const closePos =
        Math.hypot(this.camGlide.x - this.camLook.x, this.camGlide.z - this.camLook.z) < 0.8;
      const closeDist =
        this.camGlide.dist == null || Math.abs(this.camGlide.dist - this.camDist) < 0.8;
      if (closePos && closeDist) {
        this.camLook.x = this.camGlide.x;
        this.camLook.z = this.camGlide.z;
        if (this.camGlide.dist != null) this.camDist = this.camGlide.dist;
        this.camGlide = null;
      }
      dirty = true;
    }

    if (dirty) this.applyCamera();
  }

  getHomeSide() {
    return this.homeSide;
  }

  /** North keep for the guest. Does not flip the map. */
  setHomeSide(team: Team) {
    this.homeSide = team;
    this.resetCamera();
  }

  zoomBy(factor: number) {
    if (this.fpsLive) return;
    this.camGlide = null;
    this.camDist = THREE.MathUtils.clamp(this.camDist * factor, this.camDistMin, this.camDistMax);
    this.applyCamera();
  }

  /** Zoom toward the exact map point under (screenX, screenY) so you can inspect any battle close up. */
  zoomAtScreen(factor: number, screenX: number, screenY: number) {
    if (this.fpsLive) return;
    this.camGlide = null;
    const before = this.groundHitAt(screenX, screenY);
    this.camDist = THREE.MathUtils.clamp(this.camDist * factor, this.camDistMin, this.camDistMax);
    this.applyCamera();
    if (before) {
      this.camera.updateMatrixWorld();
      const after = this.groundHitAt(screenX, screenY);
      if (after) {
        this.camLook.x += before.x - after.x;
        this.camLook.z += before.z - after.z;
        this.clampCamLook();
        this.applyCamera();
      }
    }
  }

  /** Normalised zoom: 0 = closest, 1 = furthest. */
  getZoomT() {
    return (this.camDist - this.camDistMin) / (this.camDistMax - this.camDistMin);
  }

  setZoomT(t: number) {
    if (this.fpsLive) return;
    const k = THREE.MathUtils.clamp(t, 0, 1);
    this.camDist = this.camDistMin + (this.camDistMax - this.camDistMin) * k;
    this.applyCamera();
  }

  orbitBy(dx: number, dy: number) {
    if (this.fpsLive) return;
    this.camYaw -= dx * 0.0055;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.0045, this.camPitchMin, this.camPitchMax);
    this.applyCamera();
  }

  lookBy(dx: number, dy: number, scale = 1) {
    // Mouse-right / stick-right turns right (Basilisk corrected the inverted yaw).
    this.fpsYaw += dx * 0.0024 * scale;
    this.fpsPitch = THREE.MathUtils.clamp(this.fpsPitch - dy * 0.0022 * scale, -1.15, 1.1);
  }

  getFpsYaw() {
    return this.fpsYaw;
  }

  ensurePossess(yaw: number, siege = false) {
    if (this.fpsLive) return;
    this.enterPossess(yaw, siege);
  }

  enterPossess(yaw: number, siege = false) {
    this.trebView = siege;
    this.fpsYaw = yaw;
    this.fpsPitch = siege ? -0.28 : 0.08;
    this.fpsSwing = 0;
    this.fpsPull = 0;
  }

  kickSwing() {
    this.fpsSwing = 1;
  }

  panBy(dx: number, dy: number) {
    if (this.fpsLive) return;
    this.camGlide = null;
    // Pan relative to camera facing on the ground plane
    const forward = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const scale = Math.max(0.18, this.camDist * 0.00145);
    this.camLook.addScaledVector(right, -dx * scale);
    this.camLook.addScaledVector(forward, -dy * scale);
    this.clampCamLook();
    this.applyCamera();
  }

  private applyCamera() {
    const sp = Math.sin(this.camPitch);
    const cp = Math.cos(this.camPitch);
    this.camera.position.set(
      this.camLook.x + this.camDist * sp * Math.sin(this.camYaw),
      this.camLook.y + this.camDist * cp,
      this.camLook.z + this.camDist * sp * Math.cos(this.camYaw),
    );
    this.camera.position.add(this.camShake);
    this.camera.lookAt(this.camLook);
  }

  /** One-finger drag behaviour on touch devices: marquee select (default) or camera orbit. */
  setTouchDragMode(mode: TouchDragMode) {
    this.touchDragMode = mode;
  }

  getTouchDragMode() {
    return this.touchDragMode;
  }

  getDragMode() {
    return this.dragMode;
  }

  /** Cancel the pending tap for the current gesture (used after a long-press fires). */
  cancelTap() {
    this.suppressClick = true;
  }

  /** Returns true if this pointerdown should also fire a game click (short tap). */
  onPointerDown(ev: PointerEvent) {
    if (this.fpsLive) return false;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, ox: ev.clientX, oy: ev.clientY });
    this.pointerType = ev.pointerType;

    if (this.pointers.size === 2) {
      // Second finger: whatever was happening becomes a two-finger camera gesture
      // (pinch = zoom, drag = pan, twist = orbit).
      this.dragMode = "pinch";
      const pts = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchStartCamDist = this.camDist;
      this.pinchStartAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      this.pinchCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      this.suppressClick = true;
      this.dragMoved = true;
      return false;
    }
    if (this.pointers.size > 2) {
      this.suppressClick = true;
      return false;
    }

    this.dragMoved = false;
    this.suppressClick = false;
    this.pointerButton = ev.button;
    this.lastPtr = { x: ev.clientX, y: ev.clientY };

    // Middle-drag or Shift-drag = pan freely across the battlefield.
    // Alt-drag = orbit immediately. Right-click taps order; right-drag orbits.
    if (ev.button === 1 || ev.shiftKey) {
      this.dragMode = "pan";
      this.suppressClick = true;
    } else if (ev.altKey) {
      this.dragMode = "orbit";
      this.suppressClick = true;
    } else {
      this.dragMode = "none"; // promote to select/orbit after move threshold
    }
    try {
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    } catch {
      /* ignore */
    }
    return false;
  }

  onPointerMove(ev: PointerEvent) {
    if (this.fpsLive) return;
    const prev = this.pointers.get(ev.pointerId);
    if (!prev) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, ox: prev.ox, oy: prev.oy });

    if (this.dragMode === "pinch") {
      if (this.pointers.size < 2) return;
      this.camGlide = null;
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const rect = this.canvas.getBoundingClientRect();
      const before = this.groundHitAt(cx - rect.left, cy - rect.top);
      if (this.pinchStartDist > 1) {
        const ratio = this.pinchStartDist / Math.max(1, d);
        this.camDist = THREE.MathUtils.clamp(this.pinchStartCamDist * ratio, this.camDistMin, this.camDistMax);
      }
      // Twist → yaw orbit
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      let dAngle = angle - this.pinchStartAngle;
      if (dAngle > Math.PI) dAngle -= Math.PI * 2;
      if (dAngle < -Math.PI) dAngle += Math.PI * 2;
      if (Math.abs(dAngle) > 0.004) {
        this.camYaw -= dAngle;
        this.pinchStartAngle = angle;
      }
      // Keep the pinch anchor point locked on the map while zooming/twisting
      this.applyCamera();
      if (before) {
        this.camera.updateMatrixWorld();
        const after = this.groundHitAt(cx - rect.left, cy - rect.top);
        if (after) {
          this.camLook.x += before.x - after.x;
          this.camLook.z += before.z - after.z;
          this.clampCamLook();
        }
      }
      // Centroid drift → pan
      const pdx = cx - this.pinchCenter.x;
      const pdy = cy - this.pinchCenter.y;
      this.pinchCenter = { x: cx, y: cy };
      if (Math.abs(pdx) > 0.1 || Math.abs(pdy) > 0.1) this.panBy(pdx, pdy);
      this.applyCamera();
      this.dragMoved = true;
      this.suppressClick = true;
      return;
    }

    const dx = ev.clientX - this.lastPtr.x;
    const dy = ev.clientY - this.lastPtr.y;
    this.lastPtr = { x: ev.clientX, y: ev.clientY };

    if (this.dragMode === "none") {
      const touch = this.pointerType !== "mouse";
      const threshold = touch ? 8 : 2;
      // Total travel from pointerdown — last-frame dx is too small to promote a slow finger drag.
      const travel = Math.hypot(ev.clientX - prev.ox, ev.clientY - prev.oy);
      if (travel <= threshold) return;
      if (touch) {
        this.dragMode = this.touchDragMode === "select" ? "select" : "orbit";
      } else {
        this.dragMode = this.pointerButton === 0 ? "select" : "orbit";
      }
      this.suppressClick = true;
      this.dragMoved = true;
    }

    if (this.dragMode === "orbit") {
      this.orbitBy(dx, dy);
      this.dragMoved = true;
      this.suppressClick = true;
    } else if (this.dragMode === "pan") {
      this.panBy(dx, dy);
      this.dragMoved = true;
      this.suppressClick = true;
    } else if (this.dragMode === "select") {
      this.dragMoved = true;
      this.suppressClick = true;
    }
  }

  /** Returns true if the gesture was a tap and should select/build. */
  onPointerUp(ev: PointerEvent): boolean {
    this.pointers.delete(ev.pointerId);
    const wasTap = !this.suppressClick && !this.dragMoved && this.dragMode === "none";
    if (this.pointers.size < 2 && this.dragMode === "pinch") {
      // Lifting one finger of a pinch must not turn the remaining finger into a select/orbit.
      this.dragMode = "none";
      this.suppressClick = true;
      this.dragMoved = true;
      const rest = this.pointers.values().next().value as { x: number; y: number } | undefined;
      if (rest) this.lastPtr = { x: rest.x, y: rest.y };
    }
    if (this.pointers.size === 0) {
      this.dragMode = "none";
      this.dragMoved = false;
      this.suppressClick = false;
    }
    return wasTap;
  }

  // ---------------------------------------------------------------- quality

  onQuality(cb: ((info: QualityInfo) => void) | null) {
    this.onQualityChange = cb;
    cb?.(this.getQualityInfo());
  }

  getQualityInfo(): QualityInfo {
    return { setting: this.qualitySetting, tier: this.tier, fps: Math.round(this.fpsEstimate) };
  }

  setQuality(setting: QualitySetting) {
    this.qualitySetting = setting;
    try {
      localStorage.setItem(QUALITY_KEY, setting);
    } catch {
      /* ignore */
    }
    this.autoDrops = 0;
    this.frameAccum = 0;
    this.frameCount = 0;
    this.frameSamples = 0;
    this.applyTier(setting === "auto" ? this.detectedTier : setting, true);
  }

  private configureProceduralMaterials() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const mobile = isMobileGpu();
    // Desktop keeps a separate linear bump map. Phones, tablets, and low tier
    // do not: a shared canvas as sRGB map + bump map drops the color pass.
    const bump = !mobile && this.tier !== "low";
    const anisotropy =
      this.tier === "low" ? 1 : this.tier === "medium" || mobile ? Math.min(4, maxAniso) : Math.min(8, maxAniso);
    configureStructureMaterials({
      anisotropy,
      bump,
      canvasSize: mobile || this.tier === "low" ? 256 : 512,
    });
    configureUnitMaterials({ anisotropy, bump });
  }

  private applyTier(tier: QualityTier, notify: boolean) {
    const profile = TIER_PROFILE[tier];
    const prev = this.tier;
    this.tier = tier;
    // Shadow sampling bloats the lit program. Phones skip it so the color pass can link.
    const shadows = profile.shadows && !isMobileGpu();
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.autoUpdate = profile.shadowEvery <= 1;
    if (this.sun.castShadow !== shadows) this.sun.castShadow = shadows;
    if (this.sun.shadow.mapSize.x !== profile.shadowMap) {
      this.sun.shadow.mapSize.set(profile.shadowMap, profile.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.fog = profile.fog ? new THREE.FogExp2(0x8eb4d0, 0.00055) : null;
    this.scene.environment = tier === "low" ? null : this.skyEnv;
    // Point lights are folded into the lit program of every nearby mesh. On a phone
    // that variant fails, which hides keeps, mines, and camps while the road stays up.
    for (const light of this.torchLights) light.visible = profile.pointLights && !isMobileGpu();
    if (this.particles.length > profile.particles) this.particles.length = profile.particles;
    this.configureProceduralMaterials();
    if (prev !== tier) {
      // Shadow/fog toggles need shader recompiles.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
        else m.needsUpdate = true;
      });
    }
    // Filtering only. Albedo maps stay on the shared colormap.
    setSharedAnisotropy(tier === "low" ? 1 : tier === "medium" ? 4 : 8);
    this.resize();
    if (notify) this.onQualityChange?.(this.getQualityInfo());
  }

  /** Rolling frame-time monitor; in Auto mode steps the tier down when the device can't keep up. */
  private sampleFrame(dtMs: number) {
    if (dtMs > 250) return; // tab was hidden / debugger paused
    this.frameSamples++;
    if (this.frameSamples < 30) return; // warm-up (shader compiles, first asset uploads)
    this.frameAccum += dtMs;
    this.frameCount++;
    if (this.frameAccum < 2000) return;
    const avg = this.frameAccum / this.frameCount;
    this.fpsEstimate = 1000 / Math.max(1, avg);
    this.frameAccum = 0;
    this.frameCount = 0;
    if (this.qualitySetting !== "auto" || this.autoDrops >= 2) return;
    if (avg > 22 && this.tier !== "low") {
      this.autoDrops++;
      this.applyTier(this.tier === "high" ? "medium" : "low", true);
    }
  }

  onWheel(ev: WheelEvent) {
    ev.preventDefault();
    if (this.fpsLive) {
      if (this.trebView) return;
      const step = ev.deltaY > 0 ? 5.4 : -5.4;
      this.pullFpsBy(step);
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const factor = ev.deltaY > 0 ? 1.1 : 0.9;
    this.zoomAtScreen(factor, ev.clientX - rect.left, ev.clientY - rect.top);
  }

  /** Positive delta pulls the camera toward third person (same as scroll-wheel out). */
  pullFpsBy(delta: number) {
    if (!this.fpsLive || this.trebView) return;
    this.fpsPull = THREE.MathUtils.clamp(this.fpsPull + delta, 0, this.fpsMaxPull);
  }

  getFpsPull() {
    return this.fpsPull;
  }

  getFpsMaxPull() {
    return this.fpsMaxPull;
  }

  private allocateParticleBuffers(cap: number) {
    const positions = new Float32Array(cap * 3);
    const colors = new Float32Array(cap * 3);
    this.particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeo.setDrawRange(0, 0);
  }

  private burst(x: number, y: number, h: number, color: number, count: number, speed = 40) {
    const cap = TIER_PROFILE[this.tier].particles;
    // Scale burst density with tier so low-end devices don't pay for bursts they'll clip anyway.
    if (this.tier === "low") count = Math.max(2, Math.round(count * 0.4));
    else if (this.tier === "medium") count = Math.max(3, Math.round(count * 0.7));
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = Math.random() * 0.9 + 0.2;
      const sp = speed * (0.4 + Math.random());
      this.particles.push({
        pos: to3(x, y, h),
        vel: new THREE.Vector3(Math.cos(a) * sp, elev * sp, Math.sin(a) * sp),
        life: 0.35 + Math.random() * 0.45,
        max: 0.8,
        color: c.clone(),
        size: 2 + Math.random() * 3,
      });
    }
    if (this.particles.length > cap) this.particles.splice(0, this.particles.length - cap);
  }

  private shootRock(fromX: number, fromY: number, toX: number, toY: number) {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.35, 0),
      new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.85 }),
    );
    const start = to3(fromX, fromY, 16);
    const end = to3(toX, toY, 6);
    mesh.position.copy(start);
    this.dynamicRoot.add(mesh);
    this.arrows.push({ mesh, start, end, life: 0.72, max: 0.72 });
  }

  private shootArrow(fromX: number, fromY: number, toX: number, toY: number, spread: number, startH = 12) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 5.5, 5),
      new THREE.MeshStandardMaterial({ color: 0x6b3d1f, roughness: 0.7 }),
    );
    const start = to3(fromX + spread, fromY, startH);
    const end = to3(toX, toY, 7);
    const direction = end.clone().sub(start).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    mesh.position.copy(start);
    this.dynamicRoot.add(mesh);
    this.arrows.push({ mesh, start, end, life: 0.5, max: 0.5 });
  }

  private syncCombatFx(state: GameState, dt: number) {
    // Unit deaths â€” use cached last positions (syncUnits may already have pruned meshes)
    const live = this.scratchIds;
    live.clear();
    for (const u of state.units) live.add(u.id);
    for (const [id, last] of this.knownUnits) {
      if (!live.has(id)) {
        this.burst(last.x, last.y, 8, last.team === "you" ? 0x88c8ff : 0xff8866, 16, 58);
      }
    }
    this.knownUnits.clear();
    for (const u of state.units) this.knownUnits.set(u.id, { x: u.pos.x, y: u.pos.y, team: u.team });

    for (const event of state.combatEvents) {
      if (this.knownCombatEvents.has(event.id)) continue;
      this.knownCombatEvents.add(event.id);
      const hit = event.target ?? event.pos;
      if (event.kind === "arrow" && event.target) {
        this.shootArrow(event.pos.x, event.pos.y, event.target.x, event.target.y, 0);
      } else if (event.kind === "trebuchet" && event.target) {
        this.shootRock(event.pos.x, event.pos.y, event.target.x, event.target.y);
        this.burst(hit.x, hit.y, 10, 0xe8b66b, 18, 54);
      } else if (event.kind === "sabotage") {
        this.burst(hit.x, hit.y, 8, 0xb48cff, 14, 42);
      } else if (event.kind === "meleeHit") {
        this.burst(hit.x, hit.y, 7, 0xffd48a, 7, 34);
      } else if (event.kind === "ramImpact" || event.kind === "keepImpact") {
        this.burst(hit.x, hit.y, 8, 0xe8b66b, event.kind === "ramImpact" ? 22 : 13, 62);
      } else if (event.kind === "woodHit") {
        this.burst(hit.x, hit.y, 6, 0xa86b32, 9, 42);
      } else if (event.kind === "woodBreak") {
        this.burst(hit.x, hit.y, 7, 0xc48645, 32, 76);
      } else if (event.kind === "buildComplete") {
        this.burst(hit.x, hit.y, 7, 0xffdb7d, 18, 44);
      }
    }

    // Keep hits
    for (const team of ["you", "foe"] as Team[]) {
      const flash = state.keeps[team].hitFlash;
      if (flash > 0 && this.knownKeepFlash[team] <= 0) {
        const k = state.keeps[team];
        this.burst(k.pos.x, k.pos.y, 18, team === "you" ? 0x66aaff : 0xff5577, 22, 70);
      }
      this.knownKeepFlash[team] = flash;

      const keep = state.keeps[team];
      const attack = keep.attackFlash;
      const target = keep.attackTarget;
      if (attack > 0 && this.knownKeepAttack[team] <= 0 && target) {
        const occupants = state.villagers.filter(
          (v) => v.team === team && v.state === "garrisoned",
        ).length;
        const arrows = Math.min(3, Math.max(1, Math.ceil(occupants / 2)));
        for (let i = 0; i < arrows; i++) {
          this.shootArrow(keep.pos.x, keep.pos.y, target.x, target.y, (i - (arrows - 1) / 2) * 3, 25);
        }
      }
      this.knownKeepAttack[team] = attack;
    }

    // Tower / catapult kick
    for (const b of state.buildings) {
      const prev = this.knownKick.get(b.id) ?? 0;
      if (b.animKick > 0 && prev <= 0) {
        const col = b.kind === "catapult" ? 0xffcc66 : 0xaad4ff;
        this.burst(b.pos.x, b.pos.y, 16, col, b.kind === "catapult" ? 18 : 10, 48);
      }
      this.knownKick.set(b.id, b.animKick);
    }

    // Integrate particles (in-place compaction, no per-frame array churn)
    let write = 0;
    const particles = this.particles;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= 60 * dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
      particles[write++] = p;
    }
    particles.length = write;

    let arrowWrite = 0;
    for (let i = 0; i < this.arrows.length; i++) {
      const arrow = this.arrows[i];
      arrow.life -= dt;
      const t = Math.min(1, 1 - arrow.life / arrow.max);
      arrow.mesh.position.lerpVectors(arrow.start, arrow.end, t);
      arrow.mesh.position.y += Math.sin(t * Math.PI) * 18;
      if (arrow.life > 0) {
        this.arrows[arrowWrite++] = arrow;
        continue;
      }
      this.dynamicRoot.remove(arrow.mesh);
      arrow.mesh.geometry.dispose();
      (arrow.mesh.material as THREE.Material).dispose();
    }
    this.arrows.length = arrowWrite;

    const posAttr = this.particleGeo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = this.particleGeo.getAttribute("color") as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;
    const n = Math.min(particles.length, posAttr.count);
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      const fade = Math.max(0, p.life / p.max);
      positions[i * 3] = p.pos.x;
      positions[i * 3 + 1] = p.pos.y;
      positions[i * 3 + 2] = p.pos.z;
      colors[i * 3] = p.color.r * fade;
      colors[i * 3 + 1] = p.color.g * fade;
      colors[i * 3 + 2] = p.color.b * fade;
    }
    this.particleGeo.setDrawRange(0, n);
    this.particlePoints.visible = n > 0;
    if (n > 0) {
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }
  }

  private updateCamera(state: GameState, dt = 0) {
    const body =
      state.possessedId != null ? state.units.find((u) => u.id === state.possessedId && u.hp > 0) : undefined;
    if (body) {
      this.fpsSwing = Math.max(0, this.fpsSwing - dt * 5.4);
      this.fpsHands.visible = false;
      if (!this.fpsLive) this.fpsLive = true;
      if (body.kind === "trebuchet") {
        this.trebView = true;
        if (this.fpsHead) {
          this.fpsHead.visible = true;
          this.fpsHead = null;
        }
        this.applyTrebuchetCamera(body, state.shake);
        return;
      }
      this.trebView = false;
      const nextMax =
        (Math.min(state.possessVisionScore ?? 0, POSSESS_VISION_SCORE) / POSSESS_VISION_SCORE) * POSSESS_PULL_MAX;
      // Kill / vision unlock: snap out to the new third-person range by default.
      if (nextMax > this.fpsMaxPull + 0.01) this.fpsPull = nextMax;
      this.fpsMaxPull = nextMax;
      this.fpsPull = Math.min(this.fpsPull, this.fpsMaxPull);
      const visionT = this.fpsMaxPull > 0.01 ? this.fpsPull / this.fpsMaxPull : 0;
      const fov = THREE.MathUtils.lerp(POSSESS_FOV_TIGHT, POSSESS_FOV_WIDE, visionT);
      if (Math.abs(this.camera.fov - fov) > 0.15 || this.camera.near !== 0.18) {
        this.camera.fov = fov;
        this.camera.near = 0.18;
        this.camera.updateProjectionMatrix();
      }
      const mesh = this.entityMap.get(`unit-${body.id}`);
      this.fpsEye.set(
        body.pos.x - WORLD_W / 2,
        body.kind === "runner" ? 14.2 : 11.2,
        body.pos.y - WORLD_H / 2,
      );
      if (mesh) {
        mesh.updateMatrixWorld(true);
        const head = this.findUnitHead(mesh, body.kind);
        if (this.fpsHead && this.fpsHead !== head) this.fpsHead.visible = true;
        this.fpsHead = head;
        if (head) {
          head.visible = this.fpsPull > 9;
          head.getWorldPosition(this.fpsEye);
          this.fpsEye.y += 0.4;
        }
      }
      this.applyFpsCamera(this.fpsEye, state.shake);
      return;
    }
    if (this.fpsLive) {
      this.fpsLive = false;
      this.trebView = false;
      this.fpsHands.visible = false;
      this.fpsSwing = 0;
      this.fpsPull = 0;
      this.fpsMaxPull = 0;
      if (this.fpsHead) {
        this.fpsHead.visible = true;
        this.fpsHead = null;
      }
      this.camera.near = 5;
      const rect = this.canvas.getBoundingClientRect();
      this.camera.fov = rect.height > rect.width ? 44 : 40;
      this.camera.updateProjectionMatrix();
      this.resetCamera();
      return;
    }
    if (state.shake > 0) {
      this.camShake.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 4);
    } else {
      this.camShake.set(0, 0, 0);
    }
    this.applyCamera();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(TIER_PROFILE[this.tier].dpr, window.devicePixelRatio || 1);
    if (this.renderer.getPixelRatio() !== dpr) this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (!this.fpsLive) this.camera.fov = h > w ? 44 : 40;
    this.camera.updateProjectionMatrix();
    if (!this.fpsLive) this.applyCamera();
  }

  screenToWorld(screenX: number, screenY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = (screenX / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -(screenY / Math.max(1, rect.height)) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    if (!hit) return { x: WORLD_W / 2, y: WORLD_H / 2 };
    return {
      x: hit.x + WORLD_W / 2,
      y: hit.z + WORLD_H / 2,
    };
  }

  /** Project a 2D sim world point (at elevation `height`) into canvas-local CSS pixels, or null if behind camera. */
  private projectWorldPoint(
    worldX: number,
    worldY: number,
    height: number,
    width: number,
    heightPx: number,
    out: { x: number; y: number },
  ): boolean {
    const v = this.tmpV;
    v.set(worldX - WORLD_W / 2, height, worldY - WORLD_H / 2);
    v.applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z >= -this.camera.near || v.z <= -this.camera.far) return false;
    v.applyMatrix4(this.camera.projectionMatrix);
    if (v.z < -1 || v.z > 1) return false;
    out.x = (v.x * 0.5 + 0.5) * width;
    out.y = (-v.y * 0.5 + 0.5) * heightPx;
    return true;
  }

  /** Project a sim world coordinate to canvas-local screen coordinates, or null if behind the camera. */
  worldToScreen(worldX: number, worldY: number, height = 0): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this.camera.updateMatrixWorld();
    const out = { x: 0, y: 0 };
    return this.projectWorldPoint(worldX, worldY, height, rect.width, rect.height, out) ? out : null;
  }

  /**
   * Project every living friendly `fromBarracks` unit to canvas coordinates and return IDs
   * falling inside the screen rectangle `[min(x0,x1), max(x0,x1)] × [min(y0,y1), max(y0,y1)]`.
   */
  pickFriendlyUnitsInScreenRect(
    state: GameState,
    team: Team,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): number[] {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return [];
    this.camera.updateMatrixWorld();
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const pt = { x: 0, y: 0 };
    const ids: number[] = [];

    for (const u of state.units) {
      if (u.team !== team || !u.fromBarracks || u.hp <= 0) continue;
      const bodyH = u.kind === "trebuchet" || u.kind === "rammer" ? 7 : 4.5;
      if (
        this.projectWorldPoint(u.pos.x, u.pos.y, bodyH, rect.width, rect.height, pt) &&
        pt.x >= minX &&
        pt.x <= maxX &&
        pt.y >= minY &&
        pt.y <= maxY
      ) {
        ids.push(u.id);
        continue;
      }
      if (
        this.projectWorldPoint(u.pos.x, u.pos.y, 0.5, rect.width, rect.height, pt) &&
        pt.x >= minX &&
        pt.x <= maxX &&
        pt.y >= minY &&
        pt.y <= maxY
      ) {
        ids.push(u.id);
      }
    }
    return ids;
  }

  /**
   * Return IDs of all living friendly `fromBarracks` units of `kind` currently visible inside
   * the camera viewport `[0..width, 0..height]` (AoE2 double-click selection).
   */
  pickVisibleFriendlyUnitsOfKind(state: GameState, team: Team, kind: UnitKind): number[] {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return [];
    this.camera.updateMatrixWorld();
    const pt = { x: 0, y: 0 };
    const ids: number[] = [];

    for (const u of state.units) {
      if (u.team !== team || !u.fromBarracks || u.hp <= 0 || u.kind !== kind) continue;
      const bodyH = u.kind === "trebuchet" || u.kind === "rammer" ? 7 : 4.5;
      if (
        (this.projectWorldPoint(u.pos.x, u.pos.y, bodyH, rect.width, rect.height, pt) ||
          this.projectWorldPoint(u.pos.x, u.pos.y, 0.5, rect.width, rect.height, pt)) &&
        pt.x >= 0 &&
        pt.x <= rect.width &&
        pt.y >= 0 &&
        pt.y <= rect.height
      ) {
        ids.push(u.id);
      }
    }
    return ids;
  }

  private segmentRayScore(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    baseRadius: number,
    minScreenScale: number,
  ): number | null {
    const ray = this.raycaster.ray;
    this.pickV0.set(x0, y0, z0);
    this.pickV1.set(x1, y1, z1);
    const distSq = ray.distanceSqToSegment(this.pickV0, this.pickV1, this.pickRayPt, this.pickSegPt);
    const camDist = this.pickRayPt.distanceTo(ray.origin);
    if (camDist < this.camera.near) return null;
    const effR = Math.max(baseRadius, camDist * minScreenScale);
    if (distSq > effR * effR) return null;
    return Math.sqrt(distSq) / effR + camDist * 1e-5;
  }

  private setupPickRay(screenX: number, screenY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    this.camera.updateMatrixWorld();
    this.pointer.x = (screenX / rect.width) * 2 - 1;
    this.pointer.y = -(screenY / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return true;
  }

  /** Accurate 3D screen-space picking for living barricades (returns barricade id or null). */
  pickBarricade(state: GameState, screenX: number, screenY: number): number | null {
    if (!this.setupPickRay(screenX, screenY)) return null;
    const hw = WORLD_W / 2;
    const hh = WORLD_H / 2;
    let bestId: number | null = null;
    let bestScore = Infinity;
    for (const bar of state.barricades) {
      if (bar.hp <= 0) continue;
      const wx = bar.pos.x - hw;
      const wz = bar.pos.y - hh;
      const score = this.segmentRayScore(wx - 19, 5.5, wz, wx + 19, 5.5, wz, 9.5, 0.015);
      if (score != null && score < bestScore) {
        bestScore = score;
        bestId = bar.id;
      }
    }
    return bestId;
  }

  private pickEntities(state: GameState, screenX: number, screenY: number, includeBarricades: false): RectHit | null;
  private pickEntities(state: GameState, screenX: number, screenY: number, includeBarricades: true): ScreenPickHit | null;
  private pickEntities(
    state: GameState,
    screenX: number,
    screenY: number,
    includeBarricades: boolean,
  ): ScreenPickHit | null {
    if (!this.setupPickRay(screenX, screenY)) return null;
    const hw = WORLD_W / 2;
    const hh = WORLD_H / 2;
    const hasGround = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpV) !== null;
    const gx = this.tmpV.x + hw;
    const gy = this.tmpV.z + hh;

    // 1. Living units & non-garrisoned villagers (3D capsule test so clicking upper bodies hits accurately).
    let bestMobile: RectHit | null = null;
    let bestMobileScore = Infinity;
    for (const v of state.villagers) {
      if (v.hp <= 0 || v.state === "garrisoned") continue;
      const wx = v.pos.x - hw;
      const wz = v.pos.y - hh;
      const score = this.segmentRayScore(wx, 0, wz, wx, 10, wz, 7.8, 0.014);
      if (score != null && score < bestMobileScore) {
        bestMobileScore = score;
        bestMobile = { kind: "villager", id: String(v.id) };
      }
    }
    for (const u of state.units) {
      if (u.hp <= 0) continue;
      const wx = u.pos.x - hw;
      const wz = u.pos.y - hh;
      const topY = u.kind === "trebuchet" ? 18 : u.kind === "rammer" ? 10 : u.kind === "runner" || u.kind === "templar" ? 13.5 : 11;
      const rad =
        u.kind === "trebuchet"
          ? 18
          : u.kind === "rammer"
            ? 14
            : u.kind === "brute" || u.kind === "templar" || u.kind === "ward"
              ? 10
              : 8;
      const score = this.segmentRayScore(wx, 0, wz, wx, topY, wz, rad, 0.014);
      if (score != null && score < bestMobileScore) {
        bestMobileScore = score;
        bestMobile = { kind: "unit", id: String(u.id) };
      }
    }
    if (bestMobile) return bestMobile;

    // 2. Barricades (horizontal beam test across road).
    if (includeBarricades) {
      let bestBar: ScreenPickHit | null = null;
      let bestBarScore = Infinity;
      for (const bar of state.barricades) {
        if (bar.hp <= 0) continue;
        const wx = bar.pos.x - hw;
        const wz = bar.pos.y - hh;
        const score = this.segmentRayScore(wx - 19, 5.5, wz, wx + 19, 5.5, wz, 9.5, 0.015);
        if (score != null && score < bestBarScore) {
          bestBarScore = score;
          bestBar = { kind: "barricade", id: String(bar.id) };
        }
      }
      if (bestBar) return bestBar;
    }

    // 3. Buildings (friendly & enemy).
    let bestBld: RectHit | null = null;
    let bestBldScore = Infinity;
    for (const b of state.buildings) {
      if (b.hp <= 0) continue;
      const wx = b.pos.x - hw;
      const wz = b.pos.y - hh;
      const topY = b.kind === "watchtower" || b.kind === "church" ? 28 : 20;
      let score = this.segmentRayScore(wx, 0, wz, wx, topY, wz, 21, 0.016);
      if (score == null && hasGround) {
        const d = Math.hypot(gx - b.pos.x, gy - b.pos.y);
        if (d < 26) score = d / 26 + 0.5;
      }
      if (score != null && score < bestBldScore) {
        bestBldScore = score;
        bestBld = { kind: "building", id: String(b.id) };
      }
    }
    if (bestBld) return bestBld;

    // 4. Resource nodes (wins over overlapping pads).
    let bestNode: RectHit | null = null;
    let bestNodeScore = Infinity;
    for (const n of state.nodes) {
      const wx = n.pos.x - hw;
      const wz = n.pos.y - hh;
      let score = this.segmentRayScore(wx, 0, wz, wx, 22, wz, 24, 0.016);
      if (score == null && hasGround) {
        const d = Math.hypot(gx - n.pos.x, gy - n.pos.y);
        if (d < 34) score = d / 34 + 0.5;
      }
      if (score != null && score < bestNodeScore) {
        bestNodeScore = score;
        bestNode = { kind: "node", id: n.id };
      }
    }
    if (bestNode) return bestNode;

    // 5. Unoccupied build pads.
    if (hasGround) {
      const occupied = this.scratchPads;
      occupied.clear();
      for (const b of state.buildings) if (b.padId) occupied.add(b.padId);
      let bestPad: RectHit | null = null;
      let bestPadDist = 26;
      for (const p of state.pads) {
        if (occupied.has(p.id)) continue;
        const d = Math.hypot(gx - p.pos.x, gy - p.pos.y);
        if (d < bestPadDist) {
          bestPadDist = d;
          bestPad = { kind: "pad", id: p.id };
        }
      }
      if (bestPad) return bestPad;
    }

    // 6. Keeps (skipped during Arena courtyard mode).
    if (!state.arena) {
      let bestKeep: RectHit | null = null;
      let bestKeepScore = Infinity;
      for (const team of ["you", "foe"] as Team[]) {
        const k = state.keeps[team];
        if (k.hp <= 0) continue;
        const wx = k.pos.x - hw;
        const wz = k.pos.y - hh;
        let score = this.segmentRayScore(wx, 0, wz, wx, 34, wz, 34, 0.02);
        if (score == null && hasGround) {
          const d = Math.hypot(gx - k.pos.x, gy - k.pos.y);
          if (d < 40) score = d / 40 + 0.5;
        }
        if (score != null && score < bestKeepScore) {
          bestKeepScore = score;
          bestKeep = { kind: "keep", id: team };
        }
      }
      if (bestKeep) return bestKeep;
    }

    return null;
  }

  /** Accurate 3D screen-space entity picking for clicks/orders (returns `RectHit | null`). */
  pickHit(state: GameState, screenX: number, screenY: number): RectHit | null {
    return this.pickEntities(state, screenX, screenY, false);
  }

  /** Accurate 3D screen-space entity picking including barricades (`RectHit | { kind: "barricade"; id: string } | null`). */
  pickTargetAt(state: GameState, screenX: number, screenY: number): ScreenPickHit | null {
    return this.pickEntities(state, screenX, screenY, true);
  }

  draw(state: GameState) {
    const now = performance.now();
    const rawMs = now - this.wallClock;
    const step = Math.min(0.05, Math.max(0.008, rawMs / 1000));
    this.wallClock = now;
    this.sampleFrame(rawMs);

    this.stepCamera(step);
    this.syncScene(state, step);

    const profile = TIER_PROFILE[this.tier];
    if (this.renderer.shadowMap.enabled && profile.shadowEvery > 1) {
      this.shadowFrame = (this.shadowFrame + 1) % profile.shadowEvery;
      if (this.shadowFrame === 0) this.renderer.shadowMap.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }

  private syncScene(state: GameState, step = 0) {
    const arenaNow = !!state.arena;
    if (state.mapId !== this.lastMapId || arenaNow !== this.arenaView) {
      this.arenaView = arenaNow;
      this.rebuildBattlefield(state);
    }
    // FX before prune so deaths still have last-known sim coords
    this.syncCombatFx(state, step);
    if (this.arenaView) this.syncArenaCourtyard(state);
    else this.syncKeeps(state);
    this.syncBuildings(state);
    this.syncPads(state);
    this.syncNodes(state);
    this.syncBarricades(state);
    this.syncStructureDamageRings(state);
    this.syncUnits(state);
    this.syncUnitTacticalViz(state);
    this.syncVillagers(state);
    this.syncCommandViz(state);
    this.updateAnimations(step);
    this.syncSelectionRing(state);
    this.syncFloats(state);
    this.pulseTorches(state.time);
    this.updateCamera(state, step);

    this.sun.intensity = 2.25 + Math.sin(state.time * 0.35) * 0.1;
    this.hemi.intensity = 1.3 + Math.sin(state.time * 0.22) * 0.05;
  }

  /** Mixers near the camera tick every frame; distant ones at half/third rate (accumulated dt). */
  private updateAnimations(step: number) {
    const nearSq = this.tier === "high" ? 520 * 520 : this.tier === "medium" ? 380 * 380 : 260 * 260;
    const farInterval = this.tier === "low" ? 3 : 2;
    const baseInterval = this.tier === "low" ? 2 : 1;
    const cam = this.camera.position;
    for (const animated of this.animationMap.values()) {
      animated.accum += step;
      animated.frame++;
      const p = animated.root.getWorldPosition(this.tmpV);
      const dx = p.x - cam.x;
      const dy = p.y - cam.y;
      const dz = p.z - cam.z;
      const far = dx * dx + dy * dy + dz * dz > nearSq;
      const interval = far ? farInterval : baseInterval;
      if (animated.frame % interval !== 0) continue;
      animated.mixer.update(animated.accum);
      animated.accum = 0;
    }
  }

  private rebuildMapProps(state: GameState) {
    // Drop previous world (avoid disposing shared GLB materials)
    while (this.worldGroup.children.length) {
      this.worldGroup.remove(this.worldGroup.children[0]);
    }
    this.torchLights = [];
    const seed = this.hashMapSeed(state.mapId);
    this.worldGroup.add(buildTerrain(seed));
    this.worldGroup.add(buildScenery(seed));
    const width = mapBounds(seed).width;
    if (width !== this.mapWidth) {
      this.mapWidth = width;
      this.resetCamera();
    }
  }

  private hashMapSeed(mapId: string) {
    const m = /^seed-(\d+)$/.exec(mapId);
    if (m) return Number(m[1]) >>> 0;
    let h = 2166136261;
    for (let i = 0; i < mapId.length; i++) {
      h ^= mapId.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private ensure(key: EntityKey, factory: () => THREE.Object3D) {
    let obj = this.entityMap.get(key);
    if (!obj) {
      obj = factory();
      this.entityMap.set(key, obj);
      this.dynamicRoot.add(obj);
    }
    obj.visible = true;
    return obj;
  }

  private liveSet() {
    this.scratchLive.clear();
    return this.scratchLive;
  }

  private clearAnimation(key: EntityKey) {
    const animated = this.animationMap.get(key);
    if (!animated) return;
    animated.mixer.stopAllAction();
    animated.mixer.uncacheRoot(animated.mixer.getRoot());
    this.animationMap.delete(key);
  }

  private prune(prefix: string, live: Set<string>) {
    for (const [k, obj] of this.entityMap) {
      if (!k.startsWith(prefix)) continue;
      if (!live.has(k)) {
        this.dynamicRoot.remove(obj);
        if (prefix === "cmd-") this.disposeCommandMarkerObject(obj);
        this.clearAnimation(k);
        this.entityMap.delete(k);
      }
    }
  }

  private makeKeep(team: Team) {
    const g = new THREE.Group();
    const keep = buildKeepModel(team);
    // Gate faces the enemy: player keep sits at +z, foe at -z.
    if (team === "you") keep.rotation.y = Math.PI;
    g.add(keep);
    const light = new THREE.PointLight(0xffaa55, 1.6, 110, 2);
    light.position.set(-16, 28, 14);
    light.visible = TIER_PROFILE[this.tier].pointLights && !isMobileGpu();
    g.add(light);
    this.torchLights.push(light);
    const light2 = light.clone();
    light2.position.set(16, 28, 14);
    light2.visible = light.visible;
    g.add(light2);
    this.torchLights.push(light2);
    return g;
  }

  private syncKeeps(state: GameState) {
    const live = this.liveSet();
    for (const team of ["you", "foe"] as Team[]) {
      const key = `keep-${team}`;
      live.add(key);
      const obj = this.ensure(key, () => this.makeKeep(team));
      const k = state.keeps[team];
      setPos3(obj, k.pos.x, k.pos.y, 0);
      if (k.hitFlash > 0) obj.scale.setScalar(1.04);
      else obj.scale.setScalar(1);
    }
    this.prune("keep-", live);
    this.prune("arena-", this.liveSet());
  }

  private syncArenaCourtyard(_state: GameState) {
    const live = this.liveSet();
    const key = "arena-yard";
    live.add(key);
    const obj = this.ensure(key, () => {
      const g = new THREE.Group();
      g.add(buildArenaCourtyardModel("you"));
      return g;
    });
    setPos3(obj, WORLD_W / 2, WORLD_H / 2, 0);
    // Model curtain is ARENA_COURTYARD_W; scale so walls match 2×ARENA_HALF sim span.
    obj.scale.setScalar((ARENA_HALF * 2) / 92);
    this.prune("arena-", live);
    this.prune("keep-", this.liveSet());
  }

  private makeBuilding(kind: Building["kind"], team: Team) {
    if (kind === "watchtower") return buildWatchtowerModel(team);
    if (kind === "ballista") return buildBallistaModel(team);
    if (kind === "catapult") return buildCatapultModel(team);
    if (kind === "house") return buildHouseModel(team);
    if (kind === "church") return buildChurchModel(team);
    return buildBarracksModel(team);
  }

  private syncBuildings(state: GameState) {
    const live = this.liveSet();
    for (const b of state.buildings) {
      const key = `bld-${b.id}`;
      live.add(key);
      let obj = this.entityMap.get(key);
      if (obj && obj.userData.buildingKind !== b.kind) {
        this.dynamicRoot.remove(obj);
        this.entityMap.delete(key);
        obj = undefined;
      }
      if (!obj) {
        obj = this.ensure(key, () => {
          const built = this.makeBuilding(b.kind, b.team);
          built.userData.arm = built.getObjectByName("arm") ?? null;
          built.userData.buildingKind = b.kind;
          return built;
        });
      }
      setPos3(obj, b.pos.x, b.pos.y, 0);
      if (b.kind === "church") {
        let ring = obj.userData.auraRing as THREE.Mesh | undefined;
        if (!ring) {
          ring = new THREE.Mesh(
            new THREE.RingGeometry(CHURCH_AURA_RANGE * 0.92, CHURCH_AURA_RANGE, 48),
            new THREE.MeshBasicMaterial({
              color: 0xe8d080,
              transparent: true,
              opacity: 0.28,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.4;
          obj.add(ring);
          obj.userData.auraRing = ring;
        }
      }
      const silenced = (b.disableTimer ?? 0) > 0;
      let hush = obj.userData.hush as THREE.Mesh | undefined;
      if (!hush) {
        hush = new THREE.Mesh(
          new THREE.RingGeometry(9, 13.5, 22),
          new THREE.MeshBasicMaterial({
            color: 0x2a1020,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        hush.rotation.x = -Math.PI / 2;
        hush.position.y = 0.55;
        obj.add(hush);
        obj.userData.hush = hush;
      }
      hush.visible = silenced;
      obj.scale.setScalar(silenced ? 0.94 : 1);
      if (b.kind === "ballista") {
        for (let i = 0; i < 2; i++) {
          const dog = obj.getObjectByName(`guardDog${i}`);
          if (dog) dog.visible = b.rateRank > i;
        }
      }
      const aimed = state.possessAimBuildingId === b.id;
      let mark = obj.userData.aimMark as THREE.Mesh | undefined;
      if (!mark) {
        mark = new THREE.Mesh(
          new THREE.RingGeometry(16, 22, 36),
          new THREE.MeshBasicMaterial({
            color: 0xffd56a,
            transparent: true,
            opacity: 0.88,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        mark.rotation.x = -Math.PI / 2;
        mark.position.y = 0.85;
        obj.add(mark);
        obj.userData.aimMark = mark;
      }
      mark.visible = aimed;
      if (aimed) {
        const pulse = 1 + Math.sin(state.time * 7) * 0.1;
        mark.scale.setScalar(pulse);
      }
      const arm = obj.userData.arm as THREE.Object3D | null;
      if (arm && b.animKick > 0) arm.rotation.z = -0.8 * (b.animKick / 0.15);
      else if (arm) arm.rotation.z = 0;
    }
    this.prune("bld-", live);
  }

  private padMaterial(zone: string, team: Team) {
    const id = `${zone}-${team}`;
    let mat = this.padMaterials.get(id);
    if (!mat) {
      const color =
        zone === "midEco" ? 0xa56bff : zone === "eco" ? 0xc6f06a : team === "you" ? 0x7fd4ff : 0xff6a78;
      mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.padMaterials.set(id, mat);
    }
    return mat;
  }

  private syncPads(state: GameState) {
    const live = this.liveSet();
    const occupied = this.scratchPads;
    occupied.clear();
    for (const b of state.buildings) if (b.padId) occupied.add(b.padId);
    for (const p of state.pads) {
      if (occupied.has(p.id)) continue;
      const key = `pad-${p.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const inner = p.zone === "eco" || p.zone === "midEco" ? 8.5 : 9.5;
        const outer = p.zone === "eco" || p.zone === "midEco" ? 14.5 : 16;
        const color = this.padMaterial(p.zone, p.team).color;
        const ringMat = this.padMaterial(p.zone, p.team).clone();
        const glowMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        const g = new THREE.Group();
        g.renderOrder = 30;
        const glow = new THREE.Mesh(new THREE.RingGeometry(inner - 2.2, outer + 3, 40), glowMat);
        glow.rotation.x = -Math.PI / 2;
        glow.name = "glow";
        glow.renderOrder = 30;
        const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.name = "ring";
        ring.renderOrder = 31;
        g.add(glow, ring);
        return g;
      });
      setPos3(obj, p.pos.x, p.pos.y, 1.2);
      const pulse = state.buildSelection && p.team === state.commandTeam ? 0.92 + Math.sin(state.time * 5) * 0.08 : 0.82;
      const ecoSel = state.buildSelection === "house";
      const match =
        p.zone === "eco"
          ? ecoSel || !state.buildSelection
          : state.buildSelection !== "house" || !state.buildSelection;
      const ringOp = match ? pulse : 0.55;
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
        if (!mat || mat.opacity == null) return;
        mat.opacity = mesh.name === "glow" ? ringOp * 0.42 : ringOp;
      });
    }
    this.prune("pad-", live);
  }

  private resourceBeacon(label: string, color: number) {
    const g = new THREE.Group();
    g.name = "beacon";
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(11, 14.5, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.8;
    ring.name = "marker";
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 1.1, 28, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    beam.position.y = 16;
    beam.name = "beam";
    g.add(beam);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1a1208";
    ctx.fillRect(8, 8, 240, 48);
    ctx.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 240, 48);
    ctx.fillStyle = "#fff6d8";
    ctx.font = "bold 36px Georgia";
    ctx.textAlign = "center";
    ctx.fillText(label, 128, 44);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }),
    );
    spr.scale.set(22, 5.5, 1);
    spr.position.y = 34;
    spr.name = "label";
    g.add(spr);
    return g;
  }

  private syncNodes(state: GameState) {
    const live = this.liveSet();
    for (const n of state.nodes) {
      const key = `node-${this.homeSide}-${n.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const g = this.makeNode(n);
        g.userData.canopy = g.getObjectByName("canopy") ?? null;
        g.userData.beam = g.getObjectByName("beam") ?? null;
        g.userData.label = g.getObjectByName("label") ?? null;
        g.userData.marker = g.getObjectByName("marker") ?? null;
        return g;
      });
      setPos3(obj, n.pos.x, n.pos.y, 0);
      const alive = n.loadsLeft > 0;
      const canopy = obj.userData.canopy as THREE.Object3D | null;
      if (canopy) canopy.visible = alive;
      const beam = obj.userData.beam as THREE.Object3D | null;
      if (beam) beam.visible = alive;
      const label = obj.userData.label as THREE.Object3D | null;
      if (label) label.visible = alive;
      const marker = obj.userData.marker as THREE.Mesh | null;
      if (marker?.material instanceof THREE.MeshBasicMaterial) {
        marker.material.opacity = alive ? 0.55 + Math.sin(state.time * 4 + n.pos.x) * 0.3 : 0.12;
      }
    }
    this.prune("node-", live);
  }

  private makeNode(n: GameState["nodes"][number]) {
    const own = n.team === this.homeSide;
    const g = new THREE.Group();
    if (n.kind === "pine") {
      // Bright oak + log pile = wood. Scenery pines never look like this.
      const canopy = buildTree("oak", n.pos.x + n.pos.y, 30);
      canopy.name = "canopy";
      g.add(canopy);
      const logs = cloneModel("kLogs", 7);
      if (logs) {
        logs.position.set(6, 0, 4);
        logs.name = "logs";
        g.add(logs);
      }
      g.add(
        this.resourceBeacon(own ? "WOOD" : "RAID WOOD", own ? 0xf0c040 : 0xff704f),
      );
    } else {
      const rocks = new THREE.Group();
      rocks.name = "canopy";
      rocks.add(buildGoldMine());
      g.add(rocks);
      g.add(
        this.resourceBeacon(own ? "GOLD" : "RAID GOLD", own ? 0x4aa0ff : 0xff704f),
      );
    }
    return g;
  }

  private makeBarricade(barricade: Barricade) {
    const group = new THREE.Group();
    const timber = new THREE.MeshStandardMaterial({
      color: barricade.team === "you" ? 0x74451f : 0x71302a,
      roughness: 0.9,
    });
    const iron = new THREE.MeshStandardMaterial({ color: 0x40372f, roughness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.BoxGeometry(43, 2.7, 3.2), timber);
      log.position.set(0, 2.4 + i * 3.1, 0);
      log.rotation.z = (i - 1) * 0.035;
      log.castShadow = true;
      group.add(log);
    }
    for (const x of [-17, 17]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(2.6, 13, 3.5), timber);
      brace.position.set(x, 5.3, 0);
      brace.rotation.z = x < 0 ? -0.16 : 0.16;
      brace.castShadow = true;
      group.add(brace);
    }
    for (const x of [-20, -10, 0, 10, 20]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(1.1, 7, 5), iron);
      spike.position.set(x, 9.8, 0);
      spike.castShadow = true;
      group.add(spike);
    }
    return group;
  }

  private syncBarricades(state: GameState) {
    const live = this.liveSet();
    for (const barricade of state.barricades) {
      const key = `bar-${barricade.id}`;
      live.add(key);
      const obj = this.ensure(key, () => this.makeBarricade(barricade));
      setPos3(obj, barricade.pos.x, barricade.pos.y, 0);
      const progress = barricade.built
        ? 1
        : Math.max(0.12, barricade.buildProgress / Math.max(0.01, barricade.buildTime));
      obj.scale.set(1, progress, 1);
      obj.visible = true;
      const aimed = state.possessAimBarricadeId === barricade.id;
      let mark = obj.userData.aimMark as THREE.Mesh | undefined;
      if (!mark) {
        mark = new THREE.Mesh(
          new THREE.RingGeometry(10, 15, 28),
          new THREE.MeshBasicMaterial({
            color: 0xffd56a,
            transparent: true,
            opacity: 0.88,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        mark.rotation.x = -Math.PI / 2;
        mark.position.y = 0.7;
        obj.add(mark);
        obj.userData.aimMark = mark;
      }
      mark.visible = aimed;
      if (aimed) {
        const pulse = 1 + Math.sin(state.time * 7) * 0.1;
        mark.scale.setScalar(pulse);
      }
    }
    this.prune("bar-", live);
  }

  private makeUnit(u: Unit) {
    if (u.kind === "spy") return buildPeonModel(u.team === "you" ? "foe" : "you");
    return buildUnitModel(u.kind, u.team);
  }

  /**
   * Mesh yaw matches possess/camera convention: Math.PI - atan2(dx, -dy)
   * so the rig faces the travel (or look) direction and walk cycles stay aligned.
   */
  private faceMesh(obj: THREE.Object3D, x: number, y: number, lockYaw?: number) {
    if (lockYaw != null) {
      obj.rotation.y = Math.PI - lockYaw;
      obj.userData.faceYaw = lockYaw;
      obj.userData.lastFaceX = x;
      obj.userData.lastFaceY = y;
      return;
    }
    const lx = obj.userData.lastFaceX as number | undefined;
    const ly = obj.userData.lastFaceY as number | undefined;
    if (lx != null && ly != null) {
      const dx = x - lx;
      const dy = y - ly;
      if (dx * dx + dy * dy > 0.04) {
        obj.userData.faceYaw = Math.atan2(dx, -dy);
      }
    } else if (obj.userData.faceYaw == null) {
      obj.userData.faceYaw = 0;
    }
    obj.userData.lastFaceX = x;
    obj.userData.lastFaceY = y;
    obj.rotation.y = Math.PI - (obj.userData.faceYaw as number);
  }

  private syncUnits(state: GameState) {
    const live = this.liveSet();
    for (const u of state.units) {
      const key = `unit-${u.id}`;
      live.add(key);
      let obj = this.entityMap.get(key);
      if (obj && obj.userData.unitKind !== u.kind) {
        this.dynamicRoot.remove(obj);
        this.clearAnimation(key);
        this.entityMap.delete(key);
        obj = undefined;
      }
      if (!obj) {
        obj = this.ensure(key, () => {
          const made = this.makeUnit(u);
          made.userData.unitKind = u.kind;
          made.userData.ramBody = made.children.find((child) => child.userData.movingRamBody) ?? null;
          return made;
        });
      }
      setPos3(obj, u.pos.x, u.pos.y, 0);
      obj.visible = true;
      const possessed = state.possessedId === u.id;
      const driven = possessed || u.facing != null;
      this.syncPossessMark(obj, u, driven);
      // Local FPS body → camera yaw; other driven peers → synced facing; else travel.
      const lookYaw = possessed ? this.fpsYaw : u.facing;
      this.faceMesh(obj, u.pos.x, u.pos.y, lookYaw);
      if (!possessed) {
        const head = this.findUnitHead(obj, u.kind);
        if (head) head.visible = true;
      }
      if (u.kind === "rammer") {
        const body = obj.userData.ramBody as THREE.Object3D | null;
        if (body) {
          body.position.y = Math.abs(Math.sin(state.time * 5.5 + u.id)) * 0.35;
          body.rotation.z = Math.sin(state.time * 5.5 + u.id) * 0.012;
        }
      }
      if (u.kind === "trebuchet") {
        animateTrebuchet(obj, {
          phase: u.siegePhase,
          siegeTimer: u.siegeTimer,
          attackTimer: u.attackTimer,
          attackCooldown: u.attackCooldown,
          charge: possessed ? state.possessCharge : 0,
        });
      } else {
        animateUnit(obj, state.time + u.id * 0.37, { x: u.pos.x, y: u.pos.y, timer: u.attackTimer });
      }
    }
    this.prune("unit-", live);
  }

  /** Team ring, screen name, and a thin HP bar while this body is being driven. */
  private syncPossessMark(obj: THREE.Object3D, u: Unit, on: boolean) {
    let plate = obj.userData.possessPlate as THREE.Group | undefined;
    if (!on) {
      if (plate) plate.visible = false;
      return;
    }
    const color = u.team === "you" ? 0x2f6dff : 0xe23b32;
    if (!plate) {
      plate = new THREE.Group();
      plate.name = "possess-plate";
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(6.2, 7.5, 40),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.92,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.35;
      ring.renderOrder = 3;
      const name = new THREE.Sprite(
        new THREE.SpriteMaterial({ transparent: true, depthTest: false }),
      );
      name.position.y = 16.2;
      name.scale.set(16, 4.2, 1);
      name.renderOrder = 6;
      name.center.set(0.5, 0);
      const bar = new THREE.Sprite(
        new THREE.SpriteMaterial({ transparent: true, depthTest: false }),
      );
      bar.position.y = 15.2;
      bar.scale.set(10, 0.7, 1);
      bar.renderOrder = 6;
      bar.center.set(0.5, 1);
      plate.add(ring, name, bar);
      obj.add(plate);
      obj.userData.possessPlate = plate;
      obj.userData.possessName = name;
      obj.userData.possessBar = bar;
      obj.userData.possessNameText = "";
    }
    plate.visible = true;
    const ring = plate.children[0] as THREE.Mesh;
    (ring.material as THREE.MeshBasicMaterial).color.set(color);
    // HP / power live in the top FPS HUD; keep only the ground ring on the mesh.
    const name = obj.userData.possessName as THREE.Sprite | undefined;
    const bar = obj.userData.possessBar as THREE.Sprite | undefined;
    if (name) name.visible = false;
    if (bar) bar.visible = false;
  }

  private syncVillagers(state: GameState) {
    const live = this.liveSet();
    for (const v of state.villagers) {
      if (v.state === "garrisoned") continue;
      const key = `vil-${v.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const g = new THREE.Group();
        g.userData.selection = null;
        const m = buildPeonModel(v.team);
        m.name = "rig";
        g.add(m);
        g.userData.rig = m;
        return g;
      });
      setPos3(obj, v.pos.x, v.pos.y, 0);
      this.faceMesh(obj, v.pos.x, v.pos.y);
      obj.scale.setScalar(v.state === "defend" ? 1.08 : 1);
      let selection = obj.userData.selection as THREE.Mesh | null;
      if (!selection) {
        selection = new THREE.Mesh(
          new THREE.RingGeometry(5.8, 7.1, 28),
          new THREE.MeshBasicMaterial({
            color: 0x79d3ff,
            transparent: true,
            opacity: 0.82,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        selection.name = "peon-selection";
        selection.rotation.x = -Math.PI / 2;
        selection.position.y = 0.25;
        obj.add(selection);
        obj.userData.selection = selection;
      }
      selection.visible = state.selectedVillagerIds.includes(v.id);
      const rig = obj.userData.rig as THREE.Object3D;
      const node = v.targetNodeId ? state.nodes.find((n) => n.id === v.targetNodeId) : undefined;
      setPeonGear(rig, node?.kind === "copper" ? "pick" : "axe", v.carryingGold > 0 ? "gold" : v.carryingWood > 0 ? "wood" : "none");
      animateUnit(rig, state.time + v.id * 0.37, {
        x: v.pos.x,
        y: v.pos.y,
        timer: v.attackTimer,
        fighting: v.state === "defend" && v.attackTimer > -0.35,
        work: v.state === "gathering" || v.state === "buildingBarricade" || v.state === "repairing",
      });
    }
    this.prune("vil-", live);
  }

  private obtainPooledRing(
    pool: THREE.Group[],
    glowMat: THREE.MeshBasicMaterial,
    coreMat: THREE.MeshBasicMaterial,
    glowOrder: number,
    coreOrder: number,
    idx: number,
  ): THREE.Group {
    if (idx < pool.length) return pool[idx]!;
    const g = new THREE.Group();
    const glow = new THREE.Mesh(this.unitRingGlowGeo, glowMat);
    glow.renderOrder = glowOrder;
    const core = new THREE.Mesh(this.unitRingCoreGeo, coreMat);
    core.position.y = 0.04;
    core.renderOrder = coreOrder;
    g.add(glow, core);
    this.tacticalRingRoot.add(g);
    pool.push(g);
    return g;
  }

  private finalizeRingPool(pool: THREE.Group[], usedCount: number) {
    for (let i = usedCount; i < pool.length; i++) {
      pool[i]!.visible = false;
    }
    const maxKeep = Math.max(24, usedCount * 2);
    while (pool.length > maxKeep) {
      const extra = pool.pop()!;
      this.tacticalRingRoot.remove(extra);
    }
  }

  /**
   * Always-visible pooled damage rings around every living damaged structure on both teams:
   * - Yellow ring (`0.45 <= hp / maxHp < 0.999`): slightly damaged
   * - Gently pulsing red ring (`hp / maxHp < 0.45`): critically damaged
   */
  private syncStructureDamageRings(state: GameState) {
    let yellowCount = 0;
    let redCount = 0;

    const critWave = Math.sin(state.time * 4.6);
    const critPulse = 1 + critWave * 0.045;
    this.damageRedCoreMat.opacity = 0.82 + critWave * 0.14;
    this.damageRedGlowMat.opacity = 0.28 + critWave * 0.1;

    const placeDamageRing = (x: number, y: number, elev: number, radius: number, hp: number, maxHp: number) => {
      if (hp <= 0 || maxHp <= 0) return;
      const ratio = hp / maxHp;
      if (ratio >= 0.999) return;
      if (ratio < 0.45) {
        const ring = this.obtainPooledRing(
          this.damageRedRingPool,
          this.damageRedGlowMat,
          this.damageRedCoreMat,
          18,
          19,
          redCount++,
        );
        ring.visible = true;
        setPos3(ring, x, y, elev);
        ring.scale.setScalar(radius * critPulse);
      } else {
        const ring = this.obtainPooledRing(
          this.damageYellowRingPool,
          this.damageYellowGlowMat,
          this.damageYellowCoreMat,
          18,
          19,
          yellowCount++,
        );
        ring.visible = true;
        setPos3(ring, x, y, elev);
        ring.scale.setScalar(radius);
      }
    };

    for (const b of state.buildings) {
      if (b.hp <= 0 || b.hp >= b.maxHp) continue;
      placeDamageRing(b.pos.x, b.pos.y, 0.68, 22, b.hp, b.maxHp);
    }

    for (const bar of state.barricades) {
      if (!bar.built || bar.hp <= 0 || bar.hp >= bar.maxHp) continue;
      placeDamageRing(bar.pos.x, bar.pos.y, 0.68, 17, bar.hp, bar.maxHp);
    }

    if (!state.arena) {
      for (const team of ["you", "foe"] as Team[]) {
        const keep = state.keeps[team];
        if (!keep || keep.hp <= 0 || keep.hp >= keep.maxHp) continue;
        placeDamageRing(keep.pos.x, keep.pos.y, 0.72, 35.5, keep.hp, keep.maxHp);
      }
    }

    this.finalizeRingPool(this.damageYellowRingPool, yellowCount);
    this.finalizeRingPool(this.damageRedRingPool, redCount);
  }

  /**
   * AoE2-style tactical unit visuals (all pooled, zero per-frame geometry/material allocation):
   * 1) Gold/cyan selection rings under units in `state.selectedUnitIds`
   * 2) Pulsing emerald guard rings + dashed green tethers to guarded allies
   * 3) Pulsing crimson target rings under focused enemy units, buildings, barricades, or keep
   */
  private syncUnitTacticalViz(state: GameState) {
    const selectedIds = state.selectedUnitIds;
    if (!selectedIds || selectedIds.length === 0) {
      this.finalizeRingPool(this.unitSelRingPool, 0);
      this.finalizeRingPool(this.guardRingPool, 0);
      this.finalizeRingPool(this.targetRingPool, 0);
      this.guardTetherLines.geometry.setDrawRange(0, 0);
      this.guardTetherLines.visible = false;
      return;
    }

    const selSet = this.scratchSelectedUnitIds;
    selSet.clear();
    for (const id of selectedIds) selSet.add(id);

    const unitById = this.scratchUnitById;
    unitById.clear();
    for (const u of state.units) {
      if (u.hp > 0) unitById.set(u.id, u);
    }

    const guardedIds = this.scratchGuardedIds;
    guardedIds.clear();
    const targetKeys = this.scratchTargetKeys;
    targetKeys.clear();

    const hw = WORLD_W / 2;
    const hh = WORLD_H / 2;
    const guardWave = Math.sin(state.time * 5.2);
    const targetWave = Math.sin(state.time * 7.2);
    const guardPulse = 1 + guardWave * 0.07;
    const targetPulse = 1 + targetWave * 0.08;
    this.guardRingCoreMat.opacity = 0.78 + guardWave * 0.16;
    this.guardRingGlowMat.opacity = 0.24 + guardWave * 0.1;
    this.targetRingCoreMat.opacity = 0.82 + targetWave * 0.14;
    this.targetRingGlowMat.opacity = 0.26 + targetWave * 0.1;

    let selCount = 0;
    let guardCount = 0;
    let targetCount = 0;
    let tetherCount = 0;
    const linePos = this.guardLinePos;
    const lineDist = this.guardLineDist;

    const placeTargetRing = (key: string, x: number, y: number, elev: number, radius: number) => {
      if (targetKeys.has(key)) return;
      targetKeys.add(key);
      const tRing = this.obtainPooledRing(
        this.targetRingPool,
        this.targetRingGlowMat,
        this.targetRingCoreMat,
        25,
        26,
        targetCount++,
      );
      tRing.visible = true;
      setPos3(tRing, x, y, elev);
      tRing.scale.setScalar(radius * targetPulse);
    };

    for (const u of state.units) {
      if (u.hp <= 0 || !selSet.has(u.id)) continue;

      // 1. Selected barracks unit ring
      const selRing = this.obtainPooledRing(
        this.unitSelRingPool,
        this.unitSelGlowMat,
        this.unitSelCoreMat,
        20,
        21,
        selCount++,
      );
      selRing.visible = true;
      setPos3(selRing, u.pos.x, u.pos.y, 0.8);
      selRing.scale.setScalar(unitFootprintRadius(u.kind));

      // 2. Guard ring + dashed emerald tether
      if (u.guardUnitId != null) {
        const allyUnit = unitById.get(u.guardUnitId);
        let guardPos: { x: number; y: number } | null = null;
        let guardKeyId = -1;
        let guardRadius = 7.4;

        if (allyUnit && allyUnit.team === u.team && allyUnit.id !== u.id) {
          guardPos = allyUnit.pos;
          guardKeyId = allyUnit.id;
          guardRadius = unitFootprintRadius(allyUnit.kind);
        } else {
          const allyVil = state.villagers.find(
            (v) => v.id === u.guardUnitId && v.hp > 0 && v.state !== "garrisoned" && v.team === u.team,
          );
          if (allyVil) {
            guardPos = allyVil.pos;
            guardKeyId = -allyVil.id - 1;
            guardRadius = 7.4;
          }
        }

        if (guardPos) {
          if (!guardedIds.has(guardKeyId)) {
            guardedIds.add(guardKeyId);
            const gRing = this.obtainPooledRing(
              this.guardRingPool,
              this.guardRingGlowMat,
              this.guardRingCoreMat,
              23,
              24,
              guardCount++,
            );
            gRing.visible = true;
            setPos3(gRing, guardPos.x, guardPos.y, 0.75);
            gRing.scale.setScalar(guardRadius * 1.22 * guardPulse);
          }
          if (tetherCount < MAX_GUARD_TETHERS) {
            const segLen = Math.hypot(guardPos.x - u.pos.x, guardPos.y - u.pos.y);
            if (segLen > 2) {
              const o = tetherCount * 6;
              linePos[o] = u.pos.x - hw;
              linePos[o + 1] = 1.4;
              linePos[o + 2] = u.pos.y - hh;
              linePos[o + 3] = guardPos.x - hw;
              linePos[o + 4] = 1.4;
              linePos[o + 5] = guardPos.y - hh;
              lineDist[tetherCount * 2] = 0;
              lineDist[tetherCount * 2 + 1] = segLen;
              tetherCount++;
            }
          }
        }
      }

      // 3. Focus-attack crimson target rings
      if (u.orderTargetUnitId != null) {
        const enemy = unitById.get(u.orderTargetUnitId);
        if (enemy) {
          placeTargetRing(`u-${enemy.id}`, enemy.pos.x, enemy.pos.y, 0.82, unitFootprintRadius(enemy.kind) * 1.2);
        }
      }
      if (u.orderTargetBuildingId != null) {
        const bld = state.buildings.find((b) => b.id === u.orderTargetBuildingId && b.hp > 0);
        if (bld) {
          placeTargetRing(`b-${bld.id}`, bld.pos.x, bld.pos.y, 0.88, 21);
        }
      }
      if (u.orderTargetBarricadeId != null) {
        const bar = state.barricades.find((b) => b.id === u.orderTargetBarricadeId && b.hp > 0);
        if (bar) {
          placeTargetRing(`bar-${bar.id}`, bar.pos.x, bar.pos.y, 0.88, 17.5);
        }
      }
      if (u.orderTargetKeep && !state.arena) {
        const enemyTeam: Team = u.team === "you" ? "foe" : "you";
        const keep = state.keeps[enemyTeam];
        if (keep && keep.hp > 0) {
          placeTargetRing(`k-${enemyTeam}`, keep.pos.x, keep.pos.y, 0.92, 34);
        }
      }
    }

    this.finalizeRingPool(this.unitSelRingPool, selCount);
    this.finalizeRingPool(this.guardRingPool, guardCount);
    this.finalizeRingPool(this.targetRingPool, targetCount);

    this.guardTetherLines.geometry.setDrawRange(0, tetherCount * 2);
    this.guardTetherLines.visible = tetherCount > 0;
    if (tetherCount > 0) {
      (this.guardTetherLines.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (this.guardTetherLines.geometry.getAttribute("lineDistance") as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private syncCommandViz(state: GameState) {
    // Peon order lines → pooled LineSegments, written in place.
    const pos = this.commandLinePos;
    const col = this.commandLineCol;
    let seg = 0;
    const hw = WORLD_W / 2;
    const hh = WORLD_H / 2;
    if (state.selectedVillagerIds.length > 0) {
      for (const v of state.villagers) {
        if (seg >= MAX_COMMAND_LINES) break;
        if (!state.selectedVillagerIds.includes(v.id)) continue;
        let target = v.moveTarget;
        if (v.state === "patrolling") target = v.patrolToB ? v.patrolB : v.patrolA;
        else if (v.state === "defend" && v.moveTarget && !v.forcedAttack) target = v.moveTarget;
        else if (v.targetBarricadeId) target = state.barricades.find((b) => b.id === v.targetBarricadeId)?.pos;
        else if (v.targetNodeId) target = state.nodes.find((n) => n.id === v.targetNodeId)?.pos;
        else if (v.targetEnemyId) {
          target =
            state.units.find((u) => u.id === v.targetEnemyId)?.pos ??
            state.villagers.find((other) => other.id === v.targetEnemyId)?.pos;
        }
        if (target && Math.hypot(target.x - v.pos.x, target.y - v.pos.y) < 2) target = undefined;
        if (!target) continue;
        const o = seg * 6;
        pos[o] = v.pos.x - hw;
        pos[o + 1] = 0.5;
        pos[o + 2] = v.pos.y - hh;
        pos[o + 3] = target.x - hw;
        pos[o + 4] = 0.5;
        pos[o + 5] = target.y - hh;
        const patrol = v.state === "patrolling";
        const r = patrol ? 0.902 : 0.494;
        const g = patrol ? 0.749 : 0.824;
        const b = patrol ? 0.412 : 1.0;
        col[o] = r;
        col[o + 1] = g;
        col[o + 2] = b;
        col[o + 3] = r;
        col[o + 4] = g;
        col[o + 5] = b;
        seg++;
      }
    }
    this.commandLines.geometry.setDrawRange(0, seg * 2);
    this.commandLines.visible = seg > 0;
    if (seg > 0) {
      (this.commandLines.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (this.commandLines.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    }

    const selectedBarracks = state.selectedBuildingId
      ? state.buildings.find((b) => b.id === state.selectedBuildingId && b.kind === "barracks" && b.rallyPoint)
      : undefined;
    if (selectedBarracks?.rallyPoint) {
      const rp = this.rallyLinePos;
      rp[0] = selectedBarracks.pos.x - hw;
      rp[1] = 1;
      rp[2] = selectedBarracks.pos.y - hh;
      rp[3] = selectedBarracks.rallyPoint.x - hw;
      rp[4] = 1;
      rp[5] = selectedBarracks.rallyPoint.y - hh;
      (this.rallyLine.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      this.rallyLine.computeLineDistances();
      this.rallyLine.visible = true;
    } else {
      this.rallyLine.visible = false;
    }

    const live = this.liveSet();
    for (const marker of state.commandMarkers) {
      const key = `cmd-${marker.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const colors: Record<CommandMarker["kind"], number> = {
          move: 0x72c9ff,
          gather: 0xe6c866,
          attack: 0xff6e67,
          patrol: 0xe4bd67,
          rally: 0xffd475,
          guard: 0x18e8b0,
          repair: 0x7ee898,
        };
        if (marker.kind === "guard") {
          // Expanding emerald/teal outer ring + inner hexagonal shield pulse.
          const g = new THREE.Group();
          const outer = new THREE.Mesh(
            this.cmdGuardOuterGeo,
            new THREE.MeshBasicMaterial({
              color: 0x18e8b0,
              transparent: true,
              opacity: 0.92,
              side: THREE.DoubleSide,
              depthTest: false,
              depthWrite: false,
              toneMapped: false,
            }),
          );
          outer.renderOrder = 27;
          const shield = new THREE.Mesh(
            this.cmdGuardShieldGeo,
            new THREE.MeshBasicMaterial({
              color: 0x66ffe0,
              transparent: true,
              opacity: 0.95,
              side: THREE.DoubleSide,
              depthTest: false,
              depthWrite: false,
              toneMapped: false,
            }),
          );
          shield.position.y = 0.05;
          shield.renderOrder = 28;
          g.add(outer, shield);
          return g;
        }
        const ring = new THREE.Mesh(
          this.cmdRingGeo,
          new THREE.MeshBasicMaterial({
            color: colors[marker.kind],
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        ring.renderOrder = 27;
        return ring;
      });
      setPos3(obj, marker.pos.x, marker.pos.y, 0.85);
      const pulse = 1 + (1.4 - marker.life) * 1.8;
      obj.scale.setScalar(Math.max(0.5, pulse));
      const opacity = Math.max(0, Math.min(1, marker.life / 1.4));
      if (obj instanceof THREE.Mesh) {
        if (obj.material instanceof THREE.MeshBasicMaterial) {
          obj.material.opacity = opacity;
        }
      } else {
        obj.rotation.y = (1.4 - marker.life) * 0.9;
        for (const child of obj.children) {
          const mat = (child as THREE.Mesh).material;
          if (mat instanceof THREE.MeshBasicMaterial) mat.opacity = opacity;
        }
      }
    }
    this.prune("cmd-", live);
  }

  private disposeRangeRings() {
    for (const ring of [this.rangeRing, this.dogRangeRing]) {
      if (!ring) continue;
      this.dynamicRoot.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.rangeRing = null;
    this.dogRangeRing = null;
  }

  private makeRangeRing(radius: number, color: number, opacity: number, band = 2) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(1, radius - band), radius, 64),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    return ring;
  }

  private syncSelectionRing(state: GameState) {
    const b = state.selectedBuildingId ? state.buildings.find((x) => x.id === state.selectedBuildingId) : undefined;
    const kennel = b ? dogRange(b) : 0;
    const wanted = b && b.kind !== "barracks" ? `${b.id}:${b.canRefund ? 1 : 0}:${kennel}` : "";
    if (wanted === this.rangeRingFor) return;
    this.rangeRingFor = wanted;
    this.disposeRangeRings();
    if (!b || b.kind === "barracks") return;
    const range = !b.canRefund && b.kind === "watchtower" ? STARTER_GUARD_RANGE : BUILD_RANGE[b.kind];
    this.rangeRing = this.makeRangeRing(range, 0xf8e0a7, 0.28);
    this.rangeRing.position.copy(to3(b.pos.x, b.pos.y, 0.5));
    this.dynamicRoot.add(this.rangeRing);
    if (kennel > 0) {
      this.dogRangeRing = this.makeRangeRing(kennel, 0xe2bc72, 0.58, 3.6);
      this.dogRangeRing.position.copy(to3(b.pos.x, b.pos.y, 1.55));
      this.dogRangeRing.renderOrder = 32;
      (this.dogRangeRing.material as THREE.MeshBasicMaterial).depthTest = false;
      this.dynamicRoot.add(this.dogRangeRing);
    }
  }

  private syncFloats(state: GameState) {
    for (const f of state.floatingTexts) {
      if (this.floatIdSeen.has(f.id)) continue;
      this.floatIdSeen.add(f.id);
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, 128, 64);
      ctx.font = "bold 28px Georgia";
      ctx.textAlign = "center";
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 64, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(28, 14, 1);
      spr.position.copy(to3(f.pos.x, f.pos.y, 24));
      this.floatRoot.add(spr);
      this.floatSprites.push({ mesh: spr, life: f.life, id: f.id });
    }
    // prune
    const liveIds = new Set(state.floatingTexts.map((f) => f.id));
    this.floatSprites = this.floatSprites.filter((s) => {
      if (!liveIds.has(s.id)) {
        this.floatRoot.remove(s.mesh);
        (s.mesh.material as THREE.SpriteMaterial).map?.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.floatIdSeen.delete(s.id);
        return false;
      }
      const ft = state.floatingTexts.find((f) => f.id === s.id)!;
      setPos3(s.mesh, ft.pos.x, ft.pos.y, 24 + ft.rise);
      (s.mesh.material as THREE.SpriteMaterial).opacity = Math.min(1, ft.life);
      return true;
    });
  }

  private pulseTorches(time: number) {
    for (const L of this.torchLights) {
      L.intensity = 0.9 + Math.sin(time * 10 + L.id) * 0.35;
    }
  }

  dispose() {
    this.disposeRangeRings();
    for (const [k, obj] of this.entityMap) {
      if (k.startsWith("cmd-")) this.disposeCommandMarkerObject(obj);
    }
    this.commandLines.geometry.dispose();
    (this.commandLines.material as THREE.Material).dispose();
    this.rallyLine.geometry.dispose();
    (this.rallyLine.material as THREE.Material).dispose();
    this.guardTetherLines.geometry.dispose();
    (this.guardTetherLines.material as THREE.Material).dispose();
    this.unitRingGlowGeo.dispose();
    this.unitRingCoreGeo.dispose();
    this.unitSelGlowMat.dispose();
    this.unitSelCoreMat.dispose();
    this.guardRingGlowMat.dispose();
    this.guardRingCoreMat.dispose();
    this.targetRingGlowMat.dispose();
    this.targetRingCoreMat.dispose();
    this.damageYellowGlowMat.dispose();
    this.damageYellowCoreMat.dispose();
    this.damageRedGlowMat.dispose();
    this.damageRedCoreMat.dispose();
    this.cmdRingGeo.dispose();
    this.cmdGuardOuterGeo.dispose();
    this.cmdGuardShieldGeo.dispose();
    this.skyEnv?.dispose();
    this.renderer.dispose();
  }
}
