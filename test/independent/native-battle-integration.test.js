import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { DataSource } from '../../server/sim/simdata.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const DATA = getData();
const CATALOG = getCatalog(DATA);
const RECEIPTS = [];
const HEALERS = ['古米', '瑰盐', '赫默', '华法琳', '刺玫', '纯烬艾雅法拉'];
const HEAL_EQUIPMENT = 'independent:医疗部共生血囊';
const SHIELD_EQUIPMENT = 'independent:护盾发生器';

function operatorNamed(name) {
  const result = Object.values(CATALOG.operators).find((op) => op.name === name && !op.elite);
  assert.ok(result, `canonical catalog includes ${name}`);
  return result;
}

function makeIntegrationBattle({ pieces, units, timeLimit = 5, setup = undefined }) {
  const data = new DataSource({
    chess: {
      patient: chessRec({ id: 'patient', profession: 'TANK', skill: null, rangeGrid: [[0, 0]], stats: {
        maxHp: 1_000_000, atk: 0, def: 0, res: 0, aspd: 100, spRecovery: 0, hpRecoveryPerSec: 0,
      } }),
    },
    enemies: { probe: enemyRec({ key: 'probe', hp: 1_000_000_000, atk: 100, def: 0, res: 0, range: 3, aspd: 100, bat: 1, speed: 0 }) },
  }, new DataSource(DATA));
  return makeBattle({
    data,
    units,
    enemies: [{ key: 'probe', pos: [10, 7] }],
    autoFinish: false,
    content: 'full',
    timeLimit,
    setup,
    extraContent: [(battle) => installIndependentBattle(battle, { catalog: CATALOG, state: { pieces } })],
  });
}

function recordOutput() {
  const target = process.env.SP_NATIVE_INTEGRATION_RESULT_PATH;
  if (!target) return;
  const fullPath = path.resolve(target);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify({ rosterCount: CATALOG.config.activeRosterIds?.length ?? null, receipts: RECEIPTS }, null, 2), 'utf8');
}
after(recordOutput);

test('空弦 and 泥岩 keep their native one-layer shield beside 2-piece equipment and use real layer events', () => {
  for (const name of ['空弦', '泥岩']) {
    for (const elite of [false, true]) {
      const source = operatorNamed(name);
      const chessId = elite ? source.eliteChessId : source.chessId;
      const uid = `shield-${name}-${elite ? 'elite' : 'normal'}`;
      const piece = { uid, chessId, row: 10, col: 5, equipment: [{ id: SHIELD_EQUIPMENT, quantity: 2 }], attachments: [], nativeState: {} };
      const h = makeIntegrationBattle({ pieces: [piece], units: [{ uid, chessId, row: 10, col: 5 }] });
      const gained = [];
      const broken = [];
      const thresholds = [];
      h.b.on('shieldLayersGained', (event) => { if (event.unit?.uid === uid) gained.push({ key: event.buff?.key, layers: event.layers }); });
      h.b.on('shieldLayersBroken', (event) => { if (event.unit?.uid === uid) broken.push({ key: event.buff?.key, layers: event.layers }); });
      h.b.on('shieldLayersThreshold', (event) => { if (event.unit?.uid === uid) thresholds.push(event); });
      h.step(1);
      const unit = h.unit(uid);
      assert.ok(unit, `${chessId} was built from its canonical chess record and KITS`);
      const equipmentBuffKey = `independent:keywordGear:shield-generator:${uid}:layers`;
      const shieldBuffs = unit.buffs.filter((buff) => Number(buff.shieldHits) > 0);
      const equipmentBuff = shieldBuffs.find((buff) => buff.key === equipmentBuffKey);
      const nativeBuffs = shieldBuffs.filter((buff) => buff.key !== equipmentBuffKey);
      assert.equal(equipmentBuff?.shieldHits, 8, `${name} ${elite ? 'elite' : 'normal'} received the real 2-piece deploy shield`);
      assert.equal(nativeBuffs.reduce((n, buff) => n + Number(buff.shieldHits), 0), 1, `${name} retains its native KITS shield`);
      assert.equal(shieldBuffs.reduce((n, buff) => n + Number(buff.shieldHits), 0), 9);
      assert.ok(gained.some((event) => event.key === equipmentBuffKey && event.layers === 8));
      assert.ok(gained.some((event) => event.key !== equipmentBuffKey && event.layers === 1));

      const attacker = h.b.enemies.find((enemy) => enemy.defId === 'enemy_probe') ?? h.spawn('probe', { pos: [10, 7] });
      for (let i = 0; i < 5; i++) h.b.dealDamage(attacker, unit, { amount: 1000, type: 'true', canDodge: false });
      assert.equal(broken.reduce((n, event) => n + event.layers, 0), 5, 'damage consumed five real shield layers');
      assert.equal(thresholds.length, 1, 'the equipment threshold fires once after five broken layers');
      assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
      const rewards = h.b.independentRewards ?? [];
      const expectedRule = CATALOG.operators[chessId].nativeTrait.effect.combat.find((rule) => rule.trigger === 'shieldLayersBroken' && rule.behavior === 'eventProduction');
      if (name === '泥岩') {
        assert.ok(expectedRule, 'Mudrock has the authored native layer-growth rule');
        const wanted = expectedRule.params.outputs[0];
        const expectedQty = Math.min(expectedRule.params.maxPerBattle, wanted.quantity);
        assert.equal(rewards.filter((reward) => reward.origin === 'native' && reward.sourceUid === uid && reward.id === wanted.id).reduce((n, reward) => n + reward.quantity, 0), expectedQty,
          'five broken layers make the authored native reward once, rather than one reward per layer');
      }
      RECEIPTS.push({ kind: 'shield', name, form: elite ? 'elite' : 'normal', chessId, nativeLayers: 1, equipmentLayers: 8,
        gained, broken, thresholdCount: thresholds.length, rewardCount: rewards.length, battleErrors: h.b.errorCount });
    }
  }
});

test('six native heal-growth operators earn only their native effective-heal production at ordinary/elite quantities and caps', { timeout: 900_000 }, () => {
  const filterFindings = [];
  for (const name of HEALERS) {
    for (const elite of [false, true]) {
      const source = operatorNamed(name);
      const chessId = elite ? source.eliteChessId : source.chessId;
      const op = CATALOG.operators[chessId];
      const uid = `heal-${source.chessId}-${elite ? 'elite' : 'normal'}`;
      const patientUid = `${uid}-patient`;
      const piece = { uid, chessId, row: 10, col: 4, equipment: [{ id: HEAL_EQUIPMENT, quantity: 1 }], attachments: [], nativeState: {} };
      const rule = op.nativeTrait.effect.combat.find((entry) => entry.trigger === 'heal' && entry.behavior === 'eventProduction');
      assert.ok(rule, `${name} ${elite ? 'elite' : 'normal'} has an authored native heal-growth rule`);
      const filter = rule.params.filter ?? {};
      filterFindings.push({ name, form: elite ? 'elite' : 'normal', effective: filter.effective === true,
        excludeEquipment: filter.excludeEquipment === true, excludeOverheal: filter.excludeOverheal === true });

      const heals = [];
      const h = makeIntegrationBattle({
        pieces: [piece],
        units: [
          { uid, chessId, row: 10, col: 4 },
          { uid: patientUid, chessId: 'patient', row: 10, col: 5 },
        ],
        timeLimit: 420,
      });
      let enemyAttacks = 0;
      h.b.on('attack', (event) => { if (event.attacker?.side === 'enemy') enemyAttacks++; });
      h.b.on('heal', (event) => {
        if (event.source?.uid !== uid) return;
        const missingBefore = Math.max(0, event.target.s.maxHp - event.target.hp);
        const requested = Number(event.amount) || 0;
        heals.push({ t: h.b.time, targetUid: event.target.uid, requested, effective: Math.max(0, Math.min(requested, missingBefore)),
          excess: Math.max(0, requested - missingBefore), equipment: !!(event.opts?.independentOrigin || event.opts?.tags?.includes('independentEquipment')),
          activation: event.source.skill?.activations ?? 'passive' });
      });
      h.step(1);
      const healer = h.unit(uid), patient = h.unit(patientUid);
      assert.ok(healer && patient, `${name} runs as canonical Battle units`);
      patient.hp = patient.s.maxHp * 0.1;
      assert.ok(h.b.enemies.some((enemy) => enemy.defId === 'enemy_probe'), 'the dummy enemy is present to create real attack opportunities');
      const enemy = h.b.enemies.find((unit) => unit.defId === 'enemy_probe');
      for (let i = 0; i < 3; i++) {
        h.b.dealDamage(healer, enemy, { amount: 10_000, type: 'phys', canDodge: false });
        h.run(0.55);
      }
      h.run(400);
      assert.ok(h.b.allyUnits.some((unit) => unit.uid === patientUid && unit.alive), `${name} has a living injured target throughout the integration run`);
      assert.ok(enemyAttacks > 0, `${name} had real enemy attack events during the integration run`);
      assert.ok(h.b.errorCount === 0, `${name} ${elite ? 'elite' : 'normal'} Battle has no content errors: ${JSON.stringify(h.b.errors)}`);
      const equipmentHeals = heals.filter((event) => event.equipment);
      const nativeEffectiveHeals = heals.filter((event) => !event.equipment && event.effective > 0);
      assert.ok(equipmentHeals.length > 0, `${name} exercised its real equipment-generated heal path`);
      assert.ok(nativeEffectiveHeals.length >= rule.params.counterEvery, `${name} received enough real KITS healing events to trigger growth`);

      const seenGroups = new Set();
      const countableNativeHeals = nativeEffectiveHeals.filter((event) => !filter.excludeOverheal || event.excess === 0).filter((event) => {
        if (!filter.groupHealCountsOnce) return true;
        const key = `${event.activation}:${Math.round(event.t * 1e6)}`;
        if (seenGroups.has(key)) return false;
        seenGroups.add(key);
        return true;
      });
      const batches = Math.floor(countableNativeHeals.length / Number(rule.params.counterEvery));
      const output = rule.params.outputs[0];
      const expectedQuantity = Math.min(Number(rule.params.maxPerBattle), batches * Number(output.quantity ?? 1));
      const actualQuantity = (h.b.independentRewards ?? []).filter((reward) => reward.origin === 'native'
        && reward.sourceUid === uid && reward.id === output.id).reduce((n, reward) => n + reward.quantity, 0);
      assert.equal(actualQuantity, expectedQuantity, `${name} ${elite ? 'elite' : 'normal'} produces from effective native heals only`);
      assert.equal(expectedQuantity, Number(rule.params.maxPerBattle), `${name} ${elite ? 'elite' : 'normal'} reaches the authored battle cap`);
      RECEIPTS.push({ kind: 'healGrowth', name, form: elite ? 'elite' : 'normal', chessId, rule: rule.params,
        heals: heals.length, nativeEffectiveHeals: nativeEffectiveHeals.length, equipmentHeals: equipmentHeals.length,
        partialOverheals: nativeEffectiveHeals.filter((event) => event.excess > 0).length, ineffectiveNativeHeals: heals.filter((event) => !event.equipment && event.effective <= 0).length, expectedQuantity, actualQuantity,
        enemyAttacks, patientHp: patient.hp, battleErrors: h.b.errorCount });
    }
  }
  RECEIPTS.push({ kind: 'healFilterAudit', findings: filterFindings });
  assert.ok(filterFindings.every((x) => x.effective && x.excludeEquipment && x.excludeOverheal),
    `all authored native healing-growth filters exclude ineffective heals, equipment heals, and overheal: ${JSON.stringify(filterFindings)}`);
});

test('native healing growth ignores real partial overheal events', () => {
  const source = operatorNamed('古米');
  const uid = 'overheal-gummy';
  const patientUid = 'overheal-patient';
  const piece = { uid, chessId: source.chessId, row: 10, col: 4, equipment: [], attachments: [], nativeState: {} };
  const h = makeIntegrationBattle({
    pieces: [piece],
    units: [{ uid, chessId: source.chessId, row: 10, col: 4 }, { uid: patientUid, chessId: 'patient', row: 10, col: 5 }],
    timeLimit: 100,
  });
  const events = [];
  let enemyAttacks = 0;
  h.b.on('heal', (event) => {
    if (event.source?.uid !== uid || event.target?.uid !== patientUid) return;
    const missing = Math.max(0, event.target.s.maxHp - event.target.hp);
    events.push({ requested: Number(event.amount) || 0, effective: Math.max(0, Math.min(Number(event.amount) || 0, missing)), excess: Math.max(0, (Number(event.amount) || 0) - missing) });
  });
  h.b.on('attack', (event) => { if (event.attacker?.side === 'enemy') enemyAttacks++; });
  h.step(1);
  const patient = h.unit(patientUid);
  patient.s.def = 100_000;
  patient.hp = patient.s.maxHp - 1;
  const enemy = h.b.enemies.find((unit) => unit.defId === 'enemy_probe');
  enemy.s.atk = 1;
  enemy.s.bat = 0.25;
  h.run(90);
  const partial = events.filter((event) => event.effective > 0 && event.excess > 0);
  const rule = CATALOG.operators[source.chessId].nativeTrait.effect.combat.find((entry) => entry.trigger === 'heal' && entry.behavior === 'eventProduction');
  const output = rule.params.outputs[0];
  const rewardQuantity = (h.b.independentRewards ?? []).filter((reward) => reward.origin === 'native' && reward.sourceUid === uid && reward.id === output.id).reduce((n, reward) => n + reward.quantity, 0);
  RECEIPTS.push({ kind: 'partialOverheal', name: '古米', form: 'normal', nativeEvents: events.length, partialOverheals: partial.length,
    enemyAttacks, rewardQuantity, rule: rule.params, battleErrors: h.b.errorCount });
  assert.ok(enemyAttacks > 0, 'the enemy had a real attack opportunity against the injured ally');
  assert.ok(partial.length >= rule.params.counterEvery, `real KITS produced enough partially overhealing heal events (${partial.length})`);
  assert.equal(rewardQuantity, 0, 'partial overheals cannot advance the native growth counter');
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
});
