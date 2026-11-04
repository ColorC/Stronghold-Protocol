// 支援/近战组逐卡设计语义收口工具。
// 默认：独立语义校验（读取 JSON 与 canonical 上下文，报告真实约束错误）。
// --apply：按主设计确定性收口后写回同一 JSON，再执行同样的语义校验。
// 校验不复用 --apply 的中间结果，只读磁盘最终 JSON。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CTX_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/assault/roster-contexts';
const GROUPS = ['support', 'assault'];
const VALUE_LABEL = {
  atkScale: '攻击倍率', healRatio: '治疗', healScale: '治疗', costGain: '费用', spGain: '技力',
  spPerSec: '每秒技力', attackSpeed: '攻速', duration: '持续', barrierRatio: '屏障', atk: '攻击',
  atkBonus: '攻击加成', def: '防御', atkPerSec: '每秒攻击', hpPerSec: '每秒生命', maxStacks: '最大层数'
};

function flattenNums(o, out = []) {
  if (o == null) return out;
  if (typeof o === 'number') { out.push(o); return out; }
  if (Array.isArray(o)) { for (const x of o) flattenNums(x, out); return out; }
  if (typeof o === 'object') for (const k of Object.keys(o)) flattenNums(o[k], out);
  return out;
}
function talentIdx(tp) {
  const m = String(tp?.sourcePointer || '').match(/talents\/(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : NaN;
}
function nativeLast(tal) { const c = tal?.candidates || []; return c[c.length - 1] || null; }
function isEmptyTalent(tal) { const last = nativeLast(tal); return !last || !last.name; }
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
function summarizeValues(values, si) {
  const parts = [];
  for (const k of Object.keys(values || {})) {
    const v = values[k];
    if (typeof v === 'number') parts.push(`${VALUE_LABEL[k] || k}${v}`);
    else if (Array.isArray(v) && v.length && v.every(x => typeof x === 'number')) {
      parts.push(`${VALUE_LABEL[k] || k}${v.length === 4 ? v[si] : v[0]}`);
    }
  }
  return parts.join('、') || '效果按逐卡表';
}
function generateSkill(op, si) {
  const sp = (op.fixedSkill.spCosts || [])[si];
  const init = [op.fixedSkill.initSp].flat();
  const eff = (op.fixedSkill.effects || []).map(e => summarizeValues(e.values, si)).join('；');
  return `技力${sp}、初始${init.length === 4 ? init[si] : init[0]}：${eff}。`;
}
function generatePassive(op, si) {
  const parts = [];
  for (const tp of op.talentPlans || []) if (!/空天赋槽/.test(tp.description || '')) parts.push(summarizeValues(tp.parameters, si));
  for (const mp of op.modePassives || []) parts.push(summarizeValues(mp.values, si));
  return [...new Set(parts)].join('；') + '。';
}
function resolveStars(op) {
  let lastSkill = '', lastPassive = '';
  for (const s of op.stars || []) {
    let sc = s.skillChange || '';
    if (!/[0-9]/.test(sc) || /同左/.test(sc)) sc = lastSkill || generateSkill(op, s.star - 1);
    s.skillChange = sc; lastSkill = sc;
    let pc = s.passiveChange || '';
    if (!/[0-9]/.test(pc) || /同左/.test(pc)) pc = lastPassive || generatePassive(op, s.star - 1);
    s.passiveChange = pc; lastPassive = pc;
  }
}
function stripSuffix(text, re) { return String(text || '').replace(re, ''); }

// ---------------- deterministic closure ----------------
function closeOperator(op, raw) {
  const mods = raw.modules || [];
  const modMeta = new Map(mods.map(m => [m.id, m]));
  for (const p of op.modulePlans || []) {
    const meta = modMeta.get(p.id);
    if (meta) p.type = meta.type;
    if (p.effect && !p.effectHandling) { p.effectHandling = p.effect; delete p.effect; }
    if (meta && meta.type === 'INITIAL') {
      p.mode = 'disabled';
      p.reason = '初始模组仅作来源记录，不施加数值。';
      p.effectHandling = '禁用：不装入战斗，仅登记来源。';
    } else if (meta && meta.type === 'ADVANCED' && p.mode !== 'disabled') {
      let eh = String(p.effectHandling || '');
      const has3 = /三星|星3/.test(eh), has4 = /四星|星4/.test(eh);
      if (!has3 && !has4) eh = `三星解锁：${eh.replace(/^改写为：/, '')}；四星加强：本效果随角色四星身体放大，无额外模块机制。`;
      else if (!has4) eh = `${eh}；四星加强：本效果随角色四星身体放大，无额外模块机制。`;
      else if (!has3) eh = `三星解锁：${eh}`;
      p.effectHandling = eh;
      p.unlockStar = 3;
    }
  }
  const enabledAdv = (op.modulePlans || []).filter(p => modMeta.get(p.id)?.type === 'ADVANCED' && p.mode !== 'disabled');
  const def = enabledAdv.find(p => p.mode === 'rewrite') || enabledAdv[0] || null;
  op.defaultModuleId = def ? def.id : null;

  const plansByIdx = new Map();
  for (const tp of op.talentPlans || []) plansByIdx.set(talentIdx(tp), tp);
  const talents = raw.talents || [];
  for (const tal of talents) {
    if (!plansByIdx.has(tal.index)) {
      const tp = { name: '（补录）', sourcePointer: `/char/talents/${tal.index}`, mode: 'retain', description: '', parameters: {}, scope: '自身' };
      plansByIdx.set(tal.index, tp); op.talentPlans.push(tp);
    }
  }
  const nonEmpty = [];
  for (const tal of talents) {
    const tp = plansByIdx.get(tal.index);
    if (!tp) continue;
    if (isEmptyTalent(tal)) {
      tp.mode = 'retain'; tp.runtimeBinding = 'none'; tp.parameters = {};
      tp.description = '原生无效果的空天赋槽位，进击保留为空，不产生机制。'; tp.scope = '无';
      delete tp.stableKey; delete tp.trigger; delete tp.unlockStar;
    } else {
      nonEmpty.push(tal.index);
      if (!tp.parameters || !Object.keys(tp.parameters).length) {
        const bb = {};
        for (const b of (nativeLast(tal)?.blackboard || [])) bb[b.key] = (b.valueStr != null && typeof b.value !== 'number') ? b.valueStr : b.value;
        tp.parameters = bb;
      }
    }
  }
  for (const mp of op.modePassives || []) delete mp.replacesTalentIndices;
  const assigned = new Set();
  for (const idx of nonEmpty) {
    const tp = plansByIdx.get(idx);
    const tn = flattenNums(tp.parameters);
    let best = -1, bestScore = 0;
    if (tn.length) {
      for (const [i, mp] of (op.modePassives || []).entries()) {
        if (assigned.has(i)) continue;
        const mn = flattenNums(mp.values);
        if (!mn.length) continue;
        const inter = tn.filter(x => mn.includes(x)).length;
        if (!inter) continue;
        const score = inter / Math.max(tn.length, mn.length);
        if (score > bestScore) { bestScore = score; best = i; }
      }
    }
    if (best >= 0 && bestScore >= 0.5) {
      assigned.add(best);
      op.modePassives[best].replacesTalentIndices = [idx];
      tp.runtimeBinding = `modePassive:${best}`;
      delete tp.stableKey; delete tp.trigger; delete tp.unlockStar;
    } else {
      tp.runtimeBinding = `assaultTalent:native_talent_${idx}`;
      tp.stableKey = `native_talent_${idx}`;
      if (!tp.trigger) tp.trigger = inferTrigger(tp.description);
      if (!tp.scope) tp.scope = '自身';
      tp.unlockStar = tp.unlockStar || 1;
    }
  }
  resolveStars(op);
}

function talent(op, i) { return (op.talentPlans || []).find(t => talentIdx(t) === i); }

function applySpecific(design) {
  const get = id => design.operators.find(o => o.charId === id);

  // 凛御银灰：删除重复 recast 被动，改为再部署触发的限时加速。
  const sv = get('char_1045_svash2');
  if (sv) {
    sv.modePassives = [{
      trigger: '本队真实干员每次成功再部署完成', target: '自身', action: 'haste',
      values: { spRegenBonus: [1, 1, 1, 1], duration: [2, 2, 2.5, 3] }, lifecycle: 'battle',
      description: '本队任一真实干员每次成功再部署后，自身获得2/2/2.5/3秒加速：自然技力回复率额外+100%（即每秒额外1点），重复触发把剩余时长累加，不提高同名速率。召唤物、装置、复制体的再部署不计入。',
      stacking: '同名加速只累加剩余时长，不叠加速率上限；与其它异源加速各自结算。',
      limits: '每次真正再部署触发一次；本模式新增被动，不挂在任何原生天赋空槽。'
    }];
    for (const e of sv.fixedSkill.effects) if (e.action === 'redeploy') {
      e.target = '当前战斗部署费用最高的合格干员（可选择自身）';
      e.values = { costReduce: [5, 5, 5, 5], immediateSkill: [1, 1, 1, 1], maxTargets: [1, 1, 1, 1], includeSelf: [1, 1, 1, 1], immediateSkillOnce: [1, 1, 1, 1], extraCastRedeployDisabled: [1, 1, 1, 1] };
      e.description = '选择当前战斗部署费用最高的合格干员（同值按编队顺序，自身可为最高费用目标），费用降低5并发起再部署：倒地/等待单位在原位立即部署，存活单位恢复全部生命；该次再部署使目标在同位置立即施放一次固定技能（仅此一次），且该次额外施放中的再部署部分禁用，其伤害、治疗、状态与其它合法天赋照常结算。';
      e.limits = '每次技能结算只发起一次再部署，额外施法中的再部署不再次发动。';
    }
    for (const i of [0, 1]) { const tp = talent(sv, i); if (tp) { tp.runtimeBinding = `assaultTalent:native_talent_${i}`; tp.stableKey = `native_talent_${i}`; tp.trigger = tp.trigger || inferTrigger(tp.description); tp.scope = tp.scope || '自身'; tp.unlockStar = 1; } }
    sv.causalChecks = [
      '最高费用同值时固定按编队顺序选择，自身可被选中；被选目标存活时恢复全部生命且不清空状态。',
      '再部署后立即施放的固定技能只执行一次，其再部署部分不再次发动，避免自递归与双发；其它技能效果正常结算。',
      '本队每次真实再部署为自身叠加2/2/2.5/3秒加速，重复触发累加剩余时长而不提高同名速率；召唤物/装置/复制体再部署不触发。'
    ];
    const dur = [2, 2, 2.5, 3];
    for (const s of sv.stars) {
      const base = stripSuffix(s.passiveChange, /；本队真实再部署后自身加速\+100%持续[^。]*。?$/);
      s.passiveChange = base.replace(/。?$/, '') + `；本队真实再部署后自身加速+100%持续${dur[s.star - 1]}秒（剩余时长累加）。`;
    }
  }

  // 新约能天使：原天赋由 modePassive 单份承接，空槽不改写，投送自动选目标。
  const an = get('char_1041_angel2');
  if (an) {
    const tp0 = talent(an, 0);
    if (tp0) {
      tp0.mode = 'rewrite'; tp0.runtimeBinding = 'modePassive:0';
      tp0.description = '原生弹药联动改由 modePassive[0] 单份承接：友方每枚真实弹药被消耗时回复自身6%生命，并按星概率对消耗者攻击范围造成轰炸；源天赋不再另行运行，避免双份叠装。';
      delete tp0.stableKey; delete tp0.trigger; delete tp0.unlockStar;
    }
    for (const i of [2, 3]) { const t = talent(an, i); if (t) { t.mode = 'retain'; t.runtimeBinding = 'none'; t.parameters = {}; t.description = '原生无效果的空天赋槽位，进击保留为空；快速装填/空投校准另列为 modePassives，不伪装成原生天赋。'; t.scope = '无'; delete t.stableKey; delete t.trigger; delete t.unlockStar; } }
    an.modePassives = [
      {
        trigger: '任意友方干员消耗真实弹药（按 ammoUsed 记录 quantity 逐枚）', target: '自身与消耗者攻击范围', action: 'heal',
        values: { healRatio: [0.06, 0.06, 0.06, 0.06], bombChance: [0.2, 0.2, 0.25, 0.25], bombAtkScale: [1.05, 1.05, 1.5, 1.5], splashRadius: [1, 1, 1, 1] }, lifecycle: 'battle',
        description: '弹药扳机：友方每消耗1枚真实弹药结算一次，自身回复6%生命，并按20%/20%/25%/25%概率对消耗者攻击范围造成自身攻击力105%/105%/150%/150%的物理半径1溅射轰炸。同一次攻击消耗多枚则按 ammoUsed 记录 quantity 逐枚分别计数。',
        stacking: '按真实弹药枚数逐枚计数，同一枚只结算一次。',
        limits: '只统计真实被消耗的弹药，不给未携带弹药的干员虚构消耗。',
        replacesTalentIndices: [0]
      },
      {
        trigger: '自身弹药打空', target: '自身', action: 'spGain',
        values: { spGain: [5, 5, 5, 6], perBattle: [3, 3, 3, 4] }, lifecycle: 'instant',
        description: '进击新增被动「快速装填」：弹药打空后立即回复5/5/5/6点技力，每场战斗最多触发3/3/3/4次。',
        stacking: '每场战斗限次，打空事件逐次计数。', limits: '每场3/3/3/4次；与原生空槽无关，不伪装原生天赋。', unlockStar: 3
      },
      {
        trigger: '成功投送队友后', target: '自身', action: 'addBuff',
        values: { splashBonus: [0.2, 0.2, 0.3, 0.3], once: [1, 1, 1, 1] }, lifecycle: 'battle',
        description: '进击新增被动「空投校准」：每次成功投送队友后，自身下一次施放的溅射伤害+20%/20%/30%/30%，仅生效一次。',
        stacking: '多次投送只保留一次未消耗加成，取最高值。', limits: '四星解锁；成功投送事件每次刷新一次。', unlockStar: 4
      }
    ];
    an.fixedSkill.effects = [
      {
        trigger: '技力自然回满时自动施放', target: '攻击范围内敌人', action: 'ammo',
        values: { ammoCount: [50, 50, 50, 50], hitsPerAttack: [5, 5, 5, 5], atkScalePerHit: [1.35, 1.45, 1.5, 1.6], ammoPerAttack: [5, 5, 5, 5] }, lifecycle: 'battle',
        description: '获得50发弹药，每次攻击消耗5发并造成5段攻击力135%/145%/150%/160%的物理伤害，打空后结束。',
        stacking: '新施放重置弹药为满值，不累加。', limits: '弹药每场按实际装填量，不虚构额外消耗。'
      },
      {
        trigger: '同一结算且存在合格投送目标', target: '自动选中的本队真实地面干员当前/保留原位', action: 'targeting',
        values: { selectLongestRespawn: [1, 1, 1, 1], includeDownedWaiting: [1, 1, 1, 1], excludeSummonDeviceClone: [1, 1, 1, 1], tieFormationOrder: [1, 1, 1, 1], requireEligibleTarget: [1, 1, 1, 1] }, lifecycle: 'instant',
        description: '自动选中本队再部署剩余时间最长的真实地面干员（含倒地等待；排除召唤物、装置、复制体；同值按编队顺序），以其当前/保留原位为落点；无合格目标则不制造假坐标，只完成装填。',
        stacking: '每次施放至多选1名。', limits: '仅本队真实地面干员；无合格目标时跳过溅射与投送。'
      },
      {
        trigger: '选中合格投送目标时', target: '该落点', action: 'damage',
        values: { atkScale: [2.5, 2.5, 2.5, 2.5], splashRadius: [1, 1, 1, 1], damageType: ['物理', '物理', '物理', '物理'] }, lifecycle: 'instant',
        description: '在该落点结算攻击力250%的物理半径1溅射伤害。', stacking: '每次施放一次。', limits: '仅在存在合格投送目标时结算。'
      },
      {
        trigger: '选中合格投送目标时', target: '该名再部署剩余时间最长的真实地面干员', action: 'redeploy',
        values: { targetCount: [1, 1, 1, 1], spGain: [6, 6, 6, 6], freeRedeploy: [1, 1, 1, 1], keepPosition: [1, 1, 1, 1] }, lifecycle: 'instant',
        description: '将该目标免费再部署到其当前/保留原位，并使其获得6点技力；存活目标原位满血，不搬到其它敌人格、不清状态、不打断当前弹药/攻击，该次再部署不再发动其技能中的再部署部分。',
        stacking: '每次施放最多1名，同值按编队顺序取最前。', limits: '仅存在合格目标时结算。'
      }
    ];
    an.fixedSkill.description = '自然技力回满时立即自动结算：进入弹药状态并立即发射一轮，每次攻击为5连击；随后自动选中再部署剩余时间最长的本队真实地面干员，以其当前/保留原位为落点结算250%物理半径1溅射并免费再部署并给6技力；无合格目标则只装填。';
    an.designReason = '以原生使命必达与火力电台为核心：技力回满即装填弹药并持续连击，自动选中再部署最久的本队真实地面干员为落点造成溅射并把其投送回原位给技力，保留弹药与再部署联动。';
    an.causalChecks = [
      '同值再部署时间时投送按编队顺序取最前，不消耗随机数；被投送干员技能中的再部署部分不再发动，其它天赋照常结算。',
      '每消耗1枚真实弹药（按 ammoUsed 记录 quantity 逐枚）结算一次回复与至多一次概率轰炸；不给未携带弹药的干员虚构消耗。',
      '存在合格目标时落点为其当前/保留原位，存活目标满血不移动、不清状态、不打断攻击；无合格目标只装填，不制造假坐标。',
      '火力电台只由 modePassive[0] 单份运行，原生天赋不另跑；快速装填/空投校准为独立 modePassives 且按星解锁。'
    ];
    an.stars[1].passiveChange = '弹药联动回6%/20%轰炸（105%物理半径1）；协约+9%。';
    an.stars[2].passiveChange = '弹药联动回6%/25%轰炸（150%物理半径1）；协约+9%；三星解锁快速装填回5技力（每场3次）。';
    an.stars[3].passiveChange = '弹药联动回6%/25%轰炸（150%物理半径1）；四星解锁空投校准溅射+30%，快速装填上限4次。';
    an.stars[3].skillChange = '每段160%；无合格投送目标时只装填，不制造假坐标。';
  }

  // 白面鸮：补回治疗职责；删除无参数且违反净入账的“不溢出浪费”；去掉全队加速公共上限。
  const pl = get('char_128_plosis');
  if (pl) {
    pl.fixedSkill.description = '技力满立即结算：先为全体友方回复一次生命，再短时提升全队攻击速度；保留医疗职责，不装成原生纯辅助技能。';
    if (!pl.fixedSkill.effects.some(e => e.action === 'heal' && /全体友方/.test(e.target))) {
      pl.fixedSkill.effects.unshift({
        trigger: '自然技力满', target: '全体友方', action: 'heal', values: { healRatio: [1.2, 1.5, 1.8, 2.2] }, lifecycle: 'instant',
        description: '立即为全体友方回复相当于自身攻击力120%/150%/180%/220%的生命；这是脑啡肽治疗职责的进击转译，不等待下一次普通攻击。',
        stacking: '每次结算对每个友方只结算一次。', limits: '每场战斗不限次数。'
      });
    }
    if (pl.modePassives[0]) {
      pl.modePassives[0].values = { spPerSec: [0.3, 0.4, 0.5, 0.6], duration: [8, 8, 10, 10] };
      pl.modePassives[0].description = '结算后8/8/10/10秒内全体友方每秒额外获得0.3/0.4/0.5/0.6点技力；同名取较强值不叠加，异源加速各自合法结算，不设全队公共上限。';
      pl.modePassives[0].stacking = '同名取较强值不叠加；与其它异源加速分别结算，不合并截断。';
      pl.modePassives[0].replacesTalentIndices = [0];
    }
    const tp0 = talent(pl, 0);
    if (tp0) { tp0.mode = 'rewrite'; tp0.runtimeBinding = 'modePassive:0'; tp0.description = '技力光环不再是常驻全场加速；改写为固定技能结算后限时全队自然回技力提升，由 modePassive[0] 单份承接，原生天赋不另运行。'; delete tp0.stableKey; delete tp0.trigger; delete tp0.unlockStar; }
    pl.causalChecks = [
      '限时回技力只在技能结算后生效，超时自动到期；没有永久加速残留。',
      '多个异源加速各自结算，不设全队公共上限、不互相截断；溢出技力不计入净入账。',
      '治疗与攻速在每次结算各自生效一次，治疗按攻击力比例计算并使用新的生命上限。'
    ];
    pl.stars[0].skillChange = '基准：治疗全体友方120%攻击；全队攻速+60持续10秒，技力100，初始20。';
    pl.stars[1].skillChange = '治疗150%攻击；全队攻速+90持续12秒，技力80，初始20。';
    pl.stars[2].skillChange = '治疗180%攻击；全队攻速+120持续14秒，技力90，初始30。';
    pl.stars[3].skillChange = '治疗220%攻击；全队攻速+150持续16秒，技力100，初始30。';
    pl.stars[3].passiveChange = '结算后10秒全队每秒+0.6技力。';
  }

  // 森蚺：未阻挡时不获得额外回复；原生天赋[1]与 modePassive 唯一绑定。
  const zu = get('char_416_zumama');
  if (zu) {
    zu.fixedSkill.description = '技力满立即对阻挡的敌人造成高倍物理伤害并晕眩；自身自然回技力固定1/秒，阻挡只额外提供回复。';
    if (zu.modePassives[0]) {
      zu.modePassives[0].values = { spPerSec: [0.15, 0.18, 0.2, 0.25] };
      zu.modePassives[0].description = '阻挡敌人时每秒额外获得0.15/0.18/0.2/0.25点技力；未阻挡时只是不获得这份额外回复，自然回技力仍固定为1/秒。';
      zu.modePassives[0].stacking = '每秒一次；与自然回技力分别入账，不叠成第二份自然回复。';
      zu.modePassives[0].replacesTalentIndices = [1];
    }
    const tp1 = talent(zu, 1);
    if (tp1) { tp1.mode = 'rewrite'; tp1.runtimeBinding = 'modePassive:0'; tp1.description = '愈战愈勇由 modePassive[0] 单份承接：阻挡时额外回复0.15/0.18/0.2/0.25技力/秒；原生天赋不另行运行，避免同加成双份结算。未阻挡时不获得此额外回复，而非停止自然回复。'; delete tp1.stableKey; delete tp1.trigger; delete tp1.unlockStar; }
    zu.implementationPlan = '复用决斗重装KIT；自然回技力固定1/秒，阻挡充能作为额外入账由 modePassive[0] 单份承接；技能瞬时damage+stun，血线增益保留。';
    zu.causalChecks = [
      '自然回技力始终为1/秒；阻挡时叠加额外0.15/0.18/0.2/0.25/秒，未阻挡时只失去这份额外回复。',
      '血线判定在伤害前采样；跨越一半时对应增益切换而非叠加。',
      '愈战愈勇只由 modePassive[0] 运行，原生天赋不再另外结算同一加成。'
    ];
    for (const s of zu.stars) {
      const base = stripSuffix(s.passiveChange, /（自然回1\/秒\+阻挡额外）。?$/);
      s.passiveChange = base.replace(/。?$/, '') + '（自然回1/秒+阻挡额外）。';
    }
  }

  // 香草：modePassive 的触发间隔必须与星级说明（三星起 6 秒）一致。
  const wy = get('char_240_wyvern');
  if (wy && wy.modePassives[0]) wy.modePassives[0].values.rechargeSec = [8, 8, 6, 6];

  // 百炼嘉维尔：战地巨斧由 modePassive 承接，星级说明必须跟随其运行数组（5/10/10/10% 与 3/4/4/4%）。
  const gv = get('char_1026_gvial2');
  if (gv) {
    const base = [0.05, 0.1, 0.1, 0.1], per = [0.03, 0.04, 0.04, 0.04];
    gv.stars.forEach((s, i) => {
      const def = Math.round(base[i] * 100), ex = Math.round(per[i] * 100);
      s.passiveChange = String(s.passiveChange).includes('医学背景')
        ? `战地巨斧+${def}%/每多挡+${ex}%；医学背景治疗+20/40%。`
        : `战地巨斧+${def}%/每多挡+${ex}%。`;
    });
  }
}

function applyGroup(group) {
  const ctx = JSON.parse(fs.readFileSync(`${CTX_ROOT}/${group}.json`, 'utf8'));
  const file = path.join(ROOT, `data/assault-design/roster-${group}.json`);
  const design = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rawById = new Map(ctx.operators.map(o => [o.charId, o]));
  for (const op of design.operators) {
    const raw = rawById.get(op.charId);
    if (!raw) continue;
    closeOperator(op, raw);
  }
  applySpecific(design);
  for (const op of design.operators) resolveStars(op);
  fs.writeFileSync(file, JSON.stringify(design, null, 2) + '\n', { encoding: 'utf8' });
  return file;
}

// ---------------- independent semantic validation ----------------
function validateGroup(group) {
  const ctx = JSON.parse(fs.readFileSync(`${CTX_ROOT}/${group}.json`, 'utf8'));
  const file = path.join(ROOT, `data/assault-design/roster-${group}.json`);
  const design = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = [];
  const required = new Map(ctx.operators.map(o => [o.charId, o]));
  const seen = new Set();
  if (design.schema !== 'assault-roster-design/v1' || design.group !== group) errors.push(`${group}: wrong schema/group`);
  for (const op of design.operators || []) {
    const raw = required.get(op.charId);
    if (!raw || seen.has(op.charId)) { errors.push(`${group}/${op.charId}: unknown/duplicate`); continue; }
    seen.add(op.charId);
    // modules
    const natIds = new Set((raw.modules || []).map(m => m.id));
    const planIds = new Set((op.modulePlans || []).map(m => m.id));
    for (const id of natIds) if (!planIds.has(id)) errors.push(`${op.charId}: module ${id} missing`);
    for (const id of planIds) if (!natIds.has(id)) errors.push(`${op.charId}: invented module ${id}`);
    const metaById = new Map((raw.modules || []).map(m => [m.id, m]));
    for (const p of op.modulePlans || []) {
      const meta = metaById.get(p.id);
      if (!meta) continue;
      if ((p.type || meta.type) !== meta.type) errors.push(`${op.charId}: module ${p.id} type mismatch`);
      if (meta.type === 'INITIAL' && p.mode !== 'disabled') errors.push(`${op.charId}: INITIAL ${p.id} must be disabled`);
      if (meta.type === 'ADVANCED' && !['disabled', 'retain', 'rewrite'].includes(p.mode)) errors.push(`${op.charId}: ADVANCED ${p.id} bad mode`);
      if (meta.type === 'ADVANCED' && p.mode !== 'disabled' && !/[0-9]/.test(String(p.effectHandling || '') + String(p.reason || ''))) errors.push(`${op.charId}: ADVANCED ${p.id} needs exact values`);
      if (meta.type === 'ADVANCED' && p.mode !== 'disabled') {
        const eh = String(p.effectHandling || '');
        if (!/三星|星3/.test(eh) || !/四星|星4/.test(eh)) errors.push(`${op.charId}: ADVANCED ${p.id} must state star3 unlock and star4 change`);
        if (p.unlockStar !== 3) errors.push(`${op.charId}: ADVANCED ${p.id} unlockStar must be 3`);
      }
    }
    if (!('defaultModuleId' in op)) errors.push(`${op.charId}: defaultModuleId missing`);
    const defPlan = (op.modulePlans || []).find(p => p.id === op.defaultModuleId);
    if (op.defaultModuleId) {
      if (!defPlan) errors.push(`${op.charId}: defaultModuleId not a module`);
      else {
        if (defPlan.mode === 'disabled') errors.push(`${op.charId}: defaultModuleId disabled`);
        if (metaById.get(defPlan.id)?.type !== 'ADVANCED') errors.push(`${op.charId}: defaultModuleId not advanced`);
      }
    } else {
      const anyEnabledAdv = (op.modulePlans || []).some(p => metaById.get(p.id)?.type === 'ADVANCED' && p.mode !== 'disabled');
      if (anyEnabledAdv) errors.push(`${op.charId}: defaultModuleId null despite enabled advanced module`);
    }
    // talents
    const rawTalents = raw.talents || [];
    const byIdx = new Map();
    for (const tp of op.talentPlans || []) {
      const i = talentIdx(tp);
      if (!Number.isInteger(i)) { errors.push(`${op.charId}: talent sourcePointer unparsable`); continue; }
      if (byIdx.has(i)) errors.push(`${op.charId}: talent ${i} duplicated`);
      byIdx.set(i, tp);
    }
    for (const t of rawTalents) if (!byIdx.has(t.index)) errors.push(`${op.charId}: native talent ${t.index} uncovered`);
    const emptyIdx = new Set(rawTalents.filter(isEmptyTalent).map(t => t.index));
    const mpRefs = new Map();
    for (const [i, mp] of (op.modePassives || []).entries()) {
      for (const r of (mp.replacesTalentIndices || [])) {
        if (mpRefs.has(r)) errors.push(`${op.charId}: talent ${r} replaced by two modePassives`);
        mpRefs.set(r, i);
      }
    }
    for (const [i, tp] of byIdx.entries()) {
      const rb = tp.runtimeBinding;
      if (emptyIdx.has(i)) {
        if (rb !== 'none') errors.push(`${op.charId}: empty talent ${i} binding must be none`);
        if (tp.mode !== 'retain') errors.push(`${op.charId}: empty talent ${i} must retain`);
        continue;
      }
      if (rb === 'none') { errors.push(`${op.charId}: non-empty talent ${i} binding none`); continue; }
      const m = /^modePassive:(\d+)$/.exec(rb || '');
      if (m) {
        const mi = Number(m[1]);
        if (!(op.modePassives || [])[mi]) errors.push(`${op.charId}: talent ${i} bad modePassive index`);
        else if (!(op.modePassives[mi].replacesTalentIndices || []).includes(i)) errors.push(`${op.charId}: talent ${i} not marked replaced in passive ${mi}`);
        else if (mpRefs.get(i) !== mi) errors.push(`${op.charId}: talent ${i} passive ref mismatch`);
        continue;
      }
      const a = /^assaultTalent:(.+)$/.exec(rb || '');
      if (a) {
        if (tp.stableKey !== a[1]) errors.push(`${op.charId}: talent ${i} stableKey mismatch`);
        if (!tp.parameters || !Object.keys(tp.parameters).length) errors.push(`${op.charId}: assaultTalent ${i} requires parameters`);
        if (!tp.trigger || !tp.scope) errors.push(`${op.charId}: assaultTalent ${i} requires trigger/scope`);
        if (!tp.unlockStar) errors.push(`${op.charId}: assaultTalent ${i} requires star`);
        continue;
      }
      errors.push(`${op.charId}: talent ${i} invalid runtimeBinding ${rb}`);
    }
    // stars
    if (!Array.isArray(op.stars) || op.stars.length !== 4) errors.push(`${op.charId}: four stars required`);
    else for (const s of op.stars) {
      const i = s.star - 1;
      if (s.atkMultiplier !== [1, 1.55, 2.2, 3][i] || s.hpMultiplier !== [1, 1.65, 2.6, 4][i]) errors.push(`${op.charId}: star ${s.star} body multipliers`);
      for (const k of ['skillChange', 'passiveChange']) {
        const v = s[k] || '';
        if (!/[0-9]/.test(v)) errors.push(`${op.charId}: star ${s.star} ${k} lacks values`);
        if (/同左/.test(v)) errors.push(`${op.charId}: star ${s.star} ${k} uses 同左`);
      }
      // 星级说明中出现的技力/初始数值必须与 spCosts/initSp 真源一致
      const spArr = op.fixedSkill?.spCosts || [];
      const initArr = [op.fixedSkill?.initSp].flat();
      const spText = String(s.skillChange).match(/技力\s*([0-9.]+)/);
      const initText = String(s.skillChange).match(/初始\s*([0-9.]+)/);
      if (spText && Number(spText[1]) !== spArr[i]) errors.push(`${op.charId}: star ${s.star} skillChange SP ${spText[1]} != ${spArr[i]}`);
      if (initText && Number(initText[1]) !== (initArr.length === 4 ? initArr[i] : initArr[0])) errors.push(`${op.charId}: star ${s.star} skillChange initSP ${initText[1]} != ${initArr.length === 4 ? initArr[i] : initArr[0]}`);
    }
    // skill
    const sk = op.fixedSkill || {};
    if (sk.kind === 'instant') {
      if (!Array.isArray(sk.spCosts) || sk.spCosts.length !== 4 || sk.spCosts.some(n => !(n > 0))) errors.push(`${op.charId}: spCosts`);
      const init = [sk.initSp].flat();
      if (!(init.length === 1 || init.length === 4)) errors.push(`${op.charId}: initSp`);
    }
    // geometry sanity
    const text = JSON.stringify(op);
    if (/八邻|周围8格|周围八格/.test(text) && /"radius":\s*\[\s*8/.test(text)) errors.push(`${op.charId}: eight tiles must not be radius 8`);
  }
  if (!allPartial) for (const id of required.keys()) if (!seen.has(id)) errors.push(`${group}: missing operator ${id}`);
  return { group, file, expected: required.size, actual: seen.size, errors };
}

// ---------------- markdown (deterministic from final JSON) ----------------
function renderDocs(group) {
  const file = path.join(ROOT, `data/assault-design/roster-${group}.json`);
  const design = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lines = [];
  lines.push(`# 进击逐卡设计 — ${group === 'support' ? '支援组' : '近战组'}`);
  lines.push('');
  lines.push(`来源修订：\`${design.sourceRevision}\`。共 ${design.operators.length} 名。数值为进击转译，非原作事实；生命基础整体×5，四星倍率统一 1/1.55/2.2/3（攻）与 1/1.65/2.6/4（生命）。`);
  lines.push('');
  for (const op of design.operators) {
    lines.push(`## ${op.name}（\`${op.charId}\`）`);
    lines.push(`- 职业：${op.profession}；档位：${op.priceTier}（${op.price} 金币）；路线：\`${op.archetype}\``);
    lines.push(`- 定位：${op.role}`);
    lines.push(`- 档位理由：${op.priceReason}`);
    lines.push(`- 设计理由：${op.designReason}`);
    lines.push('');
    const sk = op.fixedSkill || {};
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
    for (const t of op.talentPlans || []) {
      lines.push(`- ${t.name}（\`${t.sourcePointer}\`）：mode=${t.mode}；runtimeBinding=${t.runtimeBinding}${t.stableKey ? `；stableKey=${t.stableKey}` : ''}`);
      lines.push(`  - ${t.description}`);
      lines.push(`  - scope=${t.scope}；parameters=${JSON.stringify(t.parameters)}${t.trigger ? `；trigger=${t.trigger}` : ''}${t.unlockStar ? `；unlockStar=${t.unlockStar}` : ''}`);
    }
    lines.push('');
    lines.push('### 进击被动');
    for (const [i, p] of (op.modePassives || []).entries()) {
      lines.push(`- 被动${i}：${p.description}`);
      lines.push(`  - trigger=${p.trigger}；target=${p.target}；action=${p.action}；lifecycle=${p.lifecycle}`);
      lines.push(`  - values=${JSON.stringify(p.values)}；stacking=${p.stacking}；limits=${p.limits}${p.replacesTalentIndices ? `；replacesTalentIndices=${JSON.stringify(p.replacesTalentIndices)}` : ''}${p.unlockStar ? `；unlockStar=${p.unlockStar}` : ''}`);
    }
    lines.push('');
    lines.push('### 星级');
    for (const s of op.stars || []) {
      lines.push(`- ★${s.star}（攻×${s.atkMultiplier}、生命×${s.hpMultiplier}）：${s.skillChange}`);
      lines.push(`  - 被动：${s.passiveChange}`);
    }
    lines.push('');
    lines.push('### 模组');
    lines.push(`- 默认模组：${op.defaultModuleId ?? 'null'}`);
    for (const m of op.modulePlans || []) lines.push(`- \`${m.id}\`（${m.type || '-'}/${m.mode}）：${m.effectHandling || m.effect || ''}`);
    lines.push('');
    lines.push(`来源：\`${op.sourceRef?.file}\` → \`${op.sourceRef?.pointer}\``);
    lines.push(`实现：${op.implementationPlan}`);
    lines.push('因果检查：');
    for (const c of op.causalChecks || []) lines.push(`- ${c}`);
    lines.push('');
  }
  const out = path.join(ROOT, `docs/assault-mode/roster-${group}.md`);
  fs.writeFileSync(out, lines.join('\n') + '\n', { encoding: 'utf8' });
  return out;
}

const args = process.argv.slice(2);
const allPartial = args.includes('--partial');
const doApply = args.includes('--apply');
const doDocs = args.includes('--docs');
const groupArg = args.indexOf('--group');
const groups = groupArg >= 0 ? [args[groupArg + 1]] : GROUPS;
if (groups.some(g => !['support', 'assault', 'ranged'].includes(g))) throw new Error('--group must be support/assault/ranged');
if (doApply) for (const g of groups) { const f = applyGroup(g); console.log(JSON.stringify({ applied: g, file: f })); }
if (doDocs) for (const g of groups) { const f = renderDocs(g); console.log(JSON.stringify({ docs: g, file: f })); }
let failed = false;
for (const g of groups) {
  const r = validateGroup(g);
  const ok = !r.errors.length;
  failed = failed || !ok;
  console.log(JSON.stringify({ group: r.group, file: r.file, partial: allPartial, expected: r.expected, actual: r.actual, ok, errors: r.errors }));
}
process.exitCode = failed ? 1 : 0;
