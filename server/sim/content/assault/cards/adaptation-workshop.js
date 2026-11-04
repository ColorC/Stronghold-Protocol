import { adaptedKit } from '../adapted-kit.js';
import { battleState, countedTrigger, actualDamageLink, linkDamagePotential } from '../adaptation-primitives.js';
import { active, damage, heal, buff, applyStatus, sp, gainDP, allies, enemies, uid } from '../primitives.js';
import { grantSummon, deployStoredSummons, returnSummon, ledgerFor } from '../summons.js';
import { withinAdjacent4 } from '../synergy.js';
import { valuesOf, yours, ops, tagged, owned, targets, canAttack, sourceKey, onDeploy, link, selfBuff } from './adaptation-core.js';
import { benchTemplate, copyFlow, unitTemplate } from './synergy-support.js';
import { hasManualInstruction } from './adaptation-native.js';

const DRONE = 'token_10000_silent_healrb', MACHINE = 'token_10018_robrta_mach', OTTER = 'token_10004_otter_motter';
const FLOW = 'token_10030_mlyss_wtrman', WOLF = 'token_10028_vigil_wolf';
const spec = (unit, tokenId, count) => ({ tokenId, count, stockCap: valuesOf(unit).stock, fieldCap: valuesOf(unit).field,
  ruleKey: `adaptation:${unit.def.charId}`, preparedOnly: true,
  ...([DRONE,MACHINE].includes(tokenId)?{duration:valuesOf(unit).seconds}:{}) });
function initialStock(battle, unit, tokenId) {
  onDeploy(battle, unit, `stock:${tokenId}`, () => {
    if (!unit.mem.adaptWorkshopStocked) {
      unit.mem.adaptWorkshopStocked = true;
      grantSummon(battle, unit, spec(unit, tokenId, valuesOf(unit).stock));
    } else deployStoredSummons(battle, unit, spec(unit, tokenId, valuesOf(unit).stock));
  });
}
function supply(battle, unit, tokenId) {
  deployStoredSummons(battle, unit, spec(unit, tokenId, valuesOf(unit).stock));
  return grantSummon(battle, unit, spec(unit, tokenId, 1));
}

const liskam = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit);
    for (const target of targets(battle, unit)) for (let i = 0; i < v.hits && target.alive; i++) {
      damage(battle, unit, target, { scale: v.scale, type: 'arts', isSkill: true });
      if (target.alive && battle.rng() < v.chance) applyStatus(battle, unit, target, { status: 'stun', duration: v.stun });
    }
    applyStatus(battle, unit, unit, { status: 'stun', duration: v.selfStun }); return true;
  },
  link: (battle, unit) => {
    const take = countedTrigger(battle, { key: sourceKey(unit, 'tactical-defence'), owner: unit, every: valuesOf(unit).every }, () => {
      const candidates = ops(battle, unit).filter(other => other !== unit && withinAdjacent4(unit, other) && other.skill?.kind !== 'passive');
      const other = candidates.length ? candidates[Math.floor(battle.rng() * candidates.length)] : null;
      let n = sp(battle, unit, unit, valuesOf(unit).charge, 'tactical-defence', 'tactical-defence');
      if (other) n += sp(battle, unit, other, valuesOf(unit).charge, 'tactical-defence', 'tactical-defence');
      return n;
    });
    battle.on('hit', ({ source, target, dmg }) => {
      if (target === unit && source?.side === 'enemy' && dmg.isAttack) take({ target: unit, cause: battle.assaultRuntime.currentCause });
    }, { owner: unit });
  },
  innate: (battle, unit) => selfBuff(battle, unit, 'thunder-resist', { resFlat: 10 }),
});

const silent = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => hasManualInstruction(unit, DRONE) || owned(battle, unit).some(t => t.defId === DRONE),
  cast: ({ battle, unit }) => {
    supply(battle, unit, DRONE);
    for (const drone of owned(battle, unit).filter(t => t.defId === DRONE)) for (const target of allies(battle, drone, { count: 999 }))
      heal(battle, drone, target, { amount: unit.s.atk * valuesOf(unit).heal });
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'heal', 'injection', p => p.source?.ownerUnit === unit && p.source.defId === DRONE && yours(unit, p.target), ({ payload }) =>
    !!buff(battle, payload.target, payload.target, { key: 'adaptation:silent:injection', mods: { aspd: valuesOf(unit).aspd }, duration: Infinity, persist: true })),
  innate: (battle, unit) => initialStock(battle, unit, DRONE),
});

function styleOnce(battle, unit) {
  let applied = 0;
  for (const machine of owned(battle, unit).filter(t => t.defId === MACHINE)) {
    const target = allies(battle, machine, { count: 999, selection: 'uid' }).find(other => other.def.position === 'MELEE');
    if (!target) continue;
    buff(battle, target, target, { key: 'adaptation:robrta:defence', mods: { defPct: valuesOf(unit).def }, duration: Infinity, persist: true });
    const n = unit.mem.adaptStylingSeq = (unit.mem.adaptStylingSeq ?? 0) + 1;
    battle.addBuff(target, { key: sourceKey(unit, `styling:${n}`), shieldHits: valuesOf(unit).shields, duration: Infinity, source: unit });
    battle.emit('deviceTrigger', { source: unit, target, device: machine }); applied++;
  }
  return applied;
}
const robrta = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => !unit.mem.assaultBattleStates?.['robrta-guard'] || hasManualInstruction(unit, MACHINE) || owned(battle, unit).some(t => t.defId === MACHINE),
  cast: ({ battle, unit }) => {
    battleState(battle, unit, 'robrta-guard', { mods: { defPct: valuesOf(unit).selfDef, blockCnt: 1 } });
    supply(battle, unit, MACHINE); styleOnce(battle, unit); return true;
  },
  link: (battle, unit) => link(battle, unit, 'shieldBroken', 'restyle', p => yours(unit, p.target) && p.shieldKind === 'layers',
    () => styleOnce(battle, unit), { first: valuesOf(unit).first }),
  innate: (battle, unit) => initialStock(battle, unit, MACHINE),
});

const blastTargets = (battle, owner, actor) => targets(battle, owner, { tileR: actor.tileR, tileC: actor.tileC, x: actor.x, y: actor.y, dir: actor.dir,
  side: owner.side, ownerId: owner.ownerId, profile: { canHitFly: true } });
const otter = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => owned(battle, unit).some(t => blastTargets(battle, unit, t).length)
    || (ledgerFor(battle, unit).stock.get(OTTER) > 0 && (unit.def.raw.assaultPiece.summonPresets ?? []).some(p => p?.tokenId === OTTER
      && blastTargets(battle, unit, { tileR: p.row, tileC: p.col, x: p.col, y: p.row, dir: p.dir ?? unit.dir }).length)),
  cast: ({ battle, unit }) => {
    deployStoredSummons(battle, unit, spec(unit, OTTER, valuesOf(unit).stock));
    const water = owned(battle, unit).filter(t => t.defId === OTTER);
    for (const token of water) {
      for (const target of blastTargets(battle, unit, token)) {
        damage(battle, unit, target, { scale: valuesOf(unit).scale, type: 'arts', isSkill: true });
        if (target.alive) applyStatus(battle, unit, target, { status: 'stun', duration: valuesOf(unit).stun });
      }
      returnSummon(battle, unit, token, 'otterRecycle', { cancelPending: true });
    }
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'summonReturned', 'mechanical-recovery', p => p.source?.ownerId === unit.ownerId, () => {
    let n = 0;
    for (const other of ops(battle, unit).filter(x => x !== unit && withinAdjacent4(unit, x)))
      n += sp(battle, unit, other, valuesOf(unit).charge, 'mechanical-recovery', 'mechanical-recovery');
    return n;
  }, { every: valuesOf(unit).every }),
  innate: (battle, unit) => initialStock(battle, unit, OTTER),
});

const flowOf = (battle, unit) => owned(battle, unit).find(t => t.defId === FLOW);
const mlyss = (_bb, _raw, def) => adaptedKit(def, {
  cast: ({ battle, unit }) => {
    supply(battle, unit, FLOW);
    gainDP(battle, unit, valuesOf(unit).dp, 'entropy');
    battleState(battle, unit, 'mlyss-entropy', { mods: { atkPct: valuesOf(unit).atk } });
    const flow = flowOf(battle, unit);
    if (!flow) return true;
    buff(battle, flow, flow, { key: 'adaptation:mlyss:entropy', mods: { atkPct: valuesOf(unit).atk }, duration: Infinity, persist: true });
    if (flow.profile.attack === 'ranged') {
      heal(battle, unit, flow, { amount: flow.s.maxHp });
      for (const target of enemies(battle, flow, { count: 1 })) {
        damage(battle, flow, target, { scale: 1, type: flow.profile.dmgType, isSkill: true });
        if (target.alive) applyStatus(battle, flow, target, { status: 'bind', duration: valuesOf(unit).bind });
      }
    } else {
      for (const target of enemies(battle, flow, { scope: 'adjacent8', count: 999 })) battle.pull(target, 0, { center: flow });
      for (const target of (flow.blocking ?? []).filter(active)) {
        damage(battle, flow, target, { scale: 1, type: flow.profile.dmgType, isSkill: true });
        if (target.alive) applyStatus(battle, flow, target, { status: 'stun', duration: valuesOf(unit).stun });
      }
    }
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'redeploy', 'clear-water', p => yours(unit, p.source) && p.source !== unit && tagged(p.source, '莱茵生命'), ({ payload }) => {
    const flow = flowOf(battle, unit); if (!flow) return false;
    copyFlow(battle, unit, flow, unitTemplate(payload.source), { refresh: true, factor: valuesOf(unit).factor }); return true;
  }),
  innate: (battle, unit) => {
    initialStock(battle, unit, FLOW);
    battle.assaultRuntime.observe('summonDestroyed', sourceKey(unit, 'flow-refresh'), ({ payload }) => {
      if (payload.target?.ownerUnit === unit && payload.target.defId === FLOW)
        battle.after(valuesOf(unit).refresh, () => { if (active(unit)) supply(battle, unit, FLOW); });
    }, { owner: unit });
    battle.on('assaultDeploymentCost', quote => {
      if (yours(unit, quote.unit) && tagged(quote.unit, '莱茵生命')) quote.amount = Math.max(0, quote.amount - valuesOf(unit).costReduce);
    }, { owner: unit });
  },
});

const wolfOf = (battle, unit) => owned(battle, unit).find(t => t.defId === WOLF);
const vigil = (_bb, _raw, def) => adaptedKit(def, {
  cast: ({ battle, unit }) => {
    supply(battle, unit, WOLF); gainDP(battle, unit, valuesOf(unit).dp, 'pack');
    const wolf = wolfOf(battle, unit), [target] = targets(battle, unit);
    const hit = (actor, foe, hits) => {
      damage(battle, actor, foe, { scale: actor === unit && foe.blockedBy === wolf ? 1.5 : 1, hits, type: 'phys', isSkill: true });
      if (foe.alive && foe.blockedBy === wolf) damage(battle, unit, foe, { scale: valuesOf(unit).arts, hits, type: 'arts', isSkill: true });
    };
    if (target) hit(unit, target, valuesOf(unit).hits);
    if (wolf) for (const foe of (wolf.blocking ?? []).filter(active).slice(0, 1)) hit(wolf, foe, wolf.mem.adaptWolfHeads);
    return true;
  },
  link: (battle, unit) => {
    const credited = actualDamageLink(battle,unit,sourceKey(unit,'pack-nature'));
    battle.on('hit', ({ source, target, dmg }) => {
      if (!active(unit) || source?.ownerId !== unit.ownerId || target?.blockedBy?.ownerUnit !== unit || target.blockedBy.defId !== WOLF) return;
      const previous = dmg.defIgnoreFlat ?? 0,before=linkDamagePotential(source,target,dmg); dmg.defIgnoreFlat = Math.max(previous, valuesOf(unit).ignore);
      if (dmg.defIgnoreFlat > previous&&linkDamagePotential(source,target,dmg)>before+1e-9) credited(dmg,()=>dmg.defIgnoreFlat===valuesOf(unit).ignore);
    }, { owner: unit, priority: 60 });
  },
  innate: (battle, unit) => {
    initialStock(battle, unit, WOLF);
    battle.assaultRuntime.observe('summonDestroyed', sourceKey(unit, 'wolf-refresh'), ({ payload }) => {
      if (payload.target?.ownerUnit !== unit || payload.target.defId !== WOLF) return;
      battle.after(valuesOf(unit).refresh, () => { if (active(unit)) { unit.mem.adaptNextWolfHeads = 1; supply(battle, unit, WOLF); } });
    }, { owner: unit });
  },
});

export const workshopTokenInstalls = Object.freeze({
  [DRONE]: (_battle, token) => { token.profile.noAttack = true; },
  [MACHINE]: (_battle, token) => { token.profile.noAttack = true; },
  [OTTER]: (battle, token) => {
    token.profile.noAttack = false;
    battle.every(.25, () => { if (active(token)) for (const target of (token.blocking ?? []).filter(active))
      applyStatus(battle, token.ownerUnit, target, { status: 'aspdDown', value: -valuesOf(token.ownerUnit).slow, duration: .51 });
    }, { owner: token });
  },
  [FLOW]: (battle, token) => {
    const owner = token.ownerUnit;
    owner.trait.reinforcement = token;
    copyFlow(battle, owner, token, benchTemplate(battle, owner) ?? unitTemplate(owner), { refresh: true, factor: valuesOf(owner).factor });
    if (owner.mem.assaultBattleStates?.['mlyss-entropy'])
      buff(battle, token, token, { key: 'adaptation:mlyss:entropy', mods: { atkPct: valuesOf(owner).atk }, duration: Infinity, persist: true });
  },
  [WOLF]: (battle, token) => {
    const owner = token.ownerUnit; owner.trait.reinforcement = token;
    token.mem.adaptWolfHeads = owner.mem.adaptNextWolfHeads ?? valuesOf(owner).heads; delete owner.mem.adaptNextWolfHeads;
    const sync = () => {
      token.profile.noAttack = false; token.profile.hits = token.mem.adaptWolfHeads;
      buff(battle, token, token, { key: 'adaptation:wolf-heads', mods: { blockCnt: token.mem.adaptWolfHeads - token.base.blockCnt }, duration: Infinity, persist: true });
    };
    battle.on('deploy', ({ unit }) => { if (unit === token) sync(); }, { owner: token });
    battle.on('fatal', ctx => {
      if (ctx.unit !== token || token.mem.adaptWolfHeads <= 1 || ctx.prevented) return;
      ctx.prevented = true; token.mem.adaptWolfHeads--; sync();
      token.mem.adaptWolfRestore = true;
    }, { owner: token, priority: 40 });
    battle.on('damaged', ({ target }) => {
      if (target !== token || !token.mem.adaptWolfRestore) return;
      token.mem.adaptWolfRestore = false;
      if (active(token)) heal(battle, token, token, { amount: token.s.maxHp, ignoreHealFree: true });
    }, { owner: token, priority: 100 });
    battle.every(valuesOf(owner).refresh, () => {
      if (active(token) && token.mem.adaptWolfHeads < valuesOf(owner).maxHeads) { token.mem.adaptWolfHeads++; sync(); }
    }, { owner: token });
  },
});

export const adaptationWorkshopKits = Object.freeze({ char_107_liskam: liskam, char_108_silent: silent, char_484_robrta: robrta,
  char_242_otter: otter, char_249_mlyss: mlyss, char_427_vigil: vigil });
