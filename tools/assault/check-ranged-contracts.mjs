import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANON = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const DESIGN = path.join(ROOT, 'data/assault-design/roster-ranged.json');
const CTX = `${CANON}/.omni/tmp/assault/roster-contexts/ranged.json`;
const EQUIP = `${CANON}/data/assault-sources/arknights/excel/battle_equip_table.json`;
const design = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
const context = JSON.parse(fs.readFileSync(CTX, 'utf8'));
const equip = JSON.parse(fs.readFileSync(EQUIP, 'utf8'));
const errors = [];
const cards = new Map((design.operators || []).map(o => [o.charId, o]));
const need = (ok, message) => { if (!ok) errors.push(message); };
const card = id => cards.get(id);
const passive = (id, i) => card(id)?.modePassives?.[i];
const effect = (id, action) => card(id)?.fixedSkill?.effects?.find(e => e.action === action);
const containsAll = (value, words) => words.every(w => String(value || '').includes(w));

need(design.schema === 'assault-roster-design/v1' && design.group === 'ranged', 'schema/group must be ranged roster v1');
need(context.operators.length === 67 && design.operators.length === 67, 'must preserve exactly 67 source and designed ranged operators');
need(cards.size === 67, 'duplicate ranged operator IDs');
need(!/待设计|TBD|TODO|通用模板|尚未决定/.test(JSON.stringify(design)), 'unresolved placeholder found');
for (const raw of context.operators) {
  const op = card(raw.charId);
  need(!!op, `${raw.charId}: source member missing`);
  if (!op) continue;
  const nativeModules = new Map((raw.modules || []).map(m => [m.id, m]));
  for (const mod of op.modulePlans || []) {
    const src = nativeModules.get(mod.id);
    if (!src) { errors.push(`${raw.charId}: invented module ${mod.id}`); continue; }
    if (src.type === 'INITIAL') need(mod.mode === 'disabled' && mod.type === 'INITIAL' && !('unlockStar' in mod), `${raw.charId}/${mod.id}: initial module must stay disabled and unranked`);
    if (src.type === 'ADVANCED') {
      const sourceLevel = equip[mod.id]?.phases?.length || 1;
      need(mod.type === 'ADVANCED' && mod.sourceEquipLevel === sourceLevel, `${raw.charId}/${mod.id}: source equip phase mismatch`);
      if (mod.mode !== 'disabled') {
        need(mod.unlockStar === 3 && mod.attributeHandling === 'assaultEffectsOnly' && mod.replaceNativeParts === true, `${raw.charId}/${mod.id}: advanced module unlock/attribute contract missing`);
        need(containsAll(mod.effectHandling, ['三星', '四星']) && /[0-9]/.test(mod.effectHandling || ''), `${raw.charId}/${mod.id}: explicit star 3 and star 4 values missing`);
      }
    }
  }
  const refs = new Map();
  for (const [mi, mp] of (op.modePassives || []).entries()) for (const ti of mp.replacesTalentIndices || []) {
    const found = refs.get(ti) || [];
    found.push(mi); refs.set(ti, found);
  }
  for (const tp of op.talentPlans || []) {
    const ti = Number(String(tp.sourcePointer).match(/\/talents\/(\d+)/)?.[1]);
    const binding = /^modePassive:(\d+)$/.exec(tp.runtimeBinding || '');
    if (binding) need((op.modePassives[Number(binding[1])]?.replacesTalentIndices || []).includes(ti) && refs.get(ti)?.length === 1, `${raw.charId}: talent ${ti} modePassive binding is not uniquely registered`);
    const native = /^assaultTalent:(.+)$/.exec(tp.runtimeBinding || '');
    if (native) need(tp.stableKey === native[1] && tp.trigger && tp.scope && tp.unlockStar && tp.parameters && Object.keys(tp.parameters).length, `${raw.charId}: talent ${ti} registration incomplete`);
  }
}

// The twelve owner-reviewed ranged rulings: assert semantic data and visible card text together.
const inside = card('char_498_inside');
need(inside?.talentPlans?.find(t => t.sourcePointer.endsWith('/talents/0'))?.runtimeBinding === 'modePassive:1', 'inside: hidden talent must bind replacement passive');
need(passive('char_498_inside', 1)?.values?.once === true && passive('char_498_inside', 1)?.values?.fullHpRedeployNoReset === true && passive('char_498_inside', 1)?.values?.clockContinues === true && containsAll(passive('char_498_inside', 1)?.description, ['20秒', '每场战斗只授予一次', '满血再部署']), 'inside: 20-second one-time ammo grant lifecycle missing');
need(passive('char_498_inside', 1)?.values?.selfAmmoCap === 3 && passive('char_498_inside', 1)?.values?.lateranoAmmoCap === 1, 'inside: ammo caps must be +3 self and +1 Laterano');

const amiya = card('char_002_amiya');
need(amiya?.talentPlans?.find(t => t.sourcePointer.endsWith('/talents/0'))?.runtimeBinding === 'modePassive:0' && passive('char_002_amiya', 0)?.replacesTalentIndices?.includes(0), 'Amiya: replacement binding missing');
need(passive('char_002_amiya', 0)?.componentOfTalentIndex === 0 && passive('char_002_amiya', 1)?.componentOfTalentIndex === 0 && !passive('char_002_amiya', 1)?.replacesTalentIndices, 'Amiya: attack/kill components must form one bound talent group');

const excu = card('char_279_excu');
need(excu?.talentPlans?.find(t => t.sourcePointer.endsWith('/talents/0'))?.parameters?.defPenetrateFixed?.at(-1) === 160, 'Exusiai: source 160 defense pierce inheritance missing');
need(effect('char_279_excu', 'damage')?.values?.inheritTalentPierce === true && !('defPenetrateFixed' in effect('char_279_excu', 'damage').values), 'Exusiai: skill must inherit its one 160 pierce source');

const gnosis = card('char_206_gnosis');
const gnExtra = gnosis?.fixedSkill?.effects?.find(e => e.values?.mechanismName === '零度爆发·追加寒层');
need(gnosis?.fixedSkill?.maxCharge === 1 && gnosis?.fixedSkill?.chargeCount === 1, 'Gnosis: S2 must have one charge');
need(gnExtra?.values?.preCastSnapshot === true && /施放前/.test(gnExtra?.trigger || '') && /施放前/.test(gnExtra?.description || ''), 'Gnosis: extra cold layer must use pre-cast status snapshot');
need(passive('char_206_gnosis', 1)?.values?.atk?.join(',') === '0.05,0.06,0.07,0.08' && containsAll(passive('char_206_gnosis', 1)?.description, ['每次成功施加', '派生', '免疫', 'visits']), 'Gnosis: successful cold/freeze sibling events and visited-only loop guard missing');
need(containsAll(gnosis?.fixedSkill?.description, ['施放前', '每次成功施加']), 'Gnosis: visible skill description disagrees with event snapshot/counting');

const iron = card('char_4072_ironmn');
const ironSummon = effect('char_4072_ironmn', 'summon');
const ironDamage = effect('char_4072_ironmn', 'damage');
const ironCharge = iron?.fixedSkill?.effects?.find(e => e.values?.mechanismName === '装置充能作战');
need(ironSummon?.values?.tokenKey === 'token_10027_ironmn_pile2' && ironSummon.values.ownerUid === 'char_4072_ironmn' && ironSummon.values.lifeScaleFactor === 5 && ironSummon.values.lifeScaleApplyOnce === true && ironSummon.values.doesNormalAttack === false && ironSummon.values.blockCnt === 0, 'Ironmn: exact non-attacking, non-blocking pile2 device contract missing');
need(ironDamage?.values?.damageSource === 'operator' && ironDamage.values.scaleBasis === 'ownerAtk' && ironDamage.values.perDevice === false && ironDamage.values.atkScale?.join(',') === '1.4,1.5,1.6,1.75', 'Ironmn: skill damage must be one owner-attack hit, independent of device count');
need(ironCharge?.values?.hpDrainTarget === 'device' && ironCharge.values.hpDrainBaseRatio === 0.02 && ironCharge.values.hpDrainEnhancedRatio === 0.04 && ironCharge.values.spEntryPerTick === 1 && ironCharge.values.repairBasis === 'netActualHeal' && ironCharge.values.repairNoSelfRecurse === true, 'Ironmn: device drain, actual SP entry, and repair causality missing');
need(containsAll(iron?.fixedSkill?.description, ['pile2', '不按装置数放大', '装置自身', '不扣白铁或受充能友军']), 'Ironmn: visible skill description contradicts device/damage semantics');

const ling = card('char_2023_ling');
const lingSummon = effect('char_2023_ling', 'summon');
const merge = ling?.fixedSkill?.effects?.find(e => e.values?.mechanismName === '召唤物合并');
need(lingSummon?.values?.tokenKey === 'token_10020_ling_soul3' && lingSummon.values?.stockCap?.join(',') === '4,4,5,5' && lingSummon.values?.deployMax === 3 && lingSummon.values?.stockIndependentOfDeploy === true, 'Ling: source summon, inventory cap, and separate deployment cap missing');
need(/库存未满时取得/.test(lingSummon?.stacking || '') && /库存满时不新增/.test(lingSummon?.limits || ''), 'Ling: stacking/limit text blocks inventory at deployment cap');
need(merge?.values?.derivedTemplateId === 'assault_ling_large' && merge.values.sourceTemplateId === 'token_10020_ling_soul3' && merge.values.transformEarlierByOrder === true && merge.values.absorbedEventOnLater === true && merge.values.transformerNoDeathRecycle === true && merge.values.ownerUid === 'char_2023_ling', 'Ling: large-dragon identity/order/owner lifecycle incomplete');

const wisdel = card('char_1035_wisdel');
const wisSummon = effect('char_1035_wisdel', 'summon');
need(wisSummon?.values?.persistAfterSkill === true && wisSummon.values.persistAfterBattle === false && wisSummon.values.lifecycle === 'battle' && wisSummon.values.sharesOwnerSummonCapacity === true, 'Wisdel: battle persistence and shared owner capacity missing');
need(effect('char_1035_wisdel', 'damage')?.values?.mainTargetScale === 1.15 && effect('char_1035_wisdel', 'damage')?.values?.mainTargetSelect === 'closestToGoalEligibleTieEnemyId', 'Wisdel: fixed-skill main-target choice/scale missing');
need(passive('char_1035_wisdel', 0)?.values?.attachRemnant === true && passive('char_1035_wisdel', 0)?.values?.detonateOnAftershock === true && passive('char_1035_wisdel', 0)?.values?.uniquePerOwnerEnemy === true, 'Wisdel: remnant attach and aftershock detonation must share component');

const caper = card('char_4100_caper');
need(caper?.fixedSkill?.minimumSpCost === 0.5 && passive('char_4100_caper', 0)?.values?.minimumSpCost === 0.5 && passive('char_4100_caper', 0)?.values?.onceMarkForNextInstant === true && passive('char_4100_caper', 0)?.values?.consumeOnlyOnActualCast === true && passive('char_4100_caper', 0)?.values?.permanentZero === false, 'Caper: next successful instant cast must consume one cost mark with 0.5 floor');

console.log(JSON.stringify({ group: 'ranged', file: DESIGN, expected: 67, actual: cards.size, checkedRulings: 12, ok: errors.length === 0, errors }));
process.exitCode = errors.length ? 1 : 0;
