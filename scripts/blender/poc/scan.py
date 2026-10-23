# POC E "Phone scan": a card lies on a wooden table, a phone glides in above it showing the card in its camera view,
# a cyan scan line sweeps the card, corner brackets lock on and the price HUD pops. The product in 5 s.
# Run: blender --background --python scan.py -- <front> <NAME> <price> <out>
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
FRONT, NAME, PRICE, OUT = argv[0], argv[1], float(argv[2]), argv[3]
FR = 150
CS = 0.75  # card scale on the table
L.setup(OUT, FR)
L.wood_floor(0)
card, hk = L.make_card("card", FRONT, loc=(0, 0, 0.006), scale=CS, flat=True)
card.rotation_euler = (0, 0, math.radians(5))
L.holo_sweep(hk, ((1, -1.4), (96, -1.4), (130, 1.4), (FR, 1.4)), ((1, -1.3), (98, -1.3), (126, 1.3), (FR, 1.3)))

# phone: bevelled dark slab hovering behind-above the card, screen = the card seen through its camera + a cyan viewfinder
bpy.ops.mesh.primitive_cube_add(size=1); phone = bpy.context.object; phone.scale = (0.56, 1.18, 0.057)
bev = phone.modifiers.new("bevel", "BEVEL"); bev.width = 0.035; bev.segments = 8; bev.use_clamp_overlap = False
pm, _, _ = L.principled_mat("phone", (0.03, 0.03, 0.035, 1), rough=0.3, metal=0.85); phone.data.materials.append(pm)
sm, snt = L.new_mat("screen")
tc = snt.nodes.new("ShaderNodeTexCoord"); mp = L.N(snt, "ShaderNodeMapping", Location=(-0.194, -0.582, 0), Scale=(1.389, 2.165, 1))
snt.links.new(tc.outputs["UV"], mp.inputs[0])
tex = snt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(FRONT, check_existing=True); tex.extension = "CLIP"; snt.links.new(mp.outputs[0], tex.inputs[0])
mix = snt.nodes.new("ShaderNodeMixRGB"); mix.inputs[1].default_value = (0.012, 0.014, 0.02, 1)
snt.links.new(tex.outputs["Alpha"], mix.inputs[0]); snt.links.new(tex.outputs["Color"], mix.inputs[2])
em = L.N(snt, "ShaderNodeEmission", Strength=1.3); snt.links.new(mix.outputs[0], em.inputs["Color"]); L.out(snt, em.outputs[0])
bpy.ops.mesh.primitive_plane_add(size=1); screen = bpy.context.object; screen.parent = phone
screen.location = (0, 0, 0.51); screen.scale = (0.92, 0.95, 1); screen.data.materials.append(sm)
vfm = L.emission_mat("vf", L.CYAN, 3.0)
for sx, sy, w, h in ((0, 1, 0.70, 0.012), (0, -1, 0.70, 0.012), (1, 0, 0.012, 0.46), (-1, 0, 0.012, 0.46)):  # viewfinder frame lines
    bpy.ops.mesh.primitive_plane_add(size=1); ln = bpy.context.object; ln.parent = phone
    ln.location = (sx * 0.35, sy * 0.23, 0.53); ln.scale = (w, h, 1); ln.data.materials.append(vfm)
phone.rotation_euler = (math.radians(27), 0, 0)
phone.location = (0, 1.0, 2.4); phone.keyframe_insert("location", frame=1)
phone.location = (0, 1.0, 0.6); phone.keyframe_insert("location", frame=16)
for f, z in ((60, 0.65), (105, 0.57), (FR, 0.63)):
    phone.location = (0, 1.0, z); phone.keyframe_insert("location", frame=f)

# scan line sweeping over the card (down, then back up), with a cyan wash from the phone
beam = L.emission_mat("beam", L.CYAN, 14)
bpy.ops.mesh.primitive_plane_add(size=1); bl = bpy.context.object; bl.scale = (1.1, 0.016, 1); bl.data.materials.append(beam)
bl.location = (0, 0.7, 0.03); bl.keyframe_insert("location", frame=18); bl.scale = (0,) * 3; bl.keyframe_insert("scale", frame=17)
bl.scale = (1.1, 0.016, 1); bl.keyframe_insert("scale", frame=18)
bl.location = (0, -0.7, 0.03); bl.keyframe_insert("location", frame=56)
bl.location = (0, 0.7, 0.03); bl.keyframe_insert("location", frame=94)
bl.keyframe_insert("scale", frame=94); bl.scale = (0,) * 3; bl.keyframe_insert("scale", frame=95)
wash = L.spot("wash", (0, 1.0, 0.55), (0, 0, 0), 0, 60, 0.6, (0.3, 0.9, 1.0), 0.5)
wash.data.keyframe_insert("energy", frame=17); wash.data.energy = 70; wash.data.keyframe_insert("energy", frame=20)
wash.data.keyframe_insert("energy", frame=94); wash.data.energy = 0; wash.data.keyframe_insert("energy", frame=98)

# corner brackets lock on
bm = L.emission_mat("bracket", L.GREEN, 6)
hw, hh = 0.63 * CS + 0.06, 0.88 * CS + 0.06
for sx in (-1, 1):
    for sy in (-1, 1):
        cd = bpy.data.curves.new("br", "CURVE"); cd.dimensions = "3D"; cd.bevel_depth = 0.012; cd.bevel_resolution = 2
        s = cd.splines.new("POLY"); s.points.add(2)
        for pnt, co_ in zip(s.points, ((sx * hw, sy * (hh - 0.2), 0.02), (sx * hw, sy * hh, 0.02), (sx * (hw - 0.2), sy * hh, 0.02))): pnt.co = (*co_, 1)
        cd.materials.append(bm); o = bpy.data.objects.new("br", cd); L.sc.collection.objects.link(o); o.rotation_euler = (0, 0, math.radians(5))
        o.scale = (1.5,) * 3; o.keyframe_insert("scale", frame=94); o.scale = (0.97,) * 3; o.keyframe_insert("scale", frame=100); o.scale = (1,) * 3; o.keyframe_insert("scale", frame=104)
        o.hide_render = True; o.keyframe_insert("hide_render", frame=1); o.hide_render = False; o.keyframe_insert("hide_render", frame=94)
L.ring((0, 0, 0.03), 96, color=L.GREEN, big=2.0, rot=(0, 0, 0))
proto = L.sparkles(0, FR)
L.burst(proto, (0, 0, 0.05), 40, 96, 1.0, L.emission_mat("spg", (0.4, 1.0, 0.6, 1), 7.0), 0.016, flat=True)

L.area("window", (-3.0, -3.0, 4.5), (math.radians(40), math.radians(-30), 0), 700, 4, (1.0, 0.95, 0.88))
L.area("fill", (3.0, 1.0, 3.0), (math.radians(-25), math.radians(40), 0), 160, 3, (0.8, 0.85, 1.0))

# steep view from the front: phone top ~15% of the frame, card ~33-60%, HUD text 62-78% over the table
co = L.camera((0, -2.0, 6.5), (0, -0.3, 0.4), dof_target=card, fstop=5.6)
co.keyframe_insert("location", frame=1); co.location = (0, -2.1, 6.2); co.keyframe_insert("location", frame=FR)

def hud(name, body, fx, fy, size, color, strength, d=4.0):
    hh_ = d * math.tan(math.radians(19.8)); hw_ = hh_ * 9 / 16
    o = L.text(name, body, (0, 0, 0), size, color, strength, rot=(0, 0, 0)); o.parent = co
    o.location = ((fx - 0.5) * 2 * hw_, (0.5 - fy) * 2 * hh_, -d); return o
nm = hud("name", NAME.upper(), 0.5, 0.615, 0.15, L.GOLD, 1.5); L.pop(nm, 100)
pr = hud("price", "$0", 0.5, 0.675, 0.32, L.GREEN, 1.3); L.pop(pr, 104); L.count_up(pr, PRICE, 104, 24)
sub = hud("sub", "NEAR MINT  ·  MARKET PRICE TODAY", 0.5, 0.728, 0.085, L.WHITE, 1.6); L.pop(sub, 112)
br = hud("brand", "Scan yours free  ·  cardflip.io", 0.5, 0.77, 0.13, L.LILAC, 2.6); L.pop(br, 120); L.pulse(br, 130, FR, 1.0, 0.04, 16)
L.bloom(0.9, 0.5, 0.5)
L.render(OUT)
