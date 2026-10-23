# POC D "Top 3 countdown": #3 and #2 drop into the back slots, #1 lands front and centre with a flash; prices under
# each; "Did YOURS make the list?" 5 s.
# Run: blender --background --python top3.py -- <out> <front3> <name3> <price3> <front2> <name2> <price2> <front1> <name1> <price1>
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
cards = [(argv[1], argv[2], float(argv[3])), (argv[4], argv[5], float(argv[6])), (argv[7], argv[8], float(argv[9]))]
FR = 150
L.setup(OUT, FR)
L.nebula(0.7, FR)
L.glossy_floor(-1.62, color=(0.02, 0.02, 0.03, 1), rough=0.2)
L.studio_lights()
proto = L.sparkles(150, FR, clear_x=0.0, clear_z=(0, 0))

slots = [  # (x, y, z, scale, rank, f_land)
    (-0.72, 0.55, 0.6, 0.5, "#3", 28),
    (0.72, 0.55, 0.6, 0.5, "#2", 62),
    (0.0, -0.15, 0.5, 0.7, "#1", 100),
]
for (front, name, price), (x, y, z, s, rank, f1) in zip(cards, slots):
    f0 = f1 - 20
    c, hk = L.make_card(rank, front, loc=(x, y + 0.8, z + 2.2), scale=s * 0.7)
    c.keyframe_insert("location", frame=f0); c.keyframe_insert("scale", frame=f0)
    c.location = (x, y, z - 0.04); c.keyframe_insert("location", frame=f1 - 2)
    c.location = (x, y, z); c.keyframe_insert("location", frame=f1); c.scale = (s,) * 3; c.keyframe_insert("scale", frame=f1)
    c.rotation_euler = (math.radians(20), 0, math.radians(180 + 360)); c.keyframe_insert("rotation_euler", frame=f0)
    c.rotation_euler = (0, 0, 0); c.keyframe_insert("rotation_euler", frame=f1)
    for f, a in ((f1 + 35, 3), (f1 + 70, -2), (FR, 1)):
        if f <= FR: c.rotation_euler = (math.radians(a * 0.5), 0, math.radians(a)); c.keyframe_insert("rotation_euler", frame=f)
    L.holo_sweep(hk, ((1, -1.4), (f1, -1.4), (f1 + 40, 1.4), (FR, 1.4)), ((1, -1.3), (f1 + 2, -1.3), (f1 + 30, 1.3), (FR, 1.3)))
    top = z + 0.88 * s
    r = L.text("rank" + rank, rank, (x, -0.3, top + 0.16), 0.17 if rank != "#1" else 0.2, L.GOLD, 2.2); L.pop(r, f1 - 6, 1.4)
    p = L.text("price" + rank, "$0", (x, -0.3, z - 0.88 * s - 0.17), 0.17 if rank != "#1" else 0.3, L.GREEN, 1.3); L.pop(p, f1 + 2)
    L.count_up(p, price, f1 + 2, 18)
    n = L.text("name" + rank, name.upper(), (x, -0.3, z - 0.88 * s - (0.33 if rank != "#1" else 0.52)), 0.08 if rank != "#1" else 0.11, L.WHITE, 1.6); L.pop(n, f1 + 8)
    L.ring((x, -0.05, z), f1, big=1.4 if rank != "#1" else 2.4)
    if rank == "#1":
        L.flash((0, -1.2, 0.7), f1, 360)
        L.burst(proto, (0, -0.1, z), 70, f1, 2.2, L.emission_mat("sp1", (1, 0.85, 0.55, 1), 6), 0.025)
    else:
        L.burst(proto, (x, -0.1, z), 25, f1, 1.0, L.emission_mat("sp" + rank, (1, 0.85, 0.55, 1), 6), 0.018)

q = L.text("q", "Did YOURS make the list?", (0, -0.3, -1.0), 0.15, L.WHITE, 1.7); L.pop(q, 118); L.pulse(q, 128, FR, 1.0, 0.05, 16)
brand = L.text("brand", "cardflip.io", (0, -0.3, -1.3), 0.18, L.LILAC, 2.6); L.pop(brand, 126)

co = L.camera((0, -6.9, -0.17), None, fstop=2.8)
co.keyframe_insert("location", frame=1)
co.location = (0, -6.55, -0.17); co.keyframe_insert("location", frame=100)
for f, dx, dz in ((101, 0.03, -0.02), (103, -0.025, 0.02), (105, 0.012, -0.01), (107, 0, 0)):
    co.location = (dx, -6.55, -0.17 + dz); co.keyframe_insert("location", frame=f)
co.location = (0, -6.35, -0.17); co.keyframe_insert("location", frame=FR)
L.bloom()
L.render(OUT)
