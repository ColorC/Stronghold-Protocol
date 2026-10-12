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
import { resonanceContent } from '../../shared/resonance/catalog.js';
import { COMPONENT_ICON_DIR, COMPONENT_ICON_IDS, RESONANCE_ITEM_ICON_IDS, resonanceEmblemIconUrl, resonanceNativeItem, resonanceOwnItemIconUrl } from '../../public/js/resonance/itemIconMap.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const COMPONENT_DIR = path.join(PUBLIC, COMPONENT_ICON_DIR);
const CANONICAL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const data = loadData(`${CANONICAL}/data/resonance-native`);
const nativeItems = Object.values(JSON.parse(fs.readFileSync(`${CANONICAL}/data/resonance-native/items.json`, 'utf8')));
const NEW_NAMES = { bow: '装置', belt: '糖', cloak: '固源岩', tear: '技巧概要·卷1' };
const OLD_NAMES = ['叙拉古正装', '歌利亚头盔', '耶拉冈德之泪', '迅捷作战粮'];

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}

/** Canvas size and alpha flag of an extended (VP8X) WebP. */
function webpInfo(file) {
  const head = fs.readFileSync(file).subarray(0, 30);
  assert.equal(head.toString('latin1', 0, 4) + head.toString('latin1', 8, 12), 'RIFFWEBP', `${file} is a WebP image`);
  assert.equal(head.toString('latin1', 12, 16), 'VP8X', `${file} keeps its alpha channel`);
  return { alpha: Boolean(head[20] & 0x10), width: 1 + head.readUIntLE(24, 3), height: 1 + head.readUIntLE(27, 3) };
}

test('no basic component uses the name or the art of a native T3-or-higher item', () => {
  const highTier = nativeItems.filter((item) => item.tier >= 3);
  assert.ok(highTier.length > 0);
  const highNames = new Set(highTier.map((item) => item.name));
  const highIcons = new Set(highTier.flatMap((item) => [item.iconId, item.trapId]).filter(Boolean));
  for (const rulesVersion of [1, 2, 3]) {
    const catalog = getResonanceCatalog(data, { rulesVersion, seed: 1 });
    const components = Object.values(catalog.equipment).filter((item) => item.kind === 'component');
    assert.equal(components.length, 8, `rulesVersion ${rulesVersion}`);
    for (const item of components) {
      assert.ok(!highNames.has(item.name), `${item.id} ${item.name} is the name of a native T3+ item`);
      assert.ok(!OLD_NAMES.includes(item.name), `${item.id} still carries an old borrowed name`);
      assert.ok(!highIcons.has(item.iconId), `${item.id} borrows the art ${item.iconId} of a native T3+ item`);
      assert.ok(!highIcons.has(item.nativeItemId), `${item.id} points at a native T3+ item`);
      if (COMPONENT_ICON_IDS.includes(item.id)) assert.equal(item.name, NEW_NAMES[item.id], item.id);
      else {
        const native = nativeItems.find((row) => row.id === item.nativeItemId);
        assert.ok(native && native.tier <= 2, `${item.id} stays a native T1-T2 item`);
        assert.equal(native.name, item.name);
      }
    }
  }
  assert.deepEqual(Object.keys(NEW_NAMES).sort(), [...COMPONENT_ICON_IDS].sort());
  for (const name of Object.values(NEW_NAMES)) assert.ok(!nativeItems.some((item) => item.name === name), `${name} is not a native item name`);
});

test('the four 养成材料 names are used once in the catalog and the old names appear nowhere in the player catalog', () => {
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 1 });
  const display = resonanceDisplayCatalog(catalog, data);
  for (const [id, name] of Object.entries(NEW_NAMES)) {
    for (const source of [catalog, display]) {
      assert.equal(source.equipment[id].name, name, id);
      assert.equal(Object.values(source.equipment).filter((item) => item.name === name).length, 1, `${name} names one item`);
      for (const group of ['operators', 'pacts', 'strategies']) {
        assert.ok(!Object.values(source[group] ?? {}).some((row) => row.name === name), `${name} is also a ${group} name`);
      }
    }
  }
  const text = JSON.stringify(display);
  for (const old of OLD_NAMES) assert.ok(!text.includes(old), `${old} left in the player catalog`);
  assert.deepEqual(resonanceContent.equipment.bow.effects, [{ kind: 'component_stat', params: { aspd: 15 } }], 'only the name and art changed');
});

test('each own-art component has an image file that its manifest describes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(COMPONENT_DIR, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.components).sort(), [...COMPONENT_ICON_IDS].sort());
  const files = fs.readdirSync(COMPONENT_DIR).filter((name) => name.endsWith('.webp')).sort();
  assert.deepEqual(files, COMPONENT_ICON_IDS.map((id) => `${id}.webp`).sort(), 'no stray image, none missing');
  assert.ok(manifest.resVersion && !Number.isNaN(Date.parse(manifest.downloadedAt)), 'records the official resource version and download time');
  assert.match(manifest.resourceRoot, /^https:\/\/.+\/Android\/assets\//);
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 1 });
  const iconIds = new Set();
  for (const id of COMPONENT_ICON_IDS) {
    const entry = manifest.components[id];
    assert.equal(entry.file, `${id}.webp`);
    assert.equal(entry.itemName, catalog.equipment[id].name, `${id} manifest names the item the catalog shows`);
    assert.match(entry.itemId, /^\d+$/, `${id} records the Arknights item id`);
    assert.match(entry.iconId, /^MTL_/, `${id} records the material icon id`);
    assert.equal(entry.spriteName, entry.iconId);
    assert.match(entry.sourceBundle, /^arts\/ui_item_icons_\d+\.ab$/);
    iconIds.add(entry.iconId);
    const file = path.join(COMPONENT_DIR, entry.file);
    assert.equal(fs.statSync(file).size, entry.bytes, `${id} manifest size matches the file`);
    assert.deepEqual(webpInfo(file), { alpha: true, width: manifest.size, height: manifest.size }, `${id} is a square transparent image`);
  }
  assert.equal(iconIds.size, COMPONENT_ICON_IDS.length, 'four different material icons');
});

test('only components in the own-art list resolve to a component image; emblems still resolve through the same function', () => {
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 1 });
  const display = resonanceDisplayCatalog(catalog, data);
  for (const id of Object.keys(catalog.equipment)) {
    const own = resonanceOwnItemIconUrl(catalog, id);
    const kind = catalog.equipment[id].kind;
    assert.equal(resonanceOwnItemIconUrl(display, id), own, `${id} resolves the same art from the player catalog`);
    if (COMPONENT_ICON_IDS.includes(id)) assert.equal(own, `${COMPONENT_ICON_DIR}/${id}.webp`, id);
    else if (kind === 'emblem') assert.equal(own, resonanceEmblemIconUrl(catalog, id), id);
    else assert.equal(own, null, `${id} keeps its native art`);
    if (kind === 'component') assert.equal(resonanceEmblemIconUrl(catalog, id), null, `${id} is no emblem`);
  }
  assert.equal(resonanceOwnItemIconUrl({ equipment: { bow: { kind: 'completed' } } }, 'bow'), null, 'only a component takes a component image');
  assert.equal(resonanceOwnItemIconUrl({ equipment: { blade: { kind: 'component' } } }, 'blade'), null, 'a native component keeps its native art');
  assert.equal(resonanceOwnItemIconUrl({ equipment: { __proto__: { kind: 'x' } } }, 'toString'), null);
  assert.equal(resonanceOwnItemIconUrl(null, 'bow'), null);
  for (const id of COMPONENT_ICON_IDS) assert.equal(resonanceNativeItem(catalog, id, nativeItems), null, `${id} resolves to no native item`);
});

test('the native catalog packet gives the four components their material icon as iconUrl and no native art id', () => {
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 13 });
  const packet = resonanceCatalogPacket({ data, catalog, displayCatalog: catalog, nativeChessId: (id, star) => star === 1 ? id : `resonance_${id}_star${star}` });
  for (const id of COMPONENT_ICON_IDS) {
    const item = packet.data.items[id];
    assert.equal(item.iconUrl, `${COMPONENT_ICON_DIR}/${id}.webp`, id);
    assert.ok(fs.existsSync(path.join(PUBLIC, item.iconUrl)), `${id} image exists`);
    assert.equal(item.iconId, undefined, `${id} sends no native art id`);
    assert.equal(item.name, NEW_NAMES[id]);
    assert.equal(packet.catalog.equipment[id].name, NEW_NAMES[id]);
  }
  for (const id of ['blade', 'staff', 'plate', 'crest']) {
    assert.equal(packet.data.items[id].iconUrl, undefined, `${id} keeps resolving its native art`);
    assert.ok(packet.data.items[id].iconId, `${id} keeps its native art id`);
  }
});

test('the mode item icon and the native item thumb show the component image', async () => {
  const assetsManifest = JSON.parse(fs.readFileSync(`${CANONICAL}/data/resonance-native/assets.json`, 'utf8'));
  globalThis.fetch = async (url) => String(url).endsWith('/assets.json')
    ? { ok: true, status: 200, json: async () => assetsManifest } : { ok: false, status: 404, json: async () => ({}) };
  const { data: store } = await import('../../public/js/data.js');
  const { assets } = await import('../../public/js/assets.js');
  const { UnitThumb, Img } = await import('../../public/js/ui/gameComponents.js');
  const { ResonanceItemIcon, resonanceItemIconUrl } = await import('../../public/js/resonance/itemIcon.js');
  await store.load('assets');
  assets.seed(assetsManifest);
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 1 });
  const display = resonanceDisplayCatalog(catalog, data);
  const packet = resonanceCatalogPacket({ data, catalog, displayCatalog: catalog, nativeChessId: (id, star) => star === 1 ? id : `resonance_${id}_star${star}` });
  store.inject({ items: packet.data.items });
  const imgOf = (vnode) => [...walk(vnode)].find((node) => node.type === 'img' || node.type === Img)?.props.src;
  for (const id of COMPONENT_ICON_IDS) {
    const url = `${COMPONENT_ICON_DIR}/${id}.webp`;
    assert.equal(resonanceItemIconUrl(display, id), url, `${id} item icon url`);
    assert.equal(imgOf(ResonanceItemIcon({ catalog: display, itemId: id, size: 'md' })), url, `${id} mode item icon`);
    assert.equal(imgOf(UnitThumb({ kind: 'item', id, size: 'sm' })), url, `${id} native item thumb`);
  }
  for (const id of ['blade', 'plate']) {
    const native = assetsManifest.items[RESONANCE_ITEM_ICON_IDS[id]];
    assert.ok(native, id);
    assert.equal(resonanceItemIconUrl(display, id), native, `${id} still shows its native art`);
    assert.equal(imgOf(ResonanceItemIcon({ catalog: display, itemId: id, size: 'md' })), native, `${id} mode item icon`);
  }
});
