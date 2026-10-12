/** Native PvE budgets: HP, flat physical defense, percentage RES and native BAT.
 * Source TFT armor ratings are retained as reference metadata, never used as
 * the flat defense against Arknights enemies. Role budgets are subsequently
 * checked with the actual fixed native skill, talent, summon and attack kit.
 */
export const nativePowerBudget = Object.freeze({
  hp:[1900,2300,2850,3600,4700],
  dps:[270,345,440,585,790],
  defense:[480,540,620,720,850],
  stars:{ hp:[1,1.8,3.24], atk:[1,1.8,3.24] },
  roles:{
    frontline:{hp:1.25,dps:0.76,def:1},
    damage:{hp:0.82,dps:1,def:0.42},
    control:{hp:0.84,dps:0.82,def:0.4},
    healer:{hp:0.8,dps:0.52,def:0.32},
    summoner:{hp:0.85,dps:0.65,def:0.4},
    support:{hp:0.85,dps:0.55,def:0.4},
  },
});

/** Faction season 2 budgets physical output after a reference flat DEF. A physical operator's ATK is
 * budget × BAT × star + 150, so against 150 DEF it deals exactly its budget, and the cost and star
 * ratios of the budget hold against armoured enemies too. With the season-1 rule the budget only held
 * at 0 DEF: 1★ cost 1–2 physical operators (mostly 190–390 ATK) hit the 300–400 DEF regular enemies of the
 * harder waves for the 5% minimum. Arts and healing ATK are unchanged; season-1 saves keep their budget.
 */
export const nativePowerBudgetV2 = Object.freeze({...nativePowerBudget, physicalDefenseReference:150});

function baseStats(original,hero,season){
  const budget=season.nativePowerBudget??nativePowerBudget;
  const cost=Number(hero.cost), index=cost-1;
  if(!Number.isInteger(cost)||cost<1||cost>5)throw new Error(`NATIVE_POWER_BAD_COST:${hero.sourceChessId}`);
  const native=original.source.normalChess.stats;
  const role=budget.roles[hero.role];
  if(!role)throw new Error(`NATIVE_POWER_BAD_ROLE:${hero.role}`);
  const bat=Number(native.bat);
  if(!(bat>0&&Number.isFinite(bat)))throw new Error(`NATIVE_POWER_BAD_BAT:${hero.sourceChessId}`);
  const melee=original.position==='MELEE';
  const frontline=hero.role==='frontline';
  const hpRole=melee&&!frontline?Math.max(role.hp,1.05):role.hp;
  const defRole=melee&&!frontline?Math.max(role.def,0.68):role.def;
  const scale=hero.nativeKitBudget??{};
  return {...native,
    maxHp:Math.round(budget.hp[index]*hpRole*(scale.hp??1)),
    atk:Math.round(budget.dps[index]*role.dps*bat*(scale.atk??1)),
    def:Math.round(budget.defense[index]*defRole*(scale.def??1)),
    res:Number(native.res??0),bat,
  };
}

export function buildNativePowerStars(original,hero,season){
  const base=baseStats(original,hero,season),budget=season.nativePowerBudget??nativePowerBudget;
  const reference=original.source.normalChess.dmgType==='phys'?Number(budget.physicalDefenseReference??0):0;
  const stars={};
  for(const star of [1,2,3]){
    const previous=original.stars[star];
    const stats={...base,maxHp:Math.round(base.maxHp*budget.stars.hp[star-1]),atk:Math.round(base.atk*budget.stars.atk[star-1])+reference};
    const record=structuredClone(previous.record);
    record.tier=hero.cost;record.resonanceStar=star;record.stats={...record.stats,...stats};
    // Original web garrisons consume abolished bond layers. Native class traits,
    // talents and the fixed skill remain, and are separately audited in battle.
    record.garrisonIds=[];record.bonds=[];
    stars[star]={...structuredClone(previous),stats,normalized:{...stats},record};
  }
  return stars;
}

export function buildNativePowerReference(original,hero,season){
  const stats=baseStats(original,hero,season);
  const source=hero.powerReference??{};
  const armor=Number(source.armor??30);
  // Keep the source rating's relative marginal benefit while anchoring it to
  // the actual native flat defense. This is a defense anchor, not the unit's AD.
  const defenseAnchor=armor>0?stats.def*(100+armor)/armor:stats.def+600;
  const magicResist=stats.res>=0&&stats.res<100?100*stats.res/(100-stats.res):0;
  return {...source,armor,magicResist,attackDamage:defenseAnchor,
    nativeDefenseAnchor:defenseAnchor,nativeBaseDefense:stats.def,
    sourceAttackDamage:source.attackDamage,sourceMagicResist:source.magicResist,
    basis:'native-pve-flat-defense',
  };
}
