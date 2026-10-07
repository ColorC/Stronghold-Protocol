import { tavernFactions } from '../../../../shared/independentRules.js';
import { validateWarbandRule, WARBAND_BEHAVIORS } from '../../../../shared/warbandSchema.js';
import { findSummonTile } from '../tokens.js';
const live = u => !!u && u.side === 'ally' && u.alive && u.deployed && !u.removed;
const stable = (a,b) => String(a.uid ?? a.id).localeCompare(String(b.uid ?? b.id));
const STAT = { attackPercent:'atkPct',maxHpPercent:'hpPct',attackSpeedFlat:'aspd' };
const mods = (stats,n=1,target=null) => Object.fromEntries(Object.entries(stats || {}).map(([k,v])=>
  k==='baseAttackPercent'?['atkFlat',Number(target?.base?.atk||0)*v*n]:k==='damageDealtPercent'?['dmgDealtMul',1+v*n]:[STAT[k],v*n]));
const nativeAttack = (u,event) => event.attacker === u && !event.isSkill && !u.mem.independentExtraAttack && !(event.profile?.tags || []).includes('independentEquipment');
const reasons = new Set(['killed','retreat','merchant','raid']);

export function installWarband(battle,{catalog,pieces}) {
  const byUid = new Map(pieces.map(p=>[p.uid,p]));
  const opOf = u => u?.kind === 'token' ? opOf(u.ownerUnit) : u?.kind === 'op' ? u : null;
  const factions = u => { const op=opOf(u); return op ? tavernFactions(byUid.get(op.uid) || {chessId:op.defId},catalog) : []; };
  const eligible = (u,owner,faction) => !!u && ['op','token'].includes(u.kind) && u.side === 'ally' && u.ownerId === owner.ownerId && !!opOf(u) && (!faction || factions(u).includes(faction));
  const entries = [];
  for (const unit of battle.allyUnits.filter(u=>u.kind==='op')) {
    const piece=byUid.get(unit.uid);
    (catalog.operators?.[piece?.chessId]?.nativeTrait?.effect?.combat || []).forEach((rule,index)=>{
      if (!WARBAND_BEHAVIORS.includes(rule.behavior) || rule.behavior==='factionReaction') return;
      validateWarbandRule(rule); entries.push({unit,rule,index,key:`independent:warband:${unit.uid}:${index}`,used:0,echoes:0});
    });
  }
  const fallen=[];
  const remember = ({unit,reason}) => {
    if (reason!=='killed' || unit?.kind!=='token' || !opOf(unit) || unit.mem.warbandOriginalCopy || fallen.some(x=>x.id===unit.id)) return;
    const def=structuredClone(unit.def);
    // Save original definition/base, never temporary computed stats or callbacks/gear from its owner.
    def.stats={...unit.base}; def.skill=null; def.skills=[]; def.talents=[]; def.trait=''; def.traitBb={};
    fallen.push({id:unit.id,owner:opOf(unit),factions:factions(unit),def});
  };
  battle.on('death',remember,{priority:100});
  const shield = (target,key,layers,source) => {
    const current=Number(target.findBuff(key)?.shieldHits || 0);
    battle.addBuff(target,{key,shieldHits:current+layers,persist:true,allowDead:true,duration:Infinity,refresh:'replace',source});
  };
  const ground = owner => {
    const out=[],R=battle.grid.rect;
    for(let r=R.r0;r<=R.r1;r++)for(let c=R.c0;c<=R.c1;c++) {
      const t=battle.grid.tile(r,c);
      if(t && battle.grid.canStand(r,c,{ranged:false}) && battle.grid.groundPassable(r,c,true) && !battle.isReservedTile(r,c) && !battle.downOn(r,c))out.push([r,c]);
    }
    return out.sort((a,b)=>Math.hypot(a[0]-owner.tileR,a[1]-owner.tileC)-Math.hypot(b[0]-owner.tileR,b[1]-owner.tileC)||a[0]-b[0]||a[1]-b[1]);
  };
  const spawn = (owner,def,count,ratio,duration,original=false) => {
    const clean=structuredClone(def); clean.stats={...clean.stats};
    for(const key of ['atk','maxHp']) {
      const scaled=Number(clean.stats[key] || 1)*ratio;
      clean.stats[key]=Math.max(1,original && ratio === 1 ? scaled : Math.floor(scaled));
    }
    clean.skill=null; clean.skills=[]; clean.talents=[]; clean.trait=''; clean.traitBb={};
    const out=[];
    for(let i=0;i<count;i++) {
      const cell=findSummonTile(battle,owner,'melee')||ground(owner)[0]; if(!cell)break;
      const token=battle.spawnToken(owner,clean.id || 'warband-summon',...cell,{def:clean,anySource:true,kit:{},duration});
      if(token) { token.mem.warbandOriginalCopy=original; out.push(token); }
    }
    return out;
  };
  const action = (entry,echo=false) => {
    const {unit,rule,key}=entry,p=rule.params;
    const members=faction => battle.allyUnits.filter(u=>live(u)&&eligible(u,unit,faction)).sort(stable);
    if(p.buff)for(const target of members(p.buff.faction)) {
      const buffKey=`${key}:buff:${target.id}`;
      const stacks=(entry.buffStacks ||= new Map());const n=(stacks.get(target.id)||0)+1;stacks.set(target.id,n);
      battle.addBuff(target,{key:buffKey,mods:mods(p.buff.stats,n,target),persist:true,allowDead:true,refresh:'replace'});
    }
    if(p.shield)for(const target of members(p.shield.faction))shield(target,`${key}:shield:${target.id}`,p.shield.layers,unit);
    if(p.summon) {
      const def=p.summon.tokenId ? battle.tokenDef(p.summon.tokenId,unit) : {id:`warband:${unit.defId}`,name:unit.name,stats:{...unit.base},rangeGrid:unit.def.rangeGrid,profession:'TOKEN',position:'MELEE',dmgType:unit.def.dmgType};
      if(!def)throw new Error(`UNKNOWN_WARBAND_TOKEN:${p.summon.tokenId}`);
      spawn(unit,def,p.summon.count,p.summon.statRatio,p.summon.durationSeconds);
    }
    if(p.returnFallen)for(const original of fallen.filter(x=>x.owner.ownerId===unit.ownerId&&x.factions.includes(p.returnFallen.faction)).slice(0,p.returnFallen.count)) {
      spawn(original.owner,original.def,1,p.returnFallen.statRatio,p.returnFallen.duration,true);
    }
    battle.emit('warbandRetiringEffect',{unit,ruleIndex:entry.index,echo});
  };
  const multiplier = unit => 1+Math.max(0,...entries.filter(x=>x.rule.behavior==='retirementMultiplier'&&live(x.unit)&&x.unit.ownerId===unit.ownerId).map(x=>x.rule.params.extra));
  for(const entry of entries) {
    const {unit,rule,key}=entry,p=rule.params;
    if(rule.behavior==='retiringEffect') {
      const seen=new Set();
      const retire=event=>{
        if(event.unit!==unit||!reasons.has(event.reason))return;
        const identity=unit.deploySeq;
        if(seen.has(identity)||entry.used>=p.perBattle)return;
        seen.add(identity); entry.used++;
        const times=multiplier(unit);
        // Execute after removal, so summons cannot overwrite a currently retiring body's occupied cell.
        battle.after(0,()=>{for(let i=0;i<times;i++)action(entry);});
      };
      battle.on('death',retire,{owner:unit});
      battle.on('retreating',retire,{owner:unit});
    } else if(rule.behavior==='deathrattleEcho') {
      let attacks=0;
      battle.on('attack',event=>{
        if(!live(unit)||!nativeAttack(unit,event)||++attacks%p.every||entry.used>=p.perBattle)return;
        const candidate=entries.filter(x=>x.rule.behavior==='retiringEffect'&&x.unit!==unit&&live(x.unit)&&eligible(x.unit,unit,p.faction)&&x.echoes<6).sort((a,b)=>stable(a.unit,b.unit)||a.index-b.index)[0];
        if(candidate){entry.used++;candidate.echoes++;for(let i=0;i<multiplier(candidate.unit);i++)action(candidate,true);}
      },{owner:unit});
    } else if(rule.behavior==='warbandEvent') {
      const stacks=new Map(),last=new Map(),pending=new Map();let broken=0;
      const apply=(target,triggers)=>{
        if(!live(unit)||!live(target)||battle.time<(last.get(target.id)??-Infinity)+p.cooldownSeconds)return false;
        const n=stacks.get(target.id)||0,next=Math.min(p.maxStacks,n+triggers);
        if(next===n&&!p.shieldLayers)return true;
        stacks.set(target.id,next);last.set(target.id,battle.time);
        if(p.stats&&next>n)battle.addBuff(target,{key:`${key}:event:${target.id}`,mods:mods(p.stats,next,target),persist:true,allowDead:true,refresh:'replace'});
        if(p.shieldLayers)shield(target,`${key}:layers:${target.id}`,p.shieldLayers*triggers,unit);
        return true;
      };
      if(p.event==='shieldLayersBroken')battle.on('tick',()=>{
        for(const [id,{target,triggers}]of pending)if(apply(target,triggers))pending.delete(id);
      },{owner:unit});
      battle.on(p.event==='summon'?'deploy':p.event,event=>{
        if(!live(unit))return;
        const actor=p.event==='damaged'?event.target:p.event==='kill'?event.killer:event.unit || event.attacker;
        if(!eligible(actor,unit,p.faction))return;
        if(p.selfOnly&&actor!==unit)return;
        if(p.event==='death'&&p.targets==='self'&&actor===unit)return;
        if(p.event==='damaged'&&!(event.amount>0))return;
        if(p.event==='kill'&&event.victim?.side!=='enemy')return;
        if(p.event==='death'&&!reasons.has(event.reason))return;
        if(p.event==='summon'&&(actor.kind!=='token'||event.initial||event.move))return;
        if(p.event==='attack'&&!nativeAttack(actor,event))return;
        let triggers=1;
        if(p.event==='shieldLayersBroken'){broken+=Math.max(0,Number(event.layers)||0);triggers=Math.floor(broken/5);broken%=5;}
        const targets=p.targets==='self'?[unit]:p.targets==='actor'?[actor]:battle.allyUnits;
        if(!triggers)return;
        for(const target of targets.filter(t=>live(t)&&eligible(t,unit,p.targetFaction)).sort(stable)) {
          const total=triggers+(pending.get(target.id)?.triggers||0);
          if(apply(target,total))pending.delete(target.id);
          else if(p.event==='shieldLayersBroken')pending.set(target.id,{target,triggers:total});
        }
      },{owner:unit});
    }
  }
  return {entries,fallen};
}
