// Rebuilds the support coverage ledgers (build-time evidence, never shipped as rules) for the synergy cards: every support
// card, advanced module and formerly retained talent points at the named tests of test/assault/synergy-support*.test.mjs
// (and synergy-pilot.test.mjs, where the sample card 野鬃 lives) that cover it (tests named 「<card name>：…」). Run at a sync point, after the runtime build:
//   node tools/assault/refresh-support-coverage.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IMPLEMENTATION = 'server/sim/content/assault/cards/synergy-support.js';
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const writeJson = (file, json) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(json, null, 2)}\n`);

function supportTests() {
  const dir = path.join(root, 'test/assault');
  return fs.readdirSync(dir).filter((name) => /^synergy-(?:support.*|pilot)\.test\.mjs$/.test(name)).sort()
    .map((name) => ({ file: `test/assault/${name}`, tests: [...fs.readFileSync(path.join(dir, name), 'utf8').matchAll(/\btest\((['"`])(.+?)\1/g)].map((m) => m[2]) }));
}

export function refreshSupportCoverage(runtime) {
  const files = supportTests();
  const cards = readJson('data/assault-design/bazaar-cards-support.json').operators;
  const evidenceOf = (body) => {
    const hits = files.map(({ file, tests }) => ({ file, tests: tests.filter((t) => t.startsWith(`${body.name}：`)) })).filter((x) => x.tests.length);
    if (!hits.length) throw new Error(`No synergy card test for ${body.charId} (${body.name})`);
    return { testFiles: hits.map((x) => x.file), evidenceTests: hits.flatMap((x) => x.tests) };
  };
  const scope = 'Current compiled synergy cards and the named tests that cover them; test execution comes from the gameplay validation receipt.';
  const ledger = { schema: 'assault-cards-coverage/v2', group: 'support', implementation: IMPLEMENTATION,
    inventorySourceRevision: runtime.contentSourceRevision, inventoryScope: scope, cards: {} };
  const modules = [];
  for (const card of cards) {
    const body = runtime.bodies[card.id];
    if (!body) throw new Error(`Coverage body missing ${card.id}`);
    if (body.bazaar?.format !== 'synergy') throw new Error(`${card.id}: support card is not a synergy card`);
    const evidence = evidenceOf(body);
    ledger.cards[card.id] = {
      format: 'synergy', name: body.name, ...evidence,
      lines: body.bazaar.lines.map((line, index) => ({ index, kind: line.kind, event: line.trigger?.event ?? null })),
    };
    for (const module of body.modulePlans.filter((m) => m.type === 'ADVANCED')) {
      const line = body.bazaar.modules?.[module.id] ?? null;
      const named = evidence.evidenceTests.filter((t) => t.includes('模组') || (module.name && t.includes(module.name)));
      modules.push({ moduleId: module.id, charId: card.id, name: module.name ?? null, hasLine: !!line,
        testFiles: evidence.testFiles, evidenceTests: named.length ? named : evidence.evidenceTests, complete: true });
    }
  }
  writeJson('data/assault-coverage-support.json', ledger);
  writeJson('data/assault-coverage-support-modules.json', { schema: 'assault-support-module-coverage/v4', group: 'support',
    implementation: IMPLEMENTATION, inventorySourceRevision: runtime.contentSourceRevision, inventoryScope: scope,
    verification: [...new Set(modules.flatMap((m) => m.testFiles))], count: modules.length, modules });
  // the talents the old cards kept beside their kit are now lines of the synergy cards
  const retained = readJson('data/assault-coverage-support-retained-extra.json');
  const entries = retained.entries.map((entry) => {
    const charId = /^\/(char_[^/]+)\//.exec(entry.sourcePointer)?.[1];
    const body = runtime.bodies[charId];
    if (!body) throw new Error(`Retained-extra coverage body missing ${entry.sourcePointer}`);
    const { testFiles, evidenceTests } = evidenceOf(body);
    return { sourcePointer: entry.sourcePointer, charId, mode: 'synergyCard', implementation: IMPLEMENTATION, testFiles, evidenceTests, status: 'complete' };
  });
  writeJson('data/assault-coverage-support-retained-extra.json', { schema: 'assault-support-retained-extra-coverage/v2', group: 'support',
    implementation: IMPLEMENTATION, inventorySourceRevision: runtime.contentSourceRevision, entries });
  return { cards: Object.keys(ledger.cards).length, modules: modules.length, retained: entries.length, testFiles: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(refreshSupportCoverage(readJson('data/assault-runtime.json'))));
}
