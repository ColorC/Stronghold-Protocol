import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorMechanics, currentStarText } from '../../public/js/assault/mechanicsView.js';
import { adaptationCard } from '../../tools/assault/adaptation-authoring.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const rulesRoot = process.env.ASSAULT_RULES_ROOT || path.join(root, 'data');
const text = JSON.parse(fs.readFileSync(process.env.ASSAULT_PUBLIC_TEXT_PATH || path.join(rulesRoot, 'assault-public-text.json'), 'utf8'));
const source = read('data/assault-design/public-text.json');
test('current-star quantities preserve repeated and shared native units without interpreting fractions',()=>{
  assert.equal(currentStarText('晕眩5秒/5秒/6秒/6秒，补充1/2/3/4点技力。',2),'晕眩5秒，补充2点技力。');
  assert.equal(currentStarText('持续7/7/7/8秒，损失生命1/2。',4),'持续8秒，损失生命1/2。');
  assert.equal(currentStarText('防御-8/10/12/15%。',3),'防御-12%。');
});
const runtime = JSON.parse(fs.readFileSync(process.env.ASSAULT_RUNTIME_PATH || path.join(rulesRoot, 'assault-runtime.json'), 'utf8'));
const surtrPlan = read('data/assault-design/roster-assault.json').operators.find(item => item.charId === 'char_350_surtr');
const events = read('data/assault-design/events.json').events;

test('rewritten native talent bindings use the converted layer and preserve public values after a talent rename', () => {
  const catalog = { runtime, publicText: text };
  const utage = operatorMechanics(catalog, { charId: 'char_337_utage', star: 4 });
  assert.ok(utage.passives.some(p => /武者/.test(p.summary)));
  assert.match(utage.skill.summary, /斩击4次210%法伤/);
  const hbound = operatorMechanics(catalog, { charId: 'char_4232_hbound', star: 4 });
  assert.ok(hbound.original.talents.some(p=>/潜水作业|万物归酿/.test(p.name)));
  assert.match(hbound.skill.summary,/命中率−9%.*重敌.*−13%/);
  assert.equal(hbound.passives.filter(p=>/潜水作业/.test(p.summary)).length,1);
  const toledo = operatorMechanics(catalog, { charId: 'char_393_toledo', star: 4 });
  assert.ok(toledo.original.talents.some(p=>/贵族血统/.test(p.name)));
  assert.match(toledo.skill.summary,/脆弱16%.*施放后20秒翻倍/);
  const skadi = operatorMechanics(catalog, { charId: 'char_263_skadi', star: 4 });
  assert.ok(skadi.passives.some(p => /深海猎人干员攻击\+14%/.test(p.summary)));
});

// 灵知 / 初雪 / 凛御银灰 are synergy cards (design of 2026-10-21): the concise skill is the card's skill line at the current
// star (the old folded 「费用−5、原位再部署」 rules belonged to 凛御银灰's replaced kit)
test('a synergy card’s concise skill is its card skill line with the current star resolved', () => {
  const catalog = { runtime, publicText: text };
  for (const star of [1, 2, 3, 4]) {
    const royal = operatorMechanics(catalog, { charId: 'char_1045_svash2', star });
    assert.match(royal.skill.summary, /380%物伤.*最多存2次/);
    assert.doesNotMatch(royal.skill.summary, /\d+\/\d+/, 'no per-star slashes');
  }
});

test('Ember first-screen presentation resolves the authored star duration without interpreting fractions or replacing original text', () => {
  const catalog = { runtime, publicText: text };
  for (const star of [1, 2, 3, 4]) {
    const result = operatorMechanics(catalog, { charId: 'char_350_surtr', star });
    assert.match(result.skill.summary, /9秒后原地再部署/);
    assert.ok(result.passives.some(item => /无视目标20法术抗性/.test(item.summary)));
    assert.doesNotMatch(result.skill.summary, /按设计表|范围真伤/);
    assert(surtrPlan.stars[star - 1].passiveChange.includes(star === 4 ? '法抗20' : '法抗12'));
    assert.deepEqual(result.original.talents, text.operators.char_350_surtr.original.talents);
  }
  assert.equal(currentStarText('损失当前生命的1/2。', 4), '损失当前生命的1/2。');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
// The compiled card face (operators[].card, collectibles[].line) comes from the
// bazaar card sources and is checked in its own test below.
const modeText = { ...text, operators: Object.fromEntries(Object.entries(text.operators)
  .map(([id, { original, card, ...operator }]) => [id, operator])),
collectibles: Object.fromEntries(Object.entries(text.collectibles).map(([id, { line, ...item }]) => [id, item])) };

test('all 172 bodies show concise player-facing skill summaries at every star, including latest additions', () => {
  const internal = /token_|char_|enemy_|RNG|rangeGrid|damageSource|sourceTemplate|blockCnt|attackKind|原生|切比雪夫/;
  for (const charId of Object.keys(runtime.bodies)) for (const star of [1, 2, 3, 4]) {
    const mechanics = operatorMechanics({ runtime, publicText: text }, { charId, star });
    // a synergy card's (design of 2026-10-21) skill summary is its card's skill lines: check-bazaar-style keeps those short
    if (runtime.bodies[charId].bazaar?.format !== 'synergy') assert(mechanics.skill.summary.length <= 110, `${charId} star ${star}: ${mechanics.skill.summary.length} characters`);
    assert.doesNotMatch(text.operators[charId].skill.description, /\{[a-zA-Z_]+(?::[^}]*)?\}/, `${charId} numerical mode description`);
    assert.doesNotMatch(mechanics.skill.summary, /^下(?:一)?次攻击/, `${charId} immediate mode effect`);
    assert.doesNotMatch(mechanics.skill.summary, internal, `${charId} star ${star}`);
    for (const passive of mechanics.passives) assert.doesNotMatch(passive.summary, internal, `${charId}/${passive.name}`);
  }
  // 德·托莱多 is a synergy card (design of 2026-10-21): his skill summary is his card's skill line
  const toledo = operatorMechanics({ runtime, publicText: text }, { charId: 'char_393_toledo', star: 4 });
  assert.match(toledo.skill.summary, /征服者传说/);
  assert.match(toledo.skill.summary, /战栗7秒/);
  assert.ok(toledo.passives.some(p=>/存在20秒.*施放后20秒翻倍/.test(p.summary)));
});
const bad = /token_|char_|enemy_|ownerUid|JSONpointer|真实素材|按标准|按设计表|脱敏|证据|源场景|制作|实现|白板|测试|待固定|待无头|待修订|fixedSkill|effectHandling|epResistance|maxHP|status\/debuff|enemyID|assault_|absorbed|scaleBasis|perDevice|blockCnt|attackKind|track\/rarity|技能\.|沿用|延续|对应数值|后续调整|服务端|服务器|LIVE BATTLE/i;

function strings(value, at = '$') {
  if (typeof value === 'string') return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((x, i) => strings(x, `${at}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => strings(v, `${at}.${k}`));
  return [];
}

test('public text schema and complete source/output coverage', () => {
  assert.equal(source.schema, 'assault-public-text-source/v1');
  assert.equal(text.schema, 'assault-public-text/v1');
  assert.equal(Object.keys(text.operators).length, Object.keys(runtime.bodies).length);
  assert.equal(Object.keys(text.operators).length, 172);
  assert.equal(Object.keys(text.collectibles).length, 72);
  assert.deepEqual(Object.keys(text.events).sort(), events.map(event => event.id).sort());
  for (const event of events) assert.deepEqual(Object.keys(text.events[event.id].choices).sort(),
    event.choices.map(choice => choice.id).sort(), `${event.id} covers every real choice`);
  assert.equal(Object.keys(text.encounters).length, 36);
  assert.equal(Object.keys(text.directors).length, 3);
  assert.equal(Object.values(text.operators).reduce((n, o) => n + o.talents.length, 0),
    Object.values(runtime.bodies).reduce((n, body) => n + (body.adaptation ? 0 : body.source?.talents?.length || 0), 0));
  assert.equal(Object.values(text.operators).reduce((n, o) => n + Object.keys(o.modules).length, 0),
    Object.values(runtime.bodies).reduce((n, body) => n + (body.modulePlans?.length || 0), 0));
});

test('latest native operators have complete player-facing skills, talents, passives, and module entries', () => {
  // 德·托莱多 / 旅骨 / 克莱门莎 are synergy cards (design of 2026-10-21): their skill text is their card's skill line
  const toledo = text.operators.char_393_toledo;
  assert.match(toledo.skill.description, /征服者传说/);
  assert.match(toledo.skill.description, /施放后20秒翻倍/);
  assert.equal(runtime.bodies.char_393_toledo.adaptation.values.seconds,20);
  const hbound = text.operators.char_4232_hbound;
  assert.equal(hbound.skill.name,'座浅');
  assert.match(hbound.skill.description,/35轮20%法伤.*重敌.*180%/);
  const clement = text.operators.char_4231_clemnt;
  assert.equal(clement.skill.name,'与海为敌');
  assert.ok(clement.innates.some(p=>/共享本场10发弹药/.test(p)));

  const ulpia = text.operators.char_4145_ulpia;
  const frontier=Object.values(ulpia.modules).find(m=>m.name==='“前路”');
  assert.ok(frontier);assert.match(frontier.description,/血脉.*160.*深海队友半效/);
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('visible strings are natural text without internal identifiers or process wording', () => {
  for (const [at, value] of strings(modeText)) {
    if (at.endsWith('.schema')) continue;
    assert.ok(value.trim().length >= 1, `${at} is empty`);
    // native proper names are taken out first (tools/assault/build-public-text.mjs NATIVE_PROPER_NAMES)
    assert.equal(bad.test(['起泡性能测试'].reduce((out, name) => out.replaceAll(name, ''), value)), false, `${at} contains forbidden wording: ${value}`);
  }
});

test('generated public text is a faithful truth copy and preserves named rule facts', () => {
  for(const [id,body] of Object.entries(runtime.bodies))if(!body.adaptation)assert.deepEqual(modeText.operators[id],source.operators[id],id);
  const angel = text.operators.char_1041_angel2;
  // 新约能天使 is a synergy card (design of 2026-10-21): her skill text is her card's skill lines
  assert.match(angel.skill.description, /160%物伤/);
  assert.match(angel.skill.description, /投送1名近战并充能6/);
  assert.match(text.operators.char_4064_mlynar.skill.description,/卡西米尔.*反弹/);
  const ling = text.operators.char_2023_ling;
  // 令 is a synergy card (design of 2026-10-21): her skill text is her card's skill lines
  assert.equal(ling.skill.name,'笑鸣瑟');
  assert.match(ling.skill.description, /束缚/);
  assert.match([ling.skill.description,...(ling.innates??[])].join(''), /回收半血以下的?召唤物/);
  assert.doesNotMatch(`${ling.role} ${ling.skill.description} ${Object.values(ling.modules).map(m => m.description).join(' ')}`, /合并|大龙/);
  assert.doesNotMatch(ling.skill.description, /assault_|sourceTemplate|derivedTemplate/);
  assert.match(text.operators.char_4072_ironmn.skill.description, /补1个装置/);
  assert.match(text.operators.char_4072_ironmn.skill.description, /攻击所有阻挡敌人/);
  // (白铁 is a synergy card now: its skill text is the design table's — synergy-ranged-7.test.mjs)
  for (const id of ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3']) {
    assert.ok(text.operators[id].skill.description.length > 20, `${id} skill`);
  }
  const eventDescriptions = Object.values(text.events).flatMap((event) => Object.values(event.choices).map((choice) => choice.description));
  assert.ok(eventDescriptions.some((description) => /第一次自然入场.*部署点数费用/.test(description)));
  assert.ok(eventDescriptions.some((description) => /护盾.*百分比|最大生命\d+%.*护盾/.test(description)));
});

test('the original-game tab retains official names and resolved descriptions separately from mode text', () => {
  for (const [id, body] of Object.entries(runtime.bodies)) {
    const original = text.operators[id].original;
    assert.ok(original, `${id} has original-game details`);
    assert.equal(original.skills.length, body.source.skills.length);
    assert.deepEqual(original.talents.map(talent => talent.name), body.source.talents
      .filter(talent => !talent.hidden && talent.name && !/空槽位/.test(talent.name))
      .map(talent => talent.name));
    for (const [at, value] of strings(original)) {
      assert.equal(/char_|token_|enemy_|ownerUid|JSONpointer|assault_/i.test(value), false, `${id}/${at}`);
      assert.doesNotMatch(value, /\{[^{}]+\}/, `${id}/${at} has resolved official values`);
    }
  }
  assert.ok(text.operators.char_446_aroma.original.talents.some(talent => talent.name === '起泡性能测试'));
});

test('bazaar card face is compiled from the card sources at every star and matches the real skill cost', async () => {
  const { checkBazaarStyle } = await import('../../tools/assault/check-bazaar-style.mjs');
  const sources = ['assault', 'ranged', 'support'].map((family) => read(`data/assault-design/bazaar-cards-${family}.json`));
  const collectibleSources = read('data/assault-design/bazaar-collectibles.json');
  const result = checkBazaarStyle({ publicText: text, runtime, sources, collectibleSources });
  assert.deepEqual(result.errors, []);
  assert.equal(result.operators, Object.keys(runtime.bodies).length);
  assert.ok(result.ratio >= 0.5, `native roles and focused synergies: ${result.ratio}`);
  const byId = new Map(sources.flatMap((source) => source.operators).map((card) => [card.id, card]));
  for (const [id, operator] of Object.entries(text.operators)) {
    const card = adaptationCard(runtime.bodies[id],byId.get(id));
    operator.card.lines.forEach((line, index) => {
      for (let star = 0; star < 4; star++) {
        const expected = card.lines[index].suppressed?'':card.lines[index].template.replace(/\{(\w+)\}/g, (_, key) => String(card.lines[index].params[key][star]));
        assert.equal(line.textByStar[star], expected, `${id} line ${index} star ${star + 1}`);
      }
    });
    if (runtime.bodies[id].fixedSkill.kind !== 'passive') assert.deepEqual(operator.card.sp, runtime.bodies[id].fixedSkill.spCosts, `${id} sp`);
    const synergy = runtime.bodies[id]?.bazaar?.format === 'synergy';
    assert.ok(operator.card.lines.length >= 1 && operator.card.lines.length <= (synergy ? 12 : 3), `${id} lines`);
  }
  for (const item of collectibleSources.collectibles) assert.equal(text.collectibles[item.id].line, item.text, item.id);
  const vanilla = text.operators.char_240_wyvern.card;
  assert.match(vanilla.lines[0].textByStar[0],/获得6费用.*连击6次135%物伤/);
  assert.match(vanilla.lines[1].textByStar[0],/每累计获得8费用.*多斩1轮/);
  assert.doesNotMatch(vanilla.lines[1].textByStar[0], /永久/);
});
