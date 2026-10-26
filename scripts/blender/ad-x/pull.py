# X ad A "The Pull" (10-26): square 1200x1200, 8 s. A face-down card floats in the dark, spins and reveals the chase
# card, a scan line sweeps it and green brackets lock on; the card steps left while its name, live price (counts up)
# and its real 3-week price line build on the right; ends on "Scan yours at cardflip.io". Muted-first: every beat reads
# without sound. Text sits at the focus distance (sharp-text rules 10-23: low emission, light bloom, no pulsing).
# Run: blender --background --python pull.py -- <front> <NAME> <set line> <price> <change line> <series csv> <out>
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "poc"))
import bpy, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
FRONT, NAME, SETLINE, PRICE, CHANGE, SERIES, OUT = argv[0], argv[1], argv[2], float(argv[3]), argv[4], argv[5], argv[6]
FR = 240
D = 6.0   # camera-to-card distance
DT = 3.0  # text plane: in front of the floor and the sparkles (no DOF in this scene, so it stays sharp)
L.setup(OUT, FR, res=(1200, 1200))
L.nebula(0.45, FR)
L.glossy_floor(-1.62)

card, hk = L.make_card("card", FRONT, loc=(0, 0, -0.1), scale=1.1)
card.rotation_euler = (math.radians(4), 0, math.radians(180)); card.keyframe_insert("rotation_euler", frame=1)
card.keyframe_insert("location", frame=1)
for f, z in ((14, -0.04), (30, -0.1)):  # face-down float while the hook reads
    card.location = (0, 0, z); card.keyframe_insert("location", frame=f)
card.rotation_euler = (math.radians(-3), 0, math.radians(184)); card.keyframe_insert("rotation_euler", frame=32)
card.keyframe_insert("scale", frame=32)
card.rotation_euler = (0, 0, math.radians(-720)); card.keyframe_insert("rotation_euler", frame=56)   # 2.5 turns, lands face up
card.location = (0, 0, 0.05); card.keyframe_insert("location", frame=56)
card.scale = (1.2,) * 3; card.keyframe_insert("scale", frame=56)
card.keyframe_insert("location", frame=112); card.keyframe_insert("rotation_euler", frame=112); card.keyframe_insert("scale", frame=112)
card.location = (-1.0, 0, 0.12); card.keyframe_insert("location", frame=134)                     # steps left for the price
card.rotation_euler = (0, 0, math.radians(-720 + 12)); card.keyframe_insert("rotation_euler", frame=134)
card.scale = (1.22,) * 3; card.keyframe_insert("scale", frame=134)
for f, z, a in ((180, 0.17, 10), (FR, 0.12, 13)):
    card.location = (-1.0, 0, z); card.keyframe_insert("location", frame=f)
    card.rotation_euler = (0, 0, math.radians(-720 + a)); card.keyframe_insert("rotation_euler", frame=f)
L.holo_sweep(hk, ((1, -1.4), (56, -1.4), (110, 1.4), (170, 1.4), (225, -1.4)), ((1, -1.3), (58, -1.3), (100, 1.3), (180, 1.3), (215, -1.3)))
L.ring((0, -0.1, 0.05), 56, big=2.4); L.flash((0, -1.4, 0.4), 56, 360)
proto = L.sparkles(150, FR, clear_x=1.4, clear_z=(-1.4, 1.4))
L.burst(proto, (0, -0.15, 0.05), 70, 56, 2.4, L.emission_mat("spb", (1, 0.85, 0.55, 1), 6), 0.024)

# scan: a cyan line runs down the card face (parented to the card so it follows), then four green brackets lock on
CW, CH = L.W, L.H
beam = L.emission_mat("beam", L.CYAN, 9)
bpy.ops.mesh.primitive_plane_add(size=1, rotation=(math.radians(90), 0, 0)); bl = bpy.context.object; bl.parent = card
bl.data.materials.append(beam); bl.scale = (0,) * 3; bl.keyframe_insert("scale", frame=63)
for f, z in ((64, CH * 0.98), (94, -CH * 0.98)):
    bl.location = (0, -0.03, z); bl.keyframe_insert("location", frame=f)
    bl.scale = (CW * 2.25, 0.022, 1); bl.keyframe_insert("scale", frame=f)
bl.scale = (0,) * 3; bl.keyframe_insert("scale", frame=95)
wash = L.spot("wash", (0, -1.6, 0.6), (0, 0, 0.05), 0, 50, 0.6, (0.3, 0.9, 1.0), 0.4)
wash.data.keyframe_insert("energy", frame=62); wash.data.energy = 90; wash.data.keyframe_insert("energy", frame=66)
wash.data.keyframe_insert("energy", frame=94); wash.data.energy = 0; wash.data.keyframe_insert("energy", frame=99)
brm = L.emission_mat("bracket", L.GREEN, 4)
hw, hh, arm = CW + 0.07, CH + 0.07, 0.2
for sx in (-1, 1):
    for sz in (-1, 1):
        cd = bpy.data.curves.new("br", "CURVE"); cd.dimensions = "3D"; cd.bevel_depth = 0.014; cd.bevel_resolution = 2
        s = cd.splines.new("POLY"); s.points.add(2)
        for pnt, c in zip(s.points, ((sx * hw, -0.03, sz * (hh - arm)), (sx * hw, -0.03, sz * hh), (sx * (hw - arm), -0.03, sz * hh))): pnt.co = (*c, 1)
        cd.materials.append(brm); o = bpy.data.objects.new("br", cd); L.sc.collection.objects.link(o); o.parent = card
        o.scale = (0,) * 3; o.keyframe_insert("scale", frame=95)
        o.scale = (1.4,) * 3; o.keyframe_insert("scale", frame=96); o.scale = (0.97,) * 3; o.keyframe_insert("scale", frame=102)
        o.scale = (1,) * 3; o.keyframe_insert("scale", frame=106); o.keyframe_insert("scale", frame=128); o.scale = (0,) * 3; o.keyframe_insert("scale", frame=134)
L.flash((0, -1.2, 0.05), 98, 160, (0.4, 1.0, 0.6))

L.spot("top", (0.4, -2.2, 5.2), (0, 0, 0.1), 2200, 55, 0.5, (1, 0.96, 0.92), 0.4)
L.area("rimL", (-2.6, 1.8, 2.4), (math.radians(-60), 0, math.radians(-140)), 650, 2, (0.5, 0.6, 1.0))
L.area("rimR", (2.6, 1.8, 0.2), (math.radians(-90), 0, math.radians(140)), 500, 2, (1.0, 0.5, 0.9))
L.area("fill", (0, -5.0, 0.6), (math.radians(90), 0, 0), 120, 4, (0.85, 0.9, 1.0))

co = L.camera((0, -D - 0.5, 0.05), None, fstop=4.0)
co.data.dof.use_dof = False
co.keyframe_insert("location", frame=1)
co.location = (0, -D, 0.05); co.keyframe_insert("location", frame=56)
for f, dx, dz in ((57, 0.03, -0.02), (59, -0.025, 0.02), (61, 0.012, -0.01), (63, 0, 0)):  # small hit on the reveal
    co.location = (dx, -D, 0.05 + dz); co.keyframe_insert("location", frame=f)
co.keyframe_insert("location", frame=112); co.location = (0, -D + 0.12, 0.05); co.keyframe_insert("location", frame=FR)


# every word (hook, name, set, price count-up, labels, cardflip.io) is drawn flat by overlay.mjs (10-26 v3: 3D text
# read melted); the chart stays in 3D. X0 = the text column's left edge as a share of the frame width.
X0 = 0.495

# the card's real price line (one point a day, gaps joined), drawn left to right under the price
vals = [float(v) for v in SERIES.split(",")]
lo, hi = min(vals), max(vals)
cx0, cx1, cy0, cy1 = X0 + 0.005, 0.925, 0.6, 0.47  # frame fractions: x left..right, y bottom..top
hh_ = DT * (co.data.sensor_height / 2) / co.data.lens
def to_cam(fx, fy): return ((fx - 0.5) * 2 * hh_, (0.5 - fy) * 2 * hh_, -DT)
pts = [to_cam(cx0 + (cx1 - cx0) * i / (len(vals) - 1), cy0 + (cy1 - cy0) * (v - lo) / (hi - lo)) for i, v in enumerate(vals)]
cd = bpy.data.curves.new("chart", "CURVE"); cd.dimensions = "3D"; cd.bevel_depth = 0.0055; cd.bevel_resolution = 3
cd.bevel_factor_mapping_end = "SPLINE"
sp = cd.splines.new("POLY"); sp.points.add(len(pts) - 1)
for pnt, c in zip(sp.points, pts): pnt.co = (*c, 1)
cd.materials.append(L.emission_mat("chartline", L.GREEN, 1.6))
ch = bpy.data.objects.new("chart", cd); L.sc.collection.objects.link(ch); ch.parent = co
cd.bevel_factor_end = 0.0; cd.keyframe_insert("bevel_factor_end", frame=148)
cd.bevel_factor_end = 1.0; cd.keyframe_insert("bevel_factor_end", frame=178)
# soft green fill under the line, unrolled with it
me = bpy.data.meshes.new("fill"); base = to_cam(0, cy0 + 0.02)[1]
vs = [(p[0] - pts[0][0], p[1], 0) for p in pts] + [(p[0] - pts[0][0], base, 0) for p in pts]
n = len(pts); me.from_pydata(vs, [], [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)])
fm, fnt = L.new_mat("fill", blended=True)
fe = L.N(fnt, "ShaderNodeEmission", Color=(0.2, 1.0, 0.45, 1), Strength=0.9); ftr = fnt.nodes.new("ShaderNodeBsdfTransparent")
fmix = L.N(fnt, "ShaderNodeMixShader", Fac=0.12); fnt.links.new(ftr.outputs[0], fmix.inputs[1]); fnt.links.new(fe.outputs[0], fmix.inputs[2]); L.out(fnt, fmix.outputs[0])
me.materials.append(fm); fo = bpy.data.objects.new("fill", me); L.sc.collection.objects.link(fo); fo.parent = co
fo.location = (pts[0][0], 0, -DT - 0.002)
fo.scale = (0.001, 1, 1); fo.keyframe_insert("scale", frame=148); fo.scale = (1, 1, 1); fo.keyframe_insert("scale", frame=178)
dotm = L.emission_mat("dot", L.GREEN, 2.5)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.015, location=pts[-1]); dot = bpy.context.object; dot.data.materials.append(dotm); dot.parent = co
L.pop(dot, 178, big=1.6)
L.export_overlay(OUT, co, {}, {"price": PRICE, "name": NAME, "set": SETLINE, "sub": "MARKET PRICE  ·  NEAR MINT",
                              "chart": CHANGE})   # CHANGE = a timeless chart label, no dated %
L.clear_sparks(proto, co, ((0.08, 0.05, 0.92, 0.18), (0.47, 0.14, 0.98, 0.86)), (1, 40, 120, 180, FR))
L.bloom(threshold=1.0, strength=0.3, size=0.5)
L.render(OUT)
