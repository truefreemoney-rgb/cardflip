# X ad C "Higher or Lower?" (10-26 v3; Chris picked it after hating the lowball cut: "make this unique and different").
# Square 1200x1200, 9 s. A game-show stage: spotlight beams through light haze, chasing marquee bulbs, two cards on
# podiums. The left card's price is shown, the right one's is hidden while HIGHER / LOWER flash (the viewer guesses).
# The phone swoops in and scans the right card (camera view, then the CardFlip result), drops away, the hidden price
# flips to the real one: HIGHER! + confetti, then "Stop guessing. Scan it."  cardflip.io. Every word is drawn flat by
# overlay.mjs (scene C-higher) from overlay.json; prices are examples (the ad runs for months).
# Run: blender --background --python higherlower.py -- <left front> <left price> <right front> <right price>
#      <phone scan png> <phone result png> <out>
import sys, os, math, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "poc"))
import bpy, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
LFRONT, LPRICE, RFRONT, RPRICE, SCAN_PNG, RESULT_PNG, OUT = argv[0], float(argv[1]), argv[2], float(argv[3]), argv[4], argv[5], argv[6]
FR = 270
PHONE_IN, SCAN0, FLIP, PHONE_OUT = 84, 102, 128, 156   # phone arrives, scan line runs, result shows, phone drops away
REVEAL = 176                                           # the hidden price lands: HIGHER!
CTA = 208
L.setup(OUT, FR, res=(1200, 1200))
L.sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.002, 0.01, 1)
try:
    L.sc.eevee.volumetric_tile_size = "4"; L.sc.eevee.volumetric_samples = 96; L.sc.eevee.use_volumetric_shadows = True
except Exception as e:
    print("eevee volume", e)

# ---- stage: glossy floor, dark back wall, a thin haze so the spotlights show as beams ----
L.glossy_floor(-0.52, color=(0.012, 0.006, 0.02, 1), rough=0.16)
wall, _, _ = L.principled_mat("wall", (0.018, 0.008, 0.035, 1), rough=0.7)
bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 2.3, 2), rotation=(math.radians(90), 0, 0)); bpy.context.object.data.materials.append(wall)
# haze only BEHIND the cards (y > -0.35): beams show in the background, nothing fogs the cards (Chris hates washed out)
hz, hnt = L.new_mat("haze")
hv = L.N(hnt, "ShaderNodeVolumePrincipled", Density=0.04); hv.inputs["Color"].default_value = (0.85, 0.8, 1.0, 1)
hnt.nodes.new("ShaderNodeOutputMaterial"); hnt.links.new(hv.outputs[0], hnt.nodes["Material Output"].inputs["Volume"])
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 1.0, 1.5)); haze = bpy.context.object; haze.scale = (8, 2.7, 4.2); haze.data.materials.append(hz)

# ---- marquee bulbs round the stage, chasing (a value ticks every frame; each bulb lights by its index) ----
bm_, bnt = L.new_mat("bulb")
oi = bnt.nodes.new("ShaderNodeObjectInfo"); tick = bnt.nodes.new("ShaderNodeValue")
def M(op, a, b=None, c=None):
    n = bnt.nodes.new("ShaderNodeMath"); n.operation = op
    for k, v in enumerate((a, b, c)):
        if v is None: continue
        if isinstance(v, (int, float)): n.inputs[k].default_value = v
        else: bnt.links.new(v, n.inputs[k])
    return n.outputs[0]
phase = M("FRACT", M("SUBTRACT", tick.outputs[0], M("DIVIDE", oi.outputs["Object Index"], 3.0)))
on = M("LESS_THAN", phase, 0.34)
be = L.N(bnt, "ShaderNodeEmission", Color=(1.0, 0.8, 0.45, 1)); bnt.links.new(M("MULTIPLY_ADD", on, 7.0, 0.35), be.inputs["Strength"])
L.out(bnt, be.outputs[0])
for f in range(1, FR + 1):
    tick.outputs[0].default_value = f / 7.0; tick.outputs[0].keyframe_insert("default_value", frame=f)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.034, segments=12, ring_count=8); bulb0 = bpy.context.object; bulb0.data.materials.append(bm_)
bulb0.location = (0, 50, 0)
BX, BZ0, BZ1, BY = 1.75, -0.32, 1.62, 2.2
path = [(-BX, BZ0), (-BX, BZ1), (BX, BZ1), (BX, BZ0)]
idx = 0
for (x0, z0), (x1, z1) in zip(path, path[1:]):
    n = max(2, int(math.dist((x0, z0), (x1, z1)) / 0.17))
    for k in range(n):
        t = k / n; b = bulb0.copy(); L.sc.collection.objects.link(b)
        b.location = (x0 + (x1 - x0) * t, BY, z0 + (z1 - z0) * t); b.pass_index = idx; idx += 1

# ---- two podiums with glowing rims; the right rim turns green on the reveal ----
pod, _, _ = L.principled_mat("podium", (0.02, 0.016, 0.03, 1), rough=0.25, metal=0.6)
rims = []
for sx in (-1, 1):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=0.14, location=(sx * 0.62, 0, -0.45)); bpy.context.object.data.materials.append(pod)
    rm, rnt = L.new_mat("rim%d" % sx); re_ = L.N(rnt, "ShaderNodeEmission", Color=(0.62, 0.3, 1.0, 1), Strength=4.0); L.out(rnt, re_.outputs[0])
    bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=0.014, location=(sx * 0.62, 0, -0.381)); bpy.context.object.data.materials.append(rm)
    rims.append(re_)
rc = rims[1].inputs["Color"]; rc.keyframe_insert("default_value", frame=REVEAL - 1)
rc.default_value = (0.2, 1.0, 0.45, 1); rc.keyframe_insert("default_value", frame=REVEAL + 2)

# ---- the two cards, upright on the podiums, angled a touch toward each other, idling ----
cards = []
for sx, front, holo in ((-1, LFRONT, False), (1, RFRONT, True)):
    c, hk = L.make_card("card%d" % sx, front, loc=(sx * 0.62, 0, 0.18), scale=0.62, holo=holo, glow=0.8, holo_amt=0.3)
    for f, a in ((1, -7), (90, -4), (180, -7), (FR, -5)):   # make_card is already upright; the pivot only turns
        c.rotation_euler = (0, 0, math.radians(sx * a)); c.keyframe_insert("rotation_euler", frame=f)
    cards.append((c, hk))
L.holo_sweep(cards[1][1], ((1, -1.4), (REVEAL, -1.4), (REVEAL + 40, 1.4), (FR, 1.4)), ((1, -1.3), (REVEAL + 2, -1.3), (REVEAL + 30, 1.3), (FR, 1.3)))
rcard = cards[1][0]   # the winner steps forward a little on the reveal
rcard.keyframe_insert("location", frame=REVEAL); rcard.keyframe_insert("scale", frame=REVEAL)
rcard.location = (0.62, -0.18, 0.24); rcard.keyframe_insert("location", frame=REVEAL + 8)
rcard.scale = (0.66,) * 3; rcard.keyframe_insert("scale", frame=REVEAL + 8)

# ---- lights: a hard spotlight on each card (beams in the haze), two coloured sweepers, rims, a green win light ----
for sx in (-1, 1):
    L.spot("key%d" % sx, (sx * 1.25, -1.9, 3.4), (sx * 0.62, 0, 0.1), 1100, 24, 0.35, (1.0, 0.95, 0.88), 0.08)
    L.area("back%d" % sx, (sx * 0.62, 0.9, 1.3), (math.radians(-60), 0, 0), 60, 1.2, (0.7, 0.35, 1.0))
# background beams: four narrow spots high on the back wall raking down through the haze, sweeping slowly
for k, (bx, col) in enumerate(((-2.2, (1.0, 0.35, 0.8)), (-0.8, (0.75, 0.6, 1.0)), (0.8, (0.75, 0.6, 1.0)), (2.2, (0.35, 0.8, 1.0)))):
    L.spot("beam%d" % k, (bx, 2.1, 3.9), (bx * 0.4, 0.4, -0.5), 1500, 9, 0.25, col, 0.02)
    aim = [o for o in L.sc.objects if o.name == "beam%d_aim" % k][0]
    sgn = 1 if k % 2 else -1
    for f, dx in ((1, 0), (70, sgn * 0.7), (140, -sgn * 0.5), (210, sgn * 0.6), (FR, 0)):
        aim.location = (bx * 0.4 + dx, 0.4, -0.5); aim.keyframe_insert("location", frame=f)
win = L.area("win", (0.62, 0.5, 0.5), (math.radians(-90), 0, 0), 0, 0.9, (0.2, 1.0, 0.45))
win.data.keyframe_insert("energy", frame=REVEAL - 1); win.data.energy = 90; win.data.keyframe_insert("energy", frame=REVEAL + 3)
L.area("fill", (0, -4.0, 1.2), (math.radians(80), 0, 0), 60, 4, (0.85, 0.85, 1.0))
L.flash((0.62, -1.4, 0.9), REVEAL + 1, 260, (0.6, 1.0, 0.7))

# ---- confetti + sparks on the reveal ----
proto = L.sparkles(0, FR)
L.burst(proto, (0.62, -0.3, 0.2), 60, REVEAL + 1, 1.5, L.emission_mat("sp", (1, 0.86, 0.5, 1), 6), 0.022)
conf_mats = [L.emission_mat("cf%d" % i, c, 1.3) for i, c in enumerate(((1, 0.78, 0.2, 1), (0.2, 1, 0.45, 1), (0.62, 0.35, 1, 1), (1, 1, 1, 1), (1, 0.35, 0.6, 1)))]
bpy.ops.mesh.primitive_plane_add(size=1); conf0 = bpy.context.object; conf0.scale = (0.035, 0.055, 1); conf0.location = (0, 50, 0)
for i in range(170):
    o = conf0.copy(); o.data = conf0.data.copy(); o.data.materials.append(conf_mats[i % 5]); L.sc.collection.objects.link(o)
    x = random.uniform(-1.9, 1.9); y = random.uniform(-1.6, 0.6); f0_ = REVEAL + random.randint(0, 10); dur = random.randint(60, 95)
    o.location = (x, y, random.uniform(1.9, 2.6)); o.rotation_euler = [random.uniform(0, 6.3) for _ in range(3)]
    o.scale = (0,) * 3; o.keyframe_insert("scale", frame=f0_ - 1); o.scale = (0.035, 0.055, 1); o.keyframe_insert("scale", frame=f0_)
    o.keyframe_insert("location", frame=f0_); o.keyframe_insert("rotation_euler", frame=f0_)
    o.location = (x + random.uniform(-0.4, 0.4), y, random.uniform(-0.7, -0.3)); o.keyframe_insert("location", frame=f0_ + dur)
    o.rotation_euler = [r + random.uniform(6, 14) for r in o.rotation_euler]; o.keyframe_insert("rotation_euler", frame=f0_ + dur)

# ---- the phone (screens are flat pictures from phonescreen.mjs: real status bar, sharp words) ----
phone = bpy.data.objects.new("phone", None); L.sc.collection.objects.link(phone)
PW, PH, PR = 0.29, 0.6, 0.06
SW, SH, SR = PW - 0.018, PH - 0.018, PR - 0.012
body_m, _, _ = L.principled_mat("body", (0.02, 0.02, 0.025, 1), rough=0.28, metal=0.85)
body = L.rrect("body", PW, PH, PR, body_m, z=-0.004, parent=phone)
sol = body.modifiers.new("thick", "SOLIDIFY"); sol.thickness = 0.06; sol.offset = -1
bev = body.modifiers.new("bevel", "BEVEL"); bev.width = 0.012; bev.segments = 4; bev.limit_method = "ANGLE"


def img_mat(name, path, strength=1.0):
    m, nt = L.new_mat(name)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(path, check_existing=True); tex.extension = "CLIP"
    e = L.N(nt, "ShaderNodeEmission", Strength=strength); nt.links.new(tex.outputs["Color"], e.inputs["Color"]); L.out(nt, e.outputs[0])
    return m


def show(o, f_on, f_off=None):
    o.hide_render = True; o.keyframe_insert("hide_render", frame=1)
    o.hide_render = False; o.keyframe_insert("hide_render", frame=f_on)
    if f_off: o.hide_render = True; o.keyframe_insert("hide_render", frame=f_off)


show(L.rrect("scr_scan", SW, SH, SR, img_mat("scanimg", SCAN_PNG), z=0.0005, parent=phone), 1, FLIP)
show(L.rrect("scr_result", SW, SH, SR, img_mat("resimg", RESULT_PNG), z=0.0005, parent=phone), FLIP)
sl = L.rrect("scanline", SW * 0.86, 0.005, 0.002, L.emission_mat("sline", L.CYAN, 6), z=0.003, parent=phone); show(sl, SCAN0, FLIP)
for f, y in ((SCAN0, 0.3), (SCAN0 + 12, -0.2), (SCAN0 + 24, 0.3)):
    sl.location = (0, y, 0); sl.keyframe_insert("location", frame=f)
flash = L.rrect("flash", SW, SH, SR, L.emission_mat("flashm", (1, 1, 1, 1), 2.5), z=0.004, parent=phone)
flash.scale = (0,) * 3; flash.keyframe_insert("scale", frame=FLIP - 2); flash.scale = (1,) * 3; flash.keyframe_insert("scale", frame=FLIP - 1)
flash.keyframe_insert("scale", frame=FLIP + 1); flash.scale = (0,) * 3; flash.keyframe_insert("scale", frame=FLIP + 3)
# in from the lower right, hovers on the camera's line to the right card (so its screen covers that card), then drops away
P_HOVER = (0.47, -1.0, 0.24)
phone.location = (1.9, -1.6, -1.9); phone.rotation_euler = (math.radians(55), 0, math.radians(-30))
phone.keyframe_insert("location", frame=PHONE_IN); phone.keyframe_insert("rotation_euler", frame=PHONE_IN)
phone.location = P_HOVER; phone.rotation_euler = (math.radians(86), 0, math.radians(-5))
phone.keyframe_insert("location", frame=PHONE_IN + 16); phone.keyframe_insert("rotation_euler", frame=PHONE_IN + 16)
phone.location = (P_HOVER[0], P_HOVER[1], P_HOVER[2] + 0.03); phone.rotation_euler = (math.radians(87), 0, math.radians(-3))
phone.keyframe_insert("location", frame=PHONE_OUT); phone.keyframe_insert("rotation_euler", frame=PHONE_OUT)
phone.location = (1.2, -1.5, -2.1); phone.rotation_euler = (math.radians(60), 0, math.radians(16))
phone.keyframe_insert("location", frame=PHONE_OUT + 11); phone.keyframe_insert("rotation_euler", frame=PHONE_OUT + 11)

# ---- camera: front of the stage, slow push, a small hit on the reveal ----
co = L.camera((0, -4.3, 0.42), (0, 0, 0.12))
co.data.dof.use_dof = False
co.keyframe_insert("location", frame=1)
co.location = (0, -4.05, 0.4); co.keyframe_insert("location", frame=REVEAL)
for f, dx, dz in ((REVEAL + 1, 0.025, -0.015), (REVEAL + 3, -0.02, 0.015), (REVEAL + 5, 0.01, -0.006), (REVEAL + 7, 0, 0)):
    co.location = (dx, -4.05, 0.4 + dz); co.keyframe_insert("location", frame=f)
co.location = (0, -3.9, 0.39); co.keyframe_insert("location", frame=FR)


def anchor(name, loc):
    o = bpy.data.objects.new(name, None); L.sc.collection.objects.link(o); o.location = loc; return o


L.export_overlay(OUT, co, {"chipL": anchor("chipL", (-0.62, -0.52, -0.45)), "chipR": anchor("chipR", (0.62, -0.52, -0.45))},
                 {"prices": [LPRICE, RPRICE], "phone_in": PHONE_IN, "flip": FLIP, "phone_out": PHONE_OUT, "reveal": REVEAL, "cta": CTA})
L.bloom(threshold=1.3, strength=0.35, size=0.5)
L.render(OUT)
