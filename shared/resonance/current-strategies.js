// Current-season strategy overlay. The imported raw legacy catalogue remains unchanged.
export const CURRENT_STRATEGY_VERSION = 2;
export const DISABLED_CURRENT_STRATEGY_IDS = Object.freeze(['strategy_15','strategy_16','strategy_23','strategy_24','strategy_27','strategy_28','strategy_29','strategy_30']);
const patchUrl='https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-4/';
const supplementUrl='https://tftraits.com/api/display/items?v=18-18.4.0.BF63CD5E.u09ac2d13s5&lang=en-us';
const refs = {
  patientStudy: { game:'Teamfight Tactics', version:'TFTraits 18.4 publication / 18-18.4.0.BF63CD5E.u09ac2d13s5', sourceKind:'community game-data derivative publication; current official legality unconfirmed', recordId:'DA_PatientStudy', jsonPointer:'/supplement/publishedAugmentItems/176', sourceUrl:supplementUrl, patchUrl, effects:{ XPBonusWin:2, XPBonusLose:3 } },
  tradeSector: { game:'Teamfight Tactics', version:'TFTraits 18.4 publication / 18-18.4.0.BF63CD5E.u09ac2d13s5', sourceKind:'community game-data derivative publication; current official legality unconfirmed', recordId:'DA_TradeSector', jsonPointer:'/supplement/publishedAugmentItems/235', sourceUrl:supplementUrl, patchUrl, effects:{ NumGold:2, NumFreeShopRerolls:1 } },
  standUnited: { game:'Teamfight Tactics', version:'TFTraits 18.4 publication / 18-18.4.0.BF63CD5E.u09ac2d13s5', sourceKind:'community game-data derivative publication; current official legality unconfirmed', recordId:'DA_StandUnited', jsonPointer:'/supplement/publishedAugmentItems/217', sourceUrl:supplementUrl, patchUrl, effects:{ AttackDamagePercentagePerTrait:0.015, AbilityPowerPerTrait:0.015 } },
  teamBuilding: { game:'Teamfight Tactics', version:'TFTraits 18.4 publication / 18-18.4.0.BF63CD5E.u09ac2d13s5', sourceKind:'community game-data derivative publication; current official legality unconfirmed', recordId:'DA_TeamBuilding', jsonPointer:'/supplement/publishedAugmentItems/226', sourceUrl:supplementUrl, patchUrl, effects:{ PlayerRounds:5 } },
  wovenMagic: { game:'Teamfight Tactics', version:'TFTraits 18.4 publication / 18-18.4.0.BF63CD5E.u09ac2d13s5', sourceKind:'community game-data derivative publication; current official legality unconfirmed', recordId:'DA_WovenMagic', jsonPointer:'/supplement/publishedAugmentItems/255', sourceUrl:supplementUrl, patchUrl, effects:{ ManaPerComponent:2200 } },
  componentBuffet: { game:'Teamfight Tactics', version:'TFTraits 18.4 publication / 18-18.4.0.BF63CD5E.u09ac2d13s5', sourceKind:'community game-data derivative publication; current official legality unconfirmed', recordId:'DA_ComponentBuffet', jsonPointer:'/supplement/publishedAugmentItems/58', sourceUrl:supplementUrl, patchUrl, effects:{ NumberOfInitialComponentsToGrant:1, options:4 } },
  tomeOfTraits: { game:'Teamfight Tactics', version:'Set 11 / patch 11.15', recordId:'Tome of Traits', sourceUrl:'https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-11-15-notes/', effects:{ viableChoices:4, select:1 } },
};
const set = (id,name,description,kind,ref,params={}) => ({ id,name,group:'rule',description,timing:'run-or-node',condition:{kind:'always'},mutuallyExclusive:[],unique:true,effects:[{kind,params,reference:refs[ref]}],invalidFallback:{kind:'gold',params:{amount:6}} });
export function applyCurrentStrategies(catalog) {
  const strategies={...catalog.strategies};
  for(const id of DISABLED_CURRENT_STRATEGY_IDS) delete strategies[id];
  strategies.strategy_13=set('strategy_13','组队规划','立即获得一张低费复制凭证；完成5场战斗后再获得一张','team_building','teamBuilding',{battleCount:5});
  strategies.strategy_14={...set('strategy_14','弹匣挑战','立即获得一件随机组件；队伍累计消耗60发弹药后，从4件组件中选择一件，仅奖励一次','woven_magic','wovenMagic',{ammoThreshold:60,optionCount:4}),effects:[{kind:'woven_magic',params:{ammoThreshold:60,optionCount:4},reference:refs.wovenMagic,candidateReference:refs.componentBuffet}]};
  strategies.strategy_20=set('strategy_20','耐心进修','战斗结算后：胜利获得2经验，失败获得3经验；后勤节点不触发','patient_study','patientStudy',{winXp:2,lossXp:3});
  strategies.strategy_21=set('strategy_21','例行招募','立即获得2金币；每个节点有1次免费商店刷新，不累积；保留开局免费刷新余额','trade_sector','tradeSector',{gold:2,freeRefreshesPerNode:1});
  strategies.strategy_22=set('strategy_22','团结之力','每种已激活的非独特盟约，使所有干员攻击提高1.5%','stand_united','standUnited',{attackPercentPerPact:1.5,excludedPacts:['holyGun','yela','crown']});
  strategies.strategy_33={...strategies.strategy_33,description:'弹药技能消耗最后一发时，对目标造成150%攻击力物理伤害',effects:[{kind:'lastAmmo',params:{damage:150,sp:0}}]};
  strategies.strategy_25={...strategies.strategy_25,name:'盟约密约',description:'从当前可成型且合法的盟约转职中抽取至多4项，选择1项',effects:[{kind:'choose_viable_transfer',params:{candidateCount:4},reference:refs.tomeOfTraits}]};
  strategies.strategy_26={...strategies.strategy_26,description:'指定干员获得另一机制盟约；不生成额外棋子，每盟约仅计该身份一次',effects:[{kind:'dual_pact',params:{extraTag:true}}]};
  return {...catalog,strategies};
}
