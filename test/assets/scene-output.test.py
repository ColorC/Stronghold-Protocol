import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

WORKTREE_ROOT = Path(__file__).resolve().parents[2]
COMMON_DIR = Path(subprocess.check_output(
    ['git', '-C', str(WORKTREE_ROOT), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    text=True, encoding='utf-8').strip()).resolve(strict=True)
ROOT = COMMON_DIR.parent
GIT_ROOT = Path(subprocess.check_output(
    ['git', '-C', str(ROOT), 'rev-parse', '--show-toplevel'], text=True, encoding='utf-8').strip()).resolve(strict=True)
if ROOT.resolve(strict=True) != GIT_ROOT or WORKTREE_ROOT.is_symlink() or COMMON_DIR.is_symlink():
    raise RuntimeError(f'canonical fixture root verification failed: common={COMMON_DIR}, root={ROOT}, git={GIT_ROOT}')
TOOL = WORKTREE_ROOT / 'tools' / 'local-extract'
sys.path.insert(0, str(TOOL))
import scene_output

spec = importlib.util.spec_from_file_location('extract_scenes', TOOL / 'extract.py')
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)

FIXTURES = ROOT / '.omni' / 'tmp' / 'assault' / 'scene-export-fixtures'
UNITY_RESOURCES = Path(r'C:\Program Files\Unity\Hub\Editor\2021.3.48f1\Editor\Data\Resources\unity default resources')


class FakeImage:
    width = height = 1

    def __init__(self, webp_fails=False, webp_partial=False):
        self.webp_fails = webp_fails
        self.webp_partial = webp_partial

    def save(self, target, fmt, **kwargs):
        if fmt == 'WEBP' and self.webp_fails:
            if self.webp_partial:
                target.write(b'partial-webp')
            raise OSError('webp unavailable')
        target.write((fmt + ':' + json.dumps(kwargs, sort_keys=True)).encode())


class SceneOutputTests(unittest.TestCase):
    def setUp(self):
        scene_output.SceneOutput._reject_linked_ancestors(FIXTURES / 'probe')
        if FIXTURES.resolve() != Path(os.path.abspath(FIXTURES)):
            raise RuntimeError(f'fixture path resolves through a reparse point: {FIXTURES}')
        self.created_fixture_dirs = []
        cursor = FIXTURES
        while cursor != ROOT and not cursor.exists():
            self.created_fixture_dirs.append(cursor)
            cursor = cursor.parent
        FIXTURES.mkdir(parents=True, exist_ok=True)
        self.case = FIXTURES / self._testMethodName
        self.case.mkdir(parents=True, exist_ok=True)
        self.out = self.case / 'assets'
        self.manifest = self.case / 'local-assets.json'

    def tearDown(self):
        known_files = [self.manifest, self.out / 'scene/s1/scene.bin', self.out / 'scene/tex/shared.webp',
                       self.case / 'other.json', self.case / 'other-assets/scene.bin',
                       self.case / 'budget-manifest.json', self.case / 'hardlink-source.bin',
                       self.out / 'scene/s1/hardlink.bin',
                       self.case / 'native-source' / Path(extract.scenes.scene_bundle('act1autochess_m02')),
                       self.case / 'native-source' / extract.fetch_scenes.RECEIPT]
        for path in known_files:
            if path.is_file() and not path.is_symlink():
                path.unlink()
        for path in [self.out / 'scene/s1', self.out / 'scene/tex', self.out / 'scene', self.out,
                     self.case / 'other-assets', self.case / 'game', self.case]:
            if path.is_dir() and not path.is_symlink() and not any(path.iterdir()):
                path.rmdir()
        native_root = self.case / 'native-source'
        native_stage_dir = native_root / Path(extract.scenes.scene_bundle('act1autochess_m02')).parent
        for path in [native_stage_dir, *native_stage_dir.parents]:
            if path == self.case:
                break
            if path.is_dir() and not path.is_symlink() and not any(path.iterdir()):
                path.rmdir()
        for path in self.created_fixture_dirs:
            if path.is_dir() and not path.is_symlink() and not any(path.iterdir()):
                path.rmdir()

    def test_webp_only_uses_native_options_and_never_dual_writes(self):
        output = scene_output.SceneOutput(self.out, webp_only=True)
        entry = output.image(FakeImage(), self.out / 'scene/s1', 'lm0', 'scene/s1')
        path = self.out / 'scene/s1/lm0.webp'
        self.assertEqual(entry['path'], '/assets/local/scene/s1/lm0.webp')
        self.assertIn(b'"alpha_quality": 100', output.pending[path])
        self.assertIn(b'"exact": true', output.pending[path])
        self.assertFalse((self.out / 'scene/s1/lm0.png') in output.pending)

    def test_default_mode_keeps_existing_png_and_webp_pair(self):
        output = scene_output.SceneOutput(self.out)
        entry = output.image(FakeImage(), self.out / 'scene/s1', 'lm0', 'scene/s1')
        self.assertEqual(entry['path'], '/assets/local/scene/s1/lm0.webp')
        self.assertIn(self.out / 'scene/s1/lm0.png', output.pending)
        self.assertIn(self.out / 'scene/s1/lm0.webp', output.pending)

    def test_default_webp_partial_failure_keeps_png_bytes_and_omits_webp(self):
        output = scene_output.SceneOutput(self.out)
        entry = output.image(FakeImage(webp_fails=True, webp_partial=True), self.out / 'scene/s1', 'lm0', 'scene/s1')
        self.assertEqual(entry['path'], '/assets/local/scene/s1/lm0.png')
        self.assertEqual(output.pending[self.out / 'scene/s1/lm0.png'], b'PNG:{}')
        self.assertNotIn(self.out / 'scene/s1/lm0.webp', output.pending)

    def test_webp_failure_falls_back_to_one_png(self):
        output = scene_output.SceneOutput(self.out, webp_only=True)
        entry = output.image(FakeImage(webp_fails=True), self.out / 'scene/s1', 'lm0', 'scene/s1')
        self.assertEqual(entry['path'], '/assets/local/scene/s1/lm0.png')
        self.assertEqual(list(output.pending), [self.out / 'scene/s1/lm0.png'])

    def test_budget_exact_succeeds_and_over_limit_writes_nothing(self):
        data = b'new scene bytes'
        doc = {'version': 1, 'groups': {}}
        manifest_bytes = json.dumps(doc, separators=(',', ':')).encode()
        out = self.out / 'scene/s1/scene.bin'
        exact = scene_output.SceneOutput(self.out, len(data) + len(manifest_bytes))
        exact.stage(out, data)
        exact.commit(self.manifest, doc)
        self.assertEqual(out.read_bytes(), data)
        self.assertEqual(self.manifest.read_bytes(), manifest_bytes)
        self.assertEqual(exact.created, [out])
        # Fresh output path: one byte short rejects before creating any output.
        second = self.case / 'other-assets'
        limited = scene_output.SceneOutput(second, len(data) + len(manifest_bytes) - 1)
        limited.stage(second / 'scene.bin', data)
        with self.assertRaisesRegex(scene_output.SceneOutputError, 'budget exceeded'):
            limited.commit(self.case / 'other.json', doc)
        self.assertFalse((second / 'scene.bin').exists())
        self.assertFalse((self.case / 'other.json').exists())

        # Replacing an existing manifest counts its full new bytes at peak.
        existing_manifest = self.case / 'budget-manifest.json'
        existing_manifest.write_bytes(b'{"version":0,"groups":{}}')
        limited_replace = scene_output.SceneOutput(second, len(data) + len(manifest_bytes) - 1)
        limited_replace.stage(second / 'new.bin', data)
        with self.assertRaisesRegex(scene_output.SceneOutputError, 'budget exceeded'):
            limited_replace.commit(existing_manifest, doc)
        self.assertEqual(existing_manifest.read_bytes(), b'{"version":0,"groups":{}}')
        self.assertFalse((second / 'new.bin').exists())

    def test_preview_reports_exact_bytes_without_writes(self):
        output = scene_output.SceneOutput(self.out, max_bytes=128, webp_only=True, strict=True)
        out_file = self.out / 'scene/s1/scene.bin'
        output.stage(out_file, b'planned binary')
        preview = output.preview(self.manifest, {'version': 1, 'groups': {'scene/s1': {}}})
        self.assertEqual(preview['plannedNewBytes'], len(b'planned binary') + len(self.manifest.read_bytes())
                         if self.manifest.exists() else len(b'planned binary') +
                         len(json.dumps({'version': 1, 'groups': {'scene/s1': {}}}, separators=(',', ':')).encode()))
        self.assertEqual({row['action'] for row in preview['plannedFiles']}, {'create'})
        self.assertFalse(out_file.exists())
        self.assertFalse(self.manifest.exists())
        self.assertFalse(self.out.exists())

    def test_preview_enforces_output_budget_without_writes(self):
        output = scene_output.SceneOutput(self.out, max_bytes=1, webp_only=True, strict=True)
        output.stage(self.out / 'scene/s1/scene.bin', b'too much')
        with self.assertRaisesRegex(scene_output.SceneOutputError, 'budget exceeded'):
            output.preview(self.manifest, {'version': 1, 'groups': {}})
        self.assertFalse(self.out.exists())
        self.assertFalse(self.manifest.exists())

    def test_reparse_ancestors_are_rejected_and_plain_directories_pass(self):
        scene_output.SceneOutput._reject_linked_ancestors(self.case / 'plain' / 'file.bin')
        junction = self.case / 'junction' / 'file.bin'
        real_lstat = os.lstat

        def lstat_with_junction(path):
            if Path(path) == junction.parent:
                return SimpleNamespace(st_file_attributes=0x400, st_mode=stat.S_IFDIR, st_nlink=1)
            return real_lstat(path)

        with patch.object(scene_output.os, 'lstat', side_effect=lstat_with_junction):
            with self.assertRaisesRegex(scene_output.SceneOutputError, 'reparse'):
                scene_output.SceneOutput._reject_linked_ancestors(junction)

    def test_hard_linked_output_is_rejected(self):
        source = self.case / 'hardlink-source.bin'
        target = self.out / 'scene/s1/hardlink.bin'
        source.write_bytes(b'same')
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(source, target)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f'hard links unavailable in fixture filesystem: {exc}')
        output = scene_output.SceneOutput(self.out)
        output.stage(target, b'same')
        with self.assertRaisesRegex(scene_output.SceneOutputError, 'hard-linked'):
            output.commit(self.manifest, {'version': 1, 'groups': {}})

    def test_bad_manifest_is_rejected_before_output(self):
        self.manifest.write_text('{bad', encoding='utf-8')
        with self.assertRaises(Exception):
            scene_output.read_manifest(self.manifest)
        self.assertEqual(list(self.case.iterdir()), [self.manifest])

    def test_normal_entrypoint_manifest_error_performs_zero_writes(self):
        game = self.case / 'game'
        game.mkdir()
        self.manifest.write_text('{"groups":[]}', encoding='utf-8')
        argv = ['extract.py', '--game', str(game), '--out', str(self.out), '--manifest', str(self.manifest), '--only', 'scene']
        with patch.object(sys, 'argv', argv):
            self.assertEqual(extract.main(), 2)
        self.assertFalse(self.out.exists())
        self.assertEqual(self.manifest.read_text(encoding='utf-8'), '{"groups":[]}')

    def test_strict_mode_fails_when_selected_scene_bundle_is_missing(self):
        stage_id = extract.scenes.SCENES[0][0]
        with self.assertRaisesRegex(RuntimeError, 'scene bundle missing'):
            extract.export_scenes(self.case, self.out, {}, lambda _msg: None, [stage_id], [],
                                  scene_output.SceneOutput(self.out, strict=True), True)
        self.assertFalse(self.out.exists())

    def test_missing_unused_m02_theme_candidate_is_allowed_but_actual_reference_fails(self):
        # Native act1autochess_m02 has a missing map_survivaloasis_city/res.ab hint.
        missing_theme = self.case / 'arts/maps/map_survivaloasis_city/res.ab'
        loaded = []
        logs = []
        env = SimpleNamespace(load_file=lambda path: loaded.append(path))
        extract.scenes.load_scene_dependencies(env, [missing_theme], [], 'act1autochess_m02', logs.append, True)
        self.assertEqual(loaded, [])
        self.assertIn('candidate', logs[0])

        class MissingThemeMaterial:
            def read(self):
                raise OSError('external material CAB unavailable')

        with self.assertRaisesRegex(RuntimeError, 'material unresolved: external material CAB unavailable'):
            extract.scenes.read_material_pointer(MissingThemeMaterial(), 'act1autochess_m02', True)

    def test_memory_bundle_is_loaded_by_exact_name_without_filesystem_copy(self):
        calls = []
        env = SimpleNamespace(load_file=lambda *args, **kwargs: calls.append((args, kwargs)))
        payload = {'nativeVersionId': '26-04-13-12-31-42_e9b560', 'platform': 'Android',
                   'manifestVersion': 'V072',
                   'bundles': {'arts/maps/map_survivaloasis_city/res.ab': b'UnityFS fixture'}}
        records = extract.scenes.load_memory_dependencies(env, payload, 'act1autochess_m02', lambda _msg: None)
        self.assertEqual(calls, [((b'UnityFS fixture',),
                                  {'name': 'arts/maps/map_survivaloasis_city/res.ab', 'is_dependency': True})])
        self.assertEqual(records, [{'name': 'arts/maps/map_survivaloasis_city/res.ab', 'bytes': 15,
                                    'memoryOnly': True, 'nativeVersionId': '26-04-13-12-31-42_e9b560',
                                    'manifestVersion': 'V072', 'isDependency': True,
                                    'platform': 'Android'}])

    def test_stage_lightingdata_memory_file_is_primary_for_scene_lightmap_enumeration(self):
        name = 'scenes/activities/act2autochess/level_act2autochess_m04/level_act2autochess_m04/lightingdata.ab'
        calls = []
        env = SimpleNamespace(load_file=lambda *args, **kwargs: calls.append((args, kwargs)))
        records = extract.scenes.load_memory_dependencies(env, {
            'nativeVersionId': '26-04-13-12-31-42_e9b560', 'manifestVersion': 'V072', 'platform': 'Android',
            'bundles': {name: b'UnityFS lighting data'}}, 'act2autochess_m04', lambda _msg: None, [name])
        self.assertEqual(calls, [((b'UnityFS lighting data',), {'name': name, 'is_dependency': False})])
        self.assertFalse(records[0]['isDependency'])

    def test_native_unityfs_bundle_is_accepted_by_unitypy_with_original_name_in_memory(self):
        import aklz4
        import UnityPy
        from UnityPy.environment import Environment

        name = 'arts/maps/map_autochesssand/res.ab'
        native = extract.fetch_scenes.fetch_memory_bundles(
            '26-04-13-12-31-42_e9b560', 'Android', [name], 24 * 1024 * 1024,
            expected_manifest_version='V072')
        payload = native['bundles'][name]
        self.assertLessEqual(len(payload), 24 * 1024 * 1024)
        env = Environment()
        record = extract.scenes.load_memory_dependencies(env, {
            **{key: native[key] for key in ('nativeVersionId', 'manifestVersion', 'platform')},
            'bundles': native['bundles']}, 'act1autochess_m02', lambda _msg: None)
        self.assertEqual(record[0]['name'], name)
        self.assertEqual(record[0]['bytes'], len(payload))
        self.assertTrue(record[0]['memoryOnly'])
        self.assertFalse((self.out / Path(name)).exists())

    def test_flow_dependency_uses_existing_exact_memory_bundle_channel(self):
        name = 'refs/fx/texture/flow.ab'
        self.assertTrue(extract.fetch_scenes.safe_bundle(name))
        calls = []
        env = SimpleNamespace(load_file=lambda *args, **kwargs: calls.append((args, kwargs)))
        memory = {'nativeVersionId': '26-04-13-12-31-42_e9b560', 'manifestVersion': 'V072',
                  'platform': 'Android', 'bundles': {name: b'UnityFS flow fixture'}}
        records = extract.scenes.load_memory_dependencies(env, memory, 'act1autochess_m05', lambda _msg: None)
        self.assertEqual(calls, [((b'UnityFS flow fixture',), {'name': name, 'is_dependency': True})])
        self.assertEqual(records[0]['name'], name)
        self.assertTrue(records[0]['memoryOnly'])
        self.assertEqual(records[0]['nativeVersionId'], '26-04-13-12-31-42_e9b560')

    def test_stage_memory_preview_scope_and_three_source_bundles(self):
        scene_names = [extract.scenes.scene_bundle('act1autochess_m05'),
                       'scenes/activities/act1autochess/level_act1autochess_m05/level_act1autochess_m05_lighting_settings.ab',
                       'scenes/activities/act1autochess/level_act1autochess_m05/level_act1autochess_m05/lightingdata.ab']
        dependency = 'refs/fx/texture/flow.ab'
        infos = [{'name': name} for name in [*scene_names, dependency]]
        responses = []
        manifest = json.dumps({'versionId': '26-04-13-12-31-42_e9b560', 'manifestVersion': 'V072',
                               'abInfos': infos}).encode()
        def fake_get(url, _limit):
            if url.endswith('hot_update_list.json'):
                return manifest
            name = url.rsplit('/', 1)[-1].replace('.dat', '').replace('_', '/')
            # The test only needs valid one-member UnityFS archives; lookup the official encoded basename.
            source_name = next(item['name'] for item in infos
                               if extract.fetch_scenes.dat_name(item['name']) == url.rsplit('/', 1)[-1])
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w') as zipped:
                zipped.writestr(source_name, b'UnityFS fixture')
            return archive.getvalue()
        with patch.object(extract.fetch_scenes, 'get', side_effect=fake_get):
            memory = extract.fetch_scenes.fetch_memory_bundles(
                '26-04-13-12-31-42_e9b560', 'Android', [dependency], 40 * 1024 * 1024,
                expected_manifest_version='V072', stage_ids=['act1autochess_m05'])
        self.assertEqual(memory['sceneBundles'], scene_names)
        self.assertEqual(set(memory['bundles']), {*scene_names, dependency})
        self.assertFalse((self.out / Path(scene_names[0])).exists())
        with self.assertRaisesRegex(ValueError, 'not enabled'):
            extract.fetch_scenes.fetch_memory_bundles(
                '26-04-13-12-31-42_e9b560', 'Android', [dependency], 40 * 1024 * 1024,
                expected_manifest_version='V072', stage_ids=['act1autochess_m06'])
        deps = ['arts/maps/map_autochesssand/res.ab', 'arts/maps/map_yumen/res.ab',
                'arts/maps/map_survivaloasis_city/res.ab',
                'arts/maps/map_doss_shore/res.ab', 'arts/maps/effect.ab',
                'shaders/standardrealtimeshadow.ab', 'shaders/stylizedwater.ab',
                'shaders/dynamicwatertile.ab', 'refs/fx/texture/flow.ab']
        stage_root = ROOT / '.omni/tmp/assault/native-scene-input/26-04-13-12-31-42_e9b560'
        fake_memory = {'nativeVersionId': '26-04-13-12-31-42_e9b560', 'platform': 'Android',
                       'manifestVersion': 'V072', 'sceneBundles': scene_names, 'bundles': {}, 'totalBytes': 0}
        with patch.object(extract.fetch_scenes, 'fetch_memory_bundles', return_value=fake_memory) as fetch:
            source = extract.scene_memory_source('act1autochess_m05', [stage_root], deps,
                                                 40 * 1024 * 1024, include_stage_bundles=True)
        self.assertIs(source, fake_memory)
        fetch.assert_called_once_with('26-04-13-12-31-42_e9b560', 'Android', deps, 40 * 1024 * 1024, 'V072',
                                      ['act1autochess_m05'])

    def test_memory_bundle_cli_rejects_multiple_stages_before_output(self):
        game = self.case / 'game'
        game.mkdir()
        argv = ['extract.py', '--game', str(game), '--out', str(self.out), '--manifest', str(self.manifest),
                '--only', 'scene', '--strict-scenes', '--scene-webp-only', '--scene-memory-bundle',
                'arts/maps/map_survivaloasis_city/res.ab', '--max-scene-memory-bytes', '25165824']
        with patch.object(sys, 'argv', argv), self.assertRaises(SystemExit) as raised:
            extract.main()
        self.assertEqual(raised.exception.code, 2)
        self.assertFalse(self.out.exists())
        over_bound = argv[:-1] + ['25165825']
        with patch.object(sys, 'argv', over_bound), self.assertRaises(SystemExit) as raised:
            extract.main()
        self.assertEqual(raised.exception.code, 2)
        self.assertFalse(self.out.exists())

    def test_memory_bundle_preflight_failures_leave_manifest_and_outputs_untouched(self):
        stage_id = 'act1autochess_m02'
        bundle = 'arts/maps/map_survivaloasis_city/res.ab'
        stage_bundle = extract.scenes.scene_bundle(stage_id)
        game = self.case / 'game'
        game.mkdir()
        source_root = self.case / 'native-source'
        stage_path = source_root.joinpath(*Path(stage_bundle).parts)
        stage_path.parent.mkdir(parents=True, exist_ok=True)
        stage_path.write_bytes(b'UnityFS stage')
        (source_root / extract.fetch_scenes.RECEIPT).write_text(json.dumps({
            'nativeVersionId': extract.fetch_scenes.VERSION, 'platform': extract.fetch_scenes.PLATFORM,
            'manifestVersion': 'V072', 'bundles': [stage_bundle]}), encoding='utf-8')
        valid_old_manifest = {'version': 1, 'groups': {'keep': {'old': {'path': '/old'}}}}
        self.manifest.write_text(json.dumps(valid_old_manifest), encoding='utf-8')
        original = self.manifest.read_bytes()
        argv = ['extract.py', '--game', str(game), '--scenes', str(source_root), '--out', str(self.out),
                '--manifest', str(self.manifest), '--only', f'scene/{stage_id}', '--strict-scenes',
                '--scene-webp-only', '--scene-memory-bundle', bundle, '--max-scene-memory-bytes', '1']
        good_manifest = {'versionId': extract.fetch_scenes.VERSION, 'manifestVersion': 'V072',
                         'abInfos': [{'name': bundle}]}

        for response, expected in [(json.dumps({**good_manifest, 'versionId': 'wrong-version'}).encode(), 'identity/fields mismatch'),
                                   (json.dumps(good_manifest).encode(), 'uncompressed payload exceeds remaining byte limit')]:
            def fake_get(url, _limit, response=response):
                if url.endswith('hot_update_list.json'):
                    return response
                archive = io.BytesIO()
                with zipfile.ZipFile(archive, 'w') as zipped:
                    zipped.writestr(bundle, b'UnityFS over limit')
                return archive.getvalue()
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(extract.fetch_scenes, 'get', side_effect=fake_get), patch.object(sys, 'argv', argv), \
                    redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(extract.main(), 2)
            self.assertIn(expected, stderr.getvalue())
            self.assertFalse(self.out.exists())
            self.assertEqual(self.manifest.read_bytes(), original)

    def test_missing_explicit_shader_dependency_still_fails_strict(self):
        missing_shader = self.case / 'shaders' / 'missing.ab'
        env = SimpleNamespace(load_file=lambda _path: None)
        with self.assertRaisesRegex(RuntimeError, 'required dependency missing'):
            extract.scenes.load_scene_dependencies(env, [], [missing_shader], 'act1autochess_m02', lambda _msg: None, True)

    def test_grid_range_drawer_null_mesh_pointer_zero_is_skipped_placeholder(self):
        reason = extract.scenes.meshless_placeholder_reason(has_mesh_filter=True, mesh_path_id=0, is_static=False)
        self.assertEqual(reason, 'null mesh pointer (runtime-generated placeholder)')
        self.assertIsNone(extract.scenes.meshless_placeholder_reason(True, 0, True))
        self.assertEqual(extract.scenes.meshless_placeholder_reason(False, 0, False),
                         'no MeshFilter (runtime-generated placeholder)')

    def test_nonzero_unreadable_mesh_pointer_still_fails_strict(self):
        class Pointer:
            m_PathID = 2904

            def read(self):
                raise OSError('external mesh dependency unavailable')

        messages = []
        with self.assertRaisesRegex(RuntimeError, 'mesh unresolved #2904'):
            extract.scenes.read_mesh_data(Pointer(), lambda _obj: None, 'act1autochess_m03', messages.append, True)
        self.assertIn('mesh PPtr #2904', messages[0])

    def test_meshfilter_wrong_texture_type_failure_keeps_exact_external_pptr_context(self):
        target = SimpleNamespace(type=SimpleNamespace(name='Texture2D'),
                                 read=lambda: SimpleNamespace(m_Name='flow_11'))
        external = SimpleNamespace(path='archive:/CAB-c2c688f710a565b7cce0cc93f7bd219f/CAB-c2c688f710a565b7cce0cc93f7bd219f',
                                   guid='zero-guid', type=0)

        class Pointer:
            m_FileID = 8
            m_PathID = -4487102536378500135
            assetsfile = SimpleNamespace(externals=[SimpleNamespace(path=f'archive:/CAB-other-{i}/CAB-other-{i}', guid='g', type=0)
                                                    for i in range(7)] + [external])
            def deref(self):
                return target

        messages = []
        with self.assertRaisesRegex(RuntimeError, 'PPtr resolves to Texture2D') as caught:
            extract.scenes.read_mesh_data(Pointer(), lambda _obj: self.fail('Texture2D must not enter MeshHandler'),
                'act1autochess_m05', messages.append, True,
                {'ownerUnityType': 'MeshFilter', 'ownerPathId': '1001', 'ownerGameObjectName': 'shore_surface'})
        for evidence in ('MeshFilter.m_Mesh', 'm_FileID', 'externalIndexZeroBased',
                         'CAB-c2c688f710a565b7cce0cc93f7bd219f', 'shore_surface', 'Texture2D', 'ownerPathId'):
            self.assertIn(evidence, str(caught.exception))
        self.assertIn('reference=', messages[0])

    def test_meshfilter_valid_mesh_pointer_still_enters_mesh_handler(self):
        mesh = SimpleNamespace(m_Name='verified_mesh')
        reader = SimpleNamespace(type=SimpleNamespace(name='Mesh'), read=lambda: mesh)

        class Pointer:
            m_FileID = 0
            m_PathID = 17
            assetsfile = SimpleNamespace(externals=[])
            def deref(self):
                return reader

        handler = SimpleNamespace(m_Vertices=[(0, 0, 0)], m_Normals=[], m_UV0=[], m_UV1=[], m_Colors=[],
                                  get_triangles=lambda: [[(0, 0, 0)]], process=lambda: None)
        result = extract.scenes.read_mesh_data(Pointer(), lambda value: handler if value is mesh else None,
            'act1autochess_m05', lambda _msg: None, True)
        self.assertEqual(result[0], [(0, 0, 0)])

    def test_material_disturtex_error_keeps_source_field_pptr_and_cab_row(self):
        target_external = SimpleNamespace(path='archive:/CAB-c2c688f710a565b7cce0cc93f7bd219f/CAB-c2c688f710a565b7cce0cc93f7bd219f',
                                          guid='zero-guid', type=0)
        external_table = [SimpleNamespace(path=f'archive:/CAB-other-{i}/CAB-other-{i}', guid='g', type=0)
                          for i in range(7)] + [target_external]

        class Pointer:
            def __init__(self, file_id, path_id, error=None, data=None):
                self.m_FileID, self.m_PathID, self.error, self.data = file_id, path_id, error, data
                self.assetsfile = SimpleNamespace(externals=external_table)
            def deref(self):
                if self.error:
                    raise FileNotFoundError(self.error)
                return SimpleNamespace(type=SimpleNamespace(name='Shader'), read=lambda: self.data)

        shader = Pointer(0, 41, data=SimpleNamespace(m_Name='Standard', m_ParsedForm=None))
        texture = Pointer(8, -4487102536378500135, error='flow bundle was not loaded')
        null_texture = Pointer(0, 0)
        tex_env = lambda pointer: SimpleNamespace(m_Texture=pointer,
            m_Scale=SimpleNamespace(x=1, y=1), m_Offset=SimpleNamespace(x=0, y=0))
        props = SimpleNamespace(m_TexEnvs=[('_MainTex', tex_env(null_texture)),
            ('_DisturTex', tex_env(texture))],
            m_Floats=[], m_Colors=[])
        material = SimpleNamespace(m_Shader=shader, m_SavedProperties=props, m_ValidKeywords=[], m_Name='MT_Dosshore_UI')
        # A null optional texture slot is valid even in strict scene export.
        material.m_SavedProperties.m_TexEnvs = [('_MainTex', tex_env(null_texture))]
        self.assertEqual(extract.material_info(material, strict=True)['textures'], {})
        material.m_SavedProperties.m_TexEnvs = [('_MainTex', tex_env(null_texture)),
            ('_DisturTex', tex_env(texture))]
        with self.assertRaisesRegex(RuntimeError, r'Material.m_SavedProperties.m_TexEnvs\[_DisturTex\].m_Texture') as caught:
            extract.material_info(material, strict=True, source_context={
                'sourceMaterialName': 'MT_Dosshore_UI', 'ownerPathID': '8801',
                'sourceAssetsFile': 'arts/maps/map_doss_shore/res.ab'})
        error = str(caught.exception)
        self.assertIn('m_FileID', error)
        self.assertIn('externalIndexZeroBased', error)
        self.assertIn('archive:/CAB-c2c688f710a565b7cce0cc93f7bd219f/CAB-c2c688f710a565b7cce0cc93f7bd219f', error)
        self.assertIn('MT_Dosshore_UI', error)
        self.assertIn('8801', error)
        self.assertIn('arts/maps/map_doss_shore/res.ab', error)

    def test_builtin_provider_resolves_real_scene_quad_and_records_lts_patch_versions(self):
        import aklz4
        import UnityPy
        from UnityPy.environment import Environment
        from UnityPy.helpers.MeshHelper import MeshHandler

        self.assertTrue(UNITY_RESOURCES.is_file(), f'native Unity resource file missing: {UNITY_RESOURCES}')
        env = Environment()
        native_file = env.load_file(str(UNITY_RESOURCES), is_dependency=True)
        stage_version = '2021.3.39f1'  # recorded native stage version; source is intentionally a different patch
        self.assertEqual(stage_version, '2021.3.39f1')
        messages = []
        provider = extract.scenes.register_builtin_quad(env, UNITY_RESOURCES, stage_version, MeshHandler, messages.append)
        self.assertEqual(provider['unityVersion'], '2021.3.47f1')
        self.assertEqual(provider['path'], str(UNITY_RESOURCES))
        self.assertIn('stageUnityVersion=2021.3.39f1 builtinSourceUnityVersion=2021.3.47f1', messages[0])
        self.assertIn(f'nativePath={UNITY_RESOURCES} nativePathId=10210 name=Quad', messages[0])

        native_quad = native_file.objects[10210].read()
        quad_pointer = SimpleNamespace(m_FileID=1, m_PathID=10210,
                                       assetsfile=SimpleNamespace(externals=[SimpleNamespace(path='Library/unity default resources')]),
                                       read=lambda: native_quad)
        self.assertEqual(quad_pointer.read().m_Name, 'Quad')
        self.assertTrue(extract.scenes.require_supported_builtin_pointer(quad_pointer, provider, quad_pointer.read()))
        mesh_data = extract.scenes.read_mesh_data(quad_pointer, MeshHandler, 'act1autochess_m01', messages.append, True)
        self.assertEqual(len(mesh_data[0]), 4)
        self.assertEqual(sum(len(submesh) for submesh in mesh_data[-1]), 2)
        self.assertEqual(provider['geometry'], {'name': 'Quad', 'nativePathId': 10210, 'vertices': 4,
                                                'triangles': 2, 'uv': 'unit-square', 'normal': 'unit-Z'})

    def test_builtin_provider_rejects_wrong_lts_unknown_pointer_and_nonquad(self):
        import UnityPy
        from UnityPy.environment import Environment
        from UnityPy.helpers.MeshHelper import MeshHandler

        env = Environment()
        with self.assertRaisesRegex(RuntimeError, 'version mismatch: stage=2020.3.1f1'):
            extract.scenes.register_builtin_quad(env, UNITY_RESOURCES, '2020.3.1f1', MeshHandler, lambda _msg: None)

        native = UnityPy.load(str(UNITY_RESOURCES))
        cube = next(obj.read() for obj in native.objects if obj.type.name == 'Mesh' and obj.path_id == 10202)
        with self.assertRaisesRegex(RuntimeError, 'not the verified 1x1 XY Quad'):
            extract.scenes._quad_geometry(cube, MeshHandler)

        external = SimpleNamespace(path='Library/unity default resources')
        pointer = SimpleNamespace(m_FileID=1, m_PathID=10202, assetsfile=SimpleNamespace(externals=[external]))
        provider = {'unityVersion': '2021.3.47f1', 'path': str(UNITY_RESOURCES),
                    'geometry': {'name': 'Quad', 'nativePathId': 10210}}
        with self.assertRaisesRegex(RuntimeError, 'unsupported unity default resources mesh pointer #10202'):
            extract.scenes.require_supported_builtin_pointer(pointer, provider, cube)

    def test_builtin_provider_pathid_collision_keeps_scene_object_snapshot(self):
        from UnityPy.environment import Environment
        from UnityPy.helpers.MeshHelper import MeshHandler

        scene_object = SimpleNamespace(path_id=10210)
        inner = Environment()

        class CollisionEnvironment:
            @property
            def objects(self):
                provider_objects = [obj for file in inner.files.values()
                                    for obj in getattr(file, 'objects', {}).values()]
                return [scene_object, *provider_objects]

            def load_file(self, *args, **kwargs):
                return inner.load_file(*args, **kwargs)

        env = CollisionEnvironment()
        scene_objects, by_path_id = extract.scenes.snapshot_scene_objects(env)
        self.assertIs(by_path_id[10210], scene_object)
        provider = extract.scenes.register_builtin_quad(env, UNITY_RESOURCES, '2021.3.39f1', MeshHandler, lambda _msg: None)
        self.assertEqual(provider['geometry']['nativePathId'], 10210)
        self.assertIs(by_path_id[10210], scene_object)
        self.assertIn(scene_object, scene_objects)
        colliding = [obj for obj in env.objects if obj.path_id == 10210]
        self.assertEqual(len(colliding), 2)
        self.assertEqual(colliding[1].read().m_Name, 'Quad')

    def test_builtin_quad_geometry_rejects_near_unit_uv_and_degenerate_triangles(self):
        import UnityPy
        from UnityPy.helpers.MeshHelper import MeshHandler

        native = UnityPy.load(str(UNITY_RESOURCES))
        quad = next(obj.read() for obj in native.objects if obj.type.name == 'Mesh' and obj.path_id == 10210)
        original = MeshHandler(quad)
        original.process()

        class GeometryFixture:
            def __init__(self, uv, triangles):
                self.m_Name = 'Quad'
                self.m_Vertices = original.m_Vertices
                self.m_Normals = original.m_Normals
                self.m_UV0 = uv
                self._triangles = triangles

            def process(self):
                pass

            def get_triangles(self):
                return self._triangles

        correct_uv = list(original.m_UV0)
        near_uv = list(correct_uv); near_uv[0] = (.49, 0.0)
        real_triangles = original.get_triangles()
        bad_uv = GeometryFixture(near_uv, real_triangles)
        with self.assertRaisesRegex(RuntimeError, 'not the verified 1x1 XY Quad'):
            extract.scenes._quad_geometry(quad, lambda _mesh: bad_uv)

        degenerate = GeometryFixture(correct_uv, [[(0, 0, 1), real_triangles[0][1]]])
        with self.assertRaisesRegex(RuntimeError, 'not the verified 1x1 XY Quad'):
            extract.scenes._quad_geometry(quad, lambda _mesh: degenerate)

        overlapping = GeometryFixture(correct_uv, [[real_triangles[0][0], real_triangles[0][0]]])
        with self.assertRaisesRegex(RuntimeError, 'not the verified 1x1 XY Quad'):
            extract.scenes._quad_geometry(quad, lambda _mesh: overlapping)

        inconsistent_normals = GeometryFixture(correct_uv, real_triangles)
        inconsistent_normals.m_Normals = [*original.m_Normals[:3], (0.0, 0.0, 1.0)]
        with self.assertRaisesRegex(RuntimeError, 'not the verified 1x1 XY Quad'):
            extract.scenes._quad_geometry(quad, lambda _mesh: inconsistent_normals)

    def test_builtin_provider_requires_absolute_unlinked_regular_file(self):
        with self.assertRaisesRegex(RuntimeError, 'must be an absolute path'):
            extract.scenes._checked_resource_path(Path('relative-unity-resources'))
        linked = self.case / 'reparse-parent' / 'unity default resources'
        real_lstat = os.lstat

        def lstat_with_reparse(path):
            if Path(path) == linked.parent:
                return SimpleNamespace(st_file_attributes=0x400, st_mode=stat.S_IFDIR, st_nlink=1)
            return real_lstat(path)

        with patch.object(extract.scenes.os, 'lstat', side_effect=lstat_with_reparse):
            with self.assertRaisesRegex(RuntimeError, 'refusing linked Unity resource path'):
                extract.scenes._checked_resource_path(linked)

    def test_original_missing_builtin_pointer_still_fails_strict_without_provider(self):
        import aklz4
        import UnityPy
        from UnityPy.helpers.MeshHelper import MeshHandler

        pointer = SimpleNamespace(m_PathID=10210, read=lambda: (_ for _ in ()).throw(OSError('external builtin unavailable')))
        messages = []
        with self.assertRaisesRegex(RuntimeError, 'mesh unresolved #10210'):
            extract.scenes.read_mesh_data(pointer, MeshHandler, 'act1autochess_m01', messages.append, True)
        self.assertIn('mesh PPtr #10210', messages[0])

    def test_strict_material_rejects_unresolved_shader(self):
        class Pointer:
            m_PathID = 45

            def read(self):
                raise OSError('shader dependency missing')

        props = SimpleNamespace(m_TexEnvs=[], m_Floats=[], m_Colors=[])
        material = SimpleNamespace(m_Shader=Pointer(), m_SavedProperties=props, m_ValidKeywords=[])
        with self.assertRaisesRegex(RuntimeError, 'material shader unresolved'):
            extract.material_info(material, strict=True)

        class NullPointer:
            m_FileID = 0
            m_PathID = 0
        null_shader = SimpleNamespace(m_Shader=NullPointer(), m_SavedProperties=props, m_ValidKeywords=[])
        with self.assertRaisesRegex(RuntimeError, 'null shader reference'):
            extract.material_info(null_shader, strict=True)

    def test_existing_texture_and_unrelated_groups_are_reused(self):
        tex = self.out / 'scene/tex/shared.webp'
        tex.parent.mkdir(parents=True)
        tex.write_bytes(b'existing texture')
        old = {'old/group': {'keep': {'path': '/assets/local/old.bin'}},
               'scene/tex': {'shared': {'path': '/assets/local/scene/tex/shared.webp'}}}
        merged = extract.merge_manifest(old, {'scene/s2': {'scene': {'path': '/scene/s2.json'}}}, {'scene/s2'})
        self.assertEqual(merged['old/group'], old['old/group'])
        self.assertEqual(merged['scene/tex'], old['scene/tex'])
        self.assertEqual(tex.read_bytes(), b'existing texture')

    def test_commit_failure_rolls_back_only_new_files_and_keeps_manifest(self):
        self.manifest.write_text('{"version":1,"groups":{"keep":{}}}', encoding='utf-8')
        original_manifest = self.manifest.read_bytes()
        new_file = self.out / 'scene/s1/scene.bin'
        output = scene_output.SceneOutput(self.out)
        output.stage(new_file, b'new')
        doc = {'version': 1, 'groups': {'new': {}}}
        real_replace = scene_output.os.replace

        def fail_manifest(src, dst):
            if Path(dst) == self.manifest:
                raise OSError('simulated manifest replace failure')
            return real_replace(src, dst)

        with patch.object(scene_output.os, 'replace', side_effect=fail_manifest):
            with self.assertRaisesRegex(OSError, 'simulated'):
                output.commit(self.manifest, doc)
        self.assertFalse(new_file.exists())
        self.assertEqual(self.manifest.read_bytes(), original_manifest)


if __name__ == '__main__':
    unittest.main(verbosity=2)
