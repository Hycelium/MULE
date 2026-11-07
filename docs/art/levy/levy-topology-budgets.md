# Levy — Topology & Poly Budgets (Production Modeling Brief)

**Status:** Baseline v2 · **Depends on:** levy-art-direction.md · **Used by:** levy-rig-spec.md, levy-materials-textures.md, levy-weapon.md

Production modeling brief for the Levy body and pitchfork. Preserve the current procedural silhouette (`src/game/models/units.ts` → `human()`, `wrapHead()`, `levy()`, `pitchfork()`), apply only the changes listed in levy-art-direction.md. **Scale:** 1 unit = 1 m. Height 1.75 m (1.85 m to turban top). Runtime `fitModel` rescales.

## 1. Proportion sheet (meters)

Scale factor: skull top in-game = 12.55 units (head joint 10.6 + head sphere 1.05 + 0.9) → **s = 1.75 / 12.55 = 0.13944 m per in-game unit**. Constants: HIP_Y 6.6, THIGH 3.0, SHIN 2.9, SPINE_Y 0.7, SH_Y 3.0, SH_X 1.5, UA 2.35, FA 2.15, HAND 0.42, NECK_Y 3.3.

| Landmark (Y, soles at 0) | In-game units | Meters | Notes |
|---|---|---|---|
| Ankle (Foot joint) | 0.65 | 0.091 | |
| Shoe top / leg-wrap start | — | 0.12 | New (see section 4 note); in-game boot runs to 0.30 |
| Knee (Calf joint) | 3.55 | 0.495 | |
| Skirt hem (lowest) | 3.90 | 0.544 | 5 cm above knee joint |
| Crotch (inner thigh contact) | ~6.15 | 0.858 | |
| Hip (Thigh joints) | 6.55 | 0.913 | Thigh heads at X ±0.109 |
| Hips bone | 6.60 | 0.920 | |
| Belt center (Spine joint) | 7.30 | 1.018 | Belt 4.7 cm tall: 0.994–1.041 |
| Chest, widest | 9.55 | 1.332 | |
| Shoulder joint | 10.30 | 1.436 | X ±0.209 |
| Neck base (head joint) | 10.60 | 1.478 | |
| Shoulder-roll top | 10.85 | 1.513 | |
| Chin | ~10.81 | 1.507 | Hidden by veil |
| Upper lip (veil top edge, front) | ~11.32 | 1.58 | |
| Turban brow ledge (front) | ~11.71 | 1.633 | Skin brow strip 1.58–1.63 |
| Skull top | 12.55 | 1.750 | Definition of s |
| Turban top | 12.71 | 1.772 → **1.85** | Locked target; stack grows 7.8 cm |

| Dimension | Meters | Dimension | Meters |
|---|---|---|---|
| Shoulder joint spacing | 0.418 | Upper arm (UA) | 0.328 |
| Outer shoulder-roll width | 0.602 | Forearm (FA) | 0.300 |
| Chest width × depth | 0.485 × 0.359 | Wrist → palm center (HAND) | 0.059 |
| Waist at belt, W × D | 0.418 × 0.335 | Thigh / shin | 0.418 / 0.404 |
| Skirt hem W × D | 0.739 × 0.591 | Leg spacing (center to center) | 0.218 |
| Upper sleeve / forearm max diameter | 0.148 / 0.120 | Thigh / calf max diameter | 0.204 / 0.145 |
| Head W × D × chin-to-crown | 0.212 × 0.234 × 0.243 | Turban max width | 0.28 |
| Foot length × width | 0.216 × 0.100 | Heel Z / toe Z | −0.05 / +0.167 |

Stylization multipliers (vs. anatomical reference for a 1.75 m adult):

| Part | Multiplier | Target | In-game today |
|---|---|---|---|
| Head | 1.05× | 0.245 m chin-to-crown | 0.243 m — already correct, keep |
| Hands | 1.15× | Open length 0.22 m, palm width 0.10 m, closed grip envelope 0.125 m | Fist 0.109 m, palm 0.073 m — enlarge |
| Forearms | "slightly thick" | Keep 0.120 m max sleeve diameter | Keep |

## 2. Bind pose

| Item | Value |
|---|---|
| Axes | Y-up, character faces +Z, character's left = +X (glTF). In Blender: Z-up, faces −Y; exporter "+Y Up" converts. |
| Origin | Feet at origin: lowest sole vertex at Y = 0. Hips over (0, 0.920, 0); figure symmetric about X = 0. |
| Arms | A-pose, upper arms 45° below horizontal in the frontal plane. Elbow 15° flex forward. Elbow ≈ (±0.441, 1.204, 0); wrist ≈ (±0.646, 0.999, 0.078). |
| Hands | Palms down, thumbs forward. Mitten fingers 15° curl; thumb 30° abducted. |
| Legs | Vertical, feet parallel at X ±0.109, toes +Z. Knee 5° flex (knee 1.5–2 cm forward of hip–ankle line). |
| Head / spine | Neutral, straight; turban and veil in rest drape. Skirt hangs in rest drape, no wind. |

## 3. Mesh parts and naming

| Object | Contents |
|---|---|
| `Levy_Rig` | Armature (bones per levy-rig-spec.md). Root bone `Root` at origin. |
| `SM_Levy_Body_LOD0/1/2` | Single skinned mesh each; all body parts below merged; one material `M_Levy`; one UV map. |
| `Levy_Pitchfork` | Empty, bone-parented to `Weapon_R`, at the pitchfork origin. Children: `SM_Levy_Pitchfork_LOD0/1/2`, empties `Grip_L`, `Tip`, `Butt`. |
| `LP_Levy_<Part>` | Low-poly working parts (source scene only), joined into `SM_Levy_Body_LOD0` before UV and weighting. |
| `HP_Levy_<Part>` | High-poly sculpt: `Head`, `Turban`, `Veil`, `Tail`, `Tunic`, `Arms`, `Hands`, `Legs`, `Shoes`, `Belt`, `Pitchfork`. |

Merged into the body mesh (separate unwelded shells allowed): head ovoid, turban, veil, turban tail, torso with shoulder rolls, skirt, sleeves and bindings, hands, trousers, leg wraps and wrap tails, shoes, belt, buckle, pouch. Only the pitchfork is separate. Mirrored UV parts (sleeves, trousers/wraps, hands, shoes) are modeled with an X-mirror; seam vertices exactly on X = 0.

### LOD0 budget (triangles)

| Part | Tris | Topology notes |
|---|---|---|
| Head + turban + veil + tail | 700 | Head is a closed ovoid (~120 tris). Turban: 3 wound bands with real overlap ledges (~330). Veil: one shell, 1-loop thickened edge (~170). Tail ~80. |
| Torso / chest panel / shoulder rolls | 900 | 24 sides around. 3 loops per shoulder. Chest rib stripes come from the normal map. |
| Tunic skirt (front split) | 1,100 | 6 vertical columns aligned to skirt chains, 5 rings, 1-loop hem thickness, inner shell on lower 40% only. |
| Arms + sleeves + bindings | 900 | 3 loops per elbow, 2 per wrist. Bindings are raised loops, not separate meshes. Upper arm 12 sides, forearm 10. |
| Hands (mitten + thumb) | 300 | Four fingers as one block with 2 knuckle loops for a curl. |
| Trousers + leg wraps | 700 | 3 loops per knee. Spiral wrap: 4 diagonal loops per shin. Thigh 10 sides, shin 10. |
| Shoes | 250 | |
| Belt, buckle, pouch | 250 | Belt 24 sides × 3 spans (~144), buckle ~30, pouch with flap ~76. |
| **Total** | **≈ 5,100** | Single material, single `SkinnedMesh` |

Pitchfork LOD0: ~350 tris, separate mesh (section 6).

### Joint loops (3 per bend joint; counted across both shells where a joint spans two)

| Joint | Loops | Notes |
|---|---|---|
| Shoulder | 3 + shoulder-roll ring | Roll is a raised ring on the torso; sleeve top tucks 2 cm under it |
| Elbow | 3 | Center loop on the joint; wedge the back side for flex volume |
| Wrist | 2 on sleeve cuff + 1 on hand | Hand tucks 2 cm into cuff |
| Hip (thigh root) | 3 | Under the skirt top band |
| Knee | 3 | Center loop on the joint |
| Ankle | 2 on leg wrap + 1 on shoe collar | |
| Neck | 2 | Fully under veil |
| Spine | 1 per bone (Spine_01, Spine_02, Chest) + 1 at belt | |
| Fingers / thumb | 2 knuckle loops / 2 | |

### Skirt grid (rig chains FL/FR/SL/SR/BL/BR, 3 bones each)

- Columns: 6 groups centered on the chains (FL 30°, SL 90°, BL 150°, mirrored right; 0° = front). Group borders at 0°, 60°, 120°, 180°. Front split at 0° (FL/FR border); back center at 180° (BL/BR border).
- Sub-columns: FL and FR 6 quads wide (morph density); SL, SR, BL, BR 4 wide → 28 segments, open at the split.
- Rings: R0 belt bottom 0.994 m; R1 0.935 m (`_01` heads, 6 cm below belt per rig top-band blend); R2 0.805 (`_02`); R3 0.675 (`_03`); R4 hem 0.544. Vertices of each ring lie at the matching bone heads.
- Spans: R0–R1 2, then 3 per span (center + supports) → 11 spans.
- Split: open from hem to R2 (0.805 m). Split edges are 1-loop thickened with a support loop 1.5 cm in; split top ends in a reinforced quad fan, no triangle poles on the visible face.
- Budget: outer 28 × 11 quads = 616; inner shell (lower 40%) 28 × 4 = 224; hem 56; split edges 44; tear notches and split-top reinforcement ~160 → ~1,100.
- Corrective morph density: `Skirt_StrideOpen` needs the FL/FR inner columns and both split edges from R1 to hem; `Skirt_KneeRaise_L` / `_R` needs the FL (left) / FR (right) groups between R2 and hem. Extra columns live there only; rings stay continuous all the way around.

### Secondary chains

| Element | Bones | Geometry |
|---|---|---|
| Turban tail | `Wrap_Tail_01..03` | Closed flat ribbon from back of the turban, ~0.35 m, 2 quads wide × 9 rows (3 per bone), edge loop at each bone head. Frayed end in texture only. |
| Veil front | `Veil_Front_01..02` | Chin drape from upper lip to mid-chest; 3 rows per bone; drape tucks ≥ 2 cm under the turban at sides and back. |
| Leg-wrap tail | `LegWrap_Tail_L/R` | Strip at the wrap top end, outer calf at ~0.42 m, 8–10 cm, 2 × 3 quads, ~20 tris each. |
| Pouch | `Pouch` | Left hip front (≈ X +0.17, Y 0.93, Z +0.08), ~10 × 12.5 × 7 cm with flap; 1 strap loop blended to `Hips`. |

## 4. Interpenetration and clearance

| Pair | Rule (bind pose unless noted) |
|---|---|
| Skirt ↔ thighs/trousers | ≥ 3 cm from skirt inner surface (inner shell where present) to trousers below R1; ≥ 1 cm inside the top band R0–R1. |
| Sleeve ↔ torso | Underarm torso narrowed to ≤ 0.40 m wide at 1.30 m so a hanging arm (15° abduction) clears by ≥ 0.5 cm. Keep the 0.602 m outer shoulder-roll width. |
| Veil ↔ chest / shoulder rolls | Veil inner ≥ 1 cm off torso, ≥ 1.5 cm over the rolls; lower veil edge rests on the rolls. |
| Veil ↔ face | Top edge 3–5 mm proud of the head ovoid at the upper lip (1.58 m); no gap visible from the front at eye height. |
| Turban ↔ head | Turban outer ≥ 1 cm off the skull; inner faces may intersect the ovoid (both 100% `Head`). Front ledge overhangs the brow strip 1.5 cm. |
| Hands ↔ cuffs, shoes ↔ wraps | Overlap 2 cm; no visible gap at any test pose. |

Head is a closed simple ovoid (~120 tris), no nose, eyes, mouth, brows, or ears; it stays closed as a gap backstop. Veil covers from the upper lip down. Delete hidden geometry: no body under clothing (no torso, arm, or leg skin); trouser surface above the crotch inside the skirt top band; skirt band under the belt beyond 1 loop; shoe interiors; turban band faces fully buried in overlaps; belt faces against the tunic.

Leg wraps run from the shoe top (0.12 m, just above the ankle) to 0.44 m below the knee, per levy-materials-textures.md (mud ankle → 40% of shin). Shoes are low leather shoes with an ankle collar.

## 5. LOD production

Build LOD1 and LOD2 by edge-loop removal from LOD0 (preserves UVs), never by unsupervised decimation. Transfer weights from LOD0 (Data Transfer, nearest face interpolated), then prune and renormalize. All LODs share one skeleton. Check silhouette by overlaying LOD outlines at 120 px and 50 px on-screen height.

| LOD | Body / weapon tris | When | Changes |
|---|---|---|---|
| LOD0 | 5,100 / 350 | > 120 px tall | Full spec |
| LOD1 | 2,200 / 120 | 50–120 px | Skirt inner shell removed, turban bands merged, fingers fused |
| LOD2 | 800 / 40 | < 50 px | Skirt weighted to hips/thighs only (no chains); shaft is a 4-sided prism |

| Part | LOD1 (tris) | LOD2 (tris) |
|---|---|---|
| Head + turban + veil + tail | 320: head 60; bands merged into one dome with ledge loops; tail 1 row per bone | 120: turban single dome; veil weighted rigid to Neck/Chest; tail is a stub on `Head` |
| Torso + rolls | 420: 16 sides; 3 loops per shoulder kept | 160: 10 sides; rolls as 1 loop |
| Skirt | 400: inner shell removed; 20 columns (front groups 4, others 3) × 8 spans; 5 rings and split kept; morphs kept | 120: 12 columns × 4 spans; split welded; no chains; weighted to Hips/Thighs |
| Arms + sleeves | 420: 8 sides; bindings flattened to 1 loop; 3 loops at shoulders and elbows | 140: 6 sides; 1 loop per joint; bindings texture only |
| Hands | 100: fingers fused; thumb nub | 40: mitten block |
| Trousers + wraps | 340: spiral loops removed (texture); 3 loops at knees; wrap tails kept | 120: 6 sides; wrap tails removed |
| Shoes | 120 | 60 |
| Belt, buckle, pouch | 80: buckle merged into belt | 40: pouch merged, weighted to Hips |
| **Total** | **2,200** | **800** |

Springs run at LOD0 only; corrective morphs exist on LOD0 and LOD1; LOD2 has no chains, springs, or morphs.

## 6. Pitchfork

Dimensions (levy-weapon.md): 1.85 m overall, shaft 3.2 cm diameter, 8 sides, natural bow 1.5 cm; head 20 cm wide; 3 tines, 30 cm, ≥ 1.2 cm thick.

| Item | Spec |
|---|---|
| Origin | Rear (right-hand) grip, 25% from the butt |
| Axes | +Y along the shaft toward the tines; tines spread along ±X; tine plane = local XY. Shaft bow lies in the local YZ plane (−Z) so the head stays centered. |
| Butt / tine roots / tips | Y −0.4625 / +1.0875 / +1.3875 |
| Empties | `Grip_L` (0, 0.55, 0); `Tip` center tine tip (0, 1.3875, 0); `Butt` (0, −0.4625, 0). +Y along the shaft. |
| Grip polish zones | Y 0 and +0.555 (25% and 55% of length; matches materials doc) |

| Element | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| Shaft | 8 sides × 7 segments + butt cap ≈ 118 | 6 × 3 + cap ≈ 40 | 4-sided prism ≈ 12 |
| Collar (leather + iron) | 8 × 2 ≈ 32 | 12 | — |
| Crossbar | 6 sides × 5 ≈ 60 | 4 × 3 ≈ 24 | Box ≈ 10 |
| Tines (×3) | 6 sides × 3 + tip ≈ 42 each = 126 | 4 × 2 ≈ 16 each = 48 | Pyramids ≈ 6 each = 18 |
| **Total** | **≈ 336–350** | **≈ 120** | **≈ 40** |

## 7. High-poly bake source

- 1–2M tris total.
- Sculpt only readable forms: folds ≥ 2 cm, wrap overlaps, quilting ridges, hammer facets on tines, shaft grain (2 mm relief).
- Do not sculpt: pores, face, fabric weave, nails.
- Bake groups (exploded or by mesh name `<Group>_low` / `<Group>_high`): Head+Turban+Veil+Tail, Tunic, Arms, Hands, Legs, Shoes, Belt, Pitchfork. Prevents skirt-to-thigh and veil-to-chest ray bleed.

## 8. Deformation rules

- Max 4 influences per vertex (Three.js limit). Prune weights < 0.05, renormalize.
- Quads only in source; triangulate on export. No n-gons.
- Every bend joint gets 3 loops: center plus one each side.
- Export tangents in glTF so mirrored UV islands shade correctly.

## 9. Export checklist (Blender → glTF 2.0 GLB)

- [ ] Scene units Metric, unit scale 1.0; 1 unit = 1 m.
- [ ] All transforms applied on meshes and armature (location 0, rotation 0, scale 1); armature at origin.
- [ ] Format GLB; "+Y Up" on; character faces +Z in the file.
- [ ] Triangulate on export (or Triangulate modifier last, quad method Beauty); no n-gons remain in source.
- [ ] Normals and tangents on; one UV map; vertex colors off.
- [ ] Skinning on; "Include all bone influences" off; weights pruned < 0.05, normalized, ≤ 4 per vertex; no unweighted vertices.
- [ ] Shape keys on with normals: `Skirt_StrideOpen`, `Skirt_KneeRaise_L`, `Skirt_KneeRaise_R` on LOD0 and LOD1 only; Basis matches bind pose.
- [ ] Rest pose = bind pose (section 2); control rig and non-deform helpers excluded.
- [ ] No Draco or meshopt compression (loader in `src/game/assets3d.ts` does not set decoders).
- [ ] Names exactly as section 3; one material `M_Levy`; no stray objects, cameras, or lights.

## 10. Acceptance criteria

- [ ] Tri counts per LOD within ±5% of 5,100 / 2,200 / 800 (body) and 350 / 120 / 40 (weapon); each part within ±10% of its row.
- [ ] Landmark heights within ±1 cm of section 1; turban top 1.85 m; skull 1.75 m.
- [ ] Silhouette overlay vs. current in-game Levy screenshot at medium distance: turban dome, shoulder rolls, flared knee-length skirt, tapered legs, and pitchfork length match; only listed art-direction changes differ.
- [ ] No facial features in geometry or texture; veil covers from upper lip down at all test poses and head turns ±60°.
- [ ] Deformation poses, no skirt/thigh, sleeve/torso, veil/chest, or hand/cuff intersection: lunge (thigh flex 70°, stride open), high thrust (arm above shoulder), sweep (torso twist 45°), block (shaft across chest), knee raise 90° per side with morph at 1.
- [ ] Shoulder, elbow, and knee keep volume at 120° flex (no candy-wrapper at wrists through ±90° forearm twist).
- [ ] Skirt rings sit on chain bone heads; 6 column groups align with FL/FR/SL/SR/BL/BR; split opens cleanly in lunge.
- [ ] LOD transitions at 120 px and 50 px show no silhouette pop; LOD2 skirt follows thighs without chains.
- [ ] Pitchfork: origin at rear grip, +Y to tines, tine plane local XY; `Grip_L`, `Tip`, `Butt` present; left-hand IK reaches `Grip_L` in all test poses.
- [ ] GLB loads via `cloneAnimatedModel` with no console warnings; mirrored islands show no seam in normal map lighting.
