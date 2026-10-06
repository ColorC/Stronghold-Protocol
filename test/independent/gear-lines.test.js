// 2026-10-06: the shop sells operators only, and every piece of gear comes through operators. Every badge and every
// wearable gear has an operator that names and produces it; used items (补给, 玩家设施) may come at random; prize gear
// stays with 工程部特供 and 交接凭证 with their twelve operators. A trait that hands out a named item names that item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { modeIdFor } from '../../shared/constants.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const text = JSON.parse(readFileSync(new URL('../../data/independent-game-text.json', import.meta.url), 'utf8'));
const items = { ...catalog.badges, ...catalog.equipment };
/** The item every id stands for: a legacy badge is its badge, a legacy identity card the one 缪尔赛思 brings. */
const canonical = (id) => { const d = items[id]; return d?.mechanism === 'badge' ? d.badgeId : (d?.canonicalId && d.canonicalId !== id ? Object.values(catalog.equipment).find((x) => x.canonicalId === d.canonicalId && x.id !== d.canonicalId && !x.oldName)?.id || id : id); };

/** Item ids an operator's trait can produce: named ones (fixed) and the ones of its random pools. */
function producedBy(op) {
  const fixed = new Set(); const random = new Set();
  const walk = (v, into) => { if (typeof v === 'string' && items[v]) into.add(canonical(v)); else if (Array.isArray(v)) v.forEach((x) => walk(x, into)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, into)); };
  for (const r of [...op.nativeTrait.effect.prep, ...op.nativeTrait.effect.combat]) {
    const pool = r.params?.poolId ? catalog.pools[r.params.poolId] : null;
    if (pool) walk(pool, random);
    else if (r.behavior === 'randomEquipment') walk(r.params.ids, random);
    else if (r.behavior !== 'randomUnlockedEquipment') walk([...(r.params?.outputs || []).map((x) => x.id), r.params?.id], fixed); // what it hands out, not what it counts
  }
  return { fixed, random };
}

test('the shop shows operators only, one more than the original at every level', () => {
  const gd = new GameData(data, modeIdFor('solo', 'normal'));
  let state = createSession({ seed: 3 });
  for (let level = 1; level <= 6; level++) {
    const counts = gd.shopSlots(level);
    assert.equal(state.shop.slots.length, counts.chess + counts.item, `level ${level}`);
    assert.ok(state.shop.slots.every((s) => s.kind === 'chess'), `level ${level}`);
    if (level < 6) {
      state.funds = 99;
      const r = applyAction(state, { type: 'upgrade' }); assert.equal(r.ok, true, r.error?.message); state = r.state;
      const f = applyAction(state, { type: 'refresh' }); assert.equal(f.ok, true, f.error?.message); state = f.state;
    }
  }
});

test('every badge and every piece of wearable gear has an operator that produces it by name', () => {
  const fixed = new Set(); const random = new Set();
  for (const op of Object.values(catalog.operators)) { const p = producedBy(op); p.fixed.forEach((x) => fixed.add(x)); p.random.forEach((x) => random.add(x)); }
  const missing = []; const randomOnly = [];
  for (const [id, d] of Object.entries(items)) {
    // retired (干员表 v3): nobody brings it any more; it stays for saves that hold it
    if (d.available === false || d.retired || d.mechanism === 'disabled' || d.kind === '停用' || d.kind === 'prizeGear' || d.kind === 'permit') continue;
    const c = canonical(id);
    if (fixed.has(c)) continue;
    if (['补给', '玩家设施'].includes(d.kind) && random.has(c)) { randomOnly.push(d.newName || d.name); continue; }
    if (random.has(c) && /维式重锤/.test(d.newName || d.name)) continue; // 洛洛 brings one of the four hammers
    missing.push(`${d.newName || d.name} (${id})`);
  }
  assert.deepEqual(missing, []);
  assert.ok(randomOnly.length <= 8, randomOnly.join('、'));
});

test('a trait that hands out a named piece of gear names it in its text', () => {
  const wrong = [];
  for (const op of Object.values(catalog.operators).filter((x) => !x.elite)) {
    const said = text.operators[op.chessId].normal;
    for (const r of op.nativeTrait.effect.prep.filter((x) => x.behavior === 'grantEquipment')) {
      for (const out of r.params.outputs || []) {
        const d = items[out.id];
        if (!d || d.kind === 'badge' || d.mechanism === 'badge') continue;
        if (!said.includes(d.newName || d.name)) wrong.push(`${op.name}: ${d.newName || d.name}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});
