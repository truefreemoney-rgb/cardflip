# POC B "Keep or sell: A vs B": two cards slide in from the sides, VS flash, both prices count up, "Comment A or B".
# 5 s. Run: blender --background --python vs.py -- <frontA> <nameA> <priceA> <frontB> <nameB> <priceB> <out>
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
FA, NA, PA, FB, NB, PB, OUT = argv[0], argv[1], float(argv[2]), argv[3], argv[4], float(argv[5]), argv[6]
FR = 150
L.setup(OUT, FR)
L.nebula(0.7, FR)
L.studio_lights()
proto = L.sparkles(150, FR, clear_x=0.0, clear_z=(0, 0))

def enter(card, hk, x_from, x_to, tilt, f0, f1):
    card.location = (x_from, 0.6, 0.55); card.keyframe_insert("location", frame=f0)
    card.location = (x_to * 1.08, 0, 0.55); card.keyframe_insert("location", frame=f1 - 4)
    card.location = (x_to, 0, 0.55); card.keyframe_insert("location", frame=f1)
    card.rotation_euler = (math.radians(8), 0, math.radians(180 + 360)); card.keyframe_insert("rotation_euler", frame=f0)
    card.rotation_euler = (0, 0, math.radians(tilt)); card.keyframe_insert("rotation_euler", frame=f1)
    for f, a in ((f1 + 40, 3), (f1 + 80, -2), (FR, 1)):
        card.rotation_euler = (math.radians(a * 0.6), 0, math.radians(tilt + a)); card.keyframe_insert("rotation_euler", frame=f)
    L.holo_sweep(hk, ((1, -1.4), (f1, -1.4), (f1 + 45, 1.4), (f1 + 80, -1.4), (FR, 1.4)), ((1, -1.3), (f1 + 2, -1.3), (f1 + 36, 1.3), (FR, 1.3)))

A, hA = L.make_card("A", FA, loc=(-3.2, 0.6, 0.55), scale=0.58); enter(A, hA, -3.2, -0.62, -12, 1, 28)
B, hB = L.make_card("B", FB, loc=(3.2, 0.6, 0.55), scale=0.58); enter(B, hB, 3.2, 0.62, 12, 8, 35)

vs = L.text("vs", "VS", (0, -0.25, 0.55), 0.3, L.GOLD, 2.0); L.pop(vs, 36, 1.4)
L.ring((0, -0.1, 0.55), 36, big=2.0); L.flash((0, -1.2, 0.7), 36, 300)
L.burst(proto, (0, -0.15, 0.55), 50, 36, 1.6, L.emission_mat("sp2", (1, 0.85, 0.55, 1), 6), 0.022)

for x, nm, pr, tag, f0 in ((-0.62, NA, PA, "A", 30), (0.62, NB, PB, "B", 37)):
    badge = L.text("badge" + tag, tag, (x, -0.3, 1.2), 0.2, L.GOLD, 2.2); L.pop(badge, f0, 1.4)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.012, location=(x, -0.28, 1.2), rotation=(math.radians(90), 0, 0))
    r = bpy.context.object; r.data.materials.append(L.emission_mat("bring" + tag, L.GOLD, 3.0)); L.pop(r, f0, 1.3)
    name = L.text("name" + tag, nm.upper(), (x, -0.3, -0.1), 0.095, L.WHITE, 1.6); L.pop(name, 44)
    price = L.text("price" + tag, "$0", (x, -0.3, -0.36), 0.24, L.GREEN, 1.3); L.pop(price, 48)
    L.count_up(price, pr, 48, 26)
L.burst(proto, (-0.62, -0.35, -0.36), 25, 72, 0.7, L.emission_mat("spg1", (0.4, 1.0, 0.6, 1), 7.0), 0.016)
L.burst(proto, (0.62, -0.35, -0.36), 25, 72, 0.7, L.emission_mat("spg2", (0.4, 1.0, 0.6, 1), 7.0), 0.016)

q = L.text("q", "Which one do you KEEP?", (0, -0.3, -0.8), 0.15, L.WHITE, 1.7); L.pop(q, 78)
c = L.text("c", "Comment A or B", (0, -0.3, -1.1), 0.19, L.GREEN, 1.6); L.pop(c, 90); L.pulse(c, 102, FR, 1.0, 0.07, 16)
brand = L.text("brand", "cardflip.io", (0, -0.3, -1.4), 0.17, L.LILAC, 2.6); L.pop(brand, 104)

co = L.camera((0, -6.85, -0.17), None, dof_target=A, fstop=2.5)
co.keyframe_insert("location", frame=1)
co.location = (0, -6.55, -0.17); co.keyframe_insert("location", frame=36)
for f, dx, dz in ((37, 0.03, -0.02), (39, -0.025, 0.02), (41, 0.012, -0.01), (43, 0, 0)):
    co.location = (dx, -6.55, -0.17 + dz); co.keyframe_insert("location", frame=f)
co.location = (0, -6.3, -0.17); co.keyframe_insert("location", frame=FR)
L.bloom()
L.render(OUT)
