import { SOURCE_DEDUP_SECONDS } from '../../../../shared/assault/adaptation.js';
import { active, buff, uid } from './primitives.js';
import { registerAssaultAmmo, assaultAmmoState, consumeAssaultAmmo, reloadAssaultAmmo, setAssaultAmmoCapacityBonus } from './ammo.js';
import { mitigate } from '../../damage.js';

/** Evidence for an already-applied native talent. This never grants a reward,
 * runs an extra callback, or counts a periodic aura refresh as a new benefit. */
export function recordLinkEffect(battle,source,key,target,applied=true){
  if(!applied||!active(source))return false;
  const records=source.mem.assaultLinkEvidence??={},last=records[key]??-Infinity;
  if(battle.time+1e-9<last+SOURCE_DEDUP_SECONDS)return false;
  records[key]=battle.time;
  battle.assaultRuntime.publish('triggerResolved',{source,sourceUid:uid(source),key:`native-link:${key}`,target,targetUid:uid(target),amount:1});
  return true;
}

/** Each source owns one counter. Count all qualifying events; earned rewards
 * drain in order at 0.1 s intervals. A regular (every=1) proc deduplicates events
 * inside the interval. first limits rewards per battle, never an elapsed window. */
export function countedTrigger(battle, { key, owner = null, every = 1, first = null, available = () => !owner || active(owner) }, effect) {
  if (typeof key !== 'string' || !key || typeof effect !== 'function' || !Number.isInteger(every) || every < 1
    || (first != null && (!Number.isInteger(first) || first < 1))) throw new TypeError('invalid counted trigger');
  const record = { key, sourceUid: owner ? uid(owner) : null, every, first, counted: 0, rewards: 0, emitted: 0, deduplicated: 0, remainder: 0, pending: 0 };
  const records = battle.assaultRuntime.diagnostics.counters ??= {};
  if (records[key]) throw new TypeError(`duplicate counted trigger source ${key}`);
  records[key] = record;
  const queue = [];
  let last = -Infinity, scheduled = false;
  const drain = () => {
    scheduled = false;
    if (!queue.length) return;
    if (!available()) { queue.length = 0; record.pending = 0; return; }
    const wait = last + SOURCE_DEDUP_SECONDS - battle.time;
    if (wait > 1e-9) { scheduled = true; battle.after(wait, drain); return; }
    const context = queue.shift(); record.pending = queue.length; last = battle.time;
    battle.assaultRuntime.enqueue(() => {
      if (!available()) return;
      record.emitted++;
      const applied = effect(context);
      if (applied !== false && applied !== 0) battle.assaultRuntime.publish('triggerResolved', { source: owner,
        sourceUid: owner ? uid(owner) : null, key, target: context?.target ?? null, amount: 1,
        ...(context?.aura===true?{aura:true}:null) });
    }, { key: `adaptation:${key}`, targetUid: owner ? uid(owner) : null, cause: context?.cause });
    if (queue.length && !scheduled) { scheduled = true; battle.after(SOURCE_DEDUP_SECONDS, drain); }
  };
  const take = (context, amount = 1) => {
    if (!available() || (first != null && record.rewards >= first)) return false;
    if (!Number.isFinite(amount) || amount <= 0) throw new TypeError('trigger count must be positive');
    record.counted += amount;
    if (every === 1 && first == null && battle.time + 1e-9 < last + SOURCE_DEDUP_SECONDS) { record.deduplicated++; return false; }
    const before = record.rewards;
    record.remainder += amount;
    while (record.remainder + 1e-9 >= every && (first == null || record.rewards < first)) {
      record.remainder = Math.max(0, record.remainder - every); record.rewards++; queue.push(context);
    }
    record.pending = queue.length;
    if (!scheduled) drain();
    return record.rewards > before;
  };
  take.record = record;
  return take;
}

// Reuse native mitigation to exclude ineffective penetration / minimum-damage
// floors. The real damaged event still decides whether the hit actually lands.
export function linkDamagePotential(source,target,dmg){
  const ts=target.s;if(dmg.type==='element'||ts.flags.hitCount||ts.flags.hitCountArts)return 0;
  const ss=dmg.sourceless?null:source?.s;
  return mitigate(dmg.amount,dmg.type,ts,{
    defIgnorePct:(dmg.defIgnorePct??0)+(ss?.defIgnorePct??0),defIgnoreFlat:(dmg.defIgnoreFlat??0)+(ss?.defIgnoreFlat??0),
    resIgnorePct:(dmg.resIgnorePct??0)+(ss?.resIgnorePct??0),resIgnoreFlat:(dmg.resIgnoreFlat??0)+(ss?.resIgnoreFlat??0),
    elementalRes:dmg.type==='elemental'?(target.def?.epDamageResistance??0):0,
  })*(dmg.mul??1);
}
export function actualDamageLink(battle,owner,key){
  const marked=new WeakMap(),take=countedTrigger(battle,{key,owner},()=>true);
  battle.on('damaged',({dmg,amount,source})=>{
    const stillApplies=marked.get(dmg);if(!(amount>0)||!stillApplies||!stillApplies())return;
    marked.delete(dmg);take({target:source,cause:battle.assaultRuntime.currentCause,aura:true});
  },{owner});
  return(dmg,stillApplies=()=>true)=>marked.set(dmg,stillApplies);
}

/** C-type status is installed once, survives in-place redeploy, and has no
 * refresh/additional payoff. Its explicit repeat action is the sole recast. */
export function battleState(battle, unit, key, { mods = {}, flags = null, enter, repeat } = {}) {
  if (!unit || typeof key !== 'string' || !key) throw new TypeError('battle state needs its owner and source');
  const states = unit.mem.assaultBattleStates ??= {};
  if (states[key]) { repeat?.({ battle, unit, state: states[key] }); return { first: false, state: states[key] }; }
  const state = states[key] = { enteredAt: battle.time, source: key };
  const entry = buff(battle, unit, unit, { key: `assault:battle-state:${key}`, mods, flags, duration: Infinity, persist: true });
  if (!entry) { delete states[key]; return { first: false, state: null }; }
  enter?.({ battle, unit, state });
  return { first: true, state };
}

/** D-type pool: one round of the original skill costs one battle cast. */
export function installCastAmmo(battle, unit, capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError('cast ammo capacity must be positive');
  if (unit.mem.assaultCastAmmo) return unit._assaultAmmoController;
  const state = unit.mem.assaultCastAmmo = { current: capacity, capacity };
  return registerAssaultAmmo(battle, unit, { get: () => state.current, set: n => { state.current = n; }, max: () => state.capacity });
}
export const hasCastAmmo = unit => (assaultAmmoState(unit)?.current ?? 0) > 0;
export const spendCastAmmo = (battle, unit, sourceKey) => consumeAssaultAmmo(battle, unit, 1, sourceKey, { isSkill: true });
export const fillCastAmmo = (battle, source, target, sourceKey) => {
  const state = assaultAmmoState(target);
  return state ? reloadAssaultAmmo(battle, source, target, state.capacity, sourceKey) : 0;
};

export function castAmmoCapacity(battle, source, target, amount, key, { loadedIncrease = true } = {}) {
  const before = assaultAmmoState(target);
  if (!before || !target.mem.assaultCastAmmo) return 0;
  const delta = setAssaultAmmoCapacityBonus(target, key, amount);
  const after = assaultAmmoState(target);
  target._assaultAmmoController.set(Math.min(after.capacity, before.current + (loadedIncrease ? Math.max(0, delta) : 0)));
  if (delta) battle.assaultRuntime.publish('ammoCapacityChanged', { source, sourceUid: uid(source), target, targetUid: uid(target),
    amount: delta, capacity: after.capacity, current: assaultAmmoState(target).current, sourceKey: key });
  return delta;
}

