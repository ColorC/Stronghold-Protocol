import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { buildResonanceBattle, getResonanceField } from '../../server/modes/resonance/battle.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { factionSeason } from '../../shared/resonance/faction-season.js';
import { factionSeasonV2 } from '../../shared/resonance/faction-season-v2.js';
import { OPERATOR_ADAPTATIONS, STAR3_TALENT_INDEX } from '../../shared/resonance/operator-adaptations.js';
import { enemyRec } from '../helpers/battleHarness.js';

const data = loadData(process.env.SP_DATA_DIR ?? 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native', { log: { warn() {}, error() {} } });
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: factionSeasonV2.id, seed: 21 });
const firstCatalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: factionSeason.id, seed: 21 });
const active = new Set(catalog.config.activeOperatorIds);
const op = (name, cat = catalog) => { const row = Object.values(cat.operators).find((entry) => active.has(entry.id) && entry.name === name); assert.ok(row, name); return row; };
const close = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
// a knock-out from 部署费用 and not 再部署: every gain of 部署费用 the season's texts could still promise
const DEAD_COPY = /部署费用|获得\d+点费用|立即获得\d+点费用|逐渐获得\d+点|首次产生部署费用/;

const base = { seed: 21, difficulty: 'NORMAL', round: 2, roundLimit: 28, rulesVersion: 3, seasonId: factionSeasonV2.id, pieces: [], strategies: [] };
const field = getResonanceField(base, { data, catalog });
const ground = [...field.deployMap].filter(([, kind]) => kind === 'melee').map(([key]) => key.split(',').map(Number));
const at = (r, c) => ground.find(([row, col]) => row === r && col === c);
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
// a tile with two ground neighbours and a ground tile at least two tiles away from it
const center = ground.find((tile) => ground.filter((other) => other !== tile && cheb(tile, other) === 1).length >= 4);
const neighbours = ground.filter((tile) => tile !== center && cheb(tile, center) === 1);
const far = ground.find((tile) => cheb(tile, center) >= 3);
// a ground tile from which 夕 (facing RIGHT, 3×3 range from her own column) reaches `center`
const duskTile = ground.find((tile) => tile !== center && [1, 2].includes(center[1] - tile[1]) && Math.abs(center[0] - tile[0]) <= 1);
assert.ok(center && far && duskTile && neighbours.length >= 3, 'the test field has a cluster and a far tile');

/** A real Battle (preview: no scheduled waves) with `[name, star, tile]` operators. */
function arena(rows, { cat = catalog, recording = false } = {}) {
  const pieces = rows.map(([name, star = 1, tile], index) => ({ uid: `p${index}`, operatorId: op(name, cat).id, star, row: tile[0], col: tile[1], dir: 'RIGHT', equipment: [], extraPacts: [] }));
  const { battle } = buildResonanceBattle({ ...base, seasonId: cat.config.seasonId, pieces }, { data, catalog: cat, recording, preview: true });
  battle.autoFinish = false;
  if (recording) battle.recordEvents = true;
  battle.start();
  const unit = (name) => battle.allyUnits.find((entry) => entry.uid === pieces[rows.findIndex((row) => row[0] === name)]?.uid);
  let serial = 0;
  const enemy = (pos, options = {}) => {
    const key = `adapt_test_${++serial}`;
    return battle.spawnEnemy(key, { pos, def: enemyRec({ key, hp: options.hp ?? 100000, atk: 0, speed: 0, rank: options.rank ?? 'NORMAL', def: 0, res: 0 }) });
  };
  const advance = (seconds) => { const until = battle.time + seconds; while (battle.time + 1e-9 < until && !battle.finished) battle.step(); };
  const gains = [];
  battle.on('spGain', (c) => { if (c.reason === 'resonanceAdaptation') gains.push({ name: c.unit.name, amount: c.amount }); }, { priority: -1e9 });
  const emptyBars = () => { for (const ally of battle.allyUnits) if (ally.skill && !ally.skill.noSkill) { ally.skill.sp = 0; ally.skill.charges = 0; } };
  return { battle, unit, enemy, advance, gains, emptyBars, player: () => battle.getPlayer(battle.allyUnits[0].ownerId) };
}
const gained = (gains, name) => gains.filter((row) => row.name === name).reduce((sum, row) => sum + row.amount, 0);
const kill = (battle, source, target) => battle.dealDamage(source, target, { amount: target.hp + 10, type: 'true', canDodge: false });

test('season 2 texts promise no 部署费用 and season 1 keeps the native records', () => {
  const view = resonanceDisplayCatalog(catalog, data);
  for (const id of catalog.config.activeOperatorIds) {
    const operator = catalog.operators[id];
    for (const star of [1, 2, 3]) {
      const record = operator.stars[star].record;
      const texts = [record.trait?.desc, record.trait?.descRaw, record.skill?.desc, record.skill?.descRaw,
        ...(record.talents ?? []).flatMap((talent) => [talent.desc, talent.descRaw]), operator.stars[star].passive?.description,
        catalog.playerText?.operators?.[id]?.stars?.[star]?.skillDescription, view.operators[id].stars[star].skill?.description,
        ...view.operators[id].stars[star].talents.map((talent) => talent.description), view.operators[id].stars[star].passive];
      for (const text of texts.filter(Boolean)) assert.doesNotMatch(text, DEAD_COPY, `${operator.name} ${star}★: ${text}`);
    }
  }
  // the rules only exist in season 2; season-1 saves read the native kit
  assert.match(op('香草', firstCatalog).stars[1].record.skill.desc, /获得6点部署费用/);
  assert.equal(op('香草', firstCatalog).adaptation, undefined);
  assert.equal(op('格拉尼', firstCatalog).stars[3].passive.kind, 'star3_logistics');
  // every adapted operator is in the season and carries its parameters; redeploy-time effects stay
  for (const [id, row] of Object.entries(OPERATOR_ADAPTATIONS)) {
    assert.ok(active.has(id), row.name);
    assert.deepEqual(catalog.operators[id].adaptation.rules, row.rules, row.name);
  }
  assert.match(op('砾').stars[1].record.trait.desc, /再部署时间大幅度减少/);
  assert.match(op('斯卡蒂').stars[1].record.talents[1].desc, /再部署时间-10秒/);
});

test('部署费用 gains become 技力: the whole team, the 8 tiles around, and gradually over 焰心', () => {
  // 香草: 6 部署费用 → 1 技力 for every allied operator, herself included; the pool and the DP glyph stay out of it
  const all = arena([['香草', 1, center], ['调香师', 1, neighbours[0]], ['红云', 1, far]], { recording: true });
  all.emptyBars(); const dpBefore = all.player().dp;
  all.battle.drainEvents?.();
  all.unit('香草').skill.activate('test', { free: true });
  for (const name of ['调香师', '红云']) assert.equal(gained(all.gains, name), 1, `${name} +1`);
  assert.equal(gained(all.gains, '香草'), 0, 'her own skill is running');
  assert.ok(all.player().dp - dpBefore < 1e-9, 'no 部署费用 is added');
  assert.equal((all.battle.drainEvents?.() ?? []).some((event) => event[0] === 'fx' && event[1] === 'dp'), false, 'no DP glyph');
  // 贾维: 11 → 2 技力 for the operators on his 8 surrounding tiles only
  const near = arena([['贾维', 1, center], ['调香师', 1, neighbours[0]], ['红云', 1, far]]);
  near.emptyBars();
  near.unit('贾维').skill.activate('test', { free: true });
  assert.equal(gained(near.gains, '调香师'), 2); assert.equal(gained(near.gains, '红云'), 0); assert.equal(gained(near.gains, '贾维'), 0);
  // 焰尾: 1 技力 to the neighbours every 2 部署费用 of the 8 her skill hands out over its duration
  const flame = arena([['焰尾', 1, center], ['调香师', 1, neighbours[0]], ['红云', 1, far]]);
  flame.emptyBars();
  flame.unit('焰尾').skill.activate('test', { free: true });
  flame.advance(flame.unit('焰尾').skill.duration + 0.5);
  assert.equal(gained(flame.gains, '调香师'), 4); assert.equal(gained(flame.gains, '红云'), 0);
  // 谜图: 3 → 1 技力 around, at the attack the skill empowers
  const puzzle = arena([['谜图', 1, center], ['调香师', 1, neighbours[0]]]);
  puzzle.emptyBars();
  const enemy = puzzle.enemy(neighbours[1]);
  puzzle.unit('谜图').skill.activate('test', { free: true });
  for (let i = 0; i < 300 && !gained(puzzle.gains, '调香师'); i++) puzzle.battle.step();
  assert.equal(gained(puzzle.gains, '调香师'), 1);
  puzzle.advance(1);
  assert.ok(enemy.hp < enemy.s.maxHp, 'the empowered attack lands');
  // 缪尔赛思: 13 → 2 技力 for everyone; 哥伦比亚 operators start with 2 more 技力
  const mlyss = arena([['缪尔赛思', 1, center], ['调香师', 1, far]]);
  mlyss.emptyBars();
  mlyss.unit('缪尔赛思').skill.activate('test', { free: true });
  assert.equal(gained(mlyss.gains, '调香师'), 2);
  const sp = (rows) => { const one = arena(rows); return one.unit('雷蛇').skill.sp; };
  close(sp([['缪尔赛思', 1, center], ['雷蛇', 1, far]]) - sp([['红云', 1, center], ['雷蛇', 1, far]]), 2, 'a 哥伦比亚 operator starts with +2 技力');
  // season 1 keeps the native 部署费用
  const old = arena([['香草', 1, center], ['调香师', 1, far]], { cat: firstCatalog });
  old.emptyBars(); const oldDp = old.player().dp;
  old.unit('香草').skill.activate('test', { free: true });
  close(old.player().dp - oldDp, 6, 'season 1: +6 部署费用'); assert.equal(old.gains.length, 0);
  for (const fight of [all, near, flame, puzzle, mlyss, old]) assert.equal(fight.battle.errorCount, 0);
});

test('格拉尼 earns capped battle gold for kills and the settlement trusts only her cap', () => {
  for (const [star, cap] of [[1, 1], [2, 2], [3, 3]]) {
    const one = arena([['格拉尼', star, center]], { recording: true });
    one.battle.drainEvents?.();
    for (let i = 0; i < 5; i++) kill(one.battle, one.unit('格拉尼'), one.enemy(neighbours[i % neighbours.length], { hp: 10 }));
    const coins = one.battle.resonanceResults.coins.filter((row) => row.reason === 'operator_bounty');
    assert.equal(coins.reduce((sum, row) => sum + row.amount, 0), cap, `${star}★ cap`);
    assert.ok(coins.every((row) => row.source === op('格拉尼').id));
    assert.equal((one.battle.drainEvents?.() ?? []).filter((event) => event[0] === 'fx' && event[1] === 'coin').length, cap, 'a coin pops per gold');
    assert.equal(one.battle.errorCount, 0);
  }
  // weaker body: 20% less health than the season-1 budget
  close(op('格拉尼').stars[1].stats.maxHp, op('格拉尼', firstCatalog).stars[1].stats.maxHp * 0.8, '格拉尼 health', 1e-3);
  // the session credits the battle gold, clamped to the best deployed 格拉尼's cap
  const session = prep(31);
  const grani = buyNamed(session, '格拉尼');
  deploy(session, grani, center);
  const gold = session.state.gold;
  const runner = () => ({ won: true, hpLoss: 0, result: { reason: 'cleared' }, diagnostics: { errorCount: 0 }, metrics: {},
    coins: [{ amount: 1, source: op('格拉尼').id, reason: 'operator_bounty' }, { amount: 1, source: op('格拉尼').id, reason: 'operator_bounty' }] });
  const fought = applyAction(session.state, { type: 'fight' }, { ...session.options, battleRunner: runner });
  assert.equal(fought.ok, true, fought.error);
  const settled = fought.events.find((event) => event.type === 'fight-settled');
  assert.equal(settled.battleGold, 1, 'a 1★ 格拉尼 pays at most 1 gold a battle');
  assert.equal(settled.goldAfter - gold, settled.income + settled.winBonus + settled.streakBonus + settled.interest + 1 + (settled.strategyGold ?? 0) + (settled.delayedBonus ?? 0));
});

/** A season-2 prep session with plenty of gold. */
function prep(seed) {
  const created = createSession({ seed, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true);
  const state = created.state;
  state.gold = 200; state.level = 6;
  const options = { catalog, fieldResolver: (input) => getResonanceField(input, { data, catalog }), recording: false };
  return { state, options };
}
/** Put `name` in the first shop slot (keeping the pool ledger) and buy it. */
function buyNamed(session, name) {
  const offer = session.state.shop.offers[0], id = op(name).id;
  if (offer.operatorId) session.state.poolRemaining[offer.operatorId]++;
  session.state.poolRemaining[id]--;
  Object.assign(offer, { operatorId: id, cost: op(name).cost });
  const bought = applyAction(session.state, { type: 'buy', offerUid: offer.uid }, session.options);
  assert.equal(bought.ok, true, bought.error);
  session.state = bought.state;
  session.events = bought.events;
  return session.state.pieces.filter((piece) => piece.operatorId === id).at(-1);
}
function deploy(session, piece, tile) {
  const done = applyAction(session.state, { type: 'deploy', pieceUid: piece.uid, row: tile[0], col: tile[1], dir: 'RIGHT' }, session.options);
  assert.equal(done.ok, true, done.error);
  session.state = done.state;
}

test('砾 pays 1 gold back each time she gains a star', () => {
  const session = prep(41);
  const start = session.state.gold;
  for (let i = 0; i < 3; i++) buyNamed(session, '砾');
  assert.equal(session.state.pieces.filter((piece) => piece.operatorId === op('砾').id).length, 1);
  assert.equal(session.state.pieces.find((piece) => piece.operatorId === op('砾').id).star, 2);
  assert.ok(session.events.some((event) => event.type === 'operator-merge-gold' && event.gold === 1));
  assert.equal(start - session.state.gold, 3 - 1, 'three copies cost 3, the merge pays 1 back');
  assert.equal(validateSession(session.state, { catalog }).ok, true);
  // season 1 does not
  const created = createSession({ seed: 41, difficulty: 'NORMAL', catalog: firstCatalog });
  assert.equal(op('砾', firstCatalog).adaptation, undefined);
  assert.equal(created.ok, true);
});

test('three-star vanguards and executors: first-cast team 技力 and the halved return that strikes around', () => {
  const vanilla = arena([['香草', 3, center], ['调香师', 1, far]]);
  vanilla.emptyBars();
  vanilla.unit('香草').skill.activate('test', { free: true });
  assert.equal(gained(vanilla.gains, '调香师'), 1 + 2, '1 from 6 部署费用 and 2 from the first skill');
  vanilla.advance(vanilla.unit('香草').skill.duration + 0.5);
  vanilla.unit('调香师').skill.sp = 0;
  const ownGain = gained(vanilla.gains, '调香师');
  vanilla.unit('香草').skill.activate('test', { free: true });
  assert.equal(gained(vanilla.gains, '调香师') - ownGain, 1, 'the star-three bonus is once a battle');
  // 砾 3★: the first knock-out halves her 18 s wait; coming back hits the enemies on her 8 surrounding tiles
  const gravel = arena([['砾', 3, center]]);
  const rat = gravel.unit('砾'), foe = gravel.enemy(neighbours[0]);
  gravel.battle.dealDamage(foe, rat, { amount: 1e9, type: 'true', canDodge: false });
  assert.equal(rat.alive, false);
  close(rat.respawnAt - gravel.battle.time, rat.base.respawnTime * 0.5, 'half the redeploy wait');
  const before = foe.hp;
  gravel.advance(rat.base.respawnTime * 0.5 + 1);
  assert.equal(rat.alive, true, 'redeployed');
  assert.ok(before - foe.hp >= rat.s.atk * 0.99 * Math.min(1, 1), 'the return strike lands');
  assert.equal(gravel.battle.errorCount, 0);
});

test('见行者 with two allies around makes the enemies her skill stuns 脆弱; alone it does not', () => {
  const crowd = arena([['见行者', 1, center], ['调香师', 1, neighbours[0]], ['红云', 1, neighbours[1]]]);
  const front = [center[0], center[1] + 1];
  const target = crowd.enemy(front);
  crowd.unit('见行者').skill.activate('test', { free: true });
  assert.ok(target.buffs.some((buff) => buff.status === 'stun' || buff.key === 'stun'), 'stunned');
  assert.ok(target.buffs.some((buff) => buff.status === 'fragile'), 'and 脆弱');
  close(target.s.dmgTakenMul, 1.2, '20% more damage taken');
  const alone = arena([['见行者', 1, center], ['红云', 1, far]]);
  const lone = alone.enemy(front);
  alone.unit('见行者').skill.activate('test', { free: true });
  assert.equal(lone.buffs.some((buff) => buff.status === 'fragile'), false);
  for (const fight of [crowd, alone]) assert.equal(fight.battle.errorCount, 0);
});

test('夕 summons 小自在 for 25 / 45 seconds or for good by star, falls back to free ground, and at three stars summons it again', () => {
  const lifetime = (star) => {
    const one = arena([['夕', star, duskTile]]);
    one.enemy(center);
    for (let i = 0; i < 600 && !one.battle.allyUnits.some((unit) => unit.kind === 'token' && unit.alive); i++) one.battle.step();
    one.advance(0.2);
    const token = one.battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
    assert.ok(token, `${star}★ summons`);
    return { one, token, left: token.mem.duskUntil - one.battle.time };
  };
  close(lifetime(1).left, 25, '1★', 0.02);
  close(lifetime(2).left, 45, '2★', 0.02);
  const three = lifetime(3);
  assert.ok(three.left > 1000, '3★ 小自在 does not expire');
  // killed: summoned again by her next attack, once a battle
  kill(three.one.battle, three.one.battle.enemies[0], three.token);
  for (let i = 0; i < 600 && !three.one.battle.allyUnits.some((unit) => unit.kind === 'token' && unit.alive); i++) three.one.battle.step();
  assert.ok(three.one.battle.allyUnits.some((unit) => unit.kind === 'token' && unit.alive && unit !== three.token), 'summoned again');
  // the target's tile is taken by an ally: the nearest free ground is used
  const blocked = arena([['夕', 1, duskTile], ['角峰', 1, center]]);
  blocked.enemy(center);
  for (let i = 0; i < 600 && !blocked.battle.allyUnits.some((unit) => unit.kind === 'token' && unit.alive); i++) blocked.battle.step();
  const token = blocked.battle.allyUnits.find((unit) => unit.kind === 'token' && unit.alive);
  assert.ok(token, 'summoned on another tile');
  assert.ok(cheb([token.tileR, token.tileC], center) <= 1 && (token.tileR !== center[0] || token.tileC !== center[1]));
  for (const fight of [three.one, blocked]) assert.equal(fight.battle.errorCount, 0);
});

test('银灰 and 贾维 grow with the other members of their faction on the field', () => {
  const kjerag = arena([['银灰', 1, center], ['角峰', 1, neighbours[0]], ['灵知', 1, far]]);
  kjerag.advance(0.6);
  const silver = kjerag.unit('银灰');
  assert.equal(silver.mem.resonanceAdaptFaction, 2);
  assert.equal(silver.findBuff(`resonance:adapt:faction:${silver.id}`)?.mods?.aspd, 10, 'two other 谢拉格 → +10 攻击速度');
  for (const ally of kjerag.battle.allyUnits.filter((unit) => unit.kind === 'op')) assert.equal(ally.findBuff('svrash:leader')?.mods?.redeployMul ?? 1, 1, 'no team redeploy bonus');
  const siracusa = arena([['贾维', 1, center], ['红云', 1, neighbours[0]], ['布洛卡', 1, neighbours[1]], ['巫恋', 1, neighbours[2]], ['拉普兰德', 1, far]]);
  siracusa.advance(0.6);
  const chiave = siracusa.unit('贾维');
  assert.deepEqual(chiave.findBuff(`resonance:adapt:faction:${chiave.id}`)?.mods, { atkPct: 0.07 * 3, defPct: 0.07 * 3 }, 'four other 叙拉古, at most three count');
  for (const fight of [kjerag, siracusa]) assert.equal(fight.battle.errorCount, 0);
});

test('three-star skills gain an effect: 焰尾 stuns on dodge, 塞雷娅 slows and 法术脆弱, 玛恩纳 answers every ally', () => {
  const flame = arena([['焰尾', 3, center]]);
  const tail = flame.unit('焰尾'), foe = flame.enemy(neighbours[0]);
  const stuns = [];
  flame.battle.on('statusApplied', ({ source, status, target }) => { if (source === tail && status === 'stun') stuns.push(target); });
  flame.battle.emit('dodge', { source: foe, target: tail, dmg: {} });
  assert.equal(stuns.length, 0, 'not outside 焰心');
  tail.skill.activate('test', { free: true });
  flame.battle.emit('dodge', { source: foe, target: tail, dmg: {} });
  flame.battle.emit('dodge', { source: foe, target: tail, dmg: {} });
  assert.equal(stuns.length, 1, 'once per enemy in 3 seconds');
  flame.advance(3.1);
  flame.battle.emit('dodge', { source: foe, target: tail, dmg: {} });
  assert.equal(stuns.length, 2);

  const saria = arena([['塞雷娅', 3, center]]);
  const calc = saria.enemy(neighbours[0]);
  saria.unit('塞雷娅').skill.activate('test', { free: true });
  assert.ok(calc.buffs.some((buff) => buff.status === 'slow') && calc.buffs.some((buff) => buff.status === 'artsFragile'));
  close(calc.buffs.find((buff) => buff.status === 'slow').mods.moveMul, 0.7, 'move speed -30%'); close(calc.s.artsTakenMul, 1.2, '20% 法术脆弱');
  const twoStar = arena([['塞雷娅', 2, center]]);
  const plain = twoStar.enemy(neighbours[0]);
  twoStar.unit('塞雷娅').skill.activate('test', { free: true });
  assert.equal(plain.buffs.some((buff) => buff.status === 'artsFragile'), false, 'two stars keep the native skill');

  const extra = (star) => {
    const one = arena([['玛恩纳', star, center], ['红云', 1, far]]);
    const mlynar = one.unit('玛恩纳'), target = one.enemy([center[0], center[1] + 1]);
    mlynar.skill.activate('test', { free: true });
    one.advance(0.1);
    const before = target.hp;
    one.battle.dealDamage(one.unit('红云'), target, { amount: 1, type: 'true', canDodge: false, isAttack: true });
    return { lost: before - target.hp - 1, expected: mlynar.s.atk * mlynar.def.skill.bb.atk_scale, errors: one.battle.errorCount };
  };
  const three = extra(3), two = extra(2);
  close(three.lost, three.expected, 'a 叙拉古 attack carries 玛恩纳\'s true damage at three stars', 1e-3);
  assert.equal(two.lost, 0, 'two stars: only 卡西米尔 attacks');
  for (const errors of [flame.battle.errorCount, saria.battle.errorCount, twoStar.battle.errorCount, three.errors, two.errors]) assert.equal(errors, 0);
});

test('the star-three passive of an adapted operator reaches the in-match card once', () => {
  const view = resonanceDisplayCatalog(catalog, data);
  for (const name of ['焰尾', '塞雷娅', '玛恩纳', '夕', '香草', '砾']) {
    const operator = op(name);
    const row = operator.stars[3].record.talents.find((talent) => talent.index === STAR3_TALENT_INDEX);
    assert.equal(row?.name, '升星特性', name);
    assert.equal(row.desc, operator.stars[3].passive.description);
    assert.equal(operator.stars[2].record.talents.some((talent) => talent.index === STAR3_TALENT_INDEX), false, `${name} 2★ has none`);
    assert.equal(view.operators[operator.id].stars[3].talents.some((talent) => talent.name === '升星特性'), false, 'the mode card lists it as passive');
    assert.equal(view.operators[operator.id].stars[3].passive, operator.stars[3].passive.description);
  }
  // 格拉尼's old 部署费用 rider is gone: her three-star step is the higher gold cap in her trait
  assert.equal(op('格拉尼').stars[3].passive.kind, 'none');
  assert.equal(op('格拉尼').stars[3].record.talents.some((talent) => talent.index === STAR3_TALENT_INDEX), false);
  // the old effect a pilot keeps stays readable and active next to the new one
  assert.equal(op('塞雷娅').stars[3].passive.additionalEffect.kind, 'star3_symbiosis');
  assert.equal(op('玛恩纳').stars[3].passive.additionalEffect.kind, 'star3_breaker');
});
