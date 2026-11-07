# Levy — Asset Package Index

**Unit:** Levy (peasant conscript, turban, olive tunic, pitchfork)
**Status:** Production briefs in progress — topology v2 and materials v2 done; rig, weapon, animation still v1. Not yet implemented.
**Last updated:** 2026-11-06

## Documents

| File | Covers |
|---|---|
| [levy-art-direction.md](levy-art-direction.md) | Identity, silhouette, value structure, palette, stylization rules |
| [levy-topology-budgets.md](levy-topology-budgets.md) | Production modeling brief: proportions (m), bind pose, part naming, tri budgets, edge flow, LOD chain, bake source, export checklist, acceptance criteria |
| [levy-materials-textures.md](levy-materials-textures.md) | Production materials & texture brief: atlas rects and texel density, seams/mirroring, bake spec, team mask, Three.js material setup, value QA, export checklist, acceptance criteria |
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
| Delivery | One GLB: SkinnedMesh + pitchfork + all clips; `levy.anim.json` event sidecar; `gltfpack -cc` meshopt compression (loader sets `MeshoptDecoder`) |
| Height | Skull top 1.75 m, turban top 1.77 m (matches the game); 0.13944 m per game unit |
| Legs | Mid-shin leather boots (to 0.30 m) with a thin white spiral wrap band to 0.363 m (matches the game) |
| Pitchfork grip | Rear hand 25% from the butt (the procedural game model uses 20%; the new asset uses 25%) |
| Sleeve tint | Sleeve albedo `#F0F0F0` × team color, so sleeves match today's `TEAM_CLOTH` blue/red |
| Environment | 64 px sky-gradient PMREM on `scene.environment`, intensity 0.3, medium/high tiers on desktop (`src/game/skyEnvironment.ts`) |
| Textures | Separate files next to the GLB in `public/models/levy/`, referenced by relative URI |
| Palette | The new asset follows the doc palette, not the procedural model's slightly different colors |
| Hands / torso | Hands enlarged to 1.15× (0.125 m grip envelope); underarm narrowed to ≤ 0.40 m so arms don't clip the chest |

## Open items

- Texture container: KTX2 (needs Basis transcoder, recommended) vs WebP fallback.
- Whether blocks/dodges become real sim mechanics (would change balance and the sim; out of scope for v1).
- Implementation in code (`src/game/models/units.ts` `levy()`, `src/game/assets3d.ts` loader) not started.

- `fitModel` in `src/game/assets3d.ts` measures the whole hierarchy (pitchfork and all LOD meshes). When the Levy GLB is integrated it must fit on `SM_Levy_Body_LOD0` only, or scaling and centering will be wrong.
- `prep()` in `src/game/assets3d.ts` would clobber the authored PBR on a `levy` key: it sets `roughness` 0.68 and caps `metalness` at 0.08 (both multiply the ORM maps), forces `envMapIntensity` 0.75, sets anisotropy only on `map` outside the `setSharedAnisotropy` set, and falls back to `skinWithColormap` (UV repaint, DoubleSide) if the map fails to load. The `levy` key must be excluded at integration (see levy-materials-textures.md section 7).

## Codebase anchors

- Procedural Levy today: `src/game/models/units.ts` → `levy()`, `pitchfork()`, `STYLES.thrust`
- Attack timing clamp: `units.ts` (`W = min(windup, cd*0.5)`, `R = min(recover, cd*0.4)`)
- Levy stats: `src/game/balance.ts` → `levy` (cooldown 0.65 s)
- Team colors: `src/game/models/materials.ts` → `TEAM_CLOTH` (you `#2F63B8`, foe `#A82A2A`)
- GLB loading / skinned clone: `src/game/assets3d.ts` (`cloneAnimatedModel`, `SkeletonUtils.clone`)
