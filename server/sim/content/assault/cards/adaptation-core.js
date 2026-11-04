import { adaptedKit } from '../adapted-kit.js';
import { countedTrigger, battleState, actualDamageLink, linkDamagePotential } from '../adaptation-primitives.js';
import { active, allies, enemies, buff, damage, heal, applyStatus, sp, gainDP, uid } from '../primitives.js';
import { hasStatus, matchesClass, cutRedeploy, redeployNow, shortenRedeploy, redeployRemaining, withinAdjacent4, enemyAura, allyAura } from '../synergy.js';
import { assaultAmmoState } from '../ammo.js';
import { grantSummon, returnSummon, deployStoredSummons, ledgerFor } from '../summons.js';
import { rotateOffset } from '../../../dir.js';
import { COLS } from '../../../constants.js';
import { runGrowthPoints } from '../../../../../shared/assault/growth-policy.js';

const planOf = unit => unit.def.raw.assaultBody.adaptation;
const valuesOf = unit => {
  const body = unit.def.raw.assaultBody, piece = unit.def.raw.assaultPiece, plan = body.adaptation;
  const growth=runGrowthPoints(piece)/100;
  const values=body.charId==='char_311_mudrok'?{...plan.values,heal:(Math.round(plan.values.heal*100)+growth*100)/100}:plan.values;
  if (piece.star < 3) return values;
  const selected = piece.moduleChoices?.[body.charId] ?? piece.moduleId;
  const id = plan.moduleAliases?.[selected] ?? selected;
  const patch = body.modulePlans.find(m => m.id === id)?.adaptationUpgrade;
  return patch ? { ...values, [patch.key]: patch.value } : values;
};
const yours = (unit, other) => other?.kind === 'op' && other.ownerId === unit.ownerId && other.side === 'ally';
const ops = (battle, unit) => battle.allyUnits.filter(other => yours(unit, other) && active(other));
const tagged = (unit, label) => matchesClass(unit, { label });
const owned = (battle, unit) => battle.allyUnits.filter(other => other.kind === 'token' && other.ownerUnit === unit && active(other));
function anchor(unit, actor = unit) {
  const keys = planOf(unit).rangeGrid.map(([r, c]) => rotateOffset(r, c, actor.dir))
    .map(([r, c]) => (actor.tileR + r) * COLS + actor.tileC + c);
  return { tileR: actor.tileR, tileC: actor.tileC, x: actor.x, y: actor.y, dir: actor.dir,
    profile: planOf(unit).canHitFly ? {...actor.profile,canHitFly:true} : actor.profile, s: actor.s, side: actor.side, ownerId: actor.ownerId,
    rangeKeys: keys, rangeKeySet: new Set(keys) };
}
const targets = (battle, unit, actor = unit, count = planOf(unit).targetCount, groundOnly = false) => enemies(battle, actor,
  { scope: 'range', anchor: anchor(unit, actor), count, groundOnly });
const canAttack = ({ battle, unit }) => targets(battle, unit).length > 0;
const sourceKey = (unit, key) => `adaptation:${uid(unit)}:${key}`;
function onDeploy(battle, unit, key, effect) {
  battle.assaultRuntime.observe('deployed', sourceKey(unit, key), event => {
    if (event.payload.target === unit && active(unit)) effect(event);
  }, { owner: unit });
}
function link(battle, unit, type, key, accept, effect, options = {}) {
  const take = countedTrigger(battle, { key: sourceKey(unit, key), owner: unit, ...options }, effect);
  battle.assaultRuntime.observe(type, sourceKey(unit, `watch:${key}`), event => {
    if (accept(event.payload)) take({ payload: event.payload, cause: event.cause, target: event.payload.target });
  }, { owner: unit });
  return take;
}
function selfBuff(battle, unit, key, mods) {
  onDeploy(battle, unit, key, () => buff(battle, unit, unit, { key: sourceKey(unit, key), mods, duration: Infinity, persist: true }));
}
const reveal = (battle, unit) => enemyAura(battle, unit, { key: 'native-reveal', flags: { reveal: true },
  select: enemy => targets(battle, unit, unit, 999).includes(enemy) });

function edgeStrike(battle, owner, actor) {
  const v = valuesOf(owner), selected = targets(battle, owner, actor);
  if (actor !== owner) battle.fx('skillEcho', { id: actor.id, x: actor.x, y: actor.y,
    nativeUnit: owner.def.charId, skillId: planOf(owner).sourceSkillId, targets: selected.map(e => e.id) });
  for (const target of selected) {
    damage(battle, actor, target, { scale: v.scale, type: 'phys', isSkill: true });
    if (target.alive) {
      applyStatus(battle, actor, target, { status: 'cold', duration: v.cold });
      buff(battle, actor, target, { key: sourceKey(owner, 'edge-reveal'), mods: {}, flags: { reveal: true }, duration: v.cold });
    }
  }
}
function edgeDiscount(battle, unit) {
  const area = battle.assaultDeploymentArea(unit.ownerId), marker = area.findIndex(entry => entry.kind === 'deployAnchor' && entry.ownerUid === unit.uid);
  if (marker < 0) return 0;
  const candidates = area.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === 'operator');
  const preferred = candidates.filter(({ entry, index }) => index > marker && ['WARRIOR', 'CASTER', 'SNIPER'].includes(entry.unit.def.profession));
  const chosen = (preferred.length ? preferred : candidates).sort((a, b) => Math.abs(a.index - marker) - Math.abs(b.index - marker) || b.index - a.index)[0]?.entry.unit;
  if (!chosen) return;
  chosen.mem.assaultCostDelta = Math.max(-chosen.base.cost, (chosen.mem.assaultCostDelta ?? 0) - valuesOf(unit).costReduce);
}
const svash2 = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => canAttack({ battle, unit }) || battle.allyUnits.some(other => yours(unit, other) && other !== unit
    && !other.removed && (unit.mem.svash2Echoes?.[uid(other)] ?? 0) < valuesOf(unit).echoes),
  cast: ({ battle, unit }) => {
    edgeStrike(battle, unit, unit);
    edgeDiscount(battle, unit);
    const reserves = unit.mem.svash2Echoes ??= {};
    for (const other of battle.allyUnits) if (yours(unit, other) && other !== unit && !other.removed)
      reserves[uid(other)] = Math.min(valuesOf(unit).echoes, (reserves[uid(other)] ?? 0) + 1);
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'redeploy', 'opening', p => yours(unit, p.source) && p.source !== unit,
    () => sp(battle, unit, unit, valuesOf(unit).charge, 'opening', 'opening')),
  innate: (battle, unit) => {
    battle.assaultRuntime.observe('deployed', sourceKey(unit, 'echo'), ({ payload, cause }) => {
      const other = payload.target;
      if (!yours(unit, other) || other === unit) return;
      const n = unit.mem.svash2Echoes?.[uid(other)] ?? 0;
      if (!n) return;
      unit.mem.svash2Echoes[uid(other)] = 0;
      for (let i = 0; i < n; i++) battle.after(1.1 + i * .5, () => {
        if (active(other)) battle.assaultRuntime.withCause(cause, () => edgeStrike(battle, unit, other));
      }, { owner: other });
    }, { owner: unit });
    battle.on('beforeStatus', ctx => {
      if (ctx.status === 'freeze' && active(unit) && yours(unit, ctx.target) && tagged(ctx.target, '谢拉格')) ctx.cancel = true;
    }, { owner: unit });
    // Native pioneer aura retains both stages; it is independent of the one
    // talent-derived SP link and never turns into combat/run growth.
    battle.every(.25, () => {
      if (!active(unit)) return;
      const factor = battle.time - unit.deployedAt >= 15 ? 2 : 1;
      for (const other of ops(battle, unit).filter(x => tagged(x, '谢拉格')))
        buff(battle, unit, other, { key: sourceKey(unit, 'pioneer'), mods: { defFlat: 60 * factor, hpRegenRatio: .015 * factor }, duration: .51 });
    }, { owner: unit });
  },
});

const silverash = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    for (const target of targets(battle, unit)) damage(battle, unit, target, { scale: valuesOf(unit).scale, type: 'phys', isSkill: true });
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'skillResolved', 'leader', p => p.source === unit,
    () => cutRedeploy(battle, unit, { seconds: valuesOf(unit).cut, includeSelf: false })),
  innate: (battle, unit) => { reveal(battle, unit); selfBuff(battle, unit, 'leader-atk', { atkPct: .1 }); },
});

const slbell = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  // 自然震慑: original S2 strips defence and resistance from every enemy in range.
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit);
    for (const target of targets(battle, unit)) battle.addBuff(target, { key: sourceKey(unit, 'awe'), status: 'defDown',
      mods: { defMul: 1 - v.def, resMul: 1 - v.res }, duration: v.awe, source: unit });
    return true;
  },
  // 虚弱化: enemies below the threshold in her range are fragile; the link is credited when it newly takes hold.
  link: (battle, unit) => {
    const credited = countedTrigger(battle, { key: sourceKey(unit, 'weaken'), owner: unit }, () => true);
    battle.every(.25, () => { if (active(unit)) for (const target of targets(battle, unit)) {
      if (target.hp >= target.s.maxHp * valuesOf(unit).threshold) continue;
      const value = valuesOf(unit).fragile;
      const previous = target.buffs.find(b => b.status === 'fragile' && b.source === unit);
      const changed = !previous || Math.abs((previous.mods?.dmgTakenMul ?? 1) - (1 + value)) > 1e-9;
      if (applyStatus(battle, unit, target, { status: 'fragile', value, duration: .51 }) && changed) credited({ target });
    } }, { owner: unit });
  },
  // 双响: two targets per attack.
  innate: (_battle, unit) => { unit.profile.maxTargets = 2; },
});

const gnosis = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => { unit.mem.adaptGnosisCharged = unit.skill.charges >= 2; return canAttack({ battle, unit }); },
  cast: ({ battle, unit }) => {
    for (const target of targets(battle, unit)) {
      damage(battle, unit, target, { scale: valuesOf(unit).scale, type: 'arts', isSkill: true });
      if (!target.alive) continue;
      applyStatus(battle, unit, target, { status: 'cold', duration: valuesOf(unit).cold });
      if (unit.mem.adaptGnosisCharged) applyStatus(battle, unit, target, { status: 'cold', duration: valuesOf(unit).cold });
    }
    return true;
  },
  link: (battle, unit) => {
    const credited = countedTrigger(battle, { key: sourceKey(unit, 'ice-benefit'), owner: unit }, () => true);
    battle.every(.25, () => { if (active(unit)) for (const target of targets(battle, unit)) {
      const multiplier = hasStatus(target, 'frozen') ? 2 : hasStatus(target, 'cold') ? 1 : 0;
      if (!multiplier) continue;
      const value = valuesOf(unit).fragile * multiplier;
      const previous = target.buffs.find(b => b.status === 'fragile' && b.source === unit);
      const changed = !previous || Math.abs((previous.mods?.dmgTakenMul ?? 1) - (1 + value)) > 1e-9;
      if (applyStatus(battle, unit, target, { status: 'fragile', value, duration: .51 }) && changed) credited({ target });
    } }, { owner: unit });
  },
  innate: (battle, unit) => {
    battle.on('attack', ({ attacker, targets: hit }) => {
      if (attacker === unit) for (const target of hit) if (target.alive) applyStatus(battle, unit, target, { status: 'cold', duration: 1 });
    }, { owner: unit });
    battle.every(.25, () => { if (active(unit) && battle.time - unit.deployedAt >= 10)
      for (const other of ops(battle, unit).filter(x => tagged(x, '谢拉格'))) applyStatus(battle, unit, other, { status: 'resist', duration: .51 });
    }, { owner: unit });
  },
});

const blkkgt = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => targets(battle, unit, unit, 6, true).length > 0,
  cast: ({ battle, unit }) => {
    for (const target of targets(battle, unit, unit, 6, true)) {
      damage(battle, unit, target, { scale: valuesOf(unit).scale, hits: target.blockedBy ? 3 : 2, type: 'phys', isSkill: true });
      if (target.alive) applyStatus(battle, unit, target, { status: 'tremble', duration: valuesOf(unit).tremble });
    }
    return true;
  },
  link: (battle, unit) => {
    const credited = actualDamageLink(battle,unit,sourceKey(unit,'legend-benefit'));
    battle.on('hit', ({ source, target, dmg }) => {
      if (!active(unit) || !yours(unit, source) || !hasStatus(target, 'tremble') || (dmg.defIgnorePct ?? 0) >= valuesOf(unit).ignore) return;
      const before=linkDamagePotential(source,target,dmg);dmg.defIgnorePct = valuesOf(unit).ignore;
      if(linkDamagePotential(source,target,dmg)>before+1e-9)credited(dmg,()=>dmg.defIgnorePct===valuesOf(unit).ignore);
    }, { owner: unit, priority: 70 });
  },
  innate: (battle, unit) => battle.on('hit', ({ source, target, dmg }) => {
    if (source !== unit || target?.side !== 'enemy' || battle.rng() >= .1) return;
    dmg.mul *= 1.6;
    applyStatus(battle, unit, target, { status: 'tremble', duration: 5 });
  }, { owner: unit }),
});

const siege = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    for (const target of targets(battle, unit)) damage(battle, unit, target, { scale: valuesOf(unit).scale, type: 'phys', isSkill: true });
    gainDP(battle, unit, valuesOf(unit).dp, 'vault'); return true;
  },
  link: (battle, unit) => link(battle, unit, 'death', 'crush', p => p.target?.side === 'enemy' && p.reason === 'killed' && withinAdjacent4(unit, p.target),
    () => sp(battle, unit, unit, valuesOf(unit).charge, 'crush', 'crush')),
  innate: (battle, unit) => allyAura(battle, unit, { key: 'beast-king', select: other => other.def.profession === 'PIONEER',
    mods: { atkPct: valuesOf(unit).aura, defPct: valuesOf(unit).aura } }),
});

const angel = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    const [target] = targets(battle, unit);
    damage(battle, unit, target, { scale: valuesOf(unit).scale, hits: valuesOf(unit).hits, type: 'phys', isSkill: true }); return true;
  },
  link: (battle, unit) => link(battle, unit, 'deployed', 'bless', p => p.target === unit, ({payload}) => {
    const bless=()=>{
      if(!active(unit))return false;
      const pool = ops(battle, unit).filter(other => other !== unit), target = pool.length ? pool[Math.floor(battle.rng() * pool.length)] : null;
      if (!target) return false;
      return !!buff(battle, unit, target, { key: sourceKey(unit, 'bless'), mods: { atkPct: valuesOf(unit).atk, hpPct: valuesOf(unit).hp }, duration: Infinity, persist: true });
    };
    if(payload.initial){battle.after(0,bless,{owner:unit});return true;}return bless();
  }),
  innate: (battle, unit) => selfBuff(battle, unit, 'magazine', { aspd: 12, atkPct: valuesOf(unit).atk, hpPct: valuesOf(unit).hp }),
});

const demkni = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => allies(battle, unit, { anchor: anchor(unit), count: 999 }).some(other => other.hp < other.s.maxHp),
  cast: ({ battle, unit }) => {
    for (const target of allies(battle, unit, { anchor: anchor(unit), count: 999 })) heal(battle, unit, target, { scale: valuesOf(unit).scale }); return true;
  },
  link: (battle, unit) => {
    const perTarget = new Map();
    battle.assaultRuntime.observe('heal', sourceKey(unit, 'spirit'), event => {
      const target = event.payload.target;
      if (event.payload.source !== unit || !yours(unit, target)) return;
      if (!perTarget.has(target)) perTarget.set(target, countedTrigger(battle, { key: sourceKey(unit, `spirit:${uid(target)}`), owner: unit },
        () => sp(battle, unit, target, valuesOf(unit).charge, 'spirit', 'spirit')));
      perTarget.get(target)({ cause: event.cause, target });
    }, { owner: unit });
  },
  innate: (battle, unit) => battle.on('tick', ({ dt }) => {
    if (!active(unit) || (unit.mem.adaptRhineStacks ?? 0) >= 5) return;
    unit.mem.adaptRhineTime = (unit.mem.adaptRhineTime ?? 0) + dt;
    if (unit.mem.adaptRhineTime + 1e-9 < 20) return;
    unit.mem.adaptRhineTime -= 20;
    const stacks = unit.mem.adaptRhineStacks = (unit.mem.adaptRhineStacks ?? 0) + 1;
    buff(battle, unit, unit, { key: sourceKey(unit, 'rhine-suit'), mods: { atkPct: stacks * .05, defPct: stacks * .04 }, duration: Infinity, persist: true });
  }, { owner: unit }),
});

const surtr = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  state: ({ battle, unit }) => ({ mods: { atkPct: valuesOf(unit).atk, hpFlat: valuesOf(unit).hp, rangeExtend: valuesOf(unit).range, maxTargets: valuesOf(unit).targets },
    enter: () => { heal(battle, unit, unit, { amount: unit.s.maxHp, ignoreHealFree: true }); unit.mem.adaptDuskAt = battle.time; },
    repeat: () => heal(battle, unit, unit, { amount: unit.s.maxHp, ignoreHealFree: true }) }),
  link: (battle, unit) => {
    const credited = countedTrigger(battle, { key: sourceKey(unit, 'ember-benefit'), owner: unit }, () => true);
    battle.on('fatal', ctx => {
    if (ctx.unit !== unit || !active(unit)) return;
    ctx.prevented = true;
    if (unit.mem.adaptEmber) return;
    unit.mem.adaptEmber = true;
    credited({ target: unit });
    battle.after(valuesOf(unit).ember, () => {
      unit.mem.adaptEmber = false;
      if (active(unit)) redeployNow(battle, unit, unit);
    }, { owner: unit });
    }, { owner: unit, priority: 30 });
  },
  innate: (battle, unit) => {
    selfBuff(battle, unit, 'molten', { resIgnoreFlat: 20 });
    battle.every(.2, () => {
      if (!active(unit) || unit.mem.adaptDuskAt == null || unit.mem.adaptEmber) return;
      const rate = .2 * Math.min(1, (battle.time - unit.mem.adaptDuskAt) / 60);
      if (rate > 0) battle.loseHp(unit, unit.s.maxHp * rate * .2, { source: unit, tags: ['assaultSurtrDusk'] });
    }, { owner: unit });
  },
});

const skadi = (_bb, _raw, def) => adaptedKit(def, {
  // §8 explicitly preserves this native thirty-second deployment passive.
  cast: ({ battle, unit }) => buff(battle, unit, unit, { key: sourceKey(unit, 'wave'), mods: { atkPct: valuesOf(unit).atk }, duration: valuesOf(unit).duration }),
  link: (battle, unit) => {
    shortenRedeploy(battle, unit, unit, { seconds: valuesOf(unit).redeploy });
    link(battle, unit, 'redeploy', 'swift-benefit', p => p.source === unit, () => true);
  },
  innate: (battle, unit) => allyAura(battle, unit, { key: 'abyssal', select: other => tagged(other, '深海猎人'), mods: { atkPct: valuesOf(unit).aura } }),
});

const DELIVERY = 'token_10056_angel2_target';
const delivery = unit => (unit.def.raw.assaultPiece.summonPresets ?? []).find(p => p?.tokenId === DELIVERY);
const landingCandidate = (battle, unit, point) => !point ? null : battle.allyUnits.filter(other => yours(unit, other)
  && other !== unit && !other.removed && other.def.position === 'MELEE' && redeployRemaining(battle, other) > 0
  && battle.grid.canStand(point.row, point.col, { ranged: false })
  && !battle.allyUnits.some(occupant => occupant !== other && active(occupant) && occupant.tileR === point.row && occupant.tileC === point.col))
  .sort((a, b) => redeployRemaining(battle, b) - redeployRemaining(battle, a) || uid(a).localeCompare(uid(b)))[0];
const angel2 = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => canAttack({ battle, unit }) && !!delivery(unit),
  cast: ({ battle, unit }) => {
    const point = delivery(unit), candidate = landingCandidate(battle, unit, point), v = valuesOf(unit);
    if (candidate) {
      let deployed = false;
      if (active(candidate)) {
        if (battle.relocate(candidate, point.row, point.col)) deployed = redeployNow(battle, unit, candidate);
      } else deployed = battle.redeploy(candidate, { free: true, tile: [point.row, point.col], keepSp: true });
      if (deployed) {
        sp(battle, unit, candidate, v.charge, 'delivery', 'delivery');
        for (const target of battle.enemies.filter(e => active(e) && Math.max(Math.abs(e.y - point.row), Math.abs(e.x - point.col)) <= 1))
          damage(battle, unit, target, { scale: 2.5, type: 'phys', isSkill: true });
      }
    }
    const [target] = targets(battle, unit);
    if (target) damage(battle, unit, target, { scale: v.scale, hits: v.hits, type: 'phys', isSkill: true });
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'ammoUsed', 'radio', p => yours(unit, p.source) && p.source !== unit, ({ payload }) => {
    const v = valuesOf(unit);
    heal(battle, unit, unit, { maxHpRatio: v.heal });
    if (battle.rng() >= v.chance) return true;
    const [target] = enemies(battle, payload.source, { scope: 'range', count: 1 });
    if (target) for (const hit of battle.enemies.filter(e => active(e) && Math.max(Math.abs(e.y - target.y), Math.abs(e.x - target.x)) <= 1))
      damage(battle, unit, hit, { scale: v.bombard, type: 'phys', isSkill: true });
    return true;
  }),
  innate: (battle, unit) => {
    for (const [label, multiple] of [['laterano', 2], ['other', 1]]) allyAura(battle, unit, { key: `covenant:${label}`,
      select: other => !!assaultAmmoState(other) && (tagged(other, '拉特兰') === (label === 'laterano')),
      mods: { atkPct: valuesOf(unit).aura * multiple } });
  },
});

const lingToken = unit => unit.def.raw.assaultBody.source.skills.find(s => s.skillId === planOf(unit).sourceSkillId).overrideTokenKey;
const ling = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => canAttack({ battle, unit }) || owned(battle, unit).some(token => enemies(battle, token, { count: 2 }).length),
  cast: ({ battle, unit }) => {
    for (const actor of [unit, ...owned(battle, unit)]) for (const target of actor === unit ? targets(battle, unit) : enemies(battle, actor, { count: planOf(unit).targetCount })) {
      damage(battle, actor, target, { scale: valuesOf(unit).scale, type: 'arts', isSkill: true });
      if (target.alive) applyStatus(battle, actor, target, { status: 'bind', duration: valuesOf(unit).bind });
    }
    for (const token of owned(battle, unit).filter(t => t.hp < t.s.maxHp * .5)) returnSummon(battle, unit, token, 'lingRecall', { cancelPending: true });
    grantSummon(battle, unit, { tokenId: lingToken(unit), count: 1, stockCap: valuesOf(unit).stock, fieldCap: valuesOf(unit).field, ruleKey: 'adaptation-ling', preparedOnly: true });
    return true;
  },
  link: (battle, unit) => {
    const reward = countedTrigger(battle, { key: sourceKey(unit, 'poem'), owner: unit }, () => {
      const v = valuesOf(unit), previous = unit.mem.adaptPoemStacks ?? 0;
      const stacks = unit.mem.adaptPoemStacks = Math.min(v.maxStacks, previous + 1);
      buff(battle, unit, unit, { key: sourceKey(unit, 'poem-atk'), mods: { atkPct: v.growth * stacks }, duration: Infinity, persist: true });
      return sp(battle, unit, unit, v.charge, 'poem', 'poem') > 0 || stacks > previous;
    });
    for (const type of ['summonReturned', 'summonDestroyed']) battle.assaultRuntime.observe(type, sourceKey(unit, `poem:${type}`), event => {
      if (event.payload.target?.ownerUnit === unit) reward({ cause: event.cause, target: event.payload.target });
    }, { owner: unit });
  },
  innate: (battle, unit) => onDeploy(battle, unit, 'summons', () => {
    if (unit.mem.adaptLingStocked) return;
    unit.mem.adaptLingStocked = true;
    grantSummon(battle, unit, { tokenId: lingToken(unit), count: valuesOf(unit).stock,
      stockCap: valuesOf(unit).stock, fieldCap: valuesOf(unit).field, ruleKey: 'adaptation-ling', preparedOnly: true });
  }),
});

const IRON_DEVICE = 'token_10027_ironmn_pile2';
function deviceRecipient(battle, token) {
  // The original device's 1-1 grid is its own tile and the tile it faces.
  // Its own occupied tile cannot contain an operator; preserve that direction.
  return ops(battle, token.ownerUnit).filter(other => other.skill && other.skill.kind !== 'passive'
    && token.rangeKeySet.has(other.tileR*COLS+other.tileC))
    .sort((a, b) => a.skill.spTotal - b.skill.spTotal || uid(a).localeCompare(uid(b)))[0];
}
function addIronDevice(battle, unit, count) {
  const v = valuesOf(unit);
  const spec={tokenId:IRON_DEVICE,count,stockCap:v.stock,fieldCap:v.field,ruleKey:'adaptation-ironmn',preparedOnly:true};
  deployStoredSummons(battle,unit,{...spec,count:v.stock});
  return grantSummon(battle, unit, spec);
}
const ironmn = (_bb, _raw, def) => adaptedKit(def, {
  canCast:({battle,unit})=>!unit.mem.assaultBattleStates?.['ironmn-supply']
    ||(ledgerFor(battle,unit).stock.get(IRON_DEVICE)??0)<valuesOf(unit).stock
    ||owned(battle,unit).some(t=>t.defId===IRON_DEVICE&&deviceRecipient(battle,t)),
  cast: ({ battle, unit }) => {
    battleState(battle, unit, 'ironmn-supply', { mods: { atkPct: valuesOf(unit).selfBonus, defPct: valuesOf(unit).selfBonus },
      enter: () => { unit.profile.hitAllBlocked = true; } });
    // Original S2's 30 seconds × 0.8% device HP per second settle with this
    // instant support action. The ordinary 0.4% drain remains independent.
    for (const device of owned(battle, unit).filter(other => other.defId === IRON_DEVICE)) {
      const recipient = deviceRecipient(battle, device);
      if (recipient) sp(battle, unit, recipient, valuesOf(unit).charge, 'supply', sourceKey(unit, 'supply'));
      battle.loseHp(device,device.s.maxHp*valuesOf(unit).deviceCastLoss,{source:unit,tags:['assaultDeviceDrain']});
    }
    addIronDevice(battle, unit, 1);
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'summonDestroyed', 'recycle', p => p.target?.ownerUnit === unit
    && p.target.defId === IRON_DEVICE && Math.max(Math.abs(unit.tileR - p.target.tileR), Math.abs(unit.tileC - p.target.tileC)) <= 1,
  () => { if (battle.rng() >= valuesOf(unit).recycle) return false; return addIronDevice(battle, unit, 1).granted > 0; }),
  innate: (battle, unit) => onDeploy(battle, unit, 'initial-devices', () => {
    if (unit.mem.adaptIronStocked) return;
    unit.mem.adaptIronStocked = true; addIronDevice(battle, unit, valuesOf(unit).stock);
  }),
});

export { planOf, valuesOf, yours, ops, tagged, owned, anchor, targets, canAttack, sourceKey, onDeploy, link, selfBuff };

export const adaptationTokenInstalls = Object.freeze({
  token_10020_ling_soul2: (_battle, token) => { token.profile.noAttack = false; token.profile.dmgType = 'arts'; },
  [IRON_DEVICE]: (battle, token) => {
    const owner = token.ownerUnit, v = valuesOf(owner);
    token.profile.noAttack = true;
    // Retain the original device's continuous HP loss separately from its
    // support clock. It remains real HP loss and can produce destruction.
    battle.every(1, () => { if (active(token)) battle.loseHp(token, token.s.maxHp * v.deviceHpDrain, { source: owner, tags: ['assaultDeviceDrain'] }); }, { owner: token });
    battle.every(v.interval, () => {
      if (!active(token) || !active(owner)) return;
      const recipient = deviceRecipient(battle, token);
      if (!recipient) return;
      const amount = sp(battle, owner, recipient, v.deviceCharge, 'device-clock', sourceKey(owner, 'device-clock'));
      if (amount > 0) battle.emit('deviceTrigger', { source: owner, target: recipient, device: token });
    }, { owner: token });
  },
});

export const adaptationCoreKits = Object.freeze({
  char_1045_svash2: svash2, char_172_svrash: silverash, char_174_slbell: slbell, char_206_gnosis: gnosis,
  char_4116_blkkgt: blkkgt, char_112_siege: siege, char_103_angel: angel, char_202_demkni: demkni,
  char_350_surtr: surtr, char_263_skadi: skadi, char_1041_angel2: angel2, char_2023_ling: ling, char_4072_ironmn: ironmn,
});
