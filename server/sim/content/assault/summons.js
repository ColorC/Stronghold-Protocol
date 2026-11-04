import { rotateOffset } from '../../dir.js';
import { normalizeToken } from '../../simdata.js';
import { COLS } from '../../constants.js';
import { active, uid } from './primitives.js';
import { structurallyEqual } from '../../../../shared/assault/rng.js';
import { bodyOnTile, nonOccupyingTokenAt } from '../../body.js';

const ledgers = new WeakMap();
const tokenUid = (token) => token?.uid ?? token?.id;
const sourceKey = (spec) => String(spec.ruleKey ? `${spec.tokenId}:${spec.ruleKey}` : (spec.derivedKey ?? spec.tokenId));

function allLedgers(battle) {
  let byOwner = ledgers.get(battle);
  if (!byOwner) { byOwner = new Map(); ledgers.set(battle, byOwner); }
  return byOwner;
}

export function ledgerFor(battle, owner) {
  if (!battle?.assaultRuntime) throw new Error('assaultRuntime is required for summon ledger');
  const ownerUid = uid(owner);
  const ledgersByOwner = allLedgers(battle);
  if (ledgersByOwner.has(ownerUid)) return ledgersByOwner.get(ownerUid);
  const ledger = {
    owner, ownerUid, stock: new Map(), activeByKey: new Map(), capacity: 0,
    sources: new Map(), pending: [], fused: new Set(), closed: false,
  };
  ledgersByOwner.set(ownerUid, ledger);
  const retry = (cause) => {
    if (ledger.closed || !ledger.pending.length) return;
    battle.assaultRuntime.enqueue(() => retryPending(battle, ledger), {
      key: `summon-retry:${ownerUid}`, targetUid: ownerUid, cause,
    });
  };
  battle.assaultRuntime.observe('dpReceived', `summon-dp:${ownerUid}`, (event) => {
    if (event.payload?.targetUid === owner.ownerId) retry(event.cause);
  }, { owner: ledger });
  battle.assaultRuntime.observe('summonDied', `summon-death:${ownerUid}`, (event) => {
    const entry = ledger.activeByKey.get(tokenUid(event.payload?.target));
    if (!entry) return;
    ledger.activeByKey.delete(tokenUid(event.payload.target));
    const set = ledger.sources.get(entry.key);
    set?.active.delete(tokenUid(event.payload.target));
    retry(event.cause);
  }, { owner: ledger });
  battle.assaultRuntime.observe('deployed', `summon-space:${ownerUid}`, (event) => {
    if (event.payload?.target === owner) ledger.closed = false;
    if (event.payload?.target?.side === 'ally') retry(event.cause);
  }, { owner: ledger });
  battle.on('retreating', ({ unit: target }) => {
    if (target === owner) return;
    const entry = ledger.activeByKey.get(tokenUid(target));
    if (!entry) return;
    ledger.activeByKey.delete(entry.uid);
    ledger.sources.get(entry.key)?.active.delete(entry.uid);
    retry(battle.assaultRuntime.currentCause);
  }, { owner: ledger });
  battle.on('tick', () => retryPending(battle, ledger), { owner: ledger });
  battle.on('death', ({ unit, reason }) => {
    if (unit !== owner) return;
    ledger.closed = true;
    const entries = [...ledger.activeByKey.values()];
    ledger.activeByKey.clear();
    for (const record of ledger.sources.values()) record.active.clear();
    for (const { unit: live, uid: token } of entries) {
      if (live?.alive) {
        battle.retreat(live, { reason: 'ownerDeath', permanent: true });
        if (reason === 'killed') battle.assaultRuntime.publish('summonOwnerDied', { source: owner, sourceUid: ownerUid, target: live, targetUid: token, ownerUid }, { sourceUid: ownerUid });
      }
    }
    if (owner.removed) ledger.dispose();
  }, { owner: ledger });
  ledger.dispose = () => { ledger.closed = true; ledger.pending.length = 0; battle.offOwner(ledger); };
  return ledger;
}

function isLegal(battle, owner, tokenId, row, col, source) {
  const def = source.def ?? battle.tokenDef(tokenId, owner);
  const constraints = def?.raw?.sourceTemplate ?? def?.raw ?? def ?? {};
  const placement = constraints.assaultPlacementClass ?? (constraints.rangedTilesOnly ? 'high' : String(def?.position ?? 'MELEE').toLowerCase());
  const ranged = source.ranged ?? ['ranged', 'all', 'high'].includes(placement);
  if (!battle.grid.inRect(row, col) || !battle.grid.canStand(row, col, { ranged })) return false;
  const terrain = battle.grid.tile(row, col);
  if (placement === 'high' && terrain.height !== 'HIGH' && terrain.build !== 'RANGED') return false;
  const inSkillRange=()=>owner.def.raw.assaultBody.adaptation.rangeGrid.some(([r,c])=>{
    const [rr,cc]=rotateOffset(r,c,owner.dir);return owner.tileR+rr===row&&owner.tileC+cc===col;
  });
  const inRange = source.placementScope==='skillRange'?inSkillRange()
    :owner.rangeKeySet?.has(row * COLS + col)??owner.rangeKeys?.includes(row * COLS + col)??false;
  const dr = Math.abs(row - owner.tileR), dc = Math.abs(col - owner.tileC);
  if (source.placementScope === 'adjacent4' && dr + dc !== 1) return false;
  if (source.placementScope === 'adjacent8' && Math.max(dr, dc) !== 1) return false;
  if(source.placementScope==='skillRange'&&!inRange)return false;
  if ((constraints.ownerRange || source.placementScope === 'ownerRange') && !inRange) return false;
  if (constraints.ownerRangeOutside && inRange) return false;
  const occupant = battle.unitAt(row, col);
  const sharedOwnerOperator = source.occupiesTile === false && occupant?.alive && occupant.deployed
    && occupant.side === 'ally' && occupant.kind === 'op' && owner.ownerId != null && occupant.ownerId === owner.ownerId;
  if (battle.grid.isObstacle(row, col) || battle.downOn(row, col)) return false;
  if ((source.occupiesTile === false || source.avoidGroundEnemy) && battle.enemies.some((enemy) => enemy.alive && enemy.deployed && !enemy.isFlying && bodyOnTile(enemy, row, col))) return false;
  if (source.occupiesTile === false && nonOccupyingTokenAt(battle.allyUnits, row, col, source.replacingUnit)) return false;
  if (sharedOwnerOperator) {
    const reservedByWaitingAlly = battle.allyUnits.some((unit) => {
      if (unit.alive || unit.removed || (unit.kind !== 'op' && unit.kind !== 'token')) return false;
      const [rr, cc] = battle.restTile(unit);
      return rr === row && cc === col;
    });
    if (reservedByWaitingAlly) return false;
  } else if (battle.isReservedTile(row, col) || occupant) return false;
  if (owner.player && !battle.onOwnBoard(owner.player, row, col)) return false;
  return true;
}

export const summonPlacementLegal=(battle,owner,tokenId,row,col,source={})=>isLegal(battle,owner,tokenId,row,col,source);

function tiles(battle, owner, tokenId, source) {
  const out = [];
  const add = (row, col) => { if (isLegal(battle, owner, tokenId, row, col, source) && !out.some((x) => x[0] === row && x[1] === col)) out.push([row, col]); };
  if (Array.isArray(source.preparedSlot)) {
    add(source.preparedSlot[0], source.preparedSlot[1]);
    if(source.preparedOnly)return out;
  }
  for (const preset of source.preparedSlots ?? []) add(preset.row, preset.col);
  // A player-selected tile is an instruction, never a hint. Occupied or
  // temporarily unaffordable summons wait for that tile instead of wandering.
  if(source.preparedOnly||source.preparedSlots?.length)return out;
  const [r, c] = [owner.tileR, owner.tileC];
  const near = [[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1],[1,0],[1,1]];
  for (const [lr, lc] of near) { const [rr, cc] = rotateOffset(lr, lc, owner.dir); add(r + rr, c + cc); }
  const cells = [];
  for (let row = battle.rect.r0; row <= battle.rect.r1; row++) for (let col = battle.rect.c0; col <= battle.rect.c1; col++) {
    if (isLegal(battle, owner, tokenId, row, col, source)) cells.push([row, col]);
  }
  cells.sort((a, b) => Math.abs(a[0]-r)+Math.abs(a[1]-c)-Math.abs(b[0]-r)-Math.abs(b[1]-c) || a[0]-b[0] || a[1]-b[1]);
  for (const cell of cells) add(...cell);
  return out;
}

function sourceRecord(ledger, spec) {
  if (!Number.isFinite(spec.deploymentInterval ?? 0) || (spec.deploymentInterval ?? 0) < 0)
    throw new TypeError('summon deployment interval must be nonnegative and finite');
  const key = sourceKey(spec);
  let record = ledger.sources.get(key);
  if (!record) {
    record = { key, ruleKey: spec.ruleKey ?? null, tokenId: spec.tokenId, stockCap: spec.stockCap ?? Infinity, fieldCap: spec.fieldCap ?? (ledger.capacity || 1),
      cost: spec.cost ?? null, duration: spec.duration ?? null, stats: spec.stats ?? null, def: spec.def ?? null,
      kit: spec.kit ?? null, anySource: spec.anySource === true, occupiesTile: spec.occupiesTile !== false, ranged: spec.ranged, preparedSlot: spec.preparedSlot ?? null,
      placementScope: spec.placementScope ?? null, avoidGroundEnemy: spec.avoidGroundEnemy === true,
      preparedOnly:spec.preparedOnly===true, preparedSlots: (ledger.owner.def?.raw?.assaultPiece?.summonPresets ?? []).filter((preset) => preset.tokenId === spec.tokenId), active: new Set() };
    record.deploymentInterval=spec.deploymentInterval??0;record.nextDeployAt=-Infinity;
    ledger.sources.set(key, record);
  } else {
    for (const name of ['tokenId','cost','duration','stats','def','kit','anySource','occupiesTile','deploymentInterval','placementScope','avoidGroundEnemy']) {
      // Each natural cast may rebuild the same numeric profile as a fresh object.
      // Its values define the source; changing a profile remains a real conflict.
      const same = name === 'stats' ? structurallyEqual(record[name], spec[name]) : record[name] === spec[name];
      if (spec[name] !== undefined && !same) throw new Error(`summon source ${key} conflicts on ${name}`);
    }
    record.fieldCap = Math.min(record.fieldCap, spec.fieldCap ?? record.fieldCap);
    record.stockCap = Math.min(record.stockCap, spec.stockCap ?? record.stockCap);
    if(Array.isArray(spec.preparedSlot))record.preparedSlot=[...spec.preparedSlot];
    if(spec.preparedOnly!==undefined)record.preparedOnly=spec.preparedOnly===true;
  }
  return record;
}

function activeCount(ledger) { return ledger.activeByKey.size; }

function spawnOne(battle, ledger, record, spec, cause) {
  if (ledger.closed || !active(ledger.owner)) return false;
  const { tokenId } = record;
  const stock = ledger.stock.get(tokenId) ?? 0;
  const preparedFree=spec.preparedFree===true;
  if ((!preparedFree&&stock<=0) || activeCount(ledger) >= (spec.fieldCap ?? ledger.capacity ?? record.fieldCap)) return false;
  if(!preparedFree&&battle.time+1e-9<record.nextDeployAt)return false;
  const tile = tiles(battle, ledger.owner, tokenId, record)[0];
  if (!tile) return false;
  const player = battle.getPlayer(ledger.owner.ownerId);
  const def = record.def ?? battle.tokenDef(tokenId, ledger.owner);
  const nativeCost=record.cost ?? record.stats?.cost ?? def?.stats?.cost ?? 0;
  const baseCost = preparedFree?0:nativeCost;
  // Pricing is a pure projection for a new token. Payment belongs exclusively
  // to native _deploy, whose actualPaid event drives every fee-dependent rule.
  const costPreview = { kind: 'token', side: 'ally', def, ownerUnit: ledger.owner, ownerId: ledger.owner.ownerId,
    base: { cost: baseCost }, mem: {}, tileR: tile[0], tileC: tile[1] };
  const cost = battle.assaultDeploymentCost(costPreview);
  if (!player || player.dp + 1e-9 < cost) return false;
  const kitKey = record.def?.assaultKey ?? record.def?.raw?.assaultKey ?? record.def?.id ?? tokenId;
  const registry = battle.opts?.assault?.kits;
  if (record.kit != null) {
    if (!registry || typeof registry !== 'object') throw new Error('assault kit registry is required for a derived summon');
    if (!Object.prototype.hasOwnProperty.call(registry, kitKey)) {
      registry[kitKey] = typeof record.kit === 'function' ? record.kit : () => record.kit;
    }
  }
  const token = battle.spawnToken(ledger.owner, tokenId, tile[0], tile[1], {
    ...(record.def ? { def: record.def } : null),
    occupiesTile: record.occupiesTile,
    ...(record.stats ? { stats: record.stats } : null), ...(record.duration ? { duration: record.duration } : null),
    anySource: record.anySource,
    assaultCost: baseCost,
    dir: record.preparedSlots?.find((preset) => preset.row === tile[0] && preset.col === tile[1])?.dir ?? ledger.owner.dir,
  });
  if (!token) {
    return false;
  }
  // A free first placement is a one-time payment waiver. Native reusable
  // pieces (sandbeast, shield, reconstruct) must retain their later price.
  if(preparedFree)token.base.cost=nativeCost;
  if(!preparedFree)ledger.stock.set(tokenId, stock - 1);
  record.nextDeployAt=battle.time+record.deploymentInterval;
  const entry = { key: record.key, ruleKey: record.ruleKey, tokenId, unit: token, uid: tokenUid(token), cause };
  ledger.activeByKey.set(entry.uid, entry);
  record.active.add(entry.uid);
  return true;
}

/** Native preplaced summon pieces deploy once for free without spending the
 * owner's held copies. Later replacements use stock, native cost and cadence. */
export function deployPreparedSummons(battle,owner,spec){
  if(!Number.isInteger(spec?.count)||spec.count<0||spec.preparedOnly!==true)throw new TypeError('prepared summons require an explicit nonnegative count and manual slots');
  const ledger=ledgerFor(battle,owner);ledger.capacity=Math.max(ledger.capacity,spec.fieldCap??0);
  const record=sourceRecord(ledger,spec),cause=battle.assaultRuntime.currentCause;
  let spawned=0;for(let i=0;i<spec.count;i++)if(spawnOne(battle,ledger,record,{...spec,preparedFree:true},cause))spawned++;
  return{spawned};
}

function retryPending(battle, ledger) {
  if (!active(ledger.owner) || ledger.closed) return;
  let tries = ledger.pending.length;
  while (tries-- > 0 && activeCount(ledger) < ledger.capacity) {
    const pending = ledger.pending.shift();
    if (!pending) break;
    if (!spawnOne(battle, ledger, pending.record, pending.spec, pending.cause)) ledger.pending.push(pending);
  }
}

export function grantSummon(battle, owner, spec) {
  if (!spec || typeof spec.tokenId !== 'string' || !spec.tokenId || !Number.isInteger(spec.count) || spec.count < 1
    || !Number.isInteger(spec.stockCap) || spec.stockCap < 0 || !Number.isInteger(spec.fieldCap) || spec.fieldCap < 0
    || !Number.isFinite(spec.cost ?? 0) || (spec.cost ?? 0) < 0 || (spec.occupiesTile != null && typeof spec.occupiesTile !== 'boolean')
    || (spec.replaceExisting != null && typeof spec.replaceExisting !== 'boolean')) throw new TypeError('summon grant requires tokenId, positive count and stock/field caps');
  const ledger = ledgerFor(battle, owner);
  ledger.capacity = Math.max(ledger.capacity, spec.fieldCap);
  if (spec.replaceExisting) {
    const key = sourceKey(spec);
    const pending = ledger.pending.filter(entry => entry.record.key === key);
    ledger.pending = ledger.pending.filter(entry => entry.record.key !== key);
    ledger.stock.set(spec.tokenId, Math.max(0, (ledger.stock.get(spec.tokenId) ?? 0) - pending.length));
    for (const entry of [...ledger.activeByKey.values()]) if (entry.key === key && entry.unit.alive)
      battle.retreat(entry.unit, { reason: 'assaultSummonReplacement', permanent: true });
    // Rebuild this source's cast snapshot after retiring its previous generation.
    ledger.sources.delete(key);
  }
  const record = sourceRecord(ledger, spec);
  const current = ledger.stock.get(spec.tokenId) ?? 0;
  const accepted = Math.min(spec.count, Math.max(0, record.stockCap - current));
  if (!accepted) return { granted: 0, spawned: 0, pending: 0, rejected: spec.count };
  ledger.stock.set(spec.tokenId, current + accepted);
  const cause = battle.assaultRuntime.currentCause;
  let spawned = 0;
  for (let i = 0; i < accepted; i++) {
    if (spawnOne(battle, ledger, record, spec, cause)) spawned++;
    else ledger.pending.push({ record, spec: { ...spec }, cause });
  }
  return { granted: accepted, spawned, pending: accepted - spawned, rejected: spec.count - accepted };
}

/** Deploy stock already returned to the owner, using only its chosen slots.
 * Reusing a summon never creates another copy or another pool. */
export function deployStoredSummons(battle, owner, spec) {
  if (!Number.isInteger(spec?.count) || spec.count < 1) throw new TypeError('stored summon request needs a positive count');
  const ledger = ledgerFor(battle, owner), record = sourceRecord(ledger, spec);
  const reserved = ledger.pending.filter(entry => entry.record.key === record.key).length;
  const requested = Math.min(spec.count, Math.max(0, (ledger.stock.get(spec.tokenId) ?? 0) - reserved));
  const cause = battle.assaultRuntime.currentCause;
  let spawned = 0;
  for (let i = 0; i < requested; i++) {
    if (spawnOne(battle, ledger, record, spec, cause)) spawned++;
    else ledger.pending.push({ record, spec: { ...spec }, cause });
  }
  return { requested, spawned, pending: requested - spawned };
}

export function returnSummon(battle, owner, token, reason = 'return', { cancelPending = false } = {}) {
  const ledger = ledgerFor(battle, owner);
  const entry = ledger.activeByKey.get(tokenUid(token));
  if (!entry || !token?.alive) return false;
  // An explicit recall withdraws this source's outstanding deployment orders;
  // the returned resource remains held until its next requested deployment.
  if (cancelPending) ledger.pending = ledger.pending.filter(p => p.record.key !== entry.key);
  ledger.activeByKey.delete(entry.uid);
  ledger.sources.get(entry.key)?.active.delete(entry.uid);
  const record = ledger.sources.get(entry.key);
  if (record) ledger.stock.set(entry.tokenId, Math.min(record.stockCap, (ledger.stock.get(entry.tokenId) ?? 0) + 1));
  battle.retreat(token, { reason, permanent: true });
  battle.assaultRuntime.publish('summonReturned', { source: owner, sourceUid: uid(owner), target: token, targetUid: uid(token), reason }, { sourceUid: uid(owner) });
  retryPending(battle, ledger);
  return true;
}

export function fuseSummons(battle, owner, first, second, { tokenId, derivedKey, kit, sourceTemplateId, capacity = 1, model = 'lingSoul', fusionScale = 1.8 } = {}) {
  if (!first?.alive || !second?.alive || first.ownerUnit !== owner || second.ownerUnit !== owner || first === second) throw new Error('fusion requires two living summons of the same owner');
  if (typeof tokenId !== 'string' || !tokenId || typeof derivedKey !== 'string' || !derivedKey || typeof kit !== 'object' || !sourceTemplateId) throw new Error('fusion requires exact derived token, source template, and kit');
  if (!Number.isFinite(fusionScale) || fusionScale <= 0) throw new RangeError('fusion scale must be positive and finite');
  const ledger = ledgerFor(battle, owner);
  const fusionId = `${derivedKey}:${uid(first)}:${uid(second)}`;
  if (ledger.fused.has(fusionId)) return null;
  const [r,c] = [first.tileR, first.tileC];
  const stats = {};
  for (const stat of ['maxHp','atk','def','res']) {
    const a = first.s?.[stat], b = second.s?.[stat];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`fusion source lacks scaled ${stat}`);
    stats[stat] = (a+b)*fusionScale;
  }
  if (!active(first) || !active(second)) throw new Error('fusion sources must be deployed');
  const def = battle.tokenDef(sourceTemplateId, owner);
  if (!def) throw new Error(`fusion source template ${sourceTemplateId} missing`);
  const assaultKey = `${derivedKey}@${uid(owner)}:${fusionId}`;
  const derivedDef = { ...def, id: tokenId, assaultKey, name: derivedKey,
    stats: { ...def.stats, ...stats }, rangeGrid: def.rangeGrid, skill: def.skill,
    raw: { ...(def.raw ?? {}), assaultKey } };
  const exactDef = normalizeToken(tokenId, derivedDef);
  const registry = battle.opts?.assault?.kits;
  if (!registry || typeof registry !== 'object') throw new Error('assault kit registry is required for fused summon');
  if (!Object.prototype.hasOwnProperty.call(registry, assaultKey)) registry[assaultKey] = typeof kit === 'function' ? kit : () => kit;
  const primaryEntry = ledger.activeByKey.get(tokenUid(first));
  const absorbedEntry = ledger.activeByKey.get(tokenUid(second));
  if (!primaryEntry || !absorbedEntry) throw new Error('fusion requires both source summons to be registered in their owner ledger');
  const hp = Math.min(stats.maxHp, (first.hp + second.hp) * fusionScale);
  ledger.activeByKey.delete(absorbedEntry.uid);
  ledger.sources.get(absorbedEntry.key)?.active.delete(absorbedEntry.uid);
  ledger.activeByKey.delete(primaryEntry.uid);
  ledger.sources.get(primaryEntry.key)?.active.delete(primaryEntry.uid);
  battle.offOwner(first);
  first.def = exactDef;
  first.defId = tokenId;
  first.name = derivedKey;
  // The source effective stats are already in the fusion snapshot. Bake their
  // four body-stat modifiers once while preserving statuses, shields, attack
  // speed and other functional effects on the retained body.
  const baked = new Set(['hpFlat', 'hpPct', 'hpMul', 'atkFlat', 'atkPct', 'atkFinal', 'atkMul', 'defFlat', 'defPct', 'defMul', 'resFlat', 'resMul']);
  for (const entry of first.buffs) if (entry.mods) entry.mods = Object.fromEntries(Object.entries(entry.mods).filter(([key]) => !baked.has(key)));
  if (first.cultMul) first.cultMul = { ...first.cultMul, hp: 1, atk: 1, def: 1 };
  Object.assign(first.base, stats);
  first.markDirty();
  // Finish native max-HP ratio recalculation before assigning the separately
  // snapshotted current HP; otherwise that HP is scaled a second time.
  void first.s;
  first.hp = hp;
  battle._setupUnit(first);
  battle.offOwner(second);
  battle.retreat(second, { reason: 'fusionAbsorbed', permanent: true });
  const spec = { tokenId, derivedKey, ruleKey: fusionId, count: 1, stockCap: 1, fieldCap: capacity, def: derivedDef, kit, anySource: true, stats };
  const record = sourceRecord(ledger, spec);
  const fusedEntry = { key: record.key, ruleKey: record.ruleKey, tokenId, unit: first, uid: tokenUid(first), cause: battle.assaultRuntime.currentCause };
  ledger.activeByKey.set(fusedEntry.uid, fusedEntry);
  record.active.add(fusedEntry.uid);
  ledger.fused.add(fusionId);
  battle.assaultRuntime.publish('summonAbsorbed', { source: first, sourceUid: uid(first), target: second, targetUid: uid(second), ownerUid: uid(owner), absorbedByUid: uid(first) }, { sourceUid: uid(first) });
  battle.assaultRuntime.publish('summonFused', { source: owner, sourceUid: uid(owner), target: first, targetUid: uid(first), firstUid: uid(first), secondUid: uid(second), model }, { sourceUid: uid(owner) });
  return first;
}

export function deriveWorkshopPlatform(battle, owner, { tokenId, derivedKey, kit, sourceTemplateId, relicId, moduleCap = 2 } = {}) {
  const ledger = ledgerFor(battle, owner);
  const same = [...ledger.activeByKey.values()].filter((entry) => entry.ruleKey?.startsWith(`workshop:${relicId}:`)).length;
  if (same >= moduleCap) return { granted: 0, reason: 'moduleCap' };
  const template = battle.tokenDef(sourceTemplateId, owner);
  if (!template) throw new Error(`workshop source template ${sourceTemplateId} missing`);
  const assaultKey = `${derivedKey}@${uid(owner)}:workshop:${relicId}:${same}`;
  const derivedDef = { ...template, id: tokenId, assaultKey, name: derivedKey, stats: { ...template.stats }, raw: { ...(template.raw ?? {}), assaultKey } };
  const maxHp = owner.s.maxHp * 0.75;
  const atk = owner.s.atk * 1.5;
  const stats = { ...derivedDef.stats, maxHp, atk, def: owner.s.def, res: owner.s.res, blockCnt: 0, bat: 2.5 };
  const result = grantSummon(battle, owner, { tokenId, derivedKey, ruleKey: `workshop:${relicId}:${same}`, count: 1, stockCap: moduleCap, fieldCap: moduleCap, cost: 0, stats, def: derivedDef, kit, anySource: true });
  return { ...result, stats, sourceTemplateId, relicId };
}
