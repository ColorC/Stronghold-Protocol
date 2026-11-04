// Bridges existing Battle hooks into the explicit assault event stream.

const uid = (unit) => unit?.uid ?? unit?.id ?? null;

export function installAssaultEvents(battle, runtime) {
  const bind = (hook, type, map) => battle.on(hook, (ctx) => runtime.publish(type, map(ctx), { sourceUid: uid(ctx.source ?? ctx.attacker ?? ctx.killer ?? ctx.unit) }));

  bind('attack', 'attack', ({ attacker, targets, isSkill, attackId }) => ({
    source: attacker, sourceUid: uid(attacker), targetUids: targets.map(uid), targets, attackId: attackId ?? battle._attackSeq,
    skillId: isSkill ? attacker?.skill?.evSkillId ?? null : null, sourceClass: isSkill ? 'skill' : 'attack',
  }));
  bind('ammoUsed', 'ammoUsed', ({ unit, skill, left, amount = 1, ammoMax, sourceKey }) => ({ source: unit, sourceUid: uid(unit), skillId: skill?.evSkillId ?? null, left, amount, ammoMax, sourceKey }));
  bind('reloaded', 'reloaded', ({ unit, source, amount, skill }) => ({ source: source ?? unit, sourceUid: uid(source ?? unit), target: unit, targetUid: uid(unit), amount, skillId: skill?.evSkillId ?? null }));
  battle.on('deploy', ({ unit, initial, actualPaid, skillEntry }) => {
    runtime.publish('deployed', { source: unit, sourceUid: uid(unit), target: unit, targetUid: uid(unit), initial, deploySeq: unit.deploySeq, actualPaid, skillEntry: skillEntry === true, sourceClass: 'deployment' });
    if (actualPaid > 0) runtime.publish('dpSpent', { source: unit, sourceUid: uid(unit), target: battle.getPlayer(unit.ownerId), targetUid: unit.ownerId, amount: actualPaid, sourceClass: 'deployment' });
    if (unit?.kind === 'token') runtime.publish('summonSpawned', { source: unit.ownerUnit ?? null, sourceUid: uid(unit.ownerUnit), target: unit, targetUid: uid(unit), unitKind: unit.kind });
    if (unit?.kind === 'token' || unit?.kind === 'device') runtime.publish('summonEntered', { source: unit.ownerUnit ?? null, sourceUid: uid(unit.ownerUnit), target: unit, targetUid: uid(unit), unitKind: unit.kind });
  });
  // One device event for every owner's device (traps, bombs, resonance
  // devices): cards may watch it on the runtime stream like other triggers.
  bind('deviceTrigger', 'deviceTrigger', ({ source, target, device }) => ({ source, sourceUid: uid(source), target, targetUid: uid(target),
    device, ownerId: source?.ownerId ?? device?.ownerId ?? null, sourceClass: 'device' }));
  const statusEvent = (ctx) => ({ ...ctx, nativeStatus: ctx.status,
    status: ctx.status === 'freeze' ? 'frozen' : ctx.status, applied: true,
    sourceUid: uid(ctx.source), targetUid: uid(ctx.target), amount: ctx.value ?? 1,
    sourceClass: ctx.sourceClass ?? 'status' });
  bind('statusApplied', 'statusApplied', statusEvent);
  bind('assaultColdApplied', 'statusApplied', statusEvent);
  battle.on('statusApplied', (ctx) => {
    if (ctx.source && ctx.source.side !== ctx.target?.side) runtime.publish('debuffApplied', { ...ctx, sourceUid: uid(ctx.source), targetUid: uid(ctx.target), amount: ctx.value ?? 1 }, { sourceUid: uid(ctx.source) });
  });
  // 推开 / 拖拽 an enemy: a push or pull that really moved it is a statusApplied 'push' / 'pull' of whoever moved it
  // (「你的其他干员使敌人推开时」). The native methods stay as they are; the assault battle wraps them.
  const moves = (name, status, actorOf) => {
    const native = battle[name];
    battle[name] = function displace(enemy, force, options = {}) {
      const moved = native.call(battle, enemy, force, options);
      const source = actorOf(options);
      if (moved > 1e-9 && enemy?.side === 'enemy' && source?.side === 'ally') runtime.publish('statusApplied', { source, sourceUid: uid(source),
        target: enemy, targetUid: uid(enemy), status, nativeStatus: null, applied: true, amount: moved, sourceClass: 'displacement' }, { sourceUid: uid(source) });
      return moved;
    };
  };
  moves('push', 'push', (options) => options.from);
  moves('pull', 'pull', (options) => options.center);
  // 闪避时: the native dodge (damage.js) — the source attacked, the target dodged
  battle.on('dodge', ({ source, target, dmg }) => runtime.publish('dodge', { source, sourceUid: uid(source), target, targetUid: uid(target),
    damageType: dmg?.type ?? null, sourceClass: 'dodge' }, { sourceUid: uid(source) }));
  // 阻挡敌人时: the native block start (Battle._checkBlock) as an event; the blocker is the source
  battle.on('blocked', ({ blocker, enemy }) => runtime.publish('blocked', { source: blocker, sourceUid: uid(blocker), target: enemy,
    targetUid: uid(enemy), sourceClass: 'block' }, { sourceUid: uid(blocker) }));
  // 造成 X 损伤: every element gauge accumulation (applyElement's `damaged` with type element)
  battle.on('damaged', ({ source, target, amount, type, dmg }) => {
    if (!['element', 'elemental'].includes(type) || !(amount > 0)) return;
    runtime.publish(type === 'element' ? 'elementDamage' : 'elementalDamage', { source, sourceUid: uid(source), target, targetUid: uid(target), element: dmg?.element ?? null,
      amount, sourceClass: type }, { sourceUid: uid(source) });
  });
  battle.on('death', ({ unit, reason, killer }) => {
    // Release the dead summon from its ledger before talent consumers recycle
    // it. Otherwise a full pre-death stock/field can reject a real recovery.
    if (unit?.kind === 'token' && reason === 'killed') runtime.publish('summonDied', { source: killer, sourceUid: uid(killer), target: unit, targetUid: uid(unit), reason }, { sourceUid: uid(killer) });
    else if (unit?.kind === 'token' && reason !== 'fusionAbsorbed') runtime.publish('summonExited', { source: unit.ownerUnit, sourceUid: uid(unit.ownerUnit), target: unit, targetUid: uid(unit), reason }, { sourceUid: uid(unit.ownerUnit) });
    if ((unit?.kind === 'token' || unit?.kind === 'device') && reason === 'killed') runtime.publish('summonDestroyed', { source: unit.ownerUnit ?? null, sourceUid: uid(unit.ownerUnit), target: unit, targetUid: uid(unit), killer, reason });
  });
}
