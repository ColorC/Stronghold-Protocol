import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advancedModules, apiBase, attackRangeOf, battlePrepStatus, benchLayout, createPieceUidMap, deploymentControlActions, displayEncounterTitle, encounterPreview, eventTargetPayload, formChoices,
  assaultAssets, hrefForRun, legalTilesFor, legalSummonTilesFor, normalizeCatalog, publicStateFromResponse,
  reconcileDetail, runFromUrl, stablePrepView, summonTemplateOptions,
} from '../../public/js/assault/model.js';
import { runBattleFrame } from '../../public/js/assault/client-sim.js';
import { avatarUrl, portraitUrl, spineEntry, tokenAvatarUrl, validSpine } from '../../public/js/assets.js';
import { withAssaultPreparedInputs } from '../../server/modes/assault/context.js';
import { ownerRangeKeys } from '../../server/match/board.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { bazaarCard } from '../../public/js/assault/mechanicsView.js';
import { RUN_CARD_GROWTH } from '../../shared/assault/growth-policy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assaultAssetSource = JSON.parse(fs.readFileSync(path.join(root, 'data/assault-assets.json'), 'utf8'));
const assaultRuntime = JSON.parse(fs.readFileSync(path.join(root, 'data/assault-runtime.json'), 'utf8'));

test('approved growth cards expose zero and capped cumulative values on a three-line card face',()=>{
 const catalog={runtime:assaultRuntime,publicText:JSON.parse(fs.readFileSync(path.join(root,'data/assault-public-text.json'),'utf8'))};
 for(const [id,rule]of Object.entries(RUN_CARD_GROWTH)){
  const piece={charId:id,star:2,runGrowth:{[id]:rule.steps}},card=bazaarCard(catalog,piece);
  assert.equal(card.lines.length,3);assert.ok(card.lines.every(line=>[...line.text].length<=32));
  assert.equal(card.lines.find(line=>line.kind==='growth').growthPoints,rule.points*rule.steps);
  piece.runGrowth[id]=0;assert.equal(bazaarCard(catalog,piece).lines.find(line=>line.kind==='growth').growthPoints,0);
 }
 assert.equal(bazaarCard(catalog,{charId:'char_1041_angel2',star:2}).lines.some(line=>line.kind==='growth'),false);
});

test('page model keeps the deployment prefix for API and deep links', () => {
  const href = 'https://example.test/stronghold/assault.html?run=old';
  assert.equal(apiBase(href).pathname, '/stronghold/api/assault/');
  assert.equal(runFromUrl(href), 'old');
  assert.equal(new URL(hrefForRun('new-run', href)).pathname, '/stronghold/assault.html');
  assert.equal(new URL(hrefForRun('new-run', href)).searchParams.get('run'), 'new-run');
  assert.equal(new URL(hrefForRun('new-run', `${href}#piece=p1`)).hash, '#piece=p1');
  assert.equal(new URL(hrefForRun(null, href)).searchParams.has('run'), false);
  assert.equal(new URL(hrefForRun(null, `${href}&new=1#piece=p1`)).search, '');
  assert.equal(new URL(hrefForRun(null, `${href}#piece=p1`)).hash, '');
});

test('encounter preview reads authored normal and final wave groups and their native overrides', () => {
  const { runtime, nativeData } = getAssaultData();
  const design = loadAssaultDesign();
  const catalog = normalizeCatalog({ runtime, nativeData, design });
  const normal = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const normalGroups = encounterPreview(catalog, normal);
  const normalSpawn = normal.wave.spawns[0];
  const normalGroup = normalGroups.find((entry) => entry.key === normalSpawn.key);
  const normalNative = nativeData.enemies[normalSpawn.key];
  assert.equal(normalGroup.count, normal.wave.spawns.filter(spawn=>spawn.key===normalSpawn.key).reduce((sum,spawn)=>sum+spawn.count,0));
  assert.equal(normalGroup.name, normalNative.name);
  assert.equal(normalGroup.movement, normalNative.isFlyEnemy ? '飞行' : '地面');
  assert.equal(normalGroup.hp, normalNative.stats.maxHp * normal.wave.overrides[normalSpawn.key].stats.maxHp);
  assert.equal(normalGroup.leakDamage, normalNative.stats.lpr);

  const final = design.encounters.encounters.find((entry) => entry.kind === 'final');
  const finalBoss = final.wave.spawns.find((spawn) => spawn.key === final.wave.bossId);
  const boss = encounterPreview(catalog, final).find((entry) => entry.key === finalBoss.key);
  assert.equal(boss.count, finalBoss.count);
  assert.equal(boss.hpLabel, '共享生命');
  assert.equal(boss.hp, final.wave.overrides[finalBoss.key].stats.sharedPoolHp);
  assert.equal(boss.name, nativeData.bosses[finalBoss.key].name);
  assert.equal(encounterPreview(catalog, { wave: { spawns: [{ key: 'missing-source', count: 2 }] } })[0].name, '暂未提供');
});

test('renderer uid mapping is stable, collision-safe, and reversible', () => {
  const pieces = [{ uid: 'p1' }, { uid: 'p2' }, { uid: 'merge-a' }];
  const first = createPieceUidMap(pieces);
  const second = createPieceUidMap(pieces);
  assert.deepEqual(first.entries(), second.entries());
  for (const [uid, number] of first.entries()) assert.equal(first.uidOf(number), uid);
  assert.equal(first.numberOf('missing'), null);
});

test('server-authorized hookmaster and summon tiles retain their physical placement permissions', () => {
  const piece = { uid: 'gladiia', position: 'MELEE', legalTiles: [[9, 2], [9, 3]],
    summonLegalTiles: { token: [[10, 4]] } };
  const state = { pieces: [piece, { uid: 'occupied', row: 9, col: 3 }],
    board: { deployTiles: [{ key: '9,2', type: 'ranged' }, { key: '9,3', type: 'melee' }] } };
  assert.deepEqual(legalTilesFor(piece, state), [[9, 2]]);
  assert.deepEqual(legalSummonTilesFor(piece, 'token'), [[10, 4]]);
  assert.deepEqual(legalSummonTilesFor(piece, 'absent'), []);
});

test('preparation preserves signed server-authorized coordinates without remapping', () => {
  const piece = { uid: 'boss-frontline', position: 'MELEE', legalTiles: [[-7, 2]],
    summonLegalTiles: { token: [[-7, 3]] } };
  const state = { pieces: [piece], board: { field: 'bossL', deployTiles: [{ key: '-7,2', type: 'melee' }] } };
  assert.deepEqual(legalTilesFor(piece, state), [[-7, 2]]);
  assert.deepEqual(legalSummonTilesFor(piece, 'token'), [[-7, 3]]);
});

test('legal tiles exclude occupied cells and stable prep exposes twelve bench cells', () => {
  const state = { phase: 'battlePrep', pieces: [{ uid: 'p1', row: 9, col: 2 }, { uid: 'p2', row: null, col: null }] };
  const field = { boardRegion: { playerRows: [9], playerCols: [2, 3] } };
  assert.deepEqual(legalTilesFor(state.pieces[1], state, field), [[9, 3]]);
  const view = stablePrepView(state, createPieceUidMap(state.pieces));
  assert.equal(view.hand.length, 12);
  assert.equal(view.board[0].uid, createPieceUidMap(state.pieces).numberOf('p1'));
  assert.equal(benchLayout(state, 12).hand.length, 1);
});

test('legal tiles honor server candidates, existing terrain, and occupancy', () => {
  const field = { deployTiles: [
    { key: '9,2', type: 'melee' }, { key: '9,3', type: 'ranged' }, { key: '9,4', type: 'melee' },
  ] };
  const state = { board: field, pieces: [{ uid: 'occupied', row: 9, col: 4 }] };
  const ranged = { uid: 'new', position: 'ranged', legalTiles: [[9, 3], [9, 4], [10, 2]] };
  assert.deepEqual(legalTilesFor(ranged, state, field), [[9, 3]]);
  assert.deepEqual(legalTilesFor({ ...ranged, legalTiles: [] }, state, field), []);
});

test('battle prep blocks only deployed pieces outside current legal tiles and does not mutate the run', () => {
  const state = {
    phase: 'battlePrep',
    board: { deployTiles: [{ key: '9,2', type: 'melee' }, { key: '9,3', type: 'melee' }] },
    pieces: [
      { uid: 'valid', name: '先锋', row: 9, col: 2, legalTiles: [[9, 2], [9, 3]] },
      { uid: 'stale', name: '医疗', row: 10, col: 2, legalTiles: [[9, 2], [9, 3]] },
      { uid: 'bench', name: '狙击', row: null, col: null, legalTiles: [[9, 2], [9, 3]] },
    ],
  };
  const before = structuredClone(state);
  const status = battlePrepStatus(state, state.board);
  assert.deepEqual(status.invalidPieces.map((piece) => piece.uid), ['stale']);
  assert.equal(status.canStart, false);
  assert.deepEqual(state, before);

  state.pieces[1] = { ...state.pieces[1], row: null, col: null };
  assert.deepEqual(battlePrepStatus(state, state.board), { invalidPieces: [], canStart: true });
  state.pieces[0] = { ...state.pieces[0], row: null, col: null };
  assert.deepEqual(battlePrepStatus(state, state.board), { invalidPieces: [], canStart: false });
  state.pieces[0] = { ...state.pieces[0], row: 9, col: 2 };
  state.pieces[1] = { ...state.pieces[1], row: 9, col: 3 };
  assert.deepEqual(battlePrepStatus(state, state.board), { invalidPieces: [], canStart: true });
});

test('deployment order controls reposition or bench only an owned deployed operator during battle prep', () => {
  const piece = { uid: 'owned-body', charId: 'char_test', row: 10, col: 2 };
  const state = { phase: 'battlePrep', pieces: [piece] };
  let adjusted = null;
  let benched = null;
  const controls = deploymentControlActions({ kind: 'operator', uid: piece.uid }, state, {
    onAdjust: (value) => { adjusted = value; },
    onBench: (uid) => { benched = uid; },
  });
  assert.ok(controls);
  controls.adjust();
  controls.bench();
  assert.strictEqual(adjusted, piece);
  assert.equal(benched, piece.uid);
  assert.equal(deploymentControlActions({ kind: 'deployAnchor', uid: piece.uid }, state), null);
  assert.equal(deploymentControlActions({ kind: 'token', uid: piece.uid }, state), null);
  assert.equal(deploymentControlActions({ kind: 'operator', uid: piece.uid }, { ...state, phase: 'battle' }), null);
  assert.equal(deploymentControlActions({ kind: 'operator', uid: piece.uid }, { phase: 'battlePrep', pieces: [{ ...piece, row: null, col: null }] }), null);
});

test('encounter display strips the author prefix without changing stored names; invalid tile errors are user-facing', async () => {
  const { errorMessage } = await import('../../public/js/assault/model.js');
  assert.equal(displayEncounterTitle('战场#12 · 雪原哨站'), '雪原哨站');
  assert.equal(displayEncounterTitle('雪原哨站'), '雪原哨站');
  assert.equal(errorMessage({ code: 'INVALID_TILE', message: 'INVALID_TILE' }), '这个位置无法部署，请选择可用地块。');
});

test('all operators, summons, and derived models resolve through native asset helpers', () => {
  const manifest = assaultAssets(assaultAssetSource,getAssaultData().nativeData.assets);
  const units = Object.keys(assaultAssetSource.assets.units);
  const summons = Object.keys(assaultAssetSource.assets.summons);
  const derived = Object.keys(assaultAssetSource.assets.derivedModels);
  assert.equal(units.length, 172);
  assert.equal(summons.length, 12);
  assert.deepEqual(new Set(derived), new Set(['lingLargeDragon', 'workshopPlatform', 'chiaveMechanicalClaw']));
  for (const id of units) {
    assert.ok(avatarUrl(manifest, id), `${id} avatar`);
    assert.ok(portraitUrl(manifest, id), `${id} portrait`);
    for (const back of [false, true]) {
      const spine = spineEntry(manifest, id, { back });
      assert.ok(validSpine(spine), `${id} ${back ? 'back' : 'front'} Spine`);
      assert.ok(spine.textures.length > 0, `${id} texture`);
    }
  }
  for (const id of summons) {
    assert.ok(tokenAvatarUrl(manifest, id), `${id} avatar`);
    const spine = spineEntry(manifest, id);
    assert.ok(validSpine(spine), `${id} Spine`);
    assert.ok(spine.textures.length > 0, `${id} texture`);
  }
  for (const id of derived) {
    const spine = spineEntry(manifest, id);
    assert.ok(validSpine(spine), `${id} derived Spine`);
    assert.ok(spine.textures.length > 0, `${id} texture`);
  }
  assert.ok(validSpine(spineEntry(manifest, 'chiave_mech_claw')), 'actual device id resolves its reused model');
});

test('bench keeps twelve usable pieces and summon templates require a legal saved position', () => {
  const pieces = Array.from({ length: 12 }, (_, index) => ({ uid: `p${index}`, charId: 'char_2023_ling', star: 1 }));
  const state = { phase: 'battlePrep', pieces };
  const view = stablePrepView(state, createPieceUidMap(pieces));
  assert.equal(view.hand.filter(Boolean).length, 12);
  assert.ok(view.hand.every((piece) => piece.area === 'hand' && Number.isInteger(piece.uid)));

  const catalog = { runtime: assaultRuntime };
  const templates = summonTemplateOptions(catalog, pieces[0]);
  const body=assaultRuntime.bodies.char_2023_ling;
  const selected=body.source.skills.find(skill=>skill.skillId===body.fixedSkill.sourceSkillId).overrideTokenKey;
  assert.deepEqual(templates.map(template=>template.tokenId),[selected]);
  assert.ok(templates.every(template=>template.name.length>0));
  assert.equal(pieces[0].row, undefined);
  const placement = legalTilesFor({ uid: 'summon:p0', position: 'melee' }, {
    board: { deployTiles: [{ key: '9,2', type: 'melee' }] }, pieces: [],
  });
  assert.deepEqual(placement, [[9, 2]]);
});

test('event target payload refuses incomplete recruit/team choices', () => {
  const recruit = { targeting: { mode: 'recruit', selection: 'profession' } };
  assert.equal(eventTargetPayload(recruit, { targetUid: 'char-a' }), null);
  assert.deepEqual(eventTargetPayload(recruit, { targetUid: 'char-a', filterTag: 'MEDIC' }), { targetUid: 'char-a', filterTag: 'MEDIC' });
  assert.deepEqual(eventTargetPayload({ targeting: { mode: 'none' } }), {});
  assert.equal(eventTargetPayload({ targeting: { mode: 'selectTeam' } }, {}), null);
});

test('form and advanced module choices read physical body data', () => {
  const catalog = { runtime: {
    operators: { amiya: { extraForms: ['amiya-war', 'amiya-med'] } },
    bodies: { amiya: { modulePlans: [{ id: 'initial', type: 'INITIAL' }, { id: 'mod-a', type: 'ADVANCED', unlockStar: 3 }] } },
  } };
  const piece = { purchaseCharId: 'amiya', charId: 'amiya', star: 3 };
  assert.deepEqual(formChoices(catalog, piece), ['amiya', 'amiya-war', 'amiya-med']);
  assert.equal(advancedModules(catalog, piece)[0].unlockStar, 3);
});

test('response model accepts normal and revision-conflict run packets', () => {
  const state = { runId: 'r', revision: 4, phase: 'nodeChoice' };
  assert.strictEqual(publicStateFromResponse({ ok: true, state }), state);
  assert.strictEqual(publicStateFromResponse({ ok: false, run: { runId: 'r', state } }), state);
  const catalog = normalizeCatalog({ runtime: { bodies: {} }, nativeData: { chess: {}, enemies: {}, stages: {} }, design: {} });
  assert.equal(catalog.canPlay, true);
});

test('battle frame pause is a meaningful no-step state', () => {
  let steps = 0;
  const battle = {
    finished: false,
    time: 0,
    step() { steps += 1; this.time += 0.05; },
    drainEvents() { return []; },
    snapshot() { return { fieldId: 'field' }; },
  };
  const session = { battle, paused: true, accumulator: 0, tick: 0.05, maxSeconds: 120 };
  assert.equal(runBattleFrame(session, 1, 8).ticks, 0);
  assert.equal(steps, 0);
  session.paused = false;
  assert.equal(runBattleFrame(session, 0.05, 1).ticks, 1);
  assert.equal(steps, 1);
});

test('prepared shared inputs survive into the client feed without dropping snapshots or events', () => {
  const derived = [{ relicId: 'cross-chivalry', attackSpeedStacks: 2, goldAtPreparation: 7 }];
  const prepared = withAssaultPreparedInputs({ input: { pieces: [], derivedBuffInputs: [] }, derivedBuffInputs: derived });
  assert.deepEqual(prepared.input.derivedBuffInputs, derived);
  const snapshot = { fieldId: 'assault:demo', pieces: [{ uid: 'p1', row: 9, col: 2 }] };
  const events = [{ kind: 'attack', attackerUid: 'p1' }, { kind: 'death', uid: 'enemy-1' }];
  const battle = {
    finished: false, time: 0, step() { this.time += 0.05; },
    drainEvents() { return events; }, snapshot() { return snapshot; },
  };
  const frame = runBattleFrame({ battle, paused: false, accumulator: 0, tick: 0.05, maxSeconds: 120 }, 0.05, 1);
  assert.deepEqual(frame.snapshot, snapshot);
  assert.deepEqual(frame.events, events);
});

test('detail-card attack range is the body grid, facing right like the board overlay', () => {
  const catalog = normalizeCatalog({ runtime: assaultRuntime });
  // 初雪: [dRow, dCol] offsets, one tile behind and two in front of her own tile, rows −2…2
  const slbell = attackRangeOf(catalog, { charId: 'char_174_slbell' });
  assert.deepEqual(slbell, assaultRuntime.bodies.char_174_slbell.range);
  assert.ok(slbell.some(([row, col]) => row === 0 && col === 0));
  assert.equal(Math.max(...slbell.map(([, col]) => col)), 2);
  assert.equal(Math.min(...slbell.map(([, col]) => col)), -1);
  // 阿米娅 (caster): the long reach is the column axis — the front when the card faces right
  const amiya = attackRangeOf(catalog, { charId: 'char_002_amiya' });
  assert.equal(Math.max(...amiya.map(([, col]) => col)), 3);
  assert.equal(Math.max(...amiya.map(([row]) => Math.abs(row))), 1);
  // the board's facing-RIGHT rotation keeps the card's tiles where they are (column = forward, row up = +)
  const keys = ownerRangeKeys(amiya, 10, 5, 'RIGHT');
  assert.ok(keys.has('10,8') && keys.has('11,7') && !keys.has('10,2'));
  assert.ok(ownerRangeKeys(amiya, 10, 5, 'UP').has('13,5'));
  // every body has a drawable grid; malformed cells are dropped and an empty body has none
  for (const charId of Object.keys(assaultRuntime.bodies)) assert.ok(attackRangeOf(catalog, { charId })?.length, charId);
  const synthetic = { runtime: { bodies: { a: { range: [[0, 0], [0, 1], ['x', 2], [1]] }, b: { range: [], simChess: { rangeGrid: [[0, 1]] } }, c: {} } } };
  assert.deepEqual(attackRangeOf(synthetic, { charId: 'a' }), [[0, 0], [0, 1]]);
  assert.deepEqual(attackRangeOf(synthetic, { charId: 'b' }), [[0, 1]]);
  assert.equal(attackRangeOf(synthetic, { charId: 'c' }), null);
  assert.equal(attackRangeOf(synthetic, { charId: 'missing' }), null);
});

test('detail panel follows its operator and closes once the operator leaves the inventory', () => {
  const kept = { uid: 'p1', star: 1 }, other = { uid: 'p2', star: 1 };
  assert.deepEqual(reconcileDetail({ uid: 'p1', star: 1 }, [{ uid: 'p1', star: 2 }, other]), { uid: 'p1', star: 2 }, 'refreshed to the new piece state');
  assert.equal(reconcileDetail(kept, [other]), null, 'sold / merged-away / swapped-out operator closes the panel');
  assert.equal(reconcileDetail(kept, undefined), null);
  assert.equal(reconcileDetail(null, [kept]), null, 'no panel stays closed');
  const card = { uid: 'shop:slot-1', charId: 'char_x' };
  assert.equal(reconcileDetail(card, [other]), card, 'an unowned shop card preview is not an inventory piece');
  assert.deepEqual(reconcileDetail(kept, [kept, other]), kept, 'a different operator opens normally afterwards');
});
