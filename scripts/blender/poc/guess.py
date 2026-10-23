# POC A "Guess the price": the card flips in onto a glossy studio floor, the price slot-machines between digits and
# question marks and never lands. Comment bait. 5 s. Run: blender --background --python guess.py -- <front> <NAME> <out>
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
FRONT, NAME, OUT = argv[0], argv[1], argv[2]
FR = int(os.environ.get("FRAMES", "210"))  # 10-23 Chris: hold the ??? ~2 s longer at the end
L.setup(OUT, FR)
L.nebula(0.5, FR)
L.glossy_floor(-1.62)

card, hk = L.make_card("card", FRONT, loc=(0, 1.6, 1.0), scale=0.6)
card.rotation_euler = (math.radians(14), math.radians(-8), math.radians(180)); card.keyframe_insert("rotation_euler", frame=1)
card.rotation_euler = (0, 0, math.radians(-720)); card.keyframe_insert("rotation_euler", frame=40)
for f, a, t in ((80, 6, -2), (115, -5, 2), (150, 4, -1), (180, -4, 2), (210, 3, -1)):
    card.rotation_euler = (math.radians(t), 0, math.radians(-720 + a)); card.keyframe_insert("rotation_euler", frame=f)
card.keyframe_insert("location", frame=1)
card.location = (0, 0, 0.62); card.keyframe_insert("location", frame=40)
for f, z in ((95, 0.67), (150, 0.62), (180, 0.66), (210, 0.62)):
    card.location = (0, 0, z); card.keyframe_insert("location", frame=f)
card.keyframe_insert("scale", frame=1); card.scale = (0.82,) * 3; card.keyframe_insert("scale", frame=40)
L.holo_sweep(hk, ((1, -1.4), (42, -1.4), (90, 1.4), (120, -1.4), (160, 1.4), (200, -1.4)), ((1, -1.3), (44, -1.3), (80, 1.3), (150, 1.3), (165, -1.3), (195, 1.3)))
L.ring((0, -0.05, 0.62), 40); L.flash((0, -1.2, 0.8), 40, 320)
proto = L.sparkles(140, FR)
L.burst(proto, (0, -0.1, 0.62), 60, 40, 2.2, L.emission_mat("sp2", (1, 0.85, 0.55, 1), 6), 0.025)

L.spot("top", (0, -1.5, 5.5), (0, 0, 0.4), 2600, 55, 0.5, (1, 0.95, 0.9), 0.4)
L.area("rimL", (-2.6, 1.8, 2.4), (math.radians(-60), 0, math.radians(-140)), 600, 2, (0.5, 0.6, 1.0))
L.area("rimR", (2.6, 1.8, 0.2), (math.radians(-90), 0, math.radians(140)), 450, 2, (1.0, 0.5, 0.9))

# 10-23 Chris: "all text could be sharper" -> no pulse (motion blur), lower emission (bloom halo), focus on the text
# plane at f/8, bloom halved (below)
label = L.text("label", NAME.upper(), (0, -0.3, -0.36), 0.17, L.GOLD, 1.1); L.pop(label, 46)
price = L.text("price", "$ ? ? ?", (0, -0.3, -0.76), 0.44, L.GREEN, 1.0); L.pop(price, 50)
ask = L.text("ask", "GUESS THE PRICE IN THE COMMENTS", (0, -0.3, -1.1), 0.13, L.WHITE, 1.0); L.pop(ask, 66)
brand = L.text("brand", "cardflip.io", (0, -0.3, -1.38), 0.2, L.LILAC, 1.5); L.pop(brand, 80)

state = {"body": "$ ? ? ?"}
def digits(scene, *_):
    f = scene.frame_current
    if f < 50: price.data.body = "$ ? ? ?"; return
    if f >= 122: price.data.body = "$ ? ? ?"; return
    if (f - 50) % 3 == 0:
        rnd = random.Random(f)
        state["body"] = "$ " + " ".join(str(rnd.randint(0, 9)) if rnd.random() < 0.6 else "?" for _ in range(3))
    price.data.body = state["body"]
L.every_frame(digits)

qmat = L.emission_mat("q", L.GREEN, 4.0)
for i in range(8):  # question marks drifting up beside the card
    bpy.ops.object.text_add(rotation=(math.radians(90), 0, 0)); q = bpy.context.object
    q.data.body = "?"; q.data.font = L.font(); q.data.size = random.uniform(0.12, 0.2); q.data.align_x = "CENTER"; q.data.materials.append(qmat)
    x = random.choice([-1, 1]) * random.uniform(0.95, 1.18); f0 = 54 + i * 10
    q.location = (x, -0.35, -0.9); q.scale = (0,) * 3; q.keyframe_insert("scale", frame=f0); q.keyframe_insert("location", frame=f0)
    q.scale = (1,) * 3; q.keyframe_insert("scale", frame=f0 + 4)
    q.location = (x, -0.35, 0.3); q.keyframe_insert("location", frame=f0 + 44)
    q.scale = (0,) * 3; q.keyframe_insert("scale", frame=f0 + 48)

co = L.camera((0, -6.95, -0.17), None, dof_target=ask, fstop=8.0)
co.keyframe_insert("location", frame=1)
co.location = (0, -6.6, -0.17); co.keyframe_insert("location", frame=40)
for f, dx, dz in ((41, 0.03, -0.02), (43, -0.025, 0.02), (45, 0.012, -0.01), (47, 0, 0)):
    co.location = (dx, -6.6, -0.17 + dz); co.keyframe_insert("location", frame=f)
co.location = (0, -6.35, -0.17); co.keyframe_insert("location", frame=FR)
L.bloom(threshold=1.0, strength=0.3, size=0.5)
L.render(OUT)
