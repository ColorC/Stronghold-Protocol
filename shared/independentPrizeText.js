/** Project only player text; rules and original reference cards remain unchanged. */
export function independentGrowthCatalog(catalog, mode='badges') {
  if(mode!=='levels')return catalog;
  const prizes=Object.fromEntries(Object.entries(catalog.prizes||{}).map(([id,p])=>[id,{...p,effect:p.levelsEffect||p.effect}]));
  const gear=Object.fromEntries(Object.entries(catalog.gear||{}).map(([id,g])=>[id,{...g,normal:g.normalLevels||g.normal}]));
  const operators=Object.fromEntries(Object.entries(catalog.operators||{}).map(([id,o])=>{
    if(o.sourceRefs?.cards?.[0]?.id!=='SCH_149')return [id,o];
    const text=prizes['darkmoon-prize:SCH_149']?.effect||o.nativeTrait;
    return [id,{...o,nativeTrait:text,traitTexts:{...o.traitTexts,normal:text,elite:text,normalLevels:text,eliteLevels:text}}];
  }));
  return {...catalog,prizes,gear,operators};
}
