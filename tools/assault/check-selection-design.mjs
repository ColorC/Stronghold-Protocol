import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const sel=read('data/assault-roster-selection.json');
const idx=read('data/assault-operator-index.json');
const errs=[];const fail=m=>errs.push(m);
const src=new Map(idx.operators.map(o=>[o.charId,o]));
const cards=new Map();for(const g of ['support','assault','ranged'])for(const o of read(`data/assault-design/roster-${g}.json`).operators||[])cards.set(o.charId,o);
if(sel.schema!=='assault-roster-selection/v1'||idx.count!==432||sel.candidates.length!==432)fail('source roster must close exactly 432 native identities');
const ids=new Set();const selected=new Set();const branches=new Map();for(const c of sel.candidates)if(c.selected){selected.add(c.charId);const o=src.get(c.charId);if(o){const k=`${o.profession}/${o.subProfessionId}`;if(!branches.has(k))branches.set(k,[]);branches.get(k).push(c.charId)}}
if(selected.size!==170||cards.size!==170||[...selected].some(id=>!cards.has(id))||[...cards.keys()].some(id=>!selected.has(id)))fail('selected set must exactly equal the three 170-card per-card rosters');
const additions=sel.candidates.filter(c=>c.selected&&c.additionReason);if(additions.length!==16||sel.closure?.additionCount!==16)fail('exactly 16 additions to existing active/body pool must be explained');
for(const c of sel.candidates){if(ids.has(c.charId))fail(`duplicate ${c.charId}`);ids.add(c.charId);const o=src.get(c.charId);if(!o){fail(`unknown source identity ${c.charId}`);continue}if(c.name!==o.name||c.profession!==o.profession||c.source?.pointer!==o.pointers.record||c.source?.file!==o.source.characterTable)fail(`${c.charId}: identity/source pointer mismatch`);
if(c.selected){const d=cards.get(c.charId),x=c.selectedDesign;if(!d||!x)fail(`${c.charId}: selected per-card association missing`);else{if(x.archetype!==d.archetype||x.priceTier!==d.priceTier||x.price!==d.price||x.branchId!==o.subProfessionId||x.defaultModuleId!==d.defaultModuleId||x.fixedSkillSourceId!==(d.fixedSkill?.sourceSkillId??null))fail(`${c.charId}: selected design association mismatch`);if(!Array.isArray(c.reasons)||!c.reasons.length)fail(`${c.charId}: selected inclusion reason missing`)}if(c.candidateRole!==null)fail(`${c.charId}: selected identity has candidate role`);if(c.additionReason&&(!d?.designReason||!c.additionReason.includes(d.designReason)||!c.additionReason.includes(d.priceReason)))fail(`${c.charId}: additional inclusion reason not grounded in card design`);
}else{const a=c.candidateAssessment;const k=`${o.profession}/${o.subProfessionId}`;const expected=(branches.get(k)||[]).slice().sort();if(!a||a.profession!==o.profession||a.branchId!==o.subProfessionId||JSON.stringify(a.signatureSkillIds)!==JSON.stringify(o.skillIds)||JSON.stringify(a.signatureModuleIds)!==JSON.stringify((o.modules||[]).map(m=>m.moduleId))||JSON.stringify((a.activeSameBranch||[]).slice().sort())!==JSON.stringify(expected))fail(`${c.charId}: candidate branch/signature/active coverage mismatch`);if(!a?.decision||!c.candidateRole||!Array.isArray(c.reasons)||c.reasons[0]!==a.decision)fail(`${c.charId}: candidate-specific decision missing`);}
}
const formsPath=path.join(ROOT,'data/assault-design/forms.json');const formsExists=fs.existsSync(formsPath);if(formsExists){const f=JSON.parse(fs.readFileSync(formsPath,'utf8'));if(!JSON.stringify(f).includes('char_002_amiya'))fail('forms table does not identify Amiya alternate forms');}
console.log(JSON.stringify({file:path.join(ROOT,'data/assault-roster-selection.json'),sourceCount:idx.count,actual:ids.size,selected:selected.size,perCard:cards.size,additions:additions.length,amiyaFormsTable:formsExists,ok:errs.length===0,errors:errs}));process.exitCode=errs.length?1:0;
