const ID_PATTERN = /^(char_|token_|uniequip_)[a-zA-Z0-9_]+$/;

export function parseAssetScope(argv) {
  const scoped = argv.filter((arg) => arg.startsWith('--ids='));
  if (scoped.length > 1 || argv.some((arg) => !['--plan', '--acquire', '--native-local-only'].includes(arg) && !arg.startsWith('--ids='))) {
    throw new Error('usage: node tools/assault/assets-acquire.mjs [--plan|--acquire] [--native-local-only] [--ids=id1,id2,...]');
  }
  if (!scoped.length) return null;
  const ids = new Set(scoped[0].slice('--ids='.length).split(',').map((id) => id.trim()).filter(Boolean));
  if (!ids.size || [...ids].some((id) => !ID_PATTERN.test(id))) throw new Error('--ids must be a non-empty comma-separated list of native character/token/equipment IDs');
  return ids;
}

export function assertKnownAssetScope(ids, knownIds) {
  for (const id of ids || []) if (!knownIds.has(id)) throw new Error(`unknown --ids entry: ${id}`);
}

export function assertNativeLocalOnlyScope(ids, expectedId) {
  if (!ids || ids.size !== 1 || !ids.has(expectedId)) {
    throw new Error(`--native-local-only requires exactly --ids=${expectedId}`);
  }
}

export function mergeIncrementalManifest(existing, addition, ids) {
  if (!ids) return addition;
  const merged = { ...existing, ...addition, assets: {} };
  for (const section of ['units', 'summons', 'derivedModels', 'collectibles', 'events', 'skills', 'modules']) {
    merged.assets[section] = { ...(existing.assets?.[section] || {}), ...(addition.assets?.[section] || {}) };
  }
  merged.missing = { ...(existing.missing || {}), ...(addition.missing || {}) };
  merged.incremental = { ids: [...ids].sort(), preservedExistingMappings: true };
  return merged;
}
