// Deterministic source/effect coverage generator for the Assault module worker.
// Run from the repository root with Node; the generated JSON is the only output.
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');
const runtime = JSON.parse(read('data/assault-runtime.json'));
const roster = JSON.parse(read('data/assault-design/roster-assault.json'));
const forms = JSON.parse(read('data/assault-design/forms.json'));
const ranged = JSON.parse(read('data/assault-design/roster-ranged.json'));
const previous = JSON.parse(read('data/assault-coverage-assault-modules.json'));

const delegated = new Set([
  'uniequip_002_amiya2', 'uniequip_002_amiya3', 'uniequip_002_angel2', 'uniequip_002_estell',
  'uniequip_002_etlchi', 'uniequip_002_gvial2', 'uniequip_002_humus', 'uniequip_002_robin',
  'uniequip_002_skadi', 'uniequip_002_surtr', 'uniequip_002_svrash', 'uniequip_002_swire2',
  'uniequip_002_thorn2', 'uniequip_002_tinman', 'uniequip_002_utage', 'uniequip_003_etlchi',
  'uniequip_003_skadi', 'uniequip_003_surtr',
]);
const operators = [...roster.operators, ...forms.forms, ...ranged.operators.filter((entry) => entry.charId === 'char_393_toledo')];
const bodies = operators.map((entry) => runtime.bodies[entry.charId]);
const sourceEffects = (body) => [
  ...(body.fixedSkill?.effects ?? []).map((effect, index) => ({ source: `fixedSkill:${index}`, effect })),
  ...(body.modePassives ?? []).map((effect, index) => ({ source: `modePassive:${index}`, effect })),
];
const valuesAt = (values, rank) => Object.fromEntries(Object.entries(values ?? {})
  .map(([name, value]) => [name, Array.isArray(value) && value.length === 4 ? value[rank - 1] : value]));
const key = ({ source, effect }, rank) => `${source}:${effect.action}:${Object.entries(effect.values ?? {})
  .map(([name, value]) => `${name}=${Array.isArray(value) ? value[rank - 1] : value}`).join(';')}`;

const exactDFile = 'test/assault/assault-source-exact-d.test.mjs';
const exactDTests = read(exactDFile);
const exactDTitles = {
  ghost: 'exact-d Ghost R3/R4 natural SP_FULL installs literal attack, barrier, and undeath; threshold heal is once per battle',
  talr: 'exact-d Talr R3/R4 natural SP_FULL binds four targets, ticks literal damage once per second, and spends the selected module cost',
  mizuki: 'exact-d Mizuki R3/R4 natural SP_FULL hits exact target caps and applies the real under-three HP cost before/after the selected module',
};
const exactSourceProofs = new Map([
  ['char_143_ghost:fixedSkill:0:addBuff', [{ atkBonus: 1.4, barrierRatio: 0.6, undeathDuration: 9 }, { atkBonus: 1.6, barrierRatio: 0.7, undeathDuration: 10 }, exactDTitles.ghost]],
  ['char_143_ghost:modePassive:0:heal', [{ healRatio: 0.4, perBattle: 1 }, { healRatio: 0.5, perBattle: 1 }, exactDTitles.ghost]],
  ['char_4155_talr:fixedSkill:0:applyStatus', [{ rootDuration: 3.5, maxTarget: 4 }, { rootDuration: 4, maxTarget: 4 }, exactDTitles.talr]],
  ['char_4155_talr:fixedSkill:1:damage', [{ atkScalePerSec: 1.6, interval: 1 }, { atkScalePerSec: 1.8, interval: 1 }, exactDTitles.talr]],
  ['char_4155_talr:fixedSkill:2:spCost', [{ deployPointCost: 3 }, { deployPointCost: 3 }, exactDTitles.talr]],
  ['char_4155_talr:modePassive:0:growth', [{ atkPerDeployPoint: 0.03, cap: 0.3 }, { atkPerDeployPoint: 0.035, cap: 0.35 }, exactDTitles.talr]],
  ['char_437_mizuki:fixedSkill:0:damage', [{ atkScale: 1.35, maxTarget: 3, rangeExtend: 1, damageType: '法术' }, { atkScale: 1.5, maxTarget: 4, rangeExtend: 1, damageType: '法术' }, exactDTitles.mizuki]],
  ['char_437_mizuki:fixedSkill:2:applyStatus', [{ selfMaxHpCostRatio: 0.12 }, { selfMaxHpCostRatio: 0.12 }, exactDTitles.mizuki]],
]);
const exactEFile = 'test/assault/assault-source-exact-e.test.mjs';
const exactETests = read(exactEFile);
const exactETitles = {
  skadi: 'exact-e Skadi R3/R4 natural skill stats, module duration, and Abyssal formation aura use literal Battle values',
  siege: 'exact-e Siege Alter R3/R4 natural skill summons 黄金盟誓 and applies the exact real-hit window',
  silver: 'exact-e SilverAsh R3/R4 natural S3 uses literal range, six/seven target cap and exact formation values',
  formation: 'exact-e SilverAsh passive is isolated to its native Battle owner and absent after real shared-run sale',
};
const exactEProofs = [
  ['char_263_skadi:fixedSkill:0:addBuff', [{ atkBonus: 1.3, defBonus: 1.3, maxHpBonus: 1.3, duration: 50 }, { atkBonus: 1.3, defBonus: 1.3, maxHpBonus: 1.3, duration: 50 }, exactETitles.skadi]],
  ['char_263_skadi:modePassive:0:addBuff', [{ atkBonus: 0.14 }, { atkBonus: 0.14 }, exactETitles.skadi]],
  ['char_1019_siege2:fixedSkill:0:summon', [{ summonName: '黄金盟誓', summonCount: 1, duration: 25 }, { summonName: '黄金盟誓', summonCount: 1, duration: 25 }, exactETitles.siege]],
  ['char_1019_siege2:fixedSkill:1:addBuff', [{ atkBonus: 1.9, extraTargets: 3, attackIntervalDelta: -0.25, damageTypeOverride: '真实', duration: 25 }, { atkBonus: 1.9, extraTargets: 3, attackIntervalDelta: -0.25, damageTypeOverride: '真实', duration: 25 }, exactETitles.siege]],
  ['char_1019_siege2:modePassive:0:applyStatus', [{ trembleDuration: 4, perEnemy: 1 }, { trembleDuration: 4, perEnemy: 1 }, exactETitles.siege]],
  ['char_172_svrash:fixedSkill:0:damage', [{ atkScale: 1.8, maxTarget: 6, rangeExtend: 1, asMelee: 1, damageType: '物理' }, { atkScale: 2, maxTarget: 6, rangeExtend: 1, asMelee: 1, damageType: '物理' }, exactETitles.silver]],
  ['char_172_svrash:fixedSkill:1:addBuff', [{ defPenalty: -0.7, atkBonus: 1.8, rangeExtend: 1, duration: 30 }, { defPenalty: -0.7, atkBonus: 2, rangeExtend: 1, duration: 30 }, exactETitles.silver]],
  ['char_172_svrash:modePassive:0:nativeMechanism', [{ atkBonusSelf: 0.1, redeployReduceTeam: 0.1, installOncePerBattleFormation: true, removedWhenNotInTeam: true, notPersistAfterSell: true, notHaste: true }, { atkBonusSelf: 0.1, redeployReduceTeam: 0.12, installOncePerBattleFormation: true, removedWhenNotInTeam: true, notPersistAfterSell: true, notHaste: true }, exactETitles.formation]],
];
const exactProofFiles = new Map([...exactSourceProofs.keys()].map(binding => [binding, exactDFile]));
for (const [binding, proof] of exactEProofs) {
  exactSourceProofs.set(binding, proof);
  exactProofFiles.set(binding, exactEFile);
}
const exactFFile = 'test/assault/assault-source-exact-f.test.mjs';
const exactFTests = read(exactFFile);
const exactFTitles = {
  gavial: 'exact-f Gavial Alter R3/R4 native skill applies literal stats and defers actual incoming HP loss',
  blockers: 'exact-f Gavial Alter mode passive follows real blockers and formal block-cap changes',
  swire: 'exact-f Swire Alter normal coin-paid bomb lands distinct contact and timed physical hits with capped owner growth',
  robin: 'exact-f Robin normal moving enemies trigger one legal trap with exact damage, push, and rank root',
};
const exactFProofs = [
  ['char_1026_gvial2:fixedSkill:0:addBuff', [{ atkBonus: 1.3, attackSpeedBonus: 95, blockBonus: 2, duration: 25 }, { atkBonus: 1.4, attackSpeedBonus: 100, blockBonus: 2, duration: 25 }, exactFTitles.gavial]],
  ['char_1026_gvial2:fixedSkill:1:nativeMechanism', [{ damageResistance: 0.5, deferredRatio: 0.5, finalDuration: 20, interval: 0.1 }, { damageResistance: 0.5, deferredRatio: 0.5, finalDuration: 20, interval: 0.1 }, exactFTitles.gavial]],
  ['char_1026_gvial2:modePassive:0:addBuff', [{ baseAtkDef: 0.1, perExtraBlock: 0.04 }, { baseAtkDef: 0.1, perExtraBlock: 0.04 }, exactFTitles.blockers]],
  ['char_1033_swire2:fixedSkill:0:device', [{ deviceName: '香槟炸弹', goldCost: 1, goldCap: 5, triggerDamageScale: 2, sluggish: 2 }, { deviceName: '香槟炸弹', goldCost: 1, goldCap: 5, triggerDamageScale: 2.2, sluggish: 2 }, exactFTitles.swire]],
  ['char_1033_swire2:fixedSkill:1:damage', [{ atkScale: 1.4, damageType: '物理' }, { atkScale: 1.5, damageType: '物理' }, exactFTitles.swire]],
  ['char_1033_swire2:modePassive:0:growth', [{ atkPerGold: 0.03, maxStacks: 5 }, { atkPerGold: 0.04, maxStacks: 8 }, exactFTitles.swire]],
  ['char_451_robin:fixedSkill:0:device', [{ deviceCount: 1, triggerDamageScale: 3.5, pushForce: 2 }, { deviceCount: 1, triggerDamageScale: 3.8, pushForce: 2 }, exactFTitles.robin]],
  ['char_451_robin:fixedSkill:1:damage', [{ atkScale: 3.5, force: 2 }, { atkScale: 3.8, force: 2 }, exactFTitles.robin]],
  ['char_451_robin:modePassive:0:applyStatus', [{ rootDuration: 2 }, { rootDuration: 2.5 }, exactFTitles.robin]],
];
for (const [binding, proof] of exactFProofs) {
  exactSourceProofs.set(binding, proof);
  exactProofFiles.set(binding, exactFFile);
}
const exactHFile = 'test/assault/assault-source-exact-h.test.mjs';
const exactHTests = read(exactHFile);
const exactHTitles = {
  tinman: 'exact-h Tinman R3/R4 normal alchemy fields deal exact periodic arts damage, heal actual HP, and expire',
  dorothy: 'exact-h Dorothy R3/R4 resonance traps deal exact area damage, delayed status, and capped trigger growth',
  dorothyGrowth: 'exact-h Dorothy passive reaches its actual R3/R4 module-dependent permanent-growth cap',
  thorns: 'exact-h Thorns Alter R3/R4 legal ally zones deal ramped arts damage and exact debuffs',
  thornsTargets: 'exact-h Thorns Alter source maxTarget covers exactly four native ally zones at both ranks',
  thornsOwner: 'exact-h Thorns Alter retreat and true-damage death stop an active field without orphan ticks',
};
const exactHProofs = [
  ['char_4151_tinman:fixedSkill:0:device', [{ deviceName: '大拉里', duration: 14, radius: 2, charges: 2 }, { deviceName: '大拉里', duration: 15, radius: 2, charges: 2 }, exactHTitles.tinman]],
  ['char_4151_tinman:fixedSkill:1:damage', [{ atkScalePerSec: 1, interval: 1, damageType: '法术' }, { atkScalePerSec: 1.1, interval: 1, damageType: '法术' }, exactHTitles.tinman]],
  ['char_4151_tinman:fixedSkill:2:heal', [{ healScalePerSec: 0.25, interval: 1 }, { healScalePerSec: 0.28, interval: 1 }, exactHTitles.tinman]],
  ['char_4151_tinman:modePassive:0:addBuff', [{ dotAmp: 0.2 }, { dotAmp: 0.2 }, exactHTitles.tinman]],
  ['char_4048_doroth:fixedSkill:0:device', [{ deviceName: '共振装置', deviceCount: 1 }, { deviceName: '共振装置', deviceCount: 1 }, exactHTitles.dorothy]],
  ['char_4048_doroth:fixedSkill:1:damage', [{ atkScale: 3.3, damageType: '法术' }, { atkScale: 3.5, damageType: '法术' }, exactHTitles.dorothy]],
  ['char_4048_doroth:fixedSkill:2:applyStatus', [{ sluggishDuration: 4.5, delaySec: 2 }, { sluggishDuration: 5, delaySec: 2 }, exactHTitles.dorothy]],
  ['char_4048_doroth:modePassive:0:growth', [{ atkPerTrigger: 0.02, maxStacks: 10 }, { atkPerTrigger: 0.02, maxStacks: 10 }, exactHTitles.dorothyGrowth]],
  ['char_1039_thorn2:fixedSkill:0:device', [{ deviceName: '我的海疆', maxTarget: 4, duration: 22, radius: 1.1 }, { deviceName: '我的海疆', maxTarget: 4, duration: 23, radius: 1.1 }, exactHTitles.thornsTargets]],
  ['char_1039_thorn2:fixedSkill:1:applyStatus', [{ atkDebuff: -0.22, defDebuff: -0.42, resDebuff: -0.42, maxAtkDebuff: -0.37, maxDefResDebuff: -0.5, rampSec: 15 }, { atkDebuff: -0.25, defDebuff: -0.45, resDebuff: -0.45, maxAtkDebuff: -0.4, maxDefResDebuff: -0.5, rampSec: 15 }, exactHTitles.thorns]],
  ['char_1039_thorn2:fixedSkill:2:damage', [{ dotScale: 1.8, maxDotScale: 3.6, interval: 1, damageType: '法术' }, { dotScale: 2.1, maxDotScale: 3.9, interval: 1, damageType: '法术' }, exactHTitles.thorns]],
  ['char_1039_thorn2:modePassive:0:addBuff', [{ dotAmp: 0.2 }, { dotAmp: 0.2 }, exactHTitles.thorns]],
];
for (const [binding, proof] of exactHProofs) {
  exactSourceProofs.set(binding, proof);
  exactProofFiles.set(binding, exactHFile);
}
const exactGFile = 'test/assault/assault-source-exact-g.test.mjs';
const exactGTests = read(exactGFile);
const exactGTitles = {
  kazema: 'exact-g Kazema R3/R4 natural cast applies literal HP cost, attack buff, summon stats, and one source burst',
  texas: 'exact-g Texas2 R3/R4 SP_FULL damage, landing stun, rain targets/timers, and first-kill heal use formal values',
  ghost: 'exact-g Ghost2 R3/R4 natural skill costs/buffs/conditional hit and real death decoy timers match literal source',
};
const exactGProofs = [
  ['char_4016_kazema:fixedSkill:0:applyStatus', [{ selfHpCostRatio: 0.5 }, { selfHpCostRatio: 0.5 }, exactGTitles.kazema]],
  ['char_4016_kazema:fixedSkill:1:addBuff', [{ atkBonus: 1.1, duration: 20 }, { atkBonus: 1.2, duration: 20 }, exactGTitles.kazema]],
  ['char_4016_kazema:fixedSkill:2:summon', [{ summonName: '替身', summonCount: 1, summonAtkScale: 1, summonHpRatio: 0.5, duration: 20 }, { summonName: '替身', summonCount: 1, summonAtkScale: 1.1, summonHpRatio: 0.5, duration: 20 }, exactGTitles.kazema]],
  ['char_4016_kazema:modePassive:0:damage', [{ atkScale: 2.25, damageType: '法术', radius: 1 }, { atkScale: 2.7, damageType: '法术', radius: 1 }, exactGTitles.kazema]],
  ['char_1028_texas2:fixedSkill:0:damage', [{ hits: 2, atkScalePerHit: 1.55, damageType: '法术' }, { hits: 2, atkScalePerHit: 1.65, damageType: '法术' }, exactGTitles.texas]],
  ['char_1028_texas2:fixedSkill:1:applyStatus', [{ stunDuration: 1.8 }, { stunDuration: 2 }, exactGTitles.texas]],
  ['char_1028_texas2:fixedSkill:2:damage', [{ duration: 8, maxTarget: 4, atkScalePerSec: 1.2, stunPerHit: 0.2 }, { duration: 8, maxTarget: 4, atkScalePerSec: 1.3, stunPerHit: 0.2 }, exactGTitles.texas]],
  ['char_1028_texas2:modePassive:0:heal', [{ firstKillHealFull: 1, firstKillPerDeploy: 1, noResetOnSurvivingRedeploy: 1, resetOnRealEntry: 1 }, { firstKillHealFull: 1, firstKillPerDeploy: 1, noResetOnSurvivingRedeploy: 1, resetOnRealEntry: 1 }, exactGTitles.texas]],
  ['char_1023_ghost2:fixedSkill:0:damage', [{ atkScale: 2.4, maxTarget: 99, damageType: '物理' }, { atkScale: 2.6, maxTarget: 99, damageType: '物理' }, exactGTitles.ghost]],
  ['char_1023_ghost2:fixedSkill:1:addBuff', [{ atkBonus: 2.4, maxHpBonus: 1.9, duration: 25 }, { atkBonus: 2.6, maxHpBonus: 2, duration: 25 }, exactGTitles.ghost]],
  ['char_1023_ghost2:fixedSkill:2:damage', [{ extraAtkScale: 0.7, selfMaxHpLossRatio: 0.03 }, { extraAtkScale: 0.7, selfMaxHpLossRatio: 0.03 }, exactGTitles.ghost]],
  ['char_1023_ghost2:modePassive:0:summon', [{ summonName: '替身', slow: 0.3, dotScale: 0.3, duration: 15 }, { summonName: '替身', slow: 0.4, dotScale: 0.4, duration: 15 }, exactGTitles.ghost]],
];
for (const [binding, proof] of exactGProofs) {
  exactSourceProofs.set(binding, proof);
  exactProofFiles.set(binding, exactGFile);
}
const exactIFile = 'test/assault/assault-source-exact-i.test.mjs';
const exactITests = read(exactIFile);
const exactITitles = {
  mountain: 'exact-i Mountain R3/R4 natural skill hits, push, temporary punch strength, and native punch debuff use literal values',
  chyue: 'exact-i Chyue R3/R4 natural skill grows on cast, adds the fifth-hit awakening, and refunds SP on a real skill kill',
  qiubai: 'exact-i Qiubai R3/R4 natural skill hits literal caps, adds controlled-target damage, and stacks real ASPD/root',
};
const exactIProofs = [
  ['char_264_f12yin:fixedSkill:0:damage', [{ hits: 2, atkScalePerHit: 0.9, maxTarget: 4, damageType: '物理' }, { hits: 2, atkScalePerHit: 1, maxTarget: 4, damageType: '物理' }, exactITitles.mountain]],
  ['char_264_f12yin:fixedSkill:1:move', [{ force: 1 }, { force: 1 }, exactITitles.mountain]],
  ['char_264_f12yin:fixedSkill:2:addBuff', [{ talentProbBonus: 0.65, duration: 30 }, { talentProbBonus: 0.75, duration: 30 }, exactITitles.mountain]],
  ['char_264_f12yin:modePassive:0:addBuff', [{ targetAtkDown: 0.1, duration: 3 }, { targetAtkDown: 0.15, duration: 3 }, exactITitles.mountain]],
  ['char_2024_chyue:fixedSkill:0:damage', [{ atkScale: 3.5, splashRadius: 1, damageType: '物理' }, { atkScale: 3.8, splashRadius: 1, damageType: '物理' }, exactITitles.chyue]],
  ['char_2024_chyue:fixedSkill:1:growth', [{ rangeExtend: 1, extraHit: 1, threshold: 5 }, { rangeExtend: 1, extraHit: 1, threshold: 5 }, exactITitles.chyue]],
  ['char_2024_chyue:fixedSkill:2:damage', [{ talentAtkScale: 1.6, duration: 2.5 }, { talentAtkScale: 1.65, duration: 2.5 }, exactITitles.chyue]],
  ['char_2024_chyue:modePassive:0:spGain', [{ sp: 3, perCast: 1 }, { sp: 3, perCast: 1 }, exactITitles.chyue]],
  ['char_4082_qiubai:fixedSkill:0:damage', [{ atkScale: 0.52, extraTargets: 2, rangeExtend: 1, damageType: '法术' }, { atkScale: 0.55, extraTargets: 2, rangeExtend: 1, damageType: '法术' }, exactITitles.qiubai]],
  ['char_4082_qiubai:fixedSkill:1:growth', [{ attackSpeedPerHit: 13, maxStacks: 6, duration: 30 }, { attackSpeedPerHit: 13, maxStacks: 8, duration: 30 }, exactITitles.qiubai]],
  ['char_4082_qiubai:fixedSkill:2:damage', [{ extraAtkScale: 0.35, damageType: '法术' }, { extraAtkScale: 0.4, damageType: '法术' }, exactITitles.qiubai]],
  ['char_4082_qiubai:modePassive:0:applyStatus', [{ rootDuration: 1.5, prob: 0.2 }, { rootDuration: 1.5, prob: 0.2 }, exactITitles.qiubai]],
];
for (const [binding, proof] of exactIProofs) {
  exactSourceProofs.set(binding, proof);
  exactProofFiles.set(binding, exactIFile);
}
const exactJFile = 'test/assault/assault-source-exact-j.test.mjs';
const exactJTests = read(exactJFile);
const exactJTitles = {
  ulpia: 'exact-j Ulpia R3/R4 applies four official skill literals through natural anchor Battle callbacks',
  pepe: 'exact-j Pepe R3/R4 applies four source literals under base and both advanced modules',
  blkkgt: 'exact-j锏 R3/R4 applies four source literals with base and both advanced modules',
};
const exactJProofs = [
  ['char_4145_ulpia:fixedSkill:0:addBuff', [{ maxHpBonus: 0.8, atkBonus: 2.6, duration: 25 }, { maxHpBonus: 0.8, atkBonus: 2.6, duration: 25 }, exactJTitles.ulpia]],
  ['char_4145_ulpia:fixedSkill:1:damage', [{ atkScale: 1.6, radius: 1, damageType: '物理' }, { atkScale: 1.6, radius: 1, damageType: '物理' }, exactJTitles.ulpia]],
  ['char_4145_ulpia:fixedSkill:2:applyStatus', [{ stunDuration: 6 }, { stunDuration: 6 }, exactJTitles.ulpia]],
  ['char_4145_ulpia:fixedSkill:3:move', [{ dashToAnchor: 1 }, { dashToAnchor: 1 }, exactJTitles.ulpia]],
  ['char_4145_ulpia:modePassive:0:heal', [{ healPerHit: 100, lowHpHeal: 160, hpThreshold: 0.5 }, { healPerHit: 100, lowHpHeal: 160, hpThreshold: 0.5 }, exactJTitles.ulpia]],
  ['char_4058_pepe:fixedSkill:0:damage', [{ atkScale: 2.2, radius: 1, damageType: '物理' }, { atkScale: 2.4, radius: 1, damageType: '物理' }, exactJTitles.pepe]],
  ['char_4058_pepe:fixedSkill:1:applyStatus', [{ stunDuration: 0.8, stunMain: 1.5 }, { stunDuration: 0.8, stunMain: 1.5 }, exactJTitles.pepe]],
  ['char_4058_pepe:fixedSkill:2:growth', [{ atkPerStack: 0.22, rangeExtendPerStack: 0.25, maxStacks: 4 }, { atkPerStack: 0.25, rangeExtendPerStack: 0.25, maxStacks: 4 }, exactJTitles.pepe]],
  ['char_4058_pepe:modePassive:0:spGain', [{ spPerKill: 1, maxPerCast: 10 }, { spPerKill: 1, maxPerCast: 14 }, exactJTitles.pepe]],
  ['char_4116_blkkgt:fixedSkill:0:damage', [{ hits: 10, atkScalePerHit: 2.25, maxTarget: 6, damageType: '物理' }, { hits: 10, atkScalePerHit: 2.35, maxTarget: 6, damageType: '物理' }, exactJTitles.blkkgt]],
  ['char_4116_blkkgt:fixedSkill:1:move', [{ pullToCenterForce: 1, endForce: 2 }, { pullToCenterForce: 1, endForce: 2 }, exactJTitles.blkkgt]],
  ['char_4116_blkkgt:fixedSkill:2:applyStatus', [{ trembleDuration: 5, trembleChance: 1 }, { trembleDuration: 5, trembleChance: 1 }, exactJTitles.blkkgt]],
  ['char_4116_blkkgt:modePassive:0:applyStatus', [{ trembleDuration: 5, prob: 0.1 }, { trembleDuration: 5, prob: 0.1 }, exactJTitles.blkkgt]],
];
const exactKFile = 'test/assault/assault-source-exact-k.test.mjs';
const exactKTests = read(exactKFile);
const exactKTitles = {
  helage: 'exact-k Hellagur native SP_FULL damages legal targets and applies real 15s buff and low-HP haste for both modules',
  nearl: 'exact-k Nearl native SP_FULL creates one real Sun and applies source stun, combat window, and module duration',
  excu2: 'exact-k Exu native SP_FULL loads real rounds, grows ATK per bullet, then applies capped-target final damage',
};
const exactKProofs = [
  ['char_188_helage:fixedSkill:0:damage', [{ atkScale: 0.9, maxTarget: 3, rangeExtend: 2, damageType: '物理' }, { atkScale: 1, maxTarget: 3, rangeExtend: 2, damageType: '物理' }, exactKTitles.helage]],
  ['char_188_helage:fixedSkill:1:addBuff', [{ atkBonus: 0.7, duration: 15 }, { atkBonus: 0.8, duration: 15 }, exactKTitles.helage]],
  ['char_188_helage:fixedSkill:2:haste', [{ attackSpeedBonus: 50, duration: 10 }, { attackSpeedBonus: 60, duration: 10 }, exactKTitles.helage]],
  ['char_188_helage:modePassive:0:heal', [{ healPerSec: 60 }, { healPerSec: 60 }, exactKTitles.helage]],
  ['char_1014_nearl2:fixedSkill:0:summon', [{ summonName: '耀阳', summonCount: 1, duration: 25 }, { summonName: '耀阳', summonCount: 1, duration: 25 }, exactKTitles.nearl]],
  ['char_1014_nearl2:fixedSkill:1:damage', [{ atkScale: 1.1, radius: 1, damageType: '真实' }, { atkScale: 1.1, radius: 1, damageType: '真实' }, exactKTitles.nearl]],
  ['char_1014_nearl2:fixedSkill:2:applyStatus', [{ stunDuration: 3 }, { stunDuration: 3 }, exactKTitles.nearl]],
  ['char_1014_nearl2:fixedSkill:3:addBuff', [{ atkBonus: 1.3, defBonus: 1, rangeExtend: 1, blockedTrueDamage: 1, duration: 25 }, { atkBonus: 1.4, defBonus: 1, rangeExtend: 1, blockedTrueDamage: 1, duration: 25 }, exactKTitles.nearl]],
  ['char_1014_nearl2:modePassive:0:damage', [{ atkScale: 0.8, radius: 1, damageType: '真实', kazimierzExtra: 1 }, { atkScale: 0.8, radius: 1, damageType: '真实', kazimierzExtra: 1 }, exactKTitles.nearl]],
  ['char_1032_excu2:fixedSkill:0:ammo', [{ ammoCount: 16, atkScale: 1.7, baseAttackTimeDelta: 0.5, traitHealMultiplier: 3, damageType: '物理' }, { ammoCount: 16, atkScale: 1.8, baseAttackTimeDelta: 0.5, traitHealMultiplier: 3, damageType: '物理' }, exactKTitles.excu2]],
  ['char_1032_excu2:fixedSkill:1:growth', [{ atkPerAmmo: 0.06, maxStacks: 30 }, { atkPerAmmo: 0.06, maxStacks: 30 }, exactKTitles.excu2]],
  ['char_1032_excu2:fixedSkill:2:damage', [{ finalAtkScale: 2.4, ignoreDefFixed: 360, damageType: '物理' }, { finalAtkScale: 2.5, ignoreDefFixed: 400, damageType: '物理' }, exactKTitles.excu2]],
  ['char_1032_excu2:modePassive:0:addBuff', [{ extraAttackProb: 0.05, maxStacks: 30 }, { extraAttackProb: 0.05, maxStacks: 30 }, exactKTitles.excu2]],
];
for (const [binding, proof] of [...exactJProofs, ...exactKProofs]) {
  exactSourceProofs.set(binding, proof);
  exactProofFiles.set(binding, binding.startsWith('char_188_') || binding.startsWith('char_1014_') || binding.startsWith('char_1032_') ? exactKFile : exactJFile);
}
const exactLFile = 'test/assault/assault-source-exact-l.test.mjs';
const exactLTests = read(exactLFile);
const parseLiteral = (text) => JSON.parse(text.replace(/([,{]\s*)([A-Za-z][\w]*):/g, '$1"$2":').replaceAll("'", '"'));
const exactLRows = [...exactLTests.matchAll(/\{ id:'([^']+)', source:'([^']+)', title:'([^']+)', action:'([^']+)', r3:(\{[^}]*\}), r4:(\{[^}]*\}), pointer:'([^']+)' \}/g)];
if (exactLRows.length !== 20) throw new Error(`Expected 20 literal exact-L mappings, found ${exactLRows.length}`);
for (const [, charId, source, title, action, rank3, rank4] of exactLRows) {
  const binding = `${charId}:${source}:${action}`;
  const testTitle = `exact-l ${charId} ${source} ${title}: exact R3/R4 literals and real native lifecycle across modules`;
  exactSourceProofs.set(binding, [parseLiteral(rank3), parseLiteral(rank4), testTitle]);
  exactProofFiles.set(binding, exactLFile);
}
const exactTestFiles = new Map([[exactDFile, exactDTests], [exactEFile, exactETests], [exactFFile, exactFTests], [exactGFile, exactGTests], [exactHFile, exactHTests], [exactIFile, exactITests], [exactJFile, exactJTests], [exactKFile, exactKTests], [exactLFile, exactLTests]]);
for (const [binding, [, , title]] of exactSourceProofs) {
  const file = exactProofFiles.get(binding), tests = exactTestFiles.get(file);
  const registered = file === exactLFile
    ? tests.includes('for(const m of mappings) test(`exact-l ${m.id} ${m.source} ${m.title}: exact R3/R4 literals and real native lifecycle across modules`')
    : tests.includes(`test('${title}'`);
  if (!registered) throw new Error(`Missing registered exact-effect proof: ${file}::${title}`);
}

const modules = [];
const latestModuleProofs = {
  uniequip_003_ulpia: [{ testName: 'Ulpia CRU-Y R3/R4 consumes native white stats and native Abyssal kill growth with a nine-stack cap', behavior: 'R3/R4 native white attributes, owner-only Abyssal Hunter credited-kill growth and nine-stack cap are exercised through real Battle callbacks' }],
  uniequip_002_toledo: [{ testName: 'Toledo R3/R4 requires a real in-range blocker, applies native elite SP, and removes fragile on exit', behavior: 'R3/R4 native module attributes and elite/leader SP gain are exercised with real blocked enemies; out-of-range and nonblocked targets lose fragile' }],
  uniequip_002_hbound: [{ testName: 'Hbound module R3/R4 grants native white stats and its 0.1 SP per second to true skill owners', behavior: 'R3/R4 native module attributes, cast-created alchemy field damage, and owner SP gain are exercised through Battle' }],
};
for (const body of bodies) for (const plan of body.modulePlans ?? []) {
  if (plan.type !== 'ADVANCED') continue;
  const old = previous.modules.find((row) => row.advancedModuleId === plan.id);
  const effects = sourceEffects(body).map(({ source, effect }) => {
    const current = { source, action: effect.action, trigger: effect.trigger,
      rank3: valuesAt(effect.values, 3), rank4: valuesAt(effect.values, 4) };
    const proof = old?.sourceEffects.find((entry) => entry.source === source &&
      ['action', 'trigger', 'rank3', 'rank4'].every((field) => isDeepStrictEqual(entry[field], current[field])));
    const binding = `${body.charId}:${source}:${effect.action}`;
    const registered = exactSourceProofs.get(binding);
    const exact = registered && isDeepStrictEqual(current.rank3, registered[0]) && isDeepStrictEqual(current.rank4, registered[1]);
    const verified = exact || (proof?.status === 'complete' && /^test:/.test(proof.assertion ?? ''));
    return { ...current, assertion: exact ? `test:${exactProofFiles.get(binding)}::${registered[2]}` : verified ? proof.assertion : 'exact per-effect rank 3/4 assertion pending',
      status: verified ? 'complete' : 'partial', ...(proof?.conversion ? { conversion: proof.conversion } : {}) };
  });
  const verifiedModuleBehaviors = old?.verifiedModuleBehaviors?.length ? old.verifiedModuleBehaviors : latestModuleProofs[plan.id] ?? [];
  const completeness = effects.every((effect) => effect.status === 'complete') && verifiedModuleBehaviors.length ? 'complete' : 'partial';
  const status = completeness === 'complete'
    ? (delegated.has(plan.id) ? 'delegated-to-main' : 'handled-here') : 'partial-exact-effect-audit-pending';
  modules.push({
    charId: body.charId,
    advancedModuleId: plan.id,
    effectKeys: {
      rank3: sourceEffects(body).map((item) => key(item, 3)),
      rank4: sourceEffects(body).map((item) => key(item, 4)),
    },
    sourceEffects: effects,
    handler: latestModuleProofs[plan.id] ? `cards/latest-operators.js::installLatestModule/${plan.id}` : old?.handler ?? (delegated.has(plan.id) ? 'delegated-to-main' : `makeModuleHooks/${plan.id}`),
    realAssertion: delegated.has(plan.id)
      ? 'main owner-specific Battle implementation; this file does not install a second listener'
      : `rank3/rank4 real selected-module main KIT cast matrix for ${plan.id}`,
    status,
    completeness,
    translation: plan.translation?.effectHandling ?? plan.effectHandling ?? null,
    verifiedModuleBehaviors,
  });
}

if (bodies.length !== 49 || modules.length !== 71) throw new Error(`coverage shape ${bodies.length}/${modules.length}`);
const uniqueEffects = new Map();
for (const row of modules) for (const effect of row.sourceEffects) {
  const binding = `${row.charId}:${effect.source}:${effect.action}`;
  const entries = uniqueEffects.get(binding) ?? [];
  entries.push(effect); uniqueEffects.set(binding, entries);
}
const actionManifest = previous.sourceActionConsumerManifest;
const actionRows = (actionManifest?.rows ?? []).map((row) => {
  const effects = uniqueEffects.get(`${row.charId}:${row.source}:${row.action}`) ?? [];
  const verified = effects.length && effects.every((effect) => effect.status === 'complete');
  const markedTarget = row.charId === 'char_2024_chyue' && row.source === 'fixedSkill:2';
  return { ...row, ...(markedTarget ? { consumer: 'cards/assault.js::installPassives/Chyue hit and damaged hooks',
    dispatchPath: 'installPassives → landed ordinary attack mark → own marked-target final damage multiplier' } : {}), status: verified ? 'complete' : 'partial',
    assertion: verified ? [...new Set(effects.map((effect) => effect.assertion))].join('; ') : 'exact per-effect rank 3/4 assertion pending' };
});
const actionRowKeys = new Set(actionRows.map(row => `${row.charId}:${row.source}:${row.action}`));
for (const row of modules.filter((entry) => ['char_393_toledo', 'char_4232_hbound'].includes(entry.charId))) {
  for (const effect of row.sourceEffects.filter((entry) => entry.action === 'nativeMechanism')) {
    const key = `${row.charId}:${effect.source}:${effect.action}`;
    if (actionRowKeys.has(key)) continue;
    actionRowKeys.add(key);
    actionRows.push({
      charId: row.charId, source: effect.source, action: effect.action,
      consumer: `cards/latest-operators.js::${row.charId === 'char_393_toledo' ? 'toledo' : 'hbound'} + cards/assault-modules.js::installLatestModule`,
      dispatchPath: `compiled nativeMechanism → selected latest-operator KIT → ${row.advancedModuleId} consumer`,
      consumerMapped: true, mappingStatus: 'mapped', status: 'partial',
      assertion: `test:${row.charId === 'char_393_toledo' ? 'assault-source-exact-latest.test.mjs::Toledo R3/R4 requires a real in-range blocker, applies native elite SP, and removes fragile on exit' : 'assault-source-exact-latest.test.mjs::Hbound module R3/R4 grants native white stats and its 0.1 SP per second to true skill owners'}`,
    });
  }
}
if (!actionRowKeys.has('char_4145_ulpia:module:uniequip_003_ulpia:killGrowth')) {
  actionRowKeys.add('char_4145_ulpia:module:uniequip_003_ulpia:killGrowth');
  actionRows.push({
  charId: 'char_4145_ulpia', source: 'module:uniequip_003_ulpia', action: 'killGrowth',
  consumer: 'cards/assault-modules.js::installUlpia003',
  dispatchPath: 'selected CRU-Y equipLevel2/3 → credited native Abyssal Hunter kill → owner growth and allied Abyssal share',
  consumerMapped: true, mappingStatus: 'mapped', status: 'complete',
  assertion: 'test:test/assault/assault-modules.test.mjs::Ulpia CRU-Y R3/R4 consumes native white stats and native Abyssal kill growth with a nine-stack cap',
  });
}
const parameterManifest = previous.sourceParameterConsumerManifest;
const scanScope = [...new Set([...(parameterManifest?.lexicalScanScope ?? []), 'server/sim/content/assault/cards/latest-operators.js', 'server/sim/content/assault/cards/assault-modules.js'])];
const scanned = scanScope.map((file) => ({ file, lines: read(file).split(/\r?\n/) }));
const parameters = [...new Set([...uniqueEffects.values()].flatMap((effects) => Object.keys(effects[0].rank3)))].sort();
const consumers = Object.fromEntries(parameters.map((name) => {
  const bindings = [...uniqueEffects].filter(([, effects]) => Object.hasOwn(effects[0].rank3, name));
  const literalConsumerReferences = scanned.flatMap(({ file, lines }) => lines.flatMap((line, index) =>
    new RegExp(`\\b${name}\\b`).test(line) ? [`${file}:${index + 1}`] : []));
  return [name, { sourceBindings: bindings.map(([binding]) => binding),
    actions: [...new Set(bindings.map(([, effects]) => effects[0].action))].sort(), literalConsumerReferences,
    fallbackConsumer: parameterManifest?.consumers[name]?.fallbackConsumer ?? (name === 'selfMaxHpLossRatio' ? ['cards/assault.js::runDamage → Battle.loseHp'] : []) }];
}));
const noLiteralReferenceKeys = parameters.filter((name) => !consumers[name].literalConsumerReferences.length);
const output = {
  ...previous,
  schema: 'assault-advanced-module-coverage/v2',
  source: ['data/assault-runtime.json', 'data/assault-design/roster-assault.json', 'data/assault-design/forms.json'],
  bodyCount: bodies.length,
  advancedModuleCount: modules.length,
  count: modules.length,
  modules,
  completeness: modules.every((row) => row.completeness === 'complete') ? 'complete' : 'partial',
  status: modules.every((row) => row.completeness === 'complete') ? 'complete' : 'partial-exact-effect-audit-pending',
  verifiedSourceEffectCount: modules.flatMap((row) => row.sourceEffects).filter((effect) => effect.status === 'complete').length,
  pendingSourceEffectCount: modules.flatMap((row) => row.sourceEffects).filter((effect) => effect.status !== 'complete').length,
  verifiedModuleBehaviorCount: modules.reduce((count, row) => count + row.verifiedModuleBehaviors.length, 0),
  verifiedModuleCount: modules.filter((row) => row.verifiedModuleBehaviors.length).length,
  pendingModuleCount: modules.filter((row) => !row.verifiedModuleBehaviors.length).length,
  sourceActionConsumerManifest: { ...actionManifest, rowCount: actionRows.length, rows: actionRows },
  sourceParameterConsumerManifest: { ...parameterManifest, lexicalScanScope: scanScope, uniqueKeyCount: parameters.length, consumers, noLiteralReferenceKeys,
    unreviewedNoLiteralReferenceKeys: noLiteralReferenceKeys.filter((name) => !parameterManifest?.semanticAliasReview[name]) },
};
if (process.argv.includes('--check')) {
  if (!isDeepStrictEqual(previous, output)) throw new Error('Source effect coverage differs from the deterministic render');
  console.log('OK exact-effect coverage matches current runtime and retained named proofs');
  process.exit(0);
}
fs.writeFileSync(new URL('data/assault-coverage-assault-modules.json', root), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: fileURLToPath(new URL('data/assault-coverage-assault-modules.json', root)), bodyCount: bodies.length, advancedModuleCount: modules.length }));
