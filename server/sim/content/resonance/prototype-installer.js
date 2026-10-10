import { activePrototypeTraits } from './prototype-meta.js';
import { installPrototypePacts, preparePrototypeScrapGear } from './prototype-pacts.js';
import { installPrototypeBattleAugments } from './prototype-strategies.js';
import { installPrototypeSignatures } from './prototype-signatures.js';
import { installPrototypeEconomy } from './prototype-economy.js';
import { installPrototypeGearActions } from './prototype-gear.js';
import { installPrototypeSourceGear } from './prototype-source-gear.js';

const installedBattles=new WeakMap();
export function prototypePveWinCount(state) {
  return Math.min(7,(state?.history??[]).filter((row)=>row?.type==='fight-settled'&&row.won===true).length);
}
/** Install source-backed V3 battle content once for either direct or Runner-created Battles. */
export function installPrototypeBattleContent(battle,state,catalog) {
  if(catalog?.prototypeMeta?.rulesVersion!==3)return null;
  if(installedBattles.has(battle))return installedBattles.get(battle);
  const activeTraits=activePrototypeTraits(state,catalog).map((trait)=>trait.id==='emissary'?{
    ...trait,
    pveWins:prototypePveWinCount(state),
  }:trait);
  const specialUids=new Set((state?.specialEntities??[]).filter((entity)=>Number.isInteger(entity.row)&&Number.isInteger(entity.col)).map((entity)=>String(entity.uid)));
  for(const unit of battle.allyUnits??[])if(unit?.kind==='token'&&specialUids.has(String(unit.uid)))
    battle.addBuff(unit,{key:'resonance:training-dummy-duty',persist:true,flags:{noMove:true,disarm:true}});
  preparePrototypeScrapGear(battle,state,catalog,activeTraits);
  installPrototypeSourceGear(battle,state,catalog,activeTraits);
  installPrototypePacts(battle,catalog,activeTraits);
  installPrototypeBattleAugments(battle,state,catalog);
  installPrototypeSignatures(battle,state,catalog);
  installPrototypeEconomy(battle,state,catalog);
  installPrototypeGearActions(battle,state,catalog);
  installedBattles.set(battle,activeTraits);
  return activeTraits;
}
