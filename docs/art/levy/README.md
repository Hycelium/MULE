# Levy — Asset Package Index

**Unit:** Levy (peasant conscript, turban, olive tunic, pitchfork)
**Status:** Spec baseline v1 — documented, not yet implemented
**Last updated:** 2026-11-06

## Documents

| File | Covers |
|---|---|
| [levy-art-direction.md](levy-art-direction.md) | Identity, silhouette, value structure, palette, stylization rules |
| [levy-topology-budgets.md](levy-topology-budgets.md) | Triangle budgets, LOD chain, high-poly bake source, deformation rules |
| [levy-materials-textures.md](levy-materials-textures.md) | UV atlas, texture set, PBR values, team tint, surface/wear, Substance layer stacks |
| [levy-rig-spec.md](levy-rig-spec.md) | Bone hierarchy, control rig, cloth tiers, weighting |
| [levy-weapon.md](levy-weapon.md) | Pitchfork decision, dimensions, sockets, runtime IK |
| [levy-animation-guidelines.md](levy-animation-guidelines.md) | Clip list, timing chart, sim sync, triggers, motion principles, retargeting, runtime integration |

## Locked decisions

| Decision | Value |
|---|---|
| Weapon | Pitchfork, separate mesh under `Weapon_R`, no swapping, tine plane roll-locked horizontal |
| Face | No facial features or bones; veil covers upper lip down |
| Sleeves | Team-tinted at runtime through albedo alpha mask |
| Cloth | Baked chain bones (all) + runtime springs (LOD0, nearest 12) + 3 corrective morphs |
| Attack clip length | 19 frames @ 30 fps, contact frame 9 (fits 0.65 s cooldown) |
| Blocks / dodges | Presentation-only (sim has no defensive states) |
| Delivery | One GLB: SkinnedMesh + pitchfork + all clips; `levy.anim.json` event sidecar |

## Open items

- Texture container: KTX2 (needs Basis transcoder, recommended) vs WebP fallback.
- Whether blocks/dodges become real sim mechanics (would change balance and the sim; out of scope for v1).
- Implementation in code (`src/game/models/units.ts` `levy()`, `src/game/assets3d.ts` loader) not started.

## Codebase anchors

- Procedural Levy today: `src/game/models/units.ts` → `levy()`, `pitchfork()`, `STYLES.thrust`
- Attack timing clamp: `units.ts` (`W = min(windup, cd*0.5)`, `R = min(recover, cd*0.4)`)
- Levy stats: `src/game/balance.ts` → `levy` (cooldown 0.65 s)
- Team colors: `src/game/models/materials.ts` → `TEAM_CLOTH` (you `#2F63B8`, foe `#A82A2A`)
- GLB loading / skinned clone: `src/game/assets3d.ts` (`cloneAnimatedModel`, `SkeletonUtils.clone`)
