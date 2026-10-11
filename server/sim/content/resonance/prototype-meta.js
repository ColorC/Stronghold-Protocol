import { prototypeSeasonForCatalog } from '../../../../shared/resonance/season-registry.js';
import { prototypeFormForRow } from '../../../../shared/resonance/prototype-form.js';
import { prototypeLabCells } from '../../../../shared/resonance/prototype-labs.js';
import { mechanicByTrait } from './prototype-pacts.js';
import { onPrototypeEconomyPrep, onPrototypeEconomyResult } from './prototype-economy.js';

const clone = (value) => structuredClone(value);
function rosterOf(state,catalog) {
  const candidates = state?.player?.input?.units ?? state?.input?.units ?? state?.units ?? state?.board?.units ?? state?.field?.units ?? state?.pieces ?? [];
  const inventoryByUid=new Map([...(state?.inventory??[]),...(state?.items??[]),...(state?.player?.input?.items??[])]
    .filter((item)=>item&&typeof item==='object').map((item)=>[String(item.uid??item.inventoryUid??item.inventoryUID??item.itemUid??item.itemId??''),item]));
  return candidates.filter((unit)=>unit && unit.kind!=='token' && unit.kind!=='summon').map((unit)=>{
    if ((Object.hasOwn(unit,'row') || Object.hasOwn(unit,'col')) && (unit.row == null || unit.col == null)) return null;
    const operator=catalog?.operators?.[unit.operatorId]??catalog?.operators?.[unit.sourceChessId]??catalog?.operators?.[unit.defId];
    const charId=unit.charId??operator?.charId??unit.def?.raw?.charId;
    if(!charId)return null;
    const equipmentTraits=[...(unit.equipment??[]),...(unit.items??[])].flatMap((equipped)=>{
      const itemUid=typeof equipped==='object'&&(equipped.uid??equipped.itemUid??equipped.inventoryUid??equipped.inventoryUID);
      const fromInventory=itemUid==null?null:inventoryByUid.get(String(itemUid));
      const itemId=typeof equipped==='string'
        ?(catalog?.equipment?.[equipped]?equipped:(inventoryByUid.get(equipped)?.itemId??inventoryByUid.get(equipped)?.defId))
        :(equipped?.itemId??equipped?.defId??equipped?.itemDefId??equipped?.equipmentId??equipped?.id??fromInventory?.itemId??fromInventory?.defId??fromInventory?.itemDefId??fromInventory?.id);
      const item=catalog?.equipment?.[itemId];
      return (item?.effects??[]).filter((effect)=>['transfer_pact','pact_transfer'].includes(effect.kind)).map((effect)=>effect.params?.pactId).filter(Boolean);
    });
    return {...unit,charId,extraPacts:[...(unit.extraPacts??[]),...equipmentTraits]};
  }).filter(Boolean);
}
function extraTraits(unit) {
  return [...new Set([...(unit.extraPacts??[]),...(unit.mem?.resonancePacts??[]),...(unit.pacts??[])])];
}
function tierAtCount(trait,count) {
  return trait.effects.filter((tier)=>tier.minUnits<=count && count<=tier.maxUnits)
    .sort((a,b)=>a.minUnits-b.minUnits).at(-1)??null;
}
export function activePrototypeTraits(state,catalog={}) {
  const season = prototypeSeasonForCatalog(catalog);
  const traits = season.traits;
  const roster = rosterOf(state,catalog);
  const activeTraits=[];
  for (const trait of traits) {
    const memberUnits=roster.filter((unit)=>trait.members.includes(unit.charId)||extraTraits(unit).includes(trait.id));
    const memberCharIds=[...new Set(memberUnits.map((unit)=>unit.charId))];
    const tier=tierAtCount(trait,memberCharIds.length);
    if (!tier) continue;
    // Season 2 replaces the laboratory mechanism: its 萨尔贡 tier carries no laboratory cells.
    const laboratory=trait.id==='experiment'&&!trait.strongholdPact;
    activeTraits.push({id:trait.id,count:memberCharIds.length,tier:tier.minUnits,minUnits:tier.minUnits,maxUnits:tier.maxUnits,variables:clone(tier.variables),mechanic:trait.mechanic??mechanicByTrait[trait.sourceName],members:memberCharIds,memberUids:[...new Set(memberUnits.map((unit)=>unit.uid).filter((uid)=>uid!=null).map(String))],...(laboratory?{labCells:clone(state?.prototypeMeta?.labCells??[])}:{})});
  }
  return activeTraits;
}

export function prototypeFormModes(state,catalog={}) {
  const season=prototypeSeasonForCatalog(catalog);
  const trait=season.traits.find((entry)=>entry.id==='formSwap');
  const members=new Set(trait?.members??[]);
  const rect=state?.fieldRect??state?.battlefield?.rect??catalog?.prototypeMeta?.fieldRect??{r0:9,r1:12};
  const pieces=state?.pieces??state?.input?.units??state?.units??[];
  return pieces.flatMap((piece)=>{
    if(!piece||piece.row==null||piece.col==null)return [];
    const operator=catalog?.operators?.[piece.operatorId]??catalog?.operators?.[piece.sourceChessId]??catalog?.operators?.[piece.defId];
    const charId=piece.charId??operator?.charId??piece.def?.raw?.charId;
    if(!members.has(charId))return [];
    const mode=prototypeFormForRow(piece.row,rect);
    if(!mode)return [];
    return [{uid:String(piece.uid??''),charId,row:Number(piece.row),mode,skillId:operator?.fixedSkillId??null,
      label:mode==='frontline'?'前排形态':'后排形态',nativeSkillKept:true,
      skillRangeExtension:mode==='backline'?Number(season.formSwapAdaptation?.backlineSkillRangeExtension??1):0}];
  });
}

/** Pure prep hook: install a serializable active-tier snapshot for the battle adapter. */
export function onPrototypePrep(state,catalog={},context={}) {
  const next=clone(state);
  const season=prototypeSeasonForCatalog(catalog);
  const activeTraits=activePrototypeTraits(next,catalog);
  const experiment=activeTraits.find((trait)=>trait.id==='experiment'&&Array.isArray(trait.labCells));
  const labCells=experiment?prototypeLabCells({
    stageId:context.stageId??next.stageId??next.seasonId??catalog.config?.seasonId??season.id,
    seed:next.seed??0,
    deployCells:context.deployCells??[],
    count:experiment.variables?.NumLaboratory??0,
  }):[];
  next.prototypeMeta={...(next.prototypeMeta??{}),seasonId:season.id,rulesVersion:3,activeTraits,formModes:prototypeFormModes(next,catalog),labCells};
  const economy=onPrototypeEconomyPrep(next,catalog,activeTraits);
  return {state:economy.state,activeTraits,events:economy.events??[],choiceDrafts:economy.choiceDrafts??[]};
}

/** Pure result hook: retain source-backed active tiers and measured combat contribution. */
export function onPrototypeBattleResult(state,catalog={},result={}) {
  const next=clone(state);
  const season=prototypeSeasonForCatalog(catalog);
  const activeTraits=activePrototypeTraits(next,catalog);
  const contribution={};
  for (const unit of result?.contributions??[]) {
    if (!unit?.charId) continue;
    const row={};
    for(const [target,source] of [['damage','damage'],['healing','healing'],['blocked','blocked'],['controlMs','controlMs'],['summonDamage','summonDamage'],['kills','kills'],['deaths','deaths'],['skills','skills'],['survived','survived']]){
      if(!Object.hasOwn(unit,source))continue;
      if(target==='survived'&&typeof unit[source]==='boolean')row[target]=unit[source];
      else if(Number.isFinite(Number(unit[source])))row[target]=Number(unit[source]);
    }
    contribution[unit.charId]=row;
  }
  next.prototypeMeta={...(next.prototypeMeta??{}),seasonId:season.id,rulesVersion:3,activeTraits,lastBattle:{
    battleId:result?.battleId??null,battleRound:result?.battleRound??result?.outcome?.round??null,
    outcome:result?.outcome??null,metrics:clone(result?.metrics??{}),contribution,survivors:clone(result?.survivors??[]),
    uidMap:clone(result?.uidMap??null),
  }};
  const economy=onPrototypeEconomyResult(next,catalog,activeTraits,result);
  return {state:economy.state,activeTraits,contribution,rewards:[],events:economy.events??[],choiceDrafts:economy.choiceDrafts??[]};
}

export { mechanicByTrait } from './prototype-pacts.js';
