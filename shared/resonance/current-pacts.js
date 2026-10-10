// Current-season pact overrides. The frozen generated catalog remains the v1 source.
export const CURRENT_PACT_VERSION = 4;

export const currentPactThresholds = Object.freeze({
  aegir:[2,4,6],laterano:[2,4,6,8],kjerag:[2,4,6],yan:[3,5,7,9],victoria:[2,4,6],columbia:[2,4,6],kazimierz:[2,3,4],siracusa:[2,4,6],rhodes:[2,3,4],lungmen:[2,3],sargon:[2,3,4],leithania:[2,3,4],iberia:[2,3,4],higashi:[2,3],ursus:[2],bolivar:[2],rim:[2],babel:[1],sami:[1],ammo:[2,4],combo:[2,4,6],control:[2,4,6],creation:[2,4,6],symbiosis:[2,4,6],logistics:[2,4,6],redeploy:[2,3],flight:[1],arts:[2,4,6],breaker:[2,4,6],burn:[1],necrosis:[2,3,4],holyGun:[1],yela:[1],sui:[1,2,3],crown:[1],
});

const describePactEffect = (effect,threshold) => {
  const p=effect.params??{};
  switch(effect.kind) {
    case 'stat': return `成员${({maxHp:'最大生命',atk:'攻击力',aspd:'攻速',artsDamage:'法术伤害'})[p.stat]??p.stat}提高${p.value}${p.mode==='percent'?'%':''}。`;
    case 'aegir_cycle': return `成员每秒恢复${p.regen}%最大生命，攻击力增加最大生命的${p.atkFromHp}%。${p.block?`阻挡数+${p.block}。`:''}受敌方攻击时对${p.retaliationRadius}格内敌人反击，造成自身最大生命${p.retaliation}%法术伤害；个人冷却${p.cd}秒，不递归。`;
    case 'laterano_ammo': return `成员弹药技能增加${p.skillAmmo}枚载弹；全队累计每消耗${p.ammoSpend}枚弹药，为成员下次攻击追加${p.bonus}%攻击力物理伤害。${threshold>=p.droneAt?`无人机每${p.droneInterval}秒对附近敌人连射${p.droneShots}次，每次造成最高成员攻击力${p.droneDamage}%物理伤害，可对空。`:''}`;
    case 'kjerag_coordination': return `成员每${p.attackEvery}次普通攻击标记目标${p.markDuration}秒，标记冷却${p.markCooldown}秒。其他不同友方干员攻击标记者时，各追加本人${p.responseDamage}%攻击力物理伤害一次。${threshold>=p.crossfireAt?`${p.crossfireResponders}名不同友军响应后，全体存活已部署成员各追加${p.crossfireDamage}%攻击力物理伤害一次。`:''}`;
    case 'yan_combo': return `成员施法为其他成员恢复${p.teamSp}技力，施法者冷却${p.receiverCooldown}秒；累计每${p.comboEvery}次触发，全体成员各对最近敌人造成${p.comboDamage}%攻击力法术伤害。${threshold>=p.formationAt?`阵势每${p.formationInterval}秒对最近敌人造成首名成员攻击力${p.formationDamage}%法术伤害。`:''}`;
    case 'victoria_artillery': return `成员全队累计每${p.shots}次攻击，对目标${p.radius}格内敌人炮击，造成最高成员攻击力${p.damage}%物理伤害，可对空。`;
    case 'columbia_construct': return `成员的召唤物最大生命提高${p.hp}%、攻击力提高${p.atk}%。每名成员每${p.interval}秒生成机械造物，基础生命为本人最大生命${p.hp}%、基础攻击为本人${p.constructAtk}%，持续${p.constructDuration}秒，每名成员最多${p.maxConstructs}个；每秒攻击最近敌人。${p.rebuildEnabled?'每名成员首个死亡机械造物可在空位重构一次。':''}`;
    case 'kazimierz_true_damage': return `成员无视${p.pierce}%防御；每${p.attackEvery}次攻击追加${p.trueDamage}%攻击力真实伤害。`;
    case 'siracusa_execute': return `攻击生命比例低于${p.executeBelow}%的敌人时，伤害提高${p.executeBonus}%。`;
    case 'siracusa_harvest': return `成员击倒敌人时本人恢复${p.sp}技力，并强化下一次普通攻击一次，追加${p.nextHit}%攻击力物理伤害；不叠加、不递归。`;
    case 'rhodes_first_cast': return `每名成员本场首次施法恢复${p.heal}%最大生命，并获得${p.mitigation}%减伤与${p.aspd}攻速，持续${p.duration}秒。`;
    case 'lungmen_reward': return `成员击倒敌人时为全体成员恢复${p.killSp}技力，每场前${p.teamSpCap}次击倒有效；胜利结算获得${p.victoryGold}金币一次。`;
    case 'sargon_sand': return `每${p.interval}秒选生命比例最低的成员恢复${p.heal}%最大生命，在其位置生成半径${p.areaRadius}格沙域，持续${p.duration}秒；域内敌人移速降低${p.slow}%，每秒受到该成员${p.dps}%攻击力法术伤害。`;
    case 'leithania_sound': return `成员累计每${p.castEvery}次施法，在最近敌人位置生成半径1.5格声场，持续${p.areaDuration}秒，最多${p.maxAreas}个；每秒造成施法者${p.dps}%攻击力法术伤害。${threshold>=p.silenceAt?`每${p.silenceInterval}秒施加${p.silenceDuration}秒沉默。`:''}`;
    case 'iberia_barrier': return `成员本场首次阻挡获得${p.barrier}%最大生命屏障，最多持续${p.duration}秒；被敌方伤害击破或到期时，对${p.radius}格内敌人造成本人${p.breakDamage}%攻击力法术伤害，可对空；仅爆发一次。`;
    case 'higashi_redeploy': return `每次部署获得${p.stealthSeconds}秒隐匿与${p.dodge}%物理、法术闪避。${threshold>=p.deployTrueDamageAt?`返场时对8格内敌人造成${p.deployTrueDamage}%攻击力真实伤害。`:''}`;
    case 'ursus_adjacency': return `与另一名存活已部署乌萨斯成员处于8邻格时，本人防御+${p.adjacentDef}，不按邻居数量叠加。每次战斗结算，存活成员最大生命永久+${p.victoryHp}，本人累计上限${p.personalGrowthCap}。`;
    case 'bolivar_slow': return `成员对缓行或停顿、寒冷、冻结或束缚敌人的伤害提高${p.controlledDamage}%；胜利后成员攻击力永久+${p.victoryAtk}，本人累计上限${p.growthCap}。`;
    case 'rim_forge': return `成员累计每${p.skillCount}次施法获得${p.choiceCount}个组件选择，每节点最多${p.nodeLimit}次。`;
    case 'babel_exit': return `独有盟约。成员本场首次离场时，为同队存活干员恢复${p.exitSp}技力；胜利后随机1名存活成员攻击力永久+${p.victoryAtk}，累计上限${p.growthCap}。`;
    case 'sami_cold': return `对寒冷或冻结敌人的伤害提高${p.coldTargetBonus}%；成员首次施法为全队存活干员恢复${p.firstCastHeal}%最大生命。`;
    case 'ammo_last_round': return `成员每次弹药技能增加${p.skillAmmo}枚载弹；最后一枚追加${p.lastDamage}%攻击力物理伤害一次。`;
    case 'combo_sixth': return `成员每次攻击获得${p.aspdPerAttack}攻速，最多${p.speedCap}；每${p.every}次攻击追加${p.damage}%攻击力物理伤害。${threshold>=p.otherTargetAt?'同时对另一名敌人追加一次相同伤害。':''}`;
    case 'control_first': return `成员控制持续时间提高${p.durationBonus}%；施加控制时追加${p.damage}%攻击力法术伤害，同目标冷却${p.sameTargetCooldown}秒；遵循首领抗性。`;
    case 'creation_construct': return `召唤物每次攻击为所属成员恢复${p.ownerSp}技力，每秒最多触发${p.ownerSpCap}次；成员施法使自己的存活召唤物恢复${p.heal}%最大生命并获得${p.aspd}攻速，持续${p.duration}秒。`;
    case 'symbiosis_guard': return `共生成员治疗量提高${p.healingBonus}%。战斗开始及每${p.interval}秒，为生命比例最低的${p.targets}名存活已部署友方干员提供其最大生命${p.shieldHp}%的屏障与${p.aspd}攻速，均持续${p.duration}秒；同生命比例优先前线。该屏障只刷新、不叠加；破盾后攻速仍持续至结束。`;
    case 'logistics_dp': return `战斗开始增加${p.startingDp}部署费用。累计每获得10费用，为同队存活干员恢复${p.per10DpSp}技力与${p.heal}%最大生命，全队冷却${p.teamCooldown}秒；初始费用与退场返还不计入。`;
    case 'redeploy_return': return `成员再部署时间缩短${Math.round((1-p.timeMultiplier)*100)}%；每名成员本场首次返场对8格内敌人造成${p.damage}%攻击力法术伤害。`;
    case 'flight_dive': return `蒂比S2起飞期间获得${p.aspd}攻速并仅受到地面敌人${p.mitigation}%减伤；存活且仍部署时，S2自然结束对${p.radius}格内地面与空中敌人造成${p.dive}%攻击力物理伤害一次。`;
    case 'arts_cycle': return `成员自然技力回复每秒+${p.sp}，无视${p.resPen}%法抗；每${p.every}次施法，对最近${p.targetCount}名敌人各造成${p.damage}%攻击力法术伤害。`;
    case 'breaker_front': return `成员无视${p.defPen}%防御，对被阻挡敌人的伤害提高${p.blockedBonus}%；本人首次击倒精英或首领后获得${p.eliteAspd}攻速，持续${p.duration}秒。`;
    case 'burn_spread': return `独有盟约。成员伤害附带${p.burn}%攻击力灼燃损伤，同目标冷却${p.targetCooldown}秒；本人引发灼燃爆发时，对目标${p.radius}格内其它敌人追加${p.burst}%攻击力法术伤害，不再传播损伤。`;
    case 'necrosis_burst': return `成员凋亡损伤提高${p.bonus}%；凋亡爆发目标每秒额外受到触发成员${p.dps}%攻击力法术伤害，持续${p.duration}秒；同目标本场只触发一次。`;
    case 'holy_gun': return `拉特兰攻击独立触发空袭，每名攻击者冷却${p.actionCooldown}秒；依新约能天使星级，概率${p.byStar[1].chance}/${p.byStar[2].chance}/${p.byStar[3].chance}%，基础伤害为其攻击力${p.byStar[1].damage}/${p.byStar[2].damage}/${p.byStar[3].damage}%，半径${p.byStar[1].radius}/${p.byStar[2].radius}/${p.byStar[3].radius}格。每消耗1枚弹药提高${p.byStar[1].factor*100}/${p.byStar[2].factor*100}/${p.byStar[3].factor*100}%该伤害，最多计${p.byStar[1].cap}/${p.byStar[2].cap}/${p.byStar[3].cap}枚。固定技能投放${p.bombCount}枚随机弹药。`;
    case 'yela_breath': return `圣聆初雪铺设全图可行走格与目标格雪地。依一星/二星/三星，每格冷却${p.byStar[1].tileCooldown}/${p.byStar[2].tileCooldown}/${p.byStar[3].tileCooldown}秒，施加${p.byStar[1].coldDuration}/${p.byStar[2].coldDuration}/${p.byStar[3].coldDuration}秒寒冷；未施法时，每名寒冷或冻结敌人提供每秒${p.byStar[1].perColdSp}技力；技能期间每名提供${p.byStar[1].skillAtk}%攻击与${p.byStar[1].skillAspd}攻速。三星固定技能永久保持，单体攻击追加2次${p.starThreeDoubleHit}%攻击力法术伤害并施加${p.paralysis}层麻痹。`;
    case 'sui_shadow': return `全队首次施法为同队存活干员提供${p.barrier}%最大生命屏障；全队累计每${p.summonEvery}次施法，对最近终点的精英或首领召唤岁影，生命为最高攻击成员的${p.summonHp}%、攻击为其${p.summonAtk}%，持续${p.summonDuration}秒，最多${p.maxSummons}个，每秒造成法术伤害。`;
    case 'crown_memory': return `其他友方干员每次实际施法，为存活且已部署的魔王累计${p.byStar[1].perCast}/${p.byStar[2].perCast}/${p.byStar[3].perCast}%攻击力（一星/二星/三星），本场最多${p.maxStacks}层；攻击力加成强化魔王实际治疗。`;
    default: throw new Error(`CURRENT_PACT_DESCRIPTION_MISSING:${effect.kind}`);
  }
};

export const currentPactEvidence = Object.freeze({
  symbiosis: Object.freeze({
    sentinel: Object.freeze({
      game: 'Teamfight Tactics', version: 'Patch 11.15', recordId: 'Sentinel',
      sourceUrl: 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-11-15-notes/',
      sourceEffectText: '战斗开始获得护盾并同时获得攻速；原机制在护盾消失后转移给生命比例最低的友军。',
    }),
    protectiveShielding: Object.freeze({
      game: 'Teamfight Tactics', version: 'Into the Arcane', recordId: 'Protective Shielding',
      sourceUrl: 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/mechanics-into-the-arcane/',
      sourceEffectText: '战斗开始及每8秒，为自己与两名低血友军提供最大生命20%的护盾，持续5秒。',
    }),
    difference: '共鸣将两种机制组合为低生命比例友军的周期屏障与独立定时攻速；成员治疗增益、目标数、百分比和攻速数值均为共鸣适配。没有破盾奖励或盾消失后的转移。',
  }),
  higashi: Object.freeze({
    nativeCommit: '4ed1ad32ec10da15c23f9d7939dade603950759b',
    sourcePath: 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native/chess.json',
    nativeStealth: { recordId: 'chess_char_4_04_a', jsonPointer: '/chess_char_4_04_a/skills/1', sourceEffectText: '攻击范围扩大，攻击力+60%，自身获得隐匿；技能结束或离场时结束。' },
    nativeDodge: { recordId: 'chess_char_2_13_a', jsonPointer: '/chess_char_2_13_a/skills/1', sourceEffectText: '受到攻击后触发，并闪避本次物理或法术伤害。' },
    nativeDeployAttack: { recordId: 'chess_char_4_04_a', jsonPointer: '/chess_char_4_04_a/skills/2', sourceEffectText: '重新部署后对穿过的最多4名敌人造成相当于攻击力110%的物理伤害。' },
    difference: '这些是具名本体技能候选，不证明东盟约复合机制原样继承；部署触发/限时和物理转真实伤害属于适配。',
  }),
  siracusa: Object.freeze({
    killToSp: Object.freeze({
      game: 'Teamfight Tactics', version: 'Set 18 Patch 18.4 / CommunityDragon publication 16.20.1', recordId: 'DA_FloraFatalis18',
      jsonPointer: '/supplement/publishedTraits/16', sourcePath: 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/docs/resonance/reference/tft-set18.json',
      sourceUrl: 'https://tftraits.com/api/display/traits?v=18-18.4.0.BF63CD5E.u09ac2d13s5&lang=en-us',
      sourceKind: 'community game-data derivative published by TFTraits; not a first-party source',
      officialPatchContextUrl: 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-4/',
      sourceEffectText: 'Flora Fatalis champions harvest enemies on takedown, gaining 10 Mana; the 2-unit tier also heals the lowest-health ally.',
    }),
    nextAttack: Object.freeze({
      game: 'Teamfight Tactics', version: 'Patch 11.15', recordId: 'Victorious',
      sourceUrl: 'https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-11-15-notes/',
      sourceEffectText: '击倒后，下一次攻击根据目标已损失生命值造成额外魔法伤害。',
    }),
    removedWolf: 'The old eight-member wolf-shadow effect was removed from current v2 tiers; no wolf effect is described or executed.',
  }),
  burn: Object.freeze({
    native: Object.freeze({
      game: '卫戍协议原生本体', version: '4ed1ad32ec10da15c23f9d7939dade603950759b',
      recordId: 'burn element gauge / elementBurst',
      nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:server/sim/damage.js:applyElement/elementBurst',
      sourceEffectText: '原生元素损伤累积到阈值后触发元素爆发；盟约沿用该爆发事件作为触发点。',
    }),
    competitor: Object.freeze({
      game: 'Teamfight Tactics', version: 'Patch 11.15', recordId: 'Cannoneer',
      sourceUrl: 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-11-15-notes/',
      sourceEffectText: '枪手每第五次射击，按该次射击伤害的一定比例，对目标周围造成物理爆炸伤害。',
    }),
    difference: '采用枪手围绕当前目标爆炸的范围伤害原语，结合原生灼燃爆发事件。触发条件由第五次射击改为本人引发灼燃爆发；伤害改为本人攻击力比例的法术溅射，排除主目标且不传播元素损伤；范围与数值为项目适配。',
  }),
  crown: Object.freeze({
    game: 'Teamfight Tactics', version: 'Patch 11.12', recordId: 'Spellweaver',
    sourceUrl: 'https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-11-12-notes/',
    sourceEffectText: 'Spellweavers gain Ability Power and gain more Ability Power whenever they cast a spell.',
    difference: 'The transferable primitive is spell-cast-driven stacking. This pact counts other same-owner operators’ casts, converts Ability Power into Crown ATK to strengthen her native ATK-scaled healing, and sets the per-cast star values and 30-stack cap as project adaptations.',
  }),
  ammo: Object.freeze({
    game: '卫戍协议原生本体', version: '4ed1ad32ec10da15c23f9d7939dade603950759b',
    recordId: 'chess_char_1_01_a', jsonPointer: '/chess_char_1_01_a/skills/1',
    nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:data/chess.json/chess_char_1_01_a/skills/1',
    sourceEffectText: '隐现S2为真实弹药技能，黑板 attack@trigger_time=14；协议提供的 AMMO 技能具备 addAmmo(n)，激活时增加当前载弹并更新载弹条上限。',
  }),
  redeploy: Object.freeze({
    nativeCommit: '4ed1ad32ec10da15c23f9d7939dade603950759b',
    sourcePath: 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native/chess.json',
    silverAsh: Object.freeze({
      recordId: 'chess_char_4_22_a', jsonPointer: '/chess_char_4_22_a/talents/0',
      nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:data/chess.json/chess_char_4_22_a/talents/0',
      sourceEffectText: '编入队伍时所有我方单位的再部署时间-10%。',
    }),
    skadi: Object.freeze({
      recordId: 'chess_char_3_05_a', jsonPointer: '/chess_char_3_05_a/talents/1',
      nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:data/chess.json/chess_char_3_05_a/talents/1',
      sourceEffectText: '自身再部署时间-10秒。',
    }),
    texas: Object.freeze({
      recordId: 'chess_char_4_16_a', skillId: 'skchr_texas2_3', jsonPointer: '/chess_char_4_16_a/skill',
      nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:data/chess.json/chess_char_4_16_a/skill',
      sourceEffectText: '部署后立即对周围所有敌人造成两次相当于攻击力115%的法术伤害并使目标晕眩1.5秒。',
    }),
    difference: '银灰与斯卡蒂只支持缩短计时器，生效范围/条件不同；德克萨斯支持部署触发范围伤害，不支持返场治疗或仅限返场。返场治疗仍无具名来源，当前数值是适配。',
  }),
});

export function applyCurrentPacts(catalog) {
  const pacts = { ...catalog.pacts };
  const replaceLevels = (id, transform) => {
    const pact = pacts[id];
    if (!pact) throw new Error(`CURRENT_PACT_MISSING:${id}`);
    pacts[id] = {
      ...pact,
      levels: pact.levels.map((level) => transform({
        ...level,
        effects: level.effects.map((effect) => ({ ...effect, params: { ...effect.params } })),
      })),
    };
  };

  replaceLevels('symbiosis', (level) => {
    const values = { 2:[15,1,15,20], 4:[30,2,25,35], 6:[50,3,35,50] }[level.threshold];
    if (!values) throw new Error(`CURRENT_PACT_TIER_MISSING:symbiosis:${level.threshold}`);
    const [healingBonus,targets,shieldHp,aspd] = values;
    level.effects = [{ kind:'symbiosis_guard', params:{ healingBonus,targets,shieldHp,aspd,interval:8,duration:5 }, reference:currentPactEvidence.symbiosis }];
    level.description = `共生成员治疗量提高${healingBonus}%。战斗开始及每8秒，为生命比例最低的${targets}名存活已部署友方干员提供其最大生命${shieldHp}%的屏障与${aspd}攻速，均持续5秒；同生命比例优先前线。该屏障只刷新、不叠加；破盾后攻速仍持续至结束。`;
    return level;
  });

  replaceLevels('higashi', (level) => {
    for (const effect of level.effects) if (effect.kind === 'higashi_redeploy') {
      effect.params.returnSp = 0;
      effect.reference = currentPactEvidence.higashi;
    }
    const redeploy = level.effects.find((effect) => effect.kind === 'higashi_redeploy').params;
    level.description = `部署后获得${redeploy.stealthSeconds}秒隐匿与${redeploy.dodge}%闪避。${level.threshold >= redeploy.deployTrueDamageAt ? `部署攻击造成${redeploy.deployTrueDamage}%攻击力真实伤害。` : ''}`;
    return level;
  });

  replaceLevels('siracusa', (level) => {
    const legacy = level.effects.find((effect) => effect.kind === 'siracusa_execute');
    if (!legacy) throw new Error(`CURRENT_PACT_EFFECT_MISSING:siracusa:siracusa_execute:${level.threshold}`);
    const nextHit = legacy.params.nextHit;
    delete legacy.params.damageCycle;
    delete legacy.params.sp;
    delete legacy.params.nextHit;
    legacy.reference = { difference: '低生命比例增伤保留；旧有八人狼影效果已从当前v2移除。' };
    const byThreshold = { 2: 3, 4: 5, 6: 8, 8: 8 };
    level.effects.push({ kind: 'siracusa_harvest', params: {
      sp: byThreshold[level.threshold], nextHit: ({ 2:80,4:140,6:240,8:300 })[level.threshold],
      nextHitOnce: true, nextHitBasicAttackOnly: true, noStack: true, nonRecursive: true,
    }, reference: currentPactEvidence.siracusa });
    level.description = `敌人生命低于${legacy.params.executeBelow}%时伤害提高${legacy.params.executeBonus}%；成员击倒敌人时本人恢复${byThreshold[level.threshold]}技力，并强化本人下一次普通攻击一次，追加${level.effects.at(-1).params.nextHit}%攻击力物理伤害。`;
    return level;
  });

  replaceLevels('ammo', (level) => {
    const effect = level.effects.find((row) => row.kind === 'ammo_last_round');
    if (!effect) throw new Error(`CURRENT_PACT_EFFECT_MISSING:ammo:ammo_last_round:${level.threshold}`);
    effect.params.refundSp = 0;
    effect.params.refundChance = 0;
    effect.params.skillAmmo = ({ 2: 1, 4: 2, 6: 3 })[level.threshold];
    effect.reference = currentPactEvidence.ammo;
    level.description = `所有盟约成员的每次弹药技能载弹量增加${effect.params.skillAmmo}枚；技能最后一发追加${effect.params.lastDamage}%攻击力物理伤害。`;
    return level;
  });

  replaceLevels('necrosis', (level) => {
    const effect = level.effects.find((row) => row.kind === 'necrosis_burst');
    if (!effect) throw new Error(`CURRENT_PACT_EFFECT_MISSING:necrosis:necrosis_burst:${level.threshold}`);
    effect.params.firstBurstSp = 0;
    level.description = `凋亡损伤提高${effect.params.bonus}%；凋亡爆发目标每秒额外受到${effect.params.dps}%最高成员攻击力法术伤害，持续${effect.params.duration}秒。`;
    return level;
  });

  replaceLevels('redeploy', (level) => {
    const effect = level.effects.find((row) => row.kind === 'redeploy_return');
    if (!effect) throw new Error(`CURRENT_PACT_EFFECT_MISSING:redeploy:redeploy_return:${level.threshold}`);
    effect.params.returnLimit = 1;
    effect.params.heal = 0;
    effect.reference = currentPactEvidence.redeploy;
    const shorter = Math.round((1 - effect.params.timeMultiplier) * 100);
    level.description = `再部署时间缩短${shorter}%；每名成员本场首次返场对范围内敌人造成${effect.params.damage}%攻击力法术伤害。`;
    return level;
  });

  for(const [id,thresholds] of Object.entries(currentPactThresholds)) {
    const pact=pacts[id]?{...pacts[id]}:null;
    if(!pact||pact.levels.length<thresholds.length)throw new Error(`CURRENT_PACT_LEVELS_MISSING:${id}`);
    pacts[id]=pact;
    if(['babel','burn','flight','sami','holyGun','yela','crown','sui'].includes(id))pact.emblemAllowed=false;
    pact.levels=pact.levels.slice(0,thresholds.length).map((original,index)=>{
      const level={...original,threshold:thresholds[index],effects:original.effects.map(effect=>({...effect,params:{...effect.params}}))};
      for(const effect of level.effects){const p=effect.params;
        if(id==='kjerag')p.crossfireAt=6;
        if(id==='yan')p.formationAt=9;
        if(id==='victoria')for(const key of ['firewallAt','firewallDps','firewallDuration'])delete p[key];
        if(id==='columbia'){p.rebuildEnabled=level.threshold===6;p.rebuildAt=6;}
        if(id==='kazimierz')for(const key of ['solarAt','solarDuration','solarDps','solarRadius','solarCooldown'])delete p[key];
        if(id==='siracusa'&&effect.kind==='siracusa_execute'){for(const key of ['wolfAt','wolfInterval','wolfDamage','personalCooldown'])delete p[key];p.executeBonus=[20,35,60][index];effect.reference={adaptation:'低生命比例增伤保留。',removal:currentPactEvidence.siracusa.removedWolf};}
        if(id==='lungmen')for(const key of ['artilleryEvery','artilleryDamage','artilleryRadius'])delete p[key];
        if(id==='leithania')p.silenceAt=4;
        if(id==='iberia')p.duration=10;
        if(id==='higashi')p.deployTrueDamageAt=3;
        if(id==='burn'){p.radius=1.5;effect.reference=currentPactEvidence.burn;}
        if(id==='crown'&&effect.kind==='crown_memory'){delete p.battleOnly;effect.reference=currentPactEvidence.crown;}
      }
      level.description=level.effects.map(effect=>describePactEffect(effect,level.threshold)).join('');
      return level;
    });
    pact.thresholds=[...thresholds];
  }
  const playerText = { ...catalog.playerText, pacts: { ...catalog.playerText.pacts } };
  for(const [id,pact] of Object.entries(pacts))playerText.pacts[id]={levels:pact.levels.map(level=>({threshold:level.threshold,description:level.description}))};
  playerText.pacts.symbiosis = { levels: pacts.symbiosis.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.higashi = { levels: pacts.higashi.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.siracusa = { levels: pacts.siracusa.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.ammo = { levels: pacts.ammo.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.necrosis = { levels: pacts.necrosis.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.redeploy = { levels: pacts.redeploy.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  return { ...catalog, pacts, playerText };
}
