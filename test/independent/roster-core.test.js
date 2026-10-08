import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession } from '../../server/modes/independent/session.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { matchesInheritancePermission, nativeFactions, tavernFactions } from '../../shared/independentRules.js';

const data = loadData(process.env.SP_DATA_DIR || 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data', { log: { warn() {}, error() {} } });
const sourceDesign = JSON.parse((await import('node:fs')).readFileSync(process.env.SP_INDEPENDENT_DESIGN_PATH || 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/independent-design.json', 'utf8'));
const structuredCloneJson = (x) => JSON.parse(JSON.stringify(x));

function tailoredDesign() {
  const design = structuredCloneJson(sourceDesign);
  const active = design.operators.find((x) => x.name === '角峰');
  const second = design.operators.find((x) => x !== active);
  design.rules.activeRosterIds = [active.chessId, second.chessId];
  design.rules.tavernFactions = ['萨尔贡', '拉特兰'];
  design.rules.factionIdentityEquipment = true;
  active.tier = 4;
  active.nativeFactionTags = ['萨尔贡'];
  active.modeEffects = {
    normal: { prep: [{ trigger: 'gain', behavior: 'grantEquipment', params: { outputs: [{ id: 'precision', normal: 1, elite: 1 }] } }], combat: [] },
    elite: { prep: [{ trigger: 'gain', behavior: 'grantEquipment', params: { outputs: [{ id: 'precision', normal: 3, elite: 3 }] } }], combat: [] },
  };
  return { design, active, second };
}

test('active roster fixes membership and tier counts across 20 seeds without random faction bans', () => {
  const { design, active, second } = tailoredDesign();
  const catalog = getCatalog(data, design);
  const expected = [active.chessId, second.chessId].sort();
  const expectedTiers = { [active.chessId]: 4, [second.chessId]: Number(second.tier) };
  assert.deepEqual(catalog.config.activeRosterIds, [active.chessId, second.chessId]);
  assert.equal(catalog.operators[active.chessId].recruitable, true);
  const inactive = design.operators.find((x) => !catalog.config.activeRosterIds.includes(x.chessId));
  assert.equal(catalog.operators[inactive.chessId].recruitable, false);
  assert.equal(catalog.operators[catalog.operators[inactive.chessId].eliteChessId].recruitable, false);
  for (let seed = 1; seed <= 20; seed++) {
    const state = createSession({ data, seed, catalog });
    assert.equal(state.openFactions, undefined, 'new sessions do not randomly ban factions');
    assert.deepEqual(Object.keys(state.pool).sort(), expected);
    assert.deepEqual(Object.fromEntries(Object.entries(state.pool).map(([id, p]) => [id, p.tier])), expectedTiers);
  }
});

test('authored modeEffects replace name effects and use explicit normal/elite variants at gain', () => {
  const { design, active } = tailoredDesign();
  const catalog = getCatalog(data, design);
  const run = (elite) => {
    const granted = [];
    const piece = { uid: 'piece', chessId: elite ? catalog.operators[active.chessId].eliteChessId : active.chessId, elite, nativeState: {}, equipment: [] };
    const state = { pieces: [piece], round: 1, shop: { level: 1, slots: [], freeRefreshes: 0 }, counters: {}, nextUid: 1, inventory: [] };
    runNativeHook(state, 'gain', { piece }, { catalog, grantEquipment(_s, id, quantity) { granted.push({ id, quantity }); }, record() {} });
    return granted;
  };
  assert.deepEqual(run(false), [{ id: 'precision', quantity: 1 }]);
  assert.deepEqual(run(true), [{ id: 'precision', quantity: 3 }]);
});

test('unsupported authored effects are rejected instead of becoming silent empty effects', () => {
  const { design, active } = tailoredDesign();
  active.modeEffects.normal.prep[0].behavior = 'parseChineseDescription';
  assert.throws(() => getCatalog(data, design), /UNSUPPORTED_MODE_EFFECT_BEHAVIOR/);
  const bad = tailoredDesign();
  bad.active.modeEffects.elite.combat = [{ trigger: 'deploy', behavior: 'deployBuff', params: { amount: Number.POSITIVE_INFINITY } }];
  assert.throws(() => getCatalog(data, bad.design), /BAD_MODE_EFFECT_RULE/);
});

test('modeEffects accepts registered shield-layer triggers and counter events, while rejecting unknown counters', () => {
  const { design, active } = tailoredDesign();
  active.modeEffects.normal.prep = [{ trigger: 'aura', behavior: 'triggerMultiplier', params: { hook: 'gain', extra: 1 } }];
  active.modeEffects.normal.combat = ['shieldLayersGained', 'shieldLayersBroken', 'shieldLayersThreshold'].map((event) => ({
    trigger: event, behavior: 'eventProduction', params: { counterEvent: event, counterEvery: 5, outputs: [], maxPerBattle: 1 },
  }));
  assert.doesNotThrow(() => getCatalog(data, design));
  active.modeEffects.normal.combat[0].params.counterEvent = 'unknownLayerEvent';
  assert.throws(() => getCatalog(data, design), /BAD_MODE_EFFECT_COUNTER_EVENT/);
});

test('inactive operators do not enter a random recruit offer even if an old save has stale stock', () => {
  const { design, active } = tailoredDesign();
  const inactive = design.operators.find((x) => !design.rules.activeRosterIds.includes(x.chessId) && Number(x.tier) === Number(active.tier));
  assert.ok(inactive);
  active.modeEffects.normal.prep = [{ trigger: 'gain', behavior: 'recruitOffer', params: { normalTier: Number(active.tier), choices: 20 } }];
  const catalog = getCatalog(data, design);
  const state = createSession({ data, catalog, seed: 31 });
  state.pool[inactive.chessId] = { cap: 3, left: 3, tier: Number(inactive.tier) };
  const piece = { uid: 'active', chessId: active.chessId, nativeState: {}, equipment: [] };
  state.pieces.push(piece);
  const offers = [];
  runNativeHook(state, 'gain', { piece }, { catalog, data, rng: () => 0, addOffer(_state, offer) { offers.push(offer); }, record() {} });
  assert.equal(offers.length, 1);
  assert.ok(offers[0].choices.includes(active.chessId));
  assert.ok(!offers[0].choices.includes(inactive.chessId));
});

test('native faction tags replace upstream bonds while identity gear adds a tavern-only tag', () => {
  const { design, active } = tailoredDesign();
  const catalog = getCatalog(data, design);
  assert.equal(catalog.config.factionIdentityEquipment,true,'this isolated fixture enables the current optional identity-gear mechanic');
  const proxyGear = Object.values(catalog.equipment).find((x) => x.mechanism === 'identityTag');
  const piece = { chessId: active.chessId, equipment: [{ id: proxyGear.id, state: { faction: '炎' } }] };
  assert.deepEqual(nativeFactions(piece, catalog), ['萨尔贡']);
  assert.deepEqual(new Set(tavernFactions(piece, catalog)), new Set(['萨尔贡']), 'proxy factions outside configured tavern eligibility do not apply');
  delete design.rules.tavernFactions;
  const legacyCatalog = getCatalog(data, design);
  assert.deepEqual(new Set(tavernFactions(piece, legacyCatalog)), new Set(['萨尔贡', '炎']), 'legacy default keeps the original eight proxy factions');
});

test('configured native organizations stay intact and inheritance ignores proxy-only identities', () => {
  const { design, active } = tailoredDesign();
  active.nativeFactionTags = ['莱茵生命', '黑钢国际'];
  design.rules.tavernFactions = ['莱茵生命', '黑钢国际', '罗德岛'];
  const catalog = getCatalog(data, design);
  const proxyGear = Object.values(catalog.equipment).find((x) => x.mechanism === 'identityTag');
  const piece = { chessId: active.chessId, equipment: [{ id: proxyGear.id, state: { faction: '罗德岛' } }] };
  assert.deepEqual(nativeFactions(piece, catalog), ['莱茵生命', '黑钢国际']);
  assert.deepEqual(new Set(tavernFactions(piece, catalog)), new Set(['莱茵生命', '黑钢国际', '罗德岛']));
  assert.equal(matchesInheritancePermission({ donorFaction: '莱茵生命' }, 'donor', piece, catalog), true);
  assert.equal(matchesInheritancePermission({ donorFaction: '罗德岛' }, 'donor', piece, catalog), false);
  active.nativeFactionTags = ['莱茵生命', ''];
  assert.throws(() => getCatalog(data, design), /BAD_NATIVE_FACTION_TAGS/);
});
