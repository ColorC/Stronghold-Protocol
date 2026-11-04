import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeInstantCandidate,inspectSkillSource} from '../../tools/assault/instant-source.mjs';
import {makeKit} from '../../server/sim/content/assault/primitives.js';
import {assertFixedSkillContract} from '../../tools/assault/instant-source.mjs';
const table=JSON.parse(fs.readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/skill_table.json','utf8'));
const source=id=>table[id].levels.at(-1);
test('negative-duration native instantaneous skills and thrown objects are valid candidates',()=>{
  for(const id of ['skchr_podego_2','skchr_pasngr_3','skchr_bldsk_2'])assert.equal(nativeInstantCandidate(source(id)),true,id);
});
test('ammunition, toggle and infinite stances cannot pass through a zero/negative duration field',()=>{
  for(const id of ['skchr_angel2_3','skchr_f12yin_2','skchr_svrash_2','skchr_platnm_2'])assert.equal(nativeInstantCandidate(source(id)),false,id);
  assert.equal(nativeInstantCandidate({duration:0,durationType:'NONE',skillType:'AUTO',description:'持续时间<@ba.vup>无限</>'}),false);
});
test('an instant label cannot bypass an existing native instant option',()=>{
  const body={charId:'surtr',source:{skills:[{skillId:'skchr_surtr_1',index:0},{skillId:'skchr_surtr_3',index:1}]},fixedSkill:{kind:'instant',sourceSkillId:'skchr_surtr_3',sourceIndex:1}};
  assert.throws(()=>inspectSkillSource(body,table),/native instant/);
});
test('one-skill Vanilla is an explicit fallback exception, rather than a nonexistent second skill',()=>{
  const body={charId:'vanilla',source:{skills:[{skillId:'skchr_wyvern_1',index:0}]},fixedSkill:{kind:'instant',sourceSkillId:'skchr_wyvern_1',sourceIndex:0}};
  assert.equal(inspectSkillSource(body,table).singleSlotException,true);
});
test('normal kit construction overrides native attack/hurt recovery even when the authored field is absent',()=>{
  for(const spType of ['attack','hurt']){
    const def={raw:{assaultPiece:{star:1,charId:'fixture'},assaultBody:{charId:'fixture',fixedSkill:{sourceSkillId:'fixture',kind:'instant',spCosts:[4,4,4,4],initSp:0}}},skill:{spType}};
    assert.equal(makeKit(def,{cast(){}}).skill.spType,'time');
  }
});

test('native charge capacity is selected by star and preserves legitimately precharged SP',()=>{
  const fixed={sourceSkillId:'skchr_siege_2',sourceIndex:1,kind:'instant',spType:'time',recoveryPerSec:1,
    spCosts:[11,10,10,10],initSp:[6,7,8,20],maxCharges:[3,3,3,3],effects:[]};
  const body={charId:'siege',source:{skills:[{skillId:'skcom_atk_up[3]',index:0},{skillId:'skchr_siege_2',index:1},{skillId:'skchr_siege_3',index:2}]},fixedSkill:fixed};
  assert.doesNotThrow(()=>assertFixedSkillContract(body,table));
  const def={raw:{assaultPiece:{star:4,charId:'siege'},assaultBody:body}};
  assert.equal(makeKit(def,{cast(){}}).skill.charges,3);
  assert.equal(makeKit(def,{cast(){}}).skill.initSp,20);
  body.fixedSkill={...fixed,initSp:[6,7,8,31]};
  assert.throws(()=>assertFixedSkillContract(body,table),/charge capacity/);
  body.fixedSkill={...fixed,description:'最多积存2/2/3/3层。'};
  assert.throws(()=>assertFixedSkillContract(body,table),/description differs/);
  body.fixedSkill={...fixed,description:'最多积存3/3/3/3层。'};
  assert.doesNotThrow(()=>assertFixedSkillContract(body,table));
});
