import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, applyAction } from '../../shared/assault/run.js';
import { pieceFromBody, mergeInventory, applyPermanentEffect } from '../../shared/assault/inventory.js';
import { applyRunLifecycleEvent } from '../../shared/assault/run-lifecycle.js';
import { operatorUpgradeProjection } from '../../shared/assault/upgrades.js';
import { makeChessRecords, buildAssaultBattleInput } from '../../shared/assault/battle-input.js';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { createAssaultStore } from '../../server/modes/assault/store.js';
import { prepareAssaultBattle } from '../../server/modes/assault/battle.js';
import { Unit } from '../../server/sim/units.js';
import { fileURLToPath } from 'node:url';

const base = createAssaultContext();
// Configuration derived from this test's actual project root; only validate(), no store I/O.
const validationRoot = fileURLToPath(new URL('../../', import.meta.url));
const ESTELL = 'char_127_estell', MYRTLE = 'char_151_myrtle';
const clone = value => structuredClone(value);
const ctxFor = (rules = []) => ({ ...base, design: { ...base.design,
  system: { ...base.design.system, runLifecycleRules: rules } } });
const make = ctx => createRun({ runId: '00000000-0000-4000-8000-000000000083', seed: 711,
  directorId: base.design.system.directors[0].id }, ctx);
const effect = (target, stat = 'atk', amount = 10, durationType = 'UntilEndOfDay', mode = 'flat') => ({
  kind: 'enhance', target, stat, mode, amountByStar: [amount, amount, amount, amount],
  ...(durationType === undefined ? {} : { durationType }),
});
const rule = (id, event, effects, ownerId = ESTELL, extra = {}) => ({ id,
  owner: { kind: 'operator', id: ownerId }, event, effects, ...extra });
const record = (id, amount = 10, extra = {}) => ({ id, stat: 'atk', mode: 'flat', amount, expiresAtHour: 6, ...extra });
const add = (state, ctx, id = ESTELL) => {
  const piece = pieceFromBody(state, ctx, id, 1, { row: null, col: null });
  state.pieces.push(piece); return piece;
};
const shop = (state, id = MYRTLE) => {
  state.phase = 'shop'; state.shop = { id: 'shop_base', kind: 'operator', refreshCost: 2,
    refreshCount: 0, slots: [{ slotId: 'finite-offer', purchaseCharId: id, charId: id, star: 1, requiredCopies: 1, price: 1 }] };
};
const act = (state, ctx, type, fields = {}, opId = type) => applyAction(state,
  { type, ...fields, opId, expectedRevision: state.revision }, ctx);
const stats = (state, piece, enhancements = []) => makeChessRecords(base.runtime, [piece], enhancements, {}, state).chess['assault:' + piece.uid].stats;
const run = (name, fn) => test(name, { timeout: 30000 }, fn);

run('temporary sell-team grant reaches current held cards only and never writes permanent growth', () => {
  const ctx = ctxFor([rule('finite-sale', 'sell', [effect('team')], ESTELL, { selfOnly: true })]);
  const initial = make(ctx), seller = add(initial, ctx), heldUid = initial.pieces[0].uid;
  const sold = act(initial, ctx, 'sell', { uid: seller.uid }, 'finite-sale-op');
  const held = sold.state.pieces.find(p => p.uid === heldUid);
  assert.equal(held.temporaryEnhancements?.length, 1);
  assert.equal(held.temporaryEnhancements[0].expiresAtHour, 6);
  assert.ok(held.temporaryEnhancements[0].id.includes('finite-sale-op'));
  assert.deepEqual(held.permanentFlat, {}); assert.deepEqual(held.permanentPercent, {});
  assert.equal(sold.state.pieces.some(p => p.uid === seller.uid), false);
  shop(sold.state); const bought = act(sold.state, ctx, 'buy', { slotId: 'finite-offer' }, 'new-independent-buy').state;
  assert.equal(bought.pieces.find(p => p.purchaseCharId === MYRTLE).temporaryEnhancements?.length ?? 0, 0);
  assert.equal(bought.pieces.find(p => p.uid === heldUid).temporaryEnhancements.length, 1);
  assert.strictEqual(applyAction(sold.state, { type: 'sell', uid: seller.uid, opId: 'finite-sale-op', expectedRevision: initial.revision }, ctx).state, sold.state);
});

run('default lifecycle enhancement stays permanent while internal UntilEndOfHour expires at next native hour', () => {
  const permanent = effect('self'); delete permanent.durationType;
  const ctx = ctxFor([rule('mixed-buy', 'buy', [permanent, effect('self', 'def', 2, 'UntilEndOfHour')])]);
  const initial = make(ctx); shop(initial, ESTELL);
  const bought = act(initial, ctx, 'buy', { slotId: 'finite-offer' }, 'mixed-buy-op').state;
  const piece = bought.pieces.find(p => p.purchaseCharId === ESTELL);
  assert.equal(piece.permanentFlat.atk, 10); assert.equal(piece.permanentFlat.def, undefined);
  assert.equal(piece.temporaryEnhancements?.[0].expiresAtHour, 1);
  const next = act(bought, ctx, 'finishShop', {}, 'next-native-hour').state;
  assert.equal(next.hour, 2); assert.deepEqual(next.pieces.find(p => p.uid === piece.uid).temporaryEnhancements, []);
  assert.equal(next.pieces.find(p => p.uid === piece.uid).permanentFlat.atk, 10);
});

run('native inventory merge deduplicates equal source ids and keeps distinct temporary grants from both inputs', () => {
  const ctx = ctxFor(), state = make(ctx), a = add(state, ctx), b = pieceFromBody(state, ctx, ESTELL);
  a.temporaryEnhancements = [record('shared'), record('from-a', 2)];
  b.temporaryEnhancements = [record('shared'), record('from-b', 3)];
  const before = clone([a, b]), merged = mergeInventory([a, b], ctx);
  assert.deepEqual([a, b], before); assert.equal(merged.length, 1); assert.equal(merged[0].star, 2);
  assert.deepEqual(merged[0].temporaryEnhancements.map(r => r.id), ['shared', 'from-a', 'from-b']);
  assert.equal(stats(state, merged[0]).atk, base.runtime.bodies[ESTELL].starStats[1].stats.atk + 15);
  state.pieces = [a]; shop(state, ESTELL);
  const bought = act(state, ctx, 'buy', { slotId: 'finite-offer' }, 'finite-merge-buy').state;
  assert.equal(bought.pieces[0].star, 2); assert.deepEqual(bought.pieces[0].temporaryEnhancements, a.temporaryEnhancements);
});

run('day-six-hour rollover removes expired records before fresh day triggers and leaves permanent layers untouched', () => {
  const ctx = ctxFor([rule('new-day', 'dayStarted', [effect('self', 'atk', 20)])]), state = make(ctx), owner = add(state, ctx);
  state.hour = 6; owner.temporaryEnhancements = [record('yesterday')]; applyPermanentEffect(owner, { stat: 'atk', amount: 7 });
  shop(state); const advanced = act(state, ctx, 'finishShop', {}, 'finite-day-rollover').state;
  const target = advanced.pieces.find(p => p.uid === owner.uid);
  assert.deepEqual([advanced.day, advanced.hour], [2, 1]); assert.equal(target.permanentFlat.atk, 7);
  assert.equal(target.temporaryEnhancements.length, 1); assert.equal(target.temporaryEnhancements[0].amount, 20);
  assert.equal(target.temporaryEnhancements[0].expiresAtHour, 12); assert.notEqual(target.temporaryEnhancements[0].id, 'yesterday');
  assert.equal(stats(advanced, target).atk, base.runtime.bodies[ESTELL].starStats[0].stats.atk + 27);
});

run('temporary projection sums flat then percent after permanent growth and before existing team effects', () => {
  const ctx = ctxFor(), state = make(ctx), piece = add(state, ctx);
  applyPermanentEffect(piece, { stat: 'atk', amount: 10 });
  applyPermanentEffect(piece, { stat: 'atk', amount: 0.1, mode: 'percent', sourceKey: 'permanent-source' });
  piece.temporaryEnhancements = [record('flat-a', 2), record('flat-b', 3),
    record('percent-a', 0.2, { mode: 'percent' }), record('percent-b', 0.3, { mode: 'percent' })];
  const actual = stats(state, piece, [{ kind: 'enhance', scope: 'team', stat: 'atk', amount: 7, mode: 'flat' }]).atk;
  const expected = ((base.runtime.bodies[ESTELL].starStats[0].stats.atk + 10) * 1.1 + 5) * 1.5 + 7;
  assert.ok(Math.abs(actual - expected) < 1e-9, actual + '/' + expected);
  assert.equal(piece.permanentFlat.atk, 10); assert.equal(piece.permanentPercent.atk, 0.1);
});

run('two adjacent battle preparations freeze live temporary input and share browser-server stat projection', () => {
  const ctx = ctxFor(), state = make(ctx), piece = state.pieces[0], encounter = ctx.design.encounters.encounters.find(e => e.kind === 'normal');
  state.hour = 5; piece.temporaryEnhancements = [record('same-day', 17)];
  const first = prepareAssaultBattle(state, encounter, ctx);
  assert.ok(Object.isFrozen(first.input.pieces[0].temporaryEnhancements));
  assert.ok(Object.isFrozen(first.input.pieces[0].temporaryEnhancements[0]));
  assert.equal(Object.isFrozen(first.input), false, 'temporary freezing does not freeze unrelated snapshot fields');
  assert.throws(() => { first.input.pieces[0].temporaryEnhancements[0].amount = 999; }, TypeError);
  const fromShared = buildAssaultBattleInput(first, { runtime: ctx.runtime, nativeData: ctx.nativeData, kits: ctx.kits });
  assert.equal(fromShared.data.chess['assault:' + piece.uid].stats.atk, stats(state, piece).atk);
  piece.temporaryEnhancements[0].amount = 23; state.hour = 6;
  const second = prepareAssaultBattle(state, encounter, ctx);
  assert.equal(first.input.pieces[0].temporaryEnhancements[0].amount, 17);
  assert.equal(second.input.pieces[0].temporaryEnhancements[0].amount, 23);
  assert.equal(stats(second.input, second.input.pieces[0]).atk - stats(first.input, first.input.pieces[0]).atk, 6);
  const before = clone(state); state.day = 2; state.hour = 1;
  const expired = prepareAssaultBattle(state, encounter, ctx);
  assert.equal(stats(expired.input, expired.input.pieces[0]).atk, base.runtime.bodies[piece.charId].starStats[piece.star - 1].stats.atk);
  assert.deepEqual(state.pieces, before.pieces, 'projection does not mutate stored records or erase history');
});

run('native upgrade projection and real form action preserve temporary identities and expiry', () => {
  const ctx = ctxFor(), state = make(ctx), piece = add(state, ctx, 'char_002_amiya');
  piece.temporaryEnhancements = [record('form-grant', 11)];
  const upgraded = operatorUpgradeProjection(piece, ctx, 3);
  assert.equal(upgraded.star, 2); assert.deepEqual(upgraded.temporaryEnhancements, piece.temporaryEnhancements);
  const formId = ctx.catalog.operators.char_002_amiya.extraForms.find(id => id !== piece.charId);
  assert.ok(formId); const changed = act(state, ctx, 'changeForm', { uid: piece.uid, charId: formId }, 'finite-form').state;
  assert.equal(changed.pieces.find(p => p.uid === piece.uid).charId, formId);
  assert.deepEqual(changed.pieces.find(p => p.uid === piece.uid).temporaryEnhancements, piece.temporaryEnhancements);
});

run('legacy save without optional temporary fields validates and normal transactions do not rewrite its input', () => {
  const ctx = ctxFor(), state = make(ctx); for (const p of state.pieces) delete p.temporaryEnhancements;
  const store = createAssaultStore({ root: validationRoot, context: ctx });
  const before = clone(state); assert.doesNotThrow(() => store.validate(state));
  const piece = state.pieces[0]; act(state, ctx, 'changeDir', { uid: piece.uid, dir: piece.dir }, 'legacy-normal-action');
  assert.deepEqual(state, before); assert.equal(Object.hasOwn(state.pieces[0], 'temporaryEnhancements'), false);
});

run('malformed optional records are rejected by store and normal action without mutating the old run', () => {
  const ctx = ctxFor(), store = createAssaultStore({ root: validationRoot, context: ctx });
  const invalid = [null, [record('x', Infinity)], [record('x', 1, { stat: 'cost' })], [record('x', 1, { expiresAtHour: 1.5 })],
    [record('x'), record('x')], [record('x', 1, { mode: 'multiply' })], [record('x', 1, { extra: 'unknown' })]];
  for (const records of invalid) {
    const state = make(ctx); state.pieces[0].temporaryEnhancements = records; const before = clone(state);
    assert.throws(() => store.validate(state), e => e.code === 'INVALID_TEMPORARY_ENHANCEMENT');
    assert.throws(() => act(state, ctx, 'changeDir', { uid: state.pieces[0].uid, dir: 'E' }, 'bad-temp'), e => e.code === 'INVALID_TEMPORARY_ENHANCEMENT');
    assert.deepEqual(state, before);
  }
});

run('signed valid native stat amounts work but illegal projected domains reject the original transaction atomically', () => {
  const ctx = ctxFor([rule('bad-domain', 'buy', [effect('self', 'bat', -100, 'UntilEndOfDay')])]), state = make(ctx); shop(state, ESTELL);
  const before = clone(state); assert.throws(() => act(state, ctx, 'buy', { slotId: 'finite-offer' }, 'bad-domain-buy'), e => e.code === 'INVALID_TEMPORARY_ENHANCEMENT');
  assert.deepEqual(state, before);
  const legal = ctxFor([rule('legal-domain', 'buy', [effect('self', 'bat', -0.05), effect('self', 'spGain', 0.5)])]);
  const valid = make(legal); shop(valid, ESTELL); const bought = act(valid, legal, 'buy', { slotId: 'finite-offer' }, 'legal-domain-buy').state;
  const piece = bought.pieces.find(p => p.purchaseCharId === ESTELL);
  assert.equal(piece.temporaryEnhancements.find(r => r.stat === 'spRecovery').amount, 0.5);
  assert.equal(stats(bought, piece).bat, base.runtime.bodies[ESTELL].starStats[0].stats.bat - 0.05);
});

run('repeated lifecycle event claims cannot add a second temporary record', () => {
  const ctx = ctxFor([rule('same-event', 'hourStarted', [effect('self')])]), state = make(ctx), piece = add(state, ctx);
  applyRunLifecycleEvent(state, ctx, 'hourStarted', { eventKey: 'hour:1:1:started' });
  const first = clone(piece.temporaryEnhancements);
  applyRunLifecycleEvent(state, ctx, 'hourStarted', { eventKey: 'hour:1:1:started' });
  assert.equal(piece.temporaryEnhancements?.length, 1); assert.deepEqual(piece.temporaryEnhancements, first);
  assert.equal(piece.permanentFlat.atk, undefined);
});

run('conflicting duplicate temporary ids cannot silently overwrite a merge input', () => {
  const ctx = ctxFor(), state = make(ctx), a = add(state, ctx), b = pieceFromBody(state, ctx, ESTELL);
  a.temporaryEnhancements = [record('shared', 10)]; b.temporaryEnhancements = [record('shared', 20)];
  const before = clone([a, b]); assert.throws(() => mergeInventory([a, b], ctx), e => e.code === 'INVALID_TEMPORARY_ENHANCEMENT');
  assert.deepEqual([a, b], before);
});

run('one native sell-team grant merges once while two distinct sale opIds retain both source grants', () => {
  const ctx = ctxFor([rule('team-source', 'sell', [effect('team')], MYRTLE, { selfOnly: true })]);
  const initial = make(ctx), a = add(initial, ctx), b = add(initial, ctx), seller = add(initial, ctx, MYRTLE);
  const first = act(initial, ctx, 'sell', { uid: seller.uid }, 'source-sale-one').state;
  const firstA = first.pieces.find(p => p.uid === a.uid), firstB = first.pieces.find(p => p.uid === b.uid);
  assert.equal(firstA.temporaryEnhancements?.length, 1);
  assert.equal(firstA.temporaryEnhancements[0].id, firstB.temporaryEnhancements[0].id, 'recipient uid is not source identity');
  assert.equal(mergeInventory([firstA, firstB], ctx)[0].temporaryEnhancements.length, 1);
  const secondSeller = add(first, ctx, MYRTLE);
  const second = act(first, ctx, 'sell', { uid: secondSeller.uid }, 'source-sale-two').state;
  const pair = second.pieces.filter(p => p.uid === a.uid || p.uid === b.uid), merged = mergeInventory(pair, ctx)[0];
  assert.equal(merged.temporaryEnhancements.length, 2);
  assert.ok(merged.temporaryEnhancements.some(r => r.id.includes('source-sale-one')));
  assert.ok(merged.temporaryEnhancements.some(r => r.id.includes('source-sale-two')));
  assert.equal(stats(second, merged).atk, base.runtime.bodies[ESTELL].starStats[1].stats.atk + 20);
});

run('finite raw temporary RES and ASPD use the real native Unit getter clamps at both boundaries', () => {
  const ctx = ctxFor(), state = make(ctx), piece = add(state, ctx);
  const nativeBase = base.runtime.bodies[ESTELL].starStats[0].stats;
  for (const [resDelta, aspdDelta, effectiveRes, effectiveAspd] of [[150, 650, 100, 600], [-150, -150, 0, 20]]) {
    piece.temporaryEnhancements = [record('res-boundary', resDelta, { stat: 'res' }), record('aspd-boundary', aspdDelta, { stat: 'aspd' })];
    const projected = stats(state, piece);
    assert.equal(projected.res, nativeBase.res + resDelta, 'finite raw RES survives shared projection');
    assert.equal(projected.aspd, nativeBase.aspd + aspdDelta, 'finite raw ASPD survives shared projection');
    const unit = new Unit({ id: 'finite-native-boundary', kind: 'op', side: 'ally', base: projected });
    assert.equal(unit.base.res, projected.res); assert.equal(unit.base.aspd, projected.aspd);
    assert.equal(unit.s.res, effectiveRes, 'production Unit getter applies the native RES clamp');
    assert.equal(unit.s.aspd, effectiveAspd, 'production Unit getter applies the native ASPD clamp');
    assert.equal(unit.s.interval, projected.bat * 100 / effectiveAspd);
  }
});
