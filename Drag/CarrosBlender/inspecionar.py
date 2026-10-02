# Lista objetos, modificadores, instâncias e medidas de um .blend.
# Uso: blender -b arquivo.blend --python inspecionar.py
import bpy
from mathutils import Vector

dg = bpy.context.evaluated_depsgraph_get()
tris_total = 0
print("=== CENA", bpy.data.filepath)
for ob in sorted(bpy.data.objects, key=lambda o: o.name):
    info = f"{ob.name!r:40} {ob.type:8} parent={ob.parent.name if ob.parent else '-':20}"
    info += f" vis={'H' if ob.hide_render else 'V'} inst={ob.instance_type}"
    if ob.modifiers:
        info += " mods=" + ",".join(f"{m.type}" for m in ob.modifiers)
    if ob.type == 'MESH':
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        tris_total += n
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        mats = ",".join(s.material.name for s in ob.material_slots if s.material)
        info += f" tris={n} min=({mn.x:.2f},{mn.y:.2f},{mn.z:.2f}) max=({mx.x:.2f},{mx.y:.2f},{mx.z:.2f}) mats=[{mats}]"
        ev.to_mesh_clear()
    print(info)
print("=== TRIANGULOS (avaliados)", tris_total)
print("=== INSTANCIAS no depsgraph:")
for inst in dg.object_instances:
    if inst.is_instance:
        print("  ", inst.instance_object.name, "de", inst.parent.name if inst.parent else "-", tuple(round(v, 2) for v in inst.matrix_world.translation))
print("=== IMAGENS:", [(i.name, i.filepath, i.packed_file is not None) for i in bpy.data.images])
