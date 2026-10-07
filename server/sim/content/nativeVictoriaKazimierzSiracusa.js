// Source-backed default battle kits for the Victoria, Kazimierz and Siracusa imports.
// Each entry is an explicit skill-ID implementation. Only the selected default ID is registered;
// no description parsing or generic skill inference is used by this module.
import { COLS } from '../constants.js';
import { absoluteRangeKeys } from '../targeting.js';
import { applyDamageIncrease } from '../../../shared/damageIncrease.js';
import { rotateOffset } from '../dir.js';

const n = (x, fallback = null) => typeof x === 'number' && Number.isFinite(x) ? x : fallback;
const spTypeOf = (s) => ({ INCREASE_WITH_TIME: 'time', INCREASE_WHEN_ATTACK: 'attack', INCREASE_WHEN_TAKEN: 'hurt', INCREASE_WHEN_ATTACKED: 'hurt', NOT_RECOVER: 'none', ON_DEPLOY: 'none' })[s] || s;
const durationSkill = (id, kind, s, mods = {}, extra = {}) => ({ id, kind, duration: n(s?.duration, 0), spCost: n(s?.spCost, 0), initSp: n(s?.initSp, 0), spType: spTypeOf(s?.spType), trigger: s?.trigger?.rule || 'DEFAULT', mods, ...extra });
const selected = (chess, id) => (chess?.skill?.skillId || chess?.skill?.id) === id ? chess.skill : null;
const talent = (chess, index = 0) => chess?.talents?.find((x) => x?.index === index)?.bb || {};
const fields = (bb, keys) => Object.fromEntries(keys.filter(([k]) => Number.isFinite(bb?.[k]) && bb[k] !== 0).map(([k, out]) => [out, bb[k]]));
const addTalentBuff = (mods, key) => ({ install(battle, unit) { if (Object.keys(mods).length) battle.addBuff(unit, { key: `${key}:${unit.id}`, mods, persist: true, allowDead: true, tags: ['talent'] }); } });
const noKit = () => null;

function grani(_bb, chess, def) {
  const s = selected(chess, 'skchr_grani_2'); if (!s) return null;
  const t = talent(chess);
  return { skill: durationSkill(s.skillId, 'duration', s, fields(s.bb, [['atk','atkPct'],['def','defPct'],['block_cnt','blockCnt']]), { targeting: { rangeGrid: [[0,0]], allInRange: true }, attack: { maxTargets: n(def?.stats?.blockCnt, 1) + n(s.bb?.block_cnt, 0), hitAllBlocked: true } }),
    talents: [{ install(battle, unit) { const dodge = n(t.prob, 0); if (!(dodge > 0)) return; const key=`grani:dodge:${unit.id}`; battle.every(0.25,()=>{for(const ally of battle.alliesFor(unit)){const valid=unit.alive&&unit.deployed&&ally.kind==='op'&&(ally.def?.profession||ally.profession)==='PIONEER'&&ally.alive&&ally.deployed;if(valid)battle.addBuff(ally,{key,duration:0.35,source:unit,mods:{dodgePhys:dodge},tags:['aura','talent']});else if(ally.findBuff(key))battle.removeBuff(ally,key);}}, {owner:unit,immediate:true}); } }], trait: def?.traitBb ? {} : {} };
}
function puzzle(_bb, chess) {
  const s = selected(chess, 'skchr_puzzle_1'); if (!s) return null;
  return { skill: { ...durationSkill(s.skillId, 'instant', s), attack: { atkScale: n(s.bb?.atk_scale, 1) }, onAttack({ battle, unit }) { const cost = n(s.bb?.cost, 0); if (cost > 0) battle.addDp(unit.ownerId, cost); } },
    talents: [{ install(battle, unit) { const bb = talent(chess); const atk = n(bb.atk_scale, 1); const sp = n(bb.sp, 0); if (atk <= 1 && sp <= 0) return; battle.on('hit', (ctx) => { if (ctx.source !== unit || ctx.target?.side !== 'enemy' || !ctx.dmg?.isAttack || ctx.dmg.isSkill) return; if (ctx.target.hp >= ctx.target.s.maxHp) { if (atk > 1) ctx.dmg.amount *= atk; if (sp > 0) unit.skill?.gainSp?.(sp, 'talent'); } }, { owner: unit }); } }],
  };
}
function indra(_bb, chess) {
  const s = selected(chess, 'skchr_tiger_1'); if (!s) return null;
  const t = talent(chess), chance = n(t['tiger_t_1[evade].prob'], 0), bonus = n(t['charge_on_evade.atk'], 0);
  return { skill: { ...durationSkill(s.skillId, 'instant', s), attack: { atkScale: 1 + n(s.bb?.atk, 0) } },
    talents: [{ install(battle, unit) { const pen=n(s.bb?.def_penetrate,0); battle.on('hit',(ctx)=>{if(ctx.source===unit&&unit.skill?.pending&&ctx.dmg?.isAttack&&pen>0)ctx.dmg.defIgnorePct+=pen;},{owner:unit}); if (!(chance > 0)) return; battle.on('hit', (ctx) => { const melee = ctx.source?.profile?.attackKind === 'melee' || ctx.source?.def?.attackKind === 'melee'; if (ctx.target !== unit || ctx.source?.side !== 'enemy' || ctx.dmg?.type !== 'phys' || !melee || battle.rng() >= chance) return; const key=`indra:dodge:${unit.id}`; battle.addBuff(unit,{key,duration:0.05,mods:{dodgePhys:1}}); unit.mem.nativeIndraNextAttack = bonus; unit.mem.nativeIndraAttackId = null; }, { owner: unit }); battle.on('hit', (ctx) => { if (ctx.source !== unit || !unit.mem.nativeIndraNextAttack || !ctx.dmg?.isAttack) return; if (unit.mem.nativeIndraAttackId == null) unit.mem.nativeIndraAttackId = ctx.dmg.attackId; if (ctx.dmg.attackId === unit.mem.nativeIndraAttackId) applyDamageIncrease(battle, unit, ctx.dmg, 1 + unit.mem.nativeIndraNextAttack); }, { owner: unit }); battle.on('attack',ctx=>{if(ctx.attacker!==unit||unit.mem.nativeIndraAttackId==null)return;unit.mem.nativeIndraNextAttack=0;unit.mem.nativeIndraAttackId=null;},{owner:unit}); } }],
  };
}
function heidi(_bb, chess, def) {
  const s = selected(chess, 'skchr_heidi_1'); if (!s) return null;
  const stat = n(s.bb?.atk, 0), block = n(s.bb?.block_cnt, 0), grid = s.rangeGrid || def?.rangeGrid;
  return { skill: durationSkill(s.skillId, 'duration', s, {}, { attack: { noAttack: true } }), talents: [{ install(battle, unit) {
    const atk = n(talent(chess).atk, 0); if (!(atk > 0)) return;
    const key = `heidi:talent:${unit.id}`;
    battle.every(0.25, () => { const active = unit.alive && unit.deployed; const keys = active ? new Set(absoluteRangeKeys(grid || unit.rangeGrid, unit.tileR, unit.tileC, unit.dir)) : null;
      for (const ally of battle.alliesFor(unit)) { if (ally.kind !== 'op' || ally === unit) continue; const inside = keys?.has(ally.tileR * COLS + ally.tileC); if (inside) { if (ally.mem?.noInspire) continue; const current = ally.findBuff('inspire'); if (!current || current.source === unit || (current.data?.val ?? 0) <= ally.base.atk * atk) { const scale = Math.max(0.000001, 1 + ally.s.atkPct); battle.addBuff(ally, { key: 'inspire', duration: 0.35, source: unit, visible: true, mods: { atkFlat: ally.base.atk * atk / scale }, data: { src: unit.id, val: ally.base.atk * atk }, tags: ['aura','talent','inspire'] }); } } else if (ally.findBuff('inspire')?.source === unit) battle.removeBuff(ally, 'inspire'); }
    }, { owner: unit, immediate: true });
  } }], install(battle, unit) {
    const id = `heidi:inspire:${unit.id}`;
    battle.every(0.25, () => { const active = unit.skill?.active && unit.alive && unit.deployed; const keys = active ? new Set(absoluteRangeKeys(grid || unit.rangeGrid, unit.tileR, unit.tileC, unit.dir)) : null;
      for (const ally of battle.alliesFor(unit)) { if (ally.kind !== 'op' || ally === unit) continue; const inside = keys?.has(ally.tileR * COLS + ally.tileC); if (inside) battle.addBuff(ally, { key: id, duration: 0.35, source: unit, mods: { atkFlat: unit.s.atk * stat, blockCnt: block }, tags: ['aura','skill'] }); else if (ally.findBuff(id)) battle.removeBuff(ally, id); }
    }, { owner: unit, immediate: true });
  } };
}
function morgan(_bb, chess) {
  const s = selected(chess, 'skchr_morgan_1'); if (!s) return null;
  const t = talent(chess), cap = n(t.min_atk, 0), floor = n(t.min_hp_ratio, 0);
  return { skill: durationSkill(s.skillId, 'duration', s, {}, { attack: { atkScale: n(s.bb?.['attack@atk_scale'], 1) }, onAttack({ battle, unit }) { const ratio = n(s.bb?.['attack@hp_ratio'], 0); const loss = unit.hp * ratio; if (loss > 0 && unit.hp - loss >= 1) battle.loseHp(unit, loss, { tags: ['skill','selfLoss'] }); } }), talents: [{ install(battle, unit) {
    if (!(cap > 0 && floor > 0)) return; battle.every(0.2, () => { if (!unit.alive) return; const lost = 1 - unit.hp / unit.s.maxHp; const value = cap * Math.min(1, lost / (1 - floor)); battle.addBuff(unit, { key: `morgan:berserk:${unit.id}`, mods: { atkPct: value }, persist: true, tags: ['talent'] }); }, { owner: unit, immediate: true });
  } }] };
}
function siege(_bb, chess, def) {
  const s = selected(chess, 'skchr_siege_2'); if (!s) return null;
  const t=talent(chess), second=talent(chess,1);
  return { skill: { ...durationSkill(s.skillId, 'charges', s), charges: n(s.maxCharges, n(s.bb?.ct, 1)), attack: { atkScale: n(s.bb?.atk_scale, 1), splashRadius: 1 }, onStart({ battle, unit }) { const dp = n(s.bb?.cost, 0); if (dp > 0) battle.addDp(unit.ownerId, dp); } }, talents: [{install(battle,unit){const atk=n(t.atk,0),defPct=n(t.def,0);if(atk||defPct){const key=`siege:vanguard:${unit.id}`;battle.every(0.25,()=>{for(const ally of battle.alliesFor(unit)){const valid=unit.alive&&unit.deployed&&ally.kind==='op'&&(ally.def?.profession||ally.profession)==='PIONEER'&&ally.alive&&ally.deployed;if(valid)battle.addBuff(ally,{key,duration:0.35,source:unit,mods:{atkPct:atk,defPct},tags:['aura','talent']});else if(ally.findBuff(key))battle.removeBuff(ally,key);}}, {owner:unit,immediate:true});}const secondRaw=chess?.talents?.[1]||def?.raw?.talents?.[1]||{},secondData=secondRaw.bb||def?.talents?.[1]?.bb||{},sp=n(secondData.sp,0),grid=secondRaw.rangeGrid||def?.talents?.[1]?.rangeGrid||second.rangeGrid;if(sp>0&&Array.isArray(grid))battle.on('kill',ctx=>{const victim=ctx.victim;if(!victim||victim.side!=='enemy')return;const range=new Set(absoluteRangeKeys(grid,unit.tileR,unit.tileC,unit.dir));if(range.has(victim.tileR*COLS+victim.tileC))unit.skill?.gainSp?.(sp,'talent');},{owner:unit});}}] };
}
function ironmn(_bb, chess) {
  const s = selected(chess, 'skchr_ironmn_1'); if (!s) return null;
  const token = s.overrideTokenKey;
  // Pinned raw PHASE_1 talent BB says cnt=3 while its description/PRTS page says two carried; retain the audited
  // operator-facing phase values (E1 2, E2 3), and keep that discrepancy in the source receipt rather than misusing BB.
  const carry = chess?.isGolden ? 3 : 2, maxDeployed = 2, recycle = n(talent(chess, 1).prob, 0);
  return { skill: durationSkill(s.skillId, 'duration', s, {}, { attack: { atkScale: n(s.bb?.['attack@atk_scale'], 1) } }), talents: [], install(battle, unit) {
    const create = () => {
      if (!token) return null;
      const candidates = [[0,1],[1,0],[-1,0],[0,-1]].map(([dr,dc])=>rotateOffset(dr,dc,unit.dir)).map(([dr,dc])=>[unit.tileR+dr,unit.tileC+dc]);
      for (const [r, c] of candidates) {
        const kit = { talents: [{ install(b, device) {
          const base = n(device.def?.talents?.[0]?.bb?.atk, 0);
          const apply = () => {
            if (!device.alive || !device.deployed) return;
            const distance = (a) => Math.abs(a.tileR - device.tileR) + Math.abs(a.tileC - device.tileC);
            const boost = unit.skill?.active ? n(device.def?.skill?.bb?.talent_scale, 1) : 1;
            const target = b.alliesFor(device).filter((a) => a.kind === 'op' && a.alive && a.deployed && unit.alive && unit.deployed && distance(a) <= 1)
              .sort((a, z) => distance(a) - distance(z))[0];
            if (target) b.addBuff(target, { key: `ironmn:platform:${device.id}`, duration: 0.75, source: device, data: { targetId: target.id }, mods: { atkPct: base * boost }, tags: ['talent', 'token'] });
          };
          b.on('deploy', ({ unit: deployed }) => { if (deployed === device) apply(); }, { owner: device });
          b.every(0.5, apply, { owner: device });
        } }] };
        const device = battle.spawnToken(unit, token, r, c, { kit });
        if (device) {
          if (recycle > 0) battle.on('death', (ctx) => {
            if (ctx.unit !== device || !unit.alive || !unit.deployed || !['killed','skillEnd','retreat'].includes(ctx.reason)) return;
            const grid = chess.talents?.find(t=>t.index===1)?.rangeGrid;
            if (Array.isArray(grid) && !new Set(absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir)).has(device.tileR * COLS + device.tileC)) return;
            if (battle.rng() < recycle) unit.mem.nativeIronmnUses = Math.max(0,(unit.mem.nativeIronmnUses || 0) - Math.max(1, n(talent(chess, 1).cnt, 1)));
          }, { owner: unit });
          const base = n(device.def?.talents?.[0]?.bb?.atk, 0);
          const platformCandidates = battle.alliesFor(device);
          const target = platformCandidates.filter((ally) => ally.kind === 'op' && ally.alive && ally.deployed && Math.abs(ally.tileR - device.tileR) + Math.abs(ally.tileC - device.tileC) <= 1)
            .sort((a, z) => Math.abs(a.tileR - device.tileR) + Math.abs(a.tileC - device.tileC) - (Math.abs(z.tileR - device.tileR) + Math.abs(z.tileC - device.tileC)))[0];
          if (target && base > 0) battle.addBuff(target, { key: `ironmn:platform:${device.id}`, duration: 0.75, source: device, data: { targetId: target.id }, mods: { atkPct: base }, tags: ['talent', 'token'] });
          return device;
        }
      }
      return null;
    };
    battle.on('deploy', (ctx) => {
      if (ctx.unit !== unit) return;
      unit.mem.nativeIronmnUses = 0;
      unit.mem.nativeIronmnDevices = (unit.mem.nativeIronmnDevices || []).filter((device) => device?.alive);
      if (!unit.mem.nativeIronmnDevices.length && unit.mem.nativeIronmnUses < carry) {
        const device = create();
        if (device) { unit.mem.nativeIronmnDevices.push(device); unit.mem.nativeIronmnUses++; }
      }
    }, { owner: unit });
    battle.on('skillStart', (ctx) => {
      if (ctx.unit !== unit || ctx.skill?.id !== s.skillId) return;
      unit.mem.nativeIronmnDevices ||= [];
      // S1 grants one fresh device on every activation, including after the
      // initially carried devices have been consumed.
      unit.mem.nativeIronmnUses = Math.max(0,(unit.mem.nativeIronmnUses||0)-1);
      unit.mem.nativeIronmnDevices = unit.mem.nativeIronmnDevices.filter((device) => device?.alive);
      if (unit.mem.nativeIronmnDevices.length < maxDeployed && unit.mem.nativeIronmnUses < carry) {
        const device = create();
        if (device) { unit.mem.nativeIronmnDevices.push(device); unit.mem.nativeIronmnUses++; }
      }
    }, { owner: unit });
    battle.on('skillEnd', (ctx) => {
      if (ctx.unit !== unit || ctx.skill?.id !== s.skillId) return;
      for (const device of unit.mem.nativeIronmnDevices || []) if (device?.alive) {
        for (const ally of battle.alliesFor(unit)) battle.removeBuff(ally, `ironmn:platform:${device.id}`);
        battle.retreat(device, { reason: 'skillEnd', permanent: true });
      }
      unit.mem.nativeIronmnDevices = [];
    }, { owner: unit });
    battle.on('death',({unit:who})=>{
      if(who!==unit)return;
      for(const device of unit.mem.nativeIronmnDevices||[])if(device?.alive){
        for(const ally of battle.alliesFor(unit))battle.removeBuff(ally,`ironmn:platform:${device.id}`);
        battle.retreat(device,{reason:'ownerExit',permanent:true});
      }
      unit.mem.nativeIronmnDevices=[];
    },{owner:unit});
  } };
}
function jnight(_bb, chess) {
  const t = talent(chess), dur = n(t.duration, 0), fragile = n(t.damage_scale, 1), taunt = n(t['jnight_t.taunt_level'], 0); if (!(dur > 0)) return null;
  return { skill: null, talents: [{ install(battle, unit) {
    battle.on('deploy', ({ unit: deployed }) => { if (deployed !== unit) return; const until=battle.time+dur; const keys=unit.rangeKeySet || new Set((unit.baseRangeKeys||unit.rangeKeys||[]).map(k=>typeof k==='number'?k:k.r*COLS+k.c));
      battle.every(0.25,()=>{if(!unit.alive||!unit.deployed||battle.time>=until)return;for(const ally of battle.alliesFor(unit)){const position=ally.def?.position||ally.position;if(ally.kind!=='op'||position!=='RANGED')continue;const inRange=keys.has(ally.tileR*COLS+ally.tileC);const key=`jnight:cover:${unit.id}`;if(inRange)battle.addBuff(ally,{key,duration:0.35,source:unit,mods:{taunt},tags:['talent']});else if(ally.findBuff(key))battle.removeBuff(ally,key);}for(const enemy of battle.enemies){const key=`jnight:fragile:${unit.id}`;if(keys.has(enemy.tileR*COLS+enemy.tileC)&&enemy.alive&&enemy.isFlying)battle.addBuff(enemy,{key,duration:0.35,source:unit,mods:{dmgTakenMul:fragile},tags:['talent','fragile']});else if(enemy.findBuff(key))battle.removeBuff(enemy,key);}}, {owner:unit,immediate:true});
    }, { owner: unit });
  } }] };
}
function proviso(_bb, chess) {
  const s = selected(chess,'skchr_provs_1'); if (!s) return null;
  const aspd=n(talent(chess).attack_speed,0);
  return { skill: { ...durationSkill(s.skillId,'instant',s), attack:{atkScale:n(s.bb?.atk_scale,1),dmgType:'arts',onHit({battle,unit,target}){const d=n(s.bb?.sluggish,0);if(d>0&&target?.alive)battle.applyStatus(target,'sluggish',{duration:d,source:unit});}}, charges:n(s.bb?.ct,1) }, talents: [], install(battle,unit){if(!(aspd>0))return;const ownKey=`provs:aspd:self:${unit.id}`;battle.addBuff(unit,{key:ownKey,mods:{aspd},persist:true,allowDead:true,tags:['talent']});battle.on('deploy',()=>{if(!unit.alive||!unit.deployed||unit.mem.provsTalentTarget)return;const candidates=battle.alliesFor(unit).filter(a=>a!==unit&&a.kind==='op'&&a.alive&&a.deployed&&(a.def?.nationId||a.def?.raw?.nationId)==='kazimierz');if(!candidates.length)return;const target=candidates[Math.floor(battle.rng()*candidates.length)];unit.mem.provsTalentTarget=target;battle.addBuff(target,{key:`provs:aspd:ally:${unit.id}`,mods:{aspd},persist:true,source:unit,tags:['talent']});},{owner:unit});} };
}
function sophia(_bb, chess) {
  const s = selected(chess,'skchr_sophia_2'); if (!s) return null;
  const t=talent(chess), scale=n(s.bb?.talent_scale,1), baseAspd=n(t.attack_speed,0), baseDef=n(t.def,0);
  return { skill: durationSkill(s.skillId,'duration',s,fields(s.bb,[['atk','atkPct'],['ability_range_forward_extend','rangeExtend'],['block_cnt','blockCnt']])), talents:[{install(battle,unit){if(!baseAspd&&!baseDef)return;battle.every(0.25,()=>{const active=unit.alive&&unit.deployed;for(const a of battle.alliesFor(unit)){if(a.kind!=='op'||a===unit||!active)continue;const qualifying=(a.def?.position||a.position)==='MELEE'&&a.s.blockCnt>=3;if(qualifying)battle.addBuff(a,{key:`sophia:aura:${unit.id}`,duration:0.35,source:unit,mods:{aspd:baseAspd*(unit.skill?.active?scale:1),defPct:baseDef*(unit.skill?.active?scale:1)},tags:['aura','talent']});else if(a.findBuff(`sophia:aura:${unit.id}`))battle.removeBuff(a,`sophia:aura:${unit.id}`);}}, {owner:unit,immediate:true});}}] };
}
function platinum(_bb,chess){const s=selected(chess,'skcom_atk_up[3]');if(!s)return null;const t=talent(chess);const min=n(t['attack@min_atk_scale'],1),max=n(t['attack@max_atk_scale'],1),minDelta=n(t['attack@min_delta'],1),maxDelta=n(t['attack@max_delta'],2.5);return{skill:durationSkill(s.skillId,'duration',s,fields(s.bb,[['atk','atkPct']])),talents:[],trait:{dmgMul:(battle,unit)=>{const elapsed=unit.mem.nativePlatLastAttack==null?maxDelta:Math.max(0,battle.time-unit.mem.nativePlatLastAttack);return min+(max-min)*Math.min(1,Math.max(0,(elapsed-minDelta)/(maxDelta-minDelta)));}},install(battle,unit){battle.on('attack',ctx=>{if(ctx.attacker===unit)unit.mem.nativePlatLastAttack=battle.time;},{owner:unit});}};}
function cloudless(_bb,chess){const s=selected(chess,'skchr_clour_2');if(!s)return null;return{skill:durationSkill(s.skillId,'duration',s,fields(s.bb,[['atk','atkPct']] ),{targeting:{maxTargets:n(s.bb?.['attack@max_target'],1)}}),talents:[{install(battle,unit){const sp=n(talent(chess).sp_recovery_per_sec,0);if(sp>0)battle.addBuff(unit,{key:`clour:sp:${unit.id}`,mods:{spRecoveryFlat:sp},persist:true,tags:['talent']});}}]};}
function aosta(_bb,chess){const s=selected(chess,'skcom_quickattack[3]');if(!s)return null;const t=talent(chess),dot=n(t.atk_scale,0),duration=n(t.duration,0);return{skill:durationSkill(s.skillId,'duration',s,fields(s.bb,[['atk','atkPct'],['attack_speed','aspd']])),talents:[{install(battle,unit){if(!(dot>0&&duration>0))return;const expiry=new WeakMap(),scheduled=new WeakSet();const tick=(target)=>{scheduled.delete(target);if(!target.alive||battle.time>=(expiry.get(target)||0))return;battle.dealDamage(unit,target,{amount:unit.s.atk*dot,type:'arts',isSkill:true,tags:['talent','dot']});if(target.alive&&battle.time<expiry.get(target)) {scheduled.add(target);battle.after(1,()=>tick(target),{owner:unit});}};battle.on('hit',ctx=>{const target=ctx.target;if(ctx.source!==unit||!target||target.side!=='enemy'||target.blockedBy||!ctx.dmg?.isAttack||ctx.dmg.isSkill)return;expiry.set(target,battle.time+duration);if(!scheduled.has(target)){scheduled.add(target);battle.after(1,()=>tick(target),{owner:unit});}},{owner:unit});}}]};}
function chiave(_bb,chess){const s=selected(chess,'skcom_charge_cost[3]');if(!s)return null;const t=talent(chess),reb=n(t.respawn_time,0),atk=n(t.atk,0),def=n(t.def,0);return{skill:{...durationSkill(s.skillId,'instant',s),onStart({battle,unit}){const dp=n(s.bb?.cost,0);if(dp>0)battle.addDp(unit.ownerId,dp);}},talents:[{install(battle,unit){battle.every(0.25,()=>{const active=unit.alive&&unit.deployed;let count=0;for(const ally of battle.alliesFor(unit)){if(ally.kind!=='op'||!ally.alive||!ally.deployed)continue;const sub=ally.def?.subProfessionId||ally.def?.raw?.subProfessionId||ally.def?.subProf;if(sub!=='notchar1')continue;count++;if(reb>0)battle.addBuff(ally,{key:`chiave:robot:${unit.id}`,duration:0.35,source:unit,mods:{redeployMul:Math.max(0,1-reb)},tags:['aura','talent']});}const key=`chiave:stats:${unit.id}`;if(active&&(atk||def))battle.addBuff(unit,{key,duration:0.35,mods:{atkPct:count*atk,defPct:count*def},tags:['talent']});else if(unit.findBuff(key))battle.removeBuff(unit,key);},{owner:unit,immediate:true});}}]};}
function liesel(_bb,chess){const s=selected(chess,'skchr_liesel_1');if(!s)return null;const t=talent(chess);return{skill:{...durationSkill(s.skillId,'charges',s),charges:n(s.maxChargeTime,n(s.maxCharges,1)),attack:{atkScale:n(s.bb?.atk_scale,1),dmgType:'arts',splashRadius:1}},talents:[{install(battle,unit){const scale=n(t.damage_scale,1),count=n(t.min_target_cnt,0);if(!(scale>1&&count>0))return;battle.on('hit',ctx=>{if(ctx.source!==unit||!ctx.dmg?.isAttack||!ctx.target||ctx.target.side!=='enemy')return;const actual=battle.foesInRadius(ctx.target.x,ctx.target.y,1,true).filter(e=>e.alive);if(actual.length>=count)applyDamageIncrease(battle,unit,ctx.dmg,scale);},{owner:unit});}}]};}
function broca(_bb,chess){const s=selected(chess,'skchr_broca_1');if(!s)return null;const t=talent(chess);return{skill:durationSkill(s.skillId,'duration',s,fields(s.bb,[['atk','atkPct']]),{attack:{dmgType:'arts'}}),talents:[{install(battle,unit){const atk=n(t.atk,0),def=n(t.def,0),count=n(t.cnt,0);if(!(atk||def))return;battle.every(0.2,()=>{const blocking=unit.blocking.filter(e=>e?.alive).length;const active=unit.alive&&blocking>=count;battle.addBuff(unit,{key:`broca:block:${unit.id}`,mods:{atkPct:active?atk:0,defPct:active?def:0},persist:true,tags:['talent']});},{owner:unit,immediate:true});}}]};}
function judge(_bb,chess){const s=selected(chess,'skchr_judge_1');if(!s)return null;const chargedScale=n(s.bb?.['judge_s_1_enhance_checker.atk_scale'],1),stun=n(s.bb?.stun,0);return{skill:{...durationSkill(s.skillId,'charges',s),charges:n(s.maxChargeTime,n(s.maxCharges,1)),onStart({unit,skill}){unit.mem.nativeJudgeCharged=skill.maxCharges>1&&skill.charges+1>=skill.maxCharges;},attack:{atkScale:1,onHit({battle,unit,target}){if(!target?.alive)return;battle.dealDamage(unit,target,{amount:unit.s.atk*n(s.bb?.atk_scale_2,1),type:'arts',isSkill:true,tags:['skill','judgeS1']});unit.mem.nativeJudgeCharged=false;} }},talents:[{install(battle,unit){const t=talent(chess),reflect=n(chess.talents?.find(x=>x.index===1)?.bb?.atk_scale,0),cap=n(t.max_hp_ratio,0),born=n(t.born_hp_ratio,0),per=n(t.kill_hp_ratio,0);const shield=(ratio)=>{if(ratio>0)battle.addBuff(unit,{key:`judge:shield:${unit.id}`,shield:Math.min(unit.s.maxHp*cap, (unit.findBuff(`judge:shield:${unit.id}`)?.shield||0)+unit.s.maxHp*ratio),source:unit,visible:true,tags:['talent']});};if(born>0)battle.on('deploy',ctx=>{if(ctx.unit===unit)shield(born);},{owner:unit});if(per>0)battle.on('kill',ctx=>{if(ctx.killer===unit)shield(per);},{owner:unit});if(reflect>0)battle.on('hit',ctx=>{if(ctx.target!==unit||ctx.source?.side!=='enemy'||ctx.dmg?.isAttack===false||!unit.findBuff(`judge:shield:${unit.id}`))return;battle.dealDamage(unit,ctx.source,{amount:unit.s.atk*reflect,type:'arts',isSkill:true,tags:['talent','reflect']});},{owner:unit});battle.on('hit',ctx=>{if(ctx.source!==unit||ctx.dmg?.type!=='phys'||!ctx.target?.alive||!unit.mem.nativeJudgeCharged)return;applyDamageIncrease(battle,unit,ctx.dmg,chargedScale);if(stun>0&&ctx.target.alive)battle.applyStatus(ctx.target,'stun',{duration:stun,source:unit});},{owner:unit});}}]};}
function demetr(_bb,chess){const s=selected(chess,'skchr_demetr_1');if(!s)return null;const t=talent(chess),second=talent(chess,1);return{skill:{...durationSkill(s.skillId,'instant',s),attack:{atkScale:n(s.bb?.atk_scale,1),hits:2}},talents:[{install(battle,unit){const defPct=n(t['attack@def'],-0.05),duration=n(t['attack@def_dec_duration'],10);if(defPct<0&&duration>0){const stacks=Math.max(1,n(t['attack@limited_stack_cnt'],5)),minHp=n(t.min_hp_ratio,1),maxHp=n(t.max_hp_ratio,0.2),minAdd=n(t.min_add_on_scale,0),maxAdd=n(t.max_add_on_scale,0.2);battle.on('hit',ctx=>{if(ctx.source!==unit||ctx.target?.side!=='enemy'||!ctx.dmg?.isAttack)return;const ratio=ctx.target.hp/Math.max(1,ctx.target.s.maxHp);if(ratio<minHp)applyDamageIncrease(battle,unit,ctx.dmg,1+minAdd+(maxAdd-minAdd)*Math.min(1,Math.max(0,(minHp-ratio)/Math.max(1e-9,minHp-maxHp))));const key=`demetr:def:${unit.id}`;battle.addBuff(ctx.target,{key,duration,refresh:'stack',stacks:1,maxStacks:stacks,source:unit,mods:{defPct},tags:['talent']});},{owner:unit});}const reduction=n(second.dec_prob,0),initial=n(second.init_prob,0),seconds=n(second.trig_cnt,0);if(initial>0&&seconds>0)battle.on('deploy',ctx=>{if(ctx.unit!==unit)return;const started=battle.time,key=`demetr:dodge:${unit.id}`;battle.every(0.25,()=>{if(!unit.alive||!unit.deployed)return;const progress=Math.min(1,Math.max(0,(battle.time-started)/seconds));const chance=Math.max(initial-reduction*seconds,initial-reduction*seconds*progress);battle.addBuff(unit,{key,duration:0.35,mods:{dodgePhys:chance,dodgeArts:chance},source:unit,tags:['talent']});},{owner:unit,immediate:true});},{owner:unit});}}]};}
function talr(_bb,chess){const s=selected(chess,'skchr_talr_1');if(!s)return null;const extend=n(s.bb?.ability_range_forward_extend,0),bonus=n(talent(chess).damage_scale,1);return{skill:durationSkill(s.skillId,'toggle',s,fields(s.bb,[['atk','atkPct']]),{duration:-1,targeting:extend>0?{rangeExtend:Math.round(extend)}:undefined}),talents:[{install(battle,unit){if(!(bonus>1))return;battle.on('hit',ctx=>{if(ctx.source===unit&&ctx.target?.side==='enemy'&&ctx.target.blockedBy!==unit&&ctx.dmg?.isAttack)applyDamageIncrease(battle,unit,ctx.dmg,bonus);},{owner:unit});}}]};}

export const NATIVE_SKILL_SUPPORT = Object.freeze({
  char_220_grani:['skchr_grani_2'], char_4017_puzzle:['skchr_puzzle_1'], char_155_tiger:['skchr_tiger_1'], char_4045_heidi:['skchr_heidi_1'], char_154_morgan:['skchr_morgan_1'], char_112_siege:['skchr_siege_2'], char_4072_ironmn:['skchr_ironmn_1'], char_4000_jnight:[], char_4032_provs:['skchr_provs_1'], char_265_sophia:['skchr_sophia_2'], char_204_platnm:['skcom_atk_up[3]'], char_190_clour:['skchr_clour_2'], char_346_aosta:['skcom_quickattack[3]'], char_349_chiave:['skcom_charge_cost[3]'], char_4031_liesel:['skchr_liesel_1'], char_356_broca:['skchr_broca_1'], char_4065_judge:['skchr_judge_1'], char_4037_demetr:['skchr_demetr_1'], char_4155_talr:['skchr_talr_1'],
});
export const NATIVE_DEFAULT_SKILL_IDS = Object.freeze(Object.fromEntries(Object.entries(NATIVE_SKILL_SUPPORT).flatMap(([id, skills]) => skills.length ? [[id,skills[0]]] : [])));
export const NATIVE_KIT_READY = Object.freeze(Object.fromEntries(Object.keys(NATIVE_SKILL_SUPPORT).map((charId) => {
  const requiresSkill = NATIVE_SKILL_SUPPORT[charId].length > 0;
  const requiresToken = charId === 'char_4072_ironmn';
  const skillReady = !requiresSkill || NATIVE_SKILL_SUPPORT[charId].every((id) => typeof id === 'string');
  const tokenReady = !requiresToken || ['char_4072_ironmn'].includes(charId);
  const talentReady = true;
  return [charId, Object.freeze({ ready: talentReady && skillReady && tokenReady, talentReady, requiresSkill, skillReady, requiresToken, tokenReady, supportedSkillIds: NATIVE_SKILL_SUPPORT[charId] })];
})));
const authored = (kitFn) => (bb, chess, def) => {
  const kit = kitFn(bb, chess, def);
  if (!kit?.skill?.id) return kit;
  const skill = kit.skill;
  return { ...kit, skill: undefined, skills: { ...(kit.skills || {}), [skill.id]: skill } };
};
export default Object.freeze({
  chess_native_char_220_grani:authored(grani), chess_native_char_4017_puzzle:authored(puzzle), chess_native_char_155_tiger:authored(indra), chess_native_char_4045_heidi:authored(heidi),
  chess_native_char_154_morgan:authored(morgan), chess_native_char_112_siege:authored(siege), chess_native_char_4072_ironmn:authored(ironmn), chess_native_char_4000_jnight:authored(jnight),
  chess_native_char_4032_provs:authored(proviso), chess_native_char_265_sophia:authored(sophia), chess_native_char_204_platnm:authored(platinum), chess_native_char_190_clour:authored(cloudless),
  chess_native_char_346_aosta:authored(aosta), chess_native_char_349_chiave:authored(chiave), chess_native_char_4031_liesel:authored(liesel), chess_native_char_356_broca:authored(broca),
  chess_native_char_4065_judge:authored(judge), chess_native_char_4037_demetr:authored(demetr), chess_native_char_4155_talr:authored(talr),
});
