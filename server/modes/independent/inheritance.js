import { equipmentRecord, pieceEquipmentCount } from './equipment.js';
import { canPlace } from '../../match/board.js';

const own = (o, k) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k);
const get = (o, k, d = null) => own(o, k) ? o[k] : d;
const operator = (catalog, id) => get(catalog?.operators, id);
const permissionFor = (catalog, chessId) => {
  const op = operator(catalog, chessId);
  if (op?.inheritance) return op.inheritance;
  return op?.name && own(catalog?.permissions, op.name) ? catalog.permissions[op.name] : null;
};

function factionNames(subjectOp, data) {
  return (subjectOp?.source?.normalChess?.bonds || []).map((id) => data?.bonds?.[id]?.name || id);
}

const professionNames = { TANK: '重装', MEDIC: '医疗', WARRIOR: '近卫', SNIPER: '狙击', CASTER: '术师', SUPPORT: '辅助', PIONEER: '先锋', SPECIAL: '特种' };
function satisfies(permission, subject, subjectOp, prefix, data) {
  if (!permission || !subject || !subjectOp) return false;
  const tiers = permission[`${prefix}Tiers`];
  const tier = Number(subjectOp.tier ?? subjectOp.techLevel);
  if (!Number.isFinite(tier) || (Array.isArray(tiers) && !tiers.includes(tier))) return false;
  const native = subjectOp.source?.normalChess || {};
  if (permission[`${prefix}Faction`] && !factionNames(subjectOp, data).includes(permission[`${prefix}Faction`])) return false;
  const profession = professionNames[String(native.profession || subjectOp.profession || '').toUpperCase()] || native.profession || subjectOp.profession;
  const required = professionNames[String(permission[`${prefix}Profession`] || '').toUpperCase()] || permission[`${prefix}Profession`];
  if (required && profession !== required) return false;
  return true;
}

function qualifies(catalog, donor, receiver, data) {
  const give = permissionFor(catalog, donor.chessId);
  const receive = permissionFor(catalog, receiver.chessId);
  const direction = (p) => String(p?.direction || '');
  const donorSide = give && direction(give).includes('给予') && satisfies(give, receiver, operator(catalog, receiver.chessId), 'receiver', data);
  const receiverSide = receive && direction(receive).includes('接收') && satisfies(receive, donor, operator(catalog, donor.chessId), 'donor', data);
  return !!(donorSide || receiverSide);
}

function canTransferAttachment(def, receiver) {
  if (!def || def.inheritable === false) return false;
  const cond = def.condition;
  if (!cond || ['any', 'all', 'all operators', '无条件'].includes(String(cond).toLowerCase())) return true;
  if (typeof def.accepts === 'function') return !!def.accepts(receiver);
  const rule = def.params?.filter || {};
  const op = receiver?.chessId;
  if (rule.selectedAmmoSkill) return /ammo|弹药/i.test(String(receiver.skillId || '')) || /ammo|弹药/i.test(String(receiver.skill || ''));
  if (rule.nativeOnly && rule.status === 'frozen') {
    const source = receiver.source?.normalChess || {};
    return [...(source.skills || []), ...(source.talents || [])].some((x) => /freeze|冻结/i.test(JSON.stringify(x)));
  }
  if (String(def.condition).includes('medic')) return (receiver.profession || receiver.source?.normalChess?.profession) === 'MEDIC';
  return false;
}

export function previewInheritance(state, catalog, donorUid, receiverUid, data = null) {
  const donor = state.pieces.find((x) => x.uid === donorUid); const receiver = state.pieces.find((x) => x.uid === receiverUid);
  if (!donor || !receiver || donor === receiver) return { ok: false, error: 'BAD_TARGET' };
  if (!qualifies(catalog, donor, receiver, data)) return { ok: false, error: 'NO_PERMISSION' };
  if (donor.row === null || donor.col === null) return { ok: false, error: 'BAD_TILE' };
  const receiverOp = operator(catalog, receiver.chessId);
  if (!receiverOp) return { ok: false, error: 'BAD_TARGET' };
  const fieldMap = state.deployMap;
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
  const donorAttachments = (donor.attachments || []).filter((x) => canTransferAttachment(catalog.attachments?.[x.id], receiver));
  const attachConflicts = donorAttachments.filter((x) => catalog.attachments?.[x.id]?.unique && receiver.attachments.some((y) => y.id === x.id)).map((x) => ({ id: x.id }));
  const receiverUnique = new Set(receiver.attachments.filter((x) => catalog.attachments?.[x.id]?.unique).map((x) => x.id));
  const transferAttachments = donorAttachments.filter((x) => !attachConflicts.some((c) => c.id === x.id) && (!receiverUnique.has(x.id) || !catalog.attachments?.[x.id]?.unique));
  const incoming = donorGear.reduce((n, x) => n + x.quantity, 0);
  if (pieceEquipmentCount(receiver) + incoming > 99 + conflicts.reduce((n, c) => n + (receiverGear.find((x) => x.uid === c.receiverUid)?.quantity || 0), 0)) return { ok: false, error: 'CAPACITY' };
  return { ok: true, donorUid, receiverUid, donorChessId: donor.chessId, receiverChessId: receiver.chessId,
    permission: 'donor-or-receiver', oldBody: { chessId: donor.chessId, position: { row: donor.row, col: donor.col }, nativeTrait: operator(catalog, donor.chessId)?.nativeTrait?.text, inheritance: permissionFor(catalog, donor.chessId) }, newBody: { chessId: receiver.chessId, nativeTrait: receiverOp.nativeTrait?.text, inheritance: permissionFor(catalog, receiver.chessId) }, transferredEquipment: gear.map((x) => ({ ...x })), equipmentConflicts: conflicts,
    transferredAttachments: transferAttachments.map((x) => ({ ...x })), attachmentConflicts: attachConflicts,
    destroyedEquipment: (donor.equipment || []).filter((x) => !donorGear.includes(x)).map((x) => ({ ...x })),
    destroyedAttachments: (donor.attachments || []).filter((x) => !donorAttachments.includes(x)).map((x) => ({ ...x })),
    penalty: receiver.bodyPenaltyApplied ? 0 : (catalog.config?.bodyPenalty?.baseAttackRatio ?? 0.8) };
}

export function applyInheritance(state, catalog, donorUid, receiverUid, uniqueSelections = {}, data = null) {
  const preview = previewInheritance(state, catalog, donorUid, receiverUid, data);
  if (!preview.ok) throw new Error(preview.error);
  for (const c of preview.equipmentConflicts) if (!['donor', 'receiver'].includes(uniqueSelections[c.id])) throw new Error('NEEDS_SELECTION');
  for (const c of preview.attachmentConflicts) if (!['donor', 'receiver'].includes(uniqueSelections[`attachment:${c.id}`])) throw new Error('NEEDS_SELECTION');
  const donor = state.pieces.find((x) => x.uid === donorUid); const receiver = state.pieces.find((x) => x.uid === receiverUid);
  const donorPermission = permissionFor(catalog, donor.chessId); const receiverPermission = permissionFor(catalog, receiver.chessId);
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
    const def = catalog.attachments?.[item.id]; if (!canTransferAttachment(def, receiver)) continue;
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
  return { preview, donorPermission, receiverPermission, receiver };
}
