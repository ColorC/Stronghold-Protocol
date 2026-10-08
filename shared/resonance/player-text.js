const pct = (n) => `${n}%`;
const nfmt = (n) => Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));

function statText(p) {
  const names = { maxHp: '生命上限', atk: '攻击力', def: '防御力', res: '法术抗性', aspd: '攻速', artsDamage: '法术伤害' };
  return `${names[p.stat] ?? '属性'}${p.mode === 'percent' ? '+' : '+'}${nfmt(p.value)}${p.mode === 'percent' ? '%' : ''}`;
}

function pactEffectText(e) {
  const p=e.params??{};
  switch(e.kind) {
    case 'stat': return statText(p);
    case 'aegir_cycle': return `每秒恢复最大生命${p.regen}%；生命上限转攻击${p.atkFromHp}%；受敌人有效攻击后，对${p.retaliationRadius}格内地面和空中敌人造成最大生命${p.retaliation}%法术伤害，个人冷却${p.cd}秒${p.block?`，阻挡数+${p.block}`:''}。`;
    case 'laterano_ammo': return `技能获得${p.skillAmmo}枚弹药。每消耗${p.ammoSpend}枚弹药，全体成员下一击追加自身攻击力${p.bonus}%物理伤害。${p.droneAt?`${p.droneAt}人时无人机每${p.droneInterval}秒发射${p.droneShots}发、每发造成最高成员攻击力${p.droneDamage}%的${p.antiAir?'对空':''}伤害。`:''}`;
    case 'kjerag_frost': return `自然技力每秒+${p.sp}；每${p.attackEvery}次攻击施加${p.coldDuration}秒寒冷，已有寒冷时冻结。冻结使其他成员下一击追加${p.frozenHit}%攻击力法术伤害，同一目标冷却${p.frozenTargetCooldown}秒。${p.snowAt?`${p.snowAt}人时行走格铺雪，每格冷却${p.snowTileCooldown}秒，触发${p.coldFromSnow}秒寒冷。`:''}`;
    case 'yan_combo': return `成员施法使其他成员恢复${p.teamSp}技力，个人冷却${p.receiverCooldown}秒；每${p.comboEvery}次全队施法，各成员分别对最近目标造成${p.comboDamage}%攻击力法术伤害。${p.formationAt?`${p.formationAt}人时召唤阵每${p.formationInterval}秒对路格造成最高攻击力${p.formationDamage}%法术伤害。`:''}`;
    case 'victoria_artillery': return `每累计${p.shots}次攻击，由最高攻击者对同一目标及${p.radius}格范围造成${p.damage}%攻击力物理伤害。${p.firewallAt?`${p.firewallAt}人时留下${p.firewallDuration}秒火墙，每秒造成${p.firewallDps}%攻击力伤害。`:''}`;
    case 'columbia_construct': return `造物生命+${p.hp}%、攻击+${p.atk}%；无造物时每${p.interval}秒召唤持续${p.constructDuration}秒、攻击为主人的${p.constructAtk}%的无人机，最多${p.maxConstructs}只。${p.rebuildAt?`${p.rebuildAt}人时首次阵亡造物可重构一次。`:''}`;
    case 'kazimierz_true_damage': return `攻击穿透防御${p.pierce}%；每${p.attackEvery}次攻击追加${p.trueDamage}%攻击力真实伤害。${p.solarAt?`${p.solarAt}人时每次施法在目标处召唤${p.solarDuration}秒耀阳，每秒造成${p.solarDps}%攻击力真实伤害，个人冷却${p.solarCooldown}秒。`:''}`;
    case 'siracusa_execute': return `敌人生命低于${p.executeBelow}%时伤害提高${p.executeBonus}%；每累计造成${p.damageCycle}实际伤害，恢复${p.sp}技力并使下一击追加${p.nextHit}%攻击力物理伤害，个人冷却${p.personalCooldown}秒。${p.wolfAt?`${p.wolfAt}人时狼影每${p.wolfInterval}秒对最近敌人造成${p.wolfDamage}%最高攻击力物理伤害，领袖不会被处决。`:''}`;
    case 'rhodes_first_cast': return `每名成员本场首次施法前减伤${p.mitigation}%，施法后恢复${p.heal}%最大生命并获得${p.duration}秒攻速+${p.aspd}。`;
    case 'lungmen_reward': return `前线击倒敌人时全队恢复${p.killSp}技力（团队每秒上限${p.teamSpCap}）；获胜每个经营节点获得${p.victoryGold}金币。${p.artilleryEvery?`每第${p.artilleryEvery}次击倒触发半径${p.artilleryRadius}格炮击，造成${p.artilleryDamage}%最高攻击力物理伤害。`:''}`;
    case 'sargon_sand': return `每${p.interval}秒治疗生命最低成员${p.heal}%最大生命，并在其最近敌人处形成${p.duration}秒流沙：减速${p.slow}%，每秒造成受益者攻击力${p.dps}%法术伤害。`;
    case 'leithania_sound': return `每第${p.castEvery}次施法留下${p.areaDuration}秒音域，每秒造成${p.dps}%攻击力法术伤害；最多${p.maxAreas}片，同源覆盖。${p.silenceAt?`${p.silenceAt}人时音域每${p.silenceInterval}秒沉默${p.silenceDuration}秒。`:''}`;
    case 'iberia_barrier': return `每名成员本场首次阻挡获得最大生命${p.barrier}%屏障；屏障破裂时对${p.radius}格内地面和空中敌人造成${p.breakDamage}%攻击力法术伤害。`;
    case 'higashi_redeploy': return `部署后${p.stealthSeconds}秒闪避${p.dodge}%；退出后为最近队友恢复${p.returnSp}技力，每名成员每场最多${p.returnLimit}次。${p.deployTrueDamageAt?`${p.deployTrueDamageAt}人时部署造成${p.deployTrueDamage}%攻击力真实伤害。`:''}`;
    case 'ursus_adjacency': return `相邻盟约成员防御+${p.adjacentDef}；无论胜负，结算时存活成员永久增加${p.victoryHp}生命，个人成长上限${p.personalGrowthCap}。`;
    case 'bolivar_slow': return `对减速、寒冷或束缚目标伤害+${p.controlledDamage}%；获胜时成员永久增加${p.victoryAtk}攻击，个人上限${p.growthCap}。`;
    case 'rim_forge': return `每${p.skillCount}次成员施法获得一份锻造进度，每经营节点最多${p.nodeLimit}份；跨场累计五份进度后，任选${p.choiceCount}件基础组件并重新累计。`;
    case 'babel_exit': return `成员本场首次退出时全队恢复${p.exitSp}技力；胜利后随机一名在场成员永久增加${p.victoryAtk}攻击，个人上限${p.growthCap}。`;
    case 'sami_cold': return `对寒冷或冻结目标的伤害与治疗提高${p.coldTargetBonus}%；本场首次施法为全队恢复${p.firstCastHeal}%最大生命。`;
    case 'ammo_last_round': return `每次真实消耗弹药有${p.refundChance}%几率恢复${p.refundSp}技力；技能最后一发追加${p.lastDamage}%攻击力物理伤害。`;
    case 'combo_sixth': return `每次攻击攻速+${p.aspdPerAttack}，最多+${p.speedCap}；每第${p.every}次攻击追加${p.damage}%攻击力物理伤害。${p.otherTargetAt?`达到${p.otherTargetAt}人后额外击打最近另一敌人。`:''}`;
    case 'control_first': return `每名成员首次控制同一目标时造成${p.damage}%攻击力法术伤害，目标冷却${p.sameTargetCooldown}秒；控制时间延长${p.durationBonus}%，领袖抗控规则不变。`;
    case 'creation_construct': return `造物攻击为主人恢复${p.ownerSp}技力（主人每秒最多${p.ownerSpCap}）；主人施法使自身造物恢复${p.heal}%生命并获得攻速+${p.aspd}，持续${p.duration}秒。`;
    case 'symbiosis_barrier': return `有效治疗的${p.healToShield}%转为屏障，屏障上限为目标最大生命${p.barrierCap}%，同一目标冷却${p.targetCooldown}秒；屏障破裂后下一击追加${p.breakBonus}%攻击力伤害。`;
    case 'logistics_dp': return `开局额外储备${p.startingDp}点部署费用；每实际产生10点部署费用，全队恢复${p.per10DpSp}技力与${p.heal}%生命，团队冷却${p.teamCooldown}秒，开局储备不计入产费。部署费用初始${p.baseDp}、每秒恢复${p.dpPerSecond}、上限${p.dpCap}。`;
    case 'redeploy_return': return `再部署时间变为${nfmt(p.timeMultiplier*100)}%；首次返场恢复${p.heal}%生命并对攻击范围内敌人造成${p.damage}%攻击力法术伤害，每人每场最多${p.returnLimit}次。`;
    case 'flight_dive': return `腾空期间减伤${p.mitigation}%、攻速+${p.aspd}；技能结束对${p.radius}格内地面和空中敌人造成${p.dive}%攻击力物理伤害。`;
    case 'arts_cycle': return `自然技力每秒+${p.sp}，法术抗性穿透${p.resPen}%；每第${p.every}次技能对最近${p.targetCount}名敌人追加${p.damage}%攻击力法术伤害。`;
    case 'breaker_front': return `普通攻击无视${p.defPen}%防御；对被阻挡目标伤害+${p.blockedBonus}%；本场首次击倒精英后攻速+${p.eliteAspd}，持续${p.duration}秒。`;
    case 'burn_spread': return `攻击附加${p.burn}%攻击力灼燃损伤；灼燃爆发时周围敌人额外受到${p.burst}%攻击力灼燃损伤，同一目标冷却${p.targetCooldown}秒，不继续传播。`;
    case 'necrosis_burst': return `凋亡损伤提高${p.bonus}%；本场首次爆发后全队恢复${p.firstBurstSp}技力；爆发目标每秒额外受到${p.dps}%最高成员攻击力法术伤害，持续${p.duration}秒。`;
    case 'holy_gun': return `按新约能天使一星/二星/三星，所有拉特兰成员的攻击分别有${p.byStar[1].chance}%/${p.byStar[2].chance}%/${p.byStar[3].chance}%几率呼叫空袭，基础伤害为${p.byStar[1].damage}%/${p.byStar[2].damage}%/${p.byStar[3].damage}%攻击力；每枚本场真实消耗弹药再提高${nfmt(p.byStar[1].factor*100)}%/${nfmt(p.byStar[2].factor*100)}%/${nfmt(p.byStar[3].factor*100)}%，最多计入${p.byStar[1].cap}/${p.byStar[2].cap}/${p.byStar[3].cap}枚，范围${p.byStar[1].radius}/${p.byStar[2].radius}/${p.byStar[3].radius}格。新约能天使施法时在全战场随机落下${p.bombCount}枚弹药；每名成员每${p.actionCooldown}秒至多触发一次。三星空袭命中后赋予50%弹药技能易伤，持续本场。`;
    case 'yela_breath': return `全行走格与保护目标铺雪；按圣聆初雪一星/二星/三星，每格冷却${p.byStar[1].tileCooldown}/${p.byStar[2].tileCooldown}/${p.byStar[3].tileCooldown}秒，寒冷持续${p.byStar[1].coldDuration}/${p.byStar[2].coldDuration}/${p.byStar[3].coldDuration}秒。未开技能时每个寒冷或冻结敌人提供每秒${p.byStar[1].perColdSp}独立技力；技能期间每个此类敌人提供攻击+${p.byStar[1].skillAtk}%、攻速+${p.byStar[1].skillAspd}。三星技能永久持续，保留防御与法抗加成；攻击仅命中单一目标时追加两次${p.starThreeDoubleHit}%攻击力法术伤害，施加${p.paralysis}层麻痹。`;
    case 'sui_shadow': return `首次施法为全队获得${p.barrier}%生命屏障；每${p.summonEvery}次全队施法召唤岁影${p.summonDuration}秒，攻击/生命分别为最高岁成员的${p.summonAtk}%/${p.summonHp}%，场上最多${p.maxSummons}只。`;
    case 'crown_memory': return `其他成员每次施法使魔王下次技能伤害提高一星/二星/三星${p.byStar[1].perCast}%/${p.byStar[2].perCast}%/${p.byStar[3].perCast}%；本场最多${p.maxStacks}层。`;
    default: return null;
  }
}

function equipmentEffectText(effect) {
  const p=effect.params??{};
  switch(effect.kind) {
    case 'component_stat': return Object.entries(p).map(([k,v])=>({atk:`攻击力+${nfmt(v)}`,aspd:`攻速+${nfmt(v)}`,def:`防御力+${nfmt(v)}`,res:`法术抗性+${nfmt(v)}`,hp:`生命上限+${nfmt(v)}`,maxHp:`生命上限+${nfmt(v)}`,sp:`技力自然回复每秒+${nfmt(v)}`,initialSp:`初始技力+${nfmt(v)}`,initSp:`初始技力+${nfmt(v)}`}[k]??null)).filter(Boolean).join('，') || '无基础属性';
    case 'giant_slayer': return `攻击生命高于${p.healthAbove}的敌人时伤害提高${p.damageBonus}%。`;
    case 'resistance_shred': return `攻击使目标法术抗性降低${p.resReduction}，持续${p.duration}秒。`;
    case 'fifth_strike': return `每第${p.every}次攻击追加${p.damage}%攻击力物理伤害。`;
    case 'armor_pierce': return `攻击无视目标${p.defensePenetration}%防御。`;
    case 'lifesteal': return `造成的实际物理或法术伤害的${p.actualDamagePercent}%转为治疗，冷却${p.cooldown}秒。`;
    case 'hit_stack': return `受击时防御+${p.defPerHit}、攻击+${p.atkPercentPerHit}%，最多${p.maxStacks}层。`;
    case 'first_cast_haste': return `首次施法后攻速+${p.aspd}，持续${p.duration}秒。`;
    case 'pact_transfer': case 'transfer_pact': return `额外获得${({aegir:'阿戈尔',laterano:'拉特兰',kjerag:'谢拉格',yan:'炎国',victoria:'维多利亚',columbia:'哥伦比亚',kazimierz:'卡西米尔',siracusa:'叙拉古',rhodes:'罗德岛',lungmen:'龙门',sargon:'萨尔贡',leithania:'莱塔尼亚',iberia:'伊比利亚',higashi:'东',ursus:'乌萨斯',bolivar:'玻利瓦尔',rim:'雷姆必拓',babel:'巴别塔',sami:'萨米',ammo:'弹药',combo:'连击',control:'控制',creation:'造物',symbiosis:'共生',logistics:'后勤',redeploy:'再部署',flight:'飞行',arts:'术式',breaker:'破阵',burn:'灼燃',necrosis:'凋亡',holyGun:'圣枪',yela:'耶拉之息',sui:'岁',crown:'王冠'})[p.pactId]??'盟约'}标签。`;
    case 'skill_damage': return `技能伤害提高${p.skillDamageBonus}%。`;
    case 'chain_lightning': return `每第${p.every}次攻击对${p.radius}格内敌人造成${p.damage}%攻击力法术伤害。`;
    case 'counter_magic': return `受击时造成自身防御力${p.damageFromDef}%法术伤害，冷却${p.cooldown}秒。`;
    case 'spell_vulnerability': return `法术抗性+${p.resBonus}；技能目标受到的法术伤害提高${p.targetArtsVulnerability}%，持续${p.duration}秒。`;
    case 'periodic_heal': return p.healFromAtk?`每${p.interval}秒治疗生命最低的友方${p.healFromAtk}%攻击力生命。`:`每${p.interval}秒治疗${p.range}格内最多${p.healTargetCount}名友方各${p.healMaxHp}%最大生命，不触发共生。`;
    case 'cast_stack': return `每次施法攻击提高${p.atkPercentPerCast}%，本场最多提高${p.maxPercent}%。`;
    case 'attack_stack': return `每次攻击攻速+${p.aspdPerAttack}，最多+${p.maxAspd}。`;
    case 'death_save': return `本场首次受到致死伤害时免于倒下${p.duration}秒。`;
    case 'evasion': return `获得${p.physicalDodge}%物理闪避和${p.artsDodge}%法术闪避。`;
    case 'splash_strike': return `每第${p.every}次攻击对最近另一敌人造成${p.otherTargetDamage}%攻击力物理伤害。`;
    case 'attack_sp': return `每次攻击恢复${p.spPerAttack}技力，每秒最多${p.perSecondCap}。`;
    case 'thorns': return `受敌人攻击时对${p.radius}格内敌人造成自身防御力${p.damageFromDef}%物理伤害，冷却${p.cooldown}秒。`;
    case 'block_stack': return `每阻挡一名敌人防御+${p.defPerBlock}、法抗+${p.resPerBlock}，最多${p.maxStacks}层。`;
    case 'death_barrier': return `生命+${p.baseHpBonus}%；本场首次受到致死伤害时获得${p.hpPercent}%生命屏障。`;
    case 'cast_stun': return `施法使最近敌人眩晕${p.duration}秒，冷却${p.cooldown}秒。`;
    case 'resistance_cleanse': return `法术抗性额外+${p.extraRes}；每${p.interval}秒清除寒冷或冻结。`;
    case 'cast_sp': case 'skill_sp': return `技能结束时恢复${p.sp}技力，冷却${p.cooldown??''}秒。`;
    case 'regeneration': return `生命+${p.maxHpBonus}%，每秒恢复最大生命${p.healMaxHpPerSecond}%。`;
    case 'hit_sp': return `受到攻击时恢复${p.spPerHit}技力，每秒最多${p.perSecondCap}。`;
    case 'choose_identity_transfer': return '可选择一个身份盟约标签，选择结果在领取前保留。';
    default:return null;
  }
}

function sourceLevel(operator, skillTable) {
  const levels=skillTable?.[operator.fixedSkillId]?.levels;
  if(!levels?.length)return null;
  const original=operator.source?.normalChess?.skill?.bb ?? {};
  const score=(level)=>{
    const bb=Object.fromEntries((level.blackboard??[]).map(x=>[x.key,x.value]));
    const keys=Object.keys(original);
    return keys.filter(k=>Object.hasOwn(bb,k)&&bb[k]===original[k]).length;
  };
  return [...levels].sort((a,b)=>score(b)-score(a))[0];
}

function hasExactSourceBlackboard(operator, skillTable) {
  const levels=skillTable?.[operator.fixedSkillId]?.levels??[];
  const original=operator.source?.normalChess?.skill?.bb??{};
  const keys=Object.keys(original);
  return levels.some(level=>{
    const bb=Object.fromEntries((level.blackboard??[]).map(x=>[x.key,x.value]));
    return keys.every(key=>Object.hasOwn(bb,key)&&bb[key]===original[key]);
  });
}

function renderSkillTemplate(template, blackboard) {
  const missing=[];
  const rendered=template.replace(/\{([^}:]+)(?::([^}]+))?\}/g,(_whole,key,format)=>{
    const normalized=key.toLowerCase();
    const lookup=normalized.startsWith('-')?normalized.slice(1):normalized;
    if(!Object.hasOwn(blackboard,lookup)||!Number.isFinite(blackboard[lookup])){missing.push(key);return `〔${key}〕`;}
    const value=normalized.startsWith('-')?Math.abs(blackboard[lookup]):blackboard[lookup];
    if(format?.includes('%')) {
      const digits=Number(format.match(/\.(\d+)/)?.[1]??0);
      return `${(value*100).toFixed(digits)}%`;
    }
    const digits=Number(format?.match(/\.(\d+)/)?.[1]??0);
    return format?.includes('.')?value.toFixed(digits):nfmt(value);
  });
  return {description:rendered.replace(/<[^>]*>/g,'').replace(/\\n/g,'\n')
    .replace(/（(?:期间)?可随时停止技能）/g,'')
    .replace(/，?可随时主动关闭技能/g,'')
    .replace(/可以手动结束技能，?/g,'')
    .replace(/该技能可随时主动关闭/g,'').trim(),missing};
}

export function compileResonancePlayerText(catalog, skillTable) {
  const diagnostics=[];
  const operators={};
  for(const [id,op] of Object.entries(catalog.operators)) {
    const template=sourceLevel(op,skillTable)?.description;
    if(op.fixedSkillId!=='resonance_judgement_support'&&!hasExactSourceBlackboard(op,skillTable))diagnostics.push({type:'source-level-mismatch',operatorId:id,skillId:op.fixedSkillId});
    operators[id]={stars:{}};
    for(const star of [1,2,3]) {
      const spec=op.stars[star], bb=spec.skillOverrides?.bb??{};
      if(op.fixedSkillId==='resonance_judgement_support') { operators[id].stars[star]={skillDescription:null}; continue; }
      if(!template) { diagnostics.push({type:'missing-template',operatorId:id,star,skillId:op.fixedSkillId}); operators[id].stars[star]={skillDescription:null}; continue; }
      const rendered=renderSkillTemplate(template,bb);
      if(rendered.missing.length) diagnostics.push({type:'missing-blackboard-values',operatorId:id,star,keys:rendered.missing});
      let description=rendered.description;
      if(op.fixedSkillId==='skchr_shu_3')description=description.replace('攻击同时可治疗我方干员','攻击时同时治疗范围内生命最低的一名友方，治疗量为当前攻击力的100%');
      if(spec.passive?.kind==='star3_surtur')description=description.replace(/最大生命\d+(?:\.\d+)?%\/秒/g,`最大生命${spec.passive.params.selfDamagePerSecondMaxHp}%/秒`);
      operators[id].stars[star]={skillDescription:description};
    }
  }
  const pacts=Object.fromEntries(Object.entries(catalog.pacts).map(([id,pact])=>[id,{levels:pact.levels.map(level=>{
    const sentences=level.effects.map(pactEffectText);
    if(sentences.some(x=>!x))diagnostics.push({type:'unknown-pact-effect',pactId:id,threshold:level.threshold,kinds:level.effects.filter((_,i)=>!sentences[i]).map(e=>e.kind)});
    return {threshold:level.threshold,description:sentences.filter(Boolean).join(' ')};
  })}]));
  const equipment=Object.fromEntries(Object.entries(catalog.equipment).map(([id,item])=>{
    const details=item.effects.map(equipmentEffectText);
    if(details.some(x=>!x))diagnostics.push({type:'unknown-equipment-effect',itemId:id,kinds:item.effects.filter((_,i)=>!details[i]).map(e=>e.kind)});
    const base=(item.baseEffects??[]).map(equipmentEffectText);
    const prose=[...base,...details.slice((item.baseEffects??[]).length)].filter(Boolean);
    if(item.unique)prose.push(item.kind==='completed'?'同名特殊效果仅生效一件；合成组件属性仍按装备件数叠加。':'同名特殊效果仅生效一件。');
    return [id,{description:prose.join(' ')}];
  }));
  return {schemaVersion:1,operators,pacts,equipment,diagnostics};
}
