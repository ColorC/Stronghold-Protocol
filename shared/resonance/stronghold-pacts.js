/**
 * Faction season 2 pact design: non-stacking Stronghold Protocol style pacts.
 *
 * Members, activation tiers, natural fees and emblems are inherited unchanged from faction season 1; this module only
 * replaces what each tier does. Ten factions and five combat pacts receive a redesigned battlefield mechanism
 * (`STRONGHOLD_PACT_TIERS`, consumed by server/sim/content/resonance/stronghold-pacts.js); the remaining eleven keep their
 * season-1 adapter with the value corrections in `STRONGHOLD_PACT_TUNING`. Nothing grows across battles except the
 * season-1 Family, Junker King and High Roller economies, which the owner kept.
 *
 * Player copy is handwritten per pact: the overview carries the shared rule once, every tier names its own values.
 */
const freeze = (value) => Object.freeze(value);
const tiers = (rows) => freeze(Object.fromEntries(Object.entries(rows).map(([minUnits, variables]) => [minUnits, freeze({ ...variables })])));

export const STRONGHOLD_PACT_TIERS = freeze({
  academy: freeze({ mechanic: 'wanted_ammo', tiers: tiers({
    3: { wantedCount: 1, wantedInterval: 15, wantedDamage: 0.2 },
    4: { wantedCount: 1, wantedInterval: 15, wantedDamage: 0.3, ammoBonus: 0.3, durationBonus: 0.2 },
    5: { wantedCount: 2, wantedInterval: 15, wantedDamage: 0.3, ammoBonus: 0.3, durationBonus: 0.2, wantedKillSp: 4 },
    6: { wantedCount: 3, wantedInterval: 15, wantedDamage: 0.45, ammoBonus: 0.5, durationBonus: 0.3, wantedKillSp: 6 },
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
  flight: freeze({ mechanic: 'abyssal_undying', tiers: tiers({
    2: { hpBonus: 0.15, regenRatio: 0.01 },
    3: { hpBonus: 0.15, regenRatio: 0.01, reviveHealth: 0.5 },
    4: { hpBonus: 0.15, regenRatio: 0.02, reviveHealth: 0.5, huntThreshold: 0.5, huntDamage: 0.3, killHeal: 0.08 },
  }) }),
  resistance: freeze({ mechanic: 'victoria_equipment', tiers: tiers({
    3: { perComponent: 0.06, perCompleted: 0.1 },
    5: { perComponent: 0.1, perCompleted: 0.15, hammerEvery: 3 },
    7: { perComponent: 0.14, perCompleted: 0.2, hammerEvery: 3, temporaryHammer: 1 },
    10: { perComponent: 0.2, perCompleted: 0.3, hammerEvery: 3, temporaryHammer: 1, othersShare: 0.5 },
  }) }),
  risk: freeze({ mechanic: 'stealth_ambush_fear', tiers: tiers({
    3: { openingAspd: 25, openingDuration: 20 },
    4: { openingAspd: 25, openingDuration: 20, stealthDuration: 6, ambushDamage: 0.5 },
    5: { openingAspd: 35, openingDuration: 25, stealthDuration: 6, ambushDamage: 0.5, fearChance: 0.15, fearDuration: 2, fearWindow: 10 },
    6: { openingAspd: 35, openingDuration: 25, stealthDuration: 8, ambushDamage: 0.5, fearChance: 0.2, fearDuration: 2, fearWindow: 10, fearDamage: 0.3 },
    7: { openingAspd: 50, openingDuration: 0, stealthDuration: 8, ambushDamage: 0.5, fearChance: 0.25, fearDuration: 3, fearWindow: 10, fearDamage: 0.3 },
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
  rhodes: freeze({ mechanic: 'barrier_burst', tiers: tiers({
    2: { barrier: 0.12 },
    4: { barrier: 0.2, breakDamage: 1.5, breakStun: 1 },
    6: { barrier: 0.28, breakDamage: 1.5, breakStun: 1, rebarrierDelay: 12, rebarrierCount: 2 },
    9: { barrier: 0.4, breakDamage: 2.5, breakStun: 1, rebarrierDelay: 12, rebarrierCount: 2, summonBarrier: 1 },
  }) }),
  enforcer: freeze({ mechanic: 'medical_relay', tiers: tiers({
    2: { healingTaken: 0.15 },
    4: { healingTaken: 0.25, castHeal: 0.08 },
    6: { healingTaken: 0.35, castHeal: 0.08, overflowBarrier: 0.15 },
    8: { healingTaken: 0.35, castHeal: 0.12, overflowBarrier: 0.15, fallSp: 2 },
    10: { healingTaken: 0.35, castHeal: 0.12, overflowBarrier: 0.25, fallSp: 2, teamWide: 1 },
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
  sentinel: freeze({ mechanic: 'guard_share', tiers: tiers({
    2: { hpBonus: 0.2 },
    4: { hpBonus: 0.3, guardShare: 0.2 },
    6: { hpBonus: 0.4, guardShare: 0.35, counterDamage: 1, counterFragile: 0.2, counterDuration: 5 },
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
 * Season-1 adapters kept for the other eleven pacts, with values brought into the faction magnitude (owner rule 4:
 * conditional damage ≤ 45 %, standing stats ≤ 20 % outside a top tier) and in-battle stacking capped (rule 6).
 */
export const STRONGHOLD_PACT_TUNING = freeze({
  bruiser: tiers({ 2: { BonusPercentHealth: 0.2 }, 4: { BonusPercentHealth: 0.3 }, 6: { BonusPercentHealth: 0.4 } }),
  watcher: tiers({ 2: { BaseDR: 0.1, IncreasedDR: 0.2 }, 4: { BaseDR: 0.15, IncreasedDR: 0.3 }, 6: { BaseDR: 0.2, IncreasedDR: 0.35 } }),
  combo: tiers({ 2: { MinBonusAS: 0.15, MaxBonusAS: 0.4 }, 3: { MinBonusAS: 0.2, MaxBonusAS: 0.5 }, 4: { MinBonusAS: 0.25, MaxBonusAS: 0.6 } }),
  artillery: tiers({ 2: { AD: 0.1 }, 4: { AD: 0.18 }, 6: { AD: 0.25 } }),
  formSwap: tiers({ 2: { DA: 0.15, DR: 0.1 }, 4: { DA: 0.25, DR: 0.2 } }),
  dominator: tiers({ 2: { APCapPercent: 25 }, 4: { APCapPercent: 35 }, 6: { APCapPercent: 45 } }),
  breaker: tiers({ 8: { TrueDamagePercent: 0.35 } }),
});

/** Season-1 economies that depend on a replaced faction mechanism; they never trigger in season 2. */
export const STRONGHOLD_RETIRED_ECONOMY_TRAITS = freeze(['academy', 'risk', 'conqueror', 'rhodes']);
/** Season-1 augments whose only consumer was a replaced mechanism (sponsor items, crystal blasts). */
export const STRONGHOLD_RETIRED_AUGMENTS = freeze(['TFT13_Augment_AcademyCrown', 'TFT13_Augment_Automata']);
/** 号角's defence share counts this many settled wins, fixed: pact effects never grow across battles. */
export const STRONGHOLD_EMISSARY_FIXED_WINS = 4;
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
    academy: ['开战时及之后每15秒，通缉生命最高的敌人（精英、领袖优先）。', (v) => [
      `同时通缉${v.wantedCount}名；【拉特兰】干员对被通缉的敌人伤害+${p(v.wantedDamage)}。`,
      v.ammoBonus ? `技能获得的弹药+${p(v.ammoBonus)}，没有弹药的技能持续时间+${p(v.durationBonus)}。` : '',
      v.wantedKillSp ? `被通缉的敌人被击倒时，所有【拉特兰】干员回复${v.wantedKillSp}点技力。` : '',
    ]],
    creation: ['【谢拉格】干员的攻击使目标寒冷；已寒冷的敌人再次寒冷时会被冻结。', (v) => [
      `攻击使目标寒冷${n(v.chillDuration)}秒（同一目标每${n(v.chillCooldown)}秒至多一次）；对寒冷或冻结的敌人伤害+${p(v.coldDamage)}。`,
      v.windInterval ? `每${n(v.windInterval)}秒刮起寒风，使全场敌人寒冷${n(v.windDuration)}秒。` : '',
    ]],
    sui: ['开战时在【炎】干员附近召唤“炎佑”。炎佑追踪威胁最大的敌人，攻击附带攻击力20%的灼燃损伤，附近的敌人受到元素脆弱。', (v) => [
      `${v.guardianCount > 1 ? `召唤${v.guardianCount}只炎佑，` : ''}炎佑的攻击力、生命上限为【炎】干员开战时总和的${p(v.guardianShare)}，同时攻击${v.guardianTargets}个目标${v.guardianDamageTaken ? `，受到的伤害-${p(v.guardianDamageTaken)}` : ''}。`,
      v.summonAttack ? `【炎】干员的召唤物攻击力+${p(v.summonAttack)}。` : '',
      v.flameInterval ? `炎佑每${n(v.flameInterval)}秒使用“祛恶之焰”，对周围敌人造成攻击力${p(v.flameDamage)}的法术伤害，并使其受到${p(v.flameFragile)}的元素脆弱，持续${n(v.flameFragileDuration)}秒。` : '',
    ]],
    flight: ['【深海猎人】干员生命上限提升，并持续回复生命。', (v) => [
      `生命上限+${p(v.hpBonus)}，每秒回复${p(v.regenRatio)}最大生命。`,
      v.reviveHealth ? `首次被击倒时立即以${p(v.reviveHealth)}生命复活（每名每场一次）。` : '',
      v.huntDamage ? `攻击生命低于${p(v.huntThreshold)}的敌人时伤害+${p(v.huntDamage)}；击倒敌人后回复${p(v.killHeal)}最大生命。` : '',
    ]],
    resistance: ['【维多利亚】干员每携带1件装备，攻击力提升；合成装备效果更高。', (v) => [
      `每件组件攻击力+${p(v.perComponent)}，每件合成装备+${p(v.perCompleted)}。`,
      v.hammerEvery ? `每${v.hammerEvery}场战斗获得1件“${hammer}”。` : '',
      v.temporaryHammer ? `开战时，装备未满的【维多利亚】干员临时携带1件${hammer}，战斗结束后消失。` : '',
      v.othersShare ? `其他干员获得一半效果。` : '',
    ]],
    risk: ['【叙拉古】干员开战后攻击速度提升；高档开战时进入隐匿，并使敌人恐惧。', (v) => [
      v.openingDuration > 0 ? `开战后${n(v.openingDuration)}秒内攻击速度+${v.openingAspd}。` : `攻击速度+${v.openingAspd}，持续整场战斗。`,
      v.stealthDuration ? `开战时进入隐匿${n(v.stealthDuration)}秒，脱离隐匿后的首次攻击伤害+${p(v.ambushDamage)}。` : '',
      v.fearChance ? `隐匿期间及脱离后${n(v.fearWindow)}秒内，攻击有${p(v.fearChance)}概率使目标恐惧${n(v.fearDuration)}秒。` : '',
      v.fearDamage ? `对恐惧中的敌人伤害+${p(v.fearDamage)}。` : '',
    ]],
    conqueror: ['【卡西米尔】干员的攻击附带真实伤害；阻挡敌人时冲击周围。', (v) => [
      `攻击额外附带攻击力${p(v.attackTrue)}的真实伤害。`,
      v.blockPulse ? `阻挡敌人时，每${n(v.blockInterval)}秒对周围1格的敌人造成攻击力${p(v.blockPulse)}的真实伤害${v.blockStun ? `并使其晕眩${n(v.blockStun)}秒` : ''}。` : '',
      v.othersTrue ? `其他干员的攻击附带攻击力${p(v.othersTrue)}的真实伤害。` : '',
    ]],
    experiment: ['任一【萨尔贡】干员开启技能时，所有【萨尔贡】干员获得强化；再次触发只刷新持续时间。', (v) => [
      `攻击速度+${v.castAspd}${v.castAtk ? `、攻击力+${p(v.castAtk)}` : ''}，持续${n(v.castDuration)}秒。`,
      v.sandSlow ? `开启技能的干员在周围1格留下流沙，使其中的敌人减速${p(v.sandSlow)}，持续${n(v.sandDuration)}秒。` : '',
      v.relaySp ? `其他【萨尔贡】干员回复${v.relaySp}点技力（每名每秒至多一次）。` : '',
    ]],
    rhodes: ['开战时【哥伦比亚】干员获得屏障。', (v) => [
      `屏障为最大生命的${p(v.barrier)}${v.summonBarrier ? '，【哥伦比亚】干员的召唤物和装置也获得屏障' : ''}。`,
      v.breakDamage ? `屏障被击破时，对周围1格的敌人造成攻击力${p(v.breakDamage)}的法术伤害并使其晕眩${n(v.breakStun)}秒。` : '',
      v.rebarrierDelay ? `屏障被击破${n(v.rebarrierDelay)}秒后重新获得（每场至多${v.rebarrierCount}次）。` : '',
    ]],
    enforcer: ['【罗德岛】干员受到的治疗提升，开启技能时照料身边的友军。', (v) => [
      `${v.teamWide ? '全体友军' : '【罗德岛】干员'}受到的治疗+${p(v.healingTaken)}。`,
      v.castHeal ? `【罗德岛】干员开启技能时，使自身或周围8格内生命比例最低的友军回复${p(v.castHeal)}最大生命。` : '',
      v.overflowBarrier ? `${v.teamWide ? '全体友军' : '【罗德岛】干员'}超出生命上限的治疗量转为屏障（至多最大生命的${p(v.overflowBarrier)}）。` : '',
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
    sentinel: ['【坚阵】干员生命上限提升，并替身边的友军承受伤害。', (v) => [
      `生命上限+${p(v.hpBonus)}。`,
      v.guardShare ? `周围8格内其他友军受到伤害的${p(v.guardShare)}改由该【坚阵】干员承受。` : '',
      v.counterDamage ? `承受伤害时，对伤害来源造成攻击力${p(v.counterDamage)}的法术伤害并使其脆弱${p(v.counterFragile)}，持续${n(v.counterDuration)}秒（每秒至多一次）。` : '',
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
    bruiser: ['全体干员生命提升，【重装】干员额外提升生命上限。', (v) => [
      `全体干员生命+${Math.round(v.TeamFlatHealth)}；【重装】干员生命上限另+${p(v.BonusPercentHealth)}。`,
    ]],
    watcher: ['【守望】干员受到的伤害降低；生命高于一半时效果更强。', (v) => [
      `受到的伤害-${p(v.BaseDR)}；生命高于${p(v.HealthBreakpoint)}时改为-${p(v.IncreasedDR)}。`,
    ]],
    dominator: ['开战时【掌控】干员获得屏障；开启技能消耗的技力会提升其法术伤害。', (v) => [
      `开战获得${Math.round(v.ShieldAmount)}点屏障，持续${n(v.ShieldDuration)}秒；每消耗1点技力，法术伤害+${n(v.APPercent)}%，至多+${n(v.APCapPercent)}%。`,
    ]],
    breaker: ['【决斗】干员造成伤害时回复生命并追加真实伤害；首次生命低于一半时迅速回复。', (v) => [
      `造成伤害的${p(v.OmnivampPercent)}回复为生命，并追加${p(v.TrueDamagePercent)}的真实伤害；首次生命低于${p(v.HealthThreshold)}时，${n(v.Duration)}秒内回复${p(v.HealPercent)}最大生命。`,
    ]],
    combo: ['【迅击】干员的目标已损失的生命越多，攻击速度越高。', (v) => [
      `攻击速度+${Math.round(v.MinBonusAS * 100)}至+${Math.round(v.MaxBonusAS * 100)}。`,
      v.ShieldAmount ? `击倒目标后转移到下一名敌人身边，获得${Math.round(v.ShieldAmount)}点屏障，持续${n(v.ShieldDuration)}秒。` : '',
    ]],
    artillery: ['【连轰】干员攻击力提升，每数次攻击发射炮弹轰击目标周围。', (v) => [
      `攻击力+${p(v.AD)}；每${v.NumOfAttacks}次攻击对目标周围造成攻击力${p(v.PercentDamage)}的物理伤害。`,
    ]],
    formSwap: ['【双形】干员按部署的排数切换形态：靠前两排更耐打，靠后两排伤害更高。', (v) => [
      `靠前时受到的伤害-${p(v.DR)}；靠后时伤害+${p(v.DA)}。`,
    ]],
    emissary: ['仅在恰好上阵1名或4名【领军】干员时生效；每名成员提供自己的效果。', (v, tier) => [
      `${hero('TFT13_Tristana')}：全体友军每星攻击速度+${Math.round(v.StarAS * 100)}；${hero('TFT13_Nami')}：全体友军每次攻击额外回复${v.NamiMana}点技力；${hero('TFT13_Ambessa')}：全体友军防御和法术抗性提升；${hero('TFT13_Garen')}：自身与左右相邻友军获得其最大生命${p(v.GarenHealthPercent)}的生命。`,
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
