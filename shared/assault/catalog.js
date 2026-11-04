// Shared assault runtime DTO accessors. Stage/enemy/boss/wave content remains in the 0.2.2 data maps.

export function assertAssaultCatalog(runtime) {
  if (!runtime || runtime.schema !== 'assault-runtime/v1') throw new TypeError('Unsupported assault runtime catalog');
  if (Object.keys(runtime.operators ?? {}).length !== 170) throw new Error('Assault catalog must have 170 purchase identities');
  if (Object.keys(runtime.bodies ?? {}).length !== 172) throw new Error('Assault catalog must have 172 physical bodies');
  if (Object.keys(runtime.encounters ?? {}).length !== 36) throw new Error('Assault catalog must have 36 encounter references');
  return runtime;
}

export function getAssaultOperator(runtime, purchaseCharId) {
  assertAssaultCatalog(runtime);
  return runtime.operators[purchaseCharId] ?? null;
}

export function getAssaultBody(runtime, charId) {
  assertAssaultCatalog(runtime);
  return runtime.bodies[charId] ?? null;
}

/** Make a DataSource-compatible assault view without cloning enemy, boss, stage, or wave truth. */
export function toAssaultSimData(runtime, sharedData) {
  assertAssaultCatalog(runtime);
  for (const key of ['tokens', 'enemies', 'bosses', 'stages', 'waves']) {
    if (!sharedData || !sharedData[key] || typeof sharedData[key] !== 'object') {
      throw new TypeError(`Missing shared 0.2.2 ${key} data for assault`);
    }
  }
  const chess = {};
  for (const [charId, body] of Object.entries(runtime.bodies)) {
    if (body.charId !== charId || body.simChess?.charId !== charId) {
      throw new Error(`Assault body ${charId} has an invalid physical profile`);
    }
    chess[charId] = body.simChess;
  }
  const tokens = {};
  for (const [tokenId, token] of Object.entries(runtime.summons)) {
    tokens[tokenId] = { tokenId, ...token };
  }
  return {
    chess,
    tokens,
    enemies: Object.keys(runtime.auxiliaryEnemies ?? {}).length
      ? { ...sharedData.enemies, ...runtime.auxiliaryEnemies } : sharedData.enemies,
    bosses: sharedData.bosses,
    stages: sharedData.stages,
    waves: sharedData.waves,
  };
}
