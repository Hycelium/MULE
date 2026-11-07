# Levy — Asset Package Index

**Unit:** Levy (peasant conscript, turban, olive tunic, pitchfork)
**Status:** Spec baseline v1 — documented, not yet implemented
**Last updated:** 2026-11-06

## Documents

| File | Covers |
|---|---|
| [levy-art-direction.md](levy-art-direction.md) | Identity, silhouette, value structure, palette, stylization rules |
| [levy-topology-budgets.md](levy-topology-budgets.md) | Production modeling brief: proportions (m), bind pose, part naming, tri budgets, edge flow, LOD chain, bake source, export checklist, acceptance criteria |
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

### Conflicts from the modeling brief (v2) — need a decision

Measured against the current in-game Levy at 0.13944 m per game unit. The brief currently follows the docs, not the game.

1. **Turban height:** locked 1.85 m top vs 1.772 m in-game; the wrap stack grows ~8 cm (visible silhouette change).
2. **Shoes / leg wraps:** in-game boots reach mid-shin (0.30 m) with a thin wrap band; the docs imply low shoes with wraps 0.12–0.44 m (much more white on the legs).
3. **Pitchfork grip:** in-game rear grip is 20% from the butt; `levy-weapon.md` says 25%.
4. **Hands / torso:** hands grow to the 1.15× target; the underarm narrows to ≤ 0.40 m so hanging arms stop clipping the chest.
5. **`fitModel` (code):** measures the whole hierarchy including the pitchfork and all LOD meshes; it must fit on the body LOD0 only or scaling and centering will be wrong.
6. **Compression:** the modeling brief forbids Draco/meshopt because the loader has no decoders, but `levy-animation-guidelines.md` tells the animator to quantize with meshopt. Either add `MeshoptDecoder` to the loader or limit export to plain quantization.

## Codebase anchors

- Procedural Levy today: `src/game/models/units.ts` → `levy()`, `pitchfork()`, `STYLES.thrust`
- Attack timing clamp: `units.ts` (`W = min(windup, cd*0.5)`, `R = min(recover, cd*0.4)`)
- Levy stats: `src/game/balance.ts` → `levy` (cooldown 0.65 s)
- Team colors: `src/game/models/materials.ts` → `TEAM_CLOTH` (you `#2F63B8`, foe `#A82A2A`)
- GLB loading / skinned clone: `src/game/assets3d.ts` (`cloneAnimatedModel`, `SkeletonUtils.clone`)
