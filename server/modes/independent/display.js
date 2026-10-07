// Pure workshop catalog and session view projection. Kept shared by the HTTP and client-compute paths.
import { traitSummary, TRAIT_WHEN } from './summary.js';
import { chessAvatarUrl } from '../../../public/js/ui/assetUrls.js';

/** The hand-written player texts are the same source used by the HTTP catalog. */
export function independentDisplayCatalog(data, catalog, gameText = data['independent-game-text'] || {}) {
  const baseChessId = (id) => String(id).replace(/_b$/, '_a');
  const BADGE_STATS = { attackFlat: '基础攻击力', attackPercent: '攻击力', maxLifeFlat: '基础最大生命值', maxLifePercent: '最大生命值', defenceFlat: '基础防御力', attackSpeedFlat: '攻击速度', naturalSkillRecoveryFlat: '每秒自然技力恢复', artsResistanceFlat: '法术抗性', initialSkillPointsFlat: '初始技力', physicalAndArtsDodge: '物理与法术闪避率', lifeRecoveryFlat: '每秒生命恢复', healingDealtPercent: '治疗量', physicalAndArtsDamageReduction: '物理与法术伤害减免', redeployTimeReduction: '再部署时间缩减', normalAttackDamagePercent: '普通攻击伤害' };
  const BADGE_RATIOS = new Set(['attackPercent', 'maxLifePercent', 'physicalAndArtsDodge', 'healingDealtPercent', 'physicalAndArtsDamageReduction', 'redeployTimeReduction', 'normalAttackDamagePercent']);
  const gearDescription = (record) => {
    if (record.normal || record.effect) return record.normal || record.effect;
    const stat = BADGE_STATS[record.stat];
    if (stat && typeof record.value === 'number') return `${stat}增加${BADGE_RATIOS.has(record.stat) ? `${Number((record.value * 100).toFixed(4))}%` : record.value}。${record.note || ''}`;
    return record.note || '';
  };
  const operators = Object.fromEntries(Object.entries(catalog.operators).map(([id, op]) => {
    const raw = op.elite ? op.source.eliteChess || op.source.normalChess : op.source.normalChess;
    return [id, { name: op.name, tier: op.tier, elite: op.elite, position: raw.position, profession: raw.profession,
      eliteChessId: op.eliteChessId || null, baseChessId: op.chessId || id,
      avatar: chessAvatarUrl(data.assets, raw), nativeTrait: op.nativeTrait.text, permitGear: op.permitGearId || null,
      traitTexts: gameText.operators?.[baseChessId(id)] ? { normal: gameText.operators[baseChessId(id)].normal, elite: gameText.operators[baseChessId(id)].elite }
        : { normal: op.nativeTrait.normalText, elite: op.nativeTrait.eliteText },
      summary: traitSummary(op.nativeTrait.effect),
      skills: raw.skills || [], modules: (raw.modules || []).map((x) => ({ ...x, id: x.uniEquipId || x.id })) }];
  }));
  const gear = Object.fromEntries([...Object.entries(catalog.badges), ...Object.entries(catalog.equipment)].map(([id, d]) => {
    const steam = d.params?.effects?.find((x) => x.behavior === 'steamGearUpgrade');
    const text = gameText.gear?.[id];
    const steamLimit = steam ? steam.params.chooseVariantsOnEquip : undefined;
    return [id, { name: d.newName || d.name, level: d.level,
      normal: text ? text.normal : gearDescription(d), kind: d.kind, unique: !!d.unique, inheritable: d.inheritable !== false, mechanism: d.mechanism,
      sourceId: d.sourceId, available: d.available !== false, steamOptions: steam?.params.sourceIds,
      steamLimit: steamLimit && typeof steamLimit === 'object' ? steamLimit.normal : (steamLimit ?? (steam ? steam.params.choose ?? 1 : undefined)),
      identityFactions: d.mechanism === 'identityTag' ? catalog.config.tavernFactions : undefined,
      ...(d.kind === 'badge' ? { stat: d.stat, value: d.value, statName: BADGE_STATS[d.stat] || null, ratio: BADGE_RATIOS.has(d.stat) } : {}),
      ...(d.params?.normalCount != null ? { useCount: Number(d.params.normalCount) } : {}) }];
  }));
  const PRIZE_STAGE = { 起步: '起步', 成型: '成型', 兑现: '决胜' };
  const prizes = Object.fromEntries(Object.entries(catalog.prizes).map(([id, d]) => [id, { name: d.name, effect: gameText.prizes?.[id]?.text ?? d.effect, mechanism: d.mechanism, stage: PRIZE_STAGE[d.stage] || null }]));
  for (const [id, t] of Object.entries(gameText.prizes || {})) if (!prizes[id]) prizes[id] = { name: t.name, effect: t.text, mechanism: 'fallback', stage: null };
  const attachments = Object.fromEntries(Object.entries(catalog.attachments).map(([id, d]) => [id, { name: d.name, effect: gameText.attachments?.[id]?.text ?? d.effect, mechanism: d.mechanism }]));
  return { name: catalog.name, operators, gear, prizes, attachments, terms: gameText.terms,
    factions: catalog.config.tavernFactions,
    rules: { purchasePrice: catalog.config.purchasePrice, sellPrice: catalog.config.sellPrice, refreshPrice: catalog.config.refreshPrice,
      equipmentCapacity: catalog.config.equipmentCapacity, inventoryCapacity: catalog.config.inventoryCapacity, bodyPenalty: { baseAttackRatio: catalog.config.bodyPenalty?.baseAttackRatio ?? 0.8, baseLifeRatio: catalog.config.bodyPenalty?.baseLifeRatio ?? 0.8 } },
    traitWhen: TRAIT_WHEN,
    modes: [{ name: '短局', difficulty: 'FUNNY', roundLimit: 9 }, { name: '标准局', difficulty: 'NORMAL', roundLimit: 14 }, { name: '追加挑战', difficulty: 'NORMAL', roundLimit: 15 }] };
}

/** Project a validated native session to the same renderer packet used by the HTTP transport. */
export function independentSessionView(state, { data, catalog, display, viewSession }) {
  const view = viewSession(state, { data, catalog });
  const { pool, history, catalog: ignoredCatalog, ...thin } = view;
  thin.lastBattle = history.findLast((x) => x.type === 'battle') || null;
  thin.pieces = thin.pieces.map((piece) => ({ ...piece,
    equipmentDetails: piece.equipmentDetails.map((item) => ({ ...item, record: display.gear[item.id] })),
    attachmentDetails: piece.attachmentDetails.map((item) => ({ ...item, record: display.attachments[item.id] })) }));
  return thin;
}
