import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAssaultDesign } from '../../server/modes/assault/data.js';
import { applyRelicChoiceBonus, applyRelicRunEvent } from '../../shared/assault/relic-rules.js';

const design = loadAssaultDesign();

test('a legal alternate design is consumed without a parallel acquisition constant, and missing context cannot consume its claim', () => {
  const alternate=structuredClone(design);
  alternate.collectibles.items.find(item=>item.id==='econ-oldcoins').effects[0].params.amount=4;
  const draft=state(['econ-oldcoins']);
  const acquisition={acquisition:true,relicId:'econ-oldcoins',source:'relicAcquisition'};
  const before=structuredClone(draft);
  assert.throws(()=>applyRelicRunEvent(draft,{},'purchase',acquisition),/requires its design effect/);
  assert.deepEqual(draft,before,'a failed source/context check does not spend the one-time claim');
  applyRelicRunEvent(draft,{design:alternate},'purchase',acquisition);
  assert.equal(draft.gold,24);
  applyRelicRunEvent(draft,{design:alternate},'purchase',acquisition);
  assert.equal(draft.gold,24,'the alternate amount is still one-time');
});

function state(relicIds = ['econ-oldcoins', 'econ-flawlessjade', 'cross-artinstall', 'cross-lancepro', 'cross-chivalry', 'econ-friendship']) {
  return {
    schema: 'assault-run/v1', relicIds, day: 8, hour: 1, gold: 20, xp: 100, life: 5, maxLife: 10,
    claimed: [], pieces: [{ uid: 'p1', nativebodyUID: 'body-1', permanentFlat: {}, permanentPercent: {}, claimed: [] }],
  };
}

test('purchase handlers require a real collectible acquisition source, not operator purchaseCharId', () => {
  const draft = state();
  applyRelicRunEvent(draft, { design }, 'purchase', { purchaseCharId: 'operator-copy' });
  assert.equal(draft.gold, 20);
  assert.equal(draft.life, 5);
  applyRelicRunEvent(draft, { design }, 'purchase', { acquisition: true, relicId: 'econ-oldcoins', source: 'relicAcquisition' });
  applyRelicRunEvent(draft, { design }, 'purchase', { acquisition: true, relicId: 'econ-flawlessjade', source: 'relicAcquisition' });
  applyRelicRunEvent(draft, { design }, 'purchase', { acquisition: true, relicId: 'cross-artinstall', source: 'relicAcquisition' });
  applyRelicRunEvent(draft, { design }, 'purchase', { acquisition: true, relicId: 'cross-artinstall', source: 'relicAcquisition' });
  assert.equal(draft.gold, 41);
  assert.equal(draft.life, 8);
  applyRelicRunEvent(draft, { design }, 'purchase', { shopAction: 'refresh' });
  assert.equal(draft.relicRefreshDiscount, 1);
});

test('shared settlement applies summed multipliers, one flat bonus, and no final payout', () => {
  const draft = state();
  draft.relicIds.push('econ-rings', 'econ-scrapmedal', 'econ-leithmedal');
  applyRelicRunEvent(draft, { design }, 'battleEnd', { battleId: 'b1', victory: true, isFinal: false, battleGoldDrop: 10, battleXp: 10,
    permanentEffects: [{ nativebodyUID: 'body-1', effectKey: 'growth-a', sourceId: 'pierce-altar', stat: 'atk', amount: 0.05, mode: 'percent' }] });
  assert.equal(draft.gold, 35, 'friendship and rings sum before flooring, then cross-lancepro pays once');
  assert.equal(draft.xp, 112, 'scrap and leith XP multipliers sum before flooring');
  assert.deepEqual(draft.pieces[0].permanentPercent, {});
  assert.equal(draft.relicIntegrationNotes, undefined);
  const before = { gold: draft.gold, xp: draft.xp };
  applyRelicRunEvent(draft, { design }, 'battleEnd', { battleId: 'b1', victory: true, isFinal: false, battleGoldDrop: 10, battleXp: 10 });
  assert.deepEqual({ gold: draft.gold, xp: draft.xp }, before, 'repeated settlement is idempotent');
  applyRelicRunEvent(draft, { design }, 'battleEnd', { battleId: 'final', victory: true, isFinal: true, battleGoldDrop: 99, battleXp: 99 });
  assert.deepEqual({ gold: draft.gold, xp: draft.xp }, before, 'final battles have no reward');
});

test('pierce altar is a capped run counter and increments only once per victorious battle', () => {
  const draft = state(['pierce-altar']);
  for (let index = 0; index < 12; index += 1) {
    applyRelicRunEvent(draft, { design }, 'battleEnd', { battleId: `battle-${index}`, victory: true, isFinal: false });
  }
  assert.equal(draft.relicCounters['pierce-altar'], 10);
  applyRelicRunEvent(draft, { design }, 'battleEnd', { battleId: 'battle-11', victory: true, isFinal: false });
  assert.equal(draft.relicCounters['pierce-altar'], 10);
  applyRelicRunEvent(draft, { design }, 'battleEnd', { battleId: 'failed', victory: false, isFinal: false });
  assert.equal(draft.relicCounters['pierce-altar'], 10);
});

test('hour snapshots are deterministic and capped from the actual hour-start gold', () => {
  const draft = state();
  applyRelicRunEvent(draft, { design }, 'hourStarted', { day: 2, hour: 1, gold: 39 });
  assert.deepEqual(draft.relicHourSnapshots['2:1'], { relicId: 'cross-chivalry', goldAtPreparation: 39, attackSpeedStacks: 6 });
  applyRelicRunEvent(draft, { design }, 'hourStarted', { day: 2, hour: 2, gold: 1000 });
  assert.equal(draft.relicHourSnapshots['2:2'].attackSpeedStacks, 6);
});

test('cloverfossil appends one real weighted reward option and consumes the queue marker once', () => {
  const available = design.collectibles.items.filter((item) => item.rarity !== 'starter' && item.unlockDay <= 8 && item.acquisition?.some((entry) => entry.type === 'reward' && entry.source === 'battle'));
  const draft = state(['cross-cloverfossil']);
  draft.rewardQueue = { kind: 'relic', source: 'battle', choices: available.slice(0, 3).map((item) => item.id) };
  const before = [...draft.rewardQueue.choices];
  assert.equal(applyRelicChoiceBonus(draft, { design }), true);
  assert.equal(draft.rewardQueue.choices.length, 4);
  assert.deepEqual(draft.rewardQueue.choices.slice(0, 3), before);
  assert.equal(applyRelicChoiceBonus(draft, { design }), false);
  assert.equal(draft.rewardQueue.choices.length, 4);
});

test('failed lifecycle events and unknown event types are no-ops/errors without reward mutation', () => {
  const draft = state();
  applyRelicRunEvent(draft, { design }, 'purchase', { success: false, acquisition: true, relicId: 'econ-oldcoins', source: 'relicAcquisition' });
  applyRelicRunEvent(draft, { design }, 'battleEnd', { success: false, victory: true, battleGoldDrop: 10, battleXp: 10 });
  assert.equal(draft.gold, 20);
  assert.equal(draft.life, 5);
  assert.throws(() => applyRelicRunEvent(draft, { design }, 'not-an-event', {}), /unknown assault relic run event/);
});
