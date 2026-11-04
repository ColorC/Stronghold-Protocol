import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rangedKits } from '../../server/sim/content/assault/cards/ranged.js';
import { synergyRangedKits } from '../../server/sim/content/assault/cards/synergy-ranged.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { rangedEffectPlans } from '../../server/sim/content/assault/cards/ranged-plans.js';
import { rangedTokenKits } from '../../server/sim/content/assault/cards/ranged-tokens.js';
import { Battle } from '../../server/sim/Battle.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import {loadAssaultRuntime} from '../helpers/assaultRuntime.js';

const design = JSON.parse(readFileSync(new URL('../../data/assault-design/roster-ranged.json', import.meta.url), 'utf8'));
const compiled = loadAssaultRuntime();
const coverage = JSON.parse(readFileSync(new URL('../../data/assault-coverage-ranged.json', import.meta.url), 'utf8'));
// a card replaced by its synergy card (design of 2026-10-21) plays it here too (as another card's partner)
const KITS = { ...assaultKits };
function activateReadySkill(battle, unit) {
  unit.skill.sp = unit.skill.spCost;
  unit.skill.charges = 1;
  return unit.skill.activate('ranged-base-skill-test');
}

test('first 17 ranged bodies are registered without treating construction as behavioural coverage', () => {
  const rangedCards = design.operators.filter((card) => coverage.cards.includes(card.charId));
  const outsideCoverage = design.operators.filter((card) => !coverage.cards.includes(card.charId));
  assert.equal(design.operators.length, 68);
  assert.deepEqual(outsideCoverage.map((card) => [card.charId, card.profession, card.subProfessionId ?? null]), [['char_393_toledo', 'SUPPORT', null]],
    'latest Support operator Toledo has its own latest-operator source coverage, not a fabricated ranged implementation row');
  assert.deepEqual(coverage.cards, rangedCards.map((x) => x.charId));
  assert.equal(coverage.status, 'complete');
  assert.deepEqual(coverage.pending, []);
  assert.equal(coverage.pendingCardCount, 0);
  assert.equal(coverage.implementedCardCount, 67);
  assert.equal(coverage.sourceAudit.length, 67);
  assert.equal(coverage.moduleAudit.length, 91);
  const sourceRows = new Map(coverage.sourceAudit.map((row) => [row.charId, row]));
  const groupTestTexts = new Map(['test/assault/cards-ranged.test.mjs', 'test/assault/cards-ranged-mid.test.mjs', 'test/assault/cards-ranged-elite.test.mjs',
    ...coverage.sourceAudit.map((row) => row.testFile).filter((path) => /^test\/assault\/synergy-/.test(path))]
    .map((path) => [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')]));
  for (const [index, card] of rangedCards.entries()) {
    const body = compiled.bodies[card.charId]; const row = sourceRows.get(card.charId);
    const group = index < 17 ? ['first17', 'server/sim/content/assault/cards/ranged.js', 'test/assault/cards-ranged.test.mjs']
      : index < 42 ? ['mid25', 'server/sim/content/assault/cards/ranged-mid.js', 'test/assault/cards-ranged-mid.test.mjs']
        : ['elite25', 'server/sim/content/assault/cards/ranged-elite.js', 'test/assault/cards-ranged-elite.test.mjs'];
    assert.equal(row.group, group[0], `${card.charId} source group`);
    // a synergy card (design of 2026-10-21) lives in the family kit file and is tested in test/assault/synergy-*.test.mjs
    const synergy = body.bazaar?.format === 'synergy';
    assert.equal(row.implementation, body.adaptation ? 'server/sim/content/assault/cards/adaptation-registry.js' : synergy ? 'server/sim/content/assault/cards/synergy-ranged.js' : group[1], `${card.charId} implementation path`);
    if (synergy||body.adaptation) assert.match(row.testFile, /^test\/assault\/synergy-.*\.test\.mjs$/, `${card.charId} real-Battle evidence path`);
    else assert.equal(row.testFile, group[2], `${card.charId} real-Battle evidence path`);
    assert.equal(row.fixedSkill.length, body.fixedSkill.effects.length, `${card.charId} fixed effect source coverage`);
    assert.equal(row.stagedEffects.length, body.stagedEffects?.length ?? 0, `${card.charId} staged effect source coverage`);
    assert.equal(row.modePassives.length, body.modePassives.length, `${card.charId} mode passive source coverage`);
    assert.deepEqual(row.talentBindings.map((entry) => entry.binding), body.talentBindings.map((entry) => entry.binding), `${card.charId} explicit talent bindings`);
    assert.deepEqual(row.moduleIds, body.modulePlans.filter((entry) => entry.type === 'ADVANCED').map((entry) => entry.id), `${card.charId} advanced module source identities`);
    assert.ok(row.fixedSkill.every((entry) => entry.evidenceTests.length > 0), `${card.charId} fixed effects have named evidence`);
    for (const [field, sourceRows] of [['fixedSkill', row.fixedSkill], ['stagedEffects', row.stagedEffects], ['modePassives', row.modePassives]]) {
      const sourceEffects = field === 'fixedSkill' ? body.fixedSkill.effects : body[field] ?? [];
      assert.deepEqual(sourceRows.map((entry) => entry.valueKeys), sourceEffects.map((entry) => Object.keys(entry.values ?? {})), `${card.charId} ${field} parameter inventory`);
      for (const entry of sourceRows) for (const name of entry.evidenceTests) {
        assert.ok([`test('${name}'`, `test("${name}"`].some(prefix=>groupTestTexts.get(row.testFile).includes(prefix)), `${card.charId} ${field} evidence test exists: ${name}`);
      }
    }
  }
  const moduleAudit = new Map(coverage.moduleAudit.map((row) => [`${row.charId}/${row.moduleId}`, row]));
  let advancedPlans = 0;
  assert.equal(Object.keys(rangedKits).length, 17);
  for (const card of design.operators.slice(0, 17)) {
    const body = compiled.bodies[card.charId];
    assert.ok(body?.fixedSkill, `${card.charId} has no fixed skill`);
    const piece = { uid: `ranged-check:${card.charId}`, charId: card.charId, star: 4,
      moduleChoices: Object.fromEntries((body.modulePlans ?? []).filter((x) => x.type === 'ADVANCED').map((x) => [card.charId, x.id])) };
    const def = { charId: card.charId, raw: { assaultPiece: piece, assaultBody: body }, input_piece: piece };
    const kit = KITS[card.charId](null, def.raw, def);
    assert.equal(typeof kit.skill.assaultCast, 'function', `${card.charId} fixed effect handler`);
    if(!body.adaptation)assert.equal((body.fixedSkill.effects ?? []).length, (card.fixedSkill.effects ?? []).length, `${card.charId} skill coverage`);
    assert.equal((body.modulePlans ?? []).filter((x) => x.type === 'ADVANCED').length, body.adaptation?2:(card.modulePlans ?? []).filter((x) => x.type === 'ADVANCED').length, `${card.charId} modules`);
    for (const module of (body.modulePlans ?? []).filter((x) => x.type === 'ADVANCED')) {
      advancedPlans++;
      if(body.adaptation){assert.ok(module.adaptationUpgrade&&module.source.pointer);continue;}
      const row = moduleAudit.get(`${card.charId}/${module.id}`);
      assert.ok(row, `${card.charId}/${module.id} per-star module audit`);
      assert.equal(row.star3.status, 'complete');
      assert.equal(row.star4.status, 'complete');
      assert.equal(row.effectHandling, module.translation.effectHandling);
      for (const star of [row.star3, row.star4]) {
        assert.ok(star.effects.length > 0 && star.effects.every((effect) => effect.status === 'complete' && effect.testName), `${card.charId}/${module.id} tracks each completed effect and its actual test individually`);
      }
    }
  }
  assert.equal(moduleAudit.size, 91);
  assert.equal(advancedPlans, design.operators.slice(0,17).reduce((sum,card)=>sum+(compiled.bodies[card.charId].adaptation?2:card.modulePlans.filter(m=>m.type==='ADVANCED').length),0));
});

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

test('first-17 ranged batch only registers its owned token templates', () => {
  assert.deepEqual(Object.keys(rangedTokenKits), ['token_10018_robrta_mach']);
});

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs

// 隐现 + 正义骑士号 (its stand-in partner, now a synergy card): replaced by the synergy cards (design of 2026-10-21)

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-2.test.mjs
