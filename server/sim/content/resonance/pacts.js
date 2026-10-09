import { ADD_KEYS, MUL_KEYS } from '../../buffs.js';

const SPECIAL = new Set(['aegir', 'holyGun', 'yela']);
const PACT_IDS = new Set([
  'laterano','kjerag','yan','victoria','columbia','kazimierz','siracusa','rhodes','lungmen','sargon','leithania','iberia','higashi','ursus','bolivar','rim','babel','sami',
  'ammo','combo','control','creation','symbiosis','logistics','redeploy','flight','arts','breaker','burn','necrosis','sui','crown',
]);
const SUPPORTED = new Set(['stat','aegir_cycle','laterano_ammo','kjerag_coordination','yan_combo','victoria_artillery','columbia_construct','kazimierz_true_damage','siracusa_execute','siracusa_harvest','rhodes_first_cast','lungmen_reward','sargon_sand','leithania_sound','iberia_barrier','higashi_redeploy','ursus_adjacency','bolivar_slow','rim_forge','babel_exit','sami_cold','ammo_last_round','combo_sixth','control_first','creation_construct','symbiosis_barrier','logistics_dp','redeploy_return','flight_dive','arts_cycle','breaker_front','burn_spread','necrosis_burst','sui_shadow','crown_memory','holy_gun','yela_breath']);
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const norm = (value) => String(value ?? '').replace(/_[ab]$/, '');
const contentOf = (catalog) => catalog?.resonanceContent ?? catalog ?? {};
const inputOf = (unit) => unit?.player?.input?.units?.find((entry) => String(entry?.uid) === String(unit.uid) && entry.kind !== 'token') ?? null;
const operatorMap = (content) => {
  const map = new Map();
  for (const [key, operator] of Object.entries(content.operators ?? {})) {
    map.set(norm(operator.sourceChessId ?? key), operator);
    if (operator.charId) map.set(operator.charId, operator);
  }
  return map;
};
function operatorOf(unit, bySource) {
  const raw = unit?.def?.raw ?? unit?.def ?? {};
  return bySource.get(raw.charId) ?? bySource.get(norm(raw.id ?? raw.chessId ?? unit?.defId)) ?? null;
}
function pactIds(unit, operator) {
  const ids = new Set(operator?.pacts ?? []);
  for (const id of inputOf(unit)?.extraPacts ?? []) ids.add(id);
  for (const id of unit?.mem?.resonancePacts ?? []) ids.add(id);
  return ids;
}
function tierRows(pact) { return Array.isArray(pact?.levels) ? pact.levels : Array.isArray(pact?.tiers) ? pact.tiers : []; }
function activePacts(battle, content, bySource) {
  const active = new Map();
  const units = (battle.allyUnits ?? []).filter((unit) => unit.kind === 'op' && !unit.removed);
  for (const id of PACT_IDS) {
    const members = new Map();
    for (const unit of units) {
      const operator = operatorOf(unit, bySource);
      if (!operator || !pactIds(unit, operator).has(id)) continue;
      const charId = operator.charId ?? operator.id;
      if (!members.has(charId)) members.set(charId, []);
      members.get(charId).push(unit);
    }
    const count = members.size;
    const tier = tierRows(content.pacts?.[id]).filter((row) => n(row.threshold ?? row.count, 1) <= count).sort((a, b) => n(a.threshold ?? a.count) - n(b.threshold ?? b.count)).at(-1);
    if (tier) active.set(id, { id, members, count, tier: n(tier.threshold ?? tier.count, 1), effects: tier.effects ?? [] });
  }
  return active;
}
function effect(active, pactId, kind) { return active.get(pactId)?.effects.find((row) => row.kind === kind) ?? null; }
function params(active, pactId, kind) { return effect(active, pactId, kind)?.params ?? {}; }
function memberUnits(entry) { return [...(entry?.members?.values?.() ?? [])].flat(); }
function enemyList(battle) { return (battle.enemies ?? []).filter((unit) => unit.alive && unit.deployed && !unit.hidden); }
function nearestEnemy(battle, unit, range = Infinity) {
  return enemyList(battle).filter((enemy) => Math.hypot(enemy.x - unit.x, enemy.y - unit.y) <= range)
    .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y) || a.id - b.id)[0] ?? null;
}
function area(battle, x, y, radius) { return battle.foesInRadius(x, y, radius, true).filter((unit) => unit.alive); }
function deal(battle, source, target, amount, type = 'arts', tags = []) {
  if (!source || !target?.alive || !(amount > 0)) return;
  battle.dealDamage(source, target, { amount, type, canDodge: false, tags: ['resonance', ...tags] });
}
function buff(battle, unit, key, mods, duration = Infinity) {
  if (unit?.alive || unit?.deployed) battle.addBuff(unit, { key: `resonance:pact:${key}:${unit.id}`, duration, mods, tags: ['resonance', 'pact'] });
}
function statMods(effects) {
  const mods = {};
  for (const row of effects) if (row.kind === 'stat') {
    const p = row.params ?? {};
    const key = p.stat;
    const value = n(p.value, NaN);
    if (!key || !Number.isFinite(value) || !['add','percent','mul'].includes(p.mode)) throw new Error(`INVALID_RESONANCE_STAT_EFFECT:${JSON.stringify(p)}`);
    const target = p.mode === 'percent'
      ? ({ maxHp:'hpPct', atk:'atkPct', def:'defPct', atkFromHp:'atkHpPct', artsDamage:'artsDealtMul' }[key] ?? key)
      : p.mode === 'mul' ? (key.endsWith('Mul') ? key : `${key}Mul`)
        : ({ maxHp:'hpFlat', atk:'atkFlat', def:'defFlat' }[key] ?? key);
    if (p.mode === 'percent' && target === 'artsDealtMul') mods[target] = 1 + value / 100;
    else if (p.mode === 'mul') mods[target] = (mods[target] ?? 1) * value;
    else mods[target] = (mods[target] ?? 0) + (p.mode === 'percent' ? value / 100 : value);
    if (!(ADD_KEYS.includes(target) || MUL_KEYS.includes(target))) throw new Error(`UNKNOWN_RESONANCE_STAT_MOD:${p.mode}:${key}:${target}`);
  }
  return mods;
}
function profileFor(operator, unit) {
  const raw = unit?.def?.raw ?? unit?.def ?? {};
  const star = n(raw.resonanceStar ?? raw.resonance?.star ?? inputOf(unit)?.star, 1);
  const passive = star >= 3 && operator.cost < 5 ? operator.stars?.[3]?.passive : null;
  return { star, passives: [passive, passive?.additionalEffect].filter((row) => row && row.kind && row.kind !== 'none') };
}
function applyTierStats(battle, active) {
  for (const pact of active.values()) {
    const mods = statMods(pact.effects);
    if (pact.id === 'kazimierz') mods.defIgnorePct = n(params(active, 'kazimierz', 'kazimierz_true_damage').pierce, 15) / 100;
    if (pact.id === 'breaker') mods.defIgnorePct = n(params(active, 'breaker', 'breaker_front').defPen, 10) / 100;
    if (!Object.keys(mods).length) continue;
    for (const unit of memberUnits(pact)) buff(battle, unit, `${pact.id}:tier:${pact.tier}`, mods);
  }
}
function metric(battle, key, value = 1) { battle.resonanceMetric?.(`triggers.${key}`, value); }
function recordGrowth(battle, state, unit, key, amount, cap = Infinity, source = 'pact') {
  const piece = (state?.pieces ?? []).find((row) => String(row.uid) === String(unit?.uid));
  if (!piece || !(amount > 0)) return;
  const queue = battle.resonanceResults?.growth ?? [];
  const old = n(piece.growth?.[key]) + queue.filter((row) => String(row.pieceUid) === String(piece.uid) && row.key === key).reduce((sum, row) => sum + n(row.amount), 0);
  const actual = Math.max(0, Math.min(amount, Number.isFinite(cap) ? cap - old : amount));
  if (actual) queue.push({ pieceUid: piece.uid, key, amount: actual, ...(Number.isFinite(cap) ? { cap } : {}), source });
}
function battleWon(result) {
  if (result?.reason !== 'cleared') return false;
  const players=Object.values(result.perPlayer??{});
  if(players.some((player)=>player.perfect===false||(player.leaked??[]).some((row)=>row.counted!==false)))return false;
  if(result.bossHpLeft!=null&&Number(result.bossHpLeft)>0)return false;
  return true;
}
function validatePacts(content) {
  for (const [id, pact] of Object.entries(content.pacts ?? {})) {
    if (SPECIAL.has(id)) continue;
    for (const tier of tierRows(pact)) for (const row of tier.effects ?? []) {
      if (!SUPPORTED.has(row.kind)) throw new Error(`UNKNOWN_RESONANCE_PACT_EFFECT:${id}:${row.kind}`);
    }
  }
}
function spawnVisible(battle, owner, kind, stats, duration = Infinity, anchor = owner) {
  if (!owner || !anchor || !battle.grid?.canStand) return null;
  const tile = findFree(battle, anchor.tileR ?? anchor.homeR, anchor.tileC ?? anchor.homeC);
  if (!tile) return null;
  const id = `resonance_${kind}_${owner.id}`;
  const def = { name: kind, tier: 1, profession: 'TOKEN', position: 'MELEE', stats: { maxHp: 100, atk: 0, def: 0, res: 0, attackSpeed: 100, baseAttackTime: 1, blockCnt: 0, ...stats }, rangeGrid: [[0,0],[0,1]], trait: '', tokens: [], skill: null };
  const unit = battle.spawnToken(owner, id, tile[0], tile[1], { def, anySource: true, duration, kit: { skill: null, talents: [] } });
  if (unit) unit.mem.resonanceSyntheticKind = kind;
  return unit;
}

/** Install all ordinary and mechanism pacts plus low/mid-cost three-star passives. */
export function installResonancePacts(battle, { catalog, state } = {}) {
  const content = contentOf(catalog);
  const currentRules = Number(catalog?.config?.rulesVersion ?? content?.config?.rulesVersion) === 2;
  validatePacts(content);
  const bySource = operatorMap(content);
  const active = activePacts(battle, content, bySource);
  battle.resonanceLogisticsAcc = new Map();
  battle.resonancePactCache = active;

  const idsFor = (unit) => {
    const operator = operatorOf(unit, bySource);
    return operator ? { operator, ids: new Set([...pactIds(unit, operator)].filter((id) => active.has(id))), profile: profileFor(operator, unit) } : null;
  };
  for (const unit of (battle.allyUnits ?? []).filter((row) => row.kind === 'op')) {
    const matched = idsFor(unit);
    if (matched) unit.mem.resonancePactPassives = matched.profile.passives;
  }
  const counters = new Map();
  const nextAt = (unit, key) => { const id = `${unit.id}:${key}`; const value = counters.get(id) ?? -Infinity; return { id, value, set: (at) => counters.set(id, at) }; };

  battle.resonanceKjeragMark = null;
  battle.resonanceKjeragMarkNextAt = -Infinity;
  const clearKjeragMark = () => {
    const mark = battle.resonanceKjeragMark;
    if (mark?.target?.mem) delete mark.target.mem.resonanceKjeragMark;
    battle.resonanceKjeragMark = null;
  };
  const liveKjeragMark = () => {
    const mark = battle.resonanceKjeragMark;
    if (!mark) return null;
    const target = mark.target;
    if (battle.time >= mark.until || !target?.alive || target.removed || !(battle.enemies ?? []).includes(target)) {
      clearKjeragMark();
      return null;
    }
    return mark;
  };
  const makeKjeragMark = (source, target, p) => {
    if (liveKjeragMark() || battle.time < battle.resonanceKjeragMarkNextAt || !target?.alive) return false;
    const until = battle.time + n(p.markDuration, 6);
    const mark = { target, targetUid: target.uid ?? target.id, until, responders: new Set(), crossfireUsed: false, crossfireAt: n(p.crossfireAt, Infinity), responseDamage: n(p.responseDamage, 80), crossfireResponders: n(p.crossfireResponders, 3), crossfireDamage: n(p.crossfireDamage, 100) };
    battle.resonanceKjeragMark = mark;
    battle.resonanceKjeragMarkNextAt = battle.time + n(p.markCooldown, 6);
    target.mem ??= {};
    target.mem.resonanceKjeragMark = { until, sourceUid: source.uid ?? source.id };
    battle.fx?.('wanted', { id: target.id, x: target.x, y: target.y, dur: n(p.markDuration, 6) });
    metric(battle, 'kjeragMark');
    return true;
  };
  const answerKjeragMark = (source, target) => {
    const mark = liveKjeragMark();
    if (!mark || mark.target !== target) return;
    const uid = String(source.uid ?? source.id);
    if (mark.responders.has(uid)) return;
    mark.responders.add(uid);
    deal(battle, source, target, source.s.atk * mark.responseDamage / 100, 'phys', ['kjeragAssist']);
    metric(battle, 'kjeragResponse');
    if (mark.crossfireUsed || active.get('kjerag')?.count < mark.crossfireAt || mark.responders.size < mark.crossfireResponders) return;
    mark.crossfireUsed = true;
    metric(battle, 'kjeragCrossfire');
    for (const shooter of memberUnits(active.get('kjerag'))) {
      if (shooter.kind !== 'op' || !shooter.alive || !shooter.deployed || shooter.removed || !mark.target.alive) continue;
      deal(battle, shooter, mark.target, shooter.s.atk * mark.crossfireDamage / 100, 'phys', ['kjeragAssist']);
    }
  };

  battle.on('hit', (event) => {
    const source = event?.source, target = event?.target, dmg = event?.dmg;
    if(source?.side==='enemy'&&target?.side==='ally'&&target.kind==='op'&&target.motion==='FLY'){const defender=idsFor(target);if(defender?.ids.has('flight'))dmg.mul=(dmg.mul??1)*(1-n(params(active,'flight','flight_dive').mitigation,10)/100);return;}
    if (source?.side !== 'ally' || target?.side !== 'enemy' || !dmg) return;
    const matched = idsFor(source); if (!matched) return;
    const sir = params(active, 'siracusa', 'siracusa_execute');
    if (matched.ids.has('siracusa')) {
      if (target.hpRatio < n(sir.executeBelow, 40) / 100) dmg.mul = (dmg.mul ?? 1) * (1 + n(sir.executeBonus, 15) / 100);
      const queued = n(source.mem.siracusaNextHit);
      if (queued > 0 && (!currentRules || (dmg.isAttack && !dmg.isSkill))) { dmg.amount = n(dmg.amount) + queued; source.mem.siracusaNextHit = 0; }
    }
    if(matched.ids.has('breaker')&&target.blockedBy){const p=params(active,'breaker','breaker_front');if(battle.time>=n(target.mem.pactBreakerFrontAt,-Infinity)){target.mem.pactBreakerFrontAt=battle.time+.25;dmg.mul=(dmg.mul??1)*(1+n(p.blockedBonus,15)/100);}}
    for (const passive of matched.profile.passives) if (passive.kind === 'star3_breaker' && target.hpRatio < n(passive.params?.hpBelow, 35) / 100) dmg.mul = (dmg.mul ?? 1) * (1 + n(passive.params?.damage, 20) / 100);
    if(matched.ids.has('bolivar')&&(target.s?.flags?.sluggish||target.s?.flags?.cold||target.s?.flags?.freeze||target.s?.flags?.bind))dmg.mul=(dmg.mul??1)*(1+n(params(active,'bolivar','bolivar_slow').controlledDamage,25)/100);
    if(matched.ids.has('sami')&&(target.s?.flags?.cold||target.s?.flags?.freeze))dmg.mul=(dmg.mul??1)*(1+n(params(active,'sami','sami_cold').coldTargetBonus,20)/100);
    if(matched.ids.has('crown')&&dmg.isSkill&&source.mem.pactCrownSkillBonus)dmg.mul=(dmg.mul??1)*(1+source.mem.pactCrownSkillBonus);
  }, { owner: battle });

  battle.on('attack', (event) => {
    const unit = event?.attacker;
    if (!unit || unit.side !== 'ally') return;
    if(unit.kind==='token'&&unit.ownerUnit){const owner=unit.ownerUnit,matched=idsFor(owner);if(!matched)return;
      if(matched.ids.has('creation')){const p=params(active,'creation','creation_construct'),key=`creationSP:${owner.id}`,last=owner.mem[key]??-Infinity;if(battle.time-last>=1/Math.max(.01,n(p.ownerSpCap,1))){owner.mem[key]=battle.time;owner.skill?.gainSp?.(n(p.ownerSp,.25),'resonanceCreation');}}
      return;
    }
    if (unit.kind !== 'op') return;
    const matched = idsFor(unit); if (!matched) return;
    const targets = (event.targets ?? []).filter((target) => target?.side === 'enemy' && target.alive).sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y) || a.id - b.id);
    const target = targets[0]; if (!target) return;
    const { ids, profile } = matched;
    if (ids.has('combo')) {
      const p = params(active, 'combo', 'combo_sixth');
      unit.mem.pactCombo = (unit.mem.pactCombo ?? 0) + 1;
      const speed = Math.min(n(p.speedCap, 20), unit.mem.pactCombo * n(p.aspdPerAttack, 2));
      buff(battle, unit, 'combo-speed', { aspd: speed });
      if (unit.mem.pactCombo % n(p.every, 6) === 0) {
        deal(battle, unit, target, unit.s.atk * n(p.damage, 40) / 100, 'phys');
        if (active.get('combo').count >= n(p.otherTargetAt, 6)) { const other = targets.find((row) => row !== target) ?? nearestEnemy(battle, unit); if (other && other !== target) deal(battle, unit, other, unit.s.atk * n(p.damage, 40) / 100, 'phys'); }
      }
    }
    if (ids.has('kazimierz')) { const p=params(active,'kazimierz','kazimierz_true_damage');unit.mem.pactKazCount=(unit.mem.pactKazCount??0)+1;if(unit.mem.pactKazCount%n(p.attackEvery,3)===0)deal(battle,unit,target,unit.s.atk*n(p.trueDamage,25)/100,'true'); }
    let createdKjeragMark = false;
    if (ids.has('kjerag') && !event.isSkill) {
      const p = params(active, 'kjerag', 'kjerag_coordination');
      unit.mem.pactKjeragCount = (unit.mem.pactKjeragCount ?? 0) + 1;
      if (unit.mem.pactKjeragCount % n(p.attackEvery, 5) === 0) createdKjeragMark = makeKjeragMark(unit, target, p);
    }
    if (ids.has('laterano') && unit.mem.pactLateranoCharge > 0) { deal(battle,unit,target,unit.mem.pactLateranoCharge,'phys');unit.mem.pactLateranoCharge=0; }
    if (ids.has('victoria')) { const p=params(active,'victoria','victoria_artillery');battle.resonanceAttackCount=(battle.resonanceAttackCount??0)+1;if(battle.resonanceAttackCount%n(p.shots,20)===0){const owner=memberUnits(active.get('victoria')).sort((a,b)=>b.s.atk-a.s.atk||a.id-b.id)[0];if(owner)for(const enemy of battle.foesInRadius(target.x,target.y,n(p.radius,1.5),true))deal(battle,owner,enemy,owner.s.atk*n(p.damage,180)/100,'phys');} }
    if (!event.isSkill && !createdKjeragMark && unit.kind === 'op') answerKjeragMark(unit, target);
    if (ids.has('sami') && (target.s?.flags?.cold||target.s?.flags?.freeze) && event.dmg) event.dmg.mul=(event.dmg.mul??1)*(1+n(params(active,'sami','sami_cold').coldTargetBonus,20)/100);
    for (const passive of profile.passives) {
      if (passive.kind === 'star3_combo') { unit.mem.star3Combo = (unit.mem.star3Combo ?? 0) + 1; if (unit.mem.star3Combo % n(passive.params?.everyAttacks, 6) === 0) unit.skill?.gainSp?.(n(passive.params?.sp, 2), 'resonanceStar3Combo'); }
      if (passive.kind === 'star3_flight' && unit.motion === 'FLY') buff(battle, unit, `star3-flight:${unit.id}`, { aspd: n(passive.params?.airborneAspd, 30) });
    }
  }, { owner: battle });

  battle.on('skillStart', (event) => {
    const unit=event?.unit;if(!unit||unit.side!=='ally'||unit.kind!=='op')return;
    const matched=idsFor(unit);if(!matched)return;const {ids,profile}=matched;
    if(ids.has('ammo')&&unit.skill?.kind==='ammo'){
      const extra=n(params(active,'ammo','ammo_last_round').skillAmmo,0);
      if(extra>0){unit.skill.addAmmo(extra);unit.mem.pactAmmoLastDamageUsed=false;}
    }
    if(ids.has('yan')){const p=params(active,'yan','yan_combo');const cd=nextAt(unit,'yan');if(battle.time>=cd.value){cd.set(battle.time+n(p.receiverCooldown,2));for(const ally of memberUnits(active.get('yan')))if(ally!==unit)ally.skill?.gainSp?.(n(p.teamSp,1),'resonanceYan');battle.resonanceYanCast=(battle.resonanceYanCast??0)+1;if(battle.resonanceYanCast%n(p.comboEvery,5)===0)for(const ally of memberUnits(active.get('yan'))){const enemy=nearestEnemy(battle,ally);if(enemy)deal(battle,ally,enemy,ally.s.atk*n(p.comboDamage,100)/100,'arts');}}}
    if(ids.has('rhodes')&&!unit.mem.pactRhodesUsed){unit.mem.pactRhodesUsed=true;const p=params(active,'rhodes','rhodes_first_cast'),count=active.get('rhodes').count;buff(battle,unit,'rhodes-first-cast',{dmgTakenMul:1-n(p.damageReduction,10)/100,aspd:n(p.aspd,15)},n(p.duration,10));battle.heal(unit,unit,unit.s.maxHp*n(p.heal,20)/100,{tags:['resonance']});}
    if(ids.has('leithania')){const p=params(active,'leithania','leithania_sound');battle.resonanceLeithaniaCasts=(battle.resonanceLeithaniaCasts??0)+1;if(battle.resonanceLeithaniaCasts%n(p.castEvery,3)===0){const enemy=nearestEnemy(battle,unit);if(enemy){battle.resonanceLeithaniaAreas??=[];const live=battle.resonanceLeithaniaAreas.filter((field)=>field.until>battle.time);if(live.length>=n(p.maxAreas,3))live.shift();const field={x:enemy.x,y:enemy.y,until:battle.time+n(p.areaDuration,6),next:battle.time+1,silenceAt:active.get('leithania').count>=n(p.silenceAt,5)?battle.time+n(p.silenceInterval,2):Infinity,owner:unit};live.push(field);battle.resonanceLeithaniaAreas=live;const tiles=[];for(let r=Math.floor(field.y-1.5);r<=Math.ceil(field.y+1.5);r++)for(let c=Math.floor(field.x-1.5);c<=Math.ceil(field.x+1.5);c++)if((r-field.y)**2+(c-field.x)**2<=1.5**2)tiles.push([r,c]);battle.resonanceAddFloor?.(`leithania:${battle.resonanceLeithaniaCasts}`,'sound',unit,tiles,field.until);}}}
    if(ids.has('arts')){unit.mem.pactArtsCast=(unit.mem.pactArtsCast??0)+1;const p=params(active,'arts','arts_cycle');if(unit.mem.pactArtsCast%2===0){const targets=enemyList(battle).sort((a,z)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(z.x-unit.x,z.y-unit.y)||a.id-z.id).slice(0,3);for(const enemy of targets)deal(battle,unit,enemy,unit.s.atk*n(p.damage,60)/100,'arts');}}
    if(active.has('sui')){const p=params(active,'sui','sui_shadow');battle.resonanceSuiCast=(battle.resonanceSuiCast??0)+1;if(!battle.resonanceSuiBarrier){battle.resonanceSuiBarrier=true;for(const ally of battle.allyUnits.filter((row)=>row.kind==='op'&&row.alive&&row.ownerId===unit.ownerId))battle.addBuff(ally,{key:'resonance:pact:sui-barrier',shield:ally.s.maxHp*n(p.barrier,20)/100,duration:Infinity,tags:['resonance','pact']});}if(battle.resonanceSuiCast%n(p.summonEvery,10)===0&&!battle.resonanceSuiAlive){const elite=enemyList(battle).filter(x=>/ELITE|BOSS/i.test(String(x.def?.rank))).sort((a,z)=>battle.remainingDistance(a)-battle.remainingDistance(z)||a.id-z.id)[0];const owner=memberUnits(active.get('sui')).sort((a,z)=>z.s.atk-a.s.atk||a.id-z.id)[0];if(elite&&owner){const shadow=spawnVisible(battle,owner,'sui-shadow',{atk:owner.s.atk*n(p.summonAtk,80)/100,maxHp:owner.s.maxHp*n(p.summonHp,150)/100},n(p.summonDuration,8),elite);if(shadow){battle.resonanceSuiAlive=true;shadow.mem.pactSuiSummon=true;metric(battle,'sui');}}}}
    if(ids.has('crown'))unit.mem.pactCrownSkillBonus=unit.mem.pactCrownBonus??0;
    else for(const king of memberUnits(active.get('crown'))){const p=params(active,'crown','crown_memory');const star=profileFor(operatorOf(king,bySource),king).star,perCast=n(p.byStar?.[star]?.perCast,p.perCast??3);king.mem.pactCrownBonus=Math.min(n(p.maxStacks,30)*perCast/100,(king.mem.pactCrownBonus??0)+perCast/100);}
    if(ids.has('creation')){const p=params(active,'creation','creation_construct');for(const token of battle.allyUnits.filter((row)=>row.kind==='token'&&row.ownerUnit===unit&&row.alive&&row.deployed)){battle.heal(unit,token,token.s.maxHp*n(p.heal,15)/100,{tags:['resonance']});buff(battle,token,`creation-cast:${unit.id}`,{aspd:n(p.aspd,15)},6);}}
    if(ids.has('sami')&&!unit.mem.pactSamiCast){unit.mem.pactSamiCast=true;const p=params(active,'sami','sami_cold');for(const ally of battle.allyUnits.filter((row)=>row.kind==='op'&&row.alive))battle.heal(unit,ally,ally.s.maxHp*n(p.firstCastHeal,10)/100,{tags:['resonance']});}
    for(const passive of profile.passives){
      if(passive.kind==='star3_ammo'&&unit.skill?.kind==='ammo'&&!unit.mem.star3AmmoUsed){unit.mem.star3AmmoUsed=true;const plus=n(passive.params?.firstSkillExtraAmmo,3);unit.skill.ammoLeft+=plus;unit.skill.ammoMax=unit.skill.ammoLeft;}
      if(passive.kind==='star3_arts'&&!unit.mem.star3ArtsUsed){unit.mem.star3ArtsUsed=true;const enemy=nearestEnemy(battle,unit,8);if(enemy)deal(battle,unit,enemy,unit.s.atk*n(passive.params?.firstSkillDamage,100)/100,'arts');}
    }
  }, { owner: battle });

  battle.on('skillEnd', (event) => {
    const unit=event?.unit;if(!unit||unit.side!=='ally'||unit.kind!=='op')return;
    const matched=idsFor(unit);if(!matched)return;
    if(matched.ids.has('crown'))unit.mem.pactCrownSkillBonus=0;
    if(matched.ids.has('flight')&&unit.motion==='FLY'){const p=params(active,'flight','flight_dive');for(const target of area(battle,unit.x,unit.y,n(p.radius,1.5)))deal(battle,unit,target,unit.s.atk*n(p.dive,60)/100,'phys');}
  },{owner:battle});

  battle.on('skillStart',(event)=>{const unit=event?.unit;if(!unit||unit.side!=='ally'||unit.kind!=='op')return;const matched=idsFor(unit);if(!matched?.ids.has('rim'))return;const p=params(active,'rim','rim_forge');battle.resonanceRimSkills=(battle.resonanceRimSkills??0)+1;if(battle.resonanceRimSkills%n(p.skillCount,5)===0&&(battle.resonanceRimForgeGranted??0)<n(p.nodeLimit,1)){battle.resonanceRimForgeGranted=(battle.resonanceRimForgeGranted??0)+1;battle.resonanceResults?.forge?.push({progress:1,threshold:n(p.skillCount,5),source:'rim',nodeCap:n(p.nodeLimit,1)});}}, { owner:battle });

  battle.on('ammoUsed', (event) => {
    const unit=event?.unit;if(!unit||unit.side!=='ally')return;const matched=idsFor(unit);if(!matched)return;
    if(matched.ids.has('ammo')){const p=params(active,'ammo','ammo_last_round');if(currentRules){if(n(p.refundChance,0)>0&&battle.rng()<n(p.refundChance,0)/100)unit.skill?.gainSp?.(n(p.refundSp,0),'resonanceAmmo');if(unit.skill?.kind==='ammo'&&n(event.left,unit.skill.ammoLeft)<=0&&!unit.mem.pactAmmoLastDamageUsed){unit.mem.pactAmmoLastDamageUsed=true;const enemy=nearestEnemy(battle,unit,8);deal(battle,unit,enemy,unit.s.atk*n(p.lastDamage,80)/100,'phys');}}else{if(battle.rng()<.2)unit.skill?.gainSp?.(.5,'resonanceAmmo');if(unit.skill?.ammoLeft===0){const enemy=nearestEnemy(battle,unit,8);deal(battle,unit,enemy,unit.s.atk*n(p.lastDamage,80)/100,'phys');}}}
    if(matched.ids.has('laterano')){const p=params(active,'laterano','laterano_ammo');battle.resonanceAmmoSpent=(battle.resonanceAmmoSpent??0)+1;if(battle.resonanceAmmoSpent%n(p.ammoSpend,6)===0)for(const ally of memberUnits(active.get('laterano')))ally.mem.pactLateranoCharge=(ally.mem.pactLateranoCharge??0)+ally.s.atk*n(p.bonus,20)/100;}
  },{owner:battle});

  battle.on('damaged', (event) => {
    const source=event?.source,target=event?.target,dmg=event?.dmg;
      if(source?.side==='ally'&&target?.side==='enemy'&&event.dealt>0){
        const matched=idsFor(source);if(!matched)return;const {ids}=matched;
        if(!currentRules&&ids.has('siracusa')){const p=params(active,'siracusa','siracusa_execute');source.mem.pactSiraDamage=(source.mem.pactSiraDamage??0)+event.dealt;const cd=nextAt(source,'siracusa');if(battle.time>=cd.value&&source.mem.pactSiraDamage>=n(p.damageCycle,4000)){source.mem.pactSiraDamage-=n(p.damageCycle,4000);cd.set(battle.time+n(p.personalCooldown,2));source.skill?.gainSp?.(n(p.sp,3),'resonanceSiracusa');source.mem.siracusaNextHit=(source.mem.siracusaNextHit??0)+source.s.atk*n(p.nextHit,60)/100;}}
      if(ids.has('burn')&&!(dmg?.tags??[]).includes('resonance')){const p=params(active,'burn','burn_spread');const cd=nextAt(target,'burn');if(battle.time>=cd.value){cd.set(battle.time+n(p.targetCooldown,3));battle.dealDamage(source,target,{amount:source.s.atk*n(p.burn,10)/100,type:'element',element:'burn',canDodge:false,tags:['resonance','burn']});}}
    if(ids.has('necrosis')&&target.s?.flags?.necrosis&&target.s?.flags?.necrosisBurst&&!target.mem.pactNecrosis){target.mem.pactNecrosis=true;const p=params(active,'necrosis','necrosis_burst'),burstSp=n(p.firstBurstSp,3);if(burstSp>0)source.skill?.gainSp?.(burstSp,'resonanceNecrosis');target.buffs?.push?.({key:'resonance:necrosis:pact',duration:n(p.duration,5),interval:1,source,data:{dps:source.s.atk*n(p.dps,50)/100},onTick:({battle:b,unit:enemy,buff:entry})=>{if(enemy.alive)b.dealDamage(source,enemy,{amount:entry.data.dps,type:'arts',canDodge:false,tags:['resonance','necrosis']});},tags:['resonance']});}
      if(ids.has('control')&&(target.s?.flags?.stun||target.s?.flags?.cold||target.s?.flags?.freeze))procControl(battle,active,source,target);
    }
    if(source?.side==='enemy'&&target?.side==='ally'&&dmg?.isAttack){
      const matched=idsFor(target);if(!matched)return;const {ids}=matched;
      if(ids.has('iberia')&&target.mem.pactIberiaShield>0){const shield=target.buffs?.find((row)=>String(row.key).includes(`iberia-barrier:${target.id}`));if(!shield||shield.shield<=0){target.mem.pactIberiaShield=0;const p=params(active,'iberia','iberia_barrier');for(const enemy of area(battle,target.x,target.y,n(p.radius,2)))deal(battle,target,enemy,target.s.atk*n(p.breakDamage,120)/100,'arts');}}
    }
    if(source?.side==='ally'&&target?.side==='ally'&&target.mem.pactSymbiosisShieldUsed&&!(target.buffs??[]).some((row)=>String(row.key).includes('symbiosis-shield')&&row.shield>0)){target.mem.pactSymbiosisShieldUsed=false;target.mem.pactSymbiosisAttackBonus=n(params(active,'symbiosis','symbiosis_barrier').breakBonus,30)/100;}
  },{owner:battle});

  battle.on('healed', (event) => {
    const target=event?.target;if(target?.side!=='ally'||!(event.amount>0))return;
    if(event?.opts?.noSymbiosisRecursion)return;
    const matched=idsFor(event.source);if(!matched)return;
    const p=params(active,'symbiosis','symbiosis_barrier');if(matched.ids.has('symbiosis'))grantHealShield(battle,target,event.amount,n(p.healToShield,15),n(p.barrierCap,15),n(p.targetCooldown,2));
    for(const passive of matched.profile.passives)if(passive.kind==='star3_symbiosis')grantHealShield(battle,target,event.amount,n(passive.params?.healShield,15),15,n(passive.params?.targetCooldown,2));
  },{owner:battle});

  battle.on('beforeStatus', (event) => {
    const target=event?.target,source=event?.source;
    if(event?.cancel||target?.side!=='enemy'||!source||source.side!=='ally'||!['cold','freeze','stun','bind','sleep','levitate','sluggish'].includes(event.status))return;
    const matched=idsFor(source);if(!matched)return;
    if(matched.ids.has('control')){const p=params(active,'control','control_first');event.duration*=1+n(p.durationBonus,10)/100;procControl(battle,active,source,target);}
    for(const passive of matched.profile.passives)if(passive.kind==='star3_control'&&!source.mem.star3ControlUsed){source.mem.star3ControlUsed=true;source.skill?.gainSp?.(n(passive.params?.firstControlSp,15),'resonanceStar3Control');}
  },{owner:battle});

  battle.on('kill', (event) => {
    const killer=event?.killer,victim=event?.victim;if(!killer||killer.side!=='ally')return;const matched=idsFor(killer);if(!matched)return;
    if(currentRules&&matched.ids.has('siracusa')&&victim?.side==='enemy'){const p=params(active,'siracusa','siracusa_harvest');killer.skill?.gainSp?.(n(p.sp,0),'resonanceSiracusaHarvest');if(!(n(killer.mem.siracusaNextHit)>0))killer.mem.siracusaNextHit=killer.s.atk*n(p.nextHit,0)/100;}
    if(matched.ids.has('lungmen')){const p=params(active,'lungmen','lungmen_reward');battle.resonanceKills=(battle.resonanceKills??0)+1;if(battle.resonanceKills<=n(p.teamSpCap,6))for(const ally of memberUnits(active.get('lungmen')))ally.skill?.gainSp?.(n(p.killSp,1),'resonanceLungmen');}
    if(matched.ids.has('breaker')&&/ELITE|BOSS/i.test(String(victim.def?.rank))&&!killer.mem.pactBreakerElite){killer.mem.pactBreakerElite=true;const p=params(active,'breaker','breaker_front');buff(battle,killer,'breaker-elite',{aspd:n(p.eliteAspd,20)},n(p.duration,8));}
  },{owner:battle});

  battle.on('death', ({ unit }) => {
    if (unit?.side === 'enemy' && battle.resonanceKjeragMark?.target === unit) clearKjeragMark();
  }, { owner: battle });

  battle.on('deploy', (event) => {
    const unit=event?.unit;if(!unit||unit.side!=='ally')return;
    if(unit.kind==='token'&&unit.ownerUnit){const matched=idsFor(unit.ownerUnit);const passive=matched?.profile.passives.find((row)=>row.kind==='star3_creation');if(passive&&!unit.ownerUnit.mem.star3CreationUsed){unit.ownerUnit.mem.star3CreationUsed=true;unit.base.maxHp*=1+n(passive.params?.firstConstructHp,20)/100;unit.base.atk*=1+n(passive.params?.firstConstructAtk,30)/100;unit.markDirty?.();unit.hp=unit.s.maxHp;}return;}
    if(unit.kind!=='op')return;const matched=idsFor(unit);if(!matched)return;
    if(matched.ids.has('higashi')){const p=params(active,'higashi','higashi_redeploy');buff(battle,unit,'higashi-deploy',{dodgePhys:n(p.dodge,25)/100,dodgeArts:n(p.dodge,25)/100},n(p.duration,10));}
    if(matched.ids.has('redeploy')&&!event.initial&&unit.mem.pactRedeployPending){
      unit.mem.pactRedeployPending=false;
      const p=params(active,'redeploy','redeploy_return');
      if(currentRules){
        const returned=n(unit.mem.pactRedeployReturns,0);
        if(returned<n(p.returnLimit,1)){
          unit.mem.pactRedeployReturns=returned+1;
          if(n(p.heal,0)>0)battle.heal(unit,unit,unit.s.maxHp*n(p.heal)/100,{tags:['resonance']});
          for(const enemy of enemiesInRange(battle,unit,8))deal(battle,unit,enemy,unit.s.atk*n(p.damage,100)/100,p.damageType==='arts'?'arts':'arts');
        }
      }else{
        battle.heal(unit,unit,unit.s.maxHp*n(p.heal,20)/100,{tags:['resonance']});
        for(const enemy of enemiesInRange(battle,unit,8))deal(battle,unit,enemy,unit.s.atk*n(p.damage,100)/100,p.damageType==='arts'?'arts':'arts');
      }
    }
    if(matched.ids.has('higashi')&&active.get('higashi').count>=n(params(active,'higashi','higashi_redeploy').deployTrueDamageAt,4)&&!event.initial){const p=params(active,'higashi','higashi_redeploy');for(const enemy of enemiesInRange(battle,unit,8))deal(battle,unit,enemy,unit.s.atk*n(p.deployTrueDamage,80)/100,'true');}
    if(matched.ids.has('iberia')&&!unit.mem.pactIberiaUsed){unit.mem.pactIberiaUsed=true;}
    if(!event.initial&&unit.mem.star3RedeployPending){
      unit.mem.star3RedeployPending=false;
      if(!currentRules){
        unit.hp=Math.min(unit.s.maxHp,unit.hp+unit.s.maxHp*n(matched.profile.passives.find((row)=>row.kind==='star3_redeploy')?.params?.firstRedeployHeal,20)/100);
        const p=matched.profile.passives.find((row)=>row.kind==='star3_redeploy')?.params??{};
        for(const enemy of enemiesInRange(battle,unit,8))deal(battle,unit,enemy,unit.s.atk*n(p.firstRedeployDamage,100)/100,'arts');
      }
    }
  },{owner:battle});

  battle.on('blocked',(event)=>{const unit=event?.blocker;if(!unit||unit.kind!=='op')return;const matched=idsFor(unit);if(!matched?.ids.has('iberia')||unit.mem.pactIberiaBlocked)return;unit.mem.pactIberiaBlocked=true;const p=params(active,'iberia','iberia_barrier');battle.addBuff(unit,{key:`resonance:pact:iberia-barrier:${unit.id}`,shield:unit.s.maxHp*n(p.barrier,20)/100,duration:Infinity,tags:['resonance','pact']});unit.mem.pactIberiaShield=n(p.barrier,20)/100*unit.s.maxHp;},{owner:battle});
  const babelFirstExit=(unit)=>{if(!unit||unit.side!=='ally'||unit.kind!=='op'||unit.mem.pactBabelExitUsed)return;const matched=idsFor(unit);if(!matched?.ids.has('babel'))return;unit.mem.pactBabelExitUsed=true;for(const ally of battle.allyUnits.filter((row)=>row.kind==='op'&&row.alive&&row.ownerId===unit.ownerId))ally.skill?.gainSp?.(n(params(active,'babel','babel_exit').exitSp,5),'resonanceBabel');};
  battle.on('retreating',(event)=>babelFirstExit(event?.unit),{owner:battle});
   battle.on('retreating',(event)=>{const unit=event?.unit;if(!unit||unit.side!=='ally'||unit.kind!=='op')return;const matched=idsFor(unit);const p=params(active,'higashi','higashi_redeploy');if(matched?.ids.has('higashi')&&(!currentRules||n(p.returnSp,0)>0)&&n(unit.mem.pactHigashiReturns,0)<n(p.returnLimit,2)){unit.mem.pactHigashiReturns=n(unit.mem.pactHigashiReturns,0)+1;unit.skill?.gainSp?.(n(p.returnSp,15),'resonanceHigashi');}},{owner:battle});

  battle.on('battleStart',()=>{applyTierStats(battle,active);
    const logistics=active.get('logistics');if(logistics){const q=params(active,'logistics','logistics_dp');for(const unit of memberUnits(logistics).slice(0,1))battle.addDp?.(unit.ownerId,n(q.startingDp,10),{source:'initial'});}
    const rim=active.get('rim');if(rim){const progress=n(state?.strategyState?.rimForge?.progress,0);battle.resonanceRimForgeProgress=progress;}
  },{owner:battle});

  battle.on('death',(event)=>babelFirstExit(event?.unit),{owner:battle});
  battle.on('dpGained',(event)=>{
    if(!active.has('logistics')||event?.source==='initial'||event?.source==='refund'||!(n(event?.amount)>0))return;
    const key=event.playerId;
    battle.resonanceLogisticsAcc.set(key,(battle.resonanceLogisticsAcc.get(key)??0)+n(event.amount));
    if(event.source==='resonance_bonus'||event.sourceUnitId==null)return;
    const producer=battle.allyUnits.find((unit)=>String(unit.id)===String(event.sourceUnitId)&&unit.kind==='op');
    if(!producer||producer.mem.star3LogisticsUsed)return;
    const passive=idsFor(producer)?.profile.passives.find((row)=>row.kind==='star3_logistics');
    if(passive){producer.mem.star3LogisticsUsed=true;battle.addDp?.(producer.ownerId,n(passive.params?.firstDp,5),{source:'resonance_bonus'});}
  },{owner:battle});

  battle.on('death',(event)=>{const unit=event?.unit;if(!unit||unit.side!=='ally'||unit.kind!=='op')return;const matched=idsFor(unit);const passive=matched?.profile.passives.find((row)=>row.kind==='star3_redeploy');
    if(currentRules){
      let multiplier=1;
      if(passive&&!unit.mem.star3RedeployUsed){unit.mem.star3RedeployUsed=true;unit.mem.star3RedeployPending=true;multiplier=Math.min(multiplier,n(passive.params?.firstRedeployTimeMultiplier,.5));}
      if(matched.ids.has('redeploy')){const p=params(active,'redeploy','redeploy_return');unit.mem.pactRedeployPending=true;multiplier=Math.min(multiplier,n(p.timeMultiplier,.8));}
      if(multiplier<1)unit.respawnAt=unit.deathAt+unit.base.respawnTime*multiplier;
    }else{
      if(passive&&!unit.mem.star3RedeployUsed){unit.mem.star3RedeployUsed=true;unit.mem.star3RedeployPending=true;const multiplier=n(passive.params?.firstRedeployTimeMultiplier,.5);unit.respawnAt=unit.deathAt+unit.base.respawnTime*multiplier;}
      if(matched.ids.has('redeploy')){const p=params(active,'redeploy','redeploy_return');unit.mem.pactRedeployPending=true;unit.respawnAt=unit.deathAt+unit.base.respawnTime*n(p.timeMultiplier,.8);}
    }
  },{owner:battle});
  battle.on('death',(event)=>{const unit=event?.unit;if(unit?.kind==='token'&&unit.mem.pactSuiSummon)battle.resonanceSuiAlive=false;if(unit?.kind==='token'&&unit.mem.resonanceSyntheticKind==='columbia-construct'&&active.get('columbia')?.count>=n(params(active,'columbia','columbia_construct').rebuildAt,10)){const owner=unit.ownerUnit;if(owner&&!owner.mem.pactColumbiaRebuilt){owner.mem.pactColumbiaRebuilt=true;battle.after(.05,()=>{if(owner.alive)spawnVisible(battle,owner,'columbia-construct',{maxHp:owner.s.maxHp,atk:owner.s.atk},n(params(active,'columbia','columbia_construct').constructDuration,8));},{owner});}}},{owner:battle});

  battle.on('battleEnd', (event) => {
    const won=battle.resonanceOutcome ? battle.resonanceOutcome.won === true : battleWon(event?.result);
    const lungmen=active.get('lungmen');if(won&&lungmen)battle.resonanceResults?.coins?.push({amount:n(params(active,'lungmen','lungmen_reward').victoryGold,1),source:'lungmen'});
    const ursus=active.get('ursus');if(ursus){const p=params(active,'ursus','ursus_adjacency');for(const unit of memberUnits(ursus))if(unit.alive)recordGrowth(battle,state,unit,'ursus:hp',n(p.victoryHp,25),n(p.personalGrowthCap,250),'ursus');}
    const bolivar=active.get('bolivar');if(won&&bolivar&&bolivar.count>=2){const p=params(active,'bolivar','bolivar_slow');for(const unit of memberUnits(bolivar))recordGrowth(battle,state,unit,'bolivar:atk',n(p.victoryAtk,10),n(p.growthCap,100),'bolivar');}
    const babel=active.get('babel');if(won&&babel){const p=params(active,'babel','babel_exit'),living=memberUnits(babel).filter((unit)=>unit.alive).sort((a,z)=>a.id-z.id);if(living.length){const selected=living[battle.rng.int?.(0,living.length-1)??0];recordGrowth(battle,state,selected,'babel:atk',n(p.victoryAtk,12),n(p.growthCap,120),'babel');}}
  },{owner:battle});

  battle.on('elementBurst',(event)=>{
    const unit=event?.source;if(unit?.side!=='ally'||unit.kind!=='op'||unit.mem.star3NecrosisUsed)return;
    const passive=idsFor(unit)?.profile.passives.find((row)=>row.kind==='star3_necrosis');
    if(passive){unit.mem.star3NecrosisUsed=true;unit.skill?.gainSp?.(n(passive.params?.firstElementBurstSp,10),'resonanceStar3Necrosis');}
  },{owner:battle});

  battle.on('tick', ({dt}) => { liveKjeragMark(); tickPacts(battle,active,dt,counters); });
  return active;
}

function findFree(battle,r,c){if(!Number.isInteger(r)||!Number.isInteger(c))return null;for(let d=1;d<=4;d++)for(let y=r-d;y<=r+d;y++)for(let x=c-d;x<=c+d;x++)if(Math.max(Math.abs(y-r),Math.abs(x-c))===d&&battle.grid.canStand(y,x)&&!battle._occ[battle.grid.key(y,x)])return[y,x];return null;}
function enemiesInRange(battle,unit,range=Infinity){return enemyList(battle).filter((enemy)=>Math.hypot(enemy.x-unit.x,enemy.y-unit.y)<=range);}
function procControl(battle,active,source,target){const p=params(active,'control','control_first'),key=`${target.id}:control`,until=target.mem?.pactControlAt??-Infinity;if(battle.time-until<n(p.sameTargetCooldown,3))return;target.mem.pactControlAt=battle.time;deal(battle,source,target,source.s.atk*n(p.damage,40)/100,'arts');}
function grantHealShield(battle,target,amount,ratio,capRatio,cooldown){const until=target.mem.pactSymbiosisAt??-Infinity;if(battle.time-until<cooldown)return;target.mem.pactSymbiosisAt=battle.time;const cap=target.s.maxHp*capRatio/100,shield=amount*ratio/100,old=target.buffs.find((entry)=>entry.key==='resonance:pact:symbiosis-shield');if(old)old.shield=Math.min(cap,old.shield+shield);else battle.addBuff(target,{key:'resonance:pact:symbiosis-shield',shield:Math.min(cap,shield),duration:Infinity,tags:['resonance','pact']});target.mem.pactSymbiosisShieldUsed=true;}
function tickPacts(battle,active,dt,counters){
  for(const unit of battle.allyUnits.filter((row)=>row.kind==='op'&&row.alive&&row.deployed)){
    const flight=active.get('flight');if(flight&&memberUnits(flight).includes(unit)&&unit.motion==='FLY'){const p=params(active,'flight','flight_dive');buff(battle,unit,'flight',{aspd:n(p.aspd,15),dmgTakenMul:1-n(p.mitigation,10)/100},.6);}
    for(const passive of unit.mem.resonancePactPassives??[]){if(passive.kind==='star3_flight'&&unit.motion==='FLY'){const key=`flight:${unit.id}`,next=counters.get(key)??-Infinity;if(battle.time>=next){counters.set(key,battle.time+0.5);buff(battle,unit,key,{aspd:n(passive.params?.airborneAspd,30)},.6);}}}
  }
  const sound=active.get('leithania');if(sound){const p=params(active,'leithania','leithania_sound');battle.resonanceLeithaniaAreas=(battle.resonanceLeithaniaAreas??[]).filter((field)=>field.until>battle.time);for(const field of battle.resonanceLeithaniaAreas){if(battle.time>=field.next){field.next=battle.time+1;for(const enemy of battle.foesInRadius(field.x,field.y,1.5,true).filter((row)=>row.alive))deal(battle,field.owner,enemy,field.owner.s.atk*n(p.dps,40)/100,'arts');}if(battle.time>=field.silenceAt){field.silenceAt=battle.time+n(p.silenceInterval,2);for(const enemy of battle.foesInRadius(field.x,field.y,1.5,true).filter((row)=>row.alive))battle.applyStatus(enemy,'silence',{duration:n(p.silenceDuration,1),source:field.owner});}}}
  const sargon=active.get('sargon');if(sargon){const p=params(active,'sargon','sargon_sand'),key='sargon:pulse',next=counters.get(key)??n(p.interval,12);if(battle.time>=next){counters.set(key,battle.time+n(p.interval,12));const owner=memberUnits(sargon).filter((unit)=>unit.alive).sort((a,z)=>a.hpRatio-z.hpRatio||a.id-z.id)[0];if(owner){battle.heal(owner,owner,owner.s.maxHp*n(p.heal,15)/100,{tags:['resonance']});owner.mem.pactSargonArea={x:owner.x,y:owner.y,until:battle.time+n(p.duration,4),next:battle.time,owner};}}
    for(const owner of memberUnits(sargon)){const field=owner.mem.pactSargonArea;if(!field||battle.time>=field.until)continue;if(battle.time>=field.next){field.next=battle.time+1;const radius=n(p.areaRadius,1.5);for(const enemy of battle.foesInRadius(field.x,field.y,radius,true).filter((row)=>row.alive)){battle.addBuff(enemy,{key:`resonance:pact:sargon-slow:${owner.id}`,duration:1.1,mods:{moveMul:1-n(p.slow,25)/100},tags:['resonance','pact']});deal(battle,owner,enemy,owner.s.atk*n(p.dps,30)/100,'arts');}const tiles=[];for(let r=Math.floor(field.y-radius);r<=Math.ceil(field.y+radius);r++)for(let c=Math.floor(field.x-radius);c<=Math.ceil(field.x+radius);c++)if((r-field.y)**2+(c-field.x)**2<=radius**2)tiles.push([r,c]);battle.resonanceAddFloor?.(`sargon:${owner.id}`,'sand',owner,tiles,field.until);}}
  }
  const columbia=active.get('columbia');if(columbia){const p=params(active,'columbia','columbia_construct');for(const owner of memberUnits(columbia)){const live=battle.allyUnits.filter((unit)=>unit.kind==='token'&&unit.ownerUnit===owner&&unit.alive&&unit.mem.resonanceSyntheticKind==='columbia-construct').length;if(live>=n(p.maxConstructs,2))continue;const key=`columbia:${owner.id}`,next=counters.get(key)??n(p.interval,12);if(battle.time>=next){counters.set(key,battle.time+n(p.interval,12));spawnVisible(battle,owner,'columbia-construct',{maxHp:owner.s.maxHp*n(p.hp,20)/100,atk:owner.s.atk*n(p.constructAtk??p.atk,35)/100},n(p.constructDuration,8));}}}
  const laterano=active.get('laterano');if(laterano&&laterano.count>=n(params(active,'laterano','laterano_ammo').droneAt,8)){const p=params(active,'laterano','laterano_ammo'),key='laterano-drone',next=counters.get(key)??0;if(battle.time>=next){counters.set(key,battle.time+n(p.droneInterval,2));let drone=battle.allyUnits.find((row)=>row.kind==='token'&&row.alive&&row.mem.resonanceSyntheticKind==='laterano-drone');const owner=memberUnits(laterano).sort((a,z)=>z.s.atk-a.s.atk||a.id-z.id)[0];if(!drone&&owner)drone=spawnVisible(battle,owner,'laterano-drone',{atk:0,maxHp:Math.max(1,owner.s.maxHp*.25)},Infinity);if(drone&&owner){const target=nearestEnemy(battle,drone,8);if(target)for(let shot=0;shot<n(p.droneShots,3);shot++)deal(battle,owner,target,owner.s.atk*n(p.droneDamage,180)/100,'phys',['drone']);if(target)metric(battle,'lateranoDroneShots',n(p.droneShots,3));}}}
  const yan=active.get('yan');if(yan&&yan.count>=n(params(active,'yan','yan_combo').formationAt,10)){const p=params(active,'yan','yan_combo'),owner=memberUnits(yan).sort((a,z)=>a.id-z.id)[0],key='yan-formation',next=counters.get(key)??0;if(owner&&!battle.allyUnits.some((row)=>row.kind==='token'&&row.alive&&row.mem.resonanceSyntheticKind==='yan-formation'))spawnVisible(battle,owner,'yan-formation',{maxHp:owner.s.maxHp,atk:0},Infinity);if(owner&&battle.time>=next){counters.set(key,battle.time+n(p.formationInterval,2));const target=nearestEnemy(battle,owner,8);if(target){deal(battle,owner,target,owner.s.atk*n(p.formationDamage,200)/100,'arts',['formation']);metric(battle,'yanFormation');}}}
  for(const summon of battle.allyUnits.filter((unit)=>unit.kind==='token'&&unit.alive&&unit.deployed&&unit.mem.resonanceSyntheticKind==='columbia-construct')){const next=summon.mem.resonanceSyntheticNext??0;if(battle.time>=next){summon.mem.resonanceSyntheticNext=battle.time+1;const target=nearestEnemy(battle,summon,6);if(target){deal(battle,summon,target,summon.s.atk,'phys',['construct']);metric(battle,'columbiaConstructAttacks');}}}
  for(const summon of battle.allyUnits.filter((unit)=>unit.kind==='token'&&unit.alive&&unit.deployed&&unit.mem.resonanceSyntheticKind==='sui-shadow')){const next=summon.mem.resonanceSyntheticNext??0;if(battle.time>=next){summon.mem.resonanceSyntheticNext=battle.time+1;const target=nearestEnemy(battle,summon,6);if(target){deal(battle,summon,target,summon.s.atk,'arts',['shadow']);metric(battle,'suiShadowAttacks');}}}
  const logistics=active.get('logistics');if(logistics){for(const owner of memberUnits(logistics)){const key=owner.ownerId,acc=battle.resonanceLogisticsAcc.get(key)??0,accept=`logisticsCd:${key}`,until=counters.get(accept)??-Infinity,p=params(active,'logistics','logistics_dp');if(acc>=10&&battle.time>=until){battle.resonanceLogisticsAcc.set(key,acc-10);counters.set(accept,battle.time+n(p.teamCooldown,2));metric(battle,'logisticsDpThreshold');for(const ally of battle.allyUnits.filter((unit)=>unit.kind==='op'&&unit.alive&&unit.ownerId===key)){ally.skill?.gainSp?.(n(p.per10DpSp,2),'resonanceLogistics');battle.heal(owner,ally,ally.s.maxHp*n(p.heal,3)/100,{tags:['resonance']});}}}}
}
