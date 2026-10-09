import test from 'node:test';
import assert from 'node:assert/strict';
import {getData} from '../../server/data.js';
import {getCatalog} from '../../server/modes/independent/catalog.js';
const data=getData(),catalog=getCatalog();
test('each of the 34 new native bodies has an explicit playable default skill and retains all source options',()=>{
  const rows=Object.values(data.chess).filter(r=>r.chessType==='NATIVE_IMPORT_CANDIDATE');
  assert.equal(rows.length,68);
  for(const row of rows){
    assert.equal(row.nativeImport.playable,true,row.name);
    assert.equal(row.baseId,row.chessId.replace(/_b$/,'_a'),`${row.name} resolves to its ordinary body`);
    assert.ok(row.nativeGrowth.phases.length);
    if(row.skill){assert.ok(row.nativeImport.supportedSkillIds.includes(row.skill.skillId));assert.ok(row.skills.some(s=>s.isDefault&&s.skillId===row.skill.skillId));}
    for(const id of row.nativeImport.sourceNativeSkillIds)assert.ok(row.skills.some(s=>s.skillId===id));
  }
});
test('an operator without a second promotion never loses native stats on advancement',()=>{
  const a=data.chess.chess_native_char_240_wyvern_a,b=data.chess.chess_native_char_240_wyvern_b;
  assert.equal(a.status.phase,b.status.phase);assert.ok(b.status.level>=a.status.level);
  for(const k of ['atk','maxHp','def','res'])assert.ok(b.stats[k]>=a.stats[k],k);
});
test('native import includes original automatic trigger metadata and the correct class and character precedence',()=>{
  const j=data.chess.chess_native_char_1034_jesca2_a.skills.find(s=>s.skillId==='skchr_jesca2_2');
  assert.equal(j.trigger.rawRule,'TAKE_DAMAGE');assert.equal(j.trigger.rule,'TAKE_DAMAGE');
  const shu=data.chess.chess_native_char_2025_shu_a.skills.find(s=>s.skillId==='skchr_shu_3');
  assert.equal(shu.trigger.rawRule,'TRY_SEARCH_ALLY_SKILL');
  assert.equal(catalog.operators.chess_native_char_2025_shu_a.defaultSkillIndex,0);
});
