# Levy — Weapon: Pitchfork

**Status:** Baseline v1 · **Depends on:** levy-rig-spec.md (`Hand_R`, `Weapon_R`) · **Used by:** levy-animation-guidelines.md

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
| `Grip_L` empty | +0.55 m along Y (front hand) |
| `Tip` empty | Center tine tip — trails and hit VFX |
| `Butt` empty | Shaft end — block-push FX |

Material: shares the body atlas and material (see levy-materials-textures.md).

## Runtime

After `mixer.update`, run two-bone IK on the left arm to `Grip_L` world position (LOD0 only) so the off-hand stays on the shaft under additive hit reactions and springs. Reuse the existing `solveArm` in `src/game/models/unitKit.ts`.
