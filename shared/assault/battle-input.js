import { toAssaultSimData } from './catalog.js';
import { GEO } from '../constants.js';
import { projectTemporaryStats } from './temporary-enhancements.js';
import { effectiveEnchantmentId } from './temporary-enchantments.js';
import { abilityBonuses } from './temporary-abilities.js';
import { relicEffectParams } from './relic-rules.js';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => Array.isArray(value) ? value.map(clone) : object(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value;
const recordsBy = (value, key) => Array.isArray(value) ? Object.fromEntries(value.map((item) => [item?.[key], item]).filter(([id]) => id != null)) : value;
const NATIVE_DIRECTIONS = Object.freeze({ N: 'UP', E: 'RIGHT', S: 'DOWN', W: 'LEFT' });
/** Resolve the exact native wave id recorded by an encounter's source reference. */
export function assaultWaveSourceId(encounter) {
  const ref = encounter?.waveSourceRef;
  if (ref == null) return null;
  if (!object(ref) || typeof ref.file !== 'string' || typeof ref.pointer !== 'string') throw new TypeError('invalid assault wave source reference');
  const file = ref.file.replaceAll('\\', '/').toLowerCase();
  if (file !== 'data/waves.json' && !file.endsWith('/data/waves.json')) throw new Error(`unsupported assault wave source file ${ref.file}`);
  const match = ref.pointer.match(/^\/((?:[^/~]|~[01])+)$/);
  if (!match) throw new Error(`invalid assault wave source pointer ${ref.pointer}`);
  return match[1].replaceAll('~1', '/').replaceAll('~0', '~');
}
/** Select the exact native wave variant under the simulator's player-count rule. */
export function assaultNativeTemplateId(sourceWaveId, waveRecords, playerCount = 1) {
  if (typeof sourceWaveId !== 'string' || !sourceWaveId || sourceWaveId.endsWith('_s')
      || !Number.isInteger(playerCount) || playerCount < 1) throw new TypeError('invalid assault native wave identity or player count');
  const waves = recordsBy(waveRecords, 'id');
  const source = waves[sourceWaveId];
  if (!source || source.id !== sourceWaveId || source.solo !== false) throw new Error(`invalid assault source wave ${sourceWaveId}`);
  const solo = playerCount <= 1;
  const nativeTemplateId = solo ? `${sourceWaveId}_s` : sourceWaveId;
  const variant = waves[nativeTemplateId];
  if (!variant || variant.id !== nativeTemplateId || variant.kind !== source.kind || variant.bossId !== source.bossId
      || variant.solo !== solo || (solo && !nativeTemplateId.endsWith('_s'))) {
    throw new Error(`invalid native ${solo ? 'solo' : 'multiplayer'} wave variant ${nativeTemplateId} for ${sourceWaveId}`);
  }
  return nativeTemplateId;
}
export function assaultNativeDirection(direction = 'E') {
  const native = NATIVE_DIRECTIONS[direction] ?? direction;
  if (!['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(native)) throw new TypeError(`invalid assault direction ${direction}`);
  return native;
}
/** `wave.dayScale[day]` = { k, atk, hp, speed } of this encounter (absent on older waves = no day strength); a day outside the table takes the nearest entry. */
export function enemyDayScale(wave, day) {
  const table = wave?.dayScale;
  if (!table || typeof table !== 'object') return null;
  const days = Object.keys(table).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  if (!days.length) return null;
  const wanted = Number.isFinite(Number(day)) ? Number(day) : days[0];
  const entry = table[String(days.reduce((best, d) => (Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best), days[0]))];
  return { k: finite(entry.k, 'dayScale k'), atk: finite(entry.atk, 'dayScale atk'), hp: finite(entry.hp, 'dayScale hp'), speed: finite(entry.speed, 'dayScale speed') };
}
const finite = (n, label) => { const v = Number(n); if (!Number.isFinite(v)) throw new TypeError(`invalid assault ${label}`); return v; };

/** Project native multiplayer wave entrances onto this solo field's real native gates.
 * Existing prepared saves may still contain the former opposite-side entrances.
 * Keep route indices/checkpoints and spawn timing; never let the simulator clamp a gate off the grid.
 */
export function assaultFieldRoutes(routes, stage, field = 'normal') {
  const rect = field === 'bossL' ? GEO.BOSS_RECT : GEO.NORMAL_RECT;
  /** @param {number[]} point */
  const inside = ([row, col]) => row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1;
  const tile = ([row, col]) => (stage.legend || stage.tiles || {})[stage.rows?.[row]?.[col]];
  const passable = (point) => {
    const t = tile(point);
    const pass = t?.pass ?? t?.passable ?? t?.passableMask;
    return inside(point) && (t?.groundPassable === true || pass === 'ALL' || pass === 'WALK' || pass === 'GROUND');
  };
  const gates = (type) => {
    const result = [];
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) {
      const t = tile([r, c]);
      if (t?.special === type || (t?.key ?? t?.tileKey) === `tile_${type}`) result.push([r, c]);
    }
    return result;
  };
  // Reachability only. Native Grid remains the sole owner of movement paths and smoothing.
  const reachable = (start, end) => {
    if (!passable(start) || !passable(end)) return false;
    const queue = [start], seen = new Set([start.join(',')]);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      if (p[0] === end[0] && p[1] === end[1]) return true;
      for (const [dr, dc] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const next = [p[0] + dr, p[1] + dc], key = next.join(',');
        if (!seen.has(key) && passable(next)) { seen.add(key); queue.push(next); }
      }
    }
    return false;
  };
  const resolveGate = (point, type) => {
    if (!Array.isArray(point) || !point.every(Number.isFinite)) throw new TypeError(`invalid assault route ${type}`);
    if (inside(point)) return [...point];
    const candidate = gates(type).sort((a, b) => Math.abs(a[0] - point[0]) - Math.abs(b[0] - point[0])
      || Math.abs(a[1] - point[1]) - Math.abs(b[1] - point[1]) || a[0] - b[0] || a[1] - b[1])[0];
    if (!candidate || field === 'bossL') throw new Error(`assault route ${type} ${point} is outside its native field`);
    return [...candidate];
  };
  return routes.map((raw, index) => {
    const route = clone(raw);
    if (!route?.start || !route.end) throw new Error(`assault route ${index} has no native gates`);
    const start = resolveGate(route.start, 'start');
    const end = resolveGate(route.end, 'end');
    const checkpoints = (route.checkpoints || []).map(clone);
    let prior = start;
    const positions = checkpoints.map((c) => Array.isArray(c) ? { type: 'MOVE', pos: c } : c)
      .filter((c) => ['MOVE', 'APPEAR'].includes(String(c.type || 'MOVE').toUpperCase()));
    for (const checkpoint of [...positions, { type: 'MOVE', pos: end }]) {
      const point = checkpoint.pos;
      if (!inside(point)) throw new Error(`assault route ${index} checkpoint ${point} is outside its native field`);
      if (checkpoint.type !== 'APPEAR' && route.motion === 'WALK' && !reachable(prior, point)) {
        throw new Error(`assault route ${index} has no native ground path from ${prior} to ${point}`);
      }
      prior = point;
    }
    return { ...route, start, end, checkpoints };
  });
}

function statsFor(body, piece, teamEnhancements, teamGrowth = {}, clock = null) {
  const star = Number(piece.star);
  if (!Number.isInteger(star) || star < 1 || star > 4) throw new RangeError(`invalid star for ${piece.uid}`);
  const row = body.starStats?.[star - 1];
  if (!row || row.star !== star || !object(row.stats)) throw new Error(`missing star ${star} stats for ${body.charId}`);
  const stats = { ...row.stats };
  const apply = (stat, amount, mode) => {
    if (stat === 'spGain') stat = 'spRecovery';
    if (!Object.hasOwn(stats, stat)) throw new Error(`unknown assault stat ${stat} for ${body.charId}`);
    const value = finite(amount, `${stat} enhancement`);
    stats[stat] = mode === 'percent' ? stats[stat] * (1 + value) : stats[stat] + value;
    if (!Number.isFinite(stats[stat])) throw new Error(`non-finite assault stat ${stat}`);
  };
  for (const [stat, value] of Object.entries(piece.permanentFlat ?? {})) apply(stat, value, 'flat');
  for (const [stat, value] of Object.entries(piece.permanentPercent ?? {})) apply(stat, value, 'percent');
  projectTemporaryStats(stats, piece, clock);
  for (const effect of teamEnhancements) {
    if (effect.scope === 'team' || effect.uid === piece.uid || effect.target === piece.uid) apply(effect.stat, effect.amount, effect.mode ?? 'flat');
  }
  for (const [stat, amount] of Object.entries(teamGrowth)) apply(stat, amount, 'flat');
  return stats;
}

export function makeChessRecords(runtime, pieces, enhancements, teamGrowth = {}, clock = null, ownerId = 'assault') {
  if(typeof ownerId!=='string'||!ownerId)throw new TypeError('assault chess owner must be an explicit nonempty string');
  const chess = {};
  const units = [];
  for (const piece of pieces) {
    if (!piece || typeof piece.uid !== 'string' || typeof piece.charId !== 'string') throw new TypeError('assault pieces require uid and physical charId');
    const body = runtime.bodies[piece.charId];
    if (!body || body.charId !== piece.charId) throw new Error(`missing physical assault body ${piece.charId}`);
    if (!Number.isInteger(piece.sourceCopies) || piece.sourceCopies < 1) throw new Error(`invalid sourceCopies for ${piece.uid}`);
    const sim = body.simChess;
    const id = `assault:${piece.uid}`;
    const skill = sim.skill ? { ...sim.skill,
      skillType: 'AUTO', trigger: 'SP_FULL', kind: 'instant',
      spCost: Array.isArray(body.fixedSkill?.spCosts) ? body.fixedSkill.spCosts[piece.star - 1] : body.fixedSkill?.spCost,
      initSp: Array.isArray(body.fixedSkill?.initSp) ? body.fixedSkill.initSp[piece.star - 1] : (body.fixedSkill?.initSp ?? sim.skill.initSp),
      spType: body.fixedSkill?.spType ?? sim.skill.spType ?? 'INCREASE_WITH_TIME',
    } : null;
    const simPiece = { ...clone(piece), abilityBonuses: abilityBonuses(piece, clock), enchantmentId: effectiveEnchantmentId(piece, clock), dir: assaultNativeDirection(piece.dir),
      summonPresets: (piece.summonPresets ?? []).filter(Boolean).map((preset) => ({ ...clone(preset), dir: assaultNativeDirection(preset.dir ?? piece.dir) })) };
    const rec = { ...sim, assaultOwnerId: ownerId, chessId: id, charId: piece.charId, name: body.name,
      tier: piece.star, golden: piece.star >= 4,
      stats: statsFor(body, piece, enhancements, teamGrowth, clock), skill, talents: [], module: null, skills: [],
      assaultPiece: { ...simPiece, fixedSkill: clone(body.fixedSkill), sourceDesign: clone(body.source) }, assaultBody: body };
    chess[id] = rec;
    if (piece.row != null && piece.col != null) units.push({ uid: piece.uid, kind: 'chess', chessId: id,
      row: Number(piece.row), col: Number(piece.col), dir: assaultNativeDirection(piece.dir) });
  }
  return { chess, units };
}

/** Build native simulator input from the selected run and compiled Assault data.
 * @typedef {Record<string, any>} AssaultDataRecord
 * @typedef {Record<string, (...args: any[]) => unknown>} AssaultKitRegistry
 * @param {{ runtime?: AssaultDataRecord, nativeData?: AssaultDataRecord,
 *   kits?: AssaultKitRegistry, install?: ((battle: any, preparedInput: any) => void) | null,
 *   recordEvents?: boolean }} [options={}]
 */
export function buildAssaultBattleInput(prepared, options = {}) {
  const { runtime, nativeData, kits, install = null, recordEvents = true } = options;
  if (!prepared?.encounter || !prepared?.config || !Array.isArray(prepared.input?.pieces)) throw new TypeError('prepared assault battle is incomplete');
  if (!runtime || !nativeData) throw new TypeError('assault battle requires runtime and native 0.2.2 data');
  if (!kits || !object(kits)) throw new TypeError('assault requires an explicit fixed kit registry');
  const effects = prepared.input.nextBattleEffects ?? [];
  const enhancements = effects.filter((effect) => effect.kind === 'enhance');
  for (const effect of prepared.derivedBuffInputs ?? []) {
    if (effect.relicId === 'cross-chivalry') {
      const params = relicEffectParams(options,'cross-chivalry','hourStarted');
      const stacks = Math.min(Number(params.maxStacks),Math.max(0,Number(effect.attackSpeedStacks ?? 0)));
      enhancements.push({ kind: 'enhance', scope: 'team', stat: 'aspd', amount: stacks * Number(params.attackSpeedPer5Gold), mode: 'flat' });
    }
  }
  const altar = Number(prepared.input.relicCounters?.['pierce-altar'] ?? 0);
  if (!Number.isInteger(altar) || altar < 0 || altar > 10) throw new RangeError('invalid pierce-altar relic counter');
  if (altar > 0) {
    const params = relicEffectParams(options,'pierce-altar','battleEnd');
    enhancements.push({ kind: 'enhance', scope: 'team', stat: 'atk', amount: altar * Number(params.atkRatioPerStack), mode: 'percent', sourceKey: 'pierce-altar' });
    enhancements.push({ kind: 'enhance', scope: 'team', stat: 'def', amount: altar * Number(params.defRatioPerStack), mode: 'percent', sourceKey: 'pierce-altar' });
  }
  const teamGrowth = prepared.input.teamGrowth ?? {};
  if (!object(teamGrowth)) throw new TypeError('assault teamGrowth must be a flat stat map');
  const { chess, units } = makeChessRecords(runtime, prepared.input.pieces, enhancements, teamGrowth, prepared.input);
  const placedUids = new Set(units.map((unit) => unit.uid));
  const deployAnchors = prepared.input.pieces.filter((piece) => placedUids.has(piece.uid)).flatMap((piece) =>
    (runtime.bodies[piece.charId].deployAnchors ?? []).map((anchor) => ({ ...clone(anchor), ownerUid: piece.uid })));
  const simData = toAssaultSimData(runtime, nativeData);
  simData.chess = chess;
  for (const piece of prepared.input.pieces) {
    for (const preset of piece.summonPresets ?? []) {
      if (!preset) continue;
      const marker = runtime.bodies[piece.charId]?.adaptation?.marker;
      if (typeof preset.tokenId !== 'string' || (!Object.hasOwn(simData.tokens, preset.tokenId) && marker?.id !== preset.tokenId)) throw new Error(`unknown assault summon ${preset.tokenId}`);
      if (!Number.isInteger(preset.row) || !Number.isInteger(preset.col)) throw new Error(`invalid summon preset for ${piece.uid}`);
    }
  }
  const bosses = recordsBy(nativeData.bosses, 'bossId');
  const waves = recordsBy(nativeData.waves, 'id');
  const sourceWaveId = prepared.encounter.kind === 'final' ? assaultWaveSourceId(prepared.encounter) : null;
  if (prepared.encounter.kind === 'final' && (!sourceWaveId || sourceWaveId !== prepared.waveId || !waves[sourceWaveId])) {
    throw new Error(`assault final wave source mismatch for ${prepared.encounter.id}: ${sourceWaveId ?? '<missing>'} != ${prepared.waveId}`);
  }
  const nativeTemplateId = sourceWaveId ? assaultNativeTemplateId(sourceWaveId, waves, 1) : null;
  // Older persisted prepared battles predate this field; derive their solo variant from the verified source.
  if (sourceWaveId && prepared.nativeTemplateId != null && prepared.nativeTemplateId !== nativeTemplateId) throw new Error(`assault final native template mismatch for ${prepared.encounter.id}: ${prepared.nativeTemplateId} != ${nativeTemplateId}`);
  const waveTemplate = nativeTemplateId ? clone(waves[nativeTemplateId]) : null;
  const enemies = recordsBy(nativeData.enemies, 'key');
  const spawnSpecs = prepared.encounter.wave.spawns.map((spawn) => {
    const boss = spawn.key === prepared.encounter.wave.bossId && prepared.encounter.wave.bossId
      ? bosses[prepared.encounter.wave.bossId] : null;
    const enemyKey = boss ? boss.enemyKey : (spawn.key ?? spawn.enemyKey);
    if (!enemies[enemyKey]) throw new Error(`encounter ${prepared.encounter.id} references missing native enemy ${enemyKey}`);
    const override = prepared.encounter.wave.overrides?.[spawn.key] ?? prepared.encounter.wave.overrides?.[enemyKey];
    const st = override?.stats ?? {};
    const absoluteHp = st.hpMode === 'absolute' ? st.maxHp : null;
    // Per-spawn pacing scale (tools/assault/wave-pacing.mjs); older saved waves have none. The boss keeps its absolute shared pool.
    const hpScale = boss ? 1 : finite(spawn.hpScale ?? 1, 'spawn hpScale');
    // Day strength (tools/assault/chapter-enemy-sets.mjs): the original's 1.1^k attack / 1.2^k HP / speed of this day, on top of the constant override. The boss keeps its designed stats.
    const day = boss ? null : enemyDayScale(prepared.encounter.wave, prepared.input.day);
    const mods = { hpMul: (absoluteHp == null ? (st.maxHp ?? 1) * (day?.hp ?? 1) : 1) * hpScale,
      atkMul: (st.atk ?? 1) * (day?.atk ?? 1), defMul: st.def ?? 1, resMul: st.res ?? 1, speedMul: (st.moveSpeed ?? 1) * (day?.speed ?? 1) };
    return { enemyKey, count: spawn.count, interval: spawn.interval, time: spawn.time,
      routeIndex: (spawn.routeIndex??0) % (prepared.field.routes??prepared.encounter.wave.routes).length, tag: boss ? 'boss' : spawn.tag, mods, countInTotal: true };
  });
  const bossStats = prepared.encounter.wave.overrides?.[prepared.encounter.wave.bossId]?.stats;
  const sharedBoss = prepared.encounter.wave.bossId ? { maxHp: bossStats?.sharedPoolHp ?? bossStats?.maxHp } : null;
  if (sharedBoss && !(Number.isFinite(sharedBoss.maxHp) && sharedBoss.maxHp > 0)) throw new Error(`assault boss ${prepared.encounter.wave.bossId} has no explicit absolute shared-pool HP`);
  const firstEntryWaivers = new Set(effects.filter((effect) => effect.kind === 'firstNaturalEntryCostWaiver' && effect.countsAsSkillRedeploy === false).map((effect) => effect.uid));
  return {
    data: simData, units, spawnSpecs,
    battle: {
      seed: prepared.seed, kind: prepared.field.field === 'bossL' ? 'boss' : 'normal', modeId: 'assault', round: prepared.input.hour,
      fieldId: `assault:${prepared.encounter.id}`, stage: prepared.field.stage,
      routes: assaultFieldRoutes(prepared.field.routes??prepared.encounter.wave.routes, prepared.field.stage, prepared.field.field),
      spawns: spawnSpecs, timeLimit: prepared.config.battleSeconds, autoFinish: true,
      flags: { dpInit: prepared.encounter.wave.dp.init, dpPerSec: prepared.encounter.wave.dp.perSec,
        dpMax: prepared.encounter.wave.dp.max, layerGainsEnabled: false },
      ...(waveTemplate ? { waveTemplate } : {}),
      ...(nativeTemplateId ? { nativeTemplateId } : {}),
      sharedBoss, content: 'assault', assault: { strict: true, kits: { ...kits }, deployAnchors, install: (battle) => {
        battle.battleId = prepared.battleId;
        if (typeof install === 'function') install(battle, prepared);
      } }, recordEvents,
      setup: (battle) => {
        for (const unit of battle.allyUnits) if (firstEntryWaivers.has(unit.uid)) unit.mem.assaultSkillFree = true;
        let life = finite(prepared.input.life, 'remaining life');
        battle.assaultLeakLife = () => Math.max(0, life);
        battle.on('enemyLeak', ({ enemy }) => {
          life -= Number(enemy.lpr ?? 1);
          if (life <= 0) battle.forceEnd('life-depleted');
        });
        if (prepared.encounter.id.startsWith('enc_final_')) {
          // Native final-round countdown is display only. Drain whole elapsed
          // seconds after 150; both browser and server use this simulation clock.
          battle.assaultOvertimeLoss = 0;
          battle.on('tick', () => {
            if (battle.sharedBoss?.hp <= 0) { battle.forceEnd('boss-cleared'); return; }
            const due = Math.max(0, Math.floor(battle.time + battle.dt - 150 + 1e-9));
            const loss = Math.min(Math.max(0, life), Math.max(0, due - battle.assaultOvertimeLoss));
            life -= loss;
            battle.assaultOvertimeLoss += loss;
            if (life <= 0) battle.forceEnd('life-depleted');
          });
        }
        const shieldEntries = new Set();
        battle.on('deploy', ({ unit }) => {
          if (unit.kind !== 'op' || shieldEntries.has(unit.uid)) return;
          shieldEntries.add(unit.uid);
          for (const [index, effect] of effects.entries()) {
            if (effect.kind !== 'openingShield' || (!['all', 'team'].includes(effect.target)
              && effect.target !== unit.uid && effect.targetUid !== unit.uid)) continue;
            const amount = effect.mode === 'percent' ? unit.s.maxHp * Number(effect.amount) / 100 : Number(effect.amount);
            if (amount > 0) battle.addBuff(unit, { key: `assault:opening-shield:${effect.sourceEventId ?? unit.uid}:${index}`,
              shield: amount, duration: Number(effect.durationSec) > 0 ? Number(effect.durationSec) : Infinity,
              visible: true, source: null });
          }
        });
      },
    }, firstEntryWaivers,
  };
}
