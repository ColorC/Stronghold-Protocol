import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SP_DATA_DIR ??= 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const [{ getData }, { getResonanceCatalog, getLegacyResonanceCatalog }, { Battle }, { installResonancePacts }, { applyCurrentPacts }, { createResonanceKits }] = await Promise.all([
  import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'), import('../../server/sim/Battle.js'),
  import('../../server/sim/content/resonance/pacts.js'), import('../../shared/resonance/current-pacts.js'), import('../../server/sim/content/resonance/kits.js'),
]);
const { enemyRec, flatStage } = await import('../helpers/battleHarness.js');
const data = getData();
const current = getResonanceCatalog(data, { rulesVersion: 2, seed: 41 });
const legacy = getLegacyResonanceCatalog(data, { environmentId: 'origin_laterano', seed: 41 });
const uniqueOperators = [...new Map(current.config.activeOperatorIds.map((id) => current.operators[id]).map((op) => [op.charId, op])).values()];

function makeBattle(pact, { ammo = false, count = 2, catalog = current, operators = null, stars = [], nativeKits = false } = {}) {
  const selected = operators ?? uniqueOperators.slice(0, count);
  const loadouts = selected.map((operator, index) => ({ operator, uid: `pact-${pact ?? 'solo'}-${index}`, star: stars[index] ?? 1 }));
  const player = { playerId: 'pact-test', units: loadouts.map((row, index) => ({ uid: row.uid, chessId: row.operator.id, skillIndex: row.operator.fixedSkillIndex ?? 0, moduleId: 'none', row: 9, col: index + 2, dir: 'RIGHT', star: row.star, items: [], extraPacts: pact ? [pact] : [] })) };
  const state = { rulesVersion: catalog.config?.rulesVersion ?? 1, pieces: loadouts.map((row) => ({ uid: row.uid, star: row.star })) };
  const kits = nativeKits ? createResonanceKits(catalog, state, data) : Object.fromEntries(loadouts.map(({ operator }) => [operator.id, () => ({ trait: { noAttack: true }, skill: { id: `test-${pact ?? 'solo'}`, kind: ammo ? 'ammo' : 'duration', ammo: ammo ? 2 : 0, duration: 10, trigger: 'SP_FULL', spCost: 1, initSp: 0, spType: 'none' } })]));
  const battle = new Battle({ seed: 41, kind: 'normal', round: 1, timeLimit: 30, autoFinish: false, stage: flatStage({ id: 'current-pact-test' }), data, players: [player], kits, content: 'independent', recordEvents: false, flags: { startOpCooldown: 0, dpInit: 20, dpPerSec: 1, dpMax: 99 } });
  const active = installResonancePacts(battle, { catalog, state });
  return { battle, active, units: battle.allyUnits.filter((unit) => unit.kind === 'op'), state };
}
function spawnDummy(battle, pos) { return battle.spawnEnemy('current-redeploy-target', { pos, def: enemyRec({ key: 'current-redeploy-target', hp: 1e9, atk: 0, speed: 0 }) }); }
function advance(battle, seconds) { for (let i = 0, n = Math.ceil(seconds / battle.dt); i < n && !battle.finished; i += 1) battle.step(); }
function advanceUntilAlive(battle, unit, seconds = 1) { for (let i = 0, n = Math.ceil(seconds / battle.dt); i < n && !battle.finished && !unit.alive; i += 1) battle.step(); }
function fundRedeploy(battle, unit) { const player = battle.getPlayer(unit.ownerId); if (player) player.dp = 99; }
function observeRedeployEffects(battle, unit) {
  const heals = [], pactHits = [], nativeSkillHits = [];
  const heal = battle.heal.bind(battle), damage = battle.dealDamage.bind(battle);
  battle.heal = (source, target, amount, options = {}) => { if (target === unit) heals.push({ source, amount, tags: options.tags ?? [] }); return heal(source, target, amount, options); };
  battle.dealDamage = (source, target, hit) => {
    if (source === unit && hit?.tags?.includes('resonance')) pactHits.push({ target, amount: hit.amount, type: hit.type });
    if (source === unit && hit?.tags?.includes('skill') && !hit?.tags?.includes('resonance')) nativeSkillHits.push({ target, amount: hit.amount, type: hit.type });
    return damage(source, target, hit);
  };
  return { heals, pactHits, nativeSkillHits };
}
function downOperator(battle, unit, killer = null) {
  const enemy = killer ?? spawnDummy(battle, [unit.y, unit.x + 3]);
  unit.hp = 1;
  battle.dealDamage(enemy, unit, { amount: 1e9, type: 'true', canDodge: false });
  return enemy;
}
const star3RedeployOperator = Object.values(current.operators).find((operator) => operator.stars?.[3]?.passive?.kind === 'star3_redeploy');
assert.ok(star3RedeployOperator, 'catalog has a fixed three-star redeploy passive fixture');

test('current v2 pact tiers and player text follow the current roster while v1 remains frozen', () => {
  const patched = applyCurrentPacts({ ...legacy, pacts: legacy.pacts, playerText: legacy.playerText });
  assert.equal(patched.pacts.higashi.levels.every((row) => row.effects.find(x => x.kind === 'higashi_redeploy').params.returnSp === 0), true);
  assert.ok(patched.pacts.siracusa.levels.every((row) => row.effects.some(x => x.kind === 'siracusa_harvest')));
  assert.equal(patched.pacts.ammo.levels[1].effects[0].params.skillAmmo, 2);
  assert.equal(patched.pacts.ammo.levels.length,2);
  assert.ok(patched.pacts.siracusa.levels[0].effects.find(row => row.kind === 'siracusa_harvest').reference.killToSp.jsonPointer);
  assert.ok(patched.pacts.ammo.levels[0].effects[0].reference.nativeGit);
  assert.match(patched.playerText.pacts.higashi.levels[0].description, /闪避/);
  assert.doesNotMatch(patched.playerText.pacts.higashi.levels[0].description, /四人/);
  assert.match(patched.playerText.pacts.higashi.levels[1].description, /返场.*80%攻击力真实伤害/);
  assert.doesNotMatch(patched.playerText.pacts.higashi.levels[0].description, /返.*技力/);
  assert.match(patched.playerText.pacts.siracusa.levels[0].description, /击倒.*本人恢复3技力/);
  assert.doesNotMatch(patched.playerText.pacts.siracusa.levels[0].description, /狼影/);
  assert.equal(patched.pacts.siracusa.levels.length,3);
  assert.ok(patched.playerText.pacts.siracusa.levels.every(row=>!row.description.includes('狼影')));
  assert.match(patched.playerText.pacts.ammo.levels[0].description, /增加1枚载弹/);
  assert.match(legacy.playerText.pacts.higashi.levels[0].description, /退出后.*技力/);
  assert.match(legacy.playerText.pacts.ammo.levels[0].description, /几率恢复/);
});

test('v2 Redeploy publishes only supported tier values and references native timer/deploy-AoE mechanics', () => {
  const patched = applyCurrentPacts({ ...legacy, pacts: legacy.pacts, playerText: legacy.playerText });
  const expected = [[2, .8, 100, 20], [3, .65, 180, 35]];
  for (const [index, [threshold, timer, damage, shorter]] of expected.entries()) {
    const row = patched.pacts.redeploy.levels[index], effect = row.effects.find((x) => x.kind === 'redeploy_return');
    assert.equal(row.threshold, threshold); assert.equal(effect.params.timeMultiplier, timer);
    assert.equal(effect.params.returnLimit, 1); assert.equal(effect.params.heal, 0); assert.equal(effect.params.damage, damage);
    assert.match(row.description, new RegExp(`缩短${shorter}%；.*${damage}%攻击力法术伤害`));
    assert.equal(patched.playerText.pacts.redeploy.levels[index].description, row.description);
    assert.equal(effect.reference.sourcePath, 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native/chess.json');
    assert.equal(effect.reference.nativeCommit, '4ed1ad32ec10da15c23f9d7939dade603950759b');
    assert.ok(effect.reference.silverAsh.nativeGit.endsWith('/chess_char_4_22_a/talents/0'));
    assert.ok(effect.reference.skadi.nativeGit.endsWith('/chess_char_3_05_a/talents/1'));
    assert.ok(effect.reference.texas.nativeGit.endsWith('/chess_char_4_16_a/skill'));
  }
  assert.deepEqual(legacy.pacts.redeploy.levels.map((row) => row.effects[0].params), [
    { returnLimit: 2, damageType: 'arts', timeMultiplier: .8, heal: 20, damage: 100 },
    { returnLimit: 2, damageType: 'arts', timeMultiplier: .65, heal: 35, damage: 180 },
    { returnLimit: 2, damageType: 'arts', timeMultiplier: .4, heal: 60, damage: 320 },
  ], 'the v1 catalog is unchanged');
});

test('v2 Redeploy shortens every death but only the first reentry gets one pact AoE and no pact healing', () => {
  const { battle, units } = makeBattle('redeploy', { count: 2 });
  battle.start();
  const unit = units[0]; unit.base.respawnTime = .5;
  const target = spawnDummy(battle, [unit.y, unit.x + 2]);
  const startingHp = target.hp, effects = observeRedeployEffects(battle, unit);
  assert.equal(unit.mem.pactRedeployReturns, undefined, 'initial deployment does not consume the return');

  const killer = downOperator(battle, unit);
  assert.equal(unit.alive, false); assert.ok(unit.mem.pactRedeployPending);
  assert.ok(Math.abs(unit.respawnAt - unit.deathAt - .5 * .8) < 1e-8);
  fundRedeploy(battle, unit);
  advanceUntilAlive(battle, unit);
  assert.equal(unit.alive, true);
  assert.equal(unit.mem.pactRedeployReturns, 1);
  assert.equal(effects.heals.length, 0, 'zero-heal current pact never calls Battle.heal');
  assert.equal(effects.pactHits.filter((hit) => hit.target === target).length, 1, 'the first actual redeploy hits this target once');
  assert.equal(effects.pactHits.find((hit) => hit.target === target).amount, unit.s.atk);
  assert.ok(target.hp < startingHp);

  downOperator(battle, unit, killer);
  assert.equal(unit.alive, false); assert.ok(unit.mem.pactRedeployPending, 'later deaths still use the pact timer');
  assert.ok(Math.abs(unit.respawnAt - unit.deathAt - .5 * .8) < 1e-8);
  fundRedeploy(battle, unit);
  advanceUntilAlive(battle, unit);
  assert.equal(unit.alive, true);
  assert.equal(unit.mem.pactRedeployReturns, 1, 'return count is held in this unit’s battle memory');
  assert.equal(effects.pactHits.filter((hit) => hit.target === target).length, 1, 'later redeploys do not repeat the capped pact AoE');
  assert.equal(effects.heals.length, 0);
  assert.equal(battle.errorCount, 0);
});

test('v2 combines first star-three and pact timers with the shorter value, while solo star-three has no hidden heal/AoE', () => {
  const partner = Object.values(current.operators).find((operator) => operator.id !== star3RedeployOperator.id);
  const combined = makeBattle('redeploy', { operators: [star3RedeployOperator, partner], stars: [3, 1] });
  combined.battle.start();
  const unit = combined.units[0]; unit.base.respawnTime = .5;
  const target = spawnDummy(combined.battle, [unit.y, unit.x + 2]);
  const combinedEffects = observeRedeployEffects(combined.battle, unit);
  const killer = downOperator(combined.battle, unit);
  assert.ok(Math.abs(unit.respawnAt - unit.deathAt - .5 * .5) < 1e-8, 'star-three .5 wins over pact .8, not overwritten');
  fundRedeploy(combined.battle, unit);
  advanceUntilAlive(combined.battle, unit);
  assert.equal(unit.alive, true); assert.equal(combinedEffects.heals.length, 0);
  assert.equal(combinedEffects.pactHits.filter((hit) => hit.target === target).length, 1); assert.ok(target.hp < 1e9);
  downOperator(combined.battle, unit, killer);
  assert.ok(Math.abs(unit.respawnAt - unit.deathAt - .5 * .8) < 1e-8, 'after the one-shot passive, each death still gets pact timer');
  fundRedeploy(combined.battle, unit);
  advanceUntilAlive(combined.battle, unit);
  assert.equal(unit.alive, true); assert.equal(combinedEffects.pactHits.filter((hit) => hit.target === target).length, 1, 'pact return limit remains spent');
  assert.equal(combined.battle.errorCount, 0);

  const solo = makeBattle(null, { operators: [star3RedeployOperator], stars: [3] });
  solo.battle.start();
  const lone = solo.units[0]; lone.base.respawnTime = .5;
  const soloTarget = spawnDummy(solo.battle, [lone.y, lone.x + 2]);
  const soloEffects = observeRedeployEffects(solo.battle, lone);
  downOperator(solo.battle, lone);
  assert.ok(Math.abs(lone.respawnAt - lone.deathAt - .5 * .5) < 1e-8);
  advanceUntilAlive(solo.battle, lone);
  assert.equal(lone.alive, true); assert.equal(soloEffects.heals.length, 0);
  assert.equal(soloEffects.pactHits.length, 0, 'star3_redeploy itself only shortens its first wait');
  assert.equal(soloTarget.hp, 1e9);
  assert.equal(solo.battle.errorCount, 0);
});

test('v2 pact AOE is tagged separately from the native Texas-on-deploy skill; v1 combined legacy effects remain intact', () => {
  const texas = Object.values(current.operators).find((operator) => operator.name === '缄默德克萨斯');
  const partner = Object.values(current.operators).find((operator) => operator.id !== texas?.id);
  assert.ok(texas); assert.equal(texas.fixedSkillId, 'skchr_texas2_3');
  const native = makeBattle('redeploy', { operators: [texas, partner], nativeKits: true });
  native.battle.start();
  const unit = native.units[0]; unit.base.respawnTime = .5;
  const target = spawnDummy(native.battle, [unit.y, unit.x + 1]);
  const nativeEffects = observeRedeployEffects(native.battle, unit);
  const killer = downOperator(native.battle, unit);
  fundRedeploy(native.battle, unit);
  advanceUntilAlive(native.battle, unit);
  assert.equal(unit.alive, true);
  assert.equal(nativeEffects.pactHits.filter((hit) => hit.target === target).length, 1, 'one pact-tagged hit comes from current Redeploy');
  assert.ok(nativeEffects.nativeSkillHits.length >= 2, 'native Texas S3 keeps its own two deployment hits');
  assert.ok(target.hp < 1e9, 'the live native skill and pact effect both resolve against the target');
  assert.equal(nativeEffects.heals.length, 0);
  assert.equal(native.battle.errorCount, 0);

  const legacyBattle = makeBattle('redeploy', { catalog: legacy, operators: [star3RedeployOperator, partner], stars: [3, 1] });
  legacyBattle.battle.start(); const old = legacyBattle.units[0]; old.base.respawnTime = .5;
  const oldTarget = spawnDummy(legacyBattle.battle, [old.y, old.x + 2]);
  const oldEffects = observeRedeployEffects(legacyBattle.battle, old); downOperator(legacyBattle.battle, old);
  assert.ok(Math.abs(old.respawnAt - old.deathAt - .5 * .8) < 1e-8, 'v1 pact timer retains historical write order');
  fundRedeploy(legacyBattle.battle, old); advanceUntilAlive(legacyBattle.battle, old);
  assert.equal(old.alive, true); assert.equal(oldEffects.heals.length, 1, 'v1 Redeploy retains its historical pact heal');
  assert.equal(oldEffects.pactHits.filter((hit) => hit.target === oldTarget).length, 2, 'v1 pact and star-three passive retain their historical AOE effects');
  assert.ok(oldTarget.hp < 1e9); assert.equal(legacyBattle.battle.errorCount, 0);
});

test('Higashi retreat no longer grants SP in v2', () => {
  const { battle, units } = makeBattle('higashi');
  battle.start();
  let sp = 0;
  units[0].skill.gainSp = (amount) => { sp += amount; };
  battle.emit('retreating', { unit: units[0] });
  assert.equal(sp, 0);
  const old = makeBattle('higashi', { catalog: legacy });
  old.battle.start();
  let oldSp = 0;
  old.units[0].skill.gainSp = (amount) => { oldSp += amount; };
  old.battle.emit('retreating', { unit: old.units[0] });
  assert.equal(oldSp, 15, 'v1 keeps the default retreat SP reward');
});

test('Siracusa kill grants tier SP and one non-stacking bonus on the next basic attack only', () => {
  const { battle, units } = makeBattle('siracusa');
  battle.start();
  const unit = units[0];
  let sp = 0;
  unit.skill.gainSp = (amount) => { sp += amount; };
  const target = battle.spawnEnemy('current-pact-target', { pos: [unit.y, unit.x + 2], def: enemyRec({ key: 'current-pact-target', hp: 1e6, atk: 0, speed: 0 }) });
  battle.emit('kill', { killer: unit, victim: target });
  const queued = unit.mem.siracusaNextHit;
  battle.emit('kill', { killer: unit, victim: target });
  assert.equal(sp, 6);
  assert.equal(unit.mem.siracusaNextHit, queued, 'an unused enhancement does not stack');
  const before = target.hp;
  battle.dealDamage(unit, target, { amount: 100, type: 'phys', isAttack: true, isSkill: true, canDodge: false });
  assert.equal(unit.mem.siracusaNextHit, queued, 'a skill hit cannot consume the basic-attack enhancement');
  battle.dealDamage(unit, target, { amount: 100, type: 'phys', isAttack: true, isSkill: false, canDodge: false });
  assert.equal(unit.mem.siracusaNextHit, 0);
  assert.ok(before - target.hp >= 200 + queued, 'the next normal attack receives the stored damage once');
  assert.equal(battle.errorCount, 0);
});

test('Ammo pact adds real clip rounds on each ammo-skill activation and last round deals once without refund', () => {
  const { battle, units } = makeBattle('ammo', { ammo: true });
  battle.start();
  const unit = units[0];
  let sp = 0;
  unit.skill.gainSp = (amount) => { sp += amount; };
  assert.equal(unit.skill.activate('pact-ammo-test', { free: true }), true);
  assert.equal(unit.skill.ammoLeft, 3, 'two native fixture rounds plus one v2 pact round');
  const target = battle.spawnEnemy('current-ammo-target', { pos: [unit.y, unit.x + 2], def: enemyRec({ key: 'current-ammo-target', hp: 1e6, atk: 0, speed: 0 }) });
  const ammoProcHits = [];
  const dealDamage = battle.dealDamage.bind(battle);
  battle.dealDamage = (source, victim, damage) => { if (source === unit && damage?.tags?.includes('resonance')) ammoProcHits.push(damage.amount); return dealDamage(source, victim, damage); };
  unit.skill.onAttackPerformed([target]);
  unit.skill.onAttackPerformed([target]);
  const before = target.hp;
  unit.skill.onAttackPerformed([target]);
  assert.equal(unit.skill.active, false);
  assert.ok(before - target.hp >= unit.s.atk * 0.8, 'the clip-ending shot adds the configured physical hit');
  assert.equal(ammoProcHits.length, 1, 'only one rider occurs at the true last round');
  assert.equal(ammoProcHits[0], unit.s.atk * 0.8);
  assert.equal(sp, 0, 'ammo use no longer returns SP');
  assert.equal(unit.skill.activate('second-pact-ammo-test', { free: true }), true);
  assert.equal(unit.skill.ammoLeft, 3, 'the pact adds rounds again on the next genuine activation');
  assert.equal(battle.errorCount, 0);
  for (const [count, added] of [[2, 1], [4, 2]]) {
    const tier = makeBattle('ammo', { ammo: true, count });
    tier.battle.start();
    assert.equal(tier.units[0].skill.activate('tier-ammo-test', { free: true }), true);
    assert.equal(tier.units[0].skill.ammoLeft, 2 + added, `${count}-member tier adds ${added} loaded rounds`);
  }
});

test('v1 Siracusa damage-cycle SP and queued damage-on-skill-hit remain legacy-only', () => {
  for (const [catalog, expectedSp, expectedCycleBonus] of [[legacy, 3, true], [current, 0, false]]) {
    const { battle, units } = makeBattle('siracusa', { catalog });
    battle.start();
    const unit = units[0], p = catalog.pacts.siracusa.levels[0].effects.find((effect) => effect.kind === 'siracusa_execute').params;
    let sp = 0;
    unit.skill.gainSp = (amount) => { sp += amount; };
    const target = spawnDummy(battle, [unit.y, unit.x + 2]);
    battle.dealDamage(unit, target, { amount: p.damageCycle, type: 'true', canDodge: false });
    assert.equal(sp, expectedSp, `${catalog === legacy ? 'v1' : 'v2'} damage-cycle SP behavior`);
    assert.equal(Number(unit.mem.siracusaNextHit ?? 0) > 0, expectedCycleBonus, 'only v1 damage-cycle grants the queued bonus');

    unit.mem.siracusaNextHit = 77;
    const beforeSkill = target.hp;
    battle.dealDamage(unit, target, { amount: 100, type: 'phys', isSkill: true, canDodge: false });
    assert.equal(Number(unit.mem.siracusaNextHit ?? 0), catalog === legacy ? 0 : 77, 'v1 consumes queued bonus on any hit; v2 waits for a basic attack');
    assert.ok(beforeSkill - target.hp >= (catalog === legacy ? 177 : 100));
    if (catalog === current) {
      battle.dealDamage(unit, target, { amount: 100, type: 'phys', isAttack: true, isSkill: false, canDodge: false });
      assert.equal(unit.mem.siracusaNextHit, 0, 'v2 consumes the queued bonus on its next basic attack');
    }
    assert.equal(battle.errorCount, 0);
  }
});

test('v1 Ammo retains its probabilistic half-SP refund while v2 never refunds SP', () => {
  for (const [catalog, expectedSp] of [[legacy, .5], [current, 0]]) {
    const { battle, units } = makeBattle('ammo', { catalog, ammo: true });
    battle.start();
    const unit = units[0]; let sp = 0;
    unit.skill.gainSp = (amount) => { sp += amount; };
    battle.rng = () => .1;
    assert.equal(unit.skill.activate(`ammo-compat-${catalog === legacy ? 'v1' : 'v2'}`, { free: true }), true);
    const target = spawnDummy(battle, [unit.y, unit.x + 2]);
    unit.skill.onAttackPerformed([target]);
    assert.equal(sp, expectedSp, `${catalog === legacy ? 'v1' : 'v2'} ammo refund behavior`);
    assert.equal(battle.errorCount, 0);
  }
});

test('unknown current pact effects remain rejected', () => {
  const malformed = structuredClone(current);
  malformed.pacts.ammo.levels[0].effects.push({ kind: 'invented_current_effect', params: {} });
  assert.throws(() => installResonancePacts({ allyUnits: [] }, { catalog: malformed, state: { rulesVersion: 2 } }), /UNKNOWN_RESONANCE_PACT_EFFECT:ammo:invented_current_effect/);
});

test('v2 Necrosis burst keeps the damage-over-time effect without SP; v1 keeps its original SP reward', () => {
  for (const [catalog, expectedSp] of [[current, 0], [legacy, 3]]) {
    const { battle, units } = makeBattle('necrosis', { catalog });
    battle.start();
    let sp = 0;
    units[0].skill.gainSp = (amount) => { sp += amount; };
    const target = battle.spawnEnemy('current-necrosis-target', { pos: [units[0].y, units[0].x + 2], def: enemyRec({ key: 'current-necrosis-target', hp: 1e6, atk: 0, speed: 0 }) });
    target.s.flags.necrosis = true;
    target.s.flags.necrosisBurst = true;
    battle.dealDamage(units[0], target, { amount: catalog===current?target.gaugeMax:1, type: 'element', element: 'apoptosis', canDodge: false });
    assert.equal(sp, expectedSp);
    assert.ok(target.buffs.some((buff) => buff.key === 'resonance:necrosis:pact'), 'the supported burst DOT still applies');
    assert.equal(battle.errorCount, 0);
  }
  assert.ok(current.pacts.necrosis.levels.every((row) => row.effects.find((effect) => effect.kind === 'necrosis_burst').params.firstBurstSp === 0));
  assert.match(current.playerText.pacts.necrosis.levels[0].description, /凋亡爆发目标每秒/);
  assert.doesNotMatch(current.playerText.pacts.necrosis.levels[0].description, /技力/);
});
