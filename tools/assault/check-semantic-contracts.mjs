// 支援/近战逐卡语义契约校验（主代理裁定项）。
// 默认：只读校验 data/assault-design/roster-{support,assault}.json，逐项检查明确契约，退出码非零即失败。
// --apply：按裁定确定性写入同两个 JSON（幂等），随后执行同样的只读校验。
// 不修改 tools/assault/check-roster-consistency.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = {
  support: path.join(ROOT, 'data/assault-design/roster-support.json'),
  assault: path.join(ROOT, 'data/assault-design/roster-assault.json')
};
const deep = o => JSON.parse(JSON.stringify(o));
const arrEq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
const allNums = o => { const out = []; const walk = v => { if (v == null) return; if (typeof v === 'number') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (typeof v === 'object') Object.values(v).forEach(walk); }; walk(o); return out; };
const tIdx = tp => { const m = String(tp?.sourcePointer || '').match(/talents\/(\d+)(?:\/|$)/); return m ? Number(m[1]) : NaN; };

// ---------------- deterministic apply (主代理裁定) ----------------
function applyAll() {
  const S = JSON.parse(fs.readFileSync(FILES.support, 'utf8'));
  const A = JSON.parse(fs.readFileSync(FILES.assault, 'utf8'));
  const by = (d, id) => d.operators.find(o => o.charId === id);
  const tal = (o, i) => (o.talentPlans || []).find(t => tIdx(t) === i);

  // === 1/2 凛御银灰 ===
  const sv = by(S, 'char_1045_svash2');
  {
    const t0 = tal(sv, 0);
    t0.mode = 'rewrite';
    t0.description = '在场时向待部署区加入具名位置锚点「风雪之眼」，并令待部署区按当前战斗部署费用升序排列、同值按编队顺序。风雪之眼不是可战斗干员，不占人口、不可被攻击或治疗。位于其左侧的干员与自身初始技力+2/3/4/5，且其下一次再部署时间倍率为0.9/0.85/0.8/0.75。初始技力只在自然入场初始化时结算一次，存活原位免费满血再部署不重复发放。';
    t0.parameters = {
      initSp: [2, 3, 4, 5],
      respawnTimeMultiplier: [0.9, 0.85, 0.8, 0.75],
      anchorName: '风雪之眼',
      anchorKind: 'deployAnchor',
      anchorCombatant: false,
      anchorPopulation: 0,
      anchorAttackable: false,
      anchorHealable: false,
      deploySort: { key: 'currentBattleDeployCost', order: 'asc', tieBreak: 'formationOrder' },
      affectSide: 'anchorLeft',
      initSpTiming: 'naturalDeployInitOnly',
      initSpNotOnSurvivingRedeploy: true,
      respawnAppliesTo: 'nextRedeployMultiplier'
    };
    t0.trigger = '被动常驻/部署初始化';
    t0.scope = '风雪之眼左侧干员与自身';
    t0.runtimeBinding = 'assaultTalent:native_talent_0';
    t0.stableKey = 'native_talent_0';
    t0.unlockStar = 1;

    const t1 = tal(sv, 1);
    t1.mode = 'rewrite';
    t1.description = '银灰存活且已部署时，提供自身来源的在场谢拉格光环：免疫冻结（freezeImmune），防御+60/70/80/90，并每秒回复最大生命1.5%/1.8%/2.0%/2.2%；在场满15秒后防御与每秒回血系数翻倍（×2）。回血比例直接使用新maxHP一次，不再额外×5。撤退或倒地立即取消自身源光环；重新入场后15秒计时重新开始；存活原位免费满血再部署不重置15秒计时。光环保活本身不产生新的status/debuff计数，免疫冻结不算一次成功施加。';
    t1.parameters = {
      freezeImmune: true,
      freezeImmuneDoesNotCountAsApplied: true,
      def: [60, 70, 80, 90],
      hpPerSec: [0.015, 0.018, 0.02, 0.022],
      hpPerSecIsMaxHpRatio: true,
      hpHealAppliedMultiplier: 1,
      rampSec: 15,
      rampMultiplier: 2,
      auraScope: 'inFieldShelag',
      auraProvidedWhile: 'selfAliveAndDeployed',
      auraRevokedOnExit: true,
      rampRestartOnReentry: true,
      noRampResetOnSurvivingRedeploy: true,
      auraKeepaliveEmitsStatus: false
    };
    t1.trigger = '来源部署/在场时钟与退场';
    t1.scope = '在场谢拉格干员（银灰为来源）';
    t1.runtimeBinding = 'assaultTalent:native_talent_1';
    t1.stableKey = 'native_talent_1';
    t1.unlockStar = 1;

    const dur = [2, 2, 2.5, 3];
    const inits = [2, 3, 4, 5], mult = [0.9, 0.85, 0.8, 0.75], def = [60, 70, 80, 90], hp = [1.5, 1.8, 2, 2.2];
    const pre = ['基准：', '', '', ''];
    const tail = i => `本队真实再部署后自身加速+100%持续${dur[i]}秒（剩余时长累加）。`;
    sv.stars.forEach((s, i) => {
      s.passiveChange = `${pre[i]}风雪之眼（锚点，不占人口）左侧及自身初始技力+${inits[i]}、下次再部署×${mult[i]}；雪境先驱（自身源、存活已部署）在场谢拉格免疫冻结、防御+${def[i]}、每秒回最大生命${hp[i]}%${i === 3 ? '，在场15秒后系数×2' : ''}；${tail(i)}`;
    });
  }

  // === 3 银灰 ===
  const sr = by(A, 'char_172_svrash');
  {
    const t0 = tal(sr, 0);
    t0.mode = 'rewrite';
    t0.description = '由 modePassive[0] 单份承接：自身攻击力+5%/5%/10%/10%，且银灰编入队伍时全体我方单位再部署时间-5%/8%/10%/12%。原生天赋不再另行安装；增益每战编队安装一次，未编入队伍即移除，不整局留存到卖出之后。';
    t0.parameters = { atkBonus: [0.05, 0.05, 0.1, 0.1], redeployReduce: [0.05, 0.08, 0.1, 0.12], installOncePerBattleFormation: true, removedWhenNotInTeam: true, notPersistAfterSell: true };
    t0.runtimeBinding = 'modePassive:0';
    delete t0.stableKey; delete t0.trigger; delete t0.unlockStar; delete t0.scope;
    sr.modePassives[0] = {
      trigger: '银灰编入队伍（每战编队安装一次）',
      target: '自身与我方全体单位',
      action: 'nativeMechanism',
      values: { atkBonusSelf: [0.05, 0.05, 0.1, 0.1], redeployReduceTeam: [0.05, 0.08, 0.1, 0.12], installOncePerBattleFormation: true, removedWhenNotInTeam: true, notPersistAfterSell: true, notHaste: true },
      lifecycle: 'battle',
      description: '银灰编入队伍时，自身攻击力+5%/5%/10%/10%，全体我方单位再部署时间-5%/8%/10%/12%；由银灰一个来源提供，同源不叠。每战编队安装一次，未编入队伍即移除，不整局留到卖出之后。再部署减时不是加速（haste 仅指自然SP+100%），此处直接修改再部署时间。',
      stacking: '同源只取一次',
      limits: '仅当银灰在编入队伍中，移除即失效。',
      replacesTalentIndices: [0],
      components: [
        { name: '领袖·攻击', trigger: '编入队伍', target: '自身', action: 'addBuff', values: { atkBonus: [0.05, 0.05, 0.1, 0.1] }, lifecycle: 'battle', description: '自身攻击力+5%/5%/10%/10%。', stacking: '同源一次', limits: '编入队伍期间' },
        { name: '领袖·再部署', trigger: '编入队伍', target: '我方全体单位', action: 'redeploy', values: { redeployReduce: [0.05, 0.08, 0.1, 0.12] }, lifecycle: 'battle', description: '全体我方单位再部署时间-5%/8%/10%/12%。', stacking: '同源一次', limits: '编入队伍期间' }
      ]
    };
    const atk = [5, 5, 10, 10], red = [5, 8, 10, 12];
    sr.stars.forEach((s, i) => {
      s.passiveChange = (i === 0 ? '领袖自身+' + atk[i] + '%攻/全队再部署-' + red[i] + '%；反隐。' : `领袖+${atk[i]}%攻/再部署-${red[i]}%。`);
    });
  }

  // === 4 红豆 ===
  const vg = by(S, 'char_290_vigna');
  {
    const t0 = tal(vg, 0);
    t0.parameters = {
      delegatesToFixedSkillEffect: 1,
      executionOwner: 'fixedSkill',
      critProb: 0.3,
      critScaleByStar: [1.5, 1.75, 2, 2.5],
      rngPerCast: 1,
      appliesTo: 'firstDirectDamageMultiplier',
      noExtraDamageInstance: true
    };
    t0.description = '改写为固定技能结算时的穿刺暴击判定，由 assaultTalent 单份登记但不在天赋处自行执行：执行者为 fixedSkill.effects[1]，一次施法仅一次RNG，作用于本次穿刺的直接伤害倍率，不额外产生第二段damage。';
    t0.mode = 'rewrite';
    vg.fixedSkill.effects[1] = {
      trigger: '同一结算',
      target: '本次穿刺命中目标',
      action: 'nativeMechanism',
      values: { modifiesEffectIndex: 0, critProb: [0.3, 0.3, 0.3, 0.3], critScale: [1.5, 1.75, 2, 2.5], rngPerCast: 1, noExtraDamageInstance: 1 },
      lifecycle: 'instant',
      description: '对本次施法自身穿刺的直接伤害做一次30%暴击判定：命中则本次直接伤害倍率变为150%/175%/200%/250%，未命中按基准结算；一次施法只消耗一次RNG，不额外产生第二段damage。',
      stacking: '每次施法只判定一次',
      limits: '无额外次数限制'
    };
  }

  // === 5 清流 ===
  const fl = by(S, 'char_385_finlpp');
  {
    const t0 = tal(fl, 0);
    t0.description = '治疗附加抵抗：由 modePassive[0] 单份承接，按星级2/3/4/4秒，异常持续时间×0.5；三星起自身也获得同效果，四星治疗异常目标时额外移除1个异常。';
    t0.mode = 'rewrite';
    fl.modePassives[0] = {
      trigger: '自身完成一次治疗（含模组追加的合法独立治疗）',
      target: '被治疗目标',
      action: 'applyStatus',
      values: {
        status: 'resist',
        statusDurationMultiplier: 0.5,
        resistSec: [2, 3, 4, 4],
        selfAlso: [0, 0, 1, 1],
        cleanseOnHealAbnormal: { enabled: [0, 0, 0, 1], priority: ['stun', 'frozen', 'cold', 'sleep', 'root', 'sluggish', 'silence'], maxRemove: 1, excludes: ['activeSkill', 'elementBurst'] },
        elementSlotMultiplier: [1, 1, 1, 0.85],
        elementSlotMultiplierScope: 'duringSelfGrantedResist'
      },
      lifecycle: 'battle',
      description: '每次治疗命中后使目标获得2/3/4/4秒抵抗（异常持续时间×0.5），同名刷新取较长剩余时间；三星起自身也获得同效果。四星起，若治疗的是处于异常状态的目标，按固定优先 stun>frozen>cold>sleep>root>sluggish>silence 移除其中1个已有异常（仅这七种，不清技能、不清元素爆发）；自身授予的抵抗持续期内，目标元素槽累计倍率×0.85。模组追加的合法独立治疗同样正常触发抵抗，visited 路径仅阻止同一次派生回到自身形成回路，不删除合法收益。',
      stacking: '同名刷新不叠加；cleanse每治疗目标每次最多移除1个。',
      limits: '每次治疗各触发一次；元素槽倍率只作用于自身授予的抵抗期间。',
      replacesTalentIndices: [0]
    };
    const m2 = fl.modulePlans.find(m => m.id === 'uniequip_002_finlpp');
    m2.effectHandling = '三星解锁：范围治疗额外向最远目标追加一次50%治疗；该追加治疗是合法独立治疗，正常触发抵抗，visited 路径防止同一次派生自回路。；四星加强：本效果随角色四星身体放大，无额外模块机制。';
    fl.stars[2].passiveChange = '治疗附4秒抵抗（×0.5），自身也获得同效果。';
    fl.stars[3].skillChange = '范围治疗400%，技力24，初始15。';
    fl.stars[3].passiveChange = '治疗附4秒抵抗；四星治疗异常目标额外移除1个异常（七种固定优先）；自身授予的抵抗内元素槽累计×0.85（-15%）。';
    fl.causalChecks = [
      '每次成功治疗都触发一次抵抗；模组追加的独立治疗同样是合法根事件，正常触发抵抗，visited 只阻止同一次派生回到自身。',
      '四星移除异常只从 stun/frozen/cold/sleep/root/sluggish/silence 中按优先移除1个，不清技能、不清元素爆发；元素槽倍率只在自身授予抵抗期间生效。'
    ];
  }

  // === 6 哈洛德 ===
  const hr = by(S, 'char_4114_harold');
  {
    const t0 = tal(hr, 0);
    t0.description = '统一 epResistance 为元素槽积累减免（不是HP元素伤害）：攻击范围内任意友方某个元素槽累计超过该槽阈值50%时，给予该友方12%/13%/15%/18%元素槽积累减免；离开攻击范围或该槽降到阈值50%以下即取消。';
    t0.parameters = {
      epResistance: [0.12, 0.13, 0.15, 0.18],
      reductionTarget: 'elementSlotAccumulation',
      thresholdRatio: 0.5,
      perSlot: true,
      anySlot: true,
      cancelOnLeaveRange: true,
      cancelOnBelowThreshold: true
    };
    t0.mode = 'rewrite';
    hr.modePassives[0] = {
      trigger: '攻击范围内任意友方某元素槽累计>该槽阈值50%',
      target: '该友方',
      action: 'addBuff',
      values: { epResistance: [0.12, 0.13, 0.15, 0.18], reductionTarget: 'elementSlotAccumulation', thresholdRatio: 0.5, perSlot: true, anySlot: true, cancelOnLeaveRange: true, cancelOnBelowThreshold: true },
      lifecycle: 'battle',
      description: '攻击范围内任意友方某个元素槽累计超过该槽阈值50%时，为该友方提供12%/13%/15%/18%元素槽积累减免；离开攻击范围或该槽降到阈值50%以下即取消。减免的是元素槽积累，不是HP元素伤害。',
      stacking: '同名不叠加，按槽独立判定。',
      limits: '状态随进入/离开范围与阈值进入/退出切换。',
      replacesTalentIndices: [0]
    };
    hr.modePassives[1] = {
      trigger: '四星：被本被动覆盖的友方元素槽爆发时',
      target: '该友方',
      action: 'heal',
      values: {
        unlockStar: 4,
        onlyFirstInstantHpDamage: true,
        healEqualsActualHpDamage: true,
        appliesAfterMitigation: true,
        capByMissingHp: true,
        keepBurstDebuffAndDot: true,
        cancelWholeBurst: false,
        multiplyBy5: false,
        countFullHpHealAsNetHeal: false,
        independentSlots: true
      },
      lifecycle: 'instant',
      description: '四星起，元素爆发只把首次即时HP伤害改为治疗其等量实际应受HP伤害（减伤结算后、以目标缺失生命为上限）；仍正常结算爆发debuff与持续伤害及其他元素独立槽；不取消整次爆发、不×5、不把满血治疗计为净治疗。',
      stacking: '每次爆发首次即时HP伤害只结算一次。',
      limits: '仅四星解锁；独立元素槽分别结算。',
      unlockStar: 4
    };
    hr.stars[3].passiveChange = '高损伤目标元素槽积累减免18%；四星元素爆发首次即时HP伤害改为等量治疗（减伤后、缺口上限），仍结算其余爆发效果。';
    hr.causalChecks = [
      '元素槽减免作用于积累而非HP；离开攻击范围或槽降到阈值50%以下立即取消，同名不叠加。',
      '四星爆发转换只作用于首次即时HP伤害，按减伤后实际应受伤害且以缺口为上限治疗；爆发debuff、持续伤害与其他独立元素槽照常结算，不取消整次爆发。'
    ];
  }

  // === 7 缄默德克萨斯 ===
  const tx = by(A, 'char_1028_texas2');
  {
    const t0 = tal(tx, 0);
    t0.mode = 'rewrite';
    t0.description = '由 modePassive[0] 单份承接：技能施放后10秒内攻击力+10%/15%/20%/20%；每次真实部署后首次由自身击倒敌人时回复全部生命并按相同规则补剑雨。原生天赋不另行触发。';
    t0.parameters = { atkBonus: [0.1, 0.15, 0.2, 0.2], duration: 10, firstKillPerDeploy: true, replenishRainHalf: true };
    t0.runtimeBinding = 'modePassive:0';
    delete t0.stableKey; delete t0.trigger; delete t0.unlockStar;
    tx.modePassives[0] = {
      trigger: '固定技能施放后 / 每次真实部署后首次由自身击倒敌人',
      target: '自身',
      action: 'heal',
      values: { firstKillHealFull: [1, 1, 1, 1], firstKillPerDeploy: [1, 1, 1, 1], noResetOnSurvivingRedeploy: [1, 1, 1, 1], resetOnRealEntry: [1, 1, 1, 1] },
      lifecycle: 'battle',
      description: '每次真实部署后，自身首次击倒敌人时回复全部生命并按相同规则补剑雨：若有现存剑雨则按当前规格延长其剩余时间4秒（原8秒的一半）；若不存在则新建4秒剑雨序列，tick间隔1秒、目标与倍率取本星固定技能，不重做落地两段。存活原位免费满血再部署不重置首次击杀标记；死亡后真正入场才重置。本效果为每部署一次，不是每战一次。',
      stacking: '每个真实部署周期内首次击杀只结算一次。',
      limits: '每部署一次；补剑雨在同一时刻只发生一次。',
      replacesTalentIndices: [0],
      components: [
        { name: '首次击杀回满', trigger: '每次真实部署后首次击杀', target: '自身', action: 'heal', values: { healFull: [1, 1, 1, 1], perDeploy: [1, 1, 1, 1] }, lifecycle: 'instant', description: '每部署首次击杀回复全部生命。', stacking: '每部署一次', limits: '存活原位免费再部署不重置标记，死亡真正入场重置。' },
        { name: '施放后攻击力增益', trigger: '固定技能施放后', target: '自身', action: 'addBuff', values: { atkBonus: [0.1, 0.15, 0.2, 0.2], duration: [10, 10, 10, 10] }, lifecycle: 'battle', description: '技能施放后10秒内攻击力+10%/15%/20%/20%，刷新时长不叠加。', stacking: '刷新时长不叠加', limits: '每次施放刷新。' },
        { name: '补剑雨', trigger: '每次真实部署后首次击杀', target: '自身剑雨', action: 'nativeMechanism', values: { rainExtendSec: [4, 4, 4, 4], createIfNoneSec: [4, 4, 4, 4], tickIntervalSec: [1, 1, 1, 1], reuseThisStarSpec: [1, 1, 1, 1], noRedoLanding: [1, 1, 1, 1] }, lifecycle: 'battle', description: '按当前规格延长现存剑雨剩余时间4秒；无现存剑雨则新建4秒序列，tick间隔1秒、目标与倍率取本星固定技能，不重做落地两段。', stacking: '同一首次击杀只补一次', limits: '每部署首次击杀一次。' }
      ]
    };
    const m3 = tx.modulePlans.find(m => m.id === 'uniequip_003_texas2');
    m3.effectHandling = '三星解锁：技能施放后攻击力增益+5%；四星加强：每次部署首次击杀额外按相同规则补剑雨2秒（25%×8秒），与基础4秒合计6秒，仅一次。';
    const atk = [10, 15, 20, 20];
    tx.stars.forEach((s, i) => {
      const base = i === 0 ? '技能后攻击+10%/10秒；' : `技能后攻击+${atk[i]}%/10秒；`;
      s.passiveChange = `${base}每部署首次击杀回满并按当前规格补剑雨（基础4秒；四星合计6秒）。`;
    });
    tx.causalChecks = [
      '剑雨每秒对同一目标最多命中一次；补剑雨按当前规格延长剩余时间/新建4秒序列，不重做落地两段。',
      '每部署首次击杀才回满并补剑雨，存活原位免费满血再部署不重置标记，死亡真正入场才重置；不把每部署与每战混写。'
    ];
  }

  // === 8 白面鸮 module002 ===
  const pl = by(S, 'char_128_plosis');
  {
    const m2 = pl.modulePlans.find(m => m.id === 'uniequip_002_plosis');
    m2.effectHandling = '三星解锁：限时全队回技力期间自身额外获得0.5/秒技力，且该光环持续时间+2秒；四星加强：自身额外提升至0.6/秒、光环持续再+2秒；随光环时限结束，不一次赠送总量；原常驻光环不另装。';
    m2.values = { unlockStar: 3, durationBonusSec: [2, 2], selfSpPerSec: [0.5, 0.6], selfSpPerSecStage: { star3: 0.5, star4: 0.6 }, notLumpSum: true, endsWithAura: true, noSeparatePermanentAura: true };
  }

  // === 9 Mon3tr retreat heal + 其余模糊模组补值 ===
  const mo = by(S, 'char_4179_monstr');
  {
    const m2 = mo.modulePlans.find(m => m.id === 'uniequip_002_monstr');
    m2.effectHandling = '三星解锁：重构体周围友方攻击+5%；四星加强：重构体退场时，治疗其周围八邻（切比雪夫距离1，半径1）内至多3名友方，治疗量为Mon3tr攻击力120%，每目标一次。';
    m2.values = { unlockStar: 3, retreatHeal: { rangeType: 'adjacent8', radiusTiles: 1, maxTargets: 3, atkScale: 1.2, oncePerTarget: true } };
  }
  const gv = A.operators.find(o => o.charId === 'char_1026_gvial2');
  if (gv) { const m = gv.modulePlans.find(x => x.id === 'uniequip_004_gvial2'); if (m) m.effectHandling = '三星解锁：勇冠三军高血攻击额外+3%；四星加强：技能结束后清空50%未结算延迟伤害。'; }
  const nl = A.operators.find(o => o.charId === 'char_1014_nearl2');
  if (nl) { const m = nl.modulePlans.find(x => x.id === 'uniequip_003_nearl2'); if (m) m.effectHandling = '三星解锁：卡西米尔追加伤害+10%；四星加强：卡西米尔追加伤害翻倍（×2），仅一次。'; }
  const bk = A.operators.find(o => o.charId === 'char_4116_blkkgt');
  if (bk) { const m = bk.modulePlans.find(x => x.id === 'uniequip_003_blkkgt'); if (m) m.effectHandling = '三星解锁：斩击命中至少3名敌人时退返1点技力；四星加强：结尾拖拽力度+1级（提升一档）。'; }
  const et = A.operators.find(o => o.charId === 'char_4010_etlchi');
  if (et) { const m = et.modulePlans.find(x => x.id === 'uniequip_003_etlchi'); if (m) m.effectHandling = '三星解锁：心烛持续时间+5秒；四星加强：攻击心烛时额外偷取生命+1次。'; }
  const ml = A.operators.find(o => o.charId === 'char_4064_mlynar');
  if (ml) { const m = ml.modulePlans.find(x => x.id === 'uniequip_002_mlynar'); if (m) m.effectHandling = '三星解锁：卡西米尔附带真伤+3%；四星加强：特性倍率不再因击杀下降（下降幅度0）。'; }

  fs.writeFileSync(FILES.support, JSON.stringify(S, null, 2) + '\n', 'utf8');
  fs.writeFileSync(FILES.assault, JSON.stringify(A, null, 2) + '\n', 'utf8');
}

// ---------------- validation ----------------
function validate() {
  const S = JSON.parse(fs.readFileSync(FILES.support, 'utf8'));
  const A = JSON.parse(fs.readFileSync(FILES.assault, 'utf8'));
  const by = (d, id) => d.operators.find(o => o.charId === id);
  const tal = (o, i) => (o.talentPlans || []).find(t => tIdx(t) === i);
  const errs = [];
  const push = m => errs.push(m);

  for (const [g, d] of [['support', S], ['assault', A]]) {
    if (!Array.isArray(d.operators) || !d.operators.length) push(`${g}: no operators`);
    for (const o of d.operators) {
      // global: INITIAL disabled
      for (const m of o.modulePlans || []) {
        if (m.type === 'INITIAL' && m.mode !== 'disabled') push(`${o.charId}: INITIAL not disabled`);
        if (m.mode !== 'disabled' && m.type === 'ADVANCED') {
          const t = String(m.effectHandling || '');
          if (!/三星/.test(t) || !/四星/.test(t)) push(`${o.charId} ${m.id}: advanced module must state star3/star4`);
          const four = t.split('四星加强')[1] || '';
          if (!/[0-9]/.test(four) && !/无额外模块机制/.test(four)) push(`${o.charId} ${m.id}: four-star clause lacks any number or explicit no-extra-mechanism`);
        }
      }
      // global: no bad status fields / no haste-for-redeploy
      for (const mp of o.modePassives || []) {
        const v = mp.values || {};
        if (v.status === 1) push(`${o.charId}: modePassive has wrong status:1`);
        if ('damageReducer' in v) push(`${o.charId}: modePassive has stray damageReducer`);
        if (mp.action === 'haste' && Object.keys(v).some(k => /redeploy/i.test(k))) push(`${o.charId}: must not use haste for redeploy reduction`);
      }
    }
  }

  // C1/C2 凛御银灰
  {
    const o = by(S, 'char_1045_svash2'); if (!o) push('svash2 missing');
    else {
      const t0 = tal(o, 0);
      if (t0.mode !== 'rewrite') push('svash2 t0 mode != rewrite');
      if (!arrEq(t0.parameters?.initSp, [2, 3, 4, 5])) push('svash2 t0 initSp');
      if (!arrEq(t0.parameters?.respawnTimeMultiplier, [0.9, 0.85, 0.8, 0.75])) push('svash2 t0 respawnTimeMultiplier');
      if (t0.parameters?.anchorName !== '风雪之眼') push('svash2 t0 anchorName');
      if (t0.parameters?.anchorCombatant !== false || t0.parameters?.anchorPopulation !== 0) push('svash2 t0 anchor must not be combatant/population');
      if (t0.parameters?.initSpTiming !== 'naturalDeployInitOnly' || t0.parameters?.initSpNotOnSurvivingRedeploy !== true) push('svash2 t0 initSp timing');
      if (!(t0.parameters?.deploySort?.key === 'currentBattleDeployCost' && t0.parameters?.deploySort?.tieBreak === 'formationOrder')) push('svash2 t0 deploySort');
      const t1 = tal(o, 1);
      if (t1.parameters?.freezeImmune !== true) push('svash2 t1 freezeImmune');
      if (t1.parameters?.freezeImmuneDoesNotCountAsApplied !== true) push('svash2 t1 freeze immune not counted');
      if (!arrEq(t1.parameters?.def, [60, 70, 80, 90])) push('svash2 t1 def');
      if (!arrEq(t1.parameters?.hpPerSec, [0.015, 0.018, 0.02, 0.022])) push('svash2 t1 hpPerSec');
      if (t1.parameters?.rampSec !== 15 || t1.parameters?.rampMultiplier !== 2) push('svash2 t1 ramp');
      if (t1.parameters?.hpHealAppliedMultiplier !== 1) push('svash2 t1 hp once no x5');
      if (t1.parameters?.auraRevokedOnExit !== true || t1.parameters?.rampRestartOnReentry !== true || t1.parameters?.noRampResetOnSurvivingRedeploy !== true) push('svash2 t1 aura lifecycle');
      if (t1.parameters?.auraKeepaliveEmitsStatus !== false) push('svash2 t1 aura emits status');
    }
  }
  // C3 银灰
  {
    const o = by(A, 'char_172_svrash'); if (!o) push('svrash missing');
    else {
      const t0 = tal(o, 0);
      if (t0.runtimeBinding !== 'modePassive:0') push('svrash t0 binding');
      if (!(o.modePassives[0]?.replacesTalentIndices || []).includes(0)) push('svrash mp0 not replacing t0');
      if (o.modePassives[0]?.action === 'haste') push('svrash mp0 must not be haste');
      if (!arrEq(o.modePassives[0]?.values?.atkBonusSelf, [0.05, 0.05, 0.1, 0.1])) push('svrash mp0 atkBonusSelf');
      if (!arrEq(o.modePassives[0]?.values?.redeployReduceTeam, [0.05, 0.08, 0.1, 0.12])) push('svrash mp0 redeployReduceTeam');
      if (o.modePassives[0]?.lifecycle === 'run') push('svrash mp0 must not be run lifecycle');
      const comp = o.modePassives[0]?.components || [];
      if (!comp.some(c => /攻击/.test(c.name) && arrEq(allNums(c.values), [0.05, 0.05, 0.1, 0.1]))) push('svrash mp0 missing atk component');
      if (!comp.some(c => /再部署/.test(c.name))) push('svrash mp0 missing redeploy component');
    }
  }
  // C4 红豆
  {
    const o = by(S, 'char_290_vigna'); if (!o) push('vigna missing');
    else {
      const t0 = tal(o, 0);
      if (t0.parameters?.delegatesToFixedSkillEffect !== 1) push('vigna delegatesToFixedSkillEffect');
      if (t0.parameters?.executionOwner !== 'fixedSkill') push('vigna executionOwner');
      if (!arrEq(o.fixedSkill.effects[1]?.values?.critScale, [1.5, 1.75, 2, 2.5])) push('vigna critScale');
      if (!arrEq(o.fixedSkill.effects[1]?.values?.critProb, [0.3, 0.3, 0.3, 0.3])) push('vigna critProb');
      if (o.fixedSkill.effects[1]?.action === 'damage') push('vigna effect1 must not be a second damage instance');
      if (o.fixedSkill.effects[1]?.values?.modifiesEffectIndex !== 0) push('vigna effect1 modifiesEffectIndex');
      const delegators = (o.talentPlans || []).filter(t => t.parameters?.delegatesToFixedSkillEffect != null);
      if (delegators.length !== 1) push('vigna delegation must be unique');
    }
  }
  // C5 清流
  {
    const o = by(S, 'char_385_finlpp'); if (!o) push('finlpp missing');
    else {
      const v = o.modePassives[0]?.values || {};
      if (v.status !== 'resist') push('finlpp status must be resist string');
      if (v.statusDurationMultiplier !== 0.5) push('finlpp statusDurationMultiplier');
      if ('status' in v && typeof v.status === 'number') push('finlpp numeric status forbidden');
      if ('damageReducer' in v) push('finlpp damageReducer forbidden');
      if (!arrEq(v.resistSec, [2, 3, 4, 4])) push('finlpp resistSec');
      if (!arrEq(v.selfAlso, [0, 0, 1, 1])) push('finlpp selfAlso');
      const cl = v.cleanseOnHealAbnormal || {};
      if (!arrEq(cl.enabled, [0, 0, 0, 1]) || cl.maxRemove !== 1) push('finlpp cleanse enable');
      if (!arrEq(cl.priority, ['stun', 'frozen', 'cold', 'sleep', 'root', 'sluggish', 'silence'])) push('finlpp cleanse priority');
      if (!arrEq(cl.excludes, ['activeSkill', 'elementBurst'])) push('finlpp cleanse excludes');
      if (!arrEq(v.elementSlotMultiplier, [1, 1, 1, 0.85])) push('finlpp elementSlotMultiplier');
      const m2 = (o.modulePlans || []).find(m => m.id === 'uniequip_002_finlpp');
      if (/不重复触发抵抗/.test(String(m2?.effectHandling || ''))) push('finlpp module still forbids legal resist');
    }
  }
  // C6 哈洛德
  {
    const o = by(S, 'char_4114_harold'); if (!o) push('harold missing');
    else {
      const v = o.modePassives[0]?.values || {};
      if (!arrEq(v.epResistance, [0.12, 0.13, 0.15, 0.18])) push('harold epResistance');
      if (v.reductionTarget !== 'elementSlotAccumulation') push('harold reductionTarget');
      if (v.thresholdRatio !== 0.5 || v.perSlot !== true || v.anySlot !== true) push('harold threshold/perSlot');
      if (v.cancelOnLeaveRange !== true || v.cancelOnBelowThreshold !== true) push('harold cancel semantics');
      const burst = (o.modePassives || []).find(p => p.values && p.values.onlyFirstInstantHpDamage === true);
      if (!burst) push('harold four-star burst-to-heal missing');
      else {
        const bv = burst.values;
        if (bv.healEqualsActualHpDamage !== true || bv.appliesAfterMitigation !== true) push('harold burst heal basis');
        if (bv.capByMissingHp !== true) push('harold burst heal cap');
        if (bv.keepBurstDebuffAndDot !== true) push('harold must keep burst debuff/dot');
        if (bv.cancelWholeBurst !== false || bv.multiplyBy5 !== false || bv.countFullHpHealAsNetHeal !== false) push('harold burst constraints');
        if (burst.unlockStar !== 4) push('harold burst unlockStar');
      }
      if (!Array.isArray(o.causalChecks) || o.causalChecks.length < 2) push('harold causalChecks');
    }
  }
  // C7 缄默德克萨斯
  {
    const o = by(A, 'char_1028_texas2'); if (!o) push('texas2 missing');
    else {
      const t0 = tal(o, 0);
      if (t0.runtimeBinding !== 'modePassive:0') push('texas2 t0 binding');
      const mp = o.modePassives[0];
      if (!(mp?.replacesTalentIndices || []).includes(0)) push('texas2 mp0 not replacing t0');
      const comp = mp?.components || [];
      const atkC = comp.find(c => /攻击/.test(c.name));
      if (!atkC || !arrEq(atkC.values?.atkBonus, [0.1, 0.15, 0.2, 0.2]) || !arrEq(atkC.values?.duration, [10, 10, 10, 10])) push('texas2 post-cast atk component');
      const rainC = comp.find(c => /剑雨/.test(c.name));
      if (!rainC || !arrEq(rainC.values?.rainExtendSec, [4, 4, 4, 4]) || !arrEq(rainC.values?.tickIntervalSec, [1, 1, 1, 1])) push('texas2 rain replenish component');
      if (rainC?.values?.noRedoLanding == null) push('texas2 no redo landing');
      if (mp?.values?.noResetOnSurvivingRedeploy == null || mp?.values?.resetOnRealEntry == null) push('texas2 per-deploy reset semantics');
      const m3 = (o.modulePlans || []).find(m => m.id === 'uniequip_003_texas2');
      if (!/6秒/.test(String(m3?.effectHandling || ''))) push('texas2 module003 total 6s missing');
    }
  }
  // C8 白面鸮 module002
  {
    const o = by(S, 'char_128_plosis'); if (!o) push('plosis missing');
    else {
      const m2 = (o.modulePlans || []).find(m => m.id === 'uniequip_002_plosis');
      if (m2?.mode === 'disabled') push('plosis module002 must be enabled');
      if (!arrEq(m2?.values?.durationBonusSec, [2, 2])) push('plosis module002 durationBonusSec');
      if (!arrEq(m2?.values?.selfSpPerSec, [0.5, 0.6])) push('plosis module002 selfSpPerSec');
      if (m2?.values?.notLumpSum !== true || m2?.values?.endsWithAura !== true) push('plosis module002 timing');
      if (m2?.unlockStar !== 3) push('plosis module002 unlockStar');
    }
  }
  // C9 Mon3tr
  {
    const o = by(S, 'char_4179_monstr'); if (!o) push('monstr missing');
    else {
      const m2 = (o.modulePlans || []).find(m => m.id === 'uniequip_002_monstr');
      const rh = m2?.values?.retreatHeal;
      if (!rh) push('monstr module002 retreatHeal missing');
      else {
        if (rh.rangeType !== 'adjacent8' || rh.radiusTiles !== 1) push('monstr retreat heal range');
        if (!(rh.maxTargets >= 1)) push('monstr retreat heal maxTargets');
        if (!(typeof rh.atkScale === 'number' && rh.atkScale > 0)) push('monstr retreat heal atkScale');
      }
      if (!/八邻|半径1|切比雪夫/.test(String(m2?.effectHandling || ''))) push('monstr module002 range text');
    }
  }

  return errs;
}

const args = process.argv.slice(2);
const doApply = args.includes('--apply');
if (doApply) { applyAll(); console.log(JSON.stringify({ applied: true, files: Object.values(FILES) })); }
const errors = validate();
const groups = Object.keys(FILES).map(g => {
  const d = JSON.parse(fs.readFileSync(FILES[g], 'utf8'));
  return { group: g, operators: d.operators.length };
});
console.log(JSON.stringify({ check: 'semantic-contracts', groups, ok: !errors.length, errors }));
process.exitCode = errors.length ? 1 : 0;
