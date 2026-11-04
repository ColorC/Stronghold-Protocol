// Assault 再部署 loop (user definition 10-21): an operator on the field runs a loop timer of its 再部署时间 from every
// deployment (redeploys included). When it reaches 0 the operator is redeployed where it stands: HP back to full;
// SP, buffs and the attack state stay; every 部署时 effect (the runtime `deployed` event) fires again and a skill marked
// `castOnDeploy` is cast at once. No retreat, no leaving the field. Knocked-out operators keep the native respawn timer.
// Installed by the assault content only (the native battle files stay as they are): the loop rides the native `deploy`
// and `tick` hooks, and `battle.skillRedeploy` of an operator on the field becomes this in-place 再部署.

// The rule switch (assault runtime rule `redeployCycle`): true = every assault operator runs the automatic loop. A battle
// may override it with `opts.assault.redeployCycle`. Off restores the native behaviour exactly: no loop timers and the
// native skillRedeploy; explicit 立即再部署 effects (synergy.js redeployNow) still redeploy in place.
export const REDEPLOY_CYCLE_DEFAULT = true;
// 再部署 chains inside one battle tick (立即再部署 effects feeding each other): a hard stop, not a balance cap
export const REDEPLOY_CHAIN = Object.freeze({ perUnit: 3, perFrame: 48 });

const uidOf = (u) => u?.uid ?? u?.id ?? null;
const onField = (u) => !!(u && u.side === 'ally' && u.kind === 'op' && u.alive && u.deployed && !u.removed && !u._removing);

/** Length of `u`'s loop now: 再部署时间 × the redeploy multipliers, then this battle's 「之后每轮」 cuts. */
export function cycleLength(u) {
  const cut = u.mem?.assaultRedeployCut;
  const base = Math.max(0, Number(u.base?.respawnTime) || 0) * (u.persist?.redeployMul ?? 1) * (u.s?.redeployMul ?? 1);
  return Math.max(0, base * (cut?.keep ?? 1) - (cut?.seconds ?? 0));
}

function arm(battle, u) {
  const length = cycleLength(u);
  u.assaultCycle = { startedAt: battle.time, length, at: battle.time + length, count: u.assaultCycle?.count ?? 0 };
  return u.assaultCycle;
}

/** 部署时发动技能 (skill spec `castOnDeploy`): a free cast at every deployment and in-place 再部署. */
function castOnDeploy(battle, u, cause, tag) {
  if (u.skill?.spec?.castOnDeploy !== true || !onField(u)) return;
  const runtime = battle.assaultRuntime;
  runtime.enqueue(() => { if (onField(u)) runtime.cast(u, { extra: true, suppressRedeploy: true, force: true }); },
    { key: `castOnDeploy:${uidOf(u)}:${tag}`, targetUid: uidOf(u), cause });
}

/**
 * One in-place 再部署 of `u` now (its timer done, 「立即再部署」 or a skill's redeploy). Chains inside one tick are capped:
 * a unit at most REDEPLOY_CHAIN.perUnit times and all units REDEPLOY_CHAIN.perFrame times; refused ones are counted in
 * `battle.assaultRedeployChain.refused`. Returns true when it happened.
 */
export function cycleRedeploy(battle, u, { cause = null, reason = 'cycle' } = {}) {
  if (!battle.assaultStrict || !onField(u)) return false;
  const chain = battle.assaultRedeployChain ??= { time: null, total: 0, byUnit: new Map(), refused: 0 };
  if (chain.time !== battle.time) { chain.time = battle.time; chain.total = 0; chain.byUnit.clear(); }
  const own = chain.byUnit.get(u) ?? 0;
  if (chain.total >= REDEPLOY_CHAIN.perFrame || own >= REDEPLOY_CHAIN.perUnit) { chain.refused++; return false; }
  chain.total++;
  chain.byUnit.set(u, own + 1);
  const healed = Math.max(0, u.s.maxHp - u.hp);
  u.hp = u.s.maxHp;
  if (healed >= 0.5) battle._ev(['heal', u.id, Math.round(healed)]);
  const count = (u.assaultCycle?.count ?? 0) + 1;
  arm(battle, u);
  u.assaultCycle.count = count;
  const runtime = battle.assaultRuntime;
  const parent = cause ?? runtime.currentCause;
  const id = uidOf(u);
  runtime.publish('deployed', { source: u, sourceUid: id, target: u, targetUid: id, initial: false, deploySeq: u.deploySeq,
    cycle: count, actualPaid: 0, skillEntry: reason === 'skill', inPlace: true, reason, sourceClass: 'redeploy' }, { cause: parent });
  runtime.publish('redeploy', { source: u, sourceUid: id, target: u, targetUid: id, alive: true, inPlace: true, cycle: count,
    skill: reason === 'skill', free: true, actualPaid: 0, reason }, { cause: parent });
  castOnDeploy(battle, u, parent, `cycle:${count}`);
  return true;
}

export function redeployCycleEnabled(battle) {
  const own = battle.opts?.assault?.redeployCycle;
  return typeof own === 'boolean' ? own : REDEPLOY_CYCLE_DEFAULT;
}

export function installRedeployCycle(battle) {
  const enabled = redeployCycleEnabled(battle);
  battle.assaultRedeployCycleOn = enabled;
  // every native deployment (the first one, a knocked-out operator's comeback): a new loop, the deploy-time skill
  battle.on('deploy', ({ unit }) => {
    if (unit?.kind !== 'op' || !onField(unit)) return;
    if (enabled) {
      const count = unit.assaultCycle?.count ?? 0;
      arm(battle, unit);
      unit.assaultCycle.count = count;
    }
    castOnDeploy(battle, unit, battle.assaultRuntime.currentCause, `deploy:${unit.deploySeq}`);
  });
  if (!enabled) return;
  // the loop timers, once a tick after the native automatic redeploys (the tick hook phase)
  battle.on('tick', () => {
    for (const u of battle.assaultDeploymentOrder()) {
      if (!onField(u) || !u.assaultCycle || battle.time + 1e-9 < u.assaultCycle.at) continue;
      if (!cycleRedeploy(battle, u, { reason: 'cycle' })) u.assaultCycle.at = battle.time + Math.max(battle.dt ?? 0, 1e-6);
    }
  });
  // a skill's 再部署 of an operator on the field is the in-place one (the native path keeps the knocked-out case)
  const nativeSkillRedeploy = battle.skillRedeploy;
  battle.skillRedeploy = function skillRedeploy(unit, opts = {}) {
    if (onField(unit) && !unit.removed) return cycleRedeploy(battle, unit, { cause: opts.cause ?? null, reason: 'skill' });
    return nativeSkillRedeploy.call(battle, unit, opts);
  };
}
