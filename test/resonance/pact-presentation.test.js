import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import path from 'node:path';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { createSession, viewSession } from '../../server/modes/resonance/session.js';
import { resonanceSessionDisplay } from '../../server/modes/resonance/display.js';
import { pactReadableCopy, pactRewardProgress, pactRewardSchedule } from '../../public/js/resonance/pactPresentation.js';

const canonicalDataDir = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const requestedDataDir = process.env.SP_DATA_DIR;
assert.equal(path.resolve(requestedDataDir || ''), path.resolve(canonicalDataDir),
  'test must read the frozen canonical Native data directory, not a worktree copy');
const quietLog = { warn() {}, error() {}, info() {} };
const data = loadData(canonicalDataDir, { log: quietLog });
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 718 });
const pact = catalog.pacts?.conqueror;
const expectedSchedule = [10, 35, 65, 100, 150, 200, 330, 440, 550, 660, 750, 850, 1000, 1200, 1500];
const fullRewardSentence = '累计达到10、35、65、100、150、200、330、440、550、660、750、850、1000、1200或1500点可领取一档奖励；';
const shortRewardSentence = '累积进度可解锁战利品。';

function progressFor(conquest, openedChests) {
  const created = createSession({ seed: 718, catalog });
  assert.equal(created.ok, true, created.error);
  const state = structuredClone(created.state);
  state.prototypeMeta.economy.conqueror.conquest = conquest;
  state.prototypeMeta.economy.conqueror.openedChests = [...openedChests];
  const displayed = resonanceSessionDisplay(state, { data, catalog, viewSession, fieldResolver: () => null });
  assert.equal(displayed.ok, true, displayed.error);
  const thresholds = pactRewardSchedule(pact);
  const progress = pactRewardProgress(displayed, thresholds);
  const previous = thresholds.filter((threshold) => openedChests.includes(threshold)).at(-1) || 0;
  const fraction = progress.next == null ? 1 : Math.max(0, Math.min(1, (progress.value - previous) / (progress.next - previous)));
  return { state, displayed, progress, fraction };
}

test('V3 Conqueror descriptions collapse only the repeated chest schedule and retain its exact source values', () => {
  assert.equal(catalog.config.rulesVersion, 3);
  assert.equal(catalog.config.seasonId, 'resonance-set13-14.23');
  assert.equal(pact?.source?.recordId, 'TFT13_Warband');
  assert.deepEqual(pactRewardSchedule(pact), expectedSchedule);
  assert.equal(pact.levels.length, 4);

  for (const level of pact.levels) {
    const effect = level.effects?.[0];
    assert.equal(effect?.kind, 'prototype_trait');
    assert.equal(effect?.params?.traitId, 'conqueror');
    assert.equal(effect?.params?.mechanic, 'knockout_treasure');
    assert.equal(effect?.params?.sourceName, 'Conqueror');
    assert.ok(level.description.includes(fullRewardSentence), `full source thresholds missing at ${level.threshold}`);
    const reduced = pactReadableCopy(level.description);
    assert.equal(reduced, level.description.replace(fullRewardSentence, shortRewardSentence),
      `only the repeated schedule may be shortened at ${level.threshold}`);
    assert.ok(reduced.includes(`每次击倒获得${level.sourceVariables.StacksPerKill}点征服进度`));
    assert.ok(reduced.includes(`远征干员攻击力与术法伤害再提高3%`));
    assert.ok(!reduced.includes('累计达到'));
  }
});

test('progress uses the V3 session conquest/openedChests ledger for ready, next, and completed states', () => {
  const created = createSession({ seed: 718, catalog });
  assert.equal(created.ok, true, created.error);
  assert.equal(created.state.prototypeMeta.economy.conqueror.conquest, 0);
  assert.deepEqual(created.state.prototypeMeta.economy.conqueror.openedChests, []);

  const pending = progressFor(40, [10]);
  assert.equal(pending.progress.value, 40);
  assert.equal(pending.progress.next, 35, 'unclaimed threshold remains the available reward even when later progress has accrued');
  assert.deepEqual(pending.progress.opened, [10]);
  assert.equal(pending.fraction, 1, 'the next chest is ready to claim');

  const afterClaim = progressFor(40, [10, 35]);
  assert.equal(afterClaim.progress.next, 65);
  assert.equal(afterClaim.fraction, 1 / 6);

  const completed = progressFor(1500, expectedSchedule);
  assert.equal(completed.progress.next, null);
  assert.equal(completed.fraction, 1);
  assert.deepEqual(completed.progress.opened, expectedSchedule);
});

test('the real V3 display projection carries pact counts and the helper reads the session economy ledger', () => {
  const created = createSession({ seed: 718, catalog });
  assert.equal(created.ok, true, created.error);
  const displayed = resonanceSessionDisplay(created.state, {
    data, catalog, viewSession,
    fieldResolver: () => null,
  });
  assert.equal(displayed.ok, true, displayed.error);
  assert.equal(displayed.rulesVersion, 3);
  assert.ok(displayed.pacts && Object.hasOwn(displayed.pacts, 'conqueror'));
  assert.equal(displayed.pacts.conqueror.count >= 0, true);
  assert.deepEqual(displayed.prototypeMeta.economy.conqueror, {
    conquest: 0, openedChests: [], pendingChests: [],
  });
  assert.deepEqual(pactRewardProgress(displayed, pactRewardSchedule(pact)), {
    value: 0, next: 10, opened: [],
  });
  displayed.prototypeMeta.economy.conqueror.conquest = 40;
  displayed.prototypeMeta.economy.conqueror.openedChests.push(10);
  assert.deepEqual(pactRewardProgress(displayed, pactRewardSchedule(pact)), {
    value: 40, next: 35, opened: [10],
  });
  assert.equal(created.state.prototypeMeta.economy.conqueror.conquest, 0);
  assert.deepEqual(created.state.prototypeMeta.economy.conqueror.openedChests, [],
    'DTO mutation must not mutate the authoritative session ledger');
});
