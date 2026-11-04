import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const code = `${root}/publish/assault/code`;
process.env.SP_DATA_DIR = `${root}/data/assault-rules`;
process.env.SP_ASSAULT_RULES_ROOT = `${root}/data/assault-rules`;

const moduleUrl = (relative) => pathToFileURL(path.join(code, relative)).href;
const sourcePath = process.env.SP_ASSAULT_HTTP_SOURCE || `${code}/server/modes/assault/http.js`;
let source = await fs.readFile(sourcePath, 'utf8');
for (const [specifier, target] of [
  ["'../../../shared/assault/run.js'", moduleUrl('shared/assault/run.js')],
  ["'./store.js'", moduleUrl('server/modes/assault/store.js')],
  ["'../../../shared/i18n.js'", moduleUrl('shared/i18n.js')],
]) {
  assert.ok(source.includes(specifier), `D8 HTTP import missing: ${specifier}`);
  source = source.replace(specifier, JSON.stringify(target));
}
assert.match(source, /respond\(res, 200, projectAssaultBattleDto\(state, state\.currentBattle\)\)/);
const http = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { createAssaultContext } = await import(moduleUrl('server/modes/assault/context.js'));
const { createRun } = await import(moduleUrl('shared/assault/run.js'));
const { buildAssaultBattleInput } = await import(moduleUrl('shared/assault/battle-input.js'));

test('final battle HTTP projection preserves native wave identity through the published shared builder', () => {
  const context = createAssaultContext();
  const state = createRun({ runId: 'final-wave-http-fixture', seed: 17, directorId: 'director_ironmn' }, context);
  const finalEncounter = context.design.encounters.encounters.find((entry) => entry.id === 'enc_final_boss7_acdeer');
  assert.ok(finalEncounter);
  const prepared = context.prepareBattle(state, finalEncounter);
  assert.equal(prepared.waveId, 'act1autochess_h07_07');
  assert.equal(prepared.nativeTemplateId, 'act1autochess_h07_07_s');

  const response = JSON.parse(JSON.stringify(http.projectAssaultBattleDto(state, prepared)));
  assert.deepEqual(
    { battleId: response.battle.battleId, seed: response.battle.seed, encounterId: response.battle.encounterId,
      waveId: response.battle.waveId, nativeTemplateId: response.battle.nativeTemplateId,
      input: response.battle.input, encounterIdFromBody: response.battle.encounter.id,
      stageId: response.battle.field.stageId, field: response.battle.field.field,
      battleSeconds: response.battle.config.battleSeconds },
    { battleId: prepared.battleId, seed: prepared.seed, encounterId: prepared.encounterId,
      waveId: prepared.waveId, nativeTemplateId: prepared.nativeTemplateId,
      input: { ...prepared.input, derivedBuffInputs: [] }, encounterIdFromBody: prepared.encounter.id,
      stageId: prepared.field.stageId, field: prepared.field.field, battleSeconds: 120 },
  );
  const built = buildAssaultBattleInput(response.battle, { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits });
  assert.equal(built.battle.nativeTemplateId, 'act1autochess_h07_07_s');
  assert.equal(built.battle.waveTemplate.id, 'act1autochess_h07_07_s');

  const normalEncounter = context.design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const normalPrepared = context.prepareBattle(state, normalEncounter);
  const normalDto = http.projectAssaultBattleDto(state, normalPrepared).battle;
  assert.equal(normalDto.waveId, normalPrepared.waveId);
  assert.equal(normalDto.nativeTemplateId, normalPrepared.nativeTemplateId);
  assert.equal(buildAssaultBattleInput(normalDto, { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits }).battle.nativeTemplateId, undefined);

  assert.throws(() => buildAssaultBattleInput({ ...response.battle, waveId: 'act1autochess_h07_06' },
    { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits }), /wave source mismatch/);
  assert.throws(() => buildAssaultBattleInput({ ...response.battle, waveId: undefined },
    { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits }), /wave source mismatch/);
  assert.throws(() => buildAssaultBattleInput({ ...response.battle, nativeTemplateId: 'act1autochess_h07_06_s' },
    { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits }), /native template mismatch/);
  console.log(JSON.stringify({ testPid: process.pid, finalEncounter: finalEncounter.id, sourceWaveId: prepared.waveId,
    nativeTemplateId: prepared.nativeTemplateId, normalFieldsPreserved: true, negativeGuards: 3, actualSharedBuilder: true }));
});
