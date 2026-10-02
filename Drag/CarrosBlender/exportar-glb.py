# Converte os .blend do Blend Swap em .glb prontos para o jogo (wwwroot/arrancada/modelos/).
#
# Uso (na raiz do projeto):
#   blender -b "D:/DevGAmes/Ferramentas/blendModels/cars/BMW M4 F82/BMW_M4_(20)_blendswap.blend" --python Drag/CarrosBlender/exportar-glb.py -- bmw-m4
#   blender -b "D:/DevGAmes/Ferramentas/blendModels/cars/Ford Mustang/ford cycles.blend"         --python Drag/CarrosBlender/exportar-glb.py -- mustang-s197
#   (os .blend originais e as licenças do Blend Swap ficam fora do projeto, em D:/DevGAmes/Ferramentas/blendModels/cars)
#
# O que o script faz:
#   1. Remove câmeras, chão, luzes e objetos ocultos; limita a subdivisão (orçamento de triângulos).
#   2. Aplica todos os modificadores (espelho, subdivisão, solidificar, array...).
#   3. Gira/escala para o padrão do jogo: frente em +X, lado direito em -Y do Blender (+Z no Three.js),
#      tamanho real em metros e pneus encostando no chão (z = 0).
#   4. Junta a carroceria num único objeto (uma primitiva por material) e separa UMA roda centrada no cubo.
#   5. Exporta .glb com compressão Draco e um .json com medidas (eixos, bitola, roda, escapes).
import bpy, bmesh, json, math, os, sys
from mathutils import Matrix, Vector

CARS = {
    'bmw-m4': {
        'length': 4.67,                 # comprimento real (m)
        'front': '-Y',                  # para onde a frente aponta no .blend
        'delete': ['Camera', 'Camera.001', 'Ground', 'Windscreen_for_lattice',
                   'Duplication_Plane_Tyre', 'Duplication_Plane_Tyre_2', 'Duplication_Plane_Tyre_3'],
        'wheel': ['Tyre', 'Rim', 'Rim_cap'],          # peças da roda modelo (gira)
        'wheel_static': [],                            # pinças etc. (não giram)
        'tire': 'Tyre',
        'other_wheels': [],                            # rodas extras a remover (o jogo clona a modelo)
        'rear_axle_from': 'Duplication_Plane_Tyre',    # objeto cujo centro marca o eixo traseiro
        'exhausts': ['Cylinder'],
        'max_subsurf': 1,
    },
    'mustang-s197': {
        'length': 4.78,
        'front': '-X',
        'delete': ['Camera', 'Camera.001', 'Plane', 'Plane.002', 'dof1', 'dof2', 'tuercas', 'tuercas.002'],
        'wheel': ['Cylinder.018', 'Cylinder.003', 'Cylinder.004', 'Cylinder.002', 'tuercas.003'],
        'wheel_static': ['Cube.004'],
        'tire': 'Cylinder.018',
        'other_wheels': ['Cylinder.001', 'Cylinder.007', 'Cylinder.005', 'Cylinder.006', 'tuercas.001', 'Cube.000'],
        'rear_axle_from': 'Cylinder.001',
        'exhausts': ['Cube.002', 'Cube.003'],
        'max_subsurf': 1,
        # Peças que dividem material com outras: grade preta (era alumínio) e piscas âmbar (era lanterna).
        # O vidro do retrovisor direito não tinha material.
        'overrides': {'parrilla': 'negro', 'luz direccional f': 'ambar', 'luz direccional frent': 'ambar',
                      'espejo': 'espejos'},
        # Vidro do retrovisor esquerdo modelado virado para a frente (some visto de trás).
        'flip': ['espejo.001'],
    },
}

car_id = sys.argv[sys.argv.index('--') + 1]
cfg = CARS[car_id]
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
out_dir = os.path.join(root, 'wwwroot', 'arrancada', 'modelos')
os.makedirs(out_dir, exist_ok=True)


def world_bbox(obs):
    pts = [ob.matrix_world @ Vector(c) for ob in obs for c in ob.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def select_only(obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


scene = bpy.context.scene
objs = bpy.data.objects

# Camadas antigas (2.7x) viram coleções fora da View Layer. Fica só o que aparece no render,
# mais as peças de roda listadas (às vezes moram numa camada oculta só para servir de modelo).
keep = {n for n in cfg['wheel'] + cfg['wheel_static'] + cfg['other_wheels'] + [cfg['rear_axle_from']] + cfg['exhausts']}
visible = {ob.name for ob in scene.objects if ob.visible_get()}
for ob in list(objs):
    if ob.name in keep and ob.name not in scene.collection.objects:
        scene.collection.objects.link(ob)
    elif ob.name not in keep and ob.name not in visible:
        objs.remove(ob, do_unlink=True)

# Medidas tiradas antes de mexer na geometria.
tire = objs[cfg['tire']]
tmn, tmx = world_bbox([tire])
hub = (tmn + tmx) / 2
rear_ref = objs[cfg['rear_axle_from']]
rmn, rmx = world_bbox([rear_ref])
rear_center = (rmn + rmx) / 2

# Troca o material de objetos específicos (cria o material se não existir).
for obname, matname in cfg.get('overrides', {}).items():
    ob = objs.get(obname)
    if not ob:
        continue
    mat = bpy.data.materials.get(matname) or bpy.data.materials.new(matname)
    if not ob.material_slots:
        ob.data.materials.append(mat)
    for slot in ob.material_slots:
        slot.link = 'OBJECT'
        slot.material = mat

# ---------- 1. Limpeza ----------
for name in cfg['delete']:
    if name in objs:
        objs.remove(objs[name], do_unlink=True)
for ob in list(objs):
    if ob.type in ('CAMERA', 'LIGHT', 'EMPTY') and ob.name not in cfg['delete']:
        objs.remove(ob, do_unlink=True)
    elif ob.hide_render:
        objs.remove(ob, do_unlink=True)
for ob in objs:
    ob.hide_set(False)
    ob.hide_viewport = False
    for m in ob.modifiers:
        if m.type == 'SUBSURF':
            m.levels = min(m.levels, cfg['max_subsurf'])
            m.render_levels = m.levels

for name in cfg['other_wheels']:
    if name in objs:
        objs.remove(objs[name], do_unlink=True)

# ---------- 2. Aplica modificadores ----------
meshes = [ob for ob in objs if ob.type in ('MESH', 'CURVE', 'SURFACE', 'FONT', 'META')]
for ob in meshes:
    select_only([ob])
    bpy.ops.object.convert(target='MESH')
meshes = [ob for ob in objs if ob.type == 'MESH']
for ob in meshes:
    if ob.data.users > 1:
        ob.data = ob.data.copy()

# ---------- 3. Orientação, escala e chão ----------
rot = {'-Y': Matrix.Rotation(math.radians(90), 4, 'Z'),
       '+Y': Matrix.Rotation(math.radians(-90), 4, 'Z'),
       '-X': Matrix.Rotation(math.radians(180), 4, 'Z'),
       '+X': Matrix.Identity(4)}[cfg['front']]
# Peças espelhadas com escala negativa (ex.: lateral esquerda do Mustang = cópia da direita com escala -1):
# o Blender desenha as duas faces, mas o glTF/Three.js descarta a face de trás. Depois de aplicar a
# transformação, inverte a ordem dos vértices dessas peças (e das listadas em 'flip') para as normais
# voltarem a apontar para fora.
mirrored = [ob for ob in meshes if ob.matrix_world.determinant() < 0]
mirrored += [objs[n] for n in cfg.get('flip', []) if n in objs and objs[n] not in mirrored]
body_obs = [ob for ob in meshes if ob.name not in cfg['wheel'] + cfg['wheel_static']]
bmn, bmx = world_bbox(body_obs)
length_now = max((bmx - bmn).x, (bmx - bmn).y)   # o comprimento é a maior medida horizontal
scale = cfg['length'] / length_now
M = Matrix.Scale(scale, 4) @ rot
for ob in meshes:
    ob.matrix_world = M @ ob.matrix_world
select_only(meshes)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for ob in mirrored:
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
print('ESPELHADAS', len(mirrored), sorted(ob.name for ob in mirrored))

hub = M @ hub
rear_center = M @ rear_center
tmn, tmx = world_bbox([objs[cfg['tire']]])
ground = tmn.z
center_x = (world_bbox(body_obs)[0].x + world_bbox(body_obs)[1].x) / 2
shift = Vector((-center_x, 0, -ground))
for ob in meshes:
    ob.location += shift
select_only(meshes)
bpy.ops.object.transform_apply(location=True)
hub += shift
rear_center += shift

# ---------- 4. Roda modelo centrada no cubo ----------
wheel_obs = [objs[n] for n in cfg['wheel'] if n in objs]
static_obs = [objs[n] for n in cfg['wheel_static'] if n in objs]
tmn, tmx = world_bbox([objs[cfg['tire']]])
hub = (tmn + tmx) / 2
radius = (tmx.z - tmn.z) / 2
width = tmx.y - tmn.y


def strip_far(ob, center, limit):
    """Remove vértices perdidos longe da roda (alguns aros trazem geometria solta)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    far = [v for v in bm.verts if (v.co - center).length > limit]
    bmesh.ops.delete(bm, geom=far, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()


for ob in wheel_obs + static_obs:
    strip_far(ob, hub, radius * 1.25)

def join(obs, name):
    obs = [o for o in obs if o.name in bpy.context.view_layer.objects and o.type == 'MESH' and len(o.data.polygons)]
    if not obs:
        return None
    select_only(obs)
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob

wheel = join(wheel_obs, 'wheel')
caliper = join(static_obs, 'caliper')
for ob in [wheel, caliper]:
    if ob:
        for v in ob.data.vertices:
            v.co -= hub
        ob.location = (0, 0, 0)
# Lado da face externa: no Blender, -Y = lado direito do carro.
wheel_outer = 'right' if hub.y < 0 else 'left'

# Escapes: ponto mais traseiro de cada lado.
exhausts = []
for name in cfg['exhausts']:
    ob = objs.get(name)
    if not ob:
        continue
    for side in (-1, 1):
        vs = [ob.matrix_world @ v.co for v in ob.data.vertices if v.co.y * side > 0.02]
        if not vs:
            continue
        x = min(v.x for v in vs)
        c = sum((v for v in vs), Vector()) / len(vs)
        exhausts.append([round(x, 4), round(c.z, 4), round(-c.y, 4)])   # coordenadas do Three.js (x, y, z)

body_obs = [ob for ob in bpy.context.view_layer.objects if ob.type == 'MESH' and ob not in (wheel, caliper)]
body = join(body_obs, 'body')

# Sombreamento suave por ângulo (modelos antigos vêm com faces chapadas).
for ob in [body, wheel, caliper]:
    if ob:
        select_only([ob])
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35), keep_sharp_edges=True)

tris = {}
for ob in [body, wheel, caliper]:
    if ob:
        ob.data.calc_loop_triangles()
        tris[ob.name] = len(ob.data.loop_triangles)

bmn, bmx = world_bbox([body])
info = {
    'id': car_id,
    'length': round(bmx.x - bmn.x, 4),
    'width': round(bmx.y - bmn.y, 4),
    'height': round(bmx.z - bmn.z, 4),
    'frontAxle': round(hub.x, 4) if hub.x > rear_center.x else round(rear_center.x, 4),
    'rearAxle': round(rear_center.x, 4) if hub.x > rear_center.x else round(hub.x, 4),
    'trackHalf': round(abs(hub.y), 4),
    'wheelRadius': round(radius, 4),
    'wheelWidth': round(width, 4),
    'wheelOuter': wheel_outer,
    'hasCaliper': caliper is not None,
    'exhausts': exhausts,
    'materials': sorted({s.material.name for s in body.material_slots if s.material}),
    'wheelMaterials': sorted({s.material.name for s in wheel.material_slots if s.material}),
    'triangles': tris,
}
with open(os.path.join(out_dir, car_id + '.json'), 'w', encoding='utf-8') as f:
    json.dump(info, f, indent=2, ensure_ascii=False)

# ---------- 5. Exporta ----------
select_only([o for o in (body, wheel, caliper) if o])
bpy.ops.export_scene.gltf(
    filepath=os.path.join(out_dir, car_id + '.glb'),
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_yup=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
)
print('EXPORT_OK', json.dumps(info, ensure_ascii=False))
