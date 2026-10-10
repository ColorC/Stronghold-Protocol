import { grantEquipment } from './equipment.js';
import { operatorGrowthInfo } from '../../../shared/independentGrowth.js';
import { independentPermanentStats } from '../../sim/content/independent/battle.js';

export const HISTORICAL_PRIZE_PREFIX = 'darkmoon-prize:';
export const PRIZE_JESSICA_ID = 'chess_prize_jesca2_a';
export const PRIZE_JESSICA_ELITE_ID = 'chess_prize_jesca2_b';
const onBoard = p => p.row != null && p.col != null && !p.deleted && !p.removed;
const sourceKey = n => 'BGS_Treasures_' + String(n).padStart(3,'0');
const targets = new Set([0,9,15,16,18,26,28,34].map(sourceKey));
const WORDING = {
  BGS_Treasures_000:['浓缩营养包','为一名干员装备2枚攻击徽章和2枚伤害徽章。'],
  BGS_Treasures_001:['采购储备','获得2枚可随时使用的金币。'],
  BGS_Treasures_004:['新人征调','发现一名科技一级干员。'],
  BGS_Treasures_007:['全队战备','为场上所有干员各装备1枚攻击徽章和1枚伤害徽章。'],
  BGS_Treasures_013:['优质库存','本局商店干员额外携带1枚伤害徽章。'],
  BGS_Treasures_029:['快速调度','接下来3次刷新免费。'],
  BGS_Treasures_033:['扩展招募','本局商店增加一个干员栏位。'],
  BGS_Treasures_006:['调度更新','将商店所有干员替换为高一级科技的随机干员。'],
  BGS_Treasures_009:['持续训练','为一名干员装备持续训练装置；每回合整备结束时，为其装备2枚攻击徽章和2枚伤害徽章。'],
  BGS_Treasures_010:['战场征调','从上一场我方实际参战干员中发现一名的原始复制。上一场为空时，改为从当前可招募干员中发现。'],
  BGS_Treasures_012:['免费征调','发现一名当前科技等级的干员。'],
  BGS_Treasures_014:['循环铸币','每回合可使用一次，获得1枚金币；这张奖品会保留。'],
  BGS_Treasures_026:['坚守援助','为一名干员装备5枚攻击徽章、5枚生命徽章和坚守盟约。'],
  BGS_Treasures_030:['重复部署许可','本回合，获得干员时触发的特质额外触发一次。'],
  BGS_Treasures_036:['建设优惠','本局每回合结束时，额外降低2枚金币的升本费用。'],
  BGS_Treasures_011:['后勤改组','发现一项本局后勤效果：增加徽章产出、每回合免费刷新，或招募后返还金币。'],
  BGS_Treasures_015:['护盾补给','为一名干员装备护盾发生器。'],
  BGS_Treasures_018:['攻势倍增','为一名干员装备足够的攻击徽章，使其永久攻击面板至少翻倍；训练模式按双倍攻击目标沿原生成长曲线提高等级；超过原生等级上限的目标不额外添加属性。'],
  BGS_Treasures_019:['营养储备','获得基础营养包，数量等于十份储备中尚未持有的份数。每份可为一名干员装备1枚攻击徽章和1枚伤害徽章。'],
  BGS_Treasures_020:['顶级征调','发现一名科技六级干员。'],
  BGS_Treasures_034:['回营整备','将一名未进阶干员撤回整备区，并为其装备2枚攻击徽章和2枚伤害徽章。'],
  BGS_Treasures_037:['进阶库存','随机使商店一名未进阶干员进阶。'],
  TB_Bacon_Secrets_12:['应急屏障','下一次战斗中受到致命据点伤害时，免除该场战斗的据点伤害。'],
  BGS_Treasures_016:['提高战备','使一名未进阶干员进阶并撤回整备区。'],
  BGS_Treasures_022:['友好采购','本局购买商店干员少花1枚金币。'],
  BGS_Treasures_023:['开放调度','本局每回合前5次刷新免费。'],
  BGS_Treasures_025:['重新拨款','补足本回合的自然金币。'],
  BGS_Treasures_028:['协同武装','为一名干员装备护盾发生器、速射扳机，以及10枚攻击徽章和10枚生命徽章。速射扳机使每第8次普通攻击连射两次。'],
  BGS_Treasures_032:['超级赢家','分别发现一份第一、第二和第三档暗月奖品。'],
  SCH_149:['涤火杰西卡','获得奖品支援干员涤火杰西卡。获得时，以攻击徽章和生命徽章补足至场上友方最高的永久攻击和生命面板；训练模式沿其原生成长曲线训练至队伍的最高战备水平。'],
};
// Real Integrated Strategies collectibles used as art references for workshop rewards.
// Keep the workshop effect/title authoritative; the original item is provenance only.
const ROGUELIKE_PRIZE_ART = {
  BGS_Treasures_000:'rogue_2_relic_grace_5', BGS_Treasures_001:'rogue_1_gold',
  BGS_Treasures_004:'rogue_1_recruit_ticket_pioneer', BGS_Treasures_007:'rogue_2_relic_grace_6',
  BGS_Treasures_013:'rogue_2_relic_grace_3', BGS_Treasures_029:'rogue_1_recruit_ticket_all_discount',
  BGS_Treasures_033:'rogue_1_recruit_ticket_all', BGS_Treasures_006:'rogue_5_relic_legacy_9',
  BGS_Treasures_009:'rogue_5_relic_legacy_13', BGS_Treasures_010:'rogue_1_recruit_ticket_all_discount',
  BGS_Treasures_012:'rogue_1_recruit_ticket_all', BGS_Treasures_014:'rogue_1_gold',
  BGS_Treasures_026:'rogue_5_relic_legacy_20', BGS_Treasures_030:'rogue_5_relic_legacy_10',
  BGS_Treasures_036:'rogue_1_gold', BGS_Treasures_011:'rogue_2_relic_grace_12',
  BGS_Treasures_015:'rogue_2_relic_grace_19', BGS_Treasures_018:'rogue_2_relic_grace_5',
  BGS_Treasures_019:'rogue_2_relic_grace_1', BGS_Treasures_020:'rogue_1_recruit_ticket_all_premium',
  BGS_Treasures_034:'rogue_5_relic_legacy_9', BGS_Treasures_037:'rogue_5_relic_legacy_1',
  TB_Bacon_Secrets_12:'rogue_2_relic_grace_11', BGS_Treasures_016:'rogue_5_relic_legacy_10',
  BGS_Treasures_022:'rogue_2_relic_grace_18', BGS_Treasures_023:'rogue_2_relic_grace_12',
  BGS_Treasures_025:'rogue_1_gold', BGS_Treasures_028:'rogue_2_relic_grace_11',
  BGS_Treasures_032:'rogue_5_relic_legacy_11', SCH_149:'rogue_1_recruit_ticket_all_premium',
};
const LEVEL_WORDING = {
  BGS_Treasures_011:'发现一项本局后勤效果：增加训练产出、每回合免费刷新，或招募后返还金币。',
  BGS_Treasures_000:'为一名干员提供4级训练。',BGS_Treasures_007:'为场上所有干员各提供2级训练。',
  BGS_Treasures_013:'本局商店干员额外携带1级训练。',
  BGS_Treasures_009:'为一名干员装备持续训练装置；每回合整备结束时，为其提供4级训练。',
  BGS_Treasures_026:'为一名干员提供10级训练，并装备坚守盟约。',
  BGS_Treasures_018:'按一名干员的双倍永久攻击目标沿原生成长曲线提高等级；达到原生等级上限后，不额外添加属性。',
  BGS_Treasures_019:'获得基础营养包，数量等于十份储备中尚未持有的份数。每份可为一名干员提供2级训练。',
  BGS_Treasures_034:'将一名未进阶干员撤回整备区，并提供4级训练。',
  BGS_Treasures_028:'为一名干员提供20级训练，并装备护盾发生器和速射扳机。速射扳机使每第8次普通攻击连射两次。',
  SCH_149:'获得奖品支援干员涤火杰西卡。获得时，沿其原生成长曲线训练至队伍的最高战备水平；达到原生等级上限后不额外添加属性。',
};
export function compileHistoricalPrizes(atlas,roguelikeArt={}) {
  return Object.fromEntries(atlas.cards.map(card => {
    const [name,effect] = WORDING[card.id] || [];
    if (!name || !effect) throw new Error('UNMAPPED_DARKMOON_PRIZE:' + card.id);
    const id = HISTORICAL_PRIZE_PREFIX + card.id;
    const rogueItemId=roguelikeArt.assignments?.[card.id] || ROGUELIKE_PRIZE_ART[card.id];
    const rogueItem=roguelikeArt.items?.[rogueItemId];
    return [id,{id,name:rogueItem?`${rogueItem.name} · ${name}`:name,workshopName:name,effect,normalEffect:card.id==='BGS_Treasures_018'?'为一名干员装备足够的攻击徽章，使其永久攻击面板至少翻倍。':card.id==='SCH_149'?'获得奖品支援干员涤火杰西卡。获得时，以攻击徽章和生命徽章补足至场上友方最高的永久攻击和生命面板。':effect,levelsEffect:LEVEL_WORDING[card.id] || effect,stage:['起步','成型','兑现','终极'][card.prizeTier-1],prizeTier:card.prizeTier,
      iconItemId:rogueItemId,historical:true,sourceVersion:atlas.version,mechanism:targets.has(card.id)?'darkmoonTargetPrize':'darkmoonPrize',params:{sourceId:card.id},
      sourceRefs:{cards:[{id:card.id,name:card.nameCN,nameEn:card.nameEN,text:card.textCN,textEn:card.textEN,
        attack:card.baseStats?.attack ?? null,health:card.baseStats?.health ?? null,tier:card.tavernTier ?? null,
        cardType:card.cardType,version:atlas.version,sourceUrl:atlas.sourceUrls.chineseUrl,
        ...(card.id==='SCH_149'?{goldenId:'TB_BaconUps_308',goldenAttack:2,goldenHealth:2,
          textElite:'战吼：获得攻击力和生命值，使其变为战场上最高数值的两倍。',goldenText:'战吼：获得攻击力和生命值，使其变为战场上最高数值的两倍。'}:{})}],
        roguelikeCollectible:rogueItem||null}}];
  }));
}
export function installHistoricalPrizeSupport(operators,equipment,prizes,roguelikeArt={}) {
  const rogueSource=(id)=>roguelikeArt.items?.[id]||null;
  const original = operators.chess_native_char_1034_jesca2_a;
  if (!original) throw new Error('MISSING_PRIZE_JESSICA_NATIVE_BODY');
  for (const [id,elite] of [[PRIZE_JESSICA_ID,false],[PRIZE_JESSICA_ELITE_ID,true]]) {
    const op = structuredClone(elite ? operators[original.eliteChessId] || original : original);
    const nativeId = elite ? original.eliteChessId : original.chessId;
    const raw = structuredClone(elite ? original.source.eliteChess || original.source.normalChess : original.source.normalChess);
    raw.chessId=id; raw.id=id; raw.baseId=nativeId; raw.darkmoonNativeChessId=id;
    op.chessId=id; op.baseChessId=PRIZE_JESSICA_ID; op.elite=elite; op.eliteChessId=elite?null:PRIZE_JESSICA_ELITE_ID;
    op.recruitable=false; op.mergable=false; op.prizeSupport=true; op.darkmoonSupport=true;
    op.source={...op.source,normalChess:raw,eliteChess:raw};
    op.sourceRefs={...structuredClone(prizes[HISTORICAL_PRIZE_PREFIX+'SCH_149'].sourceRefs),darkmoon19_2:{id:'SCH_149',name:'银色自大狂',nameEn:'Argent Braggart',version:'19.2.0.68600',battlecry:true}};
    const text='奖品支援。获得时，以攻击徽章和生命徽章补足至场上友方最高的永久攻击和生命面板。';
    op.nativeTrait={text,normalText:text,eliteText:text,sources:{normal:[],elite:[]},sourceRecords:[],effect:{prep:[],combat:[],unsupported:[]}};
    delete op.effectDelivery; delete op.permitGearId;
    operators[id]=op;
  }
  for (const [id,name,effect,params] of [
    ['darkmoon-gruul-training','持续训练装置','每回合整备结束时，为装备者装备2枚攻击徽章和2枚伤害徽章。',{effects:[]}],
    ['darkmoon-windfury-trigger','速射扳机','每第8次普通攻击连射两次。',{effects:[{trigger:'attack',behavior:'doubleStrike',params:{counterEvery:8}}]}],
  ]) equipment[id]={id,sourceId:id,canonicalId:id,uniqueKey:id,name,kind:'equipment',mechanism:'combatEquipment',params:{...params,equipmentLifetime:'unit',combatEffectScope:'wearer'},effect,normal:effect,normalLevels:id==='darkmoon-gruul-training'?'每回合整备结束时，为装备者提供4级训练。':effect,
    iconItemId:id==='darkmoon-gruul-training'?'rogue_2_relic_grace_5':'rogue_1_relic_a19',level:null,unique:id==='darkmoon-windfury-trigger',available:true,shopEligible:false,prizeOnly:true,sourcePrizeId:HISTORICAL_PRIZE_PREFIX+(id==='darkmoon-gruul-training'?'BGS_Treasures_009':'BGS_Treasures_028'),sourceRefs:{...structuredClone(prizes[HISTORICAL_PRIZE_PREFIX+(id==='darkmoon-gruul-training'?'BGS_Treasures_009':'BGS_Treasures_028')].sourceRefs),roguelikeCollectible:rogueSource(id==='darkmoon-gruul-training'?'rogue_2_relic_grace_5':'rogue_1_relic_a19')},inheritable:true};
  for (const [id,name,effect,iconItemId] of [
    ['prize-logistics-production','生产协作','本局干员产出的基础徽章数量加倍。','rogue_2_relic_grace_5'],
    ['prize-logistics-refresh','调度协作','本局每回合增加一次免费刷新。','rogue_1_recruit_ticket_all_discount'],
    ['prize-logistics-refund','采购协作','本局每购买一名商店干员，获得1枚金币。','rogue_1_gold'],
  ]) prizes[id]={id,name,effect,levelsEffect:id==='prize-logistics-production'?'本局干员产出的训练等级数量加倍。':effect,iconItemId,logisticsChoice:true,mechanism:'passive',sourceRefs:{roguelikeCollectible:rogueSource(iconItemId)}};
  const coin=HISTORICAL_PRIZE_PREFIX+'gold-coin';
  prizes[coin]={id:coin,name:'储备金币',iconItemId:'rogue_1_gold',effect:'获得1枚金币。',historicalSupply:true,mechanism:'darkmoonPrize',params:{sourceId:'gold-coin'},sourceRefs:{roguelikeCollectible:rogueSource('rogue_1_gold')}};
  const banana=HISTORICAL_PRIZE_PREFIX+'small-banana';
  prizes[banana]={id:banana,name:'基础营养包',levelsEffect:'为一名干员提供2级训练。',iconItemId:'rogue_2_relic_grace_1',effect:'为一名干员装备1枚攻击徽章和1枚伤害徽章。',historicalSupply:true,mechanism:'darkmoonTargetPrize',params:{sourceId:'small-banana'},sourceRefs:{roguelikeCollectible:rogueSource('rogue_2_relic_grace_1')}};
}
function random(state,rng=null) { if(rng)return rng(); let x=state.rngState>>>0||1;x^=x<<13;x^=x>>>17;x^=x<<5;state.rngState=x>>>0;return (x>>>0)/0x100000000; }
function shuffled(state,values,rng=null) { const out=[...values];for(let i=out.length-1;i>0;i--){const j=Math.floor(random(state,rng)*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out; }
function addCard(state,id,quantity=1) { state.inventory.push({uid:'i'+state.nextUid++,id,quantity,state:{}}); }
function chooseUnit(state,catalog,tier,source,ids=null,copy=false,rng=null) {
  const candidates=ids || Object.keys(state.pool||{}).filter(id=>state.pool[id].left>0 && state.pool[id].tier===tier && catalog.operators[id]?.recruitable!==false);
  const choices=shuffled(state,[...new Set(candidates)],rng).slice(0,3);
  if (!choices.length) throw new Error('NO_CANDIDATE');
  state.offers.push({id:'o'+state.nextUid++,type:'recruit',choices,tier,source,poolTaken:copy,poolCopies:copy?0:1,copyNativeOnly:copy});
}
function targetPiece(state,action) { const p=state.pieces.find(x=>x.uid===action.targetUid);if(!p)throw new Error('BAD_TARGET');return p; }
function grant(state,catalog,p,id,n=1,source='prize') {return grantEquipment(state,catalog,id,n,{origin:'prize',phase:'prize',prizeId:source,sourceUid:p.uid,targetUid:p.uid,landOn:'self'});}
function growthPair(state,catalog,p,n,health='damage',source='prize') { grant(state,catalog,p,'precision',n,source);grant(state,catalog,p,health,n,source); }
export function matchPermanentPrizeStats(state,catalog,p,target) {
  if(state.growthMode==='levels') {
    const max=operatorGrowthInfo({...p,growthMode:'levels'},catalog).maximum;
    for(let level=p.growthLevel||1;level<=max;level++) {
      p.growthMode='levels';p.growthLevel=level;
      const s=independentPermanentStats(p,catalog,state);
      if(s.atk>=target.atk && s.maxHp>=target.maxHp)break;
    }
    return;
  }
  for(const [field,id] of [['atk','precision'],['maxHp','vitality']]) {
    const current=independentPermanentStats(p,catalog,state)[field];if(current>=target[field])continue;
    const probe=structuredClone(p);probe.equipment.push({id,quantity:1});
    const step=independentPermanentStats(probe,catalog,state)[field]-current;
    if(step>0)grant(state,catalog,p,id,Math.ceil((target[field]-current)/step),'SCH_149');
  }
}
export function awardPrizeJessica(state,catalog,services) {
  const highest={atk:0,maxHp:0};
  for(const friend of state.pieces.filter(onBoard)) { const s=independentPermanentStats(friend,catalog,state);highest.atk=Math.max(highest.atk,s.atk);highest.maxHp=Math.max(highest.maxHp,s.maxHp); }
  const p=services.grantChess(state,PRIZE_JESSICA_ID,{poolTaken:true,poolCopies:0,noMerge:true,source:'darkmoon-prize:SCH_149'});
  if(!p)throw new Error('BENCH_FULL');
  matchPermanentPrizeStats(state,catalog,p,highest);
  return p;
}
export function chooseHistoricalPrize(state,catalog,id,services) {
  if(id===HISTORICAL_PRIZE_PREFIX+'SCH_149') { const p=awardPrizeJessica(state,catalog,services);return {prizeId:id,uid:p.uid}; }
  addCard(state,id);return {prizeId:id,itemId:id};
}
export function useHistoricalPrize(state,catalog,item,action,services,makePrizeOffer) {
  const prize=catalog.prizes[item.id];const key=prize?.params?.sourceId;const p=targets.has(key)||key==='small-banana'?targetPiece(state,action):null;
  const effect=(type,values={})=>state.playerEffects.push({type,source:item.id,...values});
  const shield=()=>grant(state,catalog,p,'independent:护盾发生器',1,item.id);
  switch(key) {
    case 'BGS_Treasures_000':growthPair(state,catalog,p,2);break;
    case 'small-banana':growthPair(state,catalog,p,1);break;
    case 'BGS_Treasures_001': addCard(state,HISTORICAL_PRIZE_PREFIX+'gold-coin',2);break;
    case 'gold-coin':state.funds++;break;
    case 'BGS_Treasures_004':chooseUnit(state,catalog,1,item.id,null,false,services?.rng);break;
    case 'BGS_Treasures_007':for(const f of state.pieces.filter(onBoard))growthPair(state,catalog,f,1);break;
    case 'BGS_Treasures_013':effect('darkmoonPrizeShopGrowth',{id:'damage',quantity:1});for(const s of state.shop.slots)if(!s.sold)s.equipment.push({id:'damage',quantity:1,origin:item.id});break;
    case 'BGS_Treasures_029':state.shop.freeRefreshes+=3;break;
    case 'BGS_Treasures_033':effect('darkmoonPrizeExtraSlot',{amount:1});expandHistoricalPrizeShop(state,catalog,services?.rng);break;
    case 'BGS_Treasures_006':for(const s of state.shop.slots){if(s.sold||s.kind!=='chess')continue;const tier=Math.min(6,(catalog.operators[s.id]?.tier||1)+1);const ids=Object.keys(state.pool).filter(id=>state.pool[id].tier===tier&&state.pool[id].left>0);if(ids.length){s.id=shuffled(state,ids,services?.rng)[0];s.elite=false;s.equipment=[];delete s.darkmoonGrowth;}}decorateHistoricalPrizeShop(state,catalog,state.shop.slots);break;
    case 'BGS_Treasures_009':grant(state,catalog,p,'darkmoon-gruul-training');break;
    case 'BGS_Treasures_010':{let ids=(state.previousRoundWarband||[]).map(x=>x.chessId).filter(id=>catalog.operators[id]&&!catalog.operators[id].prizeSupport);if(!ids.length)ids=Object.keys(state.pool).filter(id=>state.pool[id].left>0&&state.pool[id].tier<=state.shop.level);chooseUnit(state,catalog,null,item.id,ids,true,services?.rng);break;}
    case 'BGS_Treasures_012':chooseUnit(state,catalog,state.shop.level,item.id,null,false,services?.rng);break;
    case 'BGS_Treasures_014':if(item.state?.lastUsedRound===state.round)throw new Error('ALREADY_USED_THIS_ROUND');item.state={...item.state,lastUsedRound:state.round};state.funds++;return {keep:true};
    case 'BGS_Treasures_026':growthPair(state,catalog,p,5,'vitality');grant(state,catalog,p,'independent:坚守盟约');break;
    case 'BGS_Treasures_030':effect('darkmoonPrizeRepeatGain',{expiresRound:state.round,extra:1});break;
    case 'BGS_Treasures_036':effect('darkmoonPrizeUpgradeDiscount',{amount:2});break;
    case 'BGS_Treasures_011':state.offers.push({id:'o'+state.nextUid++,type:'logistics',choices:['prize-logistics-production','prize-logistics-refresh','prize-logistics-refund'],source:item.id});break;
    case 'BGS_Treasures_015':shield();break;
    case 'BGS_Treasures_018':{const s=independentPermanentStats(p,catalog,state);matchPermanentPrizeStats(state,catalog,p,{atk:s.atk*2,maxHp:s.maxHp});break;}
    case 'BGS_Treasures_019':{const id=HISTORICAL_PRIZE_PREFIX+'small-banana';const held=state.inventory.filter(x=>x.id===id).reduce((n,x)=>n+x.quantity,0);if(held<10)addCard(state,id,10-held);break;}
    case 'BGS_Treasures_020':chooseUnit(state,catalog,6,item.id,null,false,services?.rng);break;
    case 'BGS_Treasures_034':if(p.elite)throw new Error('BAD_TARGET');withdrawPrizeTarget(state,p);growthPair(state,catalog,p,2);break;
    case 'BGS_Treasures_037':{const candidates=state.shop.slots.filter(s=>!s.sold&&!s.elite&&catalog.operators[s.id]?.eliteChessId);if(!candidates.length)throw new Error('NO_CANDIDATE');const slot=shuffled(state,candidates,services?.rng)[0];slot.elite=true;break;}
    case 'TB_Bacon_Secrets_12':if(state.playerEffects.some(x=>x.type==='darkmoonPrizeIceBlock'))throw new Error('SECRET_ALREADY_ACTIVE');effect('darkmoonPrizeIceBlock',{charges:1});break;
    case 'BGS_Treasures_016':if(p.elite||!catalog.operators[p.chessId]?.eliteChessId)throw new Error('BAD_TARGET');withdrawPrizeTarget(state,p);p.chessId=catalog.operators[p.chessId].eliteChessId;p.elite=true;break;
    case 'BGS_Treasures_022':effect('darkmoonPrizeBuyDiscount',{amount:1});for(const slot of state.shop.slots)if(slot.kind==='chess')slot.price=Math.max(0,slot.price-1);break;
    case 'BGS_Treasures_023':effect('darkmoonPrizeOpenBar',{count:5});state.shop.freeRefreshes+=5;break;
    case 'BGS_Treasures_025':state.funds=Math.max(state.funds,state.incomeThisRound);break;
    case 'BGS_Treasures_028':shield();grant(state,catalog,p,'darkmoon-windfury-trigger');growthPair(state,catalog,p,10,'vitality');break;
    case 'BGS_Treasures_032':for(const stage of ['start','build','cashout'])makePrizeOffer(state,catalog,stage,'big-winner',services?.rng);break;
    default:throw new Error('UNSUPPORTED_HISTORICAL_PRIZE');
  }
  return {keep:false};
}
function withdrawPrizeTarget(state,p) {
  if(onBoard(p) && state.pieces.filter(x=>!onBoard(x)&&!x.temp).length+(state.summons||[]).filter(x=>!onBoard(x)&&!x.temp).length>=10)throw new Error('BENCH_FULL');
  p.row=null;p.col=null;state.summons=(state.summons||[]).filter(x=>x.ownerUid!==p.uid);
}
export function choosePrizeLogistics(state,id) {
  const types={'prize-logistics-production':'darkmoonPrizeProductionBoost','prize-logistics-refresh':'darkmoonPrizeLogisticsRefresh','prize-logistics-refund':'darkmoonPrizeRecruitRefund'};
  if(!types[id])throw new Error('BAD_CHOICE');state.playerEffects.push({type:types[id],source:id,amount:1});
  if(id==='prize-logistics-refresh')state.shop.freeRefreshes++;
}
export function expandHistoricalPrizeShop(state,catalog,rng=null) {
  const choices=Object.keys(state.pool).filter(id=>state.pool[id].left>0&&state.pool[id].tier<=state.shop.level);
  if(!choices.length)return;
  const id=shuffled(state,choices,rng)[0];const slot={kind:'chess',id,elite:false,price:3,sold:false,equipment:[]};
  decorateHistoricalPrizeShop(state,catalog,[slot]);state.shop.slots.push(slot);
}
export function decorateHistoricalPrizeShop(state,catalog,slots) {
  const discount=state.playerEffects.filter(x=>x.type==='darkmoonPrizeBuyDiscount').reduce((n,x)=>n+x.amount,0);
  for(const slot of slots) {
    slot.price=Math.max(0,3-discount);
    for(const fx of state.playerEffects.filter(x=>x.type==='darkmoonPrizeShopGrowth'))if(!slot.equipment.some(e=>e.origin===fx.source))slot.equipment.push({id:fx.id,quantity:fx.quantity,origin:fx.source});
  }
  return slots;
}
export function historicalPrizePrepEnd(state,catalog) {
  for(const p of state.pieces.filter(onBoard))for(const e of p.equipment.filter(x=>x.id==='darkmoon-gruul-training'))growthPair(state,catalog,p,2*(e.quantity||1));
  state.shop.upgradePrice=Math.max(0,state.shop.upgradePrice-state.playerEffects.filter(x=>x.type==='darkmoonPrizeUpgradeDiscount').reduce((n,x)=>n+x.amount,0));
}
export function historicalPrizeNextRound(state) {
  state.playerEffects=state.playerEffects.filter(x=>x.type!=='darkmoonPrizeRepeatGain'||x.expiresRound>=state.round);
  state.shop.freeRefreshes+=state.playerEffects.filter(x=>['darkmoonPrizeOpenBar','darkmoonPrizeLogisticsRefresh'].includes(x.type)).reduce((n,x)=>n+(x.count||x.amount),0);
}
export function historicalPrizePreventFatalDamage(state,damage) {
  if(damage<state.lp)return damage;
  const secret=state.playerEffects.find(x=>x.type==='darkmoonPrizeIceBlock'&&x.charges>0);
  if(!secret)return damage;
  secret.charges--;state.playerEffects=state.playerEffects.filter(x=>x!==secret);return 0;
}
