import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FX_KINDS } from '../../public/js/render/fxRecipes.js';
import { framePlacement } from '../../public/js/render/originalVfx.js';

test('upstream 0.2.0 custom-kit FX kinds keep their explicit visual archetypes', () => {
  const expected = {
    bulletClear: 'wave', logosLexicon: 'mark', logosExecute: 'strike', mantraArc: 'bolt', mantraGrant: 'mark', mantraGate: 'reticle',
    veenBounce: 'counter', veenVolley: 'volley', harpoon: 'beam', arrowRain: 'volley', mark: 'reticle', bounce: 'counter', dying: 'mark',
  };
  for (const [kind, archetype] of Object.entries(expected)) assert.equal(FX_KINDS[kind]?.a, archetype, kind);
});

test('character VFX coverage manifest has no silent omissions', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const file = path.join(root, 'data/vfx/character-vfx-coverage.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.schema, 1);
  assert.deepEqual(doc.rules.eventSlots, ['cast', 'targetStart', 'reached', 'hit', 'end']);
  const listed = new Set();
  const collect = (v) => {
    if (Array.isArray(v)) { for (const x of v) collect(x); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (['cast', 'targetStart', 'reached', 'hit', 'end', 'begin', 'loop'].includes(k) && Array.isArray(x)) for (const prefab of x) listed.add(prefab);
      else collect(x);
    }
  };
  collect(doc.operators);
  assert.ok(listed.has('rosmon_skill_03_B_hit_01_stone'));
  assert.ok(listed.has('blkkgt_skill_03_start_02'));
  const raw = doc.operators.char_4116_blkkgt.rawPrefabSemantics;
  for (const prefab of ['blkkgt_skill_03_start_01', 'blkkgt_skill_03_start_02', 'blkkgt_skill_03_hit_1', 'blkkgt_skill_03_end', 'blkkgt_skill_03_start_03', 'blkkgt_skill_03_start_04', 'blkkgt_skill_03_hit_2']) {
    assert.ok(raw[prefab]?.bindingState, `binding state missing for ${prefab}`);
  }
  assert.equal(raw.blkkgt_skill_03_start_02.bindingState, 'translated');
  assert.equal(raw.blkkgt_skill_03_start_02.meshChildState, 'mesh');
  assert.equal(raw.blkkgt_skill_03_start_03.bindingState, 'translated');
  assert.deepEqual(doc.operators.char_4116_blkkgt.normal.hit, ['blkkgt_attack_hit_1', 'blkkgt_attack_hit_2']);
  assert.deepEqual(doc.operators.char_4116_blkkgt.skills.skchr_blkkgt_1.hit, ['blkkgt_skill_01_hit_01', 'blkkgt_skill_01_hit_02']);
  assert.deepEqual(doc.operators.char_4116_blkkgt.skills.skchr_blkkgt_2.hit, ['blkkgt_skill_02_hit_1']);
  assert.equal(doc.operators.char_4116_blkkgt.skills.skchr_blkkgt_2.action.directionType3.length, 4);
});

test('packed colour/coverage atlas keeps logical frame width and anchor', () => {
  const p = framePlacement({ cellW: 200, cellH: 100, originX: 50, originY: 80 });
  assert.equal(p.anchorX, 0.25);
  assert.equal(p.anchorY, 0.8);
  assert.equal(p.scaleX, 1);
  assert.equal(p.scaleY, 1);
});
