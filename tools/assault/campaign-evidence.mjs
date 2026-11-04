// Test instrumentation: observes applied effects and accepted counters, without
// publishing events, granting effects, changing predicates, or advancing time.
export function installCampaignEvidence(battle,{detailed=false}={}){
 installScopedLinkEvidence(battle);
 if(detailed)installSummonDiagnostics(battle);
 const effects=new Map(),auras=new Map(),qualified=new Map();
 const owner=u=>{while(u&&u.kind!=='op')u=u.ownerUnit;return u?.side==='ally'?u:null;};
 const key=u=>owner(u)?.uid;
 const add=(map,u,target)=>{const id=key(u);if(!id)return;const set=map.get(id)??new Set();set.add(target?.uid??target?.id??'self');map.set(id,set);};
 const auraSource=u=>owner(u)?.def?.raw?.assaultBody?.adaptation?.roles?.includes('aura');
 const originalBuff=battle.addBuff;
 battle.addBuff=function(target,spec){
  const result=originalBuff.call(this,target,spec);
  if(result&&spec.source&&((spec.shield??0)>0||(spec.shieldHits??0)>0||Object.values(spec.mods??{}).some(v=>Number.isFinite(v)&&v!==0)||Object.values(spec.flags??{}).some(Boolean))){
   add(effects,spec.source,target);
   const groupAura=auraSource(spec.source)&&(String(spec.key).startsWith('assault:allyAura:')||spec.key==='adaptation:natural-sp-aura'
     ||spec.source.def?.charId==='char_491_humus'&&spec.key==='adaptation:humus:recycled');
   if(target!==spec.source||groupAura)add(auras,spec.source,target);
  }
  return result;
 };
 const originalHeal=battle.heal;
 battle.heal=function(source,target,amount,options){
  const result=originalHeal.call(this,source,target,amount,options);
  if(result>0)add(effects,source,target);
  // An active recipient of regeneration is in the aura even at full HP;
  // zero healing is never added to the production ledger.
  const nativeSelfRecipient=['char_151_myrtle','char_181_flower','char_143_ghost','char_474_glady'].includes(source?.def?.charId);
  if(auraSource(source)&&options?.regen&&amount>0&&(target!==source||nativeSelfRecipient)&&target?.alive&&target.deployed)add(auras,source,target);
  return result;
 };
 const originalStatus=battle.applyStatus;
 battle.applyStatus=function(target,status,options){
  const result=originalStatus.call(this,target,status,options);
  if(result&&auraSource(options?.source)&&target!==options.source&&['fragile','protect','resist','reveal','artsFragile'].includes(status))add(auras,options.source,target);
  return result;
 };
 const rt=battle.assaultRuntime,originalObserve=rt.observe,originalEnqueue=rt.enqueue;
 let observer=null;
 rt.observe=function(type,id,fn,options){
  return originalObserve.call(this,type,id,(...args)=>{const before=observer;observer={id,owner:options?.owner};try{return fn(...args);}finally{observer=before;}},options);
 };
 rt.enqueue=function(fn,options){
  const result=originalEnqueue.call(this,fn,options);
  if(result&&observer?.owner?.kind==='op'&&!/native-end|ledger:|module-watch/.test(observer.id)){
   const id=key(observer.owner),set=qualified.get(id)??new Set();set.add(observer.id);qualified.set(id,set);
  }
  return result;
 };
 for(const type of ['triggerResolved','summonEntered','shieldGained','chargeGranted','hasteApplied','redeployReduced'])originalObserve.call(rt,type,'campaign:evidence:'+type,({payload:p})=>{
  if((p.amount??1)>0){add(effects,p.source,p.target);if(type==='triggerResolved'&&p.target
    &&(p.aura===true&&auraSource(p.source)||String(p.key).startsWith('native-link:')&&p.target!==p.source))add(auras,p.source,p.target);}
 });
 battle.campaignEvidence=()=>({version:3,auraMeasurement:'live recipient selected by the original group aura, including its owner when eligible; individual self buffs are excluded and zero healing is not production',operators:battle.allyUnits.filter(u=>u.kind==='op').map(u=>{
  const counters=Object.values(rt.diagnostics.counters??{}).filter(c=>c.sourceUid===u.uid).map(c=>({...c}));
  return {uid:u.uid,charId:u.def.charId,stateEntered:!!u.mem.assaultBattleStates?.[u.def.raw.assaultBody.adaptation.sourceSkillId],
   states:Object.keys(u.mem.assaultBattleStates??{}),appliedTargets:[...(effects.get(u.uid)??[])],auraBeneficiaries:[...(auras.get(u.uid)??[])],
   acceptedObservers:[...(qualified.get(u.uid)??[])],linkEffects:battle.scopedLinkEvidence()[u.uid]??[],counters};
 }),...(detailed?{summons:battle.summonDiagnostics()}:null)});
}

function installSummonDiagnostics(battle){
 const rows=new Map(),charges=[];
 const unitKey=u=>String(u?.id??u?.uid);
 const front=token=>battle.allyUnits.filter(u=>u.kind==='op'&&u.ownerId===token.ownerId&&u.deployed&&u.alive&&!u.removed
   &&token.rangeKeySet?.has(u.tileR*21+u.tileC)).map(u=>({uid:u.uid,charId:u.def.charId,star:u.def.raw?.assaultPiece?.star}));
 battle.assaultRuntime.observe('summonEntered','diagnosis:summon-entry',({payload:p})=>{
  const t=p.target;if(!t||!['token','device'].includes(t.kind))return;
  rows.set(unitKey(t),{unit:t,id:t.id,tokenId:t.defId,ownerUid:t.ownerUnit?.uid,ownerCharId:t.ownerUnit?.def.charId,
   enteredAt:battle.time,entryHp:t.hp,maxHp:t.s.maxHp,row:t.tileR,col:t.tileC,dir:t.dir,
   frontAtEntry:front(t),lostHp:0,enemyDamage:0,endedAt:null,reason:null,killer:null});
 });
 battle.on('death',({unit,reason,killer})=>{const row=rows.get(unitKey(unit));if(row){row.endedAt??=battle.time;row.reason=reason;row.killer=killer?.def?.charId??killer?.defId??null;}});
 battle.on('damaged',({target,source,amount})=>{const row=rows.get(unitKey(target));if(row&&source?.side==='enemy')row.enemyDamage+=Math.max(0,amount??0);});
 const lose=battle.loseHp;
 battle.loseHp=function(unit,...args){const before=unit.hp,result=lose.call(this,unit,...args),row=rows.get(unitKey(unit));
  if(row)row.lostHp+=Math.max(0,before-unit.hp);return result;};
 battle.assaultRuntime.observe('chargeGranted','diagnosis:actual-charge',({payload:p})=>{
  const source=p.source?.ownerUnit??p.source;
  if(source?.def?.charId==='char_4072_ironmn'&&p.amount>0)charges.push({time:battle.time,sourceId:p.source?.id,sourceKey:p.sourceKey,
   ownerUid:source.uid,targetUid:p.target?.uid,targetCharId:p.target?.def?.charId,amount:p.amount});
 });
 battle.summonDiagnostics=()=>({entities:[...rows.values()].map(({unit,...r})=>({...r,lifetime:(r.endedAt??battle.time)-r.enteredAt,
   alive:unit.alive&&unit.deployed&&!unit.removed,hp:unit.hp,frontAtEnd:front(unit)})),charges});
}
// Read-only QA instrumentation. No game events or rewards are manufactured.
export function installScopedLinkEvidence(battle) {
  let scope = null;
  const applications = new Map();
  const withScope = (unit, fn) => function (...args) {
    const previous = scope; scope = unit;
    try { return fn.apply(this, args); } finally { scope = previous; }
  };
  const current = () => battle.assaultLinkInstaller ?? scope;
  const mark = (source, key, target, positive) => {
    const unit = current();
    if (!positive || !unit || unit !== source || unit.kind !== 'op') return;
    const entries = applications.get(unit.uid) ?? new Set();
    entries.add(`${key}:${target?.id ?? target?.uid ?? 'self'}`); applications.set(unit.uid, entries);
  };
  for (const method of ['on', 'every', 'after']) {
    const original = battle[method];
    battle[method] = function (name, callback, options) {
      const source = current();
      return original.call(this, name, source ? withScope(source, callback) : callback, options);
    };
  }
  const rt = battle.assaultRuntime, observe = rt.observe, enqueue = rt.enqueue;
  rt.observe = function (type, key, callback, options) {
    const source = current();
    return observe.call(this, type, key, source ? withScope(source, callback) : callback, options);
  };
  rt.enqueue = function (callback, options) {
    const source = current();
    return enqueue.call(this, source ? withScope(source, callback) : callback, options);
  };
  const addBuff = battle.addBuff;
  battle.addBuff = function (target, spec) {
    const previous = target?.findBuff(spec.key);
    const result = addBuff.call(this, target, spec);
    const changed = !previous || previous !== result;
    const useful = Object.values(spec.mods ?? {}).some(v => Number.isFinite(v) && v !== 0)
      || Object.values(spec.flags ?? {}).some(Boolean) || (spec.shield ?? 0) > 0 || (spec.shieldHits ?? 0) > 0;
    mark(spec.source ?? current(), spec.key, target, result && changed && useful);
    return result;
  };
  for (const [method, sourceIndex, targetIndex] of [['heal', 0, 1], ['dealDamage', 0, 1]]) {
    const original = battle[method];
    battle[method] = function (...args) {
      const result = original.apply(this, args); mark(args[sourceIndex], method, args[targetIndex], result > 0); return result;
    };
  }
  const status = battle.applyStatus;
  battle.applyStatus = function (target, kind, options) {
    const result = status.call(this, target, kind, options);
    mark(options?.source, 'status:' + kind, target, result); return result;
  };
  for (const type of ['chargeGranted', 'hasteApplied', 'redeployReduced', 'reloaded', 'ammoCapacityChanged']) {
    observe.call(rt, type, 'qa:link-evidence:' + type, ({ payload }) =>
      mark(payload.source, payload.sourceKey ?? type, payload.target, payload.amount > 0));
  }
  battle.scopedLinkEvidence = () => Object.fromEntries([...applications].map(([uid, keys]) => [uid, [...keys]]));
}
