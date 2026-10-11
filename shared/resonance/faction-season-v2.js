import {factionSeason} from './faction-season.js';
import {STRONGHOLD_PACT_TIERS,STRONGHOLD_PACT_TUNING,STRONGHOLD_PACT_IDS,STRONGHOLD_RETIRED_ECONOMY_TRAITS,
  STRONGHOLD_RETIRED_AUGMENTS,STRONGHOLD_REWARD_ITEM_SUBSTITUTIONS,STRONGHOLD_STRATEGY_OVERRIDES} from './stronghold-pacts.js';

const clone=value=>structuredClone(value);
const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const retiredAugments=new Set(STRONGHOLD_RETIRED_AUGMENTS);
const corrected=row=>{
  const fix=STRONGHOLD_STRATEGY_OVERRIDES[row.apiName];
  if(!fix)return row;
  const effects={...clone(row.effects??{}),...clone(fix.variables??{})};
  return {...clone(row),effects,...(fix.adaptation?{adaptation:fix.adaptation(effects)}:{})};
};

// Same heroes, members, thresholds, fees and emblems as faction season 1; only tier effects change.
const traits=factionSeason.traits.map(trait=>{
  const redesign=STRONGHOLD_PACT_TIERS[trait.id];
  if(redesign){
    return {...clone(trait),mechanic:redesign.mechanic,strongholdPact:true,
      effects:trait.effects.map(tier=>{
        const variables=redesign.tiers[tier.minUnits];
        requireValue(variables,`STRONGHOLD_PACT_TIER_MISSING:${trait.id}:${tier.minUnits}`);
        return {minUnits:tier.minUnits,maxUnits:tier.maxUnits,style:tier.style,variables:clone(variables),sourceVariables:clone(variables)};
      }),
      designReference:{...clone(trait.designReference),rule:'faction season 2 keeps the season-1 members, tiers and fees; tier effects are the non-stacking pact redesign'},
    };
  }
  const tuning=STRONGHOLD_PACT_TUNING[trait.id];
  if(!tuning)return clone(trait);
  for(const minUnits of Object.keys(tuning))requireValue(trait.effects.some(tier=>tier.minUnits===Number(minUnits)),`STRONGHOLD_PACT_TUNING_TIER:${trait.id}:${minUnits}`);
  return {...clone(trait),effects:trait.effects.map(tier=>({...clone(tier),variables:{...clone(tier.variables),...clone(tuning[tier.minUnits]??{})}}))};
});
requireValue(STRONGHOLD_PACT_IDS.every(id=>traits.some(trait=>trait.id===id&&trait.strongholdPact)),'STRONGHOLD_PACT_UNKNOWN_TRAIT');

export const factionSeasonV2=Object.freeze({...factionSeason,
  id:'resonance-factions-2',
  traits,
  strongholdPacts:Object.freeze([...STRONGHOLD_PACT_IDS]),
  retiredEconomyTraits:Object.freeze([...STRONGHOLD_RETIRED_ECONOMY_TRAITS]),
  rewardItemSubstitutions:Object.freeze({...STRONGHOLD_REWARD_ITEM_SUBSTITUTIONS}),
  augmentCandidates:factionSeason.augmentCandidates.filter(row=>!retiredAugments.has(row.apiName)).map(corrected),
  strategyCandidates:factionSeason.strategyCandidates.filter(row=>!retiredAugments.has(row.apiName)).map(corrected),
  source:{...factionSeason.source,pactDesign:'Faction season 2: members and activation tiers of faction season 1; non-stacking Stronghold Protocol pact effects (shared/resonance/stronghold-pacts.js).'},
});
