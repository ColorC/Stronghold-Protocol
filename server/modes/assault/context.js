import { getAssaultData, getAssaultEncounter, loadAssaultDesign } from './data.js';
import { createAssaultBattle, getAssaultField, prepareAssaultBattle, runAssaultBattle } from './battle.js';
import { canPlace, legalTiles, ownerRangeKeys, positionClass, tileKey } from '../../match/board.js';
import { assaultNativeDirection } from '../../../shared/assault/battle-input.js';
import { viewRun } from '../../../shared/assault/run.js';
import { assaultKits } from '../../sim/content/assault/cards/registry.js';
import { installRelics } from '../../sim/content/assault/relics.js';

const NATIVE_KEYS = ['chess', 'enemies', 'tokens', 'bosses', 'stages', 'waves', 'assets'];
const sourceFields = new Set(['sourcePath', 'sourceRoot', 'reusedRoot', 'tempRoot', 'sourceRel', 'sourceUrl', 'sourceUrls', 'sourceVersion', 'source', 'sources', 'note', 'generatedBy', 'mappings', 'missing']);
function assetView(value) {
  if (Array.isArray(value)) return value.map(assetView);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sourceFields.has(key)).map(([key, item]) => [key, assetView(item)]));
  return value;
}

// Store and browser both consume the same prepared snapshot. Gold-derived buffs
// belong to this snapshot, rather than to the live run after the next action.
export function withAssaultPreparedInputs(prepared) {
  if (!prepared?.input) throw new TypeError('assault prepared input is missing');
  return { ...prepared, input: { ...prepared.input,
    derivedBuffInputs: prepared.derivedBuffInputs ?? prepared.input.derivedBuffInputs ?? [] } };
}

export function createAssaultContext({ data = null, runtime = null, design = null, kits = assaultKits,
  relicInstaller = installRelics, assetManifest = null, publicText = null } = {}) {
  const loaded = getAssaultData({ nativeData: data, runtime });
  const context = { ...loaded, catalog: loaded.runtime, design: design ?? loadAssaultDesign(), kits,
    assetManifest: assetView(assetManifest ?? loaded.nativeData['assault-assets'] ?? {}),
    publicText: publicText ?? loaded.nativeData['assault-public-text'] ?? null };
  context.browserNativeData = Object.fromEntries(NATIVE_KEYS.filter((key) => loaded.nativeData[key] != null)
    .map((key) => [key, loaded.nativeData[key]]));
  const fieldCache = new Map();
  const encounterFor = (state) => {
    const encounterId = state.currentNode?.kind === 'battle' ? state.currentNode.encounterId : state.prepEncounterId;
    return encounterId ? getAssaultEncounter(context.design, encounterId)
      : context.design.encounters.encounters.find((entry) => entry.kind === 'normal');
  };
  const fieldFor = (state) => {
    const encounter = encounterFor(state);
    if (!encounter) throw new Error('assault has no preparation field');
    const key=`${state.mapEncounterId??''}:${encounter.id}`;
    if (!fieldCache.has(key)) fieldCache.set(key,
      getAssaultField(state, encounter, { data: loaded.nativeData, runtime: loaded.runtime, design: context.design }));
    return fieldCache.get(key);
  };
  context.fieldFor = fieldFor;
  context.canPlace = (state, piece, row, col) => {
    const body = loaded.runtime.bodies[piece.charId];
    if (!body) throw new Error(`unknown assault body ${piece.charId}`);
    return canPlace(fieldFor(state).normalizedDeployMap, positionClass(body.simChess), row, col);
  };
  context.canPlaceSummon = (state, piece, row, col, action = {}) => {
    const tokenId = action.tokenId ?? action.summonId;
    const body = loaded.runtime.bodies[piece.charId];
    const marker = body?.adaptation?.marker;
    if (marker?.id === tokenId) return piece.row != null && piece.col != null
      && canPlace(fieldFor(state).normalizedDeployMap, marker.assaultPlacementClass, row, col);
    const token = loaded.runtime.summons[tokenId] ?? Object.values(loaded.runtime.derivedTemplates ?? {})
      .find((entry) => entry.derivedTemplateId === tokenId);
    if (!token || !body || piece.row == null || piece.col == null) return false;
    if (!(body.summonTemplateIds ?? []).includes(tokenId)
      && !(token.ownerCharId === piece.charId && token.derivedTemplateId === tokenId)) return false;
    // Compiled templates retain the native placement constraints separately
    // from their normalized combat statistics.
    const source = token.sourceTemplate ?? token;
    if (!canPlace(fieldFor(state).normalizedDeployMap, positionClass(source), row, col)) return false;
    const manual = body.adaptation?.manualSummons?.find(entry => entry.tokenId === tokenId);
    if (manual && action.index != null && (piece.summonPresets ?? []).filter((p,index) => index !== action.index && p?.tokenId === tokenId).length >= manual.max) return false;
    const dr = Math.abs(row - piece.row), dc = Math.abs(col - piece.col);
    if (manual?.scope === 'adjacent4' && dr + dc !== 1) return false;
    if (manual?.scope === 'adjacent8' && (Math.max(dr, dc) !== 1)) return false;
    const grid=manual?.scope==='skillRange'?body.adaptation.rangeGrid:body.range??body.simChess.rangeGrid;
    const range = ownerRangeKeys(grid, piece.row, piece.col, assaultNativeDirection(piece.dir));
    const inRange = range.has(tileKey(row, col));
    if ((source.ownerRange || ['ownerRange','skillRange'].includes(manual?.scope)) && !inRange) return false;
    if (source.ownerRangeOutside && inRange) return false;
    return !state.pieces.some((other) => other.row === row && other.col === col)
      && !state.pieces.some(other=>(other.summonPresets??[]).some((preset,index)=>preset&&preset.row===row&&preset.col===col
        && !(other.uid===piece.uid&&(action.index==null?preset.tokenId===tokenId:index===action.index))));
  };
  context.summonOccupiesTile = (_state, piece, preset) => {
    const marker = loaded.runtime.bodies[piece.charId]?.adaptation?.marker;
    return marker?.id === preset.tokenId ? marker.occupiesTile === true : true;
  };
  context.install = (battle, prepared) => relicInstaller(battle, withAssaultPreparedInputs(prepared),
    { runtime: loaded.runtime, design: context.design });
  context.prepareBattle = (state, encounter) => prepareAssaultBattle(state, encounter, context);
  context.settleBattle = (_state, prepared) => runAssaultBattle(withAssaultPreparedInputs(prepared), context);
  context.view = (state) => {
    const result = viewRun(state, context);
    const field = fieldFor(state);
    result.board = { stageId: field.stageId, field: field.field, encounterId: field.encounterId,
      deployTiles: [...field.normalizedDeployMap].map(([key, type]) => ({ key, type })) };
    result.pieces = result.pieces.map((piece) => {
      const body = loaded.runtime.bodies[piece.charId];
      const summonIds = [...new Set([...(body.summonTemplateIds ?? []),
        ...(body.adaptation?.marker ? [body.adaptation.marker.id] : []),
        ...Object.values(loaded.runtime.derivedTemplates ?? {}).filter((template) => template.ownerCharId === piece.charId)
          .map((template) => template.derivedTemplateId)])];
      const candidates = [...field.normalizedDeployMap.keys()].map((key) => key.split(',').map(Number));
      return { ...piece, legalTiles: legalTiles(field.normalizedDeployMap, positionClass(body.simChess)),
        summonLegalTiles: Object.fromEntries(summonIds.map((tokenId) => [tokenId,
          candidates.filter(([row, col]) => context.canPlaceSummon(state, piece, row, col, { tokenId }))])) };
    });
    if (state.phase === 'battlePrep' && state.pieces.some((piece) => piece.row != null
      && loaded.runtime.bodies[piece.charId]?.deployAnchors?.length)) {
      // Read native quotes without starting a fight or consuming any fee.
      const quoteBattle = createAssaultBattle(context.prepareBattle(state, encounterFor(state)), context);
      result.deploymentArea = quoteBattle.assaultDeploymentArea('assault').map((entry) => ({
        kind: entry.kind, uid: entry.unit?.uid ?? entry.id,
        charId: entry.unit?.def?.charId ?? null,
        name: entry.unit?.name ?? entry.name, deployCost: entry.deployCost,
      }));
    }
    return result;
  };
  return context;
}
