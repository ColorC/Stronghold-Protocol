// Bazaar-style card lines for the support family (data/assault-design/bazaar-cards-support.json).
// Every number is read from body.bazaar (compiled by tools/assault/build-runtime-data.mjs):
// lines[i].params / modules[moduleId].params, four star tiers, percentages as integers.
// Old passives replaced by these lines are listed in supportBazaarSuppressed and skipped by support.js.
import { active, allies, enemies, v, uid, sp, buff, haste, heal, gainDP, damage, applyStatus, watch, matchesTags } from '../primitives.js';

const EPS = 1e-9;
function linePar(body, line, name) {
  const value = body.bazaar?.lines?.[line]?.params?.[name];
  if (!Array.isArray(value)) throw new Error(`${body.charId ?? 'support'} bazaar line ${line} lacks param ${name}`);
  return Number(v(body, value));
}
function modPar(body, moduleId, name) {
  const value = body.bazaar?.modules?.[moduleId]?.params?.[name];
  if (!Array.isArray(value)) throw new Error(`${body.charId ?? 'support'} bazaar module ${moduleId} lacks param ${name}`);
  return Number(v(body, value));
}
const mine = (unit, x) => !!x && x.side === 'ally' && x.ownerId === unit.ownerId;
const myOp = (unit, x, tag = null, excludeSelf = false) => mine(unit, x) && x.kind === 'op' && (!excludeSelf || x !== unit) && (!tag || matchesTags(x, tag));
const myToken = (unit, x) => mine(unit, x) && x.kind === 'token';
const hasModule = (unit, id) => unit.assaultSupportModules?.has(id) === true;
const limiter = (n) => { let used = 0; return () => (used < n ? (used++, true) : false); };
const K = (unit, suffix) => `assault:${unit.def?.charId}:bazaar:${suffix}`;
function on(battle, unit, type, suffix, pred, fn) {
  return watch(battle, unit, type, `bazaar:${suffix}`, ({ payload }) => pred(payload ?? {}), ({ payload, cause }) => fn(payload ?? {}, cause));
}
function charge(battle, unit, target, amount, suffix, cause) {
  if (!(amount > 0) || !active(target) || !target.skill) return 0;
  return sp(battle, unit, target, amount, K(unit, suffix), K(unit, suffix), cause);
}
const attackedBy = (p) => p.sourceClass === 'attack' && p.source?.side === 'enemy';
function aura(battle, unit, suffix, select, mods) {
  const key = `${K(unit, suffix)}:${uid(unit)}`;
  battle.every(0.25, () => {
    if (!active(unit)) return;
    for (const t of select()) if (active(t)) buff(battle, unit, t, { key, mods: typeof mods === 'function' ? mods(t) : mods, duration: 0.5, stacking: 'replace', notify: false });
  }, { owner: unit });
}
// 「当你的[类型]干员施放技能时，为此干员充能 X」
function chargeOnAllySkill(ctx, line, param, tag, { excludeSelf = false, limit = Infinity } = {}) {
  const { battle, unit, body } = ctx, ok = limiter(limit), amount = linePar(body, line, param);
  on(battle, unit, 'skillStart', `skill-${tag}`, p => myOp(unit, p.source, tag, excludeSelf), (_p, cause) => { if (ok()) charge(battle, unit, unit, amount, `skill-${tag}`, cause); });
}
function chargeOnAllyDeploy(ctx, line, param, tag, { excludeSelf = false } = {}) {
  const { battle, unit, body } = ctx, amount = linePar(body, line, param);
  on(battle, unit, 'deployed', `deploy-${tag}`, p => myOp(unit, p.source, tag, excludeSelf), (_p, cause) => charge(battle, unit, unit, amount, `deploy-${tag}`, cause));
}
function chargeOnAllyKill(ctx, line, param, tag, { limit = Infinity, tokens = false } = {}) {
  const { battle, unit, body } = ctx, ok = limiter(limit), amount = param == null ? 1 : linePar(body, line, param);
  on(battle, unit, 'kill', `kill-${tag ?? 'summon'}`, p => p.target?.side === 'enemy' && (tokens ? myToken(unit, p.source) : myOp(unit, p.source, tag)),
    (_p, cause) => { if (ok()) charge(battle, unit, unit, amount, `kill-${tag ?? 'summon'}`, cause); });
}
function selfStacks(ctx, line, param, max, suffix) {
  const { battle, unit, body } = ctx, step = linePar(body, line, param) / 100, key = K(unit, suffix);
  let stacks = 0;
  return () => { if (stacks >= max) return false; stacks++; buff(battle, unit, unit, { key, mods: { atkMul: 1 + step * stacks }, duration: Infinity, stacking: 'replace' }); return true; };
}
// 「获得 X 再生，持续 T 秒」：hpRegen per second for T seconds.
function regen(battle, unit, target, amount, duration, key, { stacking = 'replace', maxStacks = 1 } = {}) {
  if (!(amount > 0 && duration > 0) || !active(target)) return null;
  return buff(battle, unit, target, { key, mods: { hpRegen: amount }, duration, stacking, maxStacks });
}

const HANDLERS = {
  char_240_wyvern(ctx) { // 当你获得费用时，你的先锋干员本场战斗中 +a% 攻击力（最多 5 层）
    const { battle, unit, body } = ctx, step = linePar(body, 1, 'a') / 100, key = K(unit, 'dp-pioneer-atk');
    let stacks = 0;
    const apply = (t) => { if (stacks > 0 && myOp(unit, t, 'PIONEER') && t.alive) buff(battle, unit, t, { key, mods: { atkMul: 1 + step * stacks }, duration: Infinity, stacking: 'replace' }); };
    on(battle, unit, 'dpReceived', 'dp-pioneer', p => p.targetUid === unit.ownerId && p.sourceClass !== 'natural' && p.amount > 0, () => {
      if (stacks >= 5) return; stacks++; for (const t of battle.allyUnits) apply(t);
    });
    battle.on('deploy', e => apply((e.payload ?? e).unit), { owner: unit });
  },
  char_290_vigna(ctx) { // 暴击每名目标独立掷；击倒时获得 1 费用并为相邻干员充能 1
    const { battle, unit, body } = ctx, base = linePar(body, 0, 'c') / 100;
    const prob = base + (hasModule(unit, 'uniequip_002_vigna') && ctx.star >= 3 ? modPar(body, 'uniequip_002_vigna', 'c') / 100 : 0);
    const critScale = Number(v(body, ctx.plan.skill.effects.find(e => e.params?.critScale != null)?.params?.critScale ?? [1.5, 1.75, 2, 2.5]));
    battle.on('hit', (event) => {
      const c = event.payload ?? event;
      if (c.source !== unit || c.target?.side !== 'enemy' || !c.dmg || c.dmg.attackId !== 'assault:char_290_vigna:skill:0') return;
      if (battle.rng() < prob) { c.dmg.mul = (c.dmg.mul ?? 1) * critScale; c.dmg.crit = true; }
    }, { owner: unit, priority: -20 });
    on(battle, unit, 'kill', 'kill-dp', p => p.source === unit && p.target?.side === 'enemy', (_p, cause) => {
      gainDP(battle, unit, 1, K(unit, 'kill-dp'), cause);
      for (const t of allies(battle, unit, { scope: 'adjacent4', count: 99, excludeSelf: true })) if (mine(unit, t)) charge(battle, unit, t, 1, 'kill-sp', cause);
    });
  },
  char_151_myrtle(ctx) { // 当你获得费用时，治疗攻击范围内的先锋干员 h% 攻击力
    const { battle, unit, body } = ctx, scale = linePar(body, 1, 'h') / 100;
    on(battle, unit, 'dpReceived', 'dp-heal', p => p.targetUid === unit.ownerId && p.sourceClass !== 'natural' && p.amount > 0, (_p, cause) => {
      for (const t of allies(battle, unit, { scope: 'range', count: 99, tags: ['PIONEER'] })) if (mine(unit, t) && t.hp < t.s.maxHp - EPS) heal(battle, unit, t, { scale, cause });
    });
  },
  char_181_flower(ctx) { // 罗德岛施放技能充能（前 10 次）；施放技能时你的干员获得再生
    const { battle, unit, body } = ctx;
    chargeOnAllySkill(ctx, 1, 'b', 'rhodes', { limit: 10 });
    const amount = linePar(body, 2, 'r'), duration = linePar(body, 2, 't') + (hasModule(unit, 'uniequip_002_flower') && ctx.star >= 3 ? 2 : 0);
    on(battle, unit, 'skillStart', 'regen', p => p.source === unit, () => {
      for (const t of allies(battle, unit, { scope: 'field', count: 99 })) if (mine(unit, t)) regen(battle, unit, t, amount, duration, K(unit, 'regen'));
    });
  },
  char_385_finlpp(ctx) { // 施放技能时加速攻击范围内的炎干员
    const { battle, unit, body } = ctx, t = linePar(body, 1, 't');
    on(battle, unit, 'skillStart', 'haste-yan', p => p.source === unit, (_p, cause) => {
      for (const a of allies(battle, unit, { scope: 'range', count: 99, tags: ['yan'] })) if (mine(unit, a)) haste(battle, unit, a, t, K(unit, 'haste-yan'), { cause });
    });
  },
  char_199_yak(ctx) { // 当敌人获得寒冷或冻结时，为此干员充能（前 10 次）
    const { battle, unit, body } = ctx, ok = limiter(10), amount = linePar(body, 2, 's');
    on(battle, unit, 'statusApplied', 'cold-sp', p => p.target?.side === 'enemy' && ['cold', 'frozen', 'freeze'].includes(p.status), (_p, cause) => { if (ok()) charge(battle, unit, unit, amount, 'cold-sp', cause); });
  },
  char_150_snakek(ctx) { // 受到攻击时此干员与相邻干员 +a% 防御 5 秒
    const { battle, unit, body } = ctx, a = linePar(body, 1, 'a') / 100;
    on(battle, unit, 'damageTaken', 'guard', p => p.target === unit && attackedBy(p), (_p, cause) => {
      for (const t of [unit, ...allies(battle, unit, { scope: 'adjacent4', count: 99, excludeSelf: true })]) if (mine(unit, t)) buff(battle, unit, t, { key: K(unit, 'guard'), mods: { defMul: 1 + a }, duration: 5, stacking: 'replace', cause });
    });
  },
  char_381_bubble(ctx) { // 此干员或相邻干员受到攻击时，攻击者 -a% 攻击力 5 秒；模组：停顿 0.5 秒（前 20 次）
    const { battle, unit, body } = ctx, a = linePar(body, 1, 'a') / 100, stagger = hasModule(unit, 'uniequip_002_bubble') && ctx.star >= 3 ? limiter(20) : null;
    on(battle, unit, 'damageTaken', 'weaken', p => attackedBy(p) && (p.target === unit || (mine(unit, p.target) && allies(battle, unit, { scope: 'adjacent4', count: 99, excludeSelf: true }).includes(p.target))), (p, cause) => {
      const attacker = p.source; if (!active(attacker)) return;
      buff(battle, unit, attacker, { key: K(unit, 'weaken'), mods: { atkMul: 1 - a }, duration: 5, stacking: 'replace', cause });
      if (stagger?.()) applyStatus(battle, unit, attacker, { status: 'sluggish', duration: 0.5, key: K(unit, 'stagger'), cause });
    });
  },
  char_196_sunbr(ctx) { // 当你治疗干员时，其 +a% 防御 5 秒（口径 a：你方任意单位的治疗）
    const { battle, unit, body } = ctx, a = linePar(body, 1, 'a') / 100;
    battle.on('heal', (event) => {
      const c = event.payload ?? event;
      if (!active(unit) || !mine(unit, c.source) || !mine(unit, c.target) || c.target.kind !== 'op' || !active(c.target) || !(c.amount > 0)) return;
      buff(battle, unit, c.target, { key: K(unit, 'heal-def'), mods: { defMul: 1 + a }, duration: 5, stacking: 'replace', cause: battle.assaultRuntime?.currentCause });
    }, { owner: unit });
  },
  char_128_plosis(ctx) { // 召唤物部署充能（前 8 次）；施放技能时加速你的全体干员
    const { battle, unit, body } = ctx, ok = limiter(8), c = linePar(body, 1, 'c');
    on(battle, unit, 'summonSpawned', 'summon-sp', p => myToken(unit, p.target), (_p, cause) => { if (ok()) charge(battle, unit, unit, c, 'summon-sp', cause); });
    const t = hasModule(unit, 'uniequip_002_plosis') && ctx.star >= 3 ? modPar(body, 'uniequip_002_plosis', 't') : linePar(body, 2, 't');
    on(battle, unit, 'skillStart', 'haste-all', p => p.source === unit, (_p, cause) => {
      for (const a of allies(battle, unit, { scope: 'field', count: 99, operatorsOnly: true })) if (mine(unit, a)) haste(battle, unit, a, t, K(unit, 'haste-all'), { cause });
    });
  },
  char_4163_rosesa(ctx) { // 治疗时被治疗干员受到治疗 +b% 8 秒（模组 +a 秒）；伊比利亚施放技能充能
    const { battle, unit, body } = ctx, b = linePar(body, 1, 'b') / 100;
    const duration = 8 + (hasModule(unit, 'uniequip_002_rosesa') && ctx.star >= 3 ? modPar(body, 'uniequip_002_rosesa', 'a') : 0);
    battle.on('heal', (event) => {
      const c = event.payload ?? event;
      if (!active(unit) || c.source !== unit || c.opts?.regen || !mine(unit, c.target) || !active(c.target) || !(c.amount > 0)) return;
      buff(battle, unit, c.target, { key: K(unit, 'heal-amp'), mods: { healingTakenMul: 1 + b }, duration, stacking: 'replace' });
    }, { owner: unit });
    chargeOnAllySkill(ctx, 2, 'c', 'iberia');
  },
  char_102_texas(ctx) { // 当你的企鹅物流干员部署时，获得 a 费用
    const { battle, unit, body } = ctx, a = linePar(body, 1, 'a');
    on(battle, unit, 'deployed', 'penguin-dp', p => myOp(unit, p.source, 'penguin'), (_p, cause) => gainDP(battle, unit, a, K(unit, 'penguin-dp'), cause));
  },
  char_349_chiave(ctx) { // 当你的召唤物部署时，此干员本场战斗中 +a% 攻击力（最多 3 层）；机械爪按召唤物计
    const { battle, unit } = ctx, stack = selfStacks(ctx, 1, 'a', 3, 'summon-atk');
    unit.mem ??= {}; unit.mem.bazaarChiaveSummoned = () => { if (active(unit)) stack(); };
    on(battle, unit, 'summonSpawned', 'summon-atk', p => myToken(unit, p.target), () => stack());
  },
  char_496_wildmn(ctx) { // 击倒时红松骑士团干员所需费用 -a（前 5 次）
    const { battle, unit, body } = ctx, ok = limiter(5), a = linePar(body, 1, 'a');
    on(battle, unit, 'kill', 'pinus-cost', p => p.source === unit && p.target?.side === 'enemy', () => {
      if (!ok()) return;
      for (const t of battle.allyUnits) if (myOp(unit, t, 'pinus') && !t.removed) { t.mem ??= {}; t.mem.assaultCostDelta = Math.max(-(t.base?.cost ?? 0), (t.mem.assaultCostDelta ?? 0) - a); }
    });
  },
  char_4119_wanqin(ctx) { // 施放技能时周围干员 +a% 最大生命 10 秒；其他炎干员施放技能充能
    const { battle, unit, body } = ctx, a = linePar(body, 1, 'a') / 100;
    on(battle, unit, 'skillStart', 'hp', p => p.source === unit, (_p, cause) => {
      for (const t of allies(battle, unit, { scope: 'adjacent8', count: 99, operatorsOnly: true })) if (mine(unit, t)) buff(battle, unit, t, { key: K(unit, 'hp'), mods: { hpMul: 1 + a }, duration: 10, stacking: 'replace', cause });
    });
    chargeOnAllySkill(ctx, 2, 's', 'yan', { excludeSelf: true });
  },
  char_497_ctable(ctx) { chargeOnAllySkill(ctx, 1, 's', 'rhodes', { excludeSelf: true }); },
  char_4017_puzzle(ctx) { // 当你的维多利亚干员部署时，为其充能 s
    const { battle, unit, body } = ctx, s = linePar(body, 2, 's');
    on(battle, unit, 'deployed', 'victoria-sp', p => myOp(unit, p.source, 'victoria'), (p, cause) => charge(battle, unit, p.source, s, 'victoria-sp', cause));
  },
  char_108_silent(ctx) { // 当你的召唤物部署时，你的医疗干员 +b 攻速 8 秒
    const { battle, unit, body } = ctx, b = linePar(body, 1, 'b');
    on(battle, unit, 'summonSpawned', 'medic-aspd', p => myToken(unit, p.target), (_p, cause) => {
      for (const t of battle.allyUnits) if (myOp(unit, t, 'MEDIC') && active(t)) buff(battle, unit, t, { key: K(unit, 'medic-aspd'), mods: { aspd: b }, duration: 8, stacking: 'replace', cause });
    });
  },
  char_4114_harold(ctx) { chargeOnAllyDeploy(ctx, 2, 'd', 'victoria'); },
  char_494_vendla(ctx) { // 攻击范围内的重装干员受到的治疗 +d%
    const { battle, unit, body } = ctx, d = linePar(body, 2, 'd') / 100;
    aura(battle, unit, 'tank-heal', () => allies(battle, unit, { scope: 'range', count: 99, tags: ['TANK'] }).filter(t => mine(unit, t)), { healingTakenMul: 1 + d });
  },
  char_4139_papyrs(ctx) { chargeOnAllySkill(ctx, 2, 'd', 'sargon'); },
  char_4222_taraxa(ctx) { // 施放技能时攻击范围内干员 +1 阻挡 t 秒；你的炎干员获得 c% 庇护
    const { battle, unit, body } = ctx, t = linePar(body, 1, 't'), c = linePar(body, 2, 'c') / 100;
    on(battle, unit, 'skillStart', 'block', p => p.source === unit, (_p, cause) => {
      for (const a of allies(battle, unit, { scope: 'range', count: 99, operatorsOnly: true })) if (mine(unit, a)) buff(battle, unit, a, { key: K(unit, 'block'), mods: { blockCnt: 1 }, duration: t, stacking: 'replace', cause });
    });
    aura(battle, unit, 'yan-protect', () => battle.allyUnits.filter(a => myOp(unit, a, 'yan')), { dmgTakenMul: 1 - c });
  },
  char_107_liskam(ctx) { /* 受击充能的前 20 次上限在 support.js 雷蛇分支内读 unit.mem.bazaarLiskamCharges */ ctx.unit.mem ??= {}; ctx.unit.mem.bazaarLiskamCharges = 0; },
  char_4137_udflow(ctx) { // 当阿戈尔干员击倒敌人时，此干员本场战斗中 +a% 攻击力（最多 5 层）
    const { battle, unit } = ctx, stack = selfStacks(ctx, 2, 'a', 5, 'egir-atk');
    on(battle, unit, 'kill', 'egir-atk', p => p.target?.side === 'enemy' && myOp(unit, p.source, 'egir'), () => stack());
  },
  char_4207_branch(ctx) { // 当相邻干员受到攻击时，为此干员充能 s（前 10 次）
    const { battle, unit, body } = ctx, ok = limiter(10), s = linePar(body, 2, 's');
    on(battle, unit, 'damageTaken', 'adjacent-hit', p => attackedBy(p) && p.target !== unit && mine(unit, p.target) && allies(battle, unit, { scope: 'adjacent4', count: 99, excludeSelf: true }).includes(p.target),
      (_p, cause) => { if (ok()) charge(battle, unit, unit, s, 'adjacent-hit', cause); });
  },
  char_431_ashlok(ctx) { chargeOnAllyDeploy(ctx, 1, 's', 'pinus'); },
  char_4148_philae(ctx) { // 当你引发元素爆发时，为此干员充能 s
    const { battle, unit, body } = ctx, s = linePar(body, 1, 's');
    on(battle, unit, 'elementBurst', 'burst-sp', p => mine(unit, p.source), (_p, cause) => charge(battle, unit, unit, s, 'burst-sp', cause));
  },
  char_112_siege(ctx) { chargeOnAllyKill(ctx, 1, null, 'glasgow'); },
  char_4026_vulpis(ctx) { chargeOnAllyKill(ctx, 1, 's', 'siracusa'); },
  char_479_sleach(ctx) { chargeOnAllyDeploy(ctx, 2, 's', 'victoria', { excludeSelf: true }); },
  char_427_vigil(ctx) { chargeOnAllyKill(ctx, 1, 's', null, { tokens: true }); },
  char_249_mlyss(ctx) { // 你的召唤物 +a% 攻击力
    const { battle, unit, body } = ctx, a = linePar(body, 2, 'a') / 100;
    aura(battle, unit, 'summon-atk', () => battle.allyUnits.filter(t => myToken(unit, t)), { atkMul: 1 + a });
  },
  char_4087_ines(ctx) { // 当你再部署干员时，为此干员充能 s，获得 1 费用
    const { battle, unit, body } = ctx, s = linePar(body, 2, 's');
    on(battle, unit, 'redeploy', 'redeploy', p => myOp(unit, p.target), (_p, cause) => { charge(battle, unit, unit, s, 'redeploy', cause); gainDP(battle, unit, 1, K(unit, 'redeploy-dp'), cause); });
  },
  char_1016_agoat2(ctx) { // 当你引发元素爆发时，为此干员充能 c（前 8 次）；再生行在 support.js 氤氲分支读 body.bazaar
    const { battle, unit, body } = ctx, ok = limiter(8), c = linePar(body, 2, 'c');
    on(battle, unit, 'elementBurst', 'burst-sp', p => mine(unit, p.source), (_p, cause) => { if (ok()) charge(battle, unit, unit, c, 'burst-sp', cause); });
  },
  char_1020_reed2(ctx) { // 造成伤害时 30%（模组 a%）几率施加 b% 法术脆弱 6 秒；近卫击倒充能（前 10 次）
    const { battle, unit, body } = ctx, b = linePar(body, 1, 'b') / 100;
    const prob = hasModule(unit, 'uniequip_002_reed2') && ctx.star >= 3 ? modPar(body, 'uniequip_002_reed2', 'a') / 100 : 0.3;
    battle.on('damaged', (event) => {
      const c = event.payload ?? event, target = c.target;
      if (c.source !== unit || !active(unit) || target?.side !== 'enemy' || !target.alive || !(c.amount > 0) || c.dmg?.type === 'element') return;
      if (battle.rng() < prob) applyStatus(battle, unit, target, { status: 'artsFragile', duration: 6, value: b, key: K(unit, 'fragile'), cause: battle.assaultRuntime?.currentCause });
    }, { owner: unit });
    chargeOnAllyKill(ctx, 2, 'c', 'WARRIOR', { limit: 10 });
  },
  char_4056_titi(ctx) { // 当你施加睡眠时，为此干员充能 c
    const { battle, unit, body } = ctx, c = linePar(body, 2, 'c');
    on(battle, unit, 'statusApplied', 'sleep-sp', p => p.status === 'sleep' && mine(unit, p.source), (_p, cause) => charge(battle, unit, unit, c, 'sleep-sp', cause));
  },
  char_136_hsguma(ctx) { // 此干员或相邻干员受到攻击时反击 a%（模组 +a%）；龙门部署时获得护盾
    const { battle, unit, body } = ctx;
    const scale = linePar(body, 1, 'a') / 100 * (1 + (hasModule(unit, 'uniequip_003_hsguma') && ctx.star >= 3 ? modPar(body, 'uniequip_003_hsguma', 'a') / 100 : 0));
    on(battle, unit, 'damageTaken', 'thorns', p => attackedBy(p) && (p.target === unit || (mine(unit, p.target) && allies(battle, unit, { scope: 'adjacent4', count: 99, excludeSelf: true }).includes(p.target))), (p, cause) => {
      if (active(p.source)) damage(battle, unit, p.source, { scale, type: 'phys', sourceKey: K(unit, 'thorns'), cause });
    });
    const ratio = linePar(body, 2, 'p') / 100, key = K(unit, 'lungmen-shield');
    on(battle, unit, 'deployed', 'lungmen-shield', p => myOp(unit, p.source, 'lungmen'), () => {
      const old = unit.findBuff?.(key);
      battle.addBuff(unit, { key, shield: (old?.shield ?? 0) + unit.s.maxHp * ratio, duration: Infinity, refresh: 'replace', source: unit, visible: true, tags: ['talent'] });
    });
  },
  char_202_demkni(ctx) { // 你的莱茵生命干员 +a% 防御（模组再 +a%）
    const { battle, unit, body } = ctx, a = linePar(body, 2, 'a') / 100 + (hasModule(unit, 'uniequip_003_demkni') && ctx.star >= 3 ? modPar(body, 'uniequip_003_demkni', 'a') / 100 : 0);
    aura(battle, unit, 'rhine-def', () => battle.allyUnits.filter(t => myOp(unit, t, 'rhine')), { defMul: 1 + a });
  },
  char_423_blemsh(ctx) { // 当卡西米尔干员受到攻击时，为此干员充能 s（前 10 次）
    const { battle, unit, body } = ctx, ok = limiter(10), s = linePar(body, 1, 's');
    on(battle, unit, 'damageTaken', 'kazimierz-hit', p => attackedBy(p) && myOp(unit, p.target, 'kazimierz'), (_p, cause) => { if (ok()) charge(battle, unit, unit, s, 'kazimierz-hit', cause); });
  },
  char_2025_shu(ctx) { chargeOnAllySkill(ctx, 2, 's', 'sui', { excludeSelf: true }); },
  char_311_mudrok(ctx) { chargeOnAllySkill(ctx, 2, 's', 'rhodes', { excludeSelf: true }); },
  char_4065_judge(ctx) { /* 叙拉古击倒得护盾：support.js 斥罪分支按 bazaar 行改判击倒者 */ },
  char_416_zumama(ctx) { // 阻挡敌人时加速此干员 t 秒；晕眩敌人时相邻干员 +a% 攻击力 5 秒
    const { battle, unit, body } = ctx, t = linePar(body, 1, 't'), a = linePar(body, 2, 'a') / 100;
    battle.on('blocked', (event) => { const c = event.payload ?? event; if (c.blocker === unit && active(unit)) haste(battle, unit, unit, t, K(unit, 'block-haste')); }, { owner: unit });
    on(battle, unit, 'statusApplied', 'stun-atk', p => p.source === unit && p.status === 'stun' && p.target?.side === 'enemy', (_p, cause) => {
      for (const x of allies(battle, unit, { scope: 'adjacent4', count: 99, excludeSelf: true })) if (mine(unit, x)) buff(battle, unit, x, { key: K(unit, 'stun-atk'), mods: { atkMul: 1 + a }, duration: 5, stacking: 'replace', cause });
    });
  },
  char_4194_rmixer(ctx) { // 当你的拉特兰干员装填时，为此干员充能 s（前 10 次）
    const { battle, unit, body } = ctx, ok = limiter(10), s = linePar(body, 2, 's');
    on(battle, unit, 'reloaded', 'laterano-reload', p => myOp(unit, p.target, 'laterano'), (_p, cause) => { if (ok()) charge(battle, unit, unit, s, 'laterano-reload', cause); });
  },
  char_2026_yu(ctx) { chargeOnAllySkill(ctx, 2, 's', 'sui', { excludeSelf: true }); },
  char_1034_jesca2(ctx) { // 机动盾牌与相邻干员 +a% 防御
    const { battle, unit, body } = ctx, a = linePar(body, 2, 'a') / 100;
    aura(battle, unit, 'shield-def', () => {
      const shields = battle.allyUnits.filter(t => myToken(unit, t) && t.ownerUnit === unit && active(t));
      const out = new Set(shields);
      for (const s of shields) for (const x of allies(battle, s, { scope: 'adjacent4', count: 99 })) if (mine(unit, x) && x.kind === 'op') out.add(x);
      return [...out];
    }, { defMul: 1 + a });
  },
};

// Old typed passives / talents replaced by a bazaar line (key: `${charId}:${plan key}`).
export const supportBazaarSuppressed = new Set([
  'char_240_wyvern:passive:0', 'char_290_vigna:passive:0', 'char_151_myrtle:passive:0', 'char_181_flower:passive:0',
  'char_150_snakek:passive:0', 'char_381_bubble:passive:0', 'char_128_plosis:passive:0', 'char_4163_rosesa:passive:0',
  'char_102_texas:passive:0', 'char_496_wildmn:passive:0', 'char_4119_wanqin:passive:0', 'char_497_ctable:passive:0',
  'char_108_silent:passive:0', 'char_494_vendla:passive:0', 'char_112_siege:passive:0', 'char_1020_reed2:passive:0',
  'char_136_hsguma:passive:0',
]);

export function installSupportBazaar(ctx) {
  const handler = HANDLERS[ctx.charId];
  if (!handler || !ctx.body?.bazaar) return false;
  handler(ctx);
  return true;
}
export const supportBazaarHandledCards = Object.freeze(Object.keys(HANDLERS));
