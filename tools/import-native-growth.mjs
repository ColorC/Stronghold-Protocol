#!/usr/bin/env node
// Attach official native level curves to the existing chess pool without downloading or rewriting
// any source tables. New operators are reported separately until their complete battle kits exist.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { interpolateAttrs, statsFrom } from './build-data.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REVISION = 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add';
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
    report: resolve(ROOT, 'runtime/growth-destination-20261008/native-import/growth-import-receipt.json'),
    write: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') {
      console.log('usage: node tools/import-native-growth.mjs --character-table <file> [--chess <file>] [--report <file>] [--write]');
      process.exit(0);
    }
    if (k === '--write') { o.write = true; continue; }
    if (['--character-table','--chess','--report'].includes(k)) {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${k} requires a path`);
      o[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = resolve(v);
      continue;
    }
    throw new Error(`unknown option ${k}`);
  }
  if (!o.characterTable) throw new Error('--character-table is required');
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

function computeCandidates(charTable, chess) {
  const present = new Set(Object.values(chess).map((c) => c.charId).filter(Boolean));
  const rows = [];
  for (const [nationId, ids] of Object.entries(SELECTED)) for (const charId of ids) {
    const c = charTable[charId];
    assertCurve(c, charId);
    if (c.nationId !== nationId) throw new Error(`${charId}: native nationId ${c.nationId || '<empty>'} does not match selected ${nationId}`);
    const inPool = present.has(charId);
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
      importStatus: inPool ? 'existing-pool-growth-attached' : 'source-backed-candidate-needs-native-battle-kit',
      skillIds: (c.skills || []).map((s) => s?.skillId).filter(Boolean),
      tokenIds: [...new Set([
        ...Object.keys(c.displayTokenDict || {}),
        ...(c.skills || []).map((s) => s?.overrideTokenKey).filter(Boolean),
        ...(c.talents || []).map((t) => t?.candidate?.tokenKey || t?.tokenKey).filter(Boolean),
      ])],
      skillExecution: inPool
        ? { status: 'existing-upstream-definition-not-changed', supportedSkillIds: [], needsFocusedKitAudit: (c.skills || []).map(s => s?.skillId).filter(Boolean) }
        : { status: 'unsupported-until-native-kit-is-implemented', supportedSkillIds: [], unsupportedSkillIds: (c.skills || []).map(s => s?.skillId).filter(Boolean) },
      nativeGrowth: growth,
      projectSampleStats: { normal: { phase: 1, level: atNormal, values: normalStats }, advanced: { phase: c.phases.length > 2 ? 2 : c.phases.length - 1, level: atAdvanced, values: advancedStats } },
      unresolved: inPool ? [] : ['no upstream chess definition at pinned upstream revision', 'native skill execution and token variants must be implemented before activation'],
    });
  }
  return rows;
}

export async function runImport(opts) {
  const charTable = JSON.parse(await readFile(opts.characterTable, 'utf8'));
  const chess = JSON.parse(await readFile(opts.chess, 'utf8'));
  const updated = structuredClone(chess);
  let attached = 0;
  const missingIds = [];
  for (const rec of Object.values(updated)) {
    if (!rec.charId) continue;
    const c = charTable[rec.charId];
    if (!c || c.isNotObtainable) { missingIds.push(rec.charId); continue; }
    assertCurve(c, rec.charId);
    rec.nativeGrowth = nativeGrowth(c);
    attached++;
  }
  const candidates = computeCandidates(charTable, updated);
  const noGrowthRefs = Object.values(updated).filter((c) => c.charId && c.visible && !c.nativeGrowth).map((c) => c.charId);
  if (noGrowthRefs.length) throw new Error(`growth join incomplete: ${noGrowthRefs.slice(0, 10).join(', ')}`);
  const phaseCount = candidates.reduce((n, c) => n + c.nativeGrowth.phases.length, 0);
  const curveCount = candidates.reduce((n, c) => n + c.nativeGrowth.phases.reduce((s, p) => s + p.attributesKeyFrames.length, 0), 0);
  const report = {
    schemaVersion: 1,
    source: { characterTable: opts.characterTable, revision: SOURCE_REVISION, upstreamChessRevision: 'c2a2ef778cf728ff29b953b9842b2a39b1e9cbea' },
    importer: { path: resolve(ROOT, 'tools/import-native-growth.mjs'), projectCurveFunctions: resolve(ROOT, 'tools/build-data.mjs'), algorithm: 'native phase keyframes + tools/build-data.mjs interpolateAttrs/statsFrom' },
    targetChess: opts.chess,
    currentPool: { chessDefinitions: Object.keys(chess).length, charactersWithGrowthAttached: attached, sourceExcludedHiddenDefinitions: [...new Set(missingIds)], visibleDefinitionsMissingGrowth: noGrowthRefs },
    selected: { counts: Object.fromEntries(Object.entries(SELECTED).map(([n, a]) => [n, a.length])), total: candidates.length, candidates },
    curveAudit: { selectedOperators: candidates.length, phases: phaseCount, keyframes: curveCount, everyPhaseHasCompleteEndpoints: candidates.every(c => c.nativeGrowth.phases.every(p => p.maxLevel === p.attributesKeyFrames.at(-1).level && p.attributesKeyFrames[0].level === 1)) },
    kitAudit: { newNativeKitFile: null, newlySupportedSkillIds: [], unsupportedNewSkillIds: candidates.filter(c => !c.inCurrentChess).flatMap(c => c.skillExecution.unsupportedSkillIds.map(skillId => ({ charId: c.charId, skillId }))), existingDefinitionsNeedFocusedKitAudit: candidates.filter(c => c.inCurrentChess).flatMap(c => c.skillExecution.needsFocusedKitAudit.map(skillId => ({ charId: c.charId, skillId }))) },
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
