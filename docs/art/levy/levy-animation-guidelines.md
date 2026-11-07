# Levy — Animation Guidelines

**Status:** Baseline v2 · **Depends on:** levy-rig-spec.md, levy-weapon.md · **Used by:** animator, engine integration

## Gameplay constraints (from code)

| Constraint | Value |
|---|---|
| Attack cooldown | 0.65 s (`balance.ts` → `levy`) |
| Windup cap | `min(windup, cd × 0.5)` = 0.325 s |
| Recovery cap | `min(recover, cd × 0.4)` = 0.26 s |
| Defensive sim states | None — blocks/dodges/hit reactions are presentation-only |

## Authoring

- 30 fps, Blender, in place: `Root` never moves; vertical bob and lunge travel live on `Hips` translation. Stride/travel distance goes to `levy.anim.json`.
- Tracks: rotation on all bones, translation on `Hips` only, no scale, no morph weights.
- Every combat clip starts and ends on the Guard pose so attacks chain without pops.
- Tine plane roll-locked horizontal in all attacks and blocks.

## Clip list

| Clip | Frames | Loop | Notes |
|---|---|---|---|
| `Idle_Carry` | 90 | ✓ | Shaft vertical, butt grounded by right foot; breathing + weight shift |
| `Idle_Guard` | 60 | ✓ | Low stance, tines forward at chest height, small bob |
| `Walk_Carry` | 32 | ✓ | Authored 1.4 m/s; export `stride` metadata |
| `Jog_Guard` | 20 | ✓ | Authored 3.2 m/s; weapon leveled; closing on target |
| `Carry_To_Guard` | 10 | | Weapon drops vertical → level with a step-in. Also `UB_` version |
| `Guard_To_Carry` | 14 | | Slower, shoulders drop. Also `UB_` version |
| `Thrust_High` | 19 | | Primary attack, contact frame 9 |
| `Thrust_Low` | 19 | | Deep front-knee lunge, contact frame 9; preferred vs wards |
| `Sweep` | 19 | | Horizontal haft swing R → L, tines leading, contact frame 9; every 3rd–4th attack |
| `Block_Haft` | 6 in / 4 hold / 8 out | | Shaft horizontal in both hands, pushed forward |
| `Dodge_Side_L` / `_R` | 14 | | Hop sidestep, weapon level |
| `Dodge_Back` | 14 | | Two-foot skip back, guard held |
| `Hit_Light_F` / `_L` / `_R` | 8 | | Additive, upper body |
| `Hit_Heavy_F` | 14 | | Full body, stumble step back |
| `Death_Back` / `_Front` / `_Crumple` | 30–36 | | Weapon stays parented; end-frame hold |
| `Spawn_Rally` | 24 | | Optional: fork raised overhead, shout pose (body only) |

`UB_` clips contain only `Spine_02` and descendant tracks, for layering over walk/jog.

## Attack timing chart (19 frames ≈ 0.633 s)

```
Frames  0–1   Settle         guard pose, micro-dip of the hips
Frames  2–6   Anticipation   hips rotate back, rear foot loads, shaft draws back 25–30 cm, tines dip 5°
Frames  7–8   Strike         2 frames, near-linear tangents: hips → chest → arms → weapon
Frame   9     CONTACT        front foot planted (since frame 7), full extension, COG 5 cm lower
Frames 10–12  Follow-thru    tip overshoots 8–10 cm, rebounds 3 cm; tunic chains still trailing
Frames 13–14  Hold           readable "stuck" moment
Frames 15–19  Recovery       ease back to guard; cancel-safe for next windup
```

## Sim sync

- Playback rate = `contactTime / W` (0.30 / 0.325 ≈ 0.92) so frame 9 lands on the sim's `hitAt`.
- Hit-stop: on confirmed hit at LOD0, attacker action `timeScale` = 0.05 for 50 ms. The cancel-safe tail absorbs the drift.

## Presentation triggers

| Clip | Trigger |
|---|---|
| `Block_Haft` | An enemy targeting this Levy enters windup while this Levy is in Guard or Recovery. Damage still applies; `Hit_Light` layers on top. |
| `Dodge_*` | ~15% chance instead of a block when not attacking. |
| `Hit_Heavy_F` | Damage > 20% max HP, or any siege/tower hit. |

## Motion principles

- **Kinetic chain:** hips lead → chest +1 frame → arms +1 → weapon tip +1. Cloth trails 2–4 frames.
- **Snap:** strikes are 2 frames, linear/fast-out. Ease only anticipation and recovery. Never ease into contact.
- **Weight:** front foot plants before contact; COG drops 4–6 cm at contact; rear heel lifts on extension; skirt flares on lunges (`Skirt_StrideOpen`).
- **Readability:** anticipation silhouette shows shaft drawn back with tines beside the torso. Strikes aim at the target's chest line.
- **Character:** slightly overcommitted lunges; small balance wobble on recovery frame 16–17. Idles show fatigue (shoulders forward, weight on one leg).
- **Hit reactions:** direction-correct; head and chest lead, weapon stays roughly on line; back to responsive within 8 frames.

## Motion references

| Reference | Take from it |
|---|---|
| Chinese spear basics (lan / na / zha, rear-hand drive) | Thrust mechanics |
| George Silver short staff, HEMA quarterstaff | Haft blocks, sweeps |
| Bōjutsu | Block-to-strike transitions |
| For Honor | Windup readability, hit-stop |
| Mount & Blade II: Bannerlord | Polearm grips, infantry weight |
| Ghost of Tsushima peasant enemies | Overcommitted, untrained energy |

## Retargeting reference motion

1. **Source:** Rokoko, Movella, ActorCore, or Mixamo (blocking only), or video-traced reference. Use a 1.8 m pole prop.
2. **Match:** align to the Levy A-pose; retarget body bones only (Rokoko Retarget or Auto-Rig Pro). Never retarget skirt, wrap, veil, or pouch bones.
3. **Constrain:** foot IK on contact frames; left hand on `Grip_L` throughout; right hand drives the weapon; re-solve the tine roll lock.
4. **Reduce to poses:** bake every 2 frames, keep only extremes and breakdowns (~5–7 keys per attack).
5. **Stylize:** push key poses 15–25% further, compress strikes to 2 frames, add the 2-frame contact hold, retime to the chart.
6. **Curves:** linear strikes, eased anticipation/recovery, overlap offsets per the kinetic chain.
7. **Cloth bake:** simulate only on the locked body animation, bake to chain bones.
8. **Export:** resample 30 fps, drop constant and scale tracks, compress with `gltfpack -cc` (EXT_meshopt_compression; the loader sets `MeshoptDecoder`). Write events (contact, footplant, cancel window) to `levy.anim.json`.

## Event sidecar (`levy.anim.json`)

```json
{ "fps": 30,
  "clips": {
    "Thrust_High": { "contact": 9, "footplant": [7], "cancelFrom": 15, "travel": 0.35 },
    "Walk_Carry":  { "speed": 1.4, "stride": 1.49, "footplant": [0, 16] },
    "Block_Haft":  { "holdFrom": 6, "holdTo": 10 } } }
```

Every attack has `contact` and `cancelFrom`; every loop has `speed` and `footplant`. Frames are integers at 30 fps.

## Blend table

| From → To | Cross-fade |
|---|---|
| Idle ↔ Walk / Jog | 0.20 s |
| Guard → attack, attack → attack (from `cancelFrom`) | 0.05 s |
| Attack → Guard (clip end) | 0.00 s (shared pose) |
| Any → Block / Dodge | 0.08 s |
| Any → Hit_Heavy / Death | 0.06 s |
| `Hit_Light_*` | Additive, weight 1, no fade |
| `UB_*` over locomotion | Weight fade 0.15 s |

## Runtime integration (Three.js)

- Additive clips: `AnimationUtils.makeClipAdditive(clip, 0)` once at load; play with `blendMode = AdditiveAnimationBlendMode`.
- `UB_*` clips: filter tracks to `Spine_02` descendants at load (by bone name prefix list), not at runtime.
- Hit-stop: set the attack action's `timeScale` to 0.05 for 50 ms, then restore the sync rate.

- One GLB: SkinnedMesh + pitchfork under `Weapon_R` + all clips. Clone with `SkeletonUtils.clone`; share `AnimationClip` objects.
- Mixer update rate: LOD0 every frame, LOD1 30 Hz, LOD2 15 Hz, off-screen accumulate time only.
- Inflate the bounding sphere (radius 1.6 m from Hips) so lunges aren't frustum-culled.
- Locomotion: `timeScale = groundSpeed / authoredSpeed`, clamp 0.8–1.25; beyond that cross-fade Walk ↔ Jog.
- Order per frame: mixer → corrective morphs → springs (LOD0) → left-hand IK (LOD0).

## Acceptance

- [ ] All clips in the clip list present, names exact; frame counts match.
- [ ] Attack contact on frame 9; sim sync rate ≈ 0.92 lands contact on `hitAt` (±1 frame).
- [ ] Combat clips start/end on Guard; no pop chaining Thrust_High → Thrust_Low → Sweep.
- [ ] No foot sliding at 0.8–1.25 timeScale; `Root` static in every clip.
- [ ] Tine plane horizontal in attacks/blocks; left hand within 1 cm of `Grip_L`.
- [ ] Sidecar validates: every attack has `contact`/`cancelFrom`, every loop has `speed`/`footplant`.
