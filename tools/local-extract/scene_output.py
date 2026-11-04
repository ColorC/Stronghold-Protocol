"""Transactional, bounded output for official scene extraction."""
import io
import json
import os
import tempfile
from pathlib import Path


class SceneOutputError(RuntimeError):
    pass


def read_manifest(path):
    """Validate the existing manifest before any extraction writes begin."""
    path = Path(path)
    SceneOutput._reject_linked_ancestors(path)
    if not path.exists():
        return {'version': 1, 'source': 'local-client', 'count': 0, 'groups': {}}
    if path.is_file() and os.stat(path).st_nlink > 1:
        raise SceneOutputError(f'refusing hard-linked manifest: {path}')
    doc = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(doc, dict) or not isinstance(doc.get('groups'), dict):
        raise SceneOutputError(f'invalid manifest structure: {path}')
    for group, entries in doc['groups'].items():
        if not isinstance(group, str) or not isinstance(entries, dict):
            raise SceneOutputError(f'invalid manifest group: {group!r}')
    return doc


class SceneOutput:
    def __init__(self, root, max_bytes=None, webp_only=False, strict=False):
        self.root = Path(root)
        self.max_bytes = max_bytes
        self.webp_only = webp_only
        self.strict = strict
        self.pending = {}
        self.created = []

    def checkpoint(self):
        return set(self.pending)

    def rollback_to(self, checkpoint):
        self.pending = {p: b for p, b in self.pending.items() if p in checkpoint}

    def stage(self, path, data):
        path = Path(path)
        try:
            path.resolve().relative_to(self.root.resolve())
        except ValueError as exc:
            raise SceneOutputError(f'output escapes root: {path}') from exc
        self.pending[path] = bytes(data)

    @staticmethod
    def _reject_linked_ancestors(path):
        path = Path(os.path.abspath(path))
        for candidate in reversed((path, *path.parents)):
            try:
                info = os.lstat(candidate)
            except FileNotFoundError:
                continue
            attrs = getattr(info, 'st_file_attributes', 0)
            reparse_flag = getattr(info, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)
            if candidate.is_symlink() or attrs & reparse_flag:
                raise SceneOutputError(f'refusing linked or reparse output path: {candidate}')

    def image(self, img, out_dir, stem, sub):
        """Encode fully in memory; WebP-only mode falls back to a single PNG."""
        out_dir = Path(out_dir)
        if self.webp_only:
            buf = io.BytesIO()
            try:
                img.save(buf, 'WEBP', quality=95, method=6, alpha_quality=100, exact=True)
                self.stage(out_dir / f'{stem}.webp', buf.getvalue())
                return {'path': f'/assets/local/{sub}/{stem}.webp', 'w': img.width, 'h': img.height, 'webp': 'lossy'}
            except Exception:
                png = io.BytesIO()
                img.save(png, 'PNG')
                self.stage(out_dir / f'{stem}.png', png.getvalue())
                return {'path': f'/assets/local/{sub}/{stem}.png', 'w': img.width, 'h': img.height}

        png = io.BytesIO()
        img.save(png, 'PNG')
        png_bytes = png.getvalue()
        self.stage(out_dir / f'{stem}.png', png_bytes)
        webp = io.BytesIO()
        try:
            img.save(webp, 'WEBP', quality=95, method=6, alpha_quality=100, exact=True)
        except Exception:
            return {'path': f'/assets/local/{sub}/{stem}.png', 'w': img.width, 'h': img.height}
        self.stage(out_dir / f'{stem}.webp', webp.getvalue())
        return {'path': f'/assets/local/{sub}/{stem}.webp', 'w': img.width, 'h': img.height, 'webp': 'lossy'}

    def preview(self, manifest_path, doc):
        """Validate a complete staged transaction and report exact bytes without writing anything."""
        manifest_path = Path(manifest_path)
        pending = dict(self.pending)
        pending[manifest_path] = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        planned, total, new_bytes = [], 0, 0
        for path, data in pending.items():
            self._reject_linked_ancestors(path)
            try:
                path.resolve().relative_to(self.root.resolve())
            except ValueError as exc:
                if path != manifest_path:
                    raise SceneOutputError(f'output escapes root: {path}') from exc
            if path.exists():
                if not path.is_file():
                    raise SceneOutputError(f'refusing non-file output: {path}')
                if os.stat(path).st_nlink > 1:
                    raise SceneOutputError(f'refusing hard-linked output: {path}')
                old = path.read_bytes()
                if old == data:
                    action = 'reuse'
                elif path == manifest_path:
                    action = 'replace-manifest'
                    new_bytes += len(data)
                else:
                    raise SceneOutputError(f'refusing to overwrite different existing output: {path}')
            else:
                action = 'create'
                new_bytes += len(data)
            size = len(data)
            total += size
            planned.append({'path': str(path.resolve(strict=False)), 'bytes': size, 'action': action})
        if self.max_bytes is not None and new_bytes > self.max_bytes:
            raise SceneOutputError(f'scene output budget exceeded: {new_bytes} > {self.max_bytes} bytes')
        return {'plannedFiles': sorted(planned, key=lambda row: row['path']), 'plannedTotalBytes': total,
                'plannedNewBytes': new_bytes, 'maxBytes': self.max_bytes}

    def commit(self, manifest_path, doc):
        """Preflight conflicts/budget, then atomically publish files and manifest."""
        manifest_path = Path(manifest_path)
        pending = dict(self.pending)
        pending[manifest_path] = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        new_bytes = 0
        for path, data in pending.items():
            self._reject_linked_ancestors(path)
            try:
                path.relative_to(self.root)
                rel_parts = path.relative_to(self.root).parts
            except ValueError:
                rel_parts = ()
            if path.exists():
                if not path.is_file():
                    raise SceneOutputError(f'refusing non-file output: {path}')
                if os.stat(path).st_nlink > 1:
                    raise SceneOutputError(f'refusing hard-linked output: {path}')
                if path.read_bytes() != data:
                    if path == manifest_path:
                        new_bytes += len(data)  # atomic replacement temporarily holds the complete new manifest
                        continue
                    else:
                        raise SceneOutputError(f'refusing to overwrite different existing output: {path}')
            else:
                new_bytes += len(data)
        if self.max_bytes is not None and new_bytes > self.max_bytes:
            raise SceneOutputError(f'scene output budget exceeded: {new_bytes} > {self.max_bytes} bytes')
        try:
            for path, data in pending.items():
                is_manifest = path == manifest_path
                if path.exists() and path.read_bytes() == data:
                    continue
                path.parent.mkdir(parents=True, exist_ok=True)
                self._reject_linked_ancestors(path)
                fd, temp_name = tempfile.mkstemp(prefix='.scene-export-', dir=path.parent)
                try:
                    with os.fdopen(fd, 'wb') as f:
                        f.write(data)
                        f.flush()
                        os.fsync(f.fileno())
                    os.replace(temp_name, path)
                    if not is_manifest:
                        self.created.append(path)
                finally:
                    if os.path.exists(temp_name):
                        os.unlink(temp_name)
        except Exception:
            for path in reversed(self.created):
                if path.is_file() and not path.is_symlink():
                    path.unlink()
            self.created.clear()
            raise

