"""Debug: print evaluated bounds of the Levy body at rest and per clip frame. Run on out/levy_build.blend."""

import bpy
from mathutils import Vector

scene = bpy.context.scene
rig = bpy.data.objects["Levy_Rig"]
body = bpy.data.objects["SM_Levy_Body_LOD0"]
print("VGROUPS", len(body.vertex_groups), "VERTS", len(body.data.vertices))
unweighted = sum(1 for v in body.data.vertices if not v.groups)
print("UNWEIGHTED", unweighted)


def bounds(tag):
    dg = bpy.context.evaluated_depsgraph_get()
    me = body.evaluated_get(dg).to_mesh()
    xs = [body.matrix_world @ v.co for v in me.vertices]
    lo = Vector((min(p.x for p in xs), min(p.y for p in xs), min(p.z for p in xs)))
    hi = Vector((max(p.x for p in xs), max(p.y for p in xs), max(p.z for p in xs)))
    print(tag, "min", tuple(round(c, 3) for c in lo), "max", tuple(round(c, 3) for c in hi))
    body.evaluated_get(dg).to_mesh_clear()


rig.animation_data_create()
rig.animation_data.action = None
scene.frame_set(0)
bounds("REST")
tip = bpy.data.objects["Tip"]
hand = rig.pose.bones["Hand_R"]
for act in bpy.data.actions:
    rig.animation_data.action = act
    for f in (0, 6, 9, 12, 19):
        scene.frame_set(f)
        t = tip.matrix_world.translation
        h = rig.matrix_world @ hand.tail
        print(f"{act.name}@{f} tip", tuple(round(c, 3) for c in t), "handR", tuple(round(c, 3) for c in h))
