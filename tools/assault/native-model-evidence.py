#!/usr/bin/env python3
"""Read official local bundles; optionally add the one identified Cathy PNG.

Run with the existing Python installation and -B. No network, extraction tree,
installation, manifest mutation, or computed content digests are used.
"""

import argparse
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import stat
import struct
import sys
import urllib.request
import zipfile


CANONICAL_ROOT = Path("E:/WindowsWorkspace/webworks/apps/stronghold-protocol")
VERSION = "26-09-22-07-47-20_6c71fa"
BUNDLE_DIR = CANONICAL_ROOT / "data/assault-sources/arknights/assetbundles" / VERSION
URL_ROOT = "https://ak.hycdn.cn/assetbundle/official/Android/assets/" + VERSION + "/"
SCRIPT_PACKAGE = "anon_b1571a1194a50f0abd5da9a91d24f6d6.dat"
TOKEN_PACKAGE = "pkgrps_btl_pfb_tokens_0.dat"
CATHY_ID = "token_10041_cathy_catsld"
CATHY_TEXTURE = 3000751526514175534
CATHY_OUTPUT = CANONICAL_ROOT / "data/assault-sources/assets/summons" / CATHY_ID / "model" / (CATHY_ID + ".png")
OPERATORS = ("char_1012_skadi2", "char_291_aglina", "char_4045_heidi", "char_4134_cetsyr")
TOLEDO_VERSION = "26-10-08-04-51-28-56071834"
TOLEDO_INDEX = "9a5354be72032a76f8a80ed2d963a66f.idx"
TOLEDO_BUNDLE = "pkgrps/btl_pfb_tokens_6.ab"
TOLEDO_PREFAB = "dyn/battle/prefabs/[uc]tokens/token_10067_toledo_tldptm.prefab"
TOLEDO_NEIGHBORS = (
    "dyn/battle/prefabs/[uc]tokens/token_10066_closur_ourbase.prefab",
    "dyn/battle/prefabs/[uc]tokens/token_10068_kalts2_mtship.prefab",
)
MAP_OWNER_VERSION = "26-04-13-12-31-42_e9b560"
MAP_OWNER_INDEX = "f9f379412ec2262e40876de258ec619f.idx"
MAP_OWNER_BASE = "https://ak.hycdn.cn/assetbundle/official/Android/assets/26-04-13-12-31-42_e9b560/"
MAP_OWNER_BUNDLES = (
    "arts/maps/map_doss_shore/background_mesh/bg_doss_shore.ab",
    "arts/maps/map_doss_shore/background_mesh/s_background_common.ab",
    "arts/maps/map_doss_shore/mesh/dosshore_ui.ab",
)
MAP_OWNER_CAB = "c2c688f710a565b7cce0cc93f7bd219f"
MAP_OWNER_MESH_PATH_ID = -4487102536378500135
MAP_DEPENDENCY_BUNDLE = "anon/fc2d5c7750596c62c748dc87eb834d42.bin"
MAP_DEPENDENCY_CID = 13930
MAP_DEPENDENCY_HASH = "7fda"
MAP_DEPENDENCY_RAW_BYTES = 5_278_007
MAP_DEPENDENCY_EXPANDED_BYTES = 6_344_181
MAP_DEPENDENCY_RAW_LIMIT = 6 * 1024 * 1024
MAP_DEPENDENCY_EXPANDED_LIMIT = 8 * 1024 * 1024
MAP_DEPENDENCY_SECOND_BUNDLE = "anon/98a215cf851e7e4bb0ac9592f79c2cc3.bin"
MAP_DEPENDENCY_SECOND_RAW_LIMIT = 8 * 1024 * 1024
MAP_DEPENDENCY_SECOND_EXPANDED_LIMIT = 32 * 1024 * 1024
MAP_SOURCE_SCENE_BUNDLE = "scenes/activities/act1autochess/level_act1autochess_m05/level_act1autochess_m05.ab"
MAP_SOURCE_SCENE_RAW_LIMIT = 16 * 1024 * 1024
MAP_SOURCE_SCENE_EXPANDED_LIMIT = 64 * 1024 * 1024
MAP_SHORE_RES_BUNDLE = "arts/maps/map_doss_shore/res.ab"
MAP_SHORE_RES_RAW_LIMIT = 8 * 1024 * 1024
MAP_SHORE_RES_EXPANDED_LIMIT = 32 * 1024 * 1024
MAP_FLOW_TEXTURE_BUNDLE = "refs/fx/texture/flow.ab"
MAP_FLOW_TEXTURE_RAW_LIMIT = 12 * 1024 * 1024
MAP_FLOW_TEXTURE_EXPANDED_LIMIT = 16 * 1024 * 1024
MAP_FLOW_TEXTURE_METADATA_RECEIPT = CANONICAL_ROOT / "runtime/assault/native-flow-texture-probe.json"
MAP_EMISSION_OWNER_BUNDLE = "arts/maps/map_survivaloasis_city/res.ab"
MAP_EMISSION_OWNER_CAB = "d11100f4254cd2e6ee06daa9c2b8392f"
MAP_EMISSION_OWNER_PATH_ID = 1516978124489369110
MAP_EMISSION_OWNER_RAW_LIMIT = 12 * 1024 * 1024
MAP_EMISSION_OWNER_EXPANDED_LIMIT = 12 * 1024 * 1024


def absolute(path):
    return str(path.absolute()).replace("\\", "/")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def pointer(value):
    return {"fileId": int(value["m_FileID"]), "pathId": str(value["m_PathID"])}


def text_bytes(data):
    value = data["m_Script"]
    return value.encode("utf-8", "surrogateescape") if isinstance(value, str) else bytes(value)


class FlatBufferReader:
    """Small bounds-checked reader for the native index's verified FlatBuffers tables."""

    def __init__(self, data):
        self.data = memoryview(data)

    def _range(self, pos, size):
        require(isinstance(pos, int) and isinstance(size, int) and pos >= 0 and size >= 0
                and pos + size <= len(self.data), "FlatBuffers pointer is outside the index")

    def u32(self, pos):
        self._range(pos, 4)
        return struct.unpack_from("<I", self.data, pos)[0]

    def string(self, pos):
        length = self.u32(pos)
        self._range(pos + 4, length + 1)
        require(self.data[pos + 4 + length] == 0, "FlatBuffers string lacks its terminator")
        return bytes(self.data[pos + 4:pos + 4 + length]).decode("utf-8")

    def table(self, pos):
        self._range(pos, 4)
        distance = struct.unpack_from("<i", self.data, pos)[0]
        require(distance != 0, "FlatBuffers table has invalid vtable distance")
        vtable = pos - distance
        self._range(vtable, 4)
        vtable_size, object_size = struct.unpack_from("<HH", self.data, vtable)
        require(vtable_size >= 4 and vtable_size % 2 == 0 and object_size >= 4,
                "FlatBuffers table has malformed vtable dimensions")
        self._range(vtable, vtable_size)
        self._range(pos, object_size)
        return vtable, vtable_size, object_size

    def field(self, pos, slot):
        vtable, vtable_size, object_size = self.table(pos)
        entry = vtable + 4 + slot * 2
        if entry + 2 > vtable + vtable_size:
            return 0
        offset = struct.unpack_from("<H", self.data, entry)[0]
        require(offset == 0 or 4 <= offset < object_size,
                "FlatBuffers field offset exceeds its table")
        return offset

    def indirect(self, pos):
        relative = self.u32(pos)
        require(relative > 0, "FlatBuffers uoffset is zero")
        target = pos + relative
        self._range(target, 4)
        return target

    def vector(self, pos):
        target = self.indirect(pos)
        count = self.u32(target)
        self._range(target + 4, count * 4)
        return [self.indirect(target + 4 + index * 4) for index in range(count)]

    def u32_vector(self, pos):
        target = self.indirect(pos)
        count = self.u32(target)
        self._range(target + 4, count * 4)
        return [self.u32(target + 4 + index * 4) for index in range(count)]


def parse_native_index_mapping(index_bytes, manifest, paths=(TOLEDO_PREFAB, *TOLEDO_NEIGHBORS)):
    """Resolve asset path -> native bundle name using the two verified root vectors."""
    require(isinstance(manifest, dict) and manifest.get("manifestVersion") in ("V072", "V078"),
            "native index mapping requires a supported official V072/V078 manifest")
    infos = manifest.get("abInfos")
    require(isinstance(infos, list), "official manifest lacks abInfos")
    reader = FlatBufferReader(index_bytes)
    root_pos = 128 + reader.u32(128)
    reader.table(root_pos)
    bundle_slot, asset_slot = reader.field(root_pos, 1), reader.field(root_pos, 2)
    require(bundle_slot and asset_slot, "native index lacks bundle/asset root vectors")
    bundle_tables = reader.vector(root_pos + bundle_slot)
    asset_tables = reader.vector(root_pos + asset_slot)
    bundle_names = []
    for table_pos in bundle_tables:
        name_slot = reader.field(table_pos, 0)
        require(name_slot, "native bundle table lacks its name")
        bundle_names.append(reader.string(reader.indirect(table_pos + name_slot)))
    wanted = set(paths)
    found = {}
    for table_pos in asset_tables:
        path_slot, bundle_slot, basename_slot, fullpath_slot = (reader.field(table_pos, i) for i in range(4))
        require(path_slot, "native asset table lacks its logical path")
        logical_path = reader.string(reader.indirect(table_pos + path_slot))
        if not fullpath_slot:
            continue
        full_path = reader.string(reader.indirect(table_pos + fullpath_slot))
        if full_path not in wanted:
            continue
        # FlatBuffers omits default-valued scalar fields; an absent slot 1 means index 0.
        bundle_index = reader.u32(table_pos + bundle_slot) if bundle_slot else 0
        require(bundle_index < len(bundle_names), "native asset bundle vector index is out of range")
        require(basename_slot, "requested native asset table lacks its basename")
        basename = reader.string(reader.indirect(table_pos + basename_slot))
        found[full_path] = {"assetTablePos": table_pos, "bundleVectorIndex": bundle_index,
                            "bundleName": bundle_names[bundle_index], "logicalPath": logical_path,
                            "basename": basename, "fullPath": full_path}
    result = {}
    for path in paths:
        require(path in found, "native index has no exact asset path: " + path)
        matches = [row for row in infos if isinstance(row, dict) and row.get("name") == found[path]["bundleName"]]
        require(len(matches) == 1, "official manifest does not uniquely resolve native bundle: " + found[path]["bundleName"])
        result[path] = {**found[path], "manifestRecord": matches[0]}
    return {"bundleVectorCount": len(bundle_names), "assetVectorCount": len(asset_tables), "paths": result}


def parse_map_owner_index(index_bytes, manifest):
    """Read the verified index vectors and retain only exact shore-map asset rows."""
    require(isinstance(manifest, dict) and manifest.get("manifestVersion") == "V072",
            "map owner index requires the official V072 manifest")
    infos = manifest.get("abInfos")
    require(isinstance(infos, list), "official V072 manifest lacks abInfos")
    reader = FlatBufferReader(index_bytes)
    root_pos = 128 + reader.u32(128)
    reader.table(root_pos)
    bundle_slot, asset_slot = reader.field(root_pos, 1), reader.field(root_pos, 2)
    require(bundle_slot and asset_slot, "V072 index lacks bundle/asset root vectors")
    bundle_tables = reader.vector(root_pos + bundle_slot)
    asset_tables = reader.vector(root_pos + asset_slot)
    bundle_names = []
    bundle_positions = []
    for table_pos in bundle_tables:
        name_slot = reader.field(table_pos, 0)
        require(name_slot, "V072 native bundle table lacks its name")
        bundle_names.append(reader.string(reader.indirect(table_pos + name_slot)))
        bundle_positions.append(table_pos)
    manifest_by_name = {}
    for row in infos:
        if isinstance(row, dict) and isinstance(row.get("name"), str):
            manifest_by_name.setdefault(row["name"], []).append(row)
    wanted_bundles = set(MAP_OWNER_BUNDLES)
    bundle_slots = []
    for index, (name, table_pos) in enumerate(zip(bundle_names, bundle_positions)):
        if name not in wanted_bundles:
            continue
        field_offsets = [reader.field(table_pos, slot) for slot in range(4)]
        scalar_value = reader.u32(table_pos + field_offsets[2]) if field_offsets[2] else 0
        dependency_indices = reader.u32_vector(table_pos + field_offsets[3]) if field_offsets[3] else []
        require(all(value < len(bundle_names) for value in dependency_indices),
                "V072 bundle dependency index is out of range: " + name)
        matches = manifest_by_name.get(name, [])
        require(len(matches) == 1, "V072 bundle name does not uniquely join to official manifest: " + name)
        bundle_slots.append({"bundleVectorIndex": index, "tablePos": table_pos,
                             "fieldOffsets": field_offsets,
                             "fieldKinds": ["string-uoffset", "u32-scalar-untyped", "u32-scalar-untyped", "u32-vector-uoffset"],
                             "bundleName": name, "slot2Scalar": scalar_value,
                             "slot3DependencyIndices": dependency_indices,
                             "slot3DependencyNames": [bundle_names[value] for value in dependency_indices],
                             "manifestRecord": matches[0]})
    relevant = []
    for table_pos in asset_tables:
        path_slot, bundle_index_slot, basename_slot, fullpath_slot = (reader.field(table_pos, i) for i in range(4))
        if not path_slot:
            continue
        logical = reader.string(reader.indirect(table_pos + path_slot))
        full = reader.string(reader.indirect(table_pos + fullpath_slot)) if fullpath_slot else ""
        if "map_doss_shore" not in (logical + " " + full).lower() or not full.lower().endswith((".fbx", ".mesh")):
            continue
        bundle_index = reader.u32(table_pos + bundle_index_slot) if bundle_index_slot else 0
        require(bundle_index < len(bundle_names), "V072 asset bundle vector index is out of range")
        name = bundle_names[bundle_index]
        matches = manifest_by_name.get(name, [])
        require(len(matches) == 1, "V072 bundle name does not uniquely join to official manifest: " + name)
        basename = reader.string(reader.indirect(table_pos + basename_slot)) if basename_slot else None
        relevant.append({"assetTablePos": table_pos, "logicalPath": logical, "fullPath": full,
                         "bundleVectorIndex": bundle_index, "bundleName": name,
                         "basename": basename, "manifestRecord": matches[0]})
    return {"bundleVectorCount": len(bundle_names), "assetVectorCount": len(asset_tables),
            "candidateBundleSlots": bundle_slots,
            "relevantMapDossShoreMeshRows": relevant}


def exact_mesh_owner(serialized_file_name, path_id, object_type):
    return (serialized_file_name.casefold() == ("CAB-" + MAP_OWNER_CAB).casefold()
            and int(path_id) == MAP_OWNER_MESH_PATH_ID and object_type == "Mesh")


def exact_emission_texture_owner(serialized_file_name, path_id):
    name = str(serialized_file_name or "").replace("\\", "/").rsplit("/", 1)[-1].casefold()
    cab = name[4:] if name.startswith("cab-") else name
    return cab == MAP_EMISSION_OWNER_CAB and str(path_id) == str(MAP_EMISSION_OWNER_PATH_ID)


def source_pointer_evidence(owner_object, pptr, field, owner_name=None):
    """Capture a target PPtr using UnityPy's normal resolver and external-index convention."""
    fid, path_id = int(pptr.m_FileID), int(pptr.m_PathID)
    assets_file = owner_object.assets_file
    externals = list(getattr(assets_file, "externals", []))
    zero_index = fid - 1 if fid > 0 else None
    external = externals[zero_index] if zero_index is not None and zero_index < len(externals) else None
    row = None if external is None else {"path": str(getattr(external, "path", "")),
                                         "guid": str(getattr(external, "guid", "")),
                                         "type": int(getattr(external, "type", 0))}
    result = {"ownerSerializedFile": str(getattr(assets_file, "name", "")),
              "ownerUnityType": getattr(getattr(owner_object, "type", None), "name", type(owner_object).__name__),
              "ownerPathId": str(getattr(owner_object, "path_id", "")), "ownerName": owner_name, "field": field,
              "m_FileID": fid, "m_PathID": str(path_id), "externalIndexZeroBased": zero_index,
              "externalEntryCount": len(externals), "externalEntry": row}
    try:
        target = pptr.deref()
        result.update({"resolverStatus": "resolved", "resolvedSerializedFile": str(target.assets_file.name),
                       "resolvedUnityType": target.type.name, "resolvedPathId": str(target.path_id)})
    except Exception as error:
        result.update({"resolverStatus": "unresolved", "resolverErrorType": type(error).__name__,
                       "resolverError": str(error)})
    return result


def exact_manifest_record(manifest, name):
    require(isinstance(manifest, dict) and isinstance(manifest.get("abInfos"), list),
            "official manifest lacks abInfos")
    rows = [row for row in manifest["abInfos"] if isinstance(row, dict) and row.get("name") == name]
    require(len(rows) == 1, "official manifest does not uniquely list exact dependency: " + name)
    return rows[0]


def dependency_carrier_size_limits(record, raw_limit=3_500_000, expanded_limit=64 * 1024 * 1024):
    raw_size, expanded_size = record.get("totalSize"), record.get("abSize")
    require(isinstance(raw_size, int) and 0 <= raw_size <= raw_limit,
            f"exact dependency manifest totalSize {raw_size!r} exceeds {raw_limit} bytes or is invalid")
    require(isinstance(expanded_size, int) and 0 <= expanded_size <= expanded_limit,
            f"exact dependency manifest abSize {expanded_size!r} exceeds {expanded_limit} bytes or is invalid")
    return raw_size, expanded_size


def dependency_carrier_gate(metadata, raw_limit=3_500_000, expanded_limit=64 * 1024 * 1024):
    """Return a structured gate result that always retains the exact manifest row."""
    result = {**metadata, "thresholds": {"rawPackageBytes": raw_limit, "expandedBundleBytes": expanded_limit},
              "ownerResolved": False, "carrierDownloaded": False}
    try:
        result["manifestRawPackageBytes"], result["manifestExpandedBundleBytes"] = dependency_carrier_size_limits(
            metadata["candidateManifestRecord"], raw_limit, expanded_limit)
    except (KeyError, ValueError) as error:
        result.update({"status": "rejected-before-carrier-fetch",
                       "failureStage": "official-manifest-size-gate", "firstError": str(error)})
        return result
    result["status"] = "within-carrier-size-limits"
    return result


def validate_map_dependency_scope(bundle_name, cid, bundle_hash, raw_size, expanded_size,
                                  raw_limit, expanded_limit):
    expected = (MAP_DEPENDENCY_BUNDLE, MAP_DEPENDENCY_CID, MAP_DEPENDENCY_HASH,
                MAP_DEPENDENCY_RAW_BYTES, MAP_DEPENDENCY_EXPANDED_BYTES,
                MAP_DEPENDENCY_RAW_LIMIT, MAP_DEPENDENCY_EXPANDED_LIMIT)
    actual = (bundle_name, cid, bundle_hash, raw_size, expanded_size, raw_limit, expanded_limit)
    require(actual == expected, "map dependency probe requires the exact authorized bundle metadata and 6/8 MiB caps")
    return {"name": bundle_name, "cid": cid, "hash": bundle_hash, "md5": bundle_hash,
            "totalSize": raw_size, "abSize": expanded_size, "cat": 1, "meta": 1}


class Bundle:
    def __init__(self, filename, types):
        import UnityPy

        self.path = BUNDLE_DIR / filename
        self.source = {"path": absolute(self.path), "url": URL_ROOT + filename}
        require(self.path.is_file(), "Missing official input: " + absolute(self.path))
        with zipfile.ZipFile(self.path) as archive:
            members = [entry for entry in archive.infolist() if not entry.is_dir()]
            require(len(members) == 1, "Expected one native member in " + absolute(self.path))
            member = members[0]
            raw = archive.read(member)
        self.source.update({"bytes": self.path.stat().st_size, "zipMember": member.filename,
                            "nativeMemberBytes": len(raw)})
        self.env = UnityPy.load(raw)
        self.objects = {obj.path_id: obj for obj in self.env.objects}
        self.rows = {pid: (obj.type.name, obj.read_typetree())
                     for pid, obj in self.objects.items() if obj.type.name in types}

    def get(self, ptr, kind=None):
        require(ptr["m_FileID"] == 0, "Unresolved external asset PPtr: " + str(pointer(ptr)))
        pid = ptr["m_PathID"]
        require(pid in self.rows, "Missing local asset PPtr: " + str(pid))
        actual, data = self.rows[pid]
        require(kind is None or actual == kind, "PPtr " + str(pid) + " has type " + actual)
        return pid, data

    def asset(self, path):
        matches = []
        for kind, data in self.rows.values():
            if kind == "AssetBundle":
                matches.extend(value["asset"] for key, value in data["m_Container"] if key == path)
        require(len(matches) == 1, "Expected exactly one native container entry: " + path)
        return self.get(matches[0], "GameObject")

    def hierarchy(self, root):
        transforms = {pid: data for pid, (kind, data) in self.rows.items() if kind == "Transform"}
        by_go = {data["m_GameObject"]["m_PathID"]: pid for pid, data in transforms.items()}
        require(root in by_go, "Native prefab has no root Transform")
        paths, visited = {}, set()

        def visit(tid, prefix):
            require(tid not in visited, "Duplicate/cyclic native Transform reference")
            visited.add(tid)
            require(tid in transforms, "Missing native child Transform: " + str(tid))
            transform = transforms[tid]
            gid, go = self.get(transform["m_GameObject"], "GameObject")
            path = prefix + "/" + go["m_Name"] if prefix else go["m_Name"]
            paths[gid] = path
            for child in transform["m_Children"]:
                require(child["m_FileID"] == 0, "External native child Transform")
                visit(child["m_PathID"], path)

        visit(by_go[root], "")
        return paths


class Scripts:
    def __init__(self, bundle):
        self.bundle = bundle

    def resolve(self, owner, pid, data):
        ptr = data["m_Script"]
        fid = ptr["m_FileID"]
        require(fid > 0, "Expected official external MonoScript PPtr")
        externals = owner.objects[pid].assets_file.externals
        require(fid <= len(externals), "MonoScript external index out of range")
        native_file = externals[fid - 1].path.replace("\\", "/").split("/")[-1]
        sid = ptr["m_PathID"]
        require(sid in self.bundle.rows, "Unresolved MonoScript: " + str(sid))
        obj = self.bundle.objects[sid]
        require(obj.assets_file.name == native_file, "MonoScript external CAB does not match input")
        kind, script = self.bundle.rows[sid]
        require(kind == "MonoScript", "Script PPtr does not point to MonoScript")
        return {"pointer": pointer(ptr), "serializedFile": native_file,
                "className": script["m_ClassName"], "namespace": script["m_Namespace"],
                "assembly": script["m_AssemblyName"]}

    def verify(self, owner, pid, data, namespace, class_name):
        script = self.resolve(owner, pid, data)
        require((script["namespace"], script["className"]) == (namespace, class_name),
                "Unexpected native class: " + script["namespace"] + "." + script["className"])
        return script


MODEL_TYPES = {"GameObject", "Transform", "MonoBehaviour", "AssetBundle", "Material", "Texture2D", "TextAsset"}


def texture_record(bundle, pid, data):
    return {"pathId": str(pid), "name": data["m_Name"], "width": data["m_Width"],
            "height": data["m_Height"], "format": data["m_TextureFormat"],
            "stream": data.get("m_StreamData")}


def skeleton_chain(bundle, scripts, pid, data, go_path):
    renderer_script = scripts.verify(bundle, pid, data, "Spine.Unity", "SkeletonAnimation")
    sda_id, sda = bundle.get(data["skeletonDataAsset"], "MonoBehaviour")
    scripts.verify(bundle, sda_id, sda, "Spine.Unity", "SkeletonDataAsset")
    skel_id, skel = bundle.get(sda["skeletonJSON"], "TextAsset")
    require(len(sda["atlasAssets"]) == 1, "Expected one native Spine atlas asset")
    atlas_id, atlas_asset = bundle.get(sda["atlasAssets"][0], "MonoBehaviour")
    scripts.verify(bundle, atlas_id, atlas_asset, "Spine.Unity", "SpineAtlasAsset")
    text_id, atlas = bundle.get(atlas_asset["atlasFile"], "TextAsset")
    require(len(atlas_asset["materials"]) == 1, "Expected one native Spine material")
    material_id, material = bundle.get(atlas_asset["materials"][0], "Material")
    saved = material["m_SavedProperties"]
    texenvs = dict(saved["m_TexEnvs"])
    require("_MainTex" in texenvs, "Native material lacks _MainTex")
    texture_id, texture = bundle.get(texenvs["_MainTex"]["m_Texture"], "Texture2D")
    alpha = texenvs.get("_AlphaTex", {}).get("m_Texture")
    alpha_record = None
    if alpha and alpha["m_PathID"]:
        alpha_id, alpha_data = bundle.get(alpha, "Texture2D")
        alpha_record = texture_record(bundle, alpha_id, alpha_data)
    floats = dict(saved["m_Floats"])
    atlas_text = text_bytes(atlas).decode("utf-8")
    return {"rendererPathId": str(pid), "goPath": go_path, "rendererScript": renderer_script,
            "skeletonDataPathId": str(sda_id),
            "skeleton": {"pathId": str(skel_id), "name": skel["m_Name"], "bytes": len(text_bytes(skel))},
            "atlasAssetPathId": str(atlas_id),
            "atlas": {"pathId": str(text_id), "name": atlas["m_Name"],
                      "bytes": len(text_bytes(atlas)), "page": atlas_text.strip().splitlines()[0]},
            "material": {"pathId": str(material_id), "name": material["m_Name"],
                         "useAlphaTex": floats.get("_UseAlphaTex"), "useBleed": floats.get("_UseBleed")},
            "mainTexture": texture_record(bundle, texture_id, texture), "alphaTexture": alpha_record}


def body_evidence(character, bundle, scripts):
    container = "dyn/battle/prefabs/skins/character/" + character + "/defaultskin.prefab"
    root, _ = bundle.asset(container)
    hierarchy = bundle.hierarchy(root)
    animators, renderers, faces = [], [], []
    for pid, (kind, data) in bundle.rows.items():
        if kind != "MonoBehaviour" or data["m_GameObject"]["m_PathID"] not in hierarchy:
            continue
        script = scripts.resolve(bundle, pid, data)
        path = hierarchy[data["m_GameObject"]["m_PathID"]]
        if data["m_GameObject"]["m_PathID"] == root:
            animators.append((pid, data, script))
        if (script["namespace"], script["className"]) == ("Spine.Unity", "SkeletonAnimation"):
            renderers.append((pid, data, path))
        if (script["namespace"], script["className"]) == ("Torappu.Battle", "FaceSwitcher"):
            faces.append({"pathId": str(pid), "goPath": path, "script": script,
                          "switchTime": data["_switchTime"], "defaultLOrR": data["_defaultLOrR"]})
    require(len(animators) == 1, "Expected one default root animator for " + character)
    aid, animator, _ = animators[0]
    animator_script = scripts.verify(bundle, aid, animator, "Torappu.Battle", "SingleSpineAnimator")
    require(len(renderers) == 1, "Default prefab does not have exactly one SkeletonAnimation: " + character)
    rid, renderer, path = renderers[0]
    require(animator["_skeleton"]["m_FileID"] == 0 and animator["_skeleton"]["m_PathID"] == rid,
            "Default animator _skeleton does not point to the sole renderer")
    require(len(faces) == 1, "Expected one native FaceSwitcher component: " + character)
    face = animator["_faceSwitcher"]
    require(face["m_FileID"] == 0 and (face["m_PathID"] == 0 or str(face["m_PathID"]) == faces[0]["pathId"]),
            "Default animator has unresolved FaceSwitcher reference")
    return {"characterId": character, "source": bundle.source, "containerPath": container,
            "rootGameObjectPathId": str(root), "hierarchy": sorted(hierarchy.values()),
            "animator": {"pathId": str(aid), "script": animator_script,
                         "skeletonPointer": pointer(animator["_skeleton"]), "faceSwitcherPointer": pointer(face)},
            "faceSwitcher": faces[0], "skeletonAnimationCount": len(renderers),
            "nativeSingleSpine": True, "directionModelSharing": "native-single-spine",
            "chain": skeleton_chain(bundle, scripts, rid, renderer, path)}


def cathy_evidence(bundle, scripts):
    container = "dyn/battle/prefabs/[uc]tokens/" + CATHY_ID + ".prefab"
    root, _ = bundle.asset(container)
    hierarchy = bundle.hierarchy(root)
    matches = []
    for pid, (kind, data) in bundle.rows.items():
        gid = data.get("m_GameObject", {}).get("m_PathID")
        if kind == "MonoBehaviour" and gid in hierarchy and "skeletonDataAsset" in data:
            chain = skeleton_chain(bundle, scripts, pid, data, hierarchy[gid])
            if chain["mainTexture"]["pathId"] == str(CATHY_TEXTURE):
                matches.append(chain)
    require(len(matches) == 1, "Cathy exact Texture2D is not uniquely linked by native material")
    chain = matches[0]
    require((chain["mainTexture"]["width"], chain["mainTexture"]["height"]) == (216, 216),
            "Cathy native texture has unexpected dimensions")
    image = bundle.objects[CATHY_TEXTURE].read().image
    require(image.size == (216, 216) and image.mode == "RGBA", "Cathy native RGBA decoding failed")
    return {"characterId": CATHY_ID, "source": bundle.source, "containerPath": container,
            "rootGameObjectPathId": str(root), "chain": chain,
            "decoded": {"width": image.width, "height": image.height, "mode": image.mode,
                        "alphaExtrema": list(image.getchannel("A").getextrema()),
                        "alphaBBox": image.getchannel("A").getbbox()},
            "output": {"path": absolute(CATHY_OUTPUT), "status": "not-requested"}}, image


def export_cathy(target_text, image):
    from PIL import Image

    target = Path(target_text)
    require(target.is_absolute(), "--export-cathy requires an absolute path")
    require(target == CATHY_OUTPUT, "--export-cathy permits only " + absolute(CATHY_OUTPUT))
    # Existing directories must already belong to the formal input tree. Do not
    # create directories or follow a link/reparse point when adding an asset.
    for ancestor in (target.parent, *target.parent.parents):
        info = ancestor.lstat()
        require(stat.S_ISDIR(info.st_mode), "PNG parent is not a directory: " + absolute(ancestor))
        require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, "st_file_attributes", 0) & 0x400),
                "PNG parent is a link/reparse point: " + absolute(ancestor))

    def reuse():
        info = target.lstat()
        require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode)
                and not (getattr(info, "st_file_attributes", 0) & 0x400), "Existing PNG is not a regular file")
        with Image.open(target) as existing:
            require(existing.format == "PNG", "Existing output is not a PNG")
            size = list(existing.size)
            existing.verify()
        return {"path": absolute(target), "status": "reused", "bytes": info.st_size, "size": size}

    if target.exists() or target.is_symlink():
        return reuse()
    encoded = io.BytesIO()
    image.save(encoded, format="PNG")
    try:
        with target.open("xb") as output:
            output.write(encoded.getvalue())
    except FileExistsError:
        return reuse()
    return {"path": absolute(target), "status": "created", "bytes": target.stat().st_size,
            "size": list(image.size)}


def probe_toledo_index(version):
    require(version == TOLEDO_VERSION, "Toledo index probe supports only the verified official native version")
    base = "https://ak.hycdn.cn/assetbundle/official/Android/assets/" + version + "/"
    with urllib.request.urlopen(base + "hot_update_list.json", timeout=30) as response:
        manifest_raw = response.read(4 * 1024 * 1024 + 1)
    require(len(manifest_raw) <= 4 * 1024 * 1024, "official manifest exceeds bounded RAM limit")
    manifest = json.loads(manifest_raw)
    require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V078",
            "official native manifest version identity mismatch")
    records = [x for x in manifest.get("abInfos", []) if isinstance(x, dict) and x.get("name") == TOLEDO_INDEX]
    require(len(records) == 1, "official manifest does not uniquely list the resolved native index")
    with urllib.request.urlopen(base + TOLEDO_INDEX.replace("/", "_").replace(".idx", ".dat"), timeout=60) as response:
        archive_bytes = response.read(4 * 1024 * 1024 + 1)
    require(len(archive_bytes) <= 4 * 1024 * 1024, "native index raw package exceeds bounded RAM limit")
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        require(len(members) == 1 and members[0].filename == TOLEDO_INDEX,
                "native index package member does not match official manifest")
        idx = archive.read(members[0])
    require(len(idx) <= 36 * 1024 * 1024, "expanded native index exceeds bounded RAM limit")
    mappings = parse_native_index_mapping(idx, manifest)
    tokens = ("token_10066_closur_ourbase", "token_10067_toledo_tldptm", "token_10068_kalts2_mtship")
    rows = []
    for token in tokens:
        needle = ("dyn/battle/prefabs/[uc]tokens/" + token + ".prefab").encode("utf-8")
        offsets, start = [], 0
        while True:
            offset = idx.find(needle, start)
            if offset < 0:
                break
            offsets.append(offset)
            start = offset + len(needle)
        row = {"path": needle.decode(), "nameOffsets": offsets}
        if offsets:
            pos = offsets[0]
            record_offset = pos - 20
            fields = struct.unpack("<5I", idx[record_offset:record_offset + 20])
            row["recordOffset"] = record_offset
            row["recordFieldsLE"] = {"idxRecordLeadingU32": fields[0], "field1": fields[1], "field2": fields[2],
                                      "field3": fields[3], "pathByteLength": fields[4]}
            row["rawContextHex"] = idx[max(0, pos - 48):pos + len(needle) + 64].hex()
            row["beforeFieldsLE"] = [int.from_bytes(idx[pos - distance:pos - distance + 4], "little")
                                      for distance in (20, 16, 12, 8, 4)]
            row["nameRecordBytesBefore"] = idx[max(0, pos - 32):pos].hex()
            row["nameRecordBytesAfter"] = idx[pos + len(needle):pos + len(needle) + 32].hex()
            # Preserve raw field windows around the previously indexed record without
            # assuming that the name offset itself is the index record offset.
            for candidate in (pos - 20, pos, pos + len(needle)):
                if 0 <= candidate <= len(idx) - 24:
                    row.setdefault("fieldWindows", []).append({"offset": candidate,
                        "bytes": idx[candidate:candidate + 24].hex()})
        rows.append(row)
    bundle_strings = [{"name": match.group().decode("ascii"), "offset": match.start(),
                       "contextHex": idx[max(0, match.start() - 24):match.end() + 24].hex()}
                      for match in re.finditer(rb"pkgrps[/_]btl_pfb_tokens_[0-9]+\.ab", idx)]
    prefab_paths = len(re.findall(rb"dyn/battle/prefabs/[^\x00]{1,240}\.prefab", idx))
    package_rows = [{"arrayOrdinal": ordinal, "fields": item,
                     "fieldTypes": {key: type(value).__name__ for key, value in item.items()}}
                    for ordinal, item in enumerate(manifest.get("abInfos", []))
                    if isinstance(item, dict) and re.search(r"pkgrps/btl_pfb_tokens_[0-9]+\.ab$", str(item.get("name", "")))]
    return {"nativeVersionId": version, "manifestVersion": manifest["manifestVersion"],
            "manifestRecord": records[0], "rawIndexPackageBytes": len(archive_bytes),
            "expandedIndexBytes": len(idx), "indexMember": TOLEDO_INDEX,
            "idxHeaderHex": idx[:128].hex(), "idxFirstU32LE": [int.from_bytes(idx[i:i + 4], "little") for i in range(0, 32, 4)],
            "prefabPathStringCount": prefab_paths, "bundleNameStringOccurrences": bundle_strings,
            "manifestTokenPackageRows": package_rows,
            "indexEntries": rows,
            "nativeAssetBundleMappings": mappings,
            "officialManifestBytes": len(manifest_raw),
            "targetKnownRecordOffset": 24633936,
            "targetKnownCidOffset": 24633956,
            "payloadDisposition": "RAM-only; no disk write"}


def probe_native_manifest(version):
    require(version == TOLEDO_VERSION, "native manifest probe supports only the verified official version")
    url = "https://ak.hycdn.cn/assetbundle/official/Android/assets/" + version + "/hot_update_list.json"
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    require(len(raw) <= 4 * 1024 * 1024, "official manifest exceeds bounded RAM limit")
    manifest = json.loads(raw)
    require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V078",
            "official native manifest identity mismatch")
    infos = manifest.get("abInfos")
    require(isinstance(infos, list), "official manifest lacks abInfos array")
    positions = {}
    for ordinal in (5447, 5449):
        positions[str(ordinal)] = infos[ordinal] if ordinal < len(infos) else None
    return {"nativeVersionId": version, "manifestVersion": manifest["manifestVersion"],
            "abInfosCount": len(infos), "arrayPositions": positions,
            "recordsWhoseCidEqualsOrdinal": {
                str(ordinal): [item for item in infos if isinstance(item, dict) and item.get("cid") == ordinal]
                for ordinal in (5447, 5449)},
            "payloadDisposition": "manifest RAM only; no disk write"}


def probe_missing_map_owner(version):
    require(version == MAP_OWNER_VERSION, "missing map owner probe supports only the exact official V072 version")
    with urllib.request.urlopen(MAP_OWNER_BASE + "hot_update_list.json", timeout=30) as response:
        manifest_raw = response.read(4 * 1024 * 1024 + 1)
    require(len(manifest_raw) <= 4 * 1024 * 1024, "official V072 manifest exceeds bounded RAM limit")
    manifest = json.loads(manifest_raw)
    require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V072"
            and manifest.get("manifestName") == MAP_OWNER_INDEX,
            "official V072 manifest identity/name mismatch")
    rows = [row for row in manifest.get("abInfos", []) if isinstance(row, dict) and row.get("name") == MAP_OWNER_INDEX]
    require(len(rows) == 1, "official manifest does not uniquely list the exact V072 index")
    package_name = MAP_OWNER_INDEX.replace("/", "_").replace(".idx", ".dat")
    with urllib.request.urlopen(MAP_OWNER_BASE + package_name, timeout=60) as response:
        raw_package = response.read(3_500_001)
    require(len(raw_package) <= 3_500_000, "V072 index raw package exceeds 3.5 MiB RAM cap")
    with zipfile.ZipFile(io.BytesIO(raw_package)) as archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        require(len(members) == 1 and members[0].filename == MAP_OWNER_INDEX,
                "V072 index package member does not match exact official manifest name")
        with archive.open(members[0]) as member:
            index_bytes = member.read(34 * 1024 * 1024 + 1)
    require(len(index_bytes) <= 34 * 1024 * 1024, "V072 expanded index exceeds 34 MiB RAM cap")
    parsed = parse_map_owner_index(index_bytes, manifest)
    target_cid = rows[0].get("cid")
    return {"nativeVersionId": version, "manifestVersion": "V072", "manifestName": MAP_OWNER_INDEX,
            "officialManifestBytes": len(manifest_raw), "indexPackageName": package_name,
            "rawIndexPackageBytes": len(raw_package), "expandedIndexBytes": len(index_bytes),
            "indexRootOffset": 128 + FlatBufferReader(index_bytes).u32(128),
            "indexBundleVectorCount": parsed["bundleVectorCount"],
            "indexAssetVectorCount": parsed["assetVectorCount"],
            "manifestIndexRecord": rows[0], "manifestIndexRecordFieldTypes":
                {key: type(value).__name__ for key, value in rows[0].items()},
            "targetIndexManifestCid": target_cid,
            "candidateBundleSlots": parsed["candidateBundleSlots"],
            "relevantMapDossShoreMeshRows": parsed["relevantMapDossShoreMeshRows"],
            "meshPathId": "-4487102536378500135", "targetCab": "c2c688f710a565b7cce0cc93f7bd219f",
            "ownerConclusion": "unresolved unless an exact map Mesh source row is present; index rows alone do not prove the CAB/PPtr owner",
            "payloadDisposition": "RAM only; no index or bundle written to disk"}


def probe_map_mesh_owner(version):
    require(version == MAP_OWNER_VERSION, "map mesh owner probe supports only the exact official V072 version")
    with urllib.request.urlopen(MAP_OWNER_BASE + "hot_update_list.json", timeout=30) as response:
        manifest_raw = response.read(4 * 1024 * 1024 + 1)
    require(len(manifest_raw) <= 4 * 1024 * 1024, "official V072 manifest exceeds bounded RAM limit")
    manifest = json.loads(manifest_raw)
    require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V072"
            and manifest.get("manifestName") == MAP_OWNER_INDEX,
            "official V072 manifest identity/name mismatch")
    records = {}
    for name in MAP_OWNER_BUNDLES:
        matches = [row for row in manifest.get("abInfos", [])
                   if isinstance(row, dict) and row.get("name") == name]
        require(len(matches) == 1, "official V072 manifest does not uniquely list exact candidate: " + name)
        records[name] = matches[0]

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import fetch_scenes
    import aklz4  # noqa: F401; registers the repository's existing Arknights LZHAM-flag decoder
    import gc
    import UnityPy
    base = fetch_scenes.CDN.format(platform="Android", version=version)
    results, total_raw = [], 0
    for name in MAP_OWNER_BUNDLES:
        package_name = fetch_scenes.dat_name(name)
        raw_cap = min(3_500_000, 10 * 1024 * 1024 - total_raw)
        require(raw_cap > 0, "candidate carrier raw total reached 10 MiB cap")
        raw = fetch_scenes.get(base + package_name, raw_cap)
        raw_bytes = len(raw)
        total_raw += len(raw)
        require(total_raw <= 10 * 1024 * 1024, "candidate carrier raw total exceeds 10 MiB cap")
        native = fetch_scenes.unpack_bundle(raw, name, 32 * 1024 * 1024)
        del raw
        env = UnityPy.load(native)
        serialized = list(env.get_files()) if hasattr(env, "get_files") else list(env.files.values())
        # UnityPy environments expose bundle members through each file's recursive get_assets().
        members = []
        for root in serialized:
            if hasattr(root, "get_assets"):
                members.extend(list(root.get_assets()))
            elif hasattr(root, "objects"):
                members.append(root)
        unique = {id(item): item for item in members}
        rows = []
        for asset_file in unique.values():
            if not hasattr(asset_file, "objects") or not hasattr(asset_file, "externals"):
                continue
            matches = []
            for path_id, obj in asset_file.objects.items():
                if path_id == MAP_OWNER_MESH_PATH_ID:
                    matches.append({"pathId": str(path_id), "type": getattr(getattr(obj, "type", None), "name", None)})
            rows.append({"serializedFileName": asset_file.name, "cabFile": getattr(asset_file, "cab_file", None),
                         "externalNames": [getattr(item, "path", None) for item in asset_file.externals],
                         "targetPathIdMatches": matches})
        results.append({"bundleName": name, "manifestRecord": records[name],
                        "carrierName": package_name, "carrierRawBytes": raw_bytes,
                        "expandedUnityBundleBytes": len(native), "serializedFiles": rows})
        del env, native, members, unique
        gc.collect()
    return {"nativeVersionId": version, "manifestVersion": "V072", "manifestName": MAP_OWNER_INDEX,
            "targetCab": MAP_OWNER_CAB, "targetMeshPathId": str(MAP_OWNER_MESH_PATH_ID),
            "candidateBundles": results, "totalRawCarrierBytes": total_raw,
            "ownerMatches": [row for bundle in results for sf in bundle["serializedFiles"]
                             for row in sf["targetPathIdMatches"]
                             if exact_mesh_owner(sf["serializedFileName"], row["pathId"], row["type"])],
            "interpretation": "Only a SerializedFile named exactly by target CAB and a matching pathID typed Mesh is an owner proof; no match means unresolved, not absent.",
            "payloadDisposition": "RAM only; candidate carriers processed sequentially and released"}


def probe_map_emission_owner(version):
    bundle_name = MAP_EMISSION_OWNER_BUNDLE
    base = {"nativeVersionId": version, "manifestVersion": "V072", "manifestName": MAP_OWNER_INDEX,
            "candidateBundleName": bundle_name, "targetCab": MAP_EMISSION_OWNER_CAB,
            "targetPathId": str(MAP_EMISSION_OWNER_PATH_ID), "ownerResolved": False,
            "carrierDownloaded": False, "metadataSource": "single exact official V072 manifest row",
            "thresholds": {"rawPackageBytes": MAP_EMISSION_OWNER_RAW_LIMIT,
                           "expandedBundleBytes": MAP_EMISSION_OWNER_EXPANDED_LIMIT},
            "payloadDisposition": "RAM only; target object directory metadata only; no typetree or export"}
    if version != MAP_OWNER_VERSION:
        return {**base, "status": "rejected-before-carrier-fetch", "failureStage": "native-version-gate",
                "firstError": "emission owner probe supports only exact official V072"}
    manifest_raw = None
    try:
        with urllib.request.urlopen(MAP_OWNER_BASE + "hot_update_list.json", timeout=30) as response:
            manifest_raw = response.read(4 * 1024 * 1024 + 1)
        require(len(manifest_raw) <= 4 * 1024 * 1024, "official V072 manifest exceeds bounded RAM limit")
        manifest = json.loads(manifest_raw)
        require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V072"
                and manifest.get("manifestName") == MAP_OWNER_INDEX,
                "official V072 manifest identity/name mismatch")
        record = exact_manifest_record(manifest, bundle_name)
    except Exception as error:
        return {**base, "status": "rejected-during-official-manifest-read", "failureStage": "official-manifest",
                "officialManifestBytes": len(manifest_raw) if manifest_raw is not None else None,
                "firstError": str(error)}
    base.update({"officialManifestBytes": len(manifest_raw), "candidateManifestRecord": record,
                 "candidateManifestRecordFieldTypes": {key: type(value).__name__ for key, value in record.items()}})
    gated = dependency_carrier_gate(base, MAP_EMISSION_OWNER_RAW_LIMIT, MAP_EMISSION_OWNER_EXPANDED_LIMIT)
    if gated["status"] != "within-carrier-size-limits":
        return gated
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import fetch_scenes
    import aklz4  # noqa: F401; registers the existing native decoder
    import gc
    import UnityPy
    package_name = fetch_scenes.dat_name(bundle_name)
    raw = None
    try:
        raw = fetch_scenes.get(MAP_OWNER_BASE + package_name, MAP_EMISSION_OWNER_RAW_LIMIT)
        require(len(raw) == record["totalSize"], "carrier raw bytes differ from official manifest totalSize")
        native = fetch_scenes.unpack_bundle(raw, bundle_name, MAP_EMISSION_OWNER_EXPANDED_LIMIT)
        require(len(native) == record["abSize"], "expanded carrier bytes differ from official manifest abSize")
        env = UnityPy.load(native)
        serialized = list(env.get_files()) if hasattr(env, "get_files") else list(env.files.values())
        members = []
        for root in serialized:
            if hasattr(root, "get_assets"):
                members.extend(list(root.get_assets()))
            elif hasattr(root, "objects"):
                members.append(root)
        unique = {id(item): item for item in members}
        rows, owner_matches = [], []
        for asset_file in unique.values():
            if not hasattr(asset_file, "objects"):
                continue
            matches = []
            for path_id, obj in asset_file.objects.items():
                if str(path_id) == str(MAP_EMISSION_OWNER_PATH_ID):
                    row = {"pathId": str(path_id), "type": getattr(getattr(obj, "type", None), "name", None)}
                    matches.append(row)
                    if exact_emission_texture_owner(getattr(asset_file, "name", None), path_id):
                        owner_matches.append({"serializedFileName": str(asset_file.name), **row})
            rows.append({"serializedFileName": str(getattr(asset_file, "name", "")),
                         "targetPathIdMatches": matches})
        result = {**gated, "status": "pass", "carrierDownloaded": True,
                  "carrierPackageName": package_name, "actualRawPackageBytes": len(raw),
                  "actualExpandedBundleBytes": len(native), "serializedFiles": rows,
                  "ownerMatches": owner_matches, "ownerResolved": bool(owner_matches)}
        del env, native, members, unique
        gc.collect()
        return result
    except Exception as error:
        return {**gated, "status": "rejected-during-carrier-fetch-or-parse",
                "failureStage": "official-carrier-fetch-or-object-directory", "carrierDownloaded": raw is not None,
                "carrierPackageName": package_name,
                "actualRawPackageBytes": len(raw) if raw is not None else None,
                "actualPackageFormat": dependency_package_format(raw, bundle_name) if raw is not None else None,
                "firstError": str(error)}


def probe_map_source_pointer(version):
    bundle_name = MAP_SOURCE_SCENE_BUNDLE
    base = {"nativeVersionId": version, "manifestVersion": "V072", "manifestName": MAP_OWNER_INDEX,
            "sceneBundleName": bundle_name, "targetPathId": str(MAP_OWNER_MESH_PATH_ID),
            "targetCab": MAP_OWNER_CAB, "ownerResolved": False, "payloadDisposition": "metadata only until exact row and limits pass"}
    if version != MAP_OWNER_VERSION:
        return {**base, "status": "rejected-before-scene-fetch", "failureStage": "native-version-gate",
                "firstError": "source-pointer probe supports only exact official V072"}
    manifest_raw = None
    try:
        with urllib.request.urlopen(MAP_OWNER_BASE + "hot_update_list.json", timeout=30) as response:
            manifest_raw = response.read(4 * 1024 * 1024 + 1)
        require(len(manifest_raw) <= 4 * 1024 * 1024, "official V072 manifest exceeds bounded RAM limit")
        manifest = json.loads(manifest_raw)
        require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V072"
                and manifest.get("manifestName") == MAP_OWNER_INDEX,
                "official V072 manifest identity/name mismatch")
        record = exact_manifest_record(manifest, bundle_name)
    except Exception as error:
        return {**base, "status": "rejected-during-official-manifest-read", "failureStage": "official-manifest",
                "officialManifestBytes": len(manifest_raw) if manifest_raw is not None else None,
                "firstError": str(error)}
    base.update({"officialManifestBytes": len(manifest_raw), "candidateManifestRecord": record,
                 "candidateManifestRecordFieldTypes": {key: type(value).__name__ for key, value in record.items()},
                 "metadataSource": "single official V072 manifest RAM read"})
    try:
        raw_limit, expanded_limit = MAP_SOURCE_SCENE_RAW_LIMIT, MAP_SOURCE_SCENE_EXPANDED_LIMIT
        raw_size, expanded_size = dependency_carrier_size_limits(record, raw_limit, expanded_limit)
    except Exception as error:
        base.update({"status": "rejected-before-scene-fetch", "failureStage": "official-manifest-size-gate",
                     "thresholds": {"rawPackageBytes": MAP_SOURCE_SCENE_RAW_LIMIT,
                                    "expandedBundleBytes": MAP_SOURCE_SCENE_EXPANDED_LIMIT},
                     "ownerResolved": False, "carrierDownloaded": False, "firstError": str(error)})
        return base
    base.update({"thresholds": {"rawPackageBytes": raw_limit, "expandedBundleBytes": expanded_limit},
                 "manifestRawPackageBytes": raw_size, "manifestExpandedBundleBytes": expanded_size,
                 "carrierDownloaded": False})
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import fetch_scenes
    package_name = fetch_scenes.dat_name(bundle_name)
    raw = None
    native = None
    try:
        raw = fetch_scenes.get(MAP_OWNER_BASE + package_name, raw_limit)
        require(len(raw) == raw_size, "scene raw package bytes differ from official totalSize")
        native = fetch_scenes.unpack_bundle(raw, bundle_name, expanded_limit)
        require(len(native) == expanded_size, "scene expanded bytes differ from official abSize")
        import aklz4  # noqa: F401; registers the existing native Unity decoder
        import UnityPy
        env = UnityPy.load(native)
        objects = list(env.objects)
        unity_versions = sorted({str(getattr(asset, "unity_version", "")) for asset in env.assets
                                 if getattr(asset, "unity_version", "")})
    except Exception as error:
        return {**base, "status": "rejected-during-scene-fetch-or-load",
                "failureStage": "scene-fetch-or-unity-load", "firstError": str(error),
                "carrierDownloaded": raw is not None,
                "actualRawPackageBytes": len(raw) if raw is not None else None,
                "actualExpandedBundleBytes": len(native) if native is not None else None,
                "carrierPackageName": package_name,
                "actualPackageFormat": dependency_package_format(raw, bundle_name) if raw is not None else None}

    target_refs = []
    failures = []
    preload_matches = []
    container_matches = []
    material_texture_matches = []
    inspected_counts = {"MeshFilter": 0, "MeshRenderer": 0, "Material": 0, "AssetBundle": 0}
    for obj in objects:
        kind = getattr(getattr(obj, "type", None), "name", "")
        if kind not in inspected_counts:
            continue
        inspected_counts[kind] += 1
        try:
            data = obj.read()
        except Exception as error:
            failures.append({"ownerType": kind, "ownerPathId": str(obj.path_id), "stage": "object-read", "error": str(error)})
            continue
        if kind == "MeshFilter":
            ptr = getattr(data, "m_Mesh", None)
            if ptr is not None and int(getattr(ptr, "m_PathID", 0)) == MAP_OWNER_MESH_PATH_ID:
                target_refs.append(source_pointer_evidence(obj, ptr, "MeshFilter.m_Mesh"))
        elif kind == "AssetBundle":
            for index, ptr in enumerate(getattr(data, "m_PreloadTable", []) or []):
                if int(getattr(ptr, "m_PathID", 0)) == MAP_OWNER_MESH_PATH_ID:
                    preload_matches.append(source_pointer_evidence(obj, ptr, f"AssetBundle.m_PreloadTable[{index}]"))
            for path, ptr in getattr(data, "m_Container", []) or []:
                if int(getattr(ptr, "m_PathID", 0)) == MAP_OWNER_MESH_PATH_ID:
                    container_matches.append({"containerPath": str(path),
                                              **source_pointer_evidence(obj, ptr, "AssetBundle.m_Container.asset")})
        elif kind == "MeshRenderer":
            for index, mat_ptr in enumerate(getattr(data, "m_Materials", []) or []):
                if int(getattr(mat_ptr, "m_PathID", 0)) == MAP_OWNER_MESH_PATH_ID:
                    target_refs.append(source_pointer_evidence(obj, mat_ptr, f"MeshRenderer.m_Materials[{index}]"))
                try:
                    mat_obj = mat_ptr.deref()
                    if mat_obj.type.name != "Material":
                        continue
                    mat_data = mat_obj.read()
                    inspected_counts["Material"] += 1
                    saved = getattr(mat_data, "m_SavedProperties", None)
                    for slot, texenv in getattr(saved, "m_TexEnvs", []) or []:
                        tex_ptr = getattr(texenv, "m_Texture", None)
                        if tex_ptr is not None and int(getattr(tex_ptr, "m_PathID", 0)) == MAP_OWNER_MESH_PATH_ID:
                            material_texture_matches.append({"materialPathId": str(mat_obj.path_id), "slot": str(slot),
                                **source_pointer_evidence(mat_obj, tex_ptr,
                                    f"Material.m_SavedProperties.m_TexEnvs[{slot}].m_Texture")})
                except Exception:
                    continue
    resolved = [row for row in target_refs + preload_matches + container_matches + material_texture_matches
                if row.get("resolverStatus") == "resolved" and
                row.get("resolvedSerializedFile", "").casefold() == ("CAB-" + MAP_OWNER_CAB).casefold() and
                int(row.get("resolvedPathId", 0)) == MAP_OWNER_MESH_PATH_ID and row.get("resolvedUnityType") == "Mesh"]
    del env, native, raw, objects
    return {**base, "status": "pass", "carrierDownloaded": True,
            "carrierPackageName": package_name, "actualRawPackageBytes": raw_size,
            "actualExpandedBundleBytes": expanded_size, "unityPyVersion": getattr(UnityPy, "__version__", "unknown"),
            "unityVersions": unity_versions,
            "inspectedObjectCounts": inspected_counts, "targetPPtrs": target_refs,
            "assetBundlePreloadMatches": preload_matches, "assetBundleContainerMatches": container_matches,
            "materialTextureMatches": material_texture_matches, "objectReadFailures": failures[:20],
            "ownerResolved": bool(resolved), "ownerMatches": resolved,
            "payloadDisposition": "one official scene package RAM only; selective Unity object reads; no typetree sweep or disk staging"}


def probe_map_shore_res_pointer(version):
    bundle_name = MAP_SHORE_RES_BUNDLE
    raw_limit, expanded_limit = MAP_SHORE_RES_RAW_LIMIT, MAP_SHORE_RES_EXPANDED_LIMIT
    base = {"nativeVersionId": version, "manifestVersion": "V072", "manifestName": MAP_OWNER_INDEX,
            "bundleName": bundle_name, "targetPathId": str(MAP_OWNER_MESH_PATH_ID),
            "targetCab": MAP_OWNER_CAB, "thresholds": {"rawPackageBytes": raw_limit,
                "expandedBundleBytes": expanded_limit}, "ownerResolved": False,
            "carrierDownloaded": False, "metadataSource": "one official V072 manifest RAM read"}
    if version != MAP_OWNER_VERSION:
        return {**base, "status": "rejected-before-bundle-fetch", "failureStage": "native-version-gate",
                "firstError": "shore res pointer probe supports only exact official V072"}
    manifest_raw = None
    try:
        with urllib.request.urlopen(MAP_OWNER_BASE + "hot_update_list.json", timeout=30) as response:
            manifest_raw = response.read(4 * 1024 * 1024 + 1)
        require(len(manifest_raw) <= 4 * 1024 * 1024, "official V072 manifest exceeds bounded RAM limit")
        manifest = json.loads(manifest_raw)
        require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V072"
                and manifest.get("manifestName") == MAP_OWNER_INDEX,
                "official V072 manifest identity/name mismatch")
        record = exact_manifest_record(manifest, bundle_name)
    except Exception as error:
        return {**base, "status": "rejected-during-official-manifest-read", "failureStage": "official-manifest",
                "officialManifestBytes": len(manifest_raw) if manifest_raw is not None else None,
                "firstError": str(error)}
    base.update({"officialManifestBytes": len(manifest_raw), "candidateManifestRecord": record,
                 "candidateManifestRecordFieldTypes": {key: type(value).__name__ for key, value in record.items()}})
    try:
        raw_size, expanded_size = dependency_carrier_size_limits(record, raw_limit, expanded_limit)
    except Exception as error:
        return {**base, "status": "rejected-before-bundle-fetch", "failureStage": "official-manifest-size-gate",
                "firstError": str(error), "carrierDownloaded": False}
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import fetch_scenes
    package_name = fetch_scenes.dat_name(bundle_name)
    raw = native = None
    try:
        raw = fetch_scenes.get(MAP_OWNER_BASE + package_name, raw_limit)
        require(len(raw) == raw_size, "shore res raw package bytes differ from official totalSize")
        native = fetch_scenes.unpack_bundle(raw, bundle_name, expanded_limit)
        require(len(native) == expanded_size, "shore res expanded bytes differ from official abSize")
        import aklz4  # noqa: F401; register the existing official Unity decoder
        import UnityPy
        env = UnityPy.load(native)
        objects = list(env.objects)
        serialized_files = []
        seen_files = set()
        for obj in objects:
            assets_file = obj.assets_file
            if id(assets_file) in seen_files:
                continue
            seen_files.add(id(assets_file))
            target_obj = assets_file.objects.get(MAP_OWNER_MESH_PATH_ID)
            externals = [{"indexZeroBased": index, "path": str(getattr(item, "path", "")),
                          "guid": str(getattr(item, "guid", "")),
                          "type": int(getattr(item, "type", 0))}
                         for index, item in enumerate(getattr(assets_file, "externals", []))]
            serialized_files.append({"serializedFileName": str(assets_file.name),
                "unityVersion": str(getattr(assets_file, "unity_version", "")),
                "objectCount": len(assets_file.objects),
                "targetPathIdObject": None if target_obj is None else {
                    "pathId": str(MAP_OWNER_MESH_PATH_ID), "type": target_obj.type.name},
                "externals": externals})
    except Exception as error:
        return {**base, "status": "rejected-during-bundle-fetch-or-load", "failureStage": "bundle-fetch-or-load",
                "firstError": str(error), "carrierDownloaded": raw is not None,
                "actualRawPackageBytes": len(raw) if raw is not None else None,
                "actualExpandedBundleBytes": len(native) if native is not None else None,
                "carrierPackageName": package_name,
                "actualPackageFormat": dependency_package_format(raw, bundle_name) if raw is not None else None}
    target_refs = []
    read_failures = []
    object_counts = {"MeshFilter": 0, "Material": 0, "MeshRenderer": 0}
    for obj in objects:
        kind = obj.type.name
        if kind not in object_counts:
            continue
        object_counts[kind] += 1
        try:
            data = obj.read()
            if kind == "MeshFilter":
                ptr = getattr(data, "m_Mesh", None)
                if ptr is not None and int(ptr.m_PathID) == MAP_OWNER_MESH_PATH_ID:
                    owner_name = None
                    try:
                        owner_name = data.m_GameObject.deref().read().m_Name
                    except Exception:
                        pass
                    target_refs.append(source_pointer_evidence(obj, ptr, "MeshFilter.m_Mesh", owner_name))
            elif kind == "Material":
                ptr = getattr(data, "m_Shader", None)
                if ptr is not None and int(ptr.m_PathID) == MAP_OWNER_MESH_PATH_ID:
                    target_refs.append(source_pointer_evidence(obj, ptr, "Material.m_Shader", getattr(data, "m_Name", None)))
                saved = getattr(data, "m_SavedProperties", None)
                for slot, texenv in getattr(saved, "m_TexEnvs", []) or []:
                    ptr = getattr(texenv, "m_Texture", None)
                    if ptr is not None and int(ptr.m_PathID) == MAP_OWNER_MESH_PATH_ID:
                        target_refs.append(source_pointer_evidence(obj, ptr,
                            f"Material.m_SavedProperties.m_TexEnvs[{slot}].m_Texture", getattr(data, "m_Name", None)))
            else:
                for index, ptr in enumerate(getattr(data, "m_Materials", []) or []):
                    if int(ptr.m_PathID) == MAP_OWNER_MESH_PATH_ID:
                        owner_name = None
                        try:
                            owner_name = data.m_GameObject.deref().read().m_Name
                        except Exception:
                            pass
                        target_refs.append(source_pointer_evidence(obj, ptr, f"MeshRenderer.m_Materials[{index}]", owner_name))
        except Exception as error:
            read_failures.append({"serializedFileName": str(obj.assets_file.name), "objectType": kind,
                                  "objectPathId": str(obj.path_id), "error": str(error)})
    owner_matches = [row for row in target_refs if row.get("resolverStatus") == "resolved"
                     and row.get("resolvedSerializedFile", "").casefold() == ("CAB-" + MAP_OWNER_CAB).casefold()
                     and row.get("resolvedUnityType") == "Mesh"
                     and int(row.get("resolvedPathId", 0)) == MAP_OWNER_MESH_PATH_ID]
    unity_versions = sorted({str(getattr(asset, "unity_version", "")) for asset in env.assets
                             if getattr(asset, "unity_version", "")})
    result = {**base, "status": "pass", "candidateManifestRecord": record,
              "actualRawPackageBytes": raw_size, "actualExpandedBundleBytes": expanded_size,
              "carrierPackageName": package_name, "carrierDownloaded": True,
              "unityPyVersion": getattr(UnityPy, "__version__", "unknown"), "unityVersions": unity_versions,
              "serializedFiles": serialized_files, "objectCounts": object_counts,
              "targetPPtrs": target_refs, "objectReadFailures": read_failures[:30],
              "ownerResolved": bool(owner_matches), "ownerMatches": owner_matches,
              "payloadDisposition": "one exact official res.ab RAM only; headers, externals and typed target references only"}
    del env, objects, raw, native
    return result


def probe_map_flow_texture(version):
    """Inspect only the index-proven flow texture dependency and exact target object."""
    bundle_name = MAP_FLOW_TEXTURE_BUNDLE
    raw_limit, expanded_limit = MAP_FLOW_TEXTURE_RAW_LIMIT, MAP_FLOW_TEXTURE_EXPANDED_LIMIT
    assert_exact_flow_texture_target(bundle_name, raw_limit, expanded_limit)
    base = {"nativeVersionId": version, "manifestVersion": "V072", "manifestName": MAP_OWNER_INDEX,
            "bundleName": bundle_name, "targetCab": MAP_OWNER_CAB,
            "targetPathId": str(MAP_OWNER_MESH_PATH_ID),
            "thresholds": {"rawPackageBytes": raw_limit, "expandedBundleBytes": expanded_limit},
            "ownerResolved": False, "carrierDownloaded": False,
            "metadataSource": absolute(MAP_FLOW_TEXTURE_METADATA_RECEIPT)}
    if version != MAP_OWNER_VERSION:
        return {**base, "status": "rejected-before-bundle-fetch", "failureStage": "native-version-gate",
                "firstError": "flow texture probe supports only exact official V072"}
    try:
        metadata_path = MAP_FLOW_TEXTURE_METADATA_RECEIPT
        require(metadata_path.is_file() and not metadata_path.is_symlink(),
                "exact prior flow metadata receipt is unavailable or unsafe")
        saved = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
        saved_result = saved.get("result", {})
        record = saved_result.get("candidateManifestRecord")
        require(saved_result.get("nativeVersionId") == version
                and saved_result.get("manifestVersion") == "V072"
                and saved_result.get("manifestName") == MAP_OWNER_INDEX
                and record and record.get("name") == bundle_name,
                "saved flow metadata receipt does not identify the exact V072 carrier")
        require(record.get("cid") == 13886 and record.get("hash") == "66f306984be1d33690509d1bc057678d"
                and record.get("md5") == "c7aaddbe0410d3f675381a7719c791b7"
                and record.get("totalSize") == 8_850_267 and record.get("abSize") == 9_940_774,
                "saved flow metadata row differs from the independently verified exact row")
    except Exception as error:
        return {**base, "status": "rejected-during-official-manifest-read", "failureStage": "official-manifest",
                "officialManifestBytes": None,
                "firstError": str(error)}
    base.update({"officialManifestBytes": saved_result.get("officialManifestBytes"), "candidateManifestRecord": record,
                 "candidateManifestRecordFieldTypes": saved_result.get("candidateManifestRecordFieldTypes")
                 or {key: type(value).__name__ for key, value in record.items()},
                 "metadataReusedFromReceipt": absolute(MAP_FLOW_TEXTURE_METADATA_RECEIPT)})
    try:
        raw_size, expanded_size = dependency_carrier_size_limits(record, raw_limit, expanded_limit)
    except Exception as error:
        return {**base, "status": "rejected-before-bundle-fetch", "failureStage": "official-manifest-size-gate",
                "firstError": str(error), "carrierDownloaded": False}
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import fetch_scenes
    package_name = fetch_scenes.dat_name(bundle_name)
    raw = native = env = None
    try:
        raw = fetch_scenes.get(MAP_OWNER_BASE + package_name, raw_limit)
        require(len(raw) == raw_size, "flow raw package bytes differ from official totalSize")
        native = fetch_scenes.unpack_bundle(raw, bundle_name, expanded_limit)
        require(len(native) == expanded_size, "flow expanded bundle bytes differ from official abSize")
        import aklz4  # noqa: F401; register the existing official Unity decoder
        import UnityPy
        env = UnityPy.load(native)
        serialized_files = []
        target_rows = []
        for asset_file in env.assets:
            externals = [{"indexZeroBased": index, "path": str(getattr(item, "path", "")),
                          "guid": str(getattr(item, "guid", "")), "type": int(getattr(item, "type", 0))}
                         for index, item in enumerate(getattr(asset_file, "externals", []))]
            obj = asset_file.objects.get(MAP_OWNER_MESH_PATH_ID)
            target = None
            if obj is not None:
                target = {"pathId": str(obj.path_id), "type": getattr(obj.type, "name", None)}
                if target["type"] == "Texture2D":
                    try:
                        data = obj.read()
                        target.update({"name": getattr(data, "m_Name", None),
                                       "width": int(getattr(data, "m_Width")),
                                       "height": int(getattr(data, "m_Height")),
                                       "format": str(getattr(data, "m_TextureFormat", None))})
                    except Exception as error:
                        target["metadataReadError"] = str(error)
                target_rows.append({"serializedFileName": str(asset_file.name), **target})
            serialized_files.append({"serializedFileName": str(asset_file.name),
                "unityVersion": str(getattr(asset_file, "unity_version", "")),
                "objectCount": len(asset_file.objects), "targetPathIdObject": target,
                "externals": externals})
    except Exception as error:
        return {**base, "status": "rejected-during-bundle-fetch-or-load", "failureStage": "bundle-fetch-or-load",
                "firstError": str(error), "carrierDownloaded": raw is not None,
                "actualRawPackageBytes": len(raw) if raw is not None else None,
                "actualExpandedBundleBytes": len(native) if native is not None else None,
                "carrierPackageName": package_name,
                "actualPackageFormat": dependency_package_format(raw, bundle_name) if raw is not None else None}
    target_texture = [row for row in target_rows if row.get("type") == "Texture2D"
                      and row.get("serializedFileName", "").casefold() == ("CAB-" + MAP_OWNER_CAB).casefold()]
    result = {**base, "status": "pass", "actualRawPackageBytes": raw_size,
              "actualExpandedBundleBytes": expanded_size, "carrierPackageName": package_name,
              "carrierDownloaded": True, "unityPyVersion": getattr(UnityPy, "__version__", "unknown"),
              "serializedFiles": serialized_files, "targetObjectMatches": target_rows,
              "targetTexture2DMatches": target_texture, "ownerResolved": bool(target_texture),
              "payloadDisposition": "one exact flow.ab RAM only; SerializedFile directories/externals and target Texture2D header only"}
    del env, raw, native
    return result


def assert_exact_flow_texture_target(bundle_name, raw_limit, expanded_limit):
    require(bundle_name == MAP_FLOW_TEXTURE_BUNDLE, "flow texture carrier is outside the exact verified scope")
    require(raw_limit == MAP_FLOW_TEXTURE_RAW_LIMIT and expanded_limit == MAP_FLOW_TEXTURE_EXPANDED_LIMIT,
            "flow texture carrier requires the exact 12/16 MiB limits")


def inspect_dependency_carrier(raw_package, bundle_name, expanded_limit=MAP_DEPENDENCY_EXPANDED_LIMIT):
    """Inspect one explicitly index-linked .bin carrier without reading object typetrees."""
    require(bundle_name in (MAP_DEPENDENCY_BUNDLE, MAP_DEPENDENCY_SECOND_BUNDLE),
            "dependency carrier is outside the exact verified scope")
    with zipfile.ZipFile(io.BytesIO(raw_package)) as archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        require(len(members) == 1 and members[0].filename == bundle_name,
                "official dependency archive member does not match the exact index bundle name")
        require(members[0].file_size <= expanded_limit,
                f"expanded dependency carrier exceeds {expanded_limit} byte RAM limit")
        with archive.open(members[0]) as member:
            native = member.read(expanded_limit + 1)
    require(len(native) <= expanded_limit, f"expanded dependency carrier exceeds {expanded_limit} byte RAM limit")
    require(native.startswith(b"UnityFS"), "dependency carrier has unsupported non-UnityFS package format")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import aklz4  # noqa: F401; registers the repository's existing decompressor
    import UnityPy
    env = UnityPy.load(native)
    serialized = list(env.get_files()) if hasattr(env, "get_files") else list(env.files.values())
    members = []
    for root in serialized:
        if hasattr(root, "get_assets"):
            members.extend(list(root.get_assets()))
        elif hasattr(root, "objects"):
            members.append(root)
    unique = {id(item): item for item in members}
    rows = []
    for asset_file in unique.values():
        if not hasattr(asset_file, "objects") or not hasattr(asset_file, "externals"):
            continue
        target_matches = []
        for path_id, obj in asset_file.objects.items():
            if path_id == MAP_OWNER_MESH_PATH_ID:
                target_matches.append({"pathId": str(path_id),
                                       "type": getattr(getattr(obj, "type", None), "name", None)})
        externals = [{"path": str(getattr(item, "path", "")),
                      "guid": str(getattr(item, "guid", "")),
                      "type": str(getattr(item, "type", ""))}
                     for item in asset_file.externals]
        rows.append({"serializedFileName": str(asset_file.name),
                     "targetPathIdMatches": target_matches,
                     "externalReferences": externals})
    matches = [{"serializedFileName": row["serializedFileName"], **target}
               for row in rows for target in row["targetPathIdMatches"]
               if exact_mesh_owner(row["serializedFileName"], target["pathId"], target["type"])]
    expanded_bytes = len(native)
    del env, native, members, unique
    return {"serializedFiles": rows, "ownerMatches": matches,
            "actualExpandedBundleBytes": expanded_bytes,
            "payloadDisposition": "RAM only; one exact dependency carrier; object directories and externals only; no typetree"}


def probe_map_dependency_manifest(version):
    require(version == MAP_OWNER_VERSION, "map dependency manifest probe supports only exact official V072")
    with urllib.request.urlopen(MAP_OWNER_BASE + "hot_update_list.json", timeout=30) as response:
        manifest_raw = response.read(4 * 1024 * 1024 + 1)
    require(len(manifest_raw) <= 4 * 1024 * 1024, "official V072 manifest exceeds bounded RAM limit")
    manifest = json.loads(manifest_raw)
    require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V072"
            and manifest.get("manifestName") == MAP_OWNER_INDEX,
            "official V072 manifest identity/name mismatch")
    record = exact_manifest_record(manifest, MAP_DEPENDENCY_BUNDLE)
    return {"nativeVersionId": version, "manifestVersion": "V072",
            "manifestName": MAP_OWNER_INDEX, "officialManifestBytes": len(manifest_raw),
            "candidateBundleName": MAP_DEPENDENCY_BUNDLE,
            "candidateManifestRecord": record,
            "candidateManifestRecordFieldTypes": {key: type(value).__name__ for key, value in record.items()},
            "ownerResolved": False, "carrierDownloaded": False,
            "payloadDisposition": "official manifest RAM only; no index or carrier request"}


def dependency_package_format(raw_package, bundle_name):
    info = {"containerKind": "zip" if zipfile.is_zipfile(io.BytesIO(raw_package)) else "unknown",
            "rawHeaderHex": raw_package[:16].hex(), "rawHeaderAscii": raw_package[:16].decode("ascii", "replace")}
    if info["containerKind"] == "zip":
        with zipfile.ZipFile(io.BytesIO(raw_package)) as archive:
            info["members"] = [{"name": item.filename, "compressedBytes": item.compress_size,
                                "expandedBytes": item.file_size} for item in archive.infolist() if not item.is_dir()]
            exact = [item for item in archive.infolist() if not item.is_dir() and item.filename == bundle_name]
            if len(exact) == 1:
                with archive.open(exact[0]) as member:
                    header = member.read(16)
                info["exactMemberHeaderHex"] = header.hex()
                info["exactMemberHeaderAscii"] = header.decode("ascii", "replace")
    return info


def probe_map_dependency_carrier(version, bundle_name, cid, bundle_hash, raw_size,
                                 expanded_size, raw_limit, expanded_limit):
    require(version == MAP_OWNER_VERSION, "map dependency carrier probe supports only exact official V072")
    record = validate_map_dependency_scope(bundle_name, cid, bundle_hash, raw_size, expanded_size,
                                           raw_limit, expanded_limit)
    metadata = {"nativeVersionId": version, "manifestVersion": "V072", "manifestName": MAP_OWNER_INDEX,
                "candidateBundleName": bundle_name, "candidateManifestRecord": record,
                "candidateManifestRecordFieldTypes": {key: type(value).__name__ for key, value in record.items()},
                "metadataSource": "previous successful metadata-only native receipt; no manifest/index request"}
    gated = dependency_carrier_gate(metadata, raw_limit, expanded_limit)
    if gated["status"] != "within-carrier-size-limits":
        return gated
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import fetch_scenes
    package_name = fetch_scenes.dat_name(bundle_name)
    try:
        raw = fetch_scenes.get(MAP_OWNER_BASE + package_name, raw_limit)
        require(len(raw) == raw_size, "dependency package actual raw bytes do not match official totalSize")
        inspected = inspect_dependency_carrier(raw, bundle_name, expanded_limit)
    except Exception as error:
        return {**gated, "status": "rejected-during-carrier-fetch-or-parse",
                "failureStage": "official-carrier-fetch-or-format", "firstError": str(error),
                "carrierDownloaded": "raw" in locals(),
                "actualRawPackageBytes": len(raw) if "raw" in locals() else None,
                "carrierPackageName": package_name,
                "actualPackageFormat": dependency_package_format(raw, bundle_name) if "raw" in locals() else None}
    return {**gated, "status": "pass", "carrierBundleName": bundle_name,
            "carrierPackageName": package_name, "candidateManifestRecord": gated["candidateManifestRecord"],
            "carrierDownloaded": True, "actualRawPackageBytes": len(raw),
            "manifestExpandedBytes": gated["manifestExpandedBundleBytes"],
            "targetCab": MAP_OWNER_CAB, "targetMeshPathId": str(MAP_OWNER_MESH_PATH_ID), **inspected}


def probe_second_map_dependency_carrier(version):
    bundle_name = MAP_DEPENDENCY_SECOND_BUNDLE
    raw_limit, expanded_limit = MAP_DEPENDENCY_SECOND_RAW_LIMIT, MAP_DEPENDENCY_SECOND_EXPANDED_LIMIT
    base = {"nativeVersionId": version, "manifestVersion": "V072", "manifestName": MAP_OWNER_INDEX,
            "candidateBundleName": bundle_name, "metadataSource": "single official V072 manifest RAM read",
            "thresholds": {"rawPackageBytes": raw_limit, "expandedBundleBytes": expanded_limit},
            "ownerResolved": False, "carrierDownloaded": False}
    if version != MAP_OWNER_VERSION:
        return {**base, "status": "rejected-before-carrier-fetch", "failureStage": "native-version-gate",
                "firstError": "second map dependency probe supports only the exact official V072 version"}
    try:
        with urllib.request.urlopen(MAP_OWNER_BASE + "hot_update_list.json", timeout=30) as response:
            manifest_raw = response.read(4 * 1024 * 1024 + 1)
        require(len(manifest_raw) <= 4 * 1024 * 1024, "official V072 manifest exceeds bounded RAM limit")
        manifest = json.loads(manifest_raw)
        require(manifest.get("versionId") == version and manifest.get("manifestVersion") == "V072"
                and manifest.get("manifestName") == MAP_OWNER_INDEX,
                "official V072 manifest identity/name mismatch")
        record = exact_manifest_record(manifest, bundle_name)
    except Exception as error:
        return {**base, "status": "rejected-during-official-manifest-read", "failureStage": "official-manifest",
                "officialManifestBytes": len(manifest_raw) if "manifest_raw" in locals() else None,
                "firstError": str(error)}
    base.update({"officialManifestBytes": len(manifest_raw), "candidateManifestRecord": record,
                 "candidateManifestRecordFieldTypes": {key: type(value).__name__ for key, value in record.items()}})
    gated = dependency_carrier_gate(base, raw_limit, expanded_limit)
    if gated["status"] != "within-carrier-size-limits":
        return gated
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import fetch_scenes
    package_name = fetch_scenes.dat_name(bundle_name)
    try:
        raw = fetch_scenes.get(MAP_OWNER_BASE + package_name, raw_limit)
        require(len(raw) == record["totalSize"], "dependency package actual raw bytes do not match official totalSize")
        inspected = inspect_dependency_carrier(raw, bundle_name, expanded_limit)
    except Exception as error:
        return {**gated, "status": "rejected-during-carrier-fetch-or-parse",
                "failureStage": "official-carrier-fetch-or-format", "firstError": str(error),
                "carrierDownloaded": "raw" in locals(),
                "actualRawPackageBytes": len(raw) if "raw" in locals() else None,
                "carrierPackageName": package_name,
                "actualPackageFormat": dependency_package_format(raw, bundle_name) if "raw" in locals() else None}
    return {**gated, "status": "pass", "carrierBundleName": bundle_name,
            "carrierPackageName": package_name, "carrierDownloaded": True,
            "actualRawPackageBytes": len(raw), "actualExpandedBundleBytes": inspected["actualExpandedBundleBytes"],
            "targetCab": MAP_OWNER_CAB, "targetMeshPathId": str(MAP_OWNER_MESH_PATH_ID), **inspected}


def inspect_toledo_bundle(path_text, version):
    require(version == TOLEDO_VERSION, "Toledo bundle inspection supports only the verified official version")
    target = Path(path_text).absolute()
    expected = CANONICAL_ROOT / ".omni/tmp/assault/native-scene-input" / version / TOLEDO_BUNDLE
    require(target == expected, "bundle inspection path is outside the exact canonical Toledo staging target")
    require(target.is_file(), "exact staged Toledo bundle is missing: " + absolute(target))
    import UnityPy
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
    import aklz4  # noqa: F401
    env = UnityPy.load(target.read_bytes())
    objects = list(env.objects)
    bundle_obj = next((obj for obj in objects if obj.type.name == "AssetBundle"), None)
    require(bundle_obj is not None, "staged native bundle has no AssetBundle object")
    bundle_data = bundle_obj.read_typetree()
    terms = ("10067", "toledo", "tldptm")

    def field_refs(value, path=""):
        found = []
        if isinstance(value, dict):
            if "m_FileID" in value and "m_PathID" in value:
                found.append({"field": path, "fileId": value["m_FileID"], "pathId": str(value["m_PathID"])})
            else:
                for key, child in value.items():
                    found.extend(field_refs(child, (path + "." if path else "") + str(key)))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                found.extend(field_refs(child, f"{path}[{index}]"))
        return found

    hits = []
    neighbor_hits = []
    type_counts = {}
    external_ptrs = []
    wanted_types = {"GameObject", "MonoBehaviour", "TextAsset"}
    for obj in objects:
        kind = obj.type.name
        type_counts[kind] = type_counts.get(kind, 0) + 1
        if kind not in wanted_types:
            # Transform and AssetBundle references can own links relevant to the prefab.
            if kind not in {"Transform", "AssetBundle", "MonoScript", "Material", "Texture2D"}:
                continue
        try:
            data = obj.read_typetree()
        except Exception:
            continue
        name = str(data.get("m_Name", ""))
        content = text_bytes(data) if kind == "TextAsset" else b""
        all_refs = field_refs(data)
        for ref in all_refs:
            if ref["fileId"] > 0:
                assets_file = obj.assets_file
                externals_list = getattr(assets_file, "externals", [])
                ext_path = str(getattr(externals_list[ref["fileId"] - 1], "path", "")) if ref["fileId"] <= len(externals_list) else "<external-index-out-of-range>"
                external_ptrs.append({"ownerType": kind, "ownerPathId": str(obj.path_id),
                                      "field": ref["field"], "fileId": ref["fileId"],
                                      "pathId": ref["pathId"], "externalPath": ext_path})
        matched = kind in wanted_types and any(term in name.lower() or term.encode() in content.lower() for term in terms)
        neighbor_match = kind in wanted_types and any(token in name.lower() or token.encode() in content.lower()
            for token in ("10066_closur_ourbase", "10068_kalts2_mtship"))
        if neighbor_match:
            neighbor_hits.append({"type": kind, "pathId": str(obj.path_id), "name": name,
                                  "pointers": all_refs})
        if matched:
            row = {"type": kind, "pathId": str(obj.path_id), "name": name}
            if kind == "TextAsset":
                row["contentBytes"] = len(content)
                row["contentText"] = content[:4096].decode("utf-8", "replace")
            row["pointers"] = all_refs
            hits.append(row)
    object_by_id = {obj.path_id: obj for obj in objects}
    container = []
    neighbor_containers = []
    for key, value in bundle_data["m_Container"]:
        if not any(token in key.lower() for token in ("10067", "toledo", "tldptm", "10066", "10068")):
            continue
        ptr = pointer(value["asset"])
        row = {"path": key, "asset": ptr}
        root_obj = object_by_id.get(value["asset"]["m_PathID"])
        if root_obj is not None:
            root_data = root_obj.read_typetree()
            row["rootObject"] = {"type": root_obj.type.name, "pathId": str(root_obj.path_id),
                                  "name": root_data.get("m_Name"),
                                  "componentPointers": field_refs(root_data)}
        if "10067" in key or "toledo" in key.lower() or "tldptm" in key.lower():
            container.append(row)
        else:
            neighbor_containers.append(row)
    native_typed_chain = None
    if container:
        require(len(container) == 1, "official Toledo prefab container is not unique")
        root_pid = int(container[0]["asset"]["pathId"])
        root_obj = object_by_id[root_pid]
        root_data = root_obj.read_typetree()

        def local_object(ptr, expected_type, field):
            require(ptr["m_FileID"] == 0, "Toledo typed PPtr is external: " + field)
            obj = object_by_id.get(ptr["m_PathID"])
            require(obj is not None, "Toledo typed PPtr target is missing: " + field)
            require(obj.type.name == expected_type,
                    "Toledo typed PPtr has wrong Unity type for " + field + ": " + obj.type.name)
            return obj

        renderers = []
        component_diagnostics = []
        for component in root_data.get("m_Component", []):
            ref = component["component"]
            require(ref["m_FileID"] == 0, "Toledo prefab component pointer is external")
            obj = object_by_id.get(ref["m_PathID"])
            require(obj is not None, "Toledo prefab component pointer target is missing")
            if obj.type.name != "MonoBehaviour":
                continue
            data = obj.read_typetree()
            component_diagnostics.append({"pathId": str(obj.path_id),
                                          "scriptPointer": pointer(data.get("m_Script", {"m_FileID": 0, "m_PathID": 0})),
                                          "fields": sorted(str(key) for key in data)})
            if "skeletonDataAsset" in data:
                renderers.append((obj, data))
        if len(renderers) != 1:
            native_typed_chain = {"status": "unresolved", "reason": "native SkeletonAnimation-shaped component count was " + str(len(renderers)),
                                  "prefabComponents": component_diagnostics}
        else:
            renderer_obj, renderer = renderers[0]
        if len(renderers) == 1:
            sda_obj = local_object(renderer["skeletonDataAsset"], "MonoBehaviour", "SkeletonAnimation.skeletonDataAsset")
            sda = sda_obj.read_typetree()
            skel_obj = local_object(sda["skeletonJSON"], "TextAsset", "SkeletonDataAsset.skeletonJSON")
            require(len(sda.get("atlasAssets", [])) == 1, "Toledo SkeletonDataAsset must reference one native atlas")
            atlas_obj = local_object(sda["atlasAssets"][0], "MonoBehaviour", "SkeletonDataAsset.atlasAssets[0]")
            atlas = atlas_obj.read_typetree()
            atlas_text_obj = local_object(atlas["atlasFile"], "TextAsset", "SpineAtlasAsset.atlasFile")
            require(len(atlas.get("materials", [])) == 1, "Toledo SpineAtlasAsset must reference one material")
            material_obj = local_object(atlas["materials"][0], "Material", "SpineAtlasAsset.materials[0]")
            texenvs = dict(material_obj.read_typetree()["m_SavedProperties"]["m_TexEnvs"])
            require("_MainTex" in texenvs, "Toledo native material lacks _MainTex")
            texture_obj = local_object(texenvs["_MainTex"]["m_Texture"], "Texture2D", "Material._MainTex")
            texture = texture_obj.read_typetree()
            skel_data = skel_obj.read_typetree()
            atlas_data = atlas_text_obj.read_typetree()
            atlas_text = text_bytes(atlas_data).decode("utf-8")
            native_typed_chain = {
                "prefab": {"container": container[0]["path"], "unityType": root_obj.type.name,
                           "pathId": str(root_obj.path_id)},
                "skeletonAnimation": {"unityType": renderer_obj.type.name, "pathId": str(renderer_obj.path_id),
                                      "scriptPointer": pointer(renderer["m_Script"])},
                "skeletonDataAsset": {"unityType": sda_obj.type.name, "pathId": str(sda_obj.path_id),
                                      "scriptPointer": pointer(sda["m_Script"])},
                "skeletonText": {"unityType": skel_obj.type.name, "pathId": str(skel_obj.path_id),
                                 "name": skel_data.get("m_Name"), "bytes": len(text_bytes(skel_data))},
                "atlasAsset": {"unityType": atlas_obj.type.name, "pathId": str(atlas_obj.path_id),
                               "scriptPointer": pointer(atlas["m_Script"])},
                "atlasText": {"unityType": atlas_text_obj.type.name, "pathId": str(atlas_text_obj.path_id),
                              "name": atlas_data.get("m_Name"), "bytes": len(text_bytes(atlas_data)),
                              "page": atlas_text.strip().splitlines()[0]},
                "material": {"unityType": material_obj.type.name, "pathId": str(material_obj.path_id)},
                "mainTexture": {"unityType": texture_obj.type.name, "pathId": str(texture_obj.path_id),
                            "name": texture.get("m_Name"), "width": texture.get("m_Width"),
                            "height": texture.get("m_Height")},
        }
    externals = []
    for filename, assets_file in env.files.items():
        for index, external in enumerate(getattr(assets_file, "externals", []), 1):
            externals.append({"ownerFile": str(filename), "fileId": index,
                              "path": str(getattr(external, "path", "")),
                              "guid": str(getattr(external, "guid", "")),
                              "type": str(getattr(external, "type", ""))})
    return {"nativeVersionId": version, "path": absolute(target), "bytes": target.stat().st_size,
            "unityPyVersion": getattr(UnityPy, "__version__", "unknown"), "objectCount": len(objects),
            "objectTypeCounts": type_counts,
            "containerCount": len(bundle_data["m_Container"]), "targetContainerEntries": container,
            "matchedInternalObjects": hits, "neighborContainerEntries": neighbor_containers,
            "neighborInternalNameHits": neighbor_hits,
            "nativeTypedChain": native_typed_chain,
            "serializedFileExternalReferences": externals,
            "externalPPtrCount": len(external_ptrs), "externalPPtrs": external_ptrs,
            "payloadDisposition": "staged bundle remains until normal native retire"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-cathy", metavar="ABSOLUTE_PNG_PATH",
                        help="Add the exact native Cathy PNG to its sole allowed formal path; never overwrite")
    parser.add_argument("--native-version", default=TOLEDO_VERSION)
    parser.add_argument("--probe-toledo-index", action="store_true")
    parser.add_argument("--probe-native-manifest", action="store_true")
    parser.add_argument("--probe-missing-map-owner", action="store_true")
    parser.add_argument("--probe-map-mesh-owner", action="store_true")
    parser.add_argument("--probe-map-dependency-manifest", action="store_true")
    parser.add_argument("--probe-map-dependency-carrier", action="store_true")
    parser.add_argument("--probe-map-second-dependency-carrier", action="store_true")
    parser.add_argument("--probe-map-source-pointer", action="store_true")
    parser.add_argument("--probe-map-shore-res-pointer", action="store_true")
    parser.add_argument("--probe-map-flow-texture", action="store_true")
    parser.add_argument("--probe-map-emission-owner", action="store_true")
    parser.add_argument("--dependency-bundle")
    parser.add_argument("--dependency-cid", type=int)
    parser.add_argument("--dependency-hash")
    parser.add_argument("--dependency-raw-bytes", type=int)
    parser.add_argument("--dependency-expanded-bytes", type=int)
    parser.add_argument("--dependency-max-raw-bytes", type=int)
    parser.add_argument("--dependency-max-expanded-bytes", type=int)
    parser.add_argument("--inspect-toledo-bundle", metavar="ABSOLUTE_STAGED_AB")
    args = parser.parse_args()
    dep_args = (args.dependency_bundle, args.dependency_cid, args.dependency_hash,
                args.dependency_raw_bytes, args.dependency_expanded_bytes,
                args.dependency_max_raw_bytes, args.dependency_max_expanded_bytes)
    if any(value is not None for value in dep_args) and not args.probe_map_dependency_carrier:
        parser.error("dependency scope options require --probe-map-dependency-carrier")
    if args.probe_map_second_dependency_carrier and (args.probe_map_dependency_carrier or any(value is not None for value in dep_args)):
        parser.error("second anonymous carrier probe does not accept first-carrier metadata options")
    if args.probe_toledo_index:
        print(json.dumps(probe_toledo_index(args.native_version), ensure_ascii=True, separators=(",", ":")))
        return 0
    if args.probe_native_manifest:
        print(json.dumps(probe_native_manifest(args.native_version), ensure_ascii=True, separators=(",", ":")))
        return 0
    if args.probe_missing_map_owner:
        print(json.dumps(probe_missing_map_owner(args.native_version), ensure_ascii=True, separators=(",", ":")))
        return 0
    if args.probe_map_mesh_owner:
        print(json.dumps(probe_map_mesh_owner(args.native_version), ensure_ascii=True, separators=(",", ":")))
        return 0
    if args.probe_map_emission_owner:
        result = probe_map_emission_owner(args.native_version)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0 if result.get("ownerResolved") else 1
    if args.probe_map_dependency_manifest:
        print(json.dumps(probe_map_dependency_manifest(args.native_version), ensure_ascii=True, separators=(",", ":")))
        return 0
    if args.probe_map_dependency_carrier:
        try:
            result = probe_map_dependency_carrier(args.native_version, *dep_args)
        except Exception as error:
            result = {"status": "rejected-before-carrier-fetch", "failureStage": "exact-scope-validation",
                      "nativeVersionId": args.native_version, "candidateBundleName": args.dependency_bundle,
                      "candidateManifestRecord": {"name": args.dependency_bundle, "cid": args.dependency_cid,
                          "hash": args.dependency_hash, "totalSize": args.dependency_raw_bytes,
                          "abSize": args.dependency_expanded_bytes},
                      "thresholds": {"rawPackageBytes": args.dependency_max_raw_bytes,
                                     "expandedBundleBytes": args.dependency_max_expanded_bytes},
                      "ownerResolved": False, "carrierDownloaded": False, "firstError": str(error)}
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0 if result.get("status") == "pass" else 1
    if args.probe_map_second_dependency_carrier:
        result = probe_second_map_dependency_carrier(args.native_version)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0 if result.get("status") == "pass" else 1
    if args.probe_map_source_pointer:
        result = probe_map_source_pointer(args.native_version)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0 if result.get("status") == "pass" else 1
    if args.probe_map_shore_res_pointer:
        result = probe_map_shore_res_pointer(args.native_version)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0 if result.get("status") == "pass" else 1
    if args.probe_map_flow_texture:
        result = probe_map_flow_texture(args.native_version)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0 if result.get("status") == "pass" else 1
    if args.inspect_toledo_bundle:
        print(json.dumps(inspect_toledo_bundle(args.inspect_toledo_bundle, args.native_version), ensure_ascii=True, separators=(",", ":")))
        return 0
    def failure(scope, filename, error):
        return {"scope": scope, "sourcePath": absolute(BUNDLE_DIR / filename),
                "sourceUrl": URL_ROOT + filename, "error": str(error)}

    report = {"schema": "assault-native-model-evidence/v1", "verifiedAt": datetime.now(timezone.utc).isoformat(),
              "sourceVersion": VERSION, "nativeIndexGitCommit": "404cf368572a4f346f66614612c40fd7779012b5",
              "bundleDirectory": absolute(BUNDLE_DIR), "operators": [], "errors": []}
    try:
        # Import only the already present native bundle decoder and libraries.
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-extract"))
        import aklz4  # noqa: F401; registers the existing Arknights decompressor
        script_bundle = Bundle(SCRIPT_PACKAGE, {"MonoScript"})
        scripts = Scripts(script_bundle)
        report["scriptSource"] = script_bundle.source
        for character in OPERATORS:
            try:
                bundle = Bundle("chararts_" + character + ".dat", MODEL_TYPES)
                report["operators"].append(body_evidence(character, bundle, scripts))
            except Exception as error:
                report["errors"].append(failure(character, "chararts_" + character + ".dat", error))
        try:
            bundle = Bundle(TOKEN_PACKAGE, MODEL_TYPES)
            report["cathy"], image = cathy_evidence(bundle, scripts)
            if args.export_cathy:
                require(not report["errors"], "Do not export when another native validation failed")
                report["cathy"]["output"] = export_cathy(args.export_cathy, image)
        except Exception as error:
            report["errors"].append(failure(CATHY_ID, TOKEN_PACKAGE, error))
    except Exception as error:
        report["errors"].append(failure("initialization", SCRIPT_PACKAGE, error))
    report["ok"] = not report["errors"] and len(report["operators"]) == len(OPERATORS) and "cathy" in report
    print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
