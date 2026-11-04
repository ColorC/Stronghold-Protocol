import { supportPlans } from './support-plans.js';
import { isSupportSingleCast, canCastSupportSingle, castSupportSingle } from './support-instant.js';
import { dirVec } from '../../../dir.js';
import { COLS, TICK } from '../../../constants.js';
import { makeKit, v, enemies, allies, damage, heal, buff, applyStatus, sp, haste, gainDP, watch, active, uid, recast, matchesTags } from '../primitives.js';
import { installSupportBazaar, supportBazaarSuppressed } from './support-bazaar.js';
import { grantSummon, summonPlacementLegal } from '../summons.js';
import { supportTokenKits } from './support-tokens.js';
import { supportModuleHandlers, wanqinFacingInRange } from './support-modules.js';
import { supportModuleValue as moduleValue } from './support-modules.js';
import { registerAssaultAmmo, assaultAmmoState, consumeAssaultAmmo, reloadAssaultAmmo } from '../ammo.js';
import { installSupportRetainedExtra, supportRetainedExtraHandledKeys } from './support-retained-extra.js';
import { reduceElement } from '../../../damage.js';
import { powi } from '../../../detmath.js';
import { HORN_S2_OVERLOAD_AT } from '../../kits/ops/chess_char_5_08-horn.js';
import { absoluteRangeKeys, tileKeyOf } from '../../../targeting.js';
import { bodyInKeys } from '../../../body.js';
import { shuSowableCells, SHU_FARM, SHU_S2_RANGE } from '../../kits/ops/op-shu.js';
import { holdProtect, byEnemyAttack, hurtSpDamage } from '../../kits/shared/tier1.js';
import { SIEGE_S2_RANGE } from '../../kits/ops/op-siege.js';
import { FLAG_FLIGHT as SLEACH_FLAG_FLIGHT, X4 as SLEACH_X4, R21 as SLEACH_R21, s3Tile as sleachS3Tile } from '../../kits/ops/op-sleach.js';
function siegeSkillEnemies(battle,unit,body) {
  const grid=unit.assaultSupportModules?.has('uniequip_002_siege')?SIEGE_S2_RANGE.flatMap(([r,c])=>[[r,c],[r+1,c],[r-1,c],[r,c+1],[r,c-1]]):SIEGE_S2_RANGE;
  return battle.enemiesInKeys(absoluteRangeKeys(grid,unit.tileR,unit.tileC,unit.dir),unit,{...unit.profile,canHitFly:body.physicalProfile?.canHitFly===true});
}
function silentFront(battle,unit) {
  const [dr,dc]=dirVec(unit.dir),row=unit.tileR+dr,col=unit.tileC+dc;
  const old=battle.allyUnits.find(t=>t.kind==='token'&&t.defId==='token_10000_silent_healrb'&&t.ownerUnit===unit&&active(t));
  const def=battle.tokenDef('token_10000_silent_healrb',unit),cost=def?.stats?.cost??0;
  const projected=battle.assaultDeploymentCost({kind:'token',side:'ally',def,ownerUnit:unit,ownerId:unit.ownerId,base:{cost},mem:{},tileR:row,tileC:col});
  return {row,col,old,legal:(battle.getPlayer(unit.ownerId)?.dp??0)+1e-9>=projected&&summonPlacementLegal(battle,unit,'token_10000_silent_healrb',row,col,{occupiesTile:false,replacingUnit:old})};
}
function summonSilentDrone(battle,unit,body,key) {
  const {row,col,old,legal}=silentFront(battle,unit);if(!legal)return false;
  if(old)battle.retreat(old,{reason:'replaced',permanent:true});
  const receipt=grantSummon(battle,unit,{tokenId:'token_10000_silent_healrb',count:1,stockCap:1,fieldCap:1,occupiesTile:false,ruleKey:key,kit:supportTokenKits.token_10000_silent_healrb,preparedSlot:[row,col],preparedOnly:true});
  return receipt.spawned>0;
}


const shuPlotStates = new WeakMap();
const SHU_PLOT_ATK = 'assault:char_2025_shu:plots:atk';
function shuSkillRecipients(battle,unit,body,params) {
  const grid=body.fixedSkill?.source?.native?.rangeId==='x-1'?SHU_S2_RANGE:body.range;
  const keys=new Set(absoluteRangeKeys(grid,unit.tileR,unit.tileC,unit.dir));
  return battle.injuredAlliesInKeys(keys,unit).filter(t=>active(t)&&t.kind==='op').slice(0,Math.min(2,scale(body,params,'maxTargets',2)));
}
function installShuPlots(battle, unit, body, plan, star) {
  let state = shuPlotStates.get(battle);
  if (!state) {
    state = { owners: new Map() }; shuPlotStates.set(battle, state);
    state.refresh = () => {
      for (const [owner, plots] of state.owners) {
        if (!active(owner)) plots.clear();
        for (const [cell, plot] of plots) if (plot.until <= battle.time + 1e-9) plots.delete(cell);
      }
      for (const ally of battle.allyUnits) {
        const candidates = [];
        if (active(ally) && ally.kind !== 'device') for (const [owner, plots] of state.owners) {
          const plot = plots.get(ally.tileR * COLS + ally.tileC);
          if (plot && active(owner) && battle.allySelectable(ally, owner)) candidates.push({ owner, plot });
        }
        const regen = candidates.slice().sort((a,b)=>b.plot.hp-a.plot.hp)[0];
        const old = ally.findBuff(SHU_FARM);
        if (old && state.owners.has(old.source) && (!regen || old.source !== regen.owner || old.data?.value !== regen.plot.hp)) battle.removeBuff(ally, SHU_FARM);
        if (regen) battle.applyStrongest(ally, SHU_FARM, { duration: 1.5*TICK, value: regen.plot.hp, mods: hp => ({hpRegen:hp}), source:regen.owner });
        const guard = candidates.slice().sort((a,b)=>b.plot.protect-a.plot.protect)[0];
        if (guard) holdProtect(battle, ally, guard.plot.protect, 1.5*TICK, guard.owner);
        const attack = candidates.find(x=>x.plot.atk > 0);
        if (attack) battle.addBuff(ally,{key:SHU_PLOT_ATK,mods:{atkMul:1+attack.plot.atk},duration:1.5*TICK,refresh:'replace',source:attack.owner,tags:['module']});
        else if (ally.findBuff(SHU_PLOT_ATK) && state.owners.has(ally.findBuff(SHU_PLOT_ATK).source)) battle.removeBuff(ally,SHU_PLOT_ATK);
      }
    };
    battle.every(TICK, state.refresh, { immediate:true });
  }
  const plots = new Map(); state.owners.set(unit, plots);
  unit.mem ??= {}; unit.mem.assaultShuPlots = plots;
  unit.mem.assaultShuSow = (recipients, params) => {
    if (!active(unit)) return false;
    const module = unit.assaultSupportModules?.has('uniequip_002_shu') === true;
    // “钦天司时”: only the sowing duration +{t}s (4-star protect/ATK removed).
    const hp = scale(body,params,'hpPerSec',0), protect=scale(body,params,'protect',0);
    const duration = scale(body,params,'duration',0)+(module?moduleValue(body,'uniequip_002_shu','t'):0), atk=0;
    if (!(hp>0&&duration>0)) return false;
    let planted=false;
    for (const target of recipients) {
      if (!active(target) || target.side!=='ally' || target.kind!=='op') continue;
      const targetKey=tileKeyOf(target), targetR=Math.floor(targetKey/COLS), targetC=targetKey%COLS;
      const cells = shuSowableCells(battle,targetR,targetC).filter(([r,c])=>!battle.grid.isObstacle(r,c));
      for (const [r,c] of cells) { plots.set(r*COLS+c,{hp,protect,atk,until:battle.time+duration}); planted=true; }
      if (cells.length) battle.fx('healField',{x:target.x,y:target.y,id:unit.id});
    }
    state.refresh(); return planted;
  };
  const clear = event => {const ctx=event.payload??event;if((ctx.unit??ctx.target)!==unit)return;plots.clear();state.refresh();};
  battle.on('retreating',clear,{owner:unit}); battle.on('death',clear,{owner:unit});
  const passive = plan.passives.find(e=>e.action==='device'&&e.params?.deviceId==='shu_seed_plot');
  battle.on('heal',event=>{
    const ctx=event.payload??event;
    if (ctx.source!==unit || !active(unit) || !(ctx.amount>0) || ctx.opts?.regen || !active(ctx.target) || ctx.target.side!=='ally' || ctx.target.kind!=='op') return;
    unit.mem.assaultShuSow([ctx.target],passive.params);
  },{owner:unit});
  if (star>=4) battle.every(1,()=>{
    if (!active(unit)) return;
    for (const enemy of battle.enemies) {
      if (!enemy.alive || enemy.hidden || enemy.isFlying) continue;
      const plot=plots.get(tileKeyOf(enemy));
      if (plot && plot.until>battle.time+1e-9) damage(battle,unit,enemy,{amount:unit.s.atk*0.3,type:'arts',sourceKey:'assault:char_2025_shu:plots:enemy',cause:battle.assaultRuntime.currentCause});
    }
  },{owner:unit});
}


const STAT = {atk:'atkMul',def:'defMul',res:'resFlat',attackSpeed:'aspd',spRecoveryFlat:'spRecoveryFlat',spRecoveryMul:'spRecoveryMul',blockCnt:'blockCnt',maxHp:'hpMul'};
function installChiaveClaw(battle,unit,body,star,moduleEnabled){
  const plan=body.modePassives?.find(x=>x.action==='summon'&&x.values?.deviceId==='chiave_mech_claw');
  if(!plan||plan.values?.statBasis!=='ownerAlreadyNormalizedStats'||plan.values?.sourceTemplateId!=='token_10004_otter_motter'||plan.values?.sourceUse!=='visualOnly'||plan.values?.lifeScale!==1||plan.values?.lifeScaleApplications!==0)throw new Error('Chiave claw requires its compiled typed summon, visual-only source template, and once-normalized owner stats');
  const values=plan.values,index=Math.max(0,Math.min(3,star-1)),duration=values.duration?.[index];
  if(!Number.isFinite(duration)||duration<=0)throw new Error('Chiave claw duration missing for star');
  const perDevice=body.talentBindings?.find(x=>x.nativeTalentIndex===0)?.translation?.parameters?.atkPerDevice?.[index];
  const talentKey='assault:char_349_chiave:talent:deviceStats';
  if(!Number.isFinite(perDevice))throw new Error('Chiave device talent lacks compiled per-device values');
  const refreshTalent=()=>{const count=battle.allyUnits.filter(x=>x.kind==='device'&&x.ownerUnit===unit&&x.mem?.assaultChiaveClaw&&x.alive&&x.deployed).length; if(count&&active(unit))buff(battle,unit,unit,{key:talentKey,mods:{atkMul:1+perDevice*Math.min(2,count),defMul:1+perDevice*Math.min(2,count)},duration:Infinity,stacking:'replace'});else battle.removeBuff(unit,talentKey);};
  unit.mem??={};unit.mem.supportChiaveClawSpawned=false;unit.mem.supportChiaveClawPending=true;
  const attempt=()=>{
    if(!unit.mem.supportChiaveClawPending||!active(unit)||!unit.deployed)return;
    const [dr,dc]=dirVec(unit.dir),row=unit.tileR+dr,col=unit.tileC+dc;
    if(!battle.grid.inRect(row,col)||battle.unitAt(row,col)||battle.isDown?.(row,col))return;
    const visual=battle.spawnDevice(`assault:${values.deviceId}:${uid(unit)}`,row,col,{name:'贾维机械爪',ownerUnit:unit,sourceKey:values.deviceId,spine:values.sourceTemplateId,avatar:values.sourceTemplateId,hp:unit.s.maxHp*values.maxHpRatio,atk:unit.s.atk*values.atkRatio,def:unit.s.def*values.defRatio,res:unit.s.res*values.resRatio,bat:values.bat,aspd:values.aspd,blockCnt:values.blockCnt,duration,rangeGrid:values.rangeGrid,assaultCombat:true,dmgType:'phys',canHitFly:false});
    if(!visual)return;
    visual.mem.assaultChiaveClaw=true;
    if(moduleEnabled)buff(battle,unit,visual,{key:'assault:uniequip_002_chiave:clawStats',mods:{hpMul:1.2,atkMul:1.2},duration:Infinity,stacking:'replace'});
    const stunDuration=values.attackStunDuration?.[index]??0;
    if(stunDuration>0)battle.on('damaged',event=>{const ctx=event.payload??event;if(ctx.source!==visual||ctx.target?.side!=='enemy'||!ctx.amount||ctx.amount<=0)return;applyStatus(battle,unit,ctx.target,{status:'stun',duration:stunDuration,key:`assault:chiave:${uid(visual)}:hit-stun`,cause:ctx.cause});},{owner:unit});
    if(moduleEnabled){
      let exploded=false;
      battle.on('death',event=>{const ctx=event.payload??event;if(ctx.unit!==visual||exploded||ctx.reason==='ownerRemoved')return;exploded=true;for(const enemy of enemies(battle,visual,{scope:'adjacent8',count:99,priority:'nearest'}))damage(battle,unit,enemy,{amount:unit.s.atk,type:'arts',sourceKey:'assault:uniequip_002_chiave:clawDeath',cause:ctx.cause});},{owner:unit});
    }
    unit.mem.supportChiaveClawSpawned=true;unit.mem.supportChiaveClawPending=false;
    unit.mem.bazaarChiaveSummoned?.();
  };
  battle.on('deploy',event=>{const ctx=event.payload??event;if(ctx.unit===unit)attempt();},{owner:unit});
  battle.on('tick',attempt,{owner:unit});
  attempt();
}
const ownerScoped=(unit,items)=>items.filter(x=>x?.side!=='ally'||x.ownerId===unit.ownerId);
const TARGETS = {
  self: (b,u) => [u], selfEconomy:(b,u)=>[u], eventAlly:(_b,_u,x)=>x?.target?[x.target]:[], eventEnemy:(_b,_u,x)=>x?.target?[x.target]:[],
  hitTargets:(b,u,x)=>x?.targets??(x?.target?[x.target]:enemies(b,u,{scope:'range',count:99,priority:'exit'})), attackTargets:(b,u,x)=>x?.targets??enemies(b,u,{scope:'range',count:99,priority:'exit'}), attacker:(_b,_u,x)=>x?.source?[x.source]:[],
  damagedEnemy:(_b,_u,x)=>x?.target?[x.target]:[], healedTargets:(_b,_u,x)=>x?.targets??(x?.target?[x.target]:[]),
  rangeEnemies:(b,u)=>enemies(b,u,{scope:'range',count:99}), frontRangeEnemies:(b,u)=>enemies(b,u,{scope:'range',count:99}),
  frontAreaEnemies:(b,u)=>enemies(b,u,{scope:'range',count:99}).filter(t=>{const [dr,dc]=dirVec(u.dir);return (t.y-u.tileR)*dr+(t.x-u.tileC)*dc>0;}), adjacentEnemies:(b,u)=>enemies(b,u,{scope:'adjacent8',count:99}), adjacentGroundEnemies:(b,u)=>enemies(b,u,{scope:'adjacent8',count:99,groundOnly:true}),
  blockedEnemies:(b,u)=>b.enemies.filter(x=>x.alive&&u.blocking?.includes?.(x)), blockedEnemiesAndSelf:(b,u)=>[u,...b.enemies.filter(x=>x.alive&&u.blocking?.includes?.(x))],
  allAllies:(b,u)=>allies(b,u,{scope:'field',priority:'hp',count:99}), rangeAllies:(b,u)=>allies(b,u,{scope:'range',priority:'hp',count:99}), nearbyAllies:(b,u)=>allies(b,u,{scope:'adjacent8',priority:'hp',count:99}), adjacentAllies:(b,u)=>allies(b,u,{scope:'adjacent8',priority:'hp',count:99}),
  rangeAlliesPioneer:(b,u)=>allies(b,u,{scope:'range',priority:'hp',count:99}).filter(x=>x.def?.profession==='PIONEER'), allAlliesPioneer:(b,u)=>allies(b,u,{scope:'field',priority:'hp',count:99}).filter(x=>x.def?.profession==='PIONEER'),
  rangeGroundAllies:(b,u)=>allies(b,u,{scope:'range',priority:'hp',count:99}).filter(x=>x.ground!==false), injuredRangeAllies:(b,u)=>allies(b,u,{scope:'range',priority:'hp',count:99}).filter(x=>x.hp<x.s.maxHp),
  allAlliesMedic:(b,u)=>allies(b,u,{scope:'field',priority:'hp',count:99}).filter(x=>x.def?.profession==='MEDIC'),
};
const EVENT = {skillResolve:'skillEnd',enemyKilled:'death',magicDamageTaken:'damaged',attacked:'damaged',attackedWhileSkillActive:'damaged',normalAttackHit:'attack',dpReceived:'dpReceived',dpReceivedPerPoint:'dpReceived',skillSettled:'skillEnd',healed:'heal',healedIncludingModule:'heal',skillSummon:'deploy',battleStart:'battleStart',deployed:'deploy',ammoAttackHit:'attack',hitFullHpEnemy:'attack',enemyKilledInRange:'death',allySkillInRange:'skillStart',allyElementThreshold:'elementBurst',coveredAllyElementBurst:'elementBurst',shelteredAllyAttacked:'damaged',highestMaxHpAllyHealed:'heal',skillHeal:'skillEnd',enterFengState:'statusApplied',attackHit:'attack',attack:'attack',decayDamageTaken:'damaged',enemyKilledAdjacent:'death',firstDamageToEnemy:'damaged',dodge:'dodge',allyRedeploy:'deploy',attackHitWhileSkillActive:'attack',allyStatusInRange:'statusApplied',normalHeal:'heal',damageDealt:'damaged',enemySleepPresent:'tick',hitSleepingEnemy:'attack',allyHealed:'heal',shieldBroken:'shieldLayersBroken',attackedWithOwnBarrier:'damaged',blockingTick:'tick',deathOncePerDeployment:'death',skillWhileShieldAlive:'skillEnd',lethalWhileAmmo:'death',deployedAura:'deploy'};
const OWNED_OBSERVER_TRIGGERS=new Set(['allyRedeploy','allySkillInRange','allyElementThreshold','coveredAllyElementBurst','shelteredAllyAttacked','highestMaxHpAllyHealed','allyStatusInRange','allyHealed','enemyKilledInRange','enemyKilledAdjacent','skillSummon']);
function sameOwnerOperator(observer,candidate){return !!candidate&&candidate!==observer&&candidate.kind==='op'&&candidate.side===observer.side&&candidate.ownerId===observer.ownerId;}
function hasStatus(unit,status){return !!unit?.s?.flags?.[status]||!!unit?.findBuff?.(status)||!!unit?.buffs?.some?.(b=>b.status===status||b.flags?.[status]);}
function observerAccepts(trigger,battle,unit,ctx){
  if(!OWNED_OBSERVER_TRIGGERS.has(trigger))return false;
  if(trigger==='skillSummon'){const summon=ctx.unit;return summon?.kind==='token'&&summon.side===unit.side&&summon.ownerId===unit.ownerId&&ctx.initial!==true;}
  if(trigger==='enemyKilledInRange'||trigger==='enemyKilledAdjacent'){
    const victim=ctx.unit??ctx.target;
    if(victim?.side!=='enemy'||ctx.reason!=='killed')return false;
    if(trigger==='enemyKilledAdjacent'){if(unit.def?.charId==='char_112_siege')return bodyInKeys(victim,new Set(absoluteRangeKeys(SIEGE_S2_RANGE,unit.tileR,unit.tileC,unit.dir)));return Math.max(Math.abs(victim.y-unit.tileR),Math.abs(victim.x-unit.tileC))<=4;}
    return bodyInKeys(victim,unit.rangeKeySet??unit.rangeKeys??[]);
  }
  const actor=ctx.unit??ctx.target??ctx.attacker??ctx.source;
  if(!sameOwnerOperator(unit,actor))return false;
  if(trigger==='allyStatusInRange'&&!new Set(['stun','freeze','frozen','cold','sleep','root','silence','slow','fear','bind','levitate','disarm']).has(ctx.status))return false;
  if(['allySkillInRange','allyElementThreshold','coveredAllyElementBurst','shelteredAllyAttacked','allyStatusInRange','highestMaxHpAllyHealed'].includes(trigger)){
    const subject=trigger==='allySkillInRange'?actor:(ctx.target??actor);
    if(!allies(battle,unit,{scope:'range',priority:'hp',count:99}).includes(subject))return false;
    if(trigger==='highestMaxHpAllyHealed'&&targets(battle,unit,{target:'highestMaxHpRangeAlly'},ctx)[0]!==subject)return false;
  }
  if(trigger==='allyHealed'&&!sameOwnerOperator(unit,ctx.target))return false;
  if(trigger==='allyRedeploy'&&ctx.initial===true)return false;
  return true;
}
const SUPPORT_TOKEN_IDS={silent_medic_drone:'token_10000_silent_healrb',vigil_wolfpack:'token_10028_vigil_wolf',mlyss_flowshape:'token_10030_mlyss_wtrman',monstr_reconstruction:'token_10050_monstr_prosts',jesca2_mobile_shield:'token_10032_jesca2_jckshd'};
const MAIN_MODULE_EFFECTS={'uniequip_002_grani':{charId:'char_220_grani',atk:0.1,multiHitDp:0.2},'uniequip_002_yu':{charId:'char_2026_yu',burnAdd:0.03,protectAdd:0.05,blockedDefDown:0.1}};
function scale(body, params, key, fallback = 0) { return params[key] == null ? fallback : v(body, params[key]); }
function registerHornAmmo(battle, unit, rounds) {
  unit.skill.ammoMax = Math.max(unit.skill.ammoMax ?? 0, rounds);
  if (!unit._assaultAmmoController) registerAssaultAmmo(battle, unit, {
    get: () => unit.skill.ammoLeft, set: amount => { unit.skill.ammoLeft = amount; }, max: () => unit.skill.ammoMax,
  });
}
function reloadHornAmmo(battle, unit, rounds, sourceKey) {
  registerHornAmmo(battle, unit, rounds);
  const magazine = rounds + (unit.mem?.assaultHornModule?.magazineAdd ?? 0);
  reloadAssaultAmmo(battle, unit, unit, Math.max(0, magazine - assaultAmmoState(unit).current), sourceKey);
  return true;
}
function installHornAmmo(battle, unit, body, plan) {
  const params = plan.skill.effects.find(effect => effect.action === 'ammo').params;
  const rounds = scale(body, params, 'rounds', 10);
  registerHornAmmo(battle, unit, rounds);
  let pendingProfile = null;
  battle.on('beforeAttack', ctx => {
    if (ctx.attacker !== unit) return;
    pendingProfile = ctx.profile;
    // effectiveProfile may return the base object. Detach the future base now;
    // only the successfully fired shot is modified, including shells in flight.
    if (ctx.profile === unit.profile) unit.profile = { ...unit.profile };
  }, { owner: unit, priority: -100000 });
  battle.on('assaultAttackStarted', ctx => {
    if (ctx.attacker !== unit) return;
    const profile = pendingProfile; pendingProfile = null;
    if (!profile || !active(unit)) return;
    const module = unit.mem?.assaultHornModule ?? {};
    profile.splashRadius = (profile.splashRadius ?? 0) + (module.splashRadiusAdd ?? 0);
    const current = assaultAmmoState(unit).current;
    if (ctx.noAmmo || current <= 0) return;
    const magazine = rounds + (module.magazineAdd ?? 0);
    const overloaded = magazine - current + 1 > magazine * HORN_S2_OVERLOAD_AT + 1e-9;
    profile.atkScale = scale(body, params, 'atkScale', 1);
    profile.dmgType = 'phys';
    if (overloaded) {
      const magic = module.overloadScale ?? scale(body, params, 'magicAtkScale', 0), previous = profile.onEachHit, hit = new Set();
      profile.onEachHit = (b, source, target, context) => {
        previous?.(b, source, target, context);
        if (!target?.alive || target.side !== 'enemy' || hit.has(target)) return;
        hit.add(target);
        b.dealDamage(source, target, { amount: source.s.atk * magic, type: 'arts', isSkill: true,
          isSplash: true, attackId: context.attackId, tags: ['skill', 'hornOverload'] });
      };
    }
    consumeAssaultAmmo(battle, unit, 1, 'assault:char_4039_horn:shot');
  }, { owner: unit, priority: 100000 });
  battle.on('ammoUsed', ctx => {
    const refill = 0, maximum = scale(body, plan.passives[0].params, 'emptyAmmoRefillMaxPerBattle', 0);
    if (ctx.unit !== unit || !active(unit) || assaultAmmoState(unit).current !== 0 || refill <= 0 || (unit.mem.assaultHornEmptyRefills ?? 0) >= maximum) return;
    unit.mem.assaultHornEmptyRefills = (unit.mem.assaultHornEmptyRefills ?? 0) + 1;
    reloadAssaultAmmo(battle, unit, unit, refill, 'assault:char_4039_horn:empty-refill');
  }, { owner: unit });
  const clear = ctx => {
    if ((ctx.unit ?? ctx.victim) !== unit) return;
    pendingProfile = null;
    // The instant fixed skill owns the native magazine, but Skill.end skips an
    // already settled instant skill. A real exit still discards that magazine.
    unit.skill.ammoLeft = 0;
  };
  battle.on('death', clear, { owner: unit });
}
function redeployCandidates(battle, unit) {
  return battle.assaultDeploymentArea(unit.ownerId).filter(entry => {
    const target = entry.unit;
    if (entry.kind !== 'operator' || target?.side !== 'ally' || target.removed || target._removing) return false;
    if (target.alive && target.deployed) return true;
    const [row, col] = battle.restTile(target), occupied = battle.unitAt(row, col);
    return battle.grid.inRect(row, col) && !(occupied && occupied.alive && occupied !== target)
      && !battle.downOn(row, col, target);
  }).sort((a, b) => b.deployCost - a.deployCost || a.formationIndex - b.formationIndex).map(entry => entry.unit);
}
function performRedeploy(battle, unit, body, params, cause, invocation) {
  if (invocation.extra || invocation.suppressRedeploy) return false;
  const target = redeployCandidates(battle, unit)[0];
  if (!target) return false;
  target.mem ??= {};
  const hadDelta = Object.hasOwn(target.mem, 'assaultCostDelta'), oldDelta = target.mem.assaultCostDelta;
  target.mem.assaultCostDelta = Math.max(-target.base.cost, (oldDelta ?? 0) - scale(body, params, 'costReduce', 0));
  let deployed;
  try { deployed = battle.skillRedeploy(target, { cause }); }
  catch (error) {
    if (hadDelta) target.mem.assaultCostDelta = oldDelta; else delete target.mem.assaultCostDelta;
    throw error;
  }
  if (!deployed) {
    if (hadDelta) target.mem.assaultCostDelta = oldDelta; else delete target.mem.assaultCostDelta;
    return false;
  }
  if (scale(body, params, 'immediateSkill', 0) > 0) recast(battle, target, { cause, suppressRedeploy: true, force: true });
  return true;
}
function targets(battle,unit,effect,event) {
  if (TARGETS[effect.target]) return ownerScoped(unit,TARGETS[effect.target](battle,unit,event));
  const range = ownerScoped(unit,allies(battle,unit,{scope:'range',priority:'hp',count:99}));
  const field = ownerScoped(unit,allies(battle,unit,{scope:'field',priority:'hp',count:99}));
  const adjacent = ownerScoped(unit,allies(battle,unit,{scope:'adjacent8',priority:'hp',count:99}));
  switch(effect.target){
    case 'sameFacingAdjacentAllies': return unit.def?.charId==='char_4119_wanqin'?field.filter(x=>wanqinFacingInRange(unit,x)):adjacent.filter(x=>x.dir===unit.dir);
    case 'forwardLineEnemies': {const [dr,dc]=dirVec(unit.dir);return enemies(battle,unit,{scope:'range',count:99}).filter(t=>(t.y-unit.tileR)*dc===(t.x-unit.tileC)*dr&&((t.y-unit.tileR)*dr+(t.x-unit.tileC)*dc)>0);}
    case 'frontCellEnemies': {const [dr,dc]=dirVec(unit.dir);const t=battle.unitAt(unit.tileR+dr,unit.tileC+dc);return t?.side==='enemy'&&t.alive?[t]:[];}
    case 'frontCell': {const [dr,dc]=dirVec(unit.dir);const t=battle.unitAt(unit.tileR+dr,unit.tileC+dc);return t?[t]:[];}
    case 'bannerLandingEnemies': {const [r,c]=sleachS3Tile(battle,unit,SLEACH_R21),keys=new Set(absoluteRangeKeys(SLEACH_X4,r,c,unit.dir,0));return battle.enemiesInKeys([...keys],unit,{...unit.profile,canHitFly:true});}
    case 'ownedWolfSummons': return battle.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===unit&&active(x));
    case 'selfAndFlowshapes': return [unit,...battle.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===unit&&active(x))];
    case 'tacticalPoint': return [unit];
    case 'allAlliesSniper': return field.filter(x=>x.def?.profession==='SNIPER');
    case 'mostElementDamagedAlly': {const load=x=>Math.max(0,...Object.values(x.elem??{}).map(n=>Number.isFinite(n)?n:0));return range.sort((a,b)=>load(b)-load(a)||uid(a).localeCompare(uid(b))).slice(0,1);}
    case 'highestMaxHpRangeAlly': return range.sort((a,b)=>b.s.maxHp-a.s.maxHp||uid(a).localeCompare(uid(b))).slice(0,1);
    case 'highestMaxHpAllyAndJumps': return field.filter(x=>x!==unit).sort((a,b)=>b.s.maxHp-a.s.maxHp||uid(a).localeCompare(uid(b))).slice(0,1);
    case 'selfAndRandomRangeAlly': return [unit,...range.filter(x=>x!==unit).sort((a,b)=>uid(a).localeCompare(uid(b))).slice(0,1)];
    case 'selfAndRandomAdjacentAlly': return [unit,...adjacent.filter(x=>x!==unit).sort((a,b)=>uid(a).localeCompare(uid(b))).slice(0,1)];
    case 'highestDpEligibleAlly': return redeployCandidates(battle,unit).slice(0,1);
    case 'buffedUnits': return field.filter(x=>(x.buffs?.length??0)>0);
    case 'allAlliesPioneer': return field.filter(x=>x.def?.profession==='PIONEER');
    case 'allAlliesMedic': return field.filter(x=>x.def?.profession==='MEDIC');
    case 'oneAdjacentAlly': return adjacent.slice(0,1);
    case 'healedAndAdjacentAllies': return [...new Set([...(event?.target?[event.target]:[]),...adjacent])];
    case 'adjacentTiles': return [{tileR:unit.tileR+1,tileC:unit.tileC},{tileR:unit.tileR-1,tileC:unit.tileC},{tileR:unit.tileR,tileC:unit.tileC+1},{tileR:unit.tileR,tileC:unit.tileC-1}].filter(t=>battle.grid.inRect(t.tileR,t.tileC)&&!battle.unitAt(t.tileR,t.tileC));
    case 'selfAndBehindAllies': {const [dr,dc]=dirVec(unit.dir);return [unit,...adjacent.filter(x=>(x.tileR-unit.tileR)*dr+(x.tileC-unit.tileC)*dc<0)];}
    case 'selfAndBlockedEnemies': return [unit,...battle.enemies.filter(x=>x.alive&&unit.blocking?.includes?.(x))];
    case 'allDefenders': return field.filter(x=>x.def?.profession==='TANK');
    case 'allPioneers': return field.filter(x=>x.def?.profession==='PIONEER');
    case 'sleepingEnemies': return battle.enemies.filter(x=>{const key=tileKeyOf(x);return x.alive&&x.side==='enemy'&&(unit.rangeKeySet?.has(key)??unit.rangeKeys?.includes(key))&&hasStatus(x,'sleep');});
    case 'rangeGroundTiles': return enemies(battle,unit,{scope:'range',count:99,groundOnly:true}).map(x=>{const k=tileKeyOf(x);return {tileR:Math.floor(k/COLS),tileC:k%COLS};});
    default: throw new Error(`${unit.defId} has no target resolver ${effect.target}`);
  }
}
function applyRmixerNativeStack(battle,unit,body,p,key,chosen){
  if(unit.def?.charId!=='char_4194_rmixer'||p.maxStacks==null)return null;
  if(!chosen.includes(unit))return false;
  const module=unit.assaultSupportModules?.has('uniequip_002_rmixer')===true,star=unit.assaultStar??unit.input_piece?.star??1,cap=module?moduleValue(body,'uniequip_002_rmixer','n'):scale(body,p,'maxStacks',3),duration=scale(body,p,'duration',10),mods={defFlat:scale(body,p,'def',0),aspd:scale(body,p,'attackSpeed',0)};
  // 毛刷套装: only the stack cap becomes {n} (the 4-star full-stack guard was removed).
  battle.addBuff(unit,{key,duration,refresh:'stack',maxStacks:cap,mods,source:unit,tags:['talent']});
  return true;
}
function clearReedFireSeed(unit, allyUid) {
  const seeds = unit?._supportFireSeeds;
  const timer = seeds?.get(allyUid);
  if (!timer) return false;
  timer._supportFireSeedCleanup?.();
  seeds.delete(allyUid);
  return true;
}
function clearReedFireSeeds(unit) {
  const seeds = unit?._supportFireSeeds;
  if (!seeds) return;
  for (const allyUid of [...seeds.keys()]) clearReedFireSeed(unit, allyUid);
}
function ensureReedFireSeedCleanup(battle, unit) {
  unit.mem ??= {};
  if (unit.mem.supportReedSeedCleanupInstalled) return;
  unit.mem.supportReedSeedCleanupInstalled = true;
  const onLeave = (event) => {
    const ctx = event?.payload ?? event ?? {};
    const leaving = ctx.unit ?? ctx.target;
    if (leaving === unit) {
      clearReedFireSeeds(unit);
    } else if (leaving?.side === 'ally' && leaving.ownerId === unit.ownerId) {
      clearReedFireSeed(unit, uid(leaving));
    }
  };
  battle.on('retreating', onLeave, { owner: unit });
  battle.on('death', onLeave, { owner: unit });
}
function reedFireSeedRecipients(battle, unit, body, params, event) {
  const star = unit.assaultStar ?? unit.input_piece?.star ?? unit.inputPiece?.star ?? 1;
  const moduleActive = unit.assaultSupportModules?.has('uniequip_003_reed2') && star >= 3;
  // “独属自己的一隅”: the skill marks {a} melee operators.
  const capacity = moduleActive ? moduleValue(unit, 'uniequip_003_reed2', 'a') : scale(body, params, 'maxTargets', 2);
  return targets(battle, unit, { target: 'rangeGroundAllies' }, event)
    .filter((ally) => ally?.kind === 'op' && ally.side === 'ally'
      && ally.ownerId === unit.ownerId && ally.ground !== false && active(ally))
    .slice(0, capacity);
}
function applyReedFireSeeds(battle, unit, body, params, key, chosen, cause) {
  const star = unit.assaultStar ?? unit.input_piece?.star ?? unit.inputPiece?.star ?? 1;
  const interval = scale(body, params, 'interval', 1.5);
  const duration = scale(body, params, 'duration', 20);
  const seeds = unit._supportFireSeeds ??= new Map();
  for (const [allyUid] of seeds) {
    const ally = battle.allyUnits.find((candidate) => uid(candidate) === allyUid);
    if (!active(ally)) clearReedFireSeed(unit, allyUid);
  }
  const seen = new Set();
  const marked = [];
  for (const ally of chosen) {
    if (ally?.kind !== 'op' || ally.side !== 'ally' || ally.ownerId !== unit.ownerId || ally.ground === false || !active(ally)) continue;
    const allyUid = uid(ally);
    if (seen.has(allyUid)) continue;
    seen.add(allyUid);
    marked.push(ally);
  }
  const selected = new Set(marked.map((ally) => uid(ally)));
  for (const allyUid of [...seeds.keys()]) if (!selected.has(allyUid)) clearReedFireSeed(unit, allyUid);
  if (!marked.length) return false;
  ensureReedFireSeedCleanup(battle, unit);
  const plan = supportPlans['char_1020_reed2'];
  const scorch = plan?.passives?.find((passive) => passive.action === 'applyStatus' && passive.params?.magicFragile != null);
  for (const ally of marked) {
    const allyUid = uid(ally);
    ally._supportReedFireSeedTimer?._supportFireSeedCleanup?.();
    clearReedFireSeed(unit, allyUid);
    const expiresAt = battle.time + duration;
    unit.mem.supportReedSeedGeneration = (unit.mem.supportReedSeedGeneration ?? 0) + 1;
    const seedKey = `${key}:${uid(unit)}:${allyUid}:${unit.mem.supportReedSeedGeneration}`;
    const attackBuffKey = `${seedKey}:attack`;
    let timer;
    const cleanup = () => {
      timer?.cancel();
      timer?._supportFireSeedExpiry?.cancel?.();
      battle.removeBuff(ally, attackBuffKey);
      if (ally._supportReedFireSeedTimer === timer) delete ally._supportReedFireSeedTimer;
      if (seeds.get(allyUid) === timer) seeds.delete(allyUid);
    };
    timer = battle.every(interval, () => {
      if (!active(unit) || !active(ally) || battle.time >= expiresAt - 1e-9) { cleanup(); return; }
      const enemy = enemies(battle, unit, { scope: 'field', count: 99, priority: 'exit' })[0];
      if (!enemy) return;
      const dealt = damage(battle, unit, enemy, {
        scale: v(body, params.atkScale), type: 'arts', isSkill: true, cause,
        sourceKey: seedKey, traitAlly: ally,
      });
    }, { owner: unit });
    timer._supportFireSeedExpiry = battle.after(duration, cleanup, { owner: unit });
    timer._supportFireSeedCleanup = cleanup;
    timer._supportFireSeedAttackBuffKey = attackBuffKey;
    seeds.set(allyUid, timer);
    ally._supportReedFireSeedTimer = timer;
    if (star >= 4) buff(battle, unit, ally, { key: attackBuffKey, mods: { atkMul: 1.1 }, duration, stacking: 'replace', cause });
  }
  return true;
}
function perform(battle,unit,body,effect,key,event,cause,extra={}) {
  if (unit.def?.charId === 'char_479_sleach' && effect.action === 'damage' && effect.target === 'bannerLandingEnemies') return performSleachBanner(battle, unit, body, effect, cause);
  const p=effect.params??{}; const resolvedTargets=targets(battle,unit,effect,event); let chosen=effect.action==='heal'&&(p.targets!=null||p.maxTargets!=null)?resolvedTargets.slice(0,scale(body,p,'targets',scale(body,p,'maxTargets',resolvedTargets.length))):resolvedTargets; let did=false;
  if(unit.def?.charId==='char_108_silent'&&effect.action==='summon'&&p.deviceId==='silent_medic_drone')return summonSilentDrone(battle,unit,body,key);
  if(unit.def?.charId==='char_112_siege'&&effect.action==='damage'&&effect.trigger==='skillResolve')chosen=siegeSkillEnemies(battle,unit,body);
  if(unit.def?.charId==='char_2025_shu' && effect.action==='heal' && effect.trigger==='skillResolve') {
    unit.mem ??= {}; unit.mem.assaultShuSkillRecipients=[];
    const recipients=shuSkillRecipients(battle,unit,body,p);
    for(const target of recipients) if(heal(battle,unit,target,{scale:scale(body,p,'healScale',0),cause})>0) unit.mem.assaultShuSkillRecipients.push(target);
    return unit.mem.assaultShuSkillRecipients.length>0;
  }
  if(unit.def?.charId==='char_4139_papyrs'&&effect.action==='heal'&&p.chainJumps!=null){const primary=resolvedTargets[0],module=unit.assaultSupportModules?.has('uniequip_002_papyrs')===true;if(primary){const jumps=scale(body,p,'chainJumps',1)+(module?1:0),rest=allies(battle,unit,{scope:'field',priority:'hp',count:99}).filter(x=>x!==unit&&x!==primary).sort((a,b)=>b.s.maxHp-a.s.maxHp||uid(a).localeCompare(uid(b)));chosen=[primary,...rest].slice(0,jumps);unit.mem??={};unit.mem.supportPapyrsSkillHealTargets=chosen;}}
  if(unit.def?.charId==='char_4056_titi'&&effect.trigger==='skillResolve') {
    if(effect.action==='damage') {unit.mem??={};unit.mem.supportTitiSkillHits=[];for(const target of chosen)if(damage(battle,unit,target,{scale:scale(body,p,'atkScale',0),type:'arts',isSkill:true,cause,sourceKey:key})>0)unit.mem.supportTitiSkillHits.push(target);return unit.mem.supportTitiSkillHits.length>0;}
    if(effect.action==='applyStatus'&&p.sleep!=null) {const prob=Math.min(1,scale(body,p,'prob',0));for(const target of unit.mem?.supportTitiSkillHits??[]){if(battle.rng()<prob)did=applyStatus(battle,unit,target,{status:'sleep',duration:scale(body,p,'sleep',0),key,cause})||did;}return did;}
  }
  if(unit.def?.charId==='char_1016_agoat2'&&effect.action==='heal'&&effect.trigger==='skillResolve') {for(const target of chosen)if(target.hp<target.s.maxHp)did=battle.assaultRuntime.withCause(cause,()=>battle.heal(unit,target,unit.s.atk*scale(body,p,'healScale',0),{skillHeal:true}))>0||did;return did;}
  const nativeRmixerStack=applyRmixerNativeStack(battle,unit,body,p,key,chosen);
  if(nativeRmixerStack!==null)return nativeRmixerStack;
  if(unit.def?.charId==='char_4148_philae'&&effect.action==='addBuff'&&p.epBarrier!=null){
    if(!chosen.includes(unit))return false;
    const duration=scale(body,p,'duration',0),basePool=scale(body,p,'epBarrier',0),module=unit.assaultSupportModules?.has('uniequip_002_philae')===true;
    if(!(duration>0&&basePool>0))return false;
    unit.mem??={};const generation=(unit.mem.supportPhilaeBarrierGeneration??0)+1;unit.mem.supportPhilaeBarrierGeneration=generation;
    unit.mem.philaeBarrier=basePool*(module?1.3:1);unit.mem.supportPhilaeBarrierExpires=battle.time+duration;
    battle.reduceElement(unit,1e12);
    const maxHp=scale(body,p,'maxHp',0);if(maxHp>0)buff(battle,unit,unit,{key,mods:{hpMul:1+maxHp},duration,stacking:'replace',cause});
    battle.after(duration,()=>{if(unit.mem?.supportPhilaeBarrierGeneration===generation){unit.mem.philaeBarrier=0;unit.mem.supportPhilaeBarrierExpires=0;}},{owner:unit});
    return true;
  }
  switch(effect.action){
    case 'damage': { let amount=scale(body,p,'scale',scale(body,p,'atkScale',scale(body,p,'magicAtkScale',1)))*(extra.damageMul??1);if(unit.def?.charId==='char_431_ashlok'&&p.splash!=null&&unit.assaultSupportModules?.has('uniequip_002_ashlok'))amount*=1+moduleValue(body,'uniequip_002_ashlok','a',{percent:true});const isVendlaCounter=unit.def?.charId==='char_494_vendla'&&effect.trigger==='shelteredAllyAttacked'&&event?.source?.side==='enemy'&&event?.target?.side==='ally';if(isVendlaCounter&&unit.assaultSupportModules?.has('uniequip_002_vendla'))amount=0.8;const typ=p.dmgType??(p.magicAtkScale!=null?'arts':'phys'); const selected=chosen.slice(0,scale(body,p,'targets',scale(body,p,'maxTargets',chosen.length)));for(const t of selected){const proc=scale(body,p,'prob',1);if(proc<1&&battle.rng()>=proc)continue;let prob=scale(body,p,'stunProb',p.stun!=null?1:0);if(unit.def?.charId==='char_107_liskam'&&p.stunProb!=null&&unit.assaultSupportModules?.has('uniequip_002_liskam'))prob=Math.min(1,prob+0.1);if(unit.def?.charId==='char_311_mudrok'&&key==='assault:char_311_mudrok:skill:1'&&unit.assaultSupportModules?.has('uniequip_003_mudrok'))prob=Math.min(1,prob+0.1);const traitAlly=isVendlaCounter?event.target:undefined;const dealt=damage(battle,unit,t,{...(unit.def?.charId==='char_381_bubble'&&effect.trigger==='attackedWhileSkillActive'&&p.defScale!=null?{amount:unit.s.def*scale(body,p,'defScale',0)}:{scale:amount}),hits:scale(body,p,'hits',scale(body,p,'extraHits',1)),type:typ,isSkill:true,cause,sourceKey:key,traitAlly});if(dealt>0&&prob>0&&(prob>=1||battle.rng()<prob))applyStatus(battle,unit,t,{status:'stun',duration:scale(body,p,'stun',0.5),key:`${key}:stun`,cause});if(dealt>0){if(isVendlaCounter&&unit.assaultSupportModules?.has('uniequip_002_vendla'))heal(battle,unit,unit,{amount:dealt*0.2,sourceKey:key,cause});for(const status of ['cold','sluggish']){const duration=scale(body,p,status,0);if(duration>0)applyStatus(battle,unit,t,{status,duration,key:status,cause});}if(scale(body,p,'reveal',0)>0){const duration=scale(body,p,'revealDuration',scale(body,p,'cold',0));if(!(duration>0))throw new Error(`${key} reveal requires an explicit duration`);applyStatus(battle,unit,t,{status:'reveal',duration,key:'reveal',cause});}}did=dealt>0||did;}return did; }
    case 'heal': { for(const t of chosen){if(!t.alive)continue;if(t.hp<t.s.maxHp){const baseRaw=scale(body,p,'healScale',scale(body,p,'healRatio',scale(body,p,'healPerSec',scale(body,p,'scale',0)))),chainIndex=unit.def?.charId==='char_4139_papyrs'?(unit.mem?.supportPapyrsSkillHealTargets?.indexOf(t)??-1):-1,decay=unit.assaultSupportModules?.has('uniequip_002_papyrs')?0.2:0.25,raw=chainIndex>=0?baseRaw*powi(1-decay,chainIndex):baseRaw;if(raw>0)did=heal(battle,unit,t,{scale:raw,cause})>0||did;else{const ratio=scale(body,p,'maxHpRatio',0);if(ratio>0)did=heal(battle,unit,t,{maxHpRatio:ratio,cause})>0||did;}}if(unit.def?.charId==='char_4042_lumen'&&p.cleanse!=null){const module=unit.assaultSupportModules?.has('uniequip_002_lumen')===true,limit=Math.max(1,scale(body,p,'cleanse',1));unit.mem??={};unit.mem.supportLumenCleanses??=0;for(const target of chosen){let removed=0;for(const b of [...target.buffs??[]]){if(removed>=limit)break;if(b.status&&b.status!=='resist'){battle.removeBuff(target,b.key);removed++;}}/* 纯铜单筒望远镜: each removed status charges {a}, first 5 per battle. */for(let i=0;module&&i<removed&&unit.mem.supportLumenCleanses<5;i++){unit.mem.supportLumenCleanses++;sp(battle,unit,unit,moduleValue(unit,'uniequip_002_lumen','a'),'module:lumen:cleanse',`assault:module:uniequip_002_lumen:sp`,cause);}}}if(p.epHealScale!=null){const module=unit.def?.charId==='char_4114_harold'&&unit.assaultSupportModules?.has('uniequip_002_harold'),before=Math.max(0,...Object.values(t.elem??{}).map(n=>Number.isFinite(n)?n:0)),trait=unit.profile?.heal?.elementHealRatio??0.5,amount=unit.s.atk*scale(body,p,'epHealScale',0)*trait*(module?1+moduleValue(body,'uniequip_002_harold','a',{percent:true}):1);if(amount>0&&before>0){battle.reduceElement(t,amount);const after=Math.max(0,...Object.values(t.elem??{}).map(n=>Number.isFinite(n)?n:0));if(module&&after<=0&&before>0){unit.mem??={};unit.mem.supportHaroldModuleClears??=new Set();if(!unit.mem.supportHaroldModuleClears.has(uid(t))){unit.mem.supportHaroldModuleClears.add(uid(t));did=heal(battle,unit,t,{maxHpRatio:0.05,cause})>0||did;}}}}}if(unit.def?.charId==='char_423_blemsh'&&unit.assaultSupportModules?.has('uniequip_002_blemsh')){const extra=allies(battle,unit,{scope:'adjacent8',priority:'hp',count:99}).find(x=>!chosen.includes(x));if(extra&&extra.alive){const raw=scale(body,p,'healScale',scale(body,p,'healRatio',scale(body,p,'healPerSec',scale(body,p,'scale',0))));/* 工匠团的回响: one more heal target (the 4-star sleeping-target +30% was removed). */if(raw>0&&extra.hp<extra.s.maxHp)did=heal(battle,unit,extra,{scale:raw,cause})>0||did;}}return did; }
    case 'economy': {const n=scale(body,p,'costGain',scale(body,p,'initCost',0));if(n>0)gainDP(battle,unit,n,key,cause);return n>0;}
    case 'addBuff': {if(unit.def?.charId==='char_4139_papyrs'&&p.barrierScale!=null){for(const t of chosen){const primary=unit.mem?.supportPapyrsSkillHealTargets?.[0],modulePrimary=unit.assaultSupportModules?.has('uniequip_002_papyrs')&&t===primary,value=unit.s.atk*scale(body,p,'barrierScale',0)*(modulePrimary?2:1),existing=t.buffs?.find(x=>x.key===key);if(value>0)battle.addBuff(t,{key,shield:Math.max(value,existing?.shield??0),duration:scale(body,p,'duration',8),refresh:'replace',source:unit,visible:true,tags:['talent']});}return chosen.length>0;}if(unit.def?.charId==='char_4194_rmixer'&&p.maxStacks!=null){if(!chosen.includes(unit))return false;battle.addBuff(unit,{key,duration:scale(body,p,'duration',10),refresh:'stack',maxStacks:scale(body,p,'maxStacks',3),mods:{defFlat:scale(body,p,'def',0),aspd:scale(body,p,'attackSpeed',0)},source:unit,tags:['talent']});return true;}if(unit.def?.charId==='char_1016_agoat2'&&p.epBarrierScale!=null){const moduleBarrier=unit.assaultSupportModules?.has('uniequip_003_agoat2')===true,star=unit.assaultStar??unit.input_piece?.star??unit.inputPiece?.star??1,pool=unit.s.atk*v(body,p.epBarrierScale)*(moduleBarrier?1+moduleValue(body,'uniequip_003_agoat2','a',{percent:true}):1),duration=scale(body,p,'duration',0),expires=battle.time+duration;unit.mem??={};unit.mem.supportAgoatBarrierStates=new Map(chosen.map(t=>[uid(t),{left:pool,pool,expires,duration}]));if(!unit.mem.supportAgoatBarrierHook){unit.mem.supportAgoatBarrierHook=true;battle.on('elementHit',entry=>{const ctx=entry.payload??entry,target=ctx.target,dmg=ctx.dmg,targetUid=target?uid(target):null,state=targetUid==null?null:unit.mem.supportAgoatBarrierStates?.get(targetUid);if(!state||state.left<=1e-9||battle.time>=state.expires||!dmg||dmg.type!=='element'||dmg.cancel)return;const total=dmg.amount*(dmg.mul??1);if(!(total>0))return;const absorbed=Math.min(state.left,total);state.left-=absorbed;if(absorbed>=total-1e-9)dmg.cancel=true;else dmg.mul*=Math.max(0,(total-absorbed)/total);},{owner:unit,priority:-50});}return pool>0&&duration>0;}const mods={};for(const [input,out] of Object.entries(STAT))if(p[input]!=null){let n=v(body,p[input]);if(unit.def?.charId==='char_171_bldsk'&&input==='atk'&&unit.assaultSupportModules?.has('uniequip_002_bldsk'))n+=moduleValue(unit,'uniequip_002_bldsk','a',{percent:true});mods[out]=input==='atk'||input==='def'||input==='maxHp'?1+n:n;}if(p.dodge!=null){const n=v(body,p.dodge);mods.dodgePhys=n;mods.dodgeArts=n;}if(p.physDodge!=null)mods.dodgePhys=v(body,p.physDodge);if(p.attackSpeed!=null)mods.aspd=v(body,p.attackSpeed);if(p.healAmp!=null)mods.healingTakenMul=1+v(body,p.healAmp);if(p.healReceived!=null)mods.healingTakenMul=1+v(body,p.healReceived);if(!Object.keys(mods).length)throw new Error(`${unit.defId} typed buff ${key} has no stat`);const duration=scale(body,p,'duration',Infinity);for(const t of chosen)buff(battle,unit,t,{key,mods,duration,stacking:'replace',cause});return chosen.length>0;}
    case 'applyStatus': {const charId=unit.def?.charId;if(p.healAmp!=null||p.healReceived!=null){const amount=p.healAmp!=null?scale(body,p,'healAmp',0):scale(body,p,'healReceived',0),duration=scale(body,p,'duration',8)+(charId==='char_4163_rosesa'&&unit.assaultSupportModules?.has('uniequip_002_rosesa')?4:0);for(const t of chosen)buff(battle,unit,t,{key,mods:{healingTakenMul:1+amount},duration,stacking:'replace',cause});return chosen.length>0;}const status=p.status==='sleep'||p.sleep!=null?'sleep':p.stun!=null?'stun':p.slow!=null?'slow':p.fear!=null?'fear':p.dotScale!=null?'burn':p.status==='taunt'||p.tauntLevel!=null?'taunt':null;if(charId==='char_381_bubble'&&p.tauntLevel!=null&&p.def!=null){const duration=scale(body,p,'duration',20);for(const t of chosen){applyStatus(battle,unit,t,{status:'taunt',duration,value:scale(body,p,'tauntLevel',1),key:`${key}:taunt`,cause});buff(battle,unit,t,{key,mods:{defMul:1+scale(body,p,'def',0)},duration,stacking:'replace',cause});}return chosen.length>0;}if(charId==='char_381_bubble'&&p.atkDown!=null){for(const t of chosen)applyStatus(battle,unit,t,{status:'weaken',duration:scale(body,p,'duration',5),value:Math.abs(scale(body,p,'atkDown',0)),key:`${key}:weaken`,cause});return chosen.length>0;}if(charId==='char_1020_reed2'&&p.atkDown!=null&&p.magicFragile!=null){let applied=false;const rank=unit.assaultStar??unit.input_piece?.star??unit.inputPiece?.star??1,module=unit.assaultSupportModules?.has('uniequip_002_reed2'),prob=module&&rank>=3?0.5:scale(body,p,'prob',1);for(const t of chosen){if(battle.rng()>=prob)continue;const duration=scale(body,p,'duration',6);applyStatus(battle,unit,t,{status:'weaken',duration,value:-scale(body,p,'atkDown',0),key:key+':weaken',cause});applyStatus(battle,unit,t,{status:'artsFragile',duration,value:scale(body,p,'magicFragile',0),key:key+':artsFragile',cause});if(module&&rank>=4)buff(battle,unit,t,{key:'assault:module:uniequip_002_reed2:scorchVuln',mods:{artsTakenMul:1.05},duration,stacking:'replace',cause});applied=true;}return applied;}if(charId==='char_401_elysm'){let did=false;for(const t of chosen){if(p.slow!=null)did=applyStatus(battle,unit,t,{status:'slow',duration:scale(body,p,'duration',1),value:scale(body,p,'slow',1),key:`${key}:slow`,cause})||did;if(p.reveal!=null)applyStatus(battle,unit,t,{status:'reveal',duration:scale(body,p,'duration',1),key:`${key}:reveal`,cause});if(p.defDown!=null)buff(battle,unit,t,{key:`${key}:defDown`,mods:{defMul:1-scale(body,p,'defDown')},duration:scale(body,p,'duration',1),cause});}return chosen.length>0||did;}if(charId==='char_4017_puzzle'&&p.dotScale!=null){const duration=scale(body,p,'duration',1);if(unit.assaultSupportModules?.has('uniequip_002_puzzle'))for(const t of chosen){t.mem??={};const live=(t.mem.supportPuzzleMarkExpires??-Infinity)>battle.time,stacks=Math.min(10,(live?t.mem.supportPuzzleMarks??0:0)+1);t.mem.supportPuzzleMarks=stacks;t.mem.supportPuzzleMarkExpires=battle.time+duration;buff(battle,unit,t,{key:'assault:module:uniequip_002_puzzle:mark',mods:{defMul:1-stacks*0.01},duration,stacking:'replace',cause});}let elapsed=0;let timer;timer=battle.every(1,()=>{if(elapsed>=duration){timer.cancel();return;}elapsed+=1;for(const t of chosen.filter(active))damage(battle,unit,t,{scale:v(body,p.dotScale),type:'arts',isSkill:true,cause,sourceKey:key});},{owner:unit});return chosen.length>0;}if(charId==='char_171_bldsk'&&p.hpDrainPerSec!=null){let elapsed=0;let timer;timer=battle.every(1,()=>{if(!active(unit)||elapsed>=scale(body,p,'duration',1)){timer.cancel();return;}elapsed+=1;for(const t of enemies(battle,unit,{scope:'range',count:99}))damage(battle,unit,t,{amount:unit.s.maxHp*scale(body,p,'hpDrainPerSec'),type:'arts',isSkill:true,cause,sourceKey:key});},{owner:unit});return true;}if(p.status==='resist'){const duration=scale(body,p,'resistSec',1),value=scale(body,p,'statusDurationMultiplier',0.5);for(const t of chosen)applyStatus(battle,unit,t,{status:'resist',duration,value,key,cause});return chosen.length>0;}if(!status)throw new Error(`${unit.defId} has no explicit typed status mapping for ${key}`);const duration=scale(body,p,status==='stun'?'stun':status==='sleep'?'sleep':status==='fear'?'fear':'duration',1);for(const t of chosen){applyStatus(battle,unit,t,{status,duration,value:scale(body,p,'value',status==='slow'?1-scale(body,p,'slow',0):scale(body,p,'tauntLevel',1)),key,cause});if(charId==='char_494_vendla'&&p.tauntLevel!=null){unit.mem??={};unit.mem.supportVendlaShelteredUntil??=new Map();unit.mem.supportVendlaShelteredUntil.set(uid(t),battle.time+duration);if(p.atk!=null)buff(battle,unit,t,{key:`${key}:atk`,mods:{atkMul:1+scale(body,p,'atk',0)},duration,stacking:'replace',cause});}}return chosen.length>0;}
    case 'spGain': {const n=scale(body,p,'spGain',scale(body,p,'spPerSec',0));for(const t of chosen)if(n>0)did=sp(battle,unit,t,n,key,key,cause)>0||did;return did;}
    case 'haste': {const duration=scale(body,p,'duration',5);for(const t of chosen)haste(battle,unit,t,duration,key,{cause});return chosen.length>0;}
    case 'summon': {const id=SUPPORT_TOKEN_IDS[p.deviceId]??(unit.def?.charId==='char_427_vigil'?SUPPORT_TOKEN_IDS.vigil_wolfpack:p.deviceId);if(!id)throw new Error(`${unit.defId} typed summon missing tokenId`);const n=scale(body,p,'count',scale(body,p,'wolfShadows',scale(body,p,'shadows',1))),cap=p.maxShadows!=null?scale(body,p,'maxShadows',3):(id===SUPPORT_TOKEN_IDS.jesca2_mobile_shield?1:3),duration=p.duration!=null?scale(body,p,'duration',0):undefined,moduleDuration=id===SUPPORT_TOKEN_IDS.jesca2_mobile_shield&&unit.assaultSupportModules?.has('uniequip_002_jesca2')?10:0,receipt=grantSummon(battle,unit,{tokenId:id,count:n,stockCap:cap,fieldCap:cap,duration:duration==null?undefined:duration+moduleDuration,ruleKey:key,kit:supportTokenKits[id]});if(id===SUPPORT_TOKEN_IDS.vigil_wolfpack){const blockCnt=scale(body,p,'blockPerShadow',1);for(const token of battle.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===unit&&x.defId===id&&x.base.blockCnt!==blockCnt)){token.base.blockCnt=blockCnt;token.markDirty();}}return receipt.granted>0;}
    case 'redeploy': return performRedeploy(battle,unit,body,p,cause,extra);
    case 'ammo': {if(unit.def?.charId==='char_4039_horn')return reloadHornAmmo(battle,unit,scale(body,p,'rounds',10),key);const skill=unit.skill;if(!skill)throw new Error(`${unit.defId} ammo effect has no native skill state`);const rounds=scale(body,p,'rounds',0);if(rounds>0){skill.ammoMax=Math.max(skill.ammoMax??0,rounds);if(!unit._assaultAmmoController)registerAssaultAmmo(battle,unit,{get:()=>skill.ammoLeft,set:n=>{skill.ammoLeft=n;},max:()=>skill.ammoMax??0});const state=assaultAmmoState(unit);reloadAssaultAmmo(battle,unit,unit,Math.max(0,state.capacity-state.current),key);}const mods={},flags={};for(const [from,to] of Object.entries(STAT))if(p[from]!=null)mods[to]=from==='atk'||from==='def'?1+v(body,p[from]):v(body,p[from]);if(p.atkScale!=null)mods.atkMul=v(body,p.atkScale);if(p.stealth!=null)flags.stealth=!!v(body,p.stealth);if(Object.keys(mods).length||Object.keys(flags).length)buff(battle,unit,unit,{key:`${key}:ammo`,mods,flags,duration:scale(body,p,'duration',20),cause});return rounds>0||Object.keys(mods).length>0||Object.keys(flags).length>0;}
    case 'device': {if(p.deviceId!=='shu_seed_plot'||unit.def?.charId!=='char_2025_shu')throw new Error(`${unit.defId} lacks typed device handler ${p.deviceId}`);return unit.mem?.assaultShuSow?.(effect.trigger==='skillResolve'?(unit.mem.assaultShuSkillRecipients??[]):(event?.target?[event.target]:[]),p)??false;}
    case 'nativeMechanism': {
      const charId=unit.def?.charId;
      if(charId==='char_290_vigna')return true;
      if(charId==='char_4222_taraxa'){buff(battle,unit,unit,{key,mods:{aspd:v(body,p.attackSpeed)},duration:scale(body,p,'duration',12),cause});return true;}
      if(charId==='char_4087_ines'){const target=chosen[0];if(!target)return false;unit._assaultStolenAspd=Math.min(scale(body,p,'maxSteal',60),(unit._assaultStolenAspd??0)+scale(body,p,'stealAttackSpeed',7));buff(battle,unit,unit,{key:`${key}:steal`,mods:{aspd:unit._assaultStolenAspd},duration:Infinity,stacking:'replace',cause});gainDP(battle,unit,scale(body,p,'costGain',1),key,cause);return true;}
      if(charId==='char_249_mlyss'){
        const duration=scale(body,p,'duration',15),flowshapes=battle.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===unit&&active(x));
        for(const t of [...new Set([unit,...flowshapes])])buff(battle,unit,t,{key,mods:{atkMul:1+v(body,p.atk)},duration,cause});
        // The real skillResolved observer resamples first, then explicitly refreshes
        // ranged flow HP. Copying a melee template never silently heals it.
        return true;
      }
      if(charId==='char_1020_reed2')return applyReedFireSeeds(battle,unit,body,p,key,reedFireSeedRecipients(battle,unit,body,p,event),cause);
      if(charId==='char_4194_rmixer'){const need=scale(body,p,'ammoRequired',20),used=consumeAssaultAmmo(battle,unit,scale(body,p,'consume',20),key,{isSkill:true});return used===need;}
      if(charId==='char_2026_yu'){const module=[...(unit.assaultSupportModules??[])].map(id=>MAIN_MODULE_EFFECTS[id]).find(x=>x?.charId===charId),blockedDefDown=module?moduleValue(body,'uniequip_002_yu','b',{percent:true}):0;/* 人间百味: burn +3% ATK and blocked enemies DEF -{b}% from 3 stars (the 4-star protect +5% was removed). */for(const t of chosen)if(t===unit)buff(battle,unit,unit,{key:`${key}:self`,mods:{dmgTakenMul:1-scale(body,p,'protect',0)},duration:1.1,stacking:'replace',cause});for(const t of chosen.filter(x=>x!==unit&&x.side==='enemy')){if(blockedDefDown>0)buff(battle,unit,t,{key:`${key}:moduleDefDown`,mods:{defMul:1-blockedDefDown},duration:1.1,stacking:'replace',cause});const raw=unit.s.atk*scale(body,p,'magicPerSec',0);damage(battle,unit,t,{amount:raw*(1+scale(body,p,'burnRatio',0))+unit.s.atk*(module?.burnAdd??0),type:'arts',isSkill:false,cause,sourceKey:key});}return chosen.length>0;}
      throw new Error(`${unit.defId} requires an explicit typed handler for ${key}`);
    }
    case 'move': {const charId=unit.def?.charId;const selected=chosen.filter(x=>x.side==='enemy').slice(0,scale(body,p,'maxTargets',chosen.length));if(charId==='char_2026_yu'){let moved=false;for(const target of selected)moved=battle.assaultTeleportEnemy(target,unit)||moved;return moved;}if(charId==='char_496_wildmn'){const module=unit.assaultSupportModules?.has('uniequip_002_wildmn')===true,force=scale(body,p,'forceLevel',1);for(const target of selected){if(!module){battle.push(target,force,{from:unit,effect:true});continue;}const result=battle.assaultPushEnemy(target,unit,force,{from:unit,effect:true,extraDistance:1}),collision=result?.collision;if(collision){target.mem??={};target.mem.assaultWildmnModuleHits??=new Set();if(!target.mem.assaultWildmnModuleHits.has(uid(unit))){target.mem.assaultWildmnModuleHits.add(uid(unit));damage(battle,unit,target,{scale:1,type:'phys',cause,sourceKey:`${key}:module-obstacle`});}}}return selected.length>0;}throw new Error(`${unit.defId} requires typed movement handler for ${key}`);}
    case 'modifyTag': {const charId=unit.def?.charId;if(charId==='char_151_myrtle'){const mods={};if(p.blockCnt!=null)mods.blockCnt=v(body,p.blockCnt);buff(battle,unit,unit,{key,duration:scale(body,p,'duration',3),mods});return true;}if(charId==='char_220_grani'&&p.attackAllBlocked!=null){const previous=unit.profile.hitAllBlocked;unit.profile.hitAllBlocked=!!v(body,p.attackAllBlocked);battle.after(scale(body,p,'duration',30),()=>{unit.profile.hitAllBlocked=previous;},{owner:unit});return true;}throw new Error(`${unit.defId} lacks typed tag mutation for ${key}`);}
    default: throw new Error(`unsupported support action ${effect.action}`);
  }
}
// A natural cast whose skill strikes enemies (damage, or any effect aimed at enemies) waits until at least one of
// those effects has an enemy to act on; its DP / redeploy / self or ally parts never fire it into an empty range on
// their own. Same rule as 推进之王 / 忍冬 above and the assault.js family (a damage effect needs a target).
const OFFENSIVE_TARGET=/Enem/;
function offensiveReady(battle,unit,effects,body){
  const offensive=effects.filter(e=>e.trigger==='skillResolve'&&e.action!=='economy'&&(e.action==='damage'||OFFENSIVE_TARGET.test(String(e.target??''))));
  return !offensive.length||offensive.some(e=>canPerform(battle,unit,e,body));
}
function canPerform(battle,unit,effect,body){
  if(unit.def?.charId==='char_108_silent'&&effect.action==='summon')return silentFront(battle,unit).legal;
  if(unit.def?.charId==='char_112_siege')return effect.action==='damage'&&effect.trigger==='skillResolve'&&siegeSkillEnemies(battle,unit,body).length>0;
  if(unit.def?.charId==='char_2025_shu')return effect.trigger==='skillResolve'&&effect.action==='heal'&&shuSkillRecipients(battle,unit,body,effect.params??{}).length>0;
  if(unit.def?.charId==='char_1020_reed2')return effect.trigger==='skillResolve'&&reedFireSeedRecipients(battle,unit,body,effect.params??{},null).length>0;
  if(effect.action==='economy'||effect.action==='summon'||effect.action==='redeploy'||effect.action==='ammo')return true;
  const selected=targets(battle,unit,effect,null);
  if(effect.action==='heal')return selected.some(x=>x.alive&&x.hp<x.s.maxHp);
  if(effect.action==='addBuff'||effect.action==='haste')return selected.some(active);
  return selected.length>0;
}
function repeatEffect(battle,unit,body,effect,key,cause){
  const params=effect.params??{};let duration=scale(body,params,'duration',0);if(unit.def?.charId==='char_181_flower'&&unit.assaultSupportModules?.has('uniequip_002_flower'))duration+=2;if(unit.def?.charId==='char_128_plosis'&&unit.assaultSupportModules?.has('uniequip_002_plosis'))duration+=unit.assaultStar>=4?4:2;if(!(duration>0))throw new Error(`${unit.defId} periodic effect ${key} has no duration`);
  unit._supportPeriodic??=new Map();unit._supportPeriodic.get(key)?.cancel();
  let left=duration;const schedule=battle.every(1,(_b)=>{if(!active(unit)||left<=0){schedule.cancel();unit._supportPeriodic.delete(key);return;}left-=1;perform(battle,unit,body,effect,key,null,cause);},{owner:unit});unit._supportPeriodic.set(key,schedule);
}
function applyDpStack(battle,unit,body,effect,key){
  const p=effect.params??{},max=scale(body,p,'maxStacks',1),interval=scale(body,p,'rechargeSec',0),now=battle.time;
  unit._assaultDpStacks??=new Map();const state=unit._assaultDpStacks.get(key)??{stacks:0,lastAt:-Infinity};
  if(state.stacks>=max||now-state.lastAt+1e-9<interval)return false;
  state.stacks++;state.lastAt=now;unit._assaultDpStacks.set(key,state);
  const atk=scale(body,p,'atk',0);
  if(atk)buff(battle,unit,unit,{key,mods:{atkMul:1+atk*state.stacks},duration:Infinity,stacking:'replace'});
  return true;
}
function sleachBannerHome(battle, unit) {
  const [dr, dc] = dirVec(unit.dir), row = unit.tileR + dr, col = unit.tileC + dc;
  const legal = (r, c) => battle.grid.inRect(r, c) && battle.grid.isLow(r, c) && !battle.grid.isObstacle(r, c);
  if (legal(row, col)) return [row, col];
  return legal(unit.tileR, unit.tileC) ? [unit.tileR, unit.tileC] : null;
}
function sleachApplyFlagStatus(battle, unit, target, { status, duration, value = 1, key, cause } = {}) {
  return battle.assaultRuntime.withCause(cause, () => battle.applyStatus(target, status, { duration, value, instanceKey: key, source: unit, resistApplied: true }));
}
function sleachFlagKeys(unit, flag) { return new Set(absoluteRangeKeys(SLEACH_X4, flag.r, flag.c, unit.dir, 0)); }
function sleachPlaceHeldBanner(battle, unit) {
  const tile = sleachBannerHome(battle, unit);
  unit.mem ??= {};
  if (!tile) { unit.mem.sleachFlag = null; return false; }
  const [r, c] = tile;
  unit.mem.sleachFlag = { r, c, kind: 'held', source: 'assault:sleach:banner', generation: (unit.mem.sleachBannerGeneration ?? 0) };
  return true;
}
function performSleachBanner(battle, unit, body, effect, cause) {
  const p = effect.params ?? {}, [r, c] = sleachS3Tile(battle, unit, SLEACH_R21);
  const duration = scale(body, p, 'duration', 10), atk = unit.s.atk, atkScale = scale(body, p, 'atkScale', 1), stun = scale(body, p, 'stun', 0);
  unit.mem ??= {}; unit.mem.sleachBannerGeneration = (unit.mem.sleachBannerGeneration ?? 0) + 1;
  const generation = unit.mem.sleachBannerGeneration;
  const flag = { r, c, kind: 'thrown', source: 'assault:sleach:banner', generation, expiresAt: battle.time + duration };
  unit.mem.sleachFlag = flag;
  unit.mem.sleachSync?.();
  battle.fx('zone', { x: c, y: r, radius: 1.5, dur: duration, id: unit.id, skill: 'sleach:flag' });
  const keys = sleachFlagKeys(unit, flag);
  battle.after(SLEACH_FLAG_FLIGHT, () => {
    if (battle.finished || !active(unit) || unit.mem?.sleachFlag?.generation !== generation) return;
    battle.fx('aoe', { x: c, y: r, radius: 1.5, id: unit.id, skill: 'sleach:strike' });
    for (const enemy of battle.enemiesInKeys([...keys], unit, { ...unit.profile, canHitFly: true })) {
      if (!enemy.alive) continue;
      damage(battle, unit, enemy, { amount: atk * atkScale, type: 'phys', isSkill: true, sourceKey: 'assault:char_479_sleach:skill:1', cause });
      if (enemy.alive && stun > 0) applyStatus(battle, unit, enemy, { status: 'stun', duration: stun, cause });
    }
  }, { owner: unit });
  battle.after(duration, () => { if (unit.mem?.sleachFlag?.generation === generation) { unit.mem.sleachFlag = null; unit.mem.sleachSync?.(); } }, { owner: unit });
  return true;
}
function installSleachBanner(battle, unit, body, star) {
  const params = supportPlans['char_479_sleach'].talents[0]?.parameters ?? {};
  const module002 = unit.assaultSupportModules?.has('uniequip_002_sleach') === true && star >= 3;
  const module003 = unit.assaultSupportModules?.has('uniequip_003_sleach') === true && star >= 3;
  const allyAspd = (params.allyAttackSpeed?.[star - 1] ?? 0) + (module002 ? moduleValue(body, 'uniequip_002_sleach', 'a') : 0);
  const enemyAspd = params.enemyAttackSpeed?.[star - 1] ?? 0;
  const sourceId = uid(unit), baseKey = `assault:char_479_sleach:${sourceId}:talent:banner`;
  const allyKey = `${baseKey}:ally`, enemyKey = `${baseKey}:enemy`, physKey = 'assault:char_479_sleach:talent:banner:phys:shared';
  const statusKeys = (target) => [`${baseKey}:sluggish:${uid(target)}`, `${baseKey}:fragile:${uid(target)}`];
  let covered = new Map();
  const refreshPhysical = (target) => {
    const sources = battle.allyUnits.filter(source => {
      const flag = source.mem?.sleachFlag;
      if (source.kind !== 'op' || source.def?.charId !== 'char_479_sleach' || !active(source) || (source.assaultStar ?? source.input_piece?.star ?? 1) < 4 || !flag || (flag.expiresAt != null && battle.time >= flag.expiresAt - 1e-9)) return false;
      const keys = sleachFlagKeys(source, flag);
      return bodyInKeys(target, keys) && battle.enemiesInKeys([...keys], source, { canHitFly: true }).includes(target);
    }).sort((a,b) => (b.assaultStar ?? b.input_piece?.star ?? 1) - (a.assaultStar ?? a.input_piece?.star ?? 1) || String(uid(a)).localeCompare(String(uid(b))));
    if (!sources.length) { battle.removeBuff(target, physKey); return; }
    buff(battle, sources[0], target, { key: physKey, mods: { physTakenMul: 1.08 }, duration: 0.25, stacking: 'replace', cause: battle.assaultRuntime.currentCause });
  };
  const removeCoverage = () => {
    for (const target of covered.values()) {
      battle.removeBuff(target, allyKey); battle.removeBuff(target, enemyKey);
      for (const key of statusKeys(target)) battle.removeBuff(target, key);
      if (target.side === 'enemy') refreshPhysical(target);
    }
    covered = new Map();
  };
  const clear = () => { unit.mem ??= {}; unit.mem.sleachFlag = null; removeCoverage(); };
  const sync = () => {
    if (!active(unit)) { if (unit.mem?.sleachFlag || covered.size) clear(); return; }
    let flag = unit.mem?.sleachFlag;
    if (flag?.kind === 'thrown' && battle.time + 1e-9 < flag.expiresAt) { /* preserve the live thrown anchor */ }
    else {
      const [r, c] = sleachBannerHome(battle, unit) ?? [unit.tileR, unit.tileC];
      if (!flag || flag.kind !== 'held' || flag.r !== r || flag.c !== c) sleachPlaceHeldBanner(battle, unit);
      flag = unit.mem.sleachFlag;
    }
    if (!flag) { removeCoverage(); return; }
    const keys = sleachFlagKeys(unit, flag), next = new Map();
    if (allyAspd) for (const ally of battle.allyUnits) {
      if (ally.kind !== 'op' || !active(ally) || !battle.allySelectable(ally, unit) || !bodyInKeys(ally, keys)) continue;
      buff(battle, unit, ally, { key: allyKey, mods: { aspd: allyAspd }, duration: 0.25, stacking: 'replace', cause: battle.assaultRuntime.currentCause }); next.set(uid(ally), ally);
    }
    for (const enemy of battle.enemiesInKeys([...keys], unit, { ...unit.profile, canHitFly: true })) {
      if (enemyAspd) buff(battle, unit, enemy, { key: enemyKey, mods: { aspd: enemyAspd }, duration: 0.25, stacking: 'replace', cause: battle.assaultRuntime.currentCause });
      refreshPhysical(enemy);
      if (flag.kind === 'thrown') {
        sleachApplyFlagStatus(battle, unit, enemy, { status: 'sluggish', duration: 0.35, key: statusKeys(enemy)[0], cause: battle.assaultRuntime.currentCause });
        const fragile = scale(body, supportPlans['char_479_sleach'].skill.effects[1].params, 'fragile', 0);
        if (fragile > 0) sleachApplyFlagStatus(battle, unit, enemy, { status: 'fragile', duration: 0.35, value: fragile, key: statusKeys(enemy)[1], cause: battle.assaultRuntime.currentCause });
      }
      next.set(uid(enemy), enemy);
    }
    for (const [id, target] of covered) if (!next.has(id)) {
      battle.removeBuff(target, allyKey); battle.removeBuff(target, enemyKey);
      for (const key of statusKeys(target)) battle.removeBuff(target, key);
      if (target.side === 'enemy') refreshPhysical(target);
    }
    covered = next;
  };
  unit.mem ??= {};
  unit.mem.sleachSync = sync;
  if (active(unit)) sleachPlaceHeldBanner(battle, unit);
  battle.on('deploy', event => { const ctx = event.payload ?? event; if (ctx.unit === unit && active(unit)) { if (unit.mem?.sleachFlag?.kind !== 'thrown') sleachPlaceHeldBanner(battle, unit); sync(); } }, { owner: unit });
  battle.on('retreating', event => { const ctx = event.payload ?? event; if (ctx.unit === unit) clear(); }, { owner: unit });
  battle.on('death', event => { const ctx = event.payload ?? event; if (ctx.unit === unit) clear(); }, { owner: unit });
  sync();
  battle.every(TICK, sync, { owner: unit });
}


function build(charId,raw,def){
  const basePlan=supportPlans[charId];const body=raw?.assaultBody??def?.raw?.assaultBody;if(!basePlan||!body?.fixedSkill)throw new Error(`incomplete compiled support body ${charId}`);
  const single=isSupportSingleCast(body);
  const plan=single?{...basePlan,skill:{trigger:'spFull',effects:body.fixedSkill.effects.map((effect,index)=>({index,action:effect.action,trigger:'skillResolve',target:effect.target,params:effect.values}))}}:basePlan;
  const runtimeBody={...body,raw:{assaultPiece:raw.assaultPiece,assaultBody:body},input_piece:raw.assaultPiece};
  const moduleChoice=raw.assaultPiece?.moduleChoices?.[charId];if(raw.assaultPiece?.moduleChoices!=null&&(!raw.assaultPiece.moduleChoices||typeof raw.assaultPiece.moduleChoices!=='object'||Array.isArray(raw.assaultPiece.moduleChoices)))throw new Error(`${charId} moduleChoices must be keyed by body charId`);if(moduleChoice!=null&&typeof moduleChoice!=='string')throw new Error(`${charId} module choice must be one moduleId string`);const candidate=moduleChoice?supportModuleHandlers[moduleChoice]:null;const star=raw.assaultPiece?.star??1;const selected=candidate?.charId===charId&&star>=candidate.unlockStar?candidate:null;const moduleHandler=selected&&!selected.delegatedToMain?selected:null;const chosenModules=selected?[moduleChoice]:[];
  const settlePassives = (ctx) => {for(const e of plan.passives.filter(x=>x.trigger==='skillSettled')){if(supportBazaarSuppressed.has(`${charId}:passive:${e.index}`))continue;if(supportRetainedExtraHandledKeys.has(`${charId}:talent:${e.index}`))continue;const key=`assault:${charId}:passive:${e.index}`;if(charId==='char_4119_wanqin'){const p=e.params??{},ratio=scale(runtimeBody,p,'maxHp',0),sameDir=scale(runtimeBody,p,'maxHpSameDir',ratio),duration=scale(runtimeBody,p,'duration',10);const recipients=new Set([...targets(ctx.battle,ctx.unit,e,null),...allies(ctx.battle,ctx.unit,{scope:'field',count:99}).filter(ally=>wanqinFacingInRange(ctx.unit,ally))].filter(ally=>ally.kind==='op'));for(const ally of recipients){const facing=wanqinFacingInRange(ctx.unit,ally);buff(ctx.battle,ctx.unit,ally,{key,mods:{hpMul:1+(facing?sameDir:ratio)},duration,stacking:'replace',cause:ctx.cause});if(star>=4&&facing)buff(ctx.battle,ctx.unit,ally,{key:key+':facingGuard',mods:{dmgTakenMul:0.95},duration,stacking:'replace',cause:ctx.cause});}continue;}if(e.params?.spPerSec!=null||e.params?.healPerSec!=null||e.params?.magicPerSec!=null||e.params?.dotPerSec!=null)repeatEffect(ctx.battle,ctx.unit,runtimeBody,e,key,ctx.cause);else perform(ctx.battle,ctx.unit,runtimeBody,e,key,null,ctx.cause);}};
  return makeKit(def,{canCast:ctx=>{if(single)return canCastSupportSingle(ctx);if(charId==='char_479_sleach')return true;if(charId==='char_4026_vulpis'){const hit=plan.skill.effects.find(e=>e.trigger==='skillResolve'&&e.action==='damage');return !!hit&&targets(ctx.battle,ctx.unit,hit,null).length>0;}if(!offensiveReady(ctx.battle,ctx.unit,plan.skill.effects,runtimeBody))return false;return plan.skill.effects.some(e=>canPerform(ctx.battle,ctx.unit,e,runtimeBody));},cast:ctx=>{const moduleCtx={battle:ctx.battle,unit:ctx.unit,body:runtimeBody,piece:raw.assaultPiece,star,cause:ctx.cause};if(charId==='char_4026_vulpis'){const hit=plan.skill.effects.find(e=>e.trigger==='skillResolve'&&e.action==='damage');moduleCtx.vulpisTargets=hit?targets(ctx.battle,ctx.unit,hit,null).slice(0,1):[];}if(charId==='char_4139_papyrs'){ctx.unit.mem??={};ctx.unit.mem.supportPapyrsSkillHealTargets=[];}if(single){const custom=['char_181_flower','char_107_liskam','char_497_ctable'].includes(charId);if(!custom)moduleHandler?.beforeSkillCast?.(moduleCtx);const settled=castSupportSingle(ctx);if(settled)settlePassives(ctx);if(!custom)moduleHandler?.afterSkillCast?.(moduleCtx);return settled;}moduleHandler?.beforeSkillCast?.(moduleCtx);if(charId==='char_479_sleach'){const economy=plan.skill.effects.find(e=>e.action==='economy'&&e.trigger==='skillResolve');if(economy)perform(ctx.battle,ctx.unit,runtimeBody,economy,`assault:${charId}:skill:${economy.index}`,null,ctx.cause);const strike=plan.skill.effects.find(e=>e.action==='damage'&&e.trigger==='skillResolve');const settled=strike?perform(ctx.battle,ctx.unit,runtimeBody,strike,`assault:${charId}:skill:${strike.index}`,null,ctx.cause,{extra:ctx.extra}):false;moduleHandler?.afterSkillCast?.(moduleCtx);return settled;}let damageMul=moduleCtx.damageMul??1;/* char_290_vigna: crit rolls per target in support-bazaar.js */const settled=plan.skill.effects.filter(e=>e.trigger==='skillResolve'&&!(charId==='char_311_mudrok'&&e.action==='heal')).map(e=>e.action==='nativeMechanism'&&charId==='char_290_vigna'?true:perform(ctx.battle,ctx.unit,runtimeBody,e,`assault:${charId}:skill:${e.index}`,charId==='char_4026_vulpis'?{targets:moduleCtx.vulpisTargets}:null,ctx.cause,{damageMul,extra:ctx.extra,suppressRedeploy:ctx.suppressRedeploy})).some(Boolean);if(charId==='char_4026_vulpis'&&ctx.unit.assaultSupportModules?.has('uniequip_003_vulpis')&&!ctx.extra&&settled&&moduleCtx.vulpisTargets?.length){ctx.unit.mem??={};const n=ctx.unit.mem.supportVulpisDoubles??0;if(n<5){ctx.unit.mem.supportVulpisDoubles=n+1;for(const e of plan.skill.effects.filter(x=>x.trigger==='skillResolve'))perform(ctx.battle,ctx.unit,runtimeBody,e,`assault:${charId}:skill:${e.index}:moduleSecond`,{targets:moduleCtx.vulpisTargets},ctx.cause,{damageMul:e.action==='damage'?0.5:1,extra:true,suppressRedeploy:true});}}if(charId==='char_4139_papyrs'){const shieldEffect=plan.skill.effects.find(e=>e.trigger==='skillHeal'&&e.action==='addBuff');if(shieldEffect)perform(ctx.battle,ctx.unit,runtimeBody,shieldEffect,`assault:${charId}:skill:${shieldEffect.index}`,{targets:ctx.unit.mem.supportPapyrsSkillHealTargets??[]},ctx.cause);}if(charId==='char_4087_ines'){const e=plan.skill.effects[0];buff(ctx.battle,ctx.unit,ctx.unit,{key:`assault:${charId}:skill:${e.index}`,mods:{atkMul:1+v(runtimeBody,e.params.atk)},flags:{stealth:true},duration:v(runtimeBody,e.params.duration),cause:ctx.cause});}settlePassives(ctx);moduleHandler?.afterSkillCast?.(moduleCtx);return settled;},install:(battle,unit)=>{
    unit.assaultSupportModules=new Set(chosenModules);unit.assaultStar=star;
    installSupportBazaar({battle,unit,charId,body:runtimeBody,star,plan,modules:chosenModules});
    const retainedExtraKey=`${charId}:talent:${charId==='char_107_liskam'?1:0}`;
    if(supportRetainedExtraHandledKeys.has(retainedExtraKey)&&!installSupportRetainedExtra({battle,unit,charId,body:runtimeBody,piece:raw.assaultPiece,rank:star}))throw new Error(`${charId} retained-extra installer rejected its handled source key`);
    // 骑警套装 (uniequip_002_grani) is only the skill damage bonus in support-instant;
    // the old base ATK +10% and 4-star multi-hit cost refund were removed.
    if(charId==='char_4148_philae'){
      battle.on('retreating',event=>{const ctx=event.payload??event;if(ctx.unit!==unit)return;unit.mem??={};unit.mem.supportPhilaeBarrierGeneration=(unit.mem.supportPhilaeBarrierGeneration??0)+1;unit.mem.philaeBarrier=0;unit.mem.supportPhilaeBarrierExpires=0;},{owner:unit});
      battle.on('death',event=>{const ctx=event.payload??event;if(ctx.unit!==unit)return;unit.mem??={};unit.mem.supportPhilaeBarrierGeneration=(unit.mem.supportPhilaeBarrierGeneration??0)+1;unit.mem.philaeBarrier=0;unit.mem.supportPhilaeBarrierExpires=0;},{owner:unit});
      battle.on('elementHit',event=>{const ctx=event.payload??event,dmg=ctx.dmg,expires=unit.mem?.supportPhilaeBarrierExpires??0;if(ctx.target!==unit||!(unit.mem?.philaeBarrier>0)||battle.time>=expires||dmg?.type!=='element'||!(dmg.amount>0)||dmg.cancel)return;const effective=dmg.amount*(dmg.mul??1);if(!(effective>0))return;const absorbed=Math.min(unit.mem.philaeBarrier,effective);unit.mem.philaeBarrier-=absorbed;if(absorbed>=effective-1e-9)dmg.cancel=true;else dmg.amount*=Math.max(0,(effective-absorbed)/effective);},{owner:unit,priority:-30});
    }
    moduleHandler?.install?.({battle,unit,body:runtimeBody,piece:raw.assaultPiece,star,cause:battle.assaultRuntime.currentCause??null});
    if(charId==='char_4163_rosesa'){
      const penalty=0,key=`assault:${charId}:talent:selfAtk`;/* 卡面无自身减攻：旧天赋代价随「受到的治疗 +b%」行一并去掉 */
      const applyPenalty=()=>{if(active(unit)&&penalty!==0)buff(battle,unit,unit,{key,mods:{atkMul:1+penalty},duration:Infinity,stacking:'replace'});};
      battle.on('battleStart',applyPenalty,{owner:unit});
      battle.on('deploy',event=>{const ctx=event.payload??event;if(ctx.unit===unit)applyPenalty();},{owner:unit});
      applyPenalty();
    }
    if(charId==='char_349_chiave')installChiaveClaw(battle,unit,runtimeBody,star,chosenModules.includes('uniequip_002_chiave'));
    if(!single&&plan.skill.effects.some(e=>e.action==='ammo')&&unit.skill&&!unit._assaultAmmoController){const skill=unit.skill;registerAssaultAmmo(battle,unit,{get:()=>skill.ammoLeft,set:n=>{skill.ammoLeft=n;},max:()=>skill.ammoMax??0});
      // These four fixed skills load a persistent support pool on an instant
      // skill resolution. Spend only after Battle emits an attack (the firing
      // boundary); hit/dodge/shield outcomes do not affect the bullet count.
      // Native ammo skills already spend from this same counter themselves.
      if(skill.kind!=='ammo')battle.on('attack',event=>{const ctx=event.payload??event;if(ctx.attacker!==unit||!unit.buffs?.some(x=>x.key===`assault:${charId}:skill:0:ammo`))return;consumeAssaultAmmo(battle,unit,1,`assault:${charId}:attack-ammo`,{partial:true,isSkill:!!ctx.isSkill});},{owner:unit});
    }
    if(charId==='char_4042_lumen'){
      const talent=plan.talents[0]?.parameters??{},normal=talent.resistSec?.[star-1]??0,high=talent.highHpResistSec?.[star-1]??normal,threshold=talent.hpRatio??0.75;
      battle.on('heal',event=>{const ctx=event.payload??event,target=ctx.target;if(ctx.source!==unit||ctx.opts?.regen||target?.side!=='ally'||!target.alive)return;const projected=(target.hp+Math.max(0,ctx.amount??0))/Math.max(1,target.s.maxHp),duration=(projected>=threshold?high:normal);if(duration>0)applyStatus(battle,unit,target,{status:'resist',duration,value:0.5,key:`assault:${charId}:talent:resist`,cause:battle.assaultRuntime.currentCause});/* “幸运”: the healed operator gains {a}% 庇护 for 5 s. */if(unit.assaultSupportModules?.has('uniequip_003_lumen')&&ctx.amount>0)holdProtect(battle,target,moduleValue(unit,'uniequip_003_lumen','a',{percent:true}),5,unit);},{owner:unit});
    }
    if(charId==='char_1020_reed2'){
      const ratio=plan.talents[1]?.parameters?.selfHealScale?.[star-1]??0;
      battle.on('heal',event=>{const ctx=event.payload??event;if(ctx.source!==unit||ctx.target===unit||ctx.target?.side!=='ally'||ctx.target.ownerId!==unit.ownerId||!(ctx.amount>0)||ratio<=0)return;heal(battle,unit,unit,{amount:ctx.amount*ratio,cause:ctx.cause??battle.assaultRuntime.currentCause});},{owner:unit});
    }
    if(charId==='char_1045_svash2'){
      const talent=plan.talents[1]?.parameters??{},defFlat=talent.def?.[star-1]??0,regen=talent.hpPerSec?.[star-1]??0,ramp=talent.rampSec??15,mult=talent.rampMultiplier??2,state={on:false,startedAt:null,nextHeal:0};
      const isKjerag=a=>(a.def?.nationId??a.def?.raw?.nationId??a.def?.raw?.assaultBody?.nationId??a.def?.raw?.assaultBody?.tags?.includes?.('kjerag'))==='kjerag'||(a.def?.raw?.assaultBody?.tags??[]).includes('kjerag');
      const keyFor=a=>`assault:${charId}:snow:${uid(unit)}:${uid(a)}`;
      const clear=()=>{for(const ally of battle.allyUnits)if(ally.ownerId===unit.ownerId&&isKjerag(ally))battle.removeBuff(ally,keyFor(ally));state.on=false;state.startedAt=null;state.nextHeal=0;};
      const refresh=()=>{if(!active(unit)){if(state.on)clear();return;}if(!state.on){state.on=true;state.startedAt=battle.time;state.nextHeal=battle.time;}const doubled=battle.time-state.startedAt+1e-9>=ramp,factor=doubled?mult:1;for(const ally of battle.allyUnits){if(ally.kind!=='op'||ally.ownerId!==unit.ownerId||!active(ally)||!isKjerag(ally))continue;buff(battle,unit,ally,{key:keyFor(ally),mods:{defFlat:defFlat*factor},duration:0.4,stacking:'replace'});if(battle.time+1e-9>=state.nextHeal){heal(battle,unit,ally,{maxHpRatio:regen*factor,cause:battle.assaultRuntime.currentCause});}}if(battle.time+1e-9>=state.nextHeal)state.nextHeal=battle.time+1;};
      battle.on('battleStart',refresh,{owner:unit});battle.on('deploy',event=>{if(event.unit===unit&&!state.on)refresh();},{owner:unit});battle.on('death',event=>{if(event.unit===unit)clear();},{owner:unit});battle.on('beforeStatus',event=>{const ctx=event.payload??event;if(ctx.status==='freeze'&&state.on&&active(unit)&&ctx.target?.ownerId===unit.ownerId&&isKjerag(ctx.target))ctx.cancel=true;},{owner:unit});battle.every(0.25,refresh,{owner:unit});
    }
    for(const e of plan.skill.effects.filter(x=>x.trigger!=='skillResolve')){const ev=e.trigger==='skillWhileShieldAlive'?'attack':EVENT[e.trigger];if(!ev)throw new Error(`${charId} lacks Battle event for fixed skill trigger ${e.trigger}`);battle.on(ev,event=>{const ctx=event.payload??event;if(!active(unit))return;if(['attack','ammoAttackHit','attackHitWhileSkillActive'].includes(e.trigger)&&ctx.attacker!==unit)return;if(e.trigger==='attackedWhileSkillActive'&&(ctx.target!==unit||(charId==='char_381_bubble'?(!ctx.dmg?.isAttack||ctx.source?.side!=='enemy'||!unit.buffs?.some(b=>b.key===`assault:${charId}:skill:0`&&b.timeLeft>0)):!unit.skill?.active)))return;if(e.trigger==='attackHitWhileSkillActive'&&!unit.buffs?.some(x=>x.key===`assault:${charId}:skill:0`))return;if(e.trigger==='shelteredAllyAttacked'&&(!byEnemyAttack(ctx)||ctx.source?.side!=='enemy'||!sameOwnerOperator(unit,ctx.target)||!allies(battle,unit,{scope:'range',priority:'hp',count:99}).includes(ctx.target)||(unit.mem?.supportVendlaShelteredUntil?.get(uid(ctx.target))??-Infinity)<=battle.time))return;if(e.trigger==='skillWhileShieldAlive'&&!unit.buffs?.some(x=>(x.shield??x.shieldHp??0)>0||x.shieldLayers>0)&&!(charId==='char_1034_jesca2'&&battle.allyUnits.some(x=>x.kind==='token'&&x.ownerUnit===unit&&x.defId===SUPPORT_TOKEN_IDS.jesca2_mobile_shield&&active(x))))return;const key=`assault:${charId}:skill:${e.index}`,effectEvent={...ctx,target:ctx.target,source:ctx.source??ctx.attacker,targets:ctx.targets},cause=event.cause??battle.assaultRuntime.currentCause;if(e.trigger==='shelteredAllyAttacked'){battle.assaultRuntime.enqueue(()=>perform(battle,unit,runtimeBody,e,key,effectEvent,cause),{key:`${key}:event`,targetUid:ctx.target.uid??ctx.target.id,cause,sourceUid:unit.uid??unit.id});battle.assaultRuntime.afterFlush(()=>{});return;}perform(battle,unit,runtimeBody,e,key,effectEvent,cause);},{owner:unit});}
    if(charId==='char_136_hsguma'){
      const value=0;/* 卡面无重装防御光环：旧天赋已被 bazaar 反击行替换 */
      if(value>0)battle.on('battleStart',()=>{for(const ally of ownerScoped(unit,allies(battle,unit,{scope:'field',priority:'hp',count:99})).filter(x=>x.def?.profession==='TANK'))buff(battle,unit,ally,{key:`assault:${charId}:talent:heavyDef`,mods:{defMul:1+value},duration:Infinity,stacking:'replace'});},{owner:unit});
    }
    if(charId==='char_102_texas'){
      const star=Math.max(1,Math.min(4,unit.input_piece?.star??unit.inputPiece?.star??unit.def?.raw?.assaultPiece?.star??1));
      const initCost=plan.talents[0]?.parameters?.initCost?.[star-1]??0;
      // 企鹅物流部署回费（support-bazaar.js）取代编入队伍的初始费用
    }
    if(charId==='char_240_wyvern'){
      const p=plan.talents[0]?.parameters??{},bonus=p.atkByStar?.[star-1]??0,duration=p.duration??8;
      battle.assaultRuntime.observe('dpReceived',`support:${uid(unit)}:vanilla-talent`,event=>{
        return; // 香草：获得费用叠攻并入 support-bazaar.js 的先锋行
        buff(battle,unit,unit,{key:`assault:${charId}:talent:dpAtk`,mods:{atkMul:1+bonus},duration,cause:event.cause??null});
      },{owner:unit});
    }
    if(charId==='char_222_bpipe'){
      const initSp=plan.talents[1]?.parameters?.initSp?.[star-1]??0,seen=new Set();
      battle.on('deploy',event=>{const target=event.unit;if(target?.kind!=='op'||target.side!=='ally'||target.ownerId!==unit.ownerId||target.def?.profession!=='PIONEER'||seen.has(uid(target)))return;seen.add(uid(target));if(initSp>0)target.skill?.gainSp(initSp,'assault:char_222_bpipe:initial-pioneer-sp',true);},{owner:unit});
      const p=plan.talents[0]?.parameters??{},prob=scale(runtimeBody,p,'prob',0),atkScale=scale(runtimeBody,p,'atkScale',1),state={extraAttack:false,moduleCandidate:null,moduleHit:false};
      battle.on('beforeAttack',event=>{const ctx=event.payload??event;if(ctx.attacker!==unit)return;state.moduleCandidate=unit.mem?.assaultBpipeModuleFollowup?(ctx.targets??[]).find(target=>target.hp>=target.s.maxHp-1e-9)??null:null;state.moduleHit=false;},{owner:unit});
      battle.on('damaged',event=>{const ctx=event.payload??event;if(unit.mem?.assaultBpipeModuleFollowup&&ctx.source===unit&&ctx.target===state.moduleCandidate&&ctx.amount>0)state.moduleHit=true;},{owner:unit});
      battle.on('attack',event=>{const ctx=event.payload??event;if(ctx.attacker!==unit||ctx.isSkill||!active(unit)||state.extraAttack)return;const precisionTarget=ctx.noAmmo&&state.moduleCandidate&&state.moduleHit?state.moduleCandidate:null;state.moduleCandidate=null;state.moduleHit=false;if(!precisionTarget&&(ctx.noAmmo||prob<=0||atkScale<=1||battle.rng()>=prob))return;const target=precisionTarget??(()=>{const already=new Set((ctx.targets??[]).map(uid));return enemies(battle,unit,{scope:'range',count:99,priority:'exit'}).find(t=>!already.has(uid(t)));})();if(!target)return;if(precisionTarget)unit.mem.assaultBpipeModuleFollowup=false;state.extraAttack=true;const key=`assault:${charId}:talent:precision-round`;buff(battle,unit,unit,{key,mods:{atkMul:atkScale},duration:1,stacking:'replace'});try{battle.forceAttack(unit,[target],{noAmmo:true});}finally{battle.removeBuff(unit,key);state.extraAttack=false;}},{owner:unit});
    }
    if(charId==='char_420_flamtl'){
      const star=Math.max(1,Math.min(4,unit.input_piece?.star??unit.inputPiece?.star??unit.def?.raw?.assaultPiece?.star??1));
      const dodge=plan.talents[1]?.parameters?.physDodge?.[star-1]??0;
      const auraKey='assault:'+charId+':talent:kazimierzDodge:'+uid(unit),covered=new Set(),moduleAura=unit.assaultSupportModules?.has('uniequip_003_flamtl')===true;
      const clearAura=()=>{for(const target of covered)battle.removeBuff(target,auraKey);covered.clear();};
      const refreshAura=()=>{if(!active(unit)){clearAura();return;}const eligible=battle.allyUnits.filter(x=>x.kind==='op'&&x.ownerId===unit.ownerId&&active(x)&&(x.def?.nationId??x.def?.raw?.nationId??x.def?.raw?.assaultBody?.nationId)==='kazimierz'),next=new Set(eligible);for(const target of covered)if(!next.has(target))battle.removeBuff(target,auraKey);for(const ally of eligible)buff(battle,unit,ally,{key:auraKey,mods:{dodgePhys:dodge,...(moduleAura?{atkMul:1+moduleValue(unit,'uniequip_003_flamtl','a',{percent:true})}:null)},duration:Infinity,stacking:'replace'});covered.clear();for(const target of eligible)covered.add(target);};
      battle.on('battleStart',refreshAura,{owner:unit});battle.on('deploy',refreshAura,{owner:unit});
      battle.on('retreating',event=>{if(event.unit===unit)clearAura();else refreshAura();},{owner:unit});battle.on('death',event=>{if(event.unit===unit)clearAura();else refreshAura();},{owner:unit});
      const state={pending:false,settling:false};
      battle.on('dodge',event=>{const ctx=event.payload??event;if(ctx.target===unit&&ctx.source?.side==='enemy'&&active(unit))state.pending=true;},{owner:unit});
      battle.on('attack',event=>{const ctx=event.payload??event;if(ctx.attacker!==unit||ctx.isSkill||!active(unit)||!state.pending||state.settling)return;state.pending=false;const blocked=unit.blocking.filter(active);if(!blocked.length)return;state.settling=true;try{for(const enemy of blocked)battle.forceAttack(unit,[enemy],{noAmmo:true});}finally{state.settling=false;}},{owner:unit});
    }
    if(charId==='char_4114_harold'){
      const resistance=v(runtimeBody,runtimeBody.bazaar.lines[1].params.c)/100;
      battle.on('elementHit',event=>{const ctx=event.payload??event,target=ctx.target,el=ctx.dmg?.element;if(!active(unit)||target?.side!=='ally'||target.ownerId!==unit.ownerId||!active(target)||!el||!unit.rangeKeySet?.has(target.tileR*COLS+target.tileC))return;ctx.dmg.mul*=1-resistance;},{owner:unit,priority:-10});
      const coveredBursts=new Map(),burstHeal=null;
      if(burstHeal){
        battle.on('elementBurst',event=>{const ctx=event.payload??event,target=ctx.target;if(!active(unit)||target?.side!=='ally'||target.ownerId!==unit.ownerId||!active(target)||!unit.rangeKeySet?.has(target.tileR*COLS+target.tileC))return;coveredBursts.set(uid(target),{target,element:ctx.element});},{owner:unit});
        battle.on('damaged',event=>{const ctx=event.payload??event,target=ctx.target,entry=target&&coveredBursts.get(uid(target));if(!entry||ctx.dmg?.element!==entry.element||!ctx.dmg?.tags?.includes('burst'))return;coveredBursts.delete(uid(target));const actual=Math.max(0,ctx.amount??0),healAmount=Math.min(actual,Math.max(0,target.s.maxHp-target.hp));if(target.hp>0&&healAmount>0)heal(battle,unit,target,{amount:healAmount,cause:ctx.cause??battle.assaultRuntime.currentCause});},{owner:unit,priority:100});
      }
    }
    if(charId==='char_4222_taraxa'){
      const params=plan.talents[0]?.parameters??{},ratio=params.damageResistance?.[star-1]??0,extraBlock=params.blockCnt??1,key=`assault:${charId}:talent:windCover`,covered=new Set();
      battle.every(0.2,()=>{
        const wind=active(unit)&&unit.buffs?.some(x=>x.key===`assault:${charId}:skill:1`&&x.timeLeft>0);
        const eligible=wind?battle.allyUnits.filter(x=>x.kind==='op'&&x.ownerId===unit.ownerId&&active(x)&&x!==unit&&x.isFlying===true&&unit.rangeKeySet?.has(x.tileR*COLS+x.tileC)):[];
        const next=new Set(eligible.map(uid));
        for(const id of covered)if(!next.has(id)){const target=battle.allyUnits.find(x=>uid(x)===id);if(target)battle.removeBuff(target,key);}
        for(const target of eligible)buff(battle,unit,target,{key,mods:{dmgTakenMul:1-ratio,blockCnt:extraBlock},duration:0.45,stacking:'replace'});
        covered.clear();for(const id of next)covered.add(id);
      },{owner:unit});
    }
    if(charId==='char_107_liskam'){
      const amount=plan.talents[0]?.parameters?.spGain??1;
      battle.on('damaged',event=>{
        const ctx=event.payload??event;
        if(ctx.target!==unit||!active(unit)||!hurtSpDamage(ctx)||(unit.s.flags.stun&&!unit.assaultSupportModules?.has('uniequip_002_liskam'))||!(amount>0))return;
        unit.mem??={};if((unit.mem.bazaarLiskamCharges??0)>=20)return;unit.mem.bazaarLiskamCharges=(unit.mem.bazaarLiskamCharges??0)+1;
        const adjacent=allies(battle,unit,{scope:'adjacent8',priority:'uid',count:99}).filter(x=>x!==unit&&x.ownerId===unit.ownerId&&active(x)&&x.skill);
        const pick=adjacent.length?adjacent[Math.min(adjacent.length-1,Math.floor(battle.rng()*adjacent.length))]:null;
        sp(battle,unit,unit,amount,`assault:${charId}:talent:tacticalDefense:self`,`assault:${charId}:talent:tacticalDefense:self`);
        if(pick)sp(battle,unit,pick,amount,`assault:${charId}:talent:tacticalDefense:${uid(pick)}`,`assault:${charId}:talent:tacticalDefense:${uid(pick)}`);
      },{owner:unit});
    }
    if(charId==='char_4148_philae'){
      const params=plan.talents[0]?.parameters??{},resistance=0,spGain=0;/* 卡面无凋亡抗性：旧天赋已被 bazaar「元素爆发充能」行替换 */
      battle.on('elementHit',event=>{const ctx=event.payload??event;if(ctx.target!==unit||ctx.dmg?.element!=='apoptosis'||!(ctx.dmg.amount>0))return;if(resistance>0)ctx.dmg.mul=(ctx.dmg.mul??1)*(1-resistance);if(spGain>0)sp(battle,unit,unit,spGain,`assault:${charId}:talent:apoptosis-sp`,`assault:${charId}:talent:apoptosis-sp`,ctx.cause??battle.assaultRuntime.currentCause);},{owner:unit,priority:-20});
    }
    if(charId==='char_136_hsguma'){
      const damageBlock=0;/* 卡面无减伤：旧天赋已被 bazaar 龙门护盾行替换 */
      battle.on('hpDamage',event=>{const ctx=event.payload??event;if(ctx.target!==unit||!active(unit)||ctx.dmg?.type==='elemental'||!(ctx.amount>0)||damageBlock<=0)return;ctx.amount*=1-damageBlock;},{owner:unit,priority:20});
    }
    if(charId==='char_4087_ines'){
      const params=plan.talents[0]?.parameters??{},steal=scale(runtimeBody,params,'stealAtk',0)*(unit.assaultSupportModules?.has('uniequip_002_ines')?2:1),maxTotal=scale(runtimeBody,params,'maxSteal',steal),root=scale(runtimeBody,params,'root',5),stolen=new Map();let total=0;
      const clearTarget=target=>{const entry=stolen.get(uid(target));if(!entry)return;if(entry.targetKey)battle.removeBuff(target,entry.targetKey);if(entry.selfKey)battle.removeBuff(unit,entry.selfKey);total=Math.max(0,total-entry.amount);stolen.delete(uid(target));};
      const clear=()=>{for(const entry of [...stolen.values()])clearTarget(entry.target);};
      battle.on('damaged',event=>{const ctx=event.payload??event,target=ctx.target;if(ctx.source!==unit||!active(unit)||target?.side!=='enemy'||!target.alive||!(ctx.amount>0)||stolen.has(uid(target)))return;const targetKey=`assault:${charId}:talent:steal:${uid(target)}`,selfKey=`${targetKey}:self`,amount=Math.min(steal,Math.max(0,maxTotal-total),Math.max(0,target.s.atk));applyStatus(battle,unit,target,{status:'bind',duration:root,key:`${targetKey}:root`,cause:ctx.cause??battle.assaultRuntime.currentCause});if(amount>0){battle.addBuff(target,{key:targetKey,mods:{atkFlat:-amount},duration:Infinity,source:unit,tags:['talent']});battle.addBuff(unit,{key:selfKey,mods:{atkFlat:amount},duration:Infinity,source:unit,tags:['talent']});stolen.set(uid(target),{target,targetKey,selfKey,amount});total+=amount;}else stolen.set(uid(target),{target,targetKey:null,selfKey:null,amount:0});},{owner:unit});
      battle.on('death',event=>{const target=event.unit;if(target===unit){clear();return;}if(target?.side==='enemy')clearTarget(target);},{owner:unit});
      battle.on('retreating',event=>{if(event.unit===unit)clear();},{owner:unit});
    }
    if(charId==='char_202_demkni'){
      const params=plan.talents[0]?.parameters??{},interval=params.interval??20,maxStacks=params.maxStacks??5,atk=scale(runtimeBody,params,'atk',0),def=scale(runtimeBody,params,'def',0),key=`assault:${charId}:talent:fieldRamp`,moduleId='uniequip_003_demkni',moduleArmor=unit.assaultSupportModules?.has(moduleId)===true,star=unit.assaultStar??unit.input_piece?.star??1;unit.mem??={};unit.mem.assaultDemkniRampStacks??=0;let elapsed=0,teamArmorGranted=false;
      const teamBuffKey=`assault:module:${moduleId}:fullArmor`;
      const clearTeamArmor=()=>{for(const ally of battle.allyUnits.filter(x=>x.ownerId===unit.ownerId))battle.removeBuff(ally,`${teamBuffKey}:${uid(ally)}`);teamArmorGranted=false;};
      const grantTeamArmor=()=>{if(teamArmorGranted)return;teamArmorGranted=true;for(const ally of allies(battle,unit,{scope:'field',selection:'uid',count:99}).filter(x=>x.ownerId===unit.ownerId))buff(battle,unit,ally,{key:`${teamBuffKey}:${uid(ally)}`,mods:{defMul:1.1},duration:10,stacking:'replace'});};
      const refresh=()=>{const stacks=unit.mem.assaultDemkniRampStacks;if(stacks>0)buff(battle,unit,unit,{key,mods:{atkMul:1+atk*stacks,defMul:1+(def+(moduleArmor?0.01:0))*stacks},duration:Infinity,stacking:'replace',persist:true});};
      battle.on('deploy',event=>{if(event.unit===unit)refresh();},{owner:unit});
      battle.on('retreating',event=>{if(event.unit===unit)clearTeamArmor();},{owner:unit});
      battle.on('death',event=>{if(event.unit===unit)clearTeamArmor();},{owner:unit});
      if(false)battle.every(1,()=>{if(!active(unit)||interval<=0||unit.mem.assaultDemkniRampStacks>=maxStacks)return;elapsed+=1;if(elapsed+1e-9<interval)return;elapsed-=interval;const before=unit.mem.assaultDemkniRampStacks;unit.mem.assaultDemkniRampStacks++;refresh();if(moduleArmor&&star>=4&&before<maxStacks&&unit.mem.assaultDemkniRampStacks>=maxStacks)grantTeamArmor();},{owner:unit});
    }
    if(charId==='char_220_grani'){
      const dodge=plan.talents[0]?.parameters?.physDodge?.[star-1]??0,key=`assault:${charId}:talent:pioneerDodge`,covered=new Set();
      battle.every(0.2,()=>{const eligible=active(unit)?battle.allyUnits.filter(x=>x.kind==='op'&&x.ownerId===unit.ownerId&&active(x)&&x.def?.profession==='PIONEER'):[],next=new Set(eligible.map(uid));for(const id of covered)if(!next.has(id)){const target=battle.allyUnits.find(x=>uid(x)===id);if(target)battle.removeBuff(target,key);}for(const target of eligible)buff(battle,unit,target,{key,mods:{dodgePhys:dodge},duration:0.45,stacking:'replace'});covered.clear();for(const id of next)covered.add(id);},{owner:unit});
    }
    if(charId==='char_479_sleach'){
      installSleachBanner(battle,unit,runtimeBody,star);
      const discount=0;/* 卡面无「下一名干员减费」：旧天赋已被 bazaar 维多利亚部署充能行替换 */let armed=active(unit),consumed=false;
      if(discount<0){battle.on('assaultDeploymentCost',event=>{const quote=event.payload??event,target=quote.unit;if(!armed||consumed||!active(unit)||target?.kind!=='op'||target===unit||target.ownerId!==unit.ownerId||target.mem?.assaultSkillFree)return;quote.amount=Math.max(0,quote.amount+discount);},{owner:unit});battle.on('deploy',event=>{const ctx=event.payload??event,target=ctx.unit;if(target===unit&&active(unit)){armed=true;consumed=false;return;}if(armed&&!consumed&&ctx.skillEntry!==true&&target?.kind==='op'&&target.ownerId===unit.ownerId)consumed=true;},{owner:unit});}
    }
    if(charId==='char_4026_vulpis'){
      const p=plan.talents[0]?.parameters??{},baseScale=scale(runtimeBody,p,'extraScale',0),duration=scale(runtimeBody,p,'duration',10),killCost=scale(runtimeBody,p,'killCostGain',0),marks=new Map(),moduleId='uniequip_002_vulpis',moduleEnabled=unit.assaultSupportModules?.has(moduleId)===true;
      battle.on('damaged',event=>{const ctx=event.payload??event,target=ctx.target;if(ctx.source!==unit||!active(unit)||target?.side!=='enemy'||ctx.type==='element'||ctx.dmg?.type==='element'||ctx.dmg?.tags?.includes('vulpisHunt')||!(ctx.amount>0)||duration<=0)return;if(!ctx.dmg?.isAttack)return;const cc=target.s?.flags?.stun||target.s?.flags?.sluggish||target.buffs?.some(x=>['stun','sluggish'].includes(x.status??x.key));const ratio=moduleEnabled?0.45*(cc?2:1):baseScale;if(ratio>0)battle.dealDamage(unit,target,{amount:unit.s.atk*ratio,type:'arts',isSkill:false,tags:['talent','assaultSupport','vulpisHunt']});},{owner:unit});
      if(false&&killCost>0)battle.on('kill',event=>{const ctx=event.payload??event,target=ctx.victim;if(ctx.killer!==unit||!active(unit)||target?.side!=='enemy')return;const mark=marks.get(uid(target));if(!mark||mark.dpClaimed||battle.time>=mark.expires)return;mark.dpClaimed=true;gainDP(battle,unit,killCost,`assault:${charId}:talent:chaseKill`);},{owner:unit});
      const regen=plan.talents[1]?.parameters??{},costRate=1,hpRatio=0,/* 卡面无自然费用加成与回血：旧天赋已被 bazaar 叙拉古击倒充能行替换 */interval=regen.interval??4;
      if(costRate>1)battle.assaultRuntime.observe('dpReceived',`support:${uid(unit)}:vulpis-natural-dp`,event=>{const ctx=event.payload??event;if(!active(unit)||ctx.targetUid!==unit.ownerId||ctx.sourceClass!=='natural'||!(ctx.amount>0))return;battle.addDp(unit.ownerId,ctx.amount*(costRate-1),'assault-vulpis-natural-bonus');},{owner:unit});
      if(hpRatio>0&&interval>0){let lastHurtAt=battle.time;battle.on('battleStart',()=>{lastHurtAt=battle.time;},{owner:unit});battle.on('deploy',event=>{if(event.unit===unit)lastHurtAt=battle.time;},{owner:unit});battle.on('hpDamage',event=>{const ctx=event.payload??event;if(ctx.target===unit&&ctx.amount>0)lastHurtAt=battle.time;},{owner:unit});battle.every(1,()=>{if(active(unit)&&battle.time-lastHurtAt+1e-9>=interval)heal(battle,unit,unit,{maxHpRatio:hpRatio,regen:true,cause:battle.assaultRuntime.currentCause});},{owner:unit});}
    }
    if(charId==='char_1045_svash2'){
      const params=plan.talents[0]?.parameters??{},anchorName=params.anchorName,initSp=scale(runtimeBody,params,'initSp',0),redeployMul=scale(runtimeBody,params,'respawnTimeMultiplier',1),gifted=new Set();
      const eligible=(target,relations)=>Array.isArray(relations)&&relations.some(relation=>relation.active&&relation.anchor?.name===anchorName&&(relation.self||relation.leftOfAnchor));
      battle.on('deploy',event=>{const ctx=event.payload??event,target=ctx.unit;if(!active(unit)||!ctx.initial||ctx.skillEntry===true||target?.kind!=='op'||target.ownerId!==unit.ownerId||!target.skill||gifted.has(uid(target))||!eligible(target,ctx.deployAnchors))return;gifted.add(uid(target));if(initSp>0)target.skill.gainSp(initSp,`assault:${charId}:talent:deploy-anchor-init`);},{owner:unit});
      battle.on('death',event=>{const ctx=event.payload??event,target=ctx.unit??ctx.target;if(!active(unit)||target?.kind!=='op'||target.ownerId!==unit.ownerId||!eligible(target,battle.assaultDeployAnchorRelations(target))||!(redeployMul>0&&redeployMul<1))return;target.mem??={};target.mem.assaultNextRedeployMul=(target.mem.assaultNextRedeployMul??1)*redeployMul;},{owner:unit});
      battle.on('death',event=>{const ctx=event.payload??event,target=ctx.unit??ctx.target,mul=target?.mem?.assaultNextRedeployMul;if(target?.kind!=='op'||!Number.isFinite(target.respawnAt)||!Number.isFinite(mul))return;target.respawnAt=battle.time+Math.max(0,target.respawnAt-battle.time)*mul;delete target.mem.assaultNextRedeployMul;},{owner:unit,priority:-75});
    }
    if(charId==='char_4056_titi'){
      const p=null;/* 卡面无萨尔贡攻速：旧天赋已被 bazaar 睡眠充能行替换 */if(p){const key=`assault:${charId}:talent:sargonMorale`,threshold=p.hpRatio??0.5,aspd=scale(runtimeBody,p,'attackSpeed',0);const isSargon=a=>(a.def?.nationId??a.def?.raw?.nationId??a.def?.raw?.assaultBody?.nationId)==='sargon';battle.every(0.25,()=>{for(const ally of battle.allyUnits){if(ally.kind!=='op'||ally.ownerId!==unit.ownerId||!isSargon(ally))continue;if(active(ally)&&ally.hp/ally.s.maxHp>threshold)buff(battle,unit,ally,{key,mods:{aspd},duration:0.5,stacking:'replace'});else battle.removeBuff(ally,key);}},{owner:unit});}
    }
    if(charId==='char_497_ctable'){
      const p=null;/* 卡面无条件攻击/攻速：旧天赋已被 bazaar 罗德岛施放充能行替换 */if(p){const key=`assault:${charId}:talent:conditionalCombat`,aspd=scale(runtimeBody,p,'attackSpeed',0),atk=scale(runtimeBody,p,'atk',0);battle.every(0.2,()=>{if(!active(unit))return;const mods=unit.blocking?.length?{atkMul:1+atk}:{aspd};buff(battle,unit,unit,{key,mods,duration:0.45,stacking:'replace'});},{owner:unit});}
    }
    if(charId==='char_112_siege'){
      unit.mem??={};unit.mem.supportSiegeHammerDp=0;
      // 卡面无「技能击倒得费用」：旧四星锤击击倒回费已停用（bazaar 第 1 行只按格拉斯哥帮击倒充能）
      const star=Math.max(1,Math.min(4,unit.input_piece?.star??unit.inputPiece?.star??unit.def?.raw?.assaultPiece?.star??1)),talent=plan.talents[0]?.parameters??{};
      battle.on('battleStart',()=>{for(const ally of battle.allyUnits.filter(x=>x.kind==='op'&&x.ownerId===unit.ownerId&&x.def?.profession==='PIONEER'))buff(battle,unit,ally,{key:`assault:${charId}:talent:pioneerAura`,mods:{atkMul:1+v(runtimeBody,runtimeBody.bazaar.lines[2].params.a)/100,defMul:1+v(runtimeBody,runtimeBody.bazaar.lines[2].params.a)/100},duration:Infinity,stacking:'replace'});},{owner:unit});
    }
    if(charId==='char_4039_horn'){
      if(!single)installHornAmmo(battle,unit,runtimeBody,plan);
      let revivedThisDeployment=false;
      const defenderAtk=v(runtimeBody,plan.talents[0]?.parameters?.atk??0);
      battle.on('battleStart',()=>{for(const ally of allies(battle,unit,{scope:'field',priority:'hp',count:99}).filter(x=>x.def?.profession==='TANK'))buff(battle,unit,ally,{key:`assault:${charId}:talent:defenderAtk`,mods:{atkMul:1+defenderAtk},duration:Infinity,stacking:'replace'});},{owner:unit});
      battle.on('deploy',event=>{if(event.unit===unit)revivedThisDeployment=false;},{owner:unit});
      battle.on('kill',event=>{if(event.victim!==unit||revivedThisDeployment)return;revivedThisDeployment=true;const hpLoss=Math.min(0.5,Math.abs(v(runtimeBody,plan.passives[0]?.params?.maxHp??0.5)));unit.base.maxHp=Math.max(1,unit.base.maxHp*(1-hpLoss));unit.markDirty?.();unit.hp=unit.s.maxHp;buff(battle,unit,unit,{key:`assault:${charId}:death:survival`,mods:{aspd:v(runtimeBody,runtimeBody.bazaar.lines[2].params.a)},duration:Infinity,stacking:'replace'});},{owner:unit,priority:-100});
    }
    if(charId==='char_416_zumama'){
      const params=plan.talents[0]?.parameters??{},hpRatio=scale(runtimeBody,params,'hpRatio',0.5),highHpScale=1,lowHpProtect=0;/* 卡面无血量阈值强化：旧天赋已被 bazaar 两行替换 */
      battle.on('hit',event=>{const ctx=event.payload??event,dmg=ctx.dmg;if(ctx.source!==unit||!active(unit)||!dmg?.isAttack||unit.hp/Math.max(1,unit.s.maxHp)<=hpRatio||highHpScale<=1)return;dmg.mul=(dmg.mul??1)*highHpScale;},{owner:unit,priority:-20});
      battle.on('hpDamage',event=>{const ctx=event.payload??event;if(ctx.target!==unit||!active(unit)||unit.hp/Math.max(1,unit.s.maxHp)>hpRatio||!(ctx.amount>0)||lowHpProtect<=0)return;ctx.amount*=1-lowHpProtect;},{owner:unit,priority:-100});
      const passive=plan.passives[0]?.params??{},spPerSec=0;if(false)battle.every(1,()=>{if(active(unit)&&unit.blocking?.some(active)&&spPerSec>0)sp(battle,unit,unit,spPerSec,`assault:${charId}:modePassive:blockingSp`,`assault:${charId}:modePassive:blockingSp`,battle.assaultRuntime.currentCause);},{owner:unit});
    }
    if(charId==='char_4065_judge'){
      const params=plan.talents[0]?.parameters??{},module003=unit.assaultSupportModules?.has('uniequip_003_judge')===true,born=scale(runtimeBody,params,'bornBarrier',0)+(module003?moduleValue(runtimeBody,'uniequip_003_judge','p',{percent:true}):0),onKill=scale(runtimeBody,params,'killBarrier',0),cap=scale(runtimeBody,params,'maxBarrier',3),key=`assault:${charId}:talent:barrier`;let lastDeploySeq=-1;
      const addBarrier=ratio=>{if(!active(unit)||ratio<=0)return false;const old=unit.buffs?.find(x=>x.key===key),current=old?.shield??0,next=Math.min(unit.s.maxHp*cap,current+unit.s.maxHp*ratio);if(!(next>current))return false;battle.addBuff(unit,{key,shield:next,duration:Infinity,refresh:'replace',source:unit,visible:true,tags:['talent']});return true;};
      const bornOnce=()=>{if(!active(unit)||unit.deploySeq===lastDeploySeq)return;lastDeploySeq=unit.deploySeq;addBarrier(born);};if(active(unit))bornOnce();battle.on('deploy',event=>{const ctx=event.payload??event;if(ctx.unit===unit)bornOnce();},{owner:unit});
      battle.on('death',event=>{const ctx=event.payload??event,victim=ctx.unit??ctx.target;if(active(unit)&&ctx.killer?.kind==='op'&&ctx.killer.side==='ally'&&ctx.killer.ownerId===unit.ownerId&&matchesTags(ctx.killer,'siracusa')&&victim?.side==='enemy')addBarrier(v(runtimeBody,runtimeBody.bazaar.lines[1].params.p)/100);},{owner:unit});
      const counterAttackId=`assault:${charId}:talent:ownBarrierCounter`,counterScale=scale(runtimeBody,plan.talents[1]?.parameters??{},'counterScale',0),module002=unit.assaultSupportModules?.has('uniequip_002_judge')===true,counterMul=module002?1+moduleValue(runtimeBody,'uniequip_002_judge','a',{percent:true}):1; battle.on('hit',event=>{const ctx=event.payload??event,target=ctx.target,attacker=ctx.source??ctx.attacker;if(target!==unit||!active(unit)||!ctx.dmg?.isAttack||attacker?.side!=='enemy'||counterScale<=0)return;const barrier=unit.buffs?.some(x=>x.source===unit&&((x.shield??0)>0||(x.shieldHits??0)>0));if(barrier)damage(battle,unit,attacker,{amount:unit.s.atk*counterScale*counterMul,type:'arts',isSkill:false,sourceKey:counterAttackId});},{owner:unit,priority:-30});
    }
    if(charId==='char_2026_yu'){
      const params=plan.talents[1]?.parameters??{},minOps=scale(runtimeBody,params,'minOps',4),hpPerSec=0,epPerSec=0;/* 卡面无编队回血：旧天赋已被 bazaar 岁施放充能行替换 */
      if(!unit._assaultYuRosterTimer)unit._assaultYuRosterTimer=battle.every(1,()=>{if(!active(unit)||battle.allyUnits.filter(x=>x.kind==='op'&&x.ownerId===unit.ownerId&&active(x)).length<minOps)return;if(hpPerSec>0)heal(battle,unit,unit,{maxHpRatio:hpPerSec,regen:true,cause:battle.assaultRuntime.currentCause});if(epPerSec>0)reduceElement(unit,unit.gaugeMax*epPerSec);},{owner:unit});
    }
    if(false&&charId==='char_4087_ines'){/* 卡面无暗哨：旧四星天赋已被 bazaar 再部署充能行替换 */
      const params=plan.talents[1]?.parameters??{},slow=scale(runtimeBody,params,'slow',-0.3),key=`assault:${charId}:talent:shadowSentry`,moveMul=Math.max(0,1+slow);
      battle.on('death',event=>{const ctx=event.payload??event;if(ctx.unit!==unit||ctx.reason==='expired')return;unit.mem??={};unit.mem.assaultInesSentryRange=new Set(unit.baseRangeKeys??unit.rangeKeys??[]);battle.fx('sentry',{x:unit.x,y:unit.y,id:unit.id});},{owner:unit,priority:20});
      battle.every(0.25,()=>{const keys=new Set();if(active(unit))for(const k of unit.rangeKeys??[])keys.add(k);for(const k of unit.mem?.assaultInesSentryRange??[])keys.add(k);if(!keys.size)return;for(const target of battle.enemies){if(!active(target)||!bodyInKeys(target,keys))continue;buff(battle,unit,target,{key,mods:{moveMul},flags:{reveal:true},duration:0.5,cause:battle.assaultRuntime.currentCause});}},{owner:unit});
    }
    if(charId==='char_423_blemsh'){
      const spGain=0/* 旧「攻击回技力」天赋已被 bazaar 卡西米尔受击充能行替换 */,sleepAtk=scale(runtimeBody,plan.talents[1]?.parameters??{},'atkScale',1);
      unit.profile.hitSleep=true;
      battle.on('attack',event=>{const ctx=event.payload??event,attacker=ctx.attacker,key=`assault:${charId}:talent:offensiveRecovery`;if(!active(unit)||attacker?.kind!=='op'||attacker.ownerId!==unit.ownerId||attacker.skill?.spType!=='hurt'||spGain<=0)return;sp(battle,unit,attacker,spGain,key,key,battle.assaultRuntime.currentCause);},{owner:unit});
      battle.on('beforeAttack',event=>{const ctx=event.payload??event;if(ctx.attacker!==unit)return;const sleeper=enemies(battle,unit,{scope:'range',count:99,allowUntargetable:true}).find(target=>hasStatus(target,'sleep'));if(sleeper)ctx.targets=[sleeper,...(ctx.targets??[]).filter(target=>target!==sleeper)].slice(0,Math.max(1,ctx.targets?.length??1));},{owner:unit});
      battle.on('hit',event=>{const ctx=event.payload??event,target=ctx.target,dmg=ctx.dmg;if(ctx.source!==unit||target?.side!=='enemy'||!dmg?.isAttack||!hasStatus(target,'sleep')||sleepAtk<=1)return;dmg.mul*=sleepAtk;},{owner:unit,priority:-15});
    }
    if(charId==='char_2025_shu'){
      installShuPlots(battle,unit,runtimeBody,plan,star);
      const params=plan.talents[1]?.parameters??{},hpBonus=0,attackSpeed=0,attackBonus=0,spInterval=0/* 卡面无编队加成：旧四星天赋已被 bazaar 岁施放充能行替换 */,key=`assault:${charId}:talent:seasons:${uid(unit)}`;
      const roster=()=>battle.allyUnits.filter(x=>active(x)&&x.kind==='op'&&x.ownerId===unit.ownerId),profession=x=>x.def?.profession??x.profession,tags=x=>x.def?.raw?.assaultBody?.tags??x.def?.tags??[];
      const counts=()=>{const team=roster(),professions=new Set(team.map(profession)),sui=team.filter(x=>tags(x).includes('sui')).length;return {team,professions,sui};};
      battle.every(0.25,()=>{if(!active(unit))return;const {team,professions,sui}=counts(),different=team.length>=3&&professions.size>=3,same=team.some(x=>team.filter(y=>profession(y)===profession(x)).length>=3),fourSui=sui>=4;for(const ally of team){const mods={};if(different&&hpBonus>0)mods.hpMul=1+hpBonus;if(same&&attackSpeed>0)mods.aspd=attackSpeed;if(fourSui&&attackBonus>0)mods.atkMul=1+attackBonus;if(Object.keys(mods).length)battle.addBuff(ally,{key:`${key}:${uid(ally)}`,mods,duration:0.5,refresh:'replace',source:unit,tags:['talent']});}},{owner:unit});
      if(spInterval>0)battle.every(spInterval,()=>{if(!active(unit))return;const {team,sui}=counts();if(sui<4)return;for(const ally of team)ally.skill?.gainSp(1,`assault:${charId}:four-sui-roster`);},{owner:unit});
    }    if(charId==='char_311_mudrok'){
      const star=unit.assaultStar??unit.input_piece?.star??unit.inputPiece?.star??1,module002=star>=3&&unit.assaultSupportModules?.has('uniequip_002_mudrok')===true,params=plan.talents[0]?.parameters??{},interval=scale(runtimeBody,params,'interval',9),cap=scale(runtimeBody,params,'maxShields',3)+(module002?1:0),baseBreakHeal=scale(runtimeBody,params,'breakHeal',0.2),breakHeal=module002?moduleValue(runtimeBody,'uniequip_002_mudrok','h',{percent:true}):baseBreakHeal,layerKey=`assault:${charId}:talent:layers:${uid(unit)}`,defKey=`assault:${charId}:talent:shieldDefense:${uid(unit)}`,sarkazReduction=0;/* 卡面无萨卡兹减伤：旧天赋已被 bazaar 罗德岛施放充能行替换 */const syncDefense=()=>{if(star>=4&&(unit.findBuff(layerKey)?.shieldHits??0)>0)battle.addBuff(unit,{key:defKey,mods:{defMul:1.2},duration:Infinity,refresh:'replace',source:unit,tags:['talent']});else battle.removeBuff(unit,defKey);};
      const deployLayers=()=>{unit.mem??={};unit.mem.assaultMudrockLayers=Math.min(cap,Math.max(1,unit.mem.assaultMudrockLayers??0));battle.addBuff(unit,{key:layerKey,shieldHits:unit.mem.assaultMudrockLayers,source:unit,visible:true,tags:['talent']});syncDefense();};
      battle.on('deploy',event=>{if(event.unit===unit)deployLayers();},{owner:unit});
      battle.every(interval,()=>{if(!active(unit)){battle.removeBuff(unit,defKey);return;}const current=unit.findBuff(layerKey)?.shieldHits??0;if(current<cap){unit.mem.assaultMudrockLayers=current+1;battle.addBuff(unit,{key:layerKey,shieldHits:current+1,source:unit,visible:true,tags:['talent']});}syncDefense();},{owner:unit});
      battle.on('shieldLayersBroken',event=>{const ctx=event.payload??event;if(ctx.unit!==unit||ctx.buff?.key!==layerKey)return;unit.mem.assaultMudrockLayers=ctx.buff.shieldHits;if(breakHeal>0)heal(battle,unit,unit,{maxHpRatio:breakHeal,cause:battle.assaultRuntime.currentCause});syncDefense();},{owner:unit});battle.on('retreat',event=>{const ctx=event.payload??event;if((ctx.unit??ctx.target)===unit)battle.removeBuff(unit,defKey);},{owner:unit});battle.on('death',event=>{const ctx=event.payload??event;if((ctx.unit??ctx.target)===unit)battle.removeBuff(unit,defKey);},{owner:unit});
      battle.on('hit',event=>{const ctx=event.payload??event,source=ctx.source??ctx.attacker;if(ctx.target!==unit||!ctx.dmg||sarkazReduction<=0||!(source?.def?.tags??[]).includes('sarkaz'))return;ctx.dmg.mul*=1-sarkazReduction;},{owner:unit,priority:-20});
    }    if(charId==='char_427_vigil'){
      const penetration=scale(runtimeBody,plan.talents[1]?.parameters??{},'defPenetrate',0);
      battle.on('hit',event=>{const ctx=event.payload??event,source=ctx.source??ctx.attacker,target=ctx.target;if(!(source===unit||source?.kind==='token'&&source.ownerUnit===unit)||!(target?.blockedBy?.kind==='token'&&target.blockedBy.ownerUnit===unit)||!ctx.dmg||penetration<=0)return;ctx.dmg.defIgnoreFlat=(ctx.dmg.defIgnoreFlat??0)+penetration;},{owner:unit,priority:-20});
    }    if(charId==='char_427_vigil'){
      const params=plan.talents[0]?.parameters??{},baseInterval=scale(runtimeBody,params,'interval',25),interval=Math.max(0,baseInterval-(chosenModules.includes('uniequip_002_vigil')?3:0)),cap=scale(runtimeBody,params,'maxShadows',3);let pulse=0;
      if(interval>0&&cap>0)battle.every(interval,()=>{if(!active(unit))return;grantSummon(battle,unit,{tokenId:SUPPORT_TOKEN_IDS.vigil_wolfpack,count:1,stockCap:cap,fieldCap:cap,ruleKey:`assault:${charId}:talent:wolf-regroup:${++pulse}`,kit:supportTokenKits[SUPPORT_TOKEN_IDS.vigil_wolfpack]});},{owner:unit});
    }
    if(charId==='char_4179_monstr'){
      const params=plan.talents[1]?.parameters??{},attackSpeed=scale(runtimeBody,params,'attackSpeed',0),duration=scale(runtimeBody,params,'duration',10),key=`assault:${charId}:talent:tacticalSynergy`;
      battle.on('heal',event=>{const ctx=event.payload??event,source=ctx.source,target=ctx.target,ownedReconstruction=source?.kind==='token'&&source.ownerUnit===unit&&source.defId===SUPPORT_TOKEN_IDS.monstr_reconstruction;if(!active(unit)||!(source===unit||ownedReconstruction)||!active(target)||target.side!=='ally'||!(ctx.amount>0)||attackSpeed<=0||duration<=0)return;buff(battle,unit,target,{key,mods:{aspd:attackSpeed},duration,stacking:'replace',cause:battle.assaultRuntime.currentCause});buff(battle,unit,unit,{key,mods:{aspd:attackSpeed},duration,stacking:'replace',cause:battle.assaultRuntime.currentCause});},{owner:unit});
    }
    if(charId==='char_1016_agoat2'){
      const params=plan.talents[1]?.parameters??{},hpBonus=0,elementResistance=0,key=`assault:${charId}:talent:ash-field:${uid(unit)}`;/* 卡面无范围场：旧四星天赋已被 bazaar 元素爆发充能行替换 */
      battle.every(0.25,()=>{if(!active(unit)||!(hpBonus>0||elementResistance>0))return;for(const target of ownerScoped(unit,allies(battle,unit,{scope:'range',priority:'hp',count:99})))battle.addBuff(target,{key,mods:{hpMul:1+hpBonus},duration:0.5,refresh:'replace',source:unit,data:{epCut:elementResistance}});},{owner:unit});
      battle.on('elementHit',event=>{const ctx=event.payload??event,target=ctx.target,dmg=ctx.dmg,field=target?.buffs?.find(x=>x.key===key);if(!field||field.source!==unit||dmg?.type!=='element'||!(field.data?.epCut>0))return;dmg.mul*=1-field.data.epCut;},{owner:unit,priority:20});
      const mist=plan.talents[0]?.parameters??{},regenScale=scale(runtimeBody,mist,'regenScale',0),mistDuration=v(runtimeBody,runtimeBody.bazaar.lines[1].params.d),maxStacks=scale(runtimeBody,mist,'maxStacks',3)+(unit.assaultSupportModules?.has('uniequip_002_agoat2')?1:0),mistKey=`assault:${charId}:talent:mist:${uid(unit)}`;
      const elementHealRatio=()=>Number(unit.profile?.heal?.elementHealRatio??runtimeBody.elementHealRatio??0.5);
      battle.on('heal',event=>{const ctx=event.payload??event,target=ctx.target;if(ctx.source!==unit||ctx.opts?.hot||ctx.opts?.aura||ctx.opts?.regen||ctx.opts?.skillHeal||!active(target)||target.side!=='ally'||!(ctx.amount>0)||!(regenScale>0&&mistDuration>0&&maxStacks>0))return;const effect=battle.addBuff(target,{key:mistKey,duration:mistDuration,refresh:'independent',stacks:1,maxStacks,interval:1,source:unit,data:{atk:unit.s.atk},onTick:({battle:current,unit:healed,buff:entry})=>{const amount=v(runtimeBody,runtimeBody.bazaar.lines[1].params.r);current.reduceElement(healed,amount*elementHealRatio());if(healed.hp<healed.s.maxHp)current.heal(unit,healed,amount,{hot:true});}});if(effect)effect.data={...(effect.data??{}),atk:unit.s.atk};if(unit.assaultSupportModules?.has('uniequip_002_agoat2')&&star>=4&&(target.buffs??[]).filter(b=>b.key===mistKey&&b.source===unit&&b.timeLeft>0).length>=maxStacks){const barrier=unit.mem?.supportAgoatBarrierStates?.get(uid(target));if(barrier&&battle.time<barrier.expires){barrier.left=barrier.pool;barrier.expires=battle.time+barrier.duration;}}},{owner:unit,priority:10});
    }
    if(charId==='char_2026_yu'){
      battle.every(1,()=>{if(!active(unit)||!(unit.blocking?.some(active)))return;perform(battle,unit,runtimeBody,{action:'nativeMechanism',target:'blockedEnemiesAndSelf',params:plan.passives[0]?.params??{}},'assault:char_2026_yu:passive:礼尚往来',null,null);}, {owner:unit});
    }
    if(charId==='char_249_mlyss'){
      const tokenId=SUPPORT_TOKEN_IDS.mlyss_flowshape,star=Math.max(1,Math.min(4,unit.input_piece?.star??unit.inputPiece?.star??unit.def?.raw?.assaultPiece?.star??1));
      const summon=()=>{if(!active(unit)||battle.allyUnits.some(x=>x.kind==='token'&&x.ownerUnit===unit&&active(x)))return;unit._mlyssRefreshTimer?.cancel();unit._mlyssRefreshTimer=null;grantSummon(battle,unit,{tokenId,count:1,stockCap:1,fieldCap:1,ruleKey:'mlyss-flowshape',kit:supportTokenKits[tokenId]});};
      summon();battle.on('deploy',event=>{if(event.unit===unit)summon();},{owner:unit});
      const refresh=Math.max(0,(plan.talents[0]?.parameters?.refreshSec?.[star-1]??30)-(unit.assaultSupportModules?.has('uniequip_003_mlyss')?5:0));
      battle.assaultRuntime.observe('summonDied',`mlyss-refresh:${uid(unit)}`,event=>{const token=event.payload?.target;if(token?.kind!=='token'||token.ownerUnit!==unit)return;unit._mlyssRefreshTimer?.cancel();unit._mlyssRefreshTimer=battle.after(refresh,()=>{unit._mlyssRefreshTimer=null;summon();},{owner:unit});},{owner:unit});
      const costCut=0,firstExtra=0;/* 卡面无莱茵生命减费：旧天赋已被 bazaar 召唤物加攻行替换 */
      const rhine=new Set(['char_108_silent','char_128_plosis','char_202_demkni','char_249_mlyss','char_1047_halo2']);
      battle.on('battleStart',()=>{const targets=battle.allyUnits.filter(x=>x.kind==='op'&&x.ownerId===unit.ownerId&&rhine.has(x.def?.charId)).sort((a,b)=>(a.deploySeq??0)-(b.deploySeq??0));targets.forEach((ally,i)=>{ally.base.cost=Math.max(0,ally.base.cost+costCut+(i===0?firstExtra:0));});},{owner:unit});
    }
    if(!single&&charId==='char_4194_rmixer'){
      const lethal=plan.skill.effects.find(x=>x.trigger==='lethalWhileAmmo');
      battle.on('hpDamage',event=>{const ctx=event.payload??event,need=scale(runtimeBody,lethal?.params??{},'ammoRequired',20);if(ctx.target!==unit||!active(unit)||!unit.skill||ctx.dmg?.type==='element'||ctx.amount<unit.hp||assaultAmmoState(unit)?.current<need)return;ctx.amount=0;consumeAssaultAmmo(battle,unit,scale(runtimeBody,lethal.params,'consume',20),`assault:${charId}:lethal-salvage`,{isSkill:false});},{owner:unit,priority:-100});
      const barrierTalent=plan.talents[1]?.parameters;
      if(barrierTalent){const barrierKey=`assault:${charId}:talent:idleBarrier`;let lastActiveAt=battle.time,hadBarrier=false;const interval=scale(runtimeBody,barrierTalent,'interval',8),ratio=scale(runtimeBody,barrierTalent,'barrier',0.15);battle.on('attack',event=>{const ctx=event.payload??event;if(ctx.attacker===unit)lastActiveAt=battle.time;},{owner:unit});battle.every(0.25,()=>{if(!active(unit))return;const exists=unit.buffs?.some(x=>x.key===barrierKey&&(x.shield??0)>0);if(exists){hadBarrier=true;return;}if(hadBarrier){lastActiveAt=battle.time;hadBarrier=false;}if(battle.time-lastActiveAt+1e-9<interval)return;const shield=unit.s.maxHp*ratio;if(shield>0){battle.addBuff(unit,{key:barrierKey,shield,visible:true,source:unit,tags:['talent'],onRemove:()=>{lastActiveAt=battle.time;hadBarrier=false;}});hadBarrier=true;}},{owner:unit});}
    }
    for(const [group,effects] of [['talents',plan.talents.flatMap((x,i)=>x.mode==='none'?[]:x.effects.map(e=>({...e,key:`talent:${i}:${e.index}`})))],['passives',plan.passives.map(e=>({...e,key:`passive:${e.index}`}))]])for(const e of effects){
      if(supportBazaarSuppressed.has(`${charId}:${e.key}`))continue;
      if(group==='passives'&&supportRetainedExtraHandledKeys.has(`${charId}:talent:${e.index}`))continue;
      if(charId==='char_1016_agoat2'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_311_mudrok'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_2025_shu'&&((group==='talents'&&e.index===1)||(group==='passives'&&e.index===0)))continue;
      if(charId==='char_249_mlyss'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_420_flamtl'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_4114_harold'&&group==='passives'&&e.index<=1)continue;
      if(charId==='char_4026_vulpis'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_4222_taraxa'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_4148_philae'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_4087_ines'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_416_zumama'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_4065_judge'&&group==='passives'&&e.index===0)continue;
      if(charId==='char_4137_udflow'&&group==='passives'&&e.index===0){
        const p=e.params??{},amount=scale(runtimeBody,p,'dotPerSec',0),duration=scale(runtimeBody,p,'duration',3),interval=scale(runtimeBody,p,'interval',1),seaMultiplier=scale(runtimeBody,p,'seamonsterMultiplier',2);
        battle.on('damaged',event=>{const ctx=event.payload??event,target=ctx.target;if(ctx.source!==unit||!active(unit)||!ctx.dmg?.isAttack||target?.side!=='enemy'||!target.alive)return;const sea=target.def?.tags?.includes('seamonster')===true;const tickAmount=amount*(sea?seaMultiplier:1);if(!(tickAmount>0&&duration>0&&interval>0))return;const dotKey=`assault:${charId}:talent:cellular-decay:${uid(unit)}:${uid(target)}`;battle.addBuff(target,{key:dotKey,duration,interval,refresh:unit.assaultSupportModules?.has('uniequip_002_udflow')?'independent':'replace',maxStacks:unit.assaultSupportModules?.has('uniequip_002_udflow')?2:1,source:unit,visible:false,tags:['talent','dot'],onTick:({battle:b,unit:enemy})=>b.dealDamage(unit,enemy,{amount:tickAmount,type:'arts',canDodge:false,tags:['dot','assaultSupport']})});},{owner:unit});
        continue;
      }
      if(charId==='char_4056_titi'&&group==='passives'&&e.trigger==='enemySleepPresent'){
        const interval=scale(runtimeBody,e.params??{},'interval',1),ratio=scale(runtimeBody,e.params??{},'dotScale',0);
        let scheduled=false;const start=()=>{if(scheduled)return;scheduled=true;battle.every(interval,()=>{if(!active(unit)||ratio<=0)return;for(const target of targets(battle,unit,e,null)){if(!active(target)||!hasStatus(target,'sleep'))continue;battle.dealDamage(unit,target,{amount:unit.s.atk*ratio,type:'arts',ignoreSleep:true,tags:['talent','assaultSupport']});}},{owner:unit});};
        battle.on('battleStart',start,{owner:unit});battle.on('deploy',event=>{if(event.unit===unit)start();},{owner:unit});continue;
      }
      if(charId==='char_385_finlpp'&&group==='passives'&&e.index===0){
        const p=e.params??{},duration=scale(runtimeBody,p,'resistSec',0),resistValue=scale(runtimeBody,p,'statusDurationMultiplier',0.5),selfAlso=!!scale(runtimeBody,p,'selfAlso',0),elementMultiplier=scale(runtimeBody,p,'elementSlotMultiplier',1),activeResistUntil=new Map(),resistKey=`assault:${charId}:talent:resist`;
        const grant=(target)=>{if(!active(target)||target.side!=='ally'||duration<=0)return;applyStatus(battle,unit,target,{status:'resist',duration,value:resistValue,key:resistKey,cause:battle.assaultRuntime.currentCause});activeResistUntil.set(uid(target),battle.time+duration);};
        battle.on('heal',event=>{const ctx=event.payload??event,target=ctx.target;if(ctx.source!==unit||target?.side!=='ally'||!target.alive||!(ctx.amount>0))return;grant(target);if(selfAlso&&target!==unit)grant(unit);const cleanse=p.cleanseOnHealAbnormal;if(cleanse?.enabled&&v(runtimeBody,cleanse.enabled)){const priority=cleanse.priority??[],max=cleanse.maxRemove??1;let removed=0;for(const status of priority){if(removed>=max)break;const existing=target.buffs?.find(b=>b.status===status||b.key===status);if(existing){battle.removeBuff(target,existing);removed++;}}}},{owner:unit});
        if(elementMultiplier!==1)battle.on('elementHit',event=>{const ctx=event.payload??event,expires=activeResistUntil.get(uid(ctx.target));if(expires==null||battle.time>expires||!(ctx.dmg?.mul>0))return;ctx.dmg.mul*=elementMultiplier;},{owner:unit,priority:-25});
        continue;
      }
      if(charId==='char_4017_puzzle'&&group==='passives'&&e.trigger==='hitFullHpEnemy'){
        const p=e.params??{},multiplier=scale(runtimeBody,p,'atkScale',1),spGain=scale(runtimeBody,p,'spGain',0),key=`assault:${charId}:talent:fullHpHit`;
        battle.on('hit',event=>{const ctx=event.payload??event,target=ctx.target,dmg=ctx.dmg;if(ctx.source!==unit||target?.side!=='enemy'||!dmg?.isAttack||target.hp+1e-9<target.s.maxHp)return;if(multiplier>1)dmg.mul*=multiplier;if(spGain>0)sp(battle,unit,unit,spGain,key,key,battle.assaultRuntime.currentCause);},{owner:unit,priority:-20});
        continue;
      }
      const ev=EVENT[e.trigger];if(!ev)throw new Error(`${charId} missing native Battle event for typed trigger ${e.trigger}`);
      const fn=event=>{if(!active(unit))return;const ctx=event.payload??event;const source=ctx.source??ctx.attacker??ctx.unit??ctx.killer;const target=ctx.target??ctx.unit;if(e.trigger==='normalHeal'&&source!==unit)return;if(['healed','healedIncludingModule'].includes(e.trigger)&&source!==unit)return;const dpObserver=['dpReceived','dpReceivedPerPoint'].includes(e.trigger)&&(ctx.targetUid===unit.ownerId||ctx.target?.playerId===unit.ownerId);const accepted=e.trigger==='enemyKilled'?(ctx.killer===unit&&(ctx.unit??ctx.target)?.side==='enemy'):e.trigger==='battleStart'||(OWNED_OBSERVER_TRIGGERS.has(e.trigger)?observerAccepts(e.trigger,battle,unit,ctx):(dpObserver||source===unit||target===unit||ctx.attacker===unit||ctx.unit===unit));if(!accepted)return;if(e.trigger==='damageDealt'&&(source!==unit||target?.side!=='enemy'||!(ctx.amount>0)))return;if(e.trigger==='attackedWithOwnBarrier'&&(target!==unit||!unit.buffs?.some(x=>(x.shield??x.shieldHp??0)>0||x.shieldLayers>0)))return;if(['attacked','magicDamageTaken','decayDamageTaken'].includes(e.trigger)&&target!==unit)return;if(e.trigger==='hitSleepingEnemy'&&!hasStatus(target,'sleep'))return;const key=`assault:${charId}:${group}:${e.key}`;const p=e.params??{};if(charId==='char_431_ashlok'&&group==='passives'&&e.trigger==='attack'){if(ctx.attacker!==unit)return;const around=[[unit.tileR+1,unit.tileC],[unit.tileR-1,unit.tileC],[unit.tileR,unit.tileC+1],[unit.tileR,unit.tileC-1]],allGround=around.every(([r,c])=>battle.grid.tile(r,c).height==='LOW'),atk=scale(runtimeBody,p,allGround?'atkOnGround':'atk',0);if(atk>0)buff(battle,unit,unit,{key,mods:{atkMul:1+atk},duration:scale(runtimeBody,p,'duration',4),stacking:'replace',cause:event.cause??null});return;}if(charId==='char_496_wildmn'&&group==='passives'&&e.trigger==='enemyKilled'){const victim=ctx.unit??ctx.target;if(ctx.killer!==unit||victim?.side!=='enemy')return;const max=scale(runtimeBody,p,'maxPerBattle',0),cut=scale(runtimeBody,p,'costReduce',0);unit.mem??={};const count=unit.mem.assaultWildmaneKillDiscounts??0;if(count>=max||cut<=0)return;unit.mem.assaultWildmaneKillDiscounts=count+1;unit.mem.assaultCostDelta=Math.max(-unit.base.cost,(unit.mem.assaultCostDelta??0)-cut);return;}if(['dpReceived','dpReceivedPerPoint'].includes(e.trigger)&&p.maxStacks!=null&&p.rechargeSec!=null){applyDpStack(battle,unit,runtimeBody,e,key);return;}if(p.spPerSec!=null||p.healPerSec!=null||p.magicPerSec!=null||p.dotPerSec!=null){repeatEffect(battle,unit,runtimeBody,e,key,event.cause??null);return;}perform(battle,unit,runtimeBody,e,key,{...ctx,target,source,targets:ctx.targets??ctx.payload?.targets},event.cause??null);};
      if(ev==='dpReceived')battle.assaultRuntime.observe(ev,`support:${uid(unit)}:${e.key}`,fn,{owner:unit});
      else battle.on(ev,fn,{owner:unit});
    }
  }});
}
export const supportKits=Object.fromEntries(Object.keys(supportPlans).map(charId=>[charId,(_battle,raw,def)=>build(charId,raw,def)]));
