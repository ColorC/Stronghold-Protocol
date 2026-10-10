import test from 'node:test';
import assert from 'node:assert/strict';
import { firstAvailableLegalTile, isResonanceSaleDrop, resonanceShortcutFor, RESONANCE_SHORTCUT_LABEL } from '../../public/js/resonance/nativeControls.js';
import { prototypeLabCells } from '../../public/js/resonance/nativeLabCells.js';

test('Resonance key map routes D/F/E/W to its own prep actions without altering shared shortcuts', () => {
  assert.equal(resonanceShortcutFor({ key: 'd' }), 'refresh');
  assert.equal(resonanceShortcutFor({ key: 'F' }), 'levelUp');
  assert.equal(resonanceShortcutFor({ key: 'e' }), 'sell');
  assert.equal(resonanceShortcutFor({ key: 'W' }), 'retreat');
  assert.equal(resonanceShortcutFor({ key: ' ' }), 'ready');
  assert.equal(resonanceShortcutFor({ code: 'Space', key: 'Spacebar' }), 'ready');
  assert.equal(resonanceShortcutFor({ key: 'Escape' }), 'escape');
  assert.equal(resonanceShortcutFor({ key: 'r' }), null);
  assert.equal(resonanceShortcutFor({ key: 'x' }), null);
  assert.match(RESONANCE_SHORTCUT_LABEL, /D 刷新 · F 购买经验 · E 出售选中干员 · W 部署或撤回选中干员/);
});

test('Resonance sale target accepts deliberate board and hand drops, and cancels unrelated outside releases',()=>{
  const rect={left:100,top:200,right:240,bottom:280},point={clientX:170,clientY:240};
  for(const area of ['board','hand']){
    assert.equal(isResonanceSaleDrop({kind:'chess',area,showPrep:true,sell:3,point,rect}),true,`${area} chess can be sold`);
  }
  assert.equal(isResonanceSaleDrop({kind:'chess',showPrep:true,sell:3,point:{clientX:99,clientY:240},rect}),false,'release elsewhere outside returns to origin');
  assert.equal(isResonanceSaleDrop({kind:'chess',showPrep:false,sell:3,point,rect}),false,'combat cannot sell');
  assert.equal(isResonanceSaleDrop({kind:'item',showPrep:true,sell:3,point,rect}),false,'items use their own destroy flow');
  assert.equal(isResonanceSaleDrop({kind:'chess',showPrep:true,sell:null,point,rect}),false,'missing refund cannot create a sale');
});

test('native W deployment consumes the string-encoded legal tile DTO and skips occupied cells', () => {
  assert.deepEqual(firstAvailableLegalTile(['7,0','7,1'], new Set(['7,0'])), { row:7,col:1 });
  assert.deepEqual(firstAvailableLegalTile([{row:2,col:3},{row:4,col:5}], new Set()), { row:2,col:3 });
  assert.equal(firstAvailableLegalTile(['bad','7,0'], new Set(['7,0'])), null);
});

test('prototype lab cells highlight only valid unique prep coordinates while editable', () => {
  const state = { phase:'prep', prototypeMeta:{ labCells:[{row:2,col:3},{row:2,col:3},{row:-1,col:3},{row:18,col:20},{row:19,col:0},{row:1.5,col:4},null] } };
  assert.deepEqual(prototypeLabCells(state, true), [[2,3],[18,20]]);
  assert.deepEqual(prototypeLabCells(state, false), []);
  assert.deepEqual(prototypeLabCells({...state,phase:'battle'}, true), []);
});
