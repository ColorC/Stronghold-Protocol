import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
process.env.SP_DATA_DIR ??= path.join(CANONICAL, 'data/resonance-native');
const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/resonance/mechanism-correspondence.json'), 'utf8'));
const [{ getData }, { getResonanceCatalog }, { resonanceOpenings }] = await Promise.all([
  import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'), import('../../shared/resonance/openings.js'),
]);
const catalog = getResonanceCatalog(getData(), { rulesVersion: 2, seed: 1 });
const refRoots = new Map();
function rootFor(file) {
  if (!refRoots.has(file)) refRoots.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
  return refRoots.get(file);
}
function atPointer(root, pointer) {
  if (!pointer || pointer === '/') return root;
  return pointer.split('/').slice(1).reduce((value, part) => value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}
function verifyRecordId(ref, record) {
  if (!ref.recordID || !record || typeof record !== 'object') return;
  const collect = value => [value.apiName,value.id,value.name,value.key,value.recordId,value.claim,value.skillId,value.prefabId,value.characterId,value.nativeApiName,value.RoleID,value.TraitID].filter(v=>v!=null).map(String);
  const ids=collect(record);
  if(ref.parentJsonPointer)ids.push(...collect(atPointer(rootFor(ref.jsonFile),ref.parentJsonPointer)));
  if (ids.length) assert.ok(ids.includes(String(ref.recordID))||ids.includes(String(ref.parentRecordID)), `${ref.recordID} must identify ${ref.jsonPointer}`);
}

test('active records exactly cover the current v2 catalog', () => {
  const expected = {
    operators: catalog.config.activeOperatorIds,
    pacts: Object.keys(catalog.pacts),
    equipment: Object.keys(catalog.equipment),
    recipes: catalog.recipes.map((r, index) => r.id ?? `${r.resultId}:${(r.parts ?? r.components ?? r.ingredients ?? []).join('+')}:${index}`),
    strategies: Object.keys(catalog.strategies),
    openingEvents: Object.keys(resonanceOpenings),
  };
  for (const [kind, ids] of Object.entries(expected)) {
    const actual = Object.keys(matrix.records[kind] ?? {});
    assert.deepEqual([...actual].sort(), [...ids].sort(), `${kind} IDs must match the current catalog exactly`);
    assert.equal(new Set(actual).size, ids.length, `${kind} IDs must be unique`);
  }
  assert.deepEqual(matrix.coverage.catalogCounts, {
    activeOperators:catalog.config.activeOperatorIds.length,pacts:Object.keys(catalog.pacts).length,equipment:Object.keys(catalog.equipment).length,recipes:catalog.recipes.length,strategies:Object.keys(catalog.strategies).length,openingEvents:Object.keys(resonanceOpenings).length,
  });
});

test('every competitor JSON pointer resolves and points to its declared record identity', () => {
  for (const [kind, rows] of Object.entries(matrix.records)) for (const row of Object.values(rows)) {
    assert.equal(row.catalogID, Object.entries(rows).find(([, value]) => value === row)?.[0]);
    assert.ok(['adapted','partial','unmatched'].includes(row.coverageClass));
    for(const axis of ['condition','target','trigger','reward','scope','resetCap'])assert.notEqual(row.mechanism?.[axis],undefined,`${kind}/${row.catalogID} includes ${axis}`);
    for (const ref of row.refs ?? []) {
      const sourceUrls=Array.isArray(ref.sourceURL)?ref.sourceURL:[ref.sourceURL];
      assert.ok(ref.nativeGit||(sourceUrls.length&&sourceUrls.every(url=>url?.startsWith('https://'))), `${kind}/${row.catalogID} needs valid source URLs or native git provenance`);
      assert.ok(ref.jsonFile && ref.jsonPointer, `${kind}/${row.catalogID} needs a concrete local JSON pointer`);
      assert.ok(!ref.jsonFile.includes('.omni')&&!ref.jsonFile.includes('.worktrees'),`${kind}/${row.catalogID} references must persist in canonical paths`);
      const file = path.isAbsolute(ref.jsonFile) ? ref.jsonFile : path.join(ROOT, 'docs/resonance/reference', ref.jsonFile);
      assert.ok(fs.existsSync(file), `reference file exists: ${file}`);
      const record = atPointer(rootFor(file), ref.jsonPointer);
      assert.notEqual(record, undefined, `${kind}/${row.catalogID}: ${ref.jsonPointer} resolves`);
      verifyRecordId(ref, record);
    }
    for (const ref of row.nativeReferences ?? []) {
      assert.ok(fs.existsSync(ref.jsonFile), `native source exists: ${ref.jsonFile}`);
      const record = atPointer(rootFor(ref.jsonFile), ref.jsonPointer);
      assert.notEqual(record, undefined, `native pointer resolves: ${ref.jsonPointer}`);
      verifyRecordId(ref, record);
      assert.ok(ref.nativeGit, 'native evidence must identify its git revision');
    }
    for (const ref of row.relatedNativeMechanisms??[]) {
      assert.ok(ref.reference?.nativeGit);
      assert.notEqual(atPointer(rootFor(ref.reference.jsonFile),ref.reference.jsonPointer),undefined);
      assert.match(ref.relationship,/separate from the current Resonance star-3/);
    }
    for (const ref of row.externalRefs??[]) {
      const sourceUrls=Array.isArray(ref.sourceURL)?ref.sourceURL:[ref.sourceURL];
      assert.ok(sourceUrls.length&&sourceUrls.every(url=>url?.startsWith('https://')));
      assert.ok(ref.sourceKind||ref.sourceSection||ref.sourceEffectText,'source-only citations identify their text carrier');
      assert.equal(ref.jsonPointer,undefined,'HTML text references do not invent a JSON Pointer');
    }
  }
});

test('unmatched entries do not claim competitor evidence and unresolved mechanisms stay visible', () => {
  const unresolved = [];
  for (const [kind, rows] of Object.entries(matrix.records)) for (const row of Object.values(rows)) {
    if (row.coverageClass === 'unmatched') {
      assert.equal(row.refs.length, 0, `${kind}/${row.catalogID} cannot invent a source`);
      assert.ok(row.remainingUnsupported?.length, `${kind}/${row.catalogID} lists concrete unsupported components`);
    }
    for (const issue of row.remainingUnsupported ?? []) unresolved.push(`${kind}/${row.catalogID}|${issue}`);
  }
  for (const system of Object.values(matrix.systems)) for (const issue of system.remainingUnsupported ?? []) unresolved.push(`${system.kind}/${system.catalogID}|${issue}`);
  assert.deepEqual(matrix.unresolvedActiveCoreMechanisms.map(x => `${x.kind}/${x.catalogID}|${x.issue}`).sort(), unresolved.sort());
  assert.equal(matrix.interpretation.coverageClasses.exact, undefined, 'no unsupported blanket exact class');
  assert.equal(matrix.referenceSourceRegistry.tft.currentOfficialLegality, 'unconfirmed');
  assert.match(matrix.referenceSourceRegistry.tft.version, /TFTraits 18\.4 publication/);
  assert.deepEqual(Object.entries(matrix.records.operators).filter(([,row])=>row.userExplicit).map(([id])=>id),['chess_char_6_13_a']);
  assert.deepEqual(Object.entries(matrix.records.pacts).filter(([,row])=>row.userExplicit).map(([id])=>id).sort(),['aegir','yela']);
  assert.equal(matrix.records.pacts.holyGun.userExplicit,false,'the legacy audit designation is not carried forward');
  assert.equal(matrix.nativeAuditStatistics.changedStarOverrideOperators,49);
  assert.equal(matrix.nativeAuditStatistics.changedStarOverrideFieldCount,234);
  assert.equal(Object.values(matrix.records.operators).reduce((sum,row)=>sum+row.nativeSkillFieldDiffs.length,0),234);
  assert.ok(Object.values(matrix.records.operators).every(row=>row.refs.some(ref=>ref.nativeGit)),'native inherited skills count as concrete mechanism references');
  assert.ok(Object.values(matrix.records.operators).some(row=>row.coverageClass!=='unmatched'));
  assert.ok(Object.values(matrix.records.pacts).filter(row=>row.coverageClass==='unmatched').length<9,'valid current-component evidence must not be discarded by whole-effect-kind changes');
  assert.ok(matrix.records.pacts.iberia.refs.some(ref=>ref.recordID==='DA_18_Malphite'||ref.parentRecordID==='DA_18_Malphite'));
  assert.equal(matrix.records.pacts.babel.coverageClass,'partial','historical Forgotten evidence supports only victory-growth component');
  assert.ok(matrix.records.pacts.babel.externalRefs.some(ref=>/teamfight-tactics-patch-11-15-notes/.test(ref.sourceURL)&&/Forgotten/.test(ref.sourceEffectText)));
  assert.ok(matrix.records.pacts.breaker.externalRefs.some(ref=>/teamfight-tactics-patch-13-1-notes/.test(ref.sourceURL)));
  assert.ok(matrix.records.pacts.lungmen.refs.some(ref=>ref.nativeGit&&ref.jsonPointer==='/chess_char_6_08_a/skill'));
  assert.ok(matrix.records.operators.chess_char_5_05_a.relatedNativeMechanisms[0].relationship.includes('does not support that effect'));
  assert.equal(matrix.records.operators.chess_char_6_13_a.remainingUnsupported.some(issue=>/star3_holyGun/.test(issue)),false,'user-explicit composite is not mislabeled as source-less');
  assert.equal(matrix.records.pacts.babel.remainingUnsupported.some(issue=>/firstExitTeamSp/.test(issue)),false,'historical ally-death resource primitive is a documented adaptation');
  assert.equal(matrix.records.pacts.lungmen.remainingUnsupported.some(issue=>/sixMemberArtillery/.test(issue)),false,'count, target and damage-scaling differences are adaptations');
  assert.equal(matrix.records.pacts.redeploy.remainingUnsupported.some(issue=>/redeployTimeReduction|firstReturnBonus/.test(issue)),false,'current pact sources support cooldown reduction and deployment AoE primitives');
  assert.equal(matrix.records.equipment.holyCloak.remainingUnsupported.some(issue=>/周期清除自身寒冷/.test(issue)),false,'status dispel source supports the cleanse primitive');
  assert.ok(matrix.records.equipment.holyCloak.adaptations.some(note=>note.startsWith('Dota 自走棋 equipment/64')));
  assert.equal(matrix.records.equipment.holyCloak.adaptations.some(note=>note.startsWith('本体equipment/64')),false,'Dota equipment provenance is not mislabeled as Stronghold native data');
  assert.equal(matrix.records.equipment.azureTear.remainingUnsupported.some(issue=>/技能结束而非施放终结技/.test(issue)),false,'Blue Battery supports after-cast resource gain');
  assert.equal(matrix.records.equipment.redemptionCloak.remainingUnsupported.some(issue=>/递归/.test(issue)),false,'non-recursion is a local resolution guard, not a competitor mechanic requirement');
  for(const row of Object.values(matrix.records.equipment))assert.equal(row.remainingUnsupported.some(issue=>/初始资源与Tear现版持续回复不等价/.test(issue)),false,'starting-SP amount/timing is covered by the shared historical comparator');
  assert.equal(matrix.records.strategies.strategy_26.remainingUnsupported.some(issue=>/noExtraCount/.test(issue)),false,'one identity contributes normally once; no phantom chess is created');
  assert.equal(matrix.records.strategies.strategy_35.remainingUnsupported.some(issue=>/仅造物且全队每场首次/.test(issue)),false,'death-triggered resurrection is sourced; eligibility and battle cap are adaptations');
  assert.ok(matrix.records.pacts.babel.externalRefs.some(ref=>/teamfight-tactics-patch-13-1-notes/.test(ref.sourceURL)&&/On Ally Death/.test(ref.sourceEffectText)));
  assert.ok(matrix.records.equipment.azureTear.externalRefs.some(ref=>/teamfight-tactics-patch-12-11-notes/.test(ref.sourceURL)&&/after casting/.test(ref.sourceEffectText)));
});

test('disabled legacy strategies and transfer items are separate from the active v2 matrix', () => {
  assert.deepEqual(matrix.coverage.removedFeatures.map(x => `${x.kind}/${x.catalogID}`).sort(), [
    ...['strategy_15','strategy_16','strategy_23','strategy_24','strategy_27','strategy_28','strategy_29','strategy_30'].map(id=>`strategies/${id}`),
    ...['transfer_holyGun','transfer_yela','transfer_crown','transfer_breaker','transfer_arts','transfer_ammo','transfer_control','transfer_symbiosis','transfer_aegir','transfer_yan'].map(id=>`equipment/${id}`),
    ...['firstControlToSp','firstElementBurstToSp','tippyAirborneAspd'].map(id=>`operator-effects/${id}`),
  ].sort());
  for (const feature of matrix.coverage.removedFeatures) if(matrix.records[feature.kind])assert.equal(matrix.records[feature.kind][feature.catalogID], undefined);
});

test('campaign, economy and UI structures preserve the intended comparison boundaries', () => {
  assert.match(matrix.systems.campaign.mechanism.comparison, /30 rounds.*3 lives.*6 boss.*28 nodes.*100 health/);
  assert.equal(matrix.systems.economy.coverageClass, 'partial');
  assert.equal(matrix.systems.economy.remainingUnsupported.length,0);
  assert.ok(matrix.systems.economy.externalRefs.length>=4,'historical economy source primitives are cited individually');
  assert.ok(matrix.systems.economy.externalRefs.every(ref=>ref.sourceURL.startsWith('https://')&&ref.sourceSection));
  const designBasis=matrix.systems.economy.designBasis;
  assert.equal(designBasis.absolutePath,'E:\\WindowsWorkspace\\spark.workshop\\debug-agent\\workshop\\data\\projects\\arknights\\material\\notes\\texts\\text-c536b659-3c89-40ab-ba70-db5648e64081.md');
  assert.equal(designBasis.sourceURL,'https://workshop.colorc.cc/bside/canvas?project=arknights&canvas=canvas-0470c0a1#card=text-c536b659-3c89-40ab-ba70-db5648e64081');
  assert.deepEqual(designBasis.sourceLines,[8,9,10]);
  const sourceLines=fs.readFileSync(designBasis.absolutePath,'utf8').split(/\r?\n/);
  assert.match(sourceLines[7],/每有10货币\+1利息，最多5/);
  assert.match(sourceLines[8],/人口数随着科技等级提升/);
  assert.match(sourceLines[9],/经验改成4货币一买/);
  assert.equal(matrix.systems.equipmentStartingSP.historicalComparator.version, '2025-07-15 historical item changes');
  assert.equal(matrix.systems.equipmentStartingSP.historicalComparator.jsonPointer, null, 'no local historical snapshot is fabricated');
  assert.match(matrix.systems.equipmentStartingSP.historicalComparator.sourceURL, /roles-revamped-and-item-changes/);
  assert.match(matrix.systems.uiInformation.current.sourceUpstreamCommit, /^62eb113419123d9a3a63606107bbf85230c5dd2f$/);
  for(const ref of matrix.systems.campaign.externalRefs)assert.ok(ref.sourceURL.startsWith('https://')&&ref.sourceSection);
  for (const ref of matrix.systems.uiInformation.externalRefs) {
    assert.ok(ref.sourceURL.startsWith('https://'));
    assert.ok(fs.existsSync(ref.localFile));
    assert.ok(ref.localAnchor);
  }
  const md=fs.readFileSync(path.join(ROOT,'docs/resonance/mechanism-correspondence.md'),'utf8');
  assert.match(md,/尚未找到对应因果原语的机制/);
  assert.doesNotMatch(md,/pending|root-adjudicated|user-explicit-composite/i,'formal Markdown uses reader-facing Chinese status wording');
  assert.doesNotMatch(md,/\b(?:adapted|partial|unmatched)\s+\d+\b/i,'coverage statuses in Chinese Markdown are localized');
  assert.doesNotMatch(md,/完整机制对应.*100%|完全同款/i,'the matrix never claims blanket equivalence');
});

test('generator is idempotent from formal JSON annotations without staging reads',()=>{
  const env={...process.env,RESONANCE_STAGING_UNAVAILABLE:'1',SP_DATA_DIR:path.join(CANONICAL,'data/resonance-native')};
  const jsonPath=path.join(ROOT,'docs/resonance/mechanism-correspondence.json');
  const mdPath=path.join(ROOT,'docs/resonance/mechanism-correspondence.md');
  const beforeJson=fs.readFileSync(jsonPath,'utf8');
  const beforeMd=fs.readFileSync(mdPath,'utf8');
  execFileSync(process.execPath,['tools/resonance/build-correspondence.mjs'],{cwd:ROOT,env,stdio:'ignore'});
  const afterFirstJson=fs.readFileSync(jsonPath,'utf8');
  const afterFirstMd=fs.readFileSync(mdPath,'utf8');
  execFileSync(process.execPath,['tools/resonance/build-correspondence.mjs'],{cwd:ROOT,env,stdio:'ignore'});
  const afterSecondJson=fs.readFileSync(jsonPath,'utf8');
  const afterSecondMd=fs.readFileSync(mdPath,'utf8');
  assert.equal(afterFirstJson,afterSecondJson,'second generation does not add duplicate evidence or metadata drift');
  assert.equal(afterFirstMd,afterSecondMd,'second generation leaves Markdown bytes unchanged');
  assert.equal(beforeJson,afterFirstJson,'one generation does not dirty an already generated formal matrix');
  assert.equal(beforeMd,afterFirstMd,'one generation does not dirty already generated Markdown');
  const regenerated=JSON.parse(afterSecondJson);
  assert.equal(regenerated.bootstrapComplete,true);
  assert.deepEqual(regenerated.coverage.catalogCounts,matrix.coverage.catalogCounts);
  assert.ok(regenerated.records.operators.chess_char_6_13_a.refs.some(ref=>ref.nativeGit));
  for(const rows of Object.values(regenerated.records))for(const row of Object.values(rows))for(const field of ['refs','candidateRefs','externalRefs'])if(row[field])assert.equal(new Set(row[field].map(ref=>JSON.stringify([ref.game,ref.version,ref.parentRecordID??ref.recordID??ref.recordId??ref.name,ref.sourceURL??ref.sourceUrl,ref.sourceSection??ref.section,ref.sourceEffectText??ref.sourceMechanism,ref.jsonFile??ref.sourcePath,ref.jsonPointer]))).size,row[field].length,`${row.kind}/${row.catalogID}/${field} has semantic duplicates`);
});
