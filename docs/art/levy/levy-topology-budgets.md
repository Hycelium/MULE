# Levy — Topology & Poly Budgets

**Status:** Baseline v1 · **Depends on:** levy-art-direction.md · **Used by:** levy-rig-spec.md, levy-materials-textures.md

## Scale

1 unit = 1 m. Height 1.75 m (1.85 m to turban top). Runtime `fitModel` rescales.

## LOD0 body (triangles)

| Part | Tris | Topology notes |
|---|---|---|
| Head + turban + veil + tail | 700 | Head is a closed ovoid (~120 tris). Turban: 3 wound bands with real overlap ledges. Veil: one shell, 1-loop thickened edge. |
| Torso / chest panel / shoulder rolls | 900 | 3 loops per shoulder. Chest rib stripes come from the normal map. |
| Tunic skirt (front split) | 1,100 | 6 vertical columns aligned to skirt chains, 5 rings, 1-loop hem thickness, inner shell on lower 40% only. |
| Arms + sleeves + bindings | 900 | 3 loops per elbow, 2 per wrist. Bindings are raised loops, not separate meshes. |
| Hands (mitten + thumb) | 300 | Four fingers as one block with 2 knuckle loops for a curl. |
| Trousers + leg wraps | 700 | 3 loops per knee. Spiral wrap: 4 diagonal loops per shin. |
| Shoes | 250 | |
| Belt, buckle, pouch | 250 | |
| **Total** | **≈ 5,100** | Single material, single `SkinnedMesh` |

Pitchfork LOD0: ~350 tris, separate mesh (see levy-weapon.md).

## LOD chain (switch by on-screen height)

| LOD | Body / weapon tris | When | Changes |
|---|---|---|---|
| LOD0 | 5,100 / 350 | > 120 px tall | Full spec |
| LOD1 | 2,200 / 120 | 50–120 px | Skirt inner shell removed, turban bands merged, fingers fused |
| LOD2 | 800 / 40 | < 50 px | Skirt weighted to hips/thighs only (no chains); shaft is a 4-sided prism |

All LODs share one skeleton.

## High-poly bake source

- 1–2M tris total.
- Sculpt only readable forms: folds ≥ 2 cm, wrap overlaps, quilting ridges, hammer facets on tines, shaft grain (2 mm relief).
- Do not sculpt: pores, face, fabric weave, nails.

## Deformation rules

- Max 4 influences per vertex (Three.js limit). Prune weights < 0.05, renormalize.
- Quads only in source; triangulate on export. No n-gons.
- Every bend joint gets 3 loops: center plus one each side.
- Export tangents in glTF so mirrored UV islands shade correctly.
