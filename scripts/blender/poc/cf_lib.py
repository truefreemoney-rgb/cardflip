# Shared helpers for the CardFlip Blender proof-of-concept clips (10-23). Card mesh/materials follow card_reveal.py v5.
# Camera-facing scenes keep every object inside world z -1.5..1.6 at y~0 (TikTok clear area ~13%-78% of the height,
# Chris 10-20: "content is to high"). Angled scenes are checked on stills with the safe-zone sheet.
import bpy, bmesh, math, random, os

FONT_HEAVY, FONT_BOLD, FONT_SYM = r"C:\Windows\Fonts\seguibl.ttf", r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\seguisym.ttf"
BACK = r"C:\Users\Chris\cardflip\scripts\blender\assets\pokemon-back.png"
GREEN, GOLD, WHITE, LILAC, CYAN = (0.2, 1.0, 0.45, 1), (1.0, 0.72, 0.2, 1), (1, 1, 1, 1), (0.82, 0.68, 1.0, 1), (0.3, 0.9, 1.0, 1)
sc = None
_fonts = {}


def setup(out, frames, fps=30, seed=7):
    global sc
    random.seed(seed)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng; break
        except TypeError:
            pass
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1080, 1920, 100
    sc.render.fps = fps; sc.frame_start, sc.frame_end = 1, frames
    sc.render.image_settings.file_format = "PNG"; sc.render.filepath = os.path.join(out, "f_")
    sc.view_settings.view_transform = "Standard"
    try: sc.render.use_motion_blur = os.environ.get("MBLUR", "1") == "1"
    except Exception: pass
    for attr, val in (("use_raytracing", True), ("use_shadows", True)):
        try: setattr(sc.eevee, attr, val)
        except Exception as e: print("eevee", attr, e)
    try: sc.eevee.taa_render_samples = int(os.environ.get("SAMPLES", "64"))
    except Exception: pass
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    return sc


def font(path=FONT_HEAVY):
    if path not in _fonts: _fonts[path] = bpy.data.fonts.load(path)
    return _fonts[path]


def new_mat(name, blended=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; m.node_tree.nodes.clear()
    if blended:
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try: setattr(m, attr, val)
            except Exception: pass
    return m, m.node_tree


def out(nt, sock):
    o = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(sock, o.inputs[0])


def N(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items(): n.inputs[k].default_value = v
    return n


def emission_mat(name, color, strength):
    m, nt = new_mat(name); e = N(nt, "ShaderNodeEmission", Color=color, Strength=strength); out(nt, e.outputs[0]); return m


def principled_mat(name, color, rough=0.4, metal=0.0, alpha=None, spec=None):
    m, nt = new_mat(name, blended=alpha is not None)
    p = N(nt, "ShaderNodeBsdfPrincipled", Roughness=rough, Metallic=metal)
    p.inputs["Base Color"].default_value = color
    if alpha is not None: p.inputs["Alpha"].default_value = alpha
    if spec is not None and "Specular IOR Level" in p.inputs: p.inputs["Specular IOR Level"].default_value = spec
    out(nt, p.outputs[0]); return m, nt, p


# ---------------- card ----------------
W, H, R, T = 0.63, 0.88, 0.062, 0.004  # 10-23: R up from 0.035 so the mesh trims the picture's white corners (Chris)
_card_mesh = None


def _mesh():
    global _card_mesh
    if _card_mesh: return _card_mesh
    me = bpy.data.meshes.new("card"); bm = bmesh.new(); pts = []
    for cx, cy, a0 in ((W - R, H - R, 0), (-W + R, H - R, 90), (-W + R, -H + R, 180), (W - R, -H + R, 270)):
        for k in range(9):
            a = math.radians(a0 + k * 90 / 8); pts.append((cx + R * math.cos(a), cy + R * math.sin(a), 0))
    bm.faces.new([bm.verts.new(p) for p in pts])
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops: l[uv].uv = ((l.vert.co.x + W) / (2 * W), (l.vert.co.y + H) / (2 * H))
    bm.to_mesh(me); bm.free(); _card_mesh = me; return me


def card_face(name, img_path, flip_u, holo, holo_keys=None):
    m, nt = new_mat(name)
    for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
        try: setattr(m, attr, val)
        except Exception: pass
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping"); nt.links.new(tc.outputs["UV"], mp.inputs[0])
    if flip_u: mp.inputs["Scale"].default_value = (-1, 1, 1); mp.inputs["Location"].default_value = (1, 0, 0)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(img_path, check_existing=True); tex.extension = "CLIP"
    nt.links.new(mp.outputs[0], tex.inputs[0])
    p = N(nt, "ShaderNodeBsdfPrincipled", Roughness=0.45)
    if "Specular IOR Level" in p.inputs: p.inputs["Specular IOR Level"].default_value = 0.35
    nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    shader = p.outputs[0]
    if holo:
        def band(rot, key):
            mpp = N(nt, "ShaderNodeMapping", Rotation=(0, 0, math.radians(rot))); nt.links.new(tc.outputs["UV"], mpp.inputs[0])
            g = nt.nodes.new("ShaderNodeTexGradient"); nt.links.new(mpp.outputs[0], g.inputs[0])
            if holo_keys is not None: holo_keys[key] = mpp.inputs["Location"]
            return g
        g1 = band(-30, "rain")
        spec = nt.nodes.new("ShaderNodeValToRGB"); el = spec.color_ramp.elements
        cols = [(0, 0, 0), (1, 0.1, 0.4), (1, 0.8, 0.1), (0.2, 1, 0.4), (0.1, 0.6, 1), (0.7, 0.2, 1), (0, 0, 0)]
        el[0].position, el[0].color = 0.30, (*cols[0], 1); el[1].position, el[1].color = 0.70, (*cols[-1], 1)
        for i, c in enumerate(cols[1:-1]): e = el.new(0.36 + i * 0.07); e.color = (*c, 1)
        nt.links.new(g1.outputs["Fac"], spec.inputs[0])
        e1 = N(nt, "ShaderNodeEmission", Strength=0.5); nt.links.new(spec.outputs["Color"], e1.inputs["Color"])
        g2 = band(-22, "shine")
        sh = nt.nodes.new("ShaderNodeValToRGB"); el2 = sh.color_ramp.elements
        el2[0].position, el2[0].color = 0.47, (0, 0, 0, 1); el2[1].position, el2[1].color = 0.5, (1, 1, 1, 1)
        e3 = el2.new(0.53); e3.color = (0, 0, 0, 1)
        nt.links.new(g2.outputs["Fac"], sh.inputs[0])
        e2 = N(nt, "ShaderNodeEmission", Strength=0.9); nt.links.new(sh.outputs["Color"], e2.inputs["Color"])
        a1 = nt.nodes.new("ShaderNodeAddShader"); nt.links.new(shader, a1.inputs[0]); nt.links.new(e1.outputs[0], a1.inputs[1])
        a2 = nt.nodes.new("ShaderNodeAddShader"); nt.links.new(a1.outputs[0], a2.inputs[0]); nt.links.new(e2.outputs[0], a2.inputs[1])
        shader = a2.outputs[0]
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Alpha"], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(shader, mix.inputs[2])
    out(nt, mix.outputs[0])
    return m


def make_card(name, front, back=BACK, holo=True, loc=(0, 0, 0), scale=0.85, flat=False):
    """Returns (pivot, holo_keys). Upright: face toward -y (the camera). flat=True: lying on the XY plane, face up."""
    holo_keys = {}
    me = _mesh().copy(); me.materials.clear()
    me.materials.append(card_face(name + "_front", front, False, holo, holo_keys))
    me.materials.append(card_face(name + "_back", back, True, False))
    edge, ent = new_mat(name + "_edge"); out(ent, N(ent, "ShaderNodeBsdfPrincipled", **{"Base Color": (0.08, 0.1, 0.25, 1), "Roughness": 0.4}).outputs[0])
    me.materials.append(edge)
    o = bpy.data.objects.new(name + "_mesh", me); sc.collection.objects.link(o)
    o.rotation_euler = (0, 0, 0) if flat else (math.radians(90), 0, 0)
    sol = o.modifiers.new("thick", "SOLIDIFY"); sol.thickness = T; sol.offset = -1; sol.material_offset = 1; sol.material_offset_rim = 2
    pivot = bpy.data.objects.new(name, None); sc.collection.objects.link(pivot); o.parent = pivot
    pivot.location = loc; pivot.scale = (scale,) * 3
    return pivot, holo_keys


def holo_sweep(keys, pts_rain, pts_shine):
    for key, pts in (("rain", pts_rain), ("shine", pts_shine)):
        if key not in keys: continue
        for f, x in pts:
            keys[key].default_value = (x, 0, 0); keys[key].keyframe_insert("default_value", frame=f)


# ---------------- backgrounds ----------------
def nebula(strength=0.9, frames=150):
    m, nt = new_mat("nebula")
    tc = nt.nodes.new("ShaderNodeTexCoord"); noise = N(nt, "ShaderNodeTexNoise", Scale=6.4, Detail=8.0, Roughness=0.62)
    noise.noise_dimensions = "4D"; nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.38, (0.002, 0.002, 0.012, 1); el[1].position, el[1].color = 0.78, (0.28, 0.12, 0.65, 1)
    mid = el.new(0.56); mid.color = (0.03, 0.07, 0.28, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs[0])
    em = N(nt, "ShaderNodeEmission", Strength=strength); nt.links.new(ramp.outputs["Color"], em.inputs["Color"]); out(nt, em.outputs[0])
    noise.inputs["W"].default_value = 0; noise.inputs["W"].keyframe_insert("default_value", frame=1)
    noise.inputs["W"].default_value = 0.8; noise.inputs["W"].keyframe_insert("default_value", frame=frames)
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 6, 0), rotation=(math.radians(90), 0, 0))
    neb = bpy.context.object; neb.scale = (32, 48, 1); neb.data.materials.append(m); return neb


def glossy_floor(z, color=(0.012, 0.012, 0.018, 1), rough=0.12, size=60):
    m, nt, p = principled_mat("floor", color, rough=rough, metal=0.2, spec=0.6)
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z)); f = bpy.context.object; f.data.materials.append(m); return f


def wood_floor(z=0, size=30):
    m, nt = new_mat("wood")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    # long soft grain along y: stretched noise through bands, low contrast, dark walnut
    mp = N(nt, "ShaderNodeMapping", Scale=(3.0, 0.12, 1)); nt.links.new(tc.outputs["Object"], mp.inputs[0])
    wave = nt.nodes.new("ShaderNodeTexWave"); wave.inputs["Scale"].default_value = 1.6; wave.inputs["Distortion"].default_value = 2.2
    wave.inputs["Detail"].default_value = 3; wave.inputs["Detail Scale"].default_value = 0.8
    nt.links.new(mp.outputs[0], wave.inputs["Vector"])
    noise = N(nt, "ShaderNodeTexNoise", Scale=18, Detail=5); nt.links.new(mp.outputs[0], noise.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMath"); mix.operation = "MULTIPLY_ADD"; mix.inputs[1].default_value = 0.6
    nt.links.new(wave.outputs["Fac"], mix.inputs[0]); nt.links.new(noise.outputs["Fac"], mix.inputs[2])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.1, (0.11, 0.06, 0.03, 1); el[1].position, el[1].color = 1.0, (0.24, 0.14, 0.07, 1)
    m2 = el.new(0.55); m2.color = (0.17, 0.095, 0.045, 1)
    nt.links.new(mix.outputs[0], ramp.inputs[0])
    p = N(nt, "ShaderNodeBsdfPrincipled", Roughness=0.42); nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    if "Specular IOR Level" in p.inputs: p.inputs["Specular IOR Level"].default_value = 0.4
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.12
    nt.links.new(mix.outputs[0], bump.inputs["Height"]); nt.links.new(bump.outputs[0], p.inputs["Normal"])
    out(nt, p.outputs[0])
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z)); f = bpy.context.object; f.data.materials.append(m); return f


def sparkles(n=160, frames=150, clear_x=1.9, clear_z=(-3.0, 0.2)):
    spark_mat = emission_mat("spark", (1.0, 0.85, 0.55, 1), 6.0)
    blue_mat = emission_mat("sparkb", (0.45, 0.65, 1.0, 1), 6.0)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
    proto = bpy.context.object; proto.data.materials.append(spark_mat); proto.location = (0, 50, 0)
    for i in range(n):
        o = proto.copy(); o.data = proto.data; sc.collection.objects.link(o)
        o.material_slots[0].link = "OBJECT"; o.material_slots[0].material = spark_mat if i % 3 else blue_mat
        if i % 7:
            y = random.uniform(0.6, 5.0); x = random.uniform(-3, 3) * (1 + y * 0.18)
        else:
            y = random.uniform(-2.0, 0.0); x = random.choice([-1, 1]) * random.uniform(1.25, 2.2)
        s = random.uniform(0.008, 0.022) * (1 + max(0, y) * 0.25); z = random.uniform(-3.5, 3.5)
        k = (6.2 + y) / 6.2
        if clear_z[0] < z < clear_z[1] and abs(x / k) < clear_x:
            x = random.choice([-1, 1]) * random.uniform(clear_x, clear_x + 0.9) * k
        o.scale = (s,) * 3
        o.location = (x, y, z); o.keyframe_insert("location", frame=1)
        o.location = (x + random.uniform(-0.3, 0.3), y, z + random.uniform(0.4, 1.0)); o.keyframe_insert("location", frame=frames)
    return proto


def burst(proto, center, n, f0, reach, mat, size=0.02, flat=False):
    for i in range(n):
        o = proto.copy(); o.data = proto.data; sc.collection.objects.link(o)
        o.material_slots[0].link = "OBJECT"; o.material_slots[0].material = mat
        a = random.uniform(0, 2 * math.pi); r = random.uniform(0.5, 1.0) * reach
        o.location = center; o.scale = (0,) * 3; o.keyframe_insert("location", frame=f0); o.keyframe_insert("scale", frame=f0 - 1)
        o.scale = (size * random.uniform(0.6, 1.4),) * 3; o.keyframe_insert("scale", frame=f0)
        if flat: o.location = (center[0] + math.cos(a) * r, center[1] + math.sin(a) * r, center[2] + random.uniform(0.05, 0.5))
        else: o.location = (center[0] + math.cos(a) * r, center[1] - random.uniform(0, 0.4), center[2] + math.sin(a) * r * 0.8)
        o.keyframe_insert("location", frame=f0 + random.randint(14, 24))
        o.scale = (0,) * 3; o.keyframe_insert("scale", frame=f0 + 26)


def ring(center, f0, color=(0.75, 0.85, 1.0, 1), big=2.6, rot=(math.radians(90), 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.012, location=center, rotation=rot)
    r = bpy.context.object; r.data.materials.append(emission_mat("ring%d" % f0, color, 4.0))
    r.scale = (0,) * 3; r.keyframe_insert("scale", frame=f0 - 2)
    r.scale = (0.3,) * 3; r.keyframe_insert("scale", frame=f0)
    r.scale = (big,) * 3; r.keyframe_insert("scale", frame=f0 + 17)
    r.scale = (0,) * 3; r.keyframe_insert("scale", frame=f0 + 18)
    return r


def flash(loc, f0, energy=380, color=(0.8, 0.88, 1.0)):
    l = bpy.data.lights.new("flash%d" % f0, "POINT"); l.energy = 0; l.color = color
    o = bpy.data.objects.new("flash%d" % f0, l); o.location = loc; sc.collection.objects.link(o)
    l.keyframe_insert("energy", frame=f0 - 3); l.energy = energy; l.keyframe_insert("energy", frame=f0 + 1)
    l.energy = 0; l.keyframe_insert("energy", frame=f0 + 17)


# ---------------- lights ----------------
def area(name, loc, rot, power, size, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, "AREA"); l.energy = power; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o); return o


def spot(name, loc, target, power, size_deg=45, blend=0.4, color=(1, 1, 1), radius=0.3):
    l = bpy.data.lights.new(name, "SPOT"); l.energy = power; l.spot_size = math.radians(size_deg); l.spot_blend = blend; l.color = color
    l.shadow_soft_size = radius
    o = bpy.data.objects.new(name, l); o.location = loc; sc.collection.objects.link(o); look_at(o, target); return o


def studio_lights():
    area("key", (2.8, -4.5, 3.4), (math.radians(55), 0, math.radians(32)), 520, 3)
    area("rimL", (-2.6, 1.8, 2.4), (math.radians(-60), 0, math.radians(-140)), 700, 2, (0.5, 0.6, 1.0))
    area("rimR", (2.6, 1.8, 0.2), (math.radians(-90), 0, math.radians(140)), 500, 2, (1.0, 0.5, 0.9))


def look_at(o, target):
    t = bpy.data.objects.new(o.name + "_aim", None); sc.collection.objects.link(t); t.location = target
    c = o.constraints.new("TRACK_TO"); c.target = t; c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"; return t


# ---------------- text ----------------
def text(name, body, loc, size, color, strength, rot=(math.radians(90), 0, 0), font_path=FONT_HEAVY, align="CENTER"):
    bpy.ops.object.text_add(location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.data.body = body; o.data.font = font(font_path)
    o.data.size = size; o.data.align_x = align; o.data.align_y = "CENTER"; o.data.extrude = 0.006
    o.data.materials.append(emission_mat(name, color, strength)); return o


def pop(o, f, big=1.18, base=1.0):
    o.scale = (0,) * 3; o.keyframe_insert("scale", frame=f - 1)
    o.scale = (big * base,) * 3; o.keyframe_insert("scale", frame=f + 5)
    o.scale = (base,) * 3; o.keyframe_insert("scale", frame=f + 10)


def pulse(o, f0, f1, base=1.0, amp=0.06, period=16):
    for f in range(f0, f1 + 1, period // 2):
        s = base * (1 + amp if ((f - f0) // (period // 2)) % 2 else 1 - amp * 0.3)
        o.scale = (s,) * 3; o.keyframe_insert("scale", frame=f)


_handlers = []


def count_up(text_obj, value, f0, dur, prefix="$", cents=True):
    def h(scene, *_):
        t = min(1.0, max(0.0, (scene.frame_current - f0) / dur)); t = 1 - (1 - t) ** 3
        text_obj.data.body = (prefix + (f"{value * t:,.2f}" if cents else f"{value * t:,.0f}"))
    _handlers.append(h); bpy.app.handlers.frame_change_pre.append(h)


def every_frame(fn):
    _handlers.append(fn); bpy.app.handlers.frame_change_pre.append(fn)


# ---------------- camera + bloom + render ----------------
def camera(loc, target=None, lens=50, dof_target=None, fstop=1.6):
    cam = bpy.data.cameras.new("cam"); cam.lens = lens; cam.sensor_fit = "VERTICAL"; cam.sensor_height = 36
    cam.dof.use_dof = os.environ.get("DOF", "1") == "1"; cam.dof.aperture_fstop = fstop
    co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co; co.location = loc
    if target is not None: look_at(co, target)
    else: co.rotation_euler = (math.radians(90), 0, 0)
    if dof_target is not None: cam.dof.focus_object = dof_target
    return co


def bloom(threshold=0.8, strength=0.6, size=0.6):
    try:
        try:
            tree = bpy.data.node_groups.new("comp", "CompositorNodeTree"); sc.compositing_node_group = tree
            tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            outn = tree.nodes.new("NodeGroupOutput")
        except Exception:
            sc.use_nodes = True; tree = sc.node_tree; tree.nodes.clear(); outn = tree.nodes.new("CompositorNodeComposite")
        rl = tree.nodes.new("CompositorNodeRLayers"); gl = tree.nodes.new("CompositorNodeGlare")
        for prop, val in (("glare_type", "BLOOM"), ("quality", "HIGH")):
            try: setattr(gl, prop, val)
            except Exception: pass
        for name, val in (("Type", "Bloom"), ("Threshold", threshold), ("Strength", strength), ("Size", size)):
            if name in gl.inputs:
                try: gl.inputs[name].default_value = val
                except Exception as e: print("glare input", name, e)
        tree.links.new(rl.outputs["Image"], gl.inputs["Image"]); tree.links.new(gl.outputs["Image"], outn.inputs[0])
        print("BLOOM ON")
    except Exception as e:
        print("BLOOM OFF:", e)


def render(out):
    if os.environ.get("STILLS"):
        for f in [int(x) for x in os.environ["STILLS"].split(",")]:
            sc.frame_set(f); sc.render.filepath = os.path.join(out, f"still_{f:04d}"); bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(animation=True)
