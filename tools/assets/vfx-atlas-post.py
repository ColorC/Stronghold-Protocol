"""Recorded effect frames -> web assets.

Input  (per effect, from ArkVfxRecorder): <frames>/<prefab>/f_####.png = [premultiplied colour | coverage] side by side, meta.json
Output (per effect, into <out>/<prefab>/):
  atlas.webp   lossless grid of cropped cells, each cell = [colour | coverage] (decode in a shader: out = vec4(P, A), blend ONE, ONE_MINUS_SRC_ALPHA)
  atlas.json   {frames, fps, cols, cell:[w,h], originPx (anchor inside a cell, pixels), pxPerUnit, prefab}
  preview.webp animated preview composited over a battlefield-like ground (for the canvas)
and <out>/index.json listing every effect.

The half-float black/white captures encode P + (1-A)*background. Additive
emission may have P > A, including nonzero P at A=0. Clamping colour to coverage
or inventing coverage from brightness changes the authored effect. Retain the
pair unchanged; source-reference captures provide a direct composition check.

    python post.py <frames root> <out root> [prefab ...]
"""
import json
import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

GROUND = np.array([0x3a, 0x40, 0x46], np.float32) / 255  # neutral grey-blue, roughly a battle tile
THRESH = 2 / 255


def load(path: Path):
    im = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255
    w = im.shape[1] // 2
    colour, coverage = im[:, :w], im[:, w:, 0]
    return colour, coverage


def process(src: Path, dst: Path) -> dict:
    meta = json.loads((src / 'meta.json').read_text('utf-8'))
    files = sorted(src.glob('f_*.png'))
    expected = int(meta['frames'])
    if {file.name for file in files} != {f'f_{i:04d}.png' for i in range(expected)}:
        raise ValueError(f'Incomplete source frame set: {src}')
    if meta.get('unportedShaders'):
        raise ValueError(f'Unsupported source shaders: {src}: {meta["unportedShaders"]}')
    frames = [load(f) for f in files]
    h, w = frames[0][1].shape
    # union box of anything visible over the clip
    mask = np.zeros((h, w), bool)
    for p, a in frames:
        mask |= (a > THRESH) | (p.max(axis=2) > THRESH)
    if not mask.any():
        return {'prefab': meta['prefab'], 'empty': True}
    ys, xs = np.where(mask)
    pad = 4
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
    cw, ch = x1 - x0, y1 - y0
    # drop trailing empty frames (effect finished early)
    last = len(frames)
    while last > 1:
        p, a = frames[last - 1]
        if (a[y0:y1, x0:x1] > THRESH).any() or (p[y0:y1, x0:x1].max() > THRESH):
            break
        last -= 1
    frames = frames[:last]
    n = len(frames)
    cols = max(1, min(n, int(math.ceil(math.sqrt(n * ch / (2 * cw))))))
    rows = int(math.ceil(n / cols))
    atlas = np.zeros((rows * ch, cols * cw * 2, 3), np.float32)
    previews = []
    for i, (p, a) in enumerate(frames):
        pc, ac = p[y0:y1, x0:x1], a[y0:y1, x0:x1]
        r, c = divmod(i, cols)
        atlas[r * ch:(r + 1) * ch, c * cw * 2:c * cw * 2 + cw] = pc
        atlas[r * ch:(r + 1) * ch, c * cw * 2 + cw:(c + 1) * cw * 2] = ac[..., None]
        comp = np.clip(pc + (1 - ac[..., None]) * GROUND, 0, 1)
        previews.append(Image.fromarray((comp * 255 + 0.5).astype(np.uint8)))
    dst.mkdir(parents=True, exist_ok=True)
    Image.fromarray((atlas * 255 + 0.5).astype(np.uint8)).save(dst / 'atlas.webp', lossless=True, quality=100, method=6)
    fps = float(meta.get('fps', 30))
    previews[0].save(dst / 'preview.webp', save_all=True, append_images=previews[1:], duration=int(round(1000 / fps)), loop=0, lossless=False, quality=88, method=4)
    ox, oy = meta['originPx']
    info = {'prefab': meta['prefab'], 'frames': n, 'fps': fps, 'cols': cols, 'cell': [int(cw), int(ch)],
            'originPx': [round(ox - x0, 2), round(oy - y0, 2)], 'pxPerUnit': meta['pxPerUnit'], 'pitch': meta.get('pitch'),
            'unportedShaders': meta.get('unportedShaders', [])}
    (dst / 'atlas.json').write_text(json.dumps(info, ensure_ascii=False, indent=1, default=int), 'utf-8')
    return info


def _one(args):
    source, out, name = args
    return process(source, out / name)


def main():
    from multiprocessing import Pool
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('out', type=Path)
    parser.add_argument('prefabs', nargs='*')
    parser.add_argument('--source-manifest', type=Path)
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if args.workers < 1:
        parser.error('--workers must be positive')
    root, out = args.root, args.out
    if args.source_manifest:
        source = json.loads(args.source_manifest.read_text(encoding='utf-8-sig'))
        sources = {entry['prefab']: Path(entry['source']) for entry in source['sources']}
    else:
        sources = {d.name: d for d in root.iterdir() if (d / 'meta.json').exists()}
    names = args.prefabs or sorted(sources)
    out.mkdir(parents=True, exist_ok=True)
    with Pool(args.workers) as pool:
        index = pool.map(_one, [(sources[n], out, n) for n in names])
    for info in index:
        print(json.dumps(info, ensure_ascii=False, default=int))
    (out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1, default=int), 'utf-8')


if __name__ == '__main__':
    main()

