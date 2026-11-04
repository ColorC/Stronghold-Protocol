/**
 * Faction season 2 generic strategies: 26 source augments (team stats and skills, equipment, economy) adapted to this
 * mode at the native scale, beside the season's emblem, crown and pact strategies. Each row names its source apiName
 * (it must be one of the season's strategyCandidates); `effects` are consumed by the session (prototype_grant,
 * prototype_round_gold) and by the battle (prototype_team_battle, server/sim/content/resonance/prototype-strategies.js).
 * Player copy is handwritten and uses only in-game words.
 */
const freeze = (value) => Object.freeze(value);
const grant = (params) => freeze({ kind: 'prototype_grant', params: freeze(params) });
const team = (mechanic, params = {}) => freeze({ kind: 'prototype_team_battle', params: freeze({ mechanic, ...params }) });
const row = (apiName, name, description, effects, iconTheme = null) => freeze({ apiName, name, description, effects: freeze(effects), ...(iconTheme ? { iconTheme } : {}) });

export const GENERIC_STRATEGIES = freeze([
  // economy
  row('TFT9_Augment_SilverSpoon', '作战记录', '立即获得10点经验。', [grant({ xp: 10 })], 'xp'),
  row('TFT9_Augment_Commander_RollingForDays', '加急许可', '立即获得10次免费刷新。', [grant({ freeRefreshes: 10 })], 'refresh'),
  row('TFT9_Augment_TiniestTitan', '定期拨款', '每场战斗结束后获得2金币。', [freeze({ kind: 'prototype_round_gold', params: freeze({ instantGold: 0, roundGold: 2 }) })], 'gold'),
  // equipment
  row('TFT11_Augment_Prizefighter', '补给箱', '从4件组件中选择2件。', [grant({ componentChoice: freeze({ optionCount: 4, count: 2 }) })], 'gear'),
  row('TFT9_Augment_BigGrabBag', '外勤补给', '获得3件随机组件、2金币和1个“重构模块”。', [grant({ randomComponents: 3, gold: 2, consumables: freeze(['prototype_reforger']) })], 'gear'),
  row('TFT9_Augment_IronAssets', '装备订购', '获得1个“列装券”和4金币。', [grant({ consumables: freeze(['prototype_completed_anvil']), gold: 4 })], 'gear'),
  row('TFT6_Augment_ItemGrabBag1', '装备补给', '获得1件随机合成装备。', [grant({ randomCompleted: 1 })], 'gear'),
  row('TFT7_Augment_BandOfThieves1', '随机武装', '获得1个“道具补给包”。', [grant({ consumables: freeze(['prototype_thiefs_gloves']) })], 'gear'),
  row('TFT6_Augment_PortableForge', '特制装备', '获得1个“机密列装券”。', [grant({ consumables: freeze(['prototype_artifact_anvil']) })], 'gear'),
  row('TFT9_Augment_SupportCache', '支援装备', '获得1个“支援列装券”。', [grant({ consumables: freeze(['prototype_support_anvil']) })], 'gear'),
  row('TFT6_Augment_RadiantRelics', '精良装备', '获得1个“辉光列装券”和1个“卸除许可”。', [grant({ consumables: freeze(['prototype_radiant_anvil', 'prototype_item_remover']) })], 'gear'),
  row('TFT6_Augment_OneTwoFive', '破格招募', '获得1件随机组件和2金币，并招募1名随机五费干员。', [grant({ randomComponents: 1, gold: 2, operators: freeze([freeze({ cost: 5, count: 1 })]) })], 'recruit'),
  row('TFT9_Augment_Commander_TeamingUp1', '协同招募', '获得1件随机组件，并招募2名随机三费干员。', [grant({ randomComponents: 1, operators: freeze([freeze({ cost: 3, count: 2 })]) })], 'recruit'),
  // team stats and skills
  row('TFT_Augment_ShojinSpirit', '战术指挥', '所有干员攻击力+8%，初始技力+5；获得1件“维式重锤”。', [team('team_stats', { atkPct: 0.08, initialSp: 5 }), grant({ items: freeze(['blade']) })], 'team'),
  row('TFT_Augment_GuardbreakerSpirit', '快速反应', '所有干员攻击速度+8。', [team('team_stats', { aspd: 8 })], 'team'),
  row('TFT_Augment_CrownguardSpirit', '稳固阵线', '所有干员造成的法术伤害提升8%，防御力+8%。', [team('team_stats', { artsDamage: 0.08, defPct: 0.08 })], 'team'),
  row('TFT_Augment_Backup', '远程支援', '至少4名远程干员上阵时，所有干员攻击速度+10。', [team('ranged_backup', { minRanged: 4, aspd: 10 })], 'team'),
  row('TFT_Augment_ClockworkAccelerator', '持续压制', '场上有敌人时，每3秒所有干员攻击速度+3，最多+30。', [team('pressure_ramp', { interval: 3, aspd: 3, maxAspd: 30 })], 'team'),
  row('TFT_Augment_Manaflow1', '技力循环', '远程干员技力自然回复速度+0.15/秒。', [team('ranged_sp_regen', { spRegen: 0.15 })], 'team'),
  row('TFT_Augment_AllForOneI', '同心协力', '每有1名不同的一费干员上阵，所有干员生命上限+2%、造成的伤害提升1.5%；招募2名随机一费干员。', [team('one_cost_unity', { hpPctPer: 0.02, damagePer: 0.015 }), grant({ operators: freeze([freeze({ cost: 1, count: 2 })]) })], 'team'),
  row('TFT10_Augment_LittleBuddies', '新老搭档', '每有1名一费或二费干员上阵（最多计4名），四费、五费干员生命上限+2%、攻击速度+4。', [team('little_buddies', { hpPctPer: 0.02, aspdPer: 4, maxCount: 4 })], 'team'),
  row('TFT_Augment_PairOfFours', '双璧', '恰好2名四费干员上阵时，二者生命上限+12%、攻击速度+20；招募1名随机四费干员。', [team('pair_of_fours', { hpPct: 0.12, aspd: 20 }), grant({ operators: freeze([freeze({ cost: 4, count: 1 })]) })], 'team'),
  row('TFT_Augment_Mentorship1', '师承', '开始作战时，周围8格内有更高费友军的干员攻击速度+12、生命上限+6%。', [team('mentorship', { aspd: 12, hpPct: 0.06 })], 'team'),
  row('TFT10_Augment_InspiringEpitaph', '遗志', '干员倒下时，最近的友军获得生命上限20%的屏障（持续8秒）和攻击速度+10，最多叠加5次。', [team('epitaph', { shieldPct: 0.2, shieldDuration: 8, aspd: 10, maxStacks: 5 })], 'team'),
  row('TFT_Augment_SuperstarsSilver', '明星阵容', '所有干员造成的伤害提升5%，每有1名三星干员上阵再提升2%（最多提升15%）；获得2次免费刷新。', [team('superstars', { base: 0.05, perThreeStar: 0.02, max: 0.15 }), grant({ freeRefreshes: 2 })], 'team'),
  row('TFT_Augment_GlassCannonI', '孤注一掷', '远程干员开始作战时生命为80%，造成的伤害提升12%。', [team('glass_cannon', { startHp: 0.8, damage: 0.12 })], 'team'),
]);
