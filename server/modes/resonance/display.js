import { legalSummonCells,selectedSummonIds } from './summons.js';
import { resonanceOpenings, openingEventView } from '../../../shared/resonance/openings.js';
const RECOVERY_TEXT = {
  INCREASE_WITH_TIME: '自然回复', INCREASE_WHEN_ATTACK: '攻击回复',
  INCREASE_WHEN_ATTACKED: '受击回复', INCREASE_WHEN_TAKEN_DAMAGE: '受击回复', NOT_RECOVER: '不回复',
};
const STRATEGY_GROUP_TEXT = { instant:'即时经营', economy:'延迟兑现', task:'条件任务', risk:'风险交换', rule:'规则改变', battle:'战斗机制' };
const ROLE_TEXT = { frontline:'前线', damage:'伤害', healer:'治疗', control:'控制', summoner:'召唤', support:'支援' };
const STRATEGY_TIMING_TEXT = { 'on-pick':'选取后立即生效', 'run-or-node':'本局或经营节点期间', 'battle-metric':'战斗指标达成后', 'node-delay':'后续经营节点兑现', 'battle-start':'战斗开始时生效' };
function conditionText(condition) {
  const p=condition?.params??condition??{};
  switch(condition?.kind){
    case 'always':return '无额外前提';
    case 'metric_threshold':return '达到对应战斗目标后兑现';
    case 'current_hp_above':return `目标生命高于${p.value??20}时可选`;
    case 'no_owned_cost':return `未持有${p.cost??''}费干员时可选`;
    case 'start_of_run':case 'gold_min':return `至少持有${condition.value??8}金币可选`;
    case 'formation_count':return `至少${p.minMelee??0}名前线、${p.minRanged??0}名远程时可选`;
    case 'choose_adjacent_pair':return '需要选择两名相邻干员';
    default:return '依当前阵容与节点条件生效';
  }
}
export function strategyProgressText(entry={},definition={},round=1) {
  if(entry.inactive)return '已应用替代收益';
  if(entry.rewarded||entry.copyDelivered||entry.released||entry.delivered)return '已兑现';
  const effect=definition.effects?.[0],p=effect?.params??{};
  switch(effect?.kind){
    case 'metric_reward':return `${p.scope==='streak'?'连续进度':'本场进度'} ${entry.progress??0} / ${p.threshold??0}`;
    case 'target_copy':return `指定成员在场获胜 ${entry.observedWins??0} / ${entry.targetWins??p.wins??3}`;
    case 'delayed_operator':return `第${entry.dueRound??round}节点领取援军`;
    case 'delayed_income':return `暂存${entry.held??0}金币，第${Number(entry.selectedRound??round)+Number(p.releaseNode??3)-1}节点结算兑现`;
    case 'xp_discount':return `还可优惠购买经验${entry.uses??p.uses??0}次`;
    case 'refresh_discount':return `再刷新${Math.max(0,Number(p.paidRefreshEvery??3)-1-Number(entry.paidCount??0))}次后，下一次免费`;
    case 'sell_bonus':return `还可获得出售奖励${entry.uses??0}次`;
    case 'free_disassemble_and_recipe':return entry.lastUsedNode===round?'本节点已使用':'在每四节点可拆卸并重选配方';
    case 'flexible_core':return `当前核心连续锁定${entry.lockBattles??0}场`;
    default:return definition.group==='battle'?'随战斗生效':'已生效';
  }
}

function scaledValues(operator, star) {
  const spec = operator.stars[star];
  const bb = spec.skillOverrides?.bb ?? {};
  return (operator.skillScaleAudit?.scaledKeys ?? []).filter((key) => Number.isFinite(bb[key])).map((key) => {
    const value = bb[key];
    const label = /heal|hp_recovery/i.test(key) ? '技能治疗倍率'
      : /shield|barrier/i.test(key) ? '技能屏障倍率'
        : /atk_scale|damage/i.test(key) ? '技能伤害倍率' : '技能效果倍率';
    return { label, value };
  });
}

function skillView(operator, star, playerText) {
  const spec = operator.stars[star];
  const skill = spec.record?.skill;
  if (!skill) return null;
  const timing = spec.skillOverrides ?? {};
  const duration = spec.passive?.params?.permanentSkill ? -1 : Number(timing.duration ?? skill.duration ?? 0);
  return {
    name: skill.name || '战线应答',
    description: playerText?.operators?.[operator.id]?.stars?.[star]?.skillDescription ?? '',
    recovery: RECOVERY_TEXT[timing.spType ?? skill.spType] || '特殊回复',
    spCost: Number(timing.spCost ?? skill.spCost ?? 0),
    initialSp: Number(timing.initSp ?? skill.initSp ?? 0),
    duration: duration < 0 ? '永久' : duration > 0 ? `${duration}秒` : skill.durationType === 'AMMO' ? '弹药技能' : '瞬发',
    values: [],
  };
}

function starView(operator, star, data, playerText) {
  const spec = operator.stars[star];
  const record = spec.record;
  const stats = spec.stats ?? record.stats ?? {};
  return {
    stats: {
      health: stats.maxHp, attack: stats.atk, defense: stats.def, resistance: stats.res,
      deploymentCost: stats.cost, block: stats.blockCnt, attackSpeed: stats.aspd, attackInterval: stats.bat,
    },
    skill: skillView(operator, star, playerText),
    summons: selectedSummonIds(operator,star).map((token) => {
      const tokenId = typeof token === 'string' ? token : token?.tokenId;
      const record = tokenId ? data?.tokens?.[tokenId] : null;
      return tokenId ? { id: tokenId, name: record?.name ?? record?.nameCn ?? '召唤物' } : null;
    }).filter(Boolean),
    talents: (record.talents ?? []).filter((talent) => !talent.hidden).map((talent) => ({ name: talent.name, description: talent.desc })),
    passive: spec.passive?.description || '',
  };
}

/** A player-only projection. Native records, source IDs and blackboard keys never cross this boundary. */
export function resonanceDisplayCatalog(catalog, data = null) {
  const operators = Object.fromEntries(Object.entries(catalog.operators).map(([id, operator]) => [id, {
    name: operator.name, charId: operator.charId, cost: operator.cost, position: operator.position,
    canDeployHighGround: operator.canDeployHighGround, role: ROLE_TEXT[operator.role] ?? '伤害', pacts: [...operator.pacts],
    avatar: operator.assets?.avatar ?? operator.assets?.portrait ?? null,
    stars: { 1: starView(operator, 1, data, catalog.playerText), 2: starView(operator, 2, data, catalog.playerText), 3: starView(operator, 3, data, catalog.playerText) },
  }]));
  const pacts = Object.fromEntries(Object.entries(catalog.pacts).map(([id, pact]) => [id, {
    name: pact.name, description: pact.description, thresholds: [...pact.thresholds],
    levels: pact.levels.map((level, index) => ({ threshold: level.threshold, description: catalog.playerText?.pacts?.[pact.id]?.levels?.[index]?.description ?? level.description })),
  }]));
  const equipment = Object.fromEntries(Object.entries(catalog.equipment).map(([id, item]) => [id, {
    name: item.name, description: catalog.playerText?.equipment?.[item.id]?.description ?? item.description, kind: item.kind, unique: !!item.unique,
  }]));
  const strategies = Object.fromEntries(Object.entries(catalog.strategies).map(([id, strategy]) => [id, {
    name: strategy.name, group: STRATEGY_GROUP_TEXT[strategy.group] ?? '策略', description: strategy.description,
    timing: STRATEGY_TIMING_TEXT[strategy.timing] ?? '按当前节点生效', condition: conditionText(strategy.condition),
    conditionKind: strategy.condition?.kind ?? null,
  }]));
  const environments = Object.fromEntries(Object.entries(catalog.environments).map(([id, env]) => [id, {
    name: env.name, identityPactId: env.identityPactId, description: env.description,
    minThreshold: env.minThreshold,
  }]));
  return {
    schemaVersion: catalog.schemaVersion,
    operators, pacts, equipment, activeOperatorIds: [...(catalog.config?.activeOperatorIds ?? [])],
    recipes: catalog.recipes.map((recipe) => ({ parts: [...recipe.parts], resultId: recipe.resultId,
      names: recipe.parts.map((id) => catalog.equipment[id]?.name ?? '装备'), resultName: catalog.equipment[recipe.resultId]?.name ?? '装备' })),
    strategies, environments: catalog.config?.rulesVersion===2?{}:environments, campaign: structuredClone(catalog.campaign),
    ...(catalog.config?.rulesVersion===2?{season:{name:catalog.season.displayName},openingEvent:openingEventView(catalog.config.openingId),openingEvents:Object.fromEntries(Object.keys(resonanceOpenings).map(id=>[id,openingEventView(id)]))}:{}),
  };
}

function canUseTile(operator, tileClass) {
  return operator.position === 'RANGED' || tileClass === 'MELEE' || (tileClass === 'RANGED' && operator.canDeployHighGround === true);
}

function nextEnemyViews(data, wave) {
  const spawns = Array.isArray(wave?.spawns) ? wave.spawns : [];
  return spawns.filter((spawn) => spawn && typeof spawn.enemyKey === 'string' && spawn.tag !== 'part').map((spawn) => {
    const enemy = data.enemies?.[spawn.enemyKey] ?? data.enemies?.[spawn.enemyKey.replace(/^enemy_/, '')] ?? {};
    return {
      enemyKey: spawn.enemyKey,
      name: enemy.name ?? enemy.nameCn ?? enemy.appellation ?? (spawn.preview?.boss ? '敌方领袖' : '敌人'),
      count: Math.max(1, Math.trunc(Number(spawn.count) || 1)),
      gate: spawn.preview?.gate === 'upper' ? 'upper' : 'lower',
      arrival: Math.max(0, Number(spawn.time) || 0),
      flying: !!spawn.preview?.fly, elite: !!spawn.preview?.elite || spawn.tag === 'boss', boss: spawn.tag === 'boss',
      ...(spawn.tag === 'boss' && Array.isArray(spawn.preview?.start) ? { start: [...spawn.preview.start] } : {}),
    };
  }).sort((a, b) => a.arrival - b.arrival);
}

function pactCounts(pieces, catalog) {
  const members = new Map();
  for (const piece of pieces) {
    const operator = catalog.operators[piece.operatorId];
    if (!operator) continue;
    const pactIds = new Set([...(operator.pacts ?? []), ...(piece.extraPacts ?? [])]);
    for (const equipped of piece.equipment ?? []) {
      for (const effect of catalog.equipment[equipped.itemId]?.effects ?? []) {
        if (['pact_transfer','transfer_pact'].includes(effect.kind) && typeof effect.params?.pactId === 'string') pactIds.add(effect.params.pactId);
      }
    }
    for (const pactId of pactIds) {
      if (!members.has(pactId)) members.set(pactId, new Map());
      const current = members.get(pactId).get(operator.charId);
      if (!current || piece.star > current.star) members.get(pactId).set(operator.charId, { name: operator.name, star: piece.star });
    }
  }
  return Object.fromEntries(Object.entries(catalog.pacts).map(([id, pact]) => {
    const distinct = [...(members.get(id)?.values() ?? [])];
    const count = distinct.length;
    const activeThreshold = [...pact.thresholds].filter((threshold) => count >= threshold).at(-1) ?? 0;
    return [id, { count, activeThreshold, nextThreshold: pact.thresholds.find((threshold) => count < threshold) ?? null,
      members: distinct.map(({ name, star }) => ({ name, star })) }];
  }));
}

/** Enriches the authoritative thin session with exact legal field/preview data and player text. */
export function resonanceSessionDisplay(state, { data, catalog, viewSession, fieldResolver, unitStats = {} }) {
  const base = viewSession(state, { catalog, fieldResolver });
  if (!base.ok) return base;
  let resolved = null;
  try { resolved = fieldResolver?.(state, { catalog }) ?? null; } catch { /* no battle field on logistics/terminal nodes */ }
  const tiles = resolved?.deployMap instanceof Map
    ? [...resolved.deployMap].map(([key, tileClass]) => {
      const [row, col] = key.split(',').map(Number);
      return { row, col, class: String(tileClass).toUpperCase() };
    }) : [];
  const occupied = new Set(base.pieces.filter((piece) => piece.row !== null).map((piece) => `${piece.row},${piece.col}`));
  const pieces = base.pieces.map((piece) => {
    const operator = catalog.operators[piece.operatorId];
    const stats = unitStats[piece.uid] ?? operator?.stars?.[piece.star]?.stats ?? {};
    const legalTiles = tiles.filter((tile) => canUseTile(operator ?? {}, tile.class)
      && (!occupied.has(`${tile.row},${tile.col}`) || (piece.row === tile.row && piece.col === tile.col)))
      .map((tile) => `${tile.row},${tile.col}`);
    const starDetails = operator ? starView(operator, piece.star, data, catalog.playerText) : null;
    const tokenNames = new Map((starDetails?.summons ?? []).map((token) => [token.id, token.name]));
    const summonOrders = (state.pieces.find((entry) => entry.uid === piece.uid)?.summonOrders ?? [])
      .map((order) => ({ name: tokenNames.get(order.tokenId), row: order.row, col: order.col }))
      .filter((order) => order.name);
    const summonLegalTiles=Object.fromEntries((starDetails?.summons??[]).map(token=>[token.id,legalSummonCells(resolved,state,piece,operator,token.id)]));
    return { ...piece, legalTiles, summonLegalTiles, summonOrders, operator: operator ? { name: operator.name, cost: operator.cost, position: operator.position,
      role: ROLE_TEXT[operator.role] ?? '伤害', pacts: [...operator.pacts], stats: { health: stats.maxHp, attack: stats.atk, defense: stats.def, resistance: stats.res },
      summons: starDetails.summons, statsKind:unitStats[piece.uid]?'deployed':'base',
      starDetails } : null };
  });
  const nodeKind = state.phase==='complete'?'complete':state.difficulty==='FUNNY'&&state.round%2===1?'logistics':resolved?.nodeKind??'unknown';
  const enemyData = resolved ? nextEnemyViews(data, resolved.wave) : [];
  const pacts = pactCounts(state.pieces.filter(piece=>piece.row!==null), catalog);
  const standUnited=state.rulesVersion===2&&state.strategies.some(selected=>(typeof selected==='string'?selected:selected.id)==='strategy_22');
  const standUnitedPacts=standUnited?Object.entries(pacts).filter(([id,pact])=>!['holyGun','yela','crown'].includes(id)&&catalog.pacts[id]?.singleUnique!==true&&pact.activeThreshold>0).map(([id])=>id):[];
  const strategyState={...base.strategyState};
  for(const selected of state.strategies??[]){const id=typeof selected==='string'?selected:selected.id;const entry=state.strategyState?.[id]??{};strategyState[id]={...entry,progressText:strategyProgressText(entry,catalog.strategies?.[id],state.round)};}
  return {
    ...base,
    ...(state.rulesVersion===2?{season:{name:catalog.season.displayName},openingEvent:openingEventView(state.openingId)}:{}),
    activeOperatorIds: [...(state.activeOperatorIds ?? [])],
    pieces,
    pacts,
    ...(standUnited?{strategyPreview:{standUnited:{activePacts:standUnitedPacts,attackPercentPerOperator:standUnitedPacts.length*1.5}}}:{}),
    strategyState,
    node: { kind: nodeKind, field: resolved?.field ?? null, stageId: resolved?.stageId ?? null,
      battleRound: resolved?.battleRound ?? null, waveRound: resolved?.waveRound ?? null,
      bossName: resolved?.bossId ? (data.bosses?.[resolved.bossId]?.name ?? data.bosses?.[resolved.bossId]?.appellation ?? '敌方领袖') : null },
    field: resolved ? { stageId: resolved.stageId, kind: resolved.field, tiles } : null,
    preview: { legalCells: tiles, nextEnemies: enemyData },
    nextEnemies: enemyData,
    shop: { ...base.shop, offers: base.shop.offers.map((offer) => ({ ...offer,
      operator: offer.operatorId ? (() => { const op = catalog.operators[offer.operatorId]; return op ? { name: op.name, cost: op.cost, pacts: [...op.pacts], skill: op.stars[1].skill } : null; })() : null,
    })) },
  };
}
