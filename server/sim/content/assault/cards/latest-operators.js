import { makeKit, active, enemies, damage, buff, applyStatus } from '../primitives.js';
import { grantSummon, summonPlacementLegal } from '../summons.js';
import { COLS } from '../../../constants.js';
import { hypot, roundHalfEven } from '../../../detmath.js';
import { bodyKeys } from '../../../body.js';
import { installAssaultModule } from './assault-modules.js';
import { installAssaultBazaar, moduleParam } from './assault-bazaar.js';

const moduleId = u => u.def.raw.assaultPiece.moduleId ?? u.def.raw.assaultPiece.moduleChoices?.[u.def.charId] ?? null;
const moduleRank = u => moduleId(u) === `uniequip_002_${u.def.charId.split('_').at(-1)}` ? u.def.raw.assaultPiece.star : 0;
const ground = (b, u, opts = {}) => enemies(b, u, { ...opts, groundOnly: true });
const weight = e => e?.s?.massLevel ?? e?.massLevel ?? 0;

function toledoCells(b,u) {
  return [...(u.rangeKeys??[])].map(k=>[Math.floor(k/COLS),k%COLS])
    .filter(([row,col])=>summonPlacementLegal(b,u,'token_10067_toledo_tldptm',row,col,{occupiesTile:true}));
}
function toledoCast({ battle: b, unit: u, rank: r, cause }) {
  const token = 'token_10067_toledo_tldptm';
  const cells = toledoCells(b,u);
  if (!cells.length) return false;
  const [row, col] = cells[0];
  const receipt = grantSummon(b, u, { tokenId: token, count: 1, stockCap: 1, fieldCap: 1, occupiesTile: true,
    replaceExisting: true, ruleKey: 'toledo-s2', preparedSlot: [row, col], preparedOnly: true });
  if (!receipt.spawned) return false;
  const summon = b.allyUnits.find(t => t.kind === 'token' && t.ownerUnit === u && t.defId === token && active(t));
  if (!summon) return false;
  const nativeRange = summon.def?.raw?.sourceTemplate?.skill?.rangeGrid;
  if (!Array.isArray(nativeRange) || !nativeRange.length) throw new TypeError('Toledo token is missing its native skill radius');
  const radiusKeys = new Set(nativeRange.map(([dr, dc]) => (summon.tileR + dr) * COLS + summon.tileC + dc));
  const values=u.def.raw.assaultBody.fixedSkill.effects[0].values;
  const duration = values.summonDuration, tremble = values.trembleDuration[r-1];
  buff(b,u,summon,{key:`toledo:${u.uid}:guard-snapshot`,mods:{atkMul:values.summonAtkMultiplier[r-1]},duration:Infinity,cause});
  for (const e of b.enemies.filter(e => active(e) && bodyKeys(e).some(key => radiusKeys.has(key)))) {
    applyStatus(b, u, e, { status: 'tremble', duration: tremble, key: `toledo:${u.uid}:tremble`, cause });
  }
  b.after(duration, () => { if (summon.alive) b.retreat(summon, { reason: 'toledoDuration', permanent: true }); }, { owner: u });
  return true;
}

function toledoInstall(b, u) {
  b.every(.2, () => {
    if (!active(u)) return;
    const star = u.def.raw.assaultPiece.star;
    const talent = moduleRank(u) >= 3 ? [0, 0, .18, .19][star - 1] : [.08, .12, .16, .16][star - 1];
    for (const e of b.enemies) {
      const key = `latest:toledo:${u.uid}:fragile`;
      if (!active(e) || !e.blockedBy || !bodyKeys(e).some(bodyKey => u.rangeKeys?.includes(bodyKey))) { b.removeBuff(e, key); continue; }
      buff(b, u, e, { key, mods: { dmgTakenMul: 1 + talent }, duration: .25, stacking: 'replace' });
    }
  }, { owner: u });
  // 大巴扎：贵族义务删去精英在场时每秒技力。
}
const installLatestModule = (battle, unit) => installAssaultModule({ battle, unit, body: unit.def.raw.assaultBody,
  piece: unit.def.raw.assaultPiece, rank: unit.def.raw.assaultPiece.star });
const toledo = (battle, raw, def) => makeKit(def, { cast: toledoCast, install: (b, u) => { installLatestModule(b, u); toledoInstall(b, u); installAssaultBazaar(b, u, u.def.raw.assaultBody); },
  canCast: ({ battle, unit }) => ground(battle, unit, { count: 1 }).length > 0 && toledoCells(battle,unit).length>0 });

function hboundCast({ battle: b, unit: u, rank: r }) {
  const target = ground(b, u, { count: 99 }).sort((a, c) => weight(c) - weight(a))[0];
  if (!target) return false;
  const field = { uid: `hbound:${u.uid}:${b.time}`, source: u, x: target.x, y: target.y,
    until: b.time + [32, 33, 34, 35][r - 1], duration: [32, 33, 34, 35][r - 1],
    scale: [.17, .18, .19, .20][r - 1], heavy: [1.5, 1.6, 1.7, 1.8][r - 1] };
  (u.mem.latestHboundFields ??= new Map()).set(field.uid, field);
  return true;
}

function hboundInstall(b, u) {
  b.on('hit', ({ source, dmg }) => {
    if (source?.side !== 'enemy' || !active(source) || !dmg || !['phys', 'arts'].includes(dmg.type) || source.isFlying) return;
    const inField = [...(u.mem.latestHboundFields?.values() ?? [])].some(f => f.until > b.time
      && hypot(source.x - f.x, source.y - f.y) <= 2);
    if (!inField) return;
    // 大巴扎：命中降低只来自模组「看不见的大海」（-x% 命中，地面敌人不分重量）；基础天赋的落空已删去。
    const module = moduleRank(u) >= 3 ? moduleParam(u, 'uniequip_002_hbound', 'x', 0) / 100 : 0;
    if (module > 0 && b.rng() < module) dmg.cancel = true;
  }, { owner: u });
  b.every(1, () => {
    if (!active(u)) { u.mem.latestHboundFields?.clear(); return; }
    for (const [id, f] of u.mem.latestHboundFields ?? []) if (f.until <= b.time) u.mem.latestHboundFields.delete(id);
    const enemies = b.enemies.filter(e => active(e) && !e.isFlying), byTarget = new Map();
    for (const e of enemies) {
      const f = [...(u.mem.latestHboundFields?.values() ?? [])].filter(f => hypot(e.x - f.x, e.y - f.y) <= 2)
        .sort((a, c) => (c.scale + c.heavy * (weight(e) >= 3 ? 1 : 0)) - (a.scale + a.heavy * (weight(e) >= 3 ? 1 : 0)))[0];
      if (f) byTarget.set(e, f);
    }
    for (const [e, f] of byTarget) {
      const heavy = weight(e) >= 3;
      damage(b, u, e, { scale: f.scale + (heavy ? f.heavy : 0), type: 'arts', sourceKey: `hbound:${u.uid}:${Math.floor(b.time)}` });
      // 大巴扎：删去重型敌人减速（卡面没有）。
    }
  }, { owner: u });
  if (false && moduleRank(u) >= 3) b.every(1, () => { // 大巴扎：删去模组每秒为炼金干员充能（卡面没有）
    if (!active(u)) return;
    const recipients = new Set();
    for (const x of b.allyUnits) {
      if (!active(x)) continue;
      const owner = x.kind === 'token' || x.kind === 'device' ? x.ownerUnit : x;
      const body = owner?.def?.raw?.assaultBody;
      const ownerId = body?.charId ?? owner?.def?.charId;
      const nativeAlchemy = owner === u || body?.subProfessionId === 'alchemist' || owner?.def?.subProfessionId === 'alchemist';
      const registeredAlchemyOwner = ['char_1039_thorn2', 'char_4151_tinman'].includes(ownerId);
      if (!nativeAlchemy && !registeredAlchemyOwner) continue;
      const recipient = owner;
      if (active(recipient) && recipient.skill) recipients.add(recipient);
    }
    for (const recipient of recipients) recipient.skill.gainSp?.(.1, 'hbound-alchemy-module', true);
  }, { owner: u });
}
const hbound = (battle, raw, def) => makeKit(def, { cast: hboundCast, install: (b, u) => { installLatestModule(b, u); hboundInstall(b, u); installAssaultBazaar(b, u, u.def.raw.assaultBody); },
  canCast: ({ battle, unit }) => ground(battle, unit, { count: 1 }).length > 0 });

const CLEMENT_RANGE_3_2 = [[0, 0], [0, 1], [0, 2], [0, 3]];
function restoreClementiaAttack(b, u) {
  if (!u.mem.latestClemAttackProfile) return;
  u.profile.maxTargets = u.mem.latestClemAttackProfile.maxTargets;
  u.profile.groundOnly = u.mem.latestClemAttackProfile.groundOnly;
  u.rangeGrid = u.mem.latestClemAttackProfile.rangeGrid;
  u.mem.latestClemAttackProfile = null;
  b.refreshRange(u);
}
function clementiaCast({ battle: b, unit: u, cause }) {
  const target = ground(b, u, { count: 1 })[0];
  if (!target) return false;
  const body = u.def.raw.assaultBody;
  const parameters = body.fixedSkill.effects?.[0]?.values ?? {}, star = u.def.raw.assaultPiece.star - 1;
  const scale = Number(Array.isArray(parameters.atkScale) ? parameters.atkScale[star] : parameters.atkScale ?? [2.25, 2.5, 2.65, 2.9][star]);
  const erosionRatio = Number(Array.isArray(parameters.erosionDamageRatio) ? parameters.erosionDamageRatio[star] : parameters.erosionDamageRatio ?? [0.3, 0.3, 0.35, 0.35][star]);
  const dealt = damage(b, u, target, { scale, type: 'phys', isSkill: true, cause, sourceKey: 'clem-s1-physical' });
  if (dealt > 0 && erosionRatio > 0) b.assaultRuntime.withCause(cause, () => b.dealDamage(u, target, {
    amount: dealt * erosionRatio, type: 'element', element: 'erosion', isSkill: true, sourceKey: 'clem-s1-erosion',
  }));
  return dealt > 0;
}
function clementiaInstall(b, u) {
  const initialDef = new WeakMap();
  const remember = e => { if (e && !initialDef.has(e)) initialDef.set(e, e.base?.def ?? e.def?.stats?.def ?? 0); };
  b.on('hit', ({ source, target, dmg }) => {
    if (target === u && source?.side === 'enemy' && dmg && ['phys', 'arts'].includes(dmg.type)) {
      const dr = source.y ?? source.tileR, dc = source.x ?? source.tileC, ur = u.y ?? u.tileR, uc = u.x ?? u.tileC;
      const [fr, fc] = u.dir === 'RIGHT' ? [0, 1] : u.dir === 'LEFT' ? [0, -1] : u.dir === 'UP' ? [-1, 0] : [1, 0];
      if ((dr - ur) * fr + (dc - uc) * fc > 0) {
        dmg.mul *= 1 - .3; // 大巴扎：此干员受到前方的伤害 -30%（删去对海怪 -50% 分支）
      }
    }
    if (false && source === u && target?.side === 'enemy' && dmg?.type === 'phys') { // 大巴扎：删去随机增伤（卡面没有）
      remember(target);
      const low = (target.s?.def ?? Infinity) < initialDef.get(target);
      if (b.rng.chance(low ? .5 : .25)) dmg.amount *= [1.2, 1.2, 1.35, 1.35][u.def.raw.assaultPiece.star - 1];
    }
  }, { owner: u });
  if (false) b.on('damaged', ({ source, target, amount, type, dmg }) => { // 大巴扎：侵蚀只来自技能（第一行），删去普攻附带侵蚀
    if (source !== u || target?.side !== 'enemy' || type !== 'phys' || !dmg?.isAttack || dmg.isSkill) return;
    if (amount > 0) b.dealDamage(u, target, { amount: amount * .2, type: 'element', element: 'erosion', attackId: dmg.attackId, tags: ['talent', 'clem-erosion'] });
  }, { owner: u });
}
const clementia = (battle, raw, def) => makeKit(def, { cast: clementiaCast, install: (b, u) => { clementiaInstall(b, u); installAssaultBazaar(b, u, u.def.raw.assaultBody); },
  canCast: ({ battle, unit }) => ground(battle, unit, { count: 1 }).length > 0 });

export const latestOperatorKits = Object.freeze({ char_393_toledo: toledo, char_4232_hbound: hbound, char_4231_clemnt: clementia });
