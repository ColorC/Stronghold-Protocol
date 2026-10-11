/**
 * Faction season 2 pact design: non-stacking Stronghold Protocol style pacts.
 *
 * Members, activation tiers, natural fees and emblems are inherited unchanged from faction season 1; this module only
 * replaces what each tier does. Ten factions and seven combat pacts receive a redesigned battlefield mechanism. No pact is
 * defense-first (owner rule: enemies that are neither killed nor held leak, so pacts kill or control)
 * (`STRONGHOLD_PACT_TIERS`, consumed by server/sim/content/resonance/stronghold-pacts.js); the remaining nine keep their
 * season-1 adapter with the value corrections in `STRONGHOLD_PACT_TUNING`. Nothing grows across battles except the
 * season-1 Family, Junker King and High Roller economies, which the owner kept.
 *
 * Player copy is handwritten per pact: the overview carries the shared rule once, every tier names its own values.
 */
const freeze = (value) => Object.freeze(value);
const tiers = (rows) => freeze(Object.fromEntries(Object.entries(rows).map(([minUnits, variables]) => [minUnits, freeze({ ...variables })])));

export const STRONGHOLD_PACT_TIERS = freeze({
  academy: freeze({ mechanic: 'wanted_ammo', tiers: tiers({
    3: { wantedCount: 1, wantedDamage: 0.2 },
    4: { wantedCount: 1, wantedDamage: 0.3, ammoBonus: 0.3, durationBonus: 0.2 },
    5: { wantedCount: 2, wantedDamage: 0.3, ammoBonus: 0.3, durationBonus: 0.2, wantedKillSp: 4 },
    6: { wantedCount: 3, wantedDamage: 0.45, ammoBonus: 0.5, durationBonus: 0.3, wantedKillSp: 6 },
  }) }),
  creation: freeze({ mechanic: 'cold_freeze_wind', tiers: tiers({
    2: { chillDuration: 1, chillCooldown: 4, coldDamage: 0.15 },
    4: { chillDuration: 1, chillCooldown: 4, coldDamage: 0.3, windInterval: 20, windDuration: 4 },
    6: { chillDuration: 1, chillCooldown: 4, coldDamage: 0.45, windInterval: 12, windDuration: 6 },
  }) }),
  sui: freeze({ mechanic: 'yanyou_guardian', tiers: tiers({
    3: { guardianCount: 1, guardianShare: 0.2, guardianTargets: 2, burnRatio: 0.2 },
    4: { guardianCount: 1, guardianShare: 0.3, guardianTargets: 3, burnRatio: 0.2, summonAttack: 0.2 },
    5: { guardianCount: 1, guardianShare: 0.4, guardianTargets: 3, burnRatio: 0.2, summonAttack: 0.2,
      flameInterval: 15, flameDamage: 2, flameRadius: 1.5, flameFragile: 0.2, flameFragileDuration: 6 },
    7: { guardianCount: 2, guardianShare: 0.4, guardianTargets: 3, burnRatio: 0.2, summonAttack: 0.4, guardianDamageTaken: 0.5,
      flameInterval: 15, flameDamage: 2, flameRadius: 1.5, flameFragile: 0.2, flameFragileDuration: 6 },
  }) }),
  flight: freeze({ mechanic: 'abyssal_hunt', tiers: tiers({
    2: { huntThreshold: 0.5, huntDamage: 0.25, killAspd: 20, killAspdDuration: 8 },
    3: { huntThreshold: 0.5, huntDamage: 0.35, killAspd: 30, killAspdDuration: 8, reviveHealth: 0.5 },
    4: { huntThreshold: 0.5, huntDamage: 0.45, killAspd: 40, killAspdDuration: 8, reviveHealth: 0.5, executeThreshold: 0.1 },
  }) }),
  resistance: freeze({ mechanic: 'victoria_equipment', tiers: tiers({
    3: { perComponent: 0.06, perCompleted: 0.1 },
    5: { perComponent: 0.1, perCompleted: 0.15, hammerEvery: 3 },
    7: { perComponent: 0.14, perCompleted: 0.2, hammerEvery: 3, temporaryHammer: 1 },
    10: { perComponent: 0.2, perCompleted: 0.3, hammerEvery: 3, temporaryHammer: 1, othersShare: 0.5 },
  }) }),
  risk: freeze({ mechanic: 'stealth_ambush_fear', tiers: tiers({
    3: { openingAspd: 25, openingDuration: 20 },
    4: { openingAspd: 25, openingDuration: 20, stealth: 1, ambushDamage: 0.5 },
    5: { openingAspd: 35, openingDuration: 25, stealth: 1, ambushDamage: 0.5, fearChance: 0.15, fearDuration: 2, fearWindow: 10 },
    6: { openingAspd: 35, openingDuration: 25, stealth: 1, ambushDamage: 0.5, fearChance: 0.2, fearDuration: 2, fearWindow: 10, fearDamage: 0.3 },
    7: { openingAspd: 50, openingDuration: 0, stealth: 1, ambushDamage: 0.5, fearChance: 0.25, fearDuration: 3, fearWindow: 10, fearDamage: 0.3 },
  }) }),
  conqueror: freeze({ mechanic: 'true_damage_block', tiers: tiers({
    2: { attackTrue: 0.08 },
    4: { attackTrue: 0.15, blockPulse: 0.6, blockInterval: 2 },
    6: { attackTrue: 0.22, blockPulse: 1, blockInterval: 2, blockStun: 0.5 },
    9: { attackTrue: 0.35, blockPulse: 1, blockInterval: 2, blockStun: 0.5, othersTrue: 0.1 },
  }) }),
  experiment: freeze({ mechanic: 'skill_relay_sand', tiers: tiers({
    3: { castAspd: 20, castDuration: 8 },
    5: { castAspd: 35, castAtk: 0.12, castDuration: 8, sandSlow: 0.4, sandDuration: 5 },
    7: { castAspd: 50, castAtk: 0.2, castDuration: 8, sandSlow: 0.4, sandDuration: 5, relaySp: 3 },
  }) }),
  rhodes: freeze({ mechanic: 'columbia_shock', tiers: tiers({
    2: { castBlast: 1, castStun: 1 },
    4: { castBlast: 1.5, castStun: 1.5 },
    6: { castBlast: 2, castStun: 1.5, stunFragile: 0.2 },
    9: { castBlast: 2.5, castStun: 2, stunFragile: 0.3, summonBlast: 1 },
  }) }),
  enforcer: freeze({ mechanic: 'rhodes_rally', tiers: tiers({
    2: { healAtk: 0.1, healAtkDuration: 5 },
    4: { healAtk: 0.15, healAtkDuration: 5, castAspd: 20, castAspdDuration: 8 },
    6: { healAtk: 0.2, healAtkDuration: 5, castAspd: 30, castAspdDuration: 8, fallSp: 2 },
    8: { healAtk: 0.25, healAtkDuration: 5, castAspd: 30, castAspdDuration: 8, fallSp: 2, castSp: 3 },
    10: { healAtk: 0.3, healAtkDuration: 5, castAspd: 40, castAspdDuration: 8, fallSp: 2, castSp: 3, teamWide: 1 },
  }) }),
  ammo: freeze({ mechanic: 'precision', tiers: tiers({
    2: { atk: 0.1 },
    4: { atk: 0.18, defIgnore: 0.15 },
    6: { atk: 0.25, defIgnore: 0.3, resIgnore: 0.3, rangedAtk: 0.1 },
  }) }),
  arts: freeze({ mechanic: 'arcane_mark', tiers: tiers({
    2: { artsMark: 0.1, markDuration: 3 },
    4: { artsMark: 0.18, markDuration: 3 },
    6: { artsMark: 0.25, markDuration: 3, lowHealth: 0.5 },
    8: { artsMark: 0.35, markDuration: 3, lowHealth: 0.5, teamWide: 1 },
  }) }),
  sentinel: freeze({ mechanic: 'hold_the_line', tiers: tiers({
    2: { blockFragile: 0.15 },
    4: { blockFragile: 0.2, blockBonus: 1 },
    6: { blockFragile: 0.3, blockBonus: 1, counterDamage: 1 },
  }) }),
  bruiser: freeze({ mechanic: 'heavy_strike', tiers: tiers({
    2: { hpStrike: 0.03 },
    4: { hpStrike: 0.05, blockedAspd: 20 },
    6: { hpStrike: 0.08, blockedAspd: 30, stunEvery: 4, stunDuration: 1 },
  }) }),
  watcher: freeze({ mechanic: 'watch_slow', tiers: tiers({
    2: { rangeSlow: 0.15 },
    4: { rangeSlow: 0.25, rangeFragile: 0.1 },
    6: { rangeSlow: 0.35, rangeFragile: 0.2 },
  }) }),
  redeploy: freeze({ mechanic: 'raid_relocate', tiers: tiers({
    2: { idleSeconds: 8, jumpAtk: 0.15, jumpDuration: 8 },
    3: { idleSeconds: 6, jumpAtk: 0.2, jumpDuration: 8 },
    4: { idleSeconds: 5, jumpAtk: 0.25, jumpDuration: 8, hpBonus: 0.15 },
    5: { idleSeconds: 4, jumpAtk: 0.35, jumpDuration: 8, hpBonus: 0.25, landingDamage: 1 },
  }) }),
  logistics: freeze({ mechanic: 'skill_refund', tiers: tiers({
    2: { refundChance: 0.25, refundSp: 8 },
    4: { refundChance: 0.4, refundSp: 10 },
    6: { refundChance: 0.55, refundSp: 12 },
    8: { refundChance: 0.7, refundSp: 15, teamChance: 0.25, teamSp: 8 },
  }) }),
});
export const STRONGHOLD_PACT_IDS = freeze(Object.keys(STRONGHOLD_PACT_TIERS));

/**
 * Season-1 adapters kept for the other nine pacts, with values brought into the faction magnitude (owner rule 4:
 * conditional damage ≤ 45 %, standing stats ≤ 20 % outside a top tier) and in-battle stacking capped (rule 6).
 */
export const STRONGHOLD_PACT_TUNING = freeze({
  combo: tiers({ 2: { MinBonusAS: 0.15, MaxBonusAS: 0.4 }, 3: { MinBonusAS: 0.2, MaxBonusAS: 0.5 }, 4: { MinBonusAS: 0.25, MaxBonusAS: 0.6 } }),
  artillery: tiers({ 2: { AD: 0.1 }, 4: { AD: 0.18 }, 6: { AD: 0.25 } }),
  // no defense-first forms: the front form slows what it hits instead of taking less damage
  formSwap: tiers({ 2: { DA: 0.15, DR: 0, FrontSlow: 0.3, FrontSlowDuration: 2 }, 4: { DA: 0.25, DR: 0, FrontSlow: 0.45, FrontSlowDuration: 2 } }),
  // the first enemy in range brings SP (a skill sooner) instead of a 屏障
  dominator: tiers({ 2: { APCapPercent: 25, SpOnFirstContact: 5 }, 4: { APCapPercent: 35, SpOnFirstContact: 8 }, 6: { APCapPercent: 45, SpOnFirstContact: 12 } }),
  // no lifesteal or emergency heal: below half health the member attacks faster instead
  breaker: tiers({ 2: { OmnivampPercent: 0, HealPercent: 0, LowHealthAspd: 20 }, 4: { OmnivampPercent: 0, HealPercent: 0, LowHealthAspd: 30 },
    6: { OmnivampPercent: 0, HealPercent: 0, LowHealthAspd: 40 }, 8: { OmnivampPercent: 0, HealPercent: 0, LowHealthAspd: 60, TrueDamagePercent: 0.35 } }),
  // 号角: a fixed native DEF% / RES share replaces the win-count armor rating (no growth across battles)
  emissary: tiers({ 1: { AmbessaDefPct: 0.08, AmbessaResFlat: 8 }, 4: { AmbessaDefPct: 0.08, AmbessaResFlat: 8 } }),
});

/** Season-1 economies that depend on a replaced faction mechanism; they never trigger in season 2. */
export const STRONGHOLD_RETIRED_ECONOMY_TRAITS = freeze(['academy', 'risk', 'conqueror', 'rhodes']);
/** Season-1 augments whose only consumer was a replaced mechanism (sponsor items, crystal blasts). */
export const STRONGHOLD_RETIRED_AUGMENTS = freeze(['TFT13_Augment_AcademyCrown', 'TFT13_Augment_Automata']);
/** Reward items whose season-1 item no longer exists in season 2, by source item name → the native item granted instead. */
export const STRONGHOLD_REWARD_ITEM_SUBSTITUTIONS = freeze({ Guardbreaker: 'hurricane' });
/**
 * Season-2 strategy corrections by source augment: extra variables for the battle adapter and handwritten player copy.
 * 迅击爆发 counts its bursts from each member's first attack (the field is empty when the battle starts); 坚阵盾击 and
 * 卡西米尔断头台 give native DEF / RES instead of the source defense ratings (values measured on the members: rating
 * +5% ≈ DEF +4%, +5 rating per execution ≈ DEF +7–15% and RES +4); 守望战痕 stacks are capped.
 */
const pct = (value) => `${Number((Number(value) * 100).toFixed(1))}%`;
export const STRONGHOLD_STRATEGY_OVERRIDES = freeze({
  TFT13_Augment_Quickstriker: freeze({
    variables: freeze({ StartOnFirstAttack: 1 }),
    adaptation: (v) => `【迅击】干员首次攻击时及之后每${Number(v.TimeBetweenProcs)}秒，攻击速度+${Math.round(Number(v.AttackSpeed) * 100)}，持续${Number(v.BuffDuration)}秒。`,
  }),
  TFT13_Augment_Bruiser: freeze({
    adaptation: (v) => `每${Number(v.RefreshSeconds)}秒，【重装】干员的下一次攻击额外造成相当于自身生命上限${pct(v.SlamPercentHealth)}的物理伤害。`,
  }),
  TFT13_Augment_Dominator: freeze({
    adaptation: (v) => `【掌控】干员持有屏障时攻击速度+${Math.round(Number(v.ShieldPercentAS) * 100)}；【掌控】干员击倒敌人后，所有【掌控】干员获得${Number(v.ShieldAmount)}点屏障，持续${Number(v.ShieldDuration)}秒。`,
  }),
  TFT13_Augment_Sentinel: freeze({
    variables: freeze({ NativeDefPct: 0.05 }),
    adaptation: (v) => `【坚阵】干员防御力+${pct(v.NativeDefPct)}；每${Number(v.Interval)}秒，下一次攻击额外造成相当于自身防御力与法术抗性之和${pct(v.ResistToDamageRatio)}的法术伤害。`,
  }),
  TFT13_Augment_Conqueror: freeze({
    variables: freeze({ NativeDefPctPerKill: 0.08, NativeResPerKill: 4, MaxKills: 5 }),
    adaptation: (v) => `【卡西米尔】干员对生命低于${Number(v.BaseExecuteThreshold)}%的敌人造成伤害时，直接将其击倒；每以此击倒1名敌人，防御力+${pct(v.NativeDefPctPerKill)}、法术抗性+${Number(v.NativeResPerKill)}，至多叠加${Number(v.MaxKills)}次。`,
  }),
  TFT13_Augment_Sorcerer: freeze({
    adaptation: (v) => `【术式】干员倒下时，对周围8格内的敌人造成相当于其攻击力${pct(v.DeathPercentage)}的法术伤害。`,
  }),
  TFT13_Augment_Watcher: freeze({
    variables: freeze({ MaxStacks: 10 }),
    adaptation: (v) => `【守望】干员每受到1次攻击，攻击力+${Number(v.IncreaseADByTakeAttack)}%；每受到1次技能伤害，法术伤害+${Number(v.IncreaseAPByTakeSpell)}%；各至多叠加${Number(v.MaxStacks)}次。`,
  }),
});
/** The one equipment slot count the temporary 维式重锤 fills up to. */
export const STRONGHOLD_EQUIPMENT_SLOTS = 3;
/** The component the 维多利亚 pact hands out (its display name comes from the equipment catalogue). */
export const STRONGHOLD_HAMMER_ITEM_ID = 'blade';

const p = (value) => `${Number((Number(value ?? 0) * 100).toFixed(1))}%`;
const n = (value) => `${Number(Number(value ?? 0).toFixed(2))}`;

/** Handwritten player copy for every season-2 pact: { overview, tier(tier) }. */
export function strongholdPactCopy(trait, season, { itemName = (id) => id } = {}) {
  const hero = (api) => season.heroes.find((row) => row.apiName === api)?.operatorName ?? '';
  const hammer = itemName(STRONGHOLD_HAMMER_ITEM_ID);
  const table = {
    academy: ['敌人出场后，场上生命上限最高的敌人（精英、领袖优先）被通缉；更强的敌人出场或被通缉的敌人倒下时，通缉随之转移。', (v) => [
      `同时通缉${v.wantedCount}名；【拉特兰】干员对被通缉的敌人伤害+${p(v.wantedDamage)}。`,
      v.ammoBonus ? `技能获得的弹药+${p(v.ammoBonus)}，没有弹药的技能持续时间+${p(v.durationBonus)}。` : '',
      v.wantedKillSp ? `被通缉的敌人被击倒时，所有【拉特兰】干员回复${v.wantedKillSp}点技力。` : '',
    ]],
    creation: ['【谢拉格】干员的攻击使目标寒冷；已寒冷的敌人再次寒冷时会被冻结。', (v) => [
      `攻击使目标寒冷${n(v.chillDuration)}秒（同一目标每${n(v.chillCooldown)}秒至多一次）；对寒冷或冻结的敌人伤害+${p(v.coldDamage)}。`,
      v.windInterval ? `场上有敌人时，每${n(v.windInterval)}秒刮起寒风，使全场敌人寒冷${n(v.windDuration)}秒。` : '',
    ]],
    sui: ['开战时在【炎】干员附近召唤“炎佑”。炎佑追踪威胁最大的敌人，攻击附带攻击力20%的灼燃损伤，附近的敌人受到元素脆弱。', (v) => [
      `${v.guardianCount > 1 ? `召唤${v.guardianCount}只炎佑，` : ''}炎佑的攻击力、生命上限为【炎】干员开战时总和的${p(v.guardianShare)}，同时攻击${v.guardianTargets}个目标${v.guardianDamageTaken ? `，受到的伤害-${p(v.guardianDamageTaken)}` : ''}。`,
      v.summonAttack ? `【炎】干员的召唤物攻击力+${p(v.summonAttack)}。` : '',
      v.flameInterval ? `炎佑身边有敌人时使用“祛恶之焰”（每${n(v.flameInterval)}秒至多一次），对周围敌人造成攻击力${p(v.flameDamage)}的法术伤害，并使其受到${p(v.flameFragile)}的元素脆弱，持续${n(v.flameFragileDuration)}秒。` : '',
    ]],
    flight: ['【深海猎人】干员猎杀受伤的敌人：对生命低于一半的敌人伤害提升，击倒敌人后攻击速度提升。', (v) => [
      `对生命低于${p(v.huntThreshold)}的敌人伤害+${p(v.huntDamage)}；击倒敌人后攻击速度+${v.killAspd}，持续${n(v.killAspdDuration)}秒。`,
      v.reviveHealth ? `首次被击倒时立即以${p(v.reviveHealth)}生命复活（每名每场一次）。` : '',
      v.executeThreshold ? `攻击生命低于${p(v.executeThreshold)}的敌人（领袖除外）时直接将其击倒。` : '',
    ]],
    resistance: ['【维多利亚】干员每携带1件装备，攻击力提升；合成装备效果更高。', (v) => [
      `每携带1件组件，攻击力+${p(v.perComponent)}；每携带1件合成装备，攻击力+${p(v.perCompleted)}。`,
      v.hammerEvery ? `每${v.hammerEvery}场战斗获得1件“${hammer}”。` : '',
      v.temporaryHammer ? `开战时，装备未满的【维多利亚】干员临时携带1件${hammer}，战斗结束后消失。` : '',
      v.othersShare ? `其他干员获得一半效果。` : '',
    ]],
    risk: ['【叙拉古】干员首次攻击后攻击速度提升；高档时开战即进入隐匿，以首次攻击伏击敌人，并使敌人恐惧。', (v) => [
      v.openingDuration > 0 ? `首次攻击后${n(v.openingDuration)}秒内攻击速度+${v.openingAspd}。` : `攻击速度+${v.openingAspd}，持续整场战斗。`,
      v.stealth ? `开战时进入隐匿，首次攻击时脱离隐匿，这次攻击伤害+${p(v.ambushDamage)}。` : '',
      v.fearChance ? `首次攻击后${n(v.fearWindow)}秒内，攻击有${p(v.fearChance)}概率使目标恐惧${n(v.fearDuration)}秒。` : '',
      v.fearDamage ? `对恐惧中的敌人伤害+${p(v.fearDamage)}。` : '',
    ]],
    conqueror: ['【卡西米尔】干员的攻击附带真实伤害；阻挡敌人时冲击周围。', (v) => [
      `攻击额外附带攻击力${p(v.attackTrue)}的真实伤害。`,
      v.blockPulse ? `阻挡敌人时，每${n(v.blockInterval)}秒对周围8格内的敌人造成攻击力${p(v.blockPulse)}的真实伤害${v.blockStun ? `并使其晕眩${n(v.blockStun)}秒` : ''}。` : '',
      v.othersTrue ? `其他干员的攻击附带攻击力${p(v.othersTrue)}的真实伤害。` : '',
    ]],
    experiment: ['任一【萨尔贡】干员开启技能时，所有【萨尔贡】干员获得强化；再次触发只刷新持续时间。', (v) => [
      `攻击速度+${v.castAspd}${v.castAtk ? `、攻击力+${p(v.castAtk)}` : ''}，持续${n(v.castDuration)}秒。`,
      v.sandSlow ? `开启技能的干员在所在位置及周围8格留下流沙，使其中的敌人减速${p(v.sandSlow)}，持续${n(v.sandDuration)}秒。` : '',
      v.relaySp ? `其他【萨尔贡】干员回复${v.relaySp}点技力（每名每秒至多一次）。` : '',
    ]],
    rhodes: ['【哥伦比亚】干员开启技能时，对攻击范围内的所有敌人造成法术伤害并使其晕眩。', (v) => [
      `造成攻击力${p(v.castBlast)}的法术伤害，晕眩${n(v.castStun)}秒。`,
      v.stunFragile ? `被这样晕眩的敌人在晕眩期间受到的伤害+${p(v.stunFragile)}。` : '',
      v.summonBlast ? '【哥伦比亚】干员的召唤物和装置部署时也释放一次。' : '',
    ]],
    enforcer: ['受到【罗德岛】干员治疗的友军攻击力提升；【罗德岛】干员开启技能时鼓舞身边的友军。', (v) => [
      `受到【罗德岛】干员治疗的友军攻击力+${p(v.healAtk)}，持续${n(v.healAtkDuration)}秒。`,
      v.castAspd ? `【罗德岛】干员开启技能时，${v.teamWide ? '全体友军' : '自身及周围8格内的友军'}攻击速度+${v.castAspd}，持续${n(v.castAspdDuration)}秒${v.castSp ? `，其他【罗德岛】干员回复${v.castSp}点技力（每名每秒至多一次）` : ''}。` : '',
      v.fallSp ? `攻击范围内的敌人倒下时，【罗德岛】干员回复${v.fallSp}点技力（每名每秒至多一次）。` : '',
    ]],
    ammo: ['【狙击】干员攻击力提升，高档时攻击无视部分防御。', (v) => [
      `攻击力+${p(v.atk)}。`,
      v.defIgnore ? `攻击无视目标${p(v.defIgnore)}的防御${v.resIgnore ? `和${p(v.resIgnore)}的法术抗性` : ''}。` : '',
      v.rangedAtk ? `其他远程干员攻击力+${p(v.rangedAtk)}。` : '',
    ]],
    arts: ['【术式】干员的攻击使目标在3秒内受到的法术伤害提升。', (v) => [
      `目标受到${v.teamWide ? '全体友军' : '【术式】干员'}的法术伤害+${p(v.artsMark)}${v.lowHealth ? `；目标生命低于${p(v.lowHealth)}时效果翻倍` : ''}。`,
    ]],
    sentinel: ['【坚阵】干员能阻挡更多敌人，被其阻挡的敌人受到的伤害提升。', (v) => [
      `被【坚阵】干员阻挡的敌人受到的伤害+${p(v.blockFragile)}。`,
      v.blockBonus ? `阻挡数+${v.blockBonus}。` : '',
      v.counterDamage ? `受到被阻挡敌人的攻击时，对其造成攻击力${p(v.counterDamage)}的法术伤害（每秒至多一次）。` : '',
    ]],
    redeploy: ['【突袭】干员一段时间未攻击且攻击范围内没有敌人时，保留技力转移到能攻击到最近地面敌人的位置。', (v) => [
      `连续${n(v.idleSeconds)}秒未攻击后转移；转移后${n(v.jumpDuration)}秒内攻击力+${p(v.jumpAtk)}。`,
      v.hpBonus ? `生命上限+${p(v.hpBonus)}。` : '',
      v.landingDamage ? `转移时对周围敌人造成攻击力${p(v.landingDamage)}的物理伤害。` : '',
    ]],
    logistics: ['【技力协同】干员技能结束时，有概率立即回复技力。', (v) => [
      `${p(v.refundChance)}概率回复${v.refundSp}点技力。`,
      v.teamChance ? `其他干员技能结束时有${p(v.teamChance)}概率回复${v.teamSp}点技力。` : '',
    ]],
    bruiser: ['【重装】干员的攻击额外造成相当于自身生命上限一定比例的物理伤害；高档时被其阻挡的敌人攻击速度降低。', (v) => [
      `攻击额外造成相当于自身生命上限${p(v.hpStrike)}的物理伤害。`,
      v.blockedAspd ? `被【重装】干员阻挡的敌人攻击速度-${v.blockedAspd}。` : '',
      v.stunEvery ? `每${n(v.stunEvery)}秒，下一次攻击使目标晕眩${n(v.stunDuration)}秒。` : '',
    ]],
    watcher: ['【守望】干员攻击范围内的敌人移动速度降低。', (v) => [
      `攻击范围内的敌人移动速度-${p(v.rangeSlow)}。`,
      v.rangeFragile ? `攻击范围内的敌人受到的伤害+${p(v.rangeFragile)}。` : '',
    ]],
    dominator: ['敌人首次进入【掌控】干员的攻击范围时，该干员回复技力；开启技能消耗的技力会提升其法术伤害。', (v) => [
      `敌人首次进入攻击范围时回复${v.SpOnFirstContact}点技力；每消耗1点技力，法术伤害+${n(v.APPercent)}%，至多+${n(v.APCapPercent)}%。`,
    ]],
    breaker: ['【决斗】干员造成伤害时追加真实伤害；生命低于一半时攻击速度提升。', (v) => [
      `造成伤害时，追加相当于该伤害${p(v.TrueDamagePercent)}的真实伤害；生命低于${p(v.HealthThreshold)}时攻击速度+${v.LowHealthAspd}。`,
    ]],
    combo: ['【迅击】干员的目标已损失的生命越多，攻击速度越高。', (v) => [
      `攻击速度+${Math.round(v.MinBonusAS * 100)}至+${Math.round(v.MaxBonusAS * 100)}。`,
      v.ShieldAmount ? `击倒目标后转移到下一名敌人身边，获得${Math.round(v.ShieldAmount)}点屏障，持续${n(v.ShieldDuration)}秒。` : '',
    ]],
    artillery: ['【连轰】干员攻击力提升，每数次攻击发射炮弹轰击目标周围。', (v) => [
      `攻击力+${p(v.AD)}；每${v.NumOfAttacks}次攻击对目标周围造成攻击力${p(v.PercentDamage)}的物理伤害。`,
    ]],
    formSwap: ['【双形】干员按部署的排数切换形态：靠前两排的攻击使敌人减速，靠后两排伤害更高。', (v) => [
      `靠前时攻击使目标减速${p(v.FrontSlow)}，持续${n(v.FrontSlowDuration)}秒；靠后时伤害+${p(v.DA)}。`,
    ]],
    emissary: ['仅在恰好上阵1名或4名【领军】干员时生效；每名成员提供自己的效果。', (v, tier) => [
      `${hero('TFT13_Tristana')}：全体友军每星攻击速度+${Math.round(v.StarAS * 100)}；${hero('TFT13_Nami')}：全体友军每次攻击额外回复${v.NamiMana}点技力；${hero('TFT13_Ambessa')}：全体友军防御力+${p(v.AmbessaDefPct)}，法术抗性+${n(v.AmbessaResFlat)}；${hero('TFT13_Garen')}：自身与左右相邻友军获得其最大生命${p(v.GarenHealthPercent)}的生命。`,
      tier.minUnits === 4 ? `4名【领军】干员各额外获得${Math.round(v.BonusHealth)}点生命，伤害+${p(v.SelfishDamageAmp)}。` : '',
    ]],
    family: ['【同袍】干员攻击速度提升、受到的伤害降低，技能所需技力减少。', (v) => [
      `攻击速度+${Math.round(v.AttackSpeed * 100)}，受到的伤害-${p(v.DamageReduction)}，技能所需技力-${p(v.ManaReduction)}。`,
      v['{01fcc30b}'] != null ? '战斗结束后，每名存活的【同袍】干员积累1点行动进度，达到10、17、20、30点时各领取一次奖励。' : '',
    ]],
    holyGun: [`${hero('TFT13_Lieutenant') || '【圣枪】干员'}开启技能时随机获得一种强化。`, (v) => [
      `发射${v.Bonus1NumRockets}枚炮弹，每枚造成${Math.round(v.Bonus1RocketDamage)}点物理伤害；或获得${Math.round(v.Bonus2ShieldAmount)}点屏障，持续${n(v.Bonus2ShieldDuration)}秒；或战斗结束时获得${v.Bonus4Gold}金币；也可能使上次的强化变为三倍。开启技能后${n(v.Duration)}秒内受到的伤害-${p(v.Durability)}。`,
    ]],
    armory: [`每隔数场战斗开放一次升级，为场上最强的${hero('TFT13_Rumble') || '【铸军】干员'}购买强化。`, (v) => [
      `每${v.NumRounds1Star}场战斗开放一次，按标价购买，也可以略过。`,
    ]],
  };
  const row = table[trait.id];
  if (!row) throw new Error(`STRONGHOLD_PACT_COPY_MISSING:${trait.id}`);
  return { overview: row[0], tier: (tier) => row[1](tier.variables ?? {}, tier).filter(Boolean).join('') };
}
