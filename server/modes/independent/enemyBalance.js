/** Additional Workshop tuning. Upstream enemy definitions and other modes stay authoritative. */
export function independentEnemyBalance(state, catalog) {
  const difficulty = String(state.difficulty ?? 'NORMAL').toUpperCase();
  const growthMode = String(state.growthMode ?? catalog?.config?.defaultGrowthMode ?? 'badges').toLowerCase();
  const stages = catalog?.config?.enemyBalanceByGrowthMode?.[growthMode]?.[difficulty]
    ?? catalog?.config?.enemyBalance?.[difficulty];
  if (!stages) return null;
  if (!Array.isArray(stages) || !stages.length) throw new TypeError('BAD_INDEPENDENT_ENEMY_BALANCE');
  let chosen = null;
  let previous = 0;
  for (const stage of stages) {
    if (!Number.isInteger(stage.fromRound) || stage.fromRound < 1 || stage.fromRound <= previous) throw new TypeError('BAD_INDEPENDENT_ENEMY_BALANCE_ROUND');
    previous = stage.fromRound;
    for (const key of ['hpMul', 'atkMul', 'defMul', 'resMul', 'bossHpMul']) {
      if (stage[key] !== undefined && (!Number.isFinite(stage[key]) || stage[key] <= 0)) throw new TypeError(`BAD_INDEPENDENT_ENEMY_BALANCE_${key}`);
    }
    if (stage.fromRound <= state.round) chosen = stage;
  }
  return chosen;
}

export function balanceIndependentWave(wave, tuning) {
  if (!tuning) return wave;
  return {
    ...wave,
    spawns: wave.spawns.map(spec => {
      const mods = { ...spec.mods };
      for (const key of ['hpMul', 'atkMul', 'defMul', 'resMul']) {
        // A leader uses its shared pool; only its parts and escorts take hpMul.
        if (key === 'hpMul' && spec.preview?.boss) continue;
        mods[key] = Number(mods[key] ?? 1) * Number(tuning[key] ?? 1);
      }
      return { ...spec, mods };
    }),
  };
}
