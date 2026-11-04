#!/usr/bin/env python3
"""Extract autochess art from a locally installed Arknights client (optional, host-side).

The official CN client ships Unity AssetBundles compressed with a custom LZ4 variant ("LZ4AK");
aklz4.py registers a decoder for it. This script pulls the art the web sources lack:
  - map_autochess / map_autochesssand textures (the real board tile atlas)
  - every Sprite of the three autochess UI bundles (HUD frames, badges, banners, icons)
  - the 6 in-match emoticon themes of 盟约 (activity_table autoChessData.enabledEmoticonThemeIdList; only the
    *_battle sprites, keyed by display_meta_table picId: emoticon/<dir>/<picId>.png, see data/emotes.json)
  - the autochess guidebook pages and battle projectile sprites
  (the emotes and the guidebook pages are on the public mirror too: tools/fetch-assets.mjs downloads them, and the
  client uses these local copies first — GitHub issue #42)
  - the enemy battle Spine models no community dump carries (ENEMY_SPINES: 灼热源石虫 / 炽焰源石虫), from the enemy art
    bundles (refs/arts/enm_art_*.ab) → spine/enemy/<enemyId>/<stem>.skel|.atlas + page PNGs with the [alpha] texture
    merged in (premultiplied RGB + A, the Ark-Models format; the atlas gets `size:` / `pma: true` like the fetched
    enemies); the client draws them instead of the web alias once this manifest lists them (data/assets.json
    enemies[id].spineLocal, docs/ASSETS.md "Enemy aliases")
  - the token (summon) battle Spine models no community dump carries (TOKEN_SPINES: most 自选 summons, 凯瑟琳's
    爬行号·防护单元, 凛御银灰's 风雪之眼), from the battle token prefabs (pkgrps/btl_pfb_tokens_*.ab: the skeleton
    the prefab's Front / only Spine renderer draws) → spine/token/<tokenId>/<stem>.skel|.atlas + merged page PNGs, the
    same format; drawn instead of the avatar diamond once this manifest lists them (data/assets.json
    tokens[id].spineLocal)
  - for the official 3D board (DESIGN §15): the map theme's Material parameters (map/<theme>/materials.json; shader
    names resolved through the shaders/*.ab bundles), the background / device meshes as Wavefront OBJ
    (mesh/<bundle>/<mesh>.obj; UnityPy's exporter, X mirrored into a right-handed frame) and their GameObject
    placement (mesh/<bundle>/prefab.json); of the 卫戍协议 device bundle (arts/maps/common/trap/trap_110.ab) only the
    射击台 (trap_1106_achplat) and 阻隔工事 (trap_1105_accrate): mesh, texture, material → mesh/trap_110, which the
    board draws in place of the 射击台's slab and of the crate's box (GitHub #663)
  - the standard gate / objective effects of every battle map (arts/effects/[pack]map.ab → map/fx: the [opt]start_box /
    [opt]end_box / [opt]start_fly meshes, their merged additive textures, materials and prefab), the blower's texture
    (arts/maps/common/res.ab → map/common: TX_wind_device of the s_wind_device mesh) and the shared water / noise
    textures (arts/maps/effect.ab → map/water) used for deep-sea / mire / smog tiles
  - derived PBR maps for three.js (DERIVED): Unity stores the theme's normal map as two channels (BC5: RG = XY, B = 0;
    DXT5nm in an older bundle: AG = XY, R = 1) and metallic/gloss with the smoothness in A; the board renderer needs
    an RGB normal map (Z rebuilt) and a roughness map in G (1 − smoothness; metalness B = 0), written next to the
    source as <name>_rgb.png / _rough.png
  - WebP copies of the board textures every player downloads with the 3D board (WEBP), written next to their PNGs;
    the manifest lists the copy
  - the official battlefield scenes (scenes.py SCENES: one prebuilt scene per 卫戍协议 battlefield) → scene/<stageId>/
    scene.json + scene.bin + lightmap pages and scene/tex/ (the materials' albedo textures). The scene bundles ship
    only while the season runs: they are read from the client when it has them, else from --scenes <dir> (default
    .cache/official-scenes/*, filled by tools/local-extract/fetch_scenes.py)

Usage:
  python3 -m venv .venv && .venv/bin/pip install -r tools/local-extract/requirements.txt
  .venv/bin/python tools/local-extract/extract.py [--game <AB root>] [--out public/assets/local] [--only <subdir prefix>]
  python3 tools/local-extract/extract.py --print-jobs     (the job table as JSON; needs no dependencies)
  python3 tools/local-extract/extract.py --webp           (only the WebP copies, from the PNGs already extracted —
                                                          e.g. the local art copied from a release bundle; needs Pillow)
  .venv/bin/python tools/local-extract/extract.py --only scene [--scenes <dir of in-season bundles>]

Writes <out>/**.png|.webp|.skel|.atlas and data/local-assets.json (manifest of what was extracted). With --only, just
the jobs whose output subdir starts with one of the prefixes run, and their groups replace those of the existing
manifest (every other group is kept as is).
Everything is (c) Hypergryph; for private, non-commercial fan use only.
"""
import argparse
import json
import os
import re
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scenes  # noqa: E402  (the battlefield scene table and exporter; imports UnityPy only when it runs)
import scene_output  # noqa: E402
import fetch_scenes  # noqa: E402  (native manifest and in-memory UnityFS validation)

ROOT = Path(__file__).resolve().parents[2]
HOME = Path.home()
MAX_SCENE_MEMORY_BYTES = 24 * 1024 * 1024
MAP_SCENE_PREVIEW_MEMORY_BYTES = 40 * 1024 * 1024
CANDIDATES = [
    HOME / 'Library/Application Support/CrossOver/Bottles/Arknights/drive_c/Program Files/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows',
    HOME / 'Library/Containers/com.hypergryph.arknights/Data/Documents/Bundles',
    # native Windows installs of the official launcher (default and x86 locations)
    Path('C:/Program Files/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows'),
    Path('C:/Program Files (x86)/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows'),
]

# In-match emote themes (display_meta_table emoticonData, scene AUTOCHESS_BATTLE), in the order of
# activity_table autoChessData.enabledEmoticonThemeIdList: (themeId, output dir under emoticon/). The dirs are the
# ones of shared/constants.js EMOTE_THEMES / data/emotes.json. Only the *_battle sprites are exported: the bundles also
# hold room / pick pics of other modes (and the autochess room pics are not in the local client at all).
EMOTE_THEMES = [
    ('emoticon_autochess_basic', 'basic'),
    ('emoticon_originium_slug', 'slug'),
    ('emoticon_autochess_basic_2', 'basic_2'),
    ('emoticon_foolsday_doctor', 'fooldoctor'),
    ('emoticon_foolsday_amiya', 'foolamiya'),
    ('emoticon_foolsday_wisdel', 'foolwisdel'),
]
BATTLE_EMOTE = r'^pic_.+_battle$'

# Meshes of the official board scene (DESIGN §15): (bundle, output name under mesh/).
MESH_BUNDLES = [
    ('arts/maps/map_autochess/bkg_mesh.ab', 'map_autochess_bkg'),
    ('arts/maps/common/meshes/s_background_common.ab', 's_background_common'),
    ('arts/maps/common/meshes/s_common_box_01.ab', 's_common_box_01'),
    ('arts/maps/common/meshes/s_wind_device.ab', 's_wind_device'),
]

# (bundle path relative to the AB root, output subdir, which object types to export[, name regex to keep])
JOBS = [
    ('arts/maps/map_autochess/res.ab', 'map/autochess', {'Texture2D', 'Material'}),
    ('arts/maps/map_autochesssand/res.ab', 'map/autochesssand', {'Texture2D', 'Material'}),
    ('ui/autochess/[uc]autochesscommon.ab', 'ui/common', {'Sprite'}),
    ('ui/autochess/[uc]autochessbattle.ab', 'ui/battle', {'Sprite', 'TextAsset'}),
    ('ui/autochess/[uc]autochessouter.ab', 'ui/outer', {'Sprite'}),
    *[(f'ui/emoticon/theme/[uc]{theme}.ab', f'emoticon/{sub}', {'Sprite'}, BATTLE_EMOTE) for theme, sub in EMOTE_THEMES],
    ('arts/guidebookpages/[pack]autochess.ab', 'guide', {'Sprite', 'Texture2D'}),
    ('battle/prefabs/[uc]projectiles.ab', 'projectiles', {'Sprite', 'Texture2D'}),
    # official module (uniequip) type icons, keyed by lower-case type name (e.g. 'mar-x')
    ('spritepack/ui_equip_type_hub_h2_0.ab', 'module', {'Sprite'}),
    *[(rel, f'mesh/{sub}', {'Mesh', 'GameObject', 'Material', 'Texture2D'}) for rel, sub in MESH_BUNDLES],
    # the official 射击台 model (GitHub round 40: 战场#03's raised tiles by the blue gate were our flat grey slab): the
    # bundle holds every 卫戍协议 device model; keep 射击台 and 阻隔工事 (trap_1105_accrate, #663)
    ('arts/maps/common/trap/trap_110.ab', 'mesh/trap_110', {'Mesh', 'GameObject', 'Material', 'Texture2D'},
     r'^((MT|TX)_)?(trap_1106_achplat|trap_1105_accrate)$'),
    ('arts/effects/[pack]map.ab', 'map/fx', {'Mesh', 'GameObject', 'Material', 'Texture2D'}),
    ('arts/maps/common/res.ab', 'map/common', {'Material', 'Texture2D'}, r'^(TX|MT)_wind_device$'),
    ('arts/maps/effect.ab', 'map/water', {'Texture2D'}, r'water_normal|Caustics|WaterNoise|noise_clouds|Water_Foam|SmoothWaves'),
]

# Enemy battle Spine models that no community dump carries (isHarryh/Ark-Models lists them with an empty assetList, so
# tools/fetch-assets.mjs aliases them to another enemy's skeleton — the web model): every enemy of data/enemies.json whose
# official battle prefab draws a skeleton of its own that is missing upstream (audited against the client's prefabs, user
# feedback after 0.1.0 report D3: 灼热源石虫 / 炽焰源石虫 — the ELEMENT faction's slugs — were drawn as the plain 源石虫).
# Read from the enemy art bundles: Assets/Torappu/Arts/Enemies/Spines/<…>/<id>_SkeletonData.asset → its skeleton
# TextAsset, the atlas TextAsset of its atlas asset and every page texture of the atlas materials (_MainTex, with its
# _AlphaTex merged in as A). Output: spine/enemy/<id>/ (manifest group spine/enemy/<id>); the client draws the model
# when the group lists every file of data/assets.json enemies[id].spineLocal (whose metadata
# tools/assets/local-enemy-spines.json keeps: `node tools/fetch-assets.mjs --local-spines` after a game update).
ENEMY_SPINES = ['enemy_1305_mhslim', 'enemy_1305_mhslim_2']
ENEMY_ART = 'refs/arts/enm_art_*.ab'
ENEMY_SPINE_SUB = 'spine/enemy'

# Token (summon) battle Spine models that no community dump carries: fexli/ArknightsResource has most of the 自选
# summons (data/backups.json `tokens`) only as skin variants or not at all, so tools/fetch-assets.mjs reports "missing
# skel" for them and the client drew the avatar diamond. Every token of data/tokens.json and data/backups.json whose
# battle prefab draws a Spine model and that has no web model (audited 2026-10-06 against both local installs). Read from
# the battle token packs (dyn/battle/prefabs/[uc]tokens/<id>.prefab): the SkeletonDataAsset of the prefab's Spine
# renderer — of a directional token (FaceSwitcher with Front / Back / Down renderers, each its own skeleton under the
# same name) the Front one, the model the fetched tokens use too (plan.mjs: Spine/ or Front/) — with its skeleton,
# atlas and page textures as in ENEMY_SPINES. The Windows build carries every one (pkgrps/btl_pfb_tokens_0/4/5.ab; the
# iOS build lacks btl_pfb_tokens_0, and its pages are ASTC rather than BC7). Output: spine/token/<id>/ (manifest group
# spine/token/<id>); the client draws the model when the group lists every file of data/assets.json
# tokens[id].spineLocal (metadata in tools/assets/local-token-spines.json, `node tools/fetch-assets.mjs --local-spines`).
# Not here: the tokens whose prefab draws nothing (an EmptyAnimator in place of the Spine renderer, displayType HIDDEN
# or an effect only, and no avatar in either install's asset index) — 乌尔比安's 从不混淆的方向, 圣聆初雪's frozen
# protection point, 酒神's 迷狂牢笼, 贝洛内's 牵绊, 予愿安洁莉娜's “一会儿见！” (token_10039 / 10058 / 10055 / 10065 / 10071).
TOKEN_SPINES = [
    'token_10002_kalts_mon3tr', 'token_10003_cgbird_bird', 'token_10005_mgllan_drone1', 'token_10005_mgllan_drone2',
    'token_10005_mgllan_drone3', 'token_10007_phatom_twin', 'token_10008_cqbw_box', 'token_10009_weedy_cannon',
    'token_10020_ling_soul1', 'token_10020_ling_soul2', 'token_10020_ling_soul3', 'token_10024_ebnhlz_rcube',
    'token_10025_doroth_recttp', 'token_10026_bgsnow_subbow', 'token_10027_ironmn_pile1', 'token_10027_ironmn_pile2',
    'token_10027_ironmn_pile3', 'token_10029_slent2_protrb', 'token_10031_swire2_gdtrap', 'token_10032_jesca2_jckshd', 'token_10034_ray_sndbst',
    'token_10035_wisdel_wward', 'token_10041_cathy_catsld', 'token_10043_necras_skeltn', 'token_10050_monstr_prosts',
    'token_10051_radian_tower1', 'token_10052_radian_tower2', 'token_10053_radian_tower3', 'token_10054_phatm2_encdool',
    'token_10057_svash2_eagle1', 'token_10057_svash2_eagle2', 'token_10057_svash2_eagle3', 'token_10059_nasti_nstdef',
    'token_10060_nasti_nstchr', 'token_10061_nasti_nstbld', 'token_10064_wang_stone1', 'token_10066_closur_ourbase', 'token_10067_toledo_tldptm',
    'token_10068_kalts2_mtship', 'token_10069_mcnist_mcgraf', 'token_10070_aphris_pc',
]
TOKEN_PACKS = 'pkgrps/btl_pfb_tokens_*.ab'
TOKEN_SPINE_SUB = 'spine/token'

# Derived three.js maps: (output subdir, source texture, kind, output name). 'normal_rg' rebuilds Z of a two-channel
# (BC5 or DXT5nm) normal map into an RGB tangent-space map; 'rough_from_gloss' turns Unity's metallic/gloss map
# (smoothness in A) into a roughness (G) / metalness (B) map. Written after the job that exported the source texture.
DERIVED = [
    ('map/autochess', 'TX_autochessi_N', 'normal_rg', 'TX_autochessi_N_rgb'),
    ('map/autochess', 'TX_autochessi_M', 'rough_from_gloss', 'TX_autochessi_M_rough'),
]

# The board textures every player downloads when a match shows the 3D board (public/js/render/board3d/load.js
# PACK_IMAGES; D / common_D / BG also feed the 2D board art, render/boardArt.js): (output subdir, name, mode). A WebP
# copy is written next to the PNG and the manifest lists the copy instead (≈ 6.7 MB → 2.0 MB per cold start); the PNG
# stays for tools/crop-board-atlas.mjs and setup's check. 'lossy' = colour maps at quality 95 with the alpha lossless
# and the RGB under transparent texels kept (`exact`: the board material is opaque and samples it); 'lossless' =
# normal and data maps, whose channels hold independent values that lossy WebP's chroma subsampling would mix (a
# normal map ends up tens of degrees off). A Pillow without WebP support keeps the PNG.
WEBP = [
    ('map/autochess', 'TX_autochessi_D', 'lossy'),
    ('map/autochess', 'TX_autochessi_BG', 'lossy'),
    ('map/autochess', 'TX_autochessi_common_D', 'lossy'),
    ('map/autochess', 'TX_autochessi_N_rgb', 'lossless'),
    ('map/autochess', 'TX_autochessi_M_rough', 'lossless'),
    ('map/autochess', 'TX_autochessi_E', 'lossless'),
    ('map/autochess', 'TX_autochessi_common_E', 'lossless'),
    ('map/common', 'TX_wind_device', 'lossy'),
    ('map/fx', '[opt]merged_textures', 'lossless'),
    ('map/water', '[ucp]TX_water_normal', 'lossless'),
    ('map/water', 'TX_Caustics256', 'lossy'),
    ('map/water', 'T_noise_clouds_01', 'lossless'),
    ('mesh/trap_110', 'TX_trap_1106_achplat', 'lossy'),
    ('mesh/trap_110', 'TX_trap_1105_accrate', 'lossy'),
]
WEBP_OPTIONS = {
    'lossy': {'quality': 95, 'method': 6, 'alpha_quality': 100, 'exact': True},
    'lossless': {'lossless': True, 'quality': 100, 'method': 6, 'exact': True},
}

# Shader bundles loaded beside every job that exports Materials, only so that the materials' shader references
# (external CABs) resolve to a name in materials.json (e.g. Torappu/Scene/StandardDirectional); nothing is exported
# from them.
SHADER_DEPS = 'shaders/*.ab'
# the root shader bundle ([uc]shaders.ab) holds the Torappu particle shaders of the map effects (map/fx)
SHADER_DEPS_ROOT = '[uc]shaders.ab'

SAFE = re.compile(r'[^A-Za-z0-9_.\-\[\]]+')


def safe_name(name):
    name = SAFE.sub('_', name).strip('._') or 'unnamed'
    return name[:120]


def job_parts(job):
    """(rel, sub, kinds, keep) of a JOBS entry; keep is a compiled name filter or None."""
    rel, sub, kinds = job[:3]
    keep = re.compile(job[3]) if len(job) > 3 and job[3] else None
    return rel, sub, kinds, keep


def wants_sub(only, sub):
    """Whether output subdir `sub` runs under --only: no prefixes, or one prefix is `sub`, a parent of it or below it."""
    if not only:
        return True
    return any(sub == p.rstrip('/') or sub.startswith(p.rstrip('/') + '/') or p.rstrip('/').startswith(sub + '/')
               for p in only)


def select_jobs(only):
    """The jobs whose output subdir starts with one of the `only` prefixes (all jobs when `only` is empty)."""
    if not only:
        return list(JOBS)
    return [j for j in JOBS if any(j[1] == p.rstrip('/') or j[1].startswith(p.rstrip('/') + '/') for p in only)]


def enemy_spine_id(container, wanted):
    """The enemy id of an enemy SkeletonData container path (Assets/Torappu/Arts/Enemies/Spines/<dir>[/<n>]/<id>_
    SkeletonData.asset) when it is one of `wanted`, else None."""
    m = re.search(r'/Enemies/Spines/(?:[^/]+/)+([^/]+)_SkeletonData\.asset$', container or '', re.I)
    return m.group(1) if m and m.group(1) in wanted else None


def token_prefab_id(container, wanted):
    """The token id of a battle token prefab container path (dyn/battle/prefabs/[uc]tokens/<id>.prefab) when it is one
    of `wanted`, else None (a skin's prefab lives under battle/prefabs/skins/character/…)."""
    m = re.search(r'(?:^|/)battle/prefabs/(?:\[uc\])?tokens/([^/]+)\.prefab$', container or '', re.I)
    return m.group(1) if m and m.group(1) in wanted else None


def spine_ids(only, sub, ids):
    """The ids of a Spine model list (ENEMY_SPINES / TOKEN_SPINES, written to `<sub>/<id>`) that run under --only: all of
    them with no prefix, `sub` or a parent of it; else those whose output dir is a prefix or below one."""
    if not wants_sub(only, sub):
        return []
    if not only or any(sub == p.rstrip('/') or sub.startswith(p.rstrip('/') + '/') for p in only):
        return list(ids)
    return [i for i in ids if any(f'{sub}/{i}' == p.rstrip('/') or f'{sub}/{i}'.startswith(p.rstrip('/') + '/')
                                  for p in only)]


def prefab_spine_nodes(root, objects):
    """The Spine renderers of a prefab, depth first: [(GameObject name, active, skeletonDataAsset PPtr)] for every
    MonoBehaviour holding a `skeletonDataAsset` (Spine's SkeletonAnimation). `root` is the root GameObject's type tree,
    `objects` the bundle's {path id: object}; references into other bundles are skipped."""
    out = []

    def local(pptr):
        return objects.get(pptr.get('m_PathID')) if pptr and not pptr.get('m_FileID') else None

    def walk(go, active, depth):
        tr, refs = None, []
        for c in go.get('m_Component') or []:
            o = local(c.get('component'))
            if o is None:
                continue
            try:
                if o.type.name == 'Transform':
                    tr = o.read_typetree()
                elif o.type.name == 'MonoBehaviour':
                    sda = o.read_typetree().get('skeletonDataAsset')
                    if sda and sda.get('m_PathID'):
                        refs.append(sda)
            except Exception:  # a script without a readable type tree is no Spine renderer we could use
                continue
        active = active and bool(go.get('m_IsActive', 1))
        out.extend((go.get('m_Name') or '', active, ref) for ref in refs)
        if tr is None or depth >= 12:
            return
        for ch in tr.get('m_Children') or []:
            t = local(ch)
            g = local(t.read_typetree().get('m_GameObject')) if t is not None else None
            if g is not None:
                walk(g.read_typetree(), active, depth + 1)

    walk(root, True, 0)
    return out


def pick_spine_node(nodes):
    """The renderer the remake draws among prefab_spine_nodes: of a directional token (a FaceSwitcher with Front / Back /
    Down renderers) the Front one, else one named Spine, else the first — active renderers first; None when empty."""
    live = [n for n in nodes if n[1]] or list(nodes)
    for want in ('Front', 'Spine'):
        hit = next((n for n in live if n[0] == want), None)
        if hit:
            return hit
    return live[0] if live else None


def _num(v, nd=6):
    """JSON-safe rounded float (NaN / inf → 0)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return round(f, nd) + 0.0 if f == f and abs(f) != float('inf') else 0  # + 0.0: no '-0.0'


def vec(v, keys='xyz'):
    """[x, y, z(, w)] of a UnityPy vector / quaternion (missing components → 0)."""
    return [_num(getattr(v, k, 0)) for k in keys]


def _pptr_name(pptr, strict=False, field='PPtr', source_context=None):
    """Name of the object a PPtr points to, or None (null pointer or an unloaded external bundle)."""
    if not getattr(pptr, 'm_PathID', 0):
        # Unity Materials routinely carry empty optional texture slots.  The
        # required shader reference has its own explicit strict null check in
        # material_info; keep optional texture PPtrs nullable here.
        return None
    data, reference = scenes.resolve_pointer_with_evidence(pptr, field)
    name = (getattr(data, 'm_Name', None) or None) if data is not None else None
    if strict and (data is None or not name):
        context = f'; source={json.dumps(source_context, ensure_ascii=False, sort_keys=True)}' if source_context else ''
        raise RuntimeError(f'{field}: object #{pptr.m_PathID} unresolved; PPtr={json.dumps(reference, ensure_ascii=False, sort_keys=True)}{context}')
    return name


def material_info(mat, strict=False, source_context=None):
    """JSON summary of a Material: shader, keywords, textures (by name, with tiling), floats and colours."""
    shader = None
    try:
        if strict and not getattr(mat.m_Shader, 'm_PathID', 0):
            raise RuntimeError('null shader reference')
        sh, shader_ref = scenes.resolve_pointer_with_evidence(mat.m_Shader, 'Material.m_Shader')
        if sh is None:
            raise RuntimeError(f'PPtr={json.dumps(shader_ref, ensure_ascii=False, sort_keys=True)}')
        shader = getattr(getattr(sh, 'm_ParsedForm', None), 'm_Name', None) or getattr(sh, 'm_Name', None)
        if strict and not shader:
            raise RuntimeError('shader bundle loaded but shader name is unknown')
    except Exception as e:
        if strict:
            raise RuntimeError(f'material shader unresolved: {e}') from e
        shader = None
    props = getattr(mat, 'm_SavedProperties', None)
    textures, floats, colors = {}, {}, {}
    for k, env in (getattr(props, 'm_TexEnvs', None) or []):
        field = f'Material.m_SavedProperties.m_TexEnvs[{k}].m_Texture'
        name = _pptr_name(env.m_Texture, strict=strict, field=field, source_context=source_context)
        if name:
            textures[k] = {'texture': name, 'scale': vec(env.m_Scale, 'xy'), 'offset': vec(env.m_Offset, 'xy')}
    for k, v in (getattr(props, 'm_Floats', None) or []):
        floats[k] = _num(v)
    for k, c in (getattr(props, 'm_Colors', None) or []):
        colors[k] = vec(c, 'rgba')
    kw = getattr(mat, 'm_ValidKeywords', None) or getattr(mat, 'm_ShaderKeywords', None) or []
    if isinstance(kw, str):
        kw = kw.split()
    return {'shader': shader, 'keywords': sorted(kw), 'textures': dict(sorted(textures.items())),
            'floats': dict(sorted(floats.items())), 'colors': dict(sorted(colors.items()))}


def prefab_node(go, mesh_keys=None):
    """JSON summary of a GameObject: local transform (Unity space), parent, mesh and material names. `mesh_keys`
    ({mesh path id: manifest key}) names the exported OBJ when two meshes of a bundle share a name."""
    node = {'name': getattr(go, 'm_Name', '') or '', 'parent': None, 'pos': [0, 0, 0], 'rot': [0, 0, 0, 1],
            'scale': [1, 1, 1], 'mesh': None, 'materials': []}
    for c in getattr(go, 'm_Component', None) or []:
        pptr = getattr(c, 'component', c)
        try:
            comp = pptr.read()
        except Exception:
            continue
        kind = type(comp).__name__
        if kind in ('Transform', 'RectTransform'):
            node['pos'] = vec(comp.m_LocalPosition)
            node['rot'] = vec(comp.m_LocalRotation, 'xyzw')
            node['scale'] = vec(comp.m_LocalScale)
            try:
                father = comp.m_Father.read() if getattr(comp.m_Father, 'm_PathID', 0) else None
                node['parent'] = father.m_GameObject.read().m_Name if father else None
            except Exception:
                node['parent'] = None
        elif kind == 'MeshFilter':
            node['mesh'] = _pptr_name(comp.m_Mesh)
            pid = getattr(comp.m_Mesh, 'm_PathID', 0)
            if mesh_keys and pid in mesh_keys and not getattr(comp.m_Mesh, 'm_FileID', 0):
                node['mesh'] = mesh_keys[pid]
        elif kind in ('MeshRenderer', 'SkinnedMeshRenderer'):
            node['materials'] = [_pptr_name(m) for m in getattr(comp, 'm_Materials', None) or []]
    return node


def dep_bundles(ab_root, kinds):
    """Bundles to load next to a job so its references resolve: the shader bundles when it exports Materials."""
    if 'Material' not in kinds:
        return []
    root = Path(ab_root)
    extra = [root / SHADER_DEPS_ROOT] if (root / SHADER_DEPS_ROOT).is_file() else []
    return sorted(p for p in root.glob(SHADER_DEPS) if p.is_file()) + extra


_NORMAL_Z = None


def _normal_z_table():
    """Z byte of a unit normal for every (x byte, y byte) pair: 128 + 127·sqrt(max(0, 1 − x² − y²))."""
    global _NORMAL_Z
    if _NORMAL_Z is None:
        t = bytearray(65536)
        for xb in range(256):
            x = xb / 127.5 - 1.0
            for yb in range(256):
                y = yb / 127.5 - 1.0
                z = max(0.0, 1.0 - x * x - y * y) ** 0.5
                t[(xb << 8) | yb] = min(255, int(round(127.5 + 127.5 * z)))
        _NORMAL_Z = bytes(t)
    return _NORMAL_Z


def derive_normal_rg(img):
    """RGB tangent-space normal map from Unity's two-channel one: Z rebuilt per pixel. X and Y are read the way Unity's
    shaders unpack them (UnityCG.cginc UnpackNormalmapRGorAG: x = R · A, y = G), which covers both layouts a client
    build holds: BC5 (R = X, G = Y, B unused, no alpha → A = 1) and DXT5nm (R = 1, G = Y, A = X — the map_autochess
    bundle before the client update of 2026-10)."""
    from PIL import Image, ImageChops
    r, g, _, a = img.convert('RGBA').split()
    x = ImageChops.multiply(r, a)  # exact when either factor is 255
    table = _normal_z_table()
    z = bytes(table[(xb << 8) | yb] for xb, yb in zip(x.tobytes(), g.tobytes()))
    return Image.merge('RGB', (x, g, Image.frombytes('L', img.size, z)))


def derive_rough_from_gloss(img):
    """three.js roughness / metalness map (G = 1 − smoothness from Unity's A, B = metalness 0, R = 1) from a
    Unity metallic/gloss map."""
    from PIL import Image
    rgba = img.convert('RGBA')
    rough = rgba.getchannel('A').point(lambda v: 255 - v)
    return Image.merge('RGB', (Image.new('L', rgba.size, 255), rough, Image.new('L', rgba.size, 0)))


DERIVERS = {'normal_rg': derive_normal_rg, 'rough_from_gloss': derive_rough_from_gloss}


def run_derived(out_root, sub, manifest, log):
    """Write the DERIVED maps of output subdir `sub` (from its exported PNGs) and record them in the manifest."""
    from PIL import Image
    n = 0
    for dsub, src, kind, name in DERIVED:
        if dsub != sub:
            continue
        path = Path(out_root) / sub / f'{src}.png'
        if not path.exists():
            log(f'  derived {name}: source {src} missing')
            continue
        try:
            img = DERIVERS[kind](Image.open(path))
            img.save(Path(out_root) / sub / f'{name}.png')
        except Exception as e:  # a broken source only drops the derived map (the renderer falls back)
            log(f'  warn derived {name}: {e}')
            continue
        manifest.setdefault(sub, {})[name] = {'path': f'/assets/local/{sub}/{name}.png', 'w': img.width, 'h': img.height,
                                              'kind': 'Derived', 'from': src, 'derive': kind}
        n += 1
    return n


def run_webp(out_root, sub, manifest, log):
    """Write the WEBP copies of output subdir `sub` from its PNGs and point their manifest entries at them."""
    n = 0
    for wsub, name, mode in WEBP:
        entry = manifest.get(sub, {}).get(name) if wsub == sub else None
        png = Path(out_root) / sub / f'{name}.png'
        if not entry or not png.exists():
            continue
        dst = png.with_name(f'{name}.webp')
        try:
            from PIL import Image
            with Image.open(png) as img:
                img.save(dst, 'WEBP', **WEBP_OPTIONS[mode])
        except Exception as e:  # no WebP support in this Pillow, or a broken PNG: the entry keeps the PNG
            log(f'  warn webp {name}: {e}')
            continue
        entry.update(path=f'/assets/local/{sub}/{dst.name}', webp=mode)
        n += 1
    return n


def webp_only(out_root, manifest_path, log):
    """--webp: the WEBP copies of an existing extraction (e.g. the local art copied from a release bundle)."""
    try:
        doc = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'No readable manifest at {manifest_path} ({e}). Extract the local art first.', file=sys.stderr)
        return 2
    groups = doc.get('groups') if isinstance(doc, dict) else None
    if not isinstance(groups, dict):
        print(f'{manifest_path} has no groups. Extract the local art first.', file=sys.stderr)
        return 2
    n = sum(run_webp(out_root, sub, groups, log) for sub in dict.fromkeys(s for s, _, _ in WEBP))
    Path(manifest_path).write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    log(f'done: {n} WebP copies, manifest {manifest_path}')
    return 0 if n else 1


def merge_manifest(old_groups, new_groups, ran_subs):
    """Groups of the previous manifest minus the subdirs that were re-extracted, plus the new ones (sorted keys)."""
    out = {g: v for g, v in (old_groups or {}).items() if g not in ran_subs}
    out.update(new_groups)
    return {g: dict(sorted(out[g].items())) for g in sorted(out)}


def export_bundle(ab_root, job, out_root, manifest, log):
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    rel, sub, kinds, keep = job_parts(job)
    src = ab_root / rel
    if not src.exists():
        log(f'skip (missing) {rel}')
        return 0
    try:
        env = UnityPy.load(str(src))
    except Exception as e:  # corrupt or unsupported bundle: report and continue
        log(f'FAIL load {rel}: {e}')
        return 0
    objects = list(env.objects)  # the job's own objects, listed before any dependency joins the environment
    for dep in dep_bundles(ab_root, kinds):
        try:
            env.load_file(str(dep))
        except Exception as e:  # a missing shader only leaves that material's shader name null
            log(f'  warn dependency {dep.name}: {e}')
    out_dir = out_root / sub
    out_dir.mkdir(parents=True, exist_ok=True)
    seen, n = set(), 0
    materials, prefab, gos, mesh_keys = {}, [], [], {}
    for obj in objects:
        t = obj.type.name
        if t not in kinds:
            continue
        try:
            data = obj.read()
            raw_name = getattr(data, 'm_Name', '') or ''
            if keep is not None and not keep.search(raw_name):
                continue
            name = safe_name(raw_name or f'obj_{obj.path_id}')
            if t in ('Sprite', 'Texture2D'):
                img = data.image
                if img is None or img.width < 2 or img.height < 2:
                    continue
                fname = name + '.png'
                if fname in seen:  # same name twice: a Sprite (true aspect) beats its padded Texture2D
                    if t == 'Texture2D' or manifest.get(sub, {}).get(name, {}).get('kind') == 'Sprite':
                        continue
                img.save(out_dir / fname)
                seen.add(fname)
                manifest.setdefault(sub, {})[name] = {
                    'path': f'/assets/local/{sub}/{fname}', 'w': img.width, 'h': img.height, 'kind': t}
                n += 1
            elif t == 'TextAsset':
                raw = data.m_Script
                blob = raw.encode('utf-8', 'surrogateescape') if isinstance(raw, str) else bytes(raw)
                if name.endswith('.atlas') or name.endswith('.skel'):
                    fname = name
                elif blob[:1] in (b'\n', b'') or b'size:' in blob[:200]:
                    fname = name + '.atlas'
                else:
                    fname = name + '.skel'
                (out_dir / fname).write_bytes(blob)
                manifest.setdefault(sub, {})[fname] = {'path': f'/assets/local/{sub}/{fname}', 'kind': t}
                n += 1
            elif t == 'Mesh':
                text = data.export()
                if not text or 'v ' not in text:
                    continue
                fname = name + '.obj'
                if fname in seen:
                    name, fname = f'{name}_{obj.path_id}', f'{name}_{obj.path_id}.obj'
                (out_dir / fname).write_text(text, encoding='utf-8')
                seen.add(fname)
                verts = sum(1 for line in text.splitlines() if line.startswith('v '))
                manifest.setdefault(sub, {})[name] = {'path': f'/assets/local/{sub}/{fname}', 'kind': 'Mesh', 'verts': verts}
                mesh_keys[obj.path_id] = name
                n += 1
            elif t == 'Material':
                materials[raw_name or name] = material_info(data)
            elif t == 'GameObject':
                gos.append(data)  # summarised after every mesh got its manifest key
        except Exception as e:
            log(f'  warn {rel} #{obj.path_id}: {e}')
    for go in gos:
        try:
            prefab.append(prefab_node(go, mesh_keys))
        except Exception as e:
            log(f'  warn {rel} GameObject: {e}')
    for key, fname, payload in (('materials', 'materials.json', materials), ('prefab', 'prefab.json', prefab)):
        if not payload:
            continue
        if isinstance(payload, list):
            payload = sorted(payload, key=lambda nd: (nd['parent'] or '', nd['name']))
        else:
            payload = dict(sorted(payload.items()))
        (out_dir / fname).write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        manifest.setdefault(sub, {})[key] = {'path': f'/assets/local/{sub}/{fname}', 'kind': key.capitalize(), 'count': len(payload)}
        n += 1
    n += run_derived(out_root, sub, manifest, log)
    log(f'{rel}: {n} files -> {sub}')
    k = run_webp(out_root, sub, manifest, log)
    if k:
        log(f'  {k} WebP copies -> {sub}')
    return n


def _text_bytes(text_asset):
    raw = text_asset.m_Script
    return raw.encode('utf-8', 'surrogateescape') if isinstance(raw, str) else bytes(raw)


def merge_alpha(rgb, alpha, straight=False):
    """Premultiplied RGBA page of a Spine atlas texture: RGB of the main texture and A from its [alpha] texture (the
    split pages: _UseAlphaTex 1), else the main texture's own alpha (the newer RGBA pages: _UseAlphaTex 0); RGB is
    clamped to A (block-compression bleed) — the client's Spine material reads premultiplied input
    (_StraightAlphaInput 0) — or, for a material with _StraightAlphaInput 1 (`straight`), multiplied by A."""
    from PIL import Image, ImageChops
    r, g, b = rgb.convert('RGB').split()
    if alpha is not None:
        a = alpha.convert('L').resize(rgb.size)
    elif rgb.mode in ('RGBA', 'LA', 'PA') or 'transparency' in rgb.info:
        a = rgb.convert('RGBA').getchannel('A')
    else:
        a = Image.new('L', rgb.size, 255)
    op = ImageChops.multiply if straight else ImageChops.darker
    return Image.merge('RGBA', tuple(op(ch, a) for ch in (r, g, b)) + (a,))


def _is_page_line(lines, i):
    """Whether line i of a Spine atlas starts a page: a page name is an unindented line without ':' that comes first
    or after a blank line (a region name follows its page's or the previous region's fields)."""
    line = lines[i]
    return bool(line.strip()) and ':' not in line and not line[:1].isspace() and (i == 0 or not lines[i - 1].strip())


def atlas_pages(text):
    """The page names (image files) of a Spine atlas text, in order."""
    lines = text.replace('\r\n', '\n').replace('\r', '\n').lstrip('\ufeff').split('\n')
    return [lines[i].strip() for i in range(len(lines)) if _is_page_line(lines, i)]


def normalize_atlas(text, sizes):
    """Spine atlas text with every page header carrying its real `size: w,h` (`sizes`: page name → (w, h)) and
    `pma: true` (the pages are premultiplied: merge_alpha) — what tools/assets/atlas.mjs normalizeAtlas gives the fetched
    enemy atlases, so the client loads the extracted model as it is. Page fields are the unindented `key: value` lines
    right after a page name (a line after a blank line, or the first line); everything else is kept."""
    lines = text.replace('\r\n', '\n').replace('\r', '\n').lstrip('\ufeff').split('\n')
    out, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]
        if not _is_page_line(lines, i):
            out.append(line)
            i += 1
            continue
        name = line.strip()
        fields, j = [], i + 1
        while j < n and lines[j].strip() and not lines[j][:1].isspace() and ':' in lines[j]:
            fields.append(lines[j])
            j += 1
        keys = [f.split(':', 1)[0].strip() for f in fields]
        size = sizes.get(name)
        if size:
            sz = f'size: {size[0]},{size[1]}'
            if 'size' in keys:
                fields[keys.index('size')] = sz
            else:
                fields.insert(0, sz)
        if 'pma' not in keys:
            fields.append('pma: true')
        out.append(line)
        out.extend(fields)
        i = j
    return '\n'.join(out)


def write_spine(objects, sda, sub, name, out_root, manifest, log):
    """Write one Spine model of a SkeletonDataAsset type tree — its skeleton TextAsset, its atlas TextAsset(s) (sized,
    `pma: true`: normalize_atlas) and the page textures of the atlas materials (_MainTex with its _AlphaTex merged in,
    merge_alpha) — to <out_root>/<sub>/ as <stem>.skel, <stem>.atlas (one stem: pixi-spine finds the atlas by the
    skeleton's name) and <page>.png, and list them in the manifest group `sub`. Returns the file count; 0 when a part
    is missing or the textures do not match the atlas pages (nothing is written then). `name` labels the log lines and
    names a skeleton without a name."""
    get = lambda pptr: objects.get(pptr['m_PathID']) if pptr and not pptr.get('m_FileID') else None  # noqa: E731
    skel = get(sda.get('skeletonJSON'))
    if skel is None:
        log(f'  warn {name}: skeleton TextAsset not in this bundle')
        return 0
    ta = skel.read()
    stem = safe_name(getattr(ta, 'm_Name', '') or name).removesuffix('.skel')
    texts, pages = [], {}
    for aref in sda.get('atlasAssets') or []:
        aa = get(aref)
        if aa is None:
            continue
        at = aa.read_typetree()
        af = get(at.get('atlasFile'))
        if af is not None:
            texts.append(_text_bytes(af.read()).decode('utf-8', 'replace'))
        for mref in at.get('materials') or []:
            mo = get(mref)
            if mo is None:
                continue
            props = mo.read_typetree()['m_SavedProperties']
            texs = dict(props['m_TexEnvs'])
            straight = dict(props.get('m_Floats') or []).get('_StraightAlphaInput') == 1
            main, alpha = get(texs.get('_MainTex', {}).get('m_Texture')), get(texs.get('_AlphaTex', {}).get('m_Texture'))
            if main is None:
                continue
            mt = main.read()
            pages[safe_name(mt.m_Name) + '.png'] = merge_alpha(mt.image, alpha.read().image if alpha is not None else None,
                                                               straight)
    if not texts or not pages:
        log(f'  warn {name}: atlas or page textures missing')
        return 0
    atlas = texts[0] if len(texts) == 1 else '\n\n'.join(t.strip('\n') for t in texts) + '\n'
    names = atlas_pages(atlas)
    if set(names) != set(pages):
        if len(names) != 1 or len(pages) != 1:
            log(f'  warn {name}: atlas pages {names} do not match the textures {sorted(pages)}')
            return 0
        pages = {names[0]: next(iter(pages.values()))}  # one page under another name: saved as the atlas names it
    files = {f'{stem}.skel': _text_bytes(ta),
             f'{stem}.atlas': normalize_atlas(atlas, {p: img.size for p, img in pages.items()}).encode('utf-8')}
    out_dir = Path(out_root) / sub
    out_dir.mkdir(parents=True, exist_ok=True)
    for fname, blob in files.items():
        (out_dir / fname).write_bytes(blob)
        manifest.setdefault(sub, {})[fname] = {'path': f'/assets/local/{sub}/{fname}', 'kind': 'TextAsset'}
    for fname, img in pages.items():
        img.save(out_dir / fname)
        manifest.setdefault(sub, {})[fname] = {'path': f'/assets/local/{sub}/{fname}', 'w': img.width, 'h': img.height,
                                               'kind': 'Texture2D'}
    return len(files) + len(pages)


def scene_ids(only):
    """The stage ids of scenes.SCENES that run under --only (all with no prefix, `scene` or a parent of it)."""
    return spine_ids(only, scenes.SCENE_SUB, [sid for sid, _deps in scenes.SCENES])


def scene_roots(ab_root, extra):
    """AB roots searched for the scene bundles, in order: the client, --scenes dirs, then every version kept under
    .cache/official-scenes (newest name first)."""
    kept = ROOT / '.cache' / 'official-scenes'
    cached = sorted((p for p in kept.iterdir() if p.is_dir()), reverse=True) if kept.is_dir() else []
    return [Path(ab_root), *[Path(p) for p in extra], *cached]


def export_scenes(ab_root, out_root, manifest, log, ids, roots, output=None, strict=False, unity_resources=None,
                  memory_bundles=None):
    """scenes.SCENES (the ids in `ids`) → scene/<stageId>/ (scenes.export_scene); a stage without a scene bundle in
    any root is skipped."""
    root = Path(ab_root)
    shader_deps = dep_bundles(root, {'Material'})
    n = 0
    old_tex = manifest.get(scenes.TEX_SUB, {})
    if old_tex:
        manifest[scenes.TEX_SUB] = dict(old_tex)
    for sid, deps in scenes.SCENES:
        if sid not in ids:
            continue
        src = None
        if memory_bundles and memory_bundles.get('sceneBundles'):
            stage_name = scenes.scene_bundle(sid)
            if stage_name in memory_bundles['bundles']:
                src = Path(memory_bundles['sourceRoot']) / stage_name
        else:
            src = scenes.find_scene(sid, roots)
        if src is None:
            log(f'skip (no scene bundle: off-season client, see --scenes) {scenes.scene_bundle(sid)}')
            if strict:
                raise RuntimeError(f'{sid}: scene bundle missing: {scenes.scene_bundle(sid)}')
            continue
        try:
            before = {k: dict(v) for k, v in manifest.items()}
            checkpoint = output.checkpoint() if output is not None else None
            stage_blob = None
            stage_memory = memory_bundles
            if memory_bundles and memory_bundles.get('sceneBundles'):
                stage_name = scenes.scene_bundle(sid)
                stage_blob = memory_bundles['bundles'].get(stage_name)
                if stage_blob is None:
                    raise RuntimeError(f'{sid}: official memory source omitted exact scene bundle {stage_name}')
                stage_memory = {**memory_bundles,
                                'bundles': {name: blob for name, blob in memory_bundles['bundles'].items()
                                            if name != stage_name}}
            n += scenes.export_scene(sid, deps, src, root, out_root, manifest, log, material_info, shader_deps,
                                     output, strict, unity_resources, stage_memory if sid in ids else None, stage_blob)
        except Exception as e:  # one broken scene must not stop the others
            if strict:
                if output is not None:
                    output.rollback_to(checkpoint)
                manifest.clear()
                manifest.update(before)
                raise
            log(f'FAIL scene {sid}: {e}')
    return n


def scene_memory_source(stage_id, roots, bundle_names, max_bytes, include_stage_bundles=False):
    """Validate native cache identity, then fetch and decompress only explicitly named bundles in RAM."""
    if include_stage_bundles:
        allowed = {
            'arts/maps/map_autochesssand/res.ab', 'arts/maps/map_doss_shore/res.ab',
            'arts/maps/effect.ab', 'shaders/standardrealtimeshadow.ab',
            'shaders/stylizedwater.ab', 'shaders/dynamicwatertile.ab', 'refs/fx/texture/flow.ab',
        }
        if stage_id == 'act1autochess_m05':
            allowed.add('arts/maps/map_yumen/res.ab')
            allowed.add('arts/maps/map_survivaloasis_city/res.ab')
        elif stage_id == 'act2autochess_m04':
            allowed.add('arts/maps/map_survivaloasis_city/res.ab')
        else:
            raise ValueError(f'{stage_id}: stage-bundle RAM preview is outside the fixed two-map scope')
        if set(bundle_names) != allowed or len(bundle_names) != len(allowed):
            raise ValueError(f'{stage_id}: preview requires the exact evidenced dependency set; '
                             f'missing={sorted(allowed - set(bundle_names))}, extra={sorted(set(bundle_names) - allowed)}')
        if max_bytes != MAP_SCENE_PREVIEW_MEMORY_BYTES:
            raise ValueError(f'{stage_id}: preview aggregate memory cap must be exactly {MAP_SCENE_PREVIEW_MEMORY_BYTES}')
    if include_stage_bundles:
        receipt_roots = {Path(root).resolve(strict=True) for root in roots
                         if Path(root).name == fetch_scenes.VERSION
                         and (Path(root) / fetch_scenes.RECEIPT).is_file()}
        if len(receipt_roots) != 1:
            raise RuntimeError(f'{stage_id}: expected one exact V072 stage receipt root, found {len(receipt_roots)}')
        source_root = next(iter(receipt_roots))
        source = source_root / scenes.scene_bundle(stage_id)
        receipt_to_check = source_root / fetch_scenes.RECEIPT
        ok, reason = fetch_scenes._plain_ancestors(receipt_to_check)
        if not ok:
            raise RuntimeError(f'{stage_id}: native scene receipt path is unsafe: {reason}')
    else:
        source = scenes.find_scene(stage_id, roots)
        if source is None:
            raise RuntimeError(f'{stage_id}: native scene bundle unavailable for memory-source identity')
        ok, reason = fetch_scenes._plain_ancestors(source)
        if not ok:
            raise RuntimeError(f'{stage_id}: native scene path is unsafe: {reason}')
        try:
            source_stat = os.lstat(source)
        except OSError as exc:
            raise RuntimeError(f'{stage_id}: native scene file unavailable: {source}: {exc}') from exc
        if (fetch_scenes._is_reparse(source_stat) or not stat.S_ISREG(source_stat.st_mode)
                or source_stat.st_nlink != 1):
            raise RuntimeError(f'{stage_id}: native scene file must be plain single-link input: {source}')
        relative = Path(scenes.scene_bundle(stage_id))
        source_root = Path(source)
        for _part in relative.parts:
            source_root = source_root.parent
    if include_stage_bundles:
        runtime_root = source_root.parents[4] / 'runtime' / 'assault'
        receipt_name = {'act1autochess_m05': 'native-m05-memory-fetch.json',
                        'act2autochess_m04': 'native-a2m04-memory-fetch.json'}[stage_id]
        fetch_receipt = runtime_root / receipt_name
        ok, reason = fetch_scenes._plain_ancestors(fetch_receipt)
        if not ok:
            raise RuntimeError(f'{stage_id}: prior native fetch receipt path is unsafe: {reason}')
        try:
            info = os.lstat(fetch_receipt)
            fetch_proof = json.loads(fetch_receipt.read_text(encoding='utf-8'))
        except Exception as exc:
            raise RuntimeError(f'{stage_id}: prior native fetch receipt unavailable: {fetch_receipt}: {exc}') from exc
        if (fetch_scenes._is_reparse(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or not isinstance(fetch_proof, dict) or fetch_proof.get('status') != 'pass'
                or fetch_proof.get('exitCode') != 0 or fetch_proof.get('timedOut') is not False):
            raise RuntimeError(f'{stage_id}: prior native StageOnly fetch receipt is not a plain successful proof')
        fetched = fetch_proof.get('result') or {}
        command = fetch_proof.get('command') or []
        try:
            command_version = command[command.index('--version') + 1] if '--version' in command else fetch_scenes.VERSION
            command_stage = command[command.index('--stage') + 1]
        except (ValueError, IndexError):
            raise RuntimeError(f'{stage_id}: prior StageOnly fetch proof lacks explicit native version/stage args')
        if (command_stage != stage_id or command_version != '26-04-13-12-31-42_e9b560'
                or fetched.get('requestedVersion') != command_version
                or fetched.get('stageIds') != [stage_id] or fetched.get('nativeVersionId') != command_version
                or fetched.get('manifestVersion') != 'V072'):
            raise RuntimeError(f'{stage_id}: prior native fetch receipt has mismatched stage/version/manifest identity')
        expected_scene_names = {scenes.scene_bundle(stage_id)}
        expected_scene_names.update(item.get('name') for item in fetched.get('got', []) if isinstance(item, dict))
        if len(expected_scene_names) != 3 or scenes.scene_bundle(stage_id) not in expected_scene_names:
            raise RuntimeError(f'{stage_id}: prior StageOnly fetch receipt does not prove exactly three source ABs')
    version, platform, manifest_version = fetch_scenes.read_memory_bundle_source(
        source_root, scenes.scene_bundle(stage_id), allow_retired=include_stage_bundles)
    if include_stage_bundles and (version != fetched.get('nativeVersionId') or platform != 'Android'
                                  or manifest_version != fetched.get('manifestVersion')):
        raise RuntimeError(f'{stage_id}: retained native input receipt differs from prior StageOnly fetch proof')
    memory = fetch_scenes.fetch_memory_bundles(version, platform, bundle_names, max_bytes, manifest_version,
                                               [stage_id] if include_stage_bundles else ())
    if include_stage_bundles and set(memory.get('sceneBundles', [])) != expected_scene_names:
        raise RuntimeError(f'{stage_id}: official manifest source ABs differ from the exact prior StageOnly receipt')
    memory['sourceRoot'] = str(source_root)
    return memory


def export_enemy_spines(ab_root, out_root, manifest, log, ids=None):
    """ENEMY_SPINES (or `ids`) from the enemy art bundles (each bundle loaded on its own; stops once every model was
    found)."""
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    wanted, n = set(ENEMY_SPINES if ids is None else ids), 0
    for f in sorted(Path(ab_root).glob(ENEMY_ART)):
        if not wanted:
            break
        try:
            env = UnityPy.load(str(f))
        except Exception as e:  # corrupt or unsupported bundle: report and continue
            log(f'FAIL load {f.name}: {e}')
            continue
        objects = {o.path_id: o for o in env.objects}
        for name, ref in env.container.items():
            eid = enemy_spine_id(name, wanted)
            if not eid:
                continue
            try:
                k = write_spine(objects, ref.read_typetree(), f'{ENEMY_SPINE_SUB}/{eid}', eid, out_root, manifest, log)
            except Exception as e:
                log(f'  warn {eid}: {e}')
                continue
            if k:
                wanted.discard(eid)
                n += k
                log(f'{f.relative_to(ab_root).as_posix()}: {eid} -> {ENEMY_SPINE_SUB}/{eid} ({k} files)')
    for eid in sorted(wanted):
        log(f'skip (not found) enemy Spine {eid}')
    return n


def export_token_spines(ab_root, out_root, manifest, log, ids=None, only_bundle=None):
    """TOKEN_SPINES (or `ids`) from the battle token packs: each token's prefab → the SkeletonDataAsset its Front / only
    Spine renderer draws (pick_spine_node) → write_spine. Each pack is loaded on its own; stops once every model was
    found."""
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    wanted, n = set(TOKEN_SPINES if ids is None else ids), 0
    candidates = sorted(Path(ab_root).glob(TOKEN_PACKS))
    if only_bundle is not None:
        bundle_rel = Path(only_bundle)
        if bundle_rel.is_absolute() or '..' in bundle_rel.parts:
            raise ValueError('--token-bundle must be relative to --game')
        candidates = [f for f in candidates if f.relative_to(ab_root).as_posix() == bundle_rel.as_posix()]
        if len(candidates) != 1:
            raise ValueError(f'--token-bundle must resolve exactly one official token bundle: {only_bundle}')
    for f in candidates:
        if not wanted:
            break
        try:
            env = UnityPy.load(str(f))
        except Exception as e:  # corrupt or unsupported bundle: report and continue
            log(f'FAIL load {f.name}: {e}')
            continue
        objects = {o.path_id: o for o in env.objects}
        for name, ref in env.container.items():
            tid = token_prefab_id(name, wanted)
            if not tid:
                continue
            sub = f'{TOKEN_SPINE_SUB}/{tid}'
            try:
                node = pick_spine_node(prefab_spine_nodes(ref.read_typetree(), objects))
                sda = objects.get(node[2]['m_PathID']) if node and not node[2].get('m_FileID') else None
                if sda is None:
                    log(f'  warn {tid}: its prefab has no Spine renderer in this bundle')
                    continue
                k = write_spine(objects, sda.read_typetree(), sub, tid, out_root, manifest, log)
            except Exception as e:
                log(f'  warn {tid}: {e}')
                continue
            if k:
                wanted.discard(tid)
                n += k
                log(f'{f.relative_to(ab_root).as_posix()}: {tid} ({node[0]}) -> {sub} ({k} files)')
    for tid in sorted(wanted):
        log(f'skip (not found) token Spine {tid}')
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', help='AssetBundle root (…/StreamingAssets/AB/Windows or …/Documents/Bundles)')
    ap.add_argument('--out', default=str(ROOT / 'public/assets/local'))
    ap.add_argument('--manifest', default=str(ROOT / 'data/local-assets.json'))
    ap.add_argument('--only', action='append', default=[], metavar='SUBDIR',
                    help='only run the jobs whose output subdir starts with this prefix (repeatable), e.g. emoticon')
    ap.add_argument('--scenes', action='append', default=[], metavar='DIR',
                    help='an AB root holding the battlefield scene bundles of an in-season version (repeatable; '
                         'searched after --game and before .cache/official-scenes/*)')
    ap.add_argument('--token-bundle', metavar='RELATIVE_BUNDLE',
                    help='restrict one selected token Spine to one exact bundle under --game')
    ap.add_argument('--print-jobs', action='store_true', help='print the job table as JSON and exit')
    ap.add_argument('--webp', action='store_true',
                    help='only write the WebP copies of the board textures from the PNGs already under --out and list '
                         'them in the manifest (needs Pillow, not the client)')
    ap.add_argument('--scene-webp-only', action='store_true', help='write scene images as served WebP, with PNG fallback')
    ap.add_argument('--max-scene-output-bytes', type=int, metavar='N', help='hard limit for newly created scene output bytes')
    ap.add_argument('--strict-scenes', action='store_true', help='fail selected scene exports on missing or unresolved content')
    ap.add_argument('--unity-resources', metavar='FILE',
                    help='read-only native Unity "unity default resources" SerializedFile provider for verified built-in Quad meshes')
    ap.add_argument('--scene-memory-bundle', action='append', default=[], metavar='BUNDLE',
                    help='explicit native .ab dependency to fetch, validate, and load only in memory (repeatable; one strict WebP scene only)')
    ap.add_argument('--scene-memory-preview', action='store_true',
                    help='RAM-only source mode for the two missing map stages; adds the stage exact three official ABs')
    ap.add_argument('--scene-preview-only', action='store_true',
                    help='run strict scene extraction and exact output planning without writing formal outputs')
    ap.add_argument('--max-scene-memory-bytes', type=int, metavar='N',
                    help='aggregate decompressed UnityFS bytes allowed for --scene-memory-bundle (maximum 24 MiB)')
    args = ap.parse_args()

    if args.print_jobs:
        jobs = [{'bundle': rel, 'sub': sub, 'kinds': sorted(kinds), 'keep': keep.pattern if keep else None}
                for rel, sub, kinds, keep in map(job_parts, JOBS)]
        derived = [{'sub': sub, 'from': src, 'derive': kind, 'name': name} for sub, src, kind, name in DERIVED]
        webp = [{'sub': sub, 'name': name, 'mode': mode} for sub, name, mode in WEBP]
        print(json.dumps({'emoteThemes': [{'themeId': t, 'dir': d} for t, d in EMOTE_THEMES], 'jobs': jobs,
                          'derived': derived, 'webp': webp,
                          'enemySpines': {'bundles': ENEMY_ART, 'sub': ENEMY_SPINE_SUB, 'ids': ENEMY_SPINES},
                          'tokenSpines': {'bundles': TOKEN_PACKS, 'sub': TOKEN_SPINE_SUB, 'ids': TOKEN_SPINES},
                          'scenes': {'sub': scenes.SCENE_SUB, 'tex': scenes.TEX_SUB,
                                     'stages': [{'id': sid, 'bundle': scenes.scene_bundle(sid), 'deps': deps}
                                                for sid, deps in scenes.SCENES]}},
                         ensure_ascii=False))
        return 0
    if args.max_scene_output_bytes is not None and args.max_scene_output_bytes < 0:
        ap.error('--max-scene-output-bytes must be non-negative')
    memory_limit = MAP_SCENE_PREVIEW_MEMORY_BYTES if args.scene_memory_preview else MAX_SCENE_MEMORY_BYTES
    if args.max_scene_memory_bytes is not None and not 0 <= args.max_scene_memory_bytes <= memory_limit:
        ap.error(f'--max-scene-memory-bytes must be between 0 and {memory_limit}')
    if args.scene_memory_bundle and (args.max_scene_memory_bytes is None or args.max_scene_memory_bytes <= 0):
        ap.error('--scene-memory-bundle requires a positive --max-scene-memory-bytes')
    if args.max_scene_memory_bytes is not None and not args.scene_memory_bundle:
        ap.error('--max-scene-memory-bytes requires --scene-memory-bundle')
    if any(not fetch_scenes.safe_bundle(name) for name in args.scene_memory_bundle):
        ap.error('--scene-memory-bundle requires safe exact native .ab names')
    if args.webp:
        return webp_only(Path(args.out), Path(args.manifest), print)

    ab_root = Path(args.game) if args.game else next((p for p in CANDIDATES if p.exists()), None)
    if not ab_root or not ab_root.exists():
        print('No Arknights install found. Pass --game <AssetBundle root>.', file=sys.stderr)
        return 2
    jobs = select_jobs(args.only)
    enemy_ids = spine_ids(args.only, ENEMY_SPINE_SUB, ENEMY_SPINES)
    token_ids = spine_ids(args.only, TOKEN_SPINE_SUB, TOKEN_SPINES)
    stage_ids = scene_ids(args.only)
    if not jobs and not enemy_ids and not token_ids and not stage_ids:
        print(f'--only {args.only}: no job matches', file=sys.stderr)
        return 2
    if args.unity_resources and not stage_ids:
        ap.error('--unity-resources requires a selected scene job')
    if args.scene_memory_preview and (len(stage_ids) != 1 or stage_ids[0] not in ('act1autochess_m05', 'act2autochess_m04')
                                     or jobs or enemy_ids or token_ids or not args.strict_scenes or not args.scene_webp_only):
        ap.error('--scene-memory-preview is limited to one strict WebP m05 or act2 m04 scene')
    if args.scene_preview_only and (not args.scene_memory_preview or not args.strict_scenes or not args.scene_webp_only):
        ap.error('--scene-preview-only requires --scene-memory-preview, --strict-scenes and --scene-webp-only')
    if args.scene_memory_bundle and (len(stage_ids) != 1 or jobs or enemy_ids or token_ids
                                     or not args.strict_scenes or not args.scene_webp_only):
        ap.error('--scene-memory-bundle requires exactly one selected strict scene job with --scene-webp-only and no other jobs')
    if args.token_bundle and (len(token_ids) != 1 or jobs or enemy_ids or stage_ids):
        ap.error('--token-bundle requires exactly one selected token Spine and no other extraction jobs')
    try:
        old_doc = scene_output.read_manifest(args.manifest)
    except Exception as e:
        print(f'FAIL manifest preflight {args.manifest}: {e}', file=sys.stderr)
        return 2
    out_root = Path(args.out)
    roots = scene_roots(ab_root, args.scenes)
    memory_bundles = None
    if args.scene_memory_bundle or args.scene_memory_preview:
        try:
            memory_bundles = scene_memory_source(stage_ids[0], roots, args.scene_memory_bundle,
                                                 args.max_scene_memory_bytes, args.scene_memory_preview)
        except Exception as e:
            print(f'FAIL scene memory bundle preflight: {e}', file=sys.stderr)
            return 2
    output = scene_output.SceneOutput(out_root, args.max_scene_output_bytes, args.scene_webp_only, args.strict_scenes)
    manifest, total = {}, 0
    print(f'AB root: {ab_root}')
    for job in jobs:
        total += export_bundle(ab_root, job, out_root, manifest, print)
    if enemy_ids:
        total += export_enemy_spines(ab_root, out_root, manifest, print, enemy_ids)
    if token_ids:
        total += export_token_spines(ab_root, out_root, manifest, print, token_ids, args.token_bundle)
    if stage_ids:
        try:
            # Existing scene textures are reusable only when both their manifest record and file are present.
            manifest[scenes.TEX_SUB] = dict(old_doc['groups'].get(scenes.TEX_SUB, {}))
            total += export_scenes(ab_root, out_root, manifest, print, stage_ids, roots,
                                   output, args.strict_scenes, args.unity_resources, memory_bundles)
        except Exception as e:
            print(f'FAIL scene export: {e}', file=sys.stderr)
            return 1
    old = old_doc['groups']
    groups = merge_manifest(old, manifest, set(manifest))
    count = sum(len(v) for v in groups.values())
    doc = {'version': 1, 'source': 'local-client', 'count': count, 'groups': groups}
    try:
        if stage_ids:
            if args.scene_preview_only:
                result = output.preview(args.manifest, doc)
                result.update({'status': 'pass', 'mode': 'scene-preview-only', 'stageIds': stage_ids,
                               'nativeVersionId': memory_bundles.get('nativeVersionId') if memory_bundles else None,
                               'manifestVersion': memory_bundles.get('manifestVersion') if memory_bundles else None,
                               'memoryBundles': [{'name': name, 'bytes': len(blob)}
                                                 for name, blob in (memory_bundles or {}).get('bundles', {}).items()],
                               'memoryInputBytes': (memory_bundles or {}).get('totalBytes', 0),
                               'sourceSceneBundles': (memory_bundles or {}).get('sceneBundles', [])})
                print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
                return 0 if total else 1
            output.commit(args.manifest, doc)
        else:
            manifest_path = Path(args.manifest)
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    except Exception as e:
        print(f'FAIL scene output commit: {e}', file=sys.stderr)
        return 1
    print(f'done: {total} files extracted, manifest {args.manifest} ({count} entries)')
    return 0 if total else 1


if __name__ == '__main__':
    sys.exit(main())
