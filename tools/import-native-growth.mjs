#!/usr/bin/env node
// Attach official native level curves to the existing chess pool without downloading or rewriting
// any source tables. New operators are reported separately until their complete battle kits exist.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { interpolateAttrs, statsFrom, buildSkill, rangeGrid, immunitiesOf, traitRecord, baseTalentList } from './build-data.mjs';
import { NATIVE_SKILL_SUPPORT } from '../server/sim/content/newnativekits.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GIT_COMMON = resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim());
const CANONICAL_ROOT = resolve(GIT_COMMON, '..');
const SOURCE_REVISION = 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add';
const SOURCE_URL = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${SOURCE_REVISION}/zh_CN/gamedata/excel/character_table.json`;
const SELECTED = Object.freeze({
  columbia: ['char_240_wyvern','char_484_robrta','char_235_jesica','char_440_pinecn','char_366_acdrop','char_108_silent','char_107_liskam','char_242_otter','char_128_plosis','char_4191_tippi','char_451_robin','char_4048_doroth','char_150_snakek','char_202_demkni','char_264_f12yin','char_1034_jesca2'],
  victoria: ['char_4162_cathy','char_494_vendla','char_220_grani','char_4017_puzzle','char_155_tiger','char_388_mint','char_4040_rockr','char_4045_heidi','char_154_morgan','char_4039_horn','char_222_bpipe','char_112_siege','char_4072_ironmn','char_1019_siege2'],
  yan: ['char_385_finlpp','char_4019_ncdeer','char_4122_grabds','char_4222_taraxa','char_306_leizi','char_4119_wanqin','char_4196_reckpr','char_4082_qiubai','char_2015_dusk','char_2023_ling','char_2025_shu','char_2024_chyue'],
  kazimierz: ['char_4000_jnight','char_237_gravel','char_496_wildmn','char_4032_provs','char_126_shotst','char_265_sophia','char_204_platnm','char_420_flamtl','char_423_blemsh','char_431_ashlok','char_430_fartth','char_4064_mlynar','char_1014_nearl2'],
  siracusa: ['char_190_clour','char_145_prove','char_446_aroma','char_346_aosta','char_349_chiave','char_427_vigil','char_4031_liesel','char_140_whitew','char_356_broca','char_358_lisa','char_4065_judge','char_1038_whitw2','char_4037_demetr','char_4155_talr'],
});

function parseArgs(argv) {
  const o = {
    characterTable: null,
    chess: resolve(ROOT, 'data/chess.json'),
    report: resolve(CANONICAL_ROOT, 'runtime/growth-destination-20261008/native-import/growth-import-receipt.json'),
    write: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') {
      console.log('usage: node tools/import-native-growth.mjs --character-table <file> [--skill-table <file>] [--range-table <file>] [--chess <file>] [--report <file>] [--write]');
      process.exit(0);
    }
    if (k === '--write') { o.write = true; continue; }
    if (['--character-table','--skill-table','--range-table','--chess','--report'].includes(k)) {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${k} requires a path`);
      o[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = resolve(v);
      continue;
    }
    throw new Error(`unknown option ${k}`);
  }
  if (!o.characterTable) throw new Error('--character-table is required');
  const excelDir = dirname(o.characterTable);
  o.skillTable ||= join(excelDir, 'skill_table.json');
  o.rangeTable ||= join(excelDir, 'range_table.json');
  return o;
}

function assertCurve(char, charId) {
  if (!char || char.isNotObtainable) throw new Error(`${charId}: missing or non-obtainable native operator`);
  if (!Array.isArray(char.phases) || char.phases.length === 0) throw new Error(`${charId}: native phases missing`);
  for (let i = 0; i < char.phases.length; i++) {
    const p = char.phases[i];
    const kfs = p.attributesKeyFrames;
    if (!Number.isFinite(p.maxLevel) || !Array.isArray(kfs) || kfs.length < 2) throw new Error(`${charId} phase ${i}: incomplete native curve`);
    if (kfs[0].level !== 1 || kfs.at(-1).level !== p.maxLevel) throw new Error(`${charId} phase ${i}: curve endpoints do not span level 1 to maxLevel`);
    for (const k of kfs) for (const field of ['maxHp','atk','def','magicResistance','cost','blockCnt','respawnTime']) {
      if (typeof k.data?.[field] !== 'number') throw new Error(`${charId} phase ${i} level ${k.level}: ${field} missing`);
    }
  }
}

function nativeGrowth(char) {
  return {
    source: { table: 'character_table.json', revision: SOURCE_REVISION },
    phases: char.phases.map((phase, index) => ({
      phase: index,
      maxLevel: phase.maxLevel,
      attributesKeyFrames: phase.attributesKeyFrames,
    })),
  };
}

function nativeChessDefs(charId, char, nationId, ctx, sequence) {
  const defs = [];
  const levels = [
    { suffix: 'a', phase: Math.min(1, char.phases.length - 1), skillLevel: 4, level: 55, label: 'normal' },
    { suffix: 'b', phase: Math.min(2, char.phases.length - 1), skillLevel: 7, level: 50, label: 'advanced' },
  ];
  const stem = `chess_native_${charId}`;
  for (const x of levels) {
    const phase = x.phase;
    const level = Math.min(x.level, char.phases[phase].maxLevel);
    const attrs = interpolateAttrs(char, phase, level);
    const stats = statsFrom(attrs);
    const trait = traitRecord(ctx, char, phase, level, [], `${stem}_${x.suffix}`);
    const skills = (char.skills || []).map((s, index) => {
      if (!s?.skillId) return null;
      const rec = buildSkill(ctx, s.skillId, x.skillLevel, null, `${stem}_${x.suffix}`);
      return rec ? { ...rec, index, isDefault: index === 0, overrideTokenKey: s.overrideTokenKey || null } : null;
    }).filter(Boolean);
    const skill = skills.find(s => s.index === 0) || skills[0] || null;
    const tokenIds = [...new Set([
      ...Object.keys(char.displayTokenDict || {}),
      ...(char.skills || []).map(s => s?.overrideTokenKey).filter(Boolean),
      ...(char.talents || []).flatMap(t => (t.candidates || []).map(c => c?.tokenKey).filter(Boolean)),
    ])];
    const supportedSkillIds = (NATIVE_SKILL_SUPPORT[charId] || []).filter((id) => skills.some((skill) => skill.skillId === id));
    const unsupportedSkillIds = skills.map((skill) => skill.skillId).filter((id) => !supportedSkillIds.includes(id));
    const baseId = `${stem}_${x.suffix}`;
    defs.push({
      chessId: baseId, baseId, goldenId: `${stem}_b`, isGolden: x.suffix === 'b', tier: null,
      identifier: 90000 + sequence * 2 + (x.suffix === 'b' ? 1 : 0), isHidden: true, isDiy: false, visible: false,
      chessType: 'NATIVE_IMPORT_CANDIDATE', shopSortId: null, charId, name: char.name,
      appellation: char.appellation || null, rarity: Number(String(char.rarity).replace('TIER_', '')) || null,
      profession: char.profession, subProfessionId: char.subProfessionId, subProfessionName: null,
      position: char.position, nationId, groupId: char.groupId || null, teamId: char.teamId || null,
      bonds: [], garrisonIds: [], price: null, sellPrice: null, upgradeNum: x.suffix === 'a' ? 3 : 0,
      upgradeChessId: x.suffix === 'a' ? `${stem}_b` : null,
      status: { phase, level, skillLevel: x.skillLevel, equipLevel: 0 },
      stats, immunities: immunitiesOf(attrs), rangeId: char.phases[phase].rangeId || null,
      rangeGrid: rangeGrid(ctx, char.phases[phase].rangeId), ...trait.classify,
      trait: trait.trait, skill, skills,
      talents: baseTalentList(ctx, char, phase, level, baseId), tokens: tokenIds, module: null, assets: null,
      nativeGrowth: nativeGrowth(char),
      nativeImport: {
        status: 'hidden-pending-native-kit', playable: false,
        sourceNativeSkillIds: skills.map((s) => s.skillId), supportedSkillIds, unsupportedSkillIds, tokenIds,
        source: { characterTableUrl: SOURCE_URL, revision: SOURCE_REVISION, skillReferences: skills.map((s) => `https://prts.wiki/w/${encodeURIComponent(char.name)}`) },
      },
    });
  }
  return defs;
}

function computeCandidates(charTable, chess) {
  const existingRecords = Object.values(chess);
  const present = new Set(existingRecords.filter((c) => c.chessType !== 'NATIVE_IMPORT_CANDIDATE').map((c) => c.charId).filter(Boolean));
  const imported = new Set(existingRecords.filter((c) => c.chessType === 'NATIVE_IMPORT_CANDIDATE').map((c) => c.charId).filter(Boolean));
  const rows = [];
  for (const [nationId, ids] of Object.entries(SELECTED)) for (const charId of ids) {
    const c = charTable[charId];
    assertCurve(c, charId);
    if (c.nationId !== nationId) throw new Error(`${charId}: native nationId ${c.nationId || '<empty>'} does not match selected ${nationId}`);
    const inPool = present.has(charId);
    const candidateAlreadyImported = imported.has(charId);
    const growth = nativeGrowth(c);
    const atNormal = Math.min(55, c.phases[1]?.maxLevel || c.phases[0].maxLevel);
    const atAdvanced = Math.min(50, c.phases[2]?.maxLevel || c.phases.at(-1).maxLevel);
    const normalAttrs = interpolateAttrs(c, c.phases.length > 1 ? 1 : 0, atNormal);
    const advancedAttrs = interpolateAttrs(c, c.phases.length > 2 ? 2 : c.phases.length - 1, atAdvanced);
    const normalStats = statsFrom(normalAttrs);
    const advancedStats = statsFrom(advancedAttrs);
    if (!normalStats || !advancedStats) throw new Error(`${charId}: project native interpolation returned no stats`);
    rows.push({
      charId, name: c.name, nationId, groupId: c.groupId || null, teamId: c.teamId || null,
      profession: c.profession, subProfessionId: c.subProfessionId, rarity: c.rarity,
      inCurrentChess: inPool,
      candidateAlreadyImported,
      importStatus: inPool ? 'existing-pool-growth-attached' : candidateAlreadyImported ? 'hidden-native-candidate-already-imported' : 'source-backed-candidate-needs-native-battle-kit',
      skillIds: (c.skills || []).map((s) => s?.skillId).filter(Boolean),
      tokenIds: [...new Set([
        ...Object.keys(c.displayTokenDict || {}),
        ...(c.skills || []).map((s) => s?.overrideTokenKey).filter(Boolean),
        ...(c.talents || []).map((t) => t?.candidate?.tokenKey || t?.tokenKey).filter(Boolean),
      ])],
      skillExecution: inPool
        ? { status: 'existing-upstream-definition-not-changed', supportedSkillIds: [], needsFocusedKitAudit: (c.skills || []).map(s => s?.skillId).filter(Boolean) }
        : {
          status: 'hidden-until-every-native-skill-and-token-is-supported',
          supportedSkillIds: (NATIVE_SKILL_SUPPORT[charId] || []).filter((id) => (c.skills || []).some((s) => s?.skillId === id)),
          unsupportedSkillIds: (c.skills || []).map((s) => s?.skillId).filter((id) => !(NATIVE_SKILL_SUPPORT[charId] || []).includes(id)),
          sourceReferences: [`https://prts.wiki/w/${encodeURIComponent(c.name)}`],
        },
      nativeGrowth: growth,
      projectSampleStats: { normal: { phase: 1, level: atNormal, values: normalStats }, advanced: { phase: c.phases.length > 2 ? 2 : c.phases.length - 1, level: atAdvanced, values: advancedStats } },
      unresolved: inPool ? [] : ['no upstream chess definition at pinned upstream revision', 'native skill execution and token variants must be implemented before activation'],
    });
  }
  return rows;
}

export async function runImport(opts) {
  const charTable = JSON.parse(await readFile(opts.characterTable, 'utf8'));
  const skillTable = JSON.parse(await readFile(opts.skillTable, 'utf8'));
  const rangeTable = JSON.parse(await readFile(opts.rangeTable, 'utf8'));
  const chess = JSON.parse(await readFile(opts.chess, 'utf8'));
  const updated = structuredClone(chess);
  const ctx = { skillTable, rangeTable, charTable, ac: { skillRangeDict: {}, skillTriggerDataList: {} } };
  let attached = 0;
  const missingIds = [];
  for (const rec of Object.values(updated)) {
    if (!rec.charId) continue;
    const c = charTable[rec.charId];
    if (!c || c.isNotObtainable) { missingIds.push(rec.charId); continue; }
    assertCurve(c, rec.charId);
    rec.nativeGrowth = nativeGrowth(c);
    if (rec.chessType === 'NATIVE_IMPORT_CANDIDATE') {
      const sourceNativeSkillIds = (rec.skills || []).map((skill) => skill?.skillId).filter(Boolean);
      const supportedSkillIds = (NATIVE_SKILL_SUPPORT[rec.charId] || []).filter((id) => sourceNativeSkillIds.includes(id));
      rec.nativeImport = {
        ...(rec.nativeImport || {}),
        status: 'hidden-pending-native-kit', playable: false, sourceNativeSkillIds, supportedSkillIds,
        unsupportedSkillIds: sourceNativeSkillIds.filter((id) => !supportedSkillIds.includes(id)),
        tokenIds: rec.tokens || [],
        source: { characterTableUrl: SOURCE_URL, revision: SOURCE_REVISION, skillReferences: sourceNativeSkillIds.map(() => `https://prts.wiki/w/${encodeURIComponent(c.name)}`) },
      };
    }
    attached++;
  }
  const candidates = computeCandidates(charTable, updated);
  const newCharacterIds = candidates.filter(c => !c.inCurrentChess && !c.candidateAlreadyImported).map(c => c.charId);
  let newDefs = 0;
  for (const charId of newCharacterIds) {
    const selected = candidates.find(c => c.charId === charId);
    const char = charTable[charId];
    const generated = nativeChessDefs(charId, char, selected.nationId, ctx, newDefs / 2);
    for (const rec of generated) {
      if (updated[rec.chessId]) throw new Error(`candidate chess id already exists: ${rec.chessId}`);
      updated[rec.chessId] = rec;
      newDefs++;
    }
  }
  const noGrowthRefs = Object.values(updated).filter((c) => c.charId && c.visible && !c.nativeGrowth).map((c) => c.charId);
  if (noGrowthRefs.length) throw new Error(`growth join incomplete: ${noGrowthRefs.slice(0, 10).join(', ')}`);
  const phaseCount = candidates.reduce((n, c) => n + c.nativeGrowth.phases.length, 0);
  const curveCount = candidates.reduce((n, c) => n + c.nativeGrowth.phases.reduce((s, p) => s + p.attributesKeyFrames.length, 0), 0);
  const report = {
    schemaVersion: 1,
    source: {
      characterTable: opts.characterTable, characterTableUrl: SOURCE_URL, revision: SOURCE_REVISION,
      upstreamChessRevision: 'c2a2ef778cf728ff29b953b9842b2a39b1e9cbea',
      upstreamChessUrl: 'https://github.com/sganggs/Stronghold-Protocol/tree/c2a2ef778cf728ff29b953b9842b2a39b1e9cbea',
    },
    importer: { path: resolve(ROOT, 'tools/import-native-growth.mjs'), projectCurveFunctions: resolve(ROOT, 'tools/build-data.mjs'), algorithm: 'native phase keyframes + tools/build-data.mjs interpolateAttrs/statsFrom' },
    targetChess: opts.chess,
    currentPool: {
      sourceChessDefinitions: Object.values(chess).filter((c) => c.chessType !== 'NATIVE_IMPORT_CANDIDATE').length,
      previouslyImportedHiddenCandidateDefinitions: Object.values(chess).filter((c) => c.chessType === 'NATIVE_IMPORT_CANDIDATE').length,
      newlyGeneratedHiddenCandidateDefinitions: newDefs, resultingChessDefinitions: Object.keys(updated).length,
      charactersWithGrowthAttached: attached, sourceExcludedHiddenDefinitions: [...new Set(missingIds)], visibleDefinitionsMissingGrowth: noGrowthRefs,
    },
    selected: { counts: Object.fromEntries(Object.entries(SELECTED).map(([n, a]) => [n, a.length])), total: candidates.length, candidates },
    curveAudit: { selectedOperators: candidates.length, phases: phaseCount, keyframes: curveCount, everyPhaseHasCompleteEndpoints: candidates.every(c => c.nativeGrowth.phases.every(p => p.maxLevel === p.attributesKeyFrames.at(-1).level && p.attributesKeyFrames[0].level === 1)) },
    kitAudit: {
      newNativeKitFile: resolve(ROOT, 'server/sim/content/newnativekits.js'),
      battleFixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js'),
      newlySupportedSkillIds: candidates.filter(c => !c.inCurrentChess).flatMap(c => c.skillExecution.supportedSkillIds.map(skillId => ({ charId: c.charId, skillId }))),
      unsupportedNewSkillIds: candidates.filter(c => !c.inCurrentChess).flatMap(c => c.skillExecution.unsupportedSkillIds.map(skillId => ({ charId: c.charId, skillId }))),
      existingDefinitionsNeedFocusedKitAudit: candidates.filter(c => c.inCurrentChess).flatMap(c => c.skillExecution.needsFocusedKitAudit.map(skillId => ({ charId: c.charId, skillId }))),
    },
    battleFixtures: [
      { charId: 'char_235_jesica', skillId: 'skchr_jesica_1', case: 'attack-recovery next-hit multiplier', fixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js') },
      { charId: 'char_235_jesica', skillId: 'skchr_jesica_2', case: 'duration, ATK% and physical/arts dodge', fixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js') },
    ],
    tokenAudit: { importedTokenDefinitions: [], unresolvedTokenIds: candidates.filter(c => !c.inCurrentChess).flatMap(c => c.tokenIds.map(tokenId => ({ charId: c.charId, tokenId }))) },
    status: opts.write ? 'written' : 'dry-run',
  };
  if (opts.write) {
    const text = JSON.stringify(updated);
    const tmp = `${opts.chess}.tmp-${process.pid}`;
    await writeFile(tmp, text);
    await rename(tmp, opts.chess);
    await mkdir(dirname(opts.report), { recursive: true });
    await writeFile(opts.report, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const report = await runImport(opts);
    console.log(JSON.stringify({ status: report.status, targetChess: report.targetChess, report: opts.report, currentPool: report.currentPool, selected: report.selected.total, missingKits: report.selected.candidates.filter(c => !c.inCurrentChess).length }));
  } catch (e) {
    console.error(`import-native-growth: ${e.stack || e}`);
    process.exitCode = 1;
  }
}
