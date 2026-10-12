import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { resonanceCatalogPacket } from '../../server/modes/resonance/native-match.js';
import { STAR3_TALENT_INDEX, starThreePassive } from '../../shared/resonance/operator-adaptations.js';
import { talentLockLabel } from '../../public/js/ui/talentLock.js';
import { chessLoadout } from '../../public/js/ui/gameLogic/loadout.js';

const NATIVE_DATA = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const data = loadData(NATIVE_DATA);
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: 'resonance-factions-2', seed: 5 });
const nativeChessId = (id, star) => (star === 1 ? id : `resonance_${id}_star${star}`);
const packet = resonanceCatalogPacket({ data, catalog, displayCatalog: catalog, nativeChessId });
const MLYNAR = 'chess_char_5_19_a';   // 玛恩纳 (not 缪尔赛思, chess_char_6_11_a)
const JNIGHT = 'chess_native_char_4000_jnight_a';
const card = (id, star) => packet.data.chess[nativeChessId(id, star)];
const playerSkill = (id, star) => catalog.playerText.operators[id]?.stars?.[star]?.skillDescription;
/** What the detail card prints as the skill: chessLoadout's chosen skill, `descRaw || desc` (public/js/ui/detailPanel.js). */
const shownSkill = (record) => { const sk = chessLoadout(record, null, (id) => packet.data.chess[id]).skill; return sk?.descRaw || sk?.desc; };

test('the card of a two- or three-star operator prints that star\'s skill numbers, not the one-star wording', () => {
  assert.match(shownSkill(card(MLYNAR, 1)), /125%攻击力/);
  assert.match(shownSkill(card(MLYNAR, 2)), /150%攻击力/);
  assert.match(shownSkill(card(MLYNAR, 3)), /313%攻击力/, '玛恩纳 at three stars does 313%, the card used to say 125%');
  assert.match(shownSkill(card(MLYNAR, 3)), /25%攻击力的真实伤害/);
  for (const star of [1, 2, 3]) assert.equal(shownSkill(card(MLYNAR, star)), playerSkill(MLYNAR, star), `${star}★ is the player text, no second calculation`);
});

test('every operator\'s card skill is the player text of its star; one without player text keeps the native wording', () => {
  let changed = 0, kept = 0;
  for (const id of catalog.config.activeOperatorIds) {
    const operator = catalog.operators[id];
    for (const star of [1, 2, 3]) {
      const record = card(id, star), own = operator.stars[star].record.skill, text = playerSkill(id, star);
      if (!record?.skill) { assert.ok(own == null, `${id} ${star}★ has no skill to show`); continue; }
      if (typeof text === 'string' && text) {
        assert.equal(record.skill.desc, text, `${id} ${star}★ desc`); assert.equal(record.skill.descRaw, text, `${id} ${star}★ descRaw`);
        assert.equal(shownSkill(record), text, `${id} ${star}★ shown`);
        if (text !== own.desc) changed++;
      } else { assert.equal(record.skill.desc, own.desc); kept++; }
      assert.equal(record.skill.skillId, own.skillId, 'only the text changes');
    }
  }
  assert.ok(changed >= 40, `${changed} star cards read the scaled numbers`);
  assert.equal(kept, 0, 'every operator with a skill has player text in this season');
});

test('the card shows the skill the operator fights with, also for 令 and 贾维 whose native default is another skill', () => {
  for (const id of catalog.config.activeOperatorIds) {
    for (const star of [1, 2, 3]) {
      const record = card(id, star);
      if (!record.skill) continue;
      const lo = chessLoadout(record, null, (x) => packet.data.chess[x]);
      assert.equal(lo.skill.skillId, catalog.operators[id].fixedSkillId, `${catalog.operators[id].name} ${star}★ card skill`);
      assert.equal(lo.skill.index, record.skill.index);
    }
  }
  assert.match(shownSkill(card('chess_native_char_2023_ling_a', 1)), /^被动：召唤物可部署在近战位且攻击范围内存在其他召唤物时与其合并为高级形态/, '令 card text is its fixed third skill');
});

test('the other skills of the record and the catalog itself are left alone', () => {
  const record = card(MLYNAR, 3), chosen = record.skill.index;
  const own = catalog.operators[MLYNAR].stars[3].record;
  assert.equal(record.skills.length, own.skills.length);
  record.skills.forEach((skill, index) => {
    if (skill.index === chosen) assert.equal(skill.desc, playerSkill(MLYNAR, 3));
    else assert.equal(skill.desc, own.skills[index].desc, `skill ${skill.skillId} keeps its text`);
  });
  assert.match(own.skill.desc, /125%攻击力/, 'the catalog record keeps the native wording the battle reads');
});

test('正义骑士号 has no skill text to scale: its card is unchanged and lists no 升星特性', () => {
  for (const star of [1, 2, 3]) {
    const record = card(JNIGHT, star);
    assert.equal(record.skill, null);
    assert.equal(record.talents.some((talent) => talent.resonancePassive), false);
    assert.equal(playerSkill(JNIGHT, star) ?? null, null);
  }
  assert.equal(starThreePassive(catalog.operators[JNIGHT]), null, 'its 被动支援 is there from one star');
});

test('every operator with a three-star passive lists 升星特性 at every star, once, with the passive\'s text', () => {
  let listed = 0;
  for (const id of catalog.config.activeOperatorIds) {
    const operator = catalog.operators[id], passive = starThreePassive(operator);
    for (const star of [1, 2, 3]) {
      const rows = (card(id, star).talents ?? []).filter((talent) => talent.name === '升星特性');
      if (!passive) { assert.equal(rows.length, 0, `${operator.name} ${star}★ has no three-star passive`); continue; }
      assert.equal(rows.length, 1, `${operator.name} ${star}★ lists it once`);
      assert.equal(rows[0].index, STAR3_TALENT_INDEX);
      assert.equal(rows[0].desc, passive.description); assert.equal(rows[0].descRaw, passive.description);
      assert.equal(rows[0].unlockStar, 3); assert.equal(rows[0].hidden, false);
    }
    if (passive) listed++;
  }
  const withPassive = catalog.config.activeOperatorIds.filter((id) => catalog.operators[id].stars[3].passive?.kind !== 'none' && id !== JNIGHT);
  assert.equal(listed, withPassive.length, 'all of them, not only the adapted ones');
  assert.ok(listed >= 50, `${listed} operators list it`);
});

test('an operator that never adapted lists it too: 送葬人 shows its 三星 passive on every star card', () => {
  const id = 'chess_char_2_01_a', passive = catalog.operators[id].stars[3].passive;
  assert.equal(catalog.operators[id].adaptation, undefined, 'not an adapted operator');
  assert.ok(passive.description);
  for (const star of [1, 2, 3]) {
    const names = chessLoadout(card(id, star), null, (x) => packet.data.chess[x]).record.talents.map((talent) => talent.name);
    assert.ok(names.includes('升星特性'), `${star}★ card talents: ${names}`);
  }
});

test('an adapted operator\'s own star-three row is not listed twice', () => {
  const rows = card(MLYNAR, 3).talents.filter((talent) => talent.index === STAR3_TALENT_INDEX);
  assert.equal(rows.length, 1);
  assert.match(rows[0].desc, /未照耀的荣光/);
  assert.equal(catalog.operators[MLYNAR].stars[1].record.talents.some((talent) => talent.index === STAR3_TALENT_INDEX), false, 'the catalog record itself is untouched');
});

test('the star-three row is marked locked below three stars and nowhere else', () => {
  const row = card(MLYNAR, 1).talents.find((talent) => talent.index === STAR3_TALENT_INDEX);
  assert.equal(talentLockLabel(row, card(MLYNAR, 1).resonanceStar), '三星时获得');
  assert.equal(talentLockLabel(row, card(MLYNAR, 2).resonanceStar), '三星时获得');
  assert.equal(talentLockLabel(row, card(MLYNAR, 3).resonanceStar), '', 'at three stars it is just a talent');
  const ordinary = card(MLYNAR, 1).talents.find((talent) => talent.name === '游侠');
  assert.equal(talentLockLabel(ordinary, 1), '', 'an ordinary talent is never marked');
  assert.equal(talentLockLabel(row, undefined), '三星时获得', 'a card without a star counts as one star');
  assert.equal(talentLockLabel(null, 1), '');
});

test('the detail card reads the lock label and the combat HUD can hide the cost counter', () => {
  const panel = readFileSync(new URL('../../public/js/ui/detailPanel.js', import.meta.url), 'utf8');
  assert.match(panel, /talentLockLabel\(t, c\?\.resonanceStar\)/);
  assert.match(panel, /is-locked/);
  const hud = readFileSync(new URL('../../public/js/ui/combatHud.js', import.meta.url), 'utf8');
  assert.equal((hud.match(/showDp \? html`<\$\{DpCounter\}/g) ?? []).length, 2, 'both HUD variants (own and client combat) honour showDp');
  assert.match(hud, /showDp = true/, 'the original mode keeps the counter by default');
  const resonance = readFileSync(new URL('../../public/js/resonance/native-match-screen.js', import.meta.url), 'utf8');
  assert.match(resonance, /<\$\{CombatHud\}[^]*?showDp=\$\{false\}/, 'the resonance match hides it');
  const original = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.doesNotMatch(original, /showDp/, 'the 13000 mode is untouched');
});
