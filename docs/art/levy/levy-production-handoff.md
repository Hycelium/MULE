# Levy — Production Handoff (v1 in-game)

**Status:** Baseline v1 · **Depends on:** levy-art-direction.md, levy-topology-budgets.md, levy-materials-textures.md, levy-rig-spec.md, levy-weapon.md, levy-animation-guidelines.md · **Used by:** modeler, texture artist, rigger, engine integration

## 1. Build checklist

| # | Step | Tool | Spec |
|---|---|---|---|
| 1 | Block-out at 1 m units, A-pose, feet at origin, facing −Y (Blender) | Blender 4.x | topology §1–2 |
| 2 | Low-poly per part (`LP_Levy_<Part>`) to the LOD0 budget, then join into `SM_Levy_Body_LOD0` | Blender | topology §3 |
| 3 | Delete hidden geometry; check clearances | Blender | topology §4 |
| 4 | UVs to the atlas rects, 8 px padding, mirrored parts offset +1 U for the bake | Blender (UV Packmaster optional) | materials §3 |
| 5 | High-poly sculpt (`HP_Levy_<Part>`), forms ≥ 2 cm only | ZBrush or Blender Sculpt | topology §7 |
| 6 | Bake by group at 2048, 16-bit, MikkTSpace, OpenGL +Y | Substance Painter | materials §4 |
| 7 | Paint layer stacks; BaseColor alpha = team mask; export 1024 BaseColor / 1024 Normal / 512 ORM | Substance Painter | materials §6, §9, §11 |
| 8 | Pitchfork `SM_Levy_Pitchfork_LOD0` + empties `Grip_L` / `Tip` / `Butt` | Blender | weapon |
| 9 | Armature `Levy_Rig` (61 bones + `Weapon_R`), skin to ≤ 4 influences, prune < 0.05 | Blender | rig §1, §5 |
| 10 | Shape keys `Skirt_StrideOpen`, `Skirt_KneeRaise_L/_R` | Blender | rig §6 |
| 11 | LOD1 / LOD2 by edge-loop removal; Data Transfer weights | Blender | topology §5 |
| 12 | First-pass clips: `Idle_Guard`, `Walk_Carry`, `Thrust_High`, `Death_Back` (rest of clip list later) | Blender | animation clip list, timing chart |
| 13 | Export + compress (section 2) | Blender, gltfpack | — |

## 2. Export settings

**Blender glTF exporter:** Format **glTF Separate (.gltf + .bin + textures)** · +Y Up · Apply Modifiers · UVs, Normals, Tangents on · Vertex colors off · Materials Export, Images **Automatic** · Skinning on, Include all bone influences off · Shape Keys on (+ normals) · Deformation Bones Only on (`Root`, `Weapon_R` keep Deform on, no weights) · Animation: Actions, sampling 30 fps, Always Sample off, Optimize (drop constant) on · Selected objects only: `Levy_Rig` and children.

**Compress:**

```
gltfpack -i levy_src.gltf -o public/models/levy/levy.glb -cc -kn -km -af 30
```

- `-cc` meshopt compression; `-kn` keep named nodes (sockets, LODs); `-km` keep material names; no `-te` (textures stay external).
- Do not run `-si` (simplify) or `-ac`.

**Files (`public/models/levy/`):** `levy.glb`, `T_Levy_BaseColor.webp`, `T_Levy_Normal.png`, `T_Levy_ORM.webp`, `levy.anim.json`.

**Names:** `Levy_Rig`, `SM_Levy_Body_LOD0/1/2`, `Levy_Pitchfork`, `SM_Levy_Pitchfork_LOD0/1/2`, `M_Levy`, `Grip_L`, `Tip`, `Butt`.

## 3. Three.js integration notes (`src/game/assets3d.ts`)

- Add `ModelKey` `"levy"` → `asset("models/levy/levy.glb")`. The loader already sets `MeshoptDecoder`.
- `cloneAnimatedModel`: route `levy` through `SkeletonUtils.clone` + `updateMatrixWorld(true)` (today only `horse` does).
- `prep()`: skip the roughness / metalness / envMapIntensity overrides and `skinWithColormap` for `levy`.
- Scale: do not use `fitModel` on the whole object (pitchfork skews it). Scale by `1 / 0.13944 ≈ 7.172` so it matches the procedural Levy, or fit on `SM_Levy_Body_LOD0` only.
- Show `*_LOD0` meshes, hide LOD1/2 for v1.
- Team tint: clone `M_Levy` per team, `onBeforeCompile` per materials §7, `customProgramCacheKey` → `"levy-team"`.
- Animation: one `AnimationMixer` per clone; `mixer.clipAction(THREE.AnimationClip.findByName(clips, "Thrust_High"))`. Attack `timeScale` ≈ 0.92 so frame 9 lands on the sim hit (animation guidelines, sim sync).
- Left-hand IK, springs, and morph drivers are not needed for v1.

## 4. Acceptance (v1 in-game)

- [ ] `levy.glb` loads with no console warnings; textures load from external files.
- [ ] Side by side with the procedural Levy: same height (±2%), feet on the ground, faces the move direction.
- [ ] Sleeves show `TEAM_CLOTH` blue/red; both teams share one shader program.
- [ ] Idle, walk, and attack play; contact lands on the hit; death plays once and holds.
- [ ] Pitchfork stays in hand with the tines horizontal during the thrust.
- [ ] No skirt/thigh or sleeve/torso clipping in walk or thrust at game camera distance.
- [ ] 2 draw calls per Levy; a full Levy wave stays within 10% of the procedural Levy's frame time.
- [ ] LOD0 tris within ±5% of 5,100 body / 350 weapon.
