import { active, enemies, allies, uid, payDP, v } from './primitives.js';
import { counterValue } from './synergy.js';
import { rotateOffset } from '../../dir.js';
import { COLS } from '../../constants.js';

const number=(unit,value)=>v(unit,value);
const owned=(battle,unit)=>battle.allyUnits.filter(x=>x.kind==='op'&&active(x)&&x.ownerId===unit.ownerId);
function skillAnchor(unit,scope='range') {
  const grid=unit.def?.raw?.assaultBody?.fixedSkill?.runtime?.sourceRangeGrid;
  if(scope!=='range'||!grid?.length)return unit;
  const keys=grid.map(([r,c])=>rotateOffset(r,c,unit.dir)).map(([r,c])=>(r+unit.tileR)*COLS+c+unit.tileC);
  return {tileR:unit.tileR,tileC:unit.tileC,profile:unit.profile,rangeKeys:keys,rangeKeySet:new Set(keys)};
}
const foes=(battle,unit,step={})=>(step.scope==='blocked'?(unit.blocking??[]).filter(active):enemies(battle,unit,{scope:step.scope??'range',anchor:skillAnchor(unit,step.scope),count:step.count??99,priority:step.priority??'exit',groundOnly:step.groundOnly===true}))
  .filter(enemy=>step.maxHpRatio==null||enemy.hp<=enemy.s.maxHp*step.maxHpRatio);
function friends(battle,unit,target,lastHealed=[]) {
  if(!target||target==='self')return [unit];
  if(target==='injuredThree')return lastHealed;
  return owned(battle,unit).filter(x=>x!==unit&&
    (target!=='meleeOthers'||x.def?.position==='MELEE')&&
    (target!=='adjacentOthers'||Math.abs(x.tileR-unit.tileR)<=1&&Math.abs(x.tileC-unit.tileC)<=1));
}
export function canResolveSkill(battle,unit,rule) {
  const payment=rule.steps.find(s=>s.action==='payDP');
  if(payment&&(battle.getPlayer(unit.ownerId)?.dp??0)<number(unit,payment.amount))return false;
  if(rule.gate==='always')return true;
  const attack=rule.steps.find(s=>s.action==='damage');
  return foes(battle,unit,attack??{}).length>0;
}

export function resolveSkill({battle,unit},rule,fx) {
  if(!canResolveSkill(battle,unit,rule))return false;
  const value=v=>number(unit,v);
  const selected=unit.def.raw.assaultPiece;
  const module=selected.star>=3?(selected.moduleId??selected.moduleChoices?.[unit.def.charId]):null;
  let lastHealed=[],lastHitCount=0;
  const seq=unit.mem.assaultResolvedCasts=(unit.mem.assaultResolvedCasts??0)+1;
  for(const [i,step] of rule.steps.entries()) {
    const key=`resolution:${i}`;
    if(step.action==='damage') {
      const targets=foes(battle,unit,step);lastHitCount=targets.length;
      for(const enemy of targets) {
        const bound=step.boundBonus&&enemy.buffs.some(b=>b.status==='bind'&&b.timeLeft>0);
        const piece=unit.def.raw.assaultPiece;
        const mod=piece.star>=3?(piece.moduleId??piece.moduleChoices?.[unit.def.charId]):null;
        const air=unit.def.charId==='char_103_angel'&&mod==='uniequip_002_angel'&&enemy.isFlying?1.1:1;
        const scale=(value(step.scale)+(module==='uniequip_002_mostma'?.15:0))
          *(unit.def.charId==='char_1028_texas2'?1+counterValue(battle,unit,'texas2-rain')/100:1);
        fx.damage(enemy,{scale:scale*(bound?1+step.boundBonus:1)*air,type:step.type,hits:step.hits,
          isSkill:true,...(step.defIgnorePct?{defIgnorePct:step.defIgnorePct}:{})});
        if(step.status&&enemy.alive)fx.status(enemy,{status:step.status.name,duration:value(step.status.seconds)
          +(module==='uniequip_002_mostma'?1:module==='uniequip_002_sntlla'&&step.status.name==='cold'?.5:0)});
      }
    } else if(step.action==='grow') {
      for(const x of friends(battle,unit,step.target,lastHealed))fx.stack(x,{key,stat:step.stat,amount:value(step.amount),mode:step.mode});
    } else if(step.action==='form')fx.buff(unit,{key,mods:step.mods,duration:Infinity});
    else if(step.action==='heal') {
      lastHealed=step.target==='self'?[unit]:allies(battle,unit,{scope:step.scope??'range',anchor:skillAnchor(unit,step.scope),count:step.count??99,selection:'lowestHp'});
      for(const x of lastHealed)fx.heal(x,step.ratio?{maxHpRatio:step.ratio}:{scale:value(step.scale)});
    } else if(step.action==='barrier')battle.addBuff(unit,{key:`assault:resolution:barrier:${uid(unit)}:${seq}:${i}`,shield:unit.s.maxHp*step.ratio,duration:Infinity,source:unit});
    else if(step.action==='loseHp')fx.loseHp(unit,{currentPct:step.currentRatio??0,maxPct:step.maxRatio??0});
    else if(step.action==='dp')fx.dp(value(step.amount));
    else if(step.action==='payDP') {if(!payDP(battle,unit,value(step.amount),'resolved-skill'))return false;}
    else if(step.action==='charge')for(const x of friends(battle,unit,step.target))fx.charge(x,value(step.amount));
    else if(step.action==='cutRedeploy')fx.cutRedeploy({seconds:value(step.seconds),includeSelf:false});
    else if(step.action==='pull')for(const enemy of foes(battle,unit))battle.pullToFront(enemy,unit,step.force);
    else if(step.action==='shortfallCost') {if(lastHitCount<step.count)fx.loseHp(unit,{maxPct:step.maxRatio});}
    else if(step.action==='statusRange'||step.action==='statusField') {
      for(const enemy of foes(battle,unit,{...step,scope:step.action==='statusField'?'field':step.scope??'range'}))fx.status(enemy,{status:step.status,duration:step.seconds});
    } else if(step.action==='scythes') {
      const other=owned(battle,unit).filter(x=>x!==unit&&x.def.position==='MELEE')
        .sort((a,b)=>Math.abs(a.tileR-unit.tileR)+Math.abs(a.tileC-unit.tileC)-Math.abs(b.tileR-unit.tileR)-Math.abs(b.tileC-unit.tileC)||uid(a).localeCompare(uid(b)))[0];
      for(const host of [unit,...(other?[other]:[])])for(const enemy of enemies(battle,unit,{scope:'adjacent8',anchor:host,count:99}))fx.damage(enemy,{scale:value(step.scale),type:'phys',hits:step.hits,isSkill:true});
    } else if(step.action==='weakenAura') {
      unit.mem.resolutionWeaken=Math.min(.6,(unit.mem.resolutionWeaken??0)+value(step.amount));
      const sync=()=>{if(active(unit))for(const enemy of foes(battle,unit))fx.buff(enemy,{key,mods:{defPct:-unit.mem.resolutionWeaken,resMul:1-unit.mem.resolutionWeaken},duration:.51});};
      if(!unit.mem.resolutionWeakenTimer)unit.mem.resolutionWeakenTimer=battle.every(.25,sync,{owner:unit});
      sync();
    } else if(step.action==='inspire'||step.action==='inspireAttack') {
      const xs=allies(battle,unit,{scope:'range',count:99,excludeSelf:true});
      for(const x of xs) {
        if(step.action==='inspire'){fx.stack(x,{key:`${key}:def`,stat:'def',amount:unit.s.def*.05,mode:'flat'});fx.stack(x,{key:`${key}:hp`,stat:'maxHp',amount:unit.s.maxHp*.02,mode:'flat'});}
        else fx.stack(x,{key,stat:'atk',amount:unit.s.atk*step.ratio,mode:'flat'});
      }
    } else if(step.action==='regenGrowth') {
      for(const x of owned(battle,unit).filter(x=>x!==unit)) {
        const totals=x.mem.resolutionRegen??={};const source=uid(unit);
        totals[source]=(totals[source]??0)+unit.s.atk*step.ratio;
        fx.buff(x,{key,mods:{hpRegen:totals[source]},duration:Infinity,persist:true});
      }
    } else if(step.action==='enemyDef')for(const enemy of foes(battle,unit,step)) {
      fx.buff(enemy,{key,mods:{defPct:-step.amount,...(module==='uniequip_002_elysm'?{physTakenMul:1.12}:{})},flags:{reveal:true},duration:Infinity});fx.status(enemy,{status:'sluggish',duration:3});
    } else if(step.action==='plasma') {
      const other=allies(battle,unit,{scope:'range',count:1,excludeSelf:true})[0];
      for(const x of [unit,...(other?[other]:[])]){fx.loseHp(x,{currentPct:.1});fx.stack(x,{key,stat:'atk',amount:value(step.amount),mode:'percent'});}
    } else throw new Error(`Unknown skill resolution action ${step.action}`);
  }
  if(module==='uniequip_002_myrtle') {
    fx.buff(unit,{key:'resolved-myrtle-block',mods:{blockCnt:-1},duration:Infinity});
    const [dr,dc]=unit.fwd;
    const front=owned(battle,unit).find(x=>x!==unit&&x.tileR===unit.tileR+dr&&x.tileC===unit.tileC+dc);
    if(front)fx.buff(front,{key:'resolved-myrtle-front',mods:{blockCnt:1},duration:Infinity});
  }
  if(module==='uniequip_002_branch') {
    fx.buff(unit,{key:'resolved-branch-def',mods:{defPct:.18},duration:Infinity});fx.heal(unit,{maxHpRatio:.8});
  }
  return true;
}
