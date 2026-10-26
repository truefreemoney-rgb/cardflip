# X ad C "Don't get lowballed" (10-26, replaces the plain phone scan: Chris "C just seems kinda plain and boring").
# Square 1200x1200, 8.5 s. Trade night: a card in a top-loader on a dark playmat under one spotlight; a yellow sticky
# note slides in, handwritten "I'll give you $5 for it" ("GOOD DEAL?"). A phone flies in and scans the card, its
# CardFlip screen counts up the market price, the big green price lands beside the note, a red marker X strikes the
# offer and the note flies off: "DON'T GET LOWBALLED." + "Scan it first  ·  cardflip.io". Price = an example.
# Run: blender --background --python lowball.py -- <front> <NAME> <set line> <price> <offer line 1> <offer line 2> <logo png> <out>
import sys, os, math, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "poc"))
import bpy, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
FRONT, NAME, SETLINE, PRICE, OFFER1, OFFER2, LOGO, OUT = argv[0], argv[1], argv[2], float(argv[3]), argv[4], argv[5], argv[6], argv[7]
FR = 255
DT = 1.0
INK = r"C:\Windows\Fonts\segoeprb.ttf"  # Segoe Print Bold: handwriting that still reads on a phone
PURPLE = (0.42, 0.16, 0.95, 1)
L.setup(OUT, FR, res=(1200, 1200))
L.sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.003, 0.003, 0.005, 1)

# ---- playmat: dark charcoal fabric ----
mm, mnt = L.new_mat("mat")
mtc = mnt.nodes.new("ShaderNodeTexCoord"); mno = L.N(mnt, "ShaderNodeTexNoise", Scale=260.0, Detail=4.0, Roughness=0.7)
mnt.links.new(mtc.outputs["Object"], mno.inputs["Vector"])
mbig = L.N(mnt, "ShaderNodeTexNoise", Scale=1.6, Detail=2.0); mnt.links.new(mtc.outputs["Object"], mbig.inputs["Vector"])
mramp = mnt.nodes.new("ShaderNodeValToRGB"); e_ = mramp.color_ramp.elements
e_[0].position, e_[0].color = 0.3, (0.018, 0.016, 0.045, 1); e_[1].position, e_[1].color = 0.75, (0.055, 0.035, 0.1, 1)  # printed-playmat navy/purple
mnt.links.new(mbig.outputs["Fac"], mramp.inputs[0])
mp_ = L.N(mnt, "ShaderNodeBsdfPrincipled", Roughness=0.93); mnt.links.new(mramp.outputs["Color"], mp_.inputs["Base Color"])
mb = mnt.nodes.new("ShaderNodeBump"); mb.inputs["Strength"].default_value = 0.25
mnt.links.new(mno.outputs["Fac"], mb.inputs["Height"]); mnt.links.new(mb.outputs[0], mp_.inputs["Normal"]); L.out(mnt, mp_.outputs[0])
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0)); bpy.context.object.data.materials.append(mm)

# ---- the card in a clear top-loader ----
CX, CY = -0.55, 0.12
card, hk = L.make_card("card", FRONT, loc=(CX, CY, 0.012), scale=0.72, flat=True)
card.rotation_euler = (0, 0, math.radians(-5))
L.holo_sweep(hk, ((1, -1.4), (20, -1.4), (70, 1.4), (150, 1.4), (230, -1.4)), ((1, -1.3), (24, -1.3), (60, 1.3), (160, 1.3), (220, -1.3)))
tl_mat, _, _ = L.principled_mat("toploader", (0.95, 0.97, 1.0, 1), rough=0.04, alpha=0.1, spec=1.0)
tl = L.rrect("toploader", 0.5, 0.69, 0.025, tl_mat, z=0.004); tl.location = (CX, CY, 0); tl.rotation_euler = (0, 0, math.radians(-5))
tls = tl.modifiers.new("thick", "SOLIDIFY"); tls.thickness = 0.03; tls.offset = 1

# ---- the lowball: a yellow sticky note with a handwritten offer ----
note = bpy.data.objects.new("note", None); L.sc.collection.objects.link(note)
paper, _, _ = L.principled_mat("paper", (1.0, 0.84, 0.22, 1), rough=0.75)
L.rrect("notepaper", 0.57, 0.57, 0.012, paper, z=0.0, parent=note)
ink = L.principled_mat("ink", (0.015, 0.02, 0.08, 1), rough=0.6)[0]
for nm_, body, y, sz in (("o1", OFFER1, 0.2, 0.18), ("o2", OFFER2, -0.14, 0.255)):
    bpy.ops.object.text_add(); t = bpy.context.object; t.name = nm_; t.data.body = body; t.data.font = L.font(INK)
    t.data.size = sz; t.data.align_x = "CENTER"; t.data.align_y = "CENTER"; t.data.materials.append(ink); t.parent = note; t.location = (0, y, 0.002)
NX, NY = 0.82, 0.62
note.location = (2.6, NY + 0.2, 0.01); note.rotation_euler = (0, 0, math.radians(24)); note.keyframe_insert("location", frame=3); note.keyframe_insert("rotation_euler", frame=3)
note.location = (NX, NY, 0.01); note.rotation_euler = (0, 0, math.radians(7)); note.keyframe_insert("location", frame=15); note.keyframe_insert("rotation_euler", frame=15)
# red marker X, then the note crumples and flies off
red = L.principled_mat("marker", (0.85, 0.04, 0.05, 1), rough=0.5)[0]
XS = 120
for k, (a, b) in enumerate((((-0.44, 0.44), (0.44, -0.44)), ((0.44, 0.44), (-0.44, -0.44)))):
    cd = bpy.data.curves.new("x%d" % k, "CURVE"); cd.dimensions = "3D"; cd.bevel_depth = 0.028; cd.bevel_resolution = 2
    cd.bevel_factor_mapping_end = "SPLINE"
    s_ = cd.splines.new("POLY"); s_.points.add(1); s_.points[0].co = (a[0], a[1], 0.01, 1); s_.points[1].co = (b[0], b[1], 0.01, 1)
    cd.materials.append(red); xo = bpy.data.objects.new("x%d" % k, cd); L.sc.collection.objects.link(xo); xo.parent = note
    cd.bevel_factor_end = 0.0; cd.keyframe_insert("bevel_factor_end", frame=XS + k * 7)
    cd.bevel_factor_end = 1.0; cd.keyframe_insert("bevel_factor_end", frame=XS + k * 7 + 5)
note.keyframe_insert("location", frame=XS + 20); note.keyframe_insert("rotation_euler", frame=XS + 20); note.keyframe_insert("scale", frame=XS + 20)
note.scale = (0.9, 0.55, 1); note.keyframe_insert("scale", frame=XS + 25)                       # crumple
note.location = (2.9, 1.6, 0.9); note.rotation_euler = (math.radians(40), math.radians(-30), math.radians(160))
note.keyframe_insert("location", frame=XS + 36); note.keyframe_insert("rotation_euler", frame=XS + 36)
note.scale = (0.4, 0.3, 0.4); note.keyframe_insert("scale", frame=XS + 36)

# ---- phone (unscaled pivot so its UI text is not squashed) ----
phone = bpy.data.objects.new("phone", None); L.sc.collection.objects.link(phone)
PW, PH, PR = 0.29, 0.6, 0.06
SW, SH, SR = PW - 0.018, PH - 0.018, PR - 0.012
body_m, _, _ = L.principled_mat("body", (0.02, 0.02, 0.025, 1), rough=0.28, metal=0.85)
body = L.rrect("body", PW, PH, PR, body_m, z=-0.004, parent=phone)
sol = body.modifiers.new("thick", "SOLIDIFY"); sol.thickness = 0.06; sol.offset = -1
bev = body.modifiers.new("bevel", "BEVEL"); bev.width = 0.012; bev.segments = 4; bev.limit_method = "ANGLE"


def img_mat(name, path, strength=1.0, alpha=False):
    m, nt = L.new_mat(name, blended=alpha)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(path, check_existing=True); tex.extension = "CLIP"
    e = L.N(nt, "ShaderNodeEmission", Strength=strength); nt.links.new(tex.outputs["Color"], e.inputs["Color"])
    if alpha:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mx = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(tex.outputs["Alpha"], mx.inputs[0]); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(e.outputs[0], mx.inputs[2]); L.out(nt, mx.outputs[0])
    else:
        L.out(nt, e.outputs[0])
    return m


def show(o, f_on, f_off=None):
    o.hide_render = True; o.keyframe_insert("hide_render", frame=1)
    o.hide_render = False; o.keyframe_insert("hide_render", frame=f_on)
    if f_off: o.hide_render = True; o.keyframe_insert("hide_render", frame=f_off)


def ui_text(name, body, x, y, size, color, strength=1.0, font_path=L.FONT_BOLD):
    t = L.text(name, body, (0, 0, 0), size, color, strength, rot=(0, 0, 0), font_path=font_path); t.parent = phone
    t.location = (x, y, 0.004); return t


SCAN0, FLIP = 52, 78
L.rrect("screen", SW, SH, SR, L.emission_mat("scr", (0.012, 0.012, 0.02, 1), 1.0), z=0.0, parent=phone)
cam_card = L.rrect("camcard", 0.2, 0.28, 0.018, img_mat("camimg", FRONT, 0.95), z=0.001, parent=phone)
cam_card.location = (0, 0.02, 0); cam_card.rotation_euler = (0, 0, math.radians(-5)); show(cam_card, 1, FLIP)
vfm = L.emission_mat("vf", L.CYAN, 2.2)
for sx in (-1, 1):
    for sy in (-1, 1):
        cd = bpy.data.curves.new("vf", "CURVE"); cd.dimensions = "3D"; cd.bevel_depth = 0.004
        s_ = cd.splines.new("POLY"); s_.points.add(2); hw_, hh_, a_ = 0.235, 0.32, 0.06
        for pnt, c_ in zip(s_.points, ((sx * hw_, 0.02 + sy * (hh_ - a_), 0.003), (sx * hw_, 0.02 + sy * hh_, 0.003), (sx * (hw_ - a_), 0.02 + sy * hh_, 0.003))): pnt.co = (*c_, 1)
        cd.materials.append(vfm); o = bpy.data.objects.new("vf", cd); L.sc.collection.objects.link(o); o.parent = phone; show(o, 1, FLIP)
scan_lbl = ui_text("scanning", "SCANNING…", 0, -0.43, 0.035, L.CYAN, 1.2); show(scan_lbl, SCAN0 - 4, FLIP)
sl = L.rrect("scanline", 0.24, 0.004, 0.002, L.emission_mat("sline", L.CYAN, 6), z=0.004, parent=phone); show(sl, SCAN0, FLIP)
for f, y in ((SCAN0, 0.32), (SCAN0 + 13, -0.28), (FLIP - 1, 0.3)):
    sl.location = (0, y, 0); sl.keyframe_insert("location", frame=f)
beam = L.rrect("beam", 0.62, 0.006, 0.003, L.emission_mat("beam", L.CYAN, 8), z=0.05)
beam.rotation_euler = (0, 0, math.radians(-5)); show(beam, SCAN0, FLIP)
for f, y in ((SCAN0, CY + 0.7), (SCAN0 + 13, CY - 0.7), (FLIP - 1, CY + 0.6)):
    beam.location = (CX, y, 0.05); beam.keyframe_insert("location", frame=f)
logo = L.rrect("logo", 0.15, 0.15 * 128 / 680, 0.001, img_mat("logo", LOGO, 1.0, alpha=True), z=0.002, parent=phone)
logo.location = (0, 0.53, 0); show(logo, FLIP)
res_card = L.rrect("rescard", 0.105, 0.147, 0.01, img_mat("resimg", FRONT, 1.0), z=0.002, parent=phone)
res_card.location = (0, 0.3, 0); show(res_card, FLIP); L.pop(res_card, FLIP, big=1.1)
show(ui_text("name", NAME, 0, 0.105, 0.052, L.WHITE, 1.0, L.FONT_HEAVY), FLIP)
show(ui_text("set", SETLINE, 0, 0.055, 0.026, (0.62, 0.64, 0.7, 1), 1.0), FLIP)
chip = L.rrect("chip", 0.075, 0.019, 0.019, L.emission_mat("chip", (0.1, 0.32, 0.18, 1), 1.0), z=0.002, parent=phone); chip.location = (0, 0.0, 0); show(chip, FLIP)
show(ui_text("chipt", "NEAR MINT", 0, 0.0, 0.022, L.GREEN, 1.0), FLIP)
show(ui_text("mkt", "Market price", 0, -0.06, 0.026, (0.62, 0.64, 0.7, 1), 1.0), FLIP)
sp_ = ui_text("sprice", "$0.00", 0, -0.135, 0.1, L.GREEN, 1.05, L.FONT_HEAVY); show(sp_, FLIP); L.count_up(sp_, PRICE, FLIP + 2, 20)
btn = L.rrect("btn", 0.21, 0.042, 0.042, L.emission_mat("btn", PURPLE, 1.0), z=0.002, parent=phone); btn.location = (0, -0.29, 0); show(btn, FLIP)
show(ui_text("btnt", "List on eBay", 0, -0.29, 0.034, L.WHITE, 1.0), FLIP)
btn2 = L.rrect("btn2", 0.21, 0.042, 0.042, L.emission_mat("btn2", (0.09, 0.09, 0.13, 1), 1.0), z=0.002, parent=phone); btn2.location = (0, -0.4, 0); show(btn2, FLIP)
show(ui_text("btn2t", "Add to collection", 0, -0.4, 0.03, L.WHITE, 1.0), FLIP)
flash = L.rrect("flash", SW, SH, SR, L.emission_mat("flashm", (1, 1, 1, 1), 3.0), z=0.006, parent=phone)
flash.scale = (0,) * 3; flash.keyframe_insert("scale", frame=FLIP - 2); flash.scale = (1,) * 3; flash.keyframe_insert("scale", frame=FLIP - 1)
flash.keyframe_insert("scale", frame=FLIP + 1); flash.scale = (0,) * 3; flash.keyframe_insert("scale", frame=FLIP + 3)
# the phone rises in from below the frame and hovers over the card, screen tilted to the camera
phone.location = (CX - 0.1, -2.6, 0.5); phone.rotation_euler = (math.radians(70), 0, math.radians(14))
phone.keyframe_insert("location", frame=28); phone.keyframe_insert("rotation_euler", frame=28)
PL, TILT = (CX, -0.3, 0.95), 34   # tilt = screen square to the (steep) camera
phone.location = PL; phone.rotation_euler = (math.radians(TILT), 0, math.radians(-3))
phone.keyframe_insert("location", frame=50); phone.keyframe_insert("rotation_euler", frame=50)
for f, dz, a in ((110, 0.03, -2), (180, -0.02, -4), (FR, 0.02, -2.5)):
    phone.location = (PL[0], PL[1], PL[2] + dz); phone.keyframe_insert("location", frame=f)
    phone.rotation_euler = (math.radians(TILT), 0, math.radians(a)); phone.keyframe_insert("rotation_euler", frame=f)

# lights: one cool overhead spot (trade-night table), soft magenta + cyan rims for style
L.spot("top", (0.1, -0.8, 5.0), (0.1, 0.2, 0), 1500, 62, 0.75, (1.0, 0.98, 0.95), 0.5)
L.area("rimM", (-3.0, 2.2, 1.6), (math.radians(-70), 0, math.radians(-125)), 110, 2.5, (1.0, 0.25, 0.75))
L.area("rimC", (3.0, 2.2, 1.6), (math.radians(-70), 0, math.radians(125)), 95, 2.5, (0.2, 0.85, 1.0))
L.area("front", (0.2, -3.2, 2.4), (math.radians(60), 0, 0), 70, 3, (0.9, 0.92, 1.0))

co = L.camera((0.05, -2.0, 3.6), (0.08, 0.12, 0.25))   # ~58 deg down: flat things (card, note) read
co.data.dof.use_dof = False
co.keyframe_insert("location", frame=1); co.location = (0.1, -1.9, 3.5); co.keyframe_insert("location", frame=FR)


def hud(name, body, fx, fy, frac, color, strength=1.0, font_path=L.FONT_HEAVY):
    return L.hud(co, name, body, fx, fy, frac, color, strength, d=DT, font_path=font_path)


q = hud("q", "GOOD DEAL?", 0.5, 0.08, 0.058, L.WHITE, 1.0); L.pop(q, 17)
q.keyframe_insert("scale", frame=XS + 30); q.scale = (0,) * 3; q.keyframe_insert("scale", frame=XS + 35)
worth = hud("worth", "ACTUALLY WORTH", 0.74, 0.64, 0.03, L.WHITE, 0.9, L.FONT_BOLD); L.pop(worth, 100)
big = hud("big", "$0.00", 0.74, 0.71, 0.1, L.GREEN, 1.05); L.pop(big, 102, big=1.3); L.count_up(big, PRICE, 102, 16)
proto = L.sparkles(0, FR)
headline = hud("headline", "DON'T GET LOWBALLED.", 0.5, 0.08, 0.06, L.WHITE, 1.0); L.pop(headline, XS + 38)
L.pop(L.hud_pill(co, "ctapill", 0.5, 0.9, 0.66, 0.1, DT), XS + 46, big=1.06)
cta = hud("cta", "Scan it first  ·  cardflip.io", 0.5, 0.9, 0.042, L.LILAC, 1.3); L.pop(cta, XS + 48)
L.bloom(threshold=1.2, strength=0.25, size=0.5)
L.render(OUT)
