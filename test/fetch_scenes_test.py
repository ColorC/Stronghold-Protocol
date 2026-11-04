import importlib.util
import ctypes
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / 'tools' / 'local-extract' / 'fetch_scenes.py'
sys.path.insert(0, str(TOOL.parent))
spec = importlib.util.spec_from_file_location('fetch_scenes', TOOL)
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)


def scene_names(stage_id):
    scene = fetch.scenes.scene_bundle(stage_id)
    parent = scene.rsplit('/', 1)[0]
    return [scene, parent + '/lightingdata.ab', parent + '/lightingsettings.ab']


def all_names(include_dependencies=False):
    result = []
    for stage_id, deps in fetch.scenes.SCENES:
        result.extend(scene_names(stage_id))
        if include_dependencies:
            result.extend(deps)
    if include_dependencies:
        result.extend(fetch.scenes.COMMON_DEPS)
    return list(dict.fromkeys(result))


def make_manifest(names=None, version=fetch.VERSION):
    names = all_names(True) if names is None else names
    return {'versionId': version, 'manifestVersion': 'V072',
            'abInfos': [{'name': name, 'totalSize': 999, 'md5': 'intentionally-wrong'} for name in names]}


def zip_bundle(name, member=None, payload=b'UnityFS\x00test'):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member or name, payload)
    return stream.getvalue()


def make_cache(parent, names, version=fetch.VERSION, native_id=None, platform='Android'):
    out = Path(parent) / version
    out.mkdir(parents=True)
    for name in names:
        target = out.joinpath(*Path(name).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b'UnityFS fixture')
    receipt = {'nativeVersionId': native_id or version, 'manifestVersion': 'V072',
               'platform': platform, 'bundles': list(names)}
    (out / fetch.RECEIPT).write_text(json.dumps(receipt))
    return out


def run_cli(args):
    stdout, stderr = StringIO(), StringIO()
    with redirect_stdout(stdout), redirect_stderr(stderr):
        code = fetch.main(args)
    output = stdout.getvalue() or stderr.getvalue()
    return code, json.loads(output)


class FetchScenesTests(unittest.TestCase):
    def test_native_download_encodes_actual_shore_bundle_space_once(self):
        name = 'arts/maps/map_doss_shore/effect profile.ab'
        self.assertTrue(fetch.safe_bundle(name))
        base = fetch.CDN.format(platform='Android', version=fetch.VERSION)
        raw_url = base + fetch.dat_name(name)
        expected = raw_url.replace(' ', '%20')
        for url in (raw_url, expected):
            with patch.object(fetch.urllib.request, 'urlopen', return_value=io.BytesIO(b'UnityFS fixture')) as open_url:
                self.assertEqual(fetch.get(url, 32), b'UnityFS fixture')
                self.assertEqual(open_url.call_args.args[0].full_url, expected)

    def test_control_character_in_bundle_or_url_is_rejected_before_network(self):
        name = 'arts/maps/map_doss_shore/effect\nprofile.ab'
        self.assertFalse(fetch.safe_bundle(name))
        with patch.object(fetch.urllib.request, 'urlopen') as open_url:
            with self.assertRaisesRegex(ValueError, 'control character'):
                fetch.get('https://ak.hycdn.cn/effect\nprofile.dat', 32)
            open_url.assert_not_called()

    def test_upstream_wanted_keeps_matching_scene_order_and_excludes_other_prefixes(self):
        stage_id = 'act2autochess_m02'
        scene = fetch.scenes.scene_bundle(stage_id)
        scene_dir = scene.rsplit('/', 1)[0]
        lighting = scene_dir + '/lightingdata.ab'
        names = ['arts/maps/map_autochess/res.ab', lighting,
                 scene_dir + '_other/level.ab', scene,
                 fetch.scenes.scene_bundle('act2autochess_m03')]
        self.assertEqual(fetch.wanted(names, [stage_id]), [lighting, scene])
        self.assertEqual(fetch.wanted(names, []), [])

    def test_selected_stage_adds_only_its_three_bundles_and_declared_dependencies(self):
        stage_id, deps = fetch.scenes.SCENES[0]
        infos = make_manifest()['abInfos']
        selected = fetch.required_names(infos, [stage_id], True)
        self.assertEqual(set(selected), set(scene_names(stage_id) + deps + fetch.scenes.COMMON_DEPS))
        self.assertNotIn(scene_names(fetch.scenes.SCENES[1][0])[0], selected)

    def test_default_selection_keeps_all_scenes(self):
        names = fetch.required_names(make_manifest()['abInfos'], [sid for sid, _ in fetch.scenes.SCENES], False)
        self.assertEqual(set(names), set(n for sid, _ in fetch.scenes.SCENES for n in scene_names(sid)))

    def test_exact_bundles_merge_with_stage_and_deduplicate(self):
        stage_id = fetch.scenes.SCENES[0][0]
        exact = 'shaders/example.ab'
        infos = make_manifest(all_names(True) + [exact])['abInfos']
        selected = fetch.required_names(infos, [stage_id], True, [exact, scene_names(stage_id)[0]])
        self.assertEqual(len(selected), len(set(selected)))
        self.assertIn(exact, selected)
        self.assertEqual(set(selected), set(scene_names(stage_id) + fetch.scenes.SCENES[0][1] + fetch.scenes.COMMON_DEPS + [exact]))

    def test_exact_bundle_rejects_arbitrary_path(self):
        with self.assertRaisesRegex(ValueError, 'unsafe explicit bundle path'):
            fetch.required_names([], [], False, ['../outside.ab'])

    def test_wrong_digest_is_ignored_and_native_receipt_is_written(self):
        stage_id = fetch.scenes.SCENES[0][0]
        names = scene_names(stage_id)
        manifest = make_manifest(names)
        calls = []
        def fake_get(url, limit):
            calls.append(url)
            if url.endswith('hot_update_list.json'):
                return json.dumps(manifest).encode()
            bundle = next(n for n in names if fetch.dat_name(n) in url)
            return zip_bundle(bundle)
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / fetch.VERSION
            with patch.object(fetch, 'get', side_effect=fake_get):
                self.assertEqual(fetch.main(['--stage', stage_id, '--out', str(out)]), 0)
            receipt = json.loads((out / fetch.RECEIPT).read_text())
            self.assertEqual(receipt['nativeVersionId'], fetch.VERSION)
            self.assertEqual(receipt['manifestVersion'], 'V072')
            self.assertEqual(len(calls), 4)

    def test_missing_declared_dependency_fails_explicitly(self):
        stage_id, deps = fetch.scenes.SCENES[0]
        names = all_names(True)
        names.remove(deps[0])
        with tempfile.TemporaryDirectory() as temp, patch.object(fetch, 'get', return_value=json.dumps(make_manifest(names)).encode()):
            self.assertEqual(fetch.main(['--stage', stage_id, '--include-dependencies', '--out', str(Path(temp) / fetch.VERSION)]), 1)

    def test_unsafe_bundle_path_is_rejected(self):
        stage_id = fetch.scenes.SCENES[0][0]
        names = scene_names(stage_id)
        names[0] = 'scenes/../escape.ab'
        with tempfile.TemporaryDirectory() as temp, patch.object(fetch, 'get', return_value=json.dumps(make_manifest(names)).encode()):
            self.assertEqual(fetch.main(['--stage', stage_id, '--out', str(Path(temp) / fetch.VERSION)]), 1)

    def test_mismatched_zip_member_is_rejected_without_payload(self):
        stage_id = fetch.scenes.SCENES[0][0]
        names = scene_names(stage_id)
        def fake_get(url, limit):
            if url.endswith('hot_update_list.json'):
                return json.dumps(make_manifest(names)).encode()
            bundle = next(n for n in names if fetch.dat_name(n) in url)
            return zip_bundle(bundle, 'wrong.ab')
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / fetch.VERSION
            with patch.object(fetch, 'get', side_effect=fake_get):
                self.assertEqual(fetch.main(['--stage', stage_id, '--out', str(out)]), 1)
            self.assertFalse(any(out.rglob('*.ab')))

    def test_native_version_cache_mismatch_is_rejected(self):
        stage_id = fetch.scenes.SCENES[0][0]
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / fetch.VERSION
            out.mkdir()
            (out / fetch.RECEIPT).write_text(json.dumps({'nativeVersionId': 'old', 'manifestVersion': 'V072', 'platform': 'Android', 'bundles': []}))
            with patch.object(fetch, 'get', return_value=json.dumps(make_manifest()).encode()):
                self.assertEqual(fetch.main(['--stage', stage_id, '--out', str(out)]), 1)

    def test_new_payload_limit_fails_before_any_payload_write(self):
        stage_id = fetch.scenes.SCENES[0][0]
        names = scene_names(stage_id)
        def fake_get(url, limit):
            if url.endswith('hot_update_list.json'):
                return json.dumps(make_manifest(names)).encode()
            bundle = next(n for n in names if fetch.dat_name(n) in url)
            return zip_bundle(bundle)
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / fetch.VERSION
            with patch.object(fetch, 'get', side_effect=fake_get):
                self.assertEqual(fetch.main(['--stage', stage_id, '--max-new-bytes', '1', '--out', str(out)]), 1)
            self.assertFalse(any(out.rglob('*.ab')))
            self.assertFalse((out / fetch.RECEIPT).exists())

    def test_valid_native_cache_is_reused_without_payload_request(self):
        stage_id = fetch.scenes.SCENES[0][0]
        names = scene_names(stage_id)
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / fetch.VERSION
            out.mkdir()
            for name in names:
                target = out.joinpath(*Path(name).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'UnityFS\x00cached')
            (out / fetch.RECEIPT).write_text(json.dumps({'nativeVersionId': fetch.VERSION, 'manifestVersion': 'V072', 'platform': 'Android', 'bundles': names}))
            def manifest_only(url, limit):
                self.assertTrue(url.endswith('hot_update_list.json'))
                return json.dumps(make_manifest(names)).encode()
            with patch.object(fetch, 'get', side_effect=manifest_only):
                self.assertEqual(fetch.main(['--stage', stage_id, '--max-new-bytes', '0', '--out', str(out)]), 0)

    def test_retire_registered_bundle_preserves_unknown_file_and_receipt(self):
        name, unknown = 'scene/known.ab', 'scene/unknown.ab'
        with tempfile.TemporaryDirectory() as temp:
            out = make_cache(temp, [name])
            unknown_path = out.joinpath(*Path(unknown).parts)
            unknown_path.parent.mkdir(parents=True, exist_ok=True)
            unknown_path.write_bytes(b'unknown')
            receipt_path = out / fetch.RECEIPT
            with patch.object(fetch, 'get', side_effect=AssertionError('retire must not use HTTP')):
                with patch.object(fetch, 'exclusive_lock_probe', return_value=True):
                    code, result = run_cli(['--retire-bundle', name, '--out', str(out)])
            self.assertEqual(code, 0)
            self.assertEqual(result['httpRequests'], 0)
            self.assertEqual(result['deleted'], [{'name': name, 'path': str(out.joinpath(*Path(name).parts)), 'bytes': len(b'UnityFS fixture')}])
            self.assertFalse(out.joinpath(*Path(name).parts).exists())
            self.assertTrue(unknown_path.exists())
            self.assertTrue(receipt_path.exists())
            self.assertEqual(json.loads(receipt_path.read_text())['bundles'], [])

    def test_retire_refuses_traversal_and_version_or_platform_mismatch(self):
        with tempfile.TemporaryDirectory() as temp:
            out = make_cache(temp, ['scene/keep.ab'])
            code, result = run_cli(['--retire-bundle', '../outside.ab', '--out', str(out)])
            self.assertEqual(code, 1)
            self.assertIn('unsafe bundle path', result['refused'][0]['reason'])
            self.assertTrue(result['refused'][0]['path'].endswith('outside.ab'))
            receipt = json.loads((out / fetch.RECEIPT).read_text())
            receipt['nativeVersionId'] = 'different-version'
            (out / fetch.RECEIPT).write_text(json.dumps(receipt))
            with patch.object(fetch, 'exclusive_lock_probe', return_value=True):
                code, result = run_cli(['--retire-bundle', 'scene/keep.ab', '--out', str(out)])
            self.assertEqual(code, 1)
            self.assertIn('nativeVersionId/platform mismatch', result['refused'][0]['reason'])
            self.assertTrue(out.joinpath('scene', 'keep.ab').exists())

    def test_retire_refuses_symlink_or_junction_ancestor(self):
        with tempfile.TemporaryDirectory() as temp:
            out = make_cache(temp, [])
            external = out / 'real'
            external.mkdir()
            external_file = external / 'target.ab'
            external_file.write_bytes(b'UnityFS outside')
            link = out / 'link'
            try:
                os.symlink(external, link, target_is_directory=True)
            except OSError:
                created = subprocess.run(['cmd.exe', '/c', 'mklink', '/J', str(link), str(external)],
                                         capture_output=True, text=True)
                if created.returncode != 0:
                    self.skipTest(f'OS does not permit symlink or junction fixture: {created.stderr[:120]}')
            receipt = json.loads((out / fetch.RECEIPT).read_text())
            receipt['bundles'] = ['link/target.ab']
            (out / fetch.RECEIPT).write_text(json.dumps(receipt))
            code, result = run_cli(['--retire-bundle', 'link/target.ab', '--out', str(out)])
            self.assertEqual(code, 1)
            self.assertIn('symlink', result['refused'][0]['reason'])
            self.assertTrue(external_file.exists())
            os.rmdir(link)

    def test_retire_refuses_hardlink(self):
        with tempfile.TemporaryDirectory() as temp:
            name = 'scene/shared.ab'
            out = make_cache(temp, [name])
            target = out.joinpath(*Path(name).parts)
            alias = out / 'alias.ab'
            try:
                os.link(target, alias)
            except OSError as exc:
                self.skipTest(f'OS does not permit test hardlink: {exc}')
            code, result = run_cli(['--retire-bundle', name, '--out', str(out)])
            self.assertEqual(code, 1)
            self.assertIn('hard-linked', result['refused'][0]['reason'])
            self.assertTrue(target.exists())

    def test_retire_refuses_exclusive_lock_and_wrong_version_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            out = make_cache(temp, ['scene/locked.ab'])
            with patch.object(fetch, 'exclusive_lock_probe', return_value=False):
                code, result = run_cli(['--retire-bundle', 'scene/locked.ab', '--out', str(out)])
            self.assertEqual(code, 1)
            self.assertIn('share=0', result['refused'][0]['reason'])
            self.assertTrue(out.joinpath('scene', 'locked.ab').exists())
            wrong = Path(temp) / 'other-cache'
            wrong.mkdir()
            code, result = run_cli(['--retire-bundle', 'scene/locked.ab', '--out', str(wrong)])
            self.assertEqual(code, 1)
            self.assertIn('version folder', result['refused'][0]['reason'])

    @unittest.skipUnless(os.name == 'nt', 'Windows CreateFile share-mode probe')
    def test_windows_native_exclusive_probe_accepts_unlocked_file(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'unlocked.ab'
            path.write_bytes(b'UnityFS fixture')
            self.assertTrue(fetch.exclusive_lock_probe(path))

    @unittest.skipUnless(os.name == 'nt', 'Windows CreateFile share-mode lock')
    def test_retire_refuses_file_held_by_real_exclusive_handle(self):
        from ctypes import wintypes
        with tempfile.TemporaryDirectory() as temp:
            name = 'scene/held.ab'
            out = make_cache(temp, [name])
            target = out.joinpath(*Path(name).parts)
            kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
            create = kernel32.CreateFileW
            create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                               wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
            create.restype = wintypes.HANDLE
            handle = create(str(target), 0x80000000, 0, None, 3, 0x80, None)
            invalid = ctypes.c_void_p(-1).value
            self.assertNotEqual(handle, invalid)
            try:
                code, result = run_cli(['--retire-bundle', name, '--out', str(out)])
            finally:
                kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
                kernel32.CloseHandle(handle)
            self.assertEqual(code, 1)
            self.assertIn('share=0', result['refused'][0]['reason'])
            self.assertTrue(target.exists())

    def test_retire_refuses_directory_and_missing_registered_bundle(self):
        names = ['scene/folder.ab', 'scene/missing.ab']
        with tempfile.TemporaryDirectory() as temp:
            out = make_cache(temp, [])
            receipt = json.loads((out / fetch.RECEIPT).read_text())
            receipt['bundles'] = names
            (out / fetch.RECEIPT).write_text(json.dumps(receipt))
            (out / 'scene' / 'folder.ab').mkdir(parents=True)
            code, result = run_cli(['--retire-bundle', names[0], '--retire-bundle', names[1], '--out', str(out)])
            self.assertEqual(code, 1)
            self.assertEqual(len(result['refused']), 2)
            self.assertIn('regular file', result['refused'][0]['reason'])
            self.assertIn('missing', result['refused'][1]['reason'])

    def test_retire_partial_failure_updates_only_deleted_receipt_names(self):
        names = ['scene/free.ab', 'scene/busy.ab']
        with tempfile.TemporaryDirectory() as temp:
            out = make_cache(temp, names)
            def available(path):
                return path.name == 'free.ab'
            with patch.object(fetch, 'exclusive_lock_probe', side_effect=available):
                code, result = run_cli(['--retire-bundle', names[0], '--retire-bundle', names[1], '--out', str(out)])
            self.assertEqual(code, 1)
            self.assertEqual([x['name'] for x in result['deleted']], [names[0]])
            self.assertEqual([x['name'] for x in result['refused']], [names[1]])
            self.assertTrue(result['receiptUpdated'])
            self.assertEqual(json.loads((out / fetch.RECEIPT).read_text())['bundles'], [names[1]])

    def test_retired_bundle_can_be_fetched_again_through_normal_cli(self):
        name = 'assets/recovered.ab'
        with tempfile.TemporaryDirectory() as temp:
            out = make_cache(temp, [name])
            with patch.object(fetch, 'exclusive_lock_probe', return_value=True):
                code, _ = run_cli(['--retire-bundle', name, '--out', str(out)])
            self.assertEqual(code, 0)
            calls = []
            manifest = make_manifest([name])
            def fake_get(url, limit):
                calls.append(url)
                return json.dumps(manifest).encode() if url.endswith('hot_update_list.json') else zip_bundle(name)
            with patch.object(fetch, 'get', side_effect=fake_get):
                code, result = run_cli(['--bundle', name, '--out', str(out)])
            self.assertEqual(code, 0)
            self.assertEqual(len(calls), 2)
            self.assertTrue(out.joinpath(*Path(name).parts).exists())
            self.assertEqual(json.loads((out / fetch.RECEIPT).read_text())['bundles'], [name])

    def test_memory_bundle_uses_exact_listed_zip_member_without_writing(self):
        name = 'arts/maps/map_survivaloasis_city/res.ab'
        manifest = make_manifest([name])
        calls = []
        def fake_get(url, limit):
            calls.append(url)
            return json.dumps(manifest).encode() if url.endswith('hot_update_list.json') else zip_bundle(name)
        with patch.object(fetch, 'get', side_effect=fake_get):
            result = fetch.fetch_memory_bundles(fetch.VERSION, fetch.PLATFORM, [name], 100)
        self.assertEqual(result['nativeVersionId'], fetch.VERSION)
        self.assertEqual(result['platform'], fetch.PLATFORM)
        self.assertEqual(result['totalBytes'], len(b'UnityFS\x00test'))
        self.assertEqual(list(result['bundles']), [name])
        self.assertEqual(result['bundles'][name], b'UnityFS\x00test')
        self.assertEqual(len(calls), 2)

    def test_memory_bundle_rejects_native_version_unlisted_name_member_and_non_unityfs(self):
        name = 'arts/maps/map_survivaloasis_city/res.ab'
        with self.assertRaisesRegex(ValueError, 'unsafe explicit memory bundle name'):
            fetch.fetch_memory_bundles(fetch.VERSION, fetch.PLATFORM, ['../escape.ab'], 100)
        wrong = make_manifest([name], version='wrong-version')
        with patch.object(fetch, 'get', return_value=json.dumps(wrong).encode()):
            with self.assertRaisesRegex(ValueError, 'identity/fields mismatch'):
                fetch.fetch_memory_bundles(fetch.VERSION, fetch.PLATFORM, [name], 100)
        manifest = make_manifest([name])
        with patch.object(fetch, 'get', return_value=json.dumps(manifest).encode()):
            with self.assertRaisesRegex(ValueError, 'omits memory bundles'):
                fetch.fetch_memory_bundles(fetch.VERSION, fetch.PLATFORM, ['arts/maps/not-listed.ab'], 100)
        with patch.object(fetch, 'get', return_value=json.dumps(manifest).encode()):
            with self.assertRaisesRegex(ValueError, 'manifestVersion differs'):
                fetch.fetch_memory_bundles(fetch.VERSION, fetch.PLATFORM, [name], 100, 'other-manifest')
        for zipped, error in [(zip_bundle(name, member='arts/maps/other.ab'), 'member mismatch'),
                              (zip_bundle(name, payload=b'not a bundle'), 'invalid UnityFS header')]:
            def fake_get(url, limit, zipped=zipped):
                return json.dumps(manifest).encode() if url.endswith('hot_update_list.json') else zipped
            with patch.object(fetch, 'get', side_effect=fake_get):
                with self.assertRaisesRegex(ValueError, error):
                    fetch.fetch_memory_bundles(fetch.VERSION, fetch.PLATFORM, [name], 100)

    def test_memory_bundle_aggregate_limit_rejects_before_returning_any_payload(self):
        names = ['arts/maps/one.ab', 'arts/maps/two.ab']
        manifest = make_manifest(names)
        calls = []
        def fake_get(url, limit):
            calls.append(url)
            if url.endswith('hot_update_list.json'):
                return json.dumps(manifest).encode()
            bundle = next(name for name in names if fetch.dat_name(name) == url.rsplit('/', 1)[-1])
            return zip_bundle(bundle)
        with patch.object(fetch, 'get', side_effect=fake_get):
            with self.assertRaisesRegex(ValueError, 'uncompressed payload exceeds remaining byte limit'):
                fetch.fetch_memory_bundles(fetch.VERSION, fetch.PLATFORM, names, 20)
        self.assertEqual(len(calls), 3)  # manifest plus both individually bounded DAT payloads

    def test_memory_source_requires_receipt_identity_and_registered_stage(self):
        name = fetch.scenes.scene_bundle('act1autochess_m02')
        with tempfile.TemporaryDirectory() as temp:
            root = make_cache(temp, [name])
            self.assertEqual(fetch.read_memory_bundle_source(root, name), (fetch.VERSION, fetch.PLATFORM, 'V072'))
            receipt_path = root / fetch.RECEIPT
            receipt = json.loads(receipt_path.read_text())
            receipt['nativeVersionId'] = 'another-version'
            receipt_path.write_text(json.dumps(receipt))
            with self.assertRaisesRegex(ValueError, 'not registered'):
                fetch.read_memory_bundle_source(root, 'scenes/activities/act1autochess/other/other.ab')

    def test_retired_stage_receipt_keeps_version_identity_without_treating_sentinel_as_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / fetch.VERSION
            root.mkdir()
            (root / fetch.RECEIPT).write_text(json.dumps({
                'nativeVersionId': fetch.VERSION, 'platform': fetch.PLATFORM,
                'manifestVersion': 'V072', 'bundles': []}), encoding='utf-8')
            name = fetch.scenes.scene_bundle('act1autochess_m05')
            self.assertEqual(fetch.read_memory_bundle_source(root, name, allow_retired=True),
                             (fetch.VERSION, fetch.PLATFORM, 'V072'))
            with self.assertRaisesRegex(ValueError, 'not registered'):
                fetch.read_memory_bundle_source(root, name)


if __name__ == '__main__':
    unittest.main()
