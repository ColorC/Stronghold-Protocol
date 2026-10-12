import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateC2S } from '../../shared/protocol.js';
import { GEO } from '../../shared/constants.js';
import { placementContext, canPlace, dropIntent } from '../../public/js/ui/gameLogic.js';
import { summonCardRows, summonDropRefusal } from '../../public/js/resonance/summonCards.js';
import { fieldTileAt } from '../../public/js/resonance/specialEntityPlacement.js';

const NATIVE_DATA = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const load = (name) => JSON.parse(readFileSync(`${NATIVE_DATA}/${name}`, 'utf8'));
const chess = load('chess.json'), tokens = load('tokens.json'), items = load('items.json'), stages = load('stages.json');
const CATHY = 'chess_char_4_11_a', CATHY_TOKEN = 'token_10041_cathy_catsld';

test('the protocol carries the summon order fields: a copy number and a facing', () => {
  const set = { t: 'g.resonance', action: { type: 'setSummonOrder', pieceUid: 7, tokenId: CATHY_TOKEN, row: 9, col: 4, dir: 'DOWN', copy: 1 } };
  assert.equal(validateC2S(set), null);
  assert.equal(validateC2S({ t: 'g.resonance', action: { type: 'clearSummonOrder', pieceUid: 7, tokenId: CATHY_TOKEN, copy: 0 } }), null);
  assert.equal(validateC2S({ t: 'g.resonance', action: { type: 'setSummonOrder', pieceUid: 7, tokenId: CATHY_TOKEN, row: 9, col: 4 } }), null, 'the old shape still passes');
  for (const bad of [{ dir: 'SIDEWAYS' }, { copy: -1 }, { copy: 12 }, { copy: 1.5 }, { speed: 2 }]) {
    assert.notEqual(validateC2S({ ...set, action: { ...set.action, ...bad } }), null, JSON.stringify(bad));
  }
});

test('the cards: one per summon of each deployed summoner, listed even at zero left, never for a benched summoner', () => {
  const state = { pieces: [
    { uid: 'p1', nativeUid: 1, row: 9, col: 3, dir: 'LEFT', operator: { name: '凯瑟琳' }, summonCards: [
      { tokenId: CATHY_TOKEN, name: '爬行号·防护单元', limit: 2, remaining: 1, placed: [{ copy: 0, row: 9, col: 4 }], legalTiles: ['9,5', '10,4'] }] },
    { uid: 'p2', nativeUid: 2, row: null, col: null, operator: { name: '巫恋' }, summonCards: [{ tokenId: 'token_10006_vodfox_doll', name: '诅咒娃娃', limit: 1, remaining: 1, placed: [], legalTiles: ['9,5'] }] },
    { uid: 'p3', nativeUid: 3, row: 10, col: 7, dir: 'RIGHT', operator: { name: '缪尔赛思' }, summonCards: [
      { tokenId: 'token_10030_mlyss_wtrman', name: '流形', limit: 1, remaining: 0, placed: [{ copy: 0, row: 9, col: 8 }], legalTiles: [] }] },
  ] };
  const rows = summonCardRows(state);
  assert.deepEqual(rows.map((row) => [row.ownerUid, row.tokenId, row.remaining, row.limit, row.ownerDir]), [[1, CATHY_TOKEN, 1, 2, 'LEFT'], [3, 'token_10030_mlyss_wtrman', 0, 1, 'RIGHT']]);
  assert.deepEqual(summonCardRows(null), []);
  assert.equal(summonDropRefusal(rows[0], { row: 9, col: 5 }), null);
  assert.equal(summonDropRefusal(rows[0], { row: 9, col: 6 }), '无法部署在该位置');
  assert.equal(summonDropRefusal(rows[0], null), '请把召唤物放在战场的部署格上');
});

test('field tile under a pointer covers the whole field, not only the own deploy rows', () => {
  const square = (row, col) => [[col * 10, row * 10], [col * 10 + 10, row * 10], [col * 10 + 10, row * 10 + 10], [col * 10, row * 10 + 10]];
  const view = { tileScreen: (row, col) => (row >= GEO.FIELD.r0 && row <= GEO.FIELD.r1 && col >= GEO.FIELD.c0 && col <= GEO.FIELD.c1 ? { poly: square(row, col) } : null) };
  const row = GEO.FIELD.r0 + 1, col = GEO.FIELD.c0 + 2;
  assert.deepEqual(fieldTileAt(view, col * 10 + 5, row * 10 + 5), { row, col }, 'a tile away from the own deploy rows');
  assert.equal(fieldTileAt(view, -50, -50), null);
  assert.equal(fieldTileAt(null, 1, 1), null);
});

test('a placed summon is not swapped with an operator in 共鸣: the client refuses before sending', () => {
  const stage = stages.act2autochess_m01;
  const empty = { alive: true, funds: 10, board: [], hand: new Array(GEO.HAND_SIZE).fill(null), temp: new Array(GEO.TEMP_SIZE).fill(null), deployCap: 8, deployCount: 0, shop: { level: 3, slots: [] } };
  const base = placementContext({ priv: empty, stage, editable: true, getChess: (id) => chess[id] || null, getToken: (id) => tokens[id] || null, getItem: (id) => items[id] || null });
  const [a, b, c] = [...base.deploy.melee].map((key) => key.split(',').map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  assert.ok(a && b && c, 'the stage has ground tiles');
  const board = [
    { uid: 1, kind: 'chess', id: CATHY, row: a[0], col: a[1], dir: 'RIGHT', items: [] },
    { uid: 2, kind: 'chess', id: 'chess_char_1_02_a', row: c[0], col: c[1], dir: 'RIGHT', items: [] },
    { uid: 3, kind: 'token', id: CATHY_TOKEN, ownerUid: 1, count: 1, row: b[0], col: b[1], dir: 'RIGHT' },
  ];
  const priv = { ...empty, board, deployCount: 2 };
  const build = (noSummonSwap) => placementContext({ priv, stage, editable: true, getChess: (id) => chess[id] || null, getToken: (id) => tokens[id] || null, getItem: (id) => items[id] || null, noSummonSwap });
  const onOperator = { area: 'board', row: c[0], col: c[1] };
  assert.equal(canPlace(build(false), 3, onOperator).action, 'swap', 'the original game swaps a summon with the operator it is dropped on');
  const refused = canPlace(build(true), 3, onOperator);
  assert.equal(refused.ok, false); assert.equal(refused.reason, '该位置已有单位');
  assert.equal(dropIntent(build(true), 3, onOperator), null);
  // turning it on its own tile and taking it back to the bench stay legal
  assert.equal(canPlace(build(true), 3, { area: 'board', row: b[0], col: b[1] }).action, 'orient');
  assert.equal(canPlace(build(true), 3, { area: 'hand', idx: 2 }).ok, true);
});
