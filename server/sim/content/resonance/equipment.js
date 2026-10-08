import { ADD_KEYS, MUL_KEYS } from '../../buffs.js';
import { COLS } from '../../constants.js';
import { canTargetEnemy } from '../../targeting.js';

const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const contentOf = (catalog) => catalog?.resonanceContent ?? catalog ?? {};
const SUPPORTED = new Set(['component_stat','giant_slayer','resistance_shred','fifth_strike','armor_pierce','lifesteal','hit_stack','first_cast_haste','pact_transfer','skill_damage','chain_lightning','counter_magic','spell_vulnerability','periodic_heal','cast_stack','attack_stack','death_save','evasion','splash_strike','attack_sp','thorns','block_stack','death_barrier','cast_stun','resistance_cleanse','cast_sp','regeneration','hit_sp','skill_sp','choose_identity_transfer','transfer_pact']);
const inputOf = (unit) => unit?.player?.input?.units?.find((entry) => String(entry?.uid) === String(unit.uid) && entry.kind !== 'token') ?? null;
const itemId = (item) => typeof item === 'string' ? item : item?.itemId ?? item?.id ?? null;
const gearOf = (unit) => (inputOf(unit)?.items ?? unit.items ?? []).map(itemId).filter(Boolean);
const effectList = (unit) => unit?.mem?.resonanceEquipmentEffects ?? [];
function actualItemEffects(content, unit) {
  const rows = [];
  for (const id of gearOf(unit)) {
    const item = content.equipment?.[id];
    if (!item) throw new Error(`UNKNOWN_RESONANCE_EQUIPMENT:${id}`);
    for (const effect of item.effects ?? []) {
      if (!SUPPORTED.has(effect.kind)) throw new Error(`UNKNOWN_RESONANCE_EQUIPMENT_EFFECT:${id}:${effect.kind}`);
      rows.push({ ...effect, itemId: id, itemKind: item.kind });
    }
  }
  return rows;
}
function statMods(rows, unit) {
  const mods = {};
  const seen = new Set();
  for (const row of rows) {
    if (row.kind === 'component_stat') {
      const p = row.params ?? {};
      for (const [key, mod] of [['atk','atkFlat'],['aspd','aspd'],['def','defFlat'],['res','resFlat'],['hp','hpFlat'],['sp','spRecoveryFlat'],['hpPct','hpPct']]) {
        const value = n(p[key]); if (value) mods[mod] = (mods[mod] ?? 0) + (key === 'hpPct' ? value / 100 : value);
      }
      const initial = n(p.initialSp ?? p.initSp);
      if (initial) unit.mem.resonanceEquipmentInitialSp = (unit.mem.resonanceEquipmentInitialSp ?? 0) + initial;
      continue;
    }
    if (row.kind === 'transfer_pact' || row.kind === 'pact_transfer') {
      const pactId = row.params?.pactId ?? row.params?.pact;
      if (pactId) { unit.mem.resonancePacts ??= new Set(); unit.mem.resonancePacts.add(pactId); }
      continue;
    }
    if (row.kind === 'choose_identity_transfer') { unit.mem.resonanceIdentityChoicePending = true; continue; }
    if (seen.has(row.kind)) continue;
    seen.add(row.kind);
    const p = row.params ?? {};
    if (row.kind === 'armor_pierce') mods.defIgnorePct = n(p.defensePenetration, 25) / 100;
    if (row.kind === 'evasion') { mods.dodgePhys = n(p.physicalDodge, 15) / 100; mods.dodgeArts = n(p.artsDodge, 15) / 100; }
    if (row.kind === 'spell_vulnerability') mods.resFlat = (mods.resFlat ?? 0) + n(p.resBonus, 0);
    if (row.kind === 'regeneration') mods.hpPct = (mods.hpPct ?? 0) + n(p.maxHpBonus, 25) / 100;
    if (row.kind === 'death_barrier') mods.hpPct = (mods.hpPct ?? 0) + n(p.baseHpBonus, 15) / 100;
    if (row.kind === 'resistance_cleanse') mods.resFlat = (mods.resFlat ?? 0) + n(p.extraRes, 0);
  }
  for(const key of Object.keys(mods))if(!ADD_KEYS.includes(key)&&!MUL_KEYS.includes(key))throw new Error(`UNKNOWN_RESONANCE_EQUIPMENT_STAT:${key}`);
  return mods;
}
function deal(battle, source, target, amount, type = 'phys', tags = []) {
  if (!source || !target?.alive || !(amount > 0)) return;
  battle.dealDamage(source, target, { amount, type, canDodge: false, tags: ['resonance','equipment',...tags] });
}
function enemies(battle, x, y, radius = Infinity) {
  return (battle.enemies ?? []).filter((unit) => unit.alive && unit.deployed && !unit.hidden && Math.hypot(unit.x-x, unit.y-y) <= radius);
}
function allies(battle, x, y, radius = Infinity) {
  return (battle.allyUnits ?? []).filter((unit) => unit.kind === 'op' && unit.alive && unit.deployed && Math.hypot(unit.x-x, unit.y-y) <= radius);
}
function effectFor(unit, kind) { return effectList(unit).find((row) => row.kind === kind) ?? null; }
function cooldown(unit, key, now, duration = 0) { const id=`resonanceEquipment:${key}`;if(now<n(unit.mem[id],-Infinity))return true;unit.mem[id]=now+duration;return false; }
function uniqueNonComponent(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (row.kind === 'component_stat' || row.kind === 'pact_transfer' || row.kind === 'transfer_pact') return true;
    // The same named unique item only contributes its passive once. Different item
    // identities may each own an effect of the same kind (for example both heals).
    const key = `${row.itemId}:${row.kind}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function assertCoverage(content) {
  for (const [id, item] of Object.entries(content.equipment ?? {})) for (const row of item.effects ?? []) {
    if (!SUPPORTED.has(row.kind)) throw new Error(`UNKNOWN_RESONANCE_EQUIPMENT_EFFECT:${id}:${row.kind}`);
  }
}

/** Apply source-derived gear stats, pact transfers, and all completed equipment triggers. */
export function installResonanceEquipment(battle, { catalog, state } = {}) {
  const content = contentOf(catalog);
  assertCoverage(content);
  const units = (battle.allyUnits ?? []).filter((unit) => unit.kind === 'op');
  for (const unit of units) {
    const rows = uniqueNonComponent(actualItemEffects(content, unit));
    unit.mem.resonanceEquipmentEffects = rows;
    const mods = statMods(rows, unit);
    if (Object.keys(mods).length) battle.addBuff(unit, { key:`resonance:equipment:stats:${unit.id}`, persist:true, allowDead:true, mods, tags:['resonance','equipment'] });
  }
  battle.on('battleStart',()=>{
    for(const unit of units){const amount=unit.mem.resonanceEquipmentInitialSp??0;if(amount>0){unit.mem.resonanceEquipmentInitialSp=0;unit.skill?.gainSp?.(amount,'resonanceGearInit');}}
  },{owner:battle});

  battle.on('hit', (event) => {
    const source=event?.source,target=event?.target,dmg=event?.dmg;
    if(source?.side!=='ally'||target?.side!=='enemy'||!dmg)return;
    const giant=effectFor(source,'giant_slayer');if(giant&&target.s?.maxHp>n(giant.params?.healthAbove,5000))dmg.mul=(dmg.mul??1)*(1+n(giant.params?.damageBonus,25)/100);
    if(dmg.type==='arts'&&target.mem.resonanceEquipmentSpellVulnUntil>battle.time){dmg.mul=(dmg.mul??1)*(1+n(target.mem.resonanceEquipmentSpellVulnPercent,15)/100);}
    const skill=effectFor(source,'skill_damage');if(skill&&dmg.isSkill)dmg.mul=(dmg.mul??1)*(1+n(skill.params?.skillDamageBonus,25)/100);
  },{owner:battle});

  battle.on('attack',(event)=>{
    const unit=event?.attacker;if(!unit||unit.side!=='ally'||unit.kind!=='op')return;
    const target=(event.targets??[]).find((row)=>row?.side==='enemy'&&row.alive);if(!target)return;
    const fifth=effectFor(unit,'fifth_strike');if(fifth){unit.mem.gearFifth=(unit.mem.gearFifth??0)+1;const p=fifth.params??{};if(unit.mem.gearFifth%n(p.every,5)===0)deal(battle,unit,target,unit.s.atk*n(p.damage,80)/100,p.damageType==='physical'?'phys':p.damageType??'phys');}
    const chain=effectFor(unit,'chain_lightning');if(chain){unit.mem.gearChain=(unit.mem.gearChain??0)+1;const p=chain.params??{};if(unit.mem.gearChain%n(p.every,4)===0){const secondary=enemies(battle,target.x,target.y,n(p.radius,1.5)).filter((row)=>row!==target);for(const enemy of secondary)deal(battle,unit,enemy,unit.s.atk*n(p.damage,80)/100,p.damageType==='arts'?'arts':p.damageType??'arts');}}
    const splash=effectFor(unit,'splash_strike');if(splash){unit.mem.gearSplash=(unit.mem.gearSplash??0)+1;const p=splash.params??{};if(unit.mem.gearSplash%n(p.every,3)===0){if(battle.rangeChanged?.(unit))battle._refreshRange?.(unit);const profile=event.profile??battle.effectiveProfile(unit),range=new Set(unit.rangeKeys??[]);const candidates=(battle.enemies??[]).filter((row)=>row!==target&&row.alive&&row.deployed&&!row.hidden&&range.has(Math.round(row.y)*COLS+Math.round(row.x))&&canTargetEnemy(unit,row,profile));candidates.sort((a,z)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(z.x-unit.x,z.y-unit.y)||a.id-z.id);const other=candidates[0];if(other)deal(battle,unit,other,unit.s.atk*n(p.otherTargetDamage,60)/100,'phys');}}
    const attackStack=effectFor(unit,'attack_stack');if(attackStack){unit.mem.gearAttackStack=(unit.mem.gearAttackStack??0)+n(attackStack.params?.aspdPerAttack,3);const value=Math.min(n(attackStack.params?.maxAspd,45),unit.mem.gearAttackStack);battle.addBuff(unit,{key:`resonance:equipment:attack-stack:${unit.id}`,persist:true,allowDead:true,mods:{aspd:value},tags:['resonance','equipment']});}
    const attackSp=effectFor(unit,'attack_sp');if(attackSp){const p=attackSp.params??{};const bucket=Math.floor(battle.time),key=`gearAttackSp:${unit.id}:${bucket}`;unit.mem[key]=(unit.mem[key]??0)+1;if(unit.mem[key]<=n(p.perSecondCap,2))unit.skill?.gainSp?.(n(p.spPerAttack,1),'resonanceGearAttack');}
  },{owner:battle});

  battle.on('damaged',(event)=>{
    const source=event?.source,target=event?.target,dmg=event?.dmg;
    if(source?.side==='ally'&&target?.side==='enemy'&&event.dealt>0){
      const vamp=effectFor(source,'lifesteal');if(vamp&&['phys','arts'].includes(dmg?.type)&&!cooldown(source,'lifestealAt',battle.time,n(vamp.params?.cooldown,.5)))battle.heal(source,source,event.dealt*n(vamp.params?.actualDamagePercent,10)/100,{tags:['resonance','equipment']});
      const shred=effectFor(source,'resistance_shred');if(shred)battle.addBuff(target,{key:`resonance:equipment:res-shred:${source.id}`,duration:n(shred.params?.duration,3),mods:{resFlat:-n(shred.params?.resReduction,12)},tags:['resonance','equipment']});
    }
    if(source?.side==='enemy'&&target?.side==='ally'&&event.amount>0){
      const stack=effectFor(target,'hit_stack');if(stack){const p=stack.params??{};target.mem.gearHitStacks=Math.min(n(p.maxStacks,20),(target.mem.gearHitStacks??0)+1);battle.addBuff(target,{key:`resonance:equipment:hit-stack:${target.id}`,persist:true,allowDead:true,mods:{defFlat:target.mem.gearHitStacks*n(p.defPerHit,8),atkPct:target.mem.gearHitStacks*n(p.atkPercentPerHit,1)/100},tags:['resonance','equipment']});}
      const counter=effectFor(target,'counter_magic');if(counter&&!cooldown(target,'counterMagicAt',battle.time,n(counter.params?.cooldown,1))){const p=counter.params??{};deal(battle,target,source,target.s.def*n(p.damageFromDef,40)/100,'arts');}
      const thorns=effectFor(target,'thorns');if(thorns&&!cooldown(target,'thornsAt',battle.time,n(thorns.params?.cooldown,1))){const p=thorns.params??{};for(const enemy of enemies(battle,target.x,target.y,n(p.radius,1)))deal(battle,target,enemy,target.s.def*n(p.damageFromDef,80)/100,'phys');}
      const hitSp=effectFor(target,'hit_sp');if(hitSp){const p=hitSp.params??{},bucket=Math.floor(battle.time),key=`gearHitSp:${target.id}:${bucket}`;target.mem[key]=(target.mem[key]??0)+1;if(target.mem[key]<=n(p.perSecondCap,2))target.skill?.gainSp?.(n(p.spPerHit,1),'resonanceGearHit');}
      const cleanse=effectFor(target,'resistance_cleanse');if(cleanse&&!cooldown(target,'cleanse',battle.time,n(cleanse.params?.interval,5))){const p=cleanse.params??{};for(const status of p.cleanses??[])battle.removeStatus?.(target,status);}
    }
  },{owner:battle});

  battle.on('skillStart',(event)=>{
    const unit=event?.unit;if(unit?.side!=='ally'||unit.kind!=='op')return;
    const haste=effectFor(unit,'first_cast_haste');if(haste&&!unit.mem.gearFirstCast){unit.mem.gearFirstCast=true;battle.addBuff(unit,{key:`resonance:equipment:first-cast:${unit.id}`,duration:n(haste.params?.duration,8),mods:{aspd:n(haste.params?.aspd,35)},tags:['resonance','equipment']});}
    const cast=effectFor(unit,'cast_stack');if(cast){const p=cast.params??{};unit.mem.gearCastStack=Math.min(n(p.maxPercent,40),(unit.mem.gearCastStack??0)+n(p.atkPercentPerCast,8));battle.addBuff(unit,{key:`resonance:equipment:cast-stack:${unit.id}`,persist:true,allowDead:true,mods:{atkPct:unit.mem.gearCastStack/100},tags:['resonance','equipment']});}
    const stun=effectFor(unit,'cast_stun');if(stun&&!cooldown(unit,'castStunAt',battle.time,n(stun.params?.cooldown,5))){const p=stun.params??{};const enemy=enemies(battle,unit.x,unit.y).sort((a,z)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(z.x-unit.x,z.y-unit.y))[0];if(enemy)battle.applyStatus(enemy,'stun',{duration:n(p.duration,1),source:unit});}
  },{owner:battle});

  battle.on('skillEnd',(event)=>{
    const unit=event?.unit;if(unit?.side!=='ally'||unit.kind!=='op')return;
    const cast=effectFor(unit,'cast_sp');if(cast&&cast.params?.trigger==='skillEnd')unit.skill?.gainSp?.(n(cast.params?.sp,4),'resonanceGearCast');
    const skill=effectFor(unit,'skill_sp');if(skill&&!cooldown(unit,'skillSpAt',battle.time,n(skill.params?.cooldown,3)))unit.skill?.gainSp?.(n(skill.params?.sp,5),'resonanceGearSkill');
  },{owner:battle});

  battle.on('damaged',(event)=>{
    const source=event?.source,target=event?.target,dmg=event?.dmg;
    if(source?.side!=='ally'||source.kind!=='op'||target?.side!=='enemy'||!(event.dealt>0)||!dmg?.isSkill)return;
    const vuln=effectFor(source,'spell_vulnerability');if(!vuln)return;
    target.mem.resonanceEquipmentSpellVulnUntil=battle.time+n(vuln.params?.duration,3);
    target.mem.resonanceEquipmentSpellVulnPercent=n(vuln.params?.targetArtsVulnerability,15);
  },{owner:battle});

  battle.on('tick',({dt})=>{
    for(const unit of battle.allyUnits.filter((row)=>row.kind==='op'&&row.alive&&row.deployed)){
      for(const spring of effectList(unit).filter((row)=>row.kind==='periodic_heal')){
        const p=spring.params??{},timerKey=`gearHealElapsed:${spring.itemId}`;
        unit.mem[timerKey]=(unit.mem[timerKey]??0)+dt;
        if(unit.mem[timerKey]>=n(p.interval,5)){
          unit.mem[timerKey]%=n(p.interval,5);
          const targets=allies(battle,unit.x,unit.y,n(p.range,Infinity)).filter((target)=>target.hp<target.s.maxHp)
            .sort((a,z)=>a.hpRatio-z.hpRatio||a.id-z.id);
          const selected=p.healMaxHp
            ? targets.slice(0,Math.max(1,Math.floor(n(p.healTargetCount,1))))
            : targets.slice(0,1);
          for(const target of selected){
            const amount=p.healMaxHp?target.s.maxHp*n(p.healMaxHp,6)/100:unit.s.atk*n(p.healFromAtk,80)/100;
            battle.heal(unit,target,amount,{tags:['resonance','equipment'],noSymbiosisRecursion:p.noSymbiosisRecursion===true});
          }
        }
      }
      for(const cleanse of effectList(unit).filter((row)=>row.kind==='resistance_cleanse')){
        const p=cleanse.params??{},timerKey=`gearCleanseElapsed:${cleanse.itemId}`;
        unit.mem[timerKey]=(unit.mem[timerKey]??0)+dt;
        if(unit.mem[timerKey]>=n(p.interval,5)){
          unit.mem[timerKey]%=n(p.interval,5);
          for(const status of p.cleanses??[])battle.removeStatus?.(unit,status);
        }
      }
      const regen=effectFor(unit,'regeneration');if(regen){unit.mem.gearRegenElapsed=(unit.mem.gearRegenElapsed??0)+dt;const p=regen.params??{};if(unit.mem.gearRegenElapsed>=1){unit.mem.gearRegenElapsed-=1;battle.heal(unit,unit,unit.s.maxHp*n(p.healMaxHpPerSecond,.6)/100,{tags:['resonance','equipment']});}}
      const block=effectFor(unit,'block_stack');if(block){const key=`resonance:equipment:block-stack:${unit.id}`,stacks=Math.min(n(block.params?.maxStacks,3),unit.blocking?.length??0);if(stacks>0)battle.addBuff(unit,{key,persist:true,allowDead:true,mods:{defFlat:stacks*n(block.params?.defPerBlock,20),resFlat:stacks*n(block.params?.resPerBlock,4)},tags:['resonance','equipment']});else battle.removeBuff(unit,key);}
    }
  });
  battle.on('fatal',(event)=>{
    const unit=event?.unit;if(unit?.side!=='ally'||unit.kind!=='op')return;
    const barrier=effectFor(unit,'death_barrier'),save=effectFor(unit,'death_save');
    const useBarrier=barrier&&!unit.mem.resonanceEquipmentDeathBarrierUsed;
    const useSave=save&&!unit.mem.resonanceEquipmentDeathSaveUsed;
    if(!useBarrier&&!useSave)return;
    event.prevented=true;unit.hp=Math.max(1,unit.hp);
    if(useBarrier){unit.mem.resonanceEquipmentDeathBarrierUsed=true;const p=barrier.params??{};battle.addBuff(unit,{key:`resonance:equipment:death-barrier:${unit.id}`,shield:unit.s.maxHp*n(p.hpPercent,15)/100,duration:Infinity,tags:['resonance','equipment']});}
    if(useSave){unit.mem.resonanceEquipmentDeathSaveUsed=true;battle.addBuff(unit,{key:`resonance:equipment:death-save:${unit.id}`,duration:n(save.params?.duration,2),flags:{invulnerable:true},tags:['resonance','equipment']});}
  },{owner:battle});
  return { units: units.length, effects: units.reduce((sum,unit)=>sum+effectList(unit).length,0) };
}
