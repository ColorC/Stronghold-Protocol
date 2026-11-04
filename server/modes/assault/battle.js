import { DataSource, normalizeStage } from '../../sim/simdata.js';
import { buildDeployMap } from '../../match/board.js';
import { getAssaultData, getAssaultEncounter, loadAssaultDesign } from './data.js';
import { assaultNativeTemplateId, assaultWaveSourceId, buildAssaultBattleInput } from '../../../shared/assault/battle-input.js';
import { validateTemporaryRun } from '../../../shared/assault/temporary-enhancements.js';
import { validateTemporaryAbilityRun } from '../../../shared/assault/temporary-abilities.js';
import { SharedBossPool } from '../../match/finalAssault.js';
import { Battle } from '../../sim/Battle.js';
import { TICK } from '../../sim/constants.js';

const MAX_SECONDS = 120;
// [ASSUMED] Safety guard only; final rounds normally end at pool depletion or LP zero.
const FINAL_SAFETY_SECONDS = 600;
const objectMap = (value, key) => Array.isArray(value) ? Object.fromEntries(value.map((item) => [item?.[key], item]).filter(([id]) => id != null)) : value;
const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freezeCopy = (value) => {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freezeCopy(child);
  return Object.freeze(value);
};
const seedOf = (value) => { const seed = Number(value); return Number.isInteger(seed) && seed > 0 ? seed >>> 0 : 1; };

function contextOf(ctx = {}) {
  const suppliedData = ctx.nativeData ?? ctx.data?.raw ?? ctx.data ?? null;
  const runtime = ctx.runtime ?? (ctx.catalog?.schema === 'assault-runtime/v1' ? ctx.catalog : null);
  const loaded = getAssaultData({ nativeData: suppliedData, runtime });
  return { ...ctx, ...loaded, design: ctx.design ?? loadAssaultDesign() };
}

export function getAssaultField(state, encounter, { data = null, runtime = null, catalog = null, design = null } = {}) {
  const ctx = contextOf({ data, runtime: catalog ?? runtime, design });
  const selected = typeof encounter === 'string' ? getAssaultEncounter(ctx.design, encounter) : encounter;
  if (!selected?.id || !selected.stageId || !selected.wave) throw new TypeError('assault encounter must have a compiled wave and source stage');
  const mapId=(state?.input??state)?.mapEncounterId;
  const layout=selected.kind!=='final'&&mapId?getAssaultEncounter(ctx.design,mapId):selected;
  const stageRecords = objectMap(ctx.nativeData.stages, 'id');
  const rawStage = stageRecords[layout.stageId];
  if (!rawStage) throw new Error(`missing native assault stage ${selected.stageId}`);
  const field = selected.boardRegion?.deployField === 'bossL' ? 'bossL' : 'normal';
  const playable = { ...rawStage, devices: (rawStage.devices ?? []).filter((device) => !['coldWind', 'turret'].includes(device.role) && !['coldWind', 'turret'].includes(device.key)) };
  const stage = normalizeStage(layout.stageId, playable);
  const normalizedDeployMap = buildDeployMap(playable, { field });
  if (!normalizedDeployMap.size) throw new Error(`assault stage ${selected.stageId} has no deployable ${field} tiles`);
  return { stage, normalizedDeployMap, field, stageId: layout.stageId, encounterId: selected.id, encounter: selected, routes: layout.wave.routes };
}

export function prepareAssaultBattle(state, encounter, context = {}) {
  const ctx = contextOf(context);
  const selected = typeof encounter === 'string' ? getAssaultEncounter(ctx.design, encounter) : encounter;
  if (!selected?.wave || !selected.id) throw new TypeError('assault battle requires a complete encounter');
  const input = state?.input ?? state;
  if (!Array.isArray(input?.pieces)) throw new TypeError('assault battle state requires pieces');
  validateTemporaryRun(input, ctx);
  validateTemporaryAbilityRun(input);
  const mappedWaveId = ctx.runtime.encounters[selected.id]?.waveId ?? selected.waveId ?? String(selected.waveSourceRef?.pointer ?? '').replace(/^\//, '');
  const sourceWaveId = selected.kind === 'final' ? assaultWaveSourceId(selected) : null;
  if (sourceWaveId && mappedWaveId && sourceWaveId !== mappedWaveId) throw new Error(`assault final wave source mismatch for ${selected.id}: ${sourceWaveId} != ${mappedWaveId}`);
  const waveId = sourceWaveId ?? mappedWaveId;
  const nativeWave = objectMap(ctx.nativeData.waves, 'id')[waveId];
  if (!nativeWave) throw new Error(`missing native 0.2.2 wave ${waveId || '<unspecified>'}`);
  if (sourceWaveId && nativeWave.id !== sourceWaveId) throw new Error(`assault final native wave identity mismatch for ${selected.id}: ${nativeWave.id} != ${sourceWaveId}`);
  const nativeTemplateId = sourceWaveId ? assaultNativeTemplateId(sourceWaveId, ctx.nativeData.waves, 1) : waveId;
  const field = getAssaultField(state, selected, { data: ctx.nativeData, runtime: ctx.runtime, design: ctx.design });
  const seed = seedOf(input.rngState ?? input.seed ?? state.seed);
  const relicCounters = copy(input.relicCounters ?? {});
  const skillRanks = copy(input.skillRanks ?? {});
  const teamGrowth = copy(input.teamGrowth ?? {});
  if (!skillRanks || typeof skillRanks !== 'object' || Array.isArray(skillRanks)) throw new TypeError('invalid assault skill ranks');
  if (!teamGrowth || typeof teamGrowth !== 'object' || Array.isArray(teamGrowth)) throw new TypeError('invalid assault team growth');
  if (!relicCounters || typeof relicCounters !== 'object' || Array.isArray(relicCounters)
    || Object.entries(relicCounters).some(([key, value]) => !Number.isInteger(value) || value < 0 || (key === 'pierce-altar' && value > 10))) {
    throw new RangeError('invalid assault relic counters');
  }
  const battleId = `assault:${input.runId ?? 'fixture'}:${input.day ?? 1}:${input.hour ?? 1}:${input.revision ?? 0}:${selected.id}:${seed}`;
  const snapshot = { runId: input.runId ?? null, mapEncounterId: input.mapEncounterId ?? null, seed, life: input.life, day: input.day, hour: input.hour,
    gold: input.gold ?? 0, relicIds: copy(input.relicIds ?? []), pieces: copy(input.pieces),
    skillRanks: freezeCopy(skillRanks), teamGrowth: freezeCopy(teamGrowth),
    relicCounters, nextBattleEffects: copy(input.nextBattleEffects ?? []), derivedBuffInputs: copy(input.derivedBuffInputs ?? []) };
  for (const piece of snapshot.pieces) for (const key of ['temporaryEnhancements', 'temporaryAbilityEnhancements', 'temporaryEnchantments']) {
    if (piece[key] !== undefined) freezeCopy(piece[key]);
  }
  return { battleId, seed, input: snapshot, encounterId: selected.id, waveId, nativeTemplateId,
    encounter: selected, config: { battleSeconds: selected.id.startsWith('enc_final_') ? FINAL_SAFETY_SECONDS
      : Math.min(MAX_SECONDS, Number(selected.maxPlayTime ?? ctx.design.system.run.battleSeconds) || MAX_SECONDS) }, field };
}

function simSource(prepared, ctx) {
  const input = buildAssaultBattleInput(prepared, { runtime: ctx.runtime, nativeData: ctx.nativeData, design: ctx.design, kits: ctx.kits, install: ctx.install });
  const data = new DataSource(input.data);
  const bossHp = input.battle.sharedBoss?.maxHp;
  const sharedBoss = Number.isFinite(bossHp) && bossHp > 0 ? new SharedBossPool(bossHp) : null;
  const battle = new Battle({ ...input.battle, data, sharedBoss,
    players: [{ playerId: 'assault', seat: 0, side: 'L', coords: 'board', units: input.units, bonds: {} }],
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.battleId = prepared.battleId;
  return { input, battle };
}

export function createAssaultBattle(prepared, context = {}) {
  const ctx = contextOf(context);
  if (!ctx.kits) throw new TypeError('assault requires a complete registered KIT registry; no placeholder fallback is allowed');
  const built = simSource(prepared, { ...ctx, kits: { ...ctx.kits }, install: ctx.install });
  return built.battle;
}

function summaryEvent(tuple) {
  const type = tuple?.[0];
  return ['spawn', 'leak', 'die', 'dmg', 'skill'].includes(type) ? copy(tuple) : null;
}

export function runAssaultBattle(prepared, context = {}, { recordReplay = false, summaryLimit = 24, maxFrames = 6000 } = {}) {
  const battle = createAssaultBattle(prepared, context);
  if (!Number.isInteger(summaryLimit) || summaryLimit < 0) throw new RangeError('summaryLimit must be a nonnegative integer');
  if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 6000) throw new RangeError('maxFrames must be 1..6000');
  const summary = [], frames = [];
  let pendingFrameEvents = [];
  battle.start();
  battle.drainEvents();
  const maxTicks = Math.ceil(prepared.config.battleSeconds / TICK) + 2;
  for (let tick = 0; tick < maxTicks && !battle.finished; tick += 1) {
    battle.step();
    const events = battle.drainEvents();
    for (const event of events) {
      const item = summaryEvent(event);
      if (item && summary.length < summaryLimit) summary.push(item);
    }
    if (recordReplay) {
      pendingFrameEvents.push(...events);
      if (battle.tickCount % 3 === 0) {
        if (frames.length >= maxFrames) throw new Error(`assault replay frame cap ${maxFrames} exceeded`);
        frames.push({ snapshot: battle.snapshot(), events: pendingFrameEvents });
        pendingFrameEvents = [];
      }
    }
  }
  if (!battle.finished) battle.forceEnd('timeout');
  const trailingEvents = battle.drainEvents();
  for (const event of trailingEvents) { const item = summaryEvent(event); if (item && summary.length < summaryLimit) summary.push(item); }
  if (recordReplay && pendingFrameEvents.length) {
    if (frames.length >= maxFrames) throw new Error(`assault replay frame cap ${maxFrames} exceeded`);
    frames.push({ snapshot: battle.snapshot(), events: pendingFrameEvents });
  }
  const raw = battle.result();
  const bossWon = !prepared.encounter.wave.bossId || (battle.sharedBoss?.hp ?? 1) <= 0;
  const noEnemies = !battle.enemies.some((enemy) => enemy.alive) && battle._pending.length === 0;
  const stats = raw.perPlayer.assault ?? {};
  const initialLife = Number(prepared.input.life ?? contextOf(context).design.system.run.life);
  const enemyLeak = (stats.leaked ?? []).reduce((sum, leak) => sum + Number(leak.lpr ?? 1), 0);
  const overtimeLife = battle.assaultOvertimeLoss ?? 0;
  const totalLeak = enemyLeak + overtimeLife;
  const remainingLife = Math.max(0, initialLife - totalLeak);
  const final = prepared.encounter.id.startsWith('enc_final_');
  const won = (final ? bossWon : raw.reason === 'cleared' && noEnemies && bossWon) && remainingLife > 0;
  return { battleId: prepared.battleId, victory: won, won, leakedLife: totalLeak, leakLife: totalLeak, remainingLife, overtimeLife,
    bossHpLeft: battle.sharedBoss?.hp ?? null, bossMaxHp: battle.sharedBoss?.maxHp ?? null,
    durationSec: raw.time, reason: remainingLife <= 0 ? 'life-depleted' : final && won ? 'cleared' : raw.reason,
    diagnostics: { errorCount: raw.errors ?? battle.errorCount ?? 0 },
    stats: { killed: raw.killed, total: raw.total, leaked: battle.leakedCount, leakLifeLost: totalLeak,
      leaks: copy(stats.leaked ?? []), units: stats.unitStats ?? [], damage: stats.bossDamage ?? 0 },
    ledger: battle.assaultLedger.snapshot(),
    permanentEffects: copy(battle.assaultPermanentEffects ?? []),
    nextEffectsConsumed: copy(prepared.input.nextBattleEffects ?? []), events: summary, ...(recordReplay ? { frames } : { frames: [] }) };
}
