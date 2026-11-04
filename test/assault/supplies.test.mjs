import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRun } from '../../shared/assault/run.js';
import { nextUint32 } from '../../shared/assault/rng.js';
import { addSupply, generateHourlySupplies, supplyDefinitions, supplyFor, validateSupplies } from '../../shared/assault/supplies.js';

const json = (name) => JSON.parse(readFileSync(new URL(`../../data/assault-design/${name}.json`, import.meta.url), 'utf8'));
const system = json('system'), events = json('events'), collectibles = json('collectibles'), encounters = json('encounters'), forms = json('forms');
const roster = ['support', 'assault', 'ranged'].flatMap((group) => json(`roster-${group}`).operators);
const operators = Object.fromEntries(roster.map((entry) => [entry.charId, structuredClone(entry)]));
operators.char_002_amiya.extraForms = forms.forms.map((entry) => entry.charId);
const bodies = Object.fromEntries(roster.map((entry) => [entry.charId, { charId: entry.charId, purchaseCharId: entry.charId, name: entry.name,
  profession: entry.profession, price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, i) => ({ star: i + 1, stats: { maxHp: 1000 * (i + 1), atk: 100 } })) }]));
for (const entry of forms.forms) bodies[entry.charId] = { charId: entry.charId, purchaseCharId: forms.family.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans, baseStats: { maxHp: 1000 },
  starStats: Array.from({ length: 4 }, (_, i) => ({ star: i + 1, stats: { maxHp: 1000 * (i + 1), atk: 100 } })) };
const supplies = [
  { id: 'machine-test', allowedStars: [1, 2], sizeSlots: 2, kind: 'machine', generationPool: ['drink-one', 'drink-two'] },
  { id: 'machine-no-pool', allowedStars: [4], sizeSlots: 2, kind: 'machine', generationPool: ['drink-one'] },
  { id: 'drink-one', allowedStars: [1], sizeSlots: 1, kind: 'beverage' },
  { id: 'drink-two', allowedStars: [2], sizeSlots: 1, kind: 'beverage' },
];
const ctx = { catalog: { operators, bodies }, design: { system: { ...system, supplyItems: supplies, supplyCapacity: 8 }, events, collectibles, encounters } };
const makeRun = () => createRun({ runId: '123e4567-e89b-42d3-a456-426614174000', seed: 711, directorId: system.directors[0].id }, ctx);
const runWithMachine = (star = 1) => { const state = makeRun(); addSupply(state, ctx, 'machine-test', star); return state; };

 test('formal run state accepts lazy empty inventory and validates supply definitions/lookup', { timeout: 30000 }, () => {
  const old = makeRun(); assert.equal(validateSupplies(old, ctx), old); assert.deepEqual(supplyDefinitions(ctx), supplies);
  assert.equal(supplyFor(ctx, 'drink-one'), supplies[2]); assert.equal(supplyFor(ctx, 'missing'), null);
  const initialized = structuredClone(old); initialized.supplies = []; initialized.nextSupplyId = 1; assert.equal(validateSupplies(initialized, ctx), initialized);
  for (const bad of [null, [{ ...supplies[0], id: '' }], [{ ...supplies[0], allowedStars: [] }], [{ ...supplies[0], allowedStars: [1, 1] }],
    [{ ...supplies[0], sizeSlots: 3 }], [{ ...supplies[0], kind: 'unknown' }], [{ ...supplies[0], generationPool: ['missing'] }],
    [{ ...supplies[0], generationPool: ['machine-test'] }]]) {
    const badCtx = { ...ctx, design: { ...ctx.design, system: { ...ctx.design.system, supplyItems: bad } } };
    assert.throws(() => supplyDefinitions(badCtx), { code: 'INVALID_SUPPLY_DEFINITIONS' });
  }
});

test('addSupply commits only valid registered item/star and enforces configured size capacity atomically', { timeout: 30000 }, () => {
  const state = makeRun(); const before = structuredClone(state);
  assert.throws(() => addSupply(state, ctx, 'missing', 1), { code: 'UNKNOWN_SUPPLY_ITEM' }); assert.deepEqual(state, before);
  assert.throws(() => addSupply(state, ctx, 'drink-one', 2), { code: 'INVALID_SUPPLY' }); assert.deepEqual(state, before);
  for (let i = 0; i < 4; i += 1) addSupply(state, ctx, 'machine-test', 1);
  assert.equal(state.supplies[0].uid, 's1'); assert.equal(state.supplies[3].uid, 's4'); assert.equal(state.nextSupplyId, 5);
  assert.throws(() => addSupply(state, ctx, 'drink-one', 1), { code: 'SUPPLY_CAPACITY' });
  assert.equal(state.supplies.length, 4); assert.equal(state.nextSupplyId, 5);
});

test('supply state rejects malformed records, duplicate/cross-piece UIDs and non-monotonic next IDs', { timeout: 30000 }, () => {
  const state = makeRun(); state.supplies = [{ uid: 's1', itemId: 'drink-one', star: 1 }]; state.nextSupplyId = 2;
  assert.doesNotThrow(() => validateSupplies(state, ctx));
  const variants = [
    { supplies: [{ uid: 'x1', itemId: 'drink-one', star: 1 }], nextSupplyId: 2 },
    { supplies: [{ uid: 's1', itemId: 'missing', star: 1 }], nextSupplyId: 2 },
    { supplies: [{ uid: 's1', itemId: 'drink-one', star: 2 }], nextSupplyId: 2 },
    { supplies: [{ uid: 's1', itemId: 'drink-one', star: 1, extra: true }], nextSupplyId: 2 },
    { supplies: [{ uid: 's1', itemId: 'drink-one', star: 1 }, { uid: 's1', itemId: 'drink-one', star: 1 }], nextSupplyId: 2 },
    { supplies: [{ uid: 's1', itemId: 'drink-one', star: 1 }], nextSupplyId: 1 },
    { supplies: [], nextSupplyId: Number.MAX_SAFE_INTEGER + 1 },
    { supplies: [{ uid: 's999999999999999999999', itemId: 'drink-one', star: 1 }], nextSupplyId: Number.MAX_SAFE_INTEGER },
  ];
  for (const fields of variants) assert.throws(() => validateSupplies({ ...makeRun(), ...fields }, ctx), { code: 'INVALID_SUPPLY' });
  const collision = makeRun(); collision.pieces[0].uid = 's1'; collision.supplies = [{ uid: 's1', itemId: 'drink-one', star: 1 }]; collision.nextSupplyId = 2;
  assert.throws(() => validateSupplies(collision, ctx), { code: 'INVALID_SUPPLY' });
  assert.throws(() => validateSupplies({ ...makeRun(), supplies: [] }, ctx), { code: 'INVALID_SUPPLY' });
});

test('hour generation uses eligible same-star beverages, one deterministic draw per machine and a per-event claim', { timeout: 30000 }, () => {
  const state = runWithMachine(1); addSupply(state, ctx, 'machine-test', 2); const machineUids = state.supplies.map((machine) => machine.uid); const priorRng = state.rngState;
  const first = nextUint32(priorRng >>> 0), second = nextUint32(first.state);
  generateHourlySupplies(state, ctx, 'hour:1:2');
  assert.equal(state.supplies.length, 4); assert.deepEqual(state.supplies.slice(2).map((item) => item.star), [1, 2]);
  assert.equal(state.supplies[2].itemId, 'drink-one'); assert.equal(state.supplies[3].itemId, 'drink-two');
  assert.equal(state.rngState, second.state, 'exactly one xorshift draw is consumed per generated machine in supply order');
  assert.deepEqual(state.history.slice(-2).map(({ kind, eventKey, sourceUid, itemId, star, uid }) => ({ kind, eventKey, sourceUid, itemId, star, uid })), [
    { kind: 'supplyGenerated', eventKey: 'hour:1:2', sourceUid: machineUids[0], itemId: 'drink-one', star: 1, uid: 's3' },
    { kind: 'supplyGenerated', eventKey: 'hour:1:2', sourceUid: machineUids[1], itemId: 'drink-two', star: 2, uid: 's4' },
  ]);
  const once = structuredClone(state); generateHourlySupplies(state, ctx, 'hour:1:2'); assert.deepEqual(state, once, 'same eventKey does not reroll or pay twice');
  generateHourlySupplies(state, ctx, 'hour:1:3'); assert.equal(state.supplies.length, 6, 'a later hour is a separate generation claim');
  assert.deepEqual(state.supplies.slice(4).map((item) => item.star), [1, 2]);
});
test('full capacity or empty legal-quality pool records one skip without consuming RNG', { timeout: 30000 }, () => {
  const full = makeRun(); for (let i = 0; i < 4; i += 1) addSupply(full, ctx, 'machine-test', 1);
  const rngFull = full.rngState; generateHourlySupplies(full, ctx, 'full-hour');
  assert.equal(full.rngState, rngFull); assert.ok(full.history.some((entry) => entry.kind === 'supplyGenerationSkipped' && entry.reason === 'capacity'));
  const noQuality = makeRun(); addSupply(noQuality, ctx, 'machine-no-pool', 4); const rngEmpty = noQuality.rngState;
  generateHourlySupplies(noQuality, ctx, 'empty-hour');
  assert.equal(noQuality.rngState, rngEmpty); assert.ok(noQuality.history.some((entry) => entry.kind === 'supplyGenerationSkipped' && entry.reason === 'no-eligible-quality'));
  const after = structuredClone(noQuality); generateHourlySupplies(noQuality, ctx, 'empty-hour'); assert.deepEqual(noQuality, after);
});

test('generation ignores removed machines and never changes operator piece identity or copy counts', { timeout: 30000 }, () => {
  const state = runWithMachine(2); const pieces = structuredClone(state.pieces); const rng = state.rngState;
  state.supplies = []; generateHourlySupplies(state, ctx, 'after-sell');
  assert.deepEqual(state.pieces, pieces); assert.equal(state.rngState, rng); assert.equal(state.supplies.length, 0);
  const active = runWithMachine(2); const originalPieces = structuredClone(active.pieces); generateHourlySupplies(active, ctx, 'hour-active');
  assert.deepEqual(active.pieces, originalPieces); assert.equal(active.supplies[1].star, 2);
});
