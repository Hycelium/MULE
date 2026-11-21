# Levy — Rig Specification

**Status:** Baseline v1 · **Depends on:** levy-topology-budgets.md · **Used by:** levy-weapon.md, levy-animation-guidelines.md

## Summary

63 deform bones + sockets, glTF export, shared across all LODs. No facial bones. Max 4 influences per vertex.

## Bone hierarchy

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

## Control rig (DCC only, not exported)

- Foot and hand IK with knee and elbow poles.
- Weapon controller with space switch (right hand / chest / world).
- Left-hand IK target constrained to the weapon's `Grip_L` empty.
- COG control above Hips.
- All animation baked to deform bones on export.

## Cloth: three tiers

| Tier | Applies to | Method |
|---|---|---|
| A — Baked cloth | All units, LOD0–LOD1 | Simulate proxy tunic, veil, tail (Blender cloth or Marvelous) on final body animation. Drive chain bones via Damped Track / Copy Rotation to sim vertex groups; bake into each clip. Deterministic, zero runtime cost. |
| B — Runtime springs | LOD0, nearest 12 units | Verlet spring per chain bone, additive on baked rotation, driven by Hips world acceleration. Stiffness 120, damping 12, gravity 0.3. Cone limits: skirt 25°, veil 20°, turban tail 35°, leg-wrap tails and pouch 30°. Front skirt forward clamp derived from thigh pitch (prevents poke-through). |
| C — Corrective morphs | LOD0–LOD1 | `Skirt_StrideOpen` (thigh separation 0° → 0, 70° → 1). `Skirt_KneeRaise_L` / `_R` (thigh flex 45° → 0, 90° → 1). Set `morphTargetInfluences` in JS after the mixer update. |

LOD2: no chains; skirt weighted to Hips/Thighs; springs and morphs off.

## Weighting

- Turban: 100% `Head`.
- Leg wraps: tight-skinned to `Calf_*`; only `LegWrap_Tail_*` moves freely.
- Skirt top band: blend 60% Hips / 40% Thigh down to first chain bone over 6 cm.
- Sleeve bindings: follow `UpperArm_Twist_*`.
- Prune < 0.05, renormalize, max 4 influences.
