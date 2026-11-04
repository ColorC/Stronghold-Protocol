import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { clearCardSummons } from '../helpers/summonFixture.js';
import { toAssaultSimData } from '../../shared/assault/catalog.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { installRelics, computeRelicDeploymentCost } from '../../server/sim/content/assault/relics.js';
import { grantSummon, ledgerFor, returnSummon } from '../../server/sim/content/assault/summons.js';
import { createRun, applyAction } from '../../shared/assault/run.js';
import { getData } from '../../server/data.js';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';

const design = loadAssaultDesign();
const runtimeData = loadAssaultRuntime();
const assaultData = getAssaultData({ runtime: runtimeData });

const close = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) < 1e-9,
  `${message}: expected ${expected}, got ${actual}`,
);

function card(uid, charId, { star = 4, row = 10, col = 5 } = {}) {
  const body = runtimeData.bodies[charId];
  assert.ok(body, `missing Assault body ${charId}`);
  const piece = {
    uid,
    charId,
    star,
    fixedSkill: body.fixedSkill,
    moduleId: null,
    moduleChoices: {},
    sourceCopies: 1,
    permanentFlat: {},
    permanentPercent: {},
    claimed: [],
    tagEdits: { add: [], remove: [] },
  };
  const chess = chessRec({
    id: `chess:${uid}`,
    charId,
    profession: body.profession,
    position: body.position,
    subProf: body.subProfessionId,
    stats: body.starStats[star - 1].stats,
    rangeGrid: body.range,
  });
  chess.trait = structuredClone(body.simChess.trait);
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  return { uid, chess, piece, row, col };
}

function findChar(predicate, label) {
  const found = Object.entries(runtimeData.bodies).find(([charId, body]) =>
    assaultKits[charId] && body.fixedSkill && predicate(body));
  assert.ok(found, `missing source-backed ${label}`);
  return found[0];
}

function professionChar(profession) {
  return findChar((body) => body.profession === profession, profession);
}

function archetypeChar(archetype) {
  const aliases = {
    '无畏者': ['无畏者', 'dreadnought', 'fearless'],
    '收割者': ['收割者', 'reaper'],
    '所有攻击者': [],
  };
  const wanted = new Set(aliases[archetype] ?? [archetype]);
  return findChar((body) => [
    body.archetype,
    body.subProfession,
    body.subProfessionId,
    ...(body.tags ?? []),
  ].filter(Boolean).map(String).some((value) => wanted.has(value)), archetype);
}

const enemy = (key, pos, opts = {}) => ({
  key,
  pos,
  record: enemyRec({
    key,
    hp: opts.hp ?? 100000000,
    atk: opts.atk ?? 0,
    def: opts.def ?? 0,
    res: opts.res ?? 0,
    speed: 0,
    ...opts,
  }),
});

function makeBattle({
  relicIds,
  cards = [card('owner', 'char_1045_svash2')],
  enemies = [],
  dpInit = 99,
  seed = 7,
} = {}) {
  const chess = Object.fromEntries(cards.map((entry) => [entry.chess.chessId, entry.chess]));
  const enemyRecords = Object.fromEntries(enemies.map((entry) => [entry.key, entry.record]));
  const data = new DataSource({
    ...toAssaultSimData(runtimeData, assaultData.nativeData),
    chess,
    enemies: enemyRecords,
  }, getDefaultSource());
  const prepared = {
    input: {
      relicIds,
      pieces: cards.map((entry) => entry.piece),
      gold: 20,
      derivedBuffInputs: [],
    },
  };
  const battle = new Battle({
    seed,
    kind: 'normal',
    modeId: 'assault-relic-redeploy-summon-cross-behavior',
    stage: flatStage(),
    routes: flatRoutes(),
    spawns: [],
    data,
    players: [{
      playerId: 'p1',
      units: cards.map((entry) => ({
        uid: entry.uid,
        chessId: entry.chess.chessId,
        row: entry.row,
        col: entry.col,
      })),
    }],
    content: 'assault',
    assault: {
      kits: assaultKits,
      strict: true,
      install: (b) => installRelics(b, prepared, { design }),
    },
    flags: { dpInit, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 },
    autoFinish: false,
    timeLimit: 60,
    quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} },
  });
  battle.start();
  battle.assaultRuntime.flush();
  // the fixture grants its own summons: a synergy summoner's deployment summon is set aside
  clearCardSummons(battle);
  const liveEnemies = enemies.map((entry) => battle.spawnEnemy(entry.key, {
    routeIndex: 0,
    pos: entry.pos,
  }));
  return {
    battle,
    units: cards.map((entry) => battle.allyUnits.find((unit) => unit.uid === entry.uid)),
    enemies: liveEnemies,
  };
}

const flush = (battle) => battle.assaultRuntime.flush();

test('redeploy effects use real deployment boundaries and independent consumers', () => {
  const airdrop = makeBattle({
    relicIds: ['redeploy-airdrop'],
    dpInit: 0,
    cards: [card('airdrop-owner', 'char_1045_svash2')],
    enemies: [
      enemy('airdrop-target', [10, 8], { hp: 1000000, def: 0 }),
      enemy('airdrop-neighbor', [10, 9], { hp: 1000000, def: 0 }),
    ],
  });
  const [airdropOwner] = airdrop.units;
  const [airdropTarget, airdropNeighbor] = airdrop.enemies;
  const before = airdropTarget.hp;
  const neighborBefore = airdropNeighbor.hp;
  airdrop.battle.step(); // the opening entry is free and happens before any enemy exists; the strike needs a paid redeploy
  airdrop.battle.retreat(airdropOwner, { reason: 'test' });
  flush(airdrop.battle);
  airdrop.battle.addDp('p1', 99);
  assert.equal(airdrop.battle.redeploy(airdropOwner, { free: false }), true);
  flush(airdrop.battle);
  close(airdropOwner.s.redeployMul, 0.75, 'airdrop opening redeploy multiplier');
  close(before - airdropTarget.hp, airdropOwner.s.atk * 1.5, 'airdrop physical damage');
  close(neighborBefore - airdropNeighbor.hp, airdropOwner.s.atk * 1.5, 'airdrop hits the selected target eight-neighbor');

  const medic = professionChar('MEDIC');
  const spring = makeBattle({
    relicIds: ['redeploy-spring'],
    cards: [
      card('medic', medic, { row: 9, col: 5 }),
      card('spring-1', 'char_1045_svash2', { row: 10, col: 5 }),
      card('spring-2', 'char_1045_svash2', { row: 11, col: 5 }),
      card('spring-3', 'char_1045_svash2', { row: 12, col: 5 }),
      card('spring-4', 'char_1045_svash2', { row: 10, col: 6 }),
    ],
  });
  close(spring.units[0].s.redeployMul, 0.95 ** 4, 'spring four-stack cap');

  const special = makeBattle({
    relicIds: ['redeploy-newedict', 'redeploy-specialstill'],
    cards: [card('special', 'char_237_gravel')],
  });
  const [specialUnit] = special.units;
  close(specialUnit.mem.assaultNextRedeployMul, 0.75, 'newedict pending marker');
  close(specialUnit.s.redeployMul, 0.8, 'specialstill persistent multiplier');
  assert.equal(special.battle.skillRedeploy(specialUnit), true);
  flush(special.battle);
  close(specialUnit.mem.assaultNextRedeployMul, 0.75, 'skill redeploy does not consume newedict');
  special.battle.retreat(specialUnit, { reason: 'test' });
  flush(special.battle);
  const cooldownBeforeRedeploy = specialUnit.respawnAt;
  close(cooldownBeforeRedeploy, special.battle.time + specialUnit.base.respawnTime * 0.8 * 0.75, 'newedict modifies the specialstill-adjusted real retreat cooldown');
  assert.equal(specialUnit.mem.assaultNextRedeployMul, undefined, 'newedict is consumed by the real retreat');
  assert.equal(special.battle.redeploy(specialUnit), true);
  flush(special.battle);
  close(specialUnit.mem.assaultNextRedeployMul, 0.75, 'newedict is regranted by the real redeployment');
  close(specialUnit.s.redeployMul, 0.8, 'specialstill does not multiply on refresh');

  const pioneer = professionChar('PIONEER');
  const rally = makeBattle({
    relicIds: ['redeploy-vanguardrally'],
    cards: [
      card('pioneer', pioneer, { row: 10, col: 5 }),
      card('waiting-a', 'char_1045_svash2', { row: 10, col: 6 }),
      card('waiting-b', 'char_1045_svash2', { row: 10, col: 7 }),
    ],
  });
  const [rallyPioneer, waitingA, waitingB] = rally.units;
  rally.battle.retreat(waitingA, { reason: 'test' });
  rally.battle.retreat(waitingB, { reason: 'test' });
  flush(rally.battle);
  const longestUnit = waitingA.respawnAt >= waitingB.respawnAt ? waitingA : waitingB;
  const other = longestUnit === waitingA ? waitingB : waitingA;
  const longest = longestUnit.respawnAt;
  rally.battle.retreat(rallyPioneer, { reason: 'test' });
  flush(rally.battle);
  assert.equal(rally.battle.redeploy(rallyPioneer), true);
  flush(rally.battle);
  close(
    longestUnit.respawnAt,
    rally.battle.time + (longest - rally.battle.time) * 0.7,
    'vanguard rally halves the longest waiting ally',
  );
  const otherBefore = other.respawnAt;
  rally.battle.retreat(rallyPioneer, { reason: 'test' });
  flush(rally.battle);
  assert.equal(rally.battle.redeploy(rallyPioneer), true);
  flush(rally.battle);
  close(
    other.respawnAt,
    rally.battle.time + (otherBefore - rally.battle.time) * 0.7,
    'second pioneer deployment settles independently',
  );
});

test('summon buffs and deployment-cost floors reach the real token consumer', () => {
  const setup = makeBattle({
    relicIds: ['summon-minorbattle', 'summon-derivative', 'summon-poeticrelic', 'cross-bundle'],
    cards: [card('summon-owner', 'char_2023_ling')],
  });
  const [owner] = setup.units;
  const ownerAtk = owner.s.atk;
  const result = grantSummon(setup.battle, owner, {
    tokenId: 'token_10020_ling_soul3',
    count: 1,
    stockCap: 1,
    fieldCap: 1,
    cost: 12,
  });
  assert.equal(result.spawned, 1);
  flush(setup.battle);
  const token = [...ledgerFor(setup.battle, owner).activeByKey.values()][0].unit;
  assert.ok(token.base.atk > 0, 'native Ling summon has a real positive ATK base');
  close(token.s.atk / token.base.atk, 1.2 * 1.15 * 1.15, 'summon attack modifiers');
  close(token.s.maxHp / token.base.maxHp, 1.15, 'summon max-hp modifier');
  close(token.s.aspd - token.base.aspd, 15, 'summon attack-speed modifier');
  assert.ok(token.base.respawnTime > 0, 'native Ling token has a nonzero respawn interval');
  close(token.s.bat / token.base.bat, 0.85, 'cross-bundle applies its attack-interval multiplier to the native Ling token');
  close(owner.s.atk, ownerAtk, 'summon buffs do not modify owner attack');
  assert.equal(computeRelicDeploymentCost(setup.battle, token, 4), 2, 'cross-bundle removes its authored two DP from the real summon cost');

  const minor = makeBattle({ relicIds: ['summon-minorbattle'], cards: [card('minor-owner', 'char_2023_ling')] });
  const [minorOwner] = minor.units;
  assert.equal(grantSummon(minor.battle, minorOwner, { tokenId: 'token_10020_ling_soul3', count: 1,
    stockCap: 1, fieldCap: 1, cost: 0 }).spawned, 1);
  flush(minor.battle);
  const minorToken = [...ledgerFor(minor.battle, minorOwner).activeByKey.values()][0].unit;
  close(minorToken.s.atk / minorToken.base.atk, 1.2, 'minor battle grants an isolated timed 20% summon attack bonus');
  assert.ok(minorToken.buffs.some((entry) => entry.key === 'relic:summon-minorbattle:0' && Math.abs(entry.timeLeft - 5) < 1e-9));

  const derivative = makeBattle({ relicIds: ['summon-derivative'], cards: [card('derivative-owner', 'char_2023_ling')] });
  const [derivativeOwner] = derivative.units;
  assert.equal(grantSummon(derivative.battle, derivativeOwner, { tokenId: 'token_10020_ling_soul3', count: 1,
    stockCap: 1, fieldCap: 1, cost: 0 }).spawned, 1);
  flush(derivative.battle);
  const derivativeToken = [...ledgerFor(derivative.battle, derivativeOwner).activeByKey.values()][0].unit;
  close(derivativeToken.s.atk / derivativeToken.base.atk, 1.15, 'derivative grants exactly 15% summon attack');
  close(derivativeToken.s.maxHp / derivativeToken.base.maxHp, 1.15, 'derivative grants exactly 15% summon maximum HP');
  close(derivativeToken.s.aspd - derivativeToken.base.aspd, 15, 'derivative grants exactly 15 summon ASPD');

  const fee = makeBattle({ relicIds: ['summon-ledger'], cards: [card('ledger-owner', 'char_2023_ling')], dpInit: 99 });
  const [feeOwner] = fee.units;
  const feeBefore = fee.battle.getPlayer('p1').dp;
  assert.equal(grantSummon(fee.battle, feeOwner, { tokenId: 'token_10020_ling_soul3', count: 1,
    stockCap: 1, fieldCap: 1, cost: 12 }).spawned, 1);
  flush(fee.battle);
  assert.equal(feeBefore - fee.battle.getPlayer('p1').dp, 9, 'summon-ledger removes exactly three from a real 12-DP summon deployment');
  assert.equal(fee.battle.errors.length, 0);

  const cadence = (withBundle) => {
    const battle = makeBattle({
      relicIds: withBundle ? ['cross-bundle'] : [],
      cards: [card(`cadence-owner-${withBundle}`, 'char_2023_ling', { row: 9, col: 7 })],
      enemies: [enemy(`cadence-target-${withBundle}`, [9, 8], { hp: 100000, def: 0, speed: 0 })],
    });
    const [summoner] = battle.units;
    assert.equal(grantSummon(battle.battle, summoner, { tokenId: 'token_10028_vigil_wolf',
      count: 1, stockCap: 1, fieldCap: 1, cost: 0 }).spawned, 1);
    flush(battle.battle);
    const summoned = [...ledgerFor(battle.battle, summoner).activeByKey.values()][0].unit;
    let attacks = 0;
    battle.battle.on('attack', (event) => {
      const payload = event.payload ?? event;
      if (payload.attacker === summoned) attacks += 1;
    });
    while (battle.battle.time < 20 && !battle.battle.finished) {
      battle.battle.step();
      flush(battle.battle);
    }
    return { attacks, unit: summoned, target: battle.enemies[0], time: battle.battle.time,
      enemyActive: battle.battle.enemies[0]?.deployed, enemyAlive: battle.battle.enemies[0]?.alive,
      canAct: summoned.canAct, attackCd: summoned.atkCd, rangeKeys: summoned.rangeKeys?.length,
      enemyPos: battle.battle.enemies[0] && [battle.battle.enemies[0].x, battle.battle.enemies[0].y], blocked: battle.battle.enemies[0]?.blockedBy?.uid,
      rangeTiles: summoned.rangeKeys, targetCount: battle.battle.enemiesInKeys(summoned.rangeKeys, summoned, summoned.profile).length,
      noAttack: summoned.profile?.noAttack };
  };
  const cadenceControl = cadence(false);
  const cadenceBundle = cadence(true);
  assert.ok(cadenceBundle.attacks > cadenceControl.attacks,
    `shorter native interval produces more attacks in the same window (${cadenceBundle.attacks} > ${cadenceControl.attacks}); tile=${cadenceBundle.unit.tileR},${cadenceBundle.unit.tileC}, interval=${cadenceBundle.unit.s.interval}, time=${cadenceBundle.time}, canAct=${cadenceBundle.canAct}, cd=${cadenceBundle.attackCd}, rangeKeys=${JSON.stringify(cadenceBundle.unit.rangeKeys)}, targetCount=${cadenceBundle.targetCount}, noAttack=${cadenceBundle.noAttack}, enemyActive=${cadenceBundle.enemyActive}, enemyAlive=${cadenceBundle.enemyAlive}, enemyPos=${JSON.stringify(cadenceBundle.enemyPos)}, blocked=${cadenceBundle.blocked}`);
});

test('hunter insight applies exact physical and arts penetration plus native pause on actual hits', () => {
  const setup = makeBattle({ relicIds: ['pierce-hunterinsight'],
    cards: [card('hunter-owner', 'char_1045_svash2')],
    enemies: [enemy('hunter-target', [10, 8], { hp: 100000, def: 400, res: 200 })] });
  const [owner] = setup.units;
  const [target] = setup.enemies;
  const beforePhysical = target.hp;
  setup.battle.dealDamage(owner, target, { amount: 1000, type: 'phys', isAttack: true, canDodge: false });
  flush(setup.battle);
  assert.equal(beforePhysical - target.hp, 700, '25% defense ignore leaves 300 defense');
  close(target.buffs.find((entry) => entry.status === 'stun')?.timeLeft, 0.3, 'physical hit pause duration');
  const beforeArts = target.hp;
  setup.battle.dealDamage(owner, target, { amount: 1000, type: 'arts', isAttack: true, canDodge: false });
  flush(setup.battle);
  close(beforeArts - target.hp, 1000 * (1 - target.s.res * 0.75 / 100), 'arts damage uses native resistance after 25% ignore');
  close(target.buffs.find((entry) => entry.status === 'stun')?.timeLeft, 0.3, 'arts hit refreshes native pause duration');
});

test('arctic pack uses real owner attribution, net SP, capped healing, and re-entry', () => {
  const setup = makeBattle({
    relicIds: ['summon-arcticpack'],
    cards: [
      card('ironmn-owner', 'char_4072_ironmn', { row: 10, col: 5 }),
      card('adjacent-ally', 'char_1045_svash2', { row: 10, col: 7 }),
      card('distant-ally', 'char_1045_svash2', { row: 10, col: 9 }),
    ],
  });
  const [owner, ally, distantAlly] = setup.units;
  assert.ok(ally.skill);
  assert.equal(distantAlly.deployed, true, 'distant unit is a real deployed ally outside the four-neighbor radius');
  ally.skill.setSpTotal(0);
  distantAlly.skill.setSpTotal(0);
  const healAmount = owner.s.atk * 0.2;
  ally.hp = ally.s.maxHp - healAmount * 2;
  const hpBefore = ally.hp;
  const spBefore = ally.skill.sp;
  const distantHpBefore = distantAlly.hp;
  const distantSpBefore = distantAlly.skill.sp;
  const result = grantSummon(setup.battle, owner, {
    tokenId: 'token_10027_ironmn_pile2',
    count: 2,
    stockCap: 2,
    fieldCap: 1,
    cost: 0,
  });
  assert.equal(result.spawned, 1);
  assert.equal(result.pending, 1);
  flush(setup.battle);
  close(ally.hp - hpBefore, healAmount, 'first real-entry heal');
  close(ally.skill.sp - spBefore, Math.min(2, ally.skill.spCost - spBefore), 'first real-entry net SP');
  close(distantAlly.hp, distantHpBefore, 'arctic pack does not heal outside its four-neighbor area');
  close(distantAlly.skill.sp, distantSpBefore, 'arctic pack does not grant SP outside its four-neighbor area');

  const first = [...ledgerFor(setup.battle, owner).activeByKey.values()][0].unit;
  assert.equal(returnSummon(setup.battle, owner, first, 'test-return'), true);
  ally.skill.setSpTotal(0);
  ally.hp = ally.s.maxHp - 1;
  const cappedBefore = ally.hp;
  setup.battle.step();
  flush(setup.battle);
  const second = [...ledgerFor(setup.battle, owner).activeByKey.values()]
    .map((entry) => entry.unit)
    .find((unit) => unit.id !== first.id);
  assert.ok(second);
  close(ally.hp, ally.s.maxHp, 'second real-entry heal caps at max HP');
  assert.equal(ally.hp - cappedBefore, 1);
});

test('pierce damage and kill healing use native damage and kill paths', () => {
  for (const [relicId, archetype, ignore] of [
    ['pierce-rendhand', '无畏者', 0.35],
    ['pierce-rockhand', '收割者', 0.35],
  ]) {
    const sourceChar = archetypeChar(archetype);
    const setup = makeBattle({
      relicIds: [relicId],
      cards: [card('pierce-source', sourceChar)],
      enemies: [enemy('pierce-target', [10, 8], { hp: 1000000, def: 100 })],
    });
    const [source] = setup.units;
    const [target] = setup.enemies;
    const amount = source.s.atk;
    const before = target.hp;
    setup.battle.dealDamage(source, target, { amount, type: 'phys', canDodge: false });
    flush(setup.battle);
    close(
      before - target.hp,
      Math.max(amount - 100 * (1 - ignore), amount * 0.05),
      `${relicId} physical defense boundary`,
    );
  }

  const rockChar = archetypeChar('收割者');
  const kill = makeBattle({
    relicIds: ['pierce-rockhand'],
    cards: [card('killer', rockChar)],
    enemies: [enemy('victim', [10, 8], { hp: 1, def: 0 })],
  });
  const [killer] = kill.units;
  const [victim] = kill.enemies;
  setupInjury(kill.battle, kill.enemies[0], killer, killer.s.maxHp * 0.1);
  const hpBefore = killer.hp;
  kill.battle.dealDamage(killer, victim, { amount: killer.s.atk, type: 'phys', canDodge: false });
  flush(kill.battle);
  assert.equal(victim.alive, false);
  const relicHeal = killer.hp - hpBefore;
  const control = makeBattle({
    relicIds: [],
    cards: [card('control-killer', rockChar)],
    enemies: [enemy('control-victim', [10, 8], { hp: 1, def: 0 })],
  });
  const [controlKiller] = control.units;
  const [controlVictim] = control.enemies;
  setupInjury(control.battle, controlVictim, controlKiller, controlKiller.s.maxHp * 0.1);
  const controlBefore = controlKiller.hp;
  control.battle.dealDamage(controlKiller, controlVictim, { amount: controlKiller.s.atk, type: 'phys', canDodge: false });
  flush(control.battle);
  assert.equal(controlVictim.alive, false);
  close(relicHeal - (controlKiller.hp - controlBefore), killer.s.maxHp * 0.015, 'rockhand adds 1.5% max HP beyond the native kill heal');
});

function setupInjury(battle, enemyUnit, allyUnit, amount = 100) {
  // a card's barrier (a synergy card's 部署时 屏障, e.g. 休谟斯) would take the injury the test needs
  for (const b of [...allyUnit.buffs].filter((x) => x.shield > 0)) battle.removeBuff(allyUnit, b);
  battle.dealDamage(enemyUnit, allyUnit, { amount, type: 'true', canDodge: false });
  battle.assaultRuntime.flush();
}

test('battle-start cross effects retain exact caps and affect spawned enemies', () => {
  const hound = makeBattle({
    relicIds: ['cross-houndcoffee'],
    cards: [card('hound-owner', 'char_1045_svash2')],
    enemies: [
      enemy('hound-a', [10, 8], { hp: 1000 }),
      enemy('hound-b', [11, 8], { hp: 1000 }),
    ],
  });
  const [houndOwner] = hound.units;
  close(houndOwner.s.maxHp / houndOwner.base.maxHp, 1.15, 'hound coffee max HP');
  close(houndOwner.s.atk / houndOwner.base.atk, 1.15, 'hound coffee attack');
  hound.battle.step();
  flush(hound.battle);
  const marked = hound.enemies.filter((unit) => Math.abs(unit.s.maxHp / unit.base.maxHp - 1.5) < 1e-9);
  assert.equal(marked.length, 1, 'hound coffee marks exactly one real enemy');
  const late = hound.battle.spawnEnemy('hound-late', { routeIndex: 0, pos: [12, 8] });
  hound.battle.step();
  flush(hound.battle);
  assert.equal(late.s.maxHp / late.base.maxHp, 1, 'hound coffee does not reselect later enemies');

  const breeder = makeBattle({
    relicIds: ['pierce-breederseed'],
    cards: [card('breeder-owner', 'char_1045_svash2'), card('breeder-ally', 'char_1045_svash2', { row: 11, col: 5 })],
  });
  for (const ally of breeder.units) {
    close(ally.s.defIgnorePct, 0.15, 'breeder defense penetration');
    close(ally.s.resIgnorePct, 0.15, 'breeder resistance penetration');
    close(ally.s.dmgTakenMul, 0.9, 'breeder shelter');
  }
});

test('everlight, shadow refund, and frost sigil end or persist at their stated boundary', () => {
  const everlight = makeBattle({
    relicIds: ['cross-everlight'],
    cards: [
      card('ranged-first', 'char_332_archet', { row: 10, col: 2 }), // 空弦: her deployment buffs no one's attack (能天使's 天使的祝福 would)
      card('ground-second', 'char_1045_svash2', { row: 10, col: 5 }),
    ],
  });
  const ground = everlight.units[1];
  close(ground.s.atk / ground.base.atk, 1.2, 'everlight first-ground attack');
  close(ground.s.elemTakenMul, 0.75, 'everlight element damage intake');
  assert.equal(ground.buffs.some((entry) => entry.status === 'resist'), true);
  everlight.battle.retreat(ground, { reason: 'test' });
  flush(everlight.battle);
  assert.equal(ground.buffs.some((entry) => entry.key === 'relic:cross-everlight:0'), false);

  const shadow = makeBattle({
    relicIds: ['cross-shadow'],
    dpInit: 0,
    cards: [card('shadow-target', 'char_1045_svash2')],
  });
  const [shadowUnit] = shadow.units;
  // The opening entry is free (PRTS: 开战时作战区全部单位免费部署), so no operator waits in the standby area at battle
  // start and this relic has nobody to mark. See docs/assault-mode audit-original-fidelity.md (item 7 dependencies).
  close(shadowUnit.s.blockCnt, shadowUnit.base.blockCnt, 'shadow marks nobody without a waiting operator');
  close(shadowUnit.s.def, shadowUnit.base.def, 'shadow defense unchanged');
  shadow.battle.retreat(shadowUnit, { reason: 'test' });
  shadow.battle.addDp('p1', 99);
  const available = shadow.battle.getPlayer('p1').dp;
  assert.equal(shadow.battle.redeploy(shadowUnit, { free: false }), true);
  flush(shadow.battle);
  close(shadow.battle.getPlayer('p1').dp, available - shadowUnit.base.cost, 'a paid redeploy has no refund without the mark');

  const frost = makeBattle({
    relicIds: ['leader-svash2-frostsigil'],
    cards: [card('frost-owner', 'char_1045_svash2')],
    enemies: [enemy('frost-target', [10, 8], { hp: 1000000 })],
  });
  const [frostOwner] = frost.units;
  const [frostTarget] = frost.enemies;
  close(frostOwner.s.redeployMul, 0.7, 'frost sigil redeploy multiplier');
  frost.battle.forceAttack(frostOwner, [frostTarget]);
  flush(frost.battle);
  const cold = frostTarget.buffs.find((entry) => entry.status === 'cold');
  assert.equal(Boolean(cold), true);
  close(cold.timeLeft, 1, 'frost sigil native cold duration');
  frost.battle.retreat(frostOwner, { reason: 'test' });
  flush(frost.battle);
  assert.equal(frostOwner.buffs.some((entry) => entry.key === 'relic:leader-svash2-frostsigil:0'), false);
});

test('old coins and flawless jade pay their exact one-time reward acquisition amounts', () => {
  const context = { catalog: runtimeData, design };
  for (const [relicId, amount] of [['econ-oldcoins', 6], ['econ-flawlessjade', 15]]) {
    const run = createRun({ runId: `relic-acquisition-${relicId}`, seed: 31,
      directorId: design.system.directors[0].id }, context);
    run.phase = 'rewards';
    run.rewardQueue = { kind: 'relic', choices: [relicId], source: 'battle' };
    const goldBefore = run.gold;
    const result = applyAction(run, { type: 'chooseRelic', relicId, opId: `acquire-${relicId}`,
      expectedRevision: run.revision }, context);
    assert.equal(result.state.gold - goldBefore, amount, `${relicId} exact acquisition gold`);
    assert.ok(result.state.claimed.includes(`relic:${relicId}:0`), `${relicId} records its one-time claim`);
  }
});

test('shared hour and shop effects traverse real applyAction entry points', () => {
  const ctx = { catalog: runtimeData, design };
  assert.ok(ctx.catalog?.operators && ctx.catalog?.bodies);

  const shopRun = createRun({
    runId: 'relic-cross-shop',
    seed: 11,
    directorId: design.system.directors[0].id,
  }, ctx);
  shopRun.relicIds.push('cross-lancepro');
  const shopNode = shopRun.nodeChoices.find((node) => node.kind === 'shop');
  assert.ok(shopNode);
  let applied = applyAction(shopRun, {
    type: 'selectNode',
    nodeId: shopNode.id,
    opId: 'select-shop',
    expectedRevision: shopRun.revision,
  }, ctx);
  let state = applied.state;
  const before = state.shop.refreshCost;
  const goldBeforeDiscountedRefresh = state.gold;
  applied = applyAction(state, {
    type: 'refreshShop',
    opId: 'refresh-shop',
    expectedRevision: state.revision,
  }, ctx);
  state = applied.state;
  const discountedCost = state.shop.refreshCost;
  const discountedGoldSpent = goldBeforeDiscountedRefresh - state.gold;
  const firstDiscountedRefreshCost = discountedCost;
  const afterRefresh = structuredClone(state);
  assert.throws(() => applyAction(state, { type: 'refreshShop', opId: 'refresh-shop-again',
    expectedRevision: state.revision }, ctx), { code: 'SHOP_REFRESH_LIMIT' },
  'the current merchant allows one refresh');
  assert.deepEqual(state, afterRefresh, 'a refused second refresh spends nothing and changes no discount');
  assert.equal(state.shop.refreshCost, firstDiscountedRefreshCost, 'the quoted relic discount does not accumulate');
  assert.equal(discountedGoldSpent, firstDiscountedRefreshCost, 'the first refresh paid the displayed discounted quote');
  const controlRun = createRun({ runId: 'relic-cross-shop-control', seed: 11, directorId: design.system.directors[0].id }, ctx);
  const controlNode = controlRun.nodeChoices.find((node) => node.kind === 'shop');
  assert.ok(controlNode);
  assert.equal(controlNode.shopId, shopNode.shopId, 'control uses the identical shop definition');
  let control = applyAction(controlRun, { type: 'selectNode', nodeId: controlNode.id, opId: 'select-control-shop', expectedRevision: controlRun.revision }, ctx).state;
  const controlBefore = control.shop.refreshCost;
  const controlGoldBefore = control.gold;
  control = applyAction(control, { type: 'refreshShop', opId: 'refresh-control', expectedRevision: control.revision }, ctx).state;
  assert.equal(discountedCost, Math.max(1, before - 1), 'lancepro applies the existing one-cost discount');
  assert.equal(control.shop.refreshCost, controlBefore, 'control refresh follows the normal shop schedule');
  assert.equal(controlBefore - discountedCost, 1, 'lancepro reduces the same real shop refresh quote by exactly one');
  assert.equal((controlGoldBefore - control.gold) - discountedGoldSpent, 1, 'net gold paid differs by exactly one');

  const hourContext = createAssaultContext({ data: getData(), runtime: runtimeData });
  const encounter = hourContext.design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const hourPiece = card('chivalry-owner', 'char_1045_svash2').piece;
  hourPiece.row = 10;
  hourPiece.col = 5;
  const prepared = prepareAssaultBattle({ runId: 'relic-cross-hour', seed: 13, life: 20,
    day: 1, hour: 2, gold: 39, relicIds: ['cross-chivalry'], pieces: [hourPiece],
    derivedBuffInputs: [{ relicId: 'cross-chivalry', attackSpeedStacks: 7, goldAtPreparation: 39 }] }, encounter, hourContext);
  prepared.derivedBuffInputs = [{ relicId: 'cross-chivalry', attackSpeedStacks: 7, goldAtPreparation: 39 }];
  const hourBattle = createAssaultBattle(prepared, hourContext);
  hourBattle.start();
  hourBattle.assaultRuntime.flush();
  const chivalryOwner = hourBattle.allyUnits.find((unit) => unit.def.charId === 'char_1045_svash2');
  assert.ok(chivalryOwner);
  assert.equal(chivalryOwner.s.aspd - runtimeData.bodies.char_1045_svash2.starStats[3].stats.aspd, 12,
    'native battle operator receives the six-stack cap of two ASPD per five gold');
});

test('run rewards use a real Assault battle result and settlement against a no-relic control', () => {
  const context = createAssaultContext({ data: getData(), runtime: runtimeData });
  const makeRun = (runId, relicIds) => {
    let state = createRun({ runId, seed: 20261009, directorId: context.design.system.directors[0].id }, context);
    state.relicIds.push(...relicIds);
    let node = state.nodeChoices.find((entry) => entry.kind === 'battle' && entry.battleKind === 'normal');
    let advance = 0;
    while (!node && advance < 8) {
      const next = state.nodeChoices.find((entry) => entry.kind === 'event')
        ?? state.nodeChoices.find((entry) => entry.kind === 'shop');
      assert.ok(next, 'run has a real event or shop route before a normal battle');
      state = applyAction(state, { type: 'selectNode', nodeId: next.id, opId: `${runId}:route:${advance}`, expectedRevision: state.revision }, context).state;
      state = applyAction(state, { type: state.phase === 'event' ? 'leaveEvent' : 'finishShop',
        opId: `${runId}:leave:${advance}`, expectedRevision: state.revision }, context).state;
      advance += 1;
      node = state.nodeChoices.find((entry) => entry.kind === 'battle' && entry.battleKind === 'normal');
    }
    assert.ok(node, 'run reaches a real normal battle node');
    state = applyAction(state, { type: 'selectNode', nodeId: node.id, opId: `${runId}:select`, expectedRevision: state.revision }, context).state;
    const used = new Set();
    for (const piece of state.pieces) {
      const tile = [...context.fieldFor(state).normalizedDeployMap.keys()].map((key) => key.split(',').map(Number))
        .find(([row, col]) => !used.has(`${row},${col}`) && context.canPlace(state, piece, row, col)
          && !state.pieces.some((other) => other.uid !== piece.uid && other.row === row && other.col === col));
      assert.ok(tile, `real formation tile for ${piece.uid}`);
      used.add(`${tile[0]},${tile[1]}`);
      state = applyAction(state, { type: 'place', uid: piece.uid, row: tile[0], col: tile[1], dir: 'E',
        opId: `${runId}:place:${piece.uid}`, expectedRevision: state.revision }, context).state;
    }
    state.life = state.maxLife - 1;
    state = applyAction(state, { type: 'readyBattle', opId: `${runId}:ready`, expectedRevision: state.revision }, context).state;
    const battleId = state.currentBattle.battleId;
    const settled = applyAction(state, { type: 'settleBattle', battleId, opId: `${runId}:settle`, expectedRevision: state.revision }, context);
    return { state: settled.state, result: settled.result, battleKind: node.battleKind };
  };
  const control = makeRun('relic-run-control', []);
  const equipped = makeRun('relic-run-economy', [
    'econ-scrapmedal', 'econ-friendship', 'econ-leithmedal', 'econ-rings', 'cross-lancepro', 'cross-chivalry', 'pierce-altar', 'cross-artinstall',
  ]);
  assert.equal(control.result.victory, true, 'control is won by the native runAssaultBattle driver');
  assert.equal(equipped.result.victory, true, 'relic run is won by the native runAssaultBattle driver');
  assert.equal(equipped.state.relicCounters['pierce-altar'], 1, 'first actual victory adds one permanent altar stack');
  const reward = equipped.battleKind === 'risk'
    ? context.design.system.run.riskReward : context.design.system.run.normalReward;
  const baseGold = reward.gold;
  const baseXp = reward.xp;
  const equippedSettlement = equipped.state.history.filter((entry) => entry.kind === 'battleSettled').at(-1);
  const controlSettlement = control.state.history.filter((entry) => entry.kind === 'battleSettled').at(-1);
  assert.equal(equippedSettlement.gold, Math.floor(baseGold * 1.4) + 1,
    'friendship, rings, and lancepro apply once to the actual battle reward');
  assert.equal(equippedSettlement.gold - controlSettlement.gold,
    Math.floor(baseGold * 1.4) + 1 - baseGold,
    'the authored gold modifiers account for the exact native settlement delta');
  assert.equal(equippedSettlement.xp - controlSettlement.xp, Math.floor(baseXp * 1.25) - baseXp,
    'scrap medal and leith medal account for the exact native XP settlement delta');
  // each run starts one life below the maximum and loses what its own battle leaked
  assert.equal(control.state.life, control.state.maxLife - 1 - control.result.leakedLife, 'control life is what its battle leaked');
  assert.equal(equipped.state.life, Math.min(equipped.state.maxLife, equipped.state.maxLife - 1 - equipped.result.leakedLife + 1),
    'artinstall restores one life after the actual settled battle');
  assert.equal(equipped.state.history.filter((entry) => entry.kind === 'battleSettled').at(-1).victory, true);

});

test('altar reaches its ten-stack cap only through ten native winning run battles', () => {
  const context = createAssaultContext({ data: getData(), runtime: runtimeData });
  let relicCounters = {};
  const battleIds = new Set();
  for (let win = 0; win < 10; win += 1) {
    let state = createRun({ runId: `relic-altar-native-${win}`, seed: 20261009,
      directorId: context.design.system.directors[0].id }, context);
    state.relicIds.push('pierce-altar');
    state.relicCounters = structuredClone(relicCounters);
    for (let routeIndex = 0; !state.nodeChoices.some((entry) => entry.kind === 'battle' && entry.battleKind === 'normal'); routeIndex += 1) {
      assert.ok(routeIndex < 4, 'fixed seed reaches a normal encounter through real event/shop actions');
      const route = state.nodeChoices.find((entry) => entry.kind === 'event')
        ?? state.nodeChoices.find((entry) => entry.kind === 'shop');
      assert.ok(route);
      state = applyAction(state, { type: 'selectNode', nodeId: route.id, opId: `altar:${win}:route:${routeIndex}`,
        expectedRevision: state.revision }, context).state;
      state = applyAction(state, { type: state.phase === 'event' ? 'leaveEvent' : 'finishShop',
        opId: `altar:${win}:leave:${routeIndex}`, expectedRevision: state.revision }, context).state;
    }
    const node = state.nodeChoices.find((entry) => entry.kind === 'battle' && entry.battleKind === 'normal');
    assert.ok(node, `normal battle route for altar settlement ${win + 1}`);
    state = applyAction(state, { type: 'selectNode', nodeId: node.id, opId: `altar:select:${win}`,
      expectedRevision: state.revision }, context).state;
    const used = new Set();
    for (const piece of state.pieces) {
      const tile = [...context.fieldFor(state).normalizedDeployMap.keys()].map((key) => key.split(',').map(Number))
        .find(([row, col]) => !used.has(`${row},${col}`) && context.canPlace(state, piece, row, col)
          && !state.pieces.some((other) => other.uid !== piece.uid && other.row === row && other.col === col));
      assert.ok(tile, `legal real tile for ${piece.uid}`);
      used.add(`${tile[0]},${tile[1]}`);
      state = applyAction(state, { type: 'place', uid: piece.uid, row: tile[0], col: tile[1], dir: 'E',
        opId: `altar:place:${win}:${piece.uid}`, expectedRevision: state.revision }, context).state;
    }
    state = applyAction(state, { type: 'readyBattle', opId: `altar:ready:${win}`,
      expectedRevision: state.revision }, context).state;
    const battleId = state.currentBattle.battleId;
    const result = applyAction(state, { type: 'settleBattle', battleId,
      opId: `altar:settle:${win}`, expectedRevision: state.revision }, context);
    assert.equal(result.result.victory, true, `battle ${win + 1} is won by the native runAssaultBattle driver`);
    battleIds.add(battleId);
    relicCounters = result.state.relicCounters;
  }
  assert.equal(battleIds.size, 10, 'each result belongs to a distinct native Battle identity');
  assert.equal(relicCounters['pierce-altar'], 10, 'cap is reached after ten distinct real victorious battle settlements');
});
