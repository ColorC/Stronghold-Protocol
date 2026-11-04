// Growth is a build identity, not a compulsory extra line on every operator.
// These cards trade on a particular resource/condition; other cards retain their
// original attacks, control, healing, stances and deployment effects.
export const GROWTH_IDENTITIES=Object.freeze({
  char_4145_ulpia:'blood-hp',
  char_1033_swire2:'deployment-spending',
  char_4048_doroth:'devices',
  char_1032_excu2:'ammo-capacity',
  char_4010_etlchi:'marked-blood',
  char_4117_ray:'scout-hunts',
  char_2024_chyue:'levitation',
  char_1039_thorn2:'alchemy-zone',
  char_4016_kazema:'paper-explosions',
  char_469_indigo:'bound-hunts',
  char_4196_reckpr:'spell-healing',
  char_249_mlyss:'rhine-manifold',
});

export function growthAllowed(body) {return Object.hasOwn(GROWTH_IDENTITIES,body?.charId);}

// P4.6: authored outside-battle progression, fixed across stars. Store integer
// steps so caps and merge inheritance never depend on floating-point sums.
export const RUN_CARD_GROWTH=Object.freeze({
  char_2015_dusk:{event:'battleEnd',stat:'atk',points:2,steps:10,line:'每胜场本局攻击+2%，至多20%。'},
  char_2023_ling:{event:'buy',stat:'atk',points:2,steps:10,line:'购白铁线召唤干员，攻击+2%，本局限20%。'},
  char_4065_judge:{event:'battleEnd',stat:'openingBarrier',points:5,steps:6,line:'胜利后开场屏障+5%生命，本局限+30%。'},
  char_311_mudrok:{event:'dayStarted',stat:'shieldHeal',points:2,steps:5,line:'每天破盾治疗+2%生命，本局限+10%。'},
});
export function runGrowthSteps(piece,id=piece?.charId){
  const rule=RUN_CARD_GROWTH[id];if(!rule)return 0;
  const steps=piece?.runGrowth?.[id]??0;
  if(!Number.isInteger(steps)||steps<0||steps>rule.steps)throw new TypeError('Invalid card run-growth steps');
  return steps;
}
export function runGrowthPoints(piece,id=piece?.charId){return runGrowthSteps(piece,id)*(RUN_CARD_GROWTH[id]?.points??0);}

export function lifetimeText(text) {
  if(typeof text!=='string')return text;
  return text.replace(/不永久累加/g,'不叠加').replace(/不永久降/g,'不降').replace(/本局内永久[，,]?\s*(?:没有上限|无上限)?/g,'本局游戏内')
    .replace(/本局永久/g,'本局游戏内').replace(/永久/g,text.includes('本局')?'本局游戏内':text.includes('本场')?'':'本局游戏内')
    .replace(/本场战斗[，,]?\s*不封顶/g,'本场战斗内').replace(/本场战斗，不封顶/g,'本场战斗内')
    .replace(/本局游戏内[，,]?(?:没有上限|无上限)/g,'本局游戏内')
    .replace(/[，,]\s*(?:不封顶|没有上限)/g,'').replaceAll('本场战斗中','本场战斗内').replace(/本场战斗(?!内)/g,'本场战斗内');
}
