// Arknights workshop gear uses the original item art that best identifies each object or effect.
// Stable legacy item IDs continue to use their own native `sourceId` artwork in the catalog.
// New workshop gear, badges, prizes, permits and attachments are explicitly matched below.
const item = (sourceItemId, reason) => Object.freeze({ type: 'item', sourceItemId, reason });
const skill = (skillId, reason) => Object.freeze({ type: 'skill', skillId, reason });

export const GEAR_ICON_MAP = Object.freeze({
  'growth-training-record': item('chess_item_5_06_e_a', '博士晋升授权原图直接表达训练与等级提升。'),
  'rhodes-portable-forge': item('chess_item_3_09_e_a', '重锤原图对应锻炉工具。'),
  'rhodes-heavy-protection-kit': item('chess_item_4_05_e_a', '防暴盾原图对应重装防护套件。'),
  'emergency-barrier-module': item('chess_item_4_11_e_a', '护盾无人机原图对应应急屏障组件。'),
  'heavy-weapons-calibration-seal': item('chess_item_3_10_e_a', '加速重锤原图对应重型武装校准章。'),
  'elite-operator-readiness-case': item('chess_item_5_07_e_a', '商业包装原图对应重点干员战备箱。'),
  'chess_item_identity_gear': item('chess_item_1_04_e_a', '随身身份牌原图对应调和识别牌。'),
  'chess_item_6_01_m': item('chess_item_5_05_e_a', '拟态物质原图替代旧版空白占位图，保留神秘来客的特殊道具感。'),
  'chess_item_6_02_m': item('chess_item_6_06_e_a', '耶拉冈德之泪原图替代旧版空白占位图，保留卷轴的秘仪主题。'),
  'chess_item_6_03_m': item('chess_item_6_08_e_a', '人事部文档原图替代旧版空白占位图，对应教具与记录。'),

  // New workshop combat gear. Each choice follows the object's shape or its defining combat effect.
  'independent:拉特兰调速器': item('chess_item_4_03_e_a', '加速器原图对应攻击速度徽章增幅。'),
  'independent:维多利亚校准砧': item('chess_item_3_09_e_a', '重锤原图对应校准与攻击徽章增幅。'),
  'independent:医疗部稳态仪': item('chess_item_4_11_e_a', '医疗护盾无人机原图对应生命值稳定装置。'),
  'independent:医疗部蓄能电容': item('chess_item_6_05_e_a', '蒸汽之心原图对应蓄能后放电。'),
  'independent:近战训练记录仪': item('chess_item_6_08_e_a', '人事部文档原图对应按攻击训练并记录进度。'),
  'independent:熔铸模具': item('chess_item_3_09_e_a', '锻造重锤原图对应徽章熔铸与强化。'),
  'independent:增压臂铠': item('chess_item_3_10_e_a', '加速重锤原图对应逐次增压。'),
  'independent:拉特兰跳弹模块': item('chess_item_4_08_e_a', '桥夹原图对应弹体跳转与连锁命中。'),
  'independent:阿戈尔裂潮重刃': item('chess_item_3_07_e_a', '阿戈尔重刃原图对应近身范围斩击。'),
  'independent:医疗部共生血囊': item('chess_item_4_11_e_a', '医疗无人机原图对应造成伤害后治疗友军。'),
  'independent:谢拉格雪境猎印': item('chess_item_6_06_e_a', '耶拉冈德之泪原图承接谢拉格冰雪主题。'),
  'independent:维多利亚荆棘纹章': item('chess_item_4_05_e_a', '防暴盾原图对应阵营友军减伤防护。'),
  'independent:谢拉格冰爪': item('chess_item_5_02_e_a', '谢拉格不融冰原图对应寒冷效果。'),
  'independent:炎国缚锁': item('chess_item_3_04_e_a', '炎国短刀原图对应炎国束缚器械。'),
  'independent:萨尔贡流沙符': item('chess_item_6_07_e_a', '黄沙罗盘原图对应萨尔贡流沙与迟滞。'),
  'independent:工程部标定信标': item('chess_item_5_04_e_a', '信标原图对应标记目标并使其易伤。'),
  'independent:拉特兰速射扳机': item('chess_item_3_02_e_a', '狙击镜原图对应速射瞄准与连射。'),
  'independent:阿戈尔神经毒棘': item('chess_item_6_04_e_a', '海沟实验体原图对应阿戈尔神经伤害。'),
  'independent:叙拉古狼嚎哨': item('chess_item_2_06_e_a', '通讯机原图对应哨音与控制指令。'),
  'independent:卡西米尔破甲箭簇': item('chess_item_6_01_e_a', '天马骑士长枪原图对应穿甲突刺。'),
  'independent:莱塔尼亚共鸣音叉': item('chess_item_3_08_e_a', '奥术法阵原图对应法术共鸣与脆弱。'),
  'independent:阿戈尔深潜锚钩': item('chess_item_6_04_e_a', '海沟实验体原图对应深海锚钩与牵引。'),
  'independent:莱茵生命浮空发生器': item('chess_item_5_04_e_a', '信标原图对应发生器定点控制效果。'),
  'independent:叙拉古处决令': item('chess_item_6_10_e_a', '骑士戒律原图对应处决规则。'),
  'independent:炎国点睛笔': item('chess_item_6_03_e_a', '天师古鼎原图对应炎国召唤与术法。'),
  'independent:萨尔贡链雷护符': item('chess_item_6_07_e_a', '黄沙罗盘原图对应萨尔贡链式法术效果。'),
  'independent:黑钢双联弹匣': item('chess_item_3_02_e_a', '狙击镜原图对应多目标射击。'),
  'independent:萨米凋亡枝': item('chess_item_6_06_e_a', '耶拉冈德之泪原图对应萨米凋亡侵蚀。'),
  'independent:工程部节拍校准器': item('chess_item_4_03_e_a', '加速器原图对应攻击节拍计数。'),
  'independent:罗德岛处置预案': item('chess_item_5_04_e_a', '信标原图对应控制目标后的范围处置。'),
  'independent:坚守盟约': item('chess_item_1_02_e_a', '坚守盾牌原图对应自身防护与友军分摊。'),
  'independent:护盾发生器': item('chess_item_4_11_e_a', '护盾无人机原图对应部署获得装备护盾。'),
  'independent:突袭盟约': item('chess_item_6_01_e_a', '天马骑士长枪原图对应部署后迅速突击。'),
  'independent:巨锤盟约': item('chess_item_3_09_e_a', '坚固重锤原图对应巨锤溅射攻击。'),
  'independent:精准盟约': item('chess_item_3_02_e_a', '精准狙击镜原图对应穿透防御的精准攻击。'),
  'independent:不屈盟约': item('chess_item_2_01_e_a', '不屈弹射器原图对应被击倒后的复生。'),
  'independent:爆破部署台': item('chess_item_3_11_e_a', '突袭破片榴弹原图对应部署范围爆破。'),
  'independent:反冲空降仓': item('chess_item_6_02_e_a', '拉特兰铳骑组件原图对应空降火力与反冲。'),
  'independent:便携式融毁教学仪': skill('skchr_nearl2_3', '耀骑士临光三技能原图表现范围真实伤害与晕眩，直接对应融毁教学仪的战斗效果。'),

  // Badge art is chosen per stat, using distinct native item pictures rather than faction glyphs.
  'badge:precision': item('chess_item_3_04_e_a', '炎国短刀原图对应干员的基础攻击。'),
  'badge:agility': item('chess_item_4_03_e_a', '加速器对应攻击速度。'),
  'badge:vitality': item('chess_item_4_12_e_a', 'M3茧甲对应生命与生存能力。'),
  'badge:defense': item('chess_item_1_02_e_a', '坚守盾牌对应基础防御。'),
  'badge:assault': item('chess_item_1_01_e_a', '维式重锤对应攻击强化。'),
  'badge:recovery': item('chess_item_2_04_e_a', '萨尔贡浓茶对应技力恢复。'),
  'badge:arcane': item('chess_item_3_08_e_a', '奥术法阵对应法术抗性。'),
  'badge:foresight': item('chess_item_5_04_e_a', '信标对应部署前的技能准备。'),
  'badge:miracle': item('chess_item_4_04_e_a', '伪装服对应规避与闪避。'),
  'badge:investor': item('chess_item_3_12_e_a', '骑士储蓄罐对应持续收益。'),
  'badge:unyielding': item('chess_item_2_01_e_a', '不屈弹射器对应旧徽章的生命主题。'),
  'badge:harmony': item('chess_item_4_11_e_a', '医疗护盾无人机对应治疗增益。'),
  'badge:coordination': item('chess_item_4_05_e_a', '防暴盾对应团队减伤。'),
  'badge:solitary': item('chess_item_6_02_e_a', '拉特兰铳骑组件对应快速重部署。'),
  'badge:mastery': skill('skchr_nearl2_1', '耀骑士临光长刃技能原图对应普通攻击熟练度。'),
  'badge:damage': item('chess_item_3_03_e_a', '激光发射器对应直接伤害。'),

  // Prize cards use an image of the granted object or the closest matching supply item.
  'prize:emergency-rations': item('chess_item_3_05_e_a', '作战口粮原图对应营养补给。'),
  'prize:extra-procurement-quota': item('chess_item_3_12_e_a', '储金罐原图对应追加采购额度。'),
  'prize:rookie-requisition': item('chess_item_2_02_e_a', '紧急调度券原图对应征调令。'),
  'prize:team-readiness-support': item('chess_item_3_11_e_a', '突袭补给原图对应全队战备支援。'),
  'prize:standard-readiness-upgrade': item('chess_item_5_06_e_a', '晋升授权原图对应战备升级。'),
  'prize:urgent-intelligence-update': item('chess_item_5_04_e_a', '信标原图对应情报刷新。'),
  'prize:portable-forge': item('chess_item_3_09_e_a', '重锤原图对应便携锻造工具。'),
  'prize:repeat-inspection-permit': item('chess_item_6_08_e_a', '人事部文档原图对应验收许可。'),
  'prize:long-term-logistics-quota': item('chess_item_2_05_e_a', '储蓄盒原图对应长期后勤配额。'),
  'prize:heavy-assault-crate': item('chess_item_4_05_e_a', '防暴盾原图对应重装防护套件。'),
  'prize:special-dispatch-authorization': item('chess_item_4_01_e_a', '征调模块原图对应调度授权。'),
  'prize:targeted-requisition': item('chess_item_2_06_e_a', '通讯机原图对应定向征调。'),
  'prize:emergency-barrier-aid': item('chess_item_4_11_e_a', '护盾无人机原图对应屏障组件。'),
  'prize:heavy-weapons-calibration': item('chess_item_3_10_e_a', '加速重锤原图对应重型武装校准。'),
  'prize:elite-requisition': item('chess_item_5_09_e_a', '天马骑士战盔原图对应精英战备。'),
  'prize:key-operator-support': item('chess_item_5_07_e_a', '商业包装原图对应重点干员支援箱。'),
  'prize:additional-procurement-budget': item('chess_item_1_03_e_a', '采购券原图对应追加采购资金。'),
  'prize:readiness-promotion-order': item('chess_item_5_06_e_a', '晋升授权原图对应干员晋升。'),
  'prize:special-readiness-training': item('chess_item_6_08_e_a', '人事部文档原图对应专项战备授训。'),

  // Inheritance permits have distinct pictures keyed by their named faction, role or handover object.
  'permit:permit-north-handover-order': item('chess_item_6_06_e_a', '耶拉冈德之泪对应北境交接主题。'),
  'permit:permit-tianshi-seal': item('chess_item_6_03_e_a', '天师古鼎对应炎国器械封签。'),
  'permit:permit-ursus-logistics-slip': item('chess_item_4_05_e_a', '防暴盾对应乌萨斯重装交接。'),
  'permit:permit-smith-receipt': item('chess_item_3_09_e_a', '维式重锤对应锻造交工凭证。'),
  'permit:permit-deepsea-entrustment': item('chess_item_6_04_e_a', '海沟实验体对应深海遗物托付。'),
  'permit:permit-rural-transfer-slip': item('chess_item_6_07_e_a', '黄沙罗盘对应野外器械移交。'),
  'permit:permit-knight-custody': item('chess_item_5_09_e_a', '天马骑士战盔对应骑士装备托管。'),
  'permit:permit-loner-loan': item('chess_item_4_04_e_a', '伪装服对应独行者借装许可。'),
  'permit:permit-heavy-adapter': item('chess_item_4_05_e_a', '防暴盾对应重装器械适配。'),
  'permit:permit-seaborn-vessel': item('chess_item_6_04_e_a', '海沟实验体对应海嗣遗物容器。'),
  'permit:permit-hunter-succession': item('chess_item_3_04_e_a', '短刀对应猎人旧装承接。'),
  'permit:permit-radiant-edict': item('chess_item_6_01_e_a', '天马长枪对应耀骑士接装敕令。'),
  'permit:permit-medical-device-handover': item('chess_item_4_11_e_a', '医疗护盾无人机对应医疗装置交接。'),

  // Attachments echo the original equipment produced or the named effect.
  'attachment:quartermaster-kit': item('chess_item_1_01_e_a', '维式重锤对应军需备品锻造攻击徽章。'),
  'attachment:ammo-recovery': item('chess_item_4_03_e_a', '加速器对应弹药回收锻造攻速徽章。'),
  'attachment:cold-region-log': item('chess_item_5_02_e_a', '不融冰对应寒区冻结记录。'),
  'attachment:medical-readiness': item('chess_item_4_12_e_a', 'M3茧甲对应医疗生命整备。'),
  'attachment:darkmoon-magnetic': item('chess_item_5_03_e_a', '机械臂原图对应机械合体组件。'),
});

export function gearIconSource(id, catalog) {
  const explicit = GEAR_ICON_MAP[id]
    || GEAR_ICON_MAP[`badge:${id}`]
    || GEAR_ICON_MAP[`prize:${id}`]
    || GEAR_ICON_MAP[`permit:${id}`]
    || GEAR_ICON_MAP[`attachment:${id}`];
  if (explicit) return explicit;
  const gear = catalog?.gear?.[id] || catalog?.prizes?.[id];
  const sourceItemId = gear?.iconItemId || gear?.sourceItemId || gear?.sourceId;
  if (sourceItemId) return item(sourceItemId, '兼容旧装备：沿用其原始明日方舟物品素材。');
  return null;
}
