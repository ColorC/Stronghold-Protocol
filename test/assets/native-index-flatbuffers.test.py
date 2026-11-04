import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
import zipfile
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("native_model_evidence", ROOT / "tools/assault/native-model-evidence.py")
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


def fixture_index(bundle_index=1, malformed_bundle_vector=False, include_shore=False,
                  include_map_bundles=False, malformed_dependency_pointer=False,
                  malformed_dependency_index=False):
    data = bytearray(8192)
    cursor = 2500

    def table(pos, fields, object_size):
        vtable = pos - (4 + 2 * len(fields))
        struct.pack_into("<i", data, pos, pos - vtable)
        struct.pack_into("<HH", data, vtable, 4 + 2 * len(fields), object_size)
        for slot, offset in enumerate(fields):
            struct.pack_into("<H", data, vtable + 4 + slot * 2, offset)

    def ref(pos, target):
        struct.pack_into("<I", data, pos, target - pos)

    def string(value):
        nonlocal cursor
        raw = value.encode("utf-8")
        pos = cursor
        struct.pack_into("<I", data, pos, len(raw))
        data[pos + 4:pos + 4 + len(raw)] = raw
        data[pos + 4 + len(raw)] = 0
        cursor += len(raw) + 5
        return pos

    # Root table at file offset 144, after the native 128-byte signature.
    struct.pack_into("<I", data, 128, 16)
    table(144, [0, 4, 8], 12)
    bundle_vector, asset_vector = 200, 240
    ref(148, bundle_vector)
    ref(152, asset_vector)
    struct.pack_into("<I", data, bundle_vector, 2)
    struct.pack_into("<I", data, asset_vector, 4 if include_shore else 3)

    bundles = ([(300 + i * 60, name) for i, name in enumerate(evidence.MAP_OWNER_BUNDLES)] if include_map_bundles else [
        (300, "pkgrps/btl_pfb_tokens_4.ab"), (360, "pkgrps/btl_pfb_tokens_5.ab")])
    struct.pack_into("<I", data, bundle_vector, len(bundles))
    for i, (pos, name) in enumerate(bundles):
        table(pos, [4, 0, 8, 12], 16)
        name_pos = string(name)
        ref(pos + 4, name_pos)
        struct.pack_into("<I", data, pos + 8, 99)  # scalar is intentionally not a uoffset
        if include_map_bundles:
            vector_pos = 760 + i * 24
            struct.pack_into("<I", data, vector_pos, 1 if i < 2 else 0)
            if i < 2:
                dependency = 9999 if malformed_dependency_index and i == 0 else ((i + 2) % len(bundles))
                struct.pack_into("<I", data, vector_pos + 4, dependency)
            ref(pos + 12, 0x7fffffff if malformed_dependency_pointer and i == 0 else vector_pos)
        else:
            struct.pack_into("<I", data, pos + 12, 0)
        ref(bundle_vector + 4 + i * 4, pos)

    assets = [
        (1500, evidence.TOLEDO_PREFAB, bundle_index, "token_10067_toledo_tldptm", evidence.TOLEDO_PREFAB),
        (1580, evidence.TOLEDO_NEIGHBORS[0], 0, "token_10066_closur_ourbase", evidence.TOLEDO_NEIGHBORS[0]),
        (1660, evidence.TOLEDO_NEIGHBORS[1], 0, "token_10068_kalts2_mtship", evidence.TOLEDO_NEIGHBORS[1]),
    ]
    if include_shore:
        assets.append((1740, "arts/maps/map_doss_shore/meshes/shore.mesh", 1,
                       "shore_mesh", "arts/maps/map_doss_shore/meshes/shore.mesh"))
    for i, (pos, logical, owner, basename, fullpath) in enumerate(assets):
        table(pos, [4, 8 if owner else 0, 12, 16], 20)
        for field_pos, value in ((pos + 4, logical), (pos + 12, basename), (pos + 16, fullpath)):
            ref(field_pos, string(value))
        if owner:
            struct.pack_into("<I", data, pos + 8, owner)
        ref(asset_vector + 4 + i * 4, pos)

    if malformed_bundle_vector:
        struct.pack_into("<I", data, 148, 0x7fffffff)
    return bytes(data[:cursor])


class NativeIndexFlatBuffersTests(unittest.TestCase):
    def test_bundle_inspection_json_preserves_replacement_character_under_windows_gbk_stdout(self):
        # Actual failed native bundle inspection contained U+FFFD, which GBK cannot encode.
        result = {"nativeName": "托雷多\ufffd", "containerRefs": [{"pathId": "-4487102536378500135"}]}
        output = io.BytesIO()
        stream = io.TextIOWrapper(output, encoding="gbk", errors="strict")
        with patch.object(sys, "argv", ["native-model-evidence.py", "--inspect-toledo-bundle", "unused-staged-path"]), patch.object(sys, "stdout", stream), patch.object(evidence, "inspect_toledo_bundle", return_value=result):
            self.assertEqual(evidence.main(), 0)
        stream.flush()
        self.assertEqual(json.loads(output.getvalue().decode("ascii")), result)
        stream.detach()

    def manifest(self):
        return {"manifestVersion": "V078", "abInfos": [
            {"name": "pkgrps/btl_pfb_tokens_4.ab", "cid": 5449},
            {"name": "pkgrps/btl_pfb_tokens_5.ab", "cid": 5450},
        ]}

    def test_exact_asset_paths_join_to_native_bundle_names_and_manifest(self):
        parsed = evidence.parse_native_index_mapping(fixture_index(), self.manifest())
        paths = parsed["paths"]
        self.assertEqual(paths[evidence.TOLEDO_PREFAB]["bundleName"], "pkgrps/btl_pfb_tokens_5.ab")
        self.assertEqual(paths[evidence.TOLEDO_PREFAB]["manifestRecord"]["cid"], 5450)
        self.assertEqual(paths[evidence.TOLEDO_NEIGHBORS[0]]["bundleName"], "pkgrps/btl_pfb_tokens_4.ab")
        self.assertEqual(paths[evidence.TOLEDO_NEIGHBORS[1]]["bundleName"], "pkgrps/btl_pfb_tokens_4.ab")

    def test_rejects_malformed_root_vector_pointer(self):
        with self.assertRaisesRegex(ValueError, "outside the index"):
            evidence.parse_native_index_mapping(fixture_index(malformed_bundle_vector=True), self.manifest())

    def test_rejects_bundle_vector_index_out_of_range(self):
        with self.assertRaisesRegex(ValueError, "bundle vector index is out of range"):
            evidence.parse_native_index_mapping(fixture_index(bundle_index=2), self.manifest())

    def test_rejects_missing_exact_path(self):
        with self.assertRaisesRegex(ValueError, "no exact asset path"):
            evidence.parse_native_index_mapping(fixture_index(), self.manifest(), paths=("missing.prefab",))

    def test_rejects_manifest_cid_shortcut_without_exact_name_join(self):
        manifest = {"manifestVersion": "V078", "abInfos": [
            {"name": "pkgrps/btl_pfb_tokens_4.ab", "cid": 5450},
        ]}
        with self.assertRaisesRegex(ValueError, "does not uniquely resolve native bundle"):
            evidence.parse_native_index_mapping(fixture_index(), manifest)

    def test_v072_map_owner_parser_joins_bundle_name_to_manifest(self):
        manifest = {"manifestVersion": "V072", "abInfos": [
            {"name": "pkgrps/btl_pfb_tokens_4.ab", "cid": 5449},
            {"name": "pkgrps/btl_pfb_tokens_5.ab", "cid": 5450},
        ]}
        parsed = evidence.parse_map_owner_index(fixture_index(include_shore=True), manifest)
        self.assertEqual((parsed["bundleVectorCount"], parsed["assetVectorCount"]), (2, 4))
        row = parsed["relevantMapDossShoreMeshRows"][0]
        self.assertEqual((row["bundleVectorIndex"], row["bundleName"]), (1, "pkgrps/btl_pfb_tokens_5.ab"))
        self.assertEqual(row["manifestRecord"]["cid"], 5450)

    def test_v072_map_owner_rejects_manifest_cid_shortcut_and_wrong_version(self):
        manifest = {"manifestVersion": "V072", "abInfos": [
            {"name": "pkgrps/btl_pfb_tokens_4.ab", "cid": 5450},
        ]}
        with self.assertRaisesRegex(ValueError, "does not uniquely join"):
            evidence.parse_map_owner_index(fixture_index(include_shore=True), manifest)
        with self.assertRaisesRegex(ValueError, "requires the official V072"):
            evidence.parse_map_owner_index(fixture_index(), {"manifestVersion": "V078", "abInfos": []})

    def test_v072_index_dependency_slots_keep_bundle_index_distinct_from_slot2_scalar(self):
        manifest = {"manifestVersion": "V072", "abInfos": [
            {"name": name, "cid": 6000 + index} for index, name in enumerate(evidence.MAP_OWNER_BUNDLES)]}
        parsed = evidence.parse_map_owner_index(fixture_index(include_shore=True, include_map_bundles=True), manifest)
        rows = parsed["candidateBundleSlots"]
        self.assertEqual([row["bundleName"] for row in rows], list(evidence.MAP_OWNER_BUNDLES))
        self.assertEqual([row["slot2Scalar"] for row in rows], [99, 99, 99])
        self.assertEqual(rows[0]["slot3DependencyIndices"], [2])
        self.assertEqual(rows[0]["slot3DependencyNames"], [evidence.MAP_OWNER_BUNDLES[2]])
        self.assertEqual(rows[1]["slot3DependencyNames"], [evidence.MAP_OWNER_BUNDLES[0]])

    def test_v072_index_dependency_slot_pointer_and_index_are_bounds_checked(self):
        manifest = {"manifestVersion": "V072", "abInfos": [
            {"name": name, "cid": 6000 + index} for index, name in enumerate(evidence.MAP_OWNER_BUNDLES)]}
        with self.assertRaisesRegex(ValueError, "outside the index"):
            evidence.parse_map_owner_index(fixture_index(include_map_bundles=True, malformed_dependency_pointer=True), manifest)
        with self.assertRaisesRegex(ValueError, "dependency index is out of range"):
            evidence.parse_map_owner_index(fixture_index(include_map_bundles=True, malformed_dependency_index=True), manifest)

    def test_mesh_owner_requires_exact_cab_pathid_and_mesh_type(self):
        self.assertTrue(evidence.exact_mesh_owner("CAB-c2c688f710a565b7cce0cc93f7bd219f",
                                                  "-4487102536378500135", "Mesh"))
        self.assertFalse(evidence.exact_mesh_owner("CAB-b00948d03b560c2550d5805a3fef6501",
                                                   "-4487102536378500135", "Mesh"))
        self.assertFalse(evidence.exact_mesh_owner("CAB-c2c688f710a565b7cce0cc93f7bd219f",
                                                   "-4487102536378500135", "Texture2D"))

    def test_emission_texture_owner_requires_exact_cab_and_pathid(self):
        self.assertTrue(evidence.exact_emission_texture_owner(
            "CAB-d11100f4254cd2e6ee06daa9c2b8392f", 1516978124489369110))
        self.assertFalse(evidence.exact_emission_texture_owner(
            "CAB-other", 1516978124489369110))
        self.assertFalse(evidence.exact_emission_texture_owner(
            "CAB-d11100f4254cd2e6ee06daa9c2b8392f", 1516978124489369111))

    def test_emission_owner_probe_uses_exact_official_row_and_object_directory_only(self):
        name = evidence.MAP_EMISSION_OWNER_BUNDLE
        row = {"name": name, "cid": 177, "hash": "native-emission", "totalSize": 4,
               "abSize": 6, "cat": 1, "meta": 1}
        manifest = {"versionId": evidence.MAP_OWNER_VERSION, "manifestVersion": "V072",
                    "manifestName": evidence.MAP_OWNER_INDEX, "abInfos": [row]}
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(manifest).encode()
        target = types.SimpleNamespace(type=types.SimpleNamespace(name="Texture2D"))
        asset_file = types.SimpleNamespace(name="CAB-" + evidence.MAP_EMISSION_OWNER_CAB,
                                           objects={evidence.MAP_EMISSION_OWNER_PATH_ID: target})
        environment = types.SimpleNamespace(get_files=lambda: [asset_file])
        fake_fetch = types.SimpleNamespace(dat_name=lambda _name: "map_survivaloasis_city_res.dat",
            get=lambda _url, _limit: b"raw!", unpack_bundle=lambda _raw, _name, _limit: b"native")
        with patch.object(evidence.urllib.request, "urlopen", return_value=response), \
             patch.dict(sys.modules, {"fetch_scenes": fake_fetch, "aklz4": types.SimpleNamespace(),
                                      "UnityPy": types.SimpleNamespace(load=lambda _data: environment)}):
            result = evidence.probe_map_emission_owner(evidence.MAP_OWNER_VERSION)
        self.assertTrue(result["ownerResolved"])
        self.assertEqual(result["candidateManifestRecord"], row)
        self.assertEqual(result["actualRawPackageBytes"], 4)
        self.assertEqual(result["actualExpandedBundleBytes"], 6)
        self.assertEqual(result["ownerMatches"][0]["type"], "Texture2D")
        self.assertNotIn("typetree", result)

    def test_emission_owner_probe_size_gate_retains_row_and_never_fetches(self):
        name = evidence.MAP_EMISSION_OWNER_BUNDLE
        row = {"name": name, "cid": 177, "hash": "native-emission",
               "totalSize": evidence.MAP_EMISSION_OWNER_RAW_LIMIT + 1,
               "abSize": 6, "cat": 1, "meta": 1}
        manifest = {"versionId": evidence.MAP_OWNER_VERSION, "manifestVersion": "V072",
                    "manifestName": evidence.MAP_OWNER_INDEX, "abInfos": [row]}
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(manifest).encode()
        with patch.object(evidence.urllib.request, "urlopen", return_value=response), \
             patch.dict(sys.modules, {"fetch_scenes": None}):
            result = evidence.probe_map_emission_owner(evidence.MAP_OWNER_VERSION)
        self.assertEqual(result["status"], "rejected-before-carrier-fetch")
        self.assertEqual(result["candidateManifestRecord"], row)
        self.assertFalse(result["ownerResolved"])
        self.assertFalse(result["carrierDownloaded"])
        self.assertEqual(result["thresholds"]["rawPackageBytes"], evidence.MAP_EMISSION_OWNER_RAW_LIMIT)

    def test_exact_dependency_manifest_name_must_have_one_row(self):
        name = evidence.MAP_DEPENDENCY_BUNDLE
        row = {"name": name, "cid": 7, "hash": "native", "totalSize": 120, "abSize": 240}
        self.assertEqual(evidence.exact_manifest_record({"abInfos": [row]}, name), row)
        with self.assertRaisesRegex(ValueError, "does not uniquely list exact dependency"):
            evidence.exact_manifest_record({"abInfos": []}, name)
        with self.assertRaisesRegex(ValueError, "does not uniquely list exact dependency"):
            evidence.exact_manifest_record({"abInfos": [row, row]}, name)

    def test_dependency_manifest_sizes_are_bounded_and_report_the_actual_excess(self):
        self.assertEqual(evidence.dependency_carrier_size_limits({"totalSize": 100, "abSize": 200}), (100, 200))
        with self.assertRaisesRegex(ValueError, "totalSize 3500001 exceeds 3500000"):
            evidence.dependency_carrier_size_limits({"totalSize": 3_500_001, "abSize": 200})
        with self.assertRaisesRegex(ValueError, "abSize 67108865 exceeds 67108864"):
            evidence.dependency_carrier_size_limits({"totalSize": 100, "abSize": 64 * 1024 * 1024 + 1})

    def test_structured_size_gate_retains_full_candidate_record_on_rejection(self):
        row = {"name": evidence.MAP_DEPENDENCY_BUNDLE, "cid": 77, "hash": "native-hash",
               "totalSize": 3_500_001, "abSize": 4_000_000}
        result = evidence.dependency_carrier_gate({"nativeVersionId": evidence.MAP_OWNER_VERSION,
                                                   "candidateManifestRecord": row})
        self.assertEqual(result["status"], "rejected-before-carrier-fetch")
        self.assertEqual(result["candidateManifestRecord"], row)
        self.assertEqual(result["candidateManifestRecord"]["cid"], 77)
        self.assertEqual(result["thresholds"]["rawPackageBytes"], 3_500_000)
        self.assertFalse(result["ownerResolved"])
        self.assertFalse(result["carrierDownloaded"])
        self.assertIn("totalSize 3500001", result["firstError"])

    def test_nonzero_carrier_cli_emits_structured_record_before_returning_failure(self):
        row = {"name": evidence.MAP_DEPENDENCY_BUNDLE, "cid": 13930, "hash": "7fda",
               "totalSize": 5_278_007, "abSize": 6_344_181}
        result = evidence.dependency_carrier_gate({"nativeVersionId": evidence.MAP_OWNER_VERSION,
                                                   "candidateManifestRecord": row})
        output = io.StringIO()
        args = ["native-model-evidence.py", "--probe-map-dependency-carrier", "--native-version",
                evidence.MAP_OWNER_VERSION]
        with patch.object(sys, "argv", args), patch.object(sys, "stdout", output), \
             patch.object(evidence, "probe_map_dependency_carrier", return_value=result):
            self.assertEqual(evidence.main(), 1)
        self.assertEqual(json.loads(output.getvalue()), result)
        self.assertEqual(json.loads(output.getvalue())["candidateManifestRecord"], row)

    def test_dependency_carrier_requires_exact_single_member_and_unityfs_header(self):
        def package(member_name, payload):
            out = io.BytesIO()
            with zipfile.ZipFile(out, "w") as archive:
                archive.writestr(member_name, payload)
            return out.getvalue()
        with self.assertRaisesRegex(ValueError, "does not match the exact index bundle name"):
            evidence.inspect_dependency_carrier(package("other.bin", b"UnityFS"), evidence.MAP_DEPENDENCY_BUNDLE)
        with self.assertRaisesRegex(ValueError, "unsupported non-UnityFS"):
            evidence.inspect_dependency_carrier(package(evidence.MAP_DEPENDENCY_BUNDLE, b"not-unity"),
                                                 evidence.MAP_DEPENDENCY_BUNDLE)
        with self.assertRaisesRegex(ValueError, "outside the exact verified scope"):
            evidence.inspect_dependency_carrier(b"", "other.bin")

    def test_exact_carrier_probe_scope_accepts_only_authorized_metadata_and_caps(self):
        exact = (evidence.MAP_DEPENDENCY_BUNDLE, 13930, "7fda", 5_278_007, 6_344_181,
                 6 * 1024 * 1024, 8 * 1024 * 1024)
        record = evidence.validate_map_dependency_scope(*exact)
        self.assertEqual(record["name"], evidence.MAP_DEPENDENCY_BUNDLE)
        self.assertEqual(record["cid"], 13930)
        self.assertEqual((record["cat"], record["meta"]), (1, 1))
        for index, wrong in ((0, "other.bin"), (1, 13931), (2, "7fdb"),
                             (5, 7 * 1024 * 1024), (6, 9 * 1024 * 1024)):
            values = list(exact)
            values[index] = wrong
            with self.subTest(field=index), self.assertRaisesRegex(ValueError, "exact authorized bundle metadata"):
                evidence.validate_map_dependency_scope(*values)

    def test_unsupported_exact_carrier_keeps_package_header_and_manifest_row(self):
        raw = b"not-a-unity-bundle\x00native"
        fmt = evidence.dependency_package_format(raw, evidence.MAP_DEPENDENCY_BUNDLE)
        self.assertEqual(fmt["containerKind"], "unknown")
        self.assertEqual(fmt["rawHeaderAscii"], raw[:16].decode("ascii", "replace"))
        row = {"name": evidence.MAP_DEPENDENCY_BUNDLE, "cid": 13930, "hash": "7fda",
               "totalSize": 5_278_007, "abSize": 6_344_181}
        result = evidence.dependency_carrier_gate({"nativeVersionId": evidence.MAP_OWNER_VERSION,
                                                   "candidateManifestRecord": row},
                                                  6 * 1024 * 1024, 8 * 1024 * 1024)
        self.assertEqual(result["status"], "within-carrier-size-limits")
        self.assertEqual(result["candidateManifestRecord"], row)
        self.assertEqual(result["thresholds"], {"rawPackageBytes": 6 * 1024 * 1024,
                                               "expandedBundleBytes": 8 * 1024 * 1024})

    def test_unsupported_carrier_probe_emits_structured_error_without_owner_claim(self):
        raw = b"not-a-unity-bundle\x00native"
        fake_fetch = types.SimpleNamespace(dat_name=lambda _: "anon_fc2d5c7750596c62c748dc87eb834d42.dat",
                                           get=lambda url, limit: raw)
        with patch.dict(sys.modules, {"fetch_scenes": fake_fetch}):
            result = evidence.probe_map_dependency_carrier(
                evidence.MAP_OWNER_VERSION, evidence.MAP_DEPENDENCY_BUNDLE, 13930, "7fda",
                5_278_007, 6_344_181, 6 * 1024 * 1024, 8 * 1024 * 1024)
        self.assertEqual(result["status"], "rejected-during-carrier-fetch-or-parse")
        self.assertEqual(result["candidateManifestRecord"]["cid"], 13930)
        self.assertEqual(result["actualRawPackageBytes"], len(raw))
        self.assertEqual(result["actualPackageFormat"]["containerKind"], "unknown")
        self.assertEqual(result["actualPackageFormat"]["rawHeaderHex"], raw[:16].hex())
        self.assertFalse(result["ownerResolved"])
        self.assertTrue(result["carrierDownloaded"])

    def test_second_carrier_manifest_over_cap_retains_full_row_and_does_not_fetch(self):
        row = {"name": evidence.MAP_DEPENDENCY_SECOND_BUNDLE, "cid": 14001, "hash": "native98",
               "md5": "md5-98", "totalSize": 8 * 1024 * 1024 + 1,
               "abSize": 12_345_678, "cat": 1, "meta": 1}
        manifest = {"versionId": evidence.MAP_OWNER_VERSION, "manifestVersion": "V072",
                    "manifestName": evidence.MAP_OWNER_INDEX, "abInfos": [row]}
        raw = json.dumps(manifest).encode()
        response = MagicMock()
        response.__enter__.return_value.read.return_value = raw
        with patch.object(evidence.urllib.request, "urlopen", return_value=response), \
             patch.dict(sys.modules, {"fetch_scenes": None}):
            result = evidence.probe_second_map_dependency_carrier(evidence.MAP_OWNER_VERSION)
        self.assertEqual(result["status"], "rejected-before-carrier-fetch")
        self.assertEqual(result["failureStage"], "official-manifest-size-gate")
        self.assertEqual(result["candidateManifestRecord"], row)
        self.assertEqual(result["thresholds"], {"rawPackageBytes": 8 * 1024 * 1024,
                                               "expandedBundleBytes": 32 * 1024 * 1024})
        self.assertFalse(result["carrierDownloaded"])
        self.assertIn("totalSize", result["firstError"])

    def test_second_carrier_gate_rejects_unknown_target_and_wrong_limits(self):
        self.assertEqual(evidence.MAP_DEPENDENCY_SECOND_BUNDLE,
                         "anon/98a215cf851e7e4bb0ac9592f79c2cc3.bin")
        with self.assertRaisesRegex(ValueError, "outside the exact verified scope"):
            evidence.inspect_dependency_carrier(b"", "anon/unknown.bin", 32 * 1024 * 1024)
        with self.assertRaisesRegex(ValueError, "abSize 33554433 exceeds 33554432"):
            evidence.dependency_carrier_size_limits({"totalSize": 1, "abSize": 32 * 1024 * 1024 + 1},
                                                     8 * 1024 * 1024, 32 * 1024 * 1024)

    def test_native_unity_pptr_file_id_8_maps_to_external_index_7_for_meshfilter(self):
        external_rows = [types.SimpleNamespace(path=f"archive:/CAB-{i}/CAB-{i}", guid=f"guid-{i}", type=0)
                         for i in range(8)]
        external_rows[7].path = "archive:/CAB-c2c688f710a565b7cce0cc93f7bd219f/CAB-c2c688f710a565b7cce0cc93f7bd219f"

        class FakePPtr:
            m_FileID = 8
            m_PathID = -4487102536378500135
            def deref(self):
                raise FileNotFoundError("Failed to resolve pointer - exact target CAB not loaded")

        owner = types.SimpleNamespace(assets_file=types.SimpleNamespace(name="scene-CAB", externals=external_rows),
                                     type=types.SimpleNamespace(name="MeshFilter"), path_id=7001)
        row = evidence.source_pointer_evidence(owner, FakePPtr(), "MeshFilter.m_Mesh")
        self.assertEqual(row["ownerUnityType"], "MeshFilter")
        self.assertEqual(row["field"], "MeshFilter.m_Mesh")
        self.assertEqual(row["m_FileID"], 8)
        self.assertEqual(row["externalIndexZeroBased"], 7)
        self.assertEqual(row["externalEntryCount"], 8)
        self.assertIn("CAB-c2c688f710a565b7cce0cc93f7bd219f", row["externalEntry"]["path"])
        self.assertEqual(row["resolverStatus"], "unresolved")

    def test_native_unity_pptr_out_of_range_and_material_texture_are_not_meshfilter(self):
        class FakePPtr:
            m_FileID = 8
            m_PathID = -4487102536378500135
            def deref(self):
                raise FileNotFoundError("Failed to resolve pointer - invalid m_FileID!")

        owner = types.SimpleNamespace(assets_file=types.SimpleNamespace(name="ui-CAB", externals=[
            types.SimpleNamespace(path="archive:/CAB-b00948/CAB-b00948", guid="ui-guid", type=0)]),
            type=types.SimpleNamespace(name="Material"), path_id=7002)
        row = evidence.source_pointer_evidence(owner, FakePPtr(), "Material.m_SavedProperties.m_TexEnvs[_MainTex].m_Texture")
        self.assertEqual(row["ownerUnityType"], "Material")
        self.assertEqual(row["externalIndexZeroBased"], 7)
        self.assertEqual(row["externalEntryCount"], 1)
        self.assertIsNone(row["externalEntry"])
        self.assertEqual(row["resolverStatus"], "unresolved")
        self.assertIn("invalid m_FileID", row["resolverError"])

    def test_shore_res_probe_over_cap_preserves_exact_manifest_row_without_carrier_fetch(self):
        row = {"name": evidence.MAP_SHORE_RES_BUNDLE, "cid": 9033, "hash": "shore-hash",
               "md5": "shore-md5", "totalSize": 8 * 1024 * 1024 + 1,
               "abSize": 9_000_000, "pid": "lpack_init4", "cat": 1}
        manifest = {"versionId": evidence.MAP_OWNER_VERSION, "manifestVersion": "V072",
                    "manifestName": evidence.MAP_OWNER_INDEX, "abInfos": [row]}
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(manifest).encode()
        with patch.object(evidence.urllib.request, "urlopen", return_value=response), \
             patch.dict(sys.modules, {"fetch_scenes": None}):
            result = evidence.probe_map_shore_res_pointer(evidence.MAP_OWNER_VERSION)
        self.assertEqual(result["status"], "rejected-before-bundle-fetch")
        self.assertEqual(result["failureStage"], "official-manifest-size-gate")
        self.assertEqual(result["candidateManifestRecord"], row)
        self.assertEqual(result["candidateManifestRecordFieldTypes"]["cid"], "int")
        self.assertFalse(result["carrierDownloaded"])
        self.assertIn("totalSize", result["firstError"])

    def test_flow_texture_scope_is_exact_and_rejects_other_target_and_limits(self):
        self.assertEqual(evidence.MAP_FLOW_TEXTURE_BUNDLE, "refs/fx/texture/flow.ab")
        self.assertEqual(evidence.MAP_FLOW_TEXTURE_RAW_LIMIT, 12 * 1024 * 1024)
        self.assertEqual(evidence.MAP_FLOW_TEXTURE_EXPANDED_LIMIT, 16 * 1024 * 1024)
        with self.assertRaisesRegex(ValueError, "exact 12/16 MiB limits"):
            evidence.assert_exact_flow_texture_target(evidence.MAP_FLOW_TEXTURE_BUNDLE, 8 * 1024 * 1024,
                                                      32 * 1024 * 1024)
        with self.assertRaisesRegex(ValueError, "abSize 16777217 exceeds 16777216"):
            evidence.dependency_carrier_size_limits({"totalSize": 1, "abSize": 16 * 1024 * 1024 + 1},
                evidence.MAP_FLOW_TEXTURE_RAW_LIMIT, evidence.MAP_FLOW_TEXTURE_EXPANDED_LIMIT)
        with self.assertRaisesRegex(ValueError, "outside the exact verified scope"):
            evidence.assert_exact_flow_texture_target("refs/fx/texture/other.ab", 12 * 1024 * 1024,
                                                      16 * 1024 * 1024)

    def test_flow_texture_reuses_exact_receipt_without_manifest_refetch_and_reads_texture_header(self):
        row = {"name": evidence.MAP_FLOW_TEXTURE_BUNDLE, "hash": "66f306984be1d33690509d1bc057678d",
               "md5": "c7aaddbe0410d3f675381a7719c791b7", "totalSize": 8_850_267,
               "abSize": 9_940_774, "cid": 13886}
        saved = {"sourceCommit": "8ce3960f56ec2b67495e100a0caa7ccaf947a270", "result": {
            "nativeVersionId": evidence.MAP_OWNER_VERSION, "manifestVersion": "V072",
            "manifestName": evidence.MAP_OWNER_INDEX, "officialManifestBytes": 2_956_517,
            "candidateManifestRecord": row, "candidateManifestRecordFieldTypes": {
                "name": "str", "hash": "str", "md5": "str", "totalSize": "int", "abSize": "int", "cid": "int"}}}
        fake_object = types.SimpleNamespace(path_id=evidence.MAP_OWNER_MESH_PATH_ID,
            type=types.SimpleNamespace(name="Texture2D"),
            read=lambda: types.SimpleNamespace(m_Name="flow_target", m_Width=296, m_Height=296,
                                               m_TextureFormat=4))
        fake_asset = types.SimpleNamespace(name="CAB-c2c688f710a565b7cce0cc93f7bd219f",
            unity_version="2021.3.39f1", objects={evidence.MAP_OWNER_MESH_PATH_ID: fake_object}, externals=[])
        class SizedBlob:
            def __init__(self, size):
                self.size = size
            def __len__(self):
                return self.size
        fake_fetch = types.SimpleNamespace(dat_name=lambda name: "refs_fx_texture_flow.dat",
            get=lambda url, limit: SizedBlob(row["totalSize"]),
            unpack_bundle=lambda raw, name, limit: SizedBlob(row["abSize"]))
        fake_unity = types.SimpleNamespace(__version__="fixture", load=lambda native:
            types.SimpleNamespace(assets=[fake_asset]))
        with tempfile.TemporaryDirectory() as tmp:
            receipt = Path(tmp) / "native-flow-texture-probe.json"
            receipt.write_text(json.dumps(saved), encoding="utf-8")
            with patch.object(evidence, "MAP_FLOW_TEXTURE_METADATA_RECEIPT", receipt), \
                 patch.object(evidence.urllib.request, "urlopen", side_effect=AssertionError("manifest refetched")), \
                 patch.dict(sys.modules, {"fetch_scenes": fake_fetch, "UnityPy": fake_unity,
                                          "aklz4": types.ModuleType("aklz4")}):
                result = evidence.probe_map_flow_texture(evidence.MAP_OWNER_VERSION)
        self.assertEqual(result["status"], "pass", result)
        self.assertEqual(result["candidateManifestRecord"], row)
        self.assertEqual(result["actualRawPackageBytes"], row["totalSize"])
        self.assertEqual(result["actualExpandedBundleBytes"], row["abSize"])
        self.assertEqual(result["targetTexture2DMatches"][0]["name"], "flow_target")
        self.assertEqual(result["targetTexture2DMatches"][0]["width"], 296)
        self.assertEqual(result["targetTexture2DMatches"][0]["height"], 296)
        self.assertTrue(result["ownerResolved"])

    def test_flow_texture_saved_metadata_drift_is_rejected_before_fetch(self):
        saved = {"result": {"nativeVersionId": evidence.MAP_OWNER_VERSION, "manifestVersion": "V072",
            "manifestName": evidence.MAP_OWNER_INDEX, "candidateManifestRecord": {
                "name": "refs/fx/texture/other.ab", "cid": 13886}}}
        with tempfile.TemporaryDirectory() as tmp:
            receipt = Path(tmp) / "native-flow-texture-probe.json"
            receipt.write_text(json.dumps(saved), encoding="utf-8")
            with patch.object(evidence, "MAP_FLOW_TEXTURE_METADATA_RECEIPT", receipt):
                result = evidence.probe_map_flow_texture(evidence.MAP_OWNER_VERSION)
        self.assertEqual(result["failureStage"], "official-manifest")
        self.assertFalse(result["carrierDownloaded"])
        self.assertFalse(result["ownerResolved"])

    def test_flow_probe_separates_texture2d_from_material_and_mesh(self):
        texture = {"serializedFileName": "CAB-c2c688f710a565b7cce0cc93f7bd219f",
                   "pathId": "-4487102536378500135", "type": "Texture2D", "width": 512,
                   "height": 512, "format": "RGBA32"}
        mesh = {**texture, "type": "Mesh"}
        material = {**texture, "type": "Material"}
        self.assertEqual([texture], [row for row in (texture, mesh, material)
                                     if row["type"] == "Texture2D" and row["serializedFileName"].casefold() ==
                                     ("CAB-" + evidence.MAP_OWNER_CAB).casefold()])
        self.assertEqual([], [row for row in (mesh, material) if row["type"] == "Texture2D"])


if __name__ == "__main__":
    unittest.main()
