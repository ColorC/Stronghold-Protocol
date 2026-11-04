// A thin browser adapter around the shared simulator.  It never creates a fallback battle: if
// the native data or the Assault registry is absent, preparation fails visibly and the server
// remains the only place that can settle the run.

import { t } from '../../../shared/i18n.js';
import { augmentSnapshot, augmentEvents, augmentAssaultSnapshot } from './snapCompat.js';

function moduleUrl(path) { return new URL(path, globalThis.location?.href || 'http://localhost/assault.html').href; }

// Observe settled grants only. Rendering batches labels by recipient per frame;
// this never issues a cast, SP grant or any other battle action.
export function installLinkFeedback(battle) {
  const feedback=battle.assaultVisualFeedback={sources:new Set(),grants:new Map()};
  for(const[type,kind]of [['chargeGranted','charge'],['hasteApplied','haste'],['redeployReduced','redeploy']])
    battle.assaultRuntime.observe(type,`view:${type}`,({payload:p})=>{
      if(!p.source||!p.target||!(p.amount>0))return;
      feedback.sources.add(p.source.id);
      const key=`${kind}:${p.target.id}`,entry=feedback.grants.get(key)??{kind,target:p.target.id,amount:0};
      entry.amount+=p.amount;feedback.grants.set(key,entry);
    });
  battle.assaultRuntime.observe('triggerResolved','view:trigger',({payload})=>{
    if(payload.source)feedback.sources.add(payload.source.id);
  });
}

async function loadModules() {
  const [battleModule, dataModule, specModule, inputModule, cardsModule, relicModule] = await Promise.all([
    import(moduleUrl('assault-engine/server/sim/Battle.js')),
    import(moduleUrl('assault-engine/server/sim/simdata.js')),
    import(moduleUrl('assault-engine/server/sim/spec.js')),
    import(moduleUrl('assault-engine/shared/assault/battle-input.js')),
    import(moduleUrl('assault-engine/server/sim/content/assault/cards/registry.js')),
    import(moduleUrl('assault-engine/server/sim/content/assault/relics.js')),
  ]);
  if (typeof battleModule.Battle !== 'function') throw new Error(t('战斗引擎配置未就绪。'));
  if (typeof dataModule.setSimData !== 'function' || typeof dataModule.DataSource !== 'function') throw new Error(t('战斗数据接口未就绪。'));
  if (typeof inputModule.buildAssaultBattleInput !== 'function') throw new Error(t('进击战斗输入接口未就绪。'));
  if (!cardsModule.assaultKits || typeof relicModule.installRelics !== 'function') throw new Error(t('进击卡组或收藏品配置未就绪。'));
  return { Battle: battleModule.Battle, ...dataModule, ...specModule, ...inputModule, ...cardsModule, ...relicModule };
}

export async function createAssaultBattle(prepared, { runtime, nativeData, design } = {}) {
  if (!prepared?.input || !prepared?.encounter || !prepared?.config) throw new Error(t('战斗准备数据不完整，无法开始。'));
  if (!runtime || !nativeData) throw new Error(t('战斗数据尚未加载，无法开始。'));
  const modules = await loadModules();
  modules.setSimData(nativeData);
  const built = modules.buildAssaultBattleInput(prepared, {
    runtime, nativeData, design, kits: modules.assaultKits,
    install: (battle, preparedInput) => {
      modules.installRelics(battle, preparedInput, { runtime, design });
      installLinkFeedback(battle);
    },
    recordEvents: true,
  });
  const ds = new modules.DataSource(built.data);
  const bossHp = built.battle.sharedBoss?.maxHp;
  if (bossHp && typeof modules.LocalBossPool !== 'function') throw new Error(t('本地Boss池接口未就绪，无法安全开始终战。'));
  const boss = bossHp ? new modules.LocalBossPool(bossHp) : null;
  const battle = new modules.Battle({
    ...built.battle,
    data: ds,
    players: [{ playerId: 'assault', seat: 0, side: 'L', coords: 'board', units: built.units, bonds: {} }],
    sharedBoss: boss,
  });
  const tick = Number(battle.dt);
  if (!Number.isFinite(tick) || tick <= 0) throw new Error(t('战斗模拟步长无效，无法播放。'));
  // Native 0.2.3 publishes fieldMeta. Start first so it contains the actual
  // deployed units and stage devices; the initial spawn/deploy events remain queued.
  battle.start();
  // Keep the actual environmental hits visible even when a healer restores the
  // same HP between rendered frames. This reads the real damage pipeline.
  battle.on('damaged', ({target,amount,dmg})=>{
    if(target?.side!=='ally'||!dmg?.tags?.includes('terrain')||!(amount>0))return;
    const note=target.mem.assaultTerrainDamage??={total:0,last:0,at:0};
    note.total+=amount;note.last=amount;note.at=battle.time;
  });
  const field = typeof battle.fieldMeta === 'function' ? battle.fieldMeta()
    : typeof battle.fieldInfo === 'function' ? battle.fieldInfo() : battle.fieldInfo || null;
  if (!field || !Array.isArray(field.units) || !field.stageId) throw new Error(t('战场数据不完整，无法播放。'));
  return { battle, built, field, tick, maxSeconds: built.battle.timeLimit };
}

export function runBattleFrame(session, realSeconds, speed = 1) {
  if (!session?.battle || session.paused) return { ticks: 0, events: [], snapshot: null,
    finished: !!session?.battle?.finished, time: Number(session?.battle?.time) || 0 };
  const multiplier = Math.max(0.25, Math.min(8, Number(speed) || 1));
  session.accumulator = (session.accumulator || 0) + Math.max(0, Number(realSeconds) || 0) * multiplier;
  const maxTicks = Math.max(1, Math.min(160, Math.ceil(multiplier * 8)));
  let ticks = 0;
  while (!session.battle.finished && session.accumulator >= session.tick && ticks < maxTicks && session.battle.time < session.maxSeconds) {
    session.battle.step();
    session.accumulator -= session.tick;
    ticks += 1;
  }
  if (!session.battle.finished && session.battle.time >= session.maxSeconds) session.battle.forceEnd?.('timeLimit');
  const events = session.battle.drainEvents?.() || [];
  const snapshot = session.battle.snapshot?.() || null;
  let outEvents = events;
  try {
    // The Assault sim sends no `energy` / `layers` / `charges` and no charged cast / counter target; the official
    // effects layer reads them (snapCompat.js). Its own read-outs — the synergy zones, the shared ammo counter and
    // the 再部署 loop — ride the snapshot the same way. Display only: a failure here never breaks the battle.
    const units = session.battle.units || [];
    augmentSnapshot(units, snapshot);
    augmentAssaultSnapshot(session.battle, snapshot);
    outEvents = augmentEvents(units, events, session.fxPrevCharges || (session.fxPrevCharges = new Map()));
    session.fxPrevCharges = new Map((snapshot?.charges || []).map(([id, n, max]) => [id, { n, max }]));
    // an in-place 再部署 (redeploy-cycle.js cycleRedeploy) bumps the loop's count: one event per bump, so the field
    // replays the native deploy effect with a 「再部署！」 label (render/app.js). The runtime publishes `redeploy`
    // only on its own observer bus, not into the client event stream — the count is the stream-safe signal.
    const counts = session.redeployCounts || (session.redeployCounts = new Map());
    const bumped = [];
    for (const u of session.battle.allyUnits || []) {
      if (u?.kind !== 'op') continue;
      const n = Number(u.assaultCycle?.count ?? 0) || 0;
      const prev = counts.get(u) ?? 0;
      if (n > prev) bumped.push(['redeploy', u.id]);
      if (n !== prev) counts.set(u, n);
    }
    if (bumped.length) outEvents = [...outEvents, ...bumped];
    const feedback=session.battle.assaultVisualFeedback;
    if(feedback){
      outEvents=[...outEvents,...[...feedback.sources].map(id=>['assaultProc',id]),
        ...[...feedback.grants.values()].map(g=>['assaultGrant',g.target,g.kind,g.amount])];
      feedback.sources.clear();feedback.grants.clear();
    }
  } catch { /* keep the sim's own events / snapshot */ }
  return { ticks, events: outEvents, snapshot, finished: !!session.battle.finished, time: Number(session.battle.time) || 0 };
}

export function battleResult(session) {
  if (!session?.battle) return null;
  const result = typeof session.battle.result === 'function' ? session.battle.result() : null;
  return result ? { ...result, ledger: session.battle.assaultLedger?.snapshot() ?? null } : null;
}

/** First entries waiting for DP remain formation markers, never combat snapshots. */
export function pendingDeployments(session) {
  const battle = session?.battle;
  if (!battle) return [];
  return (battle.allyUnits || []).filter((unit) => unit.kind === 'op' && !unit.alive && !unit.removed
    && !unit.deploySeq && unit.mem?.assaultPendingEntry).map((unit) => {
      const cost = battle.assaultDeploymentCost(unit);
      const dp = battle.getPlayer(unit.ownerId)?.dp || 0;
      return { id: unit.id, uid: unit.uid, charId: unit.def.charId, tier: unit.def.tier,
        row: unit.homeR, col: unit.homeC, cost, dp,
        eta: battle.flags.dpPerSec > 0 ? Math.max(0, (cost - dp) / battle.flags.dpPerSec) : null };
    });
}
