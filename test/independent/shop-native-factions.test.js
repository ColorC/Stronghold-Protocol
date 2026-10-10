import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { independentDisplayCatalog } from '../../server/modes/independent/display.js';
import { operatorDisplayFactions } from '../../shared/independentFactionDisplay.js';
import { darkmoonCombatEligibilityRules, DARKMOON_COMBAT_RULES } from '../../server/sim/content/independent/darkmoonCombat.js';

const raw = getCatalog(), display = independentDisplayCatalog(getData(), raw);
const active = Object.values(raw.operators).filter(op => op.recruitable);

test('every recruitable ordinary and elite shop card exposes its full native factions', () => {
  assert.ok(active.length > 100);
  for (const op of active) {
    assert.ok(op.nativeFactionTags?.length, op.name);
    assert.deepEqual(operatorDisplayFactions(display.operators[op.chessId], op.source.normalChess), op.nativeFactionTags, op.chessId);
    assert.deepEqual(operatorDisplayFactions(display.operators[op.eliteChessId], op.source.eliteChess), op.nativeFactionTags, op.chessId + ' elite');
  }
  for (const name of ['九色鹿', '酸糖', '杰西卡', '刺玫']) {
    const op = active.find(op => op.name === name); assert.ok(op, name);
    assert.ok(operatorDisplayFactions(display.operators[op.chessId]).length, name);
  }
});

test('native catalog tags take priority over old tavern bonds and preserve organization labels', () => {
  assert.deepEqual(operatorDisplayFactions({ nativeFactions: ['哥伦比亚', '黑钢国际'] }, { bonds: ['siracusaShip'] }), ['哥伦比亚', '黑钢国际']);
  assert.deepEqual(operatorDisplayFactions(null, { bonds: ['egirShip'] }), ['阿戈尔']);
});

test('Gladiia and Chiave exchange complete tier-three workshop sources while retaining native identities', () => {
  const gladiia = raw.operators.chess_char_4_12_a, chiave = raw.operators.chess_native_char_349_chiave_a;
  assert.deepEqual(gladiia.nativeFactionTags, ['阿戈尔', '深海猎人']);
  assert.deepEqual(chiave.nativeFactionTags, ['叙拉古', '贾维团伙']);
  assert.equal(gladiia.sourceRefs.darkmoon19_2.id, 'BGS_078');
  assert.equal(chiave.sourceRefs.darkmoon19_2.id, 'DS1_070');
  assert.equal(gladiia.tier, 3); assert.equal(chiave.tier, 3);
  assert.equal(DARKMOON_COMBAT_RULES.BGS_078.echo, true);
  assert.ok(darkmoonCombatEligibilityRules('BGS_078').every(rule => !rule.params.match.faction));
  for (const op of [gladiia, chiave]) {
    const elite = raw.operators[op.eliteChessId];
    assert.equal(elite.sourceRefs.darkmoon19_2.id, op.sourceRefs.darkmoon19_2.id);
    const card = op.sourceRefs.cards[0]; assert.equal(card.attack, 4); assert.equal(card.health, 3);
    assert.equal(card.goldenAttack, 8); assert.equal(card.goldenHealth, 6);
    const text = display.operators[op.chessId].traitTexts;
    assert.equal(text.normal, op.nativeTrait.normalText); assert.equal(text.elite, op.nativeTrait.eliteText);
  }
  assert.doesNotMatch(display.operators.chess_char_4_12_a.traitTexts.normal, /叙拉古/);
  assert.match(display.operators.chess_char_4_12_a.traitTexts.normal, /8次普通攻击/);
  const growth = chiave.nativeTrait.effect.prep[0];
  assert.equal(growth.behavior, 'darkmoonBattlecryTargetGrowth');
  assert.equal(growth.params.faction, '叙拉古');
  const angelina = raw.operators.chess_char_5_20_a;
  assert.equal(angelina.sourceRefs.darkmoon19_2.id, 'BGS_104');
  assert.ok(angelina.nativeFactionTags.includes('叙拉古'));
});
