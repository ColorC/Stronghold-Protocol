#!/usr/bin/env node
// tools/assault/check-forms-design.mjs
// 阿米娅形态卡（近卫 char_1001_amiya2 / 医疗 char_1037_amiya3）进击设计校验器。
//
// 真实来源校验：回读正式输入
//   char_patch_table.json / skill_table.json / uniequip_table.json /
//   battle_equip_table.json / range_table.json / character_table.json / handbook_team_table.json
// 与基底 roster-ranged.json，核对 patch 身份 / 职业 / 分支 / 技能 ID / sourceIndex /
// 天赋覆盖 / 全部原生模组覆盖 / INITIAL 禁用 / default 有效 / 四星一致 / 形态共享身份规则 /
// 明确 effect 数值；绝不使用“字段非空”代替来源验真。
//
// 用法：
//   node tools/assault/check-forms-design.mjs            校验并确定性写出 docs/assault-mode/forms.md
//   node tools/assault/check-forms-design.mjs --check-md 校验并核对现有 forms.md 与生成结果一致（不写）
//   node tools/assault/check-forms-design.mjs --self-test 运行负例自检（发明模组/错职业/INITIAL 启用等）
//
// 退出码 0 表示全部通过，1 表示存在错误。只读来源表；无网络、无浏览器、无 git。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel';
const FILES = {
  character: `${SRC}/character_table.json`,
  patch: `${SRC}/char_patch_table.json`,
  skill: `${SRC}/skill_table.json`,
  uniequip: `${SRC}/uniequip_table.json`,
  battleEquip: `${SRC}/battle_equip_table.json`,
  range: `${SRC}/range_table.json`,
  handbook: `${SRC}/handbook_team_table.json`,
};
const FORMS_PATH = path.join(ROOT, 'data', 'assault-design', 'forms.json');
const ROSTER_PATH = path.join(ROOT, 'data', 'assault-design', 'roster-ranged.json');
const FORMS_MD_PATH = path.join(ROOT, 'docs', 'assault-mode', 'forms.md');

const SCHEMA = 'assault-forms-design/v1';
const BASE_CHAR = 'char_002_amiya';
const FORM_IDS = ['char_1001_amiya2', 'char_1037_amiya3'];
const PRICE_TIER = 5;
const PRICE = 8;
const ATK_MULT = [1, 1.55, 2.2, 3];
const HP_MULT = [1, 1.65, 2.6, 4];
const ACTIONS = new Set(['damage', 'heal', 'applyStatus', 'addBuff', 'spGain', 'haste', 'spCost', 'redeploy', 'summon', 'device', 'ammo', 'targeting', 'move', 'modifyTag', 'economy', 'growth', 'nativeMechanism']);
const LIFECYCLES = new Set(['instant', 'battle', 'run']);
const PROFESSIONS = new Set(['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL']);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function flattenNums(o, out = []) {
  if (o == null) return out;
  if (typeof o === 'number') { out.push(o); return out; }
  if (Array.isArray(o)) { for (const x of o) flattenNums(x, out); return out; }
  if (typeof o === 'object') for (const k of Object.keys(o)) flattenNums(o[k], out);
  return out;
}
function talentIndex(tp) {
  const m = String(tp?.sourcePointer || '').match(/\/talents\/(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : NaN;
}
function resolvePointer(root, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return null;
  return pointer.slice(1).split('/').reduce((node, key) => (node == null ? node : node[key]), root);
}
function checkEffect(effect, label, errors) {
  if (!effect || typeof effect !== 'object') { errors.push(`${label}: missing effect`); return; }
  for (const key of ['trigger', 'target', 'action', 'description']) {
    if (typeof effect[key] !== 'string' || !effect[key].trim()) errors.push(`${label}: missing ${key}`);
  }
  if (effect.values == null || typeof effect.values !== 'object' || Array.isArray(effect.values)) errors.push(`${label}: exact values object required`);
  else if (!flattenNums(effect.values).length) errors.push(`${label}: values must carry explicit numbers`);
  if (!ACTIONS.has(effect.action)) errors.push(`${label}: unknown action ${effect.action}`);
  if (!LIFECYCLES.has(effect.lifecycle)) errors.push(`${label}: invalid lifecycle ${effect.lifecycle}`);
  for (const key of ['stacking', 'limits']) if (typeof effect[key] !== 'string' || !effect[key].trim()) errors.push(`${label}: explicit ${key} required`);
  if (/周围[8八]格|八邻/.test(JSON.stringify(effect)) && [effect.values?.radius].flat().includes(8)) errors.push(`${label}: adjacent eight tiles is radius one, not radius eight`);
}
function spInitFromText(text) {
  const sp = String(text).match(/技力\s*([0-9.]+)/);
  const init = String(text).match(/初始\s*([0-9.]+)/);
  return { sp: sp ? Number(sp[1]) : null, init: init ? Number(init[1]) : null };
}

// ---------------------------------------------------------------------------
// 核心校验：对给定 design 与真实源对象执行全部检查
// ---------------------------------------------------------------------------
function validateDesign(design, src, roster) {
  const errors = [];
  if (!design || design.schema !== SCHEMA) errors.push(`wrong schema: ${design && design.schema}`);
  if (typeof design?.sourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(design.sourceRevision)) errors.push('explicit 40-hex sourceRevision required');

  const family = design?.family || {};
  if (family.charId !== BASE_CHAR) errors.push('family.charId must be char_002_amiya');
  if (family.baseFormRef !== 'roster-ranged.json#/operators/char_002_amiya') errors.push('family.baseFormRef must reference roster-ranged base Amiya');
  if (family.sharedOwnership !== true) errors.push('family.sharedOwnership must be true');
  if (family.preparationOnly !== true) errors.push('family.preparationOnly must be true');
  if (family.priceTier !== PRICE_TIER || family.price !== PRICE) errors.push('family priceTier/price must be 5/8');
  if (family.shopEntry !== BASE_CHAR) errors.push('family.shopEntry must be the single char_002_amiya entry');
  for (const key of ['copies', 'star', 'moduleChoice', 'growth', 'tagChange', 'onceRewards']) {
    if (typeof family.shared?.[key] !== 'string' || !family.shared[key].trim()) errors.push(`family.shared.${key} required`);
  }
  for (const key of ['when', 'template', 'baseStatRecalc', 'hpClamp', 'illegalTile', 'professionTag', 'userTagEdits', 'runtime']) {
    if (typeof family.switchRules?.[key] !== 'string' || !family.switchRules[key].trim()) errors.push(`family.switchRules.${key} required`);
  }
  if (family.switchRules?.battleSwitch !== false) errors.push('family.switchRules.battleSwitch must be false');
  if (family.switchRules?.skillExtraTransform !== false) errors.push('family.switchRules.skillExtraTransform must be false');

  const baseOp = (roster?.operators || []).find(o => o.charId === BASE_CHAR);
  if (!baseOp) errors.push('baseFormRef does not resolve to a roster-ranged operator');
  else {
    if (baseOp.priceTier !== PRICE_TIER || baseOp.price !== PRICE) errors.push('base Amiya priceTier/price is not 5/8');
    if (baseOp.profession !== 'CASTER') errors.push('base Amiya profession is not CASTER');
  }

  const forms = Array.isArray(design?.forms) ? design.forms : [];
  if (forms.length !== 2) errors.push(`exactly two forms required, got ${forms.length}`);
  const seen = new Set();
  const actionSets = new Map();
  for (const form of forms) {
    const id = form?.charId;
    const patch = src.patch?.patchChars?.[id];
    if (!patch) { errors.push(`${id}: not a real char_patch_table patchChars identity`); continue; }
    if (seen.has(id)) errors.push(`${id}: duplicate form`);
    seen.add(id);
    if (!PROFESSIONS.has(form.profession) || form.profession !== patch.profession) errors.push(`${id}: profession mismatch (design ${form.profession} vs patch ${patch.profession})`);
    if (form.name !== patch.name) errors.push(`${id}: name mismatch`);
    if (form.branchId !== patch.subProfessionId) errors.push(`${id}: branchId must equal native subProfessionId ${patch.subProfessionId}`);
    if (form.position !== patch.position) errors.push(`${id}: position mismatch`);
    if (form.priceTier !== PRICE_TIER || form.price !== PRICE) errors.push(`${id}: priceTier/price must stay 5/8 on the shared Amiya identity`);

    // sourceRef -> real patchChars path
    if (!String(form.sourceRef?.file || '').endsWith('/char_patch_table.json') || form.sourceRef?.pointer !== `/patchChars/${id}`) {
      errors.push(`${id}: sourceRef must point at char_patch_table patchChars/${id}`);
    } else {
      const node = resolvePointer(src.patch, form.sourceRef.pointer);
      if (!node || node.profession !== patch.profession) errors.push(`${id}: sourceRef pointer does not resolve to the patch identity`);
    }

    // fixed skill
    const sk = form.fixedSkill || {};
    if (!['instant', 'passive'].includes(sk.kind)) errors.push(`${id}: fixedSkill.kind must be instant or passive`);
    const nativeSkills = Array.isArray(patch.skills) ? patch.skills : [];
    if (sk.sourceSkillId != null) {
      const idx = nativeSkills.findIndex(s => s.skillId === sk.sourceSkillId);
      if (idx < 0) errors.push(`${id}: invented/foreign skill ${sk.sourceSkillId}`);
      else {
        if (sk.sourceIndex !== idx) errors.push(`${id}: sourceIndex ${sk.sourceIndex} != patch index ${idx}`);
        const native = src.skill?.[sk.sourceSkillId];
        if (!native || !Array.isArray(native.levels) || !native.levels.length) errors.push(`${id}: skill ${sk.sourceSkillId} absent from skill_table`);
      }
    } else if (sk.kind !== 'passive') {
      errors.push(`${id}: instant skill requires a native sourceSkillId`);
    }
    if (sk.kind === 'instant') {
      if (!Array.isArray(sk.spCosts) || sk.spCosts.length !== 4 || sk.spCosts.some(n => !Number.isFinite(n) || n <= 0)) errors.push(`${id}: four positive exact spCosts required`);
      const init = [sk.initSp].flat();
      if (!(init.length === 1 || init.length === 4) || init.some(n => !Number.isFinite(n) || n < 0)) errors.push(`${id}: initSp must be scalar or four nonnegative values`);
    }
    for (const [i, e] of (sk.effects || []).entries()) checkEffect(e, `${id}: skill effect ${i}`, errors);
    if (!Array.isArray(sk.effects) || !sk.effects.length) errors.push(`${id}: fixed skill effects required`);

    // talents fully covered by array index
    const nativeTalents = Array.isArray(patch.talents) ? patch.talents : [];
    const plansByIdx = new Map();
    for (const tp of form.talentPlans || []) {
      const i = talentIndex(tp);
      if (!Number.isInteger(i)) { errors.push(`${id}: talent sourcePointer unparsable`); continue; }
      if (plansByIdx.has(i)) errors.push(`${id}: talent ${i} duplicated`);
      plansByIdx.set(i, tp);
      const node = resolvePointer(src.patch, tp.sourcePointer);
      if (!node || node !== nativeTalents[i]) errors.push(`${id}: talent sourcePointer ${tp.sourcePointer} does not resolve to native talent ${i}`);
      if (!['retain', 'rewrite'].includes(tp.mode)) errors.push(`${id}: talent ${i} invalid mode`);
      if (!tp.name || !tp.description || !tp.parameters || !Object.keys(tp.parameters).length) errors.push(`${id}: talent ${i} incomplete`);
    }
    for (let i = 0; i < nativeTalents.length; i += 1) if (!plansByIdx.has(i)) errors.push(`${id}: native talent ${i} not covered`);

    // mode passives and their talent bindings
    if (!Array.isArray(form.modePassives) || !form.modePassives.length) errors.push(`${id}: modePassives required`);
    const mpRefs = new Map();
    for (const [i, mp] of (form.modePassives || []).entries()) {
      checkEffect(mp, `${id}: passive ${i}`, errors);
      for (const r of (mp.replacesTalentIndices || [])) {
        if (mpRefs.has(r)) errors.push(`${id}: talent ${r} replaced by two modePassives`);
        mpRefs.set(r, i);
      }
    }
    for (const [i, tp] of plansByIdx.entries()) {
      const rb = tp.runtimeBinding;
      const m = /^modePassive:(\d+)$/.exec(rb || '');
      if (m) {
        const mi = Number(m[1]);
        if (!(form.modePassives || [])[mi]) errors.push(`${id}: talent ${i} bad modePassive index`);
        else if (!(form.modePassives[mi].replacesTalentIndices || []).includes(i)) errors.push(`${id}: talent ${i} not marked as replaced by passive ${mi}`);
      } else {
        errors.push(`${id}: talent ${i} runtimeBinding must bind to a modePassive`);
      }
    }

    // four-star consistency
    if (!Array.isArray(form.stars) || form.stars.length !== 4) errors.push(`${id}: four star states required`);
    else for (const s of form.stars) {
      const i = s.star - 1;
      if (s.atkMultiplier !== ATK_MULT[i] || s.hpMultiplier !== HP_MULT[i]) errors.push(`${id}: star ${s.star} body multipliers must be ${ATK_MULT[i]}/${HP_MULT[i]}`);
      for (const key of ['skillChange', 'passiveChange']) {
        if (typeof s[key] !== 'string' || !/[0-9]/.test(s[key])) errors.push(`${id}: star ${s.star} ${key} lacks explicit numbers`);
        if (/同左/.test(s[key] || '')) errors.push(`${id}: star ${s.star} ${key} uses 同左`);
      }
      const { sp, init } = spInitFromText(s.skillChange);
      const spArr = sk.spCosts || [];
      const initArr = [sk.initSp].flat();
      if (sp != null && sp !== spArr[i]) errors.push(`${id}: star ${s.star} skillChange SP ${sp} != ${spArr[i]}`);
      if (init != null && init !== (initArr.length === 4 ? initArr[i] : initArr[0])) errors.push(`${id}: star ${s.star} skillChange initSP ${init} inconsistent`);
    }

    // modules: every native module covered, no inventions
    const nativeModuleIds = src.uniequip?.charEquip?.[id] || [];
    if (!nativeModuleIds.length) errors.push(`${id}: no native module list found in uniequip charEquip`);
    const planIds = new Set((form.modulePlans || []).map(p => p.id));
    for (const mid of nativeModuleIds) if (!planIds.has(mid)) errors.push(`${id}: native module ${mid} not covered`);
    for (const p of form.modulePlans || []) {
      if (!nativeModuleIds.includes(p.id)) errors.push(`${id}: invented module ${p.id}`);
      const eq = src.uniequip?.equipDict?.[p.id];
      if (!eq) { errors.push(`${id}: module ${p.id} absent from uniequip equipDict`); continue; }
      if (eq.tmplId !== id) errors.push(`${id}: module ${p.id} tmplId ${eq.tmplId} mismatch`);
      if (p.type !== eq.type) errors.push(`${id}: module ${p.id} type ${p.type} != native ${eq.type}`);
      if (eq.type === 'INITIAL' && p.mode !== 'disabled') errors.push(`${id}: INITIAL ${p.id} must be disabled`);
      if (eq.type === 'ADVANCED') {
        if (!['disabled', 'retain', 'rewrite'].includes(p.mode)) errors.push(`${id}: ADVANCED ${p.id} bad mode`);
        if (p.mode !== 'disabled') {
          const txt = String(p.effectHandling || '');
          if (!/[0-9]/.test(txt)) errors.push(`${id}: ADVANCED ${p.id} needs exact effect numbers`);
          if (!/三星|星3/.test(txt) || !/四星|星4/.test(txt)) errors.push(`${id}: ADVANCED ${p.id} must state star3 unlock and star4 change`);
          if (p.unlockStar !== 3) errors.push(`${id}: ADVANCED ${p.id} unlockStar must be 3`);
        }
      }
      // module sourceRef must resolve in a real table
      const rf = String(p.sourceRef?.file || '');
      const rp = p.sourceRef?.pointer;
      if (rf.endsWith('/uniequip_table.json')) {
        if (rp !== `/equipDict/${p.id}` || !resolvePointer(src.uniequip, rp)) errors.push(`${id}: module ${p.id} uniequip sourceRef does not resolve`);
      } else if (rf.endsWith('/battle_equip_table.json')) {
        if (rp !== `/${p.id}` || !src.battleEquip?.[p.id]) errors.push(`${id}: module ${p.id} battle_equip sourceRef does not resolve`);
      } else {
        errors.push(`${id}: module ${p.id} sourceRef must reference uniequip_table or battle_equip_table`);
      }
    }
    if (!('defaultModuleId' in form)) errors.push(`${id}: defaultModuleId missing`);
    const defPlan = (form.modulePlans || []).find(p => p.id === form.defaultModuleId);
    if (form.defaultModuleId) {
      if (!defPlan) errors.push(`${id}: defaultModuleId ${form.defaultModuleId} is not a declared module`);
      else {
        if (defPlan.type !== 'ADVANCED' || defPlan.mode === 'disabled') errors.push(`${id}: defaultModuleId must be an enabled ADVANCED module`);
        if (!src.battleEquip?.[defPlan.id]) errors.push(`${id}: defaultModuleId has no real battle_equip record`);
      }
    } else {
      const anyEnabledAdv = (form.modulePlans || []).some(p => p.type === 'ADVANCED' && p.mode !== 'disabled');
      if (anyEnabledAdv) errors.push(`${id}: defaultModuleId null despite enabled ADVANCED module`);
    }

    // formRules
    const fr = form.formRules || {};
    if (fr.branchId !== patch.subProfessionId) errors.push(`${id}: formRules.branchId mismatch`);
    if (fr.battleSwitch !== false) errors.push(`${id}: formRules.battleSwitch must be false`);
    if (fr.skillExtraTransform !== false) errors.push(`${id}: formRules.skillExtraTransform must be false`);
    if (!String(fr.shopEntry || '').includes(BASE_CHAR)) errors.push(`${id}: formRules.shopEntry must keep the single char_002_amiya entry`);
    if (fr.naturalFaction !== patch.nationId) errors.push(`${id}: natural faction ${fr.naturalFaction} must stay native nationId ${patch.nationId}`);
    const tpl = fr.template || {};
    if (tpl.profession !== patch.profession || tpl.subProfessionId !== patch.subProfessionId) errors.push(`${id}: template profession/branch mismatch`);
    if (tpl.position !== patch.position) errors.push(`${id}: template position mismatch`);
    const lastPhase = Array.isArray(patch.phases) && patch.phases.length ? patch.phases[patch.phases.length - 1] : null;
    if (!lastPhase) errors.push(`${id}: patch has no phases`);
    else {
      const lastFrame = lastPhase.attributesKeyFrames[lastPhase.attributesKeyFrames.length - 1].data;
      const grid = src.range?.[lastPhase.rangeId];
      if (!grid) errors.push(`${id}: native range ${lastPhase.rangeId} absent from range_table`);
      if (tpl.rangeId !== lastPhase.rangeId) errors.push(`${id}: template rangeId ${tpl.rangeId} != native final ${lastPhase.rangeId}`);
      if (tpl.baseAttackTime !== lastFrame.baseAttackTime) errors.push(`${id}: template baseAttackTime mismatch`);
      if (tpl.blockCnt !== lastFrame.blockCnt) errors.push(`${id}: template blockCnt mismatch`);
      if (tpl.deployCost !== lastFrame.cost) errors.push(`${id}: template deployCost ${tpl.deployCost} != native ${lastFrame.cost}`);
      const expectedSlot = patch.position === 'MELEE' ? 'ground' : 'high';
      if (tpl.deploySlot !== expectedSlot) errors.push(`${id}: template deploySlot must be ${expectedSlot}`);
      if (tpl.attackType !== 'arts') errors.push(`${id}: template attackType must be arts per native trait/description`);
    }
    for (const key of ['switch', 'baseStatRecalc', 'permanentAbsoluteBonus', 'ratioBonus', 'hpClamp', 'illegalTile', 'professionTag', 'userTagEdits', 'sharedOwnership', 'modulePerBody', 'runtime']) {
      if (typeof fr[key] !== 'string' || !fr[key].trim()) errors.push(`${id}: formRules.${key} required`);
    }
    if (!String(form.implementationPlan || '').trim()) errors.push(`${id}: implementationPlan required`);
    if (!Array.isArray(form.causalChecks) || form.causalChecks.length < 2) errors.push(`${id}: at least two causal checks required`);
    if (/待设计|TBD|TODO|通用模板|尚未决定/.test(JSON.stringify(form))) errors.push(`${id}: unresolved placeholder`);

    actionSets.set(id, new Set([...(sk.effects || []), ...(form.modePassives || [])].map(e => e.action)));
  }

  for (const id of FORM_IDS) if (!seen.has(id)) errors.push(`missing required form ${id}`);

  // 形态差异：不得两位都是同一种普通伤害
  const guard = forms.find(f => f.charId === 'char_1001_amiya2');
  const medic = forms.find(f => f.charId === 'char_1037_amiya3');
  if (guard && medic) {
    if (guard.fixedSkill?.sourceSkillId === medic.fixedSkill?.sourceSkillId) errors.push('two forms must not share one fixed skill source');
    const guardActions = actionSets.get('char_1001_amiya2') || new Set();
    const medicActions = actionSets.get('char_1037_amiya3') || new Set();
    if (medicActions.has('heal') === false) errors.push('medical form must retain a heal mechanism');
    if (guardActions.has('heal')) errors.push('guard form must not be a healer');
    if (guardActions.has('damage') === false) errors.push('guard form must retain damage');
    const sameOrdinary = [...guardActions].filter(a => a === 'damage').length && [...medicActions].every(a => guardActions.has(a)) && [...guardActions].every(a => medicActions.has(a));
    if (sameOrdinary) errors.push('two forms must not be the same ordinary damage profile');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 确定性 Markdown 生成
// ---------------------------------------------------------------------------
function renderMarkdown(design) {
  const lines = [];
  const f = design.family || {};
  lines.push('# 进击形态卡设计 — 阿米娅近卫 / 医疗');
  lines.push('');
  lines.push(`来源修订：\`${design.sourceRevision}\`。基底身份：\`${f.charId}\`（${f.baseFormRef}）。`);
  lines.push(`共享身份：复制数/星级/模组选择记录/成长/变更标签/一次性领取记录共享，不双占人口；仅准备阶段免费切换；价格档 ${f.priceTier}（${f.price} 金币）；商店唯一入口 \`${f.shopEntry}\`。`);
  lines.push('');
  for (const form of design.forms || []) {
    lines.push(`## ${form.name}（\`${form.charId}\` / ${form.profession} / ${form.branchId}）`);
    lines.push(`- 定位：${form.role}`);
    lines.push(`- 档位理由：${form.priceReason}`);
    lines.push(`- 设计理由：${form.designReason}`);
    lines.push(`- 部署格模板：${form.formRules?.template?.deploySlot}；范围：\`${form.formRules?.template?.rangeId}\`；攻击间隔：${form.formRules?.template?.baseAttackTime}；阻挡：${form.formRules?.template?.blockCnt}；费用：${form.formRules?.template?.deployCost}；攻击方式：${form.formRules?.template?.attackType}`);
    lines.push('');
    const sk = form.fixedSkill || {};
    lines.push(`### 固定技能：${sk.name || '（无）'}`);
    lines.push(`- 来源技能：\`${sk.sourceSkillId ?? 'null'}\`（index ${sk.sourceIndex ?? '-'}）；类型：${sk.kind}；自然回复：${sk.recoveryPerSec}/秒`);
    if (sk.kind === 'instant') lines.push(`- 技力：${JSON.stringify(sk.spCosts)}；初始技力：${JSON.stringify(sk.initSp)}`);
    lines.push(`- ${sk.description}`);
    for (const [i, e] of (sk.effects || []).entries()) {
      lines.push(`- 效果${i + 1}：${e.description}`);
      lines.push(`  - trigger=${e.trigger}；target=${e.target}；action=${e.action}；lifecycle=${e.lifecycle}`);
      lines.push(`  - values=${JSON.stringify(e.values)}；stacking=${e.stacking}；limits=${e.limits}`);
    }
    lines.push('');
    lines.push('### 原生天赋计划');
    for (const t of form.talentPlans || []) {
      lines.push(`- ${t.name}（\`${t.sourcePointer}\`）：mode=${t.mode}；runtimeBinding=${t.runtimeBinding}`);
      lines.push(`  - ${t.description}`);
      lines.push(`  - scope=${t.scope}；parameters=${JSON.stringify(t.parameters)}`);
    }
    lines.push('');
    lines.push('### 进击被动');
    for (const [i, p] of (form.modePassives || []).entries()) {
      lines.push(`- 被动${i}：${p.description}`);
      lines.push(`  - trigger=${p.trigger}；target=${p.target}；action=${p.action}；lifecycle=${p.lifecycle}`);
      lines.push(`  - values=${JSON.stringify(p.values)}；stacking=${p.stacking}；limits=${p.limits}${p.replacesTalentIndices ? `；replacesTalentIndices=${JSON.stringify(p.replacesTalentIndices)}` : ''}`);
    }
    lines.push('');
    lines.push('### 星级');
    for (const s of form.stars || []) {
      lines.push(`- ★${s.star}（攻×${s.atkMultiplier}、生命×${s.hpMultiplier}）：${s.skillChange}`);
      lines.push(`  - 被动：${s.passiveChange}`);
    }
    lines.push('');
    lines.push('### 模组');
    lines.push(`- 默认模组：\`${form.defaultModuleId ?? 'null'}\``);
    for (const m of form.modulePlans || []) lines.push(`- \`${m.id}\`（${m.type || '-'}/${m.mode}）：${m.effectHandling || ''} 来源 ${m.sourceRef?.file} → \`${m.sourceRef?.pointer}\``);
    lines.push('');
    lines.push(`来源：\`${form.sourceRef?.file}\` → \`${form.sourceRef?.pointer}\``);
    lines.push(`形态规则：切换=${form.formRules?.switch || ''}；职业标签=${form.formRules?.professionTag || ''}；阵营=${form.formRules?.naturalFaction || ''}；运行=${form.formRules?.runtime || ''}`);
    lines.push(`实现：${form.implementationPlan}`);
    lines.push('因果检查：');
    for (const c of form.causalChecks || []) lines.push(`- ${c}`);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 载入 + 运行
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const checkMd = args.includes('--check-md');
const selfTest = args.includes('--self-test');

const src = {
  character: readJson(FILES.character),
  patch: readJson(FILES.patch),
  skill: readJson(FILES.skill),
  uniequip: readJson(FILES.uniequip),
  battleEquip: readJson(FILES.battleEquip),
  range: readJson(FILES.range),
  handbook: readJson(FILES.handbook),
};
const roster = readJson(ROSTER_PATH);
const design = readJson(FORMS_PATH);

if (selfTest) {
  const tests = [
    ['T1-profession', d => { d.forms[0].profession = 'SNIPER'; }, /profession mismatch/],
    ['T2-invented-module', d => { d.forms[0].modulePlans.push({ id: 'uniequip_999_amiya2', type: 'ADVANCED', mode: 'rewrite', unlockStar: 3, effectHandling: '三星解锁：+1；四星加强：+2', sourceRef: { file: FILES.battleEquip, pointer: '/uniequip_999_amiya2' } }); }, /invented module/],
    ['T3-initial-enabled', d => { d.forms[0].modulePlans[0].mode = 'rewrite'; }, /INITIAL .* must be disabled/],
    ['T4-source-index', d => { d.forms[0].fixedSkill.sourceIndex = 9; }, /sourceIndex .* != patch index/],
    ['T5-talent-missing', d => { d.forms[1].talentPlans = []; }, /native talent 0 not covered/],
    ['T6-default-invalid', d => { d.forms[0].defaultModuleId = 'uniequip_001_amiya2'; }, /defaultModuleId must be an enabled ADVANCED/],
    ['T7-shared-ownership', d => { d.family.sharedOwnership = false; }, /sharedOwnership must be true/],
    ['T8-star-multiplier', d => { d.forms[0].stars[0].atkMultiplier = 1.2; }, /body multipliers/],
  ];
  let failed = 0;
  for (const [code, mutate, re] of tests) {
    const clone = JSON.parse(JSON.stringify(design));
    mutate(clone);
    const errs = validateDesign(clone, src, roster);
    const hit = errs.some(e => re.test(e));
    if (!hit) failed += 1;
    console.log(JSON.stringify({ code, pass: hit, matched: errs.filter(e => re.test(e))[0] || null }));
  }
  console.log(JSON.stringify({ selfTest: true, total: tests.length, failed, ok: !failed }));
  process.exitCode = failed ? 1 : 0;
} else {
  const errors = validateDesign(design, src, roster);
  let mdPath = null;
  let mdMatches = null;
  if (!errors.length) {
    const md = renderMarkdown(design);
    if (checkMd) {
      mdMatches = fs.existsSync(FORMS_MD_PATH) ? fs.readFileSync(FORMS_MD_PATH, 'utf8') === md : false;
      if (!mdMatches) errors.push('docs/assault-mode/forms.md is stale or missing; rerun without --check-md');
      mdPath = FORMS_MD_PATH;
    } else {
      fs.writeFileSync(FORMS_MD_PATH, md, 'utf8');
      mdPath = FORMS_MD_PATH;
    }
  }
  const forms = design.forms || [];
  console.log(JSON.stringify({
    schema: design.schema,
    file: FORMS_PATH,
    forms: forms.length,
    formIds: forms.map(f => f.charId),
    nativeSkillsChecked: forms.reduce((n, f) => n + (Array.isArray(src.patch.patchChars?.[f.charId]?.skills) ? src.patch.patchChars[f.charId].skills.length : 0), 0),
    nativeModulesChecked: forms.reduce((n, f) => n + ((src.uniequip.charEquip?.[f.charId] || []).length), 0),
    markdown: mdPath,
    markdownMatches: mdMatches,
    ok: !errors.length,
    errors,
  }));
  process.exitCode = errors.length ? 1 : 0;
}
