"""The official battlefield scenes of 卫戍协议 (DESIGN §15): every battlefield is a prebuilt Unity scene
(scenes/activities/<season>/level_<stage>/level_<stage>.ab, with …/lightingdata.ab beside it) whose tile models are
baked into "Combined Mesh (root: scene)" objects, plus loose meshes for the parts the game shows and hides.

The scene bundles ship only while the season runs (the hot-update list of an off-season client has none), so they are
read from the client's AB root when it has them and else from a directory of bundles kept from an in-season version
(extract.py --scenes <dir>, default .cache/official-scenes/*; tools/local-extract/fetch_scenes.py fills it). Materials
and their textures come from the theme bundles of the local client (SCENES lists each scene's, as the official asset
index records them: the scene bundle's dependencies).

Output per stage, under <out>/scene/<stageId>/ (manifest group scene/<stageId>):
  scene.json   { version, stage, light, lightmaps, materials, groups, chunks: [{ material, lightmap, group, verts,
                 tris, offset, index32, bounds }] }
  scene.bin    the chunks' vertex data in board space (x = column, y = row, z = height: Unity's anchor-local
               (x, y, −z)); per chunk: position f32×3, uv f32×2, lightmap uv f32×2 (scale / offset applied),
               normal i8×4, colour u8×4, indices u16|u32 (padded to 4 bytes)
  lm<i>.png    lightmap page i (+ a WebP copy, the one the manifest lists): RGB = the baked indirect light (Lightmap-<i>_comp_light, stored RGBM: decode_rgbm),
               A = the key light's baked shadow (Lightmap-<i>_comp_shadowmask, R)
and the materials' albedo textures under <out>/scene/tex/ (manifest group scene/tex, shared by the scenes).
A chunk's `group` is '' for what the scene shows at rest and the sub-graphic name (HIDDEN@1 …, MapSubGraphicHolder)
for the meshes the game switches on later.
"""
import json
import os
import re
import stat
import struct
from pathlib import Path

SAND = ['arts/maps/map_autochesssand/res.ab', 'arts/maps/map_survivaloasis_city/res.ab', 'arts/maps/map_yumen/res.ab']
SHORE = ['arts/maps/map_doss_shore/res.ab']
# (stage id, theme bundles of the local client that hold the scene's materials / textures / shared meshes): the
# dependencies of each scene bundle in the official asset index (Android 25-11-21-15-21-44_ee1197 for 盟约·上半,
# 26-03-13-06-11-47_14fb99 and 26-04-13-12-31-42_e9b560 for 盟约·下半 — the same in all three).
SCENES = [
    ('act1autochess_m01', SAND),
    ('act1autochess_m02', SAND),
    ('act1autochess_m03', SAND),
    ('act1autochess_m04', SAND),
    ('act1autochess_m05', SAND + SHORE),
    ('act1autochess_m06', SAND),
    ('act1autochess_m07', SAND),
    ('act2autochess_m01', ['arts/maps/map_lakegarden/res.ab', 'arts/maps/map_syracuse_metro/res.ab',
                           'arts/maps/common/meshes/s_background_common.ab']),
    ('act2autochess_m02', SAND),
    ('act2autochess_m03', ['arts/maps/map_kxmr/res.ab', 'arts/maps/map_kxmr/background_mesh/bg_kxmr.ab',
                           'arts/maps/map_lm_center/res.ab']),
    ('act2autochess_m04', SAND + SHORE),
]
# bundles every scene may reference besides its theme (shared water / noise textures)
COMMON_DEPS = ['arts/maps/effect.ab']
SCENE_SUB = 'scene'
TEX_SUB = 'scene/tex'
SCENE_VERSION = 1
# linear light value that a lightmap page's 1.0 stands for (decode_rgbm; scene.json lightRange)
LIGHT_RANGE = 8.0
HIDDEN_NAME = re.compile(r'^[A-Z_]+@\d+$')
WATER_SHADERS = ('StylizedWater', 'StandardWater', 'DynamicWaterTile')


def scene_bundle(stage_id):
    """Bundle path of a stage's scene, relative to an AB root (act1autochess_m01 → scenes/activities/act1autochess/…)."""
    season = stage_id.rsplit('_', 1)[0]
    return f'scenes/activities/{season}/level_{stage_id}/level_{stage_id}.ab'


def find_scene(stage_id, roots):
    """The first existing scene bundle of `stage_id` under `roots` (AB roots), or None."""
    rel = scene_bundle(stage_id)
    for root in roots:
        p = Path(root) / rel
        if p.is_file():
            return p
    return None


# ---- small pure-Python linear algebra (row-major 3×4 affine matrices: [r0, r1, r2], each [a, b, c, t]) -----------

def trs(pos, rot, scale):
    """Affine matrix of a Unity local transform (position, quaternion xyzw, scale)."""
    x, y, z, w = rot
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[i][0] * scale[0], r[i][1] * scale[1], r[i][2] * scale[2], pos[i]] for i in range(3)]


def mul(a, b):
    """a · b of two affine matrices."""
    return [[a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + (a[i][3] if j == 3 else 0.0) for j in range(4)]
            for i in range(3)]


def det3(m):
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


IDENTITY = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]]


def to_board(p, anchor):
    """Unity world position → board space (x = column, y = row, z = height above the low ground)."""
    return (p[0] - anchor[0], p[1] - anchor[1], -(p[2] - anchor[2]))


def pack_chunk(ch):
    """Binary record of a chunk (see the module docstring); returns (bytes, index32)."""
    n = len(ch['pos'])
    flat = lambda rows: [v for row in rows for v in row]  # noqa: E731
    out = bytearray()
    out += struct.pack(f'<{n * 3}f', *flat(ch['pos']))
    out += struct.pack(f'<{n * 2}f', *flat(ch['uv']))
    out += struct.pack(f'<{n * 2}f', *flat(ch['uv1']))
    out += struct.pack(f'<{n * 4}b', *flat([(*(max(-127, min(127, int(round(c * 127)))) for c in nr), 0) for nr in ch['nrm']]))
    out += struct.pack(f'<{n * 4}B', *flat([tuple(max(0, min(255, int(round(c * 255)))) for c in col) for col in ch['col']]))
    idx32 = n > 65535
    out += struct.pack(f'<{len(ch["idx"])}{"I" if idx32 else "H"}', *ch['idx'])
    while len(out) % 4:
        out.append(0)
    return bytes(out), idx32


def decode_rgbm(img):
    """RGB image of a baked lightmap page stored RGBM (Unity, linear colour space: light = 5^2.2 · A^2.2 · RGB):
    the linear light L as (L / LIGHT_RANGE)^(1/2.2) per channel — = (5^2.2 / LIGHT_RANGE)^(1/2.2) · A · RGB^(1/2.2),
    clamped to 1 (the renderer reads L = value^2.2 · LIGHT_RANGE). A page without alpha is taken as plain RGB."""
    from PIL import Image, ImageChops
    if img.mode != 'RGBA':
        return img.convert('RGB')
    k = (5.0 ** 2.2 / LIGHT_RANGE) ** (1 / 2.2)
    r, g, b, a = img.split()
    m = a.point([min(255, int(round(v * k))) for v in range(256)])
    gamma = [int(round(255 * (v / 255) ** (1 / 2.2))) for v in range(256)]
    return Image.merge('RGB', tuple(ImageChops.multiply(ch.point(gamma), m) for ch in (r, g, b)))


def save_image(img, out_dir, stem, sub, output=None):
    """Write `img` as <stem>.png and a WebP copy beside it (lossy at quality 95 with the alpha lossless and the RGB
    under transparent texels kept, like extract.py WEBP: every player downloads these with the scene); returns the
    manifest entry, which lists the copy (the PNG with a Pillow that has no WebP)."""
    if output is not None:
        return output.image(img, out_dir, stem, sub)
    img.save(Path(out_dir) / f'{stem}.png')
    entry = {'path': f'/assets/local/{sub}/{stem}.png', 'w': img.width, 'h': img.height}
    try:
        img.save(Path(out_dir) / f'{stem}.webp', 'WEBP', quality=95, method=6, alpha_quality=100, exact=True)
        entry.update(path=f'/assets/local/{sub}/{stem}.webp', webp='lossy')
    except Exception:
        pass
    return entry


def hidden_groups(raw, objects):
    """{GameObject path id: sub-graphic name} of a MapSubGraphicHolder's raw data: after each name (HIDDEN@n) come the
    GameObjects and MeshTileGraphics of that group as PPtrs of this file. The script has no type tree in the bundle,
    so the fields are walked as 4-byte words: a length-prefixed name, or a (file 0, path id) pointer to an object."""
    out, group, i = {}, None, 0
    body = raw
    while i + 4 <= len(body):
        v = struct.unpack_from('<i', body, i)[0]
        if 0 < v < 64 and i + 4 + v <= len(body):
            text = body[i + 4:i + 4 + v]
            if all(32 <= b < 127 for b in text):
                s = text.decode('ascii')
                if HIDDEN_NAME.match(s):
                    group = s
                i += 4 + ((v + 3) & ~3)
                continue
        if v == 0 and i + 12 <= len(body) and group:
            pid = struct.unpack_from('<q', body, i + 4)[0]
            target = objects.get(pid)
            if target is not None:
                out[pid] = group
                i += 12
                continue
        i += 4
    return out


def meshless_placeholder_reason(has_mesh_filter, mesh_path_id, is_static):
    """Runtime-generated, non-static renderer shells without a source mesh are intentional placeholders."""
    if is_static:
        return None
    if not has_mesh_filter:
        return 'no MeshFilter (runtime-generated placeholder)'
    if not mesh_path_id:
        return 'null mesh pointer (runtime-generated placeholder)'
    return None


def _lts_version(version):
    match = re.fullmatch(r'(\d+)\.(\d+)\.\d+f\d+', str(version or ''))
    return (int(match.group(1)), int(match.group(2))) if match else None


def _checked_resource_path(path):
    path = Path(path)
    if not path.is_absolute():
        raise RuntimeError(f'--unity-resources must be an absolute path: {path}')
    for candidate in reversed((path, *path.parents)):
        try:
            info = os.lstat(candidate)
        except FileNotFoundError:
            continue
        attrs = getattr(info, 'st_file_attributes', 0)
        reparse_flag = getattr(info, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)
        if candidate.is_symlink() or attrs & reparse_flag:
            raise RuntimeError(f'refusing linked Unity resource path: {candidate}')
    info = os.stat(path)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink > 1:
        raise RuntimeError(f'--unity-resources must be an ordinary non-linked file: {path}')
    return path


def _quad_geometry(mesh, mesh_handler):
    handler = mesh_handler(mesh)
    handler.process()
    vertices, normals, uv0 = handler.m_Vertices, handler.m_Normals, handler.m_UV0
    triangles = [tuple(tri) for submesh in handler.get_triangles() for tri in submesh]
    close = lambda a, b: abs(a - b) <= 1e-5
    uv_corners = []
    for uv in uv0:
        corner = []
        for component in uv:
            if close(component, 0):
                corner.append(0)
            elif close(component, 1):
                corner.append(1)
            else:
                corner = []
                break
        uv_corners.append(tuple(corner) if len(corner) == 2 else None)
    diagonal_shared = set(triangles[0]) & set(triangles[1]) if len(triangles) == 2 else set()
    valid_triangles = (len(triangles) == 2 and all(len(tri) == 3 and len(set(tri)) == 3
                       and set(tri) <= {0, 1, 2, 3} for tri in triangles))
    if valid_triangles:
        def twice_area(tri):
            a, b, c = (vertices[index] for index in tri)
            return abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        shared = sorted(diagonal_shared)
        others = [next(iter(set(tri) - diagonal_shared)) for tri in triangles] if len(shared) == 2 else []
        if len(others) == 2:
            a, b = (vertices[index] for index in shared)
            p, q = (vertices[index] for index in others)
            side = close(abs(a[0] - b[0]), 1) and close(abs(a[1] - b[1]), 1)
            side_p = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
            side_q = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])
            covers_square = side and side_p * side_q < 0
        else:
            covers_square = False
    else:
        covers_square = False
    if (len(vertices) != 4 or len(normals) != 4 or len(uv0) != 4
            or any(not (close(abs(v[0]), .5) and close(abs(v[1]), .5) and close(v[2], 0)) for v in vertices)
            or {(-1 if v[0] < 0 else 1, -1 if v[1] < 0 else 1) for v in vertices}
            != {(-1, -1), (-1, 1), (1, -1), (1, 1)}
            or set(uv_corners) != {(0, 0), (1, 0), (0, 1), (1, 1)}
            or any(not (close(n[0], 0) and close(n[1], 0) and close(abs(n[2]), 1)) for n in normals)
            or any(not close(n[2], normals[0][2]) for n in normals)
            or not valid_triangles or any(not close(twice_area(tri), 1) for tri in triangles)
            or len(diagonal_shared) != 2 or not covers_square):
        raise RuntimeError('built-in Mesh #10210 is not the verified 1x1 XY Quad geometry')
    return {'name': mesh.m_Name, 'nativePathId': 10210, 'vertices': 4, 'triangles': 2,
            'uv': 'unit-square', 'normal': 'unit-Z'}


def register_builtin_quad(env, path, stage_unity_version, mesh_handler, log):
    """Register the read-only native built-in SerializedFile; allow only its verified Quad on the same LTS."""
    path = _checked_resource_path(path)
    provider = env.load_file(str(path), is_dependency=True)
    source_version = getattr(provider, 'unity_version', '')
    stage_lts, source_lts = _lts_version(stage_unity_version), _lts_version(source_version)
    if not stage_lts or not source_lts or stage_lts != source_lts:
        raise RuntimeError(f'unity default resources Unity version mismatch: stage={stage_unity_version}, '
                           f'builtinSource={source_version}, path={path}')
    objects = getattr(provider, 'objects', {})
    quad_object = objects.get(10210) if isinstance(objects, dict) else None
    if quad_object is None or quad_object.type.name != 'Mesh':
        raise RuntimeError(f'unity default resources lacks Mesh #10210: {path}')
    quad = quad_object.read()
    if quad.m_Name != 'Quad':
        raise RuntimeError(f'unity default Mesh #10210 is {quad.m_Name!r}, expected Quad: {path}')
    geometry = _quad_geometry(quad, mesh_handler)
    info = {'path': str(path), 'unityVersion': source_version, 'geometry': geometry}
    log(f'  built-in provider stageUnityVersion={stage_unity_version} '
        f'builtinSourceUnityVersion={source_version} nativePath={path} '
        f'nativePathId={geometry["nativePathId"]} name={geometry["name"]}')
    return info


def builtin_reference_path(pptr):
    file_id = getattr(pptr, 'm_FileID', 0)
    if not file_id:
        return None
    try:
        name = pptr.assetsfile.externals[file_id - 1].path
    except Exception:
        return None
    normalized = str(name).replace('\\', '/').lower()
    return normalized if normalized.endswith('unity default resources') else None


def require_supported_builtin_pointer(pptr, provider, mesh):
    """Reject unresolved builtin references except the explicitly checked Quad pointer."""
    if builtin_reference_path(pptr) is None:
        return False
    if provider is None:
        return False
    if getattr(pptr, 'm_PathID', None) != 10210:
        raise RuntimeError(f'unsupported unity default resources mesh pointer #{getattr(pptr, "m_PathID", None)}')
    if getattr(mesh, 'm_Name', None) != 'Quad':
        raise RuntimeError(f'unity default resources pointer #10210 resolved to {getattr(mesh, "m_Name", None)!r}, expected Quad')
    return True


def snapshot_scene_objects(env):
    """Capture scene objects before loading a provider that may reuse a native PathID."""
    scene_objs = list(env.objects)
    return scene_objs, {obj.path_id: obj for obj in scene_objs}


def load_scene_dependencies(env, candidate_deps, required_deps, stage_id, log, strict):
    """Load candidate theme CABs; actual PPtr resolution below decides whether an absent hint matters."""
    items = [(Path(path), True) for path in candidate_deps]
    items.extend((Path(path), False) for path in required_deps)
    for dep, candidate in items:
        if not dep.is_file():
            log(f'  warn {stage_id}: {"candidate " if candidate else "required "}dependency {dep} missing')
            if strict and not candidate:
                raise RuntimeError(f'{stage_id}: required dependency missing: {dep}')
            continue
        try:
            env.load_file(str(dep))
        except Exception as e:
            log(f'  warn {stage_id}: dependency {dep.name}: {e}')
            if strict:
                raise RuntimeError(f'{stage_id}: dependency load failed: {dep}: {e}') from e


def load_memory_dependencies(env, memory_bundles, stage_id, log, primary_bundles=()):
    """Register exact UnityFS bytes without files; primary bundles expose objects to the stage iterator."""
    loaded = []
    for name, blob in memory_bundles.get('bundles', {}).items():
        is_dependency = name not in set(primary_bundles)
        env.load_file(blob, name=name, is_dependency=is_dependency)
        loaded.append({'name': name, 'bytes': len(blob), 'memoryOnly': True,
                       'isDependency': is_dependency,
                       'nativeVersionId': memory_bundles['nativeVersionId'],
                       'manifestVersion': memory_bundles['manifestVersion'],
                       'platform': memory_bundles['platform']})
        log(f'  memory dependency loaded stage={stage_id} nativeVersionId={memory_bundles["nativeVersionId"]} '
            f'platform={memory_bundles["platform"]} name={name} bytes={len(blob)} memoryOnly=true')
    return loaded


def read_material_pointer(pptr, stage_id, strict):
    """Resolve an actual material reference; unlike candidate CAB hints, this is mandatory in strict mode."""
    try:
        return pptr.read()
    except Exception as e:
        if strict:
            raise RuntimeError(f'{stage_id}: material unresolved: {e}') from e
        return None


def resolve_pointer_with_evidence(pptr, field, owner=None):
    """Resolve one real Unity PPtr while retaining its source field and external-table row."""
    file_id = int(getattr(pptr, 'm_FileID', 0) or 0)
    path_id = int(getattr(pptr, 'm_PathID', 0) or 0)
    source = {'field': field, 'm_FileID': file_id, 'm_PathID': str(path_id)}
    if owner:
        source.update(owner)
    assetsfile = getattr(pptr, 'assetsfile', None)
    externals = list(getattr(assetsfile, 'externals', []) or [])
    source['externalEntryCount'] = len(externals)
    if file_id > 0:
        index = file_id - 1
        source['externalIndexZeroBased'] = index
        if 0 <= index < len(externals):
            entry = externals[index]
            source['externalEntry'] = {'path': str(getattr(entry, 'path', '')),
                                       'guid': str(getattr(entry, 'guid', '')),
                                       'type': int(getattr(entry, 'type', 0))}
        else:
            source['externalEntry'] = None
    else:
        source['externalIndexZeroBased'] = None
        source['externalEntry'] = None
    try:
        reader = pptr.deref() if hasattr(pptr, 'deref') else None
        if reader is not None:
            source['resolvedUnityType'] = getattr(getattr(reader, 'type', None), 'name', None)
            data = reader.read()
        else:
            data = pptr.read()
            source['resolvedUnityType'] = type(data).__name__
        source['resolvedName'] = getattr(data, 'm_Name', None)
        source['resolverStatus'] = 'resolved'
        return data, source
    except Exception as error:
        source['resolverStatus'] = 'unresolved'
        source['resolverErrorType'] = type(error).__name__
        source['resolverError'] = str(error)
        return None, source


def read_mesh_data(pptr, mesh_handler, stage_id, log, strict, source_owner=None):
    """Read a Mesh pointer; preserve PPtr identity when it resolves to another Unity type or fails."""
    source, reference = resolve_pointer_with_evidence(pptr, 'MeshFilter.m_Mesh', source_owner)
    if reference['resolverStatus'] == 'resolved' and reference.get('resolvedUnityType') != 'Mesh':
        error = f"PPtr resolves to {reference.get('resolvedUnityType')} {reference.get('resolvedName')!r}, expected Mesh"
    elif reference['resolverStatus'] == 'unresolved':
        error = reference['resolverError']
    else:
        error = None
    try:
        if error:
            raise RuntimeError(error)
        h = mesh_handler(source)
        h.process()
        return h.m_Vertices, h.m_Normals, h.m_UV0, h.m_UV1, h.m_Colors, h.get_triangles()
    except Exception as e:
        detail = json.dumps(reference, ensure_ascii=False, sort_keys=True)
        log(f'  warn {stage_id}: mesh PPtr #{pptr.m_PathID}: {e}; reference={detail}')
        if strict:
            raise RuntimeError(f'{stage_id}: mesh unresolved #{pptr.m_PathID}: {e}; reference={detail}') from e
        return None


def export_scene(stage_id, deps, scene_path, ab_root, out_root, manifest, log, material_info, shader_deps=(),
                 output=None, strict=False, unity_resources=None, memory_bundles=None, scene_blob=None):
    """Write one stage's scene (see the module docstring). Returns the number of files written (0 on failure)."""
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    from UnityPy.helpers.MeshHelper import MeshHandler
    from PIL import Image

    try:
        if scene_blob is None:
            env = UnityPy.load(str(scene_path))
        else:
            from UnityPy.environment import Environment
            env = Environment()
            env.load_file(scene_blob, name=scene_bundle(stage_id))
    except Exception as e:  # corrupt or unsupported bundle
        log(f'FAIL load {scene_path}: {e}')
        if strict:
            raise
        return 0
    stage_versions = sorted({str(getattr(asset, 'unity_version', '')) for asset in env.assets
                             if getattr(asset, 'unity_version', '')})
    stage_unity_version = stage_versions[0] if len(stage_versions) == 1 else ','.join(stage_versions)
    if strict and len(stage_versions) != 1:
        raise RuntimeError(f'{stage_id}: scene bundle has missing or inconsistent Unity versions: {stage_versions}')
    scene_objs, objects = snapshot_scene_objects(env)
    builtin_provider = register_builtin_quad(env, unity_resources, stage_unity_version, MeshHandler, log) if unity_resources else None
    light_bundle = scene_path.with_suffix('') / 'lightingdata.ab'
    extra = [light_bundle] if scene_blob is None and light_bundle.is_file() else []
    if strict and scene_blob is None and not light_bundle.is_file():
        raise RuntimeError(f'{stage_id}: lighting bundle missing: {light_bundle}')
    candidate_deps = [Path(ab_root) / d for d in [*deps, *COMMON_DEPS]]
    load_scene_dependencies(env, candidate_deps, shader_deps, stage_id, log, strict)
    if extra:
        load_scene_dependencies(env, [], extra, stage_id, log, strict)
    primary_memory_bundles = []
    if scene_blob is not None:
        primary_memory_bundles = [(str(Path(scene_bundle(stage_id)).with_suffix('') / 'lightingdata.ab')).replace('\\', '/')]
    memory_bundle_records = load_memory_dependencies(env, memory_bundles or {}, stage_id, log,
                                                     primary_memory_bundles)

    # ---- hierarchy: world matrices, active flags, hidden groups ---------------------------------------------------
    tf = {}  # transform path id → (local matrix, father id, game object)
    for o in scene_objs:
        if o.type.name != 'Transform':
            continue
        t = o.read()
        p, r, s = t.m_LocalPosition, t.m_LocalRotation, t.m_LocalScale
        tf[o.path_id] = (trs((p.x, p.y, p.z), (r.x, r.y, r.z, r.w), (s.x, s.y, s.z)), t.m_Father.m_PathID, t.m_GameObject)
    world_cache = {}

    def world(tid):
        if tid not in tf:
            return IDENTITY
        if tid not in world_cache:
            local, father, _ = tf[tid]
            world_cache[tid] = mul(world(father), local) if father else local
        return world_cache[tid]

    go_of_tf = {tid: rec[2].m_PathID for tid, rec in tf.items()}
    tf_of_go = {gid: tid for tid, gid in go_of_tf.items()}
    go_info = {}  # game object path id → (name, active)
    for o in scene_objs:
        if o.type.name == 'GameObject':
            g = o.read()
            go_info[o.path_id] = (g.m_Name, bool(g.m_IsActive))
    hidden = {}
    for o in scene_objs:
        if o.type.name != 'MonoBehaviour':
            continue
        raw = o.get_raw_data()
        if b'@' not in raw:
            continue
        for pid, group in hidden_groups(raw, objects).items():
            target = objects[pid]
            if target.type.name == 'GameObject':
                hidden[pid] = group
            elif target.type.name == 'MonoBehaviour':
                try:
                    hidden[target.read().m_GameObject.m_PathID] = group
                except Exception:
                    pass

    def state(gid):
        """(active in the hierarchy, hidden group of the object or its nearest grouped ancestor)."""
        active, group, tid = True, None, tf_of_go.get(gid)
        while tid in tf:
            g = go_of_tf[tid]
            active = active and go_info.get(g, ('', True))[1]
            if group is None and g in hidden:
                group = hidden[g]
            tid = tf[tid][1]
        return active, group

    anchor = (0.0, 0.0, 0.0)
    for gid, (name, _) in go_info.items():
        if name == 'Anchor' and gid in tf_of_go:
            m = world(tf_of_go[gid])
            anchor = (m[0][3], m[1][3], m[2][3])
            break

    # ---- light ----------------------------------------------------------------------------------------------------
    light = None
    for o in scene_objs:
        if o.type.name != 'Light':
            continue
        d = o.read_typetree()
        if d.get('m_Type') != 1:  # directional
            continue
        m = world(tf_of_go.get(d['m_GameObject']['m_PathID']))
        fwd = (m[0][2], m[1][2], m[2][2])  # the light shines along its +z
        n = (fwd[0] ** 2 + fwd[1] ** 2 + fwd[2] ** 2) ** 0.5 or 1.0
        c = d.get('m_Color', {})
        light = {'dir': [round(-fwd[0] / n, 5), round(-fwd[1] / n, 5), round(fwd[2] / n, 5)],
                 'color': [round(c.get(k, 1.0), 5) for k in 'rgb'], 'intensity': round(d.get('m_Intensity', 1.0), 5)}
        break

    # ---- renderers → chunks -----------------------------------------------------------------------------------------
    mesh_cache, materials, mat_tex = {}, {}, {}
    builtin_meshes = {}
    chunks = {}  # (material, lightmap, group) → {'pos': [], …}

    def mesh_data(pptr, source_owner=None):
        key = (getattr(pptr, 'm_FileID', 0), pptr.m_PathID)
        if key not in mesh_cache:
            builtin_path = builtin_reference_path(pptr)
            if builtin_path is not None and builtin_provider is not None:
                if pptr.m_PathID != 10210:
                    raise RuntimeError(f'{stage_id}: unsupported unity default resources mesh pointer #{pptr.m_PathID}')
                try:
                    builtin_mesh = pptr.read()
                except Exception:
                    builtin_mesh = None
                if builtin_mesh is not None and require_supported_builtin_pointer(pptr, builtin_provider, builtin_mesh):
                    builtin_meshes[pptr.m_PathID] = builtin_provider['geometry']
                    log(f'  resolved built-in mesh stage={stage_id} nativePath={builtin_provider["path"]} '
                        f'nativePathId={pptr.m_PathID} name={builtin_mesh.m_Name} '
                        f'stageUnityVersion={stage_unity_version} '
                        f'builtinSourceUnityVersion={builtin_provider["unityVersion"]}')
            mesh_cache[key] = read_mesh_data(pptr, MeshHandler, stage_id, log, strict, source_owner)
        return mesh_cache[key]

    def material_name(pptr):
        if not pptr.m_PathID:
            if strict:
                raise RuntimeError(f'{stage_id}: null material reference')
            return None
        mat = read_material_pointer(pptr, stage_id, strict)
        if mat is None:
            return None
        name = mat.m_Name
        if name not in materials:
            source_file = getattr(getattr(mref, 'assetsfile', None), 'name', None)
            info = material_info(mat, strict=strict, source_context={
                'sourceMaterialName': getattr(mat, 'm_Name', None),
                'ownerPathID': str(getattr(mref, 'm_PathID', 0) or 0),
                'sourceAssetsFile': source_file,
            })
            shader = info.get('shader') or ''
            info['kind'] = 'water' if any(w in shader for w in WATER_SHADERS) else 'lit'
            materials[name] = info
            try:
                for slot, env_ in mat.m_SavedProperties.m_TexEnvs:
                    if slot == '_MainTex' and env_.m_Texture.m_PathID:
                        mat_tex[name] = env_.m_Texture
            except Exception as e:
                if strict:
                    raise RuntimeError(f'{stage_id}: material texture reference invalid: {e}') from e
        return name

    skipped, dynamic_placeholders = 0, 0
    for o in scene_objs:
        if o.type.name != 'MeshRenderer':
            continue
        r = o.read()
        gid = r.m_GameObject.m_PathID
        sb = r.m_StaticBatchInfo
        static = sb.subMeshCount > 0
        mf = None
        mf_reader = None
        for c in r.m_GameObject.read().m_Component:
            if c.component.type.name == 'MeshFilter':
                mf_reader = c.component
                mf = c.component.read()
        mesh_path_id = getattr(getattr(mf, 'm_Mesh', None), 'm_PathID', 0) if mf is not None else 0
        placeholder_reason = meshless_placeholder_reason(mf is not None, mesh_path_id, static)
        if placeholder_reason:
            dynamic_placeholders += 1
            log(f'  skip dynamic placeholder {stage_id} renderer #{o.path_id}: {placeholder_reason}')
            continue
        if mf is None or not mesh_path_id:
            if strict:
                reason = 'no MeshFilter' if mf is None else 'null mesh pointer'
                raise RuntimeError(f'{stage_id}: static MeshRenderer {o.path_id} has {reason}')
            continue
        owner_name = go_info.get(gid, ('', True))[0]
        data = mesh_data(mf.m_Mesh, {'ownerUnityType': 'MeshFilter',
                                     'ownerPathId': str(getattr(mf_reader, 'm_PathID', 0) or getattr(mf_reader, 'path_id', '')),
                                     'ownerGameObjectPathId': str(gid), 'ownerGameObjectName': owner_name})
        if not data:
            continue
        verts, normals, uv0, uv1, colors, tris = data
        active, group = state(gid)
        if not active and group is None:
            group = 'inactive'
        first = sb.firstSubMesh if static else 0
        m = IDENTITY if static else world(tf_of_go.get(gid))
        # board space mirrors Unity's z: the triangle order is reversed to stay counter-clockwise (three.js front
        # faces), unless the object's own transform already mirrors it
        flip = det3(m) > 0
        so = r.m_LightmapTilingOffset
        st = (1.0, 1.0, 0.0, 0.0) if static else (so.x, so.y, so.z, so.w)
        lm = r.m_LightmapIndex if r.m_LightmapIndex < 65534 else -1
        luv = uv1 if uv1 else uv0
        for k, mref in enumerate(r.m_Materials):
            sub = first + k
            if sub >= len(tris):
                if strict:
                    raise RuntimeError(f'{stage_id}: renderer submesh {sub} has no mesh triangles')
                break
            name = material_name(mref)
            if not name:
                skipped += 1
                continue
            ch = chunks.setdefault((name, lm, group or ''), {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': [], 'map': None})
            remap = {}
            for tri in tris[sub]:
                tri = (tri[0], tri[2], tri[1]) if flip else tri
                for vi in tri:
                    j = remap.get(vi)
                    if j is None:
                        j = remap[vi] = len(ch['pos'])
                        v = verts[vi]
                        p = (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3],
                             m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3],
                             m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3])
                        ch['pos'].append(to_board(p, anchor))
                        nv = normals[vi] if normals else (0.0, 0.0, -1.0)
                        nw = (m[0][0] * nv[0] + m[0][1] * nv[1] + m[0][2] * nv[2],
                              m[1][0] * nv[0] + m[1][1] * nv[1] + m[1][2] * nv[2],
                              m[2][0] * nv[0] + m[2][1] * nv[1] + m[2][2] * nv[2])
                        ln = (nw[0] ** 2 + nw[1] ** 2 + nw[2] ** 2) ** 0.5 or 1.0
                        ch['nrm'].append((nw[0] / ln, nw[1] / ln, -nw[2] / ln))
                        t0 = uv0[vi] if uv0 else (0.0, 0.0)
                        ch['uv'].append((t0[0], t0[1]))
                        t1 = luv[vi] if luv else (0.0, 0.0)
                        ch['uv1'].append((t1[0] * st[0] + st[2], t1[1] * st[1] + st[3]))
                        col = colors[vi] if colors else (1.0, 1.0, 1.0, 1.0)
                        ch['col'].append(tuple(col[:4]) if len(col) >= 4 else (*col[:3], 1.0))
                    ch['idx'].append(j)
    if not chunks:
        log(f'  warn {stage_id}: no drawable mesh in {scene_path.name}')
        if strict:
            raise RuntimeError(f'{stage_id}: no drawable mesh')
        return 0

    # ---- write ------------------------------------------------------------------------------------------------------
    out_dir = Path(out_root) / SCENE_SUB / stage_id
    if output is None:
        out_dir.mkdir(parents=True, exist_ok=True)
    sub = f'{SCENE_SUB}/{stage_id}'
    blob, records = bytearray(), []
    for (name, lm, group), ch in sorted(chunks.items(), key=lambda kv: (kv[0][2], kv[0][0], kv[0][1])):
        data, idx32 = pack_chunk(ch)
        xs, ys, zs = zip(*ch['pos'])
        records.append({'material': name, 'lightmap': lm, 'group': group, 'verts': len(ch['pos']), 'tris': len(ch['idx']) // 3,
                        'offset': len(blob), 'index32': idx32,
                        'bounds': [round(v, 3) for v in (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))]})
        blob += data
    n = 0
    if output is None:
        (out_dir / 'scene.bin').write_bytes(bytes(blob))
    else:
        output.stage(out_dir / 'scene.bin', bytes(blob))
    manifest.setdefault(sub, {})['bin'] = {'path': f'/assets/local/{sub}/scene.bin', 'kind': 'SceneData', 'bytes': len(blob)}
    n += 1

    # lightmap pages: light RGB + the shadow mask's R as alpha
    pages = {}
    for o in env.objects:
        if o.type.name != 'Texture2D':
            continue
        try:
            t = o.read()
        except Exception:
            continue
        mm = re.match(r'^Lightmap-(\d+)_comp_(light|shadowmask)$', t.m_Name or '')
        if mm:
            pages.setdefault(int(mm.group(1)), {})[mm.group(2)] = t
    used_pages = sorted({rec['lightmap'] for rec in records if rec['lightmap'] >= 0})
    lightmaps = 0
    for i in used_pages:
        page = pages.get(i, {})
        if 'light' not in page:
            log(f'  warn {stage_id}: lightmap {i} missing (drawn unlit)')
            if strict:
                raise RuntimeError(f'{stage_id}: lightmap {i} missing')
            continue
        try:
            rgb = decode_rgbm(page['light'].image)
            mask = page['shadowmask'].image.convert('RGB').getchannel('R').resize(rgb.size) if 'shadowmask' in page else Image.new('L', rgb.size, 255)
            img = Image.merge('RGBA', (*rgb.split(), mask))
            entry = save_image(img, out_dir, f'lm{i}', sub, output)
        except Exception as e:
            log(f'  warn {stage_id}: lightmap {i}: {e}')
            if strict:
                raise RuntimeError(f'{stage_id}: lightmap {i} failed: {e}') from e
            continue
        manifest[sub][f'lm{i}'] = {**entry, 'kind': 'Lightmap'}
        lightmaps = max(lightmaps, i + 1)
        n += 1

    # albedo textures of the materials (shared by the scenes)
    tex_dir = Path(out_root) / TEX_SUB
    if output is None:
        tex_dir.mkdir(parents=True, exist_ok=True)
    for name, pptr in sorted(mat_tex.items()):
        try:
            tex = pptr.read()
            tname = re.sub(r'[^A-Za-z0-9_.\-\[\]]+', '_', tex.m_Name or f'tex_{pptr.m_PathID}')
            materials[name]['map'] = tname
            if tname in manifest.get(TEX_SUB, {}):
                old_entry = manifest[TEX_SUB][tname]
                rel = old_entry.get('path', '').removeprefix('/assets/local/') if isinstance(old_entry, dict) else ''
                candidate = Path(out_root) / rel
                if output is not None:
                    output._reject_linked_ancestors(candidate)
                staged_reuse = output is not None and candidate in output.pending
                disk_reuse = candidate.is_file() and not candidate.is_symlink()
                if (rel and not Path(rel).is_absolute() and '..' not in Path(rel).parts
                        and (staged_reuse or disk_reuse)):
                    continue
            entry = save_image(tex.image, tex_dir, tname, TEX_SUB, output)
            manifest.setdefault(TEX_SUB, {})[tname] = {**entry, 'kind': 'Texture2D'}
            n += 1
        except Exception as e:
            log(f'  warn {stage_id}: texture of {name}: {e}')
            if strict:
                raise RuntimeError(f'{stage_id}: texture unresolved for {name}: {e}') from e

    doc = {'version': SCENE_VERSION, 'stage': stage_id, 'bundle': scene_bundle(stage_id),
           'stageUnityVersion': stage_unity_version,
           'builtinSourceUnityVersion': builtin_provider['unityVersion'] if builtin_provider else None,
           'builtinNativePath': builtin_provider['path'] if builtin_provider else None,
           'builtinMeshesResolved': [builtin_meshes[k] for k in sorted(builtin_meshes)],
           'memoryBundles': memory_bundle_records,
           'light': light, 'lightmaps': lightmaps,
           'lightRange': LIGHT_RANGE, 'materials': dict(sorted(materials.items())), 'groups': sorted({rec['group'] for rec in records}),
           'chunks': records, 'binBytes': len(blob)}
    scene_json = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if output is None:
        (out_dir / 'scene.json').write_bytes(scene_json)
    else:
        output.stage(out_dir / 'scene.json', scene_json)
    manifest[sub]['scene'] = {'path': f'/assets/local/{sub}/scene.json', 'kind': 'Scene', 'chunks': len(records)}
    n += 1
    verts = sum(rec['verts'] for rec in records)
    log(f'{scene_path.name}: {len(records)} chunks, {verts} vertices, {lightmaps} lightmaps -> {sub}'
        + (f' ({skipped} sub-meshes without a material)' if skipped else '')
        + (f' ({dynamic_placeholders} dynamic placeholders skipped)' if dynamic_placeholders else ''))
    return n
