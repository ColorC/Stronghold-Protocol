import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectionSkillDefinitions, projectCollectionSkills } from '../../public/js/assault/mechanicsView.js';

const design = {
  system: JSON.parse(readFileSync(new URL('../../data/assault-design/system.json', import.meta.url), 'utf8')),
  collectibles: JSON.parse(readFileSync(new URL('../../data/assault-design/collectibles.json', import.meta.url), 'utf8')),
};

test('72 collectibles and 10 ranked skills project to one unique legacy-compatible card layer', () => {
  const definitions = collectionSkillDefinitions({
    collectibles: design.collectibles.items,
    strategySkills: design.system.strategySkills,
  });
  assert.equal(definitions.length, 82);
  assert.equal(new Set(definitions.map((entry) => entry.id)).size, 82);
  assert.equal(definitions.filter((entry) => entry.kind === 'collectible').length, 72);
  assert.equal(definitions.filter((entry) => entry.kind === 'ranked-skill').length, 10);

  const legacyState = { relicIds: ['cold-frostsignal'], skillRanks: { strategy_arms: 2 } };
  const cards = projectCollectionSkills(design, legacyState);
  const relic = cards.find((entry) => entry.id === 'cold-frostsignal');
  const arms = cards.find((entry) => entry.id === 'strategy_arms');
  const catalyst = cards.find((entry) => entry.id === 'strategy_catalytic');
  assert.equal(relic.owned, true);
  assert.equal(relic.rank, null);
  assert.equal(relic.source.kind, 'acquisition');
  assert.equal(relic.iconSource.kind, 'collectible');
  assert.equal(arms.owned, true);
  assert.equal(arms.rank, 2);
  assert.match(arms.description, /20点生命上限/);
  assert.doesNotMatch(arms.description, /10\/20\/30\/40/);
  assert.equal(arms.source.kind, 'upgrade');
  assert.equal(arms.iconSource.kind, 'strategy-skill');
  assert.equal(catalyst.owned, false);
  assert.equal(catalyst.rank, 0);
  assert.equal(catalyst.description, '');
  assert.equal(cards.filter((entry) => entry.kind === 'collectible' && entry.rank !== null).length, 0);
  assert.deepEqual(legacyState, { relicIds: ['cold-frostsignal'], skillRanks: { strategy_arms: 2 } });
});

test('rank zero is unowned and invalid or unknown legacy ids fail explicitly', () => {
  const zero = projectCollectionSkills(design, { relicIds: [], skillRanks: { strategy_arms: 0 } });
  assert.equal(zero.find((entry) => entry.id === 'strategy_arms').owned, false);
  assert.throws(() => projectCollectionSkills(design, { relicIds: ['missing-relic'] }), /unknown collectible id/);
  assert.throws(() => projectCollectionSkills(design, { skillRanks: { missing_skill: 1 } }), /unknown strategy skill id/);
  assert.throws(() => projectCollectionSkills(design, { skillRanks: { strategy_arms: 5 } }), /invalid strategy skill rank/);
  assert.throws(() => projectCollectionSkills(design, { skillRanks: { strategy_arms: 0.5 } }), /invalid strategy skill rank/);
});

test('every owned strategy skill renders its current rank rather than the full rank progression', () => {
  for (const skill of design.system.strategySkills) {
    const rank = skill.startingStar ?? 1;
    const card = projectCollectionSkills(design, { skillRanks: { [skill.id]: rank } })
      .find((entry) => entry.id === skill.id);
    const progressionLength = 4 - rank + 1;
    const progression = new RegExp(`[+-]?\\d+(?:\\.\\d+)?%?(?:\\/[+-]?\\d+(?:\\.\\d+)?%?){${progressionLength - 1}}`);
    assert.equal(card.owned, true, skill.id);
    assert.doesNotMatch(card.description, progression, skill.id);
  }
});

test('duplicate ids across sources are rejected instead of applying one effect twice', () => {
  assert.throws(() => collectionSkillDefinitions({
    collectibles: [{ id: 'same', name: 'relic' }],
    strategySkills: [{ id: 'same', name: 'skill' }],
  }), /duplicate collection skill id/);
});
