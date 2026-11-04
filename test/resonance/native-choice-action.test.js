import test from 'node:test';
import assert from 'node:assert/strict';
import { resonanceChoiceAction } from '../../public/js/resonance/choiceAction.js';

test('native Resonance choice confirms send session choice identity, selected options and selected strategy targets', () => {
  const reward = { uid: 'choice-8', type: 'components', remaining: 2, options: ['part-a', 'part-b', 'part-c'] };
  assert.deepEqual(resonanceChoiceAction(reward, ['part-a', 'part-c']), {
    type: 'claimReward', choiceUid: 'choice-8', optionIds: ['part-a', 'part-c'],
  });
  const strategy = { uid: 'choice-9', type: 'strategy', remaining: 1, options: ['pair-guard'] };
  assert.deepEqual(resonanceChoiceAction(strategy, ['pair-guard'], { 'pair-guard': 'piece-a|piece-b' }), {
    type: 'chooseStrategy', choiceUid: 'choice-9', strategyId: 'pair-guard', targets: { pieceUids: ['piece-a', 'piece-b'] },
  });
  assert.equal(resonanceChoiceAction(reward, ['part-a']), null, 'incomplete multi-pick cannot be submitted');
  assert.equal(resonanceChoiceAction(reward, ['forged-option', 'part-b']), null, 'an option not in the server choice is rejected');
});
