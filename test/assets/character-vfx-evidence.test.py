import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('vfx_evidence', ROOT / 'tools/assets/character-vfx-evidence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceTraceTests(unittest.TestCase):
    def bundle(self, directory, label, rows):
        path = Path(directory) / (label + '.json')
        path.write_text(json.dumps(rows), encoding='utf-8')
        return module.Bundle(label, path)

    def test_nested_actions_and_buffs_preserve_all_effect_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = self.bundle(directory, 'skills', [
                {'type': 'GameObject', 'path_id': 1, 'name': 'skill', 'data': {'components': [{'m_FileID': 0, 'm_PathID': 2}]}},
                {'type': 'MonoBehaviour', 'path_id': 2, 'data': {
                    '_actions': [{'_castEffects': ['start-a']}, {'_castEffects': ['start-b']}],
                    '_buffs': [{'overrideEffectKey': 'aura'}],
                }},
            ])
            report = module.build([bundle], [('skills', 'skill')], {'start-a', 'start-b', 'aura'})
            self.assertEqual({x['prefab'] for x in report['effects']}, {'start-a', 'start-b', 'aura'})
            self.assertIn('/_actions/1/_castEffects', {x['field'] for x in report['effects']})
            self.assertEqual(report['summary']['missingEffects'], [])

    def test_cycles_keep_exact_large_reference_ids_and_report_missing_nodes(self):
        large = 9007199254740993
        with tempfile.TemporaryDirectory() as directory:
            bundle = self.bundle(directory, 'character', [
                {'type': 'GameObject', 'path_id': 1, 'name': 'operator', 'data': {'component': {'m_FileID': 0, 'm_PathID': large}}},
                {'type': 'MonoBehaviour', 'path_id': large, 'data': {
                    'm_GameObject': {'m_FileID': 0, 'm_PathID': 1},
                    '_ability': {'m_FileID': 0, 'm_PathID': large + 1}, '_startEffect': 'birth',
                }},
            ])
            trace = bundle.trace('operator')
            self.assertEqual(trace['components'][0]['pathId'], str(large))
            self.assertEqual(trace['missingLocalReferences'], [str(large + 1)])
            self.assertEqual(len(trace['components']), 1)

    def test_projectile_join_keeps_target_effect_and_reports_unavailable_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            skills = self.bundle(directory, 'skills', [
                {'type': 'GameObject', 'path_id': 1, 'name': 'skill', 'data': {'component': {'m_FileID': 0, 'm_PathID': 2}}},
                {'type': 'MonoBehaviour', 'path_id': 2, 'data': {'_projectileKey': 'projectile_test'}},
            ])
            projectiles = self.bundle(directory, 'projectiles', [
                {'type': 'GameObject', 'path_id': 3, 'name': 'projectile_test', 'data': {'component': {'m_FileID': 0, 'm_PathID': 4}}},
                {'type': 'MonoBehaviour', 'path_id': 4, 'data': {'_effectsToTargetWhenStart': ['target-start'], '_effectsWhenHit': ['hit']}},
            ])
            report = module.build([skills, projectiles], [('skills', 'skill')], {'target-start'})
            self.assertEqual(report['summary']['rootCount'], 2)
            self.assertEqual(report['summary']['missingEffects'], ['hit'])
            self.assertFalse(report['visualParityVerified'])

    def test_missing_root_remains_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = self.bundle(directory, 'skills', [])
            report = module.build([bundle], [('skills', 'absent')], set())
            self.assertEqual(report['summary']['missingRoots'], [{'bundle': 'skills', 'prefab': 'absent'}])


if __name__ == '__main__':
    unittest.main()
