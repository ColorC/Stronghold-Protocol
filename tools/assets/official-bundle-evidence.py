#!/usr/bin/env python3
"""Download exact official resource-version bundles and retain their typetrees.

Inputs are a native official resource root and exact bundle names. The output
receipt records URLs and absolute paths; digest fields are not version gates.
"""
import argparse
import io
import json
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resource-root', required=True)
    parser.add_argument('--decoder-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('bundles', nargs='+')
    args = parser.parse_args()
    sys.path.insert(0, str(args.decoder_dir.resolve()))
    import aklz4  # noqa: F401: official LZ4AK decompressor registration
    import UnityPy

    root = args.out.resolve()
    root.mkdir(parents=True, exist_ok=True)
    receipt = {'resourceRoot': args.resource_root, 'resourceVersion': args.resource_root.rstrip('/').rsplit('/', 1)[-1],
               'bundles': [], 'failures': []}
    receipt_path = root / 'official-bundle-receipt.json'
    try:
        for name in args.bundles:
            package = name.removesuffix('.ab').replace('/', '_').replace('#', '__') + '.dat'
            url = args.resource_root.rstrip('/') + '/' + urllib.parse.quote(package)
            request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(request, timeout=60) as response:
                archive = zipfile.ZipFile(io.BytesIO(response.read()))
            entry = {'bundle': name, 'sourceUrl': url, 'files': []}
            receipt['bundles'].append(entry)
            for member in archive.infolist():
                if member.is_dir():
                    continue
                target = (root / 'ab' / member.filename).resolve()
                if not target.is_relative_to(root / 'ab'):
                    raise ValueError('Archive member escapes input directory: ' + member.filename)
                if target.exists():
                    raise FileExistsError('Existing input is preserved: ' + str(target))
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(member))
                env = UnityPy.load(str(target))
                rows = []
                for obj in env.objects:
                    row = {'type': obj.type.name, 'path_id': int(obj.path_id)}
                    try:
                        data = obj.read_typetree()
                        row['name'] = data.get('m_Name', '') if isinstance(data, dict) else ''
                        row['data'] = data
                    except Exception as error:
                        row['error'] = str(error)
                    rows.append(row)
                dump = target.with_suffix(target.suffix + '.typetree.json')
                dump.write_text(json.dumps(rows, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
                entry['files'].append({'bundleInput': str(target), 'typetree': str(dump), 'objects': len(rows),
                                       'decodeErrors': sum('error' in row for row in rows)})
                print(json.dumps(entry['files'][-1], ensure_ascii=False), flush=True)
    except Exception as error:
        receipt['failures'].append(str(error))
        raise
    finally:
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
        print('receipt=' + str(receipt_path), flush=True)


if __name__ == '__main__':
    main()
