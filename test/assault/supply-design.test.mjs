import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as checker from '../../tools/assault/check-system-design.mjs';
import { openDatabase } from '../../tools/assault/bazaar-native.mjs';

const sys=JSON.parse(fs.readFileSync(new URL('../../data/assault-design/system.json',import.meta.url),'utf8'));
const db=openDatabase('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/bazaar/official-GameData.db');
const cards=new Map(),query=db.prepare('SELECT Data FROM cards WHERE Id=?');
let gameModes;
try{for(const item of sys.supplyItems)cards.set(item.sourceRef.rowId,Buffer.from(query.get(item.sourceRef.rowId).Data).toString('utf8'));gameModes=db.prepare('SELECT Id,Data FROM game_modes ORDER BY Id').all().map(row=>({rowId:row.Id,dataText:Buffer.from(row.Data).toString('utf8')}));}finally{db.close();}
function validate(config){assert.equal(typeof checker.validateSupplyItems,'function','the production checker must expose supply validation');return checker.validateSupplyItems(config,cards,checker.supplyStandardPrices(gameModes));}
function rejected(name,mutate,pattern){test(name,{timeout:30000},()=>{const fixture=structuredClone(sys);mutate(fixture);const errors=validate(fixture);assert(errors.some(message=>pattern.test(message)),JSON.stringify(errors));});}

test('supply design reads nine official card rows and all twenty-nine available tiers',{timeout:30000},()=>{assert.equal(cards.size,9);assert.equal(sys.supplyItems.reduce((sum,item)=>sum+item.allowedStars.length,0),29);assert.deepEqual(validate(sys),[]);});
rejected('supply design rejects a changed available-tier buy price',s=>s.supplyItems[1].buyPrices[2]++,/native buy price/);
rejected('supply design rejects a nonzero beverage sell reward',s=>s.supplyItems[1].sellPrices[2]=1,/native sell price/);
rejected('supply design rejects an invented quality for the Gold-start cooler',s=>s.supplyItems[1].allowedStars=[1,2,3,4],/allowed stars/);
rejected('supply design rejects a changed native machine size',s=>s.supplyItems[0].sizeSlots=1,/size differs/);
rejected('supply design rejects an incorrect native damage amount',s=>s.supplyItems.find(i=>i.id==='supply_punch').saleEffect.values[0]=11,/sale values/);
rejected('supply design rejects a day-lifetime claim changed to permanent',s=>s.supplyItems[1].sourceRules.durationType='Permanent',/duration mismatch/);
rejected('supply design rejects the old non-Action native attribute pointer',s=>s.supplyItems[1].sourceRules.valueAttributePointer='/Abilities/0/Value/AttributeType',/valueAttributePointer/);
rejected('supply design rejects an incorrect multi-ability healing target',s=>s.supplyItems.find(i=>i.id==='supply_smoothie').sourceRules.abilities[1].targetHiddenTag='Burn',/referenced hidden tag/);
rejected('supply design rejects an unknown machine generation identity',s=>s.supplyItems[0].generationPool[0]='supply_unknown',/drink pool/);
rejected('supply design rejects a changed native enchantment weight',s=>s.supplyItems.find(i=>i.id==='supply_mystery').saleEffect.enchantments[0].weight++,/enchantments\/weights/);
rejected('supply design rejects an unknown supply field',s=>s.supplyItems[0].freeInventory=99,/unknown supply field/);
rejected('supply design rejects an unrelated healing field on a damage drink',s=>s.supplyItems.find(i=>i.id==='supply_punch').saleEffect.secondaryValues=[99,99,99,99],/sale effect field/);
rejected('supply design rejects an unknown raw-source claim',s=>s.supplyItems[0].sourceRules.fakeTrigger='Any',/unknown sourceRules/);
rejected('supply design rejects a missing native source trigger',s=>delete s.supplyItems[0].sourceRules.trigger,/missing required sourceRules/);
rejected('supply design rejects an empty whole-row source pointer',s=>s.supplyItems[0].sourceRef.pointer='',/pointer/);
rejected('supply design rejects an undefined random enchantment identity',s=>s.enchantments=s.enchantments.filter(i=>i.id!=='enchant_heavy'),/undefined enchantment/);
rejected('supply design rejects a fractional machine inventory capacity',s=>s.supplyCapacity=8.5,/supplyCapacity/);
