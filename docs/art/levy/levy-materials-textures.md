# Levy — Materials, UVs & Textures

**Status:** Baseline v1 · **Depends on:** levy-art-direction.md (palette), levy-topology-budgets.md · **Used by:** texture artist, engine integration

## Material model

One material for the whole unit. Body and pitchfork share one atlas → one texture set, 2 draw calls per unit (weapon is a separate mesh).

## UV atlas (1024², 8 px padding, ~5.1 px/cm)

| Region | Share | Mirrored |
|---|---|---|
| Tunic (torso + skirt) | 38% | No (back patch is asymmetric) |
| Head wrap, veil, face strip | 12% | No |
| Sleeves + bindings | 11% | Yes (offset +1 U for bake) |
| Trousers + leg wraps | 12% | Yes |
| Hands | 3% | Yes |
| Shoes | 4% | Yes |
| Belt, buckle, pouch | 5% | No |
| Pitchfork | 9% | No |
| Padding / slack | 6% | |

Pitchfork: shaft is a 1024 × 48 straightened strip on the atlas edge; head is a 128² island with three unique tines.

## Texture set

| Map | Resolution | Channels | Format (preferred / fallback) |
|---|---|---|---|
| BaseColor | 1024² | RGB albedo, A = team mask (sleeves = 1) | KTX2 UASTC / WebP lossless-alpha |
| Normal | 1024² (LOD2 uses 512 mip) | Tangent space, OpenGL +Y, MikkTSpace | KTX2 UASTC / PNG |
| ORM | 512² | R = AO, G = Roughness, B = Metallic | KTX2 ETC1S / WebP |

The codebase currently avoids the Basis transcoder. KTX2 is recommended (≈4× less GPU memory); otherwise ship the WebP fallback. Material is opaque; albedo alpha is never transparency.

## PBR values by zone

| Zone | Roughness | Metallic | AO emphasis |
|---|---|---|---|
| Wool (tunic, trousers) | 0.85–0.92 | 0 | Strong in folds, under belt |
| Linen (wraps, veil, bindings) | 0.78–0.88 | 0 | Strong between wrap bands |
| Team sleeves | 0.82 | 0 | Medium |
| Leather | 0.60–0.72 (edges 0.50) | 0 | Medium |
| Skin | 0.65 | 0 | Brow strip heavy |
| Ash shaft | 0.72; grips 0.45 | 0 | Light |
| Iron tines / collar | 0.45–0.55; tips 0.30 | 0.9; rust 0.2 | Tine crotch heavy |
| Brass buckle | 0.50; edges 0.35 | 0.9 | Recesses heavy |

## Team tint (runtime)

In `onBeforeCompile`: `albedo.rgb = mix(albedo.rgb, albedo.rgb * teamColor, map.a)`. `teamColor` is a uniform; set `customProgramCacheKey` so both teams share one program.

## Surface & wear (visible areas only)

- **Turban:** 3–4 wraps with crisp overlap shadow lines (AO + normal). Sun-yellowed crown, dust-grey lower band, faint brow sweat band (−5% value). Tail end frayed in normal/albedo only, no alpha.
- **Veil:** large soft folds under the chin; lighter over shoulders, greyed edges.
- **Face strip:** flat skin tone grading into deep AO under the turban ledge. No eyes, mouth, or brows.
- **Tunic chest:** quilted vertical channels, 1.5 cm spacing; dark channels, light ridges.
- **Tunic skirt:** 6 pleats aligned to bone chains. Mud on bottom 15 cm (darker, roughness −0.1). Grass/knee scuffs at front. 3–4 shallow hem tears as geometry notches (no alpha-test).
- **Back patch:** ~18 × 22 cm, upper-left back, running stitch in normal only.
- **Sleeves:** elbow wear (+8% value, roughness −0.05); grime in binding creases.
- **Belt / pouch:** dark leather, polished lighter edges; sagged pouch, worn flap edge; dulled buckle with dark recesses.
- **Leg wraps:** diagonal spiral bands with overlap shadows; mud from ankle up to 40% of shin.
- **Shoes:** scuffed toe highlights, mud-caked sole edge, ankle creases.
- **Hands:** dirt in knuckle creases, slightly reddened knuckles; no nails.
- **Pitchfork:** lengthwise ash grain; darker glossy grip zones at 25% and 55% of length; dirt-darkened butt; leather-and-iron collar with nail and rust bloom; hammer-faceted tines, rust in crotch, bright worn top 3 cm of each tip.

## Substance Painter layer stacks

**Setup:** bake ID, AO (128 rays), curvature, world-space normal, position, thickness from high-poly at 2048. Paint at 2048; export 1024 (ORM 512).

**Tunic (wool):**
1. Base `#6E6E4C`, roughness 0.88, wool fill at 2 cm tile, height 0.02.
2. Chest panel `#64643F` on quilted channels, AO-multiplied dark in channels.
3. Top-down gradient: position-Y mask, −10% value toward hem.
4. Fold cavity: curvature-concave, −15% value.
5. Fold highlight: curvature-convex, +6% value, roughness −0.04.
6. Back patch: fill `#75754F` + stitch height stencil on border.
7. Mud: bottom 15 cm position gradient with grunge breakup, `#4A3E2C`, roughness −0.1.
8. Wear: edge mask on hem and split edges, +8% value, desaturated.

**Linen (turban, veil, leg wraps, bindings):**
1. Base `#E2D8BE`, roughness 0.82.
2. Wrap overlap AO at 1.4× contrast.
3. Sun bleach (crown only): world-normal +Y mask, `#E6D9B4`.
4. Dust: low-position mask on turban lower band and veil edges, `#CFC6AE`.
5. Brow sweat: hand-painted band, −5% value.
6. Leg-wrap mud: ankle → 40% shin, `#5A4A36`, grunge breakup.

**Sleeves (team-masked wool):**
1. Base `#B8B8B8`, roughness 0.82, wool fill.
2. Elbow wear: curvature-convex, +8% value.
3. Binding-crease grime: AO mask, −12% value.
4. Albedo alpha = 1.0 on sleeve islands only (bindings = 0).

**Leather (belt, pouch, shoes):**
1. Base `#4A3020` / `#3E2A1C`, roughness 0.68, leather grain.
2. Edge polish: curvature edge, +12% value, roughness 0.50.
3. Creases: concave, −15% value.
4. Shoe mud: sole edge and toe, `#4A3E2C`.

**Brass buckle:** base `#8E7440`, metallic 0.9, roughness 0.5; cavity −40%; edge roughness 0.35.

**Skin (hands, brow strip):**
1. Base `#C89878`, roughness 0.65.
2. Knuckles +10% red.
3. Crease dirt: AO mask, `#6A5040` at 30%.
4. Brow strip: AO multiply from turban ledge (65% at ledge).

**Ash shaft:**
1. Base `#A87A48`, roughness 0.72, lengthwise grain (normal 0.3).
2. Grip polish: two band masks, `#8E6638`, roughness 0.45.
3. Butt dirt: bottom 10 cm, `#5A4630`.

**Iron (tines, collar):**
1. Base `#7E8288`, metallic 0.9, roughness 0.5, hammer-facet normal.
2. Rust: tine crotch and collar nail (AO + grunge), `#6A3E22`, metallic 0.2, roughness 0.8.
3. Worn tips: top 3 cm + edge mask, `#B4B8BC`, roughness 0.30.
