import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTable } from '../../tools/independent-concentrated-table.mjs';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.resolve(process.env.SP_DATA_DIR || path.join(ROOT, 'data'));
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
const design = read('independent-design.json');
const gameText = read('independent-game-text.json');
const chessData = read('chess.json');
const sourceReference = read('independent-source-reference.json');
const nativePower = read('independent-native-power.json');
const catalog = getCatalog();
const table = buildTable({ design, gameText, chessData, catalog, sourceReference, nativePower });
const bySection = (name) => table.rows.filter((row) => row.section === name);

test('concentrated table cites source rules, default-only native skills, 90-second totals and per-card tier evidence', () => {
  assert.equal(table.columns.length, 15);
  assert.equal(bySection('干员').length, 101);
  assert.equal(bySection('七人阵容').length, 5);
  assert.ok(table.rows.filter((row) => row.section !== '敌人').every((row) => row.reference && row.reference !== '原卡来源待补'));
  assert.ok(bySection('干员').every((row) => row.nativePower.includes('实跑90秒') && row.nativePower.includes('普通：总伤') && row.nativePower.includes('进阶：总伤') && row.nativePower.includes('治疗量') && row.nativePower.includes('伤害类型') && row.nativePower.includes('控制、保护、阻挡和经济价值') && row.sourceNormal && row.sourceElite && row.levels && row.landing && row.normal && row.upgrade));
  assert.ok(table.rows.every((row) => !/(?:chess_(?:char|item)_|skchr_|independent:|token_\d+_|single_0_0|single_800_40|four_0_0|[0-9a-f]{40})/i.test(Object.values(row).join(' '))));

  const matterhorn = bySection('干员').find((row) => row.name === '白铁');
  const matterhornOp=design.operators.find((op) => op.name === '白铁');
  const native = chessData[matterhornOp.chessId];
  const selectable=new Set(native.nativeImport?.selectableSkillIds||[]);
  for (const skill of native.skills.filter(s=>selectable.has(s.skillId))) assert.ok(matterhorn.native.includes(String(skill.desc).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()));
  for (const talent of native.talents) assert.ok(matterhorn.native.includes(String(talent.desc).replace(/<[^>]*>/g,'')));

  const overrides=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'independent-roster-plan.json'),'utf8')).tierOverrides;
  for(const op of design.operators.filter(o=>o.active!==false)){
    const e=op.allocationEvidence, row=bySection('干员').find(x=>x.name===op.name);
    assert.ok(e,`${op.name} has source-specific allocation evidence`);
    assert.equal(e.source.name,op.sourceRefs.cards[0].name);
    assert.equal(e.source.tier,op.sourceRefs.cards[0].tier);
    assert.equal(e.probe.seconds,90);
    assert.deepEqual(e.probe.forms.map(x=>x.form),['普通','进阶']);
    assert.ok(e.workshop.normal.length&&e.workshop.elite.length,`${op.name} normal/elite rule mechanics`);
    assert.ok(e.workshop.normal.every(x=>x.trigger&&x.recipient&&x.duration&&x.rule),`${op.name} normal trigger/target/scope/rule`);
    assert.ok(e.workshop.elite.every(x=>x.trigger&&x.recipient&&x.duration&&x.rule),`${op.name} elite trigger/target/scope/rule`);
    const normalizeRule=x=>String(x.text||x.adaptation||x.kind).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    assert.deepEqual(e.workshop.normal.map(x=>x.rule),op.effectDelivery.normal.map(normalizeRule),`${op.name} normal rule evidence is copied from current mechanics`);
    assert.deepEqual(e.workshop.elite.map(x=>x.rule),op.effectDelivery.elite.map(normalizeRule),`${op.name} elite rule evidence is copied from current mechanics`);
    assert.ok(!row.basis.includes('按原卡科技与功能安排'),`${op.name} has a specific tier rationale`);
    const override=overrides[op.name];
    if(override) assert.equal(row.basis,override.reason,`${op.name} manual tier rationale remains intact`);
    else assert.ok(row.basis.includes(e.source.name),`${op.name} rationale names its source card`);
    const measured=nativePower.operators.find(x=>x.name===op.name);
    assert.ok(measured,`${op.name} has a measured native probe`);
    assert.deepEqual(e.probe.forms.map(({form,damage,dps,healing,attacks,skillActivations,deaths,summons})=>({form,damage,dps,healing,attacks,skillActivations,deaths,summons})),
      measured.forms.map(f=>({form:f.elite?'进阶':'普通',damage:f.damage,dps:f.dps,healing:f.healing,attacks:f.attacks,skillActivations:f.skillActivations,deaths:f.deaths,summons:f.summons})),
      `${op.name} evidence is copied from the current measured input`);
    const body=chessData[op.chessId];
    assert.equal(e.nativeBody.damageType,({phys:'物理',arts:'法术',true:'真实',heal:'治疗'})[body.dmgType]||body.dmgType||'未标记');
    assert.equal(e.nativeBody.defaultSkill,body.skill?.name||'无主动技能');
    assert.ok(row.nativePower.includes(String(measured.forms[0].damage))&&row.nativePower.includes(String(measured.forms[1].healing)),`${op.name} table shows measured total damage and healing`);
  }
  for(const [name,override] of Object.entries(overrides)) assert.equal(design.operators.find(o=>o.name===name).tierReason,override.reason,`${name} manual tier review remains intact`);
  const promoted=Object.keys(overrides).filter(name=>design.operators.find(o=>o.name===name).tier>design.operators.find(o=>o.name===name).sourceRefs.cards[0].tier);
  assert.deepEqual(promoted.sort(),['号角','松果','普罗旺斯','隐德来希'].sort(),
    'the three combat-risk promotions and Provence’s separately stated growth-tier adjustment remain manual');

  const warbands = bySection('七人阵容');
  for (const row of warbands) {
    const archetype = sourceReference.archetypes.find((item) => item.name === row.name);
    assert.ok(archetype);
    assert.equal(archetype.operators.length, 7);
    for (const member of archetype.operators) assert.ok(row.native.includes(member));
    assert.ok(row.basis.includes(archetype.chain));
    assert.ok(row.reference.includes('；'));
  }
  const victoria = warbands.find((row) => row.name === '炎国商店与招募成长');
  assert.ok(victoria.native.includes('安洁莉娜（科技5；中立成员'));
  assert.ok(victoria.basis.includes('中立成员（阵营按本体资料）：安洁莉娜'));
});

test('new games show only the two active auto-issued handover permits', () => {
  const permits = bySection('交接凭证');
  assert.equal(catalog.config.rareInheritanceOperators, permits.length);
  assert.ok(!bySection('徽章').some(row => row.name === '普通攻击徽章'));
  assert.equal(catalog.config.basicBadgeCount, bySection('徽章').length);
  const training = bySection('工程部特供').find(row => row.name === '专项战备授训');
  assert.equal(training.normal, catalog.prizes['special-readiness-training'].effect);
  assert.match(training.normal, /直接/);
  assert.deepEqual(permits.map((row) => [row.name, row.level]).sort(), [
    ['医疗装置交接单', '科技3'], ['重装器械适配单', '科技4'],
  ]);
  assert.ok(permits.every((row) => row.normal.includes('交出方或接收方') && row.upgrade.includes('无需凭证')));
  const wolf = table.rows.find((row) => row.name === '叙拉古狼嚎哨');
  assert.match(wolf.basis, /12次普通攻击.*0\.75秒.*8秒/);
  const melt = table.rows.find((row) => row.name === '便携式融毁教学仪');
  const airdrop = table.rows.find((row) => row.name === '反冲空降仓');
  assert.match(melt.basis, /六本装备/);
  assert.match(airdrop.basis, /六本装备/);
});

test('current table omits retired and unassigned equipment while keeping catalog-eligible legacy flags', () => {
  const equipmentRows = [...bySection('装备'), ...bySection('特供装备')];
  for (const row of equipmentRows) {
    const item = catalog.equipment[row.name] || Object.values(catalog.equipment).find((entry) => (entry.newName || entry.name) === row.name);
    assert.ok(item, `missing catalog item for ${row.name}`);
    assert.notEqual(item.retired, true, `${row.name} is retired`);
    assert.notEqual(item.unassigned, true, `${row.name} is unassigned`);
  }
  for (const name of ['调和识别牌', '源石促效溶剂', '应急伪装服', '催泪瓦斯组件', '谢拉格不融冰', '维多利亚蒸汽之心', '耶拉冈德之泪', '熔铸模具', '莱茵生命浮空发生器', '黑钢双联弹匣']) {
    assert.ok(!equipmentRows.some((row) => row.name === name), `${name} must not be a current issuance row`);
  }
});
