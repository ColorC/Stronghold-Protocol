// Combat effects for the Resonance mode. This module attaches to the real Battle hooks and keeps only small counters
// when recording is disabled; visual floor data is static metadata plus at most twelve active dynamic areas.
import { installResonancePacts } from './pacts.js';
import { installResonanceEquipment } from './equipment.js';

const normId = (v) => String(v ?? '').replace(/_[ab]$/, '');
const numeric = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const tierRows = (pact) => Array.isArray(pact) ? pact : Array.isArray(pact?.tiers) ? pact.tiers : Array.isArray(pact?.levels) ? pact.levels : [];
const effectsOf = (row) => Array.isArray(row?.effects) ? row.effects : [];
const rounds = (n) => Math.round(n * 100) / 100;
const profileParams = (effect, star) => effect?.params?.byStar?.[star] ?? effect?.params ?? {};

/** Finish boss/hidden specs as a real loss after every scheduled enemy has escaped the field. */
export function finishResonanceTerminalIfEscaped(battle, nodeKind) {
  if (!['boss', 'hidden'].includes(nodeKind) || battle.finished || !battle.started || battle._spawnSeq <= 0) return false;
  if (!(battle.sharedBoss?.hp > 0) || (battle._pending?.length ?? 0) > 0 || battle.enemies.some((enemy) => enemy.alive && enemy.deployed)) return false;
  if (battle._hasPendingEnemySchedules()) return false;
  battle.forceEnd('leader-escaped');
  return battle.finished;
}

function contentOf(catalog) { return catalog?.resonanceContent ?? catalog ?? {}; }
function operatorIndex(content) {
  const src = content?.operators ?? {};
  const map = new Map();
  for (const [key, op] of Object.entries(src)) {
    map.set(normId(op?.sourceChessId ?? key), op);
    if (op?.charId) map.set(op.charId, op);
  }
  return map;
}
function inputOf(unit) {
  const list = unit?.player?.input?.units;
  return Array.isArray(list) ? list.find((x) => x?.uid === unit.uid && x.kind !== 'token') ?? null : null;
}
function selectedPairMembers(ctx,battle,params){
  const row=ctx.strategies.find(s=>(s.effects??[]).some(e=>e.kind==='pair_guard'));const targetIds=row?.targets??[];
  if(!Array.isArray(targetIds)||targetIds.length<2)return [];
  const selected=targetIds.slice(0,2).map(id=>battle.allyUnits.find(u=>String(u.uid)===String(id))).filter(Boolean);
  if(selected.length!==2)return [];
  if(params.adjacent===false||Math.hypot(selected[0].tileR-selected[1].tileR,selected[0].tileC-selected[1].tileC)<=1.5)return selected;
  return [];
}
function pieceOperator(unit, ctx) {
  const raw = unit?.def?.raw ?? unit?.def ?? {};
  return ctx.bySource.get(raw.charId) ?? ctx.bySource.get(normId(raw.id ?? raw.chessId ?? unit.defId)) ?? null;
}
function pactIds(unit, op) {
  const ids = new Set(op?.pacts ?? []);
  for (const id of unit?.mem?.resonancePacts ?? []) ids.add(id);
  for(const id of inputOf(unit)?.extraPacts??[])ids.add(id);
  return ids;
}
function starOf(unit, op) {
  const raw=unit?.def?.raw??unit?.def??{};
  const explicit=Number(unit?.resonanceStar??raw.resonanceStar??raw.resonance?.star);
  if(Number.isInteger(explicit)&&explicit>=1&&explicit<=3)return explicit;
  const entry = inputOf(unit);
  const n = Number(entry?.star ?? entry?.stars ?? entry?.rank ?? 1);
  return Math.max(1, Math.min(3, Number.isInteger(n) ? n : 1));
}
function uniquePactMembers(battle, ctx, pactId) {
  const units = battle.allyUnits.filter((u) => u.kind === 'op' && !u.removed);
  const byChar = new Map();
  for (const u of units) {
    const op = pieceOperator(u, ctx);
    if (!op) continue;
    const ids = new Set(op.pacts ?? []);
    for (const item of inputOf(u)?.items ?? u.items ?? []) {
      const id = typeof item === 'string' ? item : item?.id;
      if (id?.startsWith('pact:')) ids.add(id.slice(5));
      for (const effect of ctx.content.equipment?.[id]?.effects ?? []) if (effect.kind === 'transfer_pact' && (effect.params?.pactId ?? effect.params?.pact)) ids.add(effect.params.pactId ?? effect.params.pact);
    }
    if (!ids.has(pactId)) continue;
    const key = op.charId ?? op.id;
    if (!byChar.has(key)) byChar.set(key, []);
    byChar.get(key).push(u);
  }
  return byChar;
}
function tierFor(ctx, pactId, memberCount) {
  const rows = tierRows(ctx.content.pacts?.[pactId]);
  return rows.filter((r) => Number(r?.threshold ?? r?.count ?? 1) <= memberCount)
    .sort((a, b) => numeric(a.threshold ?? a.count, 1) - numeric(b.threshold ?? b.count, 1)).at(-1) ?? null;
}
function activeSpecialPacts(battle,ctx){
  const out=new Map();for(const id of ['aegir','holyGun','yela']){const members=uniquePactMembers(battle,ctx,id),tier=tierFor(ctx,id,members.size);if(tier)out.set(id,{id,members,tier,effects:effectsOf(tier)});}return out;
}
function statMods(effects) {
  const mods = {};
  for (const e of effects) {
    if (e?.kind !== 'stat') continue;
    const p = e.params ?? e;
    const stat = p.stat;
    const value = numeric(p.value, NaN);
    if (!Number.isFinite(value) || !stat) continue;
    if (p.mode === 'mul') mods[stat.endsWith('Mul') ? stat : `${stat}Mul`] = value;
    else if (p.mode === 'percent') mods[stat === 'atkFromHp' ? 'atkHpPct' : stat === 'maxHp' ? 'hpPct' : stat === 'atk' ? 'atkPct' : stat === 'def' ? 'defPct' : stat] = value / 100;
    else mods[stat === 'maxHp' ? 'hpFlat' : stat === 'atk' ? 'atkFlat' : stat === 'def' ? 'defFlat' : stat] = value;
  }
  return mods;
}
function applyPactStats(battle, active) {
  for (const { id, members, effects } of active.values()) {
    const mods = statMods(effects);
    for(const e of effects){const p=e?.params??{};
      if(e?.kind==='aegir_cycle')Object.assign(mods,{hpRegenRatio:numeric(p.regen,0)/100,atkHpPct:numeric(p.atkFromHp,0)/100,...(p.block?{blockCnt:p.block}:{})});
    }
    if (Object.keys(mods).length === 0) continue;
    for (const list of members.values()) for (const u of list) {
      battle.addBuff(u, { key: `resonance:pact:${id}`, persist: true, allowDead: true, mods, tags: ['resonance'] });
    }
  }
}
export function standUnitedActiveTraitCount(battle,ctx,params={}) {
  const excluded=new Set(['holyGun','yela','crown',...(params.excludedPacts??[])]);
  const units=battle.allyUnits.filter(unit=>unit.kind==='op'&&!unit.removed&&unit.deployed);
  const pacts=new Set();
  for(const unit of units){
    for(const id of pactIds(unit,pieceOperator(unit,ctx)))pacts.add(id);
    for(const item of inputOf(unit)?.items??unit.items??[])for(const effect of ctx.content.equipment?.[typeof item==='string'?item:item?.id]?.effects??[])if(['pact_transfer','transfer_pact'].includes(effect.kind))pacts.add(effect.params?.pactId??effect.params?.pact);
  }
  let activeCount=0;
  for(const id of pacts){
    if(excluded.has(id)||ctx.content.pacts?.[id]?.singleUnique===true)continue;
    const identities=new Set();
    for(const unit of units){
      const op=pieceOperator(unit,ctx);if(!op)continue;
      const ids=pactIds(unit,op);
      for(const item of inputOf(unit)?.items??unit.items??[])for(const effect of ctx.content.equipment?.[typeof item==='string'?item:item?.id]?.effects??[])if(['pact_transfer','transfer_pact'].includes(effect.kind))ids.add(effect.params?.pactId??effect.params?.pact);
      if(ids.has(id))identities.add(op.charId??op.id);
    }
    if(tierFor(ctx,id,identities.size))activeCount++;
  }
  return activeCount;
}
function applyStandUnited(battle,ctx) {
  const effect=ctx.strategies.flatMap(strategy=>strategy.effects??[]).find(row=>row.kind==='stand_united');
  if(!effect)return;
  const units=battle.allyUnits.filter(unit=>unit.kind==='op'&&!unit.removed&&unit.deployed);
  const activeCount=standUnitedActiveTraitCount(battle,ctx,effect.params);
  if(activeCount<1)return;
  const pct=numeric(effect.params?.attackPercentPerPact,1.5)*activeCount/100;
  for(const unit of units){
    unit.mem??={};const applied=Number(unit.mem.resonanceStandUnitedPct??0),delta=Math.max(0,pct-applied);
    if(delta<=0)continue;
    battle.addBuff(unit,{key:`resonance:strategy:standUnited:${pct}`,persist:true,allowDead:true,mods:{atkPct:delta},tags:['resonance','strategy']});
    unit.mem.resonanceStandUnitedPct=pct;
  }
}
function enemies(battle) { return battle.enemies.filter((e) => e.alive && e.deployed && !e.hidden); }
function closestEnemy(battle, unit, limit = Infinity) {
  return enemies(battle).filter((e) => Math.hypot(e.x - unit.x, e.y - unit.y) <= limit)
    .sort((a,b) => Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(b.x-unit.x,b.y-unit.y) || a.id-b.id)[0] ?? null;
}
function deal(battle, source, target, amount, type = 'arts', extraTags = []) {
  if (!target?.alive || !(amount > 0)) return 0;
  return battle.dealDamage(source, target, { amount, type, tags: ['resonance', ...extraTags], canDodge: false });
}
function metric(battle, key, n = 1) { const m = battle.resonanceMetrics;if(key.startsWith('triggers.')){const k=key.slice(9);m.triggers[k]=(m.triggers[k]??0)+n;return;}m[key] = (m[key] ?? 0) + n; }
function statEffect(target, key, mods, duration = Infinity) {
  return target && target.alive ? target.battle?.addBuff?.(target, { key, mods, duration, refresh: 'replace', tags: ['resonance'] }) : null;
}
function setDynamicFloor(battle, id, kind, owner, tiles, until) {
  if (!battle.recordEvents) return;
  const list = battle.resonanceDynamicFloors;
  const prior = list.findIndex((x) => x.id === id);
  const row = { id, kind, owner: owner?.id ?? owner ?? null, tiles: tiles.slice(0, 12), until };
  if (prior >= 0) list[prior] = row;
  else if (list.length < 12) list.push(row);
}
function fieldTiles(battle) {
  const out = [];
  const r = battle.rect;
  for (let y = r.r0; y <= r.r1; y++) for (let x = r.c0; x <= r.c1; x++) if (battle.grid.walkable(y, x)) out.push([y, x]);
  for (const [y, x] of battle.grid.specialTiles('end')) if (!out.some((p) => p[0] === y && p[1] === x)) out.push([y, x]);
  return out;
}
function applyPersonalPassives(b,ctx){
  for(const u of b.allyUnits){if(u.kind!=='op')continue;const op=pieceOperator(u,ctx);if(Number(op?.cost)!==5)continue;const passive=op?.stars?.[starOf(u,op)]?.passive;if(!passive||passive.kind==='none')continue;u.mem.resonancePassives=[passive,...(passive.additionalEffect?[passive.additionalEffect]:[])].filter(x=>x?.kind&&x.kind!=='none');}
}
function personalPassives(unit,ctx){return unit?.mem?.resonancePassives??[];}
function applyPieceGrowth(b,state){
  const pieces=new Map((state?.pieces??[]).map(p=>[String(p.uid),p]));
  for(const u of b.allyUnits){if(u.kind!=='op'||u.uid==null)continue;const piece=pieces.get(String(u.uid));const growth=piece?.growth??inputOf(u)?.growth;if(!growth||typeof growth!=='object')continue;
    const mods={};for(const [key,value0]of Object.entries(growth)){const value=numeric(value0,0);if(!value)continue;const stat=key.split(':').at(-1);
      if(['atk','attack','atkFlat'].includes(stat))mods.atkFlat=(mods.atkFlat??0)+value;
      else if(['hp','maxHp','maxHpFlat'].includes(stat))mods.hpFlat=(mods.hpFlat??0)+value;
      else if(['def','defFlat'].includes(stat))mods.defFlat=(mods.defFlat??0)+value;
      else if(['aspd','resFlat','hpPct','atkPct','defPct'].includes(stat))mods[stat]=(mods[stat]??0)+(['hpPct','atkPct','defPct'].includes(stat)?value/100:value);
    }
    if(Object.keys(mods).length)b.addBuff(u,{key:'resonance:permanentGrowth',persist:true,allowDead:true,mods,tags:['resonance','growth']});
  }
}
function addGrowthResult(b,state,unit,key,amount,cap=Infinity,source=String(key).split(':')[0]){
  const piece=(state?.pieces??[]).find(p=>String(p.uid)===String(unit?.uid));if(!piece||!(amount>0))return;
  const old=numeric(piece.growth?.[key],0),queued=b.resonanceResults.growth.filter(row=>String(row.pieceUid)===String(piece.uid)&&row.key===key).reduce((sum,row)=>sum+numeric(row.amount,0),0),actual=Math.max(0,Math.min(amount,cap-old-queued));if(actual>0)b.resonanceResults.growth.push({pieceUid:piece.uid,key,amount:actual,...(Number.isFinite(cap)?{cap}:{}),source});
}
function applySignatureSkill(b,ctx,u,op){
  if(!op)return;const star=starOf(u,op);const p=activeYela(b,ctx);const skillId=u.def?.skill?.id??u.def?.skill?.skillId;
  const passive=op.stars?.[star]?.passive;
  const profile=passive?.params??{};
  if(op.name==='新约能天使'&&skillId==='skchr_angel2_2')holyGunRandomBombs(b,ctx,u,star);
  if(passive?.kind==='star3_nearl'){
    const t=closestEnemy(b,u,8);if(t){const area={unit:u,x:t.x,y:t.y,until:b.time+numeric(profile.sunDuration,8),nextDamage:b.time+1,radius:numeric(profile.sunAreaRadius,2),damage:numeric(profile.sunDps,100)/100};ctx.nearlSunAreas??=new Map();ctx.nearlSunAreas.set(`${u.id}:${b.time}`,area);setDynamicFloor(b,`nearlSun:${u.id}`,'sun',u,[[t.tileR,t.tileC]],area.until);}
  }
  if(passive?.kind==='star3_lappland'&&!u.mem.resonanceLapplandRepeatInstalled){
    u.mem.resonanceLapplandRepeatInstalled=true;
    b.on('skillEnd',event=>{
      if(event.unit!==u||u.mem.resonanceLapplandRepeated||!u.alive||!u.deployed)return;
      u.mem.resonanceLapplandRepeated=true;metric(b,'triggers.signature_lappland_repeat');
      b.after(0,()=>u.skill?.activate?.('resonanceLapplandRepeat',{free:true}),{owner:u});
    },{owner:u});
  }
  if(passive?.kind==='star3_surtur'&&!u.mem.resonanceSurtr){u.mem.resonanceSurtr=true;u.mem.resonanceSurtrAt=b.time;metric(b,'triggers.signature_surtr_ember');}
  if(passive?.kind==='star3_zhuhuang'){
    const [dr,dc]=({UP:[-1,0],DOWN:[1,0],LEFT:[0,-1],RIGHT:[0,1]})[u.dir]??[0,1],tiles=[],rect=b.rect;
    for(let r=u.tileR+dr,c=u.tileC+dc;r>=rect.r0&&r<=rect.r1&&c>=rect.c0&&c<=rect.c1;r+=dr,c+=dc)tiles.push([r,c]);
    const id=`huangWall:${u.id}`,until=Number.MAX_SAFE_INTEGER,burnPercent=numeric(profile.burnPercent,0);
    setDynamicFloor(b,id,'firewall',u,tiles,until);
    ctx.huangWalls??=new Map();ctx.huangWalls.set(u.id,{id,unit:u,tiles,until,next:b.time+1,damage:numeric(profile.dps,100)/100,burn:!!profile.burn,burnPercent});
    if(!u.mem.resonanceHuangEndHook){u.mem.resonanceHuangEndHook=true;b.on('skillEnd',event=>{if(event?.unit!==u)return;const wall=ctx.huangWalls?.get(u.id);if(wall){wall.until=b.time;ctx.huangWalls.delete(u.id);}if(b.recordEvents)b.resonanceDynamicFloors=b.resonanceDynamicFloors.filter(row=>row.id!==id);},{owner:u});}
  }
  if(op.name==='圣聆初雪'&&star>=3&&!u.skill?.active)u.skill?.activate?.('resonanceYela',{free:true});
}
function activeYela(b,ctx){return b.allyUnits.find(x=>x.kind==='op'&&pieceOperator(x,ctx)?.name==='圣聆初雪')??null;}
function silverAshAura(b,ctx,u){
  const op=pieceOperator(u,ctx),profile=personalPassives(u,ctx).find(x=>x.kind==='star3_silverash')?.params??{};
  b.every(numeric(profile.allyInterval,2),()=>{if(!u.alive||!u.deployed)return;const nearby=b.unitsInGrid(u,null,{side:'enemy'});for(const e of nearby)deal(b,u,e,u.s.atk*numeric(profile.allyDamage,10)/100,'phys');if(nearby.length)metric(b,'triggers.signature_silverash_aura',nearby.length);const ids=(u.def?.tokens??[]).map(x=>typeof x==='string'?x:x?.tokenId).filter(Boolean);const eagle=ids[Math.min(2,starOf(u,op)-1)]??ids[0];if(eagle&&!b.allyUnits.some(x=>x.kind==='token'&&x.ownerUnit===u&&x.defId===eagle&&x.alive&&x.deployed)){const tile=findFreeTile(b,u.tileR,u.tileC);if(tile&&b.spawnToken(u,eagle,tile[0],tile[1],{duration:Infinity}))metric(b,'triggers.signature_silverash_hawk');}}, {owner:u});
}
function inRadius(battle, x, y, radius, includeFly = true) {
  return battle.foesInRadius(x, y, radius, true).filter((e) => e.alive && (includeFly || !e.isFlying));
}
function formatUnitInput(unit) { return inputOf(unit) ?? {}; }
function applyStar3Attack(b,ctx,u,target){
  const op=pieceOperator(u,ctx);if(!op||starOf(u,op)<3)return;
  const passives=personalPassives(u,ctx);
  for(const p of passives){const q=p.params??{};
  if(p?.kind==='star3_combo'){u.mem.star3Combo=(u.mem.star3Combo??0)+1;if(u.mem.star3Combo%numeric(q.everyAttacks,6)===0)u.skill?.gainSp?.(numeric(q.sp,2),'resonanceStar3Combo');}
  if(p?.kind==='star3_surtur'){deal(b,u,target,u.s.atk*numeric(q.bonusTrueDamagePerHit,100)/100,'true');metric(b,'triggers.signature_surtr_true_hit');}
  if(p?.kind==='star3_yu'){
    u.mem.yuAttack=(u.mem.yuAttack??0)+1;if(u.mem.yuAttack%numeric(q.everyAttacks,3)===0){
      const dr=Math.sign(target.tileR-u.tileR),dc=Math.sign(target.tileC-u.tileC),len=numeric(q.lineTiles,3);
    for(const e of enemies(b))if(e!==target&&Math.abs((e.tileR-u.tileR)*dc-(e.tileC-u.tileC)*dr)===0&&Math.hypot(e.tileR-u.tileR,e.tileC-u.tileC)<=len)deal(b,u,e,u.s.atk,'phys');metric(b,'triggers.signature_yu_line');
      b.heal(u,u,u.s.maxHp*numeric(q.healMaxHp,10)/100,{tags:['resonance']});
    }
  }
    if(p?.kind==='star3_chongyue'){
    u.mem.chongAttack=(u.mem.chongAttack??0)+1;if(u.mem.chongAttack%numeric(q.everyAttacks,5)===0){const damage=u.s.atk*numeric(q.damage,400)/100;deal(b,u,target,damage,'phys');for(const e of inRadius(b,target.x,target.y,numeric(q.splashTiles,1),true))if(e!==target)deal(b,u,e,damage,'phys');metric(b,'triggers.signature_chongyue_combo');}
  }
  if(p?.kind==='star3_rosmontis'){
    const others=inRadius(b,target.x,target.y,numeric(q.splashRadius,1),true).filter(e=>e!==target);for(const e of others)deal(b,u,e,u.s.atk*numeric(q.aftershockDamage,200)/100,'phys');if(others.length)metric(b,'triggers.signature_rosmontis_aftershock',others.length);
  }
    if(p?.kind==='star3_lemuen'&&u.skill?.active){const others=inRadius(b,target.x,target.y,1,true).filter(e=>e!==target).sort((a,z)=>a.id-z.id).slice(0,numeric(q.chargedExtraTargets,1));for(const e of others)deal(b,u,e,u.s.atk*numeric(q.splashDamage,80)/100,'phys');}
  if(p?.kind==='star3_muelseye'&&u.skill?.active){for(const clone of b.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===u&&x.alive&&x.deployed).slice(0,numeric(q.maxFluidForms,3))){const e=closestEnemy(b,clone);if(e){deal(b,clone,e,u.s.atk*.3,'phys');metric(b,'triggers.signature_muelseye_clone_attack');}}}
  }
}

/** Install all resonance combat pacts, environment triggers, equipment passives and terminal signatures. */
export function installResonanceBattle(battle, { catalog, state } = {}) {
  if (catalog?.config?.rulesVersion === 3) {
    catalog = { ...catalog, pacts: Object.fromEntries(Object.entries(catalog.pacts ?? {}).filter(([, pact]) =>
      (pact.levels ?? []).some((level) => (level.effects ?? []).some((effect) => effect.kind !== 'prototype_trait')))) };
  }
  const content = contentOf(catalog);
  const ctx = { content, state, bySource: operatorIndex(content), floorCooldown: new Map(), frozenSeen: new Map(), skillCount: new Map(), attackCount: new Map(), pactCache: null };
  ctx.strategies=(state?.strategies??[]).filter(s=>!state?.strategyState?.[s?.id]?.fallbackApplied).map(s=>{const row=content.strategies?.[s?.id];return row?{...row,targets:s.targets??row.targets}:s;}).filter(Boolean);
  const metrics = battle.resonanceMetrics = { damage: 0, healing: 0, ammoSpent: 0, skills: 0, control: 0, constructAttacks: 0, eliteKills: 0, triggers: Object.create(null) };
  battle.resonanceResults = { growth: [], coins: [], forge: [] };
  if(battle.recordEvents)battle.resonanceDynamicFloors??=[];else battle.resonanceDynamicFloors=null;
  battle.resonanceMetric=(key,n=1)=>metric(battle,key,n);
  battle.resonanceAddFloor=(id,kind,owner,tiles,until)=>setDynamicFloor(battle,id,kind,owner,tiles,until);
  battle.opts.phalanxKeepGuard = false;
  installResonanceEquipment(battle,{catalog,state});
  applyPieceGrowth(battle,state);
  const pactActive=installResonancePacts(battle,{catalog,state});
  const initial = activeSpecialPacts(battle, ctx);
  battle.resonancePactCache=pactActive;
  ctx.pactCache = initial;
  applyPactStats(battle, initial);
  const yela = initial.get('yela');
  const flags = state?.rulesVersion===2 ? null : content.environments?.[state?.environmentId] ?? state?.environment ?? state?.field?.environment ?? state?.env ?? null;
  if (yela || flags?.rule?.kind==='environment_snow') battle.resonanceFloors = fieldTiles(battle);
  if(flags?.rule?.kind==='environment_leak_reduction')battle.on('beforeEnemyLeak',(event)=>{if(ctx.environmentFirstLeak)return;ctx.environmentFirstLeak=true;const raw=Number(event.loss);if(Number.isFinite(raw)&&raw>=0)event.loss=Math.floor(raw/2);},{owner:battle});
  applyPersonalPassives(battle, ctx);
  installEvents(battle, ctx, initial, flags);
  if (!battle._resonanceTickInstalled) {
    battle._resonanceTickInstalled = true;
    battle.every(0.25, () => tickResonance(battle, ctx, initial, flags), { owner: battle });
  }
  return { metrics, growth: battle.resonanceResults.growth };
}

function installEvents(b, ctx, active, env) {
  const pact = (id) => active.get(id);
  const strategy = (kind) => ctx.strategies.flatMap(s=>s.effects??[]).find(e=>e.kind===kind)?.params??null;
  b.on('hit', (c) => {
    if (!c?.source || !c?.target) return;
    if(c.source.side==='ally'&&c.target.side==='enemy'){
      const lemuen=personalPassives(c.source,ctx).find(x=>x.kind==='star3_lemuen'),tags=c.dmg?.tags??[];
      if(lemuen&&tags.includes('skill')&&tags.includes('bombard')&&b.time-(c.source.mem.signatureLemuenAt??-Infinity)>=.25){
        c.source.mem.signatureLemuenAt=b.time;const q=lemuen.params??{},extra=inRadius(b,c.target.x,c.target.y,1,true).filter(e=>e!==c.target).sort((a,z)=>Math.hypot(a.x-c.target.x,a.y-c.target.y)-Math.hypot(z.x-c.target.x,z.y-c.target.y)||a.id-z.id).slice(0,numeric(q.chargedExtraTargets,1));
        for(const e of extra)deal(b,c.source,e,numeric(c.dmg.amount,0)*numeric(q.splashDamage,80)/100,c.dmg.type??'phys');
        if(extra.length)metric(b,'triggers.signature_lemuen_splash',extra.length);
      }
    }
    const pair=strategy('pair_guard');if(pair&&c.source.side==='enemy'&&c.target.side==='ally'&&!(c.dmg?.tags??[]).includes('resonancePairShare')){const members=selectedPairMembers(ctx,b,pair);if(members.includes(c.target)){const other=members.find(x=>x!==c.target);if(other?.alive&&c.target.alive){const raw=numeric(c.dmg.amount,0);c.dmg.amount=raw*(1-numeric(pair.share,20)/100);c.target.mem.resonancePairPending={other,amount:raw*numeric(pair.share,20)/100,type:c.dmg.type};}}}
    if(c.source.side!=='ally'||c.target.side!=='enemy')return;
    const p = pact('holyGun');
    if (p && (c.dmg?.tags ?? []).includes('ammoSkill') && c.target.findBuff('resonance:ammoVulnerability')) {
      const saint=[...p.members.values()].flat().find(u=>/新约能天使/.test(pieceOperator(u,ctx)?.name??''));
      const bonus=numeric(personalPassives(saint,ctx).find(x=>x.kind==='star3_holyGun')?.params?.ammoSkillVulnerability,50);
      c.dmg.mul = (c.dmg.mul ?? 1) * (1+bonus/100);
    }
    const op = pieceOperator(c.source, ctx);
    const breaker=personalPassives(c.source,ctx).find(x=>x.kind==='star3_breaker');if (breaker && c.target.hpRatio < numeric(breaker.params?.hpBelow,35)/100) c.dmg.mul = (c.dmg.mul ?? 1) * (1+numeric(breaker.params?.damage,20)/100);
    const execute=strategy('executeBonus');if(execute&&c.target.hpRatio<numeric(execute.hpBelow,20)/100){const boss=/LEADER|BOSS/i.test(String(c.target.def?.rank??''));c.dmg.mul=(c.dmg.mul??1)*(1+numeric(boss?execute.boss:execute.regular,0)/100);}
    if(env?.rule?.kind==='environment_elite_hit'&&c.dmg?.isAttack&&/ELITE|BOSS/i.test(String(c.target.def?.rank??''))){
      c.target.mem.environmentHitCount=(c.target.mem.environmentHitCount??0)+1;
      if(c.target.mem.environmentHitCount%numeric(env.rule.params?.every,3)===0){const strongest=b.allyUnits.filter(x=>x.kind==='op'&&x.alive&&x.deployed).sort((a,z)=>z.s.atk-a.s.atk||a.id-z.id)[0];if(strongest)b.dealDamage(strongest,c.target,{amount:strongest.s.atk*numeric(env.rule.params?.damage,50)/100,type:'phys',canDodge:false,tags:['resonance','environment']});}
    }
  }, { owner: b });
  b.on('attack', (c) => {
    const u = c?.attacker;
    if (!u || u.side !== 'ally' || (u.kind !== 'op'&&u.kind!=='token')) return;
    if(u.kind==='token'){
      if(u.ownerUnit){metric(b,'constructAttacks');const owner=u.ownerUnit,passive=personalPassives(owner,ctx).find(x=>x.kind==='star3_vina');
        if(passive&&/vlion/.test(String(u.defId))){const q=passive.params??{},swords=b.allyUnits.filter(t=>t.kind==='token'&&t.ownerUnit===owner&&/vlion/.test(String(t.defId))&&t.alive&&t.deployed).sort((a,z)=>a.id-z.id).slice(0,numeric(q.maxSwords,4));if(swords.includes(u))for(const target of c.targets??[])if(target?.side==='enemy'&&target.alive){deal(b,owner,target,owner.s.atk*numeric(q.swordTrueDamage,600)/100,'true',['star3','vinaSword']);metric(b,'triggers.signature_vina_sword');}}
      }
      return;
    }
    const op = pieceOperator(u, ctx); if (!op) return;
    const tags = pactIds(u, op);
    const target = c.targets?.filter((t) => t?.side === 'enemy').sort((a,z) => Math.hypot(a.x-u.x,a.y-u.y)-Math.hypot(z.x-u.x,z.y-u.y) || a.id-z.id)[0];
    if (target) {
      metric(b, 'attacks', 1);
      if (pact('holyGun') && tags.has('laterano')) holyGunAttack(b, ctx, u, target, active);
      applyStar3Attack(b, ctx, u, target);
    const yelaStar=personalPassives(u,ctx).find(x=>x.kind==='star3_yela');
      if (yelaStar && u.skill?.active && (c.targets?.filter(t=>t?.side==='enemy'&&t.alive).length??0) === 1) {
        for(let i=0;i<numeric(yelaStar.params?.singleTargetExtraHits,2);i++)deal(b,u,target,u.s.atk*numeric(yelaStar.params?.hitDamage,500)/100,'arts');
        b.applyStatus(target,'palsy',{value:numeric(yelaStar.params?.paralysisStacks,1),source:u});
        metric(b,'triggers.signature_yela_single_target');
      }
    }
  }, { owner: b });
  b.on('skillStart', (c) => {
    const u = c?.unit; if (!u || u.side !== 'ally' || u.kind !== 'op') return;
    metric(b, 'skills');
    const op = pieceOperator(u, ctx); if (!op) return;
    if(env?.rule?.kind==='environment_skill_refund'&&(ctx.envCasts??0)<numeric(env.rule.params?.firstCasts,2)){ctx.envCasts=(ctx.envCasts??0)+1;for(const a of b.allyUnits)if(a.kind==='op'&&a.alive&&a.skill)a.skill.gainSp?.(numeric(env.rule.params?.sp,1),'resonanceEnvironment');}
    if(env?.rule?.kind==='environment_ammo'&&u.skill?.kind==='ammo'&&!u.mem.environmentAmmoAdded){u.mem.environmentAmmoAdded=true;u.skill.ammoLeft+=numeric(env.rule.params?.firstSkillAmmo,2);u.skill.ammoMax=u.skill.ammoLeft;}
    for(const passive of personalPassives(u,ctx)){
      if(passive.kind==='star3_ammo'&&u.skill?.kind==='ammo'&&!u.mem.star3AmmoUsed){u.mem.star3AmmoUsed=true;const bonus=numeric(passive.params?.firstSkillExtraAmmo,3);u.skill.ammoLeft+=bonus;u.skill.ammoMax=u.skill.ammoLeft;}
      if(passive.kind==='star3_arts'&&!u.mem.star3ArtsUsed){u.mem.star3ArtsUsed=true;const e=closestEnemy(b,u,8);if(e)deal(b,u,e,u.s.atk*numeric(passive.params?.firstSkillDamage,100)/100,'arts');}
    }
    applySignatureSkill(b, ctx, u, op);
  }, { owner: b });
  b.on('ammoUsed', (c) => {
    const u = c?.unit; if (!u || u.side !== 'ally') return;
    metric(b, 'ammoSpent');
    b.resonanceMetrics.totalAmmoSpent=(b.resonanceMetrics.totalAmmoSpent??0)+1;
    u.mem.resonanceAmmoSpent=(u.mem.resonanceAmmoSpent??0)+1;
    const op = pieceOperator(u, ctx); if (!op) return;
    const executor=personalPassives(u,ctx).find(x=>x.kind==='star3_executor');if(executor&&u.skill?.kind==='ammo'&&u.skill.ammoLeft===0&&!u.mem.star3ExecutorRefund){u.mem.star3ExecutorRefund=true;u.skill.ammoLeft=u.skill.ammoMax;metric(b,'triggers.signature_executor_refund');}
    const last=strategy('lastAmmo'),lastTarget=c.targets?.find(t=>t?.side==='enemy'&&t.alive);if(last&&u.skill?.kind==='ammo'&&c.left===0){const sp=numeric(last.sp,3);if(sp>0)u.mem.resonanceLastAmmoSp=(u.mem.resonanceLastAmmoSp??0)+sp;deal(b,u,lastTarget,u.s.atk*numeric(last.damage,150)/100,'phys',['strategy']);}
  }, { owner: b });
  b.on('skillEnd',(c)=>{const u=c?.unit,sp=Number(u?.mem?.resonanceLastAmmoSp??0);if(u&&sp>0){u.mem.resonanceLastAmmoSp=0;u.skill?.gainSp?.(sp,'resonanceLastAmmo');}},{owner:b});
  b.on('damaged', (c) => {
    const src = c?.source, target = c?.target, dmg = c?.dmg;
    const pairPending=target?.mem?.resonancePairPending;if(pairPending&&src?.side==='enemy'&&!(dmg?.tags??[]).includes('resonancePairShare')){target.mem.resonancePairPending=null;if(pairPending.other?.alive)b.dealDamage(src,pairPending.other,{amount:pairPending.amount,type:pairPending.type,canDodge:false,isAttack:false,tags:['resonance','resonancePairShare']});}
    if (src?.side === 'ally' && target?.side === 'enemy' && c.amount > 0) {
      metric(b, 'damage', c.dealt ?? c.amount);
      if ((dmg?.tags ?? []).includes('resonance')) return;
    } else if (src?.side === 'enemy' && target?.side === 'ally' && dmg?.isAttack) {
      const op = pieceOperator(target, ctx);
      const ulpius=personalPassives(target,ctx).find(x=>x.kind==='star3_ulpius');if(op&&ulpius&&target.alive){const q=ulpius.params??{},mult=numeric(q.starThreeMultiplier,2),used=target.mem.star3UlpiusGrowth??0,cap=numeric(q.battleGrowthCap,20);if(used<cap){const hp=numeric(q.hitGrowthHp,50)*mult,atk=numeric(q.hitGrowthAtk,5)*mult;target.mem.star3UlpiusGrowth=used+1;b.addBuff(target,{key:`resonance:ulpius:${target.id}:${used}`,persist:true,allowDead:true,mods:{hpFlat:hp,atkFlat:atk},tags:['resonance','star3']});addGrowthResult(b,ctx.state,target,'ulpius:hp',hp,undefined,'ulpius');addGrowthResult(b,ctx.state,target,'ulpius:atk',atk,undefined,'ulpius');metric(b,'triggers.signature_ulpius_hit_growth');}}
      if (op && pactIds(target, op).has('aegir') && !(dmg?.tags ?? []).includes('resonance')) aegirRetaliate(b, ctx, target, src, active);
      if(env?.rule?.kind==='aegir_first_hit_growth'){
        const q=env.rule.params??{},n=target.mem.environmentAegirStacks??0;
        if(n<numeric(q.maxStacks,5)){target.mem.environmentAegirStacks=n+1;b.addBuff(target,{key:`resonance:environment:aegir:${target.id}:${n}`,persist:true,allowDead:true,mods:{hpPct:numeric(q.maxHp,5)/100},tags:['resonance','environment']});}
      }
      if(env?.rule?.kind==='environment_lowest_heal'&&!ctx.envLowestHealed){ctx.envLowestHealed=true;const a=b.allyUnits.filter(x=>x.kind==='op'&&x.alive&&x.deployed).sort((x,y)=>x.hpRatio-y.hpRatio||x.id-y.id)[0];if(a)b.heal(null,a,a.s.maxHp*numeric(env.rule.params?.heal,25)/100,{tags:['resonance','environment']});}
    }
  }, { owner: b });
  b.on('healed', (c) => { if (c?.target?.side === 'ally' && c.amount > 0) { metric(b, 'healing', c.amount); const owner=c.target;if(owner.kind==='op'){const sig=personalPassives(owner,ctx).find(x=>x.kind==='star3_muelseye');if(sig){const pct=numeric(sig.params?.sharedHealing,30)/100;for(const clone of b.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===owner&&x.alive&&x.deployed).slice(0,numeric(sig.params?.maxFluidForms,3))){if(b.heal(owner,clone,c.amount*pct)>0)metric(b,'triggers.signature_muelseye_shared_heal');}}}} }, { owner: b });
  b.on('elementBurst',(c)=>{const source=c?.source,target=c?.target;if(!source||source.side!=='ally'||!target||c.element!=='apoptosis')return;const sig=personalPassives(source,ctx).find(x=>x.kind==='star3_lingering');if(!sig)return;metric(b,'triggers.signature_lingering_burst');const q=sig.params??{};if(!source.mem.star3NecrosisUsed){source.mem.star3NecrosisUsed=true;source.skill?.gainSp?.(numeric(sig.additionalEffect?.params?.firstElementBurstSp,10),'resonanceStar3Necrosis');}const targets=enemies(b).filter(e=>e!==target&&b.time>=(e.mem.star3NecrosisAt??0)).sort((a,z)=>Math.hypot(a.x-target.x,a.y-target.y)-Math.hypot(z.x-target.x,z.y-target.y)||a.id-z.id).slice(0,numeric(q.spreadTargets,3));for(const e of targets){e.mem.star3NecrosisAt=b.time+numeric(q.targetCooldown,2);b.dealDamage(source,e,{amount:source.s.atk*numeric(q.necrosis,200)/100,type:'element',element:'apoptosis',canDodge:false,tags:['resonance','star3','necrosis']});}},{owner:b});
  b.on('statusApplied', (c) => {
    if (!c?.target || c.target.side !== 'enemy' || !['cold','freeze','stun','bind','sleep','levitate','sluggish'].includes(c.status)) return;
    const source = c.source;
    if (!source || source.side !== 'ally') return;
    metric(b, 'control');
    const splash=strategy('firstFreezeSplash');if(splash&&c.status==='freeze'&&!ctx.strategyFrozen?.has(c.target.id)){ctx.strategyFrozen??=new Set();ctx.strategyFrozen.add(c.target.id);for(const e of enemies(b))if(e!==c.target&&Math.hypot(e.x-c.target.x,e.y-c.target.y)<=1)b.dealDamage(source,e,{amount:source.s.atk*numeric(splash.damage,80)/100,type:'arts',canDodge:false,isAttack:false,tags:['resonance','strategy']});}
    const op = pieceOperator(source, ctx); if (!op) return;
    const lappland=personalPassives(source,ctx).find(x=>x.kind==='star3_lappland');
    if(lappland&&c.status==='freeze'){
      b.removeStatus(c.target,'freeze');
      b.applyStatus(c.target,'silence',{duration:numeric(lappland.params?.silenceDuration,1),source});
    }
    const passive=personalPassives(source,ctx).find(x=>x.kind==='star3_control');
    if(passive&&!source.mem.star3ControlUsed){source.mem.star3ControlUsed=true;source.skill?.gainSp?.(numeric(passive.params?.firstControlSp,15),'resonanceStar3Control');}
    if(env?.rule?.kind==='environment_slow_armor'&&['sluggish','cold','bind'].includes(c.status))b.addBuff(c.target,{key:'resonance:environment:slowArmor',duration:numeric(c.duration,1),mods:{defPct:-numeric(env.rule.params?.defReduction,10)/100},source,tags:['resonance','environment']});
  }, { owner: b });
  b.on('kill', (c) => {
    const killer = c?.killer, victim = c?.victim;
    if (!killer || !victim || killer.side !== 'ally' || victim.side !== 'enemy') return;
    if (/ELITE|BOSS/i.test(String(victim.def?.rank ?? ''))) metric(b, 'eliteKills');
    if(env?.rule?.kind==='environment_first_harvest'&&!ctx.envHarvest){ctx.envHarvest=true;for(const a of b.allyUnits)if(a.kind==='op'&&a.alive&&a.skill)a.skill.gainSp?.(numeric(env.rule.params?.sp,5),'resonanceEnvironment');}
    if(env?.rule?.kind==='environment_elite_bounty'&&/ELITE|BOSS/i.test(String(victim.def?.rank??''))&&!ctx.envBounty){ctx.envBounty=true;const amount=numeric(env.rule.params?.firstKillGold,2);metric(b,'environmentGold',amount);b.resonanceResults.coins.push({amount,reason:'environment_elite_bounty'});}
  }, { owner: b });
  b.on('battleStart', () => {
    applyStandUnited(b,ctx);
    if(env?.rule?.kind==='environment_opening_sp'){const q=env.rule.params??{};for(const u of b.allyUnits)if(u.kind==='op')b.addBuff(u,{key:'resonance:environment:openingSp',duration:numeric(q.duration,10),mods:{spRecoveryFlat:numeric(q.perSecond,.3)},tags:['resonance','environment']});}
    if(env?.rule?.kind==='environment_deploy_stealth'&&!ctx.envFirstDeploy){const first=b.allyUnits.find(u=>u.kind==='op'&&u.alive&&u.deployed);if(first){ctx.envFirstDeploy=true;b.applyStatus(first,'stealth',{duration:numeric(env.rule.params?.seconds,2),source:first});}}
    if(env?.rule?.kind==='environment_front_barrier')for(const u of b.allyUnits)if(u.kind==='op'&&u.def?.position==='MELEE')b.addBuff(u,{key:'resonance:environment:frontBarrier',shield:u.s.maxHp*numeric(env.rule.params?.hp,15)/100,duration:Infinity,tags:['resonance','environment']});
    const crossfire=strategy('crossfire');if(crossfire){const all=b.allyUnits.filter(x=>x.kind==='op'&&x.alive&&x.deployed),melee=all.filter(x=>x.def?.position==='MELEE'),ranged=all.filter(x=>x.def?.position==='RANGED');if(melee.length>=numeric(crossfire.minMelee,2)&&ranged.length>=numeric(crossfire.minRanged,2)){for(const u of [...melee,...ranged]){const rangedUnit=u.def?.position==='RANGED';b.addBuff(u,{key:'resonance:strategy:crossfire',persist:true,allowDead:true,mods:rangedUnit?{aspd:numeric(crossfire.rangedAspd,20)}:{hpPct:numeric(crossfire.meleeHp,20)/100},tags:['resonance','strategy']});}}}
    if(env?.rule?.kind==='environment_frontline_reward')ctx.environmentFrontlineEligible=new Set(b.allyUnits.filter(u=>u.kind==='op'&&pieceOperator(u,ctx)?.role==='frontline').map(u=>String(u.uid)));
    for (const u of b.allyUnits) {
      const op = pieceOperator(u, ctx); if (!op) continue;
      if (op.name === '圣聆初雪' && starOf(u, op) >= 3) {
        u.skill?.activate?.('resonanceYela', { free: true });
        u.resonanceKeepGuard=true;
        metric(b,'triggers.signature_yela_permanent_skill');
      }
      if (op.name === '凛御银灰' && starOf(u, op) >= 3) silverAshAura(b,ctx,u);
    }
  }, { owner:b });
  b.on('deploy',()=>applyStandUnited(b,ctx),{owner:b});
  b.on('fatal',(c)=>{
    const u=c?.unit;if(!u||u.side!=='ally'||u.kind!=='op')return;const op=pieceOperator(u,ctx);if(!op)return;
    const ines=personalPassives(u,ctx).find(x=>x.kind==='star3_ines');if(ines&&!u.mem.resonanceInesSave){u.mem.resonanceInesSave=true;u.mem.resonanceInesUntil=b.time+numeric(ines.params?.firstLethalRefusalSeconds,8);u.mem.resonanceInesDefReduction=numeric(ines.params?.globalEnemyDefReduction,40)/100;c.prevented=true;b.addBuff(u,{key:'resonance:inesUndying',duration:numeric(ines.params?.firstLethalRefusalSeconds,8),flags:{invulnerable:true},tags:['resonance']});metric(b,'triggers.signature_ines_fatal_save');}
    if(op.name==='史尔特尔'&&starOf(u,op)>=3&&u.mem.resonanceSurtr){c.prevented=true;u.hp=Math.max(1,u.hp);metric(b,'triggers.signature_surtr_fatal_save');}
  },{owner:b});
  b.on('retreating',({unit})=>{if(unit?.kind==='op'&&personalPassives(unit,ctx).some(x=>x.kind==='star3_surtur')){unit.mem.resonanceSurtr=false;unit.mem.resonanceSurtrUntil=0;}},{owner:b});
  b.on('deploy', (c) => {
    const u = c?.unit; if (!u || u.side !== 'ally') return;
    if(u.kind==='token'&&u.ownerUnit){const passives=personalPassives(u.ownerUnit,ctx),creation=passives.find(x=>x.kind==='star3_creation');if(creation&&!u.mem.resonanceCreationApplied&&!u.ownerUnit.mem.resonanceFirstConstructApplied){const hp=numeric(creation.params?.firstConstructHp,20),atk=numeric(creation.params?.firstConstructAtk,30);u.base.maxHp*=1+hp/100;u.base.atk*=1+atk/100;u.markDirty();u.hp=u.s.maxHp;u.mem.resonanceCreationApplied=true;u.ownerUnit.mem.resonanceFirstConstructApplied=true;}if(env?.rule?.kind==='environment_construct_shield')b.addBuff(u,{key:'resonance:environment:constructShield',shield:u.s.maxHp*numeric(env.rule.params?.hp,20)/100,duration:Infinity,tags:['resonance','environment']});return;}
    if(u.kind!=='op')return;
    const op = pieceOperator(u, ctx); if (!op) return;
    if(env?.rule?.kind==='environment_deploy_stealth'&&!ctx.envFirstDeploy){ctx.envFirstDeploy=true;b.applyStatus(u,'stealth',{duration:numeric(env.rule.params?.seconds,2),source:u});}
  }, { owner: b });
  b.on('death', (c) => {
    const u = c?.unit; if (!u || u.side !== 'ally') return;
    if(env?.rule?.kind==='environment_first_death_sp'&&!ctx.envFirstDeath){ctx.envFirstDeath=true;for(const a of b.allyUnits)if(a.kind==='op'&&a.alive&&a.skill)a.skill.gainSp?.(numeric(env.rule.params?.sp,2),'resonanceEnvironment');}
    if(u.kind!=='token')return;
    const owner=u.ownerUnit,ling=owner&&personalPassives(owner,ctx).find(x=>x.kind==='star3_ling');
    if(ling&&u.mem.resonanceLingAdvanced&&u.mem.resonanceLingDragon&&u.removeReason==='killed'&&!owner.mem.star3LingRebuilt){
      owner.mem.star3LingRebuilt=true;const tokenId=u.defId,returnR=u.tileR,returnC=u.tileC,stats={maxHp:u.base.maxHp,atk:u.base.atk,def:u.base.def,res:u.base.res,bat:u.base.bat,blockCnt:u.base.blockCnt};
      b.after(.05,()=>{if(!owner.alive||!owner.deployed||!b.grid.canStand(returnR,returnC)||b.unitAt(returnR,returnC)||b.downOn(returnR,returnC))return;owner.mem.resonanceLingFreeRebuild=true;const dragon=b.spawnToken(owner,tokenId,returnR,returnC,{duration:Infinity,anySource:true,stats});if(dragon){dragon.mem.resonanceLingAdvanced=true;dragon.mem.resonanceLingDragon=true;dragon.form='resonance_ling_advanced';dragon.profile.dmgType='arts';dragon.markDirty();dragon.hp=dragon.s.maxHp;}else owner.mem.resonanceLingFreeRebuild=false;},{owner});
    }
    const rebuild=strategy('firstConstructRebuild');if(u.kind==='token'&&u.ownerUnit&&rebuild&&!ctx.strategyRebuilt&&u.removeReason==='killed'){ctx.strategyRebuilt=true;const owner=u.ownerUnit,r=u.tileR,c0=u.tileC,tokenId=u.defId;b.after(.05,()=>{if(owner.alive&&b.grid.canStand(r,c0)&&!b.unitAt(r,c0)&&!b.downOn(r,c0))b.spawnToken(owner,tokenId,r,c0,{duration:Infinity});},{owner});}
  }, { owner: b });
  b.on('battleEnd',({result})=>{
    if(env?.rule?.kind==='environment_frontline_reward'){
      const q=env.rule.params??{},eligible=ctx.environmentFrontlineEligible??new Set();
      const front=b.allyUnits.filter(u=>u.kind==='op'&&u.alive&&eligible.has(String(u.uid)));
      if(eligible.size>=numeric(q.minFront,2))for(const u of front)addGrowthResult(b,ctx.state,u,'environment_ursus:hp',numeric(q.hp,5),Infinity,'environment_ursus');
    }
  },{owner:b});
}

function aegirRetaliate(b, ctx, unit, enemy, active) {
  if (!unit?.alive || !unit.deployed || !enemy?.alive || !active.has('aegir')) return;
  const tier = active.get('aegir'); const rank = tier.members.size;
  const p = active.get('aegir').effects.find(e=>e.kind==='aegir_cycle')?.params ?? {};
  const hpScale = numeric(p.retaliation, 2.5) / 100;
  const cd = numeric(p.cd,2);
  if (b.time + 1e-9 < (unit.mem.aegirNext ?? 0)) return;
  unit.mem.aegirNext = b.time + cd;
  for (const e of inRadius(b,unit.x,unit.y,numeric(p.retaliationRadius,1.5),true)) deal(b,unit,e,unit.s.maxHp*hpScale,p.damageType??'arts');
  metric(b,'triggers.aegir');
}
function holyGunAttack(b, ctx, attacker, target, active) {
  const p = active.get('holyGun'); if (!p) return;
  const members = [...p.members.values()].flat();
  const saint = members.find((u) => /新约能天使/.test(pieceOperator(u,ctx)?.name ?? ''));
  if (!saint || !saint.alive || b.time < (attacker.mem.holyGunAt ?? 0)) return;
  const star = starOf(saint,pieceOperator(saint,ctx));
  const data = p.effects.find(e=>e.kind==='holy_gun')?.params ?? {};
  const cooldown=numeric(data.actionCooldown,.4);attacker.mem.holyGunAt=b.time+cooldown;
  const profile=profileParams({params:data},star);
  const odds = numeric(profile.chance,numeric(data.airstrikeChance,15))/100;
  if (b.rng() >= odds) return;
  const cap = numeric(profile.cap,100);
  const spent = Math.min(b.resonanceMetrics.totalAmmoSpent ?? 0, cap);
  const factor = numeric(profile.factor,numeric(data.ammoScale,.005));
  const scale = numeric(profile.damage,numeric(data.airstrike,60))/100 * (1 + spent * factor);
  const radius = numeric(profile.radius,1.5);
  const struck = inRadius(b,target.x,target.y,radius,true);
  for (const e of struck) {
    deal(b,saint,e,saint.s.atk*scale,'phys',['lateranoAirstrike']);
    if (star >= 3) b.addBuff(e,{key:'resonance:ammoVulnerability',duration:Infinity,mods:{},tags:['resonance']});
  }
  metric(b,'triggers.holyGun');
}
function tickResonance(b,ctx,active,env){
  const p=active.get('yela');if(p)yelaTick(b,ctx,p);
  for(const u of b.allyUnits.filter(x=>x.kind==='op'&&x.alive&&x.deployed)){
    const op=pieceOperator(u,ctx);if(!op)continue;
    const sig=personalPassives(u,ctx).find(x=>['star3_crown','star3_surtur','star3_zhuhuang','star3_ines'].includes(x.kind));
    if(sig?.kind==='star3_crown'&&u.skill?.active){const q=sig.params??{};for(const ally of b.allyUnits)if(ally.kind==='op'&&ally.alive&&ally.skill)ally.skill.gainSp?.(numeric(q.teamSpPerSecond,2)*.25,'resonanceStar3Crown');u.mem.star3CrownElapsed=(u.mem.star3CrownElapsed??0)+.25;const each=numeric(q.comboEverySeconds,3);if(u.mem.star3CrownElapsed+1e-9>=each){u.mem.star3CrownElapsed-=each;const targets=enemies(b);for(const e of targets)deal(b,u,e,u.s.atk*numeric(q.comboDamage,300)/100,'arts');if(targets.length)metric(b,'triggers.signature_crown_combo',targets.length);}}
    if(sig?.kind==='star3_surtur'&&u.mem.resonanceSurtr){const q=sig.params??{};u.hp=Math.max(1,u.hp-u.s.maxHp*numeric(q.selfDamagePerSecondMaxHp,10)/100*.25);}
  }
  for(const owner of b.allyUnits.filter(x=>x.kind==='op'&&x.mem.resonanceInesUntil>b.time))for(const e of enemies(b))b.addBuff(e,{key:`resonance:inesArmor:${owner.id}`,duration:.3,mods:{defPct:-owner.mem.resonanceInesDefReduction},tags:['resonance']});
  for(const [id,a] of ctx.nearlSunAreas??[]){if(!a.unit.alive||b.time>=a.until){ctx.nearlSunAreas.delete(id);continue;}if(b.time+1e-9>=a.nextDamage){a.nextDamage=b.time+1;const struck=inRadius(b,a.x,a.y,a.radius,true);for(const e of struck)deal(b,a.unit,e,a.unit.s.atk*a.damage,'true');if(struck.length)metric(b,'triggers.signature_nearl_sun',struck.length);}}
  for(const [id,w] of ctx.huangWalls??[]){if(!w.unit.alive||!w.unit.skill?.active||b.time>=w.until){ctx.huangWalls.delete(id);continue;}if(b.time+1e-9>=w.next){w.next=b.time+1;for(const e of enemies(b))if(w.tiles.some(([r,c])=>e.tileR===r&&e.tileC===c)){b.dealDamage(w.unit,e,{amount:w.unit.s.atk*w.damage,type:'arts',canDodge:false,tags:['resonance','signature','star3','zhuhuangWall']});metric(b,'triggers.signature_zhuhuang_wall');if(w.burn&&w.burnPercent>0)b.dealDamage(w.unit,e,{amount:w.unit.s.atk*w.burnPercent/100,type:'element',element:'burn',tags:['resonance','signature','burn'],canDodge:false});}}}
  for(const u of b.allyUnits.filter(x=>x.kind==='op'&&x.alive&&x.deployed&&x.mem.resonanceSurtr))if(u.mem.resonanceSurtrUntil&&b.time>=u.mem.resonanceSurtrUntil){u.mem.resonanceSurtr=false;u.mem.resonanceSurtrUntil=0;}
  for(const [id,a] of ctx.leithaniaAreas??[]){if(!a.unit.alive||b.time>=a.until){ctx.leithaniaAreas.delete(id);continue;}if(b.time+1e-9>=a.nextDamage){a.nextDamage=b.time+1;for(const e of inRadius(b,a.target.x,a.target.y,1.5,true))deal(b,a.unit,e,a.unit.s.atk*a.damage,'arts');}if(a.silence&&b.time+1e-9>=a.nextSilence){a.nextSilence=b.time+a.silenceEvery;for(const e of inRadius(b,a.target.x,a.target.y,1.5,true))b.applyStatus(e,'silence',{duration:a.silenceDuration,source:a.unit});}}
  for(const [id,a] of ctx.kazSunAreas??[]){if(!a.unit.alive||b.time>=a.until){ctx.kazSunAreas.delete(id);continue;}if(b.time+1e-9>=a.nextDamage){a.nextDamage=b.time+.5;for(const e of inRadius(b,a.target.x,a.target.y,a.radius,true))deal(b,a.unit,e,a.unit.s.atk*a.damage,'true');}}
  const rule=env?.rule??{};
  if(rule.kind==='environment_snow'){
    const cooldown=numeric(rule.params?.tileCooldown,4),duration=numeric(rule.params?.coldDuration,1);
    for(const [r,c] of b.resonanceFloors??[]){const key=`environment:${r},${c}`,until=ctx.floorCooldown.get(key)??0;if(b.time+1e-9<until)continue;const occupants=enemies(b).filter(e=>e.tileR===r&&e.tileC===c);if(!occupants.length)continue;ctx.floorCooldown.set(key,b.time+cooldown);for(const e of occupants)b.applyStatus(e,'cold',{duration,source:null});}
  }
  if(rule.kind==='environment_random_cold'&&Math.floor(b.time/numeric(rule.params?.everySeconds,20))>=(ctx.envColdMark??0)+1){ctx.envColdMark=Math.floor(b.time/numeric(rule.params?.everySeconds,20));const tiles=fieldTiles(b);if(tiles.length){const n=b.rng.int?.(0,tiles.length-1)??Math.floor(b.rng()*tiles.length);const [r,c]=tiles[n];for(const e of enemies(b))if(e.tileR===r&&e.tileC===c)b.applyStatus(e,'cold',{duration:numeric(rule.params?.duration,1),source:null});}}
  if(Array.isArray(b.resonanceDynamicFloors))for(const f of b.resonanceDynamicFloors)if(f.until<=b.time){const i=b.resonanceDynamicFloors.indexOf(f);if(i>=0)b.resonanceDynamicFloors.splice(i,1);}
}
function yelaTick(b,ctx,p){
  const cold=enemies(b).filter(e=>e.s.flags.cold||e.s.flags.freeze);
  for(const xs of p.members.values())for(const u of xs){
    const op=pieceOperator(u,ctx),star=starOf(u,op);
    const profile=personalPassives(u,ctx).find(x=>x.kind==='star3_yela')?.params??{};
    const yelaRaw=p.effects.find(e=>e.kind==='yela_breath')?.params??{};const yela=profileParams({params:yelaRaw},star);
    if(!u.skill?.active){u.skill?.gainSp?.(cold.length*numeric(yela.perColdSp,.2)*.25,'resonanceYela');}
    if(u.skill?.active){b.addBuff(u,{key:'resonance:yelaActive',duration:.3,mods:{atkPct:numeric(profile.perColdAttack,numeric(yela.skillAtk,10))/100*cold.length,aspd:numeric(profile.perColdAspd,numeric(yela.skillAspd,10))*cold.length},tags:['resonance']});}
  }
  const floorTiles=b.resonanceFloors??[];
  for(const [r,c] of floorTiles){
    const key=`${r},${c}`,until=ctx.floorCooldown.get(key)??0;
    if(b.time+1e-9<until)continue;
    const owner=[...p.members.values()].flat().sort((a,z)=>a.id-z.id)[0];
    const ownerOp=owner&&pieceOperator(owner,ctx),ownerStar=ownerOp&&starOf(owner,ownerOp);
    const profile=owner?personalPassives(owner,ctx).find(x=>x.kind==='star3_yela')?.params??{}:{};
    const yelaRaw=p.effects.find(e=>e.kind==='yela_breath')?.params??{};const yela=profileParams({params:yelaRaw},ownerStar);
    const cd=numeric(profile.tileCooldown,numeric(yela.tileCooldown,3));
    const duration=numeric(profile.coldDuration,numeric(yela.coldDuration,1.5));
    const occupants=enemies(b).filter(e=>e.tileR===r&&e.tileC===c);if(!occupants.length)continue;
    ctx.floorCooldown.set(key,b.time+cd);
    if(owner)for(const e of occupants)b.applyStatus(e,'cold',{duration,source:owner});
  }
}
function holyGunRandomBombs(b,ctx,u,star){
  const effect=ctx.content.pacts?.holyGun?.levels?.[0]?.effects?.find(e=>e.kind==='holy_gun');const profile=profileParams(effect,star),tiles=fieldTiles(b),count=numeric(profile.skillBombs,numeric(effect?.params?.bombCount,15));
  for(let i=0;i<count;i++){if(!tiles.length)break;const k=Math.floor(b.rng()*tiles.length);const [r,c]=tiles[k];for(const e of inRadius(b,c,r,numeric(profile.radius,1.5),true))deal(b,u,e,u.s.atk*numeric(profile.damage,60)/100,'phys',['lateranoAirstrike']);}
}
function findFreeTile(b,r,c){for(let d=1;d<=3;d++)for(let y=r-d;y<=r+d;y++)for(let x=c-d;x<=c+d;x++)if(Math.max(Math.abs(y-r),Math.abs(x-c))===d&&b.grid.canStand(y,x)&&!b._occ[b.grid.key(y,x)])return[y,x];return[null,null];}
