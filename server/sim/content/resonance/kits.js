// Resonance fixes a source skill per operator before Battle setup. Hand-written runtime specs are reused only when the
// native kit explicitly authors that skill; selected skills without an authored native variant get a local signature kit.
import { KITS, skillSpecSource } from '../index.js';
import { absoluteRangeKeys } from '../../targeting.js';
import { ROWS, COLS } from '../../constants.js';

const plain = (id) => String(id ?? '').replace(/_[ab]$/, '');
function contentOf(catalog) { return catalog?.resonanceContent ?? catalog ?? {}; }

function authoredSpec(def, skillId, fn) {
  if (typeof fn !== 'function') return null;
  try {
    const raw = def?.raw ?? def;
    const kit = fn(def?.skill?.bb ?? {}, raw, def);
    if (!kit || kit.generic) return null;
    if (kit.skills && Object.prototype.hasOwnProperty.call(kit.skills, skillId)) return kit.skills[skillId];
    const selected = def?.skill?.id ?? def?.skill?.skillId;
    if (selected === skillId && skillSpecSource(def, { [def?.baseId]: fn }) === 'kit' && kit.skill) return kit.skill;
  } catch { return null; }
  return null;
}

function signatureKit(operator, record, star) {
  const name = String(operator?.name ?? '');
  const skillId = operator?.fixedSkillId;
  const skill = record?.skill ?? {};
  const bb = skill.bb ?? skill.blackboard ?? {};
  const fixed = { id:skillId, spCost:numeric(record?.skill?.spCost,operator.stars?.[1]?.skillOverrides?.spCost??0), initSp:numeric(record?.skill?.initSp,operator.stars?.[1]?.skillOverrides?.initSp??0), spType:'time' };
  if(name==='令'&&skillId==='skchr_ling_3'){
    const dragonId=(record?.tokens??[]).find(id=>/ling_soul3/.test(String(id)))??'token_10020_ling_soul3';
    const talentCount=numeric(record?.talents?.[0]?.bb?.cnt,4),growthTalent=record?.talents?.[1]?.bb??{};
    const growthCap=numeric(growthTalent.max_stack_cnt,5),growthSp=numeric(growthTalent.sp,2),growthAtk=numeric(growthTalent.atk,.02);
    const maxSlots=3,pulseInterval=numeric(bb.interval,.5),pulseScale=numeric(bb.atk_scale,.2);
    const tokenOf=(unit)=>String(unit?.defId??'')===dragonId;
    const giveStock=(battle,unit,amount=1)=>{unit.mem.resonanceLingStock=Math.max(0,Math.min(talentCount,(unit.mem.resonanceLingStock??talentCount)+amount));};
    const finishSkill=(battle,unit)=>{const cast=unit.skill?.activations??0;if(unit.mem.resonanceLingStockGrantedCast===cast)return;unit.mem.resonanceLingStockGrantedCast=cast;giveStock(battle,unit,1);unit.mem.resonanceLingPulse=0;};
    const grow=(battle,unit)=>{if(unit.mem.resonanceLingGrowth>=growthCap)return;unit.mem.resonanceLingGrowth=(unit.mem.resonanceLingGrowth??0)+1;unit.skill?.gainSp?.(growthSp,'resonanceLingDragon');battle.addBuff(unit,{key:`resonance:ling:dragonGrowth:${unit.id}`,persist:true,allowDead:true,mods:{atkPct:unit.mem.resonanceLingGrowth*growthAtk},tags:['resonance','signature']});};
    const activeDragons=(battle,unit)=>battle.allyUnits.filter(row=>row.kind==='token'&&row.ownerUnit===unit&&tokenOf(row)&&row.alive&&row.deployed);
    const occupiedSlots=(battle,unit)=>activeDragons(battle,unit).reduce((n,row)=>n+(row.mem.resonanceLingAdvanced?2:1),0);
    const formBlackboard=(token)=>token.def?.raw?.skill?.bb??token.def?.raw?.skill?.blackboard??token.def?.skill?.bb??token.def?.skill?.blackboard??{};
    const makeAdvanced=(battle,token)=>{
      if(token.mem.resonanceLingAdvanced)return false;
      const form=formBlackboard(token),mul=(key)=>1+numeric(form[`2.${key}`],0);
      token.base.maxHp*=mul('max_hp');token.base.atk*=mul('atk');token.base.def*=mul('def');
      token.base.res*=1+numeric(form['2.magic_resistance'],0);token.base.bat+=numeric(form['2.base_attack_time'],0);token.base.blockCnt+=numeric(form['2.block_cnt'],0);
      if(star>=3){const passive=operator.stars?.[3]?.passive?.params??{};token.base.maxHp*=numeric(passive.dragonHpMultiplier,1);token.base.atk*=numeric(passive.dragonAtkMultiplier,1);token.mem.resonanceLingDragon=true;}
      token.mem.resonanceLingAdvanced=true;token.form='resonance_ling_advanced';
      token.profile.dmgType='arts';token.markDirty();token.hp=token.s.maxHp;
      if(battle.recordEvents)battle.fx('phase',{uid:token.uid,unitId:token.id,form:token.form});
      return true;
    };
    const mergeSmall=(battle,unit)=>{
      const basic=activeDragons(battle,unit).filter(row=>!row.mem.resonanceLingAdvanced).sort((a,z)=>a.id-z.id);let pair=null;
      for(const first of basic){const nearby=battle.unitsInGrid(first,first.rangeGrid??[[0,0]],{side:'ally'});const second=nearby.filter(row=>row!==first&&basic.includes(row)).sort((a,z)=>a.id-z.id)[0];if(second){pair=[first,second];break;}}
      if(!pair)return;
      const [first,second]=pair;second.mem.resonanceLingMerged=true;
      if(makeAdvanced(battle,first)){battle.retreat(second,{reason:'resonanceAbsorbed',permanent:true});grow(battle,unit);battle.resonanceMetric?.('triggers.signature_ling_merge');}
    };
    const summonOnCast=(battle,unit)=>{
      const casts=Math.max(0,Math.floor(numeric(record?.skill?.summonOnCast,0)));if(!casts)return;
      for(let n=0;n<casts;n++){
        if((unit.mem.resonanceLingStock??talentCount)<=0||occupiedSlots(battle,unit)>=maxSlots)break;
        const ps=battle.getPlayer(unit.ownerId),native=battle.tokenDef(dragonId,unit),cost=Math.max(0,numeric(native?.stats?.cost,0));if(!ps||ps.dp+1e-9<cost)break;
        const dragons=activeDragons(battle,unit),preferred=[];
        for(const d of dragons)for(const key of absoluteRangeKeys(d.rangeGrid??[[0,0]],d.tileR,d.tileC,d.dir))preferred.push([Math.floor(key/COLS),key%COLS]);
        let tile=preferred.find(([r,c])=>battle.grid.canStand(r,c)&&!battle.unitAt(r,c));
        if(!tile){outer:for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(battle.grid.canStand(r,c)&&!battle.unitAt(r,c)){tile=[r,c];break outer;}}
        if(!tile)break;
        const spawned=battle.spawnToken(unit,dragonId,tile[0],tile[1],{anySource:true});if(!spawned)break;
        ps.dp=Math.max(0,ps.dp-cost);
      }
    };
    return {
      ...fixed,kind:'duration',duration:numeric(record?.skill?.duration,25),mods:{atkPct:numeric(bb.atk,.55),defPct:numeric(bb.def,.5)},
      onStart:({battle,unit})=>{unit.mem.resonanceLingStock??=talentCount;summonOnCast(battle,unit);mergeSmall(battle,unit);for(const dragon of activeDragons(battle,unit))battle.addBuff(dragon,{key:`resonance:ling:skill:${unit.id}`,duration:unit.skill.timeLeft,mods:{atkPct:numeric(bb.atk,.55),defPct:numeric(bb.def,.5)},tags:['resonance','signature']});unit.mem.resonanceLingPulse=0;},
      onTick:({battle,unit,dt})=>{if(!unit.skill?.active)return;mergeSmall(battle,unit);unit.mem.resonanceLingPulse=(unit.mem.resonanceLingPulse??0)+dt;if(unit.mem.resonanceLingPulse+1e-9<pulseInterval)return;unit.mem.resonanceLingPulse-=pulseInterval;for(const dragon of activeDragons(battle,unit)){if(!dragon.mem.resonanceLingAdvanced)continue;const grid=dragon.rangeGrid??[],targets=battle.unitsInGrid(dragon,grid,{side:'enemy'});for(const enemy of targets)battle.dealDamage(unit,enemy,{amount:unit.s.atk*pulseScale,type:'arts',canDodge:false,tags:['resonance','signature','lingDragon']});if(targets.length)battle.resonanceMetric?.('triggers.signature_ling_pulse');}},
      onEnd:({battle,unit})=>finishSkill(battle,unit),
      talents:[{install(battle,unit){unit.mem.resonanceLingStock??=talentCount;battle.on('skillEnd',event=>{if(event?.unit===unit&&event.skill?.id===skillId)finishSkill(battle,unit);},{owner:unit});battle.on('deploy',event=>{const token=event?.unit;if(token?.kind!=='token'||token.ownerUnit!==unit||!tokenOf(token))return;if(unit.mem.resonanceLingMergeSpawn){token.mem.resonanceLingMerged=true;return;}if(unit.mem.resonanceLingFreeRebuild){unit.mem.resonanceLingFreeRebuild=false;token.mem.resonanceLingAdvanced=true;token.mem.resonanceLingDragon=true;if(unit.skill?.active)battle.addBuff(token,{key:`resonance:ling:skill:${unit.id}`,duration:unit.skill.timeLeft,mods:{atkPct:numeric(bb.atk,.55),defPct:numeric(bb.def,.5)},tags:['resonance','signature']});return;}const stock=unit.mem.resonanceLingStock??talentCount;if(stock<=0||occupiedSlots(battle,unit)>maxSlots){battle.retreat(token,{reason:'resonanceStockLimit',permanent:true});return;}unit.mem.resonanceLingStock=stock-1;if(unit.skill?.active)battle.addBuff(token,{key:`resonance:ling:skill:${unit.id}`,duration:unit.skill.timeLeft,mods:{atkPct:numeric(bb.atk,.55),defPct:numeric(bb.def,.5)},tags:['resonance','signature']});},{owner:unit});battle.on('death',event=>{const token=event?.unit;if(token?.kind==='token'&&token.ownerUnit===unit&&tokenOf(token)&&!token.mem.resonanceLingMerged)grow(battle,unit);},{owner:unit});battle.on('retreating',event=>{const token=event?.unit;if(token?.kind==='token'&&token.ownerUnit===unit&&tokenOf(token)&&!token.mem.resonanceLingMerged&&event.reason!=='resonanceStockLimit')grow(battle,unit);},{owner:unit});}}],
      tags:['resonance','signature',skillId],
    };
  }
  if(name==='黍'&&skillId==='skchr_shu_3'){
    const seedsOf=unit=>unit.mem.resonanceShuSeeds??(unit.mem.resonanceShuSeeds=new Map());
    const sourceOf=unit=>unit.mem.resonanceShuEnemySource??(unit.mem.resonanceShuEnemySource=new Map());
    const params=operator.stars?.[star]?.passive?.params??{};
    const talent=record?.talents?.[0]?.bb??{};
    const seedAround=(battle,unit,target)=>{
      const offsets=[[0,0],[1,0],[-1,0],[0,1],[0,-1]],map=seedsOf(unit);
      for(const [dr,dc]of offsets){const r=target.tileR+dr,c=target.tileC+dc;if(!battle.grid.walkable(r,c))continue;const key=`${unit.id}:${r},${c}`;if(!map.has(key)){const seed={key,r,c};map.set(key,seed);battle.resonanceAddFloor?.(key,'shuSeed',unit,[[r,c]],undefined);battle.resonanceMetric?.('triggers.signature_shu_seed');}}
    };
    const leader=enemy=>/BOSS|LEADER/i.test(String(enemy.def?.rank??enemy.s?.rank??''))||enemy.s?.flags?.boss===true;
    const teleport=(battle,unit,enemy,seed)=>{
      if(enemy.isFlying||enemy.s.flags.selfBound)return false;
      const toR=seed.r,toC=seed.c,fromR=Math.round(enemy.y),fromC=Math.round(enemy.x);
      if(!battle.grid.groundPassable(toR,toC)||Math.hypot(enemy.x-toC,enemy.y-toR)<=4)return false;
      if((fromR!==toR||fromC!==toC)&&!battle.grid.findPath(fromR,fromC,toR,toC))return false;
      if(leader(enemy)){
        if(star>=3&&params.leaderSlow){const now=battle.time,last=enemy.mem.resonanceShuLeaderSlowAt??-Infinity,cooldown=numeric(params.leaderSlowCooldown,3);if(now-last>=cooldown){enemy.mem.resonanceShuLeaderSlowAt=now;battle.addBuff(enemy,{key:`resonance:shu:leaderSlow:${unit.id}`,duration:numeric(params.leaderSlowDuration,3),mods:{moveMul:1-numeric(params.leaderSlowPercent,20)/100},source:unit,tags:['resonance','signature']});}}
        return false;
      }
      if(enemy.s.flags.noDisplace)return false;
      enemy.x=toC;enemy.y=toR;battle._unblock(enemy);if(enemy.route)enemy.route.pts=null;
        if(star>=3)battle.dealDamage(unit,enemy,{amount:unit.s.atk*numeric(params.teleportDamage,100)/100,type:'arts',canDodge:false,tags:['resonance','signature','shuTeleport']});battle.resonanceMetric?.('triggers.signature_shu_teleport');
      return true;
    };
    return {
      ...fixed,kind:'duration',duration:numeric(record?.skill?.duration,30),heal:true,mods:{atkPct:numeric(bb.atk,.22)},targeting:record?.skill?.rangeGrid?{rangeGrid:record.skill.rangeGrid}:undefined,
      attack:{healScale:numeric(bb.heal_scale,1),projectile:'none'},
      talents:[{install(battle,unit){
        battle.on('healed',event=>{if(event.source===unit&&unit.skill?.active&&event.amount>0&&event.target?.kind==='op')seedAround(battle,unit,event.target);},{owner:unit});
        battle.on('attack',event=>{if(event.attacker!==unit||!unit.skill?.active)return;const range=unit.skill?.rangeGrid??record?.skill?.rangeGrid??[],ally=battle.unitsInGrid(unit,range,{side:'ally'}).filter(row=>row.kind==='op'&&row.alive&&row.deployed&&row.hp<row.s.maxHp).sort((a,z)=>a.hpRatio-z.hpRatio||a.id-z.id)[0];if(ally)battle.heal(unit,ally,unit.s.atk,{tags:['resonance','shuSkillHeal']});},{owner:unit});
        battle.every(1,()=>{for(const seed of seedsOf(unit).values())for(const ally of battle.allyUnits){if(ally.kind!=='op'||!ally.alive||!ally.deployed||ally.tileR!==seed.r||ally.tileC!==seed.c)continue;battle.heal(unit,ally,numeric(talent.hp_recovery_per_sec,40),{tags:['resonance','shuSeed']});battle.addBuff(ally,{key:`resonance:shu:seedGuard:${unit.id}:${seed.key}`,duration:1.1,mods:{dmgTakenMul:1-numeric(talent.damage_resistance,.05)},tags:['resonance','signature']});}},{owner:unit});
      }}],
      onStart:({unit})=>{unit.mem.resonanceShuEnemySource??=new Map();},
      onTick:({battle,unit})=>{
        const range=unit.skill?.rangeGrid??record?.skill?.rangeGrid??[];
        if(unit.skill?.active){for(const ally of battle.unitsInGrid(unit,range,{side:'ally'})){if(ally.kind==='op'&&ally.alive&&ally.deployed)battle.addBuff(ally,{key:`resonance:shu:skillAura:${unit.id}`,duration:.35,mods:{atkPct:numeric(bb.e_atk,.15),aspd:numeric(bb.e_ASPD,15)},tags:['resonance','signature']});}}
        if(!unit.skill?.active)return;
        const sources=sourceOf(unit);
        for(const enemy of battle.enemies.filter(x=>x.alive&&x.deployed&&!x.hidden&&!x.isFlying)){
          const r=enemy.tileR,c=enemy.tileC,seed=seedsOf(unit).get(`${unit.id}:${r},${c}`);
          if(seed&&!sources.has(enemy.id)){sources.set(enemy.id,{r,c});continue;}
          const origin=sources.get(enemy.id);if(origin&&Math.hypot(enemy.x-origin.c,enemy.y-origin.r)>4&&teleport(battle,unit,enemy,origin))battle.resonanceMetric?.('triggers.shuTeleport');
        }
      },
      onEnd:({unit})=>{sourceOf(unit).clear();},
      tags:['resonance','signature',skillId],
    };
  }
  if (name === '白金' && skillId === 'skchr_platnm_2') return {
    ...fixed, kind:'duration', duration:Infinity,
    mods:{atkPct:numeric(bb.atk,0),aspd:numeric(bb.attack_speed,0)},
    targeting: record?.skill?.rangeGrid ? { rangeGrid: record.skill.rangeGrid } : undefined,
    talents:[{install(battle,unit){let last=battle.time;const talent=operator.source?.normalChess?.talents?.[0]?.bb??{};battle.on('hit',c=>{if(c.source!==unit||!c.dmg?.isAttack)return;const elapsed=Math.max(0,battle.time-last);last=battle.time;const min=numeric(talent['attack@min_delta'],1),max=numeric(talent['attack@max_delta'],2.5),lo=numeric(talent['attack@min_atk_scale'],1),hi=numeric(talent['attack@max_atk_scale'],1.4);const ratio=Math.max(0,Math.min(1,(elapsed-min)/Math.max(.001,max-min)));c.dmg.mul=(c.dmg.mul??1)*(lo+(hi-lo)*ratio);},{owner:unit});}}],
    tags:['resonance','signature',skillId],
  };
  if (name === '万顷' && skillId === 'skchr_wanqin_2') return {
    ...fixed, kind:'duration', duration:numeric(record?.skill?.duration,15), mods:{aspd:numeric(bb['attack@attack_speed'],0)}, attack:{noAttack:true},
    onStart:({unit})=>{unit.mem.wanqinRes={elapsed:0,gained:0,healElapsed:0};},
    onTick:({battle,unit,dt})=>{
      if(!unit.alive||!unit.deployed)return;const s=unit.mem.wanqinRes;if(!s)return;
      s.elapsed+=dt;s.healElapsed+=dt;const iv=numeric(bb['wanqin_s_2[cost].interval'],.75),each=numeric(bb['wanqin_s_2[cost].cost'],1),cap=numeric(bb.value,20);
      while(s.elapsed+1e-9>=iv&&s.gained<cap){s.elapsed-=iv;s.gained+=each;battle.addDp(unit.ownerId,each,{sourceUnitId:unit.id});}
      if(s.healElapsed+1e-9>=1){s.healElapsed%=1;const grid=unit.skill?.rangeGrid??unit.def?.skill?.rangeGrid??record?.skill?.rangeGrid??[];for(const a of battle.unitsInGrid(unit,grid,{side:'ally'})){if(a.kind==='op'&&a.alive&&a.deployed)battle.heal(unit,a,unit.s.atk*.12,{tags:['resonance']});}}
    },
    onEnd:({unit})=>{unit.mem.wanqinRes=null;},
    talents:[{install(battle,unit){battle.every(.5,()=>{if(!unit.alive||!unit.deployed)return;for(const a of battle.alliesFor(unit)){if(a.kind!=='op'||!a.alive||!a.deployed)continue;const d=Math.hypot(a.tileR-unit.tileR,a.tileC-unit.tileC);if(d<=1.5){const same=a.dir===unit.dir;battle.addBuff(a,{key:`resonance:wanqinTalent:${unit.id}`,duration:.6,mods:{hpPct:same?.05:.03,aspd:same?15:0},tags:['resonance','talent']});}}},{owner:unit,immediate:true});}}],
    tags:['resonance','signature',skillId],
  };
  if (name === '奥斯塔' && skillId === 'skchr_aosta_2') return {
    ...fixed,kind:'duration',duration:numeric(record?.skill?.duration,21),mods:{atkPct:numeric(bb.atk,0),batPct:numeric(bb.base_attack_time,0)/Math.max(.1,numeric(record?.stats?.bat,1))},
    attack:{onHit:({battle,unit,target})=>{if(target?.alive)battle.applyStatus(target,'bind',{duration:numeric(bb['attack@frozen_duration'],1),source:unit});}},
    talents:[{install:(battle,unit)=>{battle.on('attack',c=>{if(c.attacker!==unit||!c.targets?.length)return;for(const target of c.targets){if(target.side!=='enemy'||!target.alive||target.blockedBy)continue;const scale=numeric(unit.skill?.active?bb.talent_scale:1,1);battle.addBuff(target,{key:`resonance:aostaDot:${unit.id}`,duration:3,interval:1,source:unit,data:{dps:unit.s.atk*.12*scale},onTick:({battle:b,unit:enemy,buff})=>{if(enemy.alive)b.dealDamage(unit,enemy,{amount:buff.data.dps,type:'arts',tags:['resonance','dot'],canDodge:false});},tags:['resonance','dot']});}},{owner:unit});}}],tags:['resonance','signature',skillId],
  };
  if (name === '贾维' && skillId === 'skchr_chiave_2') return {
    ...fixed,kind:'instant',
    talents:[{install(battle,unit){const redeploy=numeric(record?.talents?.[0]?.bb?.respawn_time,0.4);battle.every(.25,()=>{const robots=battle.allyUnits.filter(x=>x.kind==='op'&&x!==unit&&x.alive&&x.deployed&&(x.def?.subProfessionId??x.def?.raw?.subProfessionId??x.def?.subProf)==='notchar1');if(robots.length!==unit.mem.resonanceRobotCount){unit.mem.resonanceRobotCount=robots.length;battle.addBuff(unit,{key:`resonance:chiaveRobots:${unit.id}`,persist:true,allowDead:true,mods:{atkPct:robots.length*.07,defPct:robots.length*.07},tags:['resonance','talent']});}for(const robot of robots)battle.addBuff(robot,{key:`resonance:chiaveRobotDeploy:${unit.id}`,duration:.35,source:unit,mods:{redeployMul:Math.max(0,1-redeploy)},tags:['resonance','talent']});},{owner:unit,immediate:true});}}],
    onStart:({battle,unit})=>{battle.addDp(unit.ownerId,numeric(bb.cost,11),{sourceUnitId:unit.id});for(const e of battle.foesInRadius(unit.x,unit.y,1.5,true)){battle.dealDamage(unit,e,{amount:unit.s.atk*numeric(bb.atk_scale,2.5),type:'arts',tags:['resonance','signature'],canDodge:false});battle.addBuff(e,{key:`resonance:chiaveRes:${unit.id}`,duration:numeric(bb.duration,6),mods:{resFlat:numeric(bb.magic_resistance,-.1)*100},tags:['resonance']});}},
    tags:['resonance','signature',skillId],
  };
  if (name === '正义骑士号') return { ...fixed, kind:'passive',spCost:0,initSp:0,spType:'none',trigger:'NEVER',tags:['resonance','signature',skillId],talents:[{install(battle,unit){const p=operator.stars?.[star]?.passive?.params??{};const interval=numeric(p.interval,3),radius=numeric(p.range,2),duration=numeric(p.aspdDuration,p.duration??3);battle.every(interval,()=>{const a=battle.allyUnits.filter(x=>x.kind==='op'&&x.alive&&x.deployed&&Math.hypot(x.x-unit.x,x.y-unit.y)<=radius).sort((x,y)=>x.hpRatio-y.hpRatio||x.id-y.id)[0];if(a){battle.heal(unit,a,unit.s.atk*numeric(p.healFromAtk,50)/100,{tags:['resonance']});battle.addBuff(a,{key:`resonance:judgement:${unit.id}`,duration,mods:{aspd:numeric(p.aspd,20)},tags:['resonance']});}},{owner:unit});}}] };
  return null;
}
function numeric(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

/** Return the Battle `opts.kits` map, keyed by the catalog's sourceChessId. */
export function createResonanceKits(catalog, state, data) {
  const content = contentOf(catalog);
  const result = Object.create(null);
  for (const [key, op] of Object.entries(content.operators ?? {})) {
    const sourceId = op.sourceChessId ?? key;
    const bare = plain(sourceId);
    const native = KITS[sourceId] ?? KITS[bare] ?? KITS[`${bare}_a`] ?? KITS[op.charId] ?? KITS[String(op.charId??'').replace(/_[ab]$/, '')];
    const records = Object.values(op.stars ?? {}).map((s) => s?.record).filter(Boolean);
    const first = records[0];
    const skillId = op.fixedSkillId ?? first?.skill?.skillId ?? first?.skill?.id;
    if (!skillId) continue;
    let def = null;
    try { def = data?.getChess?.(sourceId, { skillIndex: op.fixedSkillIndex ?? null }) ?? null; } catch { /* canonical fallback below */ }
    if (!def) def = first;
    const explicit = authoredSpec(def, skillId, native);
    const custom = signatureKit(op, first, 1);
    const yelaPermanent = op.charId === 'char_1046_sbell2' && skillId === 'skchr_sbell2_3';
    if (!explicit && !custom && !yelaPermanent) continue; // preserve the native registry resolution; coverage audit identifies remaining gaps
    result[sourceId] = (bb, chess, resolved) => {
      const nativeKit = native?.(bb, chess, resolved) ?? {};
      const selectedId = resolved?.skill?.id ?? resolved?.skill?.skillId ?? skillId;
      const star=starFor(op,state,resolved);
      let picked = authoredSpec(resolved, selectedId, native) ?? signatureKit(op, recordForStar(op, state, resolved), star);
      if(yelaPermanent&&star>=3){picked??=nativeKit.skills?.[selectedId]??nativeKit.skill;if(picked)picked={...picked,duration:Infinity};}
      if (!picked) return nativeKit;
      const talents=[...(nativeKit.talents??[]),...(picked.talents??[])].filter((t,i,a)=>a.findIndex(x=>x===t||(typeof t?.install==='function'&&x?.install===t.install))===i);
      return { ...nativeKit, ...(talents.length?{talents}:{}), skills: { ...(nativeKit.skills ?? {}), [selectedId]: picked }, skill: picked };
    };
  }
  return result;
}

function recordForStar(op, state, def) {
  const star = starFor(op, state, def);
  return op.stars?.[star]?.record ?? op.stars?.[1]?.record;
}
function starFor(op, state, def) {
  const raw=def?.raw??def??{};const explicit=Number(raw.resonanceStar??raw.resonance?.star);if(Number.isInteger(explicit)&&explicit>=1&&explicit<=3)return explicit;
  const entry = (state?.pieces??[]).find((u)=>String(u.uid)===String(def?.uid)) ??
    (state?.players?.flatMap((p) => p.units ?? []) ?? state?.units ?? []).find((u) => u.uid === def?.uid && (u.chessId === op.sourceChessId || u.charId === op.charId));
  const n = Number(entry?.star ?? entry?.stars ?? entry?.rank ?? 1);
  return Math.max(1, Math.min(3, Number.isInteger(n) ? n : 1));
}
