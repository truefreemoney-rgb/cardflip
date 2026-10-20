# CardFlip test: a real card spins in 3D, a glare sweeps across, the price counts up. 9:16, 6 s, 30 fps.
# Run: blender.exe --background --python card_spin.py -- <card image> <out dir> <name> <price> <change line>
import bpy, math, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
IMG, OUT, NAME, PRICE, CHANGE = argv[0], argv[1], argv[2], float(argv[3]), argv[4]
FONT = r"C:\Windows\Fonts\segoeuib.ttf"
FPS, FRAMES = 30, 180

# --- empty scene ---
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        pass
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1080, 1920, 100
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, FRAMES
sc.render.image_settings.file_format = "PNG"
sc.render.filepath = os.path.join(OUT, "f_")
sc.view_settings.view_transform = "Standard"

world = bpy.data.worlds.new("w"); sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.008, 0.006, 0.012, 1)

def mat(name, build):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    outn = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(build(nt), outn.inputs[0])
    return m

def principled(nt, color=None, rough=0.3, coat=0.0, metal=0.0):
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    if color: p.inputs["Base Color"].default_value = color
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if "Coat Weight" in p.inputs: p.inputs["Coat Weight"].default_value = coat; p.inputs["Coat Roughness"].default_value = 0.05
    return p

def emission(nt, color, strength=1.0):
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs[0].default_value = color; e.inputs[1].default_value = strength
    return e.outputs[0]

# --- card: front picture, thin white edge, dark purple back ---
W, H, D = 0.63, 0.88, 0.012
card = bpy.data.objects.new("card", None); sc.collection.objects.link(card)
card.location = (0, 0, 0.72)

SHINE = {}
def front_build(nt):
    # satin card, no mirror coat (a coat mirrored the key light as a white block); the shine is a stripe painted
    # on the surface: UV -> rotate -> linear gradient -> a narrow band, swept across by keyframing the offset
    p = principled(nt, rough=0.55, coat=0.0)
    if "Specular IOR Level" in p.inputs: p.inputs["Specular IOR Level"].default_value = 0.25
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(IMG)
    nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(-25))
    g = nt.nodes.new("ShaderNodeTexGradient"); g.gradient_type = "LINEAR"
    r = nt.nodes.new("ShaderNodeValToRGB"); el = r.color_ramp.elements
    el[0].position = 0.46; el[0].color = (0, 0, 0, 1); el[1].position = 0.5; el[1].color = (1, 1, 1, 1)
    e3 = el.new(0.54); e3.color = (0, 0, 0, 1)
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs[1].default_value = 0.55
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(tc.outputs["UV"], mp.inputs[0]); nt.links.new(mp.outputs[0], g.inputs[0])
    nt.links.new(g.outputs["Fac"], r.inputs[0]); nt.links.new(r.outputs["Color"], em.inputs[0])
    nt.links.new(p.outputs[0], add.inputs[0]); nt.links.new(em.outputs[0], add.inputs[1])
    SHINE["loc"] = mp.inputs["Location"]
    return add.outputs[0]

bpy.ops.mesh.primitive_plane_add(size=2, location=(0, -D - 0.0005, 0), rotation=(math.radians(90), 0, 0))
front = bpy.context.object; front.scale = (W, H, 1); front.parent = card
front.data.materials.append(mat("front", front_build))

bpy.ops.mesh.primitive_cube_add(size=2)
slab = bpy.context.object; slab.scale = (W, D, H); slab.parent = card
slab.data.materials.append(mat("edge", lambda nt: principled(nt, (0.85, 0.85, 0.9, 1), 0.4).outputs[0]))

bpy.ops.mesh.primitive_plane_add(size=2, location=(0, D + 0.0005, 0), rotation=(math.radians(-90), 0, 0))
back = bpy.context.object; back.scale = (W * 0.97, H * 0.97, 1); back.parent = card
back.data.materials.append(mat("back", lambda nt: principled(nt, (0.07, 0.03, 0.18, 1), 0.3, coat=1.0, metal=0.2).outputs[0]))

# spin: 1.5 turns into place, then a slow sway; a little float the whole time
card.rotation_euler = (math.radians(8), 0, math.radians(-540)); card.keyframe_insert("rotation_euler", frame=1)
card.rotation_euler = (0, 0, 0); card.keyframe_insert("rotation_euler", frame=70)
for f, a in ((110, 9), (150, -7), (180, 4)):
    card.rotation_euler = (math.radians(-2), 0, math.radians(a)); card.keyframe_insert("rotation_euler", frame=f)
card.scale = (0.7, 0.7, 0.7); card.keyframe_insert("scale", frame=1)
card.scale = (1.1, 1.1, 1.1); card.keyframe_insert("scale", frame=55)

# --- background glow (warm, like the current videos) ---
def bg_build(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    # object coords run -1..1 on the plane; the camera sees about x +-0.3, y +-0.3; glow centred just above the card
    mp.inputs["Location"].default_value = (0, -0.12 * 1.9, 0); mp.inputs["Scale"].default_value = (1.9 * 1.25, 1.9, 1)
    g = nt.nodes.new("ShaderNodeTexGradient"); g.gradient_type = "SPHERICAL"
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.color_ramp.elements[0].color = (0.004, 0.003, 0.007, 1)
    r.color_ramp.elements[1].position = 1.0; r.color_ramp.elements[1].color = (0.24, 0.09, 0.02, 1)
    r.color_ramp.interpolation = "EASE"
    e = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(tc.outputs["Object"], mp.inputs[0]); nt.links.new(mp.outputs[0], g.inputs[0])
    nt.links.new(g.outputs["Fac"], r.inputs[0]); nt.links.new(r.outputs["Color"], e.inputs[0])
    return e.outputs[0]
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 4, 0), rotation=(math.radians(90), 0, 0))
bg = bpy.context.object; bg.scale = (7, 12, 1)
bg.data.materials.append(mat("bg", bg_build))

# --- lights: soft key, warm rim, and a sweeping glare ---
def area(name, loc, rot, power, size, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, "AREA"); l.energy = power; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o)
    return o
area("key", (2.5, -4, 3), (math.radians(55), 0, math.radians(30)), 650, 3)
area("rim", (-2.5, 2, 2.5), (math.radians(-60), 0, math.radians(-140)), 600, 2, (1, 0.55, 0.2))
loc = SHINE["loc"]
for f, x in ((1, -1.2), (80, -1.2), (122, 1.3), (180, 1.3)):
    loc.default_value = (x, 0, 0); loc.keyframe_insert("default_value", frame=f)
# --- text ---
font = bpy.data.fonts.load(FONT)
def text(name, body, z, size, color, strength=1.0):
    bpy.ops.object.text_add(location=(0, -0.2, z), rotation=(math.radians(90), 0, 0))
    o = bpy.context.object; o.name = name; o.data.body = body; o.data.font = font
    o.data.size = size; o.data.align_x = "CENTER"; o.data.align_y = "CENTER"; o.data.extrude = 0.004
    o.data.materials.append(mat(name, lambda nt: emission(nt, color, strength)))
    return o
def pop(o, f):
    o.scale = (0, 0, 0); o.keyframe_insert("scale", frame=f - 1)
    o.scale = (1.12, 1.12, 1.12); o.keyframe_insert("scale", frame=f + 6)
    o.scale = (1, 1, 1); o.keyframe_insert("scale", frame=f + 10)

label = text("label", NAME.upper(), -0.55, 0.17, (0.98, 0.75, 0.25, 1)); pop(label, 70)
price = text("price", "$0", -0.95, 0.42, (0.2, 0.9, 0.45, 1), 1.6); pop(price, 82)
change = text("change", CHANGE, -1.33, 0.15, (0.85, 0.85, 0.9, 1)); pop(change, 128)
brand = text("brand", "cardflip.io", -1.72, 0.12, (0.62, 0.5, 1.0, 1)); pop(brand, 140)

def count(scene, *_):
    f = scene.frame_current
    t = min(1.0, max(0.0, (f - 85) / 40))
    t = 1 - (1 - t) ** 3
    price.data.body = f"${PRICE * t:,.2f}" if PRICE < 1000 or t < 1 else f"${PRICE:,.0f}"
bpy.app.handlers.frame_change_pre.append(count)

# --- camera ---
cam = bpy.data.cameras.new("cam"); cam.lens = 50; cam.sensor_fit = "VERTICAL"; cam.sensor_height = 36
co = bpy.data.objects.new("cam", cam); co.location = (0, -6.1, -0.25); co.rotation_euler = (math.radians(90), 0, 0)
sc.collection.objects.link(co); sc.camera = co

bpy.ops.render.render(animation=True)
