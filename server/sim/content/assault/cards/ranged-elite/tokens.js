import { active, allies, enemies, damage, heal, buff, applyStatus, onTimer as scheduleTimer, uid } from '../../primitives.js';
import { grantSummon } from '../../summons.js';
import { bodyDist } from '../../../../body.js';

const TOKEN_IDS = Object.freeze([
  'token_10012_rosmon_shield', 'token_10035_wisdel_wward', 'token_10034_ray_sndbst',
  'token_10015_dusk_drgn', 'token_10017_skadi2_dedant', 'token_10020_ling_soul3',
  'token_10020_ling_soul1', 'token_10020_ling_soul2', 'token_10027_ironmn_pile1',
  'token_10027_ironmn_pile2', 'token_10027_ironmn_pile3',
]);

// These source summons have a real ordinary attack cadence.  The remaining
// tokens are support entities: Ray's sandbeast is explicitly no-attack in its
// source kit, Wisadel's shadow says it does not perform normal attacks, Skadi's
// seaborn is an aura carrier in this mode, and Whiteiron's devices are noncombat.
// Keep the policy explicit because this kit replaces the native token kit.
const ATTACKING_TOKEN_IDS = new Set([
  'token_10012_rosmon_shield', // native token record: melee, physical, atk 82
  'token_10015_dusk_drgn', // native token record: melee arts, atk 398
  'token_10020_ling_soul1', 'token_10020_ling_soul2', 'token_10020_ling_soul3',
]);

function onTimer(battle, unit, seconds, handler, options = {}) {
  if (active(unit)) return scheduleTimer(battle, unit, seconds, handler, options);
  let scheduled = null;
  let armed = true;
  const deferred = { cancel() { armed = false; scheduled?.(); } };
  battle.on('deploy', ({ unit: deployed }) => {
    if (!armed || deployed !== unit) return;
    scheduled = scheduleTimer(battle, unit, seconds, handler, options);
  });
  return deferred;
}

function ownerOf(unit) {
  const owner = unit?.ownerUnit;
  if (!owner || !uid(owner)) throw new TypeError(`assault token ${unit?.tokenId ?? 'unknown'} has no ownerUnit`);
  return owner;
}

function around(battle, unit) {
  return enemies(battle, unit, { scope: 'adjacent8', count: 99 });
}

function installRosmon(battle, unit) {
  const owner = ownerOf(unit);
  const key = `assault:token:rosmon:${uid(unit)}`;
  for (const target of around(battle, unit)) applyStatus(battle, unit, target, { status: 'stun', duration: owner.mem?.rosmonStunDuration ?? 2.5, key });
  battle.every(0.25, () => {
    if (!active(unit) || !active(owner)) return;
    for (const target of unit.blocking ?? []) if (active(target)) {
      buff(battle, unit, target, { key: `${key}:def`, mods: { defFlat: -(owner.mem?.rosmonDefDown ?? 160) }, duration: 0.3, stacking: 'replace' });
    }
  }, { owner: unit });
}

function installWisdel(battle, unit) {
  const owner = ownerOf(unit);
  const key = `assault:token:wisdel:${uid(unit)}`;
  onTimer(battle, unit, 0.25, () => {
    if (!active(owner)) return;
    const inAura = Math.max(Math.abs(unit.tileR - owner.tileR), Math.abs(unit.tileC - owner.tileC)) <= 1;
    const entry = owner.mem?.wisdelCamouflage;
    if (inAura && !entry) {
      owner.mem.wisdelCamouflage = buff(battle, unit, owner, { key, mods: {}, flags: { camou: true }, duration: 0.4, stacking: 'replace' });
    } else if (!inAura && entry) {
      battle.removeBuff(owner, key);
      owner.mem.wisdelCamouflage = null;
    }
  }, { every: true, immediate: true });
}

function installRay(battle, unit) {
  const owner = ownerOf(unit);
  const key = `assault:token:ray:${uid(unit)}`;
  onTimer(battle, unit, 0.25, () => {
    if (!active(owner)) return;
    for (const target of enemies(battle, unit, { scope: 'range', count: 99 })) {
      applyStatus(battle, unit, target, { status: 'reveal', duration: 0.4, key: `${key}:reveal:${uid(target)}` });
      buff(battle, unit, target, { key: `${key}:scout:${uid(target)}`, mods: { dmgTakenMul: 1 + (owner.mem?.rayDamageScale ?? 0.12) }, duration: 0.4, stacking: 'replace' });
    }
  }, { every: true, immediate: true });
}

function installDusk(battle, unit) {
  const owner = ownerOf(unit);
  const key = `assault:token:dusk:${uid(unit)}`;
  const applyOwnerModule = () => {
    const bonus = Number(owner.mem?.duskTokenAtk ?? 0);
    if (bonus > 0) buff(battle, owner, unit, { key: `${key}:attack`, mods: { atkMul: 1 + bonus }, duration: Infinity, stacking: 'replace', persist: true });
    else battle.removeBuff(unit, `${key}:attack`);
  };
  applyOwnerModule();
  battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) applyOwnerModule(); }, { owner: unit });
  battle.on('death', ({ unit: victim }) => {
    if (victim !== unit || !active(owner) || !owner.mem?.duskModuleDeathBurst) return;
    for (const target of enemies(battle, unit, { scope: 'adjacent8', count: 99 })) {
      damage(battle, owner, target, { scale: owner.mem.duskModuleDeathBurst, type: 'arts', sourceKey: `${key}:burst` });
    }
  }, { owner: unit, priority: 20 });
}

function installSkadi(battle, unit) {
  const owner = ownerOf(unit);
  const key = `assault:token:skadi2:${uid(unit)}`;
  onTimer(battle, unit, 0.5, () => {
    if (!active(owner)) return;
    for (const ally of allies(battle, unit, { scope: 'range', count: 99 })) {
      buff(battle, unit, ally, { key: `${key}:resist:${uid(ally)}`, mods: { dmgTakenMul: 0.5 }, duration: 0.6, stacking: 'replace' });
      if (ally.hp < ally.s.maxHp) heal(battle, unit, ally, { amount: unit.s.atk * 0.8 });
    }
    if (owner.mem?.skadiSeabornModule) for (const target of enemies(battle, unit, { scope: 'range', count: 99 })) {
      buff(battle, unit, target, { key: `${key}:module:${uid(target)}`, mods: { dmgTakenMul: 1.1 }, duration: 0.6, stacking: 'replace' });
    }
  }, { every: true, immediate: true });
}

function installLing(battle, unit) {
  const owner = ownerOf(unit);
  const key = `assault:token:ling:${uid(unit)}`;
  battle.on('attack', (event) => {
    const ctx = event.payload ?? event;
    if (ctx.attacker !== unit || !active(owner)) return;
    for (const target of ctx.targets ?? []) if (active(target)) {
      damage(battle, owner, target, { scale: unit.mem?.lingAttackScale ?? 0.2, type: 'arts', sourceKey: `${key}:attack` });
    }
  }, { owner: unit });
  if (unit.defId === 'lingLargeDragon') onTimer(battle, unit, 0.5, () => {
    if (!active(owner) || !active(unit)) return;
    for (const target of enemies(battle, unit, { scope: 'range', count: 99 })) {
      damage(battle, owner, target, { scale: owner.mem?.lingLargeAoeScale ?? 0.2, type: 'arts', sourceKey: `${key}:aoe` });
    }
  }, { every: true, immediate: true });
}

function installIronmn(battle, unit) {
  const owner = ownerOf(unit);
  const key = `assault:token:ironmn:${uid(unit)}`;
  if (unit.defId === 'token_10027_ironmn_pile2') {
    onTimer(battle, unit, owner.mem?.ironmnSpInterval ?? 3.5, () => {
      if (!active(owner) || !active(unit)) return;
      const candidates = allies(battle, unit, { scope: 'adjacent8', count: 99, selection: 'uid' })
        .filter((ally) => ally.skill && ally.skill.sp < ally.skill.spCost)
        .sort((a, b) => (b.skill.spCost - b.skill.sp) - (a.skill.spCost - a.skill.sp) || uid(a).localeCompare(uid(b)));
      const target = candidates[0] ?? owner;
      if (target.skill && target.skill.sp < target.skill.spCost) target.skill.gainSp(1, 'ironmnDevice');
      const loss = unit.s.maxHp * (owner.mem?.ironmnHpDrainRatio ?? 0.02);
      if (loss > 0) battle.dealDamage(owner, unit, { amount: loss, type: 'true', sourceClass: 'assaultDeviceDrain' });
    }, { every: true });
  }
  battle.on('death', ({ unit: victim }) => {
    if (victim !== unit || !active(owner) || !(owner.mem?.ironmnRecycleChance > 0)
      || bodyDist(victim, owner.x, owner.y) > 1
      || battle.rng() >= owner.mem.ironmnRecycleChance) return;
    const recycled = grantSummon(battle, owner, { tokenId: unit.defId, count: 1, stockCap: owner.mem.ironmnStockCap ?? 3, fieldCap: owner.mem.ironmnFieldCap ?? 2, ruleKey: owner.mem.ironmnRuleKey });
    if (recycled.granted > 0 && owner.mem.ironmnRecycleSp > 0) owner.skill?.gainSp(owner.mem.ironmnRecycleSp, 'ironmnRecycle');
  }, { owner: unit, priority: 20 });
}

function buildToken(tokenId) {
  // Tokens are runtime entities, not operator cards.  Their normalized defs intentionally
  // have no compiled assaultPiece/assaultBody; constructing an operator kit here would
  // fabricate an owner loadout and makes real spawnToken() fail.  Keep the token skill
  // explicitly passive and install only the token's typed owner-aware behavior.
  return () => {
    const install = (battle, unit) => {
      ownerOf(unit);
      switch (tokenId) {
        case 'token_10012_rosmon_shield': installRosmon(battle, unit); break;
        case 'token_10035_wisdel_wward': installWisdel(battle, unit); break;
        case 'token_10034_ray_sndbst': installRay(battle, unit); break;
        case 'token_10015_dusk_drgn': installDusk(battle, unit); break;
        case 'token_10017_skadi2_dedant': installSkadi(battle, unit); break;
        case 'token_10020_ling_soul3':
        case 'token_10020_ling_soul1':
        case 'token_10020_ling_soul2': installLing(battle, unit); break;
        case 'token_10027_ironmn_pile1':
        case 'token_10027_ironmn_pile2':
        case 'token_10027_ironmn_pile3': installIronmn(battle, unit); break;
        default: throw new TypeError(`unhandled ranged-elite token ${tokenId}`);
      }
    };
    return {
      trait: { noAttack: !ATTACKING_TOKEN_IDS.has(tokenId) },
      skill: {
        id: tokenId,
        kind: 'passive',
        spCost: 0,
        initSp: 0,
        trigger: 'NEVER',
        spType: 'none',
        assaultCast: () => false,
      },
      install,
    };
  };
}

export const rangedEliteTokenKits = Object.freeze(Object.fromEntries(TOKEN_IDS.map((id) => [id, buildToken(id)])));
export { TOKEN_IDS };
