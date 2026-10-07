import { EQUIPMENT_CAPACITY, equipmentRecord, pieceEquipmentCount } from './equipment.js';
import { canPlace } from '../../match/board.js';
import { attachmentAccepted as acceptsAttachment, inheritanceQualification, nativeFactions, nativeBodyStats } from '../../../shared/independentRules.js';
import { getIndependentField } from './battle.js';

const own = (o, k) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k);
const get = (o, k, d = null) => own(o, k) ? o[k] : d;
const operator = (catalog, id) => get(catalog?.operators, id);

function canTransferAttachment(def, receiver, catalog) {
  return !!def?.inheritable && acceptsAttachment(def, receiver, catalog);
}

export function previewInheritance(state, catalog, donorUid, receiverUid, data = null) {
  const donor = state.pieces.find((x) => x.uid === donorUid); const receiver = state.pieces.find((x) => x.uid === receiverUid);
  if (!donor || !receiver || donor === receiver) return { ok: false, error: 'BAD_TARGET' };
  const qualification = inheritanceQualification(donor, receiver, catalog);
  if (!qualification.allowed) return { ok: false, error: 'NO_PERMISSION' };
  if (donor.row === null || donor.col === null) return { ok: false, error: 'BAD_TILE' };
  const receiverOp = operator(catalog, receiver.chessId);
  if (!receiverOp) return { ok: false, error: 'BAD_TARGET' };
  const fieldMap = data ? getIndependentField(state, { data, catalog }).deployMap : null;
  const cls = String(receiverOp.position || receiverOp.source?.normalChess?.position || '').toUpperCase() === 'MELEE' ? 'melee' : 'all';
  if (fieldMap && !canPlace(fieldMap, cls, donor.row, donor.col)) return { ok: false, error: 'BAD_TILE' };
  const donorGear = (donor.equipment || []).filter((x) => equipmentRecord(catalog, x.id)?.inheritable !== false);
  const receiverGear = receiver.equipment || [];
  const conflicts = [];
  for (const incoming of donorGear) {
    const def = equipmentRecord(catalog, incoming.id);
    const uniqueKey = def?.uniqueKey || def?.canonicalId || incoming.id;
    const existing = receiverGear.find((x) => { const d = equipmentRecord(catalog, x.id); return (d?.uniqueKey || d?.canonicalId || x.id) === uniqueKey; });
    if (def?.unique && existing) conflicts.push({ id: incoming.id, donorUid: incoming.uid, receiverUid: existing.uid });
  }
  const gear = donorGear.filter((x) => !conflicts.some((c) => c.donorUid === x.uid));
  const donorAttachments = (donor.attachments || []).filter((x) => canTransferAttachment(catalog.attachments?.[x.id], receiver, catalog));
  const attachConflicts = donorAttachments.filter((x) => catalog.attachments?.[x.id]?.unique && receiver.attachments.some((y) => y.id === x.id)).map((x) => ({ id: x.id }));
  const receiverUnique = new Set(receiver.attachments.filter((x) => catalog.attachments?.[x.id]?.unique).map((x) => x.id));
  const transferAttachments = donorAttachments.filter((x) => !attachConflicts.some((c) => c.id === x.id) && (!receiverUnique.has(x.id) || !catalog.attachments?.[x.id]?.unique));
  const incoming = donorGear.reduce((n, x) => n + x.quantity, 0);
  if (pieceEquipmentCount(receiver) + incoming > EQUIPMENT_CAPACITY + conflicts.reduce((n, c) => n + (receiverGear.find((x) => x.uid === c.receiverUid)?.quantity || 0), 0)) return { ok: false, error: 'CAPACITY' };
  return { ok: true, donorUid, receiverUid, donorChessId: donor.chessId, receiverChessId: receiver.chessId,
    // Either body's 交接凭证 allows both directions; give/receive identify which body wears it.
    permit: { give: qualification.give?.id || null, receive: qualification.receive?.id || null },
    oldBody: { chessId: donor.chessId, position: { row: donor.row, col: donor.col }, nativeTrait: operator(catalog, donor.chessId)?.nativeTrait?.text }, newBody: { chessId: receiver.chessId, nativeTrait: receiverOp.nativeTrait?.text }, transferredEquipment: gear.map((x) => ({ ...x })), equipmentConflicts: conflicts,
    transferredAttachments: transferAttachments.map((x) => ({ ...x })), attachmentConflicts: attachConflicts,
    destroyedEquipment: (donor.equipment || []).filter((x) => !donorGear.includes(x)).map((x) => ({ ...x })),
    destroyedAttachments: (donor.attachments || []).filter((x) => !donorAttachments.includes(x)).map((x) => ({ ...x })),
    penalty: receiver.bodyPenaltyApplied ? 0 : catalog.config?.bodyPenalty?.baseAttackRatio ?? 0.8,
    oldBodyStats: nativeBodyStats(donor, catalog), newBodyStats: nativeBodyStats(receiver, catalog), donorNativeFactions: nativeFactions(donor, catalog), receiverNativeFactions: nativeFactions(receiver, catalog) };
}

export function applyInheritance(state, catalog, donorUid, receiverUid, uniqueSelections = {}, data = null) {
  const preview = previewInheritance(state, catalog, donorUid, receiverUid, data);
  if (!preview.ok) throw new Error(preview.error);
  for (const c of preview.equipmentConflicts) if (!['donor', 'receiver'].includes(uniqueSelections[c.id])) throw new Error('NEEDS_SELECTION');
  for (const c of preview.attachmentConflicts) if (!['donor', 'receiver'].includes(uniqueSelections[`attachment:${c.id}`])) throw new Error('NEEDS_SELECTION');
  const donor = state.pieces.find((x) => x.uid === donorUid); const receiver = state.pieces.find((x) => x.uid === receiverUid);
  const allowed = (donor.equipment || []).filter((x) => equipmentRecord(catalog, x.id)?.inheritable !== false);
  for (const item of allowed) {
    const def = equipmentRecord(catalog, item.id); const uniqueKey = def?.uniqueKey || def?.canonicalId || item.id;
    const existing = receiver.equipment.find((x) => { const d = equipmentRecord(catalog, x.id); return d?.unique && (d.uniqueKey || d.canonicalId || x.id) === uniqueKey; });
    if (existing) {
      if (uniqueSelections[item.id] === 'donor') receiver.equipment.splice(receiver.equipment.indexOf(existing), 1);
      else continue;
    }
    if (!receiver.equipment.some((x) => x.uid === item.uid)) receiver.equipment.push(item);
  }
  const passAttachments = [];
  for (const item of donor.attachments || []) {
    const def = catalog.attachments?.[item.id]; if (!canTransferAttachment(def, receiver, catalog)) continue;
    const existing = receiver.attachments.find((x) => x.id === item.id && def.unique);
    if (existing) {
      if (uniqueSelections[`attachment:${item.id}`] === 'donor') receiver.attachments.splice(receiver.attachments.indexOf(existing), 1);
      else continue;
    }
    passAttachments.push(item);
  }
  receiver.attachments.push(...passAttachments);
  donor.equipment = []; donor.attachments = [];
  state.pieces = state.pieces.filter((x) => x !== donor);
  const pool = state.pool[String(donor.chessId).replace(/_b$/, '_a')]; if (pool) pool.left = Math.min(pool.cap, pool.left + (donor.poolCopies || 1));
  if (!receiver.bodyPenaltyApplied) { receiver.bodyPenaltyApplied = true; receiver.bodyPenalty = structuredClone(catalog.config?.bodyPenalty || { baseAttackRatio: 0.8, baseLifeRatio: 0.8 }); }
  receiver.row = donor.row; receiver.col = donor.col;
  return { preview, receiver };
}
