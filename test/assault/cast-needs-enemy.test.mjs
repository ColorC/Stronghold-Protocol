// A natural (SP_FULL) cast whose skill strikes enemies never fires into an empty range: its DP / redeploy / self or
// ally lines alone do not cast it. Built like tools/assault/probe-skill-repair.mjs (normal compiled DTO, the real kit
// registry), with the only enemy far outside every range.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { getData } from '../../server/data.js';
import { getAssaultData } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { makeChessRecords } from '../../shared/assault/battle-input.js';
import { toAssaultSimData } from '../../shared/assault/catalog.js';
import { flatStage, flatRoutes, enemyRec } from '../helpers/battleHarness.js';

const runtime = loadAssaultRuntime();
const quiet = { warn() {}, error() {}, info() {}, log() {} };
const data = toAssaultSimData(runtime, getAssaultData({ nativeData: getData({ dir: process.env.SP_DATA_DIR, log: quiet }), runtime }).nativeData);

function fixture(charId, star, { enemyInRange }) {
  const piece = (id, uid) => ({ charId: id, uid, star, moduleId: null, moduleChoices: {}, sourceCopies: 1,
    permanentFlat: {}, permanentPercent: {}, claimed: [], tagEdits: { add: [], remove: [] }, dir: 'E', row: 10, col: uid === 'actor' ? 5 : 6 });
  const buddyId = charId === 'char_181_flower' ? 'char_240_wyvern' : 'char_181_flower';
  const built = makeChessRecords(runtime, [piece(charId, 'actor'), piece(buddyId, 'buddy')], [], {});
  const victim = enemyRec({ key: 'cast-victim', hp: 1e8, atk: 0, def: 0, res: 0, speed: 0 });
  const ds = new DataSource({ chess: built.chess, tokens: data.tokens, enemies: { ...data.enemies, 'cast-victim': victim } }, getDefaultSource());
  const b = new Battle({ kind: 'normal', modeId: 'assault-cast-needs-enemy', stage: flatStage(), routes: flatRoutes(), spawns: [], data: ds,
    players: [{ playerId: 'p1', seat: 0, side: 'L', units: built.units }], content: 'assault',
    assault: { kits: { ...assaultKits }, strict: true }, flags: { dpInit: 999, dpMax: 999, dpPerSec: 0, startOpCooldown: 0 },
    autoFinish: false, timeLimit: 120, recordEvents: false, quiet: true, logger: quiet });
  b.start();
  const u = b.allyUnits.find((x) => x.uid === 'actor'), buddy = b.allyUnits.find((x) => x.uid === 'buddy');
  u.skill.spType = 'none'; buddy.skill.spType = 'none'; u.skill.setSpTotal(0); buddy.skill.setSpTotal(0);
  if (enemyInRange) {
    const slots = [...u.rangeKeys].map((k) => [Math.floor(k / 21), k % 21]).filter(([r, c]) => b.grid.inRect(r, c) && !(r === u.tileR && c === u.tileC));
    for (const pos of [...slots.slice(0, 3), [u.tileR, u.tileC]]) b.spawnEnemy('cast-victim', { routeIndex: 0, pos });
  } else {
    b.spawnEnemy('cast-victim', { routeIndex: 0, pos: [0, 0] });
  }
  const player = b._pp(u.ownerId); if (player) player.coins = 99;
  b.step();
  u.hp = u.s.maxHp * 0.25; buddy.hp = buddy.s.maxHp * 0.25;
  return { b, u };
}

function naturalCast(charId, star, opts) {
  const { b, u } = fixture(charId, star, opts);
  const before = Number(u.skill.activations ?? 0);
  u.skill.setSpTotal(u.skill.spCost);
  for (let i = 0; i < 3; i++) b.step();
  return { b, u, cast: Number(u.skill.activations ?? 0) - before, ready: u.skill.ready, errors: b.errors, echoes:Math.max(0,...Object.values(u.mem.svash2Echoes??{})) };
}

// The operators that used to fire their strike into an empty range (2026-10-21 report: 凛御银灰 cast with no enemy).
const STRIKERS = ['char_102_texas', 'char_349_chiave', 'char_423_blemsh',
  'char_311_mudrok', 'char_1021_kroos2', 'char_498_inside'];
// 见行者 (synergy card, design of 2026-10-21) left this list: its 部署时 push clears this fixture's range before the cast;
// its cast waits for an enemy in range (canCast) — tested in test/assault/synergy-assault-2.test.mjs

for (const charId of STRIKERS) for (const star of [1, 4]) {
  test(`${charId} ★${star} holds its natural cast without an enemy and casts once one is in range`, () => {
    const empty = naturalCast(charId, star, { enemyInRange: false });
    assert.equal(empty.cast, 0, 'no cast while no enemy is a target');
    assert.equal(empty.ready, true, 'the full SP bar is kept for the next enemy');
    assert.deepEqual(empty.errors, []);
    const engaged = naturalCast(charId, star, { enemyInRange: true });
    assert.ok(engaged.cast >= 1, 'casts once an enemy is in range');
    assert.deepEqual(engaged.errors, []);
  });
}

// Every other operator that still casts with no enemy in range does so for an ally / self / device / summon / DP
// payoff of its own. A new body joins this list only after that is checked.
const NO_ENEMY_CASTS = new Set([
  // Silverash Alter prepares up to two deployment echoes for allies, even in an empty own lane.
  'char_1045_svash2',
  'char_127_estell','char_264_f12yin','char_1026_gvial2','char_263_skadi','char_358_lisa',
  'char_401_elysm','char_4207_branch','char_2026_yu','char_220_grani',
  'char_237_gravel', 'char_451_robin', 'char_4151_tinman', 'char_1041_angel2', 'char_4048_doroth', 'char_484_robrta',
  'char_344_beewax', 'char_242_otter', 'char_254_vodfox', 'char_4045_heidi', 'char_4019_ncdeer', 'char_426_billro',
  'char_4202_haruka', 'char_4072_ironmn', 'char_240_wyvern', 'char_151_myrtle', 'char_181_flower', 'char_385_finlpp',
  'char_199_yak', 'char_150_snakek', 'char_196_sunbr', 'char_128_plosis', 'char_4163_rosesa', 'char_4119_wanqin',
  'char_108_silent', 'char_171_bldsk', 'char_4196_reckpr', 'char_4114_harold', 'char_494_vendla', 'char_4139_papyrs',
  'char_4222_taraxa', 'char_107_liskam', 'char_479_sleach', 'char_420_flamtl', 'char_427_vigil', 'char_249_mlyss',
  'char_4042_lumen', 'char_1016_agoat2', 'char_4179_monstr', 'char_202_demkni', 'char_2025_shu', 'char_1037_amiya3',
  // synergy cards (design of 2026-10-21): 银灰 enters his 雪境姿态 and cuts the team's 再部署 timers; 令 strikes with and
  // recalls her summons
  'char_172_svrash', 'char_2023_ling',
  // ranged synergy cards: 凯瑟琳's 战火淬炼 is her own HP / DEF and her device's barrier refill for the operator it guards
  'char_4162_cathy',
  // Original once-per-battle states, follow fields, stored hit/attack uses and inspiration.
  'char_1033_swire2','char_1039_thorn2','char_4145_ulpia','char_1014_nearl2','char_204_platnm',
  'char_1012_skadi2','char_4134_cetsyr','char_245_cello','char_381_bubble','char_4148_philae','char_1034_jesca2','char_4194_rmixer',
  // Her original global strike reaches the otherwise distant fixture enemy.
  'char_1038_whitw2',
]);

test('Platinum enters her useful battle state once without an enemy, keeps original expanded range and never spends SP refreshing it',()=>{
  const {b,u}=fixture('char_204_platnm',1,{enemyInRange:false}),before={atk:u.s.atk,range:[...u.rangeKeys]};
  u.skill.setSpTotal(u.skill.spCost);for(let i=0;i<3;i++)b.step();
  assert.equal(u.skill.activations,1);assert.ok(u.s.atk>before.atk);assert.ok(u.rangeKeys.length>before.range.length);
  u.skill.setSpTotal(u.skill.spCost);const sp=u.skill.spTotal;for(let i=0;i<3;i++)b.step();
  assert.equal(u.skill.activations,1);assert.equal(u.skill.spTotal,sp);assert.deepEqual(b.errors,[]);
});

test('manual summon strikes retain full SP and HP without a position instruction or a useful target',()=>{
  for(const id of ['char_4016_kazema','char_344_beewax','char_393_toledo','char_1019_siege2','char_391_rosmon','char_2015_dusk','char_108_silent']){
    const {b,u}=fixture(id,1,{enemyInRange:false}),hp=u.hp;u.skill.setSpTotal(u.skill.spCost);const sp=u.skill.spTotal;
    for(let i=0;i<3;i++)b.step();assert.equal(u.skill.activations,0,id);assert.equal(u.skill.spTotal,sp,id);
    assert.ok(u.hp>=hp,id+' must not lose HP to an empty cast');assert.deepEqual(b.errors,[],id);
  }
});

test('only ally / self / device / DP skills cast with no enemy in range (every body, ★1)', () => {
  const casts = [];
  for (const body of Object.values(runtime.bodies)) {
    if (body.fixedSkill?.kind === 'passive') continue;
    if (naturalCast(body.charId, 1, { enemyInRange: false }).cast > 0) casts.push(body.charId);
  }
  assert.deepEqual(casts.filter((id) => !NO_ENEMY_CASTS.has(id)), [], 'a strike skill cast into an empty range');
  assert.ok(casts.length > 0);
});

for(const star of [1,4])test(`Silverash Alter star ${star} naturally prepares useful allied-deployment echoes without an enemy`,()=>{const result=naturalCast('char_1045_svash2',star,{enemyInRange:false});assert.ok(result.cast>0);assert.ok(result.echoes>0&&result.echoes<=2);assert.deepEqual(result.errors,[]);});
