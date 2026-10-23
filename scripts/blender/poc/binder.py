# POC C "Binder page": a real-looking 9-pocket binder page on a wooden table, soft window light on the sleeves; the
# centre card slides out of its sleeve, lifts toward the camera and its price pops. "What's YOUR binder worth?" 5 s.
# Run: blender --background --python binder.py -- <out> <hero name> <hero price> <front1> ... <front9>  (hero = 5th)
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, HNAME, HPRICE = argv[0], argv[1], float(argv[2])
FRONTS = argv[3:12]
FR = 150
L.setup(OUT, FR)
L.wood_floor(-0.02)

# binder page: dark textured leather-look sheet with raised pocket seams
m, nt = new = L.new_mat("page")
tc = nt.nodes.new("ShaderNodeTexCoord"); noise = L.N(nt, "ShaderNodeTexNoise", Scale=90, Detail=4, Roughness=0.6)
nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
p = L.N(nt, "ShaderNodeBsdfPrincipled", Roughness=0.55); p.inputs["Base Color"].default_value = (0.028, 0.028, 0.034, 1)
bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.12
nt.links.new(noise.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs[0], p.inputs["Normal"]); L.out(nt, p.outputs[0])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0)); page = bpy.context.object; page.scale = (2.75, 3.8, 1); page.data.materials.append(m)
# a stack of pages underneath (thickness at the edge) + rings on the left
m2, _, _ = L.principled_mat("pagestack", (0.9, 0.9, 0.9, 1), rough=0.7)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.02, 0, -0.03)); stack = bpy.context.object; stack.scale = (2.72, 3.76, 0.05); stack.data.materials.append(m2)
m3, _, _ = L.principled_mat("ring", (0.75, 0.75, 0.78, 1), rough=0.25, metal=1.0)
for yy in (1.3, 0, -1.3):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.14, minor_radius=0.014, location=(-1.42, yy, 0.0), rotation=(0, math.radians(90), 0))
    bpy.context.object.data.materials.append(m3)

sleeve_mat, snt, sp = L.principled_mat("sleeve", (0.9, 0.92, 0.95, 1), rough=0.05, alpha=0.16, spec=0.9)
cards = []
hero_i = 4
for i, front in enumerate(FRONTS):
    gx, gy = i % 3, i // 3
    x, y = (gx - 1) * 0.84, (1 - gy) * 1.17
    c, hk = L.make_card("c%d" % i, front, loc=(x, y, 0.012), scale=0.6, flat=True, holo=(i == hero_i))
    c.rotation_euler = (0, 0, math.radians(random.uniform(-1.4, 1.4)))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y + 0.03, 0.03)); sl = bpy.context.object
    sl.scale = (0.80, 1.12, 1); sl.data.materials.append(sleeve_mat)
    cards.append((c, hk))

hero, hk = cards[hero_i]
hero.keyframe_insert("location", frame=28); hero.keyframe_insert("rotation_euler", frame=28); hero.keyframe_insert("scale", frame=28)
hero.location = (0, 0.55, 0.05); hero.keyframe_insert("location", frame=44)          # slides out of the sleeve
hero.location = (0, -0.25, 0.95); hero.keyframe_insert("location", frame=66)         # lifts toward the camera
hero.rotation_euler = (math.radians(-30), 0, 0); hero.keyframe_insert("rotation_euler", frame=66)
hero.scale = (0.78,) * 3; hero.keyframe_insert("scale", frame=66)
for f, z, t in ((100, 1.0, -28), (130, 0.93, -31), (FR, 0.97, -29)):
    hero.location = (0, -0.25, z); hero.keyframe_insert("location", frame=f)
    hero.rotation_euler = (math.radians(t), 0, math.radians(1 if f == 100 else -1)); hero.keyframe_insert("rotation_euler", frame=f)
L.holo_sweep(hk, ((1, -1.4), (66, -1.4), (110, 1.4), (FR, -1.4)), ((1, -1.3), (68, -1.3), (100, 1.3), (FR, 1.3)))
proto = L.sparkles(0, FR)
L.ring((0, -0.25, 0.9), 66, big=1.6, rot=(math.radians(-30), 0, 0))
L.burst(proto, (0, -0.25, 0.9), 45, 66, 1.2, L.emission_mat("sp", (1, 0.85, 0.55, 1), 6), 0.02, flat=True)
L.flash((0, -1.0, 2.2), 66, 260)

win = L.area("window", (-3.0, -2.5, 4.5), (math.radians(35), math.radians(-30), 0), 420, 3.5, (1.0, 0.95, 0.88))
fill = L.area("fill", (3.0, 1.5, 3.5), (math.radians(-25), math.radians(35), 0), 120, 3, (0.75, 0.8, 1.0))
L.spot("hero", (0.6, -2.4, 4.2), (0, -0.25, 0.9), 300, 30, 0.6, (1, 1, 1), 0.3)
# lights down once the hero is up: the room light drops to a third so the lifted card and the price pop
for lo, lo_e in ((win, 150), (fill, 45)):
    lo.data.keyframe_insert("energy", frame=58); lo.data.energy = lo_e; lo.data.keyframe_insert("energy", frame=76)

co = L.camera((0, -2.7, 4.3), (0, -0.1, 0.25), dof_target=hero, fstop=5.6)
co.keyframe_insert("location", frame=1); co.location = (0, -2.95, 4.05); co.keyframe_insert("location", frame=FR)

def hud(name, body, fx, fy, size, color, strength, d=4.0):
    hh = d * math.tan(math.radians(19.8)); hw = hh * 9 / 16
    o = L.text(name, body, (0, 0, 0), size, color, strength, rot=(0, 0, 0)); o.parent = co
    o.location = ((fx - 0.5) * 2 * hw, (0.5 - fy) * 2 * hh, -d); return o
nm = hud("name", HNAME.upper(), 0.5, 0.60, 0.15, L.GOLD, 1.5); L.pop(nm, 70)
pr = hud("price", "$0", 0.5, 0.665, 0.32, L.GREEN, 1.3); L.pop(pr, 74); L.count_up(pr, HPRICE, 74, 26)
q = hud("q", "What's YOUR binder worth?", 0.5, 0.735, 0.12, L.WHITE, 1.7); L.pop(q, 106); L.pulse(q, 116, FR, 1.0, 0.05, 16)
br = hud("brand", "cardflip.io", 0.5, 0.78, 0.15, L.LILAC, 2.6); L.pop(br, 114)
L.bloom(0.9, 0.5, 0.5)
L.render(OUT)
