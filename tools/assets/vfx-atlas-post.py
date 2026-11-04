"""Recorded effect frames -> web assets.

Input  (per effect, from ArkVfxRecorder): <frames>/<prefab>/f_####.png = [premultiplied colour | coverage] side by side, meta.json
Output (per effect, into <out>/<prefab>/):
  atlas-NNN.webp bounded lossless pages, each cell = [colour | coverage] (decode in a shader: out = vec4(P, A), blend ONE, ONE_MINUS_SRC_ALPHA)
  atlas.json   {format:2, frames, fps, pages, cell:[w,h], originPx (anchor inside a cell, pixels), pxPerUnit, prefab}
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


def page_layout(frames, cw, ch, max_pixels, max_side):
    """Fit whole packed frames in a page; never scale or split a frame."""
    width = cw * 2
    if width > max_side or ch > max_side or width * ch > max_pixels:
        raise ValueError(f'Packed frame {width}x{ch} exceeds page limits')
    capacity = min(frames, max_pixels // (width * ch))
    choices = []
    for cols in range(1, min(capacity, max_side // width) + 1):
        rows = min(max_side // ch, capacity // cols)
        count = min(frames, cols * rows)
        rows = math.ceil(count / cols)
        # Prefer more complete frames, then little padding and square pages.
        choices.append((-count, cols * rows, abs(cols * width - rows * ch), cols, rows))
    _, _, _, cols, rows = min(choices)
    return cols, rows, min(frames, cols * rows)


def write_pages(frames, count, dst, cw, ch, max_pixels, max_side):
    dst.mkdir(parents=True, exist_ok=True)
    pages = []
    start = 0
    while start < count:
        cols, rows, size = page_layout(count - start, cw, ch, max_pixels, max_side)
        atlas = Image.new('RGB', (cols * cw * 2, rows * ch))
        for i in range(size):
            frame = next(frames)
            if frame.size != (cw * 2, ch):
                raise ValueError(f'Unexpected packed frame size: {frame.size}')
            atlas.paste(frame, ((i % cols) * cw * 2, (i // cols) * ch))
        file = f'atlas-{len(pages):03d}.webp'
        atlas.save(dst / file, lossless=True, quality=100, method=4)
        pages.append({'file': file, 'start': start, 'frames': size, 'cols': cols, 'size': list(atlas.size)})
        start += size
    return pages


def repack(src: Path, dst: Path, max_pixels=4_194_304, max_side=4096):
    """Page an existing lossless atlas, preserving every frame byte and anchor."""
    info = json.loads((src / 'atlas.json').read_text('utf-8'))
    if info.get('unportedShaders'):
        raise ValueError(f'Unsupported source shaders: {src}')
    if info.get('pages'):
        raise ValueError(f'Source is already paged: {src}')
    cw, ch = map(int, info['cell'])
    count, cols = int(info['frames']), int(info['cols'])
    with Image.open(src / 'atlas.webp') as image:
        if image.size != (cols * cw * 2, math.ceil(count / cols) * ch):
            raise ValueError(f'Unexpected source atlas size: {src}')
        image = image.convert('RGB')
        frames = (image.crop(((i % cols) * cw * 2, (i // cols) * ch,
                              (i % cols + 1) * cw * 2, (i // cols + 1) * ch)) for i in range(count))
        pages = write_pages(frames, count, dst, cw, ch, max_pixels, max_side)
    info.pop('cols', None)
    info.update(format=2, pages=pages)
    (dst / 'atlas.json').write_text(json.dumps(info, ensure_ascii=False, indent=1), 'utf-8')
    return info


def process(src: Path, dst: Path, max_pixels=4_194_304, max_side=4096) -> dict:
    meta = json.loads((src / 'meta.json').read_text('utf-8'))
    files = sorted(src.glob('f_*.png'))
    expected = int(meta['frames'])
    if {file.name for file in files} != {f'f_{i:04d}.png' for i in range(expected)}:
        raise ValueError(f'Incomplete source frame set: {src}')
    if meta.get('unportedShaders'):
        raise ValueError(f'Unsupported source shaders: {src}: {meta["unportedShaders"]}')
    with Image.open(files[0]) as image:
        w, h = image.width // 2, image.height
    # union box of anything visible over the clip
    mask = np.zeros((h, w), bool)
    last = 0
    for i, file in enumerate(files):
        p, a = load(file)
        if a.shape != (h, w):
            raise ValueError(f'Inconsistent source frame size: {file}')
        mask |= (a > THRESH) | (p.max(axis=2) > THRESH)
        if (a > THRESH).any() or (p.max(axis=2) > THRESH).any():
            last = i + 1
    if not mask.any():
        return {'prefab': meta['prefab'], 'empty': True, 'captureState': 'no-visible-pixels', 'sourceFrames': expected}
    ys, xs = np.where(mask)
    pad = 4
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
    cw, ch = x1 - x0, y1 - y0
    n = last
    previews = []
    def frames():
        for file in files[:n]:
            with Image.open(file) as image:
                image = image.convert('RGB')
                colour = image.crop((x0, y0, x1, y1))
                coverage = image.crop((w + x0, y0, w + x1, y1))
                packed = Image.new('RGB', (cw * 2, ch))
                packed.paste(colour, (0, 0))
                packed.paste(coverage, (cw, 0))
                pc = np.asarray(colour, np.float32) / 255
                ac = np.asarray(coverage, np.float32)[..., :1] / 255
                comp = np.clip(pc + (1 - ac) * GROUND, 0, 1)
                previews.append(Image.fromarray((comp * 255 + 0.5).astype(np.uint8)))
                yield packed
    pages = write_pages(frames(), n, dst, cw, ch, max_pixels, max_side)
    fps = float(meta.get('fps', 30))
    previews[0].save(dst / 'preview.webp', save_all=True, append_images=previews[1:], duration=int(round(1000 / fps)), loop=0, lossless=False, quality=88, method=4)
    ox, oy = meta['originPx']
    info = {'format': 2, 'prefab': meta['prefab'], 'frames': n, 'fps': fps, 'pages': pages, 'cell': [int(cw), int(ch)],
            'originPx': [round(ox - x0, 2), round(oy - y0, 2)], 'pxPerUnit': meta['pxPerUnit'], 'pitch': meta.get('pitch'),
            'unportedShaders': meta.get('unportedShaders', [])}
    (dst / 'atlas.json').write_text(json.dumps(info, ensure_ascii=False, indent=1, default=int), 'utf-8')
    return info


def _one(args):
    source, out, name, repacking, max_pixels, max_side = args
    return (repack if repacking else process)(source, out / name, max_pixels, max_side)


def main():
    from multiprocessing import Pool
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('out', type=Path)
    parser.add_argument('prefabs', nargs='*')
    parser.add_argument('--source-manifest', type=Path)
    parser.add_argument('--atlas-source', action='store_true', help='Repack existing lossless atlases without recording again')
    parser.add_argument('--max-page-pixels', type=int, default=4_194_304)
    parser.add_argument('--max-page-side', type=int, default=4096)
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if args.workers < 1:
        parser.error('--workers must be positive')
    if args.max_page_pixels < 1 or args.max_page_side < 1:
        parser.error('page limits must be positive')
    root, out = args.root, args.out
    if out.exists() and any(out.iterdir()):
        parser.error(f'Output must be new or empty: {out.resolve()}')
    if args.source_manifest:
        source = json.loads(args.source_manifest.read_text(encoding='utf-8-sig'))
        sources = {entry['prefab']: Path(entry['source']) for entry in source['sources']}
    else:
        meta_name = 'atlas.json' if args.atlas_source else 'meta.json'
        sources = {d.name: d for d in root.iterdir() if (d / meta_name).exists()}
        if args.atlas_source and (root / 'index.json').exists():
            registered = json.loads((root / 'index.json').read_text('utf-8-sig'))
            sources = {entry['prefab']: root / entry['prefab'] for entry in registered if not entry.get('empty')}
    names = args.prefabs or sorted(sources)
    out.mkdir(parents=True, exist_ok=True)
    with Pool(args.workers) as pool:
        index = pool.map(_one, [(sources[n], out, n, args.atlas_source, args.max_page_pixels, args.max_page_side) for n in names])
    for info in index:
        print(json.dumps(info, ensure_ascii=False, default=int))
    if args.atlas_source and (root / 'index.json').exists():
        original = json.loads((root / 'index.json').read_text('utf-8-sig'))
        by_name = {entry['prefab']: entry for entry in original}
        index = [{**by_name.get(info['prefab'], {}), **info} for info in index]
        for info in index:
            if info.get('pages'):
                info.pop('cols', None)
        if not args.prefabs:
            index.extend(entry for entry in original if entry.get('empty'))
        index.sort(key=lambda entry: entry['prefab'])
    (out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1, default=int), 'utf-8')


if __name__ == '__main__':
    main()
