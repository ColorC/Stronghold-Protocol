import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const STAGING = path.join(CANONICAL, '.omni/tmp/resonance');
const outJson = path.join(ROOT,'docs/resonance/mechanism-correspondence.json');
const outMd = path.join(ROOT,'docs/resonance/mechanism-correspondence.md');
const canonicalChessPath = path.join(CANONICAL, 'data/resonance-native/chess.json');
const priorMatrix = fs.existsSync(outJson) ? JSON.parse(fs.readFileSync(outJson,'utf8')) : null;
const bootstrap = priorMatrix?.bootstrapComplete !== true;
if (bootstrap && process.env.RESONANCE_STAGING_UNAVAILABLE === '1') throw new Error('CORRESPONDENCE_BOOTSTRAP_REQUIRES_EXISTING_MATRIX_OR_STAGING');
process.env.SP_DATA_DIR ??= path.join(CANONICAL, 'data/resonance-native');
const [{ getData }, { getResonanceCatalog }, { resonanceOpenings }, { resonanceContent }] = await Promise.all([
  import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'), import('../../shared/resonance/openings.js'), import('../../shared/resonance/catalog.js'),
]);
const { DISABLED_CURRENT_TRANSFER_IDS } = await import('../../shared/resonance/current-equipment.js');
const { currentPactEvidence } = await import('../../shared/resonance/current-pacts.js');

const data = getData();
const catalog = getResonanceCatalog(data, { rulesVersion: 2, seed: 1 });
const tft = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/resonance/reference/tft-set18.json'), 'utf8'));
const dota = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/resonance/reference/dota-current.json'), 'utf8'));
const currency = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/resonance/reference/currency-current.json'), 'utf8'));
const bootstrapInput = (filename) => bootstrap ? JSON.parse(fs.readFileSync(path.join(STAGING,filename),'utf8')) : null;
const baseAudit = bootstrapInput('strategy-equipment-correspondence-audit.json');
const expanded = bootstrapInput('extended-strategy-equipment-candidates.json');
const pactOperatorAudit = bootstrapInput('pact-operator-correspondence-audit.json');
const nativeAudit = bootstrapInput('season-native-mechanism-evidence.json');
const finalPactEvidence = bootstrap ? JSON.parse(fs.readFileSync(path.join(STAGING,'final-pact-evidence.json'),'utf8')) : null;
const disabledStrategies = ['strategy_15','strategy_16','strategy_23','strategy_24','strategy_27','strategy_28','strategy_29','strategy_30'];
const userExplicitOperators = new Set(['chess_char_6_13_a']);
const userExplicitPacts = new Set(['aegir','yela']);
const tftVersion = `TFTraits 18.4 publication / ${tft.supplement.sources.items.declaredVersion}`;
const nativeCommit = bootstrap ? nativeAudit.scope.nativeGitCommit : priorMatrix.boundary.nativeGitCommit;
const nativeChessPath = canonicalChessPath;
const tftUrls = {
  publishedItems: tft.supplement.sources.items.url,
  publishedAugmentItems: tft.supplement.sources.items.url,
  publishedTraits: tft.supplement.sources.traits.url,
  publishedChampions: tft.supplement.sources.champions.url,
};
const gameRefs = {
  'Teamfight Tactics': { version: tftVersion },
  'Dota Auto Chess': { version: 'Dota Auto Chess frozen upstream snapshot', sourceCommit: '8dde7071e6f07d1b5bbe3d415bcf4ef0a6a18b8e' },
  '崩坏：星穹铁道「货币战争」': { version: currency.version, sourceCommit: currency.sourceCommit },
  '崩坏：星穹铁道货币战争': { version: currency.version, sourceCommit: currency.sourceCommit },
};
const refFiles = {
  'tft-set18.json': { read: path.join(ROOT, 'docs/resonance/reference/tft-set18.json'), output:path.join(CANONICAL,'docs/resonance/reference/tft-set18.json') },
  'dota-current.json': { read: path.join(ROOT, 'docs/resonance/reference/dota-current.json'), output:path.join(CANONICAL,'docs/resonance/reference/dota-current.json') },
  'currency-current.json': { read: path.join(ROOT, 'docs/resonance/reference/currency-current.json'), output:path.join(CANONICAL,'docs/resonance/reference/currency-current.json') },
  'existing-game.json': { read: path.join(ROOT, 'docs/resonance/reference/existing-game.json'), output:path.join(CANONICAL,'docs/resonance/reference/existing-game.json') },
};
const refContent = new Map(Object.entries({ 'tft-set18.json':tft, 'dota-current.json':dota, 'currency-current.json':currency }));
function cachedJson(filename) {
  const basename=path.basename(filename);
  if(!refContent.has(basename))refContent.set(basename,JSON.parse(fs.readFileSync(filename,'utf8')));
  return refContent.get(basename);
}
const pointerGet = (root, pointer) => {
  if (!pointer || pointer === '/') return root;
  return pointer.split('/').slice(1).reduce((value, part) => value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], root);
};
const safeJson = (v) => v === undefined ? null : v;
const asRows = (value) => Array.isArray(value) ? value : Object.values(value ?? {});
const effects = (record) => Array.isArray(record?.effects) ? record.effects : [];
const effectsAtLevels = (record) => (record?.levels ?? []).flatMap((level) => level.effects ?? []);
const json = (v) => JSON.stringify(v ?? null);
const sourcePointer = (kind, id, index) => kind === 'recipes' ? `/recipes/${index}` : `/${kind}/${id}`;
const lookup = (obj, key) => obj?.[key];

function normalizeRef(raw) {
  if (!raw?.jsonPointer) return null;
  const rawGame = raw.game ?? 'Unknown game';
  const game = rawGame === 'TFT' ? 'Teamfight Tactics' : rawGame;
  const native = /原生|native/i.test(game) || Boolean(raw.nativeGit);
  const requestedFile = path.basename(String(raw.jsonFile ?? raw.localJsonFile ?? raw.sourcePath ?? ''));
  const inferredFile = game === 'Teamfight Tactics' ? 'tft-set18.json' : game === 'Dota Auto Chess' ? 'dota-current.json' : game.includes('货币战争') ? 'currency-current.json' : '';
  const basename = requestedFile && refFiles[requestedFile] ? requestedFile : inferredFile;
  const paths = native ? { read:nativeChessPath, output:nativeChessPath } : refFiles[basename];
  if (!paths || !fs.existsSync(paths.read)) return null;
  const pointer = raw.jsonPointer;
  const root = native ? cachedJson(nativeChessPath) : cachedJson(paths.read);
  const record = pointerGet(root, pointer);
  if (record === undefined || record === null) return null;
  const requestedId=raw.recordID ?? raw.recordId ?? raw.id;
  const recordIds=[record.apiName,record.id,record.name,record.key,record.recordId,record.claim,record.skillId,record.prefabId,record.characterId,record.nativeApiName,record.RoleID,record.TraitID].filter(v=>v!==undefined&&v!==null).map(String);
  const segments=pointer.split('/').slice(1);
  let parentPointer='/',parentIds=[];
  for(let size=segments.length-1;size>=0;size--){const candidatePointer=size?`/${segments.slice(0,size).join('/')}`:'/';const candidate=pointerGet(root,candidatePointer);const ids=[candidate?.apiName,candidate?.id,candidate?.name,candidate?.key,candidate?.recordId,candidate?.characterId,candidate?.nativeApiName,candidate?.RoleID,candidate?.TraitID].filter(v=>v!==undefined&&v!==null).map(String);if(ids.length){parentPointer=candidatePointer;parentIds=ids;break;}}
  if(!native&&requestedId&&recordIds.length&&!recordIds.includes(String(requestedId))&&!parentIds.includes(String(requestedId)))return null;
  const family = pointer.split('/')[1];
  const gameMeta = gameRefs[game] ?? {};
  const sourceURL = native ? (raw.sourceURL ?? raw.sourceUrl ?? null) : game === 'Teamfight Tactics'
    ? (tftUrls[pointer.includes('/publishedChampions/')?'publishedChampions':family] ?? raw.sourceURL ?? raw.sourceUrl)
    : (raw.sourceURL ?? raw.sourceUrl ?? gameMeta.sourceURL ?? null);
  return {
    game, version: game === 'Teamfight Tactics' && !/11\.15|12\.23|14\.17|17\.2/.test(String(raw.version ?? '')) ? tftVersion : (raw.version ?? gameMeta.version ?? 'version not identified'),
    recordID: native ? (record.skillId ?? record.prefabId ?? record.apiName ?? record.id ?? record.name ?? requestedId ?? null) : (raw.parentRecordID&&parentIds.includes(String(raw.parentRecordID))?String(raw.parentRecordID):requestedId&&parentIds.includes(String(requestedId))?String(requestedId):(record.apiName ?? record.id ?? record.name ?? record.key ?? record.recordId ?? record.claim ?? record.skillId ?? record.prefabId ?? record.characterId ?? record.nativeApiName ?? record.RoleID ?? record.TraitID ?? requestedId ?? null)),
    ...(parentPointer!=='/'&&parentIds.length?{parentJsonPointer:parentPointer,parentRecordID:parentIds[0]}:{}),
    ...(native&&requestedId?{subjectRecordID:String(requestedId)}:{}),
    jsonFile: paths.output, jsonPointer: pointer, sourceURL,
    ...(gameMeta.sourceCommit ? { sourceCommit: gameMeta.sourceCommit } : {}),
    ...(raw.nativeGit ? { nativeGit:raw.nativeGit } : native ? { nativeGit:`${raw.version ?? nativeCommit}:${path.basename(nativeChessPath)}#${pointer}` } : {}),
    ...(raw.sourceMechanism || raw.sourceEffectText ? { sourceMechanism: raw.sourceMechanism ?? raw.sourceEffectText } : {}),
  };
}

function directReference(raw, recordIdFallback) {
  if (!raw?.jsonPointer) return null;
  const ref = { ...raw, recordID: raw.recordId ?? recordIdFallback, jsonFile: path.join(ROOT, 'docs/resonance/reference/tft-set18.json') };
  return normalizeRef(ref);
}

function oldRefs(rows = []) { return rows.map(normalizeRef).filter(Boolean); }
function extendedRefs(id) {
  if(!bootstrap)return oldRefs(priorMatrix.records?.equipment?.[id]?.refs ?? priorMatrix.records?.strategies?.[id]?.refs ?? []);
  const item = expanded.entries[id];
  return (item?.candidateRefs ?? []).map((ref) => normalizeRef({ ...ref, jsonFile: ref.jsonFile ?? ref.sourceFile })).filter(Boolean);
}
function uniqueRefs(rows) {
  const map = new Map();
  for (const ref of rows.filter(Boolean)) {
    const recordID=ref.jsonPointer?(ref.parentRecordID??ref.recordID):(ref.recordID??ref.recordId??ref.name??null);
    const identity=[ref.game??null,ref.version??null,recordID,ref.sourceURL??ref.sourceUrl??null,ref.sourceSection??ref.section??null,ref.sourceEffectText??ref.sourceMechanism??null,ref.jsonFile??ref.sourcePath??null,ref.jsonPointer??null,ref.nativeGit??ref.sourceCommit??null];
    const key=JSON.stringify(identity);
    if(!map.has(key))map.set(key,ref);
  }
  return [...map.values()];
}
function uniqueSourceRefs(rows=[]) {
  const map=new Map();
  for(const ref of rows.filter(Boolean)){
    const identity=[ref.game??null,ref.version??null,ref.recordID??ref.recordId??ref.name??null,ref.sourceURL??ref.sourceUrl??null,ref.sourceSection??ref.section??null,ref.sourceEffectText??ref.sourceMechanism??null,ref.jsonPointer??null];
    const key=JSON.stringify(identity);
    if(!map.has(key))map.set(key,ref);
  }
  return [...map.values()];
}
function localRef(game, version, recordId, jsonFile, jsonPointer, sourceURL, nativeGit = null) {
  return { game, version, recordID: recordId, jsonFile, jsonPointer, sourceURL, ...(nativeGit ? { nativeGit } : {}) };
}
function summarizeEffects(rows) {
  return rows.map((e) => ({ kind: e.kind, params: safeJson(e.params), reference: safeJson(e.reference) }));
}
function localMechanism(kind, id, record) {
  const es = kind === 'pacts' ? effectsAtLevels(record) : effects(record);
  const levels = kind === 'pacts' ? (record.levels ?? []).map((row) => ({ threshold: row.threshold, effects: summarizeEffects(row.effects ?? []) })) : [];
  const skill=record.stars?.[1]?.record?.skill;
  const trigger = kind === 'operators'
    ? { fixedSkillId: record.fixedSkillId, skillType:skill?.skillType,spType:skill?.spType,spCost:skill?.spCost,initSp:skill?.initSp,duration:skill?.duration,durationType:skill?.durationType,trigger:skill?.trigger,star3Passive: record.stars?.[3]?.passive }
      : kind === 'recipes' ? { action: 'combine two components', ingredients: record.parts ?? record.components ?? record.ingredients ?? null }
      : kind === 'openingEvents' ? { automaticAtRunStart: true }
        : { timing: record.timing ?? record.trigger ?? null, effects: summarizeEffects(es), levels };
  const condition = kind === 'operators' ? `native fixed skill ${record.fixedSkillId}; activation follows the skill's SP type/cost and native trigger rule`
    : kind === 'pacts' ? `active identity count reaches configured thresholds ${json((record.levels ?? []).map(x => x.threshold))}`
    : kind === 'recipes' ? `two listed components available: ${(record.parts??record.components??record.ingredients??[]).join(' + ')}; ingredient order is not significant`
        : kind === 'openingEvents' ? 'seed deterministically selects one opening event' : json(record.condition ?? 'no additional condition declared');
  const target = kind === 'operators' ? (skill?.desc ?? skill?.description ?? 'native fixed-skill target text not present')
    : kind === 'pacts' ? 'active pact members and configured allies/enemies per tier effect'
      : kind === 'equipment' ? record.target ?? record.description ?? 'holder or configured combat targets'
        : kind === 'recipes' ? record.resultId ?? record.name
          : kind === 'openingEvents' ? record.description : record.target ?? 'player/session or battle units per effect';
  const reward = kind === 'operators' ? { fixedSkill: skill?.desc ?? skill?.description ?? null, star3: record.stars?.[3]?.passive ?? null }
    : kind === 'pacts' ? levels : kind === 'recipes' ? `creates ${record.resultId ?? record.name}`
      : kind === 'openingEvents' ? record.description : es.map((e) => ({ kind: e.kind, params: e.params }));
  const scope = kind === 'operators' ? `native fixed skill on ${record.name}; star-three passive follows its explicit scope/description`
    : kind === 'pacts' ? 'current run team; identity/extra pact counting follows runtime rules'
      : kind === 'recipes' ? 'one recipe operation, consuming two components'
        : kind === 'openingEvents' ? 'one event for the whole run; same recruit roster' : record.scope ?? 'run, node, battle, or holder scope as configured';
  const resetCap = kind === 'operators' ? record.stars?.[3]?.passive?.params ?? 'see skill resource, cooldown, and per-battle limits'
    : kind === 'pacts' ? es.map((e) => e.params).filter(Boolean)
      : kind === 'recipes' ? 'each operation consumes ingredients; no extra reuse cap declared'
        : kind === 'openingEvents' ? 'one automatic selection per run' : es.map((e) => e.params).filter(Boolean);
  return { condition, target, trigger, reward, scope, resetCap };
}
function addRecord(records, kind, id, displayName, effectKind, mechanism, refs, differences = [], unsupported = [], decision = 'root-adjudicated-retained-with-explicit-adaptations') {
  const validRefs = uniqueRefs(refs);
  const coverageClass = validRefs.length ? (differences.length ? 'partial' : 'adapted') : 'unmatched';
  records[kind][id] = {
    kind, catalogID: id, name: displayName, effectKind, mechanism,
    refs: validRefs, adaptations: differences,
    remainingUnsupported: unsupported,
    decision,
    coverageClass,
    mechanicComparison: { status: coverageClass, differences, remainingUnsupported: unsupported },
  };
}

const records = { operators: {}, pacts: {}, equipment: {}, recipes: {}, strategies: {}, openingEvents: {} };
const auditOperators = Object.fromEntries((pactOperatorAudit?.operators??[]).map((row) => [row.id, row]));
const auditPacts = Object.fromEntries((pactOperatorAudit?.pacts??[]).map((row) => [row.id, row]));
const nativeOperators = Object.fromEntries((nativeAudit?.operators??[]).map(row=>[row.id,row]));
const nativeOperatorOverlay = Object.fromEntries((nativeAudit?.currentV2OperatorOverlay?.operators??[]).map(row=>[row.id,row]));
const priorRecord = (kind,id) => priorMatrix?.records?.[kind]?.[id] ?? null;
function nativeReference(raw) { return normalizeRef(raw); }
function operatorCandidateEvidence(id, active) {
  if(!bootstrap) return (priorRecord('operators',id)?.dimensionEvidence ?? []).map(row=>({...row,reference:row.reference??normalizeRef(row.source)}));
  const audit=nativeOperators[id];
  const out=[];
  const extra=audit?.extraStar;
  const currentKinds=new Set([active?.stars?.[3]?.passive?.kind,active?.stars?.[3]?.passive?.additionalEffect?.kind].filter(Boolean));
  if(extra&&currentKinds.has(extra.kind))for(const candidate of extra.candidateEvidence??[]){
    const ref=nativeReference(candidate.reference);
    out.push({component:extra.kind,reference:ref??candidate.reference??null,dimensions:candidate.dimensionComparison??{},difference:candidate.difference??null,status:candidate.status??'candidate'});
  }
  const overlay=nativeOperatorOverlay[id];
  if(overlay?.nativeReference&&currentKinds.size){
    const ref=nativeReference(overlay.nativeReference);
    if(ref)out.push({component:[...currentKinds][0],reference:ref,dimensions:{},difference:overlay.difference,status:'native-adaptation'});
  }
  return out;
}
function collectEvidenceRefs(value,out=[],pointer='',inherited={}){
  if(!value||typeof value!=='object')return out;
  const context={...inherited,...(value.nativeCommit?{nativeCommit:value.nativeCommit}:{}),...(value.sourcePath?{sourcePath:value.sourcePath}:{}),...(value.game?{game:value.game}:{}),...(value.version?{version:value.version}:{}),...(value.nativeGit?{nativeGit:value.nativeGit}:{})};
  if(value.jsonPointer){
    const native=Boolean(value.nativeGit||context.nativeGit||context.nativeCommit||/原生/.test(context.game??''));
    out.push({...value,game:value.game??context.game??(native?'卫戍协议原生本体':undefined),version:value.version??context.version??context.nativeCommit,sourcePath:value.sourcePath??context.sourcePath,nativeGit:value.nativeGit??(native?`${context.nativeCommit??nativeCommit}:data/chess.json#${value.jsonPointer}`:undefined)});
  }
  for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')collectEvidenceRefs(child,out,`${pointer}/${key}`,context);
  return out;
}
function collectExternalSources(value,out=[]){
  if(!value||typeof value!=='object')return out;
  if((value.sourceURL||value.sourceUrl)&&!value.jsonPointer)out.push(value);
  for(const child of Object.values(value))if(child&&typeof child==='object')collectExternalSources(child,out);
  return out;
}
function pactDimensionEvidence(id){
  if(!bootstrap)return (priorRecord('pacts',id)?.dimensionEvidence??[]).map(row=>({...row,reference:row.reference??normalizeRef(row.source)}));
  const reviewed=(nativeAudit?.pactElements?.reviewedComponents??[]).filter(row=>row.pactId===id);
  const out=[];
  for(const component of reviewed)for(const candidate of component.candidates??[]){
    const reference=normalizeRef(candidate.reference);
    out.push({component:component.elementId,maps:candidate.maps??null,reference:reference??null,source:reference?null:candidate.reference??null,dimensions:component.coreMechanics??{},difference:candidate.difference??null,status:candidate.classification??candidate.status??'candidate'});
  }
  for(const [component,evidence] of Object.entries(nativeAudit?.pactElements?.newEvidenceSupplement??{})){
    if(!component.startsWith(`${id}.`))continue;
    for(const candidate of evidence.candidates??[]){const reference=normalizeRef(candidate.reference);out.push({component:component.slice(id.length+1),maps:candidate.maps??null,reference:reference??null,source:reference?null:candidate.reference??null,dimensions:candidate.dimensionComparison??{},difference:candidate.difference??null,status:candidate.status??evidence.status??'candidate'});}
  }
  for(const entry of finalPactEvidence?.evidence??[]){
    if(entry.pact!==id)continue;
    const candidates=entry.candidates??(entry.candidate?[entry.candidate]:[]);
    for(const candidate of candidates){
      const reference=normalizeRef(candidate);
      const mappedComponent={iberia:'barrierBreakDamage',lungmen:'sixMemberArtillery',breaker:'firstEliteKillAspd'}[entry.pact]??entry.element??entry.subject??entry.record;
      out.push({component:mappedComponent,maps:candidate.trigger??candidate.maps??null,reference:reference??null,source:reference?null:candidate,dimensions:{trigger:candidate.trigger??null,target:candidate.targetAndReward??null,reward:candidate.targetAndReward??null,scope:candidate.scopeResetCap??null,resetOrCap:candidate.scopeResetCap??null},difference:candidate.difference??entry.remainingDifference??null,status:entry.status??'candidate'});
    }
    for(const checked of entry.checked??[])out.push({component:entry.element,reference:normalizeRef({game:'卫戍协议原生本体',version:nativeCommit,recordId:checked.recordId,jsonPointer:checked.jsonPointer,sourcePath:nativeChessPath,nativeGit:`${nativeCommit}:data/chess.json#${checked.jsonPointer}`})??null,dimensions:{},difference:checked.assessment,status:'checked-negative'});
  }
  if(id==='iberia'){
    const ref=normalizeRef({game:'Teamfight Tactics',version:tftVersion,recordId:'DA_18_Malphite',jsonPointer:'/supplement/publishedChampions/47/reference/ability',sourcePath:path.join(CANONICAL,'docs/resonance/reference/tft-set18.json'),sourceURL:tftUrls.publishedChampions,sourceKind:'TFTraits 18.4 community game-data derivative publication'});
    out.push({component:'barrierBreakDamage',maps:'shield break → two-hex magic AoE',reference:ref,dimensions:{trigger:'shield breaks',target:'enemies within 2 hexes of shield holder',reward:'magic damage using Armor/MR and AP-based terms',scope:'holder ability',resetOrCap:'ability shield lasts 4 seconds; no first-block limit'},difference:'Direct trigger/reward/area prototype. Local pact creates a shield on first block and deals ATK-scaled Arts when it breaks; first-block timing, shield lifetime/recurrence, target radius semantics and stat projection are adaptations.',status:'partial'});
  }
  if(id==='babel')out.push({component:'firstExitTeamSp',maps:'ally death → resource gain',reference:null,source:{game:'Teamfight Tactics',version:'Patch 13.1 historical official Riot notes',recordID:'ADMIN On Ally Death',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-13-1-notes/',sourceKind:'official historical patch-note text; component-level comparison',sourceSection:'Traits — ADMIN; mid-patch balance update',sourceEffectText:'On Ally Death, ADMIN champions gain Mana; the patch history changes the listed Mana amount from 30 to 40 and later 20.'},dimensions:{trigger:'ally death',target:'ADMIN champions',reward:'Mana',scope:'within the ADMIN trait',resetOrCap:'per-death trigger'},difference:'The local effect grants team SP on each member’s first defeat or voluntary retreat; voluntary exit, first-per-member cap, beneficiary scope and Mana-to-SP projection are adaptations.',status:'partial'});
  if(id==='azureTear')out.push({component:'skillEndSp',maps:'after cast → resource gain',reference:null,source:{game:'Teamfight Tactics',version:'Patch 12.11 historical official Riot notes',recordID:'Blue Battery',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-12-11-notes/',sourceKind:'official historical patch-note text; component-level comparison',sourceSection:'Augments — Blue Battery',sourceEffectText:'Blue Battery grants Mana after casting an ability.'},dimensions:{trigger:'after casting an ability',target:'caster',reward:'Mana',scope:'caster',resetOrCap:'after each cast'},difference:'The local equipment grants SP when its holder’s skill ends; the native runtime locks SP gain during an active skill. Effect timing, SP amount and 3-second cooldown are adaptations.',status:'partial'});
  return out;
}

for (const id of catalog.config.activeOperatorIds) {
  const op = catalog.operators[id];
  const native = data.chess[id];
  const nativeEvidence = nativeOperators[id];
  const skillIndex = (native?.skills ?? []).findIndex((s) => s.skillId === op.fixedSkillId);
  const pointer = skillIndex >= 0 ? `/${id}/skills/${skillIndex}` : `/${id}`;
  const selectedSkill = nativeEvidence?.nativeSelectedSkill ?? { game:'卫戍协议原生本体',version:nativeCommit,recordId:id,jsonPointer:pointer,sourcePath:nativeChessPath,nativeGit:`${nativeCommit}:data/chess.json#${pointer}`,skillId:op.fixedSkillId };
  const nativeRef = nativeReference(selectedSkill);
  const prior = auditOperators[id];
  const previous=priorRecord('operators',id);
  const nativeSkill=(native?.skills??[]).find(skill=>skill.skillId===op.fixedSkillId);
  const dimensionEvidence=operatorCandidateEvidence(id,op);
  const candidateRefs=dimensionEvidence.map(row=>row.reference).filter(ref=>ref?.jsonPointer);
  const diffFields = [1,2,3].flatMap((star) => Object.entries(op.stars?.[star]?.skillOverrides ?? {}).filter(([field,value])=>json(value)!==json(nativeSkill?.[field])).map(([field]) => `star${star}.skill.${field}`));
  const auditDiffs=bootstrap?(nativeEvidence?.starOverrideDiffs??[]):(previous?.nativeAuditStarOverrideDiffs??[]);
  const extra=bootstrap?nativeEvidence?.extraStar:previous?.nativeExtraStar;
  const currentPassive=op.stars?.[3]?.passive;
  const currentExtraKinds=new Set([currentPassive?.kind,currentPassive?.additionalEffect?.kind].filter(Boolean));
  const extraActive=Boolean(extra&&currentExtraKinds.has(extra.kind));
  const hasCandidate=dimensionEvidence.some(row=>row.reference?.jsonPointer||row.reference?.sourceURL||row.reference?.nativeGit);
  const unsupported=extraActive&&!hasCandidate&&!userExplicitOperators.has(id)?[`star3 ${extra.kind}: current extra mechanic has no concrete source candidate`]:[];
  const diffs=[
    `Native fixed skill inherited from ${selectedSkill.skillId??op.fixedSkillId}; native description and trigger are preserved as the base mechanism.`,
    ...(auditDiffs.flatMap(row=>(row.skillOverrideFieldDiffs??[]).map(change=>`star${row.star}.skill.${change.field}: ${json(change.nativeValue)} → ${json(change.resonanceValue)}`))),
    ...(diffFields.length?[`Current live catalog skill-field differences: ${diffFields.join(', ')}`]:[]),
    ...(extraActive&&extra?.mechanism?[`Star-3 adaptation: ${extra.mechanism}`]:[]),
    ...dimensionEvidence.map(row=>row.difference).filter(Boolean),
  ];
  const refs=uniqueRefs([nativeRef,...candidateRefs]);
  const externalRefs=uniqueSourceRefs(dimensionEvidence.map(row=>row.reference).filter(ref=>ref&&!ref.jsonPointer&&ref.sourceURL).map(ref=>({game:ref.game,version:ref.version,recordID:ref.recordID,sourceURL:ref.sourceURL,sourceKind:'official source text; no local JSON record'})));
  const coverageClass=unsupported.length?'partial':'adapted';
  records.operators[id]={
    kind:'operators',catalogID:id,name:op.name,effectKind:['fixed-skill',currentPassive?.kind].filter(Boolean),mechanism:localMechanism('operators',id,op),refs,nativeReferences:[nativeRef],dimensionEvidence,
    externalRefs,adaptations:diffs,remainingUnsupported:unsupported,decision:userExplicitOperators.has(id)?'user-explicit-composite':'root-adjudicated-retained-with-explicit-adaptations',coverageClass,
    mechanicComparison:{status:coverageClass,differences:diffs,remainingUnsupported:unsupported},userExplicit:userExplicitOperators.has(id),nativeSkillFieldDiffs:auditDiffs.flatMap(row=>(row.skillOverrideFieldDiffs??[]).map(change=>`star${row.star}.skill.${change.field}`)),currentComputedSkillFieldDiffs:diffFields,nativeAuditStarOverrideDiffs:auditDiffs,nativeExtraStar:extra?{kind:extra.kind,mechanism:extra.mechanism,params:extra.params??null}:null,
  };
}
const ulpianusEvidence=(finalPactEvidence?.evidence??[]).find(row=>row.subject==='Ulpianus native kill growth');
if(ulpianusEvidence?.jsonPointer&&records.operators.chess_char_5_05_a){
  const ref=normalizeRef({game:'卫戍协议原生本体',version:nativeCommit,recordId:ulpianusEvidence.record,jsonPointer:ulpianusEvidence.jsonPointer,sourcePath:ulpianusEvidence.sourcePath,nativeGit:ulpianusEvidence.nativeGit,sourceEffectText:ulpianusEvidence.sourceEffectText});
  records.operators.chess_char_5_05_a.relatedNativeMechanisms=[{reference:ref,relationship:'Ulpianus native talent kill-growth reference. It is separate from the current Resonance star-3 hit-growth effect and does not support that effect.'}];
}else if(!bootstrap&&priorRecord('operators','chess_char_5_05_a')?.relatedNativeMechanisms){
  records.operators.chess_char_5_05_a.relatedNativeMechanisms=priorRecord('operators','chess_char_5_05_a').relatedNativeMechanisms;
}

for (const [id, pact] of Object.entries(catalog.pacts)) {
  const currentEvidenceOnly=['symbiosis','crown','burn'].includes(id);
  const old = auditPacts[id];
  const previous=priorRecord('pacts',id);
  const currentKinds = [...new Set(effectsAtLevels(pact).map(e => e.kind))].sort();
  const priorKinds = [...new Set(old?.effectKinds ?? [])].sort();
  const dimensions=currentEvidenceOnly?[]:pactDimensionEvidence(id);
  const oldStillHasCurrentComponent=currentKinds.some(kind=>priorKinds.includes(kind));
  const oldComponentRefs=oldStillHasCurrentComponent?oldRefs(old?.references??[]):[];
  const currentRefs=oldRefs(collectEvidenceRefs(currentPactEvidence[id]??{}));
  const dimensionRefs=dimensions.filter(row=>row.status!=='checked-negative').map(row=>row.reference).filter(Boolean);
  const persistedRefs=bootstrap||currentEvidenceOnly?[]:oldRefs(previous?.refs??[]);
  const refs=currentEvidenceOnly?uniqueRefs(currentRefs):uniqueRefs([...currentRefs,...dimensionRefs,...oldComponentRefs,...persistedRefs]);
  const externalRefs=[...collectExternalSources(currentPactEvidence[id]??{}).map(row=>({game:row.game,version:row.version,recordID:row.recordId??row.recordID??row.name??null,sourceURL:row.sourceURL??row.sourceUrl,sourceKind:row.sourceKind??'direct source text; no local JSON snapshot',sourceEffectText:row.sourceEffectText??null})),...(bootstrap||currentEvidenceOnly?[]:(previous?.externalRefs??[]))];
  for(const row of dimensions){const source=row.source;if(source&&(source.sourceURL||source.sourceUrl)&&!source.jsonPointer)externalRefs.push({game:source.game,version:source.version,recordID:source.recordID??source.recordId??null,sourceURL:source.sourceURL??source.sourceUrl,sourceKind:source.sourceKind??'historical official patch-note text; component-level comparison',sourceSection:source.sourceSection??null,sourceEffectText:source.sourceEffectText??null});}
  for(const row of dimensions){const source=row.source;if(source&&(source.sourceURL||source.sourceUrl)&&!source.jsonPointer)externalRefs.push({game:source.game,version:source.version,recordID:source.recordId??source.recordID??null,sourceURL:source.sourceURL??source.sourceUrl,sourceKind:'official historical patch-note text; component-level comparison',sourceEffectText:source.sourceEffectText??null,sourceSection:source.sourceSection??null});}
  for(const entry of finalPactEvidence?.evidence??[])if(entry.pact===id){for(const candidate of (entry.candidates??(entry.candidate?[entry.candidate]:[])))if((candidate.sourceURL||candidate.sourceUrl)&&!candidate.jsonPointer)externalRefs.push({game:candidate.game,version:candidate.version,recordID:candidate.recordId??candidate.recordID??null,sourceURL:candidate.sourceURL??candidate.sourceUrl,sourceKind:'official patch notes; historical text citation',sourceEffectText:candidate.sourceEffectText??null});}
  const candidates=currentEvidenceOnly?[]:uniqueRefs(bootstrap?[...oldRefs(old?.references??[]).filter(ref=>!refs.some(valid=>valid.jsonPointer===ref.jsonPointer&&valid.game===ref.game))]:(previous?.candidateRefs??[]));
  const explicit = userExplicitPacts.has(id);
  const computedDiffs=[
    ...(oldStillHasCurrentComponent&&priorKinds.join('|')!==currentKinds.join('|')?[`Prior source applies only to retained effect component(s) ${currentKinds.filter(kind=>priorKinds.includes(kind)).join(', ')}; removed SP/other effects are not restored.`]:[]),
    ...dimensions.map(row=>`${row.component}: ${row.maps??'component evidence'}${row.difference?` — ${row.difference}`:''}`),
    `Thresholds, targets, timings, values and reset/cap values are taken from the current v2 pact record below; these component sources do not establish the complete composite as an exact match.`,
  ];
  const currentDifference=currentPactEvidence[id]?.difference;
  const diffs=currentEvidenceOnly?[...(currentDifference?[currentDifference]:[]),'Thresholds, targets, timings, values and reset/cap values follow the current v2 pact; cited mechanisms support only the stated primitives, not an exact composite match.']:(bootstrap?computedDiffs:(previous?.adaptations??computedDiffs));
  const resolvedComponentNames=new Set(dimensions.filter(row=>row.status!=='checked-negative').map(row=>row.component));
  const unresolved=(bootstrap?(nativeAudit?.pactElements?.remainingUnsupported??[]).filter(row=>row.pactId===id&&!String(row.v2Disposition??'').includes('removed-from-v2')&&!resolvedComponentNames.has(row.elementId)).map(row=>`${row.elementId}: ${row.remainingUnsupported}`):priorRecord('pacts',id)?.remainingUnsupported??[]);
  if(bootstrap){const priorAudit=pactOperatorAudit?.pacts?.find(row=>row.id===id);for(const element of priorAudit?.elementEvidence??[])if(element.status==='unmatched'&&!(dimensions.some(row=>row.component===element.elementId&&(row.reference||row.source?.sourceURL||row.source?.sourceUrl)))){const detail=element.trigger??element.benefit??element.elementId;const item=`${element.elementId}: no concrete mechanism source found for ${detail}; retained as an unresolved component.`;if(!unresolved.includes(item))unresolved.push(item);}}
  if(id==='babel'||id==='lungmen'||id==='redeploy')for(let index=unresolved.length-1;index>=0;index--)if((id==='babel'&&unresolved[index].startsWith('firstExitTeamSp:'))||(id==='lungmen'&&unresolved[index].startsWith('sixMemberArtillery:'))||(id==='redeploy'&&(unresolved[index].startsWith('redeployTimeReduction:')||unresolved[index].startsWith('firstReturnBonus:'))))unresolved.splice(index,1);
  if(id==='babel'&&!dimensions.some(row=>row.component==='victoryAttackGrowth'&&(row.reference?.sourceURL||row.source?.sourceURL||row.source?.sourceUrl))&&!(priorRecord('pacts',id)?.externalRefs??[]).some(ref=>ref.sourceEffectText?.includes('Forgotten champions gain Attack Damage')))unresolved.push('victoryAttackGrowth: historical Forgotten source supports post-victory AD/AP growth only; its participated-champion trigger and five-stack cap differ from randomly selecting a surviving ally and the local permanent ATK cap.');
  if(bootstrap)for(const entry of finalPactEvidence?.evidence??[])if(entry.pact===id){const component={iberia:'barrierBreakDamage',lungmen:'sixMemberArtillery',breaker:'firstEliteKillAspd'}[entry.pact]??entry.element;const hasComponentEvidence=dimensions.some(row=>row.component===component&&(row.reference?.jsonPointer||row.reference?.sourceURL||row.source?.sourceURL||row.source?.sourceUrl));if(entry.remainingDifference)unresolved.push(`${component}: ${entry.remainingDifference}`);else if(String(entry.status).includes('unmatched')&&!hasComponentEvidence)unresolved.push(`${component}: ${entry.decisionNote??entry.searchNote}`);}
  const coverageClass=refs.length||externalRefs.length?'partial':'unmatched';
  records.pacts[id]={kind:'pacts',catalogID:id,name:pact.name,effectKind:currentKinds,mechanism:localMechanism('pacts',id,pact),refs,nativeReferences:refs.filter(ref=>Boolean(ref.nativeGit)),externalRefs:uniqueSourceRefs(externalRefs),candidateRefs:candidates,dimensionEvidence:dimensions,rejectedEvidence:dimensions.filter(row=>row.status==='checked-negative'),adaptations:diffs,remainingUnsupported:unresolved,decision:explicit?'user-explicit-composite':'root-adjudicated-retained-with-explicit-adaptations',coverageClass,mechanicComparison:{status:coverageClass,differences:diffs,remainingUnsupported:unresolved},userExplicit:explicit};
}

const extRows = bootstrap?expanded.entries:{};
for (const [id, item] of Object.entries(catalog.equipment)) {
  const old = bootstrap ? baseAudit.equipment[id] : priorRecord('equipment',id); const ext = extRows[id];
  const refs = uniqueRefs([...oldRefs(old?.refs ?? []), ...extendedRefs(id)]);
  const differences = bootstrap ? [...(ext?.differences ?? old?.mechanicComparison?.differences ?? [])] : [...(old?.adaptations??[])];
  const unsupported = bootstrap ? [...(ext?.unsupportedElements ?? [])] : [...(old?.remainingUnsupported??[])].filter(issue=>!String(issue).includes('初始资源与Tear现版持续回复不等价'));
  const effectKinds = [...new Set(effects(item).map(e=>e.kind))];
  addRecord(records, 'equipment', id, item.name, effectKinds.length ? effectKinds : item.kind, localMechanism('equipment', id, item), refs, differences, unsupported.length ? unsupported : (refs.length ? [] : ['No mechanism-specific competitor record resolved.']));
  if(!bootstrap&&(old?.externalRefs?.length??0)>0)records.equipment[id].externalRefs=uniqueSourceRefs(old.externalRefs);
  if(effects(item).some(effect=>Number(effect.params?.initialSp??0)>0)){
    const row=records.equipment[id];
    const note='初始资源适配依据 systems.equipmentStartingSP.historicalComparator：TFT历史Tear记录的是起始Mana后来改为Mana Regen；本地initial SP的资源量与生效时点是共鸣适配，不等同现版Mana Regen。';
    row.adaptations=[...new Set([...row.adaptations,note])];
    row.remainingUnsupported=row.remainingUnsupported.filter(issue=>!String(issue).includes('初始资源与Tear现版持续回复不等价'));
    row.mechanicComparison.remainingUnsupported=[...row.remainingUnsupported];
  }
  if(id==='holyCloak'){
    const row=records.equipment[id];
    row.remainingUnsupported=row.remainingUnsupported.filter(issue=>!String(issue).startsWith('周期清除自身寒冷或冻结'));
    row.adaptations=[...new Set([...row.adaptations.filter(note=>!String(note).includes('equipment/64 item_weishijingjia')), 'Dota 自走棋 equipment/64 item_weishijingjia 支持主动驱散负面状态；本装备周期清除持有者的寒冷/冻结。触发方式、目标范围与状态类别不同。'])];
    row.mechanicComparison.remainingUnsupported=[...row.remainingUnsupported];row.mechanicComparison.differences=[...row.adaptations];
  }
  if(id==='azureTear'){
    const row=records.equipment[id];
    row.remainingUnsupported=row.remainingUnsupported.filter(issue=>!String(issue).startsWith('技能结束而非施放终结技后'));
    row.externalRefs=uniqueSourceRefs([...(row.externalRefs??[]).filter(ref=>!/patch-12-11-notes/.test(ref.sourceURL)),{game:'Teamfight Tactics',version:'Patch 12.11 historical official Riot notes',recordID:'Blue Battery',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-12-11-notes/',sourceKind:'official historical patch-note text; component-level comparison',sourceSection:'Augments — Blue Battery',sourceEffectText:'Blue Battery grants Mana after casting an ability.'}]);
    row.adaptations=[...new Set([...row.adaptations,'TFT 12.11 Blue Battery documents resource gain after a cast; local SP is granted at skill end, after native runtime SP lock, with a 3-second cooldown. Trigger timing, resource type/value and cooldown are adaptations.'])];
    row.mechanicComparison.remainingUnsupported=[...row.remainingUnsupported];row.mechanicComparison.differences=[...row.adaptations];
  }
}
for (const [index, recipe] of catalog.recipes.entries()) {
  const id = recipe.id ?? `${recipe.resultId}:${(recipe.parts ?? recipe.components ?? recipe.ingredients ?? []).join('+')}:${index}`;
  const old = bootstrap ? (baseAudit.recipes[id] ?? Object.values(baseAudit.recipes).find(r => r.name === (recipe.resultId ?? recipe.name))) : (priorRecord('recipes',id) ?? Object.values(priorMatrix.records.recipes??{}).find(row=>row.name===(recipe.resultId??recipe.name)));
  const refs = oldRefs(old?.refs ?? []);
  const differences = bootstrap ? [...(old?.mechanicComparison?.differences ?? [])] : [...(old?.adaptations ?? [])];
  addRecord(records, 'recipes', id, recipe.resultId ?? recipe.name, 'two-component recipe', localMechanism('recipes', id, recipe), refs, differences.length ? differences : ['TFT two-component unordered combination rule is a recipe-system correspondence; resulting item is assessed separately.'], refs.length ? [] : ['No concrete recipe-system record resolved.']);
}

for (const [id, strategy] of Object.entries(catalog.strategies)) {
  const old = bootstrap ? baseAudit.strategies[id] : priorRecord('strategies',id);
  const ext = extRows[id];
  const direct = (strategy.effects ?? []).flatMap(e => [directReference(e.reference, e.reference?.recordId), directReference(e.candidateReference, e.candidateReference?.recordId)]).filter(Boolean);
  const refs = uniqueRefs([...direct, ...oldRefs(old?.refs ?? []), ...extendedRefs(id)]);
  let differences = bootstrap ? [...(ext?.differences ?? old?.mechanicComparison?.differences ?? [])] : [...(old?.adaptations ?? [])];
  let unsupported = bootstrap ? [...(ext?.unsupportedElements ?? [])] : [...(old?.remainingUnsupported ?? [])];
  if (id === 'strategy_13') { differences = ['TFT grants a second duplicator after five player combats; local reward is after five actual battle settlements, with logistics excluded.']; unsupported = []; }
  if (id === 'strategy_14') { differences = ['TFT accumulates 2200 Mana for a component; local mechanic accumulates 60 ammunition across battles, grants four component choices once, and does not count logistics.']; unsupported = []; }
  if (id === 'strategy_20') { differences = ['TFT adds 2 XP on wins and 3 XP on losses after player combat; local fight settlement uses these values and logistics is excluded.']; unsupported = []; }
  if (id === 'strategy_21') { differences = ['TFT grants one reroll each round and 2 gold; local version awards 2 gold on selection and one per-node free refresh, preserves opening balance, and prevents accumulation.']; unsupported = []; }
  if (id === 'strategy_22') { differences = ['TFT grants 1.5% AD and AP per active non-unique trait; local projects the pair into one 1.5% ATK modifier per active non-unique pact, with explicit unique-pact exclusions.']; unsupported = []; }
  if (id === 'strategy_25') { differences = ['Tome of Traits uses four choices then one selection; local samples up to four currently legal/viable pact-transfer emblems from the fixed recruit pool.']; unsupported = []; }
  if (id === 'strategy_26') { differences = ['Local extra pact is attached to one operator identity; no extra chess is created and identity contributes once per pact.']; }
  if (id === 'strategy_33') { differences = ['Dota Marci final-ammo extra damage is the candidate; local deals 150% ATK physical damage on final ammo and v2 sets SP refund to zero.']; unsupported=[]; }
  const effectsNow = effects(strategy);
  const externalRefs=collectExternalSources(effectsNow).map(row=>({game:row.game,version:row.version,recordID:row.recordId??row.recordID??row.name??null,sourceURL:row.sourceURL??row.sourceUrl,sourceKind:row.sourceKind??'official source text; no local JSON snapshot',sourceEffectText:row.sourceEffectText??null}));
  addRecord(records, 'strategies', id, strategy.name, effectsNow.map(e => e.kind), localMechanism('strategies', id, strategy), refs, differences, unsupported.length ? unsupported : (refs.length||externalRefs.length ? [] : ['No verified competitor record for the full effect chain.']));
  records.strategies[id].externalRefs=uniqueSourceRefs([...externalRefs,...(old?.externalRefs??[])]);
  if(externalRefs.length&&records.strategies[id].coverageClass==='unmatched'){records.strategies[id].coverageClass='partial';records.strategies[id].mechanicComparison.status='partial';}
}

for (const [id, event] of Object.entries(resonanceOpenings)) {
  const prior=priorRecord('openingEvents',id);
  const ref={game:'Teamfight Tactics',version:`Patch ${event.reference.version} official historical notes`,recordID:event.reference.name,sourceURL:event.reference.url,sourceKind:'official Riot patch notes; section-level text citation',sourceSection:event.reference.name};
  const diff = [...new Set([`Original timing ${json(event.reference.originalTiming ?? 'opening')}; local event is deterministically assigned by seed and shares the fixed season roster. The source is official-page text without a local JSON Pointer.`, ...(prior?.adaptations??[])])];
  const externalRefs=uniqueSourceRefs([ref,...(prior?.externalRefs??[])]);
  addRecord(records, 'openingEvents', id, event.name, 'automatic opening event', localMechanism('openingEvents', id, event), [], diff, [], 'root-adjudicated-retained-with-explicit-adaptations');
  records.openingEvents[id].externalRefs=externalRefs;
  records.openingEvents[id].coverageClass='partial';records.openingEvents[id].mechanicComparison.status='partial';
}

for (const id of disabledStrategies) {
  const old = bootstrap ? baseAudit.strategies[id] : priorMatrix?.coverage?.removedFeatures?.find(row=>row.catalogID===id&&row.kind==='strategies');
  if (old) records.strategies[id] = undefined;
}
const activeStrategyIds = new Set(Object.keys(catalog.strategies));
const removedFeatures = [
  ...disabledStrategies.map(id => {const legacy=bootstrap?baseAudit.strategies[id]:priorMatrix?.coverage?.removedFeatures?.find(row=>row.catalogID===id&&row.kind==='strategies');return {kind:'strategies',catalogID:id,name:legacy?.name??id,status:'removed-from-v2',reason:'specific mechanism lacks a defensible direct correspondence or was explicitly held out; retained only in legacy v1 catalog.',lastLegacyEffect:legacy?.effectKind??legacy?.lastLegacyEffect??null,refs:[]};}).filter(row => !activeStrategyIds.has(row.catalogID)),
  ...DISABLED_CURRENT_TRANSFER_IDS.map(id => ({ kind:'equipment',catalogID:id,name:resonanceContent.equipment[id]?.name??id,status:'removed-from-v2',reason:id.startsWith('transfer_')&&['breaker','arts','ammo','control','symbiosis','aegir','yan'].includes(id.slice('transfer_'.length))?'duplicate transfer alias removed in favor of its real crafted recipe-result item':'unique pact cannot be offered as a transferable emblem',refs:[]})),
  ...(bootstrap?Object.entries(nativeAudit.currentV2OperatorOverlay.removedGenericEffects).map(([id,entry])=>({kind:'operator-effects',catalogID:id,status:'removed-from-v2',reason:JSON.stringify(entry),refs:[]})):(priorMatrix?.coverage?.removedFeatures??[]).filter(row=>row.kind==='operator-effects')),
];
for (const id of Object.keys(records.strategies)) if (!records.strategies[id]) delete records.strategies[id];
if(records.strategies.strategy_35){const row=records.strategies.strategy_35;row.remainingUnsupported=row.remainingUnsupported.filter(issue=>!String(issue).startsWith('仅造物且全队每场首次'));row.adaptations=[...new Set([...row.adaptations,'Dota Auto Chess Skeleton King reincarnation supports death-triggered return; this adaptation restricts it to the first construct casualty per battle and restores the original tile.'])];row.mechanicComparison.remainingUnsupported=[...row.remainingUnsupported];row.mechanicComparison.differences=[...row.adaptations];}

const systems = {
  economy: {
    kind:'economy', catalogID:'campaign.economy', current:catalog.campaign.economy,
    mechanism:{ condition:'active session', target:'player gold, interest, streak, refresh and XP actions', trigger:'node settlement and player actions', reward:catalog.campaign.economy, scope:'one run', resetCap:'values are governed by campaign schedule and actionCosts' },
    refs:[],externalRefs:[
      {game:'Teamfight Tactics',version:'Patch 10.6 historical official Riot notes',recordID:'standard passive income and streak income',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-10-6-notes/',sourceKind:'official historical patch-note text',sourceSection:'System — Income',sourceEffectText:'Documents passive gold by round, streak thresholds/rewards, and payment of streak gold during PvE rounds.'},
      {game:'Teamfight Tactics',version:'Patch 14.1 historical official Riot notes',recordID:'streak gold thresholds',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-14-1-notes/',sourceKind:'official historical patch-note text',sourceSection:'Systems — Streak Gold',sourceEffectText:'Updates streak gold thresholds to 1 gold at 3–4, 2 gold at 5, and 3 gold at 6 wins or losses.'},
      {game:'Teamfight Tactics',version:'Patch 14.8 historical official Riot notes',recordID:'two-win streak gold',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/teamfight-tactics-patch-14-8-notes/',sourceKind:'official historical patch-note text',sourceSection:'Systems — Streaks',sourceEffectText:'A streak of two wins or losses grants 1 gold.'},
      {game:'Teamfight Tactics',version:'Hyper Roll official mode explanation',recordID:'standard XP purchase and interest contrast',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/teamfight-tactics-hyper-roll/',sourceKind:'official mode-design article',sourceSection:'How it Works — Experience and Income',sourceEffectText:'Contrasts standard automatic round XP and 4-gold XP purchases with Hyper Roll’s 2-gold victory payout and no interest.'},
      {game:'Teamfight Tactics',version:'Patch 18.2 historical official Riot notes; Sep 14 mid-patch adjustment',recordID:'XP per Level',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-2/',sourceKind:'official historical patch-note text',sourceSection:'Systems — XP per Level; Sep 14 mid-patch update',sourceEffectText:'Patch 18.2 changed level 7→8 XP from 60 to 56 and level 8→9 / 9→10 from 68 to 64; the Sep 14 mid-patch update restored 8→9 and 9→10 to 68 while retaining 56 for 7→8. These specific resulting thresholds match local values; this does not establish parity for all XP rules.'},
      {game:'Teamfight Tactics',version:'Patch 16.4 historical official Riot notes',recordID:'Level 7 Shop Odds',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-16-4/',sourceKind:'official historical patch-note text',sourceSection:'System Changes — Level Cost Odds',sourceEffectText:'Level 7 cost odds changed from 19/30/40/10/1% to 16/30/43/10/1%, matching the local level-7 odds; other levels are not implied.'},
    ],designBasis:{absolutePath:'E:\\WindowsWorkspace\\spark.workshop\\debug-agent\\workshop\\data\\projects\\arknights\\material\\notes\\texts\\text-c536b659-3c89-40ab-ba70-db5648e64081.md',sourceURL:'https://workshop.colorc.cc/bside/canvas?project=arknights&canvas=canvas-0470c0a1#card=text-c536b659-3c89-40ab-ba70-db5648e64081',section:'卫戍协议：共鸣',sourceLines:[8,9,10],statement:'用户原卡第8行规定每有10货币增加1利息、最多5；人口与经验规则分别见第9、10行。该卡是本地规则的人类原始依据，不是TFT来源。'},implementationSource:{absolutePath:path.join(CANONICAL,'shared/resonance/catalog.js'),localAnchor:'resonanceContent.campaign.economy'},
    adaptations:['TFT来源支持被动收入、连胜收益、回合经验及4金币购买经验等经营原语；18.2历史补丁及9月14日中途调整支持本地7→8需56经验、8→9和9→10需68经验这三个字段；16.4历史补丁支持本地7级商店概率16/30/43/10/1%。本地金币排程、利息比例/上限、其他等级经验与商店概率、难度与节点排程及开局奖励采用本地指定数值，不声称与TFT逐字段相同。'], coverageClass:'partial', decision:'记录本地经营规则及历史机制来源和数值差异', remainingUnsupported:[],
  },
  equipmentStartingSP: {
    kind:'equipment-resource-adaptation',catalogID:'equipment.initialSp',
    items:Object.values(catalog.equipment).filter(item=>effects(item).some(effect=>Number(effect.params?.initialSp??0)>0)).map(item=>({catalogID:item.id,name:item.name,effects:effects(item).filter(effect=>Number(effect.params?.initialSp??0)>0).map(effect=>({kind:effect.kind,initialSp:effect.params.initialSp}))})),
    historicalComparator:{game:'Teamfight Tactics',version:'2025-07-15 historical item changes',recordID:'Tear of the Goddess starting Mana 15 changed to 0; Mana Regen 0 changed to 1',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/roles-revamped-and-item-changes/',sourceSection:'ITEMS — Tear of the Goddess; starting Mana explanation',jsonPointer:null,localSnapshotAvailable:false},
    adaptations:['Historical TFT Tear evidence documents 15 starting Mana being replaced by 1 Mana Regen; the patch notes explain starting Mana accelerates the first cast. Local initial SP is a historical resource-family/value adaptation and does not claim equivalence to current Mana Regen.'],
    coverageClass:'partial',decision:'retain only as historical resource-family comparison; no exact item equivalence claim',remainingUnsupported:[],
  },
  campaign: {
    kind:'campaign', catalogID:'campaign', current:catalog.campaign,
    mechanism:{ condition:'new v2 run', target:'co-op PvE progression', trigger:'28 scheduled nodes, battle and logistics nodes settle under current campaign configuration', reward:'campaign rewards and battle progression', scope:'one run; 100 starting health unless current difficulty changes it', resetCap:'node schedule and per-run counters', comparison:'Tocker’s Trials 14.17: 30 rounds, 3 lives, 6 boss encounters; this mode uses 28 nodes and 100 health and does not claim equivalence.' },
    refs:[],externalRefs:[{game:'Teamfight Tactics',version:'Patch 14.17 historical',recordID:'Tocker’s Trials',sourceURL:'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-14-17-notes/',sourceKind:'official Riot patch notes; section-level text citation',sourceSection:'Tocker’s Trials'}],
    implementationSource:{absolutePath:path.join(CANONICAL,'shared/resonance/catalog.js'),localAnchor:'resonanceContent.campaign'},
    adaptations:['Native campaign is 28 nodes / 100 starting health; TFT Tocker’s Trials is documented as 30 rounds / 3 lives / 6 boss fights. Those structural differences are explicit.'], coverageClass:'partial', decision:'keep as distinct co-op PvE structure', remainingUnsupported:[],
  },
  uiInformation: {
    kind:'ui-information', catalogID:'resonance-interface-contract',
    current:{reuse:'upstream Stronghold Protocol native Preact/Pixi interfaces', tftReferenceLayers:['shop/economy controls','unit details and pact/recipe inspection','component recipe expansion','minimizable augment choice'], productSpecific:['two-step setup and run briefing','opening event detail','season roster indicators','independent codex'], sourceUpstreamCommit:'62eb113419123d9a3a63606107bbf85230c5dd2f'},
    mechanism:{ condition:'default run and in-game views', target:'player-facing shop, roster, pact, equipment, campaign and choices', trigger:'navigation, selection, inspection, battle/result state', reward:'information hierarchy and accessible action affordances; no gameplay-value import', scope:'presentation only', resetCap:'derived from current session/catalog state' },
    refs:[],externalRefs:[
      {game:'Stronghold Protocol upstream UI',version:'0.2.2 / 62eb113419123d9a3a63606107bbf85230c5dd2f',recordID:'native Preact/Pixi interface source',localFile:path.join(CANONICAL,'docs/resonance/interface-contract.md'),localAnchor:'本体复用与信息层级',sourceURL:'https://github.com/sganggs/Stronghold-Protocol/tree/62eb113419123d9a3a63606107bbf85230c5dd2f'},
      ...['https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/tft-interface-update/','https://teamfighttactics.leagueoflegends.com/en-au/news/game-updates/teamfight-tactics-patch-13-12-notes/','https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-10-16-notes/','https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/teamfight-tactics-patch-18-3/'].map((url,index)=>({game:'Teamfight Tactics',version:['9.24','13.12','10.16','18.3'][index],recordID:'information relationship reference',localFile:path.join(CANONICAL,'docs/resonance/interface-contract.md'),localAnchor:'云顶借鉴有明确边界',sourceURL:url})),
    ], adaptations:['TFT evidence supports information relationships only; panel layout, mode rules, five-cost/star progression, and runtime mechanics remain Stronghold-specific.'], coverageClass:'partial', decision:'preserve native interface and documented information hierarchy; do not claim layout equivalence', remainingUnsupported:[],
  },
};

const summary = Object.fromEntries(Object.entries(records).map(([kind, rows]) => [kind,{ total:Object.keys(rows).length, coverage:Object.values(rows).reduce((out,row)=>(out[row.coverageClass]=(out[row.coverageClass]??0)+1,out),{}) }]));
const unresolvedActiveCoreMechanisms = [
  ...Object.entries(records).flatMap(([kind, rows]) => Object.values(rows).flatMap(row => row.remainingUnsupported.map(issue => ({kind,catalogID:row.catalogID,name:row.name,issue})))),
  ...Object.values(systems).flatMap(system => (system.remainingUnsupported??[]).map(issue=>({kind:system.kind,catalogID:system.catalogID,name:system.name??system.kind,issue}))),
];
const previousAuditStats=priorMatrix?.nativeAuditStatistics;
const nativeAuditStatistics=bootstrap?{
  source:'first materialization from fixed-staging season-native-mechanism-evidence.json; persisted in this formal matrix',
  changedStarOverrideOperators:nativeAudit.validation.changedStarOverrideOperators,
  changedStarOverrideFieldCount:nativeAudit.validation.changedStarOverrideFieldCount,
  currentComputedSkillFieldDiffCount:Object.values(records.operators).reduce((sum,row)=>sum+row.currentComputedSkillFieldDiffs.length,0),
  interpretation:'The source audit records 49 operators / 234 changed override fields. This count is preserved as a native-to-overlay difference. Per-operator field changes are retained in nativeAuditStarOverrideDiffs; no competitor correspondence is implied.'
}:{...previousAuditStats,currentComputedSkillFieldDiffCount:Object.values(records.operators).reduce((sum,row)=>sum+row.currentComputedSkillFieldDiffs.length,0)};
const compatibilityRecords=priorMatrix?.compatibilityRecords??null;
const dotaReference=bootstrap?pactOperatorAudit.references.dota:priorMatrix.referenceSourceRegistry.dota;
const document = {
  schemaVersion:1,
  title:'共鸣模式机制对应与适配说明',
  bootstrapComplete:true,
  generatedAt:priorMatrix?.generatedAt??new Date().toISOString(),
  boundary:{rulesVersion:2,activeOperatorIds:catalog.config.activeOperatorIds,seasonId:catalog.config.seasonId??catalog.season?.id??null,activeFeaturesOnly:true,allMatchesAreMechanismSpecific:false,nativeGitCommit:nativeCommit},
  sourceInputs:{catalog:'server/modes/resonance/catalog.js + shared/resonance/current-*.js',nativeData:nativeChessPath,nativeGitCommit:nativeCommit,initialAuditSources:{priorMechanicalAudit:path.join(STAGING,'strategy-equipment-correspondence-audit.json'),candidateSupplement:path.join(STAGING,'extended-strategy-equipment-candidates.json'),pactOperatorAudit:path.join(STAGING,'pact-operator-correspondence-audit.json'),seasonNativeEvidence:path.join(STAGING,'season-native-mechanism-evidence.json'),finalPactEvidence:path.join(STAGING,'final-pact-evidence.json')},note:'These locations record first-materialization provenance only. Normal regeneration reads annotations from this formal JSON and does not read staging.'},
  nativeAuditStatistics,
  ...(compatibilityRecords?{compatibilityRecords}:{}),
  referenceSourceRegistry:{tft:{game:'Teamfight Tactics',version:tftVersion,sourceURLs:Object.values(tftUrls),currentOfficialLegality:'unconfirmed'},dota:{game:'Dota Auto Chess',version:dotaReference.version,sourceURL:dotaReference.sourceURL,nativeGit:dotaReference.sourceCommit??dotaReference.nativeGit},currency:{game:'崩坏：星穹铁道「货币战争」',version:currency.version,sourceCommit:currency.sourceCommit},native:{game:'Arknights / Stronghold Protocol native data',version:nativeCommit,jsonFile:nativeChessPath,nativeGit:nativeCommit}},
  coverage:{catalogCounts:{activeOperators:catalog.config.activeOperatorIds.length,pacts:Object.keys(catalog.pacts).length,equipment:Object.keys(catalog.equipment).length,recipes:catalog.recipes.length,strategies:Object.keys(catalog.strategies).length,openingEvents:Object.keys(resonanceOpenings).length},records:summary,removedFeatures},
  records, systems, unresolvedActiveCoreMechanisms,
  interpretation:{coverageClasses:{adapted:'具体机制有来源，数值、资源、范围、时钟或触发限定为明确适配',partial:'有具体机制源，但某些触发、目标、收益、范围、上限或重置仍不同或未完全核实',unmatched:'没有可核对的具体机制来源；保留为未匹配并列出未证组件'},prohibitedInference:'共享属性名、主题、定位或统计相关性不能证明新的因果桥。未逐轴吻合的机制不标作同款或exact。',decisionBoundary:'本文件记录当前rulesVersion 2目录与对应差异；active/removed表示当前运行目录，不代替后续内容取舍。'},
};

fs.writeFileSync(outJson,`${JSON.stringify(document,null,2)}\n`);
const summaryRows=Object.entries(summary).map(([kind,row])=>`| ${kind} | ${row.total} | ${Object.entries(row.coverage).map(([k,v])=>`${k}: ${v}`).join(', ')} |`).join('\n');
const kindNames={operators:'干员',pacts:'盟约',equipment:'装备',recipes:'合成配方',strategies:'策略',openingEvents:'开局事件'};
const statusNames={adapted:'有具体机制来源并列出适配',partial:'有对应机制但保留差异',unmatched:'未找到机制来源'};
const mdRows=Object.entries(summary).map(([kind,row])=>`| ${kindNames[kind]??kind} | ${row.total} | ${Object.entries(row.coverage).map(([k,v])=>`${statusNames[k]??k} ${v}`).join('；')} |`).join('\n');
const md=`# 共鸣模式机制对应与适配说明\n\n本文说明当前赛季目录中可核对的成熟机制来源，以及为适配本作战斗、盟约和资源规则所作的差异。条目按当前运行目录覆盖；这份说明不将历史来源描述为当前合法卡池。\n\n当前目录含 ${catalog.config.activeOperatorIds.length} 名本季干员、${Object.keys(catalog.pacts).length} 种盟约、${Object.keys(catalog.equipment).length} 件装备、${catalog.recipes.length} 条合成配方、${Object.keys(catalog.strategies).length} 条策略和 ${Object.keys(resonanceOpenings).length} 种开局事件。完整逐项来源、JSON Pointer、六维机制与差异见同目录 JSON。\n\n| 内容 | 数量 | 对应状态 |\n| --- | ---: | --- |\n${mdRows}\n\n## 对应口径\n\n干员固定技能以本体技能和天赋作为继承来源；技能字段、数值、资源时钟、作用对象及新加三星效果分别列出。当前覆盖保留 49 名干员、234 个技能字段差异的原始核验统计，并逐项列明差异。\n\n盟约按阈值效果拆解来源：保留当前仍生效的组件证据，不因复合效果不同而丢弃有效局部来源，也不让已撤下的返技力效果复活。未证实的触发桥和复合条件列入未解决组件。\n\n装备与配方分开判断：配方核对两件组件无序组合规则，成品装备效果另列。初始技力对照历史 TFT 物品改动中“15 初始法力改为 1 法力回复”的说明；不以现行法力回复证明初始技力。\n\n经营只按字段引用历史来源：TFT 18.2 与 9 月 14 日中途调整记载的升级经验门槛与本地 7→8 为 56、8→9 和 9→10 为 68 相符；TFT 16.4 的 7 级商店概率与本地 16/30/43/10/1% 相符。其余等级经验、商店概率、金币排程、利息及节点规则仍按本地依据，不据此宣称整体经济等同。\n\nTFTraits 18.4 是社区游戏数据衍生发布，当前官方合法卡池状态未确认。TFT 历史补丁仅作为具体机制来源。共鸣本地合作战役为 28 节点、100 初始生命；Tocker’s Trials 14.17 为 30 轮、3 条生命、6 次首领战，差异明确保留。界面参考只支持信息关系，不代表玩法或布局等同。\n\nv2 停用的策略和转职物品独立列于 JSON 的 coverage.removedFeatures；旧 v1 目录仍保留其兼容定义。\n`;
const unresolvedMd=unresolvedActiveCoreMechanisms.length?unresolvedActiveCoreMechanisms.map(row=>`- ${kindNames[row.kind]??row.kind}「${row.name}」(${row.catalogID})：${row.issue}`).join('\n'):'当前运行目录中没有仍缺少机制来源的因果链条目；这不表示效果与竞品完全相同，参数、触发范围与重置差异仍以各项适配说明为准。';
fs.writeFileSync(outMd,`${md}\n## 尚未找到对应因果原语的机制\n\n以下仅列仍缺少可核对机制来源的组件；数值、时钟、目标范围和上限差异不列为缺少来源。\n\n${unresolvedMd}\n`);
console.log(JSON.stringify({json:outJson,markdown:outMd,counts:document.coverage.catalogCounts,summary},null,2));
