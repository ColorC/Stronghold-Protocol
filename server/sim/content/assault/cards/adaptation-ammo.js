import { adaptedKit } from '../adapted-kit.js';
import { naturalSpAura } from '../adaptation-auras.js';
import { countedTrigger, fillCastAmmo, castAmmoCapacity } from '../adaptation-primitives.js';
import { active, damage, heal, applyStatus, sp, buff, haste, allies, enemies, uid } from '../primitives.js';
import { assaultAmmoState } from '../ammo.js';
import { withinAdjacent4, markWanted, isWanted } from '../synergy.js';
import { bodyDist, bodyInKeys } from '../../../body.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { valuesOf, yours, ops, tagged, anchor, targets, canAttack, sourceKey, onDeploy, link } from './adaptation-core.js';

const adjacentAmmo = (battle, unit) => ops(battle, unit).filter(other => other !== unit && withinAdjacent4(unit, other) && assaultAmmoState(other));
function credit(battle, unit, key) { return countedTrigger(battle, { key: sourceKey(unit, key), owner: unit }, () => true); }
function damageScale(dmg, key, factor) {
  const scales = dmg.assaultConditionalScales ??= {}, previous = scales[key] ?? 1;
  if (factor <= previous) return false;
  scales[key] = factor; dmg.mul *= factor / previous; return true;
}
function afterPresence(battle, unit, seconds, effect) {
  let elapsed = 0, done = false;
  battle.on('tick', ({ dt }) => {
    if (done || !active(unit)) return;
    elapsed += dt;
    if (elapsed + 1e-9 >= seconds) { done = true; effect(); }
  }, { owner: unit });
}
function inFront(unit, target) {
  if (unit.profile.frontGrid) return bodyInKeys(target, absoluteRangeKeys(unit.profile.frontGrid, unit.tileR, unit.tileC, unit.dir));
  const [r, c] = unit.fwd, dr = target.y - unit.y, dc = target.x - unit.x;
  return Math.abs(dr * c - dc * r) < .5 && dr * r + dc * c >= 0;
}

const archet = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit), [first] = targets(battle, unit, unit, 1);
    const selected = [first];
    let current = first;
    while (selected.length < v.hits) {
      const next = enemies(battle, unit, { scope: 'field', count: 999 }).filter(e => !selected.includes(e) && bodyDist(e, current.x, current.y) <= v.bounce)
        .sort((a, b) => bodyDist(a, current.x, current.y) - bodyDist(b, current.x, current.y) || uid(a).localeCompare(uid(b)))[0];
      if (!next) break;
      selected.push(next); current = next;
    }
    // Native pursuit is 5,4,3,2,1 attacks on distinct successive targets.
    // The 1.5-tile secondary radius follows the upstream Archet kit's marked
    // assumption; the first target always uses the original attack range.
    selected.forEach((target, index) => {
      if (target.alive) damage(battle, unit, target, { scale: v.scale, hits: v.hits - index, type: 'phys', isSkill: true });
    });
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'skillResolved', 'landon', p => yours(unit, p.source) && p.source !== unit
    && p.source.def.profession === 'SNIPER', () => {
    let total = 0; for (const other of adjacentAmmo(battle, unit)) total += fillCastAmmo(battle, unit, other, 'landon');
    return total;
  }, { every: valuesOf(unit).every }),
  innate: (battle, unit) => {
    onDeploy(battle, unit, 'iron-string', () => battle.addBuff(unit, { key: sourceKey(unit, 'iron-string'), shieldHits: 1, duration: Infinity, source: unit }));
    link(battle, unit, 'shieldBroken', 'iron-string-sp', p => p.target === unit, () => sp(battle, unit, unit, 7, 'iron-string', 'iron-string'));
  },
});

const excu = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit);
    for (const target of targets(battle, unit)) damage(battle, unit, target, { scale: v.scale * (inFront(unit, target) ? v.frontScale : 1),
      hits: v.hits, type: 'phys', isSkill: true });
    return true;
  },
  link: (battle, unit) => {
    battle.on('hit', ({ source, target, dmg }) => {
      if (!active(unit) || source!==unit || target?.side !== 'enemy') return;
      const previous = dmg.defIgnoreFlat ?? 0;
      dmg.defIgnoreFlat = Math.max(previous, valuesOf(unit).ignore);
    }, { owner: unit, priority: 60 });
    link(battle,unit,'skillResolved','modified-round',p=>yours(unit,p.source)&&p.source!==unit&&!!assaultAmmoState(p.source),()=>{
      const v=valuesOf(unit),list=targets(battle,unit);for(const target of list)damage(battle,unit,target,{scale:v.scale*(inFront(unit,target)?v.frontScale:1),type:'phys'});return list.length;
    },{every:valuesOf(unit).every});
  },
});

const excu2 = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit), n = unit.mem.adaptExcuRounds = Math.min(v.maxStacks, (unit.mem.adaptExcuRounds ?? 0) + 1);
    const followups = unit.mem.adaptExcuFollowups ?? 0; unit.mem.adaptExcuFollowups = 0;
    const hit = unit.mem.adaptExcuHit ??= new Set(), before = unit.profile.selfHeal;
    unit.profile.selfHeal = (before ?? 50) * v.traitRatio;
    try {
      for (const target of targets(battle, unit)) {
        hit.add(uid(target));
        damage(battle, unit, target, { scale: v.scale + v.growth * n, hits: 1 + followups, type: 'phys', isSkill: true });
      }
      if (assaultAmmoState(unit).current === 0) {
        for (const target of battle.enemies.filter(e => active(e) && hit.has(uid(e))))
          damage(battle, unit, target, { scale: v.finish * (v.scale + v.growth * n), type: 'phys', isSkill: true });
        unit.mem.adaptExcuRounds = 0; hit.clear();
      }
    } finally { unit.profile.selfHeal = before; }
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'ammoUsed', 'chosen', p => yours(unit, p.source) && p.source !== unit,
    () => { unit.mem.adaptExcuFollowups = (unit.mem.adaptExcuFollowups ?? 0) + 1; return true; }, { every: valuesOf(unit).every }),
  innate: (battle, unit) => {
    let highest = 0;
    const sync = () => {
      const count = Math.min(4, ops(battle, unit).filter(other => tagged(other, '拉特兰')).length);
      castAmmoCapacity(battle, unit, unit, count, 'laterano-empathy', { loadedIncrease: count > highest }); highest = Math.max(highest, count);
    };
    battle.on('deploy', sync, { owner: unit }); battle.on('death', sync, { owner: unit });
    battle.every(.25, sync, { owner: unit });
  },
});

const rangedEnemy = target => target.base.rangeRadius > 0 && target.def?.applyWay !== 'MELEE';
const inside = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    const selected = targets(battle, unit, unit, 999).sort((a, b) => Number(rangedEnemy(b)) - Number(rangedEnemy(a)));
    damage(battle, unit, selected[0], { scale: valuesOf(unit).scale, type: 'phys', isSkill: true }); return true;
  },
  link: (battle, unit) => link(battle, unit, 'reloaded', 'support', p => p.target === unit, () => {
    let applied = 0;
    for (const other of adjacentAmmo(battle, unit).filter(x => tagged(x, '拉特兰')))
      applied += castAmmoCapacity(battle, unit, other, valuesOf(unit).allyAmmo, sourceKey(unit, 'support'));
    return applied;
  }, { first: 1 }),
  innate: (battle, unit) => {
    onDeploy(battle, unit, 'low-profile', () => buff(battle, unit, unit, { key: sourceKey(unit, 'low-profile'), mods: { taunt: -1 }, duration: Infinity, persist: true }));
    afterPresence(battle, unit, valuesOf(unit).at, () => castAmmoCapacity(battle, unit, unit, valuesOf(unit).selfAmmo, 'fire-support'));
  },
});

function lemuenTargets(battle, unit) {
  const wanted = enemies(battle, unit, { scope: 'field', count: 999 }).filter(isWanted);
  return wanted.length ? wanted.slice(0, 1) : targets(battle, unit);
}
const lemuen = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => lemuenTargets(battle, unit).length > 0,
  cast: ({ battle, unit }) => {
    const [main] = lemuenTargets(battle, unit), v = valuesOf(unit);
    for (const target of enemies(battle, unit, { scope: 'field', count: 999 }).filter(e => bodyDist(e, main.x, main.y) <= v.radius))
      damage(battle, unit, target, { scale: bodyDist(target, main.x, main.y) <= v.centerRadius ? v.center : v.splash, type: 'phys', isSkill: true });
    return true;
  },
  link: (battle, unit) => {
    const elapsed = new Map(), credited = credit(battle, unit, 'wanted');
    battle.every(.25, () => {
      if (!active(unit)) return;
      const laterano = ops(battle, unit).filter(other => tagged(other, '拉特兰'));
      for (const target of battle.enemies.filter(e => active(e) && !isWanted(e) && (e.isBoss || ['ELITE', 'BOSS'].includes(e.def?.rank)))) {
        const inRange = laterano.some(other => other.rangeKeySet && bodyInKeys(target, other.rangeKeySet));
        const time = inRange ? (elapsed.get(uid(target)) ?? 0) + .25 : 0; elapsed.set(uid(target), time);
        if (time >= valuesOf(unit).wantedAt && markWanted(battle, unit, target)) credited({ target });
      }
    }, { owner: unit });
    battle.on('hit', ({ source, target, dmg }) => {
      if (active(unit) && yours(unit, source) && tagged(source, '拉特兰') && isWanted(target))
        damageScale(dmg, 'wanted-laterano', 1 + valuesOf(unit).fragile);
    }, { owner: unit, priority: 50 });
  },
  innate: (battle, unit) => afterPresence(battle, unit, valuesOf(unit).growthAt, () => {
    buff(battle, unit, unit, { key: sourceKey(unit, 'extradition'), mods: { atkPct: valuesOf(unit).atk }, duration: Infinity, persist: true });
    castAmmoCapacity(battle, unit, unit, 1, 'extradition');
  }),
});

const plosis = (_bb, _raw, def) => adaptedKit(def, {
  canCast: ({ battle, unit }) => allies(battle, unit, { anchor: anchor(unit), count: valuesOf(unit).targets }).some(other => other.hp < other.s.maxHp),
  cast: ({ battle, unit }) => {
    for (const target of allies(battle, unit, { anchor: anchor(unit), count: valuesOf(unit).targets })) heal(battle, unit, target, { scale: valuesOf(unit).scale });
    return true;
  },
  link: (battle, unit) => link(battle, unit, 'reloaded', 'encephalin', p => yours(unit, p.target), () => {
    for (const other of ops(battle, unit).filter(other => other !== unit && withinAdjacent4(unit, other)))
      haste(battle, unit, other, valuesOf(unit).haste, 'encephalin');
    return true;
  }),
  innate: (battle, unit) => naturalSpAura(battle,unit,'encephalin',.3),
});

const kroos2 = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    const [target] = targets(battle, unit);
    damage(battle, unit, target, { scale: valuesOf(unit).scale, hits: valuesOf(unit).hits, type: 'phys', isSkill: true }); return true;
  },
  link: (battle, unit) => link(battle, unit, 'statusApplied', 'bullseye', p => yours(unit, p.source) && p.source !== unit && p.status === 'stun', () => {
    let gained = 0;
    for (const other of adjacentAmmo(battle, unit)) gained += sp(battle, unit, other, valuesOf(unit).charge, 'bullseye', 'bullseye');
    return gained;
  }, { first: valuesOf(unit).first }),
  innate: (battle, unit) => battle.on('hit', ({ source, target, dmg }) => {
    if (source !== unit || target?.side !== 'enemy' || battle.rng() >= valuesOf(unit).chance) return;
    dmg.mul *= valuesOf(unit).crit; applyStatus(battle, unit, target, { status: 'stun', duration: valuesOf(unit).stun });
  }, { owner: unit }),
});

const meteor = (_bb, _raw, def) => adaptedKit(def, {
  canCast: canAttack,
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit);
    for (const target of targets(battle, unit)) {
      damage(battle, unit, target, { scale: v.scale, type: 'phys', isSkill: true });
      if (target.alive) applyStatus(battle, unit, target, { status: 'defDown', value: v.defDown, duration: v.seconds });
    }
    return true;
  },
  link: (battle, unit) => {
    battle.on('hit', ({ source, target, dmg }) => {
      if (!active(unit) || source!==unit || !target?.isFlying) return;
      damageScale(dmg, 'meteor-anti-air', 1 + valuesOf(unit).airBonus);
    }, { owner: unit, priority: 50 });
    link(battle,unit,'skillResolved','air-pursuit',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='SNIPER',
      ()=>{const target=targets(battle,unit,unit,999).find(e=>e.isFlying);return target?damage(battle,unit,target,{scale:1,type:'phys'}):false;},{every:valuesOf(unit).every});
  },
});

export const adaptationAmmoKits = Object.freeze({ char_332_archet: archet, char_279_excu: excu, char_1032_excu2: excu2,
  char_498_inside: inside, char_4193_lemuen: lemuen, char_128_plosis: plosis, char_1021_kroos2: kroos2, char_126_shotst: meteor });
