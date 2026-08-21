"""Split fab.fbx into one GLB per car, with a paint mask baked into albedo alpha.

Offline asset step -- needs Pillow and numpy, which the runtime does not.
Run it only when the model set or the mask logic changes:

    CAR_PACK_DIR=/path/to/generic-passenger-car-pack python car_3d/tools/build_glb.py


The pack ships each body's paint as a single flat saturated region in the albedo
map. We detect that region, store it in the alpha channel, and the viewer tints
only those pixels -- so trim, glass, lights and tyres keep their baked look.
"""
import json, math, os, re, struct, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
import fbx_parse as F
from PIL import Image

# The source pack is not in the repo -- it is a 26 MB art asset. Point
# CAR_PACK_DIR at it to re-export; the .glb files in car_3d/models are the
# committed output and are all the runtime needs.
PACK = os.environ.get('CAR_PACK_DIR',
                      os.path.expanduser('~/Downloads/generic-passenger-car-pack'))
FBX = os.path.join(PACK, 'source/fab.fbx')
TEX = os.path.join(PACK, 'textures')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models')

# body mesh name in the FBX -> slug used by the app
CARS = {
    'Compact Body':   'compact',
    'Coupe Body':     'coupe',
    'Hatchback Body': 'hatchback',
    'minivan body':   'minivan',
    'Offroad Body':   'offroad',
    'Pickup Body':    'pickup',
    'Sedan Body':     'sedan',
    'Sport body':     'sport',
    'SUV Body':       'suv',
    'Wagon Body':     'wagon',
}
# real-world length in metres, used to scale each model consistently
# cars whose PCA axis lands tail-first; flipped 180 deg so every model faces +X
SAT_MIN = 0.22          # below this a pixel is trim, not paint
HUE_TOL = 22.0          # degrees around the detected paint hue
NEUTRAL_FLOOR = 8       # neutral bodies: ignore unused/cavity pixels below this
CLEARCOAT_GLOSS = 160   # painted panels are glossy...
CLEARCOAT_METAL = 96    # ...and not brightwork
NEUTRAL_TOL = 6         # ...and take this band around the dominant level

FLIP = {'hatchback', 'offroad', 'pickup', 'sport', 'suv'}

LENGTHS = {'compact': 3.9, 'coupe': 4.5, 'hatchback': 4.1, 'minivan': 4.9,
           'offroad': 4.7, 'pickup': 5.3, 'sedan': 4.8, 'sport': 4.4,
           'suv': 4.6, 'wagon': 4.8}

# ---------------------------------------------------------------- matrices
def mat_ident():
    return [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]

def mat_mul(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def mat_trans(t):
    m = mat_ident()
    m[0][3], m[1][3], m[2][3] = t
    return m

def mat_scale(s):
    m = mat_ident()
    m[0][0], m[1][1], m[2][2] = s
    return m

def mat_rot(deg):
    x, y, z = (math.radians(d) for d in deg)
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rx = [[1,0,0,0],[0,cx,-sx,0],[0,sx,cx,0],[0,0,0,1]]
    ry = [[cy,0,sy,0],[0,1,0,0],[-sy,0,cy,0],[0,0,0,1]]
    rz = [[cz,-sz,0,0],[sz,cz,0,0],[0,0,1,0],[0,0,0,1]]
    return mat_mul(mat_mul(rz, ry), rx)          # FBX eEulerXYZ

def xform(m, v):
    return tuple(m[i][0]*v[0] + m[i][1]*v[1] + m[i][2]*v[2] + m[i][3] for i in range(3))

def xform_dir(m, v):
    return tuple(m[i][0]*v[0] + m[i][1]*v[1] + m[i][2]*v[2] for i in range(3))

def model_matrix(p):
    t   = p.get('Lcl Translation', (0.0, 0.0, 0.0))
    r   = p.get('Lcl Rotation', (0.0, 0.0, 0.0))
    s   = p.get('Lcl Scaling', (1.0, 1.0, 1.0))
    pre = p.get('PreRotation', (0.0, 0.0, 0.0))
    world = mat_mul(mat_mul(mat_trans(t), mat_mul(mat_rot(pre), mat_rot(r))), mat_scale(s))
    geo = mat_mul(mat_mul(mat_trans(p.get('GeometricTranslation', (0.0, 0.0, 0.0))),
                          mat_rot(p.get('GeometricRotation', (0.0, 0.0, 0.0)))),
                  mat_scale(p.get('GeometricScaling', (1.0, 1.0, 1.0))))
    return mat_mul(world, geo)

# ---------------------------------------------------------------- FBX graph
def build_scene():
    root = F.load(FBX)
    objs, conns = root.find('Objects'), root.find('Connections')
    by_id = {}
    for kind in ('Model', 'Geometry', 'Material', 'Texture', 'Video'):
        for n in objs.find_all(kind):
            by_id[n.props[0]] = (kind, n)
    # child -> parent object links, and material -> texture property links
    oo = collections.defaultdict(list)
    op = {}
    for c in conns.children:
        if c.props[0] == 'OO':
            oo[c.props[2]].append(c.props[1])
        elif c.props[0] == 'OP' and c.props[3] == 'DiffuseColor':
            op[c.props[2]] = c.props[1]
    return by_id, oo, op

_TEX_HAVE = None

def resolve_texture(name):
    """The FBX names paint variants that were not shipped (CoupeGreen.png);
    fall back to whatever variant of the same body/wheel the pack does ship."""
    global _TEX_HAVE
    if _TEX_HAVE is None:
        _TEX_HAVE = os.listdir(TEX)
    if name in _TEX_HAVE:
        return name
    stem = name.rsplit('.', 1)[0]
    if stem.lower().startswith('wheel'):
        prefix = stem.rsplit('_Diffuse', 1)[0]
    else:
        prefix = re.match(r'[A-Za-z]*?(?=[A-Z][a-z]+$)', stem)
        prefix = prefix.group(0) if prefix and prefix.group(0) else stem
    cands = [f for f in _TEX_HAVE
             if f.lower().startswith(prefix.lower())
             and not any(k in f for k in ('_Metallic', '_Glossiness'))]
    if cands:
        return sorted(cands)[0]
    if stem.lower().startswith('wheel'):           # wheel_F is absent entirely
        return 'wheel_G_Diffuse.png'
    raise FileNotFoundError(name)


def texture_file(by_id, op, mat_id):
    tid = op.get(mat_id)
    if tid is None or tid not in by_id:
        return None
    node = by_id[tid][1]
    rel = node.find('RelativeFilename')
    if not rel:
        return None
    return resolve_texture(os.path.basename(rel.props[0].replace('\\', '/')))

# ---------------------------------------------------------------- mesh read
def read_mesh(geo):
    verts = geo.find('Vertices').props[0]
    pvi = geo.find('PolygonVertexIndex').props[0]

    ln = geo.find('LayerElementNormal')
    normals = ln.find('Normals').props[0]
    n_ref = ln.find('ReferenceInformationType').props[0]
    n_idx = ln.find('NormalsIndex').props[0] if n_ref != 'Direct' else None

    lu = geo.find('LayerElementUV')
    uvs = lu.find('UV').props[0] if lu else [0.0, 0.0]
    u_idx = lu.find('UVIndex').props[0] if lu and lu.find('UVIndex') else None

    lm = geo.find('LayerElementMaterial')
    mats = lm.find('Materials').props[0] if lm else [0]
    m_map = lm.find('MappingInformationType').props[0] if lm else 'AllSame'

    # walk polygons; a negative index marks the last corner of a polygon
    polys, cur = [], []
    for i, raw in enumerate(pvi):
        idx = ~raw if raw < 0 else raw
        cur.append((idx, i))
        if raw < 0:
            polys.append(cur)
            cur = []

    faces = []                                     # (mat, [(pos, nrm, uv) * 3])
    for pi, poly in enumerate(polys):
        mat = mats[pi] if m_map == 'ByPolygon' else mats[0]
        corners = []
        for vi, ci in poly:
            pos = (verts[vi*3], verts[vi*3+1], verts[vi*3+2])
            ni = n_idx[ci] if n_idx else ci
            nrm = (normals[ni*3], normals[ni*3+1], normals[ni*3+2])
            ui = u_idx[ci] if u_idx else ci
            uv = (uvs[ui*2], uvs[ui*2+1]) if lu else (0.0, 0.0)
            corners.append((pos, nrm, uv))
        for k in range(1, len(corners) - 1):        # triangle fan
            faces.append((mat, [corners[0], corners[k], corners[k+1]]))
    return faces

# ---------------------------------------------------------------- textures
def tex_stem(name):
    """CompactBlue.png -> Compact, wheel_B_Diffuse.png -> wheel_B."""
    stem = name.rsplit('.', 1)[0]
    for suffix in ('Blue', 'Red', 'Green', 'Yellow', 'Black', 'White', 'Grey', '_Diffuse'):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem


def _map_array(stem, suffix, size, default):
    if stem is None:
        return None
    import numpy as np
    path = os.path.join(TEX, stem + suffix + '.png')
    if not os.path.exists(path):
        return None
    img = Image.open(path).convert('L').resize((size, size), Image.LANCZOS)
    return np.asarray(img, dtype=np.int16)


def paint_mask(img, size, stem=None):
    """Isolate the sprayed panels in a body albedo map.

    The maps are flat-shaded: paint keeps one hue and saturation while its
    value swings with baked shading, and every trim/glass/tyre pixel is exactly
    neutral. So hue plus saturation separates them cleanly. A few bodies are
    sprayed a neutral colour (SUVBlack) and have no hue to key off -- those fall
    back to the dominant mid-luminance band, which is the paint.
    """
    import numpy as np
    a = np.asarray(img.convert('RGB').resize((size, size), Image.LANCZOS),
                   dtype=np.float32) / 255.0
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    val = mx
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    chroma = mx - mn
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    hue = np.zeros_like(mx)
    safe = chroma > 1e-6
    with np.errstate(invalid='ignore'):
        h_r = ((g - b) / np.where(safe, chroma, 1)) % 6
        h_g = (b - r) / np.where(safe, chroma, 1) + 2
        h_b = (r - g) / np.where(safe, chroma, 1) + 4
    hue = np.where(mx == r, h_r, np.where(mx == g, h_g, h_b)) * 60.0
    hue = np.where(safe, hue, 0.0)

    coloured = (sat >= SAT_MIN) & (val >= 0.03)
    if coloured.mean() >= 0.03:
        bins = np.floor(hue[coloured] / 5.0).astype(int) % 72
        peak = np.bincount(bins, minlength=72).argmax()
        paint_hue = (peak + 0.5) * 5.0
        dh = np.abs((hue - paint_hue + 180.0) % 360.0 - 180.0)
        mask = coloured & (dh <= HUE_TOL)
    else:
        # A neutral body (SUVBlack) has no hue to key off, and its black paint
        # is as dark as its black trim. The material maps still separate them:
        # painted panels carry the clearcoat signature (glossy, non-metal),
        # while bumpers and cladding are matte and brightwork is metal.
        lum = np.round(val * 255).astype(int)
        gloss = _map_array(stem, '_Glossiness', size, 255)
        metal = _map_array(stem, '_Metallic', size, 0)
        if gloss is not None and metal is not None:
            mask = (gloss >= CLEARCOAT_GLOSS) & (metal <= CLEARCOAT_METAL) & (lum >= NEUTRAL_FLOOR)
        else:                               # no maps: fall back to luminance
            body = lum >= NEUTRAL_FLOOR
            level = np.bincount(lum[body], minlength=256).argmax() if body.any() else int(lum.max())
            mask = np.abs(lum - level) <= NEUTRAL_TOL

    px = a[mask]
    paint = tuple(int(round(c * 255)) for c in px.mean(axis=0)) if len(px) else (128, 128, 128)
    return Image.fromarray((mask * 255).astype('uint8'), 'L'), paint


def albedo_with_mask(name, size, mask_it):
    img = Image.open(os.path.join(TEX, name)).convert('RGB').resize((size, size), Image.LANCZOS)
    if mask_it:
        mask, paint = paint_mask(Image.open(os.path.join(TEX, name)), size, tex_stem(name))
        img.putalpha(mask)
        return img, paint
    img.putalpha(Image.new('L', (size, size), 0))
    return img, None

def mr_texture(base, size):
    """glTF metallic-roughness: G = roughness, B = metallic."""
    def load(suffix, default):
        p = os.path.join(TEX, base + suffix + '.png')
        if not os.path.exists(p):
            return Image.new('L', (size, size), default)
        return Image.open(p).convert('L').resize((size, size), Image.LANCZOS)
    metal = load('_Metallic', 0)
    gloss = load('_Glossiness', 128)
    rough = Image.eval(gloss, lambda v: 255 - v)
    return Image.merge('RGB', (Image.new('L', (size, size), 0), rough, metal))

def png_bytes(img):
    import io
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return buf.getvalue()

def jpg_bytes(img):
    import io
    buf = io.BytesIO()
    img.convert('RGB').save(buf, 'JPEG', quality=82)
    return buf.getvalue()

# ---------------------------------------------------------------- GLB writer
class Glb:
    def __init__(self):
        self.bin = bytearray()
        self.g = {'asset': {'version': '2.0', 'generator': 'carserving-fbx2glb'},
                  'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                  'materials': [], 'textures': [], 'images': [], 'samplers': [{}],
                  'accessors': [], 'bufferViews': [], 'buffers': []}

    def _pad(self, n=4):
        while len(self.bin) % n:
            self.bin.append(0)

    def view(self, data, target=None):
        self._pad()
        off = len(self.bin)
        self.bin += data
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.g['bufferViews'].append(v)
        return len(self.g['bufferViews']) - 1

    def accessor(self, data, ctype, atype, count, mn=None, mx=None, target=None):
        a = {'bufferView': self.view(data, target), 'componentType': ctype,
             'count': count, 'type': atype}
        if mn:
            a['min'], a['max'] = mn, mx
        self.g['accessors'].append(a)
        return len(self.g['accessors']) - 1

    def image(self, data, mime):
        self.g['images'].append({'bufferView': self.view(data), 'mimeType': mime})
        self.g['textures'].append({'sampler': 0, 'source': len(self.g['images']) - 1})
        return len(self.g['textures']) - 1

    def save(self, path):
        self.g['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.g, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        self._pad()
        blob = (struct.pack('<II', len(js), 0x4E4F534A) + js +
                struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))
        open(path, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + len(blob)) + blob)


def add_primitive(glb, verts, idxs, material):
    import numpy as np
    pos = np.array([v[0] for v in verts], dtype='<f4')
    nrm = np.array([v[1] for v in verts], dtype='<f4')
    uv = np.array([v[2] for v in verts], dtype='<f4')
    idx = np.array(idxs, dtype='<u4' if len(verts) > 65535 else '<u2')
    a_pos = glb.accessor(pos.tobytes(), 5126, 'VEC3', len(verts),
                         pos.min(axis=0).tolist(), pos.max(axis=0).tolist(), 34962)
    a_nrm = glb.accessor(nrm.tobytes(), 5126, 'VEC3', len(verts), target=34962)
    a_uv = glb.accessor(uv.tobytes(), 5126, 'VEC2', len(verts), target=34962)
    a_idx = glb.accessor(idx.tobytes(), 5125 if idx.dtype == np.dtype('<u4') else 5123,
                         'SCALAR', len(idxs), target=34963)
    return {'attributes': {'POSITION': a_pos, 'NORMAL': a_nrm, 'TEXCOORD_0': a_uv},
            'indices': a_idx, 'material': material}


def main():
    import numpy as np
    by_id, oo, op = build_scene()
    os.makedirs(OUT, exist_ok=True)

    models = [(i, n) for i, (k, n) in by_id.items() if k == 'Model' and n.props[2] == 'Mesh']
    info = {}
    for mid, node in models:
        p = F.prop70(node)
        geo = mat = None
        mats = []
        for cid in oo.get(mid, []):
            kind = by_id.get(cid, (None, None))[0]
            if kind == 'Geometry':
                geo = by_id[cid][1]
            elif kind == 'Material':
                mats.append(cid)
        info[mid] = {'name': node.props[1].split('::')[0], 'p': p, 'geo': geo,
                     'mats': mats, 'M': model_matrix(p),
                     'pos': p.get('Lcl Translation', (0.0, 0.0, 0.0))}

    bodies = {i: d for i, d in info.items() if d['name'] in CARS}
    # every other mesh joins the nearest body (the pack lays cars out on a grid)
    groups = {i: [i] for i in bodies}
    IGNORE = {'Cylinder001'}
    for mid, d in info.items():
        if mid in bodies or d['geo'] is None or d['name'] in IGNORE:
            continue
        best = min(bodies, key=lambda b: sum((d['pos'][k] - bodies[b]['pos'][k]) ** 2 for k in (0, 2)))
        groups[best].append(mid)

    manifest = {}
    for bid, members in groups.items():
        slug = CARS[bodies[bid]['name']]
        glb = Glb()
        tex_cache, mat_cache = {}, {}

        # ------------------------------------------------ collect geometry
        parts = []                                  # (texfile, is_body, verts, idxs)
        buckets = collections.defaultdict(lambda: ([], {}, []))
        untextured = {}
        for mid in members:
            d = info[mid]
            faces = read_mesh(d['geo'])
            M = d['M']
            for slot, tri in faces:
                mat_id = d['mats'][slot] if slot < len(d['mats']) else (d['mats'][0] if d['mats'] else None)
                tf = texture_file(by_id, op, mat_id) if mat_id else None
                if tf is None:                      # untextured slot, e.g. Glass
                    mname = by_id[mat_id][1].props[1].split('::')[0] if mat_id else 'Untextured'
                    tf = '@' + mname
                    untextured[tf] = F.prop70(by_id[mat_id][1]) if mat_id else {}
                verts, lut, idxs = buckets[tf]
                for pos, nrm, uv in tri:
                    wp = xform(M, pos)
                    wn = xform_dir(M, nrm)
                    key = (round(wp[0], 3), round(wp[1], 3), round(wp[2], 3),
                           round(wn[0], 3), round(wn[1], 3), round(wn[2], 3),
                           round(uv[0], 5), round(uv[1], 5))
                    j = lut.get(key)
                    if j is None:
                        j = lut[key] = len(verts)
                        verts.append((wp, wn, uv))
                    idxs.append(j)

        # ------------------------------------------------ normalise placement
        allpts = np.array([v[0] for tf in buckets for v in buckets[tf][0]])
        flat = allpts[:, [0, 2]]
        flat = flat - flat.mean(axis=0)
        _, vecs = np.linalg.eigh(np.cov(flat.T))
        axis = vecs[:, -1]                                 # longest horizontal axis
        yaw = math.atan2(axis[1], axis[0])
        c, s_ = math.cos(-yaw), math.sin(-yaw)
        if slug in FLIP:
            c, s_ = -c, -s_
        rx = allpts[:, 0] * c - allpts[:, 2] * s_
        rz = allpts[:, 0] * s_ + allpts[:, 2] * c
        rot = np.stack([rx, allpts[:, 1], rz], axis=1)
        lo, hi = rot.min(axis=0), rot.max(axis=0)
        scale = LENGTHS[slug] / (hi[0] - lo[0])
        cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
        floor = lo[1]

        def place(v):
            x = v[0] * c - v[2] * s_
            z = v[0] * s_ + v[2] * c
            return ((x - cx) * scale, (v[1] - floor) * scale, (z - cz) * scale)

        def place_dir(v):
            return (v[0] * c - v[2] * s_, v[1], v[0] * s_ + v[2] * c)

        prims = []
        for tf, (verts, lut, idxs) in buckets.items():
            is_body = (not tf.startswith('@') and not tf.lower().startswith('wheel')
                       and tf != 'lights.jpg')
            nv = [(place(v[0]), place_dir(v[1]), (v[2][0], 1.0 - v[2][1])) for v in verts]
            if tf.startswith('@') and tf not in mat_cache:
                mp = untextured[tf]
                col = mp.get('DiffuseColor', (0.1, 0.1, 0.1))
                opacity = mp.get('Opacity', 1.0)
                mat = {'name': tf[1:],
                       'pbrMetallicRoughness': {
                           'baseColorFactor': [col[0], col[1], col[2], opacity],
                           'metallicFactor': 0.0, 'roughnessFactor': 0.08},
                       'doubleSided': False,
                       'extras': {'paintable': False}}
                if opacity < 1.0:
                    mat['alphaMode'] = 'BLEND'
                glb.g['materials'].append(mat)
                mat_cache[tf] = len(glb.g['materials']) - 1
            if tf not in mat_cache:
                base_size = 1024 if is_body else 512
                img, paint = albedo_with_mask(tf, base_size, is_body)
                t_base = glb.image(png_bytes(img), 'image/png')
                stem = tex_stem(tf)
                t_mr = glb.image(jpg_bytes(mr_texture(stem, 512)), 'image/jpeg')
                glb.g['materials'].append({
                    'name': ('paint' if is_body else 'trim') + ':' + tf,
                    'pbrMetallicRoughness': {
                        'baseColorTexture': {'index': t_base},
                        'metallicRoughnessTexture': {'index': t_mr},
                        'metallicFactor': 1.0, 'roughnessFactor': 1.0},
                    'doubleSided': True,
                    'extras': {'paintable': bool(is_body),
                               'sourcePaint': list(paint) if paint else None}})
                mat_cache[tf] = len(glb.g['materials']) - 1
            prims.append(add_primitive(glb, nv, idxs, mat_cache[tf]))

        glb.g['meshes'].append({'name': slug, 'primitives': prims})
        glb.g['nodes'].append({'mesh': 0, 'name': slug})
        glb.g['scenes'][0]['nodes'] = [0]
        path = os.path.join(OUT, slug + '.glb')
        glb.save(path)
        tris = sum(len(b[2]) for b in buckets.values()) // 3
        manifest[slug] = {'file': slug + '.glb', 'triangles': tris,
                          'length_m': LENGTHS[slug],
                          'bytes': os.path.getsize(path)}
        print(f'{slug:10s} {tris:6d} tris  {len(buckets)} materials  {os.path.getsize(path)/1024:7.0f} KB')

    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=2)


if __name__ == '__main__':
    main()
