import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { EMBLEM_ICON_DIR, EMBLEM_ICON_PACT_IDS, resonanceEmblemIconUrl, resonanceItemPactId } from '../../public/js/resonance/itemIconMap.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const EMBLEM_DIR = path.join(PUBLIC, EMBLEM_ICON_DIR);
const data = loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');

test('every emblem of the active season resolves to its own badge file, not the pact icon', () => {
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 1 });
  const display = resonanceDisplayCatalog(catalog, data);
  const emblems = Object.entries(catalog.equipment).filter(([, item]) => item.kind === 'emblem');
  assert.equal(emblems.length, 22);
  const urls = new Set();
  for (const [id] of emblems) {
    const pactId = resonanceItemPactId(catalog, id);
    const url = resonanceEmblemIconUrl(catalog, id);
    assert.equal(url, `${EMBLEM_ICON_DIR}/${pactId}.webp`, id);
    assert.equal(display.equipment[id].effects, undefined, 'the player catalog sends no effects');
    assert.equal(resonanceItemPactId(display, id), pactId, `${id} pact read from the player catalog`);
    assert.equal(resonanceEmblemIconUrl(display, id), url, `${id} resolves the same badge from the player catalog`);
    const file = path.join(PUBLIC, url);
    assert.ok(fs.existsSync(file), `${id} badge file ${file}`);
    const head = fs.readFileSync(file).subarray(0, 12);
    assert.equal(head.toString('latin1', 0, 4) + head.toString('latin1', 8, 12), 'RIFFWEBP', `${id} is a WebP image`);
    urls.add(url);
  }
  assert.equal(urls.size, emblems.length, 'pacts sharing a pact icon still get distinct badges');
});

test('the badge list, the files and the provenance manifest agree', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EMBLEM_DIR, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.emblems).sort(), [...EMBLEM_ICON_PACT_IDS].sort());
  const files = fs.readdirSync(EMBLEM_DIR).filter((name) => name.endsWith('.webp')).sort();
  assert.deepEqual(files, EMBLEM_ICON_PACT_IDS.map((id) => `${id}.webp`).sort());
  for (const [pactId, entry] of Object.entries(manifest.emblems)) {
    assert.equal(entry.file, `${pactId}.webp`);
    assert.match(entry.sourcePactIcon, /^\/assets\//, `${pactId} records the pact icon it was drawn from`);
    assert.ok(entry.model && entry.generatedAt, `${pactId} records model and time`);
  }
});

test('only emblems take badge art; an emblem whose pact has no badge falls back to the pact icon', () => {
  const catalog = { equipment: {
    known: { kind: 'emblem', effects: [{ kind: 'transfer_pact', params: { pactId: 'arts' } }] },
    unknown: { kind: 'emblem', effects: [{ kind: 'transfer_pact', params: { pactId: 'noSuchPact' } }] },
    transfer: { kind: 'completed', effects: [{ kind: 'transfer_pact', params: { pactId: 'arts' } }] },
    prototype_emblem_noSuchPact: { kind: 'emblem' },
    prototype_emblem_arts: { kind: 'completed' },
  } };
  assert.equal(resonanceEmblemIconUrl(catalog, 'known'), `${EMBLEM_ICON_DIR}/arts.webp`);
  assert.equal(resonanceEmblemIconUrl(catalog, 'unknown'), null);
  assert.equal(resonanceEmblemIconUrl(catalog, 'transfer'), null);
  assert.equal(resonanceEmblemIconUrl(catalog, 'missing'), null);
  assert.equal(resonanceItemPactId(catalog, 'prototype_emblem_noSuchPact'), 'noSuchPact', 'pact icon fallback still knows the pact');
  assert.equal(resonanceEmblemIconUrl(catalog, 'prototype_emblem_noSuchPact'), null);
  assert.equal(resonanceItemPactId(catalog, 'prototype_emblem_arts'), null, 'the id convention applies to emblems only');
});
