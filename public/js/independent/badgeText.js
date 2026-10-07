// Badge descriptions shown in the workshop mirror the battle adapter's semantic badge IDs.
const TEXT = Object.freeze({
  damage: ['造成伤害（与技能和天赋同区加算）', 0.02],
  precision: ['原生基础攻击力白值', 0.02], agility: ['原生基础攻击速度', 0.02],
  vitality: ['原生基础最大生命白值', 0.03], defense: ['原生基础防御白值', 0.02],
  assault: ['攻击力', 0.02], recovery: ['自然技力回复', 0.02], arcane: ['受到的法术伤害减免', 0.005],
  foresight: ['当前所选技能初始技力（按该技能技力需求计算）', 0.02], miracle: ['物理与法术闪避概率各', 0.01],
  investor: ['每秒回复原生基础最大生命的', 0.001], unyielding: ['原生基础最大生命白值（旧存档徽章）', 0.03],
  harmony: ['造成的治疗量', 0.01], coordination: ['受到的物理与法术伤害减免各', 0.005],
  solitary: ['再部署时间减免', 0.01], mastery: ['普通攻击伤害', 0.01],
});

const fmt = (n) => String(Number(n.toFixed(4)));

export function badgeEffectText(id, quantity = 1) {
  const effect = TEXT[id];
  const count = Math.max(1, Number(quantity) || 1);
  if (!effect) return null;
  const [label, perBadge] = effect;
  const amount = fmt(perBadge * count * 100);
  return id === 'foresight'
    ? `${label} +${amount}%`
    : id === 'investor'
      ? `${label} ${amount}%`
      : `${label} +${amount}%`;
}
