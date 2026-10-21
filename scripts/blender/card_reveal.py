# CardFlip "card reveal" v2 (10-16): the card arrives face-down (real Pokemon back), spins and flips to the front
# with a flash, shockwave and sparks; nebula + rotating light rays + floating sparkles with depth of field behind it;
# rainbow holo sweep on the card; the price counts up and lands with a burst and a camera shake.
# Run: blender.exe --background --python card_reveal.py -- <front png> <back png> <out dir> <name> <price> <change>
import bpy, bmesh, math, random, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
FRONT, BACK, OUT, NAME, PRICE, CHANGE = argv[0], argv[1], argv[2], argv[3], float(argv[4]), argv[5]
FONT_HEAVY, FONT_BOLD = r"C:\Windows\Fonts\seguibl.ttf", r"C:\Windows\Fonts\segoeuib.ttf"
FPS, FRAMES = 30, 240
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        sc.render.engine = eng; break
    except TypeError:
        pass
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1080, 1920, 100
sc.render.fps = FPS; sc.frame_start, sc.frame_end = 1, FRAMES
sc.render.image_settings.file_format = "PNG"
sc.render.filepath = os.path.join(OUT, "f_")
sc.view_settings.view_transform = "Standard"
try: sc.render.use_motion_blur = os.environ.get("MBLUR", "1") == "1"
except Exception: pass
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)

def new_mat(name, blended=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; m.node_tree.nodes.clear()
    if blended:
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try: setattr(m, attr, val)
            except Exception: pass
    return m, m.node_tree
def out(nt, sock):
    o = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(sock, o.inputs[0])
def N(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items(): n.inputs[k].default_value = v
    return n
def emission_mat(name, color, strength):
    m, nt = new_mat(name); e = N(nt, "ShaderNodeEmission", Color=color, Strength=strength); out(nt, e.outputs[0]); return m

# ---------------- card: rounded mesh, front / back / edge ----------------
W, H, R, T = 0.63, 0.88, 0.035, 0.004
me = bpy.data.meshes.new("card"); bm = bmesh.new()
# rounded-rectangle outline built point by point (bmesh bevel on a lone quad left a stepped corner, 10-16)
pts = []
for cx, cy, a0 in ((W - R, H - R, 0), (-W + R, H - R, 90), (-W + R, -H + R, 180), (W - R, -H + R, 270)):
    for k in range(9):
        a = math.radians(a0 + k * 90 / 8); pts.append((cx + R * math.cos(a), cy + R * math.sin(a), 0))
bm.faces.new([bm.verts.new(p) for p in pts])
uv = bm.loops.layers.uv.new("UVMap")
for f in bm.faces:
    for l in f.loops: l[uv].uv = ((l.vert.co.x + W) / (2 * W), (l.vert.co.y + H) / (2 * H))
bm.to_mesh(me); bm.free()
card_mesh_obj = bpy.data.objects.new("cardmesh", me); sc.collection.objects.link(card_mesh_obj)
card_mesh_obj.rotation_euler = (math.radians(90), 0, 0)
sol = card_mesh_obj.modifiers.new("thick", "SOLIDIFY"); sol.thickness = T; sol.offset = -1
sol.material_offset = 1; sol.material_offset_rim = 2
pivot = bpy.data.objects.new("card", None); sc.collection.objects.link(pivot); card_mesh_obj.parent = pivot
pivot.location = (0, 0, 0.72)

def card_face(name, img_path, flip_u, holo):
    m, nt = new_mat(name)
    for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
        try: setattr(m, attr, val)
        except Exception: pass
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping"); nt.links.new(tc.outputs["UV"], mp.inputs[0])
    if flip_u: mp.inputs["Scale"].default_value = (-1, 1, 1); mp.inputs["Location"].default_value = (1, 0, 0)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(img_path); tex.extension = "CLIP"
    nt.links.new(mp.outputs[0], tex.inputs[0])
    p = N(nt, "ShaderNodeBsdfPrincipled", Roughness=0.45)
    if "Specular IOR Level" in p.inputs: p.inputs["Specular IOR Level"].default_value = 0.35
    nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    shader = p.outputs[0]
    if holo:
        # rainbow band + thin white shine, both swept across by keyframed offsets
        def band(rot, width, offs_key):
            mpp = N(nt, "ShaderNodeMapping", Rotation=(0, 0, math.radians(rot))); nt.links.new(tc.outputs["UV"], mpp.inputs[0])
            g = nt.nodes.new("ShaderNodeTexGradient"); nt.links.new(mpp.outputs[0], g.inputs[0])
            HOLO[offs_key] = mpp.inputs["Location"]
            return g
        g1 = band(-30, 0, "rain")
        spec = nt.nodes.new("ShaderNodeValToRGB"); el = spec.color_ramp.elements
        cols = [(0, 0, 0), (1, 0.1, 0.4), (1, 0.8, 0.1), (0.2, 1, 0.4), (0.1, 0.6, 1), (0.7, 0.2, 1), (0, 0, 0)]
        el[0].position, el[0].color = 0.30, (*cols[0], 1); el[1].position, el[1].color = 0.70, (*cols[-1], 1)
        for i, c in enumerate(cols[1:-1]): e = el.new(0.36 + i * 0.07); e.color = (*c, 1)
        nt.links.new(g1.outputs["Fac"], spec.inputs[0])
        e1 = N(nt, "ShaderNodeEmission", Strength=0.5); nt.links.new(spec.outputs["Color"], e1.inputs["Color"])
        g2 = band(-22, 0, "shine")
        sh = nt.nodes.new("ShaderNodeValToRGB"); el2 = sh.color_ramp.elements
        el2[0].position, el2[0].color = 0.47, (0, 0, 0, 1); el2[1].position, el2[1].color = 0.5, (1, 1, 1, 1)
        e3 = el2.new(0.53); e3.color = (0, 0, 0, 1)
        nt.links.new(g2.outputs["Fac"], sh.inputs[0])
        e2 = N(nt, "ShaderNodeEmission", Strength=0.9); nt.links.new(sh.outputs["Color"], e2.inputs["Color"])
        a1 = nt.nodes.new("ShaderNodeAddShader"); nt.links.new(shader, a1.inputs[0]); nt.links.new(e1.outputs[0], a1.inputs[1])
        a2 = nt.nodes.new("ShaderNodeAddShader"); nt.links.new(a1.outputs[0], a2.inputs[0]); nt.links.new(e2.outputs[0], a2.inputs[1])
        shader = a2.outputs[0]
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Alpha"], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(shader, mix.inputs[2])
    out(nt, mix.outputs[0])
    return m

HOLO = {}
me.materials.append(card_face("front", FRONT, False, True))
me.materials.append(card_face("back", BACK, True, False))
edge, ent = new_mat("edge"); out(ent, N(ent, "ShaderNodeBsdfPrincipled", **{"Base Color": (0.08, 0.1, 0.25, 1), "Roughness": 0.4}).outputs[0])
me.materials.append(edge)

# arrive face-down (back to camera), 2 turns, land on the front at f55; then sway
pivot.rotation_euler = (math.radians(12), math.radians(-6), math.radians(180)); pivot.keyframe_insert("rotation_euler", frame=1)
pivot.rotation_euler = (math.radians(4), 0, math.radians(180 + 20)); pivot.keyframe_insert("rotation_euler", frame=22)
pivot.rotation_euler = (0, 0, math.radians(-720)); pivot.keyframe_insert("rotation_euler", frame=55)
for f, a, t in ((95, 7, -3), (140, -6, 2), (190, 5, -2), (240, -3, 1)):
    pivot.rotation_euler = (math.radians(t), 0, math.radians(-720 + a)); pivot.keyframe_insert("rotation_euler", frame=f)
pivot.location = (0, 1.8, 0.95); pivot.keyframe_insert("location", frame=1)
pivot.location = (0, 0, 0.72); pivot.keyframe_insert("location", frame=40)
for f, z in ((120, 0.76), (180, 0.70), (240, 0.75)):
    pivot.location = (0, 0, z); pivot.keyframe_insert("location", frame=f)
pivot.scale = (0.6,) * 3; pivot.keyframe_insert("scale", frame=1)
pivot.scale = (0.85,) * 3; pivot.keyframe_insert("scale", frame=55)  # 10-17: smaller so card + text sit in TikTok's clear area (~10-78% of the height)
for key, pts in (("rain", ((1, -1.4), (56, -1.4), (110, 1.4), (150, -1.4), (210, 1.4))), ("shine", ((1, -1.3), (58, -1.3), (95, 1.3), (240, 1.3)))):
    for f, x in pts:
        HOLO[key].default_value = (x, 0, 0); HOLO[key].keyframe_insert("default_value", frame=f)

# ---------------- background: nebula, light rays, sparkles ----------------
m, nt = new_mat("nebula")
# the plane is 4x larger than v3 (the side swoop saw its edge as a black strip, Chris 10-17), so the noise scale is 4x to keep the look
tc = nt.nodes.new("ShaderNodeTexCoord"); noise = N(nt, "ShaderNodeTexNoise", Scale=6.4, Detail=8.0, Roughness=0.62)
noise.noise_dimensions = "4D"; nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
ramp = nt.nodes.new("ShaderNodeValToRGB"); el = ramp.color_ramp.elements
el[0].position, el[0].color = 0.38, (0.002, 0.002, 0.012, 1); el[1].position, el[1].color = 0.78, (0.28, 0.12, 0.65, 1)
mid = el.new(0.56); mid.color = (0.03, 0.07, 0.28, 1)
nt.links.new(noise.outputs["Fac"], ramp.inputs[0])
out(nt, N(nt, "ShaderNodeEmission", Strength=0.9).outputs[0]); nt.links.new(ramp.outputs["Color"], nt.nodes["Emission"].inputs["Color"])
noise.inputs["W"].default_value = 0; noise.inputs["W"].keyframe_insert("default_value", frame=1)
noise.inputs["W"].default_value = 1.2; noise.inputs["W"].keyframe_insert("default_value", frame=FRAMES)
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 6, 0), rotation=(math.radians(90), 0, 0))
neb = bpy.context.object; neb.scale = (32, 48, 1); neb.data.materials.append(m)


# light rays: a disc behind the card, stripes by angle, fading out from the centre, slowly turning
m, nt = new_mat("rays", blended=True)
tc = nt.nodes.new("ShaderNodeTexCoord")
gr = nt.nodes.new("ShaderNodeTexGradient"); gr.gradient_type = "RADIAL"; nt.links.new(tc.outputs["Object"], gr.inputs[0])
mul = N(nt, "ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 18; nt.links.new(gr.outputs["Fac"], mul.inputs[0])
sn = N(nt, "ShaderNodeMath"); sn.operation = "PINGPONG"; sn.inputs[1].default_value = 0.5; nt.links.new(mul.outputs[0], sn.inputs[0])
sm = N(nt, "ShaderNodeMath"); sm.operation = "MULTIPLY"; sm.inputs[1].default_value = 2.0; nt.links.new(sn.outputs[0], sm.inputs[0])
smp = N(nt, "ShaderNodeMapping", Scale=(1 / 3.2, 1 / 3.2, 1)); nt.links.new(tc.outputs["Object"], smp.inputs[0])
sph = nt.nodes.new("ShaderNodeTexGradient"); sph.gradient_type = "SPHERICAL"; nt.links.new(smp.outputs[0], sph.inputs[0])
fall = N(nt, "ShaderNodeMath"); fall.operation = "POWER"; fall.inputs[1].default_value = 1.6; nt.links.new(sph.outputs["Fac"], fall.inputs[0])
mask = N(nt, "ShaderNodeMath"); mask.operation = "MULTIPLY"; nt.links.new(sm.outputs[0], mask.inputs[0]); nt.links.new(fall.outputs[0], mask.inputs[1])
fade = N(nt, "ShaderNodeMath"); fade.operation = "MULTIPLY"; fade.inputs[1].default_value = 0.0; nt.links.new(mask.outputs[0], fade.inputs[0])
em = N(nt, "ShaderNodeEmission", Color=(1.0, 0.68, 0.22, 1), Strength=2.2)
trp = nt.nodes.new("ShaderNodeBsdfTransparent"); mx = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(fade.outputs[0], mx.inputs[0]); nt.links.new(trp.outputs[0], mx.inputs[1]); nt.links.new(em.outputs[0], mx.inputs[2]); out(nt, mx.outputs[0])
fade.inputs[1].keyframe_insert("default_value", frame=50)
fade.inputs[1].default_value = 0.6; fade.inputs[1].keyframe_insert("default_value", frame=62)
fade.inputs[1].default_value = 0.2; fade.inputs[1].keyframe_insert("default_value", frame=110)
bpy.ops.mesh.primitive_circle_add(vertices=96, radius=3.2, fill_type="TRIFAN", location=(0, 1.2, 0.72), rotation=(math.radians(90), 0, 0))
rays = bpy.context.object; rays.data.materials.append(m)
rays.rotation_euler = (math.radians(90), 0, 0); rays.keyframe_insert("rotation_euler", frame=1)
rays.rotation_euler = (math.radians(90), math.radians(40), 0); rays.keyframe_insert("rotation_euler", frame=FRAMES)

# sparkles: small glowing dots at many depths drifting up (blurred by the lens)
spark_mat = emission_mat("spark", (1.0, 0.85, 0.55, 1), 6.0)
blue_mat = emission_mat("sparkb", (0.45, 0.65, 1.0, 1), 6.0)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
proto = bpy.context.object; proto.data.materials.append(spark_mat); proto.location = (0, 50, 0)
for i in range(220):
    o = proto.copy(); o.data = proto.data; sc.collection.objects.link(o)
    o.material_slots[0].link = "OBJECT"; o.material_slots[0].material = spark_mat if i % 3 else blue_mat
    # most sit behind the card; the few in front stay out at the sides so nothing crosses the card or the price
    if i % 7:
        y = random.uniform(0.6, 5.0); x = random.uniform(-3, 3) * (1 + y * 0.18)
    else:
        y = random.uniform(-2.0, 0.0); x = random.choice([-1, 1]) * random.uniform(1.25, 2.2)
    s = random.uniform(0.008, 0.022) * (1 + max(0, y) * 0.25); z = random.uniform(-3.5, 3.5)
    # keep the column under the card clear (the name, price and change lines sit there): a sparkle that would show
    # within ~1.3 of the centre between z -2.1 and -0.3 is pushed out to the sides (screen x = x * 6.2 / (6.2 + y))
    k = (6.2 + y) / 6.2
    if -3.0 < z < 0.2 and abs(x / k) < 1.9:  # wide enough that the upward drift never carries one into the text
        x = random.choice([-1, 1]) * random.uniform(1.9, 2.8) * k
    o.scale = (s,) * 3
    o.location = (x, y, z); o.keyframe_insert("location", frame=1)
    o.location = (x + random.uniform(-0.3, 0.3), y, z + random.uniform(0.6, 1.4)); o.keyframe_insert("location", frame=FRAMES)

# ---------------- reveal flash: shockwave ring + spark burst ----------------
ring_mat = emission_mat("ring", (0.75, 0.85, 1.0, 1), 4.0)
bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.012, location=(0, -0.05, 0.72), rotation=(math.radians(90), 0, 0))
ring = bpy.context.object; ring.data.materials.append(ring_mat)
ring.scale = (0,) * 3; ring.keyframe_insert("scale", frame=53)
ring.scale = (0.3,) * 3; ring.keyframe_insert("scale", frame=55)
ring.scale = (2.6,) * 3; ring.keyframe_insert("scale", frame=72)
ring.scale = (0,) * 3; ring.keyframe_insert("scale", frame=73)

def burst(center, n, f0, reach, mat, size=0.02):
    for i in range(n):
        o = proto.copy(); o.data = proto.data; sc.collection.objects.link(o)
        o.material_slots[0].link = "OBJECT"; o.material_slots[0].material = mat
        a = random.uniform(0, 2 * math.pi); r = random.uniform(0.5, 1.0) * reach
        o.location = center; o.scale = (0,) * 3; o.keyframe_insert("location", frame=f0); o.keyframe_insert("scale", frame=f0 - 1)
        o.scale = (size * random.uniform(0.6, 1.4),) * 3; o.keyframe_insert("scale", frame=f0)
        o.location = (center[0] + math.cos(a) * r, center[1] - random.uniform(0, 0.4), center[2] + math.sin(a) * r * 0.8)
        o.keyframe_insert("location", frame=f0 + random.randint(14, 24))
        o.scale = (0,) * 3; o.keyframe_insert("scale", frame=f0 + 26)
burst((0, -0.1, 0.72), 70, 55, 2.4, spark_mat, 0.025)

flash = bpy.data.lights.new("flash", "POINT"); flash.energy = 0; flash.color = (0.8, 0.88, 1.0)
fo = bpy.data.objects.new("flash", flash); fo.location = (0, -1.2, 0.8); sc.collection.objects.link(fo)
flash.keyframe_insert("energy", frame=52); flash.energy = 380; flash.keyframe_insert("energy", frame=56)
flash.energy = 0; flash.keyframe_insert("energy", frame=72)

# ---------------- lights ----------------
def area(name, loc, rot, power, size, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, "AREA"); l.energy = power; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o); return o
area("key", (2.8, -4.5, 3.4), (math.radians(55), 0, math.radians(32)), 520, 3)
area("rimL", (-2.6, 1.8, 2.4), (math.radians(-60), 0, math.radians(-140)), 700, 2, (0.5, 0.6, 1.0))
area("rimR", (2.6, 1.8, 0.2), (math.radians(-90), 0, math.radians(140)), 500, 2, (1.0, 0.5, 0.9))

# ---------------- text ----------------
fh, fb = bpy.data.fonts.load(FONT_HEAVY), bpy.data.fonts.load(FONT_BOLD)
def text(name, body, z, size, color, strength, font):
    bpy.ops.object.text_add(location=(0, -0.3, z), rotation=(math.radians(90), 0, 0))
    o = bpy.context.object; o.name = name; o.data.body = body; o.data.font = font
    o.data.size = size; o.data.align_x = "CENTER"; o.data.align_y = "CENTER"; o.data.extrude = 0.006
    o.data.materials.append(emission_mat(name, color, strength)); return o
def pop(o, f):
    o.scale = (0,) * 3; o.keyframe_insert("scale", frame=f - 1)
    o.scale = (1.18,) * 3; o.keyframe_insert("scale", frame=f + 5)
    o.scale = (1,) * 3; o.keyframe_insert("scale", frame=f + 10)
# 10-17: the lines under the card were too small to read on a phone (Chris); the price size stays
label = text("label", NAME.upper(), -0.2, 0.2, (1.0, 0.72, 0.2, 1), 1.5, fh); pop(label, 64)
price = text("price", "$0", -0.52, 0.4, (0.2, 1.0, 0.45, 1), 1.3, fh); pop(price, 70)
change = text("change", CHANGE, -0.95, 0.2, (1, 1, 1, 1), 1.7, fh); pop(change, 112)
brand = text("brand", "cardflip.io", -1.22, 0.24, (0.82, 0.68, 1.0, 1), 2.6, fh); pop(brand, 128)  # 10-17: bigger and brighter (Chris)
# 10-20: a falling price ("-4% this week") gets red arrows sinking instead of green ones rising.
DOWN = CHANGE.strip().startswith(("-", "\u2212"))
green = emission_mat("arrow", (1.0, 0.3, 0.3, 1) if DOWN else (0.25, 1.0, 0.5, 1), 4.0)
for i in range(7):  # arrows rising (or sinking) beside the change line
    bpy.ops.object.text_add(rotation=(math.radians(90), 0, 0)); a = bpy.context.object
    a.data.body = "\u25BC" if DOWN else "\u25B2"; a.data.font = bpy.data.fonts.load(r"C:\Windows\Fonts\seguisym.ttf") if os.path.exists(r"C:\Windows\Fonts\seguisym.ttf") else fb
    a.data.size = random.uniform(0.08, 0.15); a.data.align_x = "CENTER"; a.data.materials.append(green)
    x = random.choice([-1, 1]) * random.uniform(1.3, 1.5); f0 = 112 + i * 6
    z0, z1 = (-0.25, -1.05) if DOWN else (-1.05, -0.25)
    a.location = (x, -0.35, z0); a.scale = (0,) * 3; a.keyframe_insert("scale", frame=f0); a.keyframe_insert("location", frame=f0)
    a.scale = (1,) * 3; a.keyframe_insert("scale", frame=f0 + 4)
    a.location = (x, -0.35, z1); a.keyframe_insert("location", frame=f0 + 40)
    a.scale = (0,) * 3; a.keyframe_insert("scale", frame=f0 + 44)
burst((0, -0.35, -0.52), 45, 102, 1.3, emission_mat("sparkg", (0.4, 1.0, 0.6, 1), 7.0), 0.018)

# price chart that draws itself behind the price while it counts (CardFlip = price history)
pts_chart = []
v = 0.0
for i in range(26):
    t = i / 25
    v = 0.55 * t ** 1.6 + 0.06 * math.sin(i * 1.9) * (1 - t) + random.uniform(-0.03, 0.03)
    if DOWN: v = 0.55 - v  # 10-20: a falling price gets a chart that eases down, not up
    pts_chart.append((-1.15 + 2.3 * t, -0.2, -0.82 + v * 0.3))
cd = bpy.data.curves.new("chart", "CURVE"); cd.dimensions = "3D"; cd.bevel_depth = 0.012; cd.bevel_resolution = 3
sp = cd.splines.new("POLY"); sp.points.add(len(pts_chart) - 1)
for p_, c_ in zip(sp.points, pts_chart): p_.co = (*c_, 1)
chart = bpy.data.objects.new("chart", cd); sc.collection.objects.link(chart)
cd.materials.append(emission_mat("chart", (0.2, 1.0, 0.45, 1), 2.2))
cd.bevel_factor_end = 0.0; cd.keyframe_insert("bevel_factor_end", frame=72)
cd.bevel_factor_end = 1.0; cd.keyframe_insert("bevel_factor_end", frame=102)
head = proto.copy(); head.data = proto.data; sc.collection.objects.link(head)
head.material_slots[0].link = "OBJECT"; head.material_slots[0].material = emission_mat("chartdot", (0.7, 1.0, 0.8, 1), 8.0)
for i, f in enumerate(range(72, 103, 2)):  # a bright dot rides the tip of the line
    j = min(len(pts_chart) - 1, round((f - 72) / 30 * (len(pts_chart) - 1)))
    head.location = pts_chart[j]; head.keyframe_insert("location", frame=f)
head.scale = (0,) * 3; head.keyframe_insert("scale", frame=71)
head.scale = (0.035,) * 3; head.keyframe_insert("scale", frame=72)
head.scale = (0.05,) * 3; head.keyframe_insert("scale", frame=104)
head.scale = (0.02,) * 3; head.keyframe_insert("scale", frame=118)

# lightning crackling around the card at the reveal: jagged bolts, each on screen for 2-3 frames
bolt_mat = emission_mat("bolt", (0.55, 0.75, 1.0, 1), 4.0)
for b in range(22):
    side = random.choice(["l", "r", "t", "b"])
    sx = {"l": -0.72, "r": 0.72}.get(side, random.uniform(-0.6, 0.6)); sz = {"t": 1.0, "b": -1.0}.get(side, random.uniform(-0.9, 0.9))
    dx = {"l": -1, "r": 1}.get(side, random.uniform(-0.4, 0.4)); dz = {"t": 1, "b": -1}.get(side, random.uniform(-0.4, 0.4))
    pts_b = []; x_, z_ = sx * 0.85, sz * 0.85 + 0.72
    for k in range(7):
        pts_b.append((x_, -0.05, z_)); x_ += dx * random.uniform(0.06, 0.16) + random.uniform(-0.07, 0.07); z_ += dz * random.uniform(0.06, 0.16) + random.uniform(-0.07, 0.07)
    bd = bpy.data.curves.new(f"bolt{b}", "CURVE"); bd.dimensions = "3D"; bd.bevel_depth = random.uniform(0.004, 0.009)
    s_ = bd.splines.new("POLY"); s_.points.add(len(pts_b) - 1)
    for p_, c_ in zip(s_.points, pts_b): p_.co = (*c_, 1)
    bd.materials.append(bolt_mat)
    bo = bpy.data.objects.new(f"bolt{b}", bd); sc.collection.objects.link(bo)
    f0 = random.randint(52, 84)
    for f, hide in ((1, True), (f0, False), (f0 + random.randint(2, 3), True)):
        bo.hide_render = hide; bo.keyframe_insert("hide_render", frame=f)

def count(scene, *_):
    t = min(1.0, max(0.0, (scene.frame_current - 72) / 30)); t = 1 - (1 - t) ** 3
    price.data.body = f"${PRICE * t:,.2f}"
bpy.app.handlers.frame_change_pre.append(count)

# ---------------- camera: slow push in, shake on the price landing, lens blur ----------------
cam = bpy.data.cameras.new("cam"); cam.lens = 50; cam.sensor_fit = "VERTICAL"; cam.sensor_height = 36
cam.dof.use_dof = os.environ.get("DOF", "1") == "1"; cam.dof.aperture_fstop = 1.0
co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co
# camera swoop: the rig turns the camera in from the side and from below while the card spins
rig = bpy.data.objects.new("rig", None); sc.collection.objects.link(rig); rig.location = (0, 0, 0.72); co.parent = rig
rig.rotation_euler = (math.radians(-10), 0, math.radians(-38)); rig.keyframe_insert("rotation_euler", frame=1)
rig.rotation_euler = (0, 0, 0); rig.keyframe_insert("rotation_euler", frame=62)
rig.rotation_euler = (0, 0, math.radians(4)); rig.keyframe_insert("rotation_euler", frame=FRAMES)
_cz = -0.72  # camera keys below are written in world terms; the rig sits at the card's height
# 10-21 (Chris 10-20: "content is to high"): CAM_BACK pulls the camera back (everything smaller), CAM_UP raises it
# (everything sits lower in the frame). At the last frame the swaying card's top sat ~9% from the top, under TikTok's
# Following / For You bar. Chris picked C (10-21): CAM_BACK=0.45 CAM_UP=0.05 = the column at ~13%-76% of the height.
# CAM_BACK=0 CAM_UP=0 gives the old (too high) framing back.
_back = float(os.environ.get("CAM_BACK", "0.45")); _up = float(os.environ.get("CAM_UP", "0.05"))
cam.dof.focus_object = pivot
co.rotation_euler = (math.radians(90), 0, 0)
co.location = (0, -6.8 - _back, -0.2 + _cz + _up); co.keyframe_insert("location", frame=1)
co.location = (0, -6.2 - _back, -0.22 + _cz + _up); co.keyframe_insert("location", frame=100)
for f, dx, dz in ((101, 0.03, -0.02), (103, -0.025, 0.02), (105, 0.015, -0.01), (107, 0, 0)):
    co.location = (dx, -6.2 - _back, -0.22 + dz + _cz + _up); co.keyframe_insert("location", frame=f)
co.location = (0, -5.9 - _back, -0.22 + _cz + _up); co.keyframe_insert("location", frame=FRAMES)


# ---------------- glow (compositor bloom), Blender 5 API first, 4.x fallback ----------------
try:
    try:
        tree = bpy.data.node_groups.new("comp", "CompositorNodeTree"); sc.compositing_node_group = tree
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        outn = tree.nodes.new("NodeGroupOutput")
    except Exception:
        sc.use_nodes = True; tree = sc.node_tree; tree.nodes.clear(); outn = tree.nodes.new("CompositorNodeComposite")
    rl = tree.nodes.new("CompositorNodeRLayers"); gl = tree.nodes.new("CompositorNodeGlare")
    for prop, val in (("glare_type", "BLOOM"), ("quality", "HIGH")):
        try: setattr(gl, prop, val)
        except Exception: pass
    for name, val in (("Type", "Bloom"), ("Threshold", 0.8), ("Strength", 0.6), ("Size", 0.6)):
        if name in gl.inputs:
            try: gl.inputs[name].default_value = val
            except Exception as e: print("glare input", name, e)
    tree.links.new(rl.outputs["Image"], gl.inputs["Image"]); tree.links.new(gl.outputs["Image"], outn.inputs[0])
    print("BLOOM ON", [i.name for i in gl.inputs])
except Exception as e:
    print("BLOOM OFF:", e)

if os.environ.get("STILLS"):  # quick look: STILLS=40,56,100 renders just those frames
    for f in [int(x) for x in os.environ["STILLS"].split(",")]:
        sc.frame_set(f); sc.render.filepath = os.path.join(OUT, f"still_{f:04d}"); bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
