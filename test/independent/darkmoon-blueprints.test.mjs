import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const blueprints = JSON.parse(fs.readFileSync(path.join(root, 'data/independent-darkmoon-blueprints.json'), 'utf8'));
const byId = new Map(blueprints.entries.map(x => [x.sourceId, x]));

test('blueprint is an exact 101-name roster slice with original 19.2 texts and both variants', () => {
  assert.equal(blueprints.sourceBuild, '19.2.0.68600');
  assert.equal(blueprints.entries.length, 101);
  assert.equal(new Set(blueprints.entries.map(x => x.sourceId)).size, 101);
  assert.equal(new Set(blueprints.entries.map(x => x.operator)).size, 101);
  const counts = Object.groupBy(blueprints.entries, x => x.rosterTribe);
  assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([k,v]) => [k,v.length])), {
    MECHANICAL:16, PIRATE:14, ELEMENTAL:12, DRAGON:13, BEAST:14, NEUTRAL:32
  });
  for (const entry of blueprints.entries) {
    assert.ok(entry.sourceTexts.normal.length > 0, `${entry.sourceId} normal text`);
    assert.ok(entry.sourceTexts.elite.length > 0, `${entry.sourceId} golden text`);
    for (const variant of ['normal','elite']) {
      const effects = entry.metadata.op.effectDelivery[variant];
      assert.equal(effects.length, 1, `${entry.sourceId} ${variant} single source effect`);
      for (const key of ['trigger','recipient','duration','text']) assert.ok(effects[0][key], `${entry.sourceId} ${variant} ${key}`);
    }
  }
});

test('delivery descriptors preserve fixed target distinctions and expose unimplemented mechanics', () => {
  assert.equal(byId.get('BGS_105').metadata.op.effectDelivery.normal[0].recipient, 'leftmostFriendly');
  assert.equal(byId.get('BGS_009').metadata.op.effectDelivery.normal[0].recipient, 'onePerEligibleType');
  assert.equal(byId.get('BGS_104').metadata.op.effectDelivery.normal[0].recipient, 'shop');
  assert.equal(byId.get('BGS_046').metadata.op.effectDelivery.normal[0].recipient, 'hand');
  assert.ok(blueprints.entries.every(x => x.metadata.op.effectDelivery.normal[0].implementation === 'unsupported'));
  assert.equal(byId.get('BGS_043').authoredRule.adaptation.source, 'randomFriendlyOperatorFromPreviousRound');
  assert.equal(byId.get('DAL_575').authoredRule.mechanic, 'summonMultiplier');
  assert.equal(byId.get('LOE_077').authoredRule.normal.trigger, 'battlecryOnGain');
  assert.equal(byId.get('FP1_031').authoredRule.normal.trigger, 'retiringEffect');
});
