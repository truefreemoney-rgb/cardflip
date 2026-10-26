# X ad B "Binder money" v2 (10-26): square 1200x1200, 9 s. A closed black portfolio binder (9-pocket pages, no rings:
# Chris 10-26 "whats up with these binder rings? makes no sense") sits on a dark walnut desk under a warm lamp:
# "OLD BINDER IN THE CLOSET?". The cover swings open on a page of nine cards; green scan brackets hop card to card
# (one scan per card, like the app), each card flashes, its price tag pops and the PAGE TOTAL badge pulses up; the
# priciest card goes last and lifts out of its sleeve. Ends "What's YOUR binder worth?  cardflip.io".
# Prices are examples (no dates, no "today": the ad runs for months).
# Run: blender --background --python binder.py -- <out> <hero index 0-8> <front1> <price1> ... <front9> <price9>
import sys, os, math, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "poc"))
import bpy, bmesh, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, HERO = argv[0], int(argv[1])
FRONTS, PRICES = argv[2::2][:9], [float(p) for p in argv[3::2][:9]]
FR = 270
DT = 1.2  # text plane: nearer than anything the camera passes (no DOF here, so it stays sharp)
OPEN0, OPEN1 = 12, 44   # cover swings open
T0, STEP = 54, 10       # first scan, frames per card
L.setup(OUT, FR, res=(1200, 1200))
L.sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.003, 0.003, 1)

# ---- desk: dark walnut, long wavy grain (v1's even stripes read as cardboard) ----
dm, dnt = L.new_mat("desk")
dtc = dnt.nodes.new("ShaderNodeTexCoord")
dmp = L.N(dnt, "ShaderNodeMapping", Scale=(0.35, 3.2, 1.0)); dnt.links.new(dtc.outputs["Object"], dmp.inputs[0])
wave = dnt.nodes.new("ShaderNodeTexWave"); wave.wave_type = "BANDS"; wave.bands_direction = "Y"
for k, v in (("Scale", 1.2), ("Distortion", 7.0), ("Detail", 6.0), ("Detail Scale", 1.4), ("Detail Roughness", 0.6)): wave.inputs[k].default_value = v
dnt.links.new(dmp.outputs[0], wave.inputs["Vector"])
dn2 = L.N(dnt, "ShaderNodeTexNoise", Scale=2.5, Detail=6.0, Roughness=0.5); dnt.links.new(dtc.outputs["Object"], dn2.inputs["Vector"])
dmix = dnt.nodes.new("ShaderNodeMath"); dmix.operation = "MULTIPLY_ADD"; dmix.inputs[1].default_value = 0.55
dnt.links.new(wave.outputs["Fac"], dmix.inputs[0]); dnt.links.new(dn2.outputs["Fac"], dmix.inputs[2])
dramp = dnt.nodes.new("ShaderNodeValToRGB"); el = dramp.color_ramp.elements
el[0].position, el[0].color = 0.25, (0.045, 0.024, 0.012, 1); el[1].position, el[1].color = 1.1, (0.2, 0.115, 0.06, 1)
mid = el.new(0.62); mid.color = (0.12, 0.066, 0.032, 1)
dnt.links.new(dmix.outputs[0], dramp.inputs[0])
dp = L.N(dnt, "ShaderNodeBsdfPrincipled", Roughness=0.38); dnt.links.new(dramp.outputs["Color"], dp.inputs["Base Color"])
if "Specular IOR Level" in dp.inputs: dp.inputs["Specular IOR Level"].default_value = 0.45
dbump = dnt.nodes.new("ShaderNodeBump"); dbump.inputs["Strength"].default_value = 0.04
dnt.links.new(dmix.outputs[0], dbump.inputs["Height"]); dnt.links.new(dbump.outputs[0], dp.inputs["Normal"]); L.out(dnt, dp.outputs[0])
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.08)); bpy.context.object.data.materials.append(dm)

# ---- the binder: padded black leather covers with stitching, a rounded spine, a black 9-pocket page ----
lm, lnt = L.new_mat("leather")
ln = L.N(lnt, "ShaderNodeTexNoise", Scale=420.0, Detail=3.0, Roughness=0.6)
lp = L.N(lnt, "ShaderNodeBsdfPrincipled", Roughness=0.42); lp.inputs["Base Color"].default_value = (0.016, 0.016, 0.019, 1)
if "Specular IOR Level" in lp.inputs: lp.inputs["Specular IOR Level"].default_value = 0.45
lb = lnt.nodes.new("ShaderNodeBump"); lb.inputs["Strength"].default_value = 0.18
lnt.links.new(ln.outputs["Fac"], lb.inputs["Height"]); lnt.links.new(lb.outputs[0], lp.inputs["Normal"]); L.out(lnt, lp.outputs[0])
thread, _, _ = L.principled_mat("thread", (0.32, 0.31, 0.3, 1), rough=0.85)
CW_, CH_, CR_ = 1.52, 2.04, 0.13  # cover half width / half height / corner radius


def stitches(name, hw, hh, r, z, parent, dash=0.032, gap=0.028, width=0.007):
    """One mesh of small thread dashes running round a rounded rectangle."""
    pts = []
    for cx, cy, a0 in ((hw - r, hh - r, 0), (-hw + r, hh - r, 90), (-hw + r, -hh + r, 180), (hw - r, -hh + r, 270)):
        for k in range(13):
            a = math.radians(a0 + k * 7.5); pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts.append(pts[0])
    seg = [(pts[i], pts[i + 1], math.dist(pts[i], pts[i + 1])) for i in range(len(pts) - 1)]
    total = sum(s[2] for s in seg)

    def at(d):
        for a, b, ln_ in seg:
            if d <= ln_: t = d / ln_; return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), (b[0] - a[0]) / ln_, (b[1] - a[1]) / ln_
            d -= ln_
        a, b, ln_ = seg[-1]; return b, (b[0] - a[0]) / ln_, (b[1] - a[1]) / ln_
    me = bpy.data.meshes.new(name); bm = bmesh.new(); d = 0.0
    while d + dash < total:
        (x0, y0), tx, ty = at(d); (x1, y1), _, _ = at(d + dash); nx, ny = -ty * width / 2, tx * width / 2
        bm.faces.new([bm.verts.new(v) for v in ((x0 + nx, y0 + ny, z), (x0 - nx, y0 - ny, z), (x1 - nx, y1 - ny, z), (x1 + nx, y1 + ny, z))])
        d += dash + gap
    bm.to_mesh(me); bm.free(); me.materials.append(thread)
    o = bpy.data.objects.new(name, me); L.sc.collection.objects.link(o); o.parent = parent; return o


back = L.rrect("backcover", CW_, CH_, CR_, lm, z=-0.012)
bs = back.modifiers.new("thick", "SOLIDIFY"); bs.thickness = 0.06; bs.offset = -1
bv = back.modifiers.new("bevel", "BEVEL"); bv.width = 0.012; bv.segments = 3; bv.limit_method = "ANGLE"
stitches("backstitch", CW_ - 0.055, CH_ - 0.055, CR_ - 0.05, -0.011, back)
bpy.ops.mesh.primitive_cylinder_add(radius=0.07, depth=2 * CH_ - 0.06, location=(-CW_, 0, 0.012), rotation=(math.radians(90), 0, 0))
spine = bpy.context.object; spine.data.materials.append(lm)
# front cover hinges on the spine: pivot on the spine axis, closed = lying over the page, open = flipped flat to the left
hinge = bpy.data.objects.new("hinge", None); L.sc.collection.objects.link(hinge); hinge.location = (-CW_, 0, 0.045)
front = L.rrect("frontcover", CW_, CH_, CR_, lm, z=0.0, parent=hinge); front.location = (CW_, 0, 0)
fs = front.modifiers.new("thick", "SOLIDIFY"); fs.thickness = 0.06; fs.offset = 1
fb = front.modifiers.new("bevel", "BEVEL"); fb.width = 0.014; fb.segments = 3; fb.limit_method = "ANGLE"
stitches("frontstitch", CW_ - 0.06, CH_ - 0.06, CR_ - 0.05, 0.0615, front)
hinge.keyframe_insert("rotation_euler", frame=OPEN0)
hinge.rotation_euler = (0, math.radians(-182), 0); hinge.keyframe_insert("rotation_euler", frame=OPEN1)
for fc in hinge.animation_data.action.fcurves if hinge.animation_data.action and hasattr(hinge.animation_data.action, "fcurves") else []:
    for kp in fc.keyframe_points: kp.interpolation = "BEZIER"; kp.easing = "EASE_IN_OUT"

pm, pnt = L.new_mat("page")   # the black pocket sheet
ptc = pnt.nodes.new("ShaderNodeTexCoord"); pn = L.N(pnt, "ShaderNodeTexNoise", Scale=90, Detail=4, Roughness=0.6)
pnt.links.new(ptc.outputs["Object"], pn.inputs["Vector"])
pp = L.N(pnt, "ShaderNodeBsdfPrincipled", Roughness=0.6); pp.inputs["Base Color"].default_value = (0.022, 0.022, 0.027, 1)
pbump = pnt.nodes.new("ShaderNodeBump"); pbump.inputs["Strength"].default_value = 0.1
pnt.links.new(pn.outputs["Fac"], pbump.inputs["Height"]); pnt.links.new(pbump.outputs[0], pp.inputs["Normal"]); L.out(pnt, pp.outputs[0])
L.rrect("page", 1.39, 1.92, 0.05, pm, z=0.0)
seam_mat, _, _ = L.principled_mat("seam", (0.55, 0.57, 0.6, 1), rough=0.3, alpha=0.5, spec=0.8)
for x in (-0.42, 0.42):   # pocket seams between columns and rows
    L.rrect("seamv", 0.006, 1.8, 0.003, seam_mat, z=0.032).location = (x, 0, 0)
for y in (-0.585, 0.585):
    L.rrect("seamh", 1.28, 0.006, 0.003, seam_mat, z=0.032).location = (0, y, 0)

sleeve_mat, _, _ = L.principled_mat("sleeve", (0.9, 0.92, 0.95, 1), rough=0.05, alpha=0.14, spec=0.9)
plate_mat, _, _ = L.principled_mat("plate", (0.012, 0.014, 0.02, 1), rough=0.35)
rim_mat = L.emission_mat("rim", L.GREEN, 2.0)
shine_mat = L.emission_mat("shine", (0.85, 1.0, 0.95, 1), 4.0)
pos, cards = [], []
for i, front_img in enumerate(FRONTS):
    gx, gy = i % 3, i // 3
    x, y = (gx - 1) * 0.84, (1 - gy) * 1.17
    c, hk = L.make_card("c%d" % i, front_img, loc=(x, y, 0.012), scale=0.6, flat=True, holo=(i == HERO))
    c.rotation_euler = (0, 0, math.radians(random.uniform(-1.4, 1.4)))
    L.rrect("sleeve%d" % i, 0.4, 0.56, 0.02, sleeve_mat, z=0.03).location = (x, y + 0.01, 0)
    pos.append((x, y)); cards.append((c, hk))


def tag(name, price, loc, parent=None, s=1.0):
    """A dark rounded price plate with a green rim and the green price, tilted toward the camera."""
    root = bpy.data.objects.new(name, None); L.sc.collection.objects.link(root)
    if parent: root.parent = parent
    root.location = loc; root.rotation_euler = (math.radians(35), 0, 0)
    L.rrect(name + "_rim", 0.29 * s, 0.092 * s, 0.07 * s, rim_mat, z=-0.004, parent=root)
    L.rrect(name + "_plate", 0.278 * s, 0.08 * s, 0.06 * s, plate_mat, z=0.0, parent=root)
    t = L.text(name + "_t", f"${price:,.2f}", (0, 0, 0.004), 0.12 * s, L.GREEN, 1.15, rot=(0, 0, 0)); t.parent = root
    t.location = (0, 0, 0.004)
    return root


order = [i for i in range(9) if i != HERO] + [HERO]
land = {}
for k, i in enumerate(order):
    land[i] = T0 + STEP * k + 3

# scanner: four green corner brackets on an empty that slides card to card and pops on each landing
scanner = bpy.data.objects.new("scanner", None); L.sc.collection.objects.link(scanner)
brm = L.emission_mat("bracket", L.GREEN, 3.5)
hw, hh, arm = 0.63 * 0.6 + 0.05, 0.88 * 0.6 + 0.05, 0.13
for sx in (-1, 1):
    for sy in (-1, 1):
        cd = bpy.data.curves.new("br", "CURVE"); cd.dimensions = "3D"; cd.bevel_depth = 0.011; cd.bevel_resolution = 2
        s_ = cd.splines.new("POLY"); s_.points.add(2)
        for pnt, c_ in zip(s_.points, ((sx * hw, sy * (hh - arm), 0), (sx * hw, sy * hh, 0), (sx * (hw - arm), sy * hh, 0))): pnt.co = (*c_, 1)
        cd.materials.append(brm); o = bpy.data.objects.new("br", cd); L.sc.collection.objects.link(o); o.parent = scanner
scanner.scale = (0,) * 3; scanner.keyframe_insert("scale", frame=T0 - 3)
for k, i in enumerate(order):
    t = T0 + STEP * k; x, y = pos[i]
    scanner.location = (x, y, 0.06); scanner.keyframe_insert("location", frame=t); scanner.keyframe_insert("location", frame=t + 4)
    scanner.scale = (1.3,) * 3; scanner.keyframe_insert("scale", frame=t + 1)
    scanner.scale = (1.0,) * 3; scanner.keyframe_insert("scale", frame=t + 4)
    # a quick light sweep across the card as it is read
    sh = L.rrect("shine%d" % i, 0.035, 0.62, 0.01, shine_mat, z=0.04); sh.rotation_euler = (0, 0, math.radians(-28))
    sh.scale = (0,) * 3; sh.keyframe_insert("scale", frame=t - 1)
    sh.location = (x - 0.42, y, 0); sh.keyframe_insert("location", frame=t); sh.scale = (1,) * 3; sh.keyframe_insert("scale", frame=t)
    sh.location = (x + 0.42, y, 0); sh.keyframe_insert("location", frame=t + 6); sh.keyframe_insert("scale", frame=t + 6)
    sh.scale = (0,) * 3; sh.keyframe_insert("scale", frame=t + 7)
last = T0 + STEP * (len(order) - 1)
scanner.keyframe_insert("scale", frame=last + 7); scanner.scale = (0,) * 3; scanner.keyframe_insert("scale", frame=last + 11)

f0 = last + 9  # the hero's lift starts here
for i in order:
    if i == HERO: continue
    x, y = pos[i]
    tg = tag("tag%d" % i, PRICES[i], (x, y - 0.33, 0.085)); L.pop(tg, land[i], big=1.25)
    tg.keyframe_insert("scale", frame=f0 + 6); tg.scale = (0,) * 3; tg.keyframe_insert("scale", frame=f0 + 14)  # clear the stage

# the hero: scanned last, slides out of its sleeve and lifts toward the camera with its price
hero, hk = cards[HERO]; hx, hy = pos[HERO]
HZ, HY = 1.1, -0.3
hero.keyframe_insert("location", frame=f0); hero.keyframe_insert("rotation_euler", frame=f0); hero.keyframe_insert("scale", frame=f0)
hero.location = (hx, hy + 0.5, 0.05); hero.keyframe_insert("location", frame=f0 + 10)
hero.location = (0, HY, HZ); hero.keyframe_insert("location", frame=f0 + 30)
hero.rotation_euler = (math.radians(36), 0, 0); hero.keyframe_insert("rotation_euler", frame=f0 + 30)
hero.scale = (0.68,) * 3; hero.keyframe_insert("scale", frame=f0 + 30)
for f, z, a in ((f0 + 70, HZ + 0.05, 37), (FR, HZ - 0.01, 35)):
    hero.location = (0, HY, z); hero.keyframe_insert("location", frame=f)
    hero.rotation_euler = (math.radians(a), 0, math.radians(0.8 if f < FR else -0.8)); hero.keyframe_insert("rotation_euler", frame=f)
L.holo_sweep(hk, ((1, -1.4), (f0 + 30, -1.4), (f0 + 75, 1.4), (FR, -1.4)), ((1, -1.3), (f0 + 32, -1.3), (f0 + 65, 1.3), (FR, 1.3)))
htag = tag("tagH", PRICES[HERO], (0, -0.6, 0.03), parent=hero, s=1.6); htag.rotation_euler = (0, 0, 0)  # on the card's lower half
L.pop(htag, f0 + 32, big=1.2)
land[HERO] = f0 + 32
proto = L.sparkles(0, FR)
L.ring((0, HY, HZ), f0 + 30, big=1.8, rot=(math.radians(36), 0, 0))
L.burst(proto, (0, HY, HZ), 50, f0 + 30, 1.4, L.emission_mat("sp", (1, 0.85, 0.55, 1), 6), 0.02)
L.flash((0, -1.2, 2.6), f0 + 30, 240)

# lighting: a warm desk lamp pool from the upper left, a cool weak fill, a rim on the binder edge
L.spot("lamp", (-2.2, -1.6, 5.2), (0.1, 0.0, 0.0), 1700, 58, 0.85, (1.0, 0.9, 0.78), 0.6)
fill = L.area("fill", (3.2, -1.0, 3.0), (math.radians(-35), math.radians(50), 0), 90, 3, (0.7, 0.78, 1.0))
L.area("rim", (0.5, 3.4, 2.2), (math.radians(-65), 0, math.radians(180)), 160, 3, (1.0, 0.9, 0.8))
hs = L.spot("herospot", (0.6, -2.4, 4.6), (0, HY, HZ), 0, 30, 0.6, (1, 1, 1), 0.3)
hs.data.keyframe_insert("energy", frame=f0); hs.data.energy = 120; hs.data.keyframe_insert("energy", frame=f0 + 24)

# camera: low and close on the closed binder, cranes up over the page as the cover opens, slow push during the scan
co = L.camera((0.9, -3.4, 1.5), (0.05, -0.2, 0.0))
co.data.dof.use_dof = False
aim = [o for o in L.sc.objects if o.name == "cam_aim"][0]
co.keyframe_insert("location", frame=1); aim.keyframe_insert("location", frame=1)
co.location = (0.75, -3.35, 1.75); co.keyframe_insert("location", frame=OPEN0)
co.location = (-0.12, -3.55, 4.75); co.keyframe_insert("location", frame=OPEN1 + 8)
aim.location = (0, -0.2, 0.1); aim.keyframe_insert("location", frame=OPEN1 + 8)
co.location = (0.12, -3.3, 4.45); co.keyframe_insert("location", frame=FR)


def hud(name, body, fx, fy, frac, color, strength=1.1, font_path=L.FONT_HEAVY):
    return L.hud(co, name, body, fx, fy, frac, color, strength, d=DT, font_path=font_path)


hook = hud("hook", "OLD BINDER IN THE CLOSET?", 0.5, 0.085, 0.05, L.WHITE, 1.0)  # on screen from frame 1
hook.keyframe_insert("scale", frame=OPEN1 - 2); hook.scale = (0,) * 3; hook.keyframe_insert("scale", frame=OPEN1 + 3)
pill = L.hud_pill(co, "totpill", 0.5, 0.085, 0.4, 0.125, DT); L.pop(pill, T0 - 2, big=1.08)
lab = hud("label", "PAGE TOTAL", 0.5, 0.047, 0.024, L.WHITE, 0.9, L.FONT_BOLD); L.pop(lab, T0 - 2)
tot = hud("total", "$0.00", 0.5, 0.102, 0.068, L.GREEN, 1.05); L.pop(tot, T0 - 2)
for i in order:   # the badge bumps each time a price lands
    fl = land[i]
    pill.scale = (1.0,) * 3; pill.keyframe_insert("scale", frame=fl)
    pill.scale = (1.07,) * 3; pill.keyframe_insert("scale", frame=fl + 2)
    pill.scale = (1.0,) * 3; pill.keyframe_insert("scale", frame=fl + 6)
events = sorted((land[i], PRICES[i]) for i in range(9))


def total(scene, *_):
    f = scene.frame_current; v = 0.0
    for fl, pr in events:
        if f >= fl + 8: v += pr
        elif f > fl: t = (f - fl) / 8; v += pr * (1 - (1 - t) ** 3)
    tot.data.body = f"${v:,.2f}"


L.every_frame(total)
L.pop(L.hud_pill(co, "ctapill", 0.5, 0.865, 0.74, 0.15, DT), f0 + 58, big=1.06)
q = hud("q", "What's YOUR binder worth?", 0.5, 0.83, 0.048, L.WHITE, 1.0); L.pop(q, f0 + 60)
url = hud("url", "cardflip.io", 0.5, 0.897, 0.062, L.LILAC, 1.5); L.pop(url, f0 + 66)
L.bloom(threshold=1.0, strength=0.3, size=0.5)
L.render(OUT)
