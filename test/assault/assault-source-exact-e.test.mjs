import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle, getAssaultField } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';
import { COLS } from '../../server/sim/constants.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import { applyAction, createRun } from '../../shared/assault/run.js';
import { pieceFromBody } from '../../shared/assault/inventory.js';

const data = getAssaultData(), design = loadAssaultDesign();
const fs = await import('node:fs');
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const ranks = [3, 4];

function fixture(charId, rank, moduleId = null, extra = [], origin = [9, 3], extrasFirst = false, direction = 'RIGHT', encounterId = null) {
  const primary = { charId, moduleId, row: origin[0], col: origin[1], dir: direction, isPrimary: true };
  const pieces = extrasFirst ? [...extra, primary] : [primary, ...extra];
  const normalized = pieces.map((item, index) => {
    const body = data.runtime.bodies[item.charId];
    return { uid: `exact-e:${charId}:r${rank}:${index}:${item.charId}`, charId: item.charId,
      isPrimary: item.isPrimary === true,
      purchaseCharId: body.purchaseCharId, star: rank, row: item.row, col: item.col, dir: item.dir ?? 'RIGHT', sourceCopies: 1,
      moduleId: item.isPrimary ? moduleId : item.moduleId ?? null,
      moduleChoices: { [item.charId]: item.isPrimary ? moduleId : item.moduleId ?? null },
      permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  });
  const source = design.encounters.encounters.find((entry) => encounterId ? entry.id === encounterId : entry.kind === 'normal');
  assert(source, 'formal normal encounter exists for native Battle fixture');
  const encounter = { ...source, wave: { ...source.wave, spawns: [], dp: { ...source.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 729300 + rank, life: 20, day: 1, hour: 1,
    pieces: normalized, nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.autoFinish = false;
  battle.start(); battle.assaultRuntime.flush();
  const units = normalized.map((piece) => battle.allyUnits.find((unit) => unit.uid === piece.uid));
  assert(units.every((unit) => unit?.alive && unit.deployed), `native Battle deploys every selected owner piece: ${JSON.stringify(units.map((unit, index) => ({ index, uid: unit?.uid, alive: unit?.alive, deployed: unit?.deployed, row: unit?.tileR, col: unit?.tileC, errors: battle.errors?.slice?.(-2) })))}`);
  for (const unit of units) battle.addBuff(unit, { key: 'exact-e:quiet', flags: { disarm: true }, duration: 150 });
  const primaryUnit = units[normalized.findIndex((piece) => piece.isPrimary)];
  return { battle, unit: primaryUnit, allies: units.filter((unit) => unit !== primaryUnit), pieces: normalized, prepared };
}

function silverSkillBoundary(f) {
  const deployMap = f.prepared.field.normalizedDeployMap;
  const rangeGrid = f.unit.rangeGrid, baseExtend = Math.round(f.unit.s.rangeExtend);
  for (let row = f.battle.rect.r0; row <= f.battle.rect.r1; row++) for (let col = f.battle.rect.c0; col <= f.battle.rect.c1; col++) {
    if (deployMap.get(`${row},${col}`) !== 'melee' || !f.battle.grid.groundPassable(row, col)) continue;
    for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
      const ordinary = new Set(absoluteRangeKeys(rangeGrid, row, col, dir, baseExtend));
      const skill = absoluteRangeKeys(rangeGrid, row, col, dir, baseExtend + 1);
      const target = skill.map((key) => [Math.floor(key / COLS), key % COLS])
        .find(([r, c]) => !ordinary.has(r * COLS + c) && f.battle.grid.groundPassable(r, c));
      if (!target) continue;
      const ally = [[row, col + 1], [row + 1, col], [row - 1, col], [row, col - 1]]
        .find(([r, c]) => (r !== row || c !== col) && deployMap.get(`${r},${c}`) === 'melee' && f.battle.grid.groundPassable(r, c));
      if (ally) return { origin: [row, col], direction: dir, target, ally };
    }
  }
  return null;
}

function enemy(f, row, col, label, hold = true) {
  assert(f.battle.grid.groundPassable(row, col), `legal ground tile ${row},${col}`);
  const target = f.battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: f.battle.enemies.length,
    pos: [row, col], mods: { hpMul: 10000, speed: 0 } });
  if (hold) f.battle.applyStatus(target, 'stun', { duration: 100 });
  target.mem.exactELabel = label;
  f.battle._buildEnemyIndex();
  return target;
}

function nearbyEnemies(f, count, label) {
  const candidates = [];
  for (let radius = 1; radius <= 5; radius++) {
    for (let row = 5; row <= 14; row++) for (let col = 1; col < COLS; col++) {
      if (Math.abs(row - f.unit.tileR) + Math.abs(col - f.unit.tileC) !== radius) continue;
      if (f.battle.grid.groundPassable(row, col)) candidates.push([row, col]);
    }
    if (candidates.length >= count) break;
  }
  assert(candidates.length >= count, `native legal ground candidates found: ${candidates.length}/${count}`);
  return candidates.slice(0, count).map(([row, col], index) => enemy(f, row, col, `${label}-${index + 1}`));
}

function advance(battle, seconds) {
  const until = battle.time + seconds;
  for (let n = 0; n < 12000 && battle.time < until; n++) battle.step();
  assert(battle.time >= until, `native Battle clock reached ${until}`);
}

function naturalCast(f, label) {
  advance(f.battle, 0.25);
  assert.equal(f.unit.skill.rule, 'SP_FULL', `${label}: native fixed skill uses natural SP_FULL`);
  assert.equal(f.unit.skill.spec.canCast({ battle: f.battle, unit: f.unit }), true, `${label}: native Battle cast gate is open`);
  const starts = [];
  f.battle.assaultRuntime.observe('skillStart', `exact-e:${label}`, (event) => {
    if (event.payload.source === f.unit) starts.push({ ...event.payload, time: f.battle.time });
  });
  const gained = f.unit.skill.gainSp(f.unit.skill.spCost - f.unit.skill.sp, `exact-e-natural-SP_FULL:${label}`);
  assert(gained > 0, `${label}: actual Skill.gainSp fills the skill bar`);
  advance(f.battle, 0.05);
  f.battle.assaultRuntime.flush();
  assert.equal(starts.length, 1, `${label}: one natural automatic cast starts`);
  assert.equal(starts[0].reason, 'automatic');
  return starts[0];
}

function rosterEntry(charId) {
  const entry = roster.operators.find((item) => item.charId === charId);
  assert(entry, `${charId} is in roster-assault.json`);
  return entry;
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('exact-e SilverAsh R3/R4 natural S3 uses literal range, six/seven target cap and exact formation values', { timeout: 30000 }, () => {
  const source = rosterEntry('char_172_svrash'), compiled = data.runtime.bodies.char_172_svrash;
  assert.deepEqual(compiled.fixedSkill.effects.map((effect) => effect.values), source.fixedSkill.effects.map((effect) => effect.values));
  assert.deepEqual(compiled.modePassives[0].values, source.modePassives[0].values);
  assert.deepEqual(source.fixedSkill.effects[0].values.atkScale.slice(2), [1.8, 2]);
  assert.deepEqual(source.fixedSkill.effects[0].values.maxTarget.slice(2), [6, 6]);
  assert.deepEqual(source.fixedSkill.effects[0].values.rangeExtend, [1, 1, 1, 1]);
  assert.deepEqual(source.fixedSkill.effects[0].values.asMelee, [1, 1, 1, 1]);
  assert.deepEqual(source.fixedSkill.effects[0].values.damageType, ['物理', '物理', '物理', '物理']);
  assert.deepEqual(source.fixedSkill.effects[1].values.defPenalty, [-0.7, -0.7, -0.7, -0.7]);
  assert.deepEqual(source.fixedSkill.effects[1].values.atkBonus.slice(2), [1.8, 2]);
  assert.deepEqual(source.fixedSkill.effects[1].values.rangeExtend, [1, 1, 1, 1]);
  assert.deepEqual(source.fixedSkill.effects[1].values.duration, [30, 30, 30, 30]);
  assert.deepEqual(source.modePassives[0].values.atkBonusSelf.slice(2), [0.1, 0.1]);
  assert.deepEqual(source.modePassives[0].values.redeployReduceTeam.slice(2), [0.1, 0.12]);
  assert.equal(source.modePassives[0].values.installOncePerBattleFormation, true);
  assert.equal(source.modePassives[0].values.removedWhenNotInTeam, true);
  assert.equal(source.modePassives[0].values.notPersistAfterSell, true);
  assert.equal(source.modePassives[0].values.notHaste, true);
  for (const rank of ranks) {
    for (const moduleId of [null, 'uniequip_002_svrash']) {
      const f = fixture('char_172_svrash', rank, moduleId,
        [{ charId: 'char_127_estell', row: 9, col: 4 }], [9, 3], !!moduleId);
      const passive = source.modePassives[0].values;
      const selfPassive = f.unit.findBuff('char_172_svrash:leader-atk');
      const teamPassive = f.allies[0].findBuff('char_172_svrash:leader-redeploy');
      const baseAtk = f.unit.base.atk;
      assert.equal(selfPassive?.mods.atkPct, 0.1, `R${rank}: native formation adds exactly +10% ATK to SilverAsh`);
      assert(Math.abs(f.unit.s.atk - baseAtk * 1.1) < 1e-6, `R${rank}: live self ATK includes the literal +10% formation passive`);
      assert.equal(f.unit.buffs.filter((buff) => buff.key === 'char_172_svrash:leader-atk').length, 1, 'battle formation installation occurs once');
      const buffValues = source.fixedSkill.effects[1].values;
      const baseValues = source.fixedSkill.effects[0].values;
      const modulePlan = source.modulePlans.find((entry) => entry.id === 'uniequip_002_svrash');
      const skillRange = absoluteRangeKeys(f.unit.rangeGrid, f.unit.tileR, f.unit.tileC, f.unit.dir,
        Math.round(f.unit.s.rangeExtend + 1));
      const skillTiles = skillRange.map((key) => [Math.floor(key / COLS), key % COLS])
        .filter(([row, col]) => f.battle.grid.groundPassable(row, col));
      assert(skillTiles.length > 0, `R${rank}: native skill range includes legal ground target cells`);
      const skillTargets = Array.from({ length: 7 }, (_, index) => {
        const [row, col] = skillTiles[index % skillTiles.length];
        return enemy(f, row, col, `silverash-skill-r${rank}-${index + 1}`);
      });
      const ordinaryRange = new Set(f.unit.rangeKeys);
      const attackId = 'char_172_svrash:damage';
      const skillHits = [];
      f.battle.on('damaged', ({ source: attacker, target, amount, type, dmg }) => {
        if (attacker === f.unit && dmg?.isSkill && dmg.attackId === attackId)
          skillHits.push({ target, amount, type, isAttack: dmg.isAttack, attackId: dmg.attackId });
      }, { owner: f.unit });
      const attackBeforeCast = f.unit.s.atk;
      naturalCast(f, `silverash-r${rank}-${moduleId ?? 'base'}`);
      const skillBuff = f.unit.buffs.find((buff) => buff.key.startsWith('char_172_svrash:addBuff'));
      assert(skillBuff, `R${rank}: natural S3 cast installs its live timed combat buff`);
      assert.equal(skillBuff.mods.atkPct, buffValues.atkBonus[rank - 1]);
      const moduleDef = moduleId && skillHits.length >= 3 && modulePlan.effectHandling.includes('防御惩罚降低至-50%') ? -0.5 : -0.7;
      assert.equal(skillBuff.mods.defPct, moduleDef, `R${rank}: real S3 DEF cost follows source and selected-module threshold`);
      assert.equal(skillBuff.duration, 30);
      assert.equal(skillBuff.mods.rangeExtend, 1);
      assert.equal(f.unit.s.rangeExtend, 1, `R${rank}: fixedSkill1's actual live range is extended by exactly one`);
      assert.equal(f.unit.mem.assaultLastSkillTargetCount, moduleId ? 7 : 6,
        `R${rank}: actual native target selection admits six by base source and seven with selected module`);
      assert.equal(skillHits.length, moduleId ? 7 : 6, `R${rank}: exact source attackId landed on the literal target cap`);
      assert(skillHits.every((hit) => hit.amount > 0), `R${rank}: every native skill hit dealt positive actual damage`);
      const literalScale = rank === 3 ? 1.8 : 2;
      for (const hit of skillHits) {
        const raw = attackBeforeCast * literalScale;
        const physical = Math.max(raw - hit.target.s.def, raw * 0.05);
        assert.equal(hit.type, 'phys', `R${rank}: fixed S3 hit remains physical`);
        assert.equal(hit.isAttack, true, `R${rank}: asMelee source hit is classified as a real attack`);
        assert(Math.abs(hit.amount - physical) < 1e-5,
          `R${rank}: actual primary damage uses literal ${literalScale}× ATK and native target DEF`);
      }
      assert.equal(baseValues.maxTarget[rank - 1], 6, `R${rank}: formal fixed skill has a six-target cap`);
      assert.equal(teamPassive?.mods.redeployMul, 1 - passive.redeployReduceTeam[rank - 1], `R${rank}: actual teammate redeploy reduction is source 10%/12%; teammate=${JSON.stringify({ unit: f.allies[0].uid, kind: f.allies[0].kind, buffs: f.allies[0].buffs.map((b) => ({ key: b.key, mods: b.mods })) })}`);
      const ownerBuff = f.unit.findBuff('char_172_svrash:leader-atk');
      const teammateBuff = f.allies[0].findBuff('char_172_svrash:leader-redeploy');
      const atkBeforeReplay = f.unit.s.atk;
      f.battle.emit('battleStart', { battle: f.battle });
      assert.equal(f.unit.findBuff('char_172_svrash:leader-atk'), ownerBuff, 'replayed native battleStart does not duplicate owner buff');
      assert.equal(f.allies[0].findBuff('char_172_svrash:leader-redeploy'), teammateBuff, 'replayed native battleStart does not duplicate team buff');
      assert.equal(f.unit.s.atk, atkBeforeReplay, 'replayed installation leaves actual owner ATK unchanged');
      assert.equal(f.allies[0].s.redeployMul, 1 - passive.redeployReduceTeam[rank - 1], `R${rank}: real teammate redeploy stat uses source 10%/12%`);
      assert.equal(teammateBuff.mods.spRecoveryFlat, undefined, `R${rank}: redeploy buff does not add natural SP recovery`);
      assert.equal(f.allies[0].buffs.some((buff) => String(buff.key).startsWith('assault:haste:')), false,
        `R${rank}: source formation installs no native haste buff`);
      assert.equal(f.battle.errors.length, 0);
    }
    const absent = fixture('char_127_estell', rank);
    assert.equal(absent.unit.buffs.some((buff) => buff.key.startsWith('char_172_svrash:')), false,
      `R${rank}: next normal Battle formation without SilverAsh has no retained self/team passive source`);
    assert.equal(absent.unit.s.redeployMul, 1, `R${rank}: absence control has no SilverAsh redeploy reduction`);
  }
});

test('exact-e SilverAsh native skill gate admits only legal extension-only enemy cells across formal encounters', { timeout: 30000 }, () => {
  const compiled = data.runtime.bodies.char_172_svrash;
  assert.deepEqual(compiled.fixedSkill.effects[0].values.rangeExtend, [1, 1, 1, 1], 'compiled fixed skill preserves formal +1 range source');
  for (const rank of ranks) for (const moduleId of [null, 'uniequip_002_svrash']) {
    let scenario = null;
    for (const encounter of design.encounters.encounters.filter((entry) => entry.kind === 'normal')) {
      const field = getAssaultField({}, encounter, { ...data, design });
      const deploy = [...field.normalizedDeployMap.entries()].find(([, kind]) => kind === 'melee');
      if (!deploy) continue;
      const [row, col] = deploy[0].split(',').map(Number);
      const probe = fixture('char_172_svrash', rank, moduleId, [], [row, col], false, 'RIGHT', encounter.id);
      const boundary = silverSkillBoundary(probe);
      if (boundary) { scenario = { encounter, boundary }; break; }
    }
    assert(scenario, `R${rank}: one of the formal normal encounters has legal ground in the actual +1 SilverAsh ring`);
    const { encounter, boundary } = scenario;
    const f = fixture('char_172_svrash', rank, moduleId,
      [{ charId: 'char_127_estell', row: boundary.ally[0], col: boundary.ally[1] }], boundary.origin, false, boundary.direction, encounter.id);
    const target = enemy(f, boundary.target[0], boundary.target[1], `silverash-extension-only-r${rank}`);
    const tileKey = Math.round(target.y) * COLS + Math.round(target.x);
    const skillKeys = new Set(absoluteRangeKeys(f.unit.rangeGrid, f.unit.tileR, f.unit.tileC, f.unit.dir,
      Math.round(f.unit.s.rangeExtend + 1)));
    assert.equal(f.unit.rangeKeys.includes(tileKey), false, `R${rank}: extension-only enemy starts outside ordinary native range at ${target.x},${target.y}`);
    assert(skillKeys.has(tileKey), `R${rank}: same enemy is inside fixed source +1 range`);
    assert.equal(f.unit.skill.spec.canCast({ battle: f.battle, unit: f.unit }), true,
      `R${rank}: normal Battle canCast accepts extension-only target on ${encounter.id}`);
    const attackId = 'char_172_svrash:damage', hits = [];
    const attackBeforeCast = f.unit.s.atk, targetDefenseBeforeCast = target.s.def;
    const castStarts = [];
    f.battle.assaultRuntime.observe('skillStart', `exact-e:silver-range-starts:${rank}:${moduleId ?? 'base'}`, (event) => {
      if (event.payload.source === f.unit) castStarts.push(f.battle.time);
    });
    f.battle.on('damaged', ({ source, target: victim, amount, dmg }) => {
      if (source === f.unit && dmg?.isSkill && dmg.attackId === attackId) hits.push({ victim, amount });
    }, { owner: f.unit });
    const ordinaryRangeBeforeCast = [...f.unit.rangeKeys].sort((a, b) => a - b);
    const ordinaryRangeExtendBeforeCast = f.unit.s.rangeExtend;
    naturalCast(f, `silverash-extension-only-${encounter.id}-r${rank}-${moduleId ?? 'base'}`);
    assert.equal(hits.length, 1, `R${rank}: real natural cast hits the sole extension-only enemy`);
    assert.equal(hits[0].victim, target);
    const raw = attackBeforeCast * (rank === 3 ? 1.8 : 2);
    const expected = Math.max(raw - targetDefenseBeforeCast, raw * 0.05);
    assert(Math.abs(hits[0].amount - expected) < 1e-5,
      `R${rank}: extension-only primary damage uses literal scale against pre-hit live DEF (${hits[0].amount} vs ${expected}; atk=${attackBeforeCast}, def=${targetDefenseBeforeCast})`);

    if (moduleId) {
      const firstRangeBuff = f.unit.buffs.find((buff) => buff.key.startsWith('char_172_svrash:addBuff'));
      assert.equal(firstRangeBuff?.mods.rangeExtend, 1, `R${rank}/module: first live cast installs the literal +1 extension`);
      const recastDeadline = f.battle.time + 35;
      while (castStarts.length < 2 && f.battle.time < recastDeadline) advance(f.battle, 0.25);
      assert.equal(castStarts.length, 2, `R${rank}/module: natural SP recovery launches a second automatic SP_FULL cast`);
      while (hits.length < 2 && f.battle.time < recastDeadline + 10) advance(f.battle, 0.25);
      assert.equal(hits.length, 2, `R${rank}/module: both naturally charged casts produce actual primary hits`);
      const refreshed = f.unit.buffs.filter((buff) => buff.key.startsWith('char_172_svrash:addBuff'));
      assert.equal(refreshed.length, 1, `R${rank}/module: second natural cast refreshes the same timed buff without stacking a duplicate`);
      assert.equal(refreshed[0].mods.rangeExtend, 1, `R${rank}/module: refreshed live range remains exactly +1`);
      assert.equal(f.unit.s.rangeExtend, ordinaryRangeExtendBeforeCast + 1,
        `R${rank}/module: refresh leaves actual live range at base plus one, not plus two`);
    }

    const sourceBuff = f.unit.buffs.find((buff) => buff.key.startsWith('char_172_svrash:addBuff'));
    assert.equal(sourceBuff?.duration, 30, `R${rank}/${moduleId ?? 'base'}: live source buff retains its literal 30-second duration`);
    f.battle.autoFinish = false;
    const timeAtTargetExit = f.battle.time;
    assert(f.battle.dealDamage(f.unit, target, { amount: target.hp * 2, type: 'true', isSkill: true, tags: ['exact-e:remove-range-target'] }) > 0,
      `R${rank}/${moduleId ?? 'base'}: normal Battle.damage kills the only cast-eligible enemy`);
    assert.equal(target.alive, false, `R${rank}/${moduleId ?? 'base'}: eligible target is truly removed from the native targeting pool`);
    assert.equal(f.unit.skill.spec.canCast({ battle: f.battle, unit: f.unit }), false,
      `R${rank}/${moduleId ?? 'base'}: after target exit, native canCast refuses a repeat during the active buff`);
    let expirationWait = 0;
    while (expirationWait <= sourceBuff.duration + 60 && f.unit.buffs.some((buff) => buff.key.startsWith('char_172_svrash:addBuff'))) {
      advance(f.battle, 0.5);
      expirationWait += 0.5;
    }
    assert(expirationWait <= sourceBuff.duration + 60,
      `R${rank}/${moduleId ?? 'base'}: source duration expires in a bounded window after last cast (wait=${expirationWait}, now=${f.battle.time}, buffs=${JSON.stringify(f.unit.buffs.filter((buff) => buff.key.startsWith('char_172_svrash:addBuff')).map((buff) => ({ key: buff.key, duration: buff.duration, timeLeft: buff.timeLeft })))}, casts=${castStarts.length})`);
    assert(f.battle.time >= timeAtTargetExit + sourceBuff.duration, `R${rank}/${moduleId ?? 'base'}: normal Battle clock passed the complete 30-second source window after target exit`);
    assert.equal(f.unit.buffs.some((buff) => buff.key.startsWith('char_172_svrash:addBuff')), false,
      `R${rank}/${moduleId ?? 'base'}: live timed S3 buff naturally expires with no cast-eligible enemy`);
    assert.equal(castStarts.length, moduleId ? 2 : 1,
      `R${rank}/${moduleId ?? 'base'}: only the explicit natural cast${moduleId ? ' and its explicit refresh' : ''} start; no automatic recast occurs after target exit (starts=${JSON.stringify(castStarts)}, time=${f.battle.time})`);
    assert.equal(f.unit.s.rangeExtend, ordinaryRangeExtendBeforeCast,
      `R${rank}/${moduleId ?? 'base'}: natural S3 range extension expires back to its pre-cast native stat (now=${f.unit.s.rangeExtend}, before=${ordinaryRangeExtendBeforeCast}, time=${f.battle.time}, buffs=${JSON.stringify(f.unit.buffs.map((buff) => ({ key: buff.key, range: buff.mods?.rangeExtend, duration: buff.duration, timeLeft: buff.timeLeft })))})`);
    assert.deepEqual([...f.unit.rangeKeys].sort((a, b) => a - b), ordinaryRangeBeforeCast,
      `R${rank}/${moduleId ?? 'base'}: after-effect target range restores the exact ordinary cells without a +1 leak`);
    assert.equal(f.unit.buffs.some((buff) => buff.key.startsWith('char_172_svrash:addBuff')), false,
      `R${rank}/${moduleId ?? 'base'}: timed S3 combat buff is removed after its real window`);

    const outside = fixture('char_172_svrash', rank, moduleId, [], boundary.origin, false, boundary.direction, encounter.id);
    const extension = new Set(absoluteRangeKeys(outside.unit.rangeGrid, outside.unit.tileR, outside.unit.tileC, outside.unit.dir,
      Math.round(outside.unit.s.rangeExtend + 1)));
    let outsideCell = null;
    for (let r = outside.battle.rect.r0; r <= outside.battle.rect.r1 && !outsideCell; r++) for (let c = outside.battle.rect.c0; c <= outside.battle.rect.c1; c++) {
      if (!extension.has(r * COLS + c) && outside.battle.grid.groundPassable(r, c)) { outsideCell = [r, c]; break; }
    }
    assert(outsideCell, `R${rank}: native field has a legal enemy cell beyond the complete skill ring`);
    const far = enemy(outside, outsideCell[0], outsideCell[1], `silverash-outside-r${rank}`);
    assert.equal(outside.unit.skill.spec.canCast({ battle: outside.battle, unit: outside.unit }), false,
      `R${rank}: normal Battle canCast rejects target beyond the full fixed skill range`);
    const before = [];
    outside.battle.on('skillStart', ({ source }) => { if (source === outside.unit) before.push(source); }, { owner: outside.unit });
    outside.unit.skill.gainSp(outside.unit.skill.spCost - outside.unit.skill.sp, `exact-e-outside-SP_FULL:r${rank}:${moduleId ?? 'base'}`);
    advance(outside.battle, 0.1); outside.battle.assaultRuntime.flush();
    assert.equal(before.length, 0, `R${rank}/${moduleId ?? 'base'}: outside-only target does not trigger automatic cast`);
    assert.equal(outside.unit.skill.sp, outside.unit.skill.spCost, `R${rank}/${moduleId ?? 'base'}: failed range gate leaves natural SP_FULL intact`);
    assert(far.alive);
    assert.equal(outside.battle.errors.length, 0);
  }
});

test('exact-e SilverAsh passive is isolated to its native Battle owner and absent after real shared-run sale', { timeout: 30000 }, () => {
  const allRoster = ['support', 'assault', 'ranged'].flatMap((group) =>
    JSON.parse(fs.readFileSync(new URL(`../../data/assault-design/roster-${group}.json`, import.meta.url), 'utf8')).operators);
  const runContext = { catalog: { operators: Object.fromEntries(allRoster.map((entry) => [entry.charId, entry])), bodies: data.runtime.bodies }, design };
  const run = createRun({ runId: 'exact-e-silverash-sale', seed: 92831, directorId: design.system.directors[0].id }, runContext);
  const silverPiece = pieceFromBody(run, runContext, 'char_172_svrash', 1, { star: 4, row: 9, col: 3, dir: 'E' });
  const teammatePiece = pieceFromBody(run, runContext, 'char_127_estell', 1, { star: 4, row: 9, col: 4, dir: 'E' });
  run.pieces = [silverPiece, teammatePiece];
  run.phase = 'battlePrep';
  const sold = applyAction(run, { type: 'sell', uid: silverPiece.uid, opId: 'exact-e-silverash-sale', expectedRevision: run.revision }, runContext);
  assert.equal(sold.state.pieces.some((piece) => piece.uid === silverPiece.uid), false, 'normal shared run sell removes SilverAsh from authoritative inventory');
  assert.equal(sold.state.pieces.some((piece) => piece.uid === teammatePiece.uid), true, 'selling SilverAsh preserves its actual remaining teammate');
  const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const prepared = prepareAssaultBattle(sold.state, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.start(); battle.assaultRuntime.flush();
  const survivor = battle.allyUnits.find((unit) => unit.uid === teammatePiece.uid);
  assert(survivor?.alive && survivor.deployed, 'post-sale formation deploys the real retained teammate through normal Battle start');
  assert.equal(survivor.buffs.some((buff) => buff.key.startsWith('char_172_svrash:')), false,
    'SilverAsh passive does not persist into the next normal Battle after actual run sale');
  assert.equal(survivor.s.redeployMul, 1, 'post-sale real teammate has no SilverAsh redeploy stat modifier');
  assert.equal(battle.errors.length, 0);
});

test('exact-e SilverAsh R4 owner formation gives team redeploy reduction to its owner only in native two-player Battle', { timeout: 30000 }, () => {
  const silver = data.runtime.bodies.char_172_svrash, estell = data.runtime.bodies.char_127_estell;
  const entries = [
    { playerId: 'exact-e-p1', charId: silver.charId, body: silver, row: 10, col: 3, dir: 'RIGHT', star: 4, moduleId: null },
    { playerId: 'exact-e-p1', charId: estell.charId, body: estell, row: 10, col: 4, dir: 'RIGHT', star: 4, moduleId: null },
    { playerId: 'exact-e-p2', charId: estell.charId, body: estell, row: 10, col: 8, dir: 'LEFT', star: 4, moduleId: null },
  ].map((entry, index) => {
    const piece = { uid: `exact-e-mp:${index}:${entry.charId}`, charId: entry.charId, star: entry.star, moduleId: entry.moduleId,
      moduleChoices: { [entry.charId]: entry.moduleId }, sourceCopies: 1, permanentFlat: {}, permanentPercent: {},
      tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
    const chess = chessRec({ id: piece.uid, charId: entry.charId, profession: entry.body.profession,
      stats: entry.body.starStats[entry.star - 1].stats, rangeGrid: entry.body.range });
    chess.assaultPiece = piece; chess.assaultBody = entry.body;
    return { ...entry, piece, chess };
  });
  const source = new DataSource({ chess: Object.fromEntries(entries.map(({ chess }) => [chess.chessId, chess])) }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: 'exact-e:silverash-owner-scope', stage: flatStage(), routes: flatRoutes(), spawns: [], data: source,
    players: ['exact-e-p1', 'exact-e-p2'].map((playerId, seat) => ({ playerId, seat, side: seat ? 'R' : 'L', coords: 'board', bonds: {},
      units: entries.filter((entry) => entry.playerId === playerId).map((entry) => ({ uid: entry.piece.uid, chessId: entry.chess.chessId,
        row: entry.row, col: entry.col, dir: entry.dir })) })),
    content: 'assault', assault: { kits: { ...assaultKits }, strict: true }, flags: { dpInit: 99, dpPerSec: 0, dpMax: 99 },
    autoFinish: false, timeLimit: 30, quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start(); battle.assaultRuntime.flush();
  const p1Owner = battle.allyUnits.find((unit) => unit.uid === entries[0].piece.uid);
  const p1Ally = battle.allyUnits.find((unit) => unit.uid === entries[1].piece.uid);
  const p2Ally = battle.allyUnits.find((unit) => unit.uid === entries[2].piece.uid);
  assert(p1Owner?.alive && p1Ally?.alive && p2Ally?.alive, 'native two-player Battle deploys all three actual pieces');
  assert.equal(p1Ally.findBuff('char_172_svrash:leader-redeploy')?.mods.redeployMul, 0.88,
    'SilverAsh owner receives exactly the R4 12% redeploy reduction');
  assert.equal(p1Ally.s.redeployMul, 0.88, 'owner teammate live redeploy stat reflects the passive');
  assert.equal(p2Ally.findBuff('char_172_svrash:leader-redeploy'), null, 'other player gets no foreign SilverAsh passive');
  assert.equal(p2Ally.s.redeployMul, 1, 'other player live redeploy stat remains unchanged');
  assert.equal(p1Ally.findBuff('char_172_svrash:leader-redeploy')?.mods.spRecoveryFlat, undefined, 'redeploy passive contributes no haste/SP rate');
  assert.equal(battle.errors.length, 0);
});
