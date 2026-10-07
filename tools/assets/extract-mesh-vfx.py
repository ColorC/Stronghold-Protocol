#!/usr/bin/env python3
"""Export Unity ParticleSystemRenderer Mesh effects for the browser renderer.

The normal VFX extractor produces a camera-facing atlas. That is sufficient for
billboards, but it loses the authored geometry of Mesh particle renderers. This
tool keeps the prefab's hierarchy, mesh vertices/indices/UVs, particle timing,
material texture and blend metadata so the client can project the mesh onto the
battle map at runtime.

Example:
  python extract-mesh-vfx.py --bundle .omni/tmp/vfx-raw-20261007/ab/battle/prefabs/effects/blkkgt.ab \
    --deps .omni/tmp/ark-vfx-rosmon-20261006/ab/refs/fx --prefab blkkgt_skill_03_end \
    --out public/assets/vfx/blkkgt/blkkgt_skill_03_end/mesh.json
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
import aklz4  # noqa: F401  (registers the custom bundle decoder)
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler


def ptr(value):
    return value.component if hasattr(value, "component") else value[1] if isinstance(value, tuple) else value


def read_ptr(value):
    try:
        return value.deref_parse_as_object() if hasattr(value, "deref_parse_as_object") else value.read()
    except Exception:
        return None


def v3(value):
    if isinstance(value, (tuple, list)):
        return tuple(float(value[i]) if i < len(value) else 0.0 for i in range(3))
    return tuple(float(getattr(value, k, 0.0)) for k in ("x", "y", "z"))


def q4(value):
    if isinstance(value, (tuple, list)):
        return tuple(float(value[i]) if i < len(value) else 0.0 for i in range(4))
    return tuple(float(getattr(value, k, 0.0)) for k in ("x", "y", "z", "w"))


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qvec(q, v):
    x, y, z = v
    qx, qy, qz, qw = q
    # q * v * q^-1, expanded for the normalized Unity quaternions in prefabs.
    tx = 2.0 * (qy * z - qz * y)
    ty = 2.0 * (qz * x - qx * z)
    tz = 2.0 * (qx * y - qy * x)
    return (x + qw * tx + qy * tz - qz * ty,
            y + qw * ty + qz * tx - qx * tz,
            z + qw * tz + qx * ty - qy * tx)


def qbasis(q, scale):
    return (qvec(q, (scale[0], 0.0, 0.0)), qvec(q, (0.0, scale[1], 0.0)), qvec(q, (0.0, 0.0, scale[2])))


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def transform(parent, pos, rot, scale):
    if parent is None:
        origin = pos
        basis = qbasis(rot, scale)
        return origin, basis, rot
    porigin, pbasis, prot = parent
    origin = porigin
    for i in range(3):
        origin = add(origin, mul(pbasis[i], pos[i]))
    local_basis = qbasis(rot, scale)
    basis = tuple(tuple(sum(pbasis[k][j] * local_basis[i][k] for k in range(3)) for j in range(3)) for i in range(3))
    return origin, basis, qmul(prot, rot)


def scalar(value, default=0.0):
    for key in ("scalar", "constant"):
        if hasattr(value, key):
            return float(getattr(value, key))
    try:
        return float(value)
    except Exception:
        return float(default)


def slug(value):
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(value)).strip("._") or "texture"


def mesh_data(env, mesh_ptr):
    mesh = read_ptr(mesh_ptr)
    if mesh is None:
        return None
    handler = MeshHandler(mesh)
    handler.process()
    vertices = handler.m_Vertices or []
    indices = handler.m_IndexBuffer or []
    uv = handler.m_UV0 or []
    return {
        "name": str(getattr(mesh, "m_Name", "")),
        "vertices": [[float(v[0]), float(v[1]), float(v[2])] for v in vertices],
        "indices": [int(i) for i in indices],
        "uv0": [[float(u[0]), float(u[1])] for u in uv],
    }


def material_data(env, material_ptr, texture_dir: Path, texture_cache: dict):
    material = read_ptr(material_ptr)
    if material is None:
        return None
    shader = read_ptr(material.m_Shader)
    shader_name = str(getattr(shader, "m_Name", "")) if shader else ""
    saved = material.m_SavedProperties
    colors = {str(k): [float(c.r), float(c.g), float(c.b), float(c.a)] for k, c in saved.m_Colors}
    floats = {str(k): float(v) for k, v in saved.m_Floats}
    main = None
    for key, envv in saved.m_TexEnvs:
        if str(key) != "_MainTex" or not envv.m_Texture.path_id:
            continue
        tex = read_ptr(envv.m_Texture)
        if tex is None:
            continue
        tex_id = f"{slug(getattr(tex, 'm_Name', 'texture'))}-{int(envv.m_Texture.path_id)}.png"
        target = texture_dir / tex_id
        if tex_id not in texture_cache:
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                tex.image.save(target)
                texture_cache[tex_id] = True
            except Exception:
                texture_cache[tex_id] = False
        main = {"file": tex_id, "scale": [float(envv.m_Scale.x), float(envv.m_Scale.y)], "offset": [float(envv.m_Offset.x), float(envv.m_Offset.y)]}
        break
    dst = floats.get("_DstBlend")
    additive = "Add" in shader_name or (dst is not None and abs(dst - 1.0) < 0.01)
    color = colors.get("_MainColor") or colors.get("_TintColor") or colors.get("_Color") or [1, 1, 1, 1]
    return {"name": str(material.m_Name), "shader": shader_name, "texture": main, "color": color, "floats": floats, "additive": bool(additive)}


def particle_data(ps):
    initial = ps.InitialModule
    emission = ps.EmissionModule
    return {
        "life": scalar(initial.startLifetime, 0.5),
        "startSpeed": scalar(initial.startSpeed),
        "size": [scalar(initial.startSize, 1), scalar(initial.startSizeY, 1), scalar(initial.startSizeZ, 1)],
        "rotation": scalar(initial.startRotation),
        "duration": float(getattr(ps, "lengthInSec", 1.0)),
        "looping": bool(getattr(ps, "looping", False)),
        "burst": int(getattr(emission, "m_BurstCount", 0)),
        "customData": bool(getattr(ps.CustomDataModule, "enabled", False)),
    }


def walk(env, node, parent_state, path, texture_dir, texture_cache, out_nodes):
    go = node.m_GameObject.read()
    name = str(go.m_Name)
    node_path = f"{path}/{name}" if path else name
    state = transform(parent_state, v3(node.m_LocalPosition), q4(node.m_LocalRotation), v3(node.m_LocalScale))
    components = []
    particle = None
    for comp_ptr in go.m_Component:
        comp = read_ptr(ptr(comp_ptr))
        if comp is None:
            continue
        typ = type(comp).__name__
        if typ == "ParticleSystem":
            particle = particle_data(comp)
        elif typ == "ParticleSystemRenderer" and getattr(comp, "m_Mesh", None) and comp.m_Mesh.path_id:
            mesh = mesh_data(env, comp.m_Mesh)
            materials = [material_data(env, m, texture_dir, texture_cache) for m in getattr(comp, "m_Materials", [])]
            materials = [m for m in materials if m]
            origin, basis, world_rot = state
            out_nodes.append({
                "path": node_path,
                "name": name,
                "origin": list(origin),
                "basis": [list(x) for x in basis],
                "mesh": mesh,
                "particle": particle or {"life": 1, "size": [1, 1, 1], "rotation": 0, "duration": 1, "burst": 1, "customData": False},
                "renderMode": int(getattr(comp, "m_RenderMode", 0)),
                "alignment": int(getattr(comp, "m_Alignment", 0)),
                "materials": materials,
            })
        components.append(typ)
    for child_ptr in node.m_Children:
        walk(env, child_ptr.read(), state, node_path, texture_dir, texture_cache, out_nodes)


def find_root(env, name):
    for obj in env.objects:
        if obj.type.name != "GameObject":
            continue
        go = obj.read()
        if str(go.m_Name) != name:
            continue
        for comp_ptr in go.m_Component:
            comp = read_ptr(ptr(comp_ptr))
            if type(comp).__name__ == "Transform" and (not comp.m_Father or comp.m_Father.path_id == 0):
                return comp
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--deps", action="append", default=[])
    ap.add_argument("--prefab", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    paths = [a.bundle]
    for root in a.deps:
        paths.extend(sorted(glob.glob(str(Path(root) / "**" / "*.ab"), recursive=True)))
    env = UnityPy.load(*paths)
    root = find_root(env, a.prefab)
    if root is None:
        raise SystemExit(f"prefab not found: {a.prefab}")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    texture_dir = out.parent / "textures"
    nodes = []
    texture_cache = {}
    walk(env, root, None, "", texture_dir, texture_cache, nodes)
    payload = {"prefab": a.prefab, "format": 1, "nodes": nodes, "textures": sorted(k for k, ok in texture_cache.items() if ok)}
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"out": str(out), "nodes": len(nodes), "textures": len(payload["textures"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
