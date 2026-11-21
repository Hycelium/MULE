# Levy — Art Direction

**Status:** Baseline v1 · **Depends on:** none · **Used by:** all other Levy docs

## Identity

A conscripted farmhand: underequipped, wearing his own clothes with his lord's colors on his sleeves. Brave but untrained; his technique is farm strength, not drilled form.

## Constraints

- Engine: Three.js (WebGL), many units on screen (budget assumes ~80 animated humanoids visible).
- Camera: medium distance, scrolling. Detail must read at that range; no hero micro-detail.
- Elevate through surface, materials, and animation. Do not redesign the character.

## Silhouette (keep)

- Stacked, wound turban dome on a slightly oversized head (1.05×).
- Rounded, padded shoulder rolls.
- Knee-length flared tunic skirt with a front split.
- Tapered legs ending in bright white leg wraps.
- Pitchfork about 1.0× character height.

## Value structure (medium distance)

1. White turban — brightest value, caps the figure.
2. Olive tunic — large mid-value mass, broken at the waist by a dark belt.
3. White leg wraps — repeat the top value and frame the figure.

Team-tinted sleeves are the most saturated element and carry the team read.

## Stylization rules

- Chunky proportions: hands 1.15×, forearms slightly thick.
- Fold detail ≥ 2 cm; nothing finer is sculpted.
- Albedo carries a subtle top-down light gradient (8–12% value falloff, shoulders → hem).
- No pores, no fabric microweave in geometry, stitches only on major seams.

## Changes from the current procedural model

| Change | Reason |
|---|---|
| Add neck veil + trailing turban tail | Matches reference; hides the face; adds secondary motion |
| Remove beard and all facial features | Face is never readable at camera distance |
| Add front skirt split | Lunges read clearly |
| Add back patch | Storytelling at low cost |
| Leg wraps become spiral bands | Replaces stacked rings with a believable wrap |

## Palette (sRGB albedo, ≤ 240 for PBR safety)

| Element | Hex | Notes |
|---|---|---|
| Tunic (olive) | `#6E6E4C` | Chest panel `#64643F`, back patch `#75754F` |
| Turban / veil / leg wraps | `#E2D8BE` | Sun-yellowed top `#E6D9B4`, dust lower `#CFC6AE` |
| Sleeves | `#B8B8B8` | Neutral; multiplied by team color at runtime |
| Team colors | you `#2F63B8`, foe `#A82A2A` | From `TEAM_CLOTH` in code |
| Trousers | `#4A3E30` | Mostly hidden |
| Belt / shoes | `#4A3020` / `#3E2A1C` | |
| Brass buckle | `#8E7440` | Dulled |
| Skin | `#C89878` | Hands and brow strip only |
| Shaft (ash) | `#A87A48` | Grip zones `#8E6638` |
| Tines (iron) | `#7E8288` | Worn tips `#B4B8BC`, rust `#6A3E22` |
| Mud | `#4A3E2C` / `#5A4A36` | Hem / leg wraps |
