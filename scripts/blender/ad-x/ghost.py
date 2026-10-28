# Halloween ad "Ghosts" (10-27): square 1200x1200, 9 s. An old book on a table under a full moon creaks open into a
# pop-up graveyard (night-sky panel + moon, hills with a crooked house, tombstones, an iron fence); fog rolls over the
# pages and Gastly, Haunter and Gengar (Fossil 1st Edition) rise out of it one by one; the camera pushes in on Gengar in
# front of the moon, a scan line sweeps it, green brackets lock on and overlay.mjs (scene H-ghost) counts up its price.
# Reference look (Chris 10-27): the haunted pop-up storybook in a fan game short, neon purple + teal under a full moon.
# Run: blender --background --python ghost.py -- <gastly> <haunter> <gengar> <price> <out>
import sys, os, math, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "poc"))
import bpy, bmesh, cf_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
GASTLY, HAUNTER, GENGAR, PRICE, OUT = argv[0], argv[1], argv[2], float(argv[3]), argv[4]
FR = 270
L.setup(OUT, FR, res=(1200, 1200))
L.sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.002, 0.01, 1)
neb = L.nebula(0.22, FR); neb.location = (0, 9, 2)
L.glossy_floor(-0.002, color=(0.01, 0.006, 0.016, 1), rough=0.42)

ZP = 0.22          # top of the open pages
BW, BD = 1.9, 1.3  # one page half-width (x) and half-depth (y)


def box(name, size, loc, mat, parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.object; o.name = name
    o.scale = size; o.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new("bev", "BEVEL"); b.width = bevel; b.segments = 3
    if parent: o.parent = parent
    return o


def cutout(name, pts, mat, thick=0.025, parent=None, loc=(0, 0, 0)):
    """A flat pop-up piece: polygon pts (x, z) in the XZ plane, base at z=0, extruded thick along +y."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]; f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f]); ext = [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ext, vec=(0, thick, 0)); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.materials.append(mat)
    o = bpy.data.objects.new(name, me); L.sc.collection.objects.link(o); o.location = loc
    if parent: o.parent = parent
    return o


def arc(cx, cz, r, a0, a1, n=16):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


# ---------------- the book ----------------
leather, lnt, lp = L.principled_mat("leather", (0.045, 0.02, 0.06, 1), rough=0.55)
paper, pnt, pp = L.principled_mat("paper", (0.3, 0.25, 0.18, 1), rough=0.85)
gold = L.principled_mat("gold", (1.0, 0.7, 0.25, 1), rough=0.3, metal=1.0)[0]
box("coverR", (BW + 0.06, 2 * BD + 0.12, 0.04), (BW / 2, 0, 0.02), leather, bevel=0.01)
box("pagesR", (BW - 0.04, 2 * BD - 0.04, ZP - 0.04), (BW / 2, 0, 0.04 + (ZP - 0.04) / 2), paper)
hinge = bpy.data.objects.new("hinge", None); L.sc.collection.objects.link(hinge); hinge.location = (0, 0, ZP)
box("pagesL", (BW - 0.04, 2 * BD - 0.04, ZP - 0.04), (-BW / 2, 0, -(ZP - 0.04) / 2), paper, parent=hinge)
box("coverL", (BW + 0.06, 2 * BD + 0.12, 0.04), (-BW / 2, 0, -(ZP - 0.04) - 0.02), leather, parent=hinge, bevel=0.01)
# gold frame + crescent moon on the front cover (it faces up while the book is shut)
for sx, sy, w, d in ((-BW / 2, BD - 0.12, BW - 0.3, 0.025), (-BW / 2, -BD + 0.12, BW - 0.3, 0.025), (-0.17, 0, 0.025, 2 * BD - 0.24), (-BW + 0.12, 0, 0.025, 2 * BD - 0.24)):
    box("trim", (w, d, 0.012), (sx, sy, -(ZP - 0.04) - 0.046), gold, parent=hinge)
cres = cutout("crescent", arc(0, 0, 0.42, 50, 310, 24) + arc(0.2, 0.04, 0.36, 290, 70, 24), gold, thick=0.012)
cres.parent = hinge; cres.rotation_euler = (math.radians(-90), 0, 0); cres.location = (-BW / 2, 0.0, -(ZP - 0.04) - 0.042)
hinge.rotation_euler = (0, math.radians(180), 0); hinge.keyframe_insert("rotation_euler", frame=30)
hinge.rotation_euler = (0, math.radians(-8), 0); hinge.keyframe_insert("rotation_euler", frame=58)
hinge.rotation_euler = (0, 0, 0); hinge.keyframe_insert("rotation_euler", frame=64)

# ---------------- pop-up layers (fold up from flat as the book opens) ----------------
def pop_up(o, f0, f1):
    o.scale = (0,) * 3; o.keyframe_insert("scale", frame=f0 - 1)
    o.scale = (1,) * 3; o.keyframe_insert("scale", frame=f0)
    o.rotation_euler = (math.radians(-88), 0, 0); o.keyframe_insert("rotation_euler", frame=f0)
    o.rotation_euler = (math.radians(7), 0, 0); o.keyframe_insert("rotation_euler", frame=f1)
    o.rotation_euler = (0, 0, 0); o.keyframe_insert("rotation_euler", frame=f1 + 6)


def layer(name, y, f0, f1):
    p = bpy.data.objects.new(name, None); L.sc.collection.objects.link(p); p.location = (0, y, ZP); pop_up(p, f0, f1); return p


# back panel: night sky with stars, a round-topped arch
sky, snt = L.new_mat("sky")
tc = snt.nodes.new("ShaderNodeTexCoord"); sep = snt.nodes.new("ShaderNodeSeparateXYZ"); snt.links.new(tc.outputs["Object"], sep.inputs[0])
mr = snt.nodes.new("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = 0; mr.inputs["From Max"].default_value = 2.3
snt.links.new(sep.outputs["Z"], mr.inputs["Value"])
ramp = snt.nodes.new("ShaderNodeValToRGB"); el = ramp.color_ramp.elements
el[0].color = (0.0, 0.16, 0.2, 1); el[1].color = (0.09, 0.02, 0.2, 1); m_ = el.new(0.45); m_.color = (0.08, 0.05, 0.28, 1)
snt.links.new(mr.outputs[0], ramp.inputs[0])
vor = L.N(snt, "ShaderNodeTexVoronoi", Scale=38.0); snt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
st = snt.nodes.new("ShaderNodeMath"); st.operation = "LESS_THAN"; st.inputs[1].default_value = 0.035
snt.links.new(vor.outputs["Distance"], st.inputs[0])
mix = snt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
snt.links.new(st.outputs[0], mix.inputs["Factor"]); snt.links.new(ramp.outputs["Color"], mix.inputs[6]); mix.inputs[7].default_value = (1, 0.95, 0.85, 1)
em = L.N(snt, "ShaderNodeEmission", Strength=1.4); snt.links.new(mix.outputs[2], em.inputs["Color"]); L.out(snt, em.outputs[0])
back = layer("back", 1.05, 38, 66)
cutout("skypanel", [(-1.75, 0), (1.75, 0)] + arc(0, 1.15, 1.75, 0, 180, 40), sky, parent=back)
moon_m, mnt = L.new_mat("moon")
mn = L.N(mnt, "ShaderNodeTexNoise", Scale=3.5, Detail=6); mtc = mnt.nodes.new("ShaderNodeTexCoord"); mnt.links.new(mtc.outputs["Object"], mn.inputs["Vector"])
mramp = mnt.nodes.new("ShaderNodeValToRGB"); mel = mramp.color_ramp.elements
mel[0].position, mel[0].color = 0.4, (0.75, 0.72, 0.62, 1); mel[1].position, mel[1].color = 0.65, (1.0, 0.98, 0.9, 1)
mnt.links.new(mn.outputs["Fac"], mramp.inputs[0]); mem = L.N(mnt, "ShaderNodeEmission", Strength=3.2); mnt.links.new(mramp.outputs[0], mem.inputs["Color"]); L.out(mnt, mem.outputs[0])
moon = cutout("moon", arc(0, 0, 0.62, 0, 360, 48)[:-1], moon_m, thick=0.02, parent=back, loc=(0, -0.03, 1.38))
halo = cutout("halo", arc(0, 0, 0.82, 0, 360, 48)[:-1], L.emission_mat("halo", (0.55, 0.45, 1.0, 1), 0.9), thick=0.01, parent=back, loc=(0, -0.012, 1.38))

# middle layer: hills with a crooked haunted house
ink = L.principled_mat("ink", (0.006, 0.004, 0.012, 1), rough=0.9)[0]
mid = layer("mid", 0.55, 44, 70)
hills = [(-1.75, 0)] + [(-1.75 + 3.5 * i / 30, 0.42 + 0.16 * math.sin(i * 0.55) + 0.08 * math.sin(i * 1.7)) for i in range(31)] + [(1.75, 0)]
cutout("hills", hills, ink, parent=mid)
cutout("house", [(0.75, 0.3), (1.35, 0.3), (1.38, 0.95), (1.48, 0.95), (1.2, 1.3), (1.12, 1.25), (1.08, 1.5), (1.0, 1.52), (0.96, 1.2), (0.7, 0.98), (0.8, 0.96)], ink, parent=mid, loc=(0, -0.01, 0))
win = L.emission_mat("window", (1.0, 0.75, 0.25, 1), 6)
for x, z in ((0.9, 0.62), (1.18, 0.62), (1.04, 1.32)):
    box("win", (0.08, 0.02, 0.1), (x, -0.035, z), win, parent=mid)
tree = [(-1.32, 0.3), (-1.24, 0.3), (-1.22, 0.85), (-1.0, 1.12), (-1.03, 1.15), (-1.21, 0.95), (-1.2, 1.25), (-1.24, 1.25),
        (-1.27, 0.98), (-1.48, 1.18), (-1.5, 1.14), (-1.3, 0.9)]
cutout("tree", tree, ink, parent=mid, loc=(0, -0.01, 0))

# front layer: tombstones + iron fence
stone = L.principled_mat("stone", (0.05, 0.045, 0.07, 1), rough=0.8)[0]
front = layer("front", -0.45, 50, 76)
for x, h, w, tilt in ((-1.25, 0.52, 0.42, 7), (-0.55, 0.38, 0.34, -5), (0.62, 0.46, 0.38, 4), (1.3, 0.34, 0.3, -9)):
    t = cutout("tomb", [(-w / 2, 0), (w / 2, 0)] + arc(0, h - w / 2, w / 2, 0, 180, 16), stone, thick=0.06, parent=front)
    t.location = (x, 0, 0); t.rotation_euler = (0, math.radians(tilt), 0)
    cross = box("rip", (0.12, 0.02, 0.025), (x, -0.012, h * 0.62), L.emission_mat("rip", (0.4, 1.0, 0.85, 1), 1.2), parent=front)
fence_m = L.principled_mat("iron", (0.02, 0.02, 0.025, 1), rough=0.4, metal=0.8)[0]
fence = layer("fence", -0.95, 56, 80)
for i in range(19):
    x = -1.7 + 3.4 * i / 18; h = 0.3 + 0.04 * (i % 2)
    cutout("bar", [(-0.018, 0), (0.018, 0), (0.018, h), (0, h + 0.06), (-0.018, h)], fence_m, thick=0.02, parent=fence, loc=(x, 0, 0))
for z in (0.08, 0.24):
    box("rail", (3.42, 0.02, 0.025), (0, 0.01, z), fence_m, parent=fence)

# fog rolling over the pages once they are open
fog_m, fnt = L.new_mat("fog")
fn = L.N(fnt, "ShaderNodeTexNoise", Scale=2.2, Detail=4); ftc = fnt.nodes.new("ShaderNodeTexCoord"); fnt.links.new(ftc.outputs["Object"], fn.inputs["Vector"])
fn.noise_dimensions = "4D"; fn.inputs["W"].default_value = 0; fn.inputs["W"].keyframe_insert("default_value", frame=1)
fn.inputs["W"].default_value = 1.4; fn.inputs["W"].keyframe_insert("default_value", frame=FR)
fsep = fnt.nodes.new("ShaderNodeSeparateXYZ"); fnt.links.new(ftc.outputs["Object"], fsep.inputs[0])
fall = fnt.nodes.new("ShaderNodeMapRange"); fall.inputs["From Min"].default_value = 0.6; fall.inputs["From Max"].default_value = -0.4
fnt.links.new(fsep.outputs["Z"], fall.inputs["Value"])
fmul = fnt.nodes.new("ShaderNodeMath"); fmul.operation = "MULTIPLY"; fnt.links.new(fn.outputs["Fac"], fmul.inputs[0]); fnt.links.new(fall.outputs[0], fmul.inputs[1])
dens = fnt.nodes.new("ShaderNodeMath"); dens.operation = "MULTIPLY"; fnt.links.new(fmul.outputs[0], dens.inputs[0])
dens.inputs[1].default_value = 0.0; dens.inputs[1].keyframe_insert("default_value", frame=48)
dens.inputs[1].default_value = 1.8; dens.inputs[1].keyframe_insert("default_value", frame=82)
vol = fnt.nodes.new("ShaderNodeVolumePrincipled"); vol.inputs["Color"].default_value = (0.3, 0.32, 0.6, 1)
fnt.links.new(dens.outputs[0], vol.inputs["Density"])
mo = next((n for n in fnt.nodes if n.type == "OUTPUT_MATERIAL"), None) or fnt.nodes.new("ShaderNodeOutputMaterial")
fnt.links.new(vol.outputs[0], mo.inputs["Volume"])
fog = box("fog", (2 * BW + 0.6, 2 * BD + 0.4, 1.2), (0, -0.1, ZP + 0.6), fog_m)

# ---------------- the ghosts ----------------
def ghost(name, front_img, pos, scale, f0, holo):
    c, hk = L.make_card(name, front_img, loc=(pos[0], pos[1], pos[2] - 0.7), scale=0.0, holo=holo, glow=0.15)
    c.scale = (0,) * 3; c.keyframe_insert("scale", frame=f0)
    c.scale = (scale * 1.08,) * 3; c.keyframe_insert("scale", frame=f0 + 14)
    c.scale = (scale,) * 3; c.keyframe_insert("scale", frame=f0 + 22)
    c.rotation_euler = (0, 0, math.radians(-25)); c.keyframe_insert("rotation_euler", frame=f0)
    c.keyframe_insert("location", frame=f0)
    c.location = pos; c.keyframe_insert("location", frame=f0 + 22)
    c.rotation_euler = (0, 0, 0); c.keyframe_insert("rotation_euler", frame=f0 + 22)
    for k, f in enumerate(range(f0 + 40, FR + 1, 26)):   # slow ghostly bob + sway
        c.location = (pos[0], pos[1], pos[2] + (0.06 if k % 2 == 0 else -0.02)); c.keyframe_insert("location", frame=f)
        c.rotation_euler = (0, math.radians(2.5 if k % 2 else -2.5), math.radians(4 if k % 2 == 0 else -4)); c.keyframe_insert("rotation_euler", frame=f)
    g = bpy.data.lights.new(name + "glow", "POINT"); g.color = (0.6, 0.35, 1.0); g.energy = 0
    go = bpy.data.objects.new(name + "glow", g); go.parent = c; go.location = (0, 0.5, 0); L.sc.collection.objects.link(go)
    g.keyframe_insert("energy", frame=f0); g.energy = 260; g.keyframe_insert("energy", frame=f0 + 12); g.energy = 70; g.keyframe_insert("energy", frame=f0 + 30)
    L.ring((pos[0], pos[1] - 0.05, pos[2]), f0 + 6, color=(0.55, 0.3, 1.0, 1), big=0.9)
    return c, hk


gas, _ = ghost("gastly", GASTLY, (-1.3, 0.05, 1.12), 0.5, 80, False)
hau, hk2 = ghost("haunter", HAUNTER, (1.3, 0.05, 1.12), 0.5, 98, True)
GP = (0, -0.05, 1.42)
gen, hk3 = ghost("gengar", GENGAR, GP, 0.68, 116, True)
# Gastly and Haunter drift out to the sides and fade so the push-in is all Gengar
for c, sx in ((gas, -1), (hau, 1)):
    c.keyframe_insert("location", frame=152); c.keyframe_insert("scale", frame=152)
    c.location = (sx * 2.6, 0.4, 1.5); c.keyframe_insert("location", frame=176)
    c.scale = (0,) * 3; c.keyframe_insert("scale", frame=176)
L.holo_sweep(hk2, ((98, -1.4), (150, 1.4)), ((98, -1.3), (150, 1.3)))
L.holo_sweep(hk3, ((116, -1.4), (170, 1.4), (230, -1.4)), ((116, -1.3), (176, 1.3), (225, -1.3)))
proto = L.sparkles(110, FR, clear_x=1.0, clear_z=(0.2, 2.6))

# scan: cyan line down Gengar's face, then green brackets lock on (same beat as ad A)
CW, CH = L.W, L.H
beam = L.emission_mat("beam", L.CYAN, 9)
bpy.ops.mesh.primitive_plane_add(size=1, rotation=(math.radians(90), 0, 0)); bl = bpy.context.object; bl.parent = gen
bl.data.materials.append(beam); bl.scale = (0,) * 3; bl.keyframe_insert("scale", frame=181)
for f, z in ((182, CH * 0.98), (208, -CH * 0.98)):
    bl.location = (0, -0.03, z); bl.keyframe_insert("location", frame=f)
    bl.scale = (CW * 2.25, 0.022, 1); bl.keyframe_insert("scale", frame=f)
bl.scale = (0,) * 3; bl.keyframe_insert("scale", frame=209)
brm = L.emission_mat("bracket", L.GREEN, 4)
hw, hh, arm = CW + 0.07, CH + 0.07, 0.2
for sx in (-1, 1):
    for sz in (-1, 1):
        cd = bpy.data.curves.new("br", "CURVE"); cd.dimensions = "3D"; cd.bevel_depth = 0.016; cd.bevel_resolution = 2
        s = cd.splines.new("POLY"); s.points.add(2)
        for pnt, c in zip(s.points, ((sx * hw, -0.03, sz * (hh - arm)), (sx * hw, -0.03, sz * hh), (sx * (hw - arm), -0.03, sz * hh))): pnt.co = (*c, 1)
        cd.materials.append(brm); o = bpy.data.objects.new("br", cd); L.sc.collection.objects.link(o); o.parent = gen
        o.scale = (0,) * 3; o.keyframe_insert("scale", frame=209)
        o.scale = (1.4,) * 3; o.keyframe_insert("scale", frame=210); o.scale = (0.97,) * 3; o.keyframe_insert("scale", frame=216)
        o.scale = (1,) * 3; o.keyframe_insert("scale", frame=220)
L.flash((0, -1.2, 1.4), 212, 160, (0.4, 1.0, 0.6))
tag = bpy.data.objects.new("tag", None); L.sc.collection.objects.link(tag); tag.parent = gen; tag.location = (0, 0, -CH - 0.3)

# ---------------- light ----------------
L.spot("key", (2.2, -4.2, 5.0), (0, 0, 0.3), 260, 50, 0.6, (0.85, 0.8, 1.0), 0.5)
L.spot("moonrim", (0, 3.4, 4.4), (0, 0, 0.8), 1600, 60, 0.5, (0.55, 0.6, 1.0), 0.6)
L.area("teal", (-3.6, -1.2, 2.0), (math.radians(70), 0, math.radians(-60)), 150, 2.5, (0.2, 0.95, 0.9))
L.area("magenta", (3.6, -1.2, 2.0), (math.radians(70), 0, math.radians(60)), 150, 2.5, (1.0, 0.3, 0.85))
L.area("fill", (0, -6, 1.5), (math.radians(90), 0, 0), 25, 4, (0.7, 0.75, 1.0))

# ---------------- camera: book on the table -> open spread -> push in on Gengar in front of the moon ----------------
aim = bpy.data.objects.new("aim", None); L.sc.collection.objects.link(aim)
co = L.camera((0, -7.4, 4.6), None, lens=50, fstop=2.8); co.data.dof.use_dof = False
tt = co.constraints.new("TRACK_TO"); tt.target = aim; tt.track_axis = "TRACK_NEGATIVE_Z"; tt.up_axis = "UP_Y"
for f, cam, tgt in ((1, (0.95, -7.4, 4.6), (0.95, 0, 0.35)), (28, (0.85, -7.0, 4.3), (0.85, 0, 0.4)), (70, (0, -7.4, 3.4), (0, 0, 0.95)),
                    (150, (0, -7.0, 3.1), (0, 0, 1.05)), (182, (0, -3.9, 1.72), (0, 0, 1.36)), (FR, (0, -3.65, 1.7), (0, 0, 1.36))):
    co.location = cam; co.keyframe_insert("location", frame=f); aim.location = tgt; aim.keyframe_insert("location", frame=f)

L.export_overlay(OUT, co, {"tag": tag}, {"price": PRICE, "name": "GENGAR", "set": "Fossil · 1st Edition · 5/62"})
L.clear_sparks(proto, co, ((0.05, 0.03, 0.95, 0.2), (0.1, 0.78, 0.9, 0.98)), (1, 120, 200, FR))
L.bloom(threshold=1.0, strength=0.35, size=0.6)
L.render(OUT)
