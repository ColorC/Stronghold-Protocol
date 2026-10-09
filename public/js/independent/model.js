// 卫戍协议：工坊 page model: pure functions from the session view (server/modes/independent/session.js viewSession,
// thinned by http.js packet) to what the original renderer and the HUD need. No DOM, no fetch — test/independent/
// page-model.test.js runs them in Node. The rules stay on the server: legal tiles, forecasts and prices come from it.
import { INVENTORY_STACK_LIMIT, inventoryStackGroups } from '../../../shared/independentInventory.js';

/** Basic equipment reuses the native bond glyphs (public/assets/bond). */
export const BADGE_BOND = Object.freeze({
  precision: 'preciShip', agility: 'skillfulShip', damage: 'raidShip', vitality: 'steadShip', defense: 'deputShip', assault: 'raidShip',
  recovery: 'swiftShip', arcane: 'arcaneShip', foresight: 'visiShip', miracle: 'miraShip', investor: 'investShip',
  unyielding: 'indomShip', harmony: 'maniShip', coordination: 'emptyShip', solitary: 'soloShip', mastery: 'suntShip',
});

export const HAND_SLOTS = 10;
export const TEMP_SLOTS = 5;

/** Renderer piece uids are integers (render/app.js); session uids are 'p12' / 'i7'. */
export const pieceNum = (uid) => Number(String(uid).replace(/^\D+/, ''));

export const isDeployed = (p) => p.row !== null && p.row !== undefined && p.col !== null && p.col !== undefined;

/** The catalog entry of a piece's current form: an elite reads its own entry (summary counts live there). */
export function formEntry(catalog, piece) {
  const base = catalog?.operators?.[piece.chessId];
  if (!base) return null;
  return piece.elite && base.eliteChessId ? catalog.operators[base.eliteChessId] || base : base;
}

/** The chess id the renderer draws (data/chess.json): the golden id for an elite. */
export const renderChessId = (catalog, piece) => (piece.elite ? catalog?.operators?.[piece.chessId]?.eliteChessId || piece.chessId : piece.chessId);

/**
 * Bench order: pieces not on the board, in the session's order (stable across actions). The bench (整备区, 10 places
 * since 2026-10-07, session.js BENCH_SIZE) is the renderer's hand row; operators that overflowed into the 临时整备区
 * (`temp`, 5 places) sit on its temp row and keep the battle from starting, as in the original. A save from before the
 * cap may hold more: those are listed by the HUD (`overflow`).
 */
export function benchLayout(state) {
  const off = (state?.pieces || []).filter((p) => !isDeployed(p));
  const bench = off.filter((p) => !p.temp); const temp = off.filter((p) => p.temp);
  return { hand: bench.slice(0, HAND_SLOTS), temp: temp.slice(0, TEMP_SLOTS), overflow: [...bench.slice(HAND_SLOTS), ...temp.slice(TEMP_SLOTS)] };
}

/**
 * The renderer's private prep state (render/app.js setPrep: hand / temp / board pieces with integer uids). Equipment is
 * not drawn as item pips (those are the original two-slot items): the HUD draws the equipment level instead.
 */
export function prepView(state, catalog) {
  const toPiece = (p) => ({ uid: pieceNum(p.uid), kind: 'chess', id: renderChessId(catalog, p), golden: !!p.elite,
    tier: catalog?.operators?.[p.chessId]?.tier ?? 1, items: [], ...(isDeployed(p) ? { row: p.row, col: p.col, dir: p.dir || 'RIGHT' } : {}) });
  const { hand, temp } = benchLayout(state);
  const pad = (list, n) => Array.from({ length: n }, (_, i) => (list[i] ? toPiece(list[i]) : null));
  return {
    hand: pad(hand, HAND_SLOTS),
    temp: pad(temp, TEMP_SLOTS),
    board: (state?.pieces || []).filter(isDeployed).map(toPiece),
    nextEnemies: Array.isArray(state?.nextEnemies) ? state.nextEnemies : [],
  };
}

/**
 * The mode's tier of every operator form (the display catalog: base and elite ids), which can differ from the
 * upstream chess record's `tier` (the mode's own roster). Drawn wherever a tier shows on this page.
 */
export function catalogTiers(catalog) {
  const tiers = new Map();
  for (const [id, op] of Object.entries(catalog?.operators || {})) if (Number.isInteger(op?.tier)) tiers.set(id, op.tier);
  for (const op of Object.values(catalog?.operators || {})) if (op?.eliteChessId && !tiers.has(op.eliteChessId) && Number.isInteger(op.tier)) tiers.set(op.eliteChessId, op.tier);
  return tiers;
}

/**
 * A battle replay whose operators carry the mode's tier: the simulation's unit info (server/sim/snapshot.js unitInfo)
 * takes the upstream chess record's, both in the field's unit list and in every spawn event. Enemies, summons and
 * anything not in the catalog keep theirs.
 */
export function withCatalogTiers(replay, catalog) {
  const tiers = catalogTiers(catalog);
  if (!replay || !tiers.size) return replay;
  const fix = (u) => (u && tiers.has(u.defId) && u.tier !== tiers.get(u.defId) ? { ...u, tier: tiers.get(u.defId) } : u);
  const spawnFix = (e) => (Array.isArray(e) && e[0] === 'spawn' ? [e[0], fix(e[1]), ...e.slice(2)] : e);
  return {
    ...replay,
    ...(replay.field ? { field: { ...replay.field, units: Array.isArray(replay.field.units) ? replay.field.units.map(fix) : replay.field.units } } : {}),
    frames: Array.isArray(replay.frames) ? replay.frames.map((f) => (Array.isArray(f?.ev) && f.ev.some((e) => e?.[0] === 'spawn') ? { ...f, ev: f.ev.map(spawnFix) } : f)) : replay.frames,
  };
}

/** Session piece for a renderer uid. */
export const pieceByNum = (state, n) => (state?.pieces || []).find((p) => pieceNum(p.uid) === n) || null;

/**
 * Whether the renderer may drop piece `n` on `target` (render/drag.js canPlace): a board tile from the server's
 * legalTiles that no other piece holds, or a bench slot for a deployed piece. The server still decides.
 */
export function canDrop(state, n, target) {
  const piece = pieceByNum(state, n);
  if (!piece || state?.phase !== 'prep' || !target) return false;
  if (target.area === 'hand') return isDeployed(piece) || !!piece.temp; // a 临时整备区 operator may go back to the bench
  if (target.area !== 'board') return false;
  if (!(piece.legalTiles || []).includes(`${target.row},${target.col}`)) return false;
  const holder = (state.pieces || []).find((p) => isDeployed(p) && p.row === target.row && p.col === target.col);
  return !holder || holder.uid === piece.uid;
}

/** Tiles to light while piece `n` is dragged. */
export function legalTilesOf(state, n) {
  const piece = pieceByNum(state, n);
  if (!piece) return [];
  return (piece.legalTiles || []).map((cell) => cell.split(',').map(Number))
    .filter(([r, c]) => !(state.pieces || []).some((p) => p.uid !== piece.uid && isDeployed(p) && p.row === r && p.col === c));
}

const gearRecord = (catalog, id) => catalog?.gear?.[id] || null;
const isBadge = (catalog, id) => !!BADGE_BOND[id] || gearRecord(catalog, id)?.kind === 'badge';
/** The 交接凭证 a piece wears (gear kind 'permit'), as gear ids. */
export const permitsOf = (piece, catalog) => (piece?.equipment || []).filter((x) => gearRecord(catalog, x.id)?.kind === 'permit').map((x) => x.id);

/**
 * Equipment worn by a piece, grouped for display: functional equipment one row per item (they carry the mechanisms),
 * then badges merged per kind ("精准 ×12"). Each row: { id, name, level, count, badge, permit, uids }. Gear has one
 * form only (owner 2026-10-07 「装备不再有精锐形态」): one level, one text.
 */
export function groupEquipment(items, catalog) {
  const rows = new Map();
  for (const item of items || []) {
    const id = item.id; const badge = isBadge(catalog, id);
    const key = badge ? `b:${id}` : `e:${item.uid}`;
    const rec = gearRecord(catalog, id) || item.record || {};
    const row = rows.get(key) || { id, name: rec.name || id, level: rec.level, count: 0, badge, permit: rec.kind === 'permit', uids: [] };
    row.count += Number(item.quantity || 1); row.uids.push(item.uid);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => (a.badge - b.badge) || (b.level ?? 0) - (a.level ?? 0) || b.count - a.count);
}

/** Kinds of inventory items that are used (补给, 玩家设施) rather than worn; a prize kept in the inventory too. */
export const USED_KINDS = new Set(['补给', '玩家设施', '奖品']);

/**
 * Inventory stacks for the strip: badge kinds (count summed) then the other items; the uid to equip from. A prize
 * kept for later (追加采购预算) is in the inventory under its prize id and reads its name from the prizes.
 */
export function inventoryStacks(inventory, catalog) {
  const stacks = new Map();
  for (const group of inventoryStackGroups(inventory || [])) {
    const item = group.items[0];
    const key = `${item.id}:n${Object.keys(item.state || {}).length ? `:${encodeURIComponent(group.key)}` : ''}`;
    const prize = !gearRecord(catalog, item.id) && catalog?.prizes?.[item.id];
    const rec = gearRecord(catalog, item.id) || (prize ? { name: prize.name, kind: '奖品', mechanism: prize.mechanism, normal: prize.effect } : {});
    const s = stacks.get(key) || { key, id: item.id, name: rec.name || '未知物品', level: rec.level,
      kind: rec.kind || null, mechanism: rec.mechanism || null, text: rec.normal, used: USED_KINDS.has(rec.kind),
      badge: isBadge(catalog, item.id), count: 0, items: [] };
    s.count += group.quantity; s.items.push(...group.items);
    stacks.set(key, s);
  }
  // A cell is a same-name stack. Preserve real UIDs when a stack fills 999.
  return [...stacks.values()].sort((a, b) => (b.badge - a.badge) || b.count - a.count).flatMap((s) => {
    const cells = []; let cell = null;
    for (const item of s.items) {
      let left = Number(item.quantity || 1);
      while (left > 0) {
        if (!cell || cell.count === INVENTORY_STACK_LIMIT) {
          cell = { ...s, key: cells.length ? `${s.key}:${cells.length}` : s.key, count: 0, items: [] };
          cells.push(cell);
        }
        const quantity = Math.min(left, INVENTORY_STACK_LIMIT - cell.count);
        cell.items.push({ ...item, quantity }); cell.count += quantity; left -= quantity;
      }
    }
    return cells;
  });
}

/** Total pieces in the inventory (each badge counts once per copy). */
export const inventoryCount = (inventory) => (inventory || []).reduce((n, x) => n + Number(x.quantity || 1), 0);

/**
 * Production ledger rows grouped for the HUD: { phase, sourceUid, origin, prizeId, id, quantity } summed per
 * (phase, source, item). `rows` = state.production or forecast.production.
 */
export function groupProduction(rows) {
  const out = new Map();
  for (const r of rows || []) {
    // gear that found the stock full (equipment.js grantEquipment `lost`) is its own row
    // badges put straight onto an operator (worn: 翻倍 / 转交) stay their own row, per target
    const key = `${r.phase}|${r.sourceUid || r.prizeId || r.origin || ''}|${r.id}|${r.lost ? 'lost' : ''}|${r.worn ? r.targetUid : ''}`;
    const g = out.get(key) || { phase: r.phase, origin: r.origin || null, sourceUid: r.sourceUid || null, prizeId: r.prizeId || null, id: r.id, quantity: 0, copied: false, lost: !!r.lost, ...(r.worn ? { worn: true, targetUid: r.targetUid } : {}) };
    g.quantity += Number(r.quantity || 0); g.copied ||= !!r.copied;
    out.set(key, g);
  }
  return [...out.values()];
}

/** The prep-end forecast grouped by source, plus pieces whose prep-end trait yields nothing right now. */
export function forecastRows(state, catalog) {
  const rows = groupProduction(state?.forecast?.production || []);
  const producing = new Set(rows.map((r) => r.sourceUid));
  const idle = (state?.pieces || []).filter((p) => !producing.has(p.uid)
    && (formEntry(catalog, p)?.summary || []).some((s) => s.when === 'prepEnd' && (s.kind === 'forge' || s.kind === 'funds' || s.kind === 'copy')));
  return { rows, idle, funds: Number(state?.forecast?.pendingFunds || 0) };
}

/** Equipment level an item stack contributes (design: 装备总等级 = 每件等级之和). */
export function itemLevel(item, catalog) {
  const g = catalog?.gear?.[item.id] || {};
  return Number(g.level ?? 1) * Number(item.quantity || 1);
}

/**
 * The receiver's equipment level after an inheritance (preview + the unique choices made so far): its own level plus
 * the donor's transferable gear, minus the side dropped in every unique conflict. Null while a conflict is open.
 */
export function inheritedLevel(receiver, donor, preview, picks, catalog) {
  if (!receiver || !donor || !preview?.ok) return null;
  const destroyed = new Set((preview.destroyedEquipment || []).map((x) => x.uid));
  let level = Number(receiver.equipmentLevel || 0);
  for (const item of donor.equipment || []) if (!destroyed.has(item.uid)) level += itemLevel(item, catalog);
  for (const c of preview.equipmentConflicts || preview.conflicts || []) {
    const keep = picks?.[c.id];
    if (!keep) return null;
    const dropped = keep === 'donor' ? (receiver.equipment || []).find((x) => x.uid === c.receiverUid) : (donor.equipment || []).find((x) => x.uid === c.donorUid);
    if (dropped) level -= itemLevel(dropped, catalog);
  }
  return level;
}

/** A summary entry's count for a piece form (formEntry already picked the entry). */
export const summaryCount = (pair, elite) => (pair ? pair[elite ? 'elite' : 'normal'] : null);

/** The offer the page must resolve first (an operator merge before prizes and recruits), or null. */
export function pendingOffer(state) {
  const offers = state?.offers || [];
  return offers.find((o) => o.type === 'operatorMerge') || offers.find((o) => o.type === 'prize') || offers[0] || null;
}

/** Replay frames → { t0, duration } and the index of the last frame at or before game time `t`. */
export function replayClock(replay) {
  const frames = replay?.frames || [];
  const t0 = frames.length ? frames[0].snap.t : 0;
  const duration = frames.length ? frames[frames.length - 1].snap.t - t0 : 0;
  return { t0, duration };
}
export function frameAt(frames, t) {
  let lo = 0, hi = frames.length - 1, k = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (frames[mid].snap.t <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  return k;
}
