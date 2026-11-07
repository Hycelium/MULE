"""Levy v1 proxy build: rig, skinned body, pitchfork, atlas textures, four clips, glTF export.

Run:  blender -b --factory-startup --python tools/levy/build_levy.py -- <out_dir>

All authored coordinates are glTF (Y up, character faces +Z, character left = +X), meters.
Specs: docs/art/levy/*.md (v2). This is a scripted first pass, not the sculpted/painted asset.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.join(os.path.dirname(__file__), "out"))
os.makedirs(OUT, exist_ok=True)
FPS = 30
ATLAS = 1024


def B(x, y=None, z=None):
    """glTF (x, y, z) -> Blender (x, -z, y)."""
    if y is None:
        x, y, z = x
    return Vector((x, -z, y))


def G(v):
    """Blender -> glTF."""
    return Vector((v.x, v.z, -v.y))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

# ------------------------------------------------------------------ armature (levy-rig-spec.md bone table)

SIDE = {"L": 1.0, "R": -1.0}
BONES = []  # (name, parent, head, tail)


def bone(name, parent, head, tail):
    BONES.append((name, parent, Vector(head), Vector(tail)))


bone("Root", None, (0, 0, 0), (0, 0.1, 0))
bone("Hips", "Root", (0, 0.920, 0), (0, 1.018, 0))
bone("Spine_01", "Hips", (0, 1.018, 0), (0, 1.160, 0))
bone("Spine_02", "Spine_01", (0, 1.160, 0), (0, 1.300, 0))
bone("Chest", "Spine_02", (0, 1.300, 0), (0, 1.478, -0.010))
bone("Neck", "Chest", (0, 1.478, -0.010), (0, 1.545, -0.010))
bone("Head", "Neck", (0, 1.545, -0.010), (0, 1.750, -0.010))
bone("Wrap_Tail_01", "Head", (0, 1.620, -0.135), (0, 1.505, -0.150))
bone("Wrap_Tail_02", "Wrap_Tail_01", (0, 1.505, -0.150), (0, 1.390, -0.160))
bone("Wrap_Tail_03", "Wrap_Tail_02", (0, 1.390, -0.160), (0, 1.273, -0.170))
bone("Veil_Front_01", "Head", (0, 1.560, 0.125), (0, 1.455, 0.155))
bone("Veil_Front_02", "Veil_Front_01", (0, 1.455, 0.155), (0, 1.360, 0.190))
for s, k in SIDE.items():
    m = lambda x, y, z: (k * x, y, z)
    bone(f"Clavicle_{s}", "Chest", m(0.030, 1.420, 0.030), m(0.209, 1.436, 0))
    bone(f"UpperArm_{s}", f"Clavicle_{s}", m(0.209, 1.436, 0), m(0.441, 1.204, 0))
    bone(f"UpperArm_Twist_{s}", f"UpperArm_{s}", m(0.325, 1.320, 0), m(0.441, 1.204, 0))
    bone(f"Forearm_{s}", f"UpperArm_{s}", m(0.441, 1.204, 0), m(0.646, 0.999, 0.078))
    bone(f"Forearm_Twist_{s}", f"Forearm_{s}", m(0.544, 1.102, 0.039), m(0.646, 0.999, 0.078))
    bone(f"Hand_{s}", f"Forearm_{s}", m(0.646, 0.999, 0.078), m(0.714, 0.931, 0.104))
    bone(f"Fingers_01_{s}", f"Hand_{s}", m(0.714, 0.931, 0.104), m(0.750, 0.893, 0.112))
    bone(f"Fingers_02_{s}", f"Fingers_01_{s}", m(0.750, 0.893, 0.112), m(0.786, 0.855, 0.120))
    bone(f"Thumb_01_{s}", f"Hand_{s}", m(0.662, 0.982, 0.108), m(0.680, 0.966, 0.148))
    bone(f"Thumb_02_{s}", f"Thumb_01_{s}", m(0.680, 0.966, 0.148), m(0.690, 0.955, 0.185))
    bone(f"Thigh_{s}", "Hips", m(0.109, 0.913, 0), m(0.109, 0.495, 0.018))
    bone(f"Calf_{s}", f"Thigh_{s}", m(0.109, 0.495, 0.018), m(0.109, 0.091, 0))
    bone(f"Foot_{s}", f"Calf_{s}", m(0.109, 0.091, 0), m(0.109, 0.025, 0.100))
    bone(f"Toe_{s}", f"Foot_{s}", m(0.109, 0.025, 0.100), m(0.109, 0.025, 0.167))
    bone(f"LegWrap_Tail_{s}", f"Calf_{s}", m(0.178, 0.360, 0), m(0.178, 0.270, 0))
    for c, (x1, z1) in {"F": (0.108, 0.152), "S": (0.215, 0.0), "B": (0.108, -0.152)}.items():
        dx, dz = {"F": (0.0255, 0.035), "S": (0.0515, 0.0), "B": (0.0255, -0.035)}[c]
        ys = [0.935, 0.805, 0.675, 0.544]
        p = f"Skirt_{c}{s}_0"
        for i in range(3):
            bone(f"{p}{i + 1}", "Hips" if i == 0 else f"{p}{i}", m(x1 + dx * i, ys[i], z1 + dz * i), m(x1 + dx * (i + 1), ys[i + 1], z1 + dz * (i + 1)))
bone("Weapon_R", "Hand_R", (-0.686, 0.959, 0.093), (-0.686, 0.959, 0.143))
bone("Pouch", "Hips", (0.170, 0.990, 0.120), (0.170, 0.870, 0.120))

arm_data = bpy.data.armatures.new("Levy_Rig")
rig = bpy.data.objects.new("Levy_Rig", arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, parent, h, t in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = B(h), B(t)
    eb.roll = 0.0
    eb.use_deform = True
for name, parent, _, _ in BONES:
    if parent:
        arm_data.edit_bones[name].parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")
BONE_NAMES = [b[0] for b in BONES]

# ------------------------------------------------------------------ geometry helpers (glTF space)

PARTS = []  # (object, region)


def basis(axis):
    a = axis.normalized()
    ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
    u = a.cross(ref).normalized()
    return u, a.cross(u).normalized(), a


def ring_verts(bm, center, axis, r, segs, zscale=1.0):
    u, w, _ = basis(axis) if axis.length > 0 else (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0)))
    out = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        p = center + u * (math.cos(a) * r) + w * (math.sin(a) * r * zscale)
        out.append(bm.verts.new(B(p)))
    return out


def bridge(bm, rings, closed=True):
    for r0, r1 in zip(rings, rings[1:]):
        n = len(r0)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))


def cap(bm, ring, flip=False):
    bm.faces.new(list(reversed(ring)) if flip else ring)


def tube(bm, p0, p1, r0, r1, segs, rows=1, caps=True):
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    rings = [ring_verts(bm, p0 + axis * (k / rows), axis, r0 + (r1 - r0) * k / rows, segs) for k in range(rows + 1)]
    bridge(bm, rings)
    if caps:
        cap(bm, rings[0], flip=True)
        cap(bm, rings[-1])


def lathe(bm, profile, segs, zscale=1.0, cx=0.0, cz=0.0, caps=(False, False)):
    """profile: [(radius, y)] from bottom to top, around the glTF Y axis."""
    rings = []
    for r, y in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new(B(cx + math.sin(a) * r, y, cz + math.cos(a) * r * zscale)))
        rings.append(ring)
    bridge(bm, rings)
    if caps[0]:
        cap(bm, rings[0])
    if caps[1]:
        cap(bm, rings[-1], flip=True)


def ellipsoid(bm, center, radii, segs=12, rings=8, up=None):
    geom = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    rot = Matrix.Identity(3)
    if up is not None:
        rot = Vector((0, 1, 0)).rotation_difference(Vector(up).normalized()).to_matrix()
    c, r = Vector(center), Vector(radii)
    for v in geom["verts"]:
        g = Vector((v.co.x * r.x, v.co.z * r.y, v.co.y * r.z))
        v.co = B(rot @ g + c)


def torus(bm, center, R, r, segs=16, csegs=6, zscale=1.0, tilt=0.0):
    c = Vector(center)
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        d = Vector((math.sin(a), 0, math.cos(a) * zscale))
        ring = []
        for j in range(csegs):
            b = 2 * math.pi * j / csegs
            p = d * (R + r * math.cos(b)) + Vector((0, r * math.sin(b), 0))
            p.y += math.sin(a) * 0 + tilt * p.z
            ring.append(bm.verts.new(B(p + c)))
        rings.append(ring)
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        for j in range(csegs):
            k = (j + 1) % csegs
            bm.faces.new((r0[j], r0[k], r1[k], r1[j]))


def box(bm, center, size):
    geom = bmesh.ops.create_cube(bm, size=1.0)
    c, s = Vector(center), Vector(size)
    for v in geom["verts"]:
        v.co = B(Vector((v.co.x * s.x, v.co.z * s.y, -v.co.y * s.z)) + c)


def part(name, region, build, weights, smooth=True):
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    groups = {n: ob.vertex_groups.new(name=n) for n in BONE_NAMES}
    for v in me.vertices:
        w = weights(G(v.co))
        tot = sum(w.values())
        for bn, x in sorted(w.items(), key=lambda kv: -kv[1])[:4]:
            if x / tot >= 0.05:
                groups[bn].add([v.index], x / tot, "REPLACE")
    PARTS.append((ob, region))
    return ob


def rigid(bn):
    return lambda p: {bn: 1.0}


def ramp(t, a, b):
    return min(1.0, max(0.0, (t - a) / (b - a)))


# ------------------------------------------------------------------ body parts (levy-topology-budgets.md proportions)

part("head", "skin", lambda bm: ellipsoid(bm, (0, 1.6285, 0.0), (0.106, 0.1215, 0.117), 14, 10), rigid("Head"))


def turban(bm):
    geom = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0)
    for v in geom["verts"]:
        g = Vector((v.co.x * 0.138, max(v.co.z, -0.15) * 0.112, v.co.y * 0.142))
        v.co = B(g + Vector((0, 1.662, -0.012)))
    for i, (y, R) in enumerate([(1.660, 0.124), (1.700, 0.118), (1.738, 0.098)]):
        torus(bm, (0, y, -0.012 - 0.008 * i), R, 0.022, 20, 6, 1.04, tilt=0.12 * (i - 1))


part("turban", "linen", turban, rigid("Head"))


def veil_w(p):
    if p.y > 1.55:
        return {"Head": 1.0}
    if p.y > 1.50:
        t = ramp(p.y, 1.50, 1.55)
        return {"Head": t, "Neck": 1 - t}
    w = {"Chest": 1.0}
    if p.z > 0.06:
        w["Veil_Front_02"] = 0.6
    return w


part("veil", "linen", lambda bm: lathe(bm, [(0.245, 1.425), (0.205, 1.455), (0.155, 1.495), (0.126, 1.535), (0.114, 1.575)], 24, 0.9, cz=0.005), veil_w)


def tail(bm):
    rows = 9
    rings = []
    for k in range(rows + 1):
        t = k / rows
        c = Vector((0, 1.62 + (1.273 - 1.62) * t, -0.135 + (-0.17 + 0.135) * t - 0.012))
        ring = [bm.verts.new(B(c + Vector(o))) for o in ((-0.035, 0, 0.006), (0.035, 0, 0.006), (0.035, 0, -0.006), (-0.035, 0, -0.006))]
        rings.append(ring)
    bridge(bm, rings)
    cap(bm, rings[-1])


def tail_w(p):
    t = ramp(p.y, 1.273, 1.62)
    if t > 0.66:
        return {"Wrap_Tail_01": 1.0}
    if t > 0.33:
        return {"Wrap_Tail_02": 1.0, "Wrap_Tail_01": max(0.0, t - 0.5)}
    return {"Wrap_Tail_03": 1.0, "Wrap_Tail_02": max(0.0, t - 0.2)}


part("tail", "linen", tail, tail_w)


def torso_w(p):
    y = p.y
    if y < 1.06:
        t = ramp(y, 0.97, 1.06)
        return {"Hips": 1 - t, "Spine_01": t}
    if y < 1.20:
        t = ramp(y, 1.06, 1.20)
        return {"Spine_01": 1 - t, "Spine_02": t}
    if y < 1.33:
        t = ramp(y, 1.20, 1.33)
        return {"Spine_02": 1 - t, "Chest": t}
    return {"Chest": 1.0}


part("torso", "tunic", lambda bm: lathe(bm, [(0.198, 0.976), (0.202, 1.074), (0.206, 1.213), (0.200, 1.332), (0.188, 1.408), (0.150, 1.453), (0.078, 1.489)], 20, 0.8, caps=(False, True)), torso_w)

SKIRT_CHAINS = {"FL": 30, "SL": 90, "BL": 150, "BR": 210, "SR": 270, "FR": 330}


def skirt(bm):
    prof = [(0.206, 1.000), (0.215, 0.935), (0.245, 0.870), (0.278, 0.805), (0.305, 0.740), (0.330, 0.675), (0.352, 0.610), (0.370, 0.544)]
    lathe(bm, prof, 28, 0.8)
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.008)


def skirt_w(p):
    ang = math.degrees(math.atan2(p.x, p.z / 0.8)) % 360
    names = list(SKIRT_CHAINS)
    angs = list(SKIRT_CHAINS.values())
    i = max(k for k in range(6) if angs[k] <= ang) if ang >= angs[0] else 5
    j = (i + 1) % 6
    span = (angs[j] - angs[i]) % 360
    f = ((ang - angs[i]) % 360) / span
    t = ramp(p.y, 0.544, 1.0)
    w = {}
    if t > 0.87:
        return {"Hips": 1.0}
    lvl = 1 if t > 0.58 else (2 if t > 0.29 else 3)
    for n, k in ((names[i], 1 - f), (names[j], f)):
        c, s = n[0], n[1]
        w[f"Skirt_{c}{s}_0{lvl}"] = w.get(f"Skirt_{c}{s}_0{lvl}", 0) + k
    if lvl == 1:
        w["Hips"] = ramp(t, 0.58, 0.87)
    return w


part("skirt", "tunic", skirt, skirt_w)
part("belt", "belt", lambda bm: lathe(bm, [(0.214, 0.994), (0.216, 1.018), (0.214, 1.041)], 24, 0.82), lambda p: {"Hips": 0.5, "Spine_01": 0.5})
part("buckle", "buckle", lambda bm: box(bm, (0, 1.018, 0.181), (0.055, 0.042, 0.012)), lambda p: {"Hips": 0.5, "Spine_01": 0.5}, smooth=False)
part("pouch", "belt", lambda bm: box(bm, (0.170, 0.930, 0.150), (0.100, 0.125, 0.060)), rigid("Pouch"), smooth=False)

for s, k in SIDE.items():
    sh, el, wr = Vector((k * 0.209, 1.436, 0)), Vector((k * 0.441, 1.204, 0)), Vector((k * 0.646, 0.999, 0.078))

    def upper_w(p, s=s, sh=sh, el=el):
        t = ramp((p - sh).dot((el - sh).normalized()), 0, (el - sh).length)
        return {f"UpperArm_{s}": 1 - 0.5 * t, f"UpperArm_Twist_{s}": 0.5 * t}

    def fore_w(p, s=s, el=el, wr=wr):
        t = ramp((p - el).dot((wr - el).normalized()), 0, (wr - el).length)
        return {f"Forearm_{s}": 1 - 0.5 * t, f"Forearm_Twist_{s}": 0.5 * t}

    part(f"roll_{s}", "sleeve", lambda bm, k=k: ellipsoid(bm, (k * 0.218, 1.442, 0), (0.088, 0.078, 0.082), 12, 8), lambda p, s=s: {f"UpperArm_{s}": 0.5, "Chest": 0.5})
    part(f"upper_{s}", "sleeve", lambda bm, sh=sh, el=el: tube(bm, sh, el, 0.074, 0.064, 12, 4, caps=False), upper_w)
    part(f"elbow_{s}", "sleeve", lambda bm, el=el: ellipsoid(bm, el, (0.064, 0.064, 0.064), 10, 6), lambda p, s=s: {f"UpperArm_{s}": 0.5, f"Forearm_{s}": 0.5})
    part(f"fore_{s}", "sleeve", lambda bm, el=el, wr=wr: tube(bm, el, wr, 0.062, 0.050, 10, 3, caps=False), fore_w)

    def bindings(bm, sh=sh, el=el):
        d = el - sh
        for t in (0.30, 0.55, 0.80):
            c = sh + d * t
            ring_a = ring_verts(bm, c - d.normalized() * 0.008, d, 0.077 - 0.01 * t, 10)
            ring_b = ring_verts(bm, c + d.normalized() * 0.008, d, 0.077 - 0.01 * t, 10)
            bridge(bm, [ring_a, ring_b])

    part(f"bind_{s}", "binding", bindings, upper_w)
    part(f"cuff_{s}", "sleeve", lambda bm, el=el, wr=wr: tube(bm, wr - (wr - el).normalized() * 0.03, wr, 0.056, 0.056, 10, 1, caps=False), fore_w)
    hand_dir = Vector((k * 0.140, -0.144, 0.042))
    part(f"hand_{s}", "skin", lambda bm, wr=wr, hand_dir=hand_dir: ellipsoid(bm, wr + hand_dir * 0.48, (0.048, 0.078, 0.034), 10, 7, up=hand_dir), lambda p, s=s: {f"Hand_{s}": 0.7, f"Fingers_01_{s}": 0.3})
    part(f"thumb_{s}", "skin", lambda bm, k=k: ellipsoid(bm, (k * 0.672, 0.975, 0.130), (0.020, 0.032, 0.020), 8, 5, up=(k * 0.3, -0.3, 1)), lambda p, s=s: {f"Thumb_01_{s}": 1.0})

    hip, knee, ankle = Vector((k * 0.109, 0.913, 0)), Vector((k * 0.109, 0.495, 0.018)), Vector((k * 0.109, 0.091, 0))

    def thigh_w(p, s=s):
        t = ramp(p.y, 0.80, 0.93)
        return {f"Thigh_{s}": 1 - 0.4 * t, "Hips": 0.4 * t}

    part(f"thigh_{s}", "trousers", lambda bm, hip=hip, knee=knee: tube(bm, hip + Vector((0, 0.04, 0)), knee, 0.100, 0.074, 10, 3, caps=False), thigh_w)
    part(f"knee_{s}", "trousers", lambda bm, knee=knee: ellipsoid(bm, knee, (0.072, 0.072, 0.072), 10, 6), lambda p, s=s: {f"Thigh_{s}": 0.5, f"Calf_{s}": 0.5})
    shin_at = lambda y, knee=knee, ankle=ankle: knee + (ankle - knee) * ((knee.y - y) / (knee.y - ankle.y))
    part(f"shin_{s}", "trousers", lambda bm: tube(bm, knee, shin_at(0.363), 0.070, 0.066, 10, 2, caps=False), rigid(f"Calf_{s}"))
    part(f"wrap_{s}", "wrap", lambda bm: tube(bm, shin_at(0.363), shin_at(0.300), 0.071, 0.069, 10, 2, caps=False), rigid(f"Calf_{s}"))
    part(f"wraptail_{s}", "wrap", lambda bm, k=k: box(bm, (k * 0.150, 0.315, -0.02), (0.012, 0.090, 0.035)), rigid(f"LegWrap_Tail_{s}"), smooth=False)

    def boot_w(p, s=s):
        t = ramp(p.y, 0.08, 0.16)
        return {f"Calf_{s}": t, f"Foot_{s}": 1 - t}

    part(f"bootshaft_{s}", "boots", lambda bm: tube(bm, shin_at(0.300), Vector((k * 0.109, 0.075, 0.0)), 0.068, 0.064, 10, 3, caps=False), boot_w)
    part(f"bootcuff_{s}", "boots", lambda bm, k=k: torus(bm, (k * 0.109, 0.300, 0.012), 0.070, 0.014, 12, 5), rigid(f"Calf_{s}"))

    def foot_w(p, s=s):
        t = ramp(p.z, 0.07, 0.13)
        return {f"Foot_{s}": 1 - t, f"Toe_{s}": t}

    part(f"foot_{s}", "boots", lambda bm, k=k: ellipsoid(bm, (k * 0.109, 0.048, 0.058), (0.052, 0.050, 0.112), 10, 6), foot_w)
    part(f"sole_{s}", "boots", lambda bm, k=k: box(bm, (k * 0.109, 0.006, 0.058), (0.100, 0.012, 0.222)), foot_w, smooth=False)

# ------------------------------------------------------------------ pitchfork (levy-weapon.md), built in its own local frame: +Y shaft -> tines, tines along X

F_ORIGIN = Vector((-0.686, 0.959, 0.093))


def frame_matrix(origin_g, dir_g):
    """Blender world matrix for a frame whose local +Y is dir_g (glTF) and local X stays horizontal."""
    y = B(Vector(dir_g)).normalized()
    x = y.cross(Vector((0, 0, 1)))
    x = x.normalized() if x.length > 1e-6 else Vector((1, 0, 0))
    z = x.cross(y).normalized()
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = B(Vector(origin_g))
    return m


FORK_BIND = frame_matrix(F_ORIGIN, (0, 0, 1))


def fork_geo(bm):
    def lt(p0, p1, r0, r1, segs, caps=True):
        tube(bm, B_inv(p0), B_inv(p1), r0, r1, segs, 1, caps)

    tube(bm, (0, -0.4625, 0), (0, 0.98, 0), 0.016, 0.016, 8, 6)
    tube(bm, (0, 0.975, 0), (0, 1.05, 0), 0.020, 0.018, 8, 1)
    for x in (-0.09, 0.0, 0.09):
        tube(bm, (x * 0.4, 1.05, 0), (x, 1.0875, 0), 0.008, 0.008, 6, 1)
        tube(bm, (x, 1.0875, 0), (x, 1.3875, 0), 0.007, 0.0015, 6, 3)
    tube(bm, (-0.09, 1.0875, 0), (0.09, 1.0875, 0), 0.009, 0.009, 6, 1)


def B_inv(v):
    return Vector(v)


def fork_local_part(name, region, build):
    """Geometry authored directly in Blender-local axes of the fork frame (x spread, y shaft, z up)."""
    bm = bmesh.new()
    # tube/ring helpers convert glTF->Blender; undo that so the input coords are fork-local Blender coords.
    global B
    saved = B
    B = lambda x, y=None, z=None: Vector(x) if y is None else Vector((x, y, z))
    try:
        build(bm)
    finally:
        B = saved
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


fork = fork_local_part("SM_Levy_Pitchfork_LOD0", "fork", fork_geo)

# ------------------------------------------------------------------ UVs into atlas rects (levy-materials-textures.md section 3, simplified per color)

RECTS = {
    "tunic": (0, 0, 512, 784),
    "linen": (512, 0, 464, 272),
    "sleeve": (512, 272, 372, 248),
    "binding": (884, 272, 92, 248),
    "trousers": (512, 520, 325, 168),
    "wrap": (837, 520, 139, 168),
    "boots": (512, 688, 240, 336),
    "skin": (752, 688, 224, 144),
    "belt": (0, 784, 200, 208),
    "buckle": (200, 784, 56, 208),
    "fork_iron": (752, 832, 224, 192),
    "fork_wood": (976, 0, 48, 1024),
}
PAD = 8


def unwrap(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def place(ob, region, sel=None):
    x, y, w, h = RECTS[region]
    x, y, w, h = x + PAD, y + PAD, w - 2 * PAD, h - 2 * PAD
    uv = ob.data.uv_layers.active.data
    for poly in ob.data.polygons:
        if sel is not None and not sel(poly):
            continue
        for li in poly.loop_indices:
            u, v = uv[li].uv
            px, py = x + u * w, y + (1 - v) * h
            uv[li].uv = (px / ATLAS, 1 - py / ATLAS)


for ob, region in PARTS:
    unwrap(ob)
    place(ob, region)

unwrap(fork)
fork_mid = lambda poly: fork.data.vertices[fork.data.loops[poly.loop_start].vertex_index].co.y < 0.975
uv = fork.data.uv_layers.active.data
placed = set()
place(fork, "fork_wood", fork_mid)
place(fork, "fork_iron", lambda poly: not fork_mid(poly))

# ------------------------------------------------------------------ material + textures

mat = bpy.data.materials.new("M_Levy")
mat.use_nodes = True
for ob, _ in PARTS:
    ob.data.materials.append(mat)
fork.data.materials.append(mat)

PALETTE = {  # sRGB albedo, roughness, metallic, team mask (levy-art-direction.md palette)
    "tunic": (0x6E6E4C, 0.88, 0.0, 0),
    "linen": (0xE2D8BE, 0.82, 0.0, 0),
    "sleeve": (0xF0F0F0, 0.82, 0.0, 1),
    "binding": (0xE2D8BE, 0.82, 0.0, 0),
    "trousers": (0x4A3E30, 0.90, 0.0, 0),
    "wrap": (0xE2D8BE, 0.82, 0.0, 0),
    "boots": (0x3E2A1C, 0.68, 0.0, 0),
    "skin": (0xC89878, 0.65, 0.0, 0),
    "belt": (0x4A3020, 0.68, 0.0, 0),
    "buckle": (0x8E7440, 0.50, 0.9, 0),
    "fork_iron": (0x7E8288, 0.50, 0.9, 0),
    "fork_wood": (0xA87A48, 0.72, 0.0, 0),
}
rng = np.random.default_rng(7)


def noise(h, w, cell, amp):
    gh, gw = h // cell + 2, w // cell + 2
    g = rng.uniform(-1, 1, (gh, gw))
    ys, xs = np.arange(h) / cell, np.arange(w) / cell
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx
    b = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx
    return (a * (1 - fy) + b * fy) * amp


albedo = np.zeros((ATLAS, ATLAS, 4), np.float32)
orm = np.zeros((ATLAS, ATLAS, 4), np.float32)
orm[..., 0] = 1.0
orm[..., 1] = 0.85
orm[..., 3] = 1.0
albedo[..., :3] = 0.5
albedo[..., 3] = 0.0
for region, (x, y, w, h) in RECTS.items():
    hexc, rough, metal, mask = PALETTE[region]
    base = np.array([(hexc >> 16) & 255, (hexc >> 8) & 255, hexc & 255], np.float32) / 255
    shade = 1 + noise(h, w, 24, 0.05) + noise(h, w, 6, 0.025)
    shade -= np.linspace(0, 0.08, h)[:, None]
    if region == "tunic":
        shade -= 0.06 * (np.sin(np.arange(w) / w * 2 * math.pi * 40) > 0.6)[None, :]
    if region == "fork_wood":
        shade += noise(h, w, 3, 0.04) * 0 + (rng.uniform(-0.04, 0.04, w))[None, :]
    albedo[y : y + h, x : x + w, :3] = np.clip(base[None, None, :] * shade[..., None], 0, 0.94)
    albedo[y : y + h, x : x + w, 3] = mask
    orm[y : y + h, x : x + w, 0] = np.clip(0.92 + noise(h, w, 16, 0.06), 0, 1)
    orm[y : y + h, x : x + w, 1] = np.clip(rough + noise(h, w, 12, 0.04), 0, 1)
    orm[y : y + h, x : x + w, 2] = metal
normal = np.zeros((ATLAS, ATLAS, 4), np.float32)
normal[..., 0] = 0.5
normal[..., 1] = 0.5
normal[..., 2] = 1.0
normal[..., 3] = 1.0


def save(name, arr, alpha, colorspace):
    img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=alpha)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).ravel())
    img.filepath_raw = os.path.join(OUT, name + ".png")
    img.file_format = "PNG"
    img.save()
    return img


base_img = save("T_Levy_BaseColor", albedo, True, "sRGB")
save("T_Levy_Normal", normal, False, "Non-Color")
save("T_Levy_ORM", orm, False, "Non-Color")
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = base_img
mat.node_tree.links.new(tex.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])

# ------------------------------------------------------------------ join body, skin, parent the fork

for o in bpy.context.view_layer.objects:
    o.select_set(False)
for ob, _ in PARTS:
    ob.select_set(True)
body = PARTS[0][0]
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = body.data.name = "SM_Levy_Body_LOD0"
body.parent = rig
mod = body.modifiers.new("Armature", "ARMATURE")
mod.object = rig


def bone_child(ob, matrix_world):
    ob.parent = rig
    ob.parent_type = "BONE"
    ob.parent_bone = "Weapon_R"
    bpy.context.view_layer.update()
    ob.matrix_world = matrix_world


pivot = bpy.data.objects.new("Levy_Pitchfork", None)
scene.collection.objects.link(pivot)
bone_child(pivot, FORK_BIND)
fork.parent = pivot
fork.matrix_parent_inverse = Matrix.Identity(4)
fork.matrix_basis = Matrix.Identity(4)
for name, y in (("Grip_L", 0.555), ("Tip", 1.3875), ("Butt", -0.4625)):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.parent = pivot
    e.location = (0, y, 0)

# ------------------------------------------------------------------ animation: weapon controller W + arm IK, FK body, baked to bones

bpy.context.view_layer.update()
W = bpy.data.objects.new("CTRL_Weapon", None)
scene.collection.objects.link(W)
W.rotation_mode = "QUATERNION"
W.matrix_world = FORK_BIND


def tail_matrix(bn):
    pb = rig.pose.bones[bn]
    m = rig.matrix_world @ pb.matrix
    m = m.copy()
    m.translation = rig.matrix_world @ pb.tail
    return m


bpy.context.view_layer.update()
hand_r_t = bpy.data.objects.new("IK_Hand_R", None)
scene.collection.objects.link(hand_r_t)
hand_r_t.parent = W
hand_r_t.matrix_parent_inverse = Matrix.Identity(4)
hand_r_t.matrix_basis = FORK_BIND.inverted() @ tail_matrix("Hand_R")
hand_l_t = bpy.data.objects.new("IK_Hand_L", None)
scene.collection.objects.link(hand_l_t)
hand_l_t.parent = W
hand_l_t.location = (0.0, 0.555, 0.0)

for s, tgt, use_rot in (("R", hand_r_t, True), ("L", hand_l_t, False)):
    c = rig.pose.bones[f"Hand_{s}"].constraints.new("IK")
    c.target = tgt
    c.chain_count = 3
    c.use_rotation = use_rot
for pb in rig.pose.bones:
    pb.rotation_mode = "XYZ"

FK = ["Hips", "Spine_01", "Spine_02", "Chest", "Neck", "Head", "Thigh_L", "Calf_L", "Foot_L", "Thigh_R", "Calf_R", "Foot_R"]
# Bone-local Euler XYZ (rest roll 0): spine +X leans forward, +Y turns to the character's left; legs -X swings forward, calf +X bends the knee.
# Hips location is bone-local: (x, up, forward).

GUARD = {
    "hips": ((0, -0.03, 0.0), (0.0, -0.30, 0.0)),
    "Spine_01": (0.08, 0.05, 0), "Spine_02": (0.05, 0.05, 0), "Chest": (0.0, 0.08, 0),
    "Thigh_L": (-0.35, 0.10, 0), "Calf_L": (0.30, 0, 0), "Foot_L": (0.05, 0, 0),
    "Thigh_R": (0.25, 0.10, 0), "Calf_R": (0.25, 0, 0), "Foot_R": (-0.15, 0, 0),
    "W": ((-0.15, 1.00, -0.05), (0.15, 0.20, 0.97)),
}


def merge(base, **over):
    d = dict(base)
    d.update(over)
    return d


def key_pose(f, pose, linear=False):
    hips_loc, hips_rot = pose["hips"]
    pb = rig.pose.bones["Hips"]
    pb.location = hips_loc
    pb.rotation_euler = hips_rot
    pb.keyframe_insert("location", frame=f)
    pb.keyframe_insert("rotation_euler", frame=f)
    for bn in FK[1:]:
        pb = rig.pose.bones[bn]
        pb.rotation_euler = pose.get(bn, (0, 0, 0))
        pb.keyframe_insert("rotation_euler", frame=f)
    grip, d = pose["W"]
    m = frame_matrix(grip, d)
    q = m.to_quaternion()
    if W.rotation_quaternion.dot(q) < 0:
        q.negate()
    W.location = m.translation
    W.rotation_quaternion = q
    W.keyframe_insert("location", frame=f)
    W.keyframe_insert("rotation_quaternion", frame=f)
    if linear:
        for ob in (rig, W):
            for fc in ob.animation_data.action.fcurves:
                for kp in fc.keyframe_points:
                    if kp.co.x == f:
                        kp.interpolation = "LINEAR"


def mirror_legs(p):
    q = dict(p)
    for a, b in (("Thigh_L", "Thigh_R"), ("Calf_L", "Calf_R"), ("Foot_L", "Foot_R")):
        q[a], q[b] = p.get(b, (0, 0, 0)), p.get(a, (0, 0, 0))
    return q


def walk_key(phase, up):
    lift = 0.0 if up else -0.03
    p = {
        "hips": ((0, lift - 0.01, 0), (0, 0.08 if phase == 0 else -0.08, 0)),
        "Spine_01": (0.06, 0, 0), "Chest": (0, -0.06 if phase == 0 else 0.06, 0),
        "W": ((-0.20, 0.97 + lift, 0.02), (0.35, 0.75, 0.55)),
    }
    if up:
        p.update({"Thigh_L": (0.0, 0, 0), "Calf_L": (0.15, 0, 0), "Thigh_R": (-0.15, 0, 0), "Calf_R": (0.95, 0, 0), "Foot_R": (-0.2, 0, 0)})
    else:
        p.update({"Thigh_L": (-0.45, 0, 0), "Calf_L": (0.10, 0, 0), "Foot_L": (0.15, 0, 0), "Thigh_R": (0.35, 0, 0), "Calf_R": (0.25, 0, 0), "Foot_R": (-0.25, 0, 0)})
    return mirror_legs(p) if phase == 1 else p


COCKED = merge(GUARD, hips=((0, -0.05, -0.02), (0, -0.55, 0)), Chest=(0, -0.15, 0), Thigh_R=(0.35, 0.10, 0), Calf_R=(0.40, 0, 0),
               W=((-0.20, 1.02, -0.30), (0.15, 0.15, 0.98)))
IMPACT = merge(GUARD, hips=((0, -0.07, 0.12), (0, 0.05, 0)), Spine_01=(0.15, 0.05, 0), Spine_02=(0.10, 0.05, 0), Chest=(0, 0.15, 0),
               Thigh_L=(-0.60, 0.05, 0), Calf_L=(0.55, 0, 0), Foot_L=(0.05, 0, 0), Thigh_R=(0.45, 0.05, 0), Calf_R=(0.05, 0, 0), Foot_R=(-0.35, 0, 0),
               W=((-0.06, 1.12, 0.20), (0.05, 0.03, 1.0)))

CLIPS = {
    "Idle_Guard": (60, [(0, GUARD), (30, merge(GUARD, hips=((0, -0.04, 0), (0, -0.30, 0)), Chest=(0.02, 0.08, 0), W=((-0.15, 0.99, -0.05), (0.15, 0.19, 0.97)))), (60, GUARD)]),
    "Walk_Carry": (32, [(0, walk_key(0, False)), (8, walk_key(0, True)), (16, walk_key(1, False)), (24, walk_key(1, True)), (32, walk_key(0, False))]),
    "Thrust_High": (19, [
        (0, GUARD),
        (2, merge(GUARD, hips=((0, -0.05, 0), (0, -0.32, 0)))),
        (6, COCKED),
        (8, merge(COCKED, hips=((0, -0.06, 0.05), (0, -0.20, 0)), W=((-0.12, 1.08, 0.0), (0.10, 0.08, 1.0)))),
        (9, IMPACT),
        (11, merge(IMPACT, W=((-0.05, 1.12, 0.26), (0.05, 0.03, 1.0)))),
        (12, merge(IMPACT, W=((-0.06, 1.12, 0.22), (0.05, 0.03, 1.0)))),
        (14, merge(IMPACT, W=((-0.06, 1.11, 0.22), (0.05, 0.04, 1.0)))),
        (16, merge(GUARD, hips=((0, -0.04, 0.04), (0, -0.20, 0)), W=((-0.11, 1.04, 0.05), (0.12, 0.15, 0.98)))),
        (19, GUARD),
    ]),
    "Death_Back": (36, [
        (0, GUARD),
        (6, merge(GUARD, hips=((0, -0.04, -0.06), (-0.10, -0.30, 0)), Spine_01=(-0.20, 0, 0), Chest=(-0.10, 0, 0), W=((-0.18, 1.08, -0.08), (0.2, 0.45, 0.87)))),
        (14, merge(GUARD, hips=((0, -0.35, -0.08), (-0.20, -0.25, 0)), Spine_01=(-0.30, 0, 0), Thigh_L=(-0.90, 0, 0), Calf_L=(1.40, 0, 0), Thigh_R=(-0.80, 0, 0), Calf_R=(1.30, 0, 0),
                   W=((-0.25, 0.70, -0.15), (0.3, 0.3, 0.9)))),
        (24, merge(GUARD, hips=((0, -0.75, -0.35), (-1.20, -0.20, 0)), Spine_01=(-0.20, 0, 0), Thigh_L=(-1.20, 0, 0), Calf_L=(0.60, 0, 0), Thigh_R=(-1.10, 0, 0), Calf_R=(0.70, 0, 0),
                   W=((-0.35, 0.25, -0.30), (0.3, 0.0, 1.0)))),
        (36, merge(GUARD, hips=((0, -0.80, -0.40), (-1.45, -0.20, 0)), Spine_01=(-0.10, 0, 0), Head=(-0.20, 0.3, 0), Thigh_L=(-1.30, 0, 0), Calf_L=(0.40, 0, 0), Thigh_R=(-1.20, 0, 0), Calf_R=(0.50, 0, 0),
                   W=((-0.40, 0.12, -0.35), (0.3, 0.0, 1.0)))),
    ]),
}
LINEAR = {"Thrust_High": {6, 8}}

rig.animation_data_create()
W.animation_data_create()
baked = []
for name, (length, keys) in CLIPS.items():
    rig.animation_data.action = bpy.data.actions.new(f"src_{name}")
    W.animation_data.action = bpy.data.actions.new(f"src_W_{name}")
    for f, pose in keys:
        key_pose(f, pose, f in LINEAR.get(name, ()))
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(frame_start=0, frame_end=length, step=1, only_selected=True, visual_keying=True, clear_constraints=False,
                     use_current_action=False, bake_types={"POSE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    act = rig.animation_data.action
    act.name = name
    act.use_fake_user = True
    baked.append(act)
    for a in list(bpy.data.actions):
        if a.name.startswith("src_"):
            bpy.data.actions.remove(a)

# ------------------------------------------------------------------ previews (optional sanity renders)

if os.environ.get("LEVY_PREVIEW"):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = B(2.6, 1.4, 2.6)
    cam.rotation_euler = (B(0, 0.85, 0) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.8, 0.2, 0.6)
    base_img.alpha_mode = "NONE"
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x, scene.render.resolution_y = 480, 480
    for act in baked:
        rig.animation_data.action = act
        for f in sorted({0, int(act.frame_range[1] // 2), 9 if act.name == "Thrust_High" else int(act.frame_range[1])}):
            scene.frame_set(f)
            scene.render.filepath = os.path.join(OUT, f"preview_{act.name}_{f:02d}.png")
            bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)

# ------------------------------------------------------------------ strip controls, export

for s in ("R", "L"):
    pb = rig.pose.bones[f"Hand_{s}"]
    for c in list(pb.constraints):
        pb.constraints.remove(c)
for ob in (hand_r_t, hand_l_t, W):
    bpy.data.objects.remove(ob)
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_euler = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.scale = (1, 1, 1)
scene.frame_set(0)

for ob in (body, fork):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(ob.data)
    bm.free()

tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
ftris = sum(len(p.vertices) - 2 for p in fork.data.polygons)
print(f"LEVY_TRIS body={tris} fork={ftris}")

bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "levy_src.gltf"),
    export_format="GLTF_SEPARATE",
    export_image_format="NONE",
    export_yup=True,
    export_apply=False,
    export_texcoords=True,
    export_normals=True,
    export_tangents=True,
    export_materials="EXPORT",
    export_skins=True,
    export_all_influences=False,
    export_def_bones=True,
    export_morph=False,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_cameras=False,
    export_lights=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "levy_build.blend"))
print("LEVY_EXPORT_OK", OUT)
