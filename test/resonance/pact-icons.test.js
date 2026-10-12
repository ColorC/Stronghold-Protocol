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
import { resolvePactIconUrl } from '../../public/js/resonance/pactIconMap.js';
import { resolveStrategyIconUrl, strategyIcon } from '../../public/js/resonance/strategyIconMap.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const INSTALL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
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

// Six pacts used to share an icon with a sibling pact or with the sub-profession of their own members. They now take native
// art that nothing in the season uses; `was` is what they showed before, `sibling` the pact that keeps it.
const REASSIGNED = Object.freeze({
  holyGun: { icon: '/assets/bond/lateranoShip.png', was: '/assets/ui/campLogo/logo_laterano.png', sibling: 'academy' },
  artillery: { icon: '/assets/prof/sub/bombarder.png', was: '/assets/bond/preciShip.png', sibling: 'ammo' },
  dominator: { icon: '/assets/prof/sub/mystic.png', was: '/assets/bond/arcaneShip.png', sibling: 'arts' },
  breaker: { icon: '/assets/prof/sub/sword.png', was: '/assets/bond/raidShip.png', sibling: 'redeploy' },
  formSwap: { icon: '/assets/prof/sub/dollkeeper.png', was: '/assets/bond/swiftShip.png', sibling: 'combo' },
  armory: { icon: '/assets/bond/skillfulShip.png', was: '/assets/prof/sub/craftsman.png', sibling: null },
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

test('the six reassigned pacts show native art nothing else in the season uses, and their old siblings keep theirs', () => {
  const branches = seasonBranches();
  for (const [id, { icon, was, sibling }] of Object.entries(REASSIGNED)) {
    assert.ok(activePacts.includes(id), `${id} is a pact of this season`);
    assert.equal(iconOf(id), icon, id);
    assert.equal(iconOf(id, catalog), icon, `${id} from the raw catalog`);
    assert.ok(fs.existsSync(path.join(INSTALL, 'public', icon)), `${icon} ships with the game assets`);
    assert.notEqual(icon, was);
    const branch = /^\/assets\/prof\/sub\/(.+)\.png$/.exec(icon)?.[1];
    if (branch) assert.ok(!branches.has(branch), `no operator of the season belongs to the ${branch} branch`);
    if (sibling) assert.equal(iconOf(sibling), was, `${sibling} keeps ${was}`);
  }
  // the old craftsman icon now belongs to the branch alone
  assert.ok(seasonBranches().has('craftsman'));
  assert.ok(!activePacts.some((id) => iconOf(id) === '/assets/prof/sub/craftsman.png'));
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
