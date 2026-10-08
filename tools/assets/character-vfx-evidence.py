#!/usr/bin/env python3
"""Trace every serialized VFX field through local prefab references.

Unlike a first-key summary, this keeps each component and nested field path.
It joins projectile keys by their exact prefab name and reports missing roots,
missing local references and missing effect assets. It does not infer playback
timing or declare visual parity from prefab names.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import deque
from pathlib import Path

INTERESTING = re.compile(r'effect|anim|mount|projectile|spawn|rotate|duration|range|hold|delay|lifetime|attack|mode|buff', re.I)
BASE_FIELDS = {'m_GameObject', 'm_Enabled', 'm_Script', 'm_Name'}


def fields(value, path=''):
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = path + '/' + str(key).replace('~', '~0').replace('/', '~1')
            yield child_path, key, child
            yield from fields(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            child_path = path + '/' + str(index)
            yield child_path, '', child
            yield from fields(child, child_path)


def references(value):
    for path, _, child in fields(value):
        if isinstance(child, dict) and {'m_FileID', 'm_PathID'} <= child.keys() and child['m_PathID']:
            yield path, int(child['m_FileID']), int(child['m_PathID'])


def strings(value):
    if isinstance(value, str):
        if value:
            yield value
    elif isinstance(value, (dict, list)):
        for _, _, child in fields(value):
            if isinstance(child, str) and child:
                yield child


class Bundle:
    def __init__(self, label, path):
        self.label, self.path = label, Path(path).resolve()
        rows = json.loads(self.path.read_text(encoding='utf-8-sig'))
        self.nodes = {int(row['path_id']): row for row in rows}
        self.roots = {}
        for row in rows:
            if row.get('type') == 'GameObject':
                self.roots.setdefault(row.get('name', ''), []).append(int(row['path_id']))

    def trace(self, name):
        todo = deque(self.roots.get(name, []))
        visited, components, missing, external = set(), [], [], []
        while todo:
            pid = todo.popleft()
            if pid in visited:
                continue
            visited.add(pid)
            node = self.nodes.get(pid)
            if node is None:
                missing.append(str(pid))
                continue
            data = node.get('data', {})
            if node.get('type') == 'MonoBehaviour':
                raw = {key: value for key, value in data.items() if key not in BASE_FIELDS}
                owner_id = data.get('m_GameObject', {}).get('m_PathID')
                owner = self.nodes.get(owner_id, {})
                components.append({
                    'pathId': str(pid), 'script': data.get('m_Script'),
                    'gameObjectId': str(owner_id) if owner_id else None,
                    'gameObjectName': owner.get('name'),
                    'fields': raw,
                    'semanticFields': [{'path': path, 'field': key, 'value': child}
                                       for path, key, child in fields(raw) if INTERESTING.search(key)],
                })
            for path, file_id, ref_id in references(data):
                if file_id == 0:
                    todo.append(ref_id)
                else:
                    external.append({'nodeId': str(pid), 'field': path,
                                     'fileId': file_id, 'pathId': str(ref_id)})
        return {'bundle': self.label, 'source': str(self.path), 'prefab': name,
                'rootIds': [str(pid) for pid in self.roots.get(name, [])],
                'visitedNodes': len(visited), 'components': components,
                'missingLocalReferences': sorted(set(missing)), 'externalReferences': external}


def build(bundles, root_requests, effect_names):
    by_label = {bundle.label: bundle for bundle in bundles}
    projectile_bundles = [bundle for bundle in bundles if bundle.label == 'projectiles']
    reports, missing_roots, effects = [], [], []
    seen_roots = set()
    todo = deque(root_requests)
    while todo:
        label, name = todo.popleft()
        if (label, name) in seen_roots:
            continue
        seen_roots.add((label, name))
        bundle = by_label[label]
        report = bundle.trace(name)
        reports.append(report)
        if not report['rootIds']:
            missing_roots.append({'bundle': label, 'prefab': name})
        for component in report['components']:
            for entry in component['semanticFields']:
                if 'effect' in entry['field'].lower():
                    for effect in sorted(set(strings(entry['value']))):
                        effects.append({'prefab': effect, 'root': name, 'bundle': label,
                                        'nodeId': component['pathId'], 'field': entry['path'],
                                        'assetFound': effect in effect_names})
                if 'projectile' in entry['field'].lower():
                    for key in strings(entry['value']):
                        matches = [b for b in projectile_bundles if key in b.roots]
                        if matches:
                            todo.extend((b.label, key) for b in matches)
                        elif key.startswith('projectile_'):
                            missing_roots.append({'bundle': 'projectiles', 'prefab': key})
    return {'schemaVersion': 1, 'status': 'source-evidence-only',
            'sources': [{'label': b.label, 'path': str(b.path)} for b in bundles],
            'roots': reports, 'effects': effects,
            'summary': {'rootCount': len(reports), 'effectCount': len({x['prefab'] for x in effects}),
                        'missingRoots': missing_roots,
                        'missingEffects': sorted({x['prefab'] for x in effects if not x['assetFound']}),
                        'missingLocalReferences': sum(len(x['missingLocalReferences']) for x in reports)},
            'visualParityVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', action='append', required=True, metavar='LABEL=ABSOLUTE_TYPE_TREE')
    parser.add_argument('--root', action='append', required=True, metavar='LABEL=PREFAB')
    parser.add_argument('--effects-index', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    bundles = [Bundle(*value.split('=', 1)) for value in args.bundle]
    index = json.loads(args.effects_index.read_text(encoding='utf-8-sig'))
    names = set(index['all']) if isinstance(index, dict) else {entry['prefab'] for entry in index}
    report = build(bundles, [tuple(value.split('=', 1)) for value in args.root], names)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.out.resolve()), **report['summary']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
