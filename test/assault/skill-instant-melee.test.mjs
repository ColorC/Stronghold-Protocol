import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { latestOperatorKits } from '../../server/sim/content/assault/cards/latest-operators.js';

const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const rows = new Map(roster.operators.map((row) => [row.charId, row]));
const kits = { ...assaultKits, ...latestOperatorKits };
const nativeIds = ['char_1019_siege2','char_155_tiger','char_172_svrash','char_188_helage','char_264_f12yin','char_294_ayer','char_350_surtr','char_4010_etlchi','char_4016_kazema','char_4037_demetr','char_4058_pepe','char_4082_qiubai','char_4145_ulpia','char_437_mizuki','char_474_glady','char_491_humus'];
const bespokeIds = ['char_1014_nearl2','char_1023_ghost2','char_1026_gvial2','char_1028_texas2','char_1032_excu2','char_1041_angel2','char_127_estell','char_140_whitew','char_143_ghost','char_154_morgan','char_263_skadi','char_265_sophia','char_308_swire','char_337_utage','char_356_broca','char_4064_mlynar','char_4231_clemnt'];

function compiledData() {
  const runtime = JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));
  return getAssaultData({ runtime });
}

function makeBattle(id, star = 4, moduleId = rows.get(id)?.defaultModuleId ?? null, addAlly = false) {
  const design = loadAssaultDesign(), data = compiledData(), body = data.runtime.bodies[id];
  const piece = { uid: `melee:${id}`, charId: id, purchaseCharId: body.purchaseCharId, star, fixedSkill: body.fixedSkill,
    sourceCopies: 1, moduleChoices: { [id]: moduleId }, moduleId, permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] },
    claimed: [], summonPresets: [], row: 9, col: 2, dir: 'RIGHT' };
  const allyBody = addAlly ? data.runtime.bodies.char_127_estell : null;
  const allyPiece = allyBody ? { uid: `melee:${id}:ally`, charId: allyBody.charId, purchaseCharId: allyBody.purchaseCharId, star: 4,
    fixedSkill: allyBody.fixedSkill, sourceCopies: 1, moduleChoices: {}, moduleId: null, permanentFlat: {}, permanentPercent: {},
    tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [], row: 10, col: 2, dir: 'RIGHT' } : null;
  const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const state = { seed: 73201, life: 20, day: 1, hour: 1, pieces: [piece, ...(allyPiece ? [allyPiece] : [])], nextBattleEffects: [] };
  const prepared = prepareAssaultBattle(state, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits });
  battle.start(); battle.assaultRuntime.flush(); battle._buildEnemyIndex();
  const unit = battle.allyUnits.find((entry) => entry.uid === piece.uid);
  const ally = allyPiece ? battle.allyUnits.find((entry) => entry.uid === allyPiece.uid) : null;
  assert.ok(unit, `live Battle unit ${id}`);
  return { battle, unit, body, piece, ally };
}

test('the complete melee repair set uses source S1 for the 16 native instant hitters and no self posture windows', () => {
  assert.equal(nativeIds.length, 16);
  assert.equal(bespokeIds.length, 17, 'the original 16 bespoke forms plus roster-owned Clemnt');
  for (const id of [...nativeIds, ...bespokeIds]) {
    const skill = rows.get(id)?.fixedSkill;
    assert.ok(skill?.effects?.length, `${id} has fixed skill effects`);
    assert.ok(skill.spCosts?.every((cost) => Number.isFinite(cost) && cost > 0), `${id} has four native SP costs`);
    assert.ok(Number.isFinite(skill.initSp) && skill.initSp <= Math.min(...skill.spCosts), `${id} starts within the SP cap`);
    assert.equal(skill.spType, 'time', `${id} uses natural 1 SP/s recovery even when the original skill was attack-recovery`);
    assert.equal(skill.recoveryPerSec, 1, `${id} naturally recovers SP`);
    // a synergy card (design of 2026-10-21) adapts the native skill its design picks, not necessarily S1
    if (nativeIds.includes(id) && !['synergy','adaptation'].includes(compiledData().runtime.bodies[id]?.bazaar?.format)) {
      assert.equal(skill.sourceIndex, 0, `${id} selects S1`);
      assert.match(skill.sourceSkillId, /_1$/u, `${id} source skill is S1`);
    }
    for (const effect of skill.effects) {
      const values = effect.values ?? {};
      if (['damage','heal','ammo','growth','targeting','redeploy','nativeMechanism'].includes(effect.action))
        assert.equal(effect.lifecycle, 'instant', `${id}:${effect.action} resolves in this cast`);
      assert.ok(values.attackSpeedBonus == null && values.atkBonus == null && values.defBonus == null && values.rangeBonus == null,
        `${id} has no self attack-speed, attack, defense, or range window`);
      assert.ok(values.atkScalePerSec == null && values.interval == null && values.normalAttackBonus == null,
        `${id} has no periodic or ordinary-attack skill window`);
      if (effect.action === 'addBuff') {
        for (const key of ['atkBonus','attackSpeedBonus','defBonus','atkPct','atkFlat','defPct','defFlat','aspd','rangeBonus','rangeExtend'])
          assert.equal(values[key], undefined, `${id} does not install ${key} as a self posture`);
      }
    }
  }
  assert.equal(rows.get('char_4231_clemnt').fixedSkill.resolution, 'single-cast-v2');
  assert.deepEqual(rows.get('char_4231_clemnt').fixedSkill.effects[0].values.erosionDamageRatio, [0.3, 0.3, 0.35, 0.35]);
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('all 33 changed melee forms naturally cast at four stars with their selected advanced module in a real Battle', () => {
  // the forms that became synergy cards (design of 2026-10-21) cast through their own kit (cards/synergy-*.js), not the
  // old one this file builds with: their casts are tested in test/assault/synergy-*.test.mjs
  const synergy = new Set(Object.values(compiledData().runtime.bodies).filter((b) => ['synergy','adaptation'].includes(b.bazaar?.format)).map((b) => b.charId));
  const ids = [...nativeIds, ...bespokeIds].filter((id) => !synergy.has(id));
  for (const id of ids) {
    const hasModule = !!rows.get(id).defaultModuleId;
    const { battle, unit, body, ally } = makeBattle(id, 4, rows.get(id).defaultModuleId ?? null, ['char_1041_angel2','char_308_swire','char_294_ayer'].includes(id));
    if (id === 'char_308_swire') battle._pp(unit.ownerId).coins = 1;
    const angelDropSp = [];
    if (id === 'char_1041_angel2') {
      assert.ok(ally?.alive, 'a legal Angel2 deployment target is present');
      battle.loseHp(ally, ally.hp + 1, { source: null });
      battle.assaultRuntime.flush();
      assert.equal(ally.alive, false, 'the target enters native downed-waiting state before the cast');
      assert.ok(Number.isFinite(ally.respawnAt), 'native Battle records its redeploy timer');
      battle.on('spGain', (event) => { if (event.reason === 'angelicaDrop') angelDropSp.push({ unit: event.unit, amount: event.amount }); });
    }
    const blockedCaster = id === 'char_1023_ghost2';
    const forwardTargets = unit.rangeKeys.filter((key) => key % 21 > unit.tileC)
      .sort((a, b) => b % 21 - a % 21);
    const targetKey = blockedCaster ? unit.tileR * 21 + unit.tileC
      : forwardTargets[0] ?? unit.rangeKeys.find((key) => Math.floor(key / 21) !== unit.tileR || key % 21 !== unit.tileC);
    assert.ok(Number.isInteger(targetKey), `${id} exposes a legal firing tile`);
    const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0,
      pos: [Math.floor(targetKey / 21), targetKey % 21], mods: { hpMul: 100000, speed: 0 } });
    enemy.s.moveSpeed = 0;
    battle._buildEnemyIndex();
    if (id === 'char_294_ayer') {
      assert.ok(ally?.alive, 'Ayer has a real allied blocker for the native S1 target rule');
      ally.x = ally.tileC = enemy.tileC; ally.y = ally.tileR = enemy.tileR;
      enemy.blockedBy = ally; ally.blocking = [...(ally.blocking ?? []), enemy];
      assert.equal(enemy.blockedBy.side, 'ally', 'Ayer targets an enemy in the real blocked-by-ally state');
    }
    if (id === 'char_491_humus') {
      enemy.blockedBy = unit; unit.blocking = [...(unit.blocking ?? []), enemy];
      assert.equal(enemy.blockedBy, unit, 'Humus S1 is tested against an enemy actually blocked by Humus');
    }
    if (blockedCaster) {
      assert.equal(battle._checkBlock(enemy), true, 'Ghost2 is tested against a real blocked target');
      assert.equal(enemy.blockedBy, unit);
    }
    const skillHits = [];
    battle.on('damaged', (event) => { if (event.source === unit && event.dmg?.isSkill && event.amount > 0) skillHits.push(event); }, { owner: unit });
    assert.equal(unit.skill.activations, 0, `${id} has not been synthetically cast`);
    const maxTicks = Math.ceil(Math.max(0, unit.skill.spCost - unit.skill.sp) * 60) + 120;
    for (let tick = 0; tick < maxTicks && unit.skill.activations === 0; tick++) battle.step();
    battle.assaultRuntime.flush();
    assert.ok(unit.skill.activations > 0, `${id} naturally reached its real SP cost and cast${hasModule ? ` with ${rows.get(id).defaultModuleId}` : ''}: ${JSON.stringify({ sp: unit.skill.sp, cost: unit.skill.spCost, target: [enemy.tileR, enemy.tileC], unit: [unit.tileR, unit.tileC], targetAlive: enemy.alive, hp: enemy.hp, maxHp: enemy.s.maxHp, route: enemy.routeProgress, leaks: battle.leaks, targetable: unit.rangeKeySet?.has(enemy.tileR * 21 + enemy.tileC), module: unit.mem.assaultModuleHooks?.moduleId, skillKeys: Object.keys(unit.skill), spType: unit.skill.spType, trigger: unit.skill.trigger, canCast: typeof unit.skill.canCast, unitAlive: unit.alive })}`);
    const bindDuration = body.fixedSkill.effects.find((effect) => effect.values?.delayedAreaDamage)?.values?.bindDuration?.[3] ?? 0;
    for (let tick = 0; tick < Math.ceil(bindDuration * 60) + 2; tick++) battle.step();
    battle.assaultRuntime.flush();
    if (id === 'char_1041_angel2') {
      assert.ok(ally.alive && ally.deployed, 'Angel2 performs the legal free redeployment');
      // 卡面「再部署 1 名干员并为其充能 6」：6 技力给被再部署的干员，新约能天使自己只有施放那一帧的自然回复。
      assert.deepEqual(angelDropSp.map((event) => [event.unit, event.amount]), [[ally, 6]], 'legal delivery charges the redeployed operator six SP');
      assert.ok(unit.skill.sp < 0.1, 'Angel2 itself only keeps the natural recovery from the cast tick');
    }
    const effectHasDamage = body.fixedSkill.effects.some((effect) => effect.action === 'damage');
    if (effectHasDamage && id !== 'char_1023_ghost2') assert.ok(skillHits.length > 0, `${id} caused positive skill damage in Battle`);
    if (id === 'char_1023_ghost2') assert.ok(skillHits.length > 0, 'Ghost2 hit the real self-blocked enemy');
    if (body.fixedSkill.effects.some((effect) => effect.action === 'addBuff' && effect.values?.barrierRatio != null)) {
      const shield = unit.buffs.find((entry) => entry.key === `${id}:barrier`);
      assert.ok(shield?.shield > 0, `${id} grants its actual cast shield`);
    }
    if (id === 'char_1032_excu2') assert.equal(unit.mem.assaultAmmo, null, 'Exusiai Alter consumes the instant three-shot pool');
    assert.deepEqual(battle.errors, [], `${id} Battle errors`);
  }
});

