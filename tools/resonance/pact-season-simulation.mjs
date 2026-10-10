import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const CANONICAL_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
export const DATA_DIR = `${CANONICAL_ROOT}/data/resonance-native`;
export const REPORT_PATH = `${CANONICAL_ROOT}/.omni/tmp/resonance/pact-season-simulation.json`;
export const LOG_PATH = `${CANONICAL_ROOT}/.omni/tmp/resonance/pact-season-simulation.log`;
export const MAX_UNITS = 10;
export const PACT_SET = new Set(['laterano','kjerag','yan','victoria','columbia','kazimierz','siracusa','rhodes','lungmen','sargon','leithania','iberia','higashi','ursus','bolivar','rim','babel','sami','ammo','combo','control','creation','symbiosis','logistics','redeploy','flight','arts','breaker','burn','necrosis','sui','crown','aegir','holyGun','yela']);
const EFFECT_TRIGGER_KEYS = Object.freeze({ iberia_barrier: ['iberiaExplosion'], symbiosis_guard: ['symbiosisPulse'],
  kjerag_coordination: ['kjeragMark', 'kjeragResponse', 'kjeragCrossfire'], sui_shadow: ['sui', 'suiShadowAttacks'],
  laterano_ammo: ['lateranoDroneShots'], yan_combo: ['yanFormation'], columbia_construct: ['columbiaConstructAttacks'],
  logistics_dp: ['logisticsDpThreshold'] });

export function tiersForPact(pact) {
  return (Array.isArray(pact?.levels) ? pact.levels : Array.isArray(pact?.tiers) ? pact.tiers : [])
    .map((row) => ({ threshold: Number(row.threshold ?? row.count), effects: row.effects ?? [] }))
    .filter((row) => Number.isInteger(row.threshold) && row.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold);
}

function pactTransferEffect(item, pactId) {
  return (item?.effects ?? []).some((effect) => ['pact_transfer', 'transfer_pact'].includes(effect.kind)
    && (effect.params?.pactId ?? effect.params?.pact) === pactId);
}

export function transferFor(catalog, pactId) {
  if (catalog.pacts?.[pactId]?.emblemAllowed === false) return null;
  const activeIds = new Set(catalog.config?.activeOperatorIds ?? []);
  if (!Object.values(catalog.operators ?? {}).some((operator) => activeIds.has(operator.id) && (operator.pacts ?? []).includes(pactId))) return null;
  const recipes = new Map((catalog.recipes ?? []).map((recipe) => [recipe.resultId, recipe]));
  const candidates = Object.entries(catalog.equipment ?? {}).filter(([, item]) => item.kind === 'emblem' && pactTransferEffect(item, pactId))
    .map(([id, item]) => ({ id, item, recipe: recipes.get(id) ?? null }))
    .sort((a, b) => Number(Boolean(b.recipe)) - Number(Boolean(a.recipe)) || a.id.localeCompare(b.id));
  const chosen = candidates[0];
  if (!chosen) return null;
  if (chosen.recipe) return { itemId: chosen.id, source: 'component-recipe', configPath: 'catalog.recipes', recipeId: chosen.recipe.id ?? chosen.id,
    parts: [...(chosen.recipe.parts ?? chosen.item.parts ?? [])], nodes: [] };
  const supplyEntries = (catalog.campaign?.supply?.transfers ?? []).filter((entry) => Number(entry.count ?? 1) > 0
    && entry.selection === 'viable-pact').map((entry) => ({ node: Number(entry.node), count: Number(entry.count ?? 1), selection: entry.selection }))
    .filter((entry) => Number.isInteger(entry.node)).sort((a, b) => a.node - b.node);
  const supplies = supplyEntries.map((entry) => entry.node);
  if (!supplies.length) return null;
  return { itemId: chosen.id, source: 'campaign-supply-transfer', configPath: 'catalog.campaign.supply.transfers', recipeId: null,
    parts: [...(chosen.item.parts ?? [])], nodes: supplies, supplyEntries, selection: 'viable-pact', rewardItemId: chosen.id };
}

export function buildLineup(catalog, pactId, threshold, maxUnits = MAX_UNITS) {
  const activeIds = catalog?.config?.activeOperatorIds;
  if (!Array.isArray(activeIds) || !activeIds.length) throw new Error('SEASON_ACTIVE_ROSTER_MISSING');
  const roster = activeIds.map((id) => catalog.operators?.[id]).filter(Boolean);
  const activeSet = new Set(activeIds);
  const natural = roster.filter((operator) => (operator.pacts ?? []).includes(pactId))
    .sort((a, b) => String(a.charId).localeCompare(String(b.charId)) || String(a.id).localeCompare(String(b.id)));
  const byIdentity = new Map();
  for (const operator of natural) if (!byIdentity.has(operator.charId ?? operator.id)) byIdentity.set(operator.charId ?? operator.id, operator);
  const selected = [...byIdentity.values()].slice(0, threshold).map((operator) => ({ operatorId: operator.id, charId: operator.charId ?? operator.id, natural: true, transfer: null }));
  if (selected.length < threshold && threshold - byIdentity.size <= 2 && catalog.pacts?.[pactId]?.emblemAllowed !== false) {
    const transfer = transferFor(catalog, pactId);
    if (transfer) {
      const chosen = new Set(selected.map((row) => row.charId));
      for (const operator of roster) {
        if (selected.length >= threshold) break;
        const charId = operator.charId ?? operator.id;
        if (chosen.has(charId)) continue;
        selected.push({ operatorId: operator.id, charId, natural: false, transfer: { ...transfer, parts: [...transfer.parts] } });
        chosen.add(charId);
      }
    }
  }
  const legal = selected.length === threshold && selected.length <= maxUnits
    && selected.every((row) => activeSet.has(row.operatorId))
    && new Set(selected.map((row) => row.charId)).size === selected.length;
  return { eligible: legal, pactId, threshold, members: selected, naturalAvailable: byIdentity.size,
    reason: legal ? null : threshold > maxUnits ? `threshold ${threshold} exceeds native level-10 deployment capacity ${maxUnits}`
      : `only ${selected.length}/${threshold} unique legal season identities; no remaining configured emblem transfer can fill the tier` };
}

function roleTags(operator) {
  const profession = String(operator?.source?.normalChess?.profession ?? operator?.profession ?? '').toUpperCase();
  const tags = new Set();
  if (operator?.role === 'frontline' || ['GUARD', 'DEFENDER', 'VANGUARD'].includes(profession)) tags.add('frontline');
  if (profession === 'MEDIC') tags.add('healer');
  if (profession === 'SNIPER' && operator?.position === 'RANGED') tags.add('antiAir');
  return tags;
}

export function completeBattleLineup(catalog, lineup, round) {
  if (!lineup.eligible) return { ...lineup, battleRound: null, composition: null };
  const members = lineup.members.map((member) => ({ ...member, isTargetPactMember: true }));
  const selectedIds = new Set(members.map((member) => member.operatorId));
  const selectedChars = new Set(members.map((member) => member.charId));
  const activeIds = catalog.config.activeOperatorIds;
  const candidates = activeIds.map((id) => catalog.operators[id]).filter((operator) => operator
    && !selectedIds.has(operator.id) && !selectedChars.has(operator.charId ?? operator.id)
    && !(operator.pacts ?? []).includes(lineup.pactId))
    .sort((a, b) => Number(a.cost) - Number(b.cost) || String(a.charId).localeCompare(String(b.charId)));
  const addCandidate = (operator) => {
    if (!operator || members.length >= MAX_UNITS) return false;
    const charId = operator.charId ?? operator.id;
    if (selectedChars.has(charId)) return false;
    members.push({ operatorId: operator.id, charId, natural: false, transfer: null, isTargetPactMember: false });
    selectedIds.add(operator.id); selectedChars.add(charId);
    return true;
  };
  for (const role of ['frontline', 'healer', 'antiAir']) {
    if (members.some((member) => roleTags(catalog.operators[member.operatorId]).has(role))) continue;
    addCandidate(candidates.find((operator) => roleTags(operator).has(role)));
  }
  const requiredCount = Math.min(MAX_UNITS, Math.max(6, lineup.threshold));
  for (const operator of candidates) {
    if (members.length >= requiredCount) break;
    addCandidate(operator);
  }
  const missingRoles = ['frontline', 'healer', 'antiAir'].filter((role) => !members.some((member) => roleTags(catalog.operators[member.operatorId]).has(role)));
  const roleComplete = missingRoles.length === 0;
  if (members.length < Math.max(6, lineup.threshold) || !roleComplete) return { ...lineup, members, eligible: false,
    battleRound: null, composition: { count: members.length, minimum: Math.max(6, lineup.threshold), missingRoles },
    reason: `legal six-member composition unavailable; missing ${missingRoles.join(',') || `members ${members.length}/${Math.max(6, lineup.threshold)}`}` };
  const targetTransfers = members.filter((member) => member.isTargetPactMember && member.transfer?.source === 'campaign-supply-transfer');
  const transferCount = targetTransfers.length;
  const supplyRows = targetTransfers[0]?.transfer?.supplyEntries ?? [];
  let supplyTotal = 0, earliestSupplyNode = 0;
  const transferSourceNodes = [];
  for (const entry of supplyRows) {
    const count = Number(entry.count ?? 1);
    for (let i = 0; i < count; i++) transferSourceNodes.push(Number(entry.node));
    supplyTotal += count;
    if (supplyTotal >= transferCount) { earliestSupplyNode = Number(entry.node); break; }
  }
  if (transferCount && supplyTotal < transferCount) return { ...lineup, members, eligible: false, battleRound: null,
    composition: { count: members.length, missingRoles }, reason: `configured transfer supplies cover ${supplyTotal}/${transferCount} required identities` };
  targetTransfers.forEach((member, index) => { member.transferSourceNode = transferSourceNodes[index]; });
  const battleRound = Math.max(round, earliestSupplyNode);
  const final = battleRound >= 28;
  const withStars = members.map((member) => ({ ...member, star: final ? (Number(catalog.operators[member.operatorId].cost) <= 4 ? 2 : 1)
    : (Number(catalog.operators[member.operatorId].cost) <= 3 ? 2 : 1) }));
  const costBreakdown = withStars.map((member) => {
    const faceValue=Number(catalog.operators[member.operatorId].cost);
    const copies=member.star===3?9:member.star===2?3:1;
    return {operatorId:member.operatorId,name:catalog.operators[member.operatorId].name,star:member.star,unitFaceValue:faceValue,copiesForStar:copies,recruitmentMergeCost:faceValue*copies};
  });
  const costs = withStars.map((member) => Number(catalog.operators[member.operatorId].cost));
  return { ...lineup, members: withStars, battleRound, eligible: true, reason: null,
    composition: { count: withStars.length, frontline: withStars.filter((member) => roleTags(catalog.operators[member.operatorId]).has('frontline')).length,
      healers: withStars.filter((member) => roleTags(catalog.operators[member.operatorId]).has('healer')).length,
      antiAir: withStars.filter((member) => roleTags(catalog.operators[member.operatorId]).has('antiAir')).length,
      targetPactMembers: lineup.threshold, targetCost: withStars.filter((member) => member.isTargetPactMember).reduce((sum, member) => sum + Number(catalog.operators[member.operatorId].cost), 0),
      supportCost: withStars.filter((member) => !member.isTargetPactMember).reduce((sum, member) => sum + Number(catalog.operators[member.operatorId].cost), 0),
      totalCost: costs.reduce((sum, cost) => sum + cost, 0), unitFaceValueTotal:costs.reduce((sum,cost)=>sum+cost,0),
      recruitmentMergeCost:costBreakdown.reduce((sum,row)=>sum+row.recruitmentMergeCost,0),
      recruitmentCopies:costBreakdown.reduce((sum,row)=>sum+row.copiesForStar,0),costBreakdown,
      transferSourceNodes: targetTransfers.map((member) => member.transferSourceNode ?? null),
      stars: withStars.map((member) => ({ operatorId: member.operatorId, cost: catalog.operators[member.operatorId].cost, star: member.star })) } };
}

export function buildSimulationPlan(catalog) {
  if (catalog?.config?.rulesVersion !== 2 || catalog?.config?.seasonId !== 'resonance-season-2') throw new Error('SEASON_2_CATALOG_REQUIRED');
  if (PACT_SET.size !== 35 || Object.keys(catalog.pacts ?? {}).length !== PACT_SET.size
    || Object.keys(catalog.pacts ?? {}).some((id) => !PACT_SET.has(id))) throw new Error('CURRENT_PACT_SET_MUST_MATCH_35_RUNTIME_HANDLERS');
  const active = new Set(catalog.config.activeOperatorIds ?? []);
  if (active.size !== 65 || active.size !== (catalog.config.activeOperatorIds ?? []).length) throw new Error('SEASON_2_ROSTER_MUST_HAVE_65_UNIQUE_IDS');
  const rows = [];
  for (const pactId of [...PACT_SET].sort()) {
    const pact = catalog.pacts?.[pactId];
    if (!pact) throw new Error(`CURRENT_PACT_MISSING:${pactId}`);
    const tiers = tiersForPact(pact);
    for (const [index, tier] of tiers.entries()) {
      const lineup = buildLineup(catalog, pactId, tier.threshold);
      const normal = completeBattleLineup(catalog, lineup, 12);
      rows.push({ id: `${pactId}:${tier.threshold}:normal`, pactId, threshold: tier.threshold, tierIndex: index,
        effects: tier.effects.map((row) => row.kind), round: normal.battleRound, node: 'normal', ...normal });
      if (index === tiers.length - 1) {
        const boss = completeBattleLineup(catalog, lineup, 28);
        rows.push({ id: `${pactId}:${tier.threshold}:boss`, pactId, threshold: tier.threshold, tierIndex: index,
          effects: tier.effects.map((row) => row.kind), round: boss.battleRound, node: 'boss', ...boss });
      }
    }
  }
  return rows;
}

export function compareTriggerCounts(withTrait = {}, withoutTrait = {}) {
  const keys = [...new Set([...Object.keys(withTrait ?? {}), ...Object.keys(withoutTrait ?? {})])].sort();
  return keys.map((key) => {
    const before = Number.isFinite(withoutTrait?.[key]) ? withoutTrait[key] : null;
    const after = Number.isFinite(withTrait?.[key]) ? withTrait[key] : null;
    return { key, withoutTrait: before, withTrait: after, delta: before == null || after == null ? null : after - before,
      status: before == null && after == null ? 'unknown' : before == null || after == null ? 'partially-observed' : after === before ? 'zero-delta' : 'changed' };
  });
}

export function targetEffectObservations(effectKinds, withTriggers = {}, withoutTriggers = {}) {
  return effectKinds.map((kind) => {
    const keys = EFFECT_TRIGGER_KEYS[kind] ?? [];
    const counters = keys.map((key) => {
      const withTrait = Number.isFinite(withTriggers?.[key]) ? withTriggers[key] : 0;
      const withoutTrait = Number.isFinite(withoutTriggers?.[key]) ? withoutTriggers[key] : 0;
      return { key, withTrait, withoutTrait, delta: withTrait - withoutTrait,
        status: withTrait === withoutTrait ? withTrait === 0 ? 'observed-zero' : 'no-delta' : 'changed' };
    });
    return { effect: kind, counters: counters.length ? counters : null,
      status: counters.length ? 'observed-through-handler-counter' : 'unknown-no-effect-specific-counter-mapping' };
  });
}

function finiteTree(value, location = '$') {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`NON_FINITE_REPORT_VALUE:${location}`);
  if (Array.isArray(value)) value.forEach((entry, index) => finiteTree(entry, `${location}[${index}]`));
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) finiteTree(entry, `${location}.${key}`);
}

function metricSummary(outcome) {
  const units = outcome.combatStats?.units ?? [];
  const total = (key) => units.length > 0 && units.every((unit) => Number.isFinite(unit[key])) ? units.reduce((sum, unit) => sum + unit[key], 0) : null;
  return { won: outcome.won, hpLoss: outcome.hpLoss, damage: total('dmg'),
    effectiveHealing: total('heal'), damageTaken: total('taken'), kills: total('kills'), attacks: total('attacks'),
    deaths: outcome.metrics?.deaths ?? null,
    skillPoints: outcome.metrics?.skillPoints ?? null,
    skillPointsUnknownReason: outcome.metrics?.skillPoints == null ? 'Battle exposes no aggregate SP-gain or spent field; per-member SP samples are included when targeted instrumentation is active' : null,
    triggers: { ...(outcome.metrics?.triggers ?? {}) }, diagnostics: outcome.diagnostics,
    ...(outcome.targetedFollowUp ? { targetedFollowUp: outcome.targetedFollowUp } : {}),
    ...(Array.isArray(outcome.growth) ? { growth: outcome.growth } : {}),
    ...(Array.isArray(outcome.coins) ? { coins: outcome.coins } : {}),
    ...(Array.isArray(outcome.forge) ? { forge: outcome.forge } : {}) };
}

function diagnosticRunner(state, { data, catalog, buildBattle, finishIfEscaped, combatStatsOf, constants }) {
  const { battle, prepared } = buildBattle(state, { data, catalog, recording: false });
  const pieces = new Map(state.pieces.map((piece) => [String(piece.uid), { ...piece, name: catalog.operators[piece.operatorId]?.name ?? piece.operatorId }]));
  const events = { eventCounts: {}, members: {} };
  const memberFor = (unit) => {
    const owner = unit?.kind === 'token' ? unit.ownerUnit : unit;
    return pieces.get(String(owner?.uid)) ?? null;
  };
  const bump = (key, member, detail = null) => {
    events.eventCounts[key] = (events.eventCounts[key] ?? 0) + 1;
    if (!member) return;
    const uid = String(member.uid);
    const record = events.members[uid] ?? (events.members[uid] = { uid, operatorId: member.operatorId, name: member.name, counts: {} });
    record.counts[key] = (record.counts[key] ?? 0) + 1;
    if (detail && (key==='skillStart'||key==='ammoUsed'||key==='blocked'||key==='retreating'||key==='death:ally'||key==='deploy:return'||key==='resonanceDamage'||key==='alliedDamage'||key==='tokenAttack'||key.startsWith('elementBurst:')||key.startsWith('skillEnd:'))) {
      record.events ??= [];
      const sameType=record.events.filter((event)=>event.type===key).length;
      if(sameType===0||detail.left===0)record.events.push({type:key,...detail});
    }
  };
  const observe = (name, handler) => battle.on(name, handler, { owner: battle });
  observe('attack', (event) => { const unit=event?.attacker,owner=unit?.kind==='token'?unit.ownerUnit:unit; bump(unit?.kind==='token'?'tokenAttack':'attack', memberFor(unit), {
    attackerKind:unit?.kind??null,tokenId:unit?.tokenId??null,targetSide:event?.targets?.[0]?.side??null,isSkill:event?.isSkill===true,ownerSkillSp:Number.isFinite(owner?.skill?.sp)?owner.skill.sp:null }); });
  observe('skillStart', (event) => { const unit=event?.unit, member=memberFor(unit); if (!member) return; bump('skillStart',member,{skillId:unit.skill?.id ?? null,sp:Number.isFinite(unit.skill?.sp)?unit.skill.sp:null,flags:{...(unit.s?.flags??{})},motion:unit.motion??null,crownStacks:unit.mem?.pactCrownStacks??0}); });
  observe('skillEnd', (event) => bump(`skillEnd:${event?.reason ?? 'unknown'}`, memberFor(event?.unit), { skillId:event?.unit?.skill?.id ?? null,reason:event?.reason ?? null }));
  observe('ammoUsed', (event) => bump('ammoUsed', memberFor(event?.unit), { skillId:event?.skill?.id ?? event?.unit?.skill?.id ?? null,left:Number.isFinite(event?.left)?event.left:null }));
  observe('blocked', (event) => bump('blocked', memberFor(event?.blocker), { enemyId:event?.enemy?.defId ?? null }));
  observe('retreating', (event) => bump('retreating', memberFor(event?.unit), { reason:event?.reason ?? null }));
  observe('death', (event) => bump(`death:${event?.unit?.side ?? 'unknown'}`, memberFor(event?.unit), { kind:event?.unit?.kind ?? null }));
  observe('deploy', (event) => bump(`deploy:${event?.initial === false ? 'return' : 'initial'}`, memberFor(event?.unit), { initial:event?.initial ?? null }));
  observe('kill', (event) => bump('kill', memberFor(event?.killer), { victimSide:event?.victim?.side ?? null,rank:event?.victim?.def?.rank ?? null }));
  observe('elementBurst', (event) => bump(`elementBurst:${event?.element ?? 'unknown'}`, memberFor(event?.source), { targetSide:event?.target?.side ?? null }));
  observe('damaged', (event) => {
    if (event?.source?.side !== 'ally' || event?.target?.side !== 'enemy') return;
    const tags=Array.isArray(event?.dmg?.tags)?event.dmg.tags:[];
    const controlled=(event?.target?.buffs??[]).some((buff)=>['sluggish','slow'].includes(buff.status)&&Number(buff.mods?.moveMul)<1);
    bump(tags.includes('resonance')?'resonanceDamage':'alliedDamage',memberFor(event?.source),{type:event?.dmg?.type??null,element:event?.dmg?.element??null,dealt:Number.isFinite(event?.dealt)?event.dealt:null,
      multiplier:Number.isFinite(event?.dmg?.mul)?event.dmg.mul:null,targetControlled:controlled,targetFlags:{...(event?.target?.s?.flags??{})},tags:tags.slice(0,5)});
  });
  observe('healed', (event) => bump('healed', memberFor(event?.source), { targetUid:event?.target?.uid ?? null,amount:Number.isFinite(event?.amount)?event.amount:null }));
  observe('kill', () => {
    for (const [uid, piece] of pieces) {
      const unit=battle.allyUnits.find((row)=>String(row.uid)===uid);
      if (unit?.skill) { const record=events.members[uid]??(events.members[uid]={uid,operatorId:piece.operatorId,name:piece.name,counts:{}}); record.spAfterKill=Number.isFinite(unit.skill.sp)?unit.skill.sp:null; }
    }
  });
  const maxTicks=Math.ceil(constants.MAX_BATTLE_TIME/constants.TICK)+1;
  while (!battle.finished && battle.tickCount < maxTicks) { battle.step(); finishIfEscaped(battle,prepared.nodeKind); }
  const capped=!battle.finished;
  if(capped)battle.forceEnd('timeout');
  const result=battle.result(),playerResult=result.perPlayer?.resonance??Object.values(result.perPlayer??{})[0]??{};
  const combatStats=combatStatsOf(playerResult);
  const leak=(playerResult.leaked??[]).filter((entry)=>entry&&entry.counted!==false).reduce((sum,entry)=>sum+Math.max(0,Number.isFinite(Number(entry.lpr))?Number(entry.lpr):1),0);
  const hpLoss=Math.min(Number(prepared.gd.lpCapPerRound)||Infinity,Math.max(0,leak));
  if(battle.errorCount)throw Object.assign(new Error(`targeted Battle recorded ${battle.errorCount} content error(s)`),{diagnostics:battle.errors.slice(0,20)});
  for(const record of Object.values(events.members)){
    const stats=combatStats?.units?.find((row)=>String(row.uid)===record.uid);
    if(stats)record.combat={damage:stats.dmg,healing:stats.heal,damageTaken:stats.taken,kills:stats.kills,attacks:stats.attacks};
    if(record.spAfterKill===undefined)delete record.spAfterKill;
    const live=battle.allyUnits.find((unit)=>String(unit.uid)===record.uid);
    if(Number.isFinite(live?.skill?.sp))record.finalSp=live.skill.sp;
  }
  const metrics={deaths:Number(playerResult.deaths)||0,...(battle.resonanceMetrics??{})};
  return { won:battle.resonanceOutcome?.won===true,hpLoss,result,combatStats,metrics,
    growth:structuredClone(battle.resonanceResults?.growth??[]),coins:structuredClone(battle.resonanceResults?.coins??[]),forge:structuredClone(battle.resonanceResults?.forge??[]),
    diagnostics:{modeId:prepared.modeId,round:state.round,battleRound:prepared.battleRound,waveRound:prepared.waveRound,nodeKind:prepared.nodeKind,stageId:prepared.stageId,ticks:battle.tickCount,capped,
      summonAnchors:structuredClone(battle.resonanceSummonAnchors??[]),summonAnchorGaps:structuredClone(battle.resonanceSummonAnchorGaps??[]),errorCount:battle.errorCount},
    targetedFollowUp:{events,deaths:metrics.deaths} };
}

function deterministicSeed(row) {
  let hash = 2166136261;
  for (const char of row.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function makeState(row, catalog, field, positionClass, canPlace, data = null, ensureSummonSpace = false, ownerRangeKeys = null) {
  if (!field?.deployMap || field.nodeKind !== (row.node === 'boss' ? 'boss' : 'normal')) throw new Error(`NATIVE_SCENE_MISMATCH:${row.id}`);
  const tiles = [...field.deployMap.keys()].map((key) => key.split(',').map(Number)).sort(([ar, ac], [br, bc]) =>
    Math.hypot(ar - 10.5, ac - 10) - Math.hypot(br - 10.5, bc - 10) || ar - br || ac - bc);
  const occupied = new Set();
  const pieces = row.members.map((member, index) => {
    const operator = catalog.operators[member.operatorId];
    const pos = positionClass(operator?.source?.normalChess ?? { position: operator?.position });
    const tile = tiles.find(([r, c]) => !occupied.has(`${r},${c}`) && canPlace(field.deployMap, pos, r, c));
    if (!tile) throw new Error(`NATIVE_FIELD_CAPACITY_OR_POSITION:${row.id}:${index + 1}/${row.members.length}:${pos}`);
    occupied.add(`${tile[0]},${tile[1]}`);
    return { uid: `pact-sim-${index + 1}`, operatorId: member.operatorId, star: member.star ?? 1,
      row: tile[0], col: tile[1], dir: 'RIGHT', equipment: member.transfer ? [{ itemId: member.transfer.itemId }] : [], extraPacts: [] };
  });
  if (ensureSummonSpace && row.pactId === 'creation' && data?.tokens && ownerRangeKeys) {
    const occupiedByOther = (piece) => new Set(pieces.filter((row) => row !== piece).map((row) => `${row.row},${row.col}`));
    for (const piece of pieces) {
      const operator = catalog.operators[piece.operatorId];
      const token = Object.values(data.tokens).find((candidate) => candidate?.placeable === true && candidate.ownerRange === true
        && Array.isArray(candidate.owners) && candidate.owners.includes(piece.operatorId));
      if (!token || !Array.isArray(operator?.source?.normalChess?.rangeGrid)) continue;
      const occupied = occupiedByOther(piece);
      const hasFreeOwnerTile = (row, col) => {
        const range = ownerRangeKeys(operator.source.normalChess.rangeGrid, row, col, piece.dir);
        return [...field.deployMap.keys()].some((key) => {
          if (occupied.has(key) || key === `${row},${col}` || !range.has(key)) return false;
          const [r, c] = key.split(',').map(Number);
          return canPlace(field.deployMap, positionClass(token), r, c);
        });
      };
      if (hasFreeOwnerTile(piece.row, piece.col)) continue;
      const candidate = tiles.filter(([row, col]) => !occupied.has(`${row},${col}`)
        && canPlace(field.deployMap, positionClass(operator.source.normalChess), row, col)
        && hasFreeOwnerTile(row, col)).sort(([ar, ac], [br, bc]) => ac - bc || ar - br)[0];
      if (candidate) { piece.row = candidate[0]; piece.col = candidate[1]; }
    }
  }
  if (pieces.some((piece) => !catalog.config.activeOperatorIds.includes(piece.operatorId))) throw new Error(`INACTIVE_OPERATOR_IN_SCENARIO:${row.id}`);
  return { schemaVersion: 1, rulesVersion: 2, seasonId: catalog.config.seasonId, seed: deterministicSeed(row), difficulty: 'NORMAL',
    round: row.round, roundLimit: 28, environmentId: null, phase: 'prep', level: Math.min(10,Math.max(1,pieces.length)), xp: 0, gold: 0, hp: 100,
    winStreak: 0, lossStreak: 0, nodeStarted: true, shop: { offers: [], locked: false }, inventory: [], strategies: [], strategyState: {},
    pacts: [], pieces, history: [], poolRemaining: {}, claimedNodes: [], pendingChoices: [], usedRecruitSlots: 0, usedTransferSlots: 0 };
}

export function buildScenarioState(row, catalog, field, { data = null, board, ensureSummonSpace = false } = {}) {
  if (!board?.positionClass || !board?.canPlace) throw new TypeError('scenario board helpers are required');
  return makeState(row,catalog,field,board.positionClass,board.canPlace,data,ensureSummonSpace,board.ownerRangeKeys);
}

function controlCatalog(catalog, row) {
  const operators = { ...catalog.operators };
  for (const member of row.members) {
    const operator = operators[member.operatorId];
    if (operator) operators[member.operatorId] = { ...operator, pacts: (operator.pacts ?? []).filter((id) => id !== row.pactId) };
  }
  const equipment = { ...catalog.equipment };
  for (const member of row.members) if (member.transfer) {
    const item = equipment[member.transfer.itemId];
    if (!item) throw new Error(`TRANSFER_ITEM_MISSING:${member.transfer.itemId}`);
    const effects = (item.effects ?? []).filter((effect) => {
      const transferredId = effect.params?.pactId ?? effect.params?.pact;
      return !(['pact_transfer', 'transfer_pact'].includes(effect.kind) && transferredId === row.pactId);
    });
    equipment[member.transfer.itemId] = { ...item, effects };
  }
  return { ...catalog, operators, equipment };
}

function runScenario(row, data, catalog, getField, runBattle, positionClass, canPlace, ownerRangeKeys = null, diagnostic = false) {
  if (!row.eligible) return { ...row, status: 'not-eligible' };
  const state = makeState(row, catalog, getField(row.round, catalog), positionClass, canPlace, data, diagnostic, ownerRangeKeys);
  const withTrait = runBattle(state, { data, catalog, recording: false });
  const withoutTrait = runBattle(state, { data, catalog: controlCatalog(catalog, row), recording: false });
  const withSummary = metricSummary(withTrait), withoutSummary = metricSummary(withoutTrait);
  const differences = Object.fromEntries(['damage','effectiveHealing','damageTaken','hpLoss','won'].map((key) => [key,
    withSummary[key] == null || withoutSummary[key] == null ? null : typeof withSummary[key] === 'boolean' ? withSummary[key] === withoutSummary[key] ? 0 : (withSummary[key] ? 1 : -1) : withSummary[key] - withoutSummary[key]]));
  return { ...row, cost: row.members.reduce((sum, member) => sum + Number(catalog.operators[member.operatorId].cost), 0),
    members: row.members.map((member) => ({ ...member, cost: catalog.operators[member.operatorId].cost, name: catalog.operators[member.operatorId].name,
      naturalPacts: [...(catalog.operators[member.operatorId].pacts ?? [])] })),
    comparison: { withTrait: withSummary, withoutTrait: withoutSummary, differences,
      triggerCounts: compareTriggerCounts(withSummary.triggers, withoutSummary.triggers),
      targetEffects: targetEffectObservations(row.effects, withSummary.triggers, withoutSummary.triggers),
      ...(diagnostic ? { targetedFollowUp: { seed:state.seed,fixtureLevel:state.level,fixturePositions:state.pieces.map((piece)=>({uid:piece.uid,operatorId:piece.operatorId,
        name:catalog.operators[piece.operatorId]?.name??piece.operatorId,row:piece.row,col:piece.col,dir:piece.dir,star:piece.star})),
        withTrait: withSummary.targetedFollowUp ?? null, withoutTrait: withoutSummary.targetedFollowUp ?? null } } : {}) }, status: 'simulated' };
}

async function runWorker() {
  process.env.SP_DATA_DIR = workerData.dataDir;
  const [{ getData }, { getResonanceCatalog }, battleApi, constants, board] = await Promise.all([
    import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'), import('../../server/modes/resonance/battle.js'),
    import('../../server/sim/constants.js'), import('../../server/match/board.js'),
  ]);
  const data = getData();
  const catalog = getResonanceCatalog(data, { rulesVersion: 2, seed: 73021, seasonId: 'resonance-season-2' });
  parentPort.postMessage({ type: 'ready', plan: buildSimulationPlan(catalog) });
  parentPort.on('message', ({ id, row, diagnostic = false }) => {
    try {
      const getField=(round)=>battleApi.getResonanceField({ seed: deterministicSeed(row), rulesVersion: 2,
        seasonId: catalog.config.seasonId, difficulty: 'NORMAL', round, roundLimit: 28 }, { data, catalog });
      const runner=diagnostic ? ((state,options)=>diagnosticRunner(state,{...options,buildBattle:battleApi.buildResonanceBattle,
        finishIfEscaped:battleApi.finishResonanceTerminalIfEscaped,combatStatsOf:battleApi.combatStatsOf,constants})) : battleApi.runResonanceBattle;
      parentPort.postMessage({ type: 'result', id, result: runScenario(row, data, catalog, getField, runner, board.positionClass, board.canPlace,
        board.ownerRangeKeys, diagnostic) });
    }
    catch (error) { parentPort.postMessage({ type: 'result', id, error: { name: error.name, message: error.message, stack: error.stack } }); }
  });
}

async function runMain() {
  process.env.SP_DATA_DIR = DATA_DIR;
  const rerunUncovered = process.argv.includes('--rerun-uncovered');
  const targetedFollowups = process.argv.includes('--targeted-followups');
  const requestedTargetedIds = process.argv.find((arg) => arg.startsWith('--targeted-ids='))?.slice('--targeted-ids='.length)
    .split(',').map((id) => id.trim()).filter(Boolean) ?? null;
  if(rerunUncovered&&targetedFollowups)throw new Error('RUN_MODES_ARE_MUTUALLY_EXCLUSIVE');
  const fs = await import('node:fs/promises');
  let previousById = new Map();
  let previouslyUncovered = new Set();
  let previousReport = null;
  if (rerunUncovered || targetedFollowups) {
    previousReport = JSON.parse(await fs.readFile(REPORT_PATH, 'utf8'));
    if (rerunUncovered) {
      previousById = new Map((previousReport.cases ?? []).map((row) => [row.id, row]));
      previouslyUncovered = new Set((previousReport.cases ?? []).filter((row) => row.status !== 'simulated').map((row) => row.pactId));
      if (!previouslyUncovered.size) throw new Error('NO_UNCOVERED_PACT_CASES_TO_RERUN');
    } else {
      if (!Array.isArray(previousReport.zeroDeltaDiagnostics?.targetedFollowupCases)) throw new Error('TARGETED_FOLLOWUP_CASE_LIST_MISSING');
      previouslyUncovered = new Set(previousReport.zeroDeltaDiagnostics.targetedFollowupCases);
      if (requestedTargetedIds) {
        const invalid = requestedTargetedIds.filter((id) => !previouslyUncovered.has(id));
        if (invalid.length) throw new Error(`TARGETED_IDS_NOT_IN_FOLLOWUP_LIST:${invalid.join(',')}`);
        previouslyUncovered = new Set(requestedTargetedIds);
      }
      if (!previouslyUncovered.size) throw new Error('NO_TARGETED_FOLLOWUP_CASES');
    }
  }
  const workers = [0, 1].map(() => new Worker(fileURLToPath(import.meta.url), { workerData: { dataDir: DATA_DIR }, resourceLimits: { maxOldGenerationSizeMb: 384 } }));
  const completed = new Map();
  let plan = null, cursor = 0, todoIndexes = [], failed = false, timedOut = false;
  const promise = new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const dispatchReady = () => {
      if (!plan || !workers.every((worker) => worker._ready || worker._dead)) return;
      if (completed.size === plan.length) { finish(); return; }
      workers.forEach(dispatch);
      if (completed.size === plan.length) finish();
    };
    const dispatch = (worker) => {
      if (!worker._ready || worker._dead || worker._busy || !plan || cursor >= todoIndexes.length) return;
      const id = todoIndexes[cursor++];
      worker._busy = true;
      worker._task = id;
      worker.postMessage({ id, row: plan[id], diagnostic: targetedFollowups });
    };
    for (const [index, worker] of workers.entries()) worker.on('message', (message) => {
      if (message.type === 'ready') {
        if (!plan) {
          plan = message.plan;
          if (rerunUncovered || targetedFollowups) {
            if(targetedFollowups){
              for(let index=0;index<plan.length;index++){
                if(previouslyUncovered.has(plan[index].id))todoIndexes.push(index);
                else completed.set(index,{...plan[index],status:'not-run',reason:'not selected by targeted follow-up list'});
              }
            } else {
            const highestByPact = new Map();
            for (const row of plan) highestByPact.set(row.pactId, Math.max(highestByPact.get(row.pactId) ?? 0, row.threshold));
            for (let index = 0; index < plan.length; index++) {
              const row = plan[index], previous = previousById.get(row.id);
              const isFinalTierPair = row.threshold === highestByPact.get(row.pactId) && ['normal', 'boss'].includes(row.node);
              const shouldRun = previouslyUncovered.has(row.pactId) && (!previous || previous.status !== 'simulated' || isFinalTierPair);
              if (shouldRun) todoIndexes.push(index);
              else if (previous?.status === 'simulated') completed.set(index, previous);
              else completed.set(index, { ...row, status: 'not-run', reason: 'case not selected by --rerun-uncovered' });
            }
            }
          } else todoIndexes = plan.map((_, index) => index);
        }
        worker._ready = true; dispatchReady(); return;
      }
      if (message.type === 'result') {
        completed.set(message.id, message.error ? { ...plan[message.id], status: 'failed', error: message.error } : message.result);
        if (message.error) failed = true;
        worker._busy = false;
        worker._task = null;
        dispatch(worker);
        if (completed.size === plan.length) finish();
      }
    }).on('error', (error) => {
      failed = true; worker._dead = true; worker._ready = true;
      if (worker._task != null && plan) completed.set(worker._task, { ...plan[worker._task], status: 'failed', error: { message: error.message } });
      worker._busy = false; worker._task = null;
      dispatchReady();
    }).on('exit', (code) => {
      if (settled) return;
      if (code !== 0) failed = true;
      worker._dead = true;
      if (worker._task != null && plan) { completed.set(worker._task, { ...plan[worker._task], status: 'failed', error: { message: `worker exited with code ${code}` } }); worker._task = null; }
      worker._busy = false;
      dispatchReady();
    });
    setTimeout(() => { timedOut = true; finish(); }, 8 * 60 * 1000).unref();
  });
  await promise;
  await Promise.all(workers.map((worker) => worker.terminate()));
  const rows = plan ? plan.map((entry, index) => completed.get(index) ?? { ...entry, status: 'not-run', reason: timedOut ? '8-minute watchdog elapsed' : 'worker did not return a result' }) : [];
  if(targetedFollowups){
    const selectedIds=new Set(previousReport.zeroDeltaDiagnostics.targetedFollowupCases);
    const diagnosisById=new Map((previousReport.zeroDeltaDiagnostics.cases??[]).flatMap((entry)=>(entry.ids??[]).map((id)=>[id,entry])));
    const rerunIds = new Set(requestedTargetedIds ?? selectedIds);
    const newlyRunRows=rows.filter((row)=>rerunIds.has(row.id)).map((row)=>{
      const prior=diagnosisById.get(row.id);
      return {...row,priorDiagnosis:prior?{classification:prior.classification,confidence:prior.confidence,evidence:prior.evidence,next:prior.next}:null};
    });
    const priorFollowups=new Map((previousReport.targetedFollowUps?.cases??[]).map((row)=>[row.id,row]));
    for(const row of newlyRunRows)priorFollowups.set(row.id,row);
    const targetedRows=[...priorFollowups.values()].filter((row)=>selectedIds.has(row.id));
    const priorRuns=previousReport.targetedFollowUps?.attemptHistory??[];
    const attemptHistory=[...priorRuns,{generatedAt:new Date().toISOString(),rerunIds:[...rerunIds],summary:{planned:rerunIds.size,
      returned:newlyRunRows.length,simulated:newlyRunRows.filter((row)=>row.status==='simulated').length,
      failed:newlyRunRows.filter((row)=>row.status==='failed').length}}];
    previousReport.targetedFollowUps={generatedAt:new Date().toISOString(),
      source:{dataDirectory:DATA_DIR,scene:'native season-2 resonance field; buildResonanceBattle + step + finishResonanceTerminalIfEscaped; recording:false',
        comparison:'same deterministic seed and same lineup/positions/equipment; control removes only target pact identity and its matching transfer effect',
        instrumentation:'read-only observers count native Battle events and collect native metrics, growth, coins, forge, deaths and per-member combat stats',
        economicScope:'focused battle effects only; no shop draw, refresh, recruit, merge, leveling cost, or post-battle session settlement was simulated. Growth/coins/forge are only reported when native Battle returns them.'},
      limits:{concurrency:2,maxOldGenerationSizeMbPerWorker:384,watchdogMs:480000,recording:false},
      status:timedOut?'watchdog-timeout':failed?'completed-with-failures':targetedRows.length!==selectedIds.size?'incomplete':'completed',
      attemptHistory,
      summary:{planned:selectedIds.size,returned:targetedRows.length,simulated:targetedRows.filter((row)=>row.status==='simulated').length,
        failed:targetedRows.filter((row)=>row.status==='failed').length,executedThisRun:todoIndexes.length},
      cases:targetedRows};
    finiteTree(previousReport);
    if(Buffer.byteLength(JSON.stringify(previousReport))>3*1024*1024)throw new Error('REPORT_EXCEEDS_3_MB');
    await fs.writeFile(REPORT_PATH,`${JSON.stringify(previousReport)}\n`);
    console.log(JSON.stringify({status:previousReport.targetedFollowUps.status,summary:previousReport.targetedFollowUps.summary,report:REPORT_PATH}));
    if(previousReport.targetedFollowUps.status!=='completed')process.exitCode=1;
    return;
  }
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), season: { id: 'resonance-season-2', activeOperatorCount: 65 },
    attemptHistory: rerunUncovered ? [...(previousReport.attemptHistory ?? []), { generatedAt: previousReport.generatedAt,
      runMode: previousReport.source?.runMode ?? 'full', summary: previousReport.summary,
      unresolvedCases: (previousReport.cases ?? []).filter((row) => row.status !== 'simulated').map((row) => ({ id: row.id,
        pactId: row.pactId, threshold: row.threshold, node: row.node, naturalAvailable: row.naturalAvailable, reason: row.reason })) }] : [],
    source: { dataDirectory: DATA_DIR, scene: 'native resonance NORMAL field via getResonanceField + runResonanceBattle(recording:false)',
      baseline: 'same seed, same lineup and equipment; target natural pact identities and pact-transfer effect removed in a control catalog',
      runMode: rerunUncovered ? 'rerun-uncovered-final-tiers; prior simulated cases reused by exact case id' : 'full' },
    limits: { concurrency: 2, maxOldGenerationSizeMbPerWorker: 384, watchdogMs: 480000, recording: false, maxUnits: MAX_UNITS },
    status: timedOut ? 'watchdog-timeout' : failed ? 'completed-with-failures' : rows.some((row) => row.status === 'not-eligible' || row.status === 'not-run') ? 'completed-with-uncovered-tiers' : 'completed', summary: { planned: plan?.length ?? 0, returned: rows.length,
      simulated: rows.filter((row) => row.status === 'simulated').length, unsupportedCapacity: rows.filter((row) => row.status === 'not-eligible').length,
      failed: rows.filter((row) => row.status === 'failed').length, executedThisRun: todoIndexes.length, reusedPriorCases: rows.length - todoIndexes.length }, cases: rows };
  finiteTree(report);
  if (Buffer.byteLength(JSON.stringify(report)) > 3 * 1024 * 1024) throw new Error('REPORT_EXCEEDS_3_MB');
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { flag: rerunUncovered ? 'w' : 'wx' });
  const log = [`command: node --max-old-space-size=384 tools/resonance/pact-season-simulation.mjs`,
    `status: ${report.status}`, `planned: ${report.summary.planned}`, `simulated: ${report.summary.simulated}`,
    `unsupported capacity: ${report.summary.unsupportedCapacity}`, `failed: ${report.summary.failed}`,
    `executed this run: ${report.summary.executedThisRun}`, `reused prior cases: ${report.summary.reusedPriorCases}`,
    `report: ${REPORT_PATH}`, `log: ${LOG_PATH}`, `exit code: ${report.status === 'completed' ? 0 : 1}`].join('\n') + '\n';
  await fs.writeFile(LOG_PATH, log, { flag: rerunUncovered ? 'w' : 'wx' });
  if (report.status !== 'completed') process.exitCode = 1;
}

if (!isMainThread) await runWorker();
else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runMain();
