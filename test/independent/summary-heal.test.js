import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { traitSummary, TRAIT_WHEN } from '../../server/modes/independent/summary.js';

test('money/discount/summon/retirement summaries carry the exact form counts and player action labels',()=>{
  const reactions=['funds','refund','discount'].map(mode=>({trigger:'gain',behavior:'factionReaction',params:{mode,count:2}}));
  const entries=traitSummary({prep:reactions,combat:[{trigger:'passive',behavior:'retirementMultiplier',params:{extra:1}},{trigger:'deploy',behavior:'warbandEvent',params:{event:'summon',targets:'actor'}},{trigger:'death',behavior:'retiringEffect',params:{perBattle:2,summon:{count:1}}}]});
  assert.deepEqual(entries.slice(0,3).map(e=>[e.kind,e.amount]),[['funds',{normal:2,elite:2}],['funds',{normal:2,elite:2}],['discount',{normal:2,elite:2}]]);
  assert.equal(entries[3].hook,'retiring');assert.equal(entries[4].when,'summon');assert.equal(TRAIT_WHEN[entries[4].when],'召唤友方时');assert.equal(entries[5].kind,'summon');
  // Evaluate the actual pure HUD summary-render function with deterministic markup helpers, avoiding its browser imports.
  const source=readFileSync(new URL('../../public/js/independent/hud.js',import.meta.url),'utf8');
  const start=source.indexOf('const KIND_WORD'),end=source.indexOf('// ---- top bar',start);
  const flat=value=>Array.isArray(value)?value.map(flat).join(''):value==null?'':typeof value==='function'?'glyph':String(value);
  const html=(strings,...values)=>strings.map((s,i)=>s+flat(values[i])).join('');
  const render=runInNewContext(source.slice(start,end).replace('export function TraitGlyphs','function TraitGlyphs')+';TraitGlyphs;',{
    html,cx:(...x)=>x.filter(Boolean).join(' '),GearIcon:()=>{},CoinGlyph:()=>{},Icon:()=>{},summaryCount:(x,elite)=>x?Number(x[elite?'elite':'normal']??x.normal??1):null,
  });
  const rendered=render({summary:entries,catalog:{traitWhen:TRAIT_WHEN},max:10});
  assert.match(rendered,/升级减费/);assert.match(rendered,/−2/);assert.match(rendered,/\+2/);assert.match(rendered,/召唤/);assert.match(rendered,/退场时/);assert.doesNotMatch(rendered,/\+null/);
  assert.doesNotMatch(render({summary:[{when:'gain',kind:'funds'}],catalog:{traitWhen:TRAIT_WHEN}}),/<b class="num">\+/,'unknown amount never renders a bare plus');
});
