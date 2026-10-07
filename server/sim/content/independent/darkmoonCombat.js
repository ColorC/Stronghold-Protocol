// Authored 19.2 source-card adaptations. Combat gains stay on the Battle instance;
// only the three explicitly persistent/resource effects are returned to preparation.
import { nativeFactions } from '../../../../shared/independentRules.js';
import { findSummonTile } from '../tokens.js';

const alive = u => !!u && u.alive && u.deployed && !u.removed;
const own = (a,b) => a?.ownerId === b?.ownerId;
const attackEvent = e => e?.attacker?.side === 'ally' && e.targets?.some(t=>t?.side==='enemy') && !e.attacker.mem.darkmoonExtraAttack;
const order = (a,b) => String(a.uid ?? a.id).localeCompare(String(b.uid ?? b.id));
const close = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const FACTIONS = Object.freeze({MECHANICAL:'哥伦比亚',PIRATE:'维多利亚',ELEMENTAL:'炎',DRAGON:'卡西米尔',BEAST:'叙拉古'});

// Numeric attack/health translations are equipment units, not native flat ATK/HP.
// Health mostly becomes the recipient's offensive secondary attribute; tanks retain HP.
const rules = {
  BGS_006:{retire:{random:'legendary',count:[1,2]}},
  BGS_008:{retire:{random:'deathrattle',count:[2,4]}},
  BGS_012:{retire:{fallen:'MECHANICAL',count:[2,4]}},
  BGS_017:{event:'summon',faction:'BEAST',target:'actor',buff:[2,0]},
  BGS_018:{retire:{faction:'BEAST',buff:[5,5]}},
  BGS_019:{startStrike:'DRAGON'},
  BGS_021:{event:'summon',faction:'BEAST',target:'actor',buff:[4,4]},
  BGS_022:{windfury:true,weakest:true},
  BGS_023:{retire:{random:'tier2',count:[1,2]}},
  BGS_032:{overkill:'strike',ratio:1.5},
  BGS_035:{event:'kill',faction:'DRAGON',target:'self',buff:[2,2]},
  BGS_040:{retire:{faction:'DRAGON',shield:5}},
  BGS_045:{event:'attack',selfOnly:true,target:'self',attackRamp:true},
  BGS_046:{recruitOnKill:true},
  BGS_047:{event:'attack',faction:'PIRATE',target:'all',buff:[2,1]},
  BGS_056:{event:'attack',faction:'PIRATE',excludeSelf:true,target:'actor',buff:[2,2]},
  BGS_060:{counterattack:true},
  BGS_061:{retire:{token:'pirate',stats:[1,1],count:[1,1],immediate:true}},
  BGS_067:{event:'shieldLayersBroken',target:'self',buff:[2,2]},
  BGS_071:{event:'summon',faction:'MECHANICAL',target:'self',buff:[1,0],shield:5},
  BGS_078:{echo:true},
  BGS_079:{retire:{random:'PIRATE',count:[3,6]}},
  BGS_080:{windfury:true,overkill:'factionBuff',faction:'PIRATE',buff:[2,2]},
  BGS_110:{event:'attacked',requireCover:true,target:'actor',buff:[3,0]},
  BGS_111:{event:'attacked',requireCover:true,target:'self',buff:[1,1],permanent:true},
  BGS_112:{event:'death',requireCover:true,target:'adjacentActor',buff:[2,2]},
  BGS_119:{windfury:true},
  BGS_121:{retire:{random:'ELEMENTAL',count:[1,2],handCopy:true}},
  BGS_126:{overkill:'spill'},
  BGS_200:{retire:{coin:1}},
  BGS_201:{event:'attacked',selfOnly:true,target:'adjacentSelf',buff:[1,1]},
  BGS_205:{intercept:true},
  BOT_218:{event:'damaged',selfOnly:true,summon:{token:'mechanical',stats:[2,3],count:[1,1],cover:true}},
  BOT_312:{retire:{token:'mechanical',stats:[1,1],count:[3,3]}},
  BOT_537:{retire:{token:'mechanical',stats:[8,8],count:[1,1]}},
  BOT_606:{retire:{damage:2}},
  CFM_316:{retire:{token:'beast',stats:[1,1],attackCount:true}},
  DAL_575:{summonMultiplier:[2,3]},
  EX1_531:{event:'death',faction:'BEAST',excludeSelf:true,target:'self',buff:[2,1]},
  EX1_534:{retire:{token:'beast',stats:[2,2],count:[2,2]}},
  EX1_556:{retire:{token:'mechanical',stats:[2,1],count:[1,1]}},
  FP1_024:{retire:{damage:.4,allCombatants:true}},
  FP1_031:{retireMultiplier:[2,3]},
  GVG_106:{event:'death',faction:'MECHANICAL',excludeSelf:true,target:'self',buff:[2,2]},
  ICC_858:{event:'shieldLayersBroken',target:'self',buff:[2,0]},
  KAR_005:{retire:{token:'beast',stats:[3,2],count:[1,1]}},
  NEW1_027:{aura:{faction:'PIRATE',buff:[1,1]}},
  OG_216:{retire:{token:'beast',stats:[1,1],count:[2,2]}},
  OG_221:{retire:{shield:5,randomAlly:true}},
  OG_256:{retire:{buff:[1,1]}},
  TRL_232:{overkill:'summon',summon:{token:'beast',stats:[5,5],count:[1,1]}},
};
export const DARKMOON_COMBAT_SUPPORTED_IDS = Object.freeze(Object.keys(rules));
export const DARKMOON_COMBAT_RULES = Object.freeze(rules);

export function darkmoonCombatMetadata(sourceId, elite=false) {
  const r=rules[sourceId]; if(!r)return null;
  const m=elite?2:1;
  const number=x=>Array.isArray(x)?x[elite?1:0]:x;
  const buffText=v=>`攻击徽章×${v[0]*m}${v[1]?`，依职业配置的副属性装备×${v[1]*m}`:''}`;
  let text='',trigger='战斗中',recipient='自身',duration='本场战斗';
  if(r.retire) {
    const p=r.retire;trigger='每次退场（每场最多三次）';recipient=p.randomAlly?'随机友方':p.faction?FACTIONS[p.faction]+'友方':p.buff?'所有友方':'战场';
    text=p.coin?`退场时将${p.coin*m}张罗德岛采购券加入装备栏；使用一张可获得一枚金币。`:p.buff?`退场时使${recipient}临时获得${buffText(p.buff)}。`:p.shield?`退场时为${recipient}增加${p.shield*m}层护盾。`:p.damage?`退场时${p.allCombatants?'对场上所有单位':'对一个随机敌人'}造成相当于自身基础攻击${p.damage*m*100}%的法术伤害。`:p.fallen?`退场时召回本场最先倒下的${number(p.count)}名${FACTIONS[p.fallen]}友方的原始幻影。`:`退场时召唤${p.attackCount?'按当前攻击成长计算，最多七个':number(p.count)}个${p.random?('随机'+(FACTIONS[p.random]||(p.random==='tier2'?'低本':'高本'))+'原型'):'作战支援单位'}${p.handCopy?'，并将对应干员的原始复制加入整备区':''}。`;
  } else if(r.buff) {
    trigger={summon:'召唤友方支援单位',death:'友方退场',kill:'友方击倒敌人',attack:'友方攻击',attacked:'友方受到攻击',shieldLayersBroken:'友方累计破裂五层护盾'}[r.event];
    recipient={self:'自身',actor:'触发效果的友方',all:'所有友方',adjacentActor:'退场干员附近的友方',adjacentSelf:'自身附近的友方'}[r.target];
    duration=r.permanent?'本局永久':'本场战斗';text=`${trigger}${r.faction?'（'+FACTIONS[r.faction]+'）':''}${r.requireCover?'（需要坚守盟约）':''}时，使${recipient}${r.permanent?'永久':'临时'}获得${buffText(r.buff)}${r.shield?'及五层护盾':''}。同一效果每三秒触发一次，每场最多二十五次。`;
  } else if(r.event==='damaged')text=`受到伤害后召唤${elite?2:1}个携带坚守盟约的机械支援单位；每三秒一次，每场最多七次。`;
  else if(r.summonMultiplier)text=`卡牌效果召唤的支援单位数量变为${number(r.summonMultiplier)}倍；不复制装备或成长。`;
  else if(r.retireMultiplier)text=`友方源卡退场效果触发${number(r.retireMultiplier)}次；不增加其他产出。`;
  else if(r.echo)text=`普通攻击后随机触发另一名在场友方的退场效果；每六秒一次，每场最多三次。`;
  else if(r.startStrike)text=`首批敌人入场时，随机造成${elite?'两次':'一次'}法术伤害，每次为自身基础攻击的40%乘以己方卡西米尔干员数量。`;
  else if(r.attackRamp)text=`每次攻击临时提高攻击倍率${elite?30:20}%，最多叠加至额外${elite?300:200}%；同一效果每三秒触发一次。`;
  else if(r.overkill)text=r.overkill==='spill'?`攻击击倒敌人时，把超过其生命的伤害传递给附近${elite?'两名':'一名'}敌人。`:r.overkill==='strike'?`攻击超杀时对最左侧敌人追加${elite?300:150}%基础攻击的法术伤害。`:r.overkill==='summon'?`攻击超杀时召唤一个强力作战支援单位。`:`攻击超杀时使其他维多利亚友方临时获得${buffText(r.buff)}。`;
  else if(r.recruitOnKill){duration='整备区';text=`普通攻击击倒敌人后，随机将${elite?2:1}名原始干员加入整备区；每场最多触发一次。`;}
  else if(r.counterattack)text=`受到敌人攻击并存活后立即反击${elite?2:1}次；每三秒触发一次，反击不再次触发自身反击。`;
  else if(r.intercept)text=`敌人准备攻击携带坚守盟约的其他友方时，替其承受攻击；需要自身可被该敌人攻击。`;
  else if(r.aura)text=`在场时使其他维多利亚友方获得${buffText(r.aura.buff)}；自身退场后失效。`;
  if(r.windfury)text=`攻击后追加${elite?3:1}次普通攻击；每三秒一轮。${text}`;
  if(r.weakest)text+='优先攻击当前可攻击范围内攻击力最低的敌人。';
  return {trigger,recipient,duration,text,sourceId,implementation:'supported',adapter:['darkmoonCombat']};
}

export function installDarkmoonCombat(battle,{catalog,pieces=[]}={}) {
  const byUid=new Map(pieces.map(p=>[p.uid,p]));
  const sourceOf=u=>u?.kind==='token'?sourceOf(u.ownerUnit):catalog.operators?.[byUid.get(u?.uid)?.chessId];
  const identity=u=>u?.mem?.darkmoonFactionTags || u?.def?.raw?.darkmoonFactionTags || (u?.kind==='token'?identity(u.ownerUnit):nativeFactions(byUid.get(u?.uid)||{chessId:u?.defId},catalog));
  const eligible=(u,owner,tribe=null)=>!!u&&u.side==='ally'&&own(u,owner)&&['op','token'].includes(u.kind)&&(!tribe||identity(u).includes(FACTIONS[tribe]));
  const members=(owner,tribe=null)=>battle.allyUnits.filter(u=>alive(u)&&eligible(u,owner,tribe)).sort(order);
  const enemies=()=>battle.enemies.filter(alive).sort((a,b)=>a.x-b.x||a.id-b.id);
  const pick=a=>a.length?a[Math.floor(battle.rng()*a.length)]:null;
  const hasCover=u=>u?.mem?.darkmoonCover || (byUid.get(u?.uid)?.equipment||[]).some(x=>catalog.equipment[x.id]?.params?.gearId==='oath-cover');
  const entries=battle.allyUnits.filter(u=>u.kind==='op').map(unit=>{
    const op=sourceOf(unit),id=op?.sourceRefs?.darkmoon19_2?.id;
    return rules[id]?{unit,id,rule:rules[id],elite:!!(byUid.get(unit.uid)?.elite||op.elite),last:-Infinity,uses:0,retireUses:0,seen:new Set(),stacks:new Map()}:null;
  }).filter(Boolean);
  const results=battle.independentDarkmoonResults={growth:[],recruits:[],coins:[]};
  const trace=battle.independentDarkmoonTrace=[];
  const note=(e,kind,targets=[])=>{trace.push({sourceId:e.id,sourceUid:e.unit.uid,kind,time:battle.time,targets:targets.map(u=>u.uid??u.id)});battle.emit('darkmoonEffect',{sourceId:e.id,source:e.unit,kind,targets});};
  const ready=(e,seconds=3,max=25,channel='event')=>{const c=(e.channels||={})[channel]||{last:-Infinity,uses:0};if(battle.time<c.last+seconds||c.uses>=max)return false;c.last=battle.time;c.uses++;e.channels[channel]=c;if(channel==='event')e.uses=c.uses;return true;};
  const scale=e=>e.elite?2:1;
  const secondary=u=>({TANK:['hpPct',.03],CASTER:['dmgDealtMul',.02],MEDIC:['spRecoveryFlat',.02],SUPPORT:['spRecoveryFlat',.02],PIONEER:['spRecoveryFlat',.02]})[u.def.profession]||['aspd',2];
  const equipment=(e,u,a,h,persistent=false)=>{
    if(!u)return;
    const m=scale(e),key=`darkmoon:${e.unit.uid}:${e.id}:${u.id}`;
    const v=e.stacks.get(u.id)||{a:0,h:0};v.a+=a*m;v.h+=h*m;e.stacks.set(u.id,v);
    const [stat,n]=secondary(u),mods={atkFlat:u.base.atk*v.a*.02};
    if(v.h){if(stat==='dmgDealtMul')mods[stat]=1+n*v.h;else if(stat==='spRecoveryFlat'){if(u.skill?.spType==='time')mods[stat]=Math.max(0,Number(u.base.spRecovery??1))*n*v.h;else mods.aspd=2*v.h;}else mods[stat]=n*v.h;}
    battle.addBuff(u,{key,mods,duration:Infinity,persist:true,allowDead:true,refresh:'replace'});
    (u.mem.darkmoonTemporaryEquipment||={})[key]={sourceId:e.id,attackUnits:v.a,secondaryUnits:v.h,expires:'battleEnd'};
    if(persistent&&u.kind==='op')results.growth.push({sourceUid:e.unit.uid,targetUid:u.uid,attackUnits:a*m,secondaryUnits:h*m});
  };
  const shield=(e,u,layers)=>{const key=`darkmoon:shield:${e.unit.uid}:${u.id}`,n=Number(u.findBuff(key)?.shieldHits||0);battle.addBuff(u,{key,shieldHits:n+layers,source:e.unit,duration:Infinity,persist:true,allowDead:true,refresh:'replace'});};
  const auras=[];
  const fallen=[];
  const summonEntries=entries.filter(e=>e.rule.summonMultiplier);
  const summonMultiplier=owner=>Math.max(1,...summonEntries.filter(e=>alive(e.unit)&&own(e.unit,owner)).map(e=>e.rule.summonMultiplier[e.elite?1:0]));
  if(summonEntries.length){
    const nativeSpawn=battle.spawnToken.bind(battle);let cloning=false;
    battle.spawnToken=(owner,id,r,c,opts={})=>{
      const token=nativeSpawn(owner,id,r,c,opts);
      if(!token||cloning||opts.darkmoonHandled||typeof owner!=='object')return token;
      const count=summonMultiplier(owner)-1;
      cloning=true;try{for(let i=0;i<count;i++){const cell=findSummonTile(battle,owner,'melee');if(!cell)break;nativeSpawn(owner,id,...cell,{...opts,darkmoonHandled:true});}}finally{cloning=false;}
      return token;
    };
  }
  const retireMultiplier=owner=>Math.max(1,...entries.filter(e=>e.rule.retireMultiplier&&alive(e.unit)&&own(e.unit,owner)).map(e=>e.rule.retireMultiplier[e.elite?1:0]));
  const normalOps=()=>Object.values(catalog.operators).filter(op=>!op.elite&&op.active!==false&&op.source?.normalChess?.visible!==false);
  const randomDef=(e,kind)=>{
    let ops=normalOps();
    if(FACTIONS[kind])ops=ops.filter(op=>op.nativeFactionTags?.includes(FACTIONS[kind]));
    else if(kind==='tier2')ops=ops.filter(op=>op.tier===2);
    else if(kind==='legendary')ops=ops.filter(op=>op.tier>=5);
    else if(kind==='deathrattle')ops=ops.filter(op=>rules[op.sourceRefs?.darkmoon19_2?.id]?.retire);
    const op=pick(ops);if(!op)return null;
    const raw=op.source.normalChess;
    return {op,def:{id:raw.tokenId||'token_10030_mlyss_wtrman',name:raw.name+'的流形',stats:{...raw.stats},rangeGrid:raw.rangeGrid,profession:'TOKEN',position:'MELEE',dmgType:raw.dmgType||'phys',darkmoonSourceId:op.sourceRefs?.darkmoon19_2?.id,tokens:[],skill:null,skills:[],talents:[],trait:'',traitBb:{}}};
  };
  const tokenDef=(e,p)=>{
    const nativeId=p.token==='beast'?'token_10028_vigil_wolf':p.token==='pirate'?'token_10040_siege2_vlion':'token_10030_mlyss_wtrman';
    const record=battle.tokenDef(nativeId,e.unit)||{id:nativeId,rangeGrid:[[0,0],[0,1]]};
    const [a,h]=p.stats, m=scale(e);
    return {...record,id:nativeId,name:p.token==='beast'?'协同狼群':p.token==='pirate'?'黄金盟誓':'作战流形',profession:'TOKEN',position:'MELEE',dmgType:'phys',stats:{...record.stats,maxHp:350*h*m,atk:120*a*m,def:120,res:0,cost:0,blockCnt:p.cover?2:1,bat:1.5,aspd:100},skill:null,skills:[],talents:[],trait:'',traitBb:{},tokens:[]};
  };
  const spawn=(e,def,count,tags=[],p={})=>{
    const out=[],limit=Math.max(0,7-battle.allyUnits.filter(u=>u.kind==='token'&&alive(u)&&own(u,e.unit)&&u.mem.darkmoonSummon).length);
    for(let i=0;i<Math.min(count*summonMultiplier(e.unit),limit);i++){
      const cell=findSummonTile(battle,e.unit,'melee');if(!cell)break;
      // Put identity on the definition before deployment, so summon observers see its real origin.
      const clean=structuredClone(def);clean.darkmoonFactionTags=tags;
      const token=battle.spawnToken(e.unit,clean.id,...cell,{def:clean,anySource:true,kit:{},duration:45,darkmoonHandled:true});
      if(token){token.mem.darkmoonSummon=true;token.mem.darkmoonFactionTags=tags;token.mem.darkmoonCover=!!p.cover;if(p.cover)battle.addBuff(token,{key:'darkmoon:token-cover',mods:{taunt:1,physTakenMul:.9,artsTakenMul:.9},persist:true});out.push(token);if(p.immediate)battle.forceAttack(token);
        const childRule=rules[clean.darkmoonSourceId];
        if(childRule?.retire&&(e.depth||0)<3){const child={unit:token,id:clean.darkmoonSourceId,rule:childRule,elite:false,depth:(e.depth||0)+1,stacks:new Map()};entries.push(child);battle.on('death',({unit:who,reason})=>{if(who===token&&reason==='killed')battle.after(0,()=>{for(let j=0;j<retireMultiplier(token);j++)retireAction(child);});},{owner:token});}
      }
    }
    note(e,'summon',out);return out;
  };
  const retireAction=(e,echo=false)=>{
    const p=e.rule.retire;if(!p)return;
    const m=scale(e);let targets=[];
    if(p.buff){targets=members(e.unit,p.faction);for(const u of targets)equipment(e,u,...p.buff);}
    if(p.shield){targets=p.randomAlly?[pick(members(e.unit).filter(u=>u!==e.unit))].filter(Boolean):members(e.unit,p.faction);for(const u of targets)shield(e,u,p.shield*m);}
    if(p.damage){targets=p.allCombatants?[...members(e.unit),...enemies()]:[pick(enemies())].filter(Boolean);for(const u of targets)battle.dealDamage(e.unit,u,{amount:e.unit.base.atk*p.damage*m,type:'arts',tags:['darkmoon','retiringEffect']});}
    if(p.coin)results.coins.push({sourceUid:e.unit.uid,quantity:p.coin*m,inventory:true});
    if(p.fallen){for(const x of fallen.filter(x=>own(x.unit,e.unit)&&x.tags.includes(FACTIONS[p.fallen])).slice(0,p.count[e.elite?1:0]))spawn(e,x.def,1,x.tags);}
    if(p.token){const count=p.attackCount?Math.min(7,Math.max(1,Math.floor(e.unit.s.atk/Math.max(1,e.unit.base.atk)*2))):(p.count[e.elite?1:0]);spawn(e,tokenDef(e,p),count,p.token==='beast'?['叙拉古']:p.token==='pirate'?['维多利亚']:['哥伦比亚'],p);}
    if(p.random)for(let i=0;i<p.count[e.elite?1:0];i++){
      const x=randomDef(e,p.random);if(!x)continue;const created=spawn(e,x.def,1,x.op.nativeFactionTags||[]);if(p.handCopy&&created.length)results.recruits.push({sourceUid:e.unit.uid,chessId:x.op.chessId,pristine:true});
    }
    note(e,echo?'retireEcho':'retire',targets);
  };
  battle.on('death',({unit,reason})=>{
    if(reason!=='killed'||unit.side!=='ally'||!['op','token'].includes(unit.kind))return;
    if(!fallen.some(x=>x.unit.id===unit.id))fallen.push({unit,tags:identity(unit),def:{...structuredClone(unit.def),stats:{...unit.base},skill:null,skills:[],talents:[],trait:'',traitBb:{}}});
  },{priority:100});
  for(const e of entries){
    const {unit,rule:r}=e;
    if(r.retire)battle.on('death',({unit:who,reason})=>{
      if(who!==unit||!['killed','retreat','raid','merchant'].includes(reason)||e.retireUses>=3||e.seen.has(unit.deploySeq))return;
      e.seen.add(unit.deploySeq);e.retireUses++;const repeat=retireMultiplier(unit);
      battle.after(0,()=>{for(let i=0;i<repeat;i++)retireAction(e);});
    },{owner:unit});
    if(r.echo)battle.on('attack',event=>{
      if(event.attacker!==unit||!attackEvent(event)||!alive(unit)||!ready(e,6,3))return;
      const x=pick(entries.filter(x=>x!==e&&x.rule.retire&&alive(x.unit)&&own(x.unit,unit)));if(x){for(let i=0;i<retireMultiplier(x.unit);i++)retireAction(x,true);note(e,'echo',[x.unit]);}
    },{owner:unit});
    if(r.aura)auras.push(e);
    if(r.startStrike){let done=false;battle.on('enemySpawn',()=>{if(done||!alive(unit))return;done=true;for(let i=0;i<(e.elite?2:1);i++){const target=pick(enemies());if(target)battle.dealDamage(unit,target,{amount:unit.base.atk*.4*members(unit,'DRAGON').length,type:'arts',tags:['darkmoon','combatStart']});}note(e,'startStrike');},{owner:unit});}
    if(r.weakest)battle.on('beforeAttack',ctx=>{if(ctx.attacker!==unit)return;const pool=battle.enemiesInKeys(unit.rangeKeys,unit,ctx.profile).sort((a,b)=>a.s.atk-b.s.atk||a.id-b.id);if(pool.length)ctx.targets=pool.slice(0,ctx.targets?.length||1);},{owner:unit,priority:-50});
    if(r.windfury)battle.on('attack',ev=>{
      if(ev.attacker!==unit||!attackEvent(ev)||!alive(unit)||!ready(e,3,50,'windfury'))return;
      unit.mem.darkmoonExtraAttack=true;try{for(let i=0;i<(e.elite?3:1)&&alive(unit);i++)battle.forceAttack(unit,null,{noAmmo:true});}finally{unit.mem.darkmoonExtraAttack=false;}note(e,'windfury');
    },{owner:unit,priority:-90});
    if(r.counterattack)battle.on('attack',ev=>{if(ev.attacker?.side!=='enemy'||!ev.targets?.includes(unit)||!alive(unit)||!ready(e))return;battle.after(0,()=>{if(alive(unit)){unit.mem.darkmoonExtraAttack=true;try{for(let i=0;i<scale(e);i++)battle.forceAttack(unit);}finally{unit.mem.darkmoonExtraAttack=false;}note(e,'counterattack');}});},{owner:unit});
    if(r.intercept)battle.on('beforeAttack',ctx=>{
      if(!alive(unit)||ctx.attacker?.side!=='enemy')return;let applied=false;
      ctx.targets=(ctx.targets||[]).map(target=>{if(target!==unit&&own(target,unit)&&hasCover(target)&&close(ctx.attacker,unit)<=Math.max(.75,ctx.attacker.s.rangeRadius||0)){applied=true;return unit;}return target;});if(applied)note(e,'intercept',[unit]);
    },{owner:unit,priority:80});
    if(r.recruitOnKill){let count=0;battle.on('kill',({killer,victim})=>{if(killer!==unit||victim.side!=='enemy'||!unit.mem.darkmoonAttackIds?.has(victim.id)||count++)return;for(let i=0;i<scale(e);i++){const x=pick(normalOps().filter(op=>op.tier<=catalog.config?.maxShopLevel||op.tier<=6));if(x)results.recruits.push({sourceUid:unit.uid,chessId:x.chessId,pristine:true});}note(e,'recruit');},{owner:unit});}
    if(r.recruitOnKill||r.overkill){
      battle.on('hit',({source,target,dmg})=>{if(source!==unit||target.side!=='enemy'||!dmg.isAttack||dmg.tags?.includes('darkmoon'))return;(unit.mem.darkmoonAttackIds||=new Map()).set(target.id,{hp:target.hp,dmg});},{owner:unit,priority:-99});
    }
    if(r.overkill)battle.on('damaged',({source,target,amount,dmg})=>{
      const mark=unit.mem.darkmoonAttackIds?.get(target.id);if(source!==unit||target.side!=='enemy'||!mark||mark.dmg!==dmg||!(amount>mark.hp))return;
      unit.mem.darkmoonAttackIds.delete(target.id);if(!ready(e,3,15))return;
      if(r.overkill==='strike'){const next=enemies().find(t=>t!==target);if(next)battle.dealDamage(unit,next,{amount:unit.base.atk*r.ratio*scale(e),type:'arts',tags:['darkmoon','overkill']});}
      else if(r.overkill==='spill'){const next=enemies().filter(t=>t!==target&&close(t,target)<=1.5).sort((a,b)=>close(a,target)-close(b,target)).slice(0,scale(e));for(const t of next)battle.dealDamage(unit,t,{amount:amount-mark.hp,type:dmg.type,tags:['darkmoon','overkill']});}
      else if(r.overkill==='factionBuff')for(const t of members(unit,r.faction).filter(t=>t!==unit))equipment(e,t,...r.buff);
      else if(r.overkill==='summon')spawn(e,tokenDef(e,r.summon),1,['叙拉古']);note(e,'overkill');
    },{owner:unit});
    if(r.event){
      let broken=0;
      const name=r.event==='summon'?'deploy':r.event==='attacked'?'beforeAttack':r.event;
      battle.on(name,event=>{
        if(!alive(unit))return;
        let actor=r.event==='kill'?event.killer:r.event==='attack'?event.attacker:r.event==='damaged'?event.target:event.unit;
        let actors=r.event==='attacked'&&event.attacker?.side==='enemy'?event.targets||[]:actor?[actor]:[];
        if(r.event==='summon')actors=actors.filter(u=>u.kind==='token'&&!event.initial&&!event.move);
        if(r.event==='attack'&&!attackEvent(event))return;
        if(r.event==='kill'&&event.victim?.side!=='enemy')return;
        if(r.event==='death'&&!['killed','retreat','merchant'].includes(event.reason))return;
        if(r.event==='damaged'&&!(event.amount>0))return;
        actors=actors.filter(u=>eligible(u,unit,r.faction)&&(!r.selfOnly||u===unit)&&(!r.excludeSelf||u!==unit)&&(!r.requireCover||hasCover(u)));
        if(!actors.length)return;
        if(r.event==='shieldLayersBroken'){broken+=Math.max(0,Number(event.layers)||0);if(broken<5)return;broken-=5;}
        if(!ready(e,r.event==='damaged'?3:3,r.event==='damaged'?7:25))return;
        const targets=new Set();
        for(const a of actors){
          const selected=r.target==='self'?[unit]:r.target==='actor'?[a]:r.target==='all'?members(unit):r.target==='adjacentActor'?members(unit).filter(u=>u!==a&&close(u,a)<=1.5):r.target==='adjacentSelf'?members(unit).filter(u=>u!==unit&&close(u,unit)<=1.5):[];
          for(const t of selected)if(alive(t))targets.add(t);
        }
        if(r.attackRamp){const key=`darkmoon:ramp:${unit.uid}`,n=Math.min(e.uses,10)*(.2*(e.elite?1.5:1));battle.addBuff(unit,{key,mods:{atkPct:n},persist:true,allowDead:true,refresh:'replace'});}
        if(r.summon)spawn(e,tokenDef(e,r.summon),scale(e),['哥伦比亚'],r.summon);
        for(const t of targets){if(r.buff)equipment(e,t,...r.buff,!!r.permanent);if(r.shield)shield(e,t,r.shield*scale(e));}
        note(e,'event',[...targets]);
      },{owner:unit});
    }
  }
  if(auras.length)battle.every(.25,()=>{for(const e of auras){const key=`darkmoon:aura:${e.unit.uid}`;for(const t of battle.allyUnits){if(alive(e.unit)&&alive(t)&&t!==e.unit&&eligible(t,e.unit,e.rule.aura.faction)){const v=e.rule.aura.buff,m=scale(e),[s,n]=secondary(t),mods={atkFlat:t.base.atk*v[0]*m*.02};if(s==='dmgDealtMul')mods[s]=1+n*v[1]*m;else if(s==='spRecoveryFlat'){if(t.skill?.spType==='time')mods[s]=(t.base.spRecovery||1)*n*v[1]*m;else mods.aspd=2*v[1]*m;}else mods[s]=n*v[1]*m;battle.addBuff(t,{key,mods,duration:.5,refresh:'replace'});}else battle.removeBuff(t,key);}}});
  return {entries,fallen,results,trace,retireAction};
}
