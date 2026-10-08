import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('vfx_atlas', ROOT / 'tools/assets/vfx-atlas-post.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CompositionTests(unittest.TestCase):
    def test_additive_emission_at_zero_coverage_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'f_0000.png'
            Image.fromarray(np.array([[[153, 102, 51], [0, 0, 0]]], dtype=np.uint8)).save(file)
            colour, coverage = module.load(file)
            np.testing.assert_allclose(colour[0, 0], [0.6, 0.4, 0.2], atol=1e-6)
            self.assertEqual(float(coverage[0, 0]), 0)
            np.testing.assert_allclose(colour[0, 0] + (1 - coverage[0, 0]) * module.GROUND,
                                       np.array([0.6, 0.4, 0.2]) + module.GROUND, atol=1e-6)

    def test_missing_declared_frame_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            src = Path(directory) / 'source'
            src.mkdir()
            (src / 'meta.json').write_text(json.dumps({'frames': 2}), encoding='utf-8')
            Image.new('RGB', (2, 1)).save(src / 'f_0000.png')
            with self.assertRaisesRegex(ValueError, 'Incomplete source'):
                module.process(src, Path(directory) / 'out')

    def test_unsupported_shader_cannot_be_published_as_valid_atlas(self):
        with tempfile.TemporaryDirectory() as directory:
            src = Path(directory) / 'source'
            src.mkdir()
            (src / 'meta.json').write_text(json.dumps({'frames': 1, 'unportedShaders': ['unknown']}), encoding='utf-8')
            Image.new('RGB', (2, 1)).save(src / 'f_0000.png')
            with self.assertRaisesRegex(ValueError, 'Unsupported source'):
                module.process(src, Path(directory) / 'out')


if __name__ == '__main__':
    unittest.main()
