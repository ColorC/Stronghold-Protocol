// Authored 19.2 source-card adaptations. Combat gains stay on the Battle instance;
// only the three explicitly persistent/resource effects are returned to preparation.
import { nativeFactions } from '../../../../shared/independentRules.js';
import { nativeLevelAttributes, operatorGrowthInfo, levelBodyStats } from '../../../../shared/independentGrowth.js';
import { findSummonTile } from '../tokens.js';
import { KITS, selectSkillSpec } from '../index.js';
import { darkmoonPrepRulesFor } from '../../../modes/independent/darkmoonPrep.js';
import { installKeywordGear } from './keywordGear.js';

const alive = u => !!u && u.alive && u.deployed && !u.removed;
const own = (a,b) => a?.ownerId === b?.ownerId;
const attackEvent = e => e?.attacker?.side === 'ally' && e.targets?.some(t=>t?.side==='enemy') && !e.attacker.mem.darkmoonExtraAttack;
const order = (a,b) => String(a.uid ?? a.id).localeCompare(String(b.uid ?? b.id));
const close = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const FACTIONS = Object.freeze({MECHANICAL:'哥伦比亚',PIRATE:'维多利亚',ELEMENTAL:'炎',DRAGON:'卡西米尔',BEAST:'叙拉古'});

// Numeric attack/health translations become attack and damage badges across operators.
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
  BOT_606:{retire:{damage:2,hits:[1,2]}},
  CFM_316:{retire:{token:'beast',stats:[1,1],attackCount:true}},
  DAL_575:{summonMultiplier:[2,3]},
  EX1_531:{event:'death',faction:'BEAST',excludeSelf:true,target:'self',buff:[2,1]},
  EX1_534:{retire:{token:'beast',stats:[2,2],count:[2,2]}},
  EX1_556:{retire:{token:'mechanical',stats:[2,1],count:[1,1]}},
  FP1_024:{retire:{damage:.4,hits:[1,2],allCombatants:true}},
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
export const hasDarkmoonDeploymentPayload = sourceId => !!rules[sourceId]?.retire && sourceId !== 'BGS_008';

export function darkmoonCombatEligibilityRules(sourceId) {
  const r=rules[sourceId];if(!r)return [];
  if(sourceId==='BGS_078')return [{behavior:'darkmoonCombat',params:{scope:'boardonly',targets:'all',event:'ordinaryAttackEcho',actor:'deployedSource',actorKinds:['op'],recipientKinds:['op','token'],match:{deploymentPayload:true},excludeSelf:true}}];
  if(sourceId==='FP1_031')return [{behavior:'darkmoonCombat',params:{scope:'boardonly',targets:'all',event:'deploymentMultiplier',actor:'deployedAmplifier',actorKinds:['op'],recipientKinds:['op','token'],match:{deploymentPayload:true}}}];
  const faction=r.faction||r.retire?.faction||r.retire?.fallen||r.startStrike||r.aura?.faction;
  const match={...(faction?{faction:FACTIONS[faction]}:{}),...(r.requireCover?{keywordGear:'坚守盟约'}:{})};
  if(!faction&&!r.requireCover&&!r.target?.startsWith('adjacent'))return [];
  const deploymentReactor=['EX1_531','GVG_106','BGS_112'].includes(sourceId);
  const summonedActor=['BGS_017','BGS_021','BGS_071'].includes(sourceId);
  const roles={BGS_012:{event:'deploy',actor:'deployedSource',actorKinds:['op'],targets:'topAttackFactionOperators',recipientKinds:['op'],includeSelf:true},BGS_017:{event:'deploy',actor:'deployedFriendly',actorKinds:['token'],targets:'newSummonedToken',recipientKinds:['token']},BGS_019:{event:'battleStartEnemySpawn',actor:'firstEnemy',actorKinds:['enemy'],targets:'factionCount',countKinds:['op','token']},BGS_021:{event:'deploy',actor:'deployedFriendly',actorKinds:['token'],targets:'newSummonedToken',recipientKinds:['token']},BGS_071:{event:'deploy',actor:'deployedFriendly',actorKinds:['token'],targets:'newSummonedToken',recipientKinds:['token']},BGS_080:{event:'overkill',actor:'attacker',actorKinds:['op'],targets:'otherFactionOperators',recipientKinds:['op','token'],excludeSelf:true}};
  const role=roles[sourceId];
  const recipientKinds=role?.recipientKinds||(r.retire?.faction||r.retire?.randomAlly||r.retire?.shield?['op','token']:undefined);
  return [{behavior:'darkmoonCombat',params:{scope:'boardonly',targets:role?.targets||(deploymentReactor?(sourceId==='BGS_112'?'adjacentToDeploymentActor':'sourceOperator'):(summonedActor?(sourceId==='BGS_021'?'newSummonedToken':'sourceOperator'):(r.target==='adjacentSelf'?'adjacentRadius':'all'))),event:role?.event||(deploymentReactor||sourceId==='BGS_012'?'deploy':summonedActor?'summon':undefined),actor:role?.actor||(deploymentReactor?'deployedFriendly':sourceId==='BGS_012'?'deployedSource':summonedActor?'newSummonedToken':undefined),actorKinds:role?.actorKinds||(deploymentReactor?['op','token']:sourceId==='BGS_012'?['op']:summonedActor?['token']:undefined),recipientKinds:role?.recipientKinds||recipientKinds, countKinds:role?.countKinds, includeSelf:role?.includeSelf, radius:1.5,match,excludeSelf:!!(r.excludeSelf||r.aura||role?.excludeSelf)}}];
}

export function darkmoonCombatMetadata(sourceId, elite=false) {
  if(sourceId==='BGS_075')return {trigger:'招募获得或首次上阵时',recipient:'自身',duration:'本局成长',text:`招募具有战斗部署效果的干员时，自身获得${elite?2:1}枚攻击徽章与${elite?2:1}枚伤害徽章。`,sourceId,implementation:'supported',adapter:['darkmoonPrep'],event:'gain',actor:'recruited-deployment-source',targets:'self'};
  const r=rules[sourceId]; if(!r)return null;
  const m=elite?2:1;
  const number=x=>Array.isArray(x)?x[elite?1:0]:x;
  const buffText=v=>`攻击徽章×${v[0]*m}${v[1]?`与伤害徽章×${v[1]*m}`:''}`;
  let text='',trigger='战斗中',recipient='自身',duration='本场战斗';
    if(r.retire) {
      const p=r.retire,deploy=sourceId!=='BGS_008',at=deploy?'战斗中每次实际部署时':'被击倒时';trigger=deploy?'战斗部署时':'被击倒时';recipient=p.randomAlly?'随机友方':p.faction?FACTIONS[p.faction]+'友方':p.buff?'所有友方':'战场';
      if(deploy&&p.damage){trigger='战斗部署后首次普通攻击时';}
    text=p.coin?`${at}将${p.coin*m}张罗德岛采购券加入装备栏；使用一张可获得一枚金币。`:p.buff?`${at}使${recipient}获得${buffText(p.buff)}。`:p.shield?`${at}为${p.randomAlly?`随机${m}名友方`:recipient}各增加${p.shield}层护盾。`:p.damage?`${at}${p.allCombatants?'对场上所有单位':'对一个随机敌人'}造成相当于自身基础攻击${p.damage*100}%的法术伤害${elite?'，触发两次':''}。`:p.fallen?`${at}召回本场最先倒下的${number(p.count)}名${FACTIONS[p.fallen]}友方的原始幻影。`:`${at}召唤${p.attackCount?'按当前攻击成长计算，最多七个':number(p.count)}个${p.random?('随机'+(FACTIONS[p.random]||(p.random==='tier2'?'低本':p.random==='legendary'?'六星':'战斗部署效果'))+'原型'):'作战支援单位'}${p.handCopy?'，并将对应干员的原始复制加入整备区':''}。`;
  } else if(r.buff&&r.event) {
    trigger={summon:'召唤友方支援单位',death:'友方退场',kill:'友方击倒敌人',attack:'友方攻击',attacked:'友方受到攻击',shieldLayersBroken:'友方累计破裂五层护盾'}[r.event];
    recipient={self:'自身',actor:'触发效果的友方',all:'所有友方',adjacentActor:'退场干员附近的友方',adjacentSelf:'自身附近的友方'}[r.target];
    duration=r.permanent?'本局成长':'本场战斗';
    const actor=r.requireCover?'佩戴坚守盟约的友方干员':r.event==='summon'&&r.faction?`${FACTIONS[r.faction]}支援单位`:r.faction?`${FACTIONS[r.faction]}干员`:'友方干员';
    const action=r.event==='summon'?'被召唤':({death:'退场',kill:'击倒敌人',attack:'攻击敌人',attacked:'受到攻击',shieldLayersBroken:'累计破裂五层护盾'}[r.event]||trigger);
    trigger=`${actor}${action}`;
    text=`${actor}${action}时，使${recipient}${r.permanent?'装备'+buffText(r.buff):'获得'+buffText(r.buff)+'的战斗增益'}${r.shield?'及五层护盾':''}。同一效果每3秒最多触发一次，每场最多25次。`;
  } else if(r.event==='damaged')text=`受到伤害后召唤一个携带坚守盟约的机械支援单位${elite?'，支援单位的攻击和生命翻倍':''}；每三秒一次，每场最多七次。`;
  else if(r.summonMultiplier)text=`卡牌效果召唤的支援单位数量变为${number(r.summonMultiplier)}倍；不复制装备或成长。`;
  else if(r.retireMultiplier)text=`友方战斗部署效果触发${number(r.retireMultiplier)}次；不增加其他产出。`;
  else if(r.echo)text=`普通攻击后随机复制另一名在场友方的战斗部署效果${elite?'，复制两次':''}；每六秒一次，每场最多三次。`;
  else if(r.startStrike)text=`首批敌人入场时，随机造成${elite?'两次':'一次'}法术伤害，每次为自身基础攻击的40%乘以己方卡西米尔干员数量。`;
  else if(r.attackRamp)text=`每次攻击临时提高攻击倍率${elite?30:20}%，最多叠加至额外${elite?300:200}%；同一效果每三秒触发一次。`;
  else if(r.overkill)text=r.overkill==='spill'?`攻击击倒敌人时，把超过其生命的伤害传递给${elite?'目标附近所有敌人':'目标附近一个随机敌人'}。`:r.overkill==='strike'?`攻击超杀时对最左侧敌人追加${elite?300:150}%基础攻击的法术伤害。`:r.overkill==='summon'?`攻击超杀时召唤一个强力作战支援单位${elite?'，支援单位的攻击和生命翻倍':''}。`:`攻击超杀时使其他维多利亚友方获得${buffText(r.buff)}。`;
  else if(r.recruitOnKill){duration='整备区';text=`普通攻击击倒敌人后，随机将${elite?2:1}名原始干员加入整备区；每场最多触发一次。`;}
  else if(r.counterattack)text=`受到敌人攻击并存活后立即反击一次；每三秒触发一次，反击不再次触发自身反击。`;
  else if(r.intercept)text=`敌人准备攻击携带坚守盟约的其他友方时，替其承受攻击；需要自身可被该敌人攻击。`;
  else if(r.aura)text=`在场时使其他维多利亚友方获得${buffText(r.aura.buff)}；自身退场后失效。`;
  // These descriptions spell out the actual replay body or token recipe. They do not alter
  // the native rules above; elite forms scale the spawned body even when its count is fixed.
  if(sourceId==='BGS_006') text=`战斗中每次实际部署时召唤${number(r.retire.count)}名随机六星干员的作战投影。`;
  else if(sourceId==='BGS_008') text=`被击倒时召唤${number(r.retire.count)}名随机带有战斗部署效果干员的作战投影；获得时装备1件突袭盟约。`;
  else if(sourceId==='BGS_012') text=`战斗中每次实际部署时复制场上攻击力最高的${number(r.retire.count)}名哥伦比亚干员（包含自身）的原始幻影；人数不足时按实际人数召唤。`;
  else if(sourceId==='BGS_017') text=`叙拉古支援单位实际部署时，使该单位获得攻击徽章×${r.buff[0]*m}的战斗增益；每只单位每次部署触发一次，每场最多25次。`;
  else if(sourceId==='BGS_021') text=`叙拉古支援单位实际部署时，使该单位获得攻击徽章×${r.buff[0]*m}与伤害徽章×${r.buff[1]*m}的战斗增益；每只单位每次部署触发一次，每场最多25次。`;
  else if(sourceId==='BGS_071') text=`哥伦比亚支援单位实际部署时，使自身获得攻击徽章×${r.buff[0]*m}的战斗增益，护盾刷新至五层（已有五层时不增加）；每只单位每次部署触发一次，每场最多25次。`;
  else if(sourceId==='BGS_023') text=`战斗中每次实际部署时召唤${number(r.retire.count)}名随机二星干员的作战投影。`;
  else if(sourceId==='BGS_061') text=`战斗中每次实际部署时召唤${number(r.retire.count)}个黄金盟誓投影。`;
  else if(sourceId==='BOT_218') text=`受到伤害后召唤一个机械水獭投影，并赋予坚守盟约；每3秒最多触发一次，每场最多7次。`;
  else if(sourceId==='BOT_312') text=`战斗中每次实际部署时召唤3个机械水獭投影。`;
  else if(sourceId==='BOT_537') text=`战斗中每次实际部署时召唤一个机械水獭投影。`;
  else if(sourceId==='CFM_316') text=`战斗中每次实际部署时按自身当前攻击与基础攻击之比×2召唤狼群投影（至少1个，至多7个）。`;
  else if(sourceId==='EX1_531'||sourceId==='GVG_106') { trigger=`${FACTIONS[r.faction]}友方战斗部署时`; text=`${FACTIONS[r.faction]}友方战斗部署时，使自身获得${buffText(r.buff)}。`; }
  else if(sourceId==='BGS_112') { trigger='携带坚守盟约的友方战斗部署时'; text='携带坚守盟约的友方战斗部署时，使该干员附近友方获得'+buffText(r.buff)+'。'; }
  else if(sourceId==='FP1_031') text=`友方战斗部署效果触发${number(r.retireMultiplier)}次；不增加其他产出。`;
  else if(sourceId==='BGS_078') text=`普通攻击后随机复制另一名在场友方的战斗部署效果${elite?'两次':''}；每六秒一次，每场最多三次。`;
  else if(sourceId==='BOT_606') text=`战斗部署后，下一次普通攻击时对一个随机敌人造成自身基础攻击200%的法术伤害${elite?'，触发两次':''}；每次部署各排队一次。`;
  else if(sourceId==='FP1_024') text=`战斗部署后，下一次普通攻击时对场上所有单位造成自身基础攻击40%的法术伤害${elite?'，触发两次':''}；每次部署各排队一次。`;
  if(r.windfury)text=`攻击后追加${elite?3:1}次普通攻击；每三秒一轮。${text}`;
  if(r.weakest)text+='优先攻击当前可攻击范围内攻击力最低的敌人。';
  return {trigger,recipient,duration,text,sourceId,implementation:'supported',adapter:['darkmoonCombat'],...(r.retire?{event:sourceId==='BGS_008'?'knockoutPayload':'deploymentPayload',actor:sourceId==='BGS_008'?'killed-source':'deployed-source',targets:recipient}:{}),...(['EX1_531','GVG_106','BGS_112'].includes(sourceId)?{event:'allyDeployment',actor:'deployed-ally',targets:sourceId==='BGS_112'?'adjacent-allies':'owner'}:{})};
}

export function installDarkmoonCombat(battle,{catalog,pieces=[],state=null}={}) {
  const byUid=new Map(pieces.map(p=>[p.uid,p]));
  const sourceOf=u=>catalog.operators?.[u?.def?.raw?.darkmoonNativeChessId] || (u?.kind==='token'?sourceOf(u.ownerUnit):catalog.operators?.[byUid.get(u?.uid)?.chessId]);
  const identity=u=>u?.mem?.darkmoonFactionTags || u?.def?.darkmoonFactionTags || u?.def?.raw?.darkmoonFactionTags || (u?.kind==='token'?identity(u.ownerUnit):nativeFactions(byUid.get(u?.uid)||{chessId:u?.defId},catalog));
  const eligible=(u,owner,tribe=null)=>!!u&&u.side==='ally'&&own(u,owner)&&['op','token'].includes(u.kind)&&(!tribe||identity(u).includes(FACTIONS[tribe]||tribe));
  const members=(owner,tribe=null)=>battle.allyUnits.filter(u=>alive(u)&&eligible(u,owner,tribe)).sort(order);
  const enemies=()=>battle.enemies.filter(alive).sort((a,b)=>a.x-b.x||a.id-b.id);
  const pick=a=>a.length?a[Math.floor(battle.rng()*a.length)]:null;
  const hasCover=u=>u?.mem?.darkmoonCover || u?.def?.darkmoonCover || u?.def?.raw?.darkmoonCover || (byUid.get(u?.uid)?.equipment||[]).some(x=>catalog.equipment[x.id]?.params?.gearId==='oath-cover');
  const entries=battle.allyUnits.filter(u=>u.kind==='op').flatMap(unit=>{
    const op=sourceOf(unit),piece=byUid.get(unit.uid);
    const sources=[{id:op?.sourceRefs?.darkmoon19_2?.id,elite:!!(piece?.elite||op?.elite),instanceKey:''},
      ...(piece?.attachments||[]).flatMap((a,index)=>a.id==='darkmoon-magnetic'&&a.state?.sourceId==='BOT_312'?[{id:a.state.sourceId,elite:!!a.state.elite,instanceKey:`:magnetic:${index}`}]:[])];
    return sources.filter(x=>rules[x.id]).map(({id,elite,instanceKey})=>({unit,id,rule:rules[id],elite,instanceKey,last:-Infinity,uses:0,retireUses:0,deployUses:0,deploySeqs:new Set(),echoes:0,seen:new Set(),stacks:new Map()}));
  });
  for(const unit of battle.allyUnits.filter(u=>u.kind==='op')){
    const sources=[...new Set(entries.filter(e=>e.unit===unit&&hasDarkmoonDeploymentPayload(e.id)).map(e=>e.id))];
    if(sources.length)(unit.mem.darkmoonDeploymentSources=sources);
  }
  const results=battle.independentDarkmoonResults={growth:[],recruits:[],coins:[]};
  const trace=battle.independentDarkmoonTrace=[];
  const note=(e,kind,targets=[])=>{trace.push({sourceId:e.id,sourceUid:e.unit.uid,kind,time:battle.time,targets:targets.map(u=>u.uid??u.id)});battle.emit('darkmoonEffect',{sourceId:e.id,source:e.unit,kind,targets});};
  const ready=(e,seconds=3,max=25,channel='event')=>{const c=(e.channels||={})[channel]||{last:-Infinity,uses:0};if(battle.time<c.last+seconds||c.uses>=max)return false;c.last=battle.time;c.uses++;e.channels[channel]=c;if(channel==='event')e.uses=c.uses;return true;};
  const scale=e=>e.elite?2:1;
  const growthMods=(u,a,h)=>{
    const mods={atkFlat:u.base.atk*a*.02};
    if(h)mods.dmgDealtMul=1+.02*h;
    const piece=byUid.get(u.uid);
    if(state?.growthMode==='levels'&&(piece||u.kind==='token')){
      for(const field of Object.keys(mods))delete mods[field];
      if(piece){
        const info=operatorGrowthInfo(piece,catalog),op=catalog.operators[piece.chessId],raw=piece.elite?op.source.eliteChess||op.source.normalChess:op.source.normalChess;
        const trained=nativeLevelAttributes(raw.nativeGrowth,info.phase,Math.min(info.maximum,info.level+(a+h)*Number(catalog.config?.levelsPerBadge||1)));
        for(const [field,key]of [['atk','atkFlat'],['maxHp','hpFlat'],['def','defFlat'],['res','resFlat']])mods[key]=trained[field]-info.stats[field];
      }else{
        // Summons train on their own native token curve. The summoner contributes only
        // phase/level context; using its operator curve (or a badge-percent fallback)
        // would give wolf packs and other tokens the wrong body.
        const raw=u.def?.raw,sourceRaw=raw?.nativeGrowth?raw:raw?.raw?.nativeGrowth?raw.raw:raw;
        const projection=raw?.nativeGrowthProjection||sourceRaw?.nativeGrowthProjection;
        const ownerRaw=u.ownerUnit?.def?.raw?.nativeGrowth?u.ownerUnit.def.raw:u.ownerUnit?.def?.raw?.raw?.nativeGrowth?u.ownerUnit.def.raw.raw:u.ownerUnit?.def?.raw;
        const curve=projection?.source==='ownerOperator'?ownerRaw?.nativeGrowth:sourceRaw?.nativeGrowth;
        if(!curve)throw new Error(`MISSING_NATIVE_TOKEN_GROWTH:${u.defId}`);
        // Mylsse original-operator projections carry their selected character's
        // own phase/level in nativeGrowthStatus; native summons instead inherit a
        // frozen owner context. Prototype projections select their prototype's
        // variant rather than the unrelated operator that happened to summon it.
        if(projection?.source==='ownerOperator'){
          const ownerStatus=u.nativeOwnerGrowth||u.ownerUnit?.nativeGrowthStatus||{};
          const phase=Number(ownerStatus.phase??0),maximum=Number(curve.phases?.[phase]?.maxLevel);
          if(!(maximum>=1))throw new Error(`BAD_NATIVE_TOKEN_PROJECTION_PHASE:${u.defId}:${phase}`);
          const level=Math.min(maximum,Math.max(1,Number(ownerStatus.level)||1));
          const baseline=nativeLevelAttributes(curve,phase,level);
          const trained=nativeLevelAttributes(curve,phase,Math.min(maximum,level+(a+h)*Number(catalog.config?.levelsPerBadge||1)));
          const ratios=projection.scales||{};
          for(const [field,key,scaleKey]of [['atk','atkFlat','atk'],['maxHp','hpFlat','maxHp'],['def','defFlat','def'],['res','resFlat','res']]){
            const ratio=Number(ratios[scaleKey]);
            if(!Number.isFinite(ratio))throw new Error(`BAD_NATIVE_TOKEN_PROJECTION_SCALE:${u.defId}:${scaleKey}`);
            mods[key]=(trained[field]-baseline[field])*ratio;
          }
          return mods;
        }
        const prototypeOwnerId=raw?.darkmoonPrototypeOwnerChessId||sourceRaw?.darkmoonPrototypeOwnerChessId;
        const prototypeStatus=prototypeOwnerId&&(sourceRaw?.variants?.[prototypeOwnerId]||raw?.variants?.[prototypeOwnerId]);
        const ownerStatus=u.nativeGrowthStatus||prototypeStatus||u.nativeOwnerGrowth||raw.status||{};
        const phase=Number(ownerStatus.phase??0),maximum=Number(curve.phases?.[phase]?.maxLevel);
        if(!(maximum>=1))throw new Error(`BAD_NATIVE_TOKEN_GROWTH_PHASE:${u.defId}:${phase}`);
        const level=Math.min(maximum,Math.max(1,Number(ownerStatus.level)||1));
        const baseline=nativeLevelAttributes(curve,phase,level);
        const trained=nativeLevelAttributes(curve,phase,Math.min(maximum,level+(a+h)*Number(catalog.config?.levelsPerBadge||1)));
        const prototypeScale=raw?.darkmoonPrototypeScale||sourceRaw?.darkmoonPrototypeScale||{};
        for(const [field,key,scaleKey]of [['atk','atkFlat','attack'],['maxHp','hpFlat','health'],['def','defFlat','defense'],['res','resFlat',null]]){
          const scale=scaleKey&&Object.hasOwn(prototypeScale,scaleKey)?Number(prototypeScale[scaleKey]):1;
          if(!Number.isFinite(scale))throw new Error(`BAD_NATIVE_TOKEN_PROTOTYPE_SCALE:${u.defId}:${scaleKey}`);
          mods[key]=(trained[field]-baseline[field])*scale;
        }
      }
    }
    return mods;
  };
  // All temporary training shares one native level curve and one cap. Two sources
  // cannot each add a full cap's worth of interpolated attributes independently.
  const refreshTraining=u=>{
    const contributions=u.mem.darkmoonLevelContributions||{};
    for(const [key,value]of Object.entries(contributions))if(value.expiresAt<=battle.time)delete contributions[key];
    const total=Object.values(contributions).reduce((sum,value)=>sum+value.units,0);
    const piece=byUid.get(u.uid);
    if(piece){
      const info=operatorGrowthInfo(piece,catalog);
      u.nativeGrowthStatus={phase:info.phase,level:Math.min(info.maximum,info.level+total*Number(catalog.config?.levelsPerBadge||1))};
    }
    battle.addBuff(u,{key:'darkmoon:native-level-growth',mods:growthMods(u,total,0),persist:true,allowDead:true,refresh:'replace'});
  };
  const applyGrowth=(u,key,a,h,duration=Infinity)=>{
    if(state?.growthMode==='levels'&&(byUid.has(u.uid)||u.kind==='token')){
      (u.mem.darkmoonLevelContributions||={})[key]={units:a+h,expiresAt:battle.time+duration};
      refreshTraining(u);
    }else battle.addBuff(u,{key,mods:growthMods(u,a,h),duration,persist:duration===Infinity,allowDead:true,refresh:'replace'});
  };
  const equipment=(e,u,a,h,persistent=false)=>{
    if(!u)return;
    const m=scale(e),key=`darkmoon:${e.unit.uid}:${e.id}${e.instanceKey||''}:${u.id}`;
    const v=e.stacks.get(u.id)||{a:0,h:0};v.a+=a*m;v.h+=h*m;e.stacks.set(u.id,v);
    applyGrowth(u,key,v.a,v.h);
    (u.mem.darkmoonTemporaryEquipment||={})[key]=state?.growthMode==='levels'
      ? {sourceId:e.id,temporaryTrainingLevels:(v.a+v.h)*Number(catalog.config?.levelsPerBadge||1),expires:'battleEnd'}
      : {sourceId:e.id,attackUnits:v.a,secondaryUnits:v.h,badgeIds:['precision','damage'],expires:'battleEnd'};
    if(persistent&&u.kind==='op')results.growth.push(state?.growthMode==='levels'
      ? {sourceUid:e.unit.uid,targetUid:u.uid,growthLevels:(a+h)*m*Number(catalog.config?.levelsPerBadge||1)}
      : {sourceUid:e.unit.uid,targetUid:u.uid,attackUnits:a*m,secondaryUnits:h*m,badgeIds:['precision','damage']});
  };
  const shield=(e,u,layers,{atLeast=false}={})=>{const key=`darkmoon:shield:${e.unit.uid}${e.instanceKey||''}:${u.id}`,n=Number(u.findBuff(key)?.shieldHits||0),next=atLeast?Math.max(n,layers):n+layers;if(next===n)return;battle.addBuff(u,{key,shieldHits:next,source:e.unit,duration:Infinity,persist:true,allowDead:true,refresh:'replace'});};
  const auras=[];
  const fallen=[];
  const summonMultiplier=owner=>Math.max(1,...entries.filter(e=>e.rule.summonMultiplier&&alive(e.unit)&&own(e.unit,owner)).map(e=>e.rule.summonMultiplier[e.elite?1:0]));
  const retireMultiplier=owner=>Math.max(1,...entries.filter(e=>e.rule.retireMultiplier&&e.id!=='FP1_031'&&alive(e.unit)&&own(e.unit,owner)).map(e=>e.rule.retireMultiplier[e.elite?1:0]));
  const deploymentMultiplier=owner=>Math.max(1,...entries.filter(e=>e.id==='FP1_031'&&alive(e.unit)&&own(e.unit,owner)).map(e=>e.rule.retireMultiplier[e.elite?1:0]));
  const normalOps=()=>Object.values(catalog.operators).filter(op=>!op.elite&&op.recruitable!==false&&(op.source?.normalChess?.visible!==false||op.source?.normalChess?.nativeImport?.playable===true));
  const randomDef=(e,kind)=>{
    let ops=normalOps();
    if(FACTIONS[kind])ops=ops.filter(op=>op.nativeFactionTags?.includes(FACTIONS[kind])&&(kind!=='ELEMENTAL'||op.chessId!==sourceOf(e.unit)?.chessId));
    else if(kind==='tier2')ops=ops.filter(op=>op.tier===2);
    else if(kind==='legendary')ops=ops.filter(op=>Number(op.source?.normalChess?.rarity)>=6);
    else if(kind==='deathrattle')ops=ops.filter(op=>hasDarkmoonDeploymentPayload(op.sourceRefs?.darkmoon19_2?.id));
    const op=pick(ops);if(!op)return null;
    const raw=op.source.normalChess,normalized=battle.data.getChess(op.chessId,{skillIndex:raw.skill?.index??0,moduleId:'none'});
    const stats=state?.growthMode==='levels'?levelBodyStats({chessId:op.chessId,growthMode:'levels',growthLevel:1,skillIndex:raw.skill?.index??0,moduleId:'none'},catalog,raw):{...raw.stats};
    return {op,def:{...normalized,name:`${raw.name}投影`,stats,darkmoonProjection:true,darkmoonSourceId:op.sourceRefs?.darkmoon19_2?.id,darkmoonNativeChessId:op.chessId}};
  };
  const phantomDef=(e,u)=>{
    const piece=byUid.get(u?.uid),op=sourceOf(u),elite=!!(piece?.elite||op?.elite||u.def.golden||u.def.raw?.golden);
    const nativeId=elite?(op?.eliteChessId||piece?.chessId||op?.chessId||u?.def?.raw?.darkmoonNativeChessId):(piece?.chessId||op?.baseChessId||op?.chessId||u?.def?.raw?.darkmoonNativeChessId);
    if(!nativeId)return null;
    const raw=(elite?op?.source?.eliteChess||op?.source?.normalChess:op?.source?.normalChess)||u.def.raw;
    const normalized=battle.data.getChess(nativeId,{skillIndex:raw.skill?.index??0,moduleId:'none'});
    const stats=state?.growthMode==='levels'?levelBodyStats({chessId:nativeId,elite,growthMode:'levels',growthLevel:1,skillIndex:raw.skill?.index??0,moduleId:'none'},catalog,raw):{...raw.stats};
    return {def:{...normalized,name:`${raw.name}投影`,stats,golden:elite,darkmoonProjection:true,darkmoonNativeChessId:nativeId},tags:identity(u)};
  };
  const tokenDef=(e,p)=>{
    const prototypes={
      mechanical:{tokenId:'token_10004_otter_motter',ownerId:'chess_native_char_242_otter_a',name:'机械水獭投影',prototypeName:'机械水獭'},
      beast:{tokenId:'token_10028_vigil_wolf',ownerId:'chess_char_3_19_a',name:'狼群投影',prototypeName:'狼群'},
      pirate:{tokenId:'token_10040_siege2_vlion',ownerId:'chess_char_6_07_a',name:'黄金盟誓投影',prototypeName:'黄金盟誓'},
      elemental:{tokenId:'token_10015_dusk_drgn',ownerId:'chess_char_5_12_a',name:'小自在投影',prototypeName:'“小自在”'},
    };
    const prototype=prototypes[p.token]||prototypes.mechanical;
    const nativeId=prototype.tokenId;
    const record=battle.tokenDef(nativeId,prototype.ownerId)||{id:nativeId,rangeGrid:[[0,0],[0,1]]};
    const [a,h]=p.stats, m=scale(e), proto=record.stats||{};
    const darkmoonPrototypeScale={attack:a*.4*m,health:h*.4*m,defense:.4};
    const stats={...proto,maxHp:Math.round((Number(proto.maxHp)||0)*darkmoonPrototypeScale.health),atk:Math.round((Number(proto.atk)||0)*darkmoonPrototypeScale.attack),def:Math.round((Number(proto.def)||0)*darkmoonPrototypeScale.defense),blockCnt:p.cover?2:1,cost:0};
    return {...record,id:nativeId,name:prototype.name,darkmoonPrototypeTokenId:nativeId,darkmoonPrototypeOwnerChessId:prototype.ownerId,darkmoonPrototypeName:prototype.prototypeName,
      darkmoonPrototypeScale,darkmoonSummonSourceText:`由${e.unit.name||'干员'}的额外特质生成`,darkmoonCover:!!p.cover,profession:'TOKEN',stats};
  };
  const spawn=(e,def,count,tags=[],p={})=>{
    const out=[],limit=Math.max(0,7-battle.allyUnits.filter(u=>u.kind==='token'&&alive(u)&&own(u,e.unit)&&u.mem.darkmoonSummon).length);
    for(let i=0;i<Math.min(count*summonMultiplier(e.unit),limit);i++){
      // Put identity on the definition before deployment, so summon observers see its real origin.
      const clean=structuredClone(def);clean.darkmoonFactionTags=tags;
      const prototypeOwnerId=clean.darkmoonPrototypeOwnerChessId;
      const nativeId=prototypeOwnerId||clean.darkmoonNativeChessId;
      const body=clean.darkmoonProjection?clean:battle.data.getToken(clean.id,prototypeOwnerId||e.unit.defId)||clean;
      const cell=findSummonTile(battle,e.unit,'near',{melee:body.position!=='RANGED',allBoard:true});if(!cell)break;
      const sourceOperator=nativeId?catalog.operators?.[nativeId]:null;
      const sourceRaw=sourceOperator?.elite?sourceOperator.source?.eliteChess||sourceOperator.source?.normalChess:sourceOperator?.source?.normalChess;
      const nativeDef=nativeId?(battle.data.getChess(nativeId)||sourceRaw||null):null;
      const nativeRaw=sourceRaw||nativeDef?.raw||nativeDef||{};
      const factory=nativeId?(KITS[nativeId]||KITS[nativeId.replace(/_[ab]$/,'')]):null;
      const kitDef=nativeDef?{...nativeDef,skill:nativeRaw.skill||nativeDef.skill,talents:nativeRaw.talents||nativeDef.talents}:null;
      const authored=factory?(factory(nativeRaw.skill?.bb||{},nativeRaw,kitDef)||{}):{};
      const kit=prototypeOwnerId?undefined:(nativeId?selectSkillSpec(authored,nativeRaw.skill?.bb||kitDef?.skill?.bb||{},nativeRaw,kitDef):undefined);
      const nativeGrowthStatus=nativeDef?{phase:nativeRaw.status?.phase??0,level:state?.growthMode==='levels'?1:nativeRaw.status?.level??1}:null;
      const token=battle.spawnToken(e.unit,clean.id,...cell,{def:clean,anySource:true,...(kit?{kit}:{}),ownerGrowth:nativeGrowthStatus,nativeGrowthStatus,duration:45,darkmoonHandled:true});
      if(token){
        token.ownerChessId=e.unit.defId||null;
        token.prototypeOwnerChessId=prototypeOwnerId||null;
        token.summonSourceText=clean.darkmoonSummonSourceText||`由${e.unit.name||'干员'}的额外特质生成`;
        token.prototypeName=clean.darkmoonPrototypeName||clean.name;
        token.uid ||= `darkmoon-copy:${token.id}`;
        token.mem.darkmoonSummon=true;token.mem.darkmoonFactionTags=tags;out.push(token);
        const copyPiece={uid:token.uid,chessId:nativeId||e.unit.defId,elite:!!(clean.golden||clean.isGolden),growthLevel:1,equipment:[]};
        const grants=darkmoonPrepRulesFor({darkmoonSourceId:clean.darkmoonSourceId},copyPiece.elite).filter(r=>r.trigger==='gain'&&r.behavior==='grantEquipment'&&r.params.landOn==='self').flatMap(r=>r.params.outputs);
        if(p.cover)grants.push({id:'坚守盟约',normal:1,elite:1});
        for(const grant of grants){
          const gear=catalog.equipment[grant.id]||Object.values(catalog.equipment).find(g=>g.name===String(grant.id).replace(/^independent:/,'')||g.sourceId===grant.id);
          if(gear?.mechanism==='keywordGear')copyPiece.equipment.push({id:gear.id,quantity:Number(copyPiece.elite?grant.elite:grant.normal)||1});
        }
        token.mem.darkmoonCover=copyPiece.equipment.some(x=>catalog.equipment[x.id]?.params?.gearId==='oath-cover');
        installKeywordGear(battle,{catalog,pieces:[copyPiece],units:[token]});
        const childRule=rules[clean.darkmoonSourceId];
        if(childRule&&(e.depth||0)<3){
          const child={unit:token,id:clean.darkmoonSourceId,rule:childRule,elite:copyPiece.elite,depth:(e.depth||0)+1,instanceKey:'',last:-Infinity,uses:0,retireUses:0,deployUses:0,deploySeqs:new Set(),echoes:0,seen:new Set(),stacks:new Map()};
          entries.push(child);installEntry(child);
          // The token's deploy event preceded its source entry installation. Resolve
          // its own eligible payload now without emitting a second actor event.
          if(hasDarkmoonDeploymentPayload(child.id)){
            token.mem.darkmoonDeploymentSources=[child.id];
            if(child.deployUses<3){child.deploySeqs.add(token.deploySeq??0);child.deployUses++;runDeploymentPayload(child,'deploy');}
          }
        }
        if(p.immediate)battle.forceAttack(token);
      }
    }
    note(e,'summon',out);return out;
  };
  const retireAction=(e,kind='retire')=>{
    const p=e.rule.retire;if(!p)return;
    const m=scale(e);let targets=[];
    if(p.buff){targets=members(e.unit,p.faction);for(const u of targets)equipment(e,u,...p.buff);}
    if(p.shield){const pool=members(e.unit).filter(u=>u!==e.unit);targets=p.randomAlly?[]:members(e.unit,p.faction);if(p.randomAlly)for(let i=0;i<m&&pool.length;i++){const chosen=pick(pool);targets.push(chosen);pool.splice(pool.indexOf(chosen),1);}for(const u of targets)shield(e,u,p.shield);}
    if(p.damage)for(let i=0;i<(p.hits?.[e.elite?1:0]||1);i++){targets=p.allCombatants?[...members(e.unit),...enemies()]:[pick(enemies())].filter(Boolean);for(const u of targets)battle.dealDamage(e.unit,u,{amount:e.unit.base.atk*p.damage,type:'arts',tags:['darkmoon','retiringEffect']});}
    if(p.coin)results.coins.push({sourceUid:e.unit.uid,quantity:p.coin*m,inventory:true});
    if(p.fallen&&e.id==='BGS_012'){
      const targets=members(e.unit,p.fallen).filter(u=>u.kind==='op').sort((a,b)=>b.s.atk-a.s.atk||order(a,b)).slice(0,p.count[e.elite?1:0]);
      for(const target of targets){const phantom=phantomDef(e,target);if(phantom)spawn(e,phantom.def,1,phantom.tags);}
    }else if(p.fallen){for(const x of fallen.filter(x=>own(x.unit,e.unit)&&x.tags.includes(FACTIONS[p.fallen])).slice(0,p.count[e.elite?1:0]))spawn(e,x.def,1,x.tags);}
    if(p.token){const count=p.attackCount?Math.min(7,Math.max(1,Math.floor(e.unit.s.atk/Math.max(1,e.unit.base.atk)*2))):(p.count[e.elite?1:0]);spawn(e,tokenDef(e,p),count,p.token==='beast'?['叙拉古']:p.token==='pirate'?['维多利亚']:['哥伦比亚'],p);}
    if(p.random)for(let i=0;i<p.count[e.elite?1:0];i++){
      const x=randomDef(e,p.random);if(!x)continue;const created=spawn(e,x.def,1,x.op.nativeFactionTags||[]);if(p.handCopy&&created.length)results.recruits.push({sourceUid:e.unit.uid,chessId:x.op.chessId,pristine:true});
    }
    note(e,kind,targets);
  };
  const deploymentEntriesFor=unit=>entries.filter(e=>e.unit===unit&&e.rule.retire&&e.id!=='BGS_008');
  const runDeploymentPayload=(e,kind='deploymentPayload')=>{
    if(e.rule.retire?.damage&&kind!=='deployEcho'){e.pendingDamage=(e.pendingDamage||0)+deploymentMultiplier(e.unit);note(e,'deployQueued',[]);return;}
    for(let i=0;i<deploymentMultiplier(e.unit);i++)retireAction(e,kind);
  };
  const pendingInitial=[];
  const deploymentActor=(actor,initial=false)=>{
    if(!actor||actor.side!=='ally'||actor.removed)return;
    battle.emit('darkmoonDeployActor',{actor,initial,kind:actor.kind,factions:identity(actor)});
    for(const e of deploymentEntriesFor(actor)){
      const seq=actor.deploySeq??0;
      if(e.deploySeqs.has(seq)||e.deployUses>=3||!alive(actor))continue;
      e.deploySeqs.add(seq);e.deployUses++;runDeploymentPayload(e,'deploy');
    }
  };
  battle.on('deploy',event=>{
    if(event.move||event.unit?.side!=='ally')return;
    if(event.initial){pendingInitial.push(event.unit);return;}
    deploymentActor(event.unit,false);
  });
  // Opening deployments are evaluated as one batch so late-placed amplifiers see the entire opening field.
  battle.on('battleStart',()=>{
    // Installation can happen after Battle.start has already emitted initial deploy
    // hooks (e.g. runtime adapters registered by a mode). Read the authoritative
    // opening field as well; deploySeq dedupe keeps captured events from repeating.
    const initial=[...new Set([...pendingInitial,...battle.allyUnits.filter(u=>u.side==='ally'&&u.alive&&u.deployed&&(u.kind==='op'||u.kind==='token'))])];pendingInitial.length=0;
    for(const actor of initial)if(alive(actor))battle.emit('darkmoonDeployActor',{actor,initial:true,kind:actor.kind,factions:identity(actor)});
    for(const actor of initial)for(const e of deploymentEntriesFor(actor)){
      const seq=actor.deploySeq??0;if(e.deploySeqs.has(seq)||e.deployUses>=3||!alive(actor))continue;
      e.deploySeqs.add(seq);e.deployUses++;runDeploymentPayload(e,'deploy');
    }
  },{priority:1000});
  battle.echoDarkmoonDeployment=(owner,faction=null)=>{
    const candidate=pick(entries.filter(e=>e.id!=='BGS_008'&&e.rule.retire&&e.unit!==owner&&alive(e.unit)&&eligible(e.unit,owner,faction)&&Number(e.echoes||0)<6));
    if(!candidate)return null;
    candidate.echoes++;
    const repetitions=deploymentMultiplier(candidate.unit);
    for(let i=0;i<repetitions;i++)retireAction(candidate,'deployEcho');
    return {unit:candidate.unit,repetitions};
  };
  // Deathrattle echo adapters must execute the exact same retirement payload
  // as a real retirement, while leaving the chosen operator alive. Keep
  // selection, faction ownership, per-candidate echo cap, and the live Baron
   // multiplier here with the native retirement entries.
  battle.echoDarkmoonRetirement=(owner,faction=null)=>{
    const e=entries.filter(x=>x.unit!==owner&&x.rule.retire&&alive(x.unit)&&eligible(x.unit,owner,faction)&&Number(x.echoes||0)<6)
      .sort((a,b)=>order(a.unit,b.unit)||String(a.id).localeCompare(String(b.id)))[0];
    if(!e)return null;
    e.echoes=(e.echoes||0)+1;
    const repetitions=retireMultiplier(e.unit);
    for(let i=0;i<repetitions;i++)retireAction(e,'retireEcho');
    return {unit:e.unit,repetitions};
   };
  battle.on('death',({unit,reason})=>{
    if(reason!=='killed'||unit.side!=='ally'||!['op','token'].includes(unit.kind))return;
    if(fallen.some(x=>x.unit.id===unit.id))return;
    const op=sourceOf(unit),nativeId=unit.kind==='op'?unit.defId:unit.def.raw?.darkmoonNativeChessId;
    if(nativeId&&op){
      const elite=!!(byUid.get(unit.uid)?.elite||unit.def.golden),raw=(elite?op.source?.eliteChess||op.source?.normalChess:op.source?.normalChess)||battle.data.raw?.chess?.[nativeId]||unit.def.raw||unit.def;
      const normalized=battle.data.getChess(nativeId,{skillIndex:raw.skill?.index??0,moduleId:'none'});
      const stats=levelBodyStats({chessId:nativeId,elite,growthMode:state?.growthMode,growthLevel:1,skillIndex:raw.skill?.index??0,moduleId:'none'},catalog,raw);
      fallen.push({unit,tags:identity(unit),def:{...normalized,id:'token_10030_mlyss_wtrman',baseId:'token_10030_mlyss_wtrman',golden:elite,stats,position:'MELEE',darkmoonSourceId:op.sourceRefs?.darkmoon19_2?.id,darkmoonNativeChessId:nativeId}});
    }else fallen.push({unit,tags:identity(unit),def:{...structuredClone(unit.def),stats:{...unit.base}}});
  },{priority:100});
  function installEntry(e){
    const {unit,rule:r}=e;
    if(r.retire?.damage&&e.id!=='BGS_008')battle.on('attack',event=>{
      if(event.attacker!==unit||!attackEvent(event)||!alive(unit)||!(e.pendingDamage>0))return;
      e.pendingDamage--;retireAction(e,'deploy');
    },{owner:unit});
    if(r.retire&&e.id==='BGS_008')battle.on('death',({unit:who,reason})=>{
      if(who!==unit||reason!=='killed'||e.retireUses>=3||e.seen.has(unit.deploySeq))return;
      e.seen.add(unit.deploySeq);e.retireUses++;const repeat=retireMultiplier(unit);
      battle.after(0,()=>{for(let i=0;i<repeat;i++)retireAction(e);});
    },{owner:unit});
    if(r.echo)battle.on('attack',event=>{
      if(event.attacker!==unit||event.isSkill||!attackEvent(event)||!alive(unit)||!ready(e,6,3))return;
      for(let i=0;i<scale(e);i++){const x=battle.echoDarkmoonDeployment(unit);if(x)note(e,'deployEcho',[x.unit]);}
    },{owner:unit});
    if(r.aura)auras.push(e);
    if(r.startStrike&&!e.depth){let done=false;battle.on('enemySpawn',()=>{if(done||!alive(unit))return;done=true;for(let i=0;i<(e.elite?2:1);i++){const target=pick(enemies());if(target)battle.dealDamage(unit,target,{amount:unit.base.atk*.4*members(unit,'DRAGON').length,type:'arts',tags:['darkmoon','combatStart']});}note(e,'startStrike');},{owner:unit});}
    if(r.weakest)battle.on('beforeAttack',ctx=>{if(ctx.attacker!==unit)return;const pool=battle.enemiesInKeys(unit.rangeKeys,unit,ctx.profile).sort((a,b)=>a.s.atk-b.s.atk||a.id-b.id);if(pool.length)ctx.targets=pool.slice(0,ctx.targets?.length||1);},{owner:unit,priority:-50});
    if(r.windfury)battle.on('attack',ev=>{
      if(ev.attacker!==unit||!attackEvent(ev)||!alive(unit)||!ready(e,3,50,'windfury'))return;
      unit.mem.darkmoonExtraAttack=true;try{for(let i=0;i<(e.elite?3:1)&&alive(unit);i++)battle.forceAttack(unit,null,{noAmmo:true});}finally{unit.mem.darkmoonExtraAttack=false;}note(e,'windfury');
    },{owner:unit,priority:-90});
    if(r.counterattack)battle.on('attack',ev=>{if(ev.attacker?.side!=='enemy'||!ev.targets?.includes(unit)||!alive(unit)||!ready(e))return;battle.after(0,()=>{if(alive(unit)){unit.mem.darkmoonExtraAttack=true;try{battle.forceAttack(unit);}finally{unit.mem.darkmoonExtraAttack=false;}note(e,'counterattack');}});},{owner:unit});
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
      else if(r.overkill==='spill'){const pool=enemies().filter(t=>t!==target&&close(t,target)<=1.5),next=e.elite?pool:[pick(pool)].filter(Boolean);for(const t of next)battle.dealDamage(unit,t,{amount:amount-mark.hp,type:dmg.type,tags:['darkmoon','overkill']});}
      else if(r.overkill==='factionBuff')for(const t of members(unit,r.faction).filter(t=>t!==unit))equipment(e,t,...r.buff);
      else if(r.overkill==='summon')spawn(e,tokenDef(e,r.summon),1,['叙拉古']);note(e,'overkill');
    },{owner:unit});
    if(r.event){
      let broken=0;
      const deploymentReactor=['EX1_531','GVG_106','BGS_112'].includes(e.id);
      const name=deploymentReactor||r.event==='summon'?'darkmoonDeployActor':r.event==='attacked'?'beforeAttack':r.event;
      battle.on(name,event=>{
        if(!alive(unit))return;
        let actor=deploymentReactor||r.event==='summon'?event.actor:r.event==='kill'?event.killer:r.event==='attack'?event.attacker:r.event==='damaged'?event.target:event.unit;
        let actors=r.event==='attacked'&&event.attacker?.side==='enemy'?event.targets||[]:actor?[actor]:[];
        // Player-placed native tokens are already on the opening field when this
        // adapter is installed. Treat their first battle deployment as the same
        // summon event as a token created during combat, while ignoring ordinary
        // opening operators and later reposition events.
        if(r.event==='summon')actors=actors.filter(u=>u.kind==='token'&&!event.move&&(!event.initial||u.mem?.independentSummon));
        if(deploymentReactor)actors=actors.filter(u=>['op','token'].includes(u.kind));
        if(r.event==='attack'&&!attackEvent(event))return;
        if(r.event==='kill'&&event.victim?.side!=='enemy')return;
        if(r.event==='death'&&!deploymentReactor)return;
        if(r.event==='damaged'&&!(event.amount>0))return;
        actors=actors.filter(u=>eligible(u,unit,r.faction)&&(!r.selfOnly||u===unit)&&(!r.excludeSelf||u!==unit)&&(!r.requireCover||hasCover(u)));
        if(!actors.length)return;
        if(r.event==='summon'){
          e.summonActors||=new Set();
          for(const summoned of actors){
            const key=`${summoned.id}:${summoned.deploySeq??0}`;
            if(e.summonActors.has(key)||e.summonUses>=25)continue;
            e.summonActors.add(key);e.summonUses=(e.summonUses||0)+1;
            const targets=r.target==='self'?[unit]:r.target==='actor'?[summoned]:r.target==='all'?members(unit):[];
            for(const target of targets)if(alive(target)){if(r.buff)equipment(e,target,...r.buff,!!r.permanent);if(r.shield)shield(e,target,r.shield,{atLeast:e.id==='BGS_071'});}
            note(e,'event',targets.filter(alive));
          }
          return;
        }
        if(r.event==='shieldLayersBroken'){broken+=Math.max(0,Number(event.layers)||0);if(broken<5)return;broken-=5;}
        if(!ready(e,r.event==='damaged'?3:3,r.event==='damaged'?7:25))return;
        const targets=new Set();
        for(const a of actors){
          const selected=r.target==='self'?[unit]:r.target==='actor'?[a]:r.target==='all'?members(unit):r.target==='adjacentActor'?members(unit).filter(u=>u!==a&&close(u,a)<=1.5):r.target==='adjacentSelf'?members(unit).filter(u=>u!==unit&&close(u,unit)<=1.5):[];
          for(const t of selected)if(alive(t))targets.add(t);
        }
        if(r.attackRamp){const key=`darkmoon:ramp:${unit.uid}`,n=Math.min(e.uses,10)*(.2*(e.elite?1.5:1));battle.addBuff(unit,{key,mods:{atkPct:n},persist:true,allowDead:true,refresh:'replace'});}
        if(r.summon)spawn(e,tokenDef(e,r.summon),1,['哥伦比亚'],r.summon);
        for(const t of targets){if(r.buff)equipment(e,t,...r.buff,!!r.permanent);if(r.shield)shield(e,t,r.shield);}
        note(e,'event',[...targets]);
      },{owner:unit});
    }
  }
  for(const entry of [...entries])installEntry(entry);
  battle.every(.25,()=>{for(const e of auras){const key=`darkmoon:aura:${e.unit.uid}`;for(const t of battle.allyUnits){if(alive(e.unit)&&alive(t)&&t!==e.unit&&eligible(t,e.unit,e.rule.aura.faction)){const v=e.rule.aura.buff,m=scale(e);applyGrowth(t,key,v[0]*m,v[1]*m,.5);}else{battle.removeBuff(t,key);if(t.mem.darkmoonLevelContributions?.[key]){delete t.mem.darkmoonLevelContributions[key];refreshTraining(t);}}}}});
  return {entries,fallen,results,trace,retireAction};
}
