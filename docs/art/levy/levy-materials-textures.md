# Levy — Materials, UVs & Textures (Baseline v2 — production materials & texture brief)

**Status:** Baseline v2 · **Depends on:** levy-art-direction.md, levy-topology-budgets.md · **Used by:** texture artist, engine integration

Scale 1 unit = 1 m. Height 1.75 m skull, 1.77 m turban top. Legs: mid-shin leather boots to 0.30 m, thin white spiral wrap band 0.30–0.363 m. Pitchfork 1.85 m, butt at Y −0.4625, grip zones at 25% and 55% of length (Y 0 and +0.555).

## 1. Material model

One material `M_Levy` shared by `SM_Levy_Body_LOD0/1/2` and `SM_Levy_Pitchfork_LOD0/1/2`; one UV map (`TEXCOORD_0`); one atlas set. 2 draw calls per unit (body + weapon). Opaque, single-sided; team tint via albedo alpha mask at runtime. Delivery: one GLB compressed with `gltfpack -cc` (meshopt), no Draco.

## 2. Texture set

| Map | Resolution | Channels | Format (preferred / fallback) |
|---|---|---|---|
| BaseColor | 1024² | RGB albedo (sRGB), A = team mask (linear, straight) | KTX2 UASTC / WebP lossless-alpha |
| Normal | 1024² (LOD2 uses 512 mip) | Tangent space, OpenGL +Y, MikkTSpace | KTX2 UASTC / PNG |
| ORM | 512² | R = AO, G = Roughness, B = Metallic | KTX2 ETC1S / WebP |

KTX2 (≈4× less GPU memory, needs the Basis transcoder) vs WebP is an **open item**; author for both. Albedo alpha is never transparency.

## 3. UV atlas layout (1024², pixel coords, origin top-left as seen in Painter = glTF UV)

Rect edges are on the 8 px grid. Islands stay ≥ 4 px inside their rect, so neighbours are always ≥ 8 px apart.

| Region | Rect x, y, w, h (px) | px² | Share | Mirrored |
|---|---|---|---|---|
| Tunic main (torso + skirt outer, back patch) | 0, 0, 512, 784 | 401,408 | 38.3% | No (back patch asymmetric) |
| Tunic skirt inner shell + hem underside | 256, 784, 256, 160 | 40,960 | 3.9% | No |
| Head wrap, veil, turban tail, face strip | 512, 0, 464, 272 | 126,208 | 12.0% | No |
| Sleeves + bindings | 512, 272, 464, 248 | 115,072 | 11.0% | Yes |
| Trousers + wrap band + wrap tails | 512, 520, 464, 168 | 77,952 | 7.4% | Yes |
| Boots (shaft, cuff, foot, sole) | 512, 688, 240, 336 | 80,640 | 7.7% | Yes |
| Hands | 752, 688, 224, 144 | 32,256 | 3.1% | Yes |
| Belt, buckle, pouch | 0, 784, 256, 208 | 53,248 | 5.1% | No |
| Pitchfork head: tines (128² island, 3 unique tines), crossbar, collar | 752, 832, 224, 192 | 43,008 | 4.1% | No |
| Pitchfork shaft strip (vertical, atlas right edge) | 976, 0, 48, 1024 | 49,152 | 4.7% | No |
| Slack (reserve for repacks) | 0, 992, 256, 32 + 256, 944, 256, 80 | 28,672 | 2.7% | |
| **Total** | | **1,048,576** | **100%** | |

Boots grew from 4% to 7.7% (taller shaft); trousers + wraps dropped from 12% to 7.4% (mostly under the skirt; the wrap band is only 6.3 cm tall). Pitchfork total 8.8%.

### Texel density (reference 5.12 px/cm = 512 px/m at 1024)

| Region | Target px/cm | × ref | Allowed deviation |
|---|---|---|---|
| Torso front panel (quilted chest) | 5.12 | 1.0 (highest) | ±5% |
| Torso back/sides, back patch; tines, crossbar, collar | 4.35 | 0.85 | ±10% |
| Skirt outer (both halves), veil | 4.6 | 0.9 | ±10% |
| Skirt inner shell + hem underside; face strip and hidden head ovoid | 3.1 | 0.6 | ±15% (face strip −30%) |
| Turban bands and tail, sleeves + bindings, boot shaft and foot, belt and pouch | 5.6 | 1.1 | ±10% |
| Wrap band + wrap tails | 6.4 | 1.25 | ±10% |
| Visible trousers (knee, shin 0.363–0.495) | 5.12 | 1.0 | ±10% |
| Trousers under skirt (thigh), boot sole | 2.6 | 0.5 | ±20% |
| Hands | 4.6 | 0.9 | −15% / +10% |
| Buckle | 7.7 | 1.5 | ±10% |
| Shaft | 6.5 along V × 4.0 around U | — | ±3% along V |

Shaft is the only island allowed non-square texels (1.6 : 1); lengthwise grain hides it. The shaft island is 40 × 1008 px (x 980–1020, y 8–1016) and maps butt → tine roots (1.55 m, 650 px/m): butt at y 1016, Y 0 grip zone centered at y 715, Y +0.555 grip zone centered at y 355, each band 78 px (12 cm).

### Island orientation

- **Tunic:** torso front and back panels upright; quilting channels exactly parallel to V (straight to ±1 px over the panel; 1.5 cm spacing = 7.7 px). Skirt halves straightened: rings R0–R4 horizontal, pleat/column borders (FL/SL/BL) vertical, grain along V.
- **Shaft:** vertical, butt at bottom, one column seam straight in V. **Tines:** vertical, tips up. **Turban bands, belt:** straight horizontal strips so overlap shadow lines are straight. **Sleeves, legs, boots:** limb axis along V, top up. **Wrap band:** own island cut at 0.30 and 0.363 m; spiral reads diagonal.

### Seam placement (hidden or on natural edges)

| Part | Seams |
|---|---|
| Sleeves | Inner arm (side facing the torso in A-pose); cuff seams under the binding loops |
| Trousers, wrap band | Inner leg; band top/bottom on its own edges (bottom 2 cm under the boot cuff overlap) |
| Torso | Side seams under the arms; horizontal cut under the belt (0.994–1.041 m) |
| Skirt | Front split (already open, 0°); back center at the BL/BR border (180°); top cut under the belt |
| Head, veil | Head ovoid and veil seams under the veil / under the turban at the back; turban band cuts under the next band's overlap ledge |
| Boots | Inner-ankle (medial) vertical seam; sole as a separate island along the sole edge |
| Hands | Palm/back border on the little-finger side; palm faces the shaft |
| Belt, pouch | Belt seam under the buckle; pouch seams on faces against the tunic |
| Pitchfork | Shaft seam on the face toward −Z; tines on the inner faces |

### Mirroring

- Mirrored pairs (sleeves, trousers/wrap band/wrap tails, hands, boots) share one island set inside their rect; both sides share wear and team mask. Shading relies on exported tangents with bitangent sign (`TANGENT.w`).
- For baking, offset the mirrored copy's UVs by exactly +1.0 U (into the 1–2 tile) so rays and AO don't double up; move back by −1.0 U after baking. Integer offsets keep the pixel snap.

### Padding

8 px between islands at 1024 (4 px in the 512 ORM). Why: 8 px keeps 1 texel of separation down to the 128² mip (1024 / 8), which is the mip sampled at the 120 px LOD switch (~68 screen px/m vs 512 texel/m ≈ mip 3). Below 128 neighbours blend, so export with infinite dilation (RGB and alpha separately) so bleed is the island's own colour.

### LODs

LOD1 and LOD2 reuse LOD0 UVs (edge-loop removal keeps UVs). Faces created by merging (turban dome, welded skirt split, 4-sided shaft prism) get UVs by Data Transfer (face-corner UV, nearest face interpolated) from LOD0 into existing regions. No new islands or texture space. The normal map is baked against LOD0 only and used as-is on LOD1/2.

## 4. Bake spec

| Setting | Value |
|---|---|
| Baker / resolution | Substance Painter, 2048², 16-bit; downsample to 1024 (ORM 512) and export 8-bit with dithering |
| Tangent space / format | MikkTSpace, per-fragment; the low mesh in Painter is the exact exported mesh with its tangents. OpenGL (+Y green up), as glTF requires |
| Anti-aliasing | Subsampling 4×4 for every baked map |
| Match | By mesh name (`<Group>_low` / `<Group>_high`) |
| Ray distances | Absolute (not relative to bounding box), cage from averaged normals, per group below |
| AO | 128 rays, spread 180°, max occluder distance 0.12 m, ignore backfaces on, self-occlusion "Always" (cross-group contact: belt over tunic, turban ledge over brow, skirt over thighs, boot cuff over band) |
| Baked vs painted | Baked: normal, AO, curvature, world-space normal, position, thickness, ID. Painted: BaseColor, roughness, metallic, team mask alpha, AO paint-overs (wrap overlap emphasis) multiplied on the bake |

| Bake group | Frontal / rear distance (cm) | Why |
|---|---|---|
| Head+Turban+Veil+Tail | 2.5 / 1.5 | Wound band overlaps up to 2 cm |
| Tunic | 2.0 / 1.5 | Folds ≥ 2 cm; isolated from thighs |
| Arms | 1.5 / 1.0 | Binding loops |
| Hands | 1.0 / 0.8 | |
| Legs (trousers, wrap band, tails) | 1.5 / 1.0 | Spiral overlap |
| Boots | 1.2 / 0.8 | Cuff ring, ankle creases |
| Belt (belt, buckle, pouch) | 1.0 / 0.6 | |
| Pitchfork | 0.6 / 0.4 | Shaft grain 2 mm, tine facets |

## 5. PBR values by zone

| Zone | Roughness | Metallic | AO emphasis |
|---|---|---|---|
| Wool (tunic, trousers) | 0.85–0.92 | 0 | Strong in folds, under belt |
| Linen (turban, veil, wrap band, bindings) | 0.78–0.88 | 0 | Strong between wrap bands |
| Team sleeves | 0.82 | 0 | Medium |
| Leather (belt, pouch, boots) | 0.60–0.72 (edges 0.50) | 0 | Medium |
| Skin | 0.65 | 0 | Brow strip heavy |
| Ash shaft | 0.72; grips 0.45 | 0 | Light |
| Iron tines / collar | 0.45–0.55; tips 0.30 | 0.9; rust 0.2 | Tine crotch heavy |
| Brass buckle | 0.50; edges 0.35 | 0.9 | Recesses heavy |

## 6. Team mask (BaseColor alpha)

| Area | Alpha |
|---|---|
| Sleeve cloth (upper sleeve + forearm) | 1.0 (255) |
| Bindings (raised loops on the sleeve) | 0 |
| Everything else, including the pitchfork | 0 |

- Soft edge: 2 px linear ramp at 1024, centered on the binding edge loops and sleeve island borders. Dilate alpha into the padding with the same values as the island edge so mips don't pull untinted borders into the sleeve.
- Painter export: custom channel `teamMask` → BaseColor alpha. Straight (not premultiplied) alpha; RGB under alpha 0 must survive: WebP with `cwebp -lossless -exact`, and disable any "clear colour under transparent" option.
- glTF `alphaMode` OPAQUE (Blender: Blend Mode Opaque, image alpha not connected to Alpha). Three.js then keeps `transparent = false`, `alphaTest = 0`, and the opaque shader path forces output alpha to 1.
- Verify: Three.js debug override of `map_fragment` with `gl_FragColor = vec4(vec3(sampledDiffuseColor.a), 1.0)` must show only sleeves white; toggling team colour must change only the sleeves; no sorting or see-through artifacts.

## 7. Three.js material setup

| Param | Value |
|---|---|
| Type | `MeshStandardMaterial` (from GLTFLoader) |
| `roughness` / `metalness` | 1.0 / 1.0 (factors; the ORM G/B channels carry the values) |
| `envMapIntensity` | 1.0 (Three default, matches unit materials from `unitKit.ts` `M()`) |
| Environment | Supplied by the scene, not the material: a 64 px sky-gradient PMREM on `scene.environment` with `scene.environmentIntensity` 0.3 (`src/game/skyEnvironment.ts`, set in `render3d.ts`). Medium and high tiers on desktop only; low tier and phones have none, so metals there rely on direct light. Do not bake reflections into albedo to compensate. |
| `side` | `FrontSide` |
| `transparent` / `alphaTest` / `depthWrite` | false / 0 / true |
| `map.colorSpace` | `SRGBColorSpace` |
| `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap` | `NoColorSpace` (linear) |
| `aoMap` | Same ORM texture, R channel, same UV (`TEXCOORD_0`, `channel` 0). Three r186 GLTFLoader assigns it from `occlusionTexture`; no second UV set |
| `normalScale` | Leave as loaded (1, 1). With exported tangents GLTFLoader does not flip Y |
| Anisotropy | All Levy textures follow the `setSharedAnisotropy` tier (1 / 4 / 8) |

Team tint in `onBeforeCompile`: `albedo.rgb = mix(albedo.rgb, albedo.rgb * teamColor, map.a)`. Replace `#include <map_fragment>` with: sample `map`, then `diffuseColor.rgb *= mix(s.rgb, s.rgb * teamColor, s.a);` and do not multiply `diffuseColor.a`. `teamColor` is a `vec3` uniform holding `new THREE.Color(TEAM_CLOTH[team])` (linear after ColorManagement; sRGB textures are hardware-decoded, alpha is not). Make one material per team, store the uniform in `userData`, and return a constant from `customProgramCacheKey` (e.g. `"levy-team"`) so both teams share one program.

**Integration risk in `src/game/assets3d.ts` `prep()` (do not edit here; exclude the `levy` key at integration):**

- `std.roughness = 0.68` (name `M_Levy` has no "metal"/"wood") scales every ORM roughness by 0.68; `std.metalness = Math.min(std.metalness, 0.08)` caps iron/brass at 0.072 instead of 0.9; `std.envMapIntensity = 0.75` overrides 1.0. `side` becomes `FrontSide` (correct here; set it explicitly anyway).
- `map.anisotropy = sharedAnisotropy` touches only `map`, and the texture isn't in `sharedAlbedo`, so later `setSharedAnisotropy` calls skip all Levy maps.
- `skinWithColormap` is skipped only while `map` exists; a failed texture load would repaint the UVs and force DoubleSide and roughness 0.86.

## 8. Surface & wear (visible areas only)

- **Turban:** 3–4 wraps with crisp overlap shadow lines (AO + normal). Sun-yellowed crown, dust-grey lower band, faint brow sweat band (−5% value). Tail end frayed in normal/albedo only, no alpha.
- **Veil:** large soft folds under the chin; lighter over shoulders, greyed edges. **Face strip:** flat skin tone grading into deep AO under the turban ledge. No eyes, mouth, or brows.
- **Tunic chest:** quilted vertical channels, 1.5 cm spacing; dark channels, light ridges. **Back patch:** ~18 × 22 cm, upper-left back, running stitch in normal only.
- **Tunic skirt:** 6 pleats aligned to bone chains. Mud on bottom 15 cm (darker, roughness −0.1). Grass/knee scuffs at front. 3–4 shallow hem tears as geometry notches (no alpha-test).
- **Sleeves:** elbow wear (+8% value, roughness −0.05); grime in binding creases. **Belt / pouch:** dark leather, polished lighter edges; sagged pouch, worn flap edge; dulled buckle with dark recesses.
- **Boots (to 0.30 m):** carry most of the mud: caked sole edge and toe, splash up to ~0.18 m, dried lighter crust breaking up toward the cuff. Ankle creases (2 crease loops), scuffed toe highlights, polished cuff ring edge.
- **Wrap band (0.30–0.363 m):** 2 diagonal spiral turns with overlap shadow lines; light dust/mud on its lower edge only (bottom ~1.5 cm, ≤ 40% opacity); top stays clean so it reads as the second-brightest value. Wrap tail on the outer calf, frayed in normal/albedo only.
- **Trousers:** knee scuffs and dust on the visible shin/knee; thigh under the skirt is AO-darkened, no detail. **Hands:** dirt in knuckle creases, slightly reddened knuckles; no nails.
- **Pitchfork:** lengthwise ash grain; darker glossy grip zones at 25% and 55% of length; dirt-darkened butt; leather-and-iron collar with nail and rust bloom; hammer-faceted tines, rust in crotch, bright worn top 3 cm of each tip.

## 9. Substance Painter layer stacks

**Setup:** bake per section 4 at 2048. Paint at 2048; export 1024 (ORM 512).

**Tunic (wool):** 1. Base `#6E6E4C`, roughness 0.88, wool fill at 2 cm tile, height 0.02. 2. Chest panel `#64643F` on quilted channels, AO-multiplied dark in channels. 3. Top-down gradient: position-Y mask, −10% value toward hem. 4. Fold cavity: curvature-concave, −15% value. 5. Fold highlight: curvature-convex, +6% value, roughness −0.04. 6. Back patch: fill `#75754F` + stitch height stencil on border. 7. Mud: bottom 15 cm position gradient with grunge breakup, `#4A3E2C`, roughness −0.1. 8. Wear: edge mask on hem and split edges, +8% value, desaturated. **Trousers (wool):** 1. Base `#4A3E30`, roughness 0.9. 2. AO multiply under the skirt. 3. Knee scuff: curvature-convex, +6% value, dust.

**Linen (turban, veil, wrap band, bindings):** 1. Base `#E2D8BE`, roughness 0.82. 2. Wrap overlap AO at 1.4× contrast. 3. Sun bleach (crown only): world-normal +Y mask, `#E6D9B4`. 4. Dust: low-position mask on turban lower band and veil edges, `#CFC6AE`. 5. Brow sweat: hand-painted band, −5% value. 6. Wrap-band lower edge: position mask 0.30–0.315 m, `#5A4A36` at ≤ 40%, grunge breakup; nothing above 0.315 m.

**Sleeves (team-masked wool):** 1. Base `#F0F0F0` (near-white so the tint lands on `TEAM_CLOTH`), roughness 0.82, wool fill. 2. Elbow wear: curvature-convex, +8% value. 3. Binding-crease grime: AO mask, −12% value. 4. Albedo alpha = 1.0 on sleeve cloth only (bindings = 0), section 6.

**Leather (belt, pouch, boots):** 1. Base belt/pouch `#4A3020`, boots `#3E2A1C`, roughness 0.68, leather grain. 2. Edge polish: curvature edge, +12% value, roughness 0.50 (boot cuff ring, toe). 3. Creases: concave, −15% value (boot ankle creases). 4. Boot mud: sole edge and toe solid, splash to ~0.18 m with grunge, `#4A3E2C`, roughness 0.85; dried crust +8% value. **Brass buckle:** base `#8E7440`, metallic 0.9, roughness 0.5; cavity −40%; edge roughness 0.35.

**Skin (hands, brow strip):** 1. Base `#C89878`, roughness 0.65. 2. Knuckles +10% red. 3. Crease dirt: AO mask, `#6A5040` at 30%. 4. Brow strip: AO multiply from turban ledge (65% at ledge).

**Ash shaft:** 1. Base `#A87A48`, roughness 0.72, lengthwise grain (normal 0.3). 2. Grip polish: two 12 cm band masks at 25% and 55% (shaft island y 715 and 355), `#8E6638`, roughness 0.45. 3. Butt dirt: bottom 10 cm, `#5A4630`. **Iron (tines, collar):** 1. Base `#7E8288`, metallic 0.9, roughness 0.5, hammer-facet normal. 2. Rust: tine crotch and collar nail (AO + grunge), `#6A3E22`, metallic 0.2, roughness 0.8. 3. Worn tips: top 3 cm + edge mask, `#B4B8BC`, roughness 0.30.

## 10. Value & readability QA

Albedo luma (Rec. 709 weights on sRGB 0–255), measured on the exported BaseColor:

| Material | Target luma | Palette base |
|---|---|---|
| Turban, veil, wrap band (whites) | 195–235 (dust band is the floor) | `#E2D8BE` ≈ 216 |
| Sleeves before tint | 215–240 (wear and grime may dip to 200) | `#F0F0F0` = 240; × team color ≈ `TEAM_CLOTH` |
| Skin | 100–170 (brow AO low end) | `#C89878` ≈ 160 |
| Ash shaft | 100–135 | `#A87A48` ≈ 128 |
| Olive tunic (mid) | 80–120 | `#6E6E4C` ≈ 108 |
| Trousers | 50–70 | `#4A3E30` ≈ 64 |
| Belt / boots (dark) | 40–60 / 35–55; boot mud ≤ 70 | ≈ 52 / ≈ 45 |
| Iron / brass (metal F0) | 110–185 / 100–130 | ≈ 130 / ≈ 118 |

Medium-distance check: render the in-game view (ACES, exposure 1.55, game lights), front and 3/4, both teams. Downscale (box filter) so the unit is 120 px and 50 px tall, then view in grayscale and in saturation.

- Turban and wrap band are the brightest clusters at both sizes; the wrap band (6.3 cm) stays visible as a light row (≈ 4 px at 120, ≈ 2 px at 50). Team sleeves are the most saturated region at both sizes for both teams.
- Belt reads as a dark break at 120 px; boots are darker than the tunic. No visible seam, mip bleed, or tint halo at either size.

## 11. Export & naming

| File (in `public/models/levy/`) | Size | Notes |
|---|---|---|
| `levy.glb` | | Meshes, rig, clips, `M_Levy`; textures by relative URI so the container can change without re-export |
| `T_Levy_BaseColor.webp` (or `.ktx2`) | 1024² | RGBA, sRGB RGB + straight alpha; `.png` lossless master kept with the sources |
| `T_Levy_Normal.png` (or `.ktx2`) | 1024² | RGB, linear, OpenGL +Y |
| `T_Levy_ORM.webp` (or `.ktx2`) | 512² | RGB, linear; glTF `occlusionTexture` and `metallicRoughnessTexture` point to the same image |

- Mips: PNG/WebP get runtime mips (power-of-two, `LinearMipmapLinearFilter`). KTX2 must ship a full baked mip chain (compressed textures can't generate mips at runtime).
- WebP needs `EXT_texture_webp`; KTX2 needs `KHR_texture_basisu` and a `KTX2Loader` on the GLTFLoader. Sources (2048 Painter project, 16-bit bakes) stay out of `public/`.

### Deliverable checklist

- [ ] `T_Levy_BaseColor`, `T_Levy_Normal`, `T_Levy_ORM` at the sizes above, names exact; UVs match the section 3 rects, padding ≥ 8 px, infinite dilation, mirrored copies moved back to 0–1.
- [ ] Bake per section 4; tangents exported and present after `gltfpack -cc`.
- [ ] Team mask per section 6; RGB intact under alpha 0; `alphaMode` OPAQUE.
- [ ] Integration note: the `levy` key is excluded from `prep()` overrides and `skinWithColormap`, and all Levy textures are added to the shared anisotropy set.

### Acceptance criteria

- [ ] Texel density within section 3 limits (checker at 5.12 px/cm); quilting channels and shaft strip straight to ±1 px.
- [ ] No mirrored seam visible under a rotating light; no normal-map inversion on mirrored islands or LOD1/2.
- [ ] Albedo luma within section 10 ranges; medium-distance check passes at 120 px and 50 px for both teams. Only sleeve cloth tints when the team colour changes.
- [ ] In Three.js: `roughness` 1, `metalness` 1, `envMapIntensity` 1, `FrontSide`, `transparent` false at runtime (no `prep()` override); one program for both teams.
- [ ] Boots carry the mud; wrap band clean above its lower 1.5 cm; grip zones line up with the hands at 25% and 55%.
