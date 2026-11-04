import { t, N_ } from '../../../shared/i18n.js';
import { populationLimit } from '../../../shared/assault/inventory.js';
// The Assault page model is deliberately DOM-free.  It keeps the page's server contract and
// renderer contract in one place so a URL resume, an action retry, and a renderer uid never
// acquire a second, client-only meaning.

const OBJECT = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
let opSequence = 0;

export const PHASES = Object.freeze({
  nodeChoice: N_('路线'), shop: N_('补给'), event: N_('事件'), rewards: N_('收藏品'),
  upgradeChoice: N_('干员升级'),
  battlePrep: N_('战斗准备'), battle: N_('战斗中'), ended: N_('本局结束'),
});

export function apiBase(href = globalThis.location?.href || 'http://localhost/assault.html') {
  return new URL('api/assault/', href);
}

export function runFromUrl(href = globalThis.location?.href || 'http://localhost/assault.html') {
  return new URL(href).searchParams.get('run');
}

export function hrefForRun(runId, href = globalThis.location?.href || 'http://localhost/assault.html') {
  const url = new URL(href);
  if (runId) { url.searchParams.set('run', runId); url.searchParams.delete('new'); }
  else { url.searchParams.delete('run'); url.searchParams.delete('new'); url.hash = ''; }
  return url.toString();
}

export function makeOpId(factory = globalThis.crypto?.randomUUID) {
  if (typeof factory === 'function') return factory.call(globalThis.crypto);
  opSequence += 1;
  return `assault-${Date.now().toString(36)}-${opSequence.toString(36)}`;
}

export function normalizeCatalog(packet) {
  const source = packet?.catalog?.runtime || packet?.catalog || packet?.runtime || null;
  const assets = packet?.assets || packet?.assetManifest || packet?.catalog?.assets || null;
  const nativeData = packet?.nativeData || packet?.catalog?.nativeData || null;
  return {
    runtime: source,
    nativeData,
    design: packet?.design || packet?.catalog?.design || null,
    assets,
    publicText: packet?.publicText || packet?.catalog?.publicText || null,
    canPlay: !!(source && nativeData && nativeData.chess && nativeData.enemies && nativeData.stages),
  };
}

export function catalogError(catalog) {
  if (!catalog?.runtime) return t('进击模式配置尚未加载，暂时无法开始。');
  if (!catalog.nativeData) return t('战斗数据尚未就绪，无法开始战斗；请稍后重新打开本页。');
  if (!catalog.nativeData.chess || !catalog.nativeData.enemies || !catalog.nativeData.stages) {
    return t('战斗数据不完整，无法安全开始；请让部署端补齐战斗配置。');
  }
  return null;
}

function hashString(value) {
  let h = 2166136261;
  for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Renderer prep pieces use integer ids.  Assault state ids remain the only authoritative ids;
// the two maps prevent collisions when a saved run contains non-numeric or merged identities.
export function createPieceUidMap(pieces = []) {
  const byUid = new Map();
  const byNumber = new Map();
  for (const piece of pieces) {
    if (!piece?.uid) continue;
    let number = hashString(piece.uid) || 1;
    while (byNumber.has(number) && byNumber.get(number) !== piece.uid) number = (number + 1) >>> 0 || 1;
    byUid.set(piece.uid, number);
    byNumber.set(number, piece.uid);
  }
  return Object.freeze({
    numberOf(uid) { return byUid.get(uid) ?? null; },
    uidOf(number) { return byNumber.get(Number(number)) ?? null; },
    entries() { return [...byUid.entries()]; },
  });
}

// The open detail follows its owned operator through every state update; once the operator left the inventory (sold,
// consumed by a merge, moved out by a swap) the panel closes. A shop card preview (`shop:` uid) was never owned.
export function reconcileDetail(current, pieces) {
  if (!current) return current;
  if (String(current.uid).startsWith('shop:')) return current;
  return pieces?.find((piece) => piece.uid === current.uid) ?? null;
}

export function isDeployed(piece) {
  return Number.isInteger(piece?.row) && Number.isInteger(piece?.col);
}

export function benchLayout(state, size = 12) {
  const off = (state?.pieces || []).filter((piece) => !isDeployed(piece));
  return { hand: off.slice(0, size), overflow: off.slice(size) };
}

export function activePopulation(state) {
  return (state?.pieces || []).filter(isDeployed).reduce((sum, piece) => sum + (piece.populationCost ?? 1), 0);
}

/** The deployment readout: population used by the deployed pieces / the cap (same rule as the server's assertInventory). */
export function deployCapacity(state, catalog) {
  return { used: activePopulation(state), cap: populationLimit(Number(state?.xp) || 0, { design: catalog?.design }) };
}

/**
 * Would deploying `piece` stay inside the cap?  Mirrors shared/assault/inventory.js assertInventory (sum of the deployed
 * pieces' populationCost <= limit), so the page refuses exactly the placements the server would refuse (POPULATION_FULL).
 * A piece that is already deployed only moves: it never needs more room.
 */
export function canDeployMore(state, catalog, piece) {
  if (!piece || isDeployed(piece)) return true;
  const { used, cap } = deployCapacity(state, catalog);
  return used + (piece.populationCost ?? 1) <= cap;
}

export function stablePrepView(state, map, size = 12) {
  const layout = benchLayout(state, size);
  const toRender = (piece, area, index) => ({
    uid: map.numberOf(piece.uid), kind: 'chess', id: piece.charId,
    tier: Number(piece.star) || 1, golden: Number(piece.star) >= 4,
    ...(area === 'board' ? { row: piece.row, col: piece.col, dir: rendererDirection(piece.dir || 'E') } : {}),
    assaultUid: piece.uid, area, index,
  });
  return {
    hand: Array.from({ length: size }, (_, index) => layout.hand[index] ? toRender(layout.hand[index], 'hand', index) : null),
    temp: [],
    board: (state?.pieces || []).filter(isDeployed).map((piece) => toRender(piece, 'board', -1)),
    nextEnemies: [],
  };
}

export function rendererDirection(direction) {
  return ({ N: 'UP', E: 'RIGHT', S: 'DOWN', W: 'LEFT' })[direction] || 'RIGHT';
}

export function modelDirection(direction) {
  return ({ UP: 'N', RIGHT: 'E', DOWN: 'S', LEFT: 'W' })[String(direction).toUpperCase()] || 'E';
}

function urlOf(value) { return typeof value === 'string' ? value : value?.url || null; }

const SPINE_METADATA_FIELDS = ['anims', 'animations', 'events', 'hits', 'bounds'];

function metadataValue(primary, fallback, field) {
  const value = primary?.[field];
  if (field === 'anims' && value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    const fallbackValue = fallback?.[field];
    if (fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) && Object.keys(fallbackValue).length === 0) return undefined;
    return fallbackValue;
  }
  return value ?? fallback?.[field];
}

function mergeSpineEntry(nativeEntry, assaultEntry) {
  if (!nativeEntry && !assaultEntry) return null;
  const entry = assaultEntry || {};
  const native = nativeEntry || {};
  const textures = Array.isArray(entry.textures) && entry.textures.length ? entry.textures
    : Array.isArray(native.textures) && native.textures.length ? native.textures : null;
  const merged = {
    ...native,
    ...entry,
    skel: urlOf(entry.skel) || urlOf(native.skel),
    atlas: urlOf(entry.atlas) || urlOf(native.atlas),
    textures: textures ? textures.map(urlOf).filter(Boolean) : [urlOf(entry.texture) || urlOf(native.texture)].filter(Boolean),
    pma: entry.pma ?? native.pma,
  };
  for (const field of SPINE_METADATA_FIELDS) {
    const value = metadataValue(entry, native, field);
    if (value !== undefined) merged[field] = value;
    else delete merged[field];
  }
  if (merged.pma === undefined) delete merged.pma;
  delete merged.texture;
  return merged;
}

function mergeSpineSides(nativeSpine, assaultSpine) {
  if (!nativeSpine && !assaultSpine) return null;
  if (nativeSpine?.kind === 'native-single-spine' || assaultSpine?.kind === 'native-single-spine') {
    return { ...(nativeSpine || {}), ...(assaultSpine || {}) };
  }
  return {
    front: mergeSpineEntry(nativeSpine?.front, assaultSpine?.front),
    back: mergeSpineEntry(nativeSpine?.back, assaultSpine?.back),
  };
}

function spineOf(model, nativeSpine = null) {
  if (!model && !nativeSpine) return null;
  model ||= {};
  const make = (entry) => entry ? {
    skel: urlOf(entry.skel), atlas: urlOf(entry.atlas),
    textures: Array.isArray(entry.textures) ? entry.textures.map(urlOf).filter(Boolean) : [urlOf(entry.texture)].filter(Boolean),
    ...(Object.fromEntries(SPINE_METADATA_FIELDS.filter(field => entry[field] !== undefined).map(field => [field, entry[field]]))),
    pma: entry.pma,
  } : null;
  return mergeSpineSides(nativeSpine, { front: make(model.front), back: make(model.back) });
}

function singleSpineOf(model, nativeSpine = null) {
  if (!model && !nativeSpine) return null;
  const make = (entry, nativeEntry) => entry || nativeEntry ? {
    ...(nativeEntry || {}), ...(entry || {}),
    skel: urlOf(entry?.skel) || urlOf(nativeEntry?.skel), atlas: urlOf(entry?.atlas) || urlOf(nativeEntry?.atlas),
    textures: Array.isArray(entry?.textures) ? entry.textures.map(urlOf).filter(Boolean)
      : Array.isArray(nativeEntry?.textures) ? nativeEntry.textures.map(urlOf).filter(Boolean)
        : [urlOf(entry?.texture) || urlOf(nativeEntry?.texture)].filter(Boolean),
    pma: entry?.pma ?? nativeEntry?.pma ?? false,
  } : null;
  const merged = make(model, nativeSpine);
  if (!merged) return null;
  for (const field of SPINE_METADATA_FIELDS) {
    const value = metadataValue(model, nativeSpine, field);
    if (value !== undefined) merged[field] = value;
    else delete merged[field];
  }
  delete merged.texture;
  return merged;
}

function ownManifest(raw) {
  const source = raw?.assets || raw || {};
  const chars = {};
  for (const [charId, entry] of Object.entries(source.units || {})) {
    chars[charId] = { avatar: urlOf(entry.avatar), portrait: urlOf(entry.portrait), spine: spineOf(entry.model) };
  }
  const tokens = {};
  for (const [tokenId, entry] of Object.entries(source.summons || source.tokens || {})) {
    tokens[tokenId] = { avatar: urlOf(entry.avatar), spine: singleSpineOf(entry.model || entry) };
  }
  for (const [derivedId, entry] of Object.entries(source.derivedModels || source.derivedTemplates || {})) {
    tokens[derivedId] = { avatar: urlOf(entry.avatar), spine: singleSpineOf(entry.model || entry) };
    if (entry.derivedTemplateId) tokens[entry.derivedTemplateId] = tokens[derivedId];
  }
  const skills = Object.fromEntries(Object.entries(source.skills || {}).map(([id, entry]) => [id, urlOf(entry)]).filter(([, url]) => url));
  // skill_table.json at source Git a550f5e: /skchr_jesica_1/iconId.
  // The shared Power Strike icon already exists in the native manifest; no guessed filename or new asset.
  const skillsById = { ...(source.skillsById || {}), skchr_jesica_1: 'skcom_powerstrike[2]' };
  return { chars, tokens, skills, skillsById, enemies: source.enemies || {}, ui: source.ui || {}, audio: source.audio || {} };
}

export function assaultAssets(raw, nativeManifest = null) {
  const own = ownManifest(raw);
  const base = nativeManifest?.assets || nativeManifest || {};
  return {
    ...base, ...own,
    chars: Object.fromEntries(Object.entries(own.chars).map(([id, entry]) => {
      const native = base.chars?.[id] || {};
      return [id, { ...native, ...entry, spine: spineOf(entry.spine, native.spine) }];
    }).concat(Object.entries(base.chars || {}).filter(([id]) => !Object.hasOwn(own.chars, id)))),
    tokens: Object.fromEntries(Object.entries(own.tokens).map(([id, entry]) => {
      const native = base.tokens?.[id] || {};
      return [id, { ...native, ...entry, spine: singleSpineOf(entry.spine, native.spine) }];
    }).concat(Object.entries(base.tokens || {}).filter(([id]) => !Object.hasOwn(own.tokens, id)))),
    skills: { ...(base.skills || {}), ...own.skills },
    skillsById: { ...(base.skillsById || {}), ...own.skillsById },
    prof: { ...(base.prof || {}), sub: { ...(base.prof?.sub || {}),
      ...Object.fromEntries(['traper', 'blessing', 'summoner', 'bearer', 'watchman', 'duelist']
        .map(id => [id, `assault-assets/prof/sub/${id}.png`])) } },
    enemies: { ...(base.enemies || {}), ...own.enemies },
    ui: { ...(base.ui || {}), ...own.ui },
    audio: { ...(base.audio || {}), ...own.audio },
  };
}

export function pieceRecord(catalog, piece) {
  const runtime = catalog?.runtime;
  return runtime?.bodies?.[piece?.charId] || runtime?.operators?.[piece?.charId] || null;
}

/**
 * The operator's original attack range for the detail card's 攻击范围 mini-map: the physical body's `range` (the
 * runtime's facing-RIGHT [dRow, dCol] offsets from the operator's own tile — dCol > 0 is in front, dRow > 0 is the row
 * above; the same grid server/modes/assault/context.js rotates with board.js ownerRangeKeys), else its simChess grid.
 * Only well-formed integer pairs are kept; null when the body has none.
 * @returns {number[][]|null}
 */
export function attackRangeOf(catalog, piece) {
  const body = pieceRecord(catalog, piece);
  const grid = Array.isArray(body?.range) && body.range.length ? body.range : body?.simChess?.rangeGrid;
  if (!Array.isArray(grid)) return null;
  const cells = grid.filter((cell) => Array.isArray(cell) && Number.isInteger(cell[0]) && Number.isInteger(cell[1]))
    .map(([row, col]) => [row, col]);
  return cells.length ? cells : null;
}

export function operatorRecord(catalog, piece) {
  return catalog?.runtime?.operators?.[piece?.purchaseCharId || piece?.charId] || pieceRecord(catalog, piece);
}

export function displayName(catalog, id, fallback = t('未命名')) {
  const text = catalog?.publicText;
  return text?.operators?.[id]?.name || catalog?.runtime?.operators?.[id]?.name || catalog?.runtime?.bodies?.[id]?.name || fallback;
}

export function avatarFor(catalog, id) {
  const item = catalog?.assets?.assets?.units?.[id] || catalog?.assets?.units?.[id];
  return urlOf(item?.avatarE2) || urlOf(item?.avatar) || catalog?.assets?.chars?.[id]?.avatar || null;
}

export function portraitFor(catalog, id) {
  const item = catalog?.assets?.assets?.units?.[id] || catalog?.assets?.units?.[id];
  return urlOf(item?.portraitE2) || urlOf(item?.portrait) || catalog?.assets?.chars?.[id]?.portrait || null;
}

export function designEntry(catalog, group, id) {
  const list = catalog?.design?.[group]?.[group === 'system' ? 'directors' : group === 'collectibles' ? 'items' : group] || [];
  return list.find((entry) => entry.id === id) || null;
}

export function encounterById(catalog, id) {
  const entry = catalog?.design?.encounters?.encounters?.find((item) => item.id === id) || null;
  const copy = catalog?.publicText?.encounters?.[id];
  return entry ? { ...entry, ...(copy || {}) } : copy ? { id, ...copy } : null;
}

export function displayEncounterTitle(name) {
  return String(name || '').replace(/^战场#\d+\s*·\s*/, '').trim();
}

function sourceRecord(map, key) {
  if (Array.isArray(map)) return map.find((entry) => entry?.key === key || entry?.id === key) || null;
  return map?.[key] || null;
}

// Build a compact preview from the encounter's authored wave and its native sources.
// This is deliberately informational: it never resolves or mutates a run choice.
export function encounterPreview(catalog, encounter) {
  const spawns = encounter?.wave?.spawns;
  if (!Array.isArray(spawns)) return [];
  const groups = new Map();
  for (const spawn of spawns) {
    const key = spawn?.key || spawn?.enemyKey || spawn?.bossId;
    if (!key) continue;
    const group = groups.get(key) || { key, count: 0 };
    const amount = Number(spawn.count);
    group.count += Number.isFinite(amount) && amount > 0 ? amount : 1;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const native = sourceRecord(catalog?.nativeData?.enemies, group.key)
      || sourceRecord(catalog?.nativeData?.bosses, group.key);
    const override = encounter.wave.overrides?.[group.key]?.stats || {};
    const nativeHp = Number(native?.stats?.maxHp);
    let hp = null;
    if (Number.isFinite(override.sharedPoolHp)) hp = override.sharedPoolHp;
    else if (Number.isFinite(override.maxHp)) {
      hp = override.hpMode === 'absolute' ? override.maxHp : nativeHp * override.maxHp;
    } else if (Number.isFinite(nativeHp)) hp = nativeHp;
    const motion = native?.stats?.motion;
    const flying = native?.isFlyEnemy === true || motion === 'FLY';
    const leakDamage = Number.isFinite(native?.stats?.lpr) ? native.stats.lpr : null;
    return {
      key: group.key,
      count: group.count,
      name: native?.name || t('暂未提供'),
      movement: native ? (flying ? t('飞行') : t('地面')) : t('暂未提供'),
      hp,
      hpLabel: group.key.startsWith('boss_') || Number.isFinite(override.sharedPoolHp) ? t('共享生命') : t('生命'),
      leakDamage,
      description: native?.desc || '',
    };
  });
}
export function relicById(catalog, id) {
  const entry = catalog?.design?.collectibles?.items?.find((item) => item.id === id) || null;
  const copy = catalog?.publicText?.collectibles?.[id];
  return entry ? { ...entry, ...(copy || {}) } : copy ? { id, ...copy } : null;
}

function tilePair(value) {
  if (Array.isArray(value) && value.length === 2 && value.every(Number.isInteger)) return value;
  if (typeof value === 'string') {
    const match = value.match(/^(-?\d+),(-?\d+)$/);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  if (value && Number.isInteger(value.row) && Number.isInteger(value.col)) return [value.row, value.col];
  return null;
}

function deployTilesFrom(field, state) {
  const entries = field?.deployTiles || state?.board?.deployTiles;
  if (Array.isArray(entries)) {
    return new Map(entries.map((entry) => {
      const pair = tilePair(entry?.key ?? entry);
      return pair ? [`${pair[0]},${pair[1]}`, entry?.type || 'melee'] : null;
    }).filter(Boolean));
  }
  const region = field?.boardRegion || state?.currentNode?.boardRegion;
  const rows = region?.playerRows || [9, 10, 11, 12];
  const cols = region?.playerCols || [2, 3, 4, 5, 6, 7, 8, 9, 10];
  return new Map(rows.flatMap((row) => cols.map((col) => [`${row},${col}`, 'melee'])));
}

function piecePositionClass(piece) {
  const value = String(piece?.position || piece?.deployType || piece?.type || '').toLowerCase();
  return value === 'ranged' || value === 'high' ? 'ranged' : value === 'all' ? 'all' : 'melee';
}

export function legalTilesFor(piece, state, field = null) {
  if (!piece) return [];
  const board = deployTilesFrom(field, state);
  const explicit = Array.isArray(piece.legalTiles) ? piece.legalTiles.map(tilePair).filter(Boolean) : null;
  const candidates = explicit !== null ? explicit : [...board.keys()].map(tilePair);
  const placement = piecePositionClass(piece);
  const occupied = new Set((state?.pieces || []).filter((p) => p.uid !== piece?.uid && isDeployed(p)).map((p) => `${p.row},${p.col}`));
  return candidates.filter(([row, col]) => {
    const type = board.get(`${row},${col}`);
    if (!type || occupied.has(`${row},${col}`)) return false;
    return explicit !== null || placement === 'all' || placement === type;
  });
}

export function battlePrepStatus(state, field = state?.board) {
  const invalidPieces = (state?.pieces || []).filter((piece) => isDeployed(piece)
    && !legalTilesFor(piece, state, field).some(([row, col]) => row === piece.row && col === piece.col));
  return { invalidPieces, canStart: activePopulation(state) > 0 && invalidPieces.length === 0 };
}

export function deploymentControlActions(entry, state, { onAdjust, onBench } = {}) {
  if (state?.phase !== 'battlePrep' || entry?.kind !== 'operator') return null;
  const piece = (state?.pieces || []).find((item) => item.uid === entry.uid && isDeployed(item));
  if (!piece) return null;
  return {
    adjust: typeof onAdjust === 'function' ? () => onAdjust(piece) : null,
    bench: typeof onBench === 'function' ? () => onBench(piece.uid) : null,
  };
}

export function summonTemplateOptions(catalog, piece) {
  const body = pieceRecord(catalog, piece);
  const effects = (body?.fixedSkill?.effects || []).filter((effect) => effect.action === 'summon' || effect.action === 'device');
  const summons = catalog?.runtime?.summons || {};
  const derived = catalog?.runtime?.derivedTemplates || {};
  const options = [];
  if (body?.adaptation?.marker) options.push({ tokenId: body.adaptation.marker.id, name: body.adaptation.marker.name, position: body.adaptation.marker.position });
  // Deployment talents (notably Muelsyse's manifold) live outside fixedSkill.
  const selectable=['char_249_mlyss','char_2023_ling','char_242_otter','char_254_vodfox','char_4117_ray','char_108_silent','char_1034_jesca2','char_4072_ironmn','char_484_robrta',...(body?.adaptation ? ['char_1041_angel2','char_427_vigil'] : [])];
  const manual=body?.adaptation?.manualSummons;
  if(Array.isArray(manual)||selectable.includes(piece.charId))for(const id of (manual?.map(entry=>entry.tokenId)??body?.summonTemplateIds??[])) {
    const record=summons[id];
    if(record)options.push({tokenId:id,name:record.name||t('召唤物'),position:record.position,
      max:manual?.find(entry=>entry.tokenId===id)?.max??body?.adaptation?.values?.field??1});
  }
  for (const effect of effects) {
    const values = effect.values || {};
    const tokenId = values.tokenKey || values.tokenId || null;
    const names = Array.isArray(values.summonName) ? values.summonName : [values.summonName, values.tokenName, values.deviceName].filter(Boolean);
    const candidates = tokenId ? [tokenId] : Object.keys(summons).filter((id) => names.includes(summons[id]?.name)
      || (effect.action === 'device' && piece.charId === 'char_484_robrta' && id === 'token_10018_robrta_mach'));
    for (const id of candidates) {
      const record = summons[id] || derived[id];
      if (!record) continue;
      options.push({ tokenId: id, name: record.name || names[0] || t('召唤物'), position: record.position, source: effect.description });
    }
  }
  const selectedToken=piece.charId==='char_2023_ling'?body.source?.skills?.find(skill=>skill.skillId===body.fixedSkill.sourceSkillId)?.overrideTokenKey
    :piece.charId==='char_4072_ironmn'?'token_10027_ironmn_pile2':null;
  return options.filter((option, index, all) => (!selectedToken||option.tokenId===selectedToken)&&all.findIndex((item) => item.tokenId === option.tokenId) === index);
}

export function legalSummonTilesFor(piece, tokenId) {
  return (piece?.summonLegalTiles?.[tokenId] ?? []).map(tilePair).filter(Boolean);
}

export function professionLabel(value) {
  return ({ PIONEER: t('先锋'), WARRIOR: t('近卫'), TANK: t('重装'), SNIPER: t('狙击'), CASTER: t('术师'), MEDIC: t('医疗'), SUPPORT: t('辅助'), SPECIAL: t('特种') })[value] || value || t('干员');
}

// 本局成长 / 本场叠加 / 可阻挡空中敌人 for the detail card. Growth sits in the piece's permanent maps (saves without any
// count 0); the battle part reads the live battle (synergy.js battleStack ledger and the granted air-block buffs).
// msgids of the cards' own counters (synergy.js battleCounter / runCounter labels): listed here so the language packs and
// tools/i18n.mjs know them; a card that adds a counter adds its label here and in every public/i18n pack
export const COUNTER_LABELS = Object.freeze([N_('止戈伤害加成'),
  N_('待命协击'),
  N_('近距离作战指导'),
  N_('责骂攻击速度加成'),
  N_('索敌援助攻击速度'),
  N_('谨慎择客'),
  N_('夹子伤害'),
  N_('折纸生花伤害'),
  N_('凋敝魂灵'),
  N_('剑雨滂沱伤害'),
  N_('轰炸伤害'),
  N_('阿戈尔的波涛每秒回复'),
  N_('视界攻击速度'),
  N_('巨力重拳几率'),
  N_('入隙伤害'),
  N_('生存的重压攻击力'),
  N_('黄昏攻击力加成'),
  N_('不畏苦暗伤害'),
  N_('触礁伤害'),
  N_('贵族血统脆弱'),
  N_('诚挚期许生命上限加成'),
  N_('闪避后攻击力加成'),
  N_('弱肉强食攻击力'),
  N_('深海掠食者'),
  N_('弥漫莲香'),
  N_('月盈星亏攻击速度上限'),
  N_('青色怒火'),
  N_('弹药上限'),
  N_('熏衣香治疗量'),
  N_('治愈水波治疗量'),
  N_('技力光环'),
  N_('受到治疗效果提升'),
  N_('剑雨伤害'),
  N_('狙击支援攻击速度'),
  N_('看天时生命加成'),
  N_('强化注射攻击速度'),
  N_('治疗量'),
  N_('土壤基肥改良'),
  N_('博览古卷屏障'),
  N_('追凶伤害'),
  N_('不退之旗攻击速度'),
  N_('流形攻击力'),
  N_('火山灰疗愈生命上限加成'),
  N_('火球伤害'),
  N_('重构体光环攻击力'),
  N_('军事要塞'),
  N_('礼尚往来伤害'),
  N_('先锋每秒回复生命'),
  N_('蛮力穿刺攻击力加成'),
  N_('万兽之王加成'),
  N_('特种作战策略防御力加成'),
  N_('狼影攻击力'),
  N_('播种每秒回复'),
  N_('停顿时间'),
  N_('尖钉伤害'),
  N_('虚弱化脆弱'),
  N_('溃败暗示脆弱'),
  N_('测绘器材脆弱'),
  N_('裂云兽伤害'),
  N_('机械水獭强化'),
  N_('精神逆构'),
  N_('积雪伤害'),
  N_('熔点引爆伤害'),
  N_('坚冰脆弱'),
  N_('剜魂具辞伤害加深'),
  N_('受治疗提升'),
]);
const GROWTH_STATS = ['maxHp', 'atk', 'def', 'res', 'aspd', 'blockCnt', 'spRecovery', 'cost', 'respawnTime'];
const AIR_BLOCK_BUFF = 'assault:airBlock:';
export function statLabel(stat) {
  return ({ maxHp: t('生命上限'), atk: t('攻击'), def: t('防御'), res: t('法术抗性'), aspd: t('攻击速度'), blockCnt: t('阻挡数'),
    spRecovery: t('技力回复'), cost: t('部署费用'), respawnTime: t('再部署时间') })[stat] || t('属性');
}
const growthOrder = (a, b) => ((GROWTH_STATS.indexOf(a.stat) + 1 || 99) - (GROWTH_STATS.indexOf(b.stat) + 1 || 99))
  || (a.mode === b.mode ? 0 : a.mode === 'flat' ? -1 : 1);
const shown = (mode, value) => (mode === 'percent' ? Math.round(value * 1000) / 10 : Math.round(value));
/** The amount of a 累计增益 row as the card shows it: +N, +N% (percent rows and '%' counters), +N<unit> for a counter's
 * own unit (秒 …, through t() so it follows the language). */
export function growthAmountText({ mode, amount, suffix = '' }) {
  const unit = mode === 'percent' ? '%' : mode === 'counter' && suffix ? (suffix === '%' ? '%' : t(suffix)) : '';
  return `+${amount}${unit}`;
}

export function growthView(piece, battle = null) {
  const run = [];
  for (const [stat, value] of Object.entries(piece?.permanentFlat ?? {})) if (Number.isFinite(value) && shown('flat', value)) run.push({ stat, mode: 'flat', amount: shown('flat', value) });
  for (const [stat, value] of Object.entries(piece?.permanentPercent ?? {})) if (Number.isFinite(value) && shown('percent', value)) run.push({ stat, mode: 'percent', amount: shown('percent', value) });
  const runCounters = Object.values(piece?.permanentCounters ?? {}).filter((e) => Number.isFinite(e?.amount) && e.amount && typeof e.label === 'string')
    .map((e) => ({ stat: 'counter', mode: 'counter', label: e.label, suffix: e.suffix ?? '', amount: Math.round(e.amount * 100) / 100 }));
  const totals = new Map(), counters = [];
  for (const entry of Object.values(battle?.assaultBattleStacks?.[piece?.uid] ?? {})) {
    // 卡内本场叠加 (synergy.js battleCounter): its own label and suffix, listed after the stat rows
    if (entry.mode === 'counter') { if (entry.amount) counters.push({ stat: 'counter', mode: 'counter', label: entry.label, suffix: entry.suffix ?? '', amount: Math.round(entry.amount * 100) / 100 }); continue; }
    const id = `${entry.stat}:${entry.mode}`;
    totals.set(id, { stat: entry.stat, mode: entry.mode, value: (totals.get(id)?.value ?? 0) + entry.amount });
  }
  const fight = [...totals.values()].map(({ stat, mode, value }) => ({ stat, mode, amount: shown(mode, value) })).filter((row) => row.amount);
  const unit = battle?.allyUnits?.find((u) => u.uid === piece?.uid && u.kind === 'op' && u.alive);
  const airBlock = unit?.s?.flags?.liftoff ? 'liftoff' : (unit?.buffs ?? []).some((b) => String(b.key).startsWith(AIR_BLOCK_BUFF)) ? 'granted' : null;
  return { run: [...run.sort(growthOrder), ...runCounters], battle: [...fight.sort(growthOrder), ...counters], airBlock };
}

export function rarityLabel(value) {
  return ({ common: t('普通'), rare: t('稀有'), epic: t('史诗') })[value] || value || t('收藏品');
}

export function outcomeText(effect) {
  if (!effect) return '';
  const amount = effect.amount ?? effect.count;
  const sign = Number(amount) >= 0 ? '+' : '';
  return ({ gold: t('金币 {sign}{amount}', { sign, amount }), xp: t('经验 {sign}{amount}', { sign, amount }), hp: t('生命 {sign}{amount}', { sign, amount }), repair: t('下一场获得保护'), enhance: t('下一场获得强化'), relicChoice: t('从收藏品中选择'), recruit: t('招募一名干员'), redeploy: t('下一场首次再部署免费'), tag: t('队伍获得标签'), shopDiscount: t('商店折扣 {sign}{amount}', { sign, amount }) })[effect.kind] || null;
}

export function eventTargetPayload(choice, target = null) {
  const mode = choice?.targeting?.mode || 'none';
  if (mode === 'none') return {};
  if (mode === 'selectTeam') return target?.targetUid ? { targetUid: target.targetUid } : null;
  if (mode === 'recruit') {
    if (!target?.targetUid) return null;
    if (choice.targeting?.selection !== 'random' && !target.filterTag) return null;
    return { targetUid: target.targetUid, ...(target.filterTag ? { filterTag: target.filterTag } : {}) };
  }
  return null;
}

export function formChoices(catalog, piece) {
  const operator = operatorRecord(catalog, piece);
  return [piece?.purchaseCharId, ...(operator?.extraForms || [])].filter(Boolean);
}

export function advancedModules(catalog, piece) {
  return (pieceRecord(catalog, piece)?.modulePlans || []).filter((plan) => plan.type === 'ADVANCED').map((plan) => ({
    ...plan, unlockStar: plan.translation?.unlockStar ?? plan.unlockStar ?? 3,
  }));
}

export function errorMessage(error) {
  if (error?.code === 'INVALID_TILE') return t('这个位置无法部署，请选择可用地块。');
  if (error?.code === 'SHOP_REFRESH_LIMIT') return t('本次补给已刷新');
  return error?.message ? t(error.message) : t('操作没有完成，请检查当前局面后重试。');
}

export function publicStateFromResponse(response) {
  return response?.state || response?.run?.state || null;
}
