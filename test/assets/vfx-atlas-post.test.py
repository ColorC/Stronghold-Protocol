import importlib.util
import json
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('vfx_atlas', ROOT / 'tools/assets/vfx-atlas-post.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CompositionTests(unittest.TestCase):
    def test_repack_cli_preserves_empty_entries_and_excludes_unregistered_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'source', Path(directory) / 'output'
            meta = {'prefab': 'registered', 'frames': 1, 'fps': 30, 'cols': 1, 'cell': [1, 1], 'originPx': [0, 0]}
            for name in ['registered', 'unregistered']:
                folder = source / name
                folder.mkdir(parents=True)
                (folder / 'atlas.json').write_text(json.dumps({**meta, 'prefab': name}), encoding='utf-8')
                Image.new('RGB', (2, 1), (100, 0, 0)).save(folder / 'atlas.webp', lossless=True)
            (source / 'index.json').write_text(json.dumps([meta, {'prefab': 'moving-trail', 'empty': True}]), encoding='utf-8')
            result = subprocess.run([sys.executable, str(ROOT / 'tools/assets/vfx-atlas-post.py'), str(source), str(output),
                                     '--atlas-source', '--workers', '1'], capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
            index = json.loads((output / 'index.json').read_text('utf-8'))
            self.assertEqual({x['prefab'] for x in index}, {'registered', 'moving-trail'})
            self.assertFalse((output / 'unregistered').exists())
            self.assertTrue(next(x for x in index if x['prefab'] == 'moving-trail')['empty'])

    def test_repack_preserves_all_frame_pixels_and_metadata_across_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            src, out = Path(directory) / 'source', Path(directory) / 'paged'
            src.mkdir()
            meta = {'prefab': 'additive', 'frames': 7, 'fps': 30, 'cols': 3, 'cell': [2, 2],
                    'originPx': [0, -3.5], 'pxPerUnit': 96, 'pitch': -30}
            (src / 'atlas.json').write_text(json.dumps(meta), encoding='utf-8')
            atlas = Image.new('RGB', (12, 6))
            originals = []
            for i in range(7):
                pixels = np.zeros((2, 4, 3), dtype=np.uint8)
                pixels[:, :2] = [100 + i, 20, 50]
                pixels[:, 2:] = [i, i, i]  # emission deliberately exceeds coverage
                frame = Image.fromarray(pixels)
                originals.append(pixels)
                atlas.paste(frame, ((i % 3) * 4, (i // 3) * 2))
            atlas.save(src / 'atlas.webp', lossless=True)
            result = module.repack(src, out, max_pixels=16, max_side=8)
            self.assertEqual(result['originPx'], meta['originPx'])
            self.assertEqual(result['frames'], 7)
            self.assertEqual(result['fps'], 30)
            self.assertGreater(len(result['pages']), 1)
            for page in result['pages']:
                image = Image.open(out / page['file']).convert('RGB')
                self.assertLessEqual(image.width * image.height, 16)
                self.assertLessEqual(max(image.size), 8)
                for j in range(page['frames']):
                    x, y = (j % page['cols']) * 4, (j // page['cols']) * 2
                    np.testing.assert_array_equal(np.asarray(image.crop((x, y, x + 4, y + 2))), originals[page['start'] + j])

    def test_frame_too_large_is_rejected_instead_of_resized(self):
        with self.assertRaisesRegex(ValueError, 'exceeds page'):
            module.page_layout(2, 100, 100, max_pixels=1000, max_side=512)

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
