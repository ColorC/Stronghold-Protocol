import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../helpers/sparseVendorHook.js';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { resonanceCatalogPacket } from '../../server/modes/resonance/native-match.js';
import { COMPONENT_ICON_IDS, EMBLEM_ICON_DIR, EMBLEM_ICON_PACT_IDS, resonanceEmblemIconUrl, resonanceItemPactId } from '../../public/js/resonance/itemIconMap.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const EMBLEM_DIR = path.join(PUBLIC, EMBLEM_ICON_DIR);
const CANONICAL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const data = loadData(`${CANONICAL}/data/resonance-native`);

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}

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
    assert.match(entry.sourcePactIcon, /^\/(assets\/|css\/resonance-pacts\/)/, `${pactId} records the pact icon it was drawn from (native art, or its own svg once redrawn)`);
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

test('the native catalog packet gives every season emblem its badge as iconUrl, and native items none (the four own-art components are in component-icons.test.js)', () => {
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 13 });
  const packet = resonanceCatalogPacket({ data, catalog, displayCatalog: catalog, nativeChessId: (id, star) => star === 1 ? id : `resonance_${id}_star${star}` });
  const emblems = Object.keys(catalog.equipment).filter((id) => catalog.equipment[id].kind === 'emblem');
  assert.equal(emblems.length, 22);
  for (const id of emblems) {
    const url = packet.data.items[id].iconUrl;
    assert.equal(url, resonanceEmblemIconUrl(catalog, id), id);
    assert.ok(fs.existsSync(path.join(PUBLIC, url)), `${id} badge file exists`);
  }
  const others = Object.entries(packet.data.items).filter(([id]) => !emblems.includes(id) && !COMPONENT_ICON_IDS.includes(id));
  assert.ok(others.length > 0);
  for (const [id, item] of others) assert.equal(item.iconUrl, undefined, `${id} keeps resolving its native art by iconId`);
});

test('UnitThumb shows an item iconUrl when the record has one and is unchanged for native items', async () => {
  const assetsManifest = JSON.parse(fs.readFileSync(`${CANONICAL}/data/resonance-native/assets.json`, 'utf8'));
  globalThis.fetch = async (url) => String(url).endsWith('/assets.json')
    ? { ok: true, status: 200, json: async () => assetsManifest } : { ok: false, status: 404, json: async () => ({}) };
  const { data: store } = await import('../../public/js/data.js');
  const { UnitThumb, Img } = await import('../../public/js/ui/gameComponents.js');
  await store.load('assets');
  store.inject({ items: {
    prototype_emblem_arts: { id: 'prototype_emblem_arts', name: '术式徽记', kind: 'emblem', iconUrl: `${EMBLEM_ICON_DIR}/arts.webp` },
    chess_item_1_01_e_a: { id: 'chess_item_1_01_e_a', name: '维式重锤', iconId: 'trap_1041_acarm041' },
    mystery: { id: 'mystery', name: '无图装备' },
  } });
  const srcOf = (id) => [...walk(UnitThumb({ kind: 'item', id, size: 'sm' }))].find((n) => n.type === Img)?.props.src;
  assert.equal(srcOf('prototype_emblem_arts'), `${EMBLEM_ICON_DIR}/arts.webp`);
  assert.equal(srcOf('chess_item_1_01_e_a'), assetsManifest.items.trap_1041_acarm041, 'native items still use the frozen manifest by iconId');
  assert.equal(srcOf('mystery'), null, 'no art keeps the lettered fallback');
});
