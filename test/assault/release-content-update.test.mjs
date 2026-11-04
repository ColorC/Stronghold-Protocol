import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classifyAssaultReleaseUpdateChanges } from '../../tools/build-server-release.mjs';

const canonical = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const manifest = JSON.parse(fs.readFileSync(path.join(canonical, 'publish/assault/code/assault-release.json'), 'utf8'));
const options = { codeRoot: manifest.roots.code, rulesRoot: manifest.roots.rules,
  oldRows: manifest.files.filter(row => !row.metadata) };

test('the normal content updater selects real adopted UI/rule rows and ignores only explicit build inputs', () => {
  const selected = ['public/js/assault/model.js', 'public/js/assault/mechanicsView.js', 'public/js/assault/ui.js',
    'public/js/render/spine.js',
    'public/css/assault-native.css', 'data/assault-assets.json', 'data/assault-public-text.json', 'data/assault-design/collectibles.json'];
  const sources = ['data/assault-design/public-text.json', 'tools/assault/build-public-text.mjs', 'tools/assault/assets-acquire.mjs'];
  const result = classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'content', changedPaths: [...selected, ...sources] });
  assert.deepEqual(result.selected.map(row => row.sourceGitPath), selected.sort());
  assert.deepEqual(result.ignored, sources.sort());
  for (const item of result.selected) assert(item.row.bytewiseVerified && item.row.targetIdentity);
});

test('transport updates remain restricted and content updates cannot silently change core, foreign mode or player data', () => {
  for (const changed of ['server/sim/battle.js', 'shared/assault/run.js', 'data/assault-runtime.json',
    'public/js/independent/engine/server/data.js', 'public/js/resonance/ui.js', 'runtime/assault/player.json']) {
    assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'content', changedPaths: [changed] }), changed);
  }
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, changedPaths: ['public/js/assault/ui.js'] }), /transport/);
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'content', changedPaths: ['public/css/assault.css'] }));
});

test('gameplay updates select the reviewed Assault consumers while rejecting generic core and foreign changes', () => {
  const paths = ['server/sim/content/assault/cards/ranged-elite.js', 'server/sim/content/assault/relics.js',
    'server/modes/assault/battle.js', 'shared/assault/battle-input.js', 'shared/assault/relic-rules.js',
    'shared/assault/run.js', 'public/js/assault/client-sim.js', 'data/assault-runtime.json', 'data/assault-design/events.json'];
  const result = classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay', changedPaths: paths });
  assert.deepEqual(result.selected.map(item => item.sourceGitPath), paths.sort());
  // paced encounter waves ship as a rules row; their generator and replay are build inputs only
  const waves = classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay',
    changedPaths: ['data/assault-design/encounters.json', 'tools/assault/wave-pacing.mjs', 'tools/assault/wave-replay.mjs'] });
  assert.deepEqual(waves.selected.map(item => item.sourceGitPath), ['data/assault-design/encounters.json']);
  assert.deepEqual(waves.ignored, ['tools/assault/wave-pacing.mjs', 'tools/assault/wave-replay.mjs']);
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'content', changedPaths: ['data/assault-design/encounters.json'] }));
  for (const changed of ['server/sim/Battle.js', 'server/sim/damage.js', 'shared/constants.js',
    'data/chess.json', 'server/modes/resonance/battle.js', 'public/js/independent/engine/server/data.js', 'runtime/assault/player.json']) {
    assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay', changedPaths: [changed] }), changed);
  }
});

test('P4 line-builder and typed metrics remain exact test inputs and never ship as game runtime',()=>{
  const paths=['campaign-evidence.mjs','campaign-player.mjs','line-builder.mjs','line-builder-check.mjs','line-builds.json',
    'line-campaign.mjs','typed-card-samples.mjs','typed-card-acceptance.mjs','position-check.mjs'].map(p=>'tools/assault/'+p);
  const result=classifyAssaultReleaseUpdateChanges({...options,updateKind:'gameplay',changedPaths:paths});
  assert.deepEqual(result.selected,[]);assert.deepEqual(result.ignored,paths.sort());
  assert.throws(()=>classifyAssaultReleaseUpdateChanges({...options,updateKind:'gameplay',changedPaths:['tools/assault/unreviewed-player.mjs']}));
  assert.throws(()=>classifyAssaultReleaseUpdateChanges({...options,updateKind:'transport',changedPaths:paths}));
});

test('the Assault skin ships its page and its one reviewed new stylesheet with the visual line only', () => {
  const sheet = 'public/css/assault-bazaar.css';
  const sheetTarget = path.resolve(path.join(options.codeRoot, ...sheet.split('/')));
  const before = { ...options, oldRows: options.oldRows.filter(row => path.resolve(row.targetPath) !== sheetTarget) };
  const result = classifyAssaultReleaseUpdateChanges({ ...before, updateKind: 'gameplay', changedPaths: ['public/assault.html', sheet] });
  assert.deepEqual(result.selected.map(item => item.sourceGitPath), ['public/assault.html', sheet]);
  assert.equal(result.selected.find(item => item.sourceGitPath === sheet).added, true);
  assert.equal(result.selected.find(item => item.sourceGitPath === 'public/assault.html').row.adopted, true);
  // a plain content update never installs the new file, and other new stylesheets stay refused
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...before, updateKind: 'content', changedPaths: [sheet] }));
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay', changedPaths: ['public/css/assault-unreviewed.css'] }));
});

test('skill repair can add only its exact reviewed helper while all other new modules are rejected',()=>{
  const helper='server/sim/content/assault/cards/support-instant.js';
  const helperTarget=path.resolve(path.join(options.codeRoot,...helper.split('/')));
  // Before its first release the helper is the one reviewed addition; once
  // released (current manifest) it is an ordinary adopted code row.
  const before={...options,oldRows:options.oldRows.filter(row=>path.resolve(row.targetPath)!==helperTarget)};
  const result=classifyAssaultReleaseUpdateChanges({...before,updateKind:'gameplay',changedPaths:[helper]});
  assert.equal(result.selected[0].added,true);
  assert.equal(result.selected[0].row.targetPath,path.join(options.codeRoot,...helper.split('/')));
  const released=classifyAssaultReleaseUpdateChanges({...options,updateKind:'gameplay',changedPaths:[helper]});
  assert.equal(released.selected[0].added,undefined);
  assert.equal(released.selected[0].row.adopted,true);
  for(const changed of ['server/sim/content/assault/cards/unreviewed.js','server/sim/new-core.js','public/js/resonance/new.js'])
    assert.throws(()=>classifyAssaultReleaseUpdateChanges({...options,updateKind:'gameplay',changedPaths:[changed]}));
  assert.throws(()=>classifyAssaultReleaseUpdateChanges({...options,updateKind:'content',changedPaths:[helper]}));
});

test('the synergy primitives ship as two reviewed new content modules plus the changed assault content entry', () => {
  const added = ['server/sim/content/assault/redeploy-cycle.js', 'server/sim/content/assault/synergy.js'];
  const entry = 'server/sim/content/assault/index.js';
  const targets = new Set(added.map((p) => path.resolve(path.join(options.codeRoot, ...p.split('/')))));
  const before = { ...options, oldRows: options.oldRows.filter((row) => !targets.has(path.resolve(row.targetPath))) };
  const result = classifyAssaultReleaseUpdateChanges({ ...before, updateKind: 'gameplay', changedPaths: [...added, entry] });
  assert.deepEqual(result.selected.map((item) => item.sourceGitPath), [...added, entry].sort());
  for (const p of added) assert.equal(result.selected.find((item) => item.sourceGitPath === p).added, true);
  assert.equal(result.selected.find((item) => item.sourceGitPath === entry).row.adopted, true);
  // the other native battle files are not part of it, and a content update never installs the new modules
  for (const changed of ['server/sim/battle/lifecycle.js', 'server/sim/battle/summons.js'])
    assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay', changedPaths: [changed] }), changed);
  // deploy.js is the one reviewed exception: the opening entry is free (design 4.3), only in the gameplay line
  assert.deepEqual(classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay', changedPaths: ['server/sim/battle/deploy.js'] }).selected.map((item) => item.sourceGitPath), ['server/sim/battle/deploy.js']);
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'transport', changedPaths: ['server/sim/battle/deploy.js'] }));
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...before, updateKind: 'content', changedPaths: added }));
});

test('the synergy cards ship their line wiring, the family kit files and the registry; the importer is a build input', () => {
  const added = ['server/sim/content/assault/card-lines.js', 'server/sim/content/assault/cards/synergy-assault.js',
    'server/sim/content/assault/cards/synergy-ranged.js', 'server/sim/content/assault/cards/synergy-support.js'];
  const changed = 'server/sim/content/assault/cards/registry.js';
  const targets = new Set(added.map((p) => path.resolve(path.join(options.codeRoot, ...p.split('/')))));
  const before = { ...options, oldRows: options.oldRows.filter((row) => !targets.has(path.resolve(row.targetPath))) };
  const result = classifyAssaultReleaseUpdateChanges({ ...before, updateKind: 'gameplay', changedPaths: [...added, changed, 'tools/assault/import-synergy-design.mjs'] });
  assert.deepEqual(result.selected.map((item) => item.sourceGitPath), [...added, changed].sort());
  for (const p of added) assert.equal(result.selected.find((item) => item.sourceGitPath === p).added, true);
  assert.deepEqual(result.ignored, ['tools/assault/import-synergy-design.mjs']);
});

test('卡内本局永久成长 ships the inventory rule that settles and merges piece counters and the save check', () => {
  const paths = ['server/modes/assault/store.js', 'shared/assault/inventory.js'];
  const result = classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay', changedPaths: paths });
  assert.deepEqual(result.selected.map((item) => item.sourceGitPath), paths);
  for (const item of result.selected) assert.equal(item.row.adopted, true);
});

test('the 10-22 feedback fixes ship the assault floor installer entry and the canvas float-text helper', () => {
  const paths = ['server/sim/content/index.js', 'public/js/render/fx/numbers.js', 'public/js/render/fx/system.js'];
  const result = classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay', changedPaths: paths });
  assert.deepEqual(result.selected.map((item) => item.sourceGitPath), [...paths].sort());
  for (const item of result.selected) assert.equal(item.row.adopted, true);
  assert.throws(() => classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'content', changedPaths: ['server/sim/content/index.js'] }));
});

test('10-23 ships only named Assault helpers, never changes the native enemy registry',()=>{
  const added=['server/sim/content/assault/linked-skills.js','server/sim/content/assault/skill-resolution.js',
    'server/sim/content/assault/chapter-enemies.js','shared/assault/global-skill-pool.js','shared/assault/skill-resolutions.js'];
  const targets=new Set(added.map(p=>path.resolve(path.join(options.codeRoot,...p.split('/')))));
  const before={...options,oldRows:options.oldRows.filter(row=>!targets.has(path.resolve(row.targetPath)))};
  const result=classifyAssaultReleaseUpdateChanges({...before,updateKind:'gameplay',changedPaths:added});
  assert.deepEqual(result.selected.map(x=>x.sourceGitPath),[...added].sort());
  assert.ok(result.selected.every(x=>x.added));
  for(const p of ['server/sim/content/enemies.js','server/sim/content/enemies/chapters.js','server/sim/content/assault/unreviewed.js'])
    assert.throws(()=>classifyAssaultReleaseUpdateChanges({...options,updateKind:'gameplay',changedPaths:[p]}));
});

test('a gameplay update accepts the structured recording modules, replay pages and routes as added files', () => {
  const added = ['server/index.js', 'public/assault-replay.html', 'public/assault-review.html', 'public/css/assault-recording.css', 'public/js/assault/recorder.js',
    'public/js/assault/replay.js', 'public/js/recording/pageCapture.js', 'server/modes/assault/recordings.js', 'server/modes/assault/recording-comments.js'];
  const result = classifyAssaultReleaseUpdateChanges({ ...options, updateKind: 'gameplay', changedPaths: added });
  assert.deepEqual(result.selected.map((row) => row.sourceGitPath), added.sort());
});
