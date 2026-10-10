import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { DataSource } from '../../server/sim/simdata.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle } from '../helpers/battleHarness.js';

const data = getData();
const source = new DataSource(data);
const catalog = getCatalog(data);
const chessId = 'chess_native_char_366_acdrop_a';

function runAttachment({ elite = false, sourceId = 'BOT_312', mechanism = 'darkmoonSourceAttachment' } = {}) {
  const attachmentId = 'darkmoon-magnetic';
  const attachment = { id: attachmentId, state: { sourceId, elite, sourceName: '赫默' } };
  const piece = { uid: 'carrier', chessId, elite: false, row: 10, col: 5, equipment: [], attachments: [attachment], nativeState: {} };
  const testCatalog = { ...catalog, attachments: { ...catalog.attachments, [attachmentId]: { ...catalog.attachments[attachmentId], mechanism } } };
  const h = makeBattle({
    data: source,
    units: [{ uid: piece.uid, chessId, row: piece.row, col: piece.col }],
    content: 'none',
    autoFinish: false,
    timeLimit: 30,
    flags: { independent: { catalog: testCatalog, pieces: [piece] } },
    extraContent: [(battle) => installIndependentBattle(battle, { catalog: testCatalog, state: { pieces: [piece] } })],
  });
  h.spawn('enemy_1197_sfshu', { pos: [10, 8.3] });
  h.spawn('enemy_1197_sfshu', { pos: [11, 8.3] });
  h.run(0.2);
  return h;
}

test('darkmoon magnetic attachment installs BOT_312 and summons three real tokens with elite scaling', () => {
  const normal = runAttachment();
  assert.equal(normal.b.errorCount, 0, JSON.stringify(normal.b.errors));
  const normalTokens = normal.b.allyUnits.filter((u) => u.kind === 'token' && u.mem.darkmoonSummon && u.ownerChessId === chessId);
  assert.equal(normalTokens.length, 3, JSON.stringify({ message: 'ordinary BOT_312 deploy creates three actual token units', errors: normal.b.errors, trace: normal.b.independentDarkmoonTrace, units: normal.b.allyUnits.map((u) => ({ kind: u.kind, uid: u.uid, name: u.name, deployed: u.deployed, alive: u.alive, seq: u.deploySeq, darkmoonSources: u.mem.darkmoonDeploymentSources })), events: normal.events.slice(-20) }));
  assert.ok(normalTokens.every((u) => u.name === '机械水獭投影'));

  const elite = runAttachment({ elite: true });
  assert.equal(elite.b.errorCount, 0, JSON.stringify(elite.b.errors));
  const eliteTokens = elite.b.allyUnits.filter((u) => u.kind === 'token' && u.mem.darkmoonSummon && u.ownerChessId === chessId);
  assert.equal(eliteTokens.length, 3, 'advanced BOT_312 preserves the source count');
  assert.deepEqual(eliteTokens.map((u) => u.base.atk), normalTokens.map((u) => u.base.atk * 2));
  assert.deepEqual(eliteTokens.map((u) => u.base.maxHp), normalTokens.map((u) => u.base.maxHp * 2));
});

test('darkmoon source attachment still rejects an unsupported source and unknown mechanism', () => {
  const wrongSource = runAttachment({ sourceId: 'BOT_999' });
  assert.ok(wrongSource.b.errors.some((e) => /darkmoonSourceAttachment.*BOT_999/.test(e.message)), JSON.stringify(wrongSource.b.errors));

  const unknownMechanism = runAttachment({ mechanism: 'unregisteredAttachmentMechanism' });
  assert.ok(unknownMechanism.b.errors.some((e) => /unimplemented independent attachment mechanism/.test(e.message)), JSON.stringify(unknownMechanism.b.errors));
});
