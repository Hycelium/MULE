# Levy — Weapon: Pitchfork

**Status:** Baseline v2 · **Depends on:** levy-topology-budgets.md (section 6), levy-materials-textures.md · **Used by:** levy-rig-spec.md, levy-animation-guidelines.md

## Decision

Pitchfork, single primary weapon, no swapping.

A spear is marginally easier (single tip, roll-invariant). The pitchfork needs one extra rule — the tine plane is roll-locked horizontal during all attacks and blocks — and is otherwise identical for a thrust-dominant moveset. It preserves the Levy's peasant identity, stays distinct from future spear units, and its wide head reads better at medium distance.

## Dimensions

| Item | Value |
|---|---|
| Overall length | 1.85 m |
| Shaft | 3.2 cm diameter, 8 sides, natural bow 1.5 cm |
| Head width | 20 cm |
| Tines | 3, 30 cm long, ≥ 1.2 cm thick (avoids sub-pixel aliasing) |
| Tris | LOD0 ~350, LOD1 ~120, LOD2 ~40 |

## Attachment

| Element | Placement |
|---|---|
| Mesh origin | Rear (right-hand) grip point, 25% from the butt |
| Local axes | +Y along the shaft toward the tines; tines spread along ±X (tine plane = local XY) |
| Parent | `Weapon_R` socket at `Hand_R` palm center (child in the GLB) |
| `Grip_L` empty | +0.555 m along Y (front hand, center of the 55% grip zone) |
| `Tip` empty | Center tine tip — trails and hit VFX |
| `Butt` empty | Shaft end — block-push FX |

## Key positions (local Y, m)

| Point | Y |
|---|---|
| `Butt` | −0.4625 |
| Rear grip / origin | 0 |
| `Grip_L` | +0.555 |
| Collar | +0.98 to +1.05 |
| Crossbar / tine roots | +1.0875 |
| `Tip` (center tine) | +1.3875 |

## Nodes & meshes

```
Weapon_R (joint)
└─ Levy_Pitchfork (empty, identity transform)
   ├─ SM_Levy_Pitchfork_LOD0 / _LOD1 / _LOD2   (static Mesh, not skinned)
   └─ Grip_L, Tip, Butt                        (empties, +Y along shaft)
```

- Static `Mesh`, 0 skin weights; follows `Weapon_R` by parenting.
- Material `M_Levy` (same instance as body); external textures, no separate texture set.
- UVs: shaft strip atlas rect (976, 0, 48, 1024), vertical, butt at bottom; head rect (752, 832, 224, 192), three unique tines.
- Meshopt: compressed with the body in `levy.glb` (`gltfpack -cc`); keep `Levy_Pitchfork` and empty names (gltfpack `-kn`).
- No collider: hits come from the sim; `Tip` is FX-only.

## Export checklist

- [ ] Transforms applied; origin at rear grip; +Y to tines; tine plane local XY.
- [ ] Tris within ±5% of 350 / 120 / 40.
- [ ] Empties exported as nodes under `Weapon_R`; names exact.
- [ ] Tines ≥ 1.2 cm thick at LOD0; no faces under 2 mm.
- [ ] `levy.glb` loads; pitchfork stays in hand through all clips, tine plane horizontal in attacks and blocks.

## Runtime

After `mixer.update`, run two-bone IK on the left arm to `Grip_L` world position (LOD0 only) so the off-hand stays on the shaft under additive hit reactions and springs. Reuse `solveArm` in `src/game/models/unitKit.ts` through the adapter in levy-rig-spec.md section 9.
- LOD meshes switch with the body LOD (same thresholds); hide inactive LODs, never remove nodes.
- Exclude the pitchfork from `fitModel` bounds (fit on `SM_Levy_Body_LOD0`).
