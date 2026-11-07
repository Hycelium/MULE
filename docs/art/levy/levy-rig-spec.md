# Levy — Rig Specification (Baseline v2 — production rig brief)

**Status:** Baseline v2 · **Depends on:** levy-topology-budgets.md, levy-weapon.md · **Used by:** levy-animation-guidelines.md, engine integration

One armature `Levy_Rig` shared by `SM_Levy_Body_LOD0/1/2`. glTF export, 1 unit = 1 m, Y-up, character faces +Z, character's left = +X. No facial bones. Max 4 influences per vertex; prune < 0.05 and renormalize. The pitchfork `Levy_Pitchfork` is bone-parented to `Weapon_R`.

## 1. Bone count

v1 said "63 deform bones + sockets". The tree below (names and hierarchy unchanged) actually contains **61 bones + 1 socket**: 60 deform bones, the non-deforming `Root`, and the `Weapon_R` socket. That makes 62 glTF skin joints, plus 3 weapon empties (`Grip_L`, `Tip`, `Butt`; nodes, not joints).

Per-group counts: `Root` 1. Torso and head 6 (`Hips`, `Spine_01`, `Spine_02`, `Chest`, `Neck`, `Head`). Head chains 5 (`Wrap_Tail_01..03`, `Veil_Front_01..02`). Arms 20 (10 per side: `Clavicle`, `UpperArm`, `UpperArm_Twist`, `Forearm`, `Forearm_Twist`, `Hand`, `Fingers_01/02`, `Thumb_01/02`). Legs 8 (`Thigh`, `Calf`, `Foot`, `Toe` per side). Leg-wrap tails 2. Skirt 18 (6 chains × 3). `Pouch` 1. Total **61**, plus `Weapon_R`.

## 2. Hierarchy

```
Root                                   (ground projection; root motion source, stripped in-place)
└─ Hips
   ├─ Spine_01
   │  └─ Spine_02
   │     └─ Chest
   │        ├─ Neck
   │        │  └─ Head                 (rigid turban + face)
   │        │     ├─ Wrap_Tail_01 ─ Wrap_Tail_02 ─ Wrap_Tail_03     (back tail, spring)
   │        │     └─ Veil_Front_01 ─ Veil_Front_02                  (chin drape, spring)
   │        ├─ Clavicle_L
   │        │  └─ UpperArm_L ─┬─ UpperArm_Twist_L
   │        │                 └─ Forearm_L ─┬─ Forearm_Twist_L
   │        │                               └─ Hand_L ─┬─ Fingers_01_L ─ Fingers_02_L
   │        │                                          └─ Thumb_01_L ─ Thumb_02_L
   │        └─ Clavicle_R
   │           └─ UpperArm_R ─┬─ UpperArm_Twist_R
   │                          └─ Forearm_R ─┬─ Forearm_Twist_R
   │                                        └─ Hand_R ─┬─ Fingers_01_R ─ Fingers_02_R
   │                                                   ├─ Thumb_01_R ─ Thumb_02_R
   │                                                   └─ Weapon_R   (socket, non-deforming)
   ├─ Thigh_L ─ Calf_L ─┬─ Foot_L ─ Toe_L
   │                    └─ LegWrap_Tail_L                           (loose wrap end, spring)
   ├─ Thigh_R ─ Calf_R ─┬─ Foot_R ─ Toe_R
   │                    └─ LegWrap_Tail_R
   ├─ Skirt_FL_01..03   Skirt_FR_01..03     (front, either side of the split)
   ├─ Skirt_SL_01..03   Skirt_SR_01..03     (sides)
   ├─ Skirt_BL_01..03   Skirt_BR_01..03     (back)
   └─ Pouch                                  (belt pouch, spring)
```

## 3. Bone table (bind pose = A-pose of levy-topology-budgets.md section 2)

**Orientation (glTF, after "+Y Up" conversion):** +Y runs along the bone, head toward child or tail. +Z is the roll reference, set per group below. +X = Y × Z. Right-side bones come from Blender Symmetrize, which mirrors Y and Z, so a left rotation \((x, y, z, w)\) mirrors to the right as \((x, -y, -z, w)\). Flexion is always an X rotation, so mirrored clips keep the X sign and negate Y and Z.

| Group | +Z (roll reference) | Resulting +X |
|---|---|---|
| `Root`, `Hips`, spine, `Neck`, `Head`, arms (`Clavicle` to `Forearm_Twist`), `Thigh`, `Calf` | World +Z (forward), perpendicular to Y | Spine: world +X; legs: world −X |
| `Hand`, `Fingers_*`, `Thumb_*` | Palm side (≈ world −Y in bind; palms down) | Curl toward palm = +X |
| `Foot`, `Toe` | World +Y (up) | World −X |
| Skirt, veil, wrap tail, leg-wrap tail, `Pouch` | Outward from the body surface | +X swing = flare outward |
| `Weapon_R` | World +Y (up); +Y = world +Z (shaft to tines) | World −X; tine plane (local XY) horizontal |

**Derivation and assumptions.** Heights come from the proportion sheet (hip 0.913, Hips 0.920, belt center 1.018, neck base 1.478, shoulder 1.436 at X ±0.209, knee 0.495, ankle 0.091, elbow and wrist from the A-pose). Spine_02 and Chest are spaced evenly to the 1.30 m underarm line. Twist bones sit at 50% of their segment. `Hand`/`Weapon_R` palm center = wrist + 0.059 m along the forearm. Skirt chain heads sit on rings R1/R2/R3 (0.935/0.805/0.675 m, hem R4 0.544). Columns are at 30°/90°/150° from front, with \(X = r_x \sin\theta\), \(Z = r_z \cos\theta\). Radii interpolate linearly from the waist (0.215 × 0.175 at R1) to the hem (0.370 × 0.296). Finger and thumb heads are estimates (±1 cm), snapped to the knuckle loops. Rows list the left or center bone; `_R` mirrors X. Flags: D = deform, E = exported, C = cloth chain, T = twist.

| Bone | Parent | Head X, Y, Z (m) | Length | Flags |
|---|---|---|---|---|
| `Root` | — | 0, 0, 0 | 0.10 | E (no weights) |
| `Hips` | `Root` | 0, 0.920, 0 | 0.098 | D E |
| `Spine_01` | `Hips` | 0, 1.018, 0 | 0.142 | D E |
| `Spine_02` | `Spine_01` | 0, 1.160, 0 | 0.140 | D E |
| `Chest` | `Spine_02` | 0, 1.300, 0 | 0.178 | D E |
| `Neck` | `Chest` | 0, 1.478, −0.010 | 0.067 | D E |
| `Head` | `Neck` | 0, 1.545, −0.010 | 0.205 (to crown 1.75) | D E |
| `Wrap_Tail_01` | `Head` | 0, 1.620, −0.135 | 0.117 | D E C |
| `Wrap_Tail_02` | `Wrap_Tail_01` | 0, 1.505, −0.150 | 0.116 | D E C |
| `Wrap_Tail_03` | `Wrap_Tail_02` | 0, 1.390, −0.160 | 0.117 (tip 1.273, −0.170) | D E C |
| `Veil_Front_01` | `Head` | 0, 1.560, 0.125 | 0.109 | D E C |
| `Veil_Front_02` | `Veil_Front_01` | 0, 1.455, 0.155 | 0.101 (tip 1.360, 0.190) | D E C |
| `Clavicle_L` / `_R` | `Chest` | 0.030, 1.420, 0.030 | 0.182 | D E |
| `UpperArm_L` / `_R` | `Clavicle` | 0.209, 1.436, 0 | 0.328 | D E |
| `UpperArm_Twist_L` / `_R` | `UpperArm` | 0.325, 1.320, 0 | 0.164 | D E T |
| `Forearm_L` / `_R` | `UpperArm` | 0.441, 1.204, 0 | 0.300 | D E |
| `Forearm_Twist_L` / `_R` | `Forearm` | 0.544, 1.102, 0.039 | 0.150 | D E T |
| `Hand_L` / `_R` | `Forearm` | 0.646, 0.999, 0.078 | 0.100 | D E |
| `Fingers_01_L` / `_R` | `Hand` | 0.714, 0.931, 0.104 | 0.055 | D E |
| `Fingers_02_L` / `_R` | `Fingers_01` | 0.750, 0.893, 0.112 | 0.065 | D E |
| `Thumb_01_L` / `_R` | `Hand` | 0.662, 0.982, 0.108 | 0.045 | D E |
| `Thumb_02_L` / `_R` | `Thumb_01` | 0.680, 0.966, 0.148 | 0.040 | D E |
| `Weapon_R` | `Hand_R` | −0.686, 0.959, 0.093 | 0.05 | E (socket) |
| `Thigh_L` / `_R` | `Hips` | 0.109, 0.913, 0 | 0.418 | D E |
| `Calf_L` / `_R` | `Thigh` | 0.109, 0.495, 0.018 | 0.404 | D E |
| `Foot_L` / `_R` | `Calf` | 0.109, 0.091, 0 | 0.120 | D E |
| `Toe_L` / `_R` | `Foot` | 0.109, 0.025, 0.100 | 0.067 (tip Z 0.167) | D E |
| `LegWrap_Tail_L` / `_R` | `Calf` | 0.178, 0.360, 0 | 0.090 | D E C |
| `Skirt_FL_01` / `FR_01` | `Hips` | 0.108, 0.935, 0.152 | 0.137 | D E C |
| `Skirt_FL_02` / `FR_02` | `_01` | 0.133, 0.805, 0.186 | 0.137 | D E C |
| `Skirt_FL_03` / `FR_03` | `_02` | 0.159, 0.675, 0.221 | 0.138 (hem 0.185, 0.544, 0.256) | D E C |
| `Skirt_SL_01` / `SR_01` | `Hips` | 0.215, 0.935, 0 | 0.140 | D E C |
| `Skirt_SL_02` / `SR_02` | `_01` | 0.266, 0.805, 0 | 0.140 | D E C |
| `Skirt_SL_03` / `SR_03` | `_02` | 0.318, 0.675, 0 | 0.140 (hem 0.370, 0.544, 0) | D E C |
| `Skirt_BL_01` / `BR_01` | `Hips` | 0.108, 0.935, −0.152 | 0.137 | D E C |
| `Skirt_BL_02` / `BR_02` | `_01` | 0.133, 0.805, −0.186 | 0.137 | D E C |
| `Skirt_BL_03` / `BR_03` | `_02` | 0.159, 0.675, −0.221 | 0.138 (hem 0.185, 0.544, −0.256) | D E C |
| `Pouch` (left only) | `Hips` | 0.170, 0.990, 0.120 | 0.120 (down, center ≈ 0.93) | D E C |

Pouch head Z is 0.120, not the topology doc's 0.08, because 0.08 lies inside the waist surface. `Root` and `Weapon_R` keep Blender's Deform checkbox **on** with no vertex groups, so the exporter's deform-only filter keeps them.

## 4. Joint limits (degrees from bind, left side, local axes of section 3)

Limits are the same for animators (Blender Limit Rotation on the controls) and for runtime IK clamping. Sign notes: spine +Z leans to the character's right; head/neck +Y turns left.

| Bone (joint) | X (+ = flexion) | Y (twist) | Z | Runtime use |
|---|---|---|---|---|
| `Spine_01`, `Spine_02`, `Chest` (each) | −15 / +30 | ±20 | ±15 | Sweep 45° twist = 15° each |
| `Neck` | −20 / +30 | ±35 | ±20 | |
| `Head` | −30 / +30 | ±40 | ±20 | Neck + Head ≥ ±60° turn |
| `Clavicle` | −10 / +20 (protract) | 0 | −10 / +30 (elevate) | Not touched by IK |
| `UpperArm` (shoulder) | −50 / +150 (forward) | ±80 | −40 / +135 (raise) | IK: clamp swing to this box |
| `Forearm` (elbow) | −15 / +130 (absolute 0–145; bind is 15°) | 0 | 0 | IK: clamp absolute flex 0–145 |
| `Hand` (wrist) | ±70 | ±90 (split 50% to `Forearm_Twist`) | ±25 | IK: clamp after solve |
| `Fingers_01/02` | −15 / +75 (bind 15° curl) | 0 | 0 | Mitten, no spread |
| `Thumb_01` / `Thumb_02` | −20 / +50 ; −10 / +60 | ±20 ; 0 | ±30 ; 0 | |
| `Thigh` (hip) | −30 / +110 | ±40 | −20 / +45 (abduct) | Morph drivers read this |
| `Calf` (knee, flexion is −X) | −140 / +5 (absolute 0–145) | ±10 | 0 | Foot IK clamp |
| `Foot` (ankle) | −45 / +25 (+ = toes up) | ±20 | ±25 | |
| `Toe` | −30 / +60 (+ = toes up) | 0 | 0 | |
| Cloth chains | Tier B cone around the baked direction: skirt 25, veil 20, tail 35, leg-wrap and pouch 30. Tier A baked swing from bind ≤ skirt 60, veil 45, tail 90, leg-wrap/pouch 60 per bone. | | | |

## 5. Control rig (Blender only, never exported)

Deform names stay exact. Controls are `CTRL_*` and mechanism bones `MCH_*`, with Deform off, in their own bone collections. Widgets are `WGT_*` objects in a hidden collection.

| Control | Function |
|---|---|
| `CTRL_Root` | Drives `Root`; ground projection. Clips are authored in place, so it stays at the origin. |
| `CTRL_COG` | Above `Hips`; parent of all body controls except IK feet and the World-space weapon |
| `CTRL_Hips` | Hip swivel under COG without moving the torso |
| `CTRL_Spine_01`, `CTRL_Spine_02`, `CTRL_Chest`, `CTRL_Neck`, `CTRL_Head` | FK. Head has a rotation space switch (Chest / World). |
| `CTRL_Clavicle_L/R` | FK, limits from section 4 |
| `CTRL_FK_UpperArm/Forearm/Hand_L/R`, `CTRL_IK_Hand_L/R`, `CTRL_Pole_Elbow_L/R` | Arm FK and IK. `IK_FK` float (0 FK, 1 IK) on `CTRL_Settings_Arm_L/R`, with snap FK→IK and IK→FK. Pole sits 0.4 m behind the elbow. |
| `CTRL_Fingers_L/R`, `CTRL_Thumb_L/R` | FK with a `Curl` attribute that drives both finger bones |
| `CTRL_IK_Foot_L/R`, `CTRL_Pole_Knee_L/R` | World-space foot IK. Pole sits 0.5 m ahead of the knee, space Foot / COG / World. FK `CTRL_FK_Thigh/Calf/Foot/Toe`. |
| Foot roll (attributes on `CTRL_IK_Foot`) | `Roll` −30 (heel) … +90 (toe, ball breaks at 30), `Bank` ±30, `Swivel` ±45, `ToeTap` ±40. Pivots: `MCH_Heel` (Z −0.05), `MCH_Ball` (`Toe` head), `MCH_TipToe` (Z +0.167), `MCH_BankIn/Out` (±0.05 X). |
| `CTRL_Weapon` | At the pitchfork origin. `Space` enum Hand_R / Chest / World uses three Child Of constraints with driven influence; snap-on-switch keys the visual transform. In Chest/World, `CTRL_IK_Hand_R` follows `MCH_Grip_R` (child of `CTRL_Weapon`, at the inverse `Weapon_R` offset), so `Weapon_R` stays rigid on `Hand_R`. `RollLock` (0–1, 1 in attacks and blocks) keeps local X horizontal. |
| Left hand to `Grip_L` | `CTRL_IK_Hand_L` has a Child Of to the `Grip_L` empty with a `GripLock` float (default 1 in all clips). When it is 1, the left arm is forced to IK. |
| `CTRL_Skirt_*`, `CTRL_Tail_*`, `CTRL_Veil_*` | Optional FK offsets layered on top of the Tier A bake |

**Bake and strip, per clip:** select every deform bone plus `Weapon_R`, then run Pose › Animation › Bake Action. Use the clip frame range, step 1, Visual Keying on, Bake Data Pose, and a new action named exactly as the clip. Run the Tier A cloth bake into the same action. In Clean Channels, use tolerance 0.001. Delete all scale F-curves and every location F-curve except `Root`/`Hips`. Push the action to an NLA track with the clip name. Export from a copy of the file: remove constraints and `CTRL_`/`MCH_` bones, or rely on "Deformation Bones Only" (they have Deform off).

## 6. Twist bones

`UpperArm_Twist` is a child of `UpperArm`. It takes the negative of 50% of `UpperArm`'s Y twist, so it keeps 50% net in world space (sleeve stays calm at the shoulder). `Forearm_Twist` is a sibling of `Hand`. It takes +50% of `Hand`'s Y twist relative to `Forearm` (pronation spreads across the forearm; `Forearm` itself gets 0). In Blender, set each twist bone's rotation mode to YXZ Euler and drive Y with a Transform Channel variable (Y rotation, mode "Swing and Y Twist", Local Space) × −0.5 or +0.5. The Bake Action in section 5 bakes them as plain rotation keys. At runtime, after left-hand IK, recompute the left twist bones the same way: swing-twist decompose `Hand_L` (or `UpperArm_L`) about local Y, then slerp the twist part by 0.5 (or −0.5).

## 7. Skinning guide

| Region | Weights |
|---|---|
| Head ovoid, turban | 100% `Head`; inner faces may intersect |
| Neck (under veil) | 2 loops: `Chest` 0.5 / `Neck` 0.5, then `Neck` 0.5 / `Head` 0.5 |
| Veil | Tucked top edge 100% `Head`. Lip to `_01` head: `Head` 1→0.4. Crossfade `_01`→`_02` across the middle rows. Bottom row `Veil_Front_02` 0.8 / `Chest` 0.2 so it rests on the rolls. LOD2: rigid `Neck`/`Chest`. |
| Turban tail | Root row `Head` 0.5 / `_01` 0.5. Each bone's 3 rows run 100% at the center, 50/50 at the next bone head. LOD2: stub on `Head`. |
| Torso | Crossfade `Spine_01`→`Spine_02`→`Chest` at the spine loops. Shoulder-roll ring `Clavicle` 0.6 / `Chest` 0.4. |
| Belt, buckle | `Hips` 0.6 / `Spine_01` 0.4, rigid-looking |
| Sleeves | Top third `UpperArm`, lower two thirds `UpperArm_Twist`. Elbow center loop 50/50 with `Forearm`. Upper bindings 100% `UpperArm_Twist`. Forearm crossfades `Forearm`→`Forearm_Twist`; wrist binding and cuff `Forearm_Twist` 0.8 / `Hand` 0.2. |
| Hands (mitten) | Palm 100% `Hand`. Knuckle loops 50/50 `Hand`/`Fingers_01` and `Fingers_01`/`Fingers_02`; tips 100% `Fingers_02`. Thumb the same. No per-finger split. |
| Skirt top band R0–R1 | Locked: at R0, 60% `Hips` / 40% same-side `Thigh`, blending to 100% `_01` at R1 over 6 cm |
| Skirt below R1 | 100% at column center, 50/50 with the neighbour chain at group borders (0°/60°/120°/180°). Ring crossfade between `_01`/`_02`/`_03` at R2/R3. Split edges use only their own side (FL or FR), never across. ≤ 4 influences. LOD2: `Hips` and `Thigh` only. |
| Trousers | `Hips` 0.5 / `Thigh` 0.5 at the crotch. Knee 3 loops `Thigh`/`Calf` 25/50/75. |
| Leg-wrap band | Tight 100% `Calf` (0.30–0.363 m). Tail strip root row `Calf` 0.5 / `LegWrap_Tail` 0.5, rest 100% tail. LOD2: tails removed. |
| Boots | Shaft `Calf`. Ankle crease `Calf` 0.5 / `Foot` 0.5. Toe cap `Toe`, 50/50 at the ball. |
| Pouch | Body 100% `Pouch`. Strap loop 100% `Hips`, blending to `Pouch` over 1 row. LOD2: merged, `Hips`. |

**Test poses** (`TEST_Poses` action, never exported). Each must show no skirt/thigh, sleeve/torso, veil/chest or hand/cuff intersection:

| Pose | Key values |
|---|---|
| Lunge | Front `Thigh` +70 X, rear −25, `Skirt_StrideOpen` = 1 |
| High thrust | Right `UpperArm` raised above the shoulder (+120 Z), elbow straight |
| Sweep | Torso twist 45° (15° per spine bone) |
| Block | Shaft horizontal across the chest, both hands on the shaft |
| Knee raise L / R | `Thigh` +90 X, `Skirt_KneeRaise_L/R` = 1 |
| Volume | Shoulder, elbow, knee at 120° flex; forearm twist ±90° (no candy-wrapper); head turn ±60° (veil stays closed) |

## 8. Cloth tiers

| Tier | Applies to | Locked parameters |
|---|---|---|
| A — Baked chain bones | Every clip, all chain bones, LOD0–LOD1 | Deterministic, zero runtime cost |
| B — Runtime springs | LOD0, nearest 12 units | Stiffness 120, damping 12, gravity 0.3; cones skirt 25°, veil 20°, tail 35°, leg-wrap and pouch 30°; front skirt forward clamp from thigh pitch |
| C — Corrective morphs | LOD0–LOD1 | `Skirt_StrideOpen` thigh separation 0°→0, 70°→1; `Skirt_KneeRaise_L/R` thigh flex 45°→0, 90°→1 |

LOD2 has no chains in its weights, and springs and morphs are off.

**Tier A bake procedure (Blender cloth or Marvelous Designer):**
1. Lock the body animation; add 30 frames of Guard pre-roll (loops: simulate two cycles, keep the second). Proxies: a 28 × 11 skirt grid on the rings, veil sheet, tail ribbon, leg-wrap strips, pouch block. Pin skirt R0–R1, veil top edge, tail root, strip roots and pouch strap, skinned to the body bones.
2. Create one vertex group `SIM_<Bone>_tip` per chain bone at the next bone head (hem for `_03`). Each chain bone gets Damped Track (Y) to it plus Copy Rotation (Y only, Local, from its parent) against roll drift. For Marvelous, import the Alembic cache as the target mesh.
3. Bake Action (Visual Keying) on the chain bones only, into the clip action; remove the constraints and delete the proxies. Clean Channels 0.001; loop clips need first key = last key (blend 4 frames); check the baked swing against section 4.

**Tier B runtime springs** run after the mixer and morphs. Each bone does Verlet in its parent's space, added on top of the baked rotation:

```ts
const K = 120, C = 12, G = 0.3 * 9.81, H = 1 / 60;           // fixed 60 Hz substeps
// once per unit per frame, meters (divide world deltas by the unit root's fitModel scale)
aHips = clampLen((hipsW - 2 * hipsW1 + hipsW2) / (dt * dt), 30);  // reset history on spawn/teleport
for (acc += Math.min(dt, 1 / 30); acc >= H; acc -= H)
  for (const b of chainsRootToTip) {                           // _01 before _02 before _03
    const inv = b.parent.getWorldQuaternion(q).invert();       // world -> parent space
    const tgt = b.position + b.bakedQuat.applyTo(Y * b.len);   // baked tip, parent space
    const f = K * (tgt - b.p) + inv.applyTo(DOWN * G) - inv.applyTo(aHips);
    const v = (b.p - b.pPrev) * (1 - C * H);
    b.pPrev = b.p; b.p = b.p + v + f * H * H;
    const base = normalize(tgt - b.position);
    let dir = coneClamp(base, normalize(b.p - b.position), b.coneDeg);
    if (b.isFrontSkirt) {                                      // FL<->Thigh_L, FR<->Thigh_R
      const t = saturate((thighFlexDeg(b.side) - 15) / 30);
      dir = clampInwardSwing(base, dir, b.outwardAxis, lerp(b.coneDeg, 0, t));
    }
    b.p = b.position + dir * b.len;
    b.quaternion = fromUnitVectors(base, dir) * b.bakedQuat;   // additive on the baked pose
    b.updateMatrixWorld(true);
  }
// gating: only LOD0 units in the nearest-12 set (re-sorted every 0.25 s). On leaving the set, fade offset to 0 over 0.2 s, then reset p = tgt.
```

**Tier C morph drivers** run every frame after `mixer.update`, on the visible LOD0 or LOD1 mesh:

```ts
const dirInHips = (thigh) => Y.applyQuat(inv(Hips.worldQuat) * thigh.worldQuat); // thigh +Y points down
const dL = dirInHips(Thigh_L), dR = dirInHips(Thigh_R);
const sep = deg(dL.angleTo(dR));
const flex = (d) => deg(Math.atan2(d.z, -d.y));                // forward pitch in the Hips sagittal plane
const m = mesh.morphTargetInfluences, i = mesh.morphTargetDictionary;
m[i.Skirt_StrideOpen]  = saturate(sep / 70);
m[i.Skirt_KneeRaise_L] = saturate((flex(dL) - 45) / 45);
m[i.Skirt_KneeRaise_R] = saturate((flex(dR) - 45) / 45);
```

## 9. Three.js runtime notes (r186)

- **Skinning:** `SkinnedMesh` stores bone matrices in a float bone texture, so the uniform bone limit does not apply. 62 joints is fine.
- **Cloning:** one `SkeletonUtils.clone` per instance. This needs unique bone names, which holds. Each instance gets one `AnimationMixer`; `AnimationClip` objects are shared from the template. Call `updateMatrixWorld(true)` before fitting.
- **Sockets:** look them up with `getObjectByName("Weapon_R" | "Grip_L" | "Tip" | "Butt")` once per clone and cache them. Names contain no `.`, `:`, `/` or spaces, so `PropertyBinding` paths stay intact.
- **Pitchfork:** it already ships as a child of `Weapon_R` in the GLB; do not reparent. Toggle `SM_Levy_Pitchfork_LOD0/1/2` in step with the body LOD.
- **Frame order:** mixer → corrective morphs → springs (LOD0) → left-hand IK (LOD0) → twist recompute.
- **Left-hand IK** uses `solveArm` (`src/game/models/unitKit.ts`) with `{shoulder: UpperArm_L, elbow: Forearm_L, wrist: Hand_L, upper: 0.328, fore: 0.300, hand: 0.059}`: target `Grip_L` world position, axis `Grip_L` world +Y, pole in `Clavicle_L` space. `solveArm` expects bones along local −Y, elbow bend −X and identity bind rotations, so solve on three proxy `Object3D`s in that convention and write back `bone.quaternion = proxyLocal * bindOffset`, clamped to section 4.
- **Culling:** set `boundingSphere = new Sphere((0, 0.92, 0), 1.6)` on each body `SkinnedMesh` of the template. That is mesh space in meters, centered on `Hips`, and it scales with `fitModel`. Clones copy it.
- **`fitModel`:** measure `SM_Levy_Body_LOD0` only (soles to turban top 1.772 m), then apply the scale and offset to the clone root. Measuring the whole hierarchy includes the forward-pointing pitchfork and the other LODs.
- **LOD switching:** the three body meshes bind to the same cloned bones. Toggle `.visible` at 120 px and 50 px with ±10% hysteresis. Only the visible mesh updates its bone texture and gets morph influences. Mixer rate follows levy-animation-guidelines.md (LOD0 every frame, LOD1 30 Hz, LOD2 15 Hz).

## 10. Export checklist (Blender → glTF GLB)

- [ ] Export from the copy with constraints and controls stripped. "Deformation Bones Only" on: 60 deform + `Root` + `Weapon_R` = 62 joints. `Root` and `Weapon_R` have Deform on with no weights.
- [ ] `Levy_Pitchfork` and the empties `Grip_L`, `Tip`, `Butt` are exported as nodes under the `Weapon_R` joint.
- [ ] No leaf or `_end` bones (glTF stores heads only). Leaf lengths for springs and IK come from the section 3 table.
- [ ] "Use Rest Position" on. Rest pose = bind pose = section 3. Inverse bind matrices match the A-pose; armature transforms applied.
- [ ] Animation: one NLA track per clip, named exactly as the clip. Always sample at 30 fps. Reset pose between actions.
- [ ] Rotation tracks only, except translation on `Root` and `Hips`. `Root` is in place, so its constant track gets dropped. `Weapon_R` gets rotation only, normally constant.
- [ ] No scale tracks. No morph weight tracks (Tier C is runtime driven). Constant tracks dropped.
- [ ] Shape keys `Skirt_StrideOpen`, `Skirt_KneeRaise_L`, `Skirt_KneeRaise_R` on LOD0 and LOD1 only. "Include all bone influences" off; ≤ 4 influences, pruned < 0.05, normalized.
- [ ] `gltfpack -cc`; names exactly as levy-topology-budgets.md section 3.

## 11. Acceptance criteria

- [ ] The GLB has exactly 62 skin joints with the names and hierarchy of section 2, and no `CTRL_`, `MCH_` or `_end` nodes.
- [ ] Bone heads within ±1 cm of section 3. Axes follow the orientation table. Copy/paste-flipped poses mirror correctly using \((x, -y, -z, w)\).
- [ ] All section 7 test poses pass with no intersection. Volume holds at 120° flex. No candy-wrapper at ±90° forearm twist.
- [ ] Morphs reach 1 at 70° separation and 90° flex, and read 0 in bind and Guard. Springs stay inside their cones. The front skirt never enters the thigh in `Thrust_Low`.
- [ ] Left-hand IK keeps the palm center within 1 cm of `Grip_L` in all combat clips, inside section 4 limits. Tine plane stays horizontal.
- [ ] Clips have no scale tracks, and translation only on `Root`/`Hips`. LOD switches show no pose pop. No frustum culling during lunges.
- [ ] Loads via `cloneAnimatedModel` with no console warnings. `fitModel` on LOD0 gives turban top 1.772 m (×1/0.13944 in game units).
