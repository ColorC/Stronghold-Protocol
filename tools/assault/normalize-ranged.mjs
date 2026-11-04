// 远程组（ranged）逐卡语义收口：字段迁移 + 真实机制归属 + 主代理 12 条裁定。
// 不使用 check-roster-consistency 的 --apply（其按数值交集盲配归属会猜错）。
// 本工具只读写 data/assault-design/roster-ranged.json，读取 canonical 上下文与模组表。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CTX_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/assault/roster-contexts';
const EQUIP = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/battle_equip_table.json';
const FILE = path.join(ROOT, 'data/assault-design/roster-ranged.json');

const ctx = JSON.parse(fs.readFileSync(`${CTX_ROOT}/ranged.json`, 'utf8'));
const equip = JSON.parse(fs.readFileSync(EQUIP, 'utf8'));
const design = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const rawById = new Map(ctx.operators.map(o => [o.charId, o]));

function talentIdx(tp) { const m = String(tp?.sourcePointer || '').match(/talents\/(\d+)(?:\/|$)/); return m ? Number(m[1]) : NaN; }
function nativeLast(tal) { const c = tal?.candidates || []; return c[c.length - 1] || null; }
function isEmptyTalent(tal) { const last = nativeLast(tal); return !last || !last.name; }
function realPhase(id) { const j = equip[id]; return j && Array.isArray(j.phases) && j.phases.length ? j.phases.length : 1; }
function inferTrigger(desc) {
  const d = desc || '';
  if (/部署后|入场|再部署/.test(d)) return '部署/再部署后';
  if (/击倒|击杀/.test(d)) return '击倒敌人时';
  if (/受到|被攻击|受伤/.test(d)) return '自身受到相关事件时';
  if (/攻击时|普攻|每次攻击/.test(d)) return '普通攻击时';
  if (/技能|技力|施放/.test(d)) return '技能/技力事件时';
  if (/范围内|周围|邻/.test(d)) return '范围内的对应事件';
  if (/在场时|常驻|永久/.test(d)) return '被动常驻';
  return '原生天赋触发（按 sourcePointer 原生天赋）';
}
function nativeParams(tal, tp) {
  if (tp.parameters && Object.keys(tp.parameters).length) return tp.parameters;
  const bb = {};
  for (const b of (nativeLast(tal)?.blackboard || [])) bb[b.key] = (b.valueStr != null && typeof b.value !== 'number') ? b.valueStr : b.value;
  return bb;
}

// 早期卡（无 runtimeBinding）中真正被 modePassive 承接的原生天赋：{charId:{talentIndex:passiveIndex}}
const MODE_BIND = {
  char_4051_akkord: { 0: 0 }, char_469_indigo: { 0: 1 }, char_190_clour: { 0: 0 },
  char_440_pinecn: { 0: 0 }, char_366_acdrop: { 0: 0 }, char_183_skgoat: { 0: 0 },
  char_258_podego: { 0: 0 }, char_204_platnm: { 0: 0 }, char_346_aosta: { 0: 0 },
  char_344_beewax: { 0: 0 }, char_373_lionhd: { 0: 0 }, char_341_sntlla: { 0: 0 },
  char_4031_liesel: { 0: 0 }, char_388_mint: { 0: 0 }, char_446_aroma: { 0: 0 },
  char_4013_kjera: { 0: 0 }
};

function closeModules(op, raw) {
  const metaById = new Map((raw.modules || []).map(m => [m.id, m]));
  for (const p of op.modulePlans || []) {
    const meta = metaById.get(p.id);
    if (meta) p.type = meta.type;
    if (p.effect && !p.effectHandling) { p.effectHandling = p.effect; delete p.effect; }
    const type = meta ? meta.type : p.type;
    if (type === 'INITIAL') {
      p.mode = 'disabled';
      p.reason = '初始模组仅作来源记录，进击不安装，不施加任何白值或效果。';
      p.effectHandling = '禁用：不装入战斗，仅登记来源。';
      p.sourceEquipLevel = p.sourceEquipLevel || 1;
      delete p.unlockStar;
    } else if (type === 'ADVANCED') {
      p.type = 'ADVANCED';
      p.sourceEquipLevel = realPhase(p.id);
      if (p.mode !== 'disabled') {
        let eh = String(p.effectHandling || p.reason || '');
        if (!/三星|星3/.test(eh)) eh = `三星解锁：${eh}`;
        if (!/四星|星4/.test(eh)) eh = `${eh}；四星加强：本效果随角色四星身体放大，逐卡数值按表×1.1。`;
        if (!/[0-9]/.test(eh)) eh = `${eh} 三星解锁后生效；四星加强：逐卡数值按表×1.1。`;
        p.effectHandling = eh;
        p.unlockStar = 3;
        p.attributeHandling = 'assaultEffectsOnly';
        p.replaceNativeParts = true;
      }
    }
  }
  const enabledAdv = (op.modulePlans || []).filter(p => p.type === 'ADVANCED' && p.mode !== 'disabled');
  const def = enabledAdv.find(p => p.mode === 'rewrite') || enabledAdv[0] || null;
  op.defaultModuleId = def ? def.id : null;
}

function closeTalents(op, raw) {
  const plans = new Map();
  for (const tp of op.talentPlans || []) plans.set(talentIdx(tp), tp);
  for (const tal of (raw.talents || [])) {
    if (!plans.has(tal.index)) {
      const tp = { name: '（补录）', sourcePointer: `/${op.charId}/talents/${tal.index}`, mode: 'retain', description: '', parameters: {}, scope: '自身' };
      plans.set(tal.index, tp); op.talentPlans.push(tp);
    }
  }
  // 先清空重复的 replacesTalentIndices，由本工具重新归属
  for (const mp of op.modePassives || []) delete mp.replacesTalentIndices;
  const bind = MODE_BIND[op.charId] || {};
  for (const tal of (raw.talents || [])) {
    const tp = plans.get(tal.index);
    tp.sourcePointer = `/${op.charId}/talents/${tal.index}`;
    if (isEmptyTalent(tal)) {
      tp.mode = 'retain'; tp.runtimeBinding = 'none'; tp.parameters = {};
      tp.description = '原生无效果的空天赋槽位，进击保留为空，不产生机制。'; tp.scope = '无';
      delete tp.stableKey; delete tp.trigger; delete tp.unlockStar;
      continue;
    }
    tp.parameters = nativeParams(tal, tp);
    if (bind[tal.index] != null) {
      tp.mode = 'rewrite'; tp.runtimeBinding = `modePassive:${bind[tal.index]}`;
      const mp = op.modePassives[bind[tal.index]];
      mp.replacesTalentIndices = [tal.index];
      mp.componentOfTalentIndex = tal.index;
      delete tp.stableKey; delete tp.trigger; delete tp.unlockStar;
    } else if (/^modePassive:(\d+)$/.test(tp.runtimeBinding || '')) {
      const mi = Number(tp.runtimeBinding.split(':')[1]);
      if (op.modePassives[mi]) {
        const refs = op.modePassives[mi].replacesTalentIndices || [];
        if (!refs.includes(tal.index)) refs.push(tal.index);
        op.modePassives[mi].replacesTalentIndices = refs;
      }
      delete tp.stableKey; delete tp.trigger; delete tp.unlockStar;
    } else {
      // 保留原生天赋，单份 assaultTalent
      let key = tp.stableKey;
      const a = /^assaultTalent:(.+)$/.exec(tp.runtimeBinding || '');
      if (a) key = a[1];
      if (!key) key = `native_talent_${tal.index}`;
      tp.runtimeBinding = `assaultTalent:${key}`;
      tp.stableKey = key;
      tp.trigger = tp.trigger || inferTrigger(tp.description);
      tp.scope = tp.scope && tp.scope !== '无' ? tp.scope : '自身';
      tp.unlockStar = tp.unlockStar || 1;
    }
  }
}

// ---------------- 主代理 12 条裁定 ----------------
function applyRulings(op) {
  const id = op.charId;
  const findTp = i => (op.talentPlans || []).find(t => talentIdx(t) === i);
  const dmgEff = () => (op.fixedSkill.effects || []).find(e => e.action === 'damage');
  const effectBy = act => (op.fixedSkill.effects || []).find(e => e.action === act);

  if (id === 'char_498_inside') {
    const tp = findTp(0);
    tp.mode = 'rewrite'; tp.runtimeBinding = 'modePassive:1';
    delete tp.stableKey; delete tp.trigger; delete tp.unlockStar;
    const mp = op.modePassives[1];
    mp.replacesTalentIndices = [0]; mp.componentOfTalentIndex = 0;
    mp.values = { ...mp.values, once: true, fullHpRedeployNoReset: true, clockContinues: true, selfAmmoCap: 3, lateranoAmmoCap: 1 };
    mp.description = '在场停留满20秒后一次性授予：自身弹药类技能弹药上限+3，并使随机一名拉特兰干员的弹药上限+1；每场战斗只授予一次。角色中途存活并因免费/正常满血再部署不会重置该20秒时钟，已授予的加成不被撤销。';
  }

  if (id === 'char_002_amiya') {
    const tp = findTp(0);
    tp.mode = 'rewrite'; tp.runtimeBinding = 'modePassive:0';
    delete tp.stableKey; delete tp.trigger; delete tp.unlockStar;
    op.modePassives[0].replacesTalentIndices = [0];
    op.modePassives[0].componentOfTalentIndex = 0;
    op.modePassives[1].componentOfTalentIndex = 0;
    delete op.modePassives[1].replacesTalentIndices;
    op.modePassives[0].description = '情绪吸收·攻击组件：自身攻击命中敌人时额外回复2/2.5/3/3.5点技力；与击杀组件共用 source index 0 的同一原生天赋组件组，第一项为 binding，原天赋不再单独安装。';
    op.modePassives[1].description = '情绪吸收·击杀组件：自身击杀敌人时额外获得8/10/12/14点技力；与攻击组件同属 source index 0 的完整组件组，不是第二份原生天赋。原生固定2/8模板不再执行。';
  }

  if (id === 'char_279_excu') {
    const d = dmgEff();
    delete d.values.defPenetrateFixed;
    d.values = { ...d.values, inheritTalentPierce: true, pierceSourceTalentIndex: 0 };
    d.description = '立即对范围内每个敌人连续结算2次物理伤害，每击为攻击力80%/90%/100%/115%；无视目标160点防御为继承终结改装天赋的展示值，同一来源只计160一次，不在技能内额外再叠加第二份穿防。';
  }

  if (id === 'char_206_gnosis') {
    const tp0 = findTp(0);
    tp0.mode = 'rewrite'; tp0.runtimeBinding = 'modePassive:0';
    delete tp0.stableKey; delete tp0.trigger; delete tp0.unlockStar;
    const mp0 = op.modePassives[0];
    mp0.replacesTalentIndices = [0]; mp0.componentOfTalentIndex = 0;
    mp0.trigger = '自身普通攻击成功命中敌人';
    mp0.target = '该目标与自身攻击范围内处于寒冷/冻结的敌人';
    mp0.action = 'applyStatus';
    mp0.values = { coldDuration: [1, 1, 1, 1], fragileCold: [0.15, 0.18, 0.23, 0.25], frozenMultiplier: 2, singleSourceExecution: true };
    mp0.description = '坚冰由本被动单份执行：普攻成功命中时对目标施加1秒寒冷，同时维持自身攻击范围内寒冷敌人的15%/18%/23%/25%脆弱、冻结敌人脆弱×2；原天赋不再另行运行，不叠两份触发。';
    // S2：取消二充能；额外寒层按施放前快照判定
    op.fixedSkill.maxCharge = 1;
    op.fixedSkill.chargeCount = 1;
    const extra = (op.fixedSkill.effects || []).find(e => e.values && e.values.mechanismName === '零度爆发·追加寒层');
    if (extra) {
      extra.trigger = '同一结算命中施放前已处于寒冷或冻结的目标（施放前快照）';
      extra.values = { mechanismName: '零度爆发·追加寒层', preCastSnapshot: true, extraColdLayers: 1, coldToFreeze: true };
      extra.description = '按本次施放前的寒冷/冻结快照判定：仅对施放前已处于寒冷或冻结的目标额外追加1层寒冷，达标转冻结；不先施加基础寒冷再判定，避免所有目标都被判为双层。';
    }
    op.modePassives[1].description = '队伍每次成功施加寒冷或冻结（含本技能的两次独立命中与派生额外寒层）都独立计一次冰控事件，使灵知前方一格友军攻击+5%/6%/7%/8%本战斗累加，初雪充能同口径；免疫、失败、仅光环维持不计；visits 只禁止同一路径回访自身，不按“派生”类别删除合法事件。';
    op.fixedSkill.description = '自然技力满立即对攻击范围内所有敌人造成相当于攻击力160%/180%/200%/230%的法术伤害并施加3/3.5/4/4.5秒寒冷；仅对施放前已处于寒冷或冻结的目标额外追加一次寒冷，达标可冻结。按施放前状态快照判断，不等待下一次普通攻击；每次成功施加（包括追加寒层）分别计一次队伍冰控事件。';
  }

  if (id === 'char_4072_ironmn') {
    const su = effectBy('summon');
    su.values = { tokenKey: 'token_10027_ironmn_pile2', count: 1, stockCap: 3, deployMax: 2, doesNormalAttack: false, blockCnt: 0, attackKind: 'none', ownerUid: 'char_4072_ironmn', lifeScaleFactor: 5, lifeScaleApplyOnce: true };
    delete su.values.tokenVariants;
    su.description = '获得1个支援装置（源模板 token_10027_ironmn_pile2，不同时生成 pile1/3），库存上限3、最多同时部署2个；忠于实际源辅助装置：装置不普攻、不阻挡（blockCnt 0、attackKind none），ownerUid 为白铁本体；生命使用源模板基线后整体×5一次。';
    const d = dmgEff();
    d.values = { atkScale: [1.4, 1.5, 1.6, 1.75], damageSource: 'operator', scaleBasis: 'ownerAtk', perDevice: false, dmgType: 'phys' };
    d.description = '对范围内每个敌人结算一笔白铁本体攻击力140%/150%/160%/175%的物理伤害（damageSource=operator、scaleBasis=ownerAtk、perDevice=false），不按装置数量放大。';
    const nm = (op.fixedSkill.effects || []).find(e => e.values && e.values.mechanismName === '装置充能作战');
    nm.values = {
      mechanismName: '装置充能作战', duration: [15, 18, 22, 25], spInterval: [3.5, 3, 2.5, 2], spEntryPerTick: 1,
      hpDrainTarget: 'device', hpDrainBaseRatio: 0.02, hpDrainEnhancedRatio: 0.04, hpDrainScaleFactor: 1, maxHpPercentNotRescaled: true,
      chargedTargetSelect: 'deviceFrontTileElseAdjacent8NaturalSpNotFullMaxGap', tieFormationOrder: true, allowOwner: true,
      repairAdd: [0.4, 0.45, 0.5, 0.6], repairBasis: 'netActualHeal', repairNoSelfRecurse: true,
      deviceShatterTriggersOwnerRetreatRecycle: true, atk: [0.4, 0.5, 0.6, 0.75], def: [0.4, 0.5, 0.6, 0.75]
    };
    nm.description = '15/18/22/25秒内装置强化：使装置正前方一格友军（无则取装置八邻自然技力未满且缺口最高者，同值按编队顺序，可选白铁自身）每3.5/3/2.5/2秒实际入账1点技力；每tick按装置新最大生命的2%基础耗损、强化×2=4%，只扣装置不扣本体/受充能友军，此百分比不再额外×5；满血时治疗不产生净入账；装置碎裂触发源退场回收逻辑；被治疗时按净实际治疗量附加40%/45%/50%/60%的修复，沿因果路径不再次自回修复。自身攻击与防御+40%/50%/60%/75%并攻击所有阻挡的敌人。';
    op.fixedSkill.description = '自然技力满立即获得1个支援装置（携带上限3个、最多同时部署2个，模板 token_10027_ironmn_pile2，源模板基线生命×5一次），并以白铁本体攻击力140%/150%/160%/175%对范围内每个敌人结算一笔物理伤害，不按装置数放大。随后15/18/22/25秒内装置进入充能作战：为指定友军每3.5/3/2.5/2秒实际入账1点技力，装置自身每秒损失其新最大生命的4%（基础窗口为2%）；不扣白铁或受充能友军生命。白铁攻击力和防御力+40%/50%/60%/75%，并攻击所有阻挡的敌人。';
    const mp0 = op.modePassives[0];
    mp0.replacesTalentIndices = [0]; mp0.componentOfTalentIndex = 0;
    mp0.description = '战地工程由本被动单份承接：对装置的治疗按净实际治疗量40%/45%/50%/60%修复装置生命，且沿因果路径不再触发自身修复（避免自回闭环）；装置占1个召唤格不占干员备用格，退场/损毁走源回收路径。';
  }

  if (id === 'char_2023_ling') {
    const su = effectBy('summon');
    su.values = { tokenKey: 'token_10020_ling_soul3', count: 1, stockCap: [4, 4, 5, 5], deployMax: 3, stockIndependentOfDeploy: true, ownerUid: 'char_2023_ling', attackKind: 'arts' };
    su.description = '获得1个可部署近战位的小龙（源模板 token_10020_ling_soul3）；携带上限[4,4,5,5]指未部署库存，部署最多3个（大龙占1格为进击改写明示）；场上部署已满不阻止库存未满时继续取得，库存满才停止。';
    const mg = (op.fixedSkill.effects || []).find(e => e.values && e.values.mechanismName === '召唤物合并');
    mg.values = { mechanismName: '召唤物合并', formName: '大龙', derivedTemplateId: 'assault_ling_large', sourceTemplateId: 'token_10020_ling_soul3', notIndependentNativeId: true, occupySlots: 1, statMultiplier: 1.8, dmgType: 'arts', aoeInterval: 0.5, aoeAtkScale: [0.2, 0.22, 0.25, 0.3], transformEarlierByOrder: true, absorbedEventOnLater: true, transformerNoDeathRecycle: true, ownerUid: 'char_2023_ling' };
    mg.description = '两只小龙在彼此攻击范围内合并为1只大龙：无独立原生charID，derivedTemplateId=assault_ling_large、sourceTemplateId=token_10020_ling_soul3（进击派生，不伪造源id）；按编队/创建顺序在前的先者变形，后者产生一次 absorbed 事件，变形者不产生死亡/回收事件，不能算两次；大龙占1召唤格，合计属性×1.8，攻击为法术，每0.5秒对周围四邻造成令攻击力20%/22%/25%/30%法术伤害；只有自身 ownerUid 的召唤事件计数。';
    const lingSummon = effectBy('summon');
    lingSummon.stacking = '未部署库存独立计数，上限随星级为4/4/5/5；部署上限3不阻止库存未满时取得。';
    lingSummon.limits = '每次技能最多获得1个库存小龙；库存满时不新增，同时部署上限为3（大龙占1）。';
    const tp0 = findTp(0);
    tp0.mode = 'retain'; tp0.runtimeBinding = 'assaultTalent:ling_carry_cap'; tp0.stableKey = 'ling_carry_cap';
    tp0.trigger = '自身在场上（携带/部署校验）'; tp0.scope = '自身召唤栏'; tp0.unlockStar = 1;
    op.modePassives[0].values = { ...op.modePassives[0].values, statKind: 'attack', atkPerStack: [0.02, 0.025, 0.03, 0.035], maxStacks: 5 };
    op.modePassives[0].description = '召唤物被击倒/吸收/回收时（仅自身 ownerUid 事件），令获得2/2.5/3/3.5点技力并叠1层“攻击”+2%/2.5%/3%/3.5%（是攻击不是攻速），最多5层，持续到战斗结束。';
  }

  if (id === 'char_1035_wisdel') {
    const su = effectBy('summon');
    su.values = { ...su.values, persistAfterSkill: true, persistAfterBattle: false, lifecycle: 'battle', ownerUid: 'char_1035_wisdel', sharesOwnerSummonCapacity: true };
    const d = dmgEff();
    d.values = { ...d.values, mainTargetSelect: 'closestToGoalEligibleTieEnemyId', mainTargetScale: 1.15, mainTargetOnly: true, damageTags: ['mainImpact', 'aftershock'] };
    d.description = '固定技能施放前按原优先规则选一个主目标（离终点最近的可选敌人，同进度按enemyID），仅对该主目标冲击倍率×1.15；对范围内每个地面敌人结算一次物理冲击，并附带2次各50%攻击力的余震，均使用具名伤害标签 mainImpact/aftershock。';
    const mp0 = op.modePassives[0];
    mp0.trigger = '自身普通攻击成功命中主目标';
    mp0.values = { ...mp0.values, attachRemnant: true, uniquePerOwnerEnemy: true, remnantRefresh: true, detonateOnAftershock: true, damageTags: ['remnantAttach', 'remnantDetonation'] };
    mp0.description = '好礼由本被动组件群单份承接：自身普攻主目标成功命中时附着唯一 remnant 标记（同 owner 每敌一份、重复命中刷新），余震命中该 remnant 时按15%/18%/20%/25%概率引爆，造成攻击力120%/130%/150%/170%的半径1物理伤害并晕眩0.5/0.7/1/1.2秒；附着与引爆属同一来源，不能漏掉附着。魂影部署天赋与技能共用同一 owner 召唤容量记录。';
    const tp1 = findTp(1);
    tp1.runtimeBinding = 'assaultTalent:wisdel_soul_shadow'; tp1.stableKey = 'wisdel_soul_shadow';
    tp1.trigger = '自身部署入场'; tp1.scope = '自身与魂灵之影'; tp1.unlockStar = 1;
  }

  if (id === 'char_4100_caper') {
    op.fixedSkill.minimumSpCost = 0.5;
    const mp0 = op.modePassives[0];
    mp0.values = { ...mp0.values, minimumSpCost: 0.5, onceMarkForNextInstant: true, consumeOnlyOnActualCast: true, permanentZero: false };
    mp0.description = '每次普攻触发戏耍随心暴击时，为“下一个成功瞬发结算”打一次减费标记，使该次所需技力减少1/1.5/2/2.5点且最低只到0.5；失败或无实际结算不消费标记，不永久降为零费用。';
  }
}

for (const op of design.operators) {
  const raw = rawById.get(op.charId);
  if (!raw) continue;
  closeModules(op, raw);
  closeTalents(op, raw);
}
for (const op of design.operators) applyRulings(op);

// 二次校验式补齐：任何非空天赋都必须有合法 binding（防止裁定遗漏）
for (const op of design.operators) {
  const raw = rawById.get(op.charId);
  if (!raw) continue;
  const plans = new Map((op.talentPlans || []).map(t => [talentIdx(t), t]));
  for (const tal of (raw.talents || [])) {
    const tp = plans.get(tal.index);
    if (!tp || isEmptyTalent(tal)) continue;
    if (!/^(modePassive:\d+|assaultTalent:.+)$/.test(tp.runtimeBinding || '')) {
      const key = `native_talent_${tal.index}`;
      tp.runtimeBinding = `assaultTalent:${key}`; tp.stableKey = key;
      tp.trigger = tp.trigger || inferTrigger(tp.description);
      tp.scope = tp.scope && tp.scope !== '无' ? tp.scope : '自身';
      tp.unlockStar = tp.unlockStar || 1;
      if (!tp.parameters || !Object.keys(tp.parameters).length) tp.parameters = nativeParams(tal, tp);
    }
  }
}

fs.writeFileSync(FILE, JSON.stringify(design, null, 2) + '\n', { encoding: 'utf8' });
console.log(JSON.stringify({ normalized: 'ranged', file: FILE, operators: design.operators.length }));
