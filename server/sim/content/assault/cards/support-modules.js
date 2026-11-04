import {
  active, allies, enemies, damage, heal, buff, applyStatus, sp, gainDP, uid, v, haste,
} from '../primitives.js';
import { grantSummon } from '../summons.js';
import { setAssaultAmmoCapacityBonus } from '../ammo.js';
import { supportPlans } from './support-plans.js';
import { supportTokenKits } from './support-tokens.js';

// ADVANCED support modules are deliberately kept separate from support.js.  The
// parent kit owns the fixed skill; these handlers only translate the selected
// module.  Numeric values here are the values in roster-support.json's
// modulePlans.translation.effectHandling, not native module white stats.

const EPS = 1e-9;
const RUNTIME_EVENTS = new Set([
  'dpReceived', 'spReceived', 'skillStart', 'skillResolved', 'deployed', 'summonSpawned',
  'summonDied', 'summonReturned', 'damageTaken', 'death', 'elementBurst', 'shieldBroken', 'shieldGained',
]);
const STAR = (star) => star >= 4 ? 1 : 0;
const keyOf = (id, suffix) => `assault:module:${id}:${suffix}`;
const payloadOf = (event) => event?.payload ?? event ?? {};
const ownerIs = (ctx, unit) => ctx?.unit === unit || ctx?.source === unit || ctx?.attacker === unit || ctx?.killer === unit;
const distance = (a, b) => Math.abs((a?.tileR ?? 0) - (b?.tileR ?? 0)) + Math.abs((a?.tileC ?? 0) - (b?.tileC ?? 0));

// Bazaar module line value for the unit's current star (the public module text
// is this template with these params; one source for text and mechanism).
// Percent params are integer percentages: pass percent=true to get a ratio.
export function supportModuleValue(unitOrBody, moduleId, key, { percent = false } = {}) {
  const body = unitOrBody?.bazaar ? unitOrBody : (unitOrBody?.def?.raw?.assaultBody ?? unitOrBody);
  const params = body?.bazaar?.modules?.[moduleId]?.params;
  if (!params || params[key] == null) throw new Error(`support module ${moduleId} lacks bazaar param ${key}`);
  const value = Number(v(unitOrBody, params[key]));
  return percent ? value / 100 : value;
}
const mv = supportModuleValue;

// Assault Wanqin002 converts x-4's eight neighbours to x-1's twelve neighbours.
// The four cardinal distance-two cells are included; this is never radius 12.
const WANQIN_FACING_8 = Object.freeze([[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]);
const WANQIN_FACING_12 = Object.freeze([...WANQIN_FACING_8,[-2,0],[2,0],[0,-2],[0,2]]);
export function wanqinFacingInRange(unit, target) {
  if (!target || target === unit || target.side !== 'ally'
    || target.ownerId !== unit.ownerId || target.dir !== unit.dir) return false;
  // The module no longer widens this to twelve cells (bazaar 牵风 is adjacent8).
  const grid = WANQIN_FACING_8;
  return grid.some(([dr,dc]) => target.tileR === unit.tileR + dr && target.tileC === unit.tileC + dc);
}


function on(battle, name, unit, fn, priority = 0) {
  if (RUNTIME_EVENTS.has(name)) {
    if (!battle.assaultRuntime) throw new Error(`assault module ${name} requires assaultRuntime`);
    return battle.assaultRuntime.observe(name, `${uid(unit)}:${name}:${unit.def?.charId ?? unit.defId}`, (event) => {
      const payload = payloadOf(event);
      const normalized = name === 'death' ? { ...payload, unit: payload.unit ?? payload.target, killer: payload.killer ?? payload.source } : payload;
      return fn({ ...normalized, cause: event?.cause ?? payload.cause }, event);
    }, { owner: unit, priority });
  }
  return battle.on(name, (event) => {
    const payload = payloadOf(event);
    if (payload && payload.cause == null && event?.cause != null) payload.cause = event.cause;
    return fn(payload, event);
  }, { owner: unit, priority });
}

function every(battle, seconds, unit, fn) {
  return battle.every(seconds, () => { if (active(unit)) fn(); }, { owner: unit });
}

function oncePerWindow(unit, field, target, now, interval) {
  unit.mem ??= {};
  unit.mem[field] ??= new Map();
  const id = uid(target);
  const previous = unit.mem[field].get(id) ?? -Infinity;
  if (now - previous + EPS < interval) return false;
  unit.mem[field].set(id, now);
  return true;
}

function nearbyEnemies(battle, unit, scope = 'adjacent8') {
  return enemies(battle, unit, { scope, count: 99, priority: 'nearest' });
}

function nearbyAllies(battle, unit, scope = 'adjacent8') {
  return allies(battle, unit, { scope, selection: 'nearest', count: 99 });
}

function installInfiniteBuff(battle, unit, id, mods) {
  return buff(battle, unit, unit, { key: keyOf(id, 'passive'), mods, duration: Infinity, stacking: 'replace' });
}

function installOnActiveBuff(battle, unit, id, mods) {
  const apply = () => { if (active(unit)) installInfiniteBuff(battle, unit, id, mods); };
  battle.on('battleStart', apply, { owner: unit });
  on(battle, 'deployed', unit, (ctx) => { if ((ctx.unit ?? ctx.target) === unit) apply(); });
  apply();
}

function grantShield(battle, unit, target, id, amount, duration = Infinity, layers = 0) {
  if (!(amount > 0) && !(layers > 0)) return null;
  return battle.addBuff(target, {
    key: keyOf(id, 'shield'), shield: amount > 0 ? amount : undefined,
    shieldHits: layers > 0 ? layers : undefined, duration, visible: true, source: unit,
  });
}

function castTargets(battle, unit) {
  return allies(battle, unit, { scope: 'range', selection: 'lowestHp', count: 99 });
}

function farthest(list, unit) {
  return [...list].sort((a, b) => distance(b, unit) - distance(a, unit) || uid(a).localeCompare(uid(b)))[0] ?? null;
}

function markOncePerBattle(unit, field, target) {
  unit.mem ??= {};
  unit.mem[field] ??= new Set();
  const id = uid(target);
  if (unit.mem[field].has(id)) return false;
  unit.mem[field].add(id);
  return true;
}

function moduleRecord(charId, install, beforeSkillCast, afterSkillCast) {
  const adapt = (fn) => {
    if (!fn) return null;
    // Builders may use positional arguments for local readability, but the
    // parent passes one mutable context object through the whole cast.  Keep
    // that object intact: before/after hooks may share only this cast's data.
    if (fn.length <= 1) return fn;
    return (ctx) => fn(ctx.battle, ctx.unit, ctx.body, ctx.piece, ctx.star, ctx);
  };
  return {
    charId,
    unlockStar: 3,
    delegatedToMain: false,
    ...(install ? { install: adapt(install) } : {}),
    ...(beforeSkillCast ? { beforeSkillCast: adapt(beforeSkillCast) } : {}),
    ...(afterSkillCast ? { afterSkillCast: adapt(afterSkillCast) } : {}),
  };
}

// The parent skill passes the actual single per-cast critical result directly to this hook.
const vigna = moduleRecord('char_290_vigna', (battle, unit) => {
  unit.mem ??= {};
  unit.mem.supportVignaRefunds = 0;
}, null, ({ battle, unit, cause, critical }) => {
  return; // 伟大的摇滚：暴击率 +c% 由 support-bazaar.js 的逐目标暴击读取，旧「暴击失败返还技力」已删
  if (critical === true || (unit.mem?.supportVignaRefunds ?? 0) >= 3) return;
  unit.mem.supportVignaRefunds = (unit.mem.supportVignaRefunds ?? 0) + 1;
  sp(battle, unit, unit, 1, 'module:vigna:failedCritical', keyOf('uniequip_002_vigna', 'refund'), cause);
});

const myrtle = moduleRecord('char_151_myrtle', (battle, unit) => {
  unit.mem ??= {};
  // 私人收藏: each own skill cast (first 5 per battle) arms one discount of
  // {a} for the next operator deployed.
  unit.mem.supportMyrtleDiscounts = 0;
  unit.mem.assaultMyrtleDiscounts = 0;
  on(battle, 'skillStart', unit, (ctx) => {
    if ((ctx.source ?? ctx.unit) !== unit || unit.mem.supportMyrtleDiscounts >= 5) return;
    unit.mem.supportMyrtleDiscounts++;
    unit.mem.assaultMyrtleDiscounts = (unit.mem.assaultMyrtleDiscounts ?? 0) + 1;
  });
  on(battle, 'assaultDeploymentCost', unit, (quote) => {
    const target = quote.unit;
    if (!active(unit) || unit.mem.assaultMyrtleDiscounts <= 0 || target?.kind !== 'op' || target === unit || target.ownerId !== unit.ownerId || target.mem?.assaultSkillFree) return;
    quote.amount = Math.max(0, quote.amount - mv(unit, 'uniequip_002_myrtle', 'a'));
  });
  on(battle, 'deploy', unit, (ctx) => {
    if (!active(unit) || ctx.unit?.kind !== 'op' || ctx.unit === unit || ctx.unit.ownerId !== unit.ownerId || ctx.skillEntry === true) return;
    if (unit.mem.assaultMyrtleDiscounts > 0) unit.mem.assaultMyrtleDiscounts--;
  });
});

const flower = moduleRecord('char_181_flower', (battle, unit, body, _piece, star) => {
  unit.mem ??= {};
  unit.mem.supportFlowerAuraUntil = -Infinity;
  unit.mem.supportFlowerHitAt = new Map();
  unit.mem.supportFlowerHealingTargets = new Set();
  unit.mem.supportFlowerCastTargets = new Set();
  const passive=body.modePassives?.find(x=>x.action==='heal'&&x.values?.healPerSec!=null),duration=(passive?.values?.duration?.[Math.max(0,Math.min(3,star-1))]??0)+2;
  on(battle,'heal',unit,ctx=>{if(unit.mem.supportFlowerResolving&&ctx.source===unit&&ctx.target?.side==='ally'&&ctx.amount>0)unit.mem.supportFlowerCastTargets.add(ctx.target);});
  on(battle,'damaged',unit,ctx=>{if(!active(unit)||battle.time+EPS>=unit.mem.supportFlowerAuraUntil||!unit.mem.supportFlowerHealingTargets.has(ctx.target)||!active(ctx.target)||!oncePerWindow(unit,'supportFlowerHitAt',ctx.target,battle.time,1))return;heal(battle,unit,ctx.target,{amount:unit.s.atk*0.05,cause:ctx.cause});});
  const clear=ctx=>{if((ctx.unit??ctx.target)!==unit)return;unit.mem.supportFlowerResolving=false;unit.mem.supportFlowerCastTargets.clear();unit.mem.supportFlowerHealingTargets.clear();unit.mem.supportFlowerHitAt.clear();unit.mem.supportFlowerAuraUntil=-Infinity;};
  on(battle,'retreating',unit,clear);on(battle,'death',unit,clear);
  unit.mem.supportFlowerAuraDuration=duration;
},ctx=>{ctx.unit.mem.supportFlowerResolving=true;ctx.unit.mem.supportFlowerCastTargets=new Set();},ctx=>{
  const unit=ctx.unit;unit.mem.supportFlowerResolving=false;
  if(unit.mem.supportFlowerCastTargets.size){unit.mem.supportFlowerHealingTargets=new Set(unit.mem.supportFlowerCastTargets);unit.mem.supportFlowerAuraUntil=ctx.battle.time+(unit.mem.supportFlowerAuraDuration??0);}
});

const finlpp = moduleRecord('char_385_finlpp', (_battle, _unit) => {}, (ctx) => {
  ctx.finlppTargets = castTargets(ctx.battle, ctx.unit).filter(target => target.ownerId === ctx.unit.ownerId);
}, (ctx) => {
  const { battle, unit, cause } = ctx;
  const target = farthest((ctx.finlppTargets ?? castTargets(battle, unit)).filter(candidate => candidate.ownerId === unit.ownerId), unit);
  // “江河之韵”: the farthest operator is healed {a}% ATK (card text value).
  if (target) heal(battle, unit, target, { scale: mv(unit, 'uniequip_002_finlpp', 'a', { percent: true }), cause });
});

// 父亲的袍子: a fixed arts damage reduction of {a}%.
const yak = moduleRecord('char_199_yak', (battle, unit) => {
  installOnActiveBuff(battle, unit, 'uniequip_002_yak', { artsTakenMul: 1 - mv(unit, 'uniequip_002_yak', 'a', { percent: true }) });
});

const snakek = moduleRecord('char_150_snakek', (battle, unit) => {
  let lastCounterAt = -Infinity;
  const clear = ctx => { if ((ctx.unit ?? ctx.target) === unit) lastCounterAt = -Infinity; };
  on(battle, 'retreating', unit, clear);
  on(battle, 'death', unit, clear);
  on(battle, 'damaged', unit, ctx => {
    if (!active(unit) || ctx.target !== unit || ctx.source?.side !== 'enemy' || !ctx.dmg?.isAttack) return;
    if (!unit.buffs?.some(b => b.key === 'assault:char_150_snakek:skill:0' && b.timeLeft > EPS)) return;
    const profile = battle.effectiveProfile(ctx.source);
    const melee = profile.attack != null ? profile.attack === 'melee' : (profile.melee ?? ctx.source.def?.applyWay === 'MELEE');
    if (!melee || battle.time - lastCounterAt + EPS < 1) return;
    lastCounterAt = battle.time;
    damage(battle, unit, ctx.source, { amount: unit.s.def * 0.3, type: 'phys', sourceKey: keyOf('uniequip_002_snakek', 'counter'), cause: ctx.cause });
  });
});

const bubble = moduleRecord('char_381_bubble', (battle, unit) => {
  const clear = ctx => { if ((ctx.unit ?? ctx.target) === unit) unit.mem?.supportBubbleSluggish?.clear(); };
  on(battle, 'retreating', unit, clear);
  on(battle, 'death', unit, clear);
  on(battle, 'damaged', unit, ctx => {
    if (!active(unit) || ctx.source !== unit || ctx.target?.side !== 'enemy' || !(ctx.amount > 0) || ctx.dmg?.attackId !== 'assault:char_381_bubble:skill:1') return;
    return; // 停顿改由 support-bazaar.js 在减攻扳机内施加（每场战斗前 20 次）
    if (!oncePerWindow(unit, 'supportBubbleSluggish', ctx.target, battle.time, 3)) return;
    applyStatus(battle, unit, ctx.target, { status: 'sluggish', duration: 0.5, key: keyOf('uniequip_002_bubble', 'sluggish'), cause: ctx.cause });
  });
});

const sunbr = moduleRecord('char_196_sunbr', (battle, unit) => {
  unit.mem ??={};unit.mem.supportSunbrResolving=false;unit.mem.supportSunbrCastTargets=new Set();unit.mem.supportSunbrTimers=new Map();
  on(battle,'heal',unit,ctx=>{if(unit.mem.supportSunbrResolving&&ctx.source===unit&&ctx.target?.side==='ally'&&ctx.amount>0)unit.mem.supportSunbrCastTargets.add(ctx.target);});
  const clear=ctx=>{if((ctx.unit??ctx.target)!==unit)return;unit.mem.supportSunbrResolving=false;unit.mem.supportSunbrCastTargets.clear();for(const state of unit.mem.supportSunbrTimers.values())state.timer.cancel();unit.mem.supportSunbrTimers.clear();};
  on(battle,'retreating',unit,clear);on(battle,'death',unit,clear);
},ctx=>{ctx.unit.mem.supportSunbrResolving=true;ctx.unit.mem.supportSunbrCastTargets=new Set();},ctx=>{
  const {battle,unit,cause}=ctx;unit.mem.supportSunbrResolving=false;
  for(const target of unit.mem.supportSunbrCastTargets){const id=uid(target),old=unit.mem.supportSunbrTimers.get(id);old?.timer.cancel();const state={left:3,timer:null};state.timer=battle.every(1,()=>{if(!active(unit)||!active(target)||state.left<=0){state.timer.cancel();if(unit.mem.supportSunbrTimers.get(id)===state)unit.mem.supportSunbrTimers.delete(id);return;}state.left--;heal(battle,unit,target,{amount:unit.s.atk*0.15,cause});if(state.left<=0){state.timer.cancel();if(unit.mem.supportSunbrTimers.get(id)===state)unit.mem.supportSunbrTimers.delete(id);}},{owner:unit});unit.mem.supportSunbrTimers.set(id,state);}
});

const plosis = moduleRecord('char_128_plosis', null, null, ({ battle, unit, body, star, cause }) => {
  return; // 医疗环境分析装置：加速时长改由 support-bazaar.js 读模组 t，删去自身额外每秒技力
  const baseDuration=Number(body?.modePassives?.[0]?.values?.duration?.[star-1]??body?.modePassives?.[0]?.values?.duration??0);
  const duration=baseDuration+(star>=4?4:2);
  const rate = star >= 4 ? 0.6 : 0.5;
  let left = duration;
  unit.mem??={};unit.mem.supportPlosisSelfTimer?.cancel();
  const timer = battle.every(1, () => {
    if(!active(unit)||left<=0){timer.cancel();if(unit.mem.supportPlosisSelfTimer===timer)delete unit.mem.supportPlosisSelfTimer;return;}
    left--;
    sp(battle, unit, unit, rate, 'module:plosis:aura', keyOf('uniequip_002_plosis', 'selfSp'), cause);
  }, { owner: unit });
  unit.mem.supportPlosisSelfTimer=timer;
});

const rosesa = moduleRecord('char_4163_rosesa', (battle, unit) => {
  // The base talent is installed when the owner is active; module scaling
  // composes multiplicatively with its -5% penalty to produce -3% total.
  const apply = () => {}; // 多彩盐漠生活：只延长受到治疗提升的持续时间（support-bazaar.js），删去攻击惩罚调整
  battle.on('battleStart', apply, { owner: unit });
  on(battle, 'deployed', unit, (ctx) => { if ((ctx.unit ?? ctx.target) === unit) apply(); });
  apply();
});

const texas = moduleRecord('char_102_texas', (battle, unit) => {
  unit.mem ??= {};
  // 外勤私人补给包: each own skill grants {a} more cost (stun-kill refund removed).
  on(battle, 'skillResolved', unit, (ctx) => { if ((ctx.source ?? ctx.unit) === unit) gainDP(battle, unit, mv(unit, 'uniequip_002_texas', 'a'), keyOf('uniequip_002_texas', 'skillDp'), ctx.cause); });
});

// The module's effects are applied by support.js when it creates the mode's
// explicitly typed Chiave claw, rather than to unrelated owner summons.
const chiave = moduleRecord('char_349_chiave', () => {});

// Wildmane's module adjusts the actual fixed-skill displacement in support.js;
// a second post-cast push would incorrectly collide with the native unbalance.
const wildmn = moduleRecord('char_496_wildmn', () => {});

const elysm = moduleRecord('char_401_elysm', (battle, unit) => {
  on(battle, 'statusApplied', unit, (ctx) => {
    if (ctx.source !== unit || ctx.target?.side !== 'enemy' || ctx.status !== 'reveal') return;
    // 应急通讯指南: enemies the skill reveals take {a}% more damage (the
    // locked-target cost refund was removed).
    buff(battle, unit, ctx.target, { key: keyOf('uniequip_002_elysm', 'revealedFragile'), mods: { dmgTakenMul: 1 + mv(unit, 'uniequip_002_elysm', 'a', { percent: true }) }, duration: ctx.duration ?? 6, stacking: 'replace', cause: ctx.cause });
  });
});

const wanqin = moduleRecord('char_4119_wanqin', (battle, unit) => {
  unit.mem ??= {};
  unit.mem.supportWanqinRefunds ??= 0;
  // 牵风: an own operator knocked out in the eight surrounding cells refunds
  // {a} cost, first 3 per battle (facing and the 12-cell range were removed).
  on(battle, 'death', unit, (ctx) => {
    const dead = ctx.target ?? ctx.unit;
    if (!active(unit) || ctx.reason !== 'killed' || dead?.kind !== 'op' || dead === unit || dead.side !== 'ally' || dead.ownerId !== unit.ownerId || unit.mem.supportWanqinRefunds >= 3) return;
    if (Math.max(Math.abs(dead.tileR - unit.tileR), Math.abs(dead.tileC - unit.tileC)) > 1) return;
    unit.mem.supportWanqinRefunds++;
    gainDP(battle, unit, mv(unit, 'uniequip_002_wanqin', 'a'), keyOf('uniequip_002_wanqin', 'allyDeath'), ctx.cause);
  });
});

const ctable = moduleRecord('char_497_ctable', (battle, unit) => {
  on(battle, 'hpDamage', unit, (ctx) => {
    if (ctx.target !== unit || !active(unit) || !(ctx.amount > 0) || !unit.s.flags?.stealth) return;
    ctx.amount = 0;
    for (const entry of [...unit.buffs]) if (entry.flags?.camou || entry.flags?.stealth || entry.key === keyOf('uniequip_002_ctable', 'camo')) battle.removeBuff(unit, entry);
  });
  const reloadKey = 'assault:char_497_ctable:skill:0';
  const redeployKey = keyOf('uniequip_002_ctable', 'redeploy');
  on(battle, 'reloaded', unit, (ctx) => {
    if (ctx.unit !== unit || ctx.sourceKey !== reloadKey || !(ctx.left > 0)) return;
    buff(battle, unit, unit, { key: redeployKey, mods: { redeployMul: 0.7 }, duration: Infinity });
  });
  on(battle, 'ammoUsed', unit, (ctx) => {
    if (ctx.unit === unit && ctx.left === 0) battle.removeBuff(unit, redeployKey);
  });
});

const puzzle = moduleRecord('char_4017_puzzle', (battle, unit) => {
  unit.mem ??= {};
  unit.mem.supportPuzzleKills = 0;
  // 首要任务: this operator's knockouts refund {a} cost, first 5 per battle
  // (no mark is required any more; the mark/defense-down was removed).
  on(battle, 'death', unit, (ctx) => {
    if (!active(unit) || ctx.unit?.side !== 'enemy' || ctx.reason !== 'killed' || (ctx.killer ?? ctx.source) !== unit || unit.mem.supportPuzzleKills >= 5) return;
    unit.mem.supportPuzzleKills++;
    gainDP(battle, unit, mv(unit, 'uniequip_002_puzzle', 'a'), keyOf('uniequip_002_puzzle', 'killDp'), ctx.cause);
  });
});

// The exact medical-drone token consumes range and destruction semantics from its owner selection.
const silent = Object.freeze({charId:'char_108_silent',unlockStar:3,delegatedToMain:true});

// 应急储备: support.js adds {a}% to the skill's attack buff; the 20-SP refund
// when a buffed ally falls was removed.
const bldsk = moduleRecord('char_171_bldsk', () => {});

// 未完成的录武簿: support-retained-extra replaces the range-skill charge with
// the module's {a}; no second listener and no extra attack-speed layer.
const reckpr = moduleRecord('char_4196_reckpr', () => {});

// Harold's translated module modifies the actual skill element-heal payload;
// the main support handler consumes it at skill settlement.  It is not an
// elementBurst listener (which fires for enemy-created bursts as well).
const harold = moduleRecord('char_4114_harold', () => {});

const vendla = moduleRecord('char_494_vendla', () => {});

const papyrs = moduleRecord('char_4139_papyrs', () => {});

// The main tactical-defense talent consumes the unlocked stun exception for both original recipients.
const liskam = Object.freeze({charId:'char_107_liskam',unlockStar:3,delegatedToMain:true});

const udflow = Object.freeze({charId:'char_4137_udflow',unlockStar:3,delegatedToMain:true});

const branch = Object.freeze({charId:'char_4207_branch',unlockStar:3,delegatedToMain:true});

// 出门必备套装: support-instant multiplies the skill splash by 1+{a}%; the
// attack-range extension was removed.
const ashlok = moduleRecord('char_431_ashlok', () => {});

const philae = moduleRecord('char_4148_philae', (battle, unit) => {
  on(battle, 'hpDamage', unit, (ctx) => {
    if(ctx.target===unit&&ctx.dmg?.type==='phys'&&(unit.mem?.philaeBarrier??0)>0&&battle.time<(unit.mem?.supportPhilaeBarrierExpires??0))ctx.amount*=0.9;
  });
});

const siege = moduleRecord('char_112_siege', (battle, unit) => {
  on(battle, 'death', unit, (ctx) => {
    const target=ctx.unit??ctx.target;if(active(unit)&&target?.side==='enemy'&&ctx.reason==='killed'&&(ctx.killer===unit||ctx.source===unit)&&ctx.amount>0)sp(battle, unit, unit, 1, 'module:siege:kill', keyOf('uniequip_002_siege', 'sp'), ctx.cause);
  });
});

// “初诺”: each own cast (first 5 per battle) charges every own pioneer {s};
// the extra pioneer ATK/DEF +3% was removed.
const siegeBanner = moduleRecord('char_112_siege', (battle, unit) => {
  unit.mem ??= {};
  unit.mem.supportSiegeBannerRefunds = 0;
}, (ctx) => {
  if (ctx.unit.mem.supportSiegeBannerRefunds >= 5) return;
  ctx.unit.mem.supportSiegeBannerRefunds++;
  const amount = mv(ctx.unit, 'uniequip_003_siege', 's');
  for (const ally of allies(ctx.battle, ctx.unit, { scope: 'field', selection: 'uid', count: 99, predicate: (x) => x.kind === 'op' && x.ownerId === ctx.unit.ownerId && x.def?.profession === 'PIONEER' })) sp(ctx.battle, ctx.unit, ally, amount, 'module:siege:banner', keyOf('uniequip_003_siege', 'sp'), ctx.cause);
});

const bpipe = moduleRecord('char_222_bpipe', () => {}, (ctx) => {
  const targets = enemies(ctx.battle, ctx.unit, { scope: 'range', count: 99 });
  // 破城矛弹夹: one extra attack per cast; the full-HP precision follow-up
  // (assaultBpipeModuleFollowup) was removed.
  if (targets.length) ctx.battle.forceAttack(ctx.unit, targets.slice(0, 1), { noAmmo: true });
});

const bpipeKill = moduleRecord('char_222_bpipe', (battle, unit) => {
  unit.mem ??= {};
  unit.mem.supportBpipeKills = 0;
  on(battle, 'death', unit, (ctx) => {
    if ((ctx.killer ?? ctx.source) !== unit || unit.mem.supportBpipeKills >= 5) return;
    unit.mem.supportBpipeKills++;
    gainDP(battle, unit, 1, keyOf('uniequip_003_bpipe', 'killDp'), ctx.cause);
  });
});

const vulpis = moduleRecord('char_4026_vulpis', (_battle, unit) => {
  unit.mem ??= {};
  unit.mem.supportVulpisDoubles ??= 0;
});

const vulpisDouble = moduleRecord('char_4026_vulpis', (_battle, unit) => {
  unit.mem ??= {};
  unit.mem.supportVulpisDoubles ??= 0;
});
// 牧人的歌: the banner aura's extra +{a} attack speed is applied by support.js;
// here each deployment hastes this operator for {t} seconds (the permanent
// 1 SP/s while the banner stands was removed).
const sleach = moduleRecord('char_479_sleach', (battle, unit) => {
  on(battle, 'deployed', unit, (ctx) => {
    if ((ctx.unit ?? ctx.target ?? ctx.source) !== unit || !active(unit)) return;
    haste(battle, unit, unit, mv(unit, 'uniequip_002_sleach', 't'), 'uniequip_002_sleach:deploy', { cause: ctx.cause });
  });
});

// “友谊万岁”: an own operator standing within one cell of the banner knocks
// out an enemy -> gain {a} cost (the 5% hit chance was removed).
const sleachHit = moduleRecord('char_479_sleach', (battle, unit) => {
  on(battle, 'death', unit, (ctx) => {
    const killer = ctx.killer ?? ctx.source, victim = ctx.unit ?? ctx.target, flag = unit.mem?.sleachFlag;
    if (!active(unit) || !flag || (flag.expiresAt != null && battle.time >= flag.expiresAt - EPS) || ctx.reason !== 'killed' || victim?.side !== 'enemy') return;
    if (killer?.kind !== 'op' || killer.side !== 'ally' || killer.ownerId !== unit.ownerId) return;
    if (Math.max(Math.abs(killer.tileR - flag.r), Math.abs(killer.tileC - flag.c)) > 1) return;
    gainDP(battle, unit, mv(unit, 'uniequip_003_sleach', 'a'), keyOf('uniequip_003_sleach', 'killDp'), ctx.cause);
  });
});

const flamtl = moduleRecord('char_420_flamtl', (battle, unit) => {
  installOnActiveBuff(battle, unit, 'uniequip_002_flamtl', { dodgePhys: 0.1 });
  // 红松的起点: charge 1 per dodge, first 10 per battle (was once per 3 s).
  unit.mem ??= {};
  unit.mem.supportFlamtlDodgeCharges = 0;
  on(battle, 'dodge', unit, (ctx) => { if (ctx.target === unit && active(unit) && unit.mem.supportFlamtlDodgeCharges < 10) { unit.mem.supportFlamtlDodgeCharges++; sp(battle, unit, unit, 1, 'module:flamtl:dodge', keyOf('uniequip_002_flamtl', 'sp'), ctx.cause); } });
});

const flamtlAura = Object.freeze({charId:'char_420_flamtl',unlockStar:3,delegatedToMain:true});

const vigil = moduleRecord('char_427_vigil', (battle, unit) => {
  on(battle, 'summonSpawned', unit, (ctx) => {
    if (ctx.source !== unit || !ctx.target) return;
    buff(battle, unit, ctx.target, { key: keyOf('uniequip_002_vigil', 'wolfAtk'), mods: { atkMul: 1.15 }, duration: Infinity });
  });
});

const vigilReform = moduleRecord('char_427_vigil', (battle, unit) => {
  unit.mem??={};unit.mem.supportVigilReformed??=false;
  on(battle,'summonDied',unit,ctx=>{
    const token=ctx.target;
    if(!active(unit)||unit.mem.supportVigilReformed||token?.ownerUnit!==unit||token.defId!=='token_10028_vigil_wolf'||ctx.reason!=='killed')return;
    battle.assaultRuntime.enqueue(()=>{
      if(!active(unit)||unit.mem.supportVigilReformed||battle.allyUnits.some(t=>t.kind==='token'&&t.ownerUnit===unit&&t.defId==='token_10028_vigil_wolf'&&active(t)))return;
      const result=grantSummon(battle,unit,{tokenId:'token_10028_vigil_wolf',count:2,stockCap:3,fieldCap:3,ruleKey:keyOf('uniequip_003_vigil','reform'),kit:supportTokenKits.token_10028_vigil_wolf});
      if(result.granted>0)unit.mem.supportVigilReformed=true;
    },{key:keyOf('uniequip_003_vigil','reform')+':'+uid(unit),cause:ctx.cause});
  });
});

const mlyss = Object.freeze({charId:'char_249_mlyss',unlockStar:3,delegatedToMain:true});

const mlyssRefresh = moduleRecord('char_249_mlyss', (battle, unit) => {
  const ownFlow=ctx=>active(unit)&&ctx.source===unit&&active(ctx.target)&&ctx.target.ownerUnit===unit&&ctx.target.ownerId===unit.ownerId&&ctx.target.kind==='token'&&ctx.target.defId==='token_10030_mlyss_wtrman';
  const burst=ctx=>{for(const target of nearbyEnemies(battle,ctx.target))damage(battle,unit,target,{scale:1.5,type:'arts',sourceKey:keyOf('uniequip_003_mlyss','refresh'),cause:ctx.cause});};
  on(battle, 'summonSpawned', unit, (ctx) => {
    if (!ownFlow(ctx)) return;
    if (!unit.mem?.supportMlyssHadShape) { unit.mem ??= {}; unit.mem.supportMlyssHadShape = true; return; }
    burst(ctx);
  });
  on(battle,'mlyssFlowRefreshed',unit,ctx=>{if(ownFlow(ctx)&&ctx.reason==='skill'&&ctx.target.profile?.attack==='ranged')burst(ctx);});
});

const ines = moduleRecord('char_4087_ines', (battle, unit) => {
  on(battle, 'statusApplied', unit, (ctx) => {
    if (ctx.source !== unit || ctx.target?.side !== 'enemy' || ctx.status !== 'bind') return;
    buff(battle, unit, ctx.target, { key: keyOf('uniequip_002_ines', 'bindFragile'), mods: { dmgTakenMul: 1.08 }, duration: ctx.duration ?? 6 });
  });
});

const lumen = moduleRecord('char_4042_lumen', (_battle, unit) => { unit.mem ??= {}; unit.mem.supportLumenCleanses = 0; });

const lumenResist = Object.freeze({charId:'char_4042_lumen',unlockStar:3,delegatedToMain:true});

const agoat2 = moduleRecord('char_1016_agoat2', (battle, unit, _body, _piece, star) => {
  return; // 想要留住的声音：再生最多层数 +1 在 support.js 氤氲分支，删去每层治疗加成
  if(star<4)return;
  on(battle,'heal',unit,ctx=>{
    if(ctx.source!==unit||ctx.target?.side!=='ally'||!(ctx.amount>0)||ctx.opts?.regen)return;
    const key='assault:char_1016_agoat2:talent:mist:'+uid(unit);
    const layers=(ctx.target.buffs??[]).filter(b=>b.key===key&&b.source===unit&&b.timeLeft>EPS).length;
    if(layers>0)ctx.amount*=1+0.02*layers;
  });
});

const agoat2Barrier = Object.freeze({charId:'char_1016_agoat2',unlockStar:3,delegatedToMain:true});

const reed2 = moduleRecord('char_1020_reed2', () => {});

const reed2Seed = moduleRecord('char_1020_reed2', () => {});

// 远方的礼物: +{a}% damage to sleeping enemies from 3 stars (the sleep
// chance bonus was removed).
const titi = moduleRecord('char_4056_titi', (battle, unit) => {
  const bonus = mv(unit, 'uniequip_002_titi', 'a', { percent: true });
  on(battle,'hit',unit,ctx=>{
    if(ctx.source!==unit||ctx.target?.side!=='enemy'||!ctx.target.s?.flags?.sleep||!(ctx.dmg?.amount>0))return;
    ctx.dmg.mul=(ctx.dmg.mul??1)*(1+bonus);
  });
});

// 友人们的赠礼: an enemy attack has an {a}% chance to be fully blocked
// (抵挡: the hit deals no HP damage). The extra block count and the 4-star
// block SP were removed.
const hsguma = moduleRecord('char_136_hsguma', (battle, unit) => {
  const chance = mv(unit, 'uniequip_002_hsguma', 'a', { percent: true });
  on(battle, 'hit', unit, (ctx) => {
    const attacker = ctx.source ?? ctx.attacker;
    if (ctx.target !== unit || !active(unit) || attacker?.side !== 'enemy' || !ctx.dmg?.isAttack || ctx.dmg.cancel) return;
    if (battle.rng() >= chance) return;
    ctx.dmg.mul = 0;
  }, -40);
});

const hsgumaThorn = moduleRecord('char_136_hsguma', (battle, unit) => {
  return; // 护身符：反击伤害 +a% 由 support-bazaar.js 的反击行读取
  installOnActiveBuff(battle, unit, 'uniequip_003_hsguma', { rangeExtend: 1 });
  on(battle, 'attack', unit, (ctx) => { if (ctx.attacker === unit) for (const target of ctx.targets ?? []) damage(battle, unit, target, { scale: target.s.def > 0 ? 1.2 : 1, type: 'phys', sourceKey: keyOf('uniequip_003_hsguma', 'thorn'), cause: ctx.cause }); });
});

// 闲置的拳击手套: healing range +1 (the 4-star resist on heal was removed).
const demkni = moduleRecord('char_202_demkni', (battle, unit) => {
  installOnActiveBuff(battle, unit, 'uniequip_002_demkni', { rangeExtend: 1 });
});

const demkniArmor = moduleRecord('char_202_demkni', () => {});

const blemsh = moduleRecord('char_423_blemsh', () => {});

const blemshStrike = moduleRecord('char_423_blemsh', (battle, unit) => {
  // “长骑”: each attack on a sleeping enemy charges 1 (the 4-star skill +15% was removed).
  on(battle, 'attack', unit, (ctx) => { if (ctx.attacker === unit && active(unit) && (ctx.targets ?? []).some((target) => target.buffs?.some((b) => b.status === 'sleep') || target.s?.flags?.sleep)) sp(battle, unit, unit, 1, 'module:blemsh:sleep', keyOf('uniequip_003_blemsh', 'sp'), ctx.cause); });
});

// The main native tile consumer applies the selected module duration, protect and attack values.
const shu = Object.freeze({ charId: 'char_2025_shu', unlockStar: 3, delegatedToMain: true });

// Mudrock's main native talent consumes this selected module's cap, heal, and shield defense.
const mudrok = Object.freeze({ charId: 'char_311_mudrok', unlockStar: 3, delegatedToMain: true });

const mudrokHammer = moduleRecord('char_311_mudrok', (battle, unit) => {
  on(battle, 'damaged', unit, (ctx) => {
    const hitSet = unit.mem?.supportMudrokHammerCastTargets;
    if (ctx.source === unit && ctx.target?.side === 'enemy' && !ctx.target.isFlying && ctx.dmg?.attackId === 'assault:char_311_mudrok:skill:1' && hitSet instanceof Set) hitSet.add(ctx.target);
  });
}, (ctx) => {
  ctx.unit.mem ??= {};
  ctx.unit.mem.supportMudrokHammerCastTargets = new Set();
}, (ctx) => {
  const hits = ctx.unit.mem?.supportMudrokHammerCastTargets;
  delete ctx.unit.mem.supportMudrokHammerCastTargets;
  // 沃土的愿景: hitting 3+ enemies charges {s} from 3 stars (the 40% stun is in support.js).
  if (hits instanceof Set && hits.size >= 3) sp(ctx.battle, ctx.unit, ctx.unit, mv(ctx.unit, 'uniequip_003_mudrok', 's'), 'module:mudrok:threeTargets', keyOf('uniequip_003_mudrok', 'sp'), ctx.cause);
});

const judge = Object.freeze({ charId: 'char_4065_judge', unlockStar: 3, delegatedToMain: true });

const judgeBarrier = Object.freeze({ charId: 'char_4065_judge', unlockStar: 3, delegatedToMain: true });

// 祖玛玛的工具箱: the skill deals {a}% more damage (the 4-star post-stun
// vulnerability window was removed).
const zumama = moduleRecord('char_416_zumama', () => {}, (ctx) => {
  ctx.damageMul = (ctx.damageMul ?? 1) * (1 + mv(ctx.unit, 'uniequip_002_zumama', 'a', { percent: true }));
});

// “小小的丑东西”: takes {a}% less damage while blocking (the blocking SP trickle
// was removed; the reduction now starts at 3 stars).
const zumamaCharge = moduleRecord('char_416_zumama', (battle, unit) => {
  const cut = mv(unit, 'uniequip_003_zumama', 'a', { percent: true });
  on(battle, 'hpDamage', unit, (ctx) => { if (ctx.target === unit && active(unit) && unit.blocking?.some(active) && ctx.amount > 0) ctx.amount *= 1 - cut; });
});

// 森蚺特限证章: above 50% HP this operator deals {a}% more damage (the 4-star
// low-HP guard was removed).
const zumamaHp = moduleRecord('char_416_zumama', (battle, unit) => {
  const bonus = mv(unit, 'uniequip_004_zumama', 'a', { percent: true });
  on(battle, 'hit', unit, (ctx) => {
    if (ctx.source !== unit || !active(unit) || !ctx.dmg || !Number.isFinite(ctx.dmg.mul ?? 1) || unit.hp / Math.max(1, unit.s.maxHp) <= 0.5) return;
    ctx.dmg.mul = (ctx.dmg.mul ?? 1) * (1 + bonus);
  }, -20);
});

// “典范之人”: skill radius +1 (support-instant); the 4-star arts splash /
// overload scale was removed.
const horn = moduleRecord('char_4039_horn', (battle, unit, body) => {
  if (body.fixedSkill?.resolution === 'single-cast-v2') return;
  unit.mem.assaultHornModule = { splashRadiusAdd: 1 };
});

const hornAmmo = moduleRecord('char_4039_horn', (battle, unit, _body, _piece, star) => {
  if(_body.fixedSkill?.resolution==='single-cast-v2')return; // The new cast owns its two-round firing counter.
  unit.mem.assaultHornModule = { magazineAdd: 5 };
  setAssaultAmmoCapacityBonus(unit, 'uniequip_003_horn', 5);
  if (star >= 4) on(battle, 'reloaded', unit, (ctx) => {
    if (ctx.unit !== unit || !(ctx.amount > 0) || !active(unit)) return;
    const distanceSq = target => (target.x - unit.x) ** 2 + (target.y - unit.y) ** 2;
    const target = [...enemies(battle, unit, { scope: 'range', count: 99 })].sort((a, b) => distanceSq(b) - distanceSq(a) || uid(a).localeCompare(uid(b)))[0];
    if (target) battle.forceAttack(unit, [target]);
  });
});

// “私家英雄”: the mobile shield lasts 10 s longer (support.js summon); the
// 4-star shield-break explosion was removed.
const jesca = moduleRecord('char_1034_jesca2', () => {});

// 未曾风化: the skill fires 1 more round (support-instant); the 4-star +2 s
// shield stun was removed.
const jescaAmmo = moduleRecord('char_1034_jesca2', (battle, unit, body) => {
  if(body.fixedSkill?.resolution!=='single-cast-v2')setAssaultAmmoCapacityBonus(unit, 'uniequip_003_jesca2', 5);
});

const rmixer = moduleRecord('char_4194_rmixer', () => {});

// “老朋友”: whenever this operator reloads another friendly operator, charge
// this operator {s} (the idle-shield +5% was removed).
const rmixerShield = moduleRecord('char_4194_rmixer', (battle, unit) => {
  on(battle, 'reloaded', unit, (ctx) => {
    const target = ctx.target ?? ctx.unit;
    if (!active(unit) || ctx.source !== unit || !target || target === unit || target.side !== 'ally' || !(ctx.amount > 0)) return;
    sp(battle, unit, unit, mv(unit, 'uniequip_003_rmixer', 's'), 'module:rmixer:reload', keyOf('uniequip_003_rmixer', 'sp'), ctx.cause);
  });
});

// Yu, Grani and Mon3tr already have complete, independently verified main-kit
// module paths.  The explicit records prevent a second installation from
// applying a second buff while allowing the parent hook to account for them.
const yu = Object.freeze({ charId: 'char_2026_yu', unlockStar: 3, delegatedToMain: true });
const grani = Object.freeze({ charId: 'char_220_grani', unlockStar: 3, delegatedToMain: true });
const monstr = Object.freeze({ charId: 'char_4179_monstr', unlockStar: 3, delegatedToMain: true });

export const supportModuleHandlers = Object.freeze({
  uniequip_002_vigna: vigna,
  uniequip_002_myrtle: myrtle,
  uniequip_002_flower: flower,
  uniequip_002_finlpp: finlpp,
  uniequip_002_yak: yak,
  uniequip_002_snakek: snakek,
  uniequip_002_bubble: bubble,
  uniequip_002_sunbr: sunbr,
  uniequip_002_plosis: plosis,
  uniequip_002_rosesa: rosesa,
  uniequip_002_texas: texas,
  uniequip_002_chiave: chiave,
  uniequip_002_wildmn: wildmn,
  uniequip_002_elysm: elysm,
  uniequip_002_wanqin: wanqin,
  uniequip_002_ctable: ctable,
  uniequip_002_puzzle: puzzle,
  uniequip_002_silent: silent,
  uniequip_002_bldsk: bldsk,
  uniequip_002_reckpr: reckpr,
  uniequip_002_harold: harold,
  uniequip_002_vendla: vendla,
  uniequip_002_papyrs: papyrs,
  uniequip_002_liskam: liskam,
  uniequip_002_udflow: udflow,
  uniequip_002_branch: branch,
  uniequip_002_ashlok: ashlok,
  uniequip_002_philae: philae,
  uniequip_002_siege: siege,
  uniequip_003_siege: siegeBanner,
  uniequip_002_bpipe: bpipe,
  uniequip_003_bpipe: bpipeKill,
  uniequip_002_vulpis: vulpis,
  uniequip_003_vulpis: vulpisDouble,
  uniequip_002_sleach: sleach,
  uniequip_003_sleach: sleachHit,
  uniequip_002_flamtl: flamtl,
  uniequip_003_flamtl: flamtlAura,
  uniequip_002_vigil: vigil,
  uniequip_003_vigil: vigilReform,
  uniequip_002_mlyss: mlyss,
  uniequip_003_mlyss: mlyssRefresh,
  uniequip_002_ines: ines,
  uniequip_002_lumen: lumen,
  uniequip_003_lumen: lumenResist,
  uniequip_002_agoat2: agoat2,
  uniequip_003_agoat2: agoat2Barrier,
  uniequip_002_reed2: reed2,
  uniequip_003_reed2: reed2Seed,
  uniequip_002_titi: titi,
  uniequip_002_monstr: monstr,
  uniequip_002_hsguma: hsguma,
  uniequip_003_hsguma: hsgumaThorn,
  uniequip_002_demkni: demkni,
  uniequip_003_demkni: demkniArmor,
  uniequip_002_blemsh: blemsh,
  uniequip_003_blemsh: blemshStrike,
  uniequip_002_shu: shu,
  uniequip_003_shu: shu,
  uniequip_002_mudrok: mudrok,
  uniequip_003_mudrok: mudrokHammer,
  uniequip_002_judge: judge,
  uniequip_003_judge: judgeBarrier,
  uniequip_002_zumama: zumama,
  uniequip_003_zumama: zumamaCharge,
  uniequip_004_zumama: zumamaHp,
  uniequip_002_horn: horn,
  uniequip_003_horn: hornAmmo,
  uniequip_002_jesca2: jesca,
  uniequip_003_jesca2: jescaAmmo,
  uniequip_002_rmixer: rmixer,
  uniequip_003_rmixer: rmixerShield,
  uniequip_002_yu: yu,
  uniequip_002_grani: grani,
});
