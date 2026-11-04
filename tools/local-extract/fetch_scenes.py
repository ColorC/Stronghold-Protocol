#!/usr/bin/env python3
"""Fetch official scene bundles into a version-isolated local staging directory."""
import argparse
import ctypes
import io
import json
import os
import re
import stat
import sys
import tempfile
import urllib.request
from urllib.parse import quote, urlsplit, urlunsplit
import zipfile
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scenes  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
VERSION = '26-04-13-12-31-42_e9b560'
PLATFORM = 'Android'
CDN = 'https://ak.hycdn.cn/assetbundle/official/{platform}/assets/{version}/'
RECEIPT = '.native-scene-receipt.json'
MANIFEST_LIMIT = 32 * 1024 * 1024
DEFAULT_INPUT_LIMIT = 256 * 1024 * 1024


def valid_version(value):
    return bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}', value)) and '..' not in value


def safe_bundle(name):
    if not isinstance(name, str) or not name or '\\' in name or ':' in name or name.startswith('/') or any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
        return False
    p = PurePosixPath(name)
    return not p.is_absolute() and all(part not in ('', '.', '..') for part in name.split('/')) and p.suffix == '.ab'


def dat_name(bundle):
    return bundle.rsplit('.', 1)[0].replace('/', '_').replace('#', '__') + '.dat'


def wanted(names, stage_ids):
    """Keep the original scene-prefix selector used by upstream callers."""
    dirs = tuple(scenes.scene_bundle(sid).rsplit('/', 1)[0] + '/' for sid in stage_ids)
    return [name for name in names if name.startswith(dirs)]


def get(url, limit):
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in url):
        raise ValueError('native download URL contains a control character')
    parts = urlsplit(url)
    encoded = urlunsplit(parts._replace(path=quote(parts.path, safe='/%')))
    req = urllib.request.Request(encoded, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        chunks, size = [], 0
        while True:
            chunk = response.read(min(1024 * 1024, limit + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise ValueError(f'response exceeds in-memory limit ({limit} bytes)')
            chunks.append(chunk)
        return b''.join(chunks)


def required_names(infos, stage_ids, include_dependencies, exact_bundles=()):
    names = [x['name'] for x in infos if isinstance(x, dict) and isinstance(x.get('name'), str)]
    selected = []
    for stage_id in stage_ids:
        scene_dir = scenes.scene_bundle(stage_id).rsplit('/', 1)[0] + '/'
        found = [n for n in names if n.startswith(scene_dir)]
        if len(found) != 3:
            raise ValueError(f'{stage_id}: expected 3 scene bundles, found {len(found)}')
        selected.extend(found)
        if include_dependencies:
            declared = next((deps for sid, deps in scenes.SCENES if sid == stage_id), None)
            selected.extend(declared or [])
    for name in exact_bundles:
        if not safe_bundle(name):
            raise ValueError(f'unsafe explicit bundle path: {name!r}')
        selected.append(name)
    if include_dependencies:
        selected.extend(scenes.COMMON_DEPS)
    return list(dict.fromkeys(selected))


def unpack_bundle(dat, bundle, byte_limit):
    with zipfile.ZipFile(io.BytesIO(dat)) as archive:
        members = [x for x in archive.infolist() if not x.is_dir()]
        if len(members) != 1:
            raise ValueError(f'{bundle}: expected one zip member, found {len(members)}')
        member = members[0].filename
        if not safe_bundle(member) or member != bundle:
            raise ValueError(f'{bundle}: archive member mismatch ({member!r})')
        if members[0].file_size > byte_limit:
            raise ValueError(f'{bundle}: uncompressed payload exceeds remaining byte limit')
        with archive.open(members[0]) as source:
            blob = source.read(byte_limit + 1)
        if len(blob) > byte_limit:
            raise ValueError(f'{bundle}: uncompressed payload exceeds remaining byte limit')
    if not blob.startswith(b'UnityFS'):
        raise ValueError(f'{bundle}: invalid UnityFS header')
    return blob


def read_memory_bundle_source(root, scene_bundle, allow_retired=False):
    """Bind an in-memory dependency request to the receipt for its already staged native scene."""
    root = Path(root)
    receipt_path = root / RECEIPT
    ok, reason = _plain_ancestors(receipt_path)
    if not ok:
        raise ValueError(f'native scene receipt path is unsafe: {reason}')
    try:
        info = os.lstat(receipt_path)
    except OSError as exc:
        raise ValueError(f'native scene receipt unavailable: {receipt_path}: {exc}') from exc
    if _is_reparse(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError(f'native scene receipt must be a plain single-link file: {receipt_path}')
    try:
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    except Exception as exc:
        raise ValueError(f'invalid native scene receipt: {exc}') from exc
    if not isinstance(receipt, dict):
        raise ValueError('native scene receipt must be an object')
    version, platform, registered = receipt.get('nativeVersionId'), receipt.get('platform'), receipt.get('bundles')
    receipt_manifest_version = receipt.get('manifestVersion')
    if (not valid_version(version) or not isinstance(platform, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', platform)
            or not isinstance(receipt_manifest_version, str) or not receipt_manifest_version):
        raise ValueError('native scene receipt has invalid version/platform')
    if not isinstance(registered, list) or (scene_bundle not in registered and not allow_retired):
        raise ValueError(f'native stage bundle is not registered in receipt: {scene_bundle}')
    return version, platform, receipt_manifest_version


def fetch_memory_bundles(version, platform, names, max_bytes, expected_manifest_version=None, stage_ids=()):
    """Fetch exact listed DAT members into bounded memory without writing cache files."""
    if not names or max_bytes < 0:
        raise ValueError('memory bundle names and a non-negative byte cap are required')
    names = list(dict.fromkeys(names))
    if any(not safe_bundle(name) for name in names):
        raise ValueError('unsafe explicit memory bundle name')
    base = CDN.format(platform=platform, version=version)
    manifest = json.loads(get(base + 'hot_update_list.json', MANIFEST_LIMIT))
    if not isinstance(manifest, dict):
        raise ValueError('official native manifest must be an object')
    infos = manifest.get('abInfos')
    if manifest.get('versionId') != version or not manifest.get('manifestVersion') or not isinstance(infos, list):
        raise ValueError('official native manifest identity/fields mismatch')
    if expected_manifest_version is not None and manifest['manifestVersion'] != expected_manifest_version:
        raise ValueError('official manifestVersion differs from native scene receipt')
    scene_names = []
    for stage_id in stage_ids:
        if stage_id not in ('act1autochess_m05', 'act2autochess_m04'):
            raise ValueError(f'{stage_id}: memory scene source is not enabled for this preview scope')
        stage_names = required_names(infos, [stage_id], False)
        if len(stage_names) != 3:
            raise ValueError(f'{stage_id}: expected exactly three source AB names, got {stage_names!r}')
        scene_names.extend(stage_names)
    names = list(dict.fromkeys([*scene_names, *names]))
    required_names(infos, [], False, names)
    listed = {item['name'] for item in infos if isinstance(item, dict) and isinstance(item.get('name'), str)}
    missing = [name for name in names if name not in listed]
    if missing:
        raise ValueError('official native manifest omits memory bundles: ' + ', '.join(missing))
    payloads, total = {}, 0
    for name in names:
        remaining = max_bytes - total
        if remaining < 0:
            raise ValueError(f'memory bundle limit exceeded: {total}>{max_bytes}')
        dat = get(base + dat_name(name), min(DEFAULT_INPUT_LIMIT, remaining + 32 * 1024 * 1024))
        blob = unpack_bundle(dat, name, remaining)
        total += len(blob)
        if total > max_bytes:
            raise ValueError(f'memory bundle limit exceeded: {total}>{max_bytes}')
        payloads[name] = blob
        del dat
    return {'nativeVersionId': version, 'platform': platform, 'manifestVersion': manifest['manifestVersion'],
            'totalBytes': total, 'sceneBundles': scene_names, 'bundles': payloads}


def _is_reparse(st):
    return stat.S_ISLNK(st.st_mode) or bool(getattr(st, 'st_file_attributes', 0) & 0x400)


def _plain_ancestors(path):
    path = Path(os.path.abspath(os.fspath(path)))
    chain = list(reversed(path.parents)) + [path]
    for item in chain:
        try:
            info = os.lstat(item)
        except OSError as exc:
            return False, f'cannot lstat ancestor {item}: {exc}'
        if _is_reparse(info):
            return False, f'reparse or symlink ancestor refused: {item}'
    return True, None


def _within(root, target):
    try:
        root_abs = os.path.normcase(os.path.abspath(os.fspath(root)))
        target_abs = os.path.normcase(os.path.abspath(os.fspath(target)))
        return os.path.commonpath([root_abs, target_abs]) == root_abs
    except (ValueError, OSError):
        return False


def _candidate_path(root, name):
    try:
        return Path(os.path.abspath(os.path.join(os.fspath(root), str(name))))
    except (TypeError, ValueError, OSError):
        return Path(root)


def exclusive_lock_probe(path):
    """On Windows, open the file with share=0 so active consumers cause a refusal."""
    if os.name != 'nt':
        return False
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    create = kernel32.CreateFileW
    create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                       wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create.restype = wintypes.HANDLE
    handle = create(str(path), 0x80000000, 0, None, 3, 0x80, None)
    invalid = ctypes.c_void_p(-1).value
    if handle == invalid:
        return False
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle(handle)
    return True


def _atomic_receipt(path, document):
    fd, temp_name = tempfile.mkstemp(prefix='.native-scene-receipt-', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(document, stream, ensure_ascii=False, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def retire_bundles(out, version, platform, names):
    result = {'mode': 'retire', 'nativeVersionId': version, 'platform': platform,
              'outputPath': str(out), 'receiptPath': str(out / RECEIPT),
              'deleted': [], 'refused': [], 'receiptUpdated': False, 'httpRequests': 0}
    def refuse(name, path, reason, size=None):
        result['refused'].append({'name': name, 'path': str(path), 'bytes': size, 'reason': reason})
    if not names:
        refuse(None, out, 'at least one --retire-bundle is required')
        return result, 1
    ok, reason = _plain_ancestors(out)
    if not ok:
        for name in names:
            refuse(name, _candidate_path(out, name), reason)
        return result, 1
    if out.name != version or not out.is_dir():
        for name in names:
            refuse(name, _candidate_path(out, name),
                   'cache root is not the requested native version folder')
        return result, 1
    receipt_path = out / RECEIPT
    ok, reason = _plain_ancestors(receipt_path)
    try:
        receipt_stat = os.lstat(receipt_path) if ok else None
    except OSError as exc:
        receipt_stat, reason = None, f'receipt unavailable: {exc}'
    if not ok or receipt_stat is None or _is_reparse(receipt_stat) or not stat.S_ISREG(receipt_stat.st_mode) or receipt_stat.st_nlink != 1:
        why = reason or 'receipt must be a plain single-link file'
        for name in names:
            refuse(name, _candidate_path(out, name), why)
        return result, 1
    try:
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    except Exception as exc:
        for name in names:
            refuse(name, _candidate_path(out, name), f'invalid receipt: {exc}')
        return result, 1
    identity_ok = receipt.get('nativeVersionId') == version and receipt.get('platform') == platform
    registered = set(receipt.get('bundles', [])) if isinstance(receipt.get('bundles'), list) else set()
    deleted_names = []
    for name in dict.fromkeys(names):
        if not safe_bundle(name):
            refuse(name, _candidate_path(out, name), 'unsafe bundle path')
            continue
        target = out.joinpath(*PurePosixPath(name).parts)
        if not _within(out, target) or not _within(out.resolve(), target.resolve(strict=False)):
            refuse(name, target, 'target escapes cache root')
            continue
        if not identity_ok:
            refuse(name, target, 'cache nativeVersionId/platform mismatch')
            continue
        if not name in registered:
            refuse(name, target, 'bundle is not registered in receipt')
            continue
        ok, reason = _plain_ancestors(target)
        if not ok:
            refuse(name, target, reason)
            continue
        try:
            info = os.lstat(target)
        except OSError as exc:
            refuse(name, target, f'bundle missing or lstat failed: {exc}')
            continue
        if _is_reparse(info) or not stat.S_ISREG(info.st_mode):
            refuse(name, target, 'bundle must be a plain regular file')
            continue
        if info.st_nlink != 1:
            refuse(name, target, f'hard-linked bundle refused (link count {info.st_nlink})', info.st_size)
            continue
        if not exclusive_lock_probe(target):
            refuse(name, target, 'exclusive Windows CreateFile share=0 probe failed', info.st_size)
            continue
        try:
            with target.open('rb') as stream:
                if stream.read(7) != b'UnityFS':
                    refuse(name, target, 'bundle does not have UnityFS header', info.st_size)
                    continue
        except OSError as exc:
            refuse(name, target, f'bundle cannot be safely read before deletion: {exc}', info.st_size)
            continue
        # Recheck link state and resolved boundary immediately before exact-file unlink.
        ok, reason = _plain_ancestors(target)
        try:
            latest = os.lstat(target) if ok else None
        except OSError as exc:
            latest, reason = None, str(exc)
        if not ok or latest is None or _is_reparse(latest) or not stat.S_ISREG(latest.st_mode) or latest.st_nlink != 1 or not _within(out.resolve(), target.resolve(strict=False)):
            refuse(name, target, reason or 'target changed or escaped before deletion', info.st_size)
            continue
        if not exclusive_lock_probe(target):
            refuse(name, target, 'exclusive Windows CreateFile share=0 probe failed before deletion', latest.st_size)
            continue
        try:
            target.unlink()
            deleted_names.append(name)
            result['deleted'].append({'name': name, 'path': str(target), 'bytes': latest.st_size})
        except OSError as exc:
            refuse(name, target, f'exact-file unlink failed: {exc}', latest.st_size)
    if deleted_names:
        receipt['bundles'] = [name for name in receipt.get('bundles', []) if name not in set(deleted_names)]
        try:
            _atomic_receipt(receipt_path, receipt)
            result['receiptUpdated'] = True
        except Exception as exc:
            result['refused'].append({'name': RECEIPT, 'path': str(receipt_path), 'bytes': receipt_stat.st_size,
                                      'reason': f'bundles deleted but atomic receipt update failed: {exc}'})
    return result, 0 if not result['refused'] and (not deleted_names or result['receiptUpdated']) else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--version', default=VERSION)
    ap.add_argument('--platform', default=PLATFORM)
    ap.add_argument('--out', help='version-specific staging directory')
    ap.add_argument('--stage', action='append', default=[], help='stage id; repeat to select several')
    ap.add_argument('--bundle', action='append', default=[], help='exact native bundle name; repeat to select several')
    ap.add_argument('--retire-bundle', action='append', default=[], help='retire an exact receipt-registered cache bundle; no HTTP')
    ap.add_argument('--include-dependencies', action='store_true')
    ap.add_argument('--max-new-bytes', type=int, default=DEFAULT_INPUT_LIMIT)
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args(argv)
    if not valid_version(args.version) or not re.fullmatch(r'[A-Za-z0-9_-]+', args.platform):
        print('invalid native version or platform', file=sys.stderr)
        return 2
    if args.max_new_bytes < 0:
        print('--max-new-bytes must be non-negative', file=sys.stderr)
        return 2
    known_stages = [sid for sid, _ in scenes.SCENES]
    if any(sid not in known_stages for sid in args.stage):
        print('unknown stage id', file=sys.stderr)
        return 2
    stage_ids = args.stage or ([] if args.bundle else list(known_stages))
    base = CDN.format(platform=args.platform, version=args.version)
    out = Path(os.path.abspath(args.out)) if args.out else ROOT / '.omni' / 'tmp' / 'assault' / 'native-scene-input' / args.version
    if out.name != args.version and not args.retire_bundle:
        print('output directory must be isolated by native version id', file=sys.stderr)
        return 2
    if args.retire_bundle:
        if args.stage or args.bundle or args.include_dependencies or args.list:
            print('--retire-bundle cannot be combined with stage, bundle, dependencies, or list options', file=sys.stderr)
            return 2
        result, code = retire_bundles(out, args.version, args.platform, args.retire_bundle)
        print(json.dumps(result, ensure_ascii=False), file=sys.stdout if code == 0 else sys.stderr)
        return code
    out_abs = str(out)
    result = {'nativeUrl': base, 'requestedVersion': args.version, 'platform': args.platform,
              'stageIds': stage_ids, 'requestedBundles': args.bundle, 'outputPath': out_abs, 'manifestPath': str(out / RECEIPT),
              'got': [], 'have': [], 'failed': []}
    try:
        manifest = json.loads(get(base + 'hot_update_list.json', MANIFEST_LIMIT))
        native_id = manifest.get('versionId')
        manifest_version = manifest.get('manifestVersion')
        infos = manifest.get('abInfos')
        if native_id != args.version or not manifest_version or not isinstance(infos, list):
            raise ValueError('native version identity or manifest fields invalid')
        by_name = {x['name']: x for x in infos if isinstance(x, dict) and isinstance(x.get('name'), str)}
        required = required_names(infos, stage_ids, args.include_dependencies, args.bundle)
        missing = [n for n in required if n not in by_name]
        if missing:
            raise ValueError('manifest omits required bundles: ' + ', '.join(missing))
        if any(not safe_bundle(n) for n in required):
            raise ValueError('manifest contains unsafe bundle path')
        result.update(nativeVersionId=native_id, manifestVersion=manifest_version,
                      expected=[{'name': n, 'url': base + dat_name(n)} for n in required])
        if args.list:
            print(json.dumps(result, ensure_ascii=False))
            return 0
        receipt_path = out / RECEIPT
        receipt = None
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
            if (receipt.get('nativeVersionId') != native_id or receipt.get('manifestVersion') != manifest_version
                    or receipt.get('platform') != args.platform):
                raise ValueError('existing cache receipt has different native identity')
        elif out.exists() and any(out.iterdir()):
            raise ValueError('cache has unreceipted files; refusing overwrite')
        have_names = set((receipt or {}).get('bundles', []))
        payloads, total_new = {}, 0
        for name in required:
            target = out.joinpath(*PurePosixPath(name).parts)
            if target.exists():
                if name not in have_names or not target.is_file() or not target.read_bytes().startswith(b'UnityFS'):
                    raise ValueError(f'{name}: existing input is not validated by native receipt')
                result['have'].append({'name': name, 'path': str(target.resolve())})
                continue
            if target.exists():
                raise ValueError(f'{name}: output path already exists')
            dat = get(base + dat_name(name), min(DEFAULT_INPUT_LIMIT, args.max_new_bytes + 32 * 1024 * 1024))
            blob = unpack_bundle(dat, name, min(DEFAULT_INPUT_LIMIT, args.max_new_bytes - total_new))
            total_new += len(blob)
            if total_new > args.max_new_bytes:
                raise ValueError(f'new input byte limit exceeded: {total_new}>{args.max_new_bytes}; no payload written')
            payloads[name] = blob
        for name, blob in payloads.items():
            target = out.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(blob)
            result['got'].append({'name': name, 'path': str(target.resolve()), 'bytes': len(blob)})
        bundles = sorted(have_names | set(payloads))
        receipt_doc = {'nativeVersionId': native_id, 'manifestVersion': manifest_version,
                       'platform': args.platform, 'bundles': bundles}
        out.mkdir(parents=True, exist_ok=True)
        receipt_path.write_text(json.dumps(receipt_doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        result['failed'].append({'reason': str(exc)})
        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
