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

// Six pacts used to share an icon with a sibling pact or with the sub-profession of their own members. Four now take native art
// that nothing in the season uses, two carry their own SVG. `was` is what they showed before, `sibling` the pact that keeps it.
const REASSIGNED = Object.freeze({
  holyGun: { icon: '/assets/bond/lateranoShip.png', was: '/assets/ui/campLogo/logo_laterano.png', sibling: 'academy' },
  artillery: { icon: '/assets/prof/sub/bombarder.png', was: '/assets/bond/preciShip.png', sibling: 'ammo' },
  dominator: { icon: '/assets/prof/sub/mystic.png', was: '/assets/bond/arcaneShip.png', sibling: 'arts' },
  armory: { icon: '/assets/bond/skillfulShip.png', was: '/assets/prof/sub/craftsman.png', sibling: null },
  breaker: { icon: `${PACT_ICON_DIR}/breaker.svg`, was: '/assets/bond/raidShip.png', sibling: 'redeploy' },
  formSwap: { icon: `${PACT_ICON_DIR}/formSwap.svg`, was: '/assets/bond/swiftShip.png', sibling: 'combo' },
});

/** Sub-profession ids of the active season's operators (what their shop and unit cards show as the branch icon). */
function seasonBranches() {
  const branches = new Map();
  for (const operator of activeOperators) {
    const ids = new Set([operator.assets?.subProfIcon, ...Object.values(operator.stars ?? {}).map((star) => star?.record?.assets?.subProfIcon)]
      .map((icon) => /^sub_(.+)_icon$/.exec(icon ?? '')?.[1]).filter(Boolean));
    for (const id of ids) branches.set(id, [...(branches.get(id) ?? []), operator.name]);
  }
  return branches;
}

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

test('a pact icon is never the sub-profession icon of an operator of the season (it would repeat on the shop cards)', () => {
  const branches = seasonBranches();
  assert.ok(branches.size >= 15, 'the season covers many branches');
  const branchIcons = new Map([...branches.keys()].map((id) => [data.assets.prof.sub[id], id]));
  for (const id of activePacts) {
    const url = iconOf(id);
    assert.ok(!branchIcons.has(url), `${id} shows ${url}, the ${branchIcons.get(url)} branch icon of ${branches.get(branchIcons.get(url))?.slice(0, 3).join(', ')}`);
  }
});

test('the six reassigned pacts show art nothing else in the season uses, and their old siblings keep theirs', () => {
  const branches = seasonBranches();
  assert.deepEqual([...PACT_ICON_IDS].sort(), ['breaker', 'formSwap']);
  for (const [id, { icon, was, sibling }] of Object.entries(REASSIGNED)) {
    assert.ok(activePacts.includes(id), `${id} is a pact of this season`);
    assert.equal(iconOf(id), icon, id);
    assert.equal(iconOf(id, catalog), icon, `${id} from the raw catalog`);
    assert.ok(fs.existsSync(fileOf(icon)), `${icon} exists`);
    assert.notEqual(icon, was);
    const branch = /^\/assets\/prof\/sub\/(.+)\.png$/.exec(icon)?.[1];
    if (branch) assert.ok(!branches.has(branch), `no operator of the season belongs to the ${branch} branch`);
    if (sibling) assert.equal(iconOf(sibling), was, `${sibling} keeps ${was}`);
  }
  assert.equal(ownPactIconUrl('ammo'), null);
  assert.equal(resolvePactIconUrl(null, 'breaker', null, []), `${PACT_ICON_DIR}/breaker.svg`, 'own art needs neither a catalog nor the native manifest');
  assert.equal(resolvePactIconUrl({ pacts: { formSwap: { name: '迅击' } } }, 'formSwap', data.assets, bonds), `${PACT_ICON_DIR}/formSwap.svg`, 'and beats a native bond of the same name');
  // the old craftsman icon now belongs to the branch alone
  assert.ok(seasonBranches().has('craftsman'));
  assert.ok(!activePacts.some((id) => iconOf(id) === '/assets/prof/sub/craftsman.png'));
});

test('the two own icons, their provenance manifest and the id list agree', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PACT_DIR, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.pacts).sort(), [...PACT_ICON_IDS].sort());
  assert.deepEqual(fs.readdirSync(PACT_DIR).sort(), ['manifest.json', ...PACT_ICON_IDS.map((id) => `${id}.svg`)].sort());
  for (const [id, entry] of Object.entries(manifest.pacts)) {
    assert.equal(entry.file, `${id}.svg`);
    // sizes are of the repository (LF) form; a Windows checkout with core.autocrlf turns the line ends into CRLF
    const repoForm = fs.readFileSync(path.join(PACT_DIR, entry.file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(entry.bytes, Buffer.byteLength(repoForm), `${id} manifest size is current`);
    assert.equal(entry.replaces, REASSIGNED[id].was, `${id} records the icon it stopped sharing`);
    assert.equal(entry.sharedWith, REASSIGNED[id].sibling);
    assert.match(entry.generatedAt, /^2026-\d\d-\d\dT/, `${id} records when the shape was made`);
    for (const key of ['concept', 'promptSummary']) assert.ok(String(entry[key] || '').length > 12, `${id} records ${key}`);
    assert.ok(Array.isArray(entry.references) && entry.references.length >= 2, `${id} records its style references`);
    assert.ok(['aigc', 'hand-designed'].includes(entry.shapeSource), `${id} says where its shape came from`);
    if (entry.shapeSource === 'aigc') {
      assert.equal(entry.model, 'gpt-image-2.5-sunburst', `${id} records the AIGC model`);
    } else {
      assert.equal(entry.model, null, `${id} was drawn without a generator`);
      assert.match(entry.pickedVariant, /^[A-Z]$/, `${id} records which draft was picked`);
      assert.ok(entry.candidateVariants.length >= 3 && entry.candidateVariants.includes(entry.pickedVariant), `${id} was picked from at least three drafts`);
      assert.ok(String(entry.selection || '').length > 40, `${id} records why that draft won`);
    }
  }
});

test('each own icon is a flat white svg of plain shapes in the bond icons\' 100 x 100 box', () => {
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

test('strategy cards of these pacts show the same icon: pact strategies the pact icon, 徽记 and 王冠 strategies their badge', () => {
  const seen = { pact: new Set(), emblem: new Set() };
  for (const [id, strategy] of Object.entries(catalog.strategies)) {
    const icon = strategyIcon(display, id);
    if (!REASSIGNED[icon.pactId]) continue;
    const url = resolveStrategyIconUrl(display, id, data.assets, bonds);
    if (icon.kind === 'pact') { assert.equal(url, REASSIGNED[icon.pactId].icon, `${id} (${strategy.name})`); seen.pact.add(icon.pactId); }
    else if (icon.kind === 'emblem') { assert.equal(url, `/css/resonance-emblems/${icon.pactId}.webp`, `${id} (${strategy.name})`); seen.emblem.add(icon.pactId); }
  }
  assert.ok(seen.pact.has('dominator'), '掌盾支配 is a pact strategy of a reassigned pact');
  assert.deepEqual([...seen.emblem].sort(), ['artillery', 'breaker', 'dominator']);
});
