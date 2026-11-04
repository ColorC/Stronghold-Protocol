import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle } from '../helpers/synergyCard.js';
import { ROWS, COLS } from '../../server/sim/constants.js';
import { summonPlacementLegal, ledgerFor } from '../../server/sim/content/assault/summons.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { damage } from '../../server/sim/content/assault/primitives.js';

function withSummons(charId, tokenId, count = 1, extras = []) {
  const q = synergyBattle([{ charId }]);
  const presets = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++)
    if (summonPlacementLegal(q.battle, q.units[0], tokenId, row, col)) presets.push({ tokenId, row, col, dir: 'RIGHT' });
  assert.ok(presets.length >= count);
  const h = synergyBattle([{ charId, piece: { summonPresets: presets.slice(0, count) } }, ...extras]);
  h.units.forEach(h.hold);
  h.tokens = () => h.battle.allyUnits.filter(u => u.kind === 'token' && u.ownerUnit === h.units[0] && u.alive && !u.removed);
  return h;
}

test('雷蛇 retains four targets, self stun and every-three-hits charge to an actual adjacent ally', () => {
  const h = synergyBattle([{ charId: 'char_107_liskam', row: 9, col: 3 }, { charId: 'char_103_angel', row: 9, col: 2 }]);
  const [liskam, angel] = h.units; h.units.forEach(h.hold);
  const foes = Array.from({ length: 5 }, () => h.spawn([9, 4]));
  const hit = new Set(); let grants = 0;
  h.battle.assaultRuntime.observe('hit', 'test:liskam', ({ payload }) => { if (payload.source === liskam && payload.isSkill) hit.add(payload.target); });
  h.battle.assaultRuntime.observe('chargeGranted', 'test:liskam-charge', ({ payload }) => { if (payload.source === liskam) grants += payload.amount; });
  h.castNow(liskam); assert.ok(hasStatus(liskam, 'stun')); assert.equal(foes.filter(e => e.hp < e.s.maxHp).length, 4);
  for (let i = 0; i < 3; i++) h.battle.dealDamage(foes[0], liskam, { amount: 1, type: 'true', isAttack: true }); h.flush();
  assert.equal(grants, 8); assert.equal(angel.skill.sp, 4);
});

test('赫默 only deploys a manually placed drone and each cast heals its original surrounding area', () => {
  const empty = synergyBattle([{ charId: 'char_108_silent' }]);
  assert.equal(empty.battle.allyUnits.some(u => u.kind === 'token'), false);
  const h = withSummons('char_108_silent', 'token_10000_silent_healrb'), [silent] = h.units, drone = h.tokens()[0];
  assert.ok(drone);
  silent.tileR = drone.tileR; silent.tileC = drone.tileC + 1; silent.y = drone.y; silent.x = drone.x + 1; silent.hp *= .5;
  const hp = silent.hp;
  h.castNow(silent); assert.ok(silent.hp > hp); assert.equal(h.tokens().length, 1);
  assert.equal(silent.findBuff('adaptation:silent:injection')?.mods.aspd, 12);
  silent.hp *= .5; const again = silent.hp; h.castNow(silent); assert.ok(silent.hp > again);
  assert.equal(silent.findBuff('adaptation:silent:injection')?.mods.aspd, 12, 'same innate benefit never becomes repeat growth');
});
test('the original drone ten-second and styling machine twenty-five-second lifetimes retire the actual first entities',()=>{
  for(const[id,token,seconds]of [['char_108_silent','token_10000_silent_healrb',10],['char_484_robrta','token_10018_robrta_mach',25]]){
    const h=withSummons(id,token),first=h.tokens()[0];for(const u of h.units)u.profile.noAttack=true;
    h.run(seconds-.2);assert.equal(first.alive,true,id);h.run(.4);assert.equal(first.alive,false,id);assert.deepEqual(h.battle.errors,[]);
  }
});

test('罗比菈塔 grants independent shield layers; only the first three allied shield breaks restyle', () => {
  const h = withSummons('char_484_robrta', 'token_10018_robrta_mach'), [unit] = h.units, machine = h.tokens()[0];
  unit.tileR = machine.tileR; unit.tileC = machine.tileC + 1; unit.y = machine.y; unit.x = machine.x + 1;
  const shieldLayers = () => unit.buffs.reduce((sum, b) => sum + (b.shieldHits ?? 0), 0);
  h.castNow(unit); assert.equal(shieldLayers(), 2); const def = unit.s.def;
  h.run(.2); h.castNow(unit); assert.equal(shieldLayers(), 4); assert.equal(unit.s.def, def);
  const enemy = h.spawn([9, 5]);
  for (let i = 0; i < 10; i++) { h.battle.dealDamage(enemy, unit, { amount: 1, type: 'true', isAttack: true }); h.flush(); h.run(.11); }
  const row = h.battle.assaultLedger.snapshot().operators.find(r => r.uid === unit.uid);
  assert.equal(row.triggers, 3); assert.equal(shieldLayers(), 0);
});

test('梅尔 detonates and recalls the same manually placed stock without manufacturing more summons', () => {
  const tokenId = 'token_10004_otter_motter', h = withSummons('char_242_otter', tokenId, 2,
    [{ charId: 'char_103_angel', row: 9, col: 1 }]);
  const [otter, ally] = h.units, first = h.tokens()[0];
  ally.tileR = otter.tileR; ally.tileC = otter.tileC + 1; ally.x = otter.x + 1; ally.y = otter.y;
  const foe = h.spawn([first.tileR, first.tileC + 1]);
  assert.equal(h.tokens().length, 2); h.castNow(otter); assert.equal(h.tokens().length, 0);
  assert.ok(foe.hp < foe.s.maxHp); assert.ok(hasStatus(foe, 'stun')); assert.equal(ally.skill.sp, 4);
  assert.equal(ledgerFor(h.battle, otter).stock.get(tokenId), 5);
  h.run(.2); h.castNow(otter); assert.equal(h.tokens().length, 0); assert.equal(ledgerFor(h.battle, otter).stock.get(tokenId), 5);
});

test('缪尔赛思 refreshes the manually placed flow from the actual Rhine operator who redeploys', () => {
  const h = withSummons('char_249_mlyss', 'token_10030_mlyss_wtrman', 1,
    [{ charId: 'char_108_silent', row: 9, col: 4 }]);
  const [mlyss, silent] = h.units, flow = h.tokens()[0]; assert.ok(flow);
  flow.hp *= .25; cycleRedeploy(h.battle, silent); h.flush();
  assert.equal(flow.mem.mlyssCopyOf, silent.uid); assert.equal(flow.hp, flow.s.maxHp);
  h.castNow(mlyss); const atk = mlyss.s.atk; h.castNow(mlyss); assert.equal(mlyss.s.atk, atk);
  assert.equal(h.tokens().length, 1);
});

test('缪尔赛思 flow copied from a healer still deals arts damage with the entropy cast (no unknown damage type heal)', () => {
  const h = withSummons('char_249_mlyss', 'token_10030_mlyss_wtrman', 1,
    [{ charId: 'char_108_silent', row: 9, col: 4 }]);
  const [mlyss, silent] = h.units, flow = h.tokens()[0];
  cycleRedeploy(h.battle, silent); h.flush();
  assert.equal(flow.mem.mlyssCopyOf, silent.uid); assert.equal(flow.profile.attack, 'ranged');
  assert.notEqual(flow.profile.dmgType, 'heal');
  const foe = h.spawn([flow.tileR, flow.tileC + 1]);
  h.castNow(mlyss);
  assert.ok(foe.hp < foe.s.maxHp); assert.deepEqual(h.battle.errors, []);
});

test('伺夜 owns one multi-headed wolfpack; a fatal hit loses one head and restores health before final death', () => {
  const h = withSummons('char_427_vigil', 'token_10028_vigil_wolf'), [vigil] = h.units, wolf = h.tokens()[0];
  assert.equal(h.tokens().length, 1); assert.equal(wolf.mem.adaptWolfHeads, 2); assert.equal(wolf.s.blockCnt, 2);
  const enemy = h.spawn([wolf.tileR, wolf.tileC + 1]);
  h.battle.dealDamage(enemy, wolf, { amount: wolf.s.maxHp * 2, type: 'true' }); h.flush();
  assert.equal(wolf.alive, true); assert.equal(wolf.mem.adaptWolfHeads, 1); assert.equal(wolf.hp, wolf.s.maxHp); assert.equal(wolf.s.blockCnt, 1);
  h.run(25.1); assert.equal(wolf.mem.adaptWolfHeads, 2);
  enemy.blockedBy = wolf; wolf.blocking = [enemy];
  let ignore = 0; h.battle.on('hit', ({ source, dmg }) => { if (source === vigil) ignore = dmg.defIgnoreFlat; }, { priority: -100 });
  damage(h.battle, vigil, enemy, { scale: 1, type: 'phys' }); h.flush(); assert.equal(ignore, 175);
});
