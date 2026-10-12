import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../helpers/sparseVendorHook.js';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { getActivePrototypeSeason } from '../../shared/resonance/season-registry.js';
import { PACT_ICON_DIR, PACT_ICON_IDS, ownPactIconUrl, resolvePactIconUrl } from '../../public/js/resonance/pactIconMap.js';
import { EMBLEM_ICON_DIR } from '../../public/js/resonance/itemIconMap.js';
import { resolveStrategyIconUrl, strategyIcon } from '../../public/js/resonance/strategyIconMap.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const INSTALL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const PACT_DIR = path.join(REPO, 'public', PACT_ICON_DIR);
const data = loadData(path.join(INSTALL, 'data/resonance-native'));
const bonds = Object.values(data.bonds);
const season = getActivePrototypeSeason();
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: season.id, seed: 1 });
const display = resonanceDisplayCatalog(catalog, data);
// mode art (/css/) ships with this checkout; native art (/assets/) lives in the install
const fileOf = (url) => [path.join(REPO, 'public', url), path.join(INSTALL, 'public', url)].find((file) => fs.existsSync(file)) ?? path.join(REPO, 'public', url);

// The pacts that have at least one active-season operator (the ones a player can meet this season).
const activeOperators = Object.values(catalog.operators).filter((operator) => catalog.config.activeOperatorIds.includes(operator.id));
const activePacts = [...new Set(activeOperators.flatMap((operator) => operator.pacts))].filter((id) => catalog.pacts[id]);
const iconOf = (id, source = display) => resolvePactIconUrl(source, id, data.assets, bonds);

// What each pact that got its own icon used to share, and with whom.
const SHARED = Object.freeze({
  holyGun: { sibling: 'academy', icon: '/assets/ui/campLogo/logo_laterano.png' },
  artillery: { sibling: 'ammo', icon: '/assets/bond/preciShip.png' },
  dominator: { sibling: 'arts', icon: '/assets/bond/arcaneShip.png' },
  breaker: { sibling: 'redeploy', icon: '/assets/bond/raidShip.png' },
  formSwap: { sibling: 'combo', icon: '/assets/bond/swiftShip.png' },
});

test('no two pacts of the active season share an icon, and every icon file exists', () => {
  assert.ok(activePacts.length >= 25, `season ${season.id} has its pact list`);
  const byUrl = new Map();
  for (const id of activePacts) {
    const url = iconOf(id);
    assert.ok(url, `${id} has an icon`);
    assert.ok(fs.existsSync(fileOf(url)), `${id} icon ${url} exists`);
    assert.equal(iconOf(id, catalog), url, `${id}: the raw and the player catalog resolve the same icon`);
    byUrl.set(url, [...(byUrl.get(url) ?? []), id]);
  }
  const shared = [...byUrl].filter(([, ids]) => ids.length > 1).map(([url, ids]) => `${url} <- ${ids.join(', ')}`);
  assert.deepEqual(shared, [], 'pacts sharing one icon');
});

test('the five pacts that used to share an icon each resolve to their own svg, ahead of every native fallback', () => {
  assert.deepEqual([...PACT_ICON_IDS].sort(), Object.keys(SHARED).sort());
  for (const [id, was] of Object.entries(SHARED)) {
    assert.ok(activePacts.includes(id), `${id} is a pact of this season`);
    assert.equal(ownPactIconUrl(id), `${PACT_ICON_DIR}/${id}.svg`);
    assert.equal(iconOf(id), `${PACT_ICON_DIR}/${id}.svg`, id);
    assert.equal(resolvePactIconUrl(null, id, null, []), `${PACT_ICON_DIR}/${id}.svg`, `${id} needs neither a catalog nor the native manifest`);
    assert.equal(resolvePactIconUrl({ pacts: { [id]: { name: '突袭', nativeIconPath: '/assets/ui/campLogo/logo_laterano.png' } } }, id, data.assets, bonds), `${PACT_ICON_DIR}/${id}.svg`, `${id} beats a native bond of the same name and a faction logo`);
    assert.notEqual(iconOf(id), was.icon, `${id} no longer shows ${was.icon}`);
    assert.equal(iconOf(was.sibling), was.icon, `${was.sibling} keeps the native icon ${id} used to share`);
  }
  assert.equal(ownPactIconUrl('ammo'), null);
  assert.equal(ownPactIconUrl('noSuchPact'), null);
});

test('the icon files, their provenance manifest and the id list agree', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PACT_DIR, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.pacts).sort(), [...PACT_ICON_IDS].sort());
  assert.deepEqual(fs.readdirSync(PACT_DIR).sort(), ['manifest.json', ...PACT_ICON_IDS.map((id) => `${id}.svg`)].sort());
  for (const [id, entry] of Object.entries(manifest.pacts)) {
    assert.equal(entry.file, `${id}.svg`);
    assert.equal(entry.bytes, fs.statSync(path.join(PACT_DIR, entry.file)).size, `${id} manifest size is current`);
    assert.equal(entry.replaces, SHARED[id].icon, `${id} records the icon it stopped sharing`);
    assert.equal(entry.sharedWith, SHARED[id].sibling);
    assert.match(entry.generatedAt, /^2026-\d\d-\d\dT/, `${id} records when the shape was made`);
    for (const key of ['concept', 'promptSummary']) assert.ok(String(entry[key] || '').length > 12, `${id} records ${key}`);
    assert.ok(Array.isArray(entry.references) && entry.references.length >= 2, `${id} records its style references`);
    assert.ok(['aigc', 'hand-designed'].includes(entry.shapeSource), `${id} says where its shape came from`);
    if (entry.shapeSource === 'aigc') {
      assert.equal(entry.model, 'gpt-image-2.5-sunburst', `${id} records the AIGC model`);
      assert.match(entry.pickedVariant, /^[A-Z]\d$/, `${id} records the picked variant`);
      assert.ok(entry.candidateVariants.length >= 3 && entry.candidateVariants.includes(entry.pickedVariant), `${id} was picked from at least three variants`);
    } else {
      assert.equal(entry.model, null, `${id} was drawn without a generator`);
    }
  }
});

test('every icon is a hand-written, flat white svg of plain shapes in the bond icons\' 100 x 100 box', () => {
  const TAGS = new Set(['svg', 'g', 'path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line']);
  for (const id of PACT_ICON_IDS) {
    const svg = fs.readFileSync(path.join(PACT_DIR, `${id}.svg`), 'utf8');
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${id} is a standalone svg`);
    assert.match(svg, /viewBox="0 0 100 100"/, `${id} uses the 100 x 100 box`);
    assert.match(svg, /width="100" height="100"/, `${id} has an intrinsic size (CSS mask and canvas both need one)`);
    const tags = [...svg.matchAll(/<([a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    assert.ok(tags.length >= 2, `${id} draws something`);
    assert.deepEqual(tags.filter((tag) => !TAGS.has(tag)), [], `${id} uses plain geometry only (no images, gradients, filters, masks or scripts)`);
    assert.ok(tags.some((tag) => tag === 'path' || tag === 'polygon'), `${id} is drawn with paths or polygons`);
    assert.ok(!/base64|<image|href=|url\(|<style|<script|opacity/i.test(svg), `${id} embeds no bitmap, reference, style or transparency`);
    const paints = [...svg.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)].map((match) => match[1].toLowerCase());
    assert.ok(paints.length > 0 && paints.every((paint) => paint === '#fff' || paint === 'none'), `${id} is white and flat: ${paints}`);
    assert.ok(svg.length < 6000, `${id} stays small (${svg.length} bytes)`);
  }
});

test('strategy cards of the redrawn pacts show the new icon: pact strategies the svg, 徽记 and 王冠 strategies their badge', () => {
  const seen = { pact: new Set(), emblem: new Set() };
  for (const [id, strategy] of Object.entries(catalog.strategies)) {
    const icon = strategyIcon(display, id);
    const pactId = icon.pactId;
    if (!PACT_ICON_IDS.includes(pactId)) continue;
    const url = resolveStrategyIconUrl(display, id, data.assets, bonds);
    if (icon.kind === 'pact') { assert.equal(url, `${PACT_ICON_DIR}/${pactId}.svg`, `${id} (${strategy.name})`); seen.pact.add(pactId); }
    else if (icon.kind === 'emblem') { assert.equal(url, `${EMBLEM_ICON_DIR}/${pactId}.webp`, `${id} (${strategy.name})`); seen.emblem.add(pactId); }
  }
  assert.ok(seen.pact.has('dominator'), '掌盾支配 is a pact strategy of a redrawn pact');
  assert.deepEqual([...seen.emblem].sort(), ['artillery', 'breaker', 'dominator']);
});
