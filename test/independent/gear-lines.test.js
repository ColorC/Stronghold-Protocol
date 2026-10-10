// The shop sells operators only. Wearable gear has a named active operator source or the explicit 专项战备授训 source;
// consumable/player-facility items may come from random pools, and 交接凭证 stays with its named operators.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { darkmoonGrowthBadges, applyDarkmoonAHGrowth } from '../../server/modes/independent/darkmoonShop.js';
import { grantEquipment, equipItem, totalEquipmentLevel } from '../../server/modes/independent/equipment.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const textPath = process.env.SP_GAME_TEXT_PATH || process.env.SP_INDEPENDENT_GAME_TEXT_PATH || new URL('../../data/independent-game-text.json', import.meta.url);
const text = JSON.parse(readFileSync(textPath, 'utf8'));
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

test('the shop shows only the current 3/4/4/5/5/6 operator counts at each level', () => {
  let state = createSession({ seed: 3 });
  const expectedSlots = [3, 4, 4, 5, 5, 6];
  for (let level = 1; level <= 6; level++) {
    assert.equal(state.shop.slots.length, expectedSlots[level - 1], `session level ${level}`);
    assert.ok(state.shop.slots.every((s) => s.kind === 'chess'), `level ${level}`);
    if (level < 6) {
      state.funds = 99;
      const r = applyAction(state, { type: 'upgrade' }); assert.equal(r.ok, true, r.error?.message); state = r.state;
      const f = applyAction(state, { type: 'refresh' }); assert.equal(f.ok, true, f.error?.message); state = f.state;
    }
  }
});

test('every assigned badge and wearable gear has a named operator source or the explicit training prize source', () => {
  const fixed = new Set(); const random = new Set();
  for (const op of Object.values(catalog.operators)) { const p = producedBy(op); p.fixed.forEach((x) => fixed.add(x)); p.random.forEach((x) => random.add(x)); }
  const missing = []; const randomOnly = [];
  for (const [id, d] of Object.entries(items)) {
    // retired (干员表 v3): nobody brings it any more; it stays for saves that hold it. unassigned (gear v4, 10-07): new
    // gear nobody brings yet — the sources are assigned after the operator traits are rewritten
    if (d.available === false || d.retired || d.unassigned || d.prizeOnly || d.sourcePrizeId || d.mechanism === 'disabled' || d.kind === '停用' || d.kind === 'prizeGear' || d.kind === 'permit') continue;
    const c = canonical(id);
    if (fixed.has(c)) continue;
    if ((catalog.config.trainingGearIds || []).includes(id)) continue; // 专项战备授训 is an explicit permanent direct-equip source
    if (['damage', 'growth-training-record'].includes(c)) continue; // dynamic source paths are verified below
    if (['补给', '玩家设施'].includes(d.kind) && random.has(c)) { randomOnly.push(d.newName || d.name); continue; }
    if (random.has(c) && /维式重锤/.test(d.newName || d.name)) continue; // 洛洛 brings one of the four hammers
    missing.push(`${d.newName || d.name} (${id})`);
  }
  assert.deepEqual(missing, []);
  assert.ok(randomOnly.length <= 8, randomOnly.join('、'));
});

test('prize-only wearable gear names its actual prize source and retains its 19.2 source card', () => {
  const prizeGear = Object.values(catalog.equipment).filter((d) => d.kind === 'prizeGear' || d.prizeOnly || d.sourcePrizeId);
  assert.ok(prizeGear.length > 0, 'historical prizes add wearable gear');
  for (const item of prizeGear) {
    assert.ok(item.kind === 'prizeGear' || item.prizeOnly || item.sourcePrizeId, `${item.id} is explicitly prize-only`);
    if (item.shopEligible != null) assert.equal(item.shopEligible, false, `${item.id} is never sold in the shop`);
    const cards = item.sourceRefs?.cards || [];
    assert.ok(cards.length > 0, `${item.id} retains the original prize source card`);
    assert.ok(cards.every((card) => card.version === '19.2.0.68600'), `${item.id} source cards retain the 19.2 version`);
    if (item.sourcePrizeId) assert.ok(catalog.prizes[item.sourcePrizeId], `${item.id} resolves to a real prize`);
  }
});

test('a trait that hands out a named piece of gear names it in its text', () => {
  const wrong = [];
  const activeIds = new Set(catalog.config.activeRosterIds || []);
  for (const op of Object.values(catalog.operators).filter((x) => !x.elite && activeIds.has(x.chessId))) {
    const said = text.operators[op.chessId]?.normal;
    assert.equal(typeof said, 'string', `active operator game text exists: ${op.chessId}`);
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

test('A/H growth uses fixed attack and damage badges across professions and skills', () => {
  const professions = ['WARRIOR','CASTER','MEDIC','TANK'];
  for (const profession of professions) {
    const op = Object.values(catalog.operators).find((item) => !item.elite && item.source?.normalChess?.profession === profession);
    assert.ok(op, `fixture exists for ${profession}`);
    const piece = { uid: `fixed-${profession}`, chessId: op.chessId, row: 10, col: 3, equipment: [], attachments: [] };
    assert.deepEqual(darkmoonGrowthBadges(piece, catalog), ['precision', 'damage']);
  }
  const caster = Object.values(catalog.operators).find((op) => !op.elite && op.source?.normalChess?.profession === 'CASTER');
  const piece = { uid: 'fixed-caster', chessId: caster.chessId, row: 10, col: 3, equipment: [], attachments: [] };
  const state = { round: 1, revision: 0, nextUid: 1, growthMode: 'badges', pieces: [piece], inventory: [], production: [] };
  const services = { catalog, grantEquipment: (s, id, quantity, extra) => grantEquipment(s, catalog, id, quantity, extra) };
  applyDarkmoonAHGrowth(state, catalog, piece, 0, 2, services, { sourceUid: piece.uid, landOn: 'self', targetUid: piece.uid, shopGrowth: true });
  assert.equal(piece.equipment.find((x) => x.id === 'damage')?.quantity, 2);
  assert.deepEqual(state.production.at(-1), { round: 1, revision: 1, id: 'damage', quantity: 2,
    origin: 'native', sourceUid: piece.uid, worn: true, targetUid: piece.uid });
});

test('the same AH source resolves as badges or native training according to the selected mode',()=>{
  const op=Object.values(catalog.operators).find(x=>!x.elite);
  for(const elite of [false,true]) for(const mode of ['badges','levels']){
    const count=elite?2:1,chessId=elite?(op.eliteChessId||op.chessId):op.chessId;
    const piece={uid:`mode-${mode}-${elite?'elite':'normal'}`,chessId,elite,row:10,col:3,equipment:[],attachments:[],growthMode:mode,growthLevel:1};
    const state={round:1,revision:0,nextUid:1,growthMode:mode,pieces:[piece],inventory:[],production:[]};
    const services={catalog,grantEquipment:(s,id,n,extra)=>grantEquipment(s,catalog,id,n,extra)};
    const grants=applyDarkmoonAHGrowth(state,catalog,piece,count,count,services,{sourceUid:piece.uid,landOn:'self',targetUid:piece.uid});
    if(mode==='badges'){
      assert.deepEqual(piece.equipment.map(x=>[x.id,x.quantity]).sort(),[['damage',count],['precision',count]]);
      assert.ok(grants.every(x=>(x.id==='precision'||x.id==='damage')&&x.quantity===count));
    }else{
      assert.equal(piece.growthLevel,1+count*2);
      assert.deepEqual(piece.equipment,[]);
      assert.equal(grants.length,2);
      assert.ok(grants.every(x=>x.id==='growth-training-record'&&x.growthLevels===count));
      assert.equal(state.production.length,2);
      assert.ok(state.production.every(x=>x.id==='growth-training-record'&&x.growthLevels===count));
      assert.ok(grants.every(x=>!('badgeIds'in x)&&!('attackUnits'in x)&&!('secondaryUnits'in x)));
    }
  }
});

test('ordinary-attack badge stays available with its stat definition but is explicitly unassigned', () => {
  const mastery = catalog.badges.mastery;
  assert.ok(mastery);
  assert.equal(mastery.unassigned, true);
  assert.notEqual(mastery.available, false);
  assert.equal(mastery.stat, 'normalAttackDamagePercent');
  assert.equal(mastery.value, 0.01);
  assert.ok(!(catalog.config.trainingGearIds || []).includes('mastery'));
});

test('levels-mode badge prizes create real growth records that permanently raise the chosen operator level', () => {
  const op = Object.values(catalog.operators).find((x) => !x.elite);
  const piece = { uid: 'level-target', chessId: op.chessId, row: 10, col: 3, equipment: [], attachments: [], growthLevel: 1 };
  const state = { round: 1, revision: 0, nextUid: 1, growthMode: 'levels', pieces: [piece], inventory: [], production: [] };
  grantEquipment(state, catalog, 'precision', 2, { origin: 'prize', phase: 'prize', prizeId: 'fixture-badge-prize' });
  const record = state.inventory.find((x) => x.id === 'growth-training-record');
  assert.equal(record?.quantity, 2);
  assert.deepEqual(state.production.at(-1), { round: 1, revision: 1, id: 'growth-training-record', quantity: 2,
    origin: 'prize', phase: 'prize', prizeId: 'fixture-badge-prize' });
  const used = equipItem(state, catalog, record.uid, piece.uid, 1);
  assert.equal(used.quantity, 1);
  assert.equal(piece.growthLevel, 2);
  assert.equal(record.quantity, 1);
});

test('fixed-target level grants use the training ledger and do not count as equipment technology level',()=>{
  const op=Object.values(catalog.operators).find(x=>!x.elite),piece={uid:'fixed-level-target',chessId:op.chessId,row:10,col:3,equipment:[],attachments:[],growthMode:'levels',growthLevel:1};
  const tech=Object.values(catalog.equipment).find(x=>x.mechanism!=='growthTraining'&&x.level>0);assert.ok(tech);
  piece.equipment.push({uid:'tech',id:tech.id,quantity:1});const before=piece.equipment.length,levelBefore=piece.growthLevel,equipmentLevel=totalEquipmentLevel(piece,catalog);
  const state={round:1,revision:0,nextUid:3,growthMode:'levels',pieces:[piece],inventory:[],production:[]};
  const result=grantEquipment(state,catalog,'precision',2,{origin:'native',sourceUid:piece.uid,targetUid:piece.uid,landOn:`uid:${piece.uid}`});
  assert.equal(piece.growthLevel,levelBefore+2);assert.equal(piece.equipment.length,before);
  assert.equal(totalEquipmentLevel(piece,catalog),equipmentLevel,'native gear technology level remains on its separate axis');
  assert.equal(result.id,'growth-training-record');assert.equal(result.growthLevels,2);
  assert.deepEqual(state.production.at(-1),{round:1,revision:1,id:'growth-training-record',quantity:2,origin:'native',sourceUid:piece.uid,worn:true,targetUid:piece.uid,growthLevels:2,growthLevel:3});
});
