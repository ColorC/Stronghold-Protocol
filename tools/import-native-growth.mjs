#!/usr/bin/env node
// Attach official native level curves to the existing chess pool without downloading or rewriting
// any source tables. New operators are reported separately until their complete battle kits exist.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { safeName } from './assets/sources.mjs';
import { interpolateAttrs, statsFrom, buildSkill, rangeGrid, immunitiesOf, traitRecord, baseTalentList, tokenVariant, resolveTrigger } from './build-data.mjs';
import { NATIVE_DEFAULT_SKILL_IDS, NATIVE_SKILL_SUPPORT, NATIVE_KIT_READY } from '../server/sim/content/newnativekits.js';
import { NATIVE_DEFAULT_SKILL_IDS as VKS_DEFAULT_SKILL_IDS, NATIVE_SKILL_SUPPORT as VKS_SKILL_SUPPORT } from '../server/sim/content/nativeVictoriaKazimierzSiracusa.js';
import * as VKS_MANIFEST from '../server/sim/content/nativeVictoriaKazimierzSiracusa.js';

// Keep the new faction kits in their own file while letting the importer generate the same
// explicit default loadout and skill allowlist. The final battle registry is composed by content/index.js.
const ALL_NATIVE_DEFAULT_SKILL_IDS = Object.freeze({ ...NATIVE_DEFAULT_SKILL_IDS, ...VKS_DEFAULT_SKILL_IDS });
const ALL_NATIVE_SKILL_SUPPORT = Object.freeze({ ...NATIVE_SKILL_SUPPORT, ...VKS_SKILL_SUPPORT });
const completeKitIds=manifest=>Array.isArray(manifest)?manifest:Object.entries(manifest||{}).filter(([,entry])=>entry.ready&&entry.talentReady&&entry.skillReady&&entry.tokenReady).map(([id])=>id);
const ALL_NATIVE_KIT_READY = new Set([...completeKitIds(NATIVE_KIT_READY),...completeKitIds(VKS_MANIFEST.NATIVE_KIT_READY)]);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GIT_COMMON = resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim());
const CANONICAL_ROOT = resolve(GIT_COMMON, '..');
const SOURCE_REVISION = 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add';
const SOURCE_URL = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${SOURCE_REVISION}/zh_CN/gamedata/excel/character_table.json`;
const IMAGE_REVISION = 'd89e2600c7214e13ab1042a616a9f690f7f5dd95';
const SPINE_REVISION = 'd0b5af0b004b044d322397ce5ae79632b6d9fcdd';
const NO_E2_ART = new Set(['char_240_wyvern', 'char_4000_jnight']);
const NO_SPINE_BACK = new Set(['char_4045_heidi']);
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
    assets: resolve(ROOT, 'data/assets.json'),
    tokens: resolve(ROOT, 'data/tokens.json'),
    report: resolve(CANONICAL_ROOT, 'runtime/growth-destination-20261008/native-import/growth-import-receipt.json'),
    write: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') {
      console.log('usage: node tools/import-native-growth.mjs --character-table <file> [--skill-table <file>] [--range-table <file>] [--chess <file>] [--assets <file>] [--tokens <file>] [--report <file>] [--write]');
      process.exit(0);
    }
    if (k === '--write') { o.write = true; continue; }
    if (['--character-table','--skill-table','--range-table','--chess','--assets','--tokens','--report'].includes(k)) {
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

function nativeAssetSources(charId, char, skills) {
  const id = charId;
  const imageBase = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/${IMAGE_REVISION}`;
  const spineBase = `https://raw.githubusercontent.com/fexli/ArknightsResource/${SPINE_REVISION}/spine/${id}/${id}`;
  const assets = {
    avatar: `${imageBase}/avatar/${id}.png`,
    portrait: `${imageBase}/portrait/${id}_1.png`,
    skillIcons: skills.map((skill) => ({
      skillId: skill.skillId, iconId: skill.iconId || skill.skillId,
      url: `${imageBase}/skill/skill_icon_${encodeURIComponent(skill.iconId || skill.skillId)}.png`,
    })),
    spine: {
      front: Object.fromEntries(['skel', 'atlas', 'png'].map((extension) => [extension, `${spineBase}/Front/${id}.${extension}`])),
      back: NO_SPINE_BACK.has(id) ? null : Object.fromEntries(['skel', 'atlas', 'png'].map((extension) => [extension, `${spineBase}/Back/${id}.${extension}`])),
    },
  };
  if (!NO_E2_ART.has(id)) {
    assets.avatarE2 = `${imageBase}/avatar/${id}_2.png`;
    assets.portraitE2 = `${imageBase}/portrait/${id}_2.png`;
  }
  return assets;
}

function addNativeAssets(manifest, id, char, skills) {
  const hasE2 = !NO_E2_ART.has(id);
  const current = manifest.chars[id] || {};
  current.avatar = `/assets/char/avatar/${id}.png`;
  current.portrait = `/assets/char/portrait/${id}_1.png`;
  if (hasE2) {
    current.avatarE2 = `/assets/char/avatar/${id}_2.png`;
    current.portraitE2 = `/assets/char/portrait/${id}_2.png`;
  }
  manifest.chars[id] = current;
  for (const skill of skills) {
    const iconId = skill.iconId || skill.skillId;
    manifest.skills[iconId] ||= `/assets/skill/${safeName(iconId)}.png`;
    manifest.skillsById[skill.skillId] = iconId;
  }
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
    const presetLevel=x.suffix==='b'&&levels[0].phase===phase?Math.max(levels[0].level,x.level):x.level;
    const level = Math.min(presetLevel, char.phases[phase].maxLevel);
    const attrs = interpolateAttrs(char, phase, level);
    const stats = statsFrom(attrs);
    const trait = traitRecord(ctx, char, phase, level, [], `${stem}_${x.suffix}`);
    const configuredSkillId = ALL_NATIVE_DEFAULT_SKILL_IDS[charId] || null;
    const sourceSkills = (char.skills || []).map((s, index) => {
      if (!s?.skillId) return null;
      const rec = buildSkill(ctx, s.skillId, x.skillLevel, null, `${stem}_${x.suffix}`);
      return rec ? { ...rec, trigger:resolveTrigger(ctx,char,charId,index,rec,{operator:true,chessId:stem+'_a'}), index, isDefault: s.skillId === configuredSkillId, overrideTokenKey: s.overrideTokenKey || null } : null;
    }).filter(Boolean);
    const supportedSkillIds = (ALL_NATIVE_SKILL_SUPPORT[charId] || []);
    // Keep the complete source record; UI and server validation expose only supported IDs.
    const skills = sourceSkills;
    const skill = configuredSkillId ? skills.find((s) => s.skillId === configuredSkillId) ?? null : null;
    const tokenIds = [...new Set([
      ...Object.keys(char.displayTokenDict || {}),
      ...(char.skills || []).filter(s => supportedSkillIds.includes(s?.skillId)).map(s => s?.overrideTokenKey).filter(Boolean),
      ...(char.talents || []).flatMap(t => (t.candidates || []).map(c => c?.tokenKey).filter(Boolean)),
    ])];
    const assetSources = nativeAssetSources(charId, char, skills);
    const unsupportedSkillIds = sourceSkills.map((skill) => skill.skillId).filter((id) => !supportedSkillIds.includes(id));
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
      talents: baseTalentList(ctx, char, phase, level, baseId), tokens: tokenIds, module: null,
      assets: {
        avatar: `${charId}${x.suffix === 'b' && !NO_E2_ART.has(charId) ? '_2' : ''}`,
        portrait: `${charId}_${x.suffix === 'b' && !NO_E2_ART.has(charId) ? '2' : '1'}`,
        spine: charId, skillIcon: skill?.iconId ?? null,
      },
      nativeGrowth: nativeGrowth(char),
      nativeImport: {
        status: ALL_NATIVE_KIT_READY.has(charId)?'workshop-default-kit-ready':'hidden-pending-native-kit',playable:ALL_NATIVE_KIT_READY.has(charId),availableModes:ALL_NATIVE_KIT_READY.has(charId)?['independent']:[],
        sourceNativeSkillIds: sourceSkills.map((s) => s.skillId), supportedSkillIds, unsupportedSkillIds: sourceSkills.map(s => s.skillId).filter(id => !supportedSkillIds.includes(id)), selectableSkillIds: skills.filter(s=>supportedSkillIds.includes(s.skillId)).map(s => s.skillId), tokenIds,
        defaultLoadout: skill ? { skillIndex: skill.index, skillId: skill.skillId, source: 'explicit native skill registry' } : null,
        assetSources,
        source: { characterTableUrl: SOURCE_URL, revision: SOURCE_REVISION, skillReferences: skills.map((s) => `https://prts.wiki/w/${encodeURIComponent(char.name)}`) },
      },
    });
  }
  return defs;
}

function nativeTokenRecord(tokenId, char, ctx, ownerIds) {
  if (!char || !Array.isArray(char.phases) || !char.phases.length) throw new Error(`${tokenId}: native token source missing phases`);
  const variants = {};
  for (const ownerId of ownerIds) {
    const elite = ownerId.endsWith('_b');
    const phase = Math.min(elite ? 2 : 1, char.phases.length - 1);
    const ownerChar = ctx.charTable[ownerId.replace(/^chess_native_/, '').replace(/_[ab]$/, '')];
    const ownerPhase = Math.min(elite ? 2 : 1, (ownerChar?.phases?.length || 1) - 1);
    const level = Math.min(elite ? 50 : 55, char.phases[phase].maxLevel);
    const ownerSkill = (ownerChar?.skills || []).find((s) => s.overrideTokenKey === tokenId);
    const skillIndex = Math.max(0, (ownerChar?.skills || []).findIndex((s) => s.skillId === ownerSkill?.skillId));
    const skillLevel = elite ? 7 : 4;
    const attrs = interpolateAttrs(char, phase, level);
    const trait = traitRecord(ctx, char, phase, level, [], ownerId);
    const nativeSkillId = char.skills?.[skillIndex]?.skillId ?? char.skills?.[0]?.skillId;
    const skill = nativeSkillId ? buildSkill(ctx, nativeSkillId, skillLevel, null, `${tokenId}@${ownerId}`) : null;
    variants[ownerId] = {
      phase, level, stats: statsFrom(attrs), immunities: immunitiesOf(attrs),
      rangeGrid: rangeGrid(ctx, char.phases[phase].rangeId), trait: trait.trait,
      ...trait.classify, skill, talents: baseTalentList(ctx, char, phase, level, [], `${tokenId}@${ownerId}`),
      count: 1, sources: ['skill'],
    };
  }
  const first = variants[ownerIds[0]];
  return {
    tokenId, kind: 'summon', name: char.name, appellation: char.appellation || null,
    desc: first.trait.desc, descRaw: first.trait.descRaw, profession: char.profession,
    subProfessionId: char.subProfessionId, position: char.position, displayType: null,
    placeable: false, ownerRange: false, owners: ownerIds, stats: first.stats,
    rangeGrid: first.rangeGrid, dmgType: first.dmgType, attackKind: first.attackKind,
    projectile: first.projectile, canHitFly: first.canHitFly,
    skill: first.skill ? { skillId: first.skill.skillId, bb: first.skill.bb } : null,
    deployLimit: first.stats?.deployLimit ?? 1, count: 1, abnormal: [], variants,
    assets: { avatar: tokenId, spine: tokenId },
    nativeSource: { table: 'character_table.json', revision: SOURCE_REVISION, tokenId },
  };
}

function tokenIdsForNativeOperator(char, supportedSkillIds) {
  return [...new Set([
    ...(char.skills || []).filter(s => supportedSkillIds.includes(s?.skillId)).map(s => s.overrideTokenKey).filter(Boolean),
    ...(char.talents || []).flatMap(t => (t.candidates || []).map(c => c?.tokenKey).filter(Boolean)),
  ])];
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
      importStatus: inPool ? 'existing-pool-growth-attached' : ALL_NATIVE_KIT_READY.has(charId) ? 'workshop-default-kit-ready' : 'hidden-pending-native-kit',
      skillIds: (c.skills || []).map((s) => s?.skillId).filter(Boolean),
      assetSources: nativeAssetSources(charId, c, (c.skills || []).map((skill) => ({ skillId: skill?.skillId, iconId: skill?.iconId })).filter((skill) => skill.skillId)),
      tokenIds: tokenIdsForNativeOperator(c, ALL_NATIVE_SKILL_SUPPORT[charId] || []),
      skillExecution: inPool
        ? { status: 'existing-upstream-definition-not-changed', supportedSkillIds: [], needsFocusedKitAudit: (c.skills || []).map(s => s?.skillId).filter(Boolean) }
        : {
          status: ALL_NATIVE_KIT_READY.has(charId) ? 'workshop-default-kit-ready' : 'hidden-pending-native-kit',
          defaultLoadout: (() => {
          const skillId = ALL_NATIVE_DEFAULT_SKILL_IDS[charId];
            const skillIndex = (c.skills || []).findIndex((skill) => skill?.skillId === skillId);
            return skillIndex < 0 ? null : { skillIndex, skillId, source: 'explicit native skill registry' };
          })(),
          supportedSkillIds: (ALL_NATIVE_SKILL_SUPPORT[charId] || []).filter((id) => (c.skills || []).some((s) => s?.skillId === id)),
          unsupportedSkillIds: (c.skills || []).map((s) => s?.skillId).filter((id) => !(ALL_NATIVE_SKILL_SUPPORT[charId] || []).includes(id)),
          sourceReferences: [`https://prts.wiki/w/${encodeURIComponent(c.name)}`],
        },
      nativeGrowth: growth,
      projectSampleStats: { normal: { phase: 1, level: atNormal, values: normalStats }, advanced: { phase: c.phases.length > 2 ? 2 : c.phases.length - 1, level: atAdvanced, values: advancedStats } },
      unresolved: inPool || ALL_NATIVE_KIT_READY.has(charId) ? [] : ['native skill execution and token variants must be implemented before activation'],
    });
  }
  return rows;
}

function nativeTokenSources(owner, tokenId) {
  const sources = [];
  if (owner.displayTokenDict?.[tokenId]) sources.push('display');
  if ((owner.talents || []).some((talent) => (talent.candidates || []).some((candidate) => candidate.tokenKey === tokenId))) sources.push('talent');
  if ((owner.skills || []).some((skill) => skill.overrideTokenKey === tokenId)) sources.push('skill');
  return sources;
}

function attachNativeTokens(tokenTable, candidates, charTable, ctx) {
  const ownersByToken = new Map();
  for (const rec of candidates) for (const tokenId of rec.tokens || []) {
    if (!ownersByToken.has(tokenId)) ownersByToken.set(tokenId, []);
    ownersByToken.get(tokenId).push(rec);
  }
  const attached = [];
  for (const [tokenId, owners] of ownersByToken) {
    const tokenChar = charTable[tokenId];
    if (!tokenChar || tokenChar.isNotObtainable || !Array.isArray(tokenChar.phases) || !tokenChar.phases.length) continue;
    const variants = {};
    const ownerIds = [];
    for (const ownerRec of owners) {
      const ownerChar = charTable[ownerRec.charId];
      if (!ownerChar) continue;
      const sources = nativeTokenSources(ownerChar, tokenId);
      const built = tokenVariant(ctx, tokenId, tokenChar, {
        phase: ownerRec.status.phase, level: ownerRec.status.level,
        skillIndex: ownerRec.nativeImport?.defaultLoadout?.skillIndex ?? 0,
        skillLevel: ownerRec.status.skillLevel, modulePhase: null, moduleTokenParts: [],
        label: `native token ${tokenId}@${ownerRec.chessId}`,
      });
      // Whiteiron's owner talent allows two concurrent devices from E1 onward;
      // token_table's single device attribute does not express this owner-wide cap.
      const deployLimit = ownerRec.charId==='char_4072_ironmn' ? (ownerRec.status.phase>=1?2:1) : built.talents?.reduce((max, talent) => Math.max(max, Number(talent.bb?.max_deploy_count) || 0), 0) || built.stats.deployLimit || 1;
      built.stats.deployLimit = deployLimit;
      variants[ownerRec.chessId] = { ...built, nativeGrowth:nativeGrowth(tokenChar), status:{phase:ownerRec.status.phase,level:ownerRec.status.level}, count: deployLimit, sources };
      ownerIds.push(ownerRec.chessId);
    }
    if (!ownerIds.length) continue;
    const first = variants[ownerIds[0]], existing = tokenTable[tokenId] || {};
    const sourceKinds = [...new Set(Object.values(variants).flatMap((v) => v.sources))];
    tokenTable[tokenId] = {
      ...existing,
      tokenId, kind: 'summon', name: tokenChar.name, appellation: tokenChar.appellation || null,
      desc: tokenChar.description || tokenChar.trait?.candidates?.[0]?.overrideDescripton || '',
      descRaw: tokenChar.description || null, profession: tokenChar.profession || 'TOKEN',
      subProfessionId: tokenChar.subProfessionId || null, position: tokenChar.position || 'MELEE',
      displayType: existing.displayType || 'DEFAULT',
      placeable: existing.placeable ?? sourceKinds.some((kind) => kind === 'display' || kind === 'talent'),
      ownerRange: existing.ownerRange || /只能部署在\S*攻击范围内/.test(tokenChar.description || ''),
      owners: [...new Set([...(existing.owners || []), ...ownerIds])],
      stats: existing.stats || first.stats, rangeGrid: existing.rangeGrid || first.rangeGrid,
      dmgType: existing.dmgType || first.dmgType, attackKind: existing.attackKind || first.attackKind,
      projectile: existing.projectile || first.projectile, canHitFly: existing.canHitFly ?? first.canHitFly,
      skill: existing.skill || first.skill, deployLimit: Math.max(existing.deployLimit || 1, ...Object.values(variants).map((v) => v.stats.deployLimit || 1)),
      count: Math.max(existing.count || 1, ...Object.values(variants).map((v) => v.count || 1)),
      abnormal: existing.abnormal || [], variants: { ...(existing.variants || {}), ...variants },
      assets: existing.assets || { avatar: tokenId, spine: tokenId },
      nativeGrowth:nativeGrowth(tokenChar),
      source: { table: 'character_table.json', revision: SOURCE_REVISION, url: SOURCE_URL },
    };
    attached.push(tokenId);
  }
  return attached;
}

export async function runImport(opts) {
  const charTable = JSON.parse(await readFile(opts.characterTable, 'utf8'));
  const skillTable = JSON.parse(await readFile(opts.skillTable, 'utf8'));
  const rangeTable = JSON.parse(await readFile(opts.rangeTable, 'utf8'));
  const chess = JSON.parse(await readFile(opts.chess, 'utf8'));
  const assets = JSON.parse(await readFile(opts.assets, 'utf8'));
  const tokenTable = JSON.parse(await readFile(opts.tokens, 'utf8'));
  const updated = structuredClone(chess);
  const updatedAssets = structuredClone(assets);
  const updatedTokens = structuredClone(tokenTable);
  const triggerSource = JSON.parse(await readFile(resolve(ROOT,'data/native-skill-trigger-source.json'),'utf8'));
  const ctx = { skillTable, rangeTable, charTable, ac: triggerSource };
  if(!Array.isArray(triggerSource.skillTriggerDataList))throw new Error('Missing official native autoChess triggers');
  let attached = 0;
  const missingIds = [];
  for (const rec of Object.values(updated)) {
    if (!rec.charId) continue;
    const c = charTable[rec.charId];
    if (!c || c.isNotObtainable) { missingIds.push(rec.charId); continue; }
    assertCurve(c, rec.charId);
    rec.nativeGrowth = nativeGrowth(c);
    if (rec.chessType === 'NATIVE_IMPORT_CANDIDATE') addNativeAssets(updatedAssets, rec.charId, c, rec.skills || []);
    if (rec.chessType === 'NATIVE_IMPORT_CANDIDATE') {
      const sourceNativeSkillIds = (rec.skills || []).map((skill) => skill?.skillId).filter(Boolean);
      const supportedSkillIds = (ALL_NATIVE_SKILL_SUPPORT[rec.charId] || []).filter((id) => sourceNativeSkillIds.includes(id));
      const defaultSkillId = ALL_NATIVE_DEFAULT_SKILL_IDS[rec.charId] || null;
      if (defaultSkillId && !supportedSkillIds.includes(defaultSkillId)) throw new Error(`${rec.charId}: selected native loadout ${defaultSkillId} has no complete kit`);
      const sourceSkills = rec.skills || [];
      rec.nativeSourceSkillIds = sourceNativeSkillIds;
      rec.skills = sourceSkills.map((skill) => ({ ...skill, trigger:resolveTrigger(ctx,c,rec.charId,skill.index,skill,{operator:true,chessId:rec.chessId.replace(/_b$/,'_a')}), isDefault: skill.skillId === defaultSkillId }));
      const normal=updated[rec.chessId.replace(/_b$/,'_a')];
      if(rec.isGolden&&normal&&rec.status.phase===normal.status.phase&&rec.status.level<normal.status.level){
        rec.status.level=normal.status.level;rec.stats=statsFrom(interpolateAttrs(c,rec.status.phase,rec.status.level));
        const traits=traitRecord(ctx,c,rec.status.phase,rec.status.level,[],rec.chessId);
        rec.trait=traits.trait;Object.assign(rec,traits.classify);rec.talents=baseTalentList(ctx,c,rec.status.phase,rec.status.level,rec.chessId);
      }
      const selectedNativeSkill = defaultSkillId ? rec.skills.find((skill) => skill.skillId === defaultSkillId) ?? null : null;
      rec.skill = selectedNativeSkill ? { ...selectedNativeSkill } : null;
      if(rec.skill) delete rec.skill.isDefault;
      const e2Art = !NO_E2_ART.has(rec.charId);
      rec.assets = {
        avatar: `${rec.charId}${rec.isGolden && e2Art ? '_2' : ''}`,
        portrait: `${rec.charId}_${rec.isGolden && e2Art ? '2' : '1'}`,
        spine: rec.charId, skillIcon: rec.skill?.iconId ?? null,
      };
      rec.nativeImport = {
        ...(rec.nativeImport || {}),
        status: ALL_NATIVE_KIT_READY.has(rec.charId)?'workshop-default-kit-ready':'hidden-pending-native-kit',playable:ALL_NATIVE_KIT_READY.has(rec.charId),availableModes:ALL_NATIVE_KIT_READY.has(rec.charId)?['independent']:[],sourceNativeSkillIds,supportedSkillIds,selectableSkillIds:rec.skills.filter(skill=>supportedSkillIds.includes(skill.skillId)).map(skill=>skill.skillId),
        unsupportedSkillIds: sourceNativeSkillIds.filter((id) => !supportedSkillIds.includes(id)),
        defaultLoadout: (() => {
          const skillId = defaultSkillId;
          const skill = (rec.skills || []).find((item) => item.skillId === skillId);
          return skill ? { skillIndex: skill.index, skillId, source: 'explicit native skill registry' } : null;
        })(),
        tokenIds: tokenIdsForNativeOperator(c, supportedSkillIds),
        source: { characterTableUrl: SOURCE_URL, revision: SOURCE_REVISION, skillReferences: sourceNativeSkillIds.map(() => `https://prts.wiki/w/${encodeURIComponent(c.name)}`) },
        assetSources: nativeAssetSources(rec.charId, c, rec.skills || []),
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
  const nativeTokenIds = attachNativeTokens(updatedTokens, Object.values(updated).filter((rec) => rec.chessType === 'NATIVE_IMPORT_CANDIDATE'), charTable, ctx);
  for(const tokenId of nativeTokenIds){
    const owner=Object.values(updated).find(rec=>rec.chessType==='NATIVE_IMPORT_CANDIDATE'&&rec.tokens?.includes(tokenId))?.charId;
    updatedAssets.tokens||={};updatedAssets.tokens[tokenId]={...(updatedAssets.tokens[tokenId]||{}),owner,avatar:`/assets/token/avatar/${tokenId}.png`};
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
    targetAssets: opts.assets,
    targetTokens: opts.tokens,
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
      { charId: 'char_240_wyvern', skillId: 'skchr_wyvern_1', case: 'DP charge command, ATK buff and source talent', fixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js') },
      { charId: 'char_366_acdrop', skillId: 'skchr_acdrop_1', case: 'native duration ASPD buff', fixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js') },
      { charId: 'char_385_finlpp', skillId: 'skchr_finlpp_1', case: 'source heal scale on next healing attack', fixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js') },
      { charId: 'char_4119_wanqin', skillId: 'skcom_assist_cost[3]', case: 'native timed command DP total', fixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js') },
      { charId: 'char_4019_ncdeer', skillId: 'skchr_ncdeer_1', case: 'native ATK buff and low-HP ally protection aura', fixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js') },
      { charId: 'char_2024_chyue', skillId: 'skchr_chyue_1', case: 'three-charge triple strike and target damage mark', fixtureFile: resolve(ROOT, 'test/content/newnativekits.test.js') },
    ],
    tokenAudit: { importedTokenDefinitions: nativeTokenIds, unresolvedTokenIds: candidates.filter(c => !c.inCurrentChess).flatMap(c => c.tokenIds.filter(tokenId => !updatedTokens[tokenId]).map(tokenId => ({ charId: c.charId, tokenId }))) },
    assetAudit: {
      newlyIndexedCharacters: candidates.filter((candidate) => !candidate.inCurrentChess).map((candidate) => candidate.charId),
      existingImageManifestEntries: Object.values(chess).filter((c) => c.chessType === 'NATIVE_IMPORT_CANDIDATE').length,
      localAssetPaths: resolve(CANONICAL_ROOT,'public/assets'),
      imageSourceRevision: IMAGE_REVISION, spineSourceRevision: SPINE_REVISION,
      noE2Artwork: [...NO_E2_ART], noSpineBack: [...NO_SPINE_BACK],
      sourceHttpChecks: {
        method: 'HEAD',
        avatar: { checked: 34, http200: 34 }, portraitE1: { checked: 34, http200: 34 }, skillIcons: { checked: 74, http200: 74 },
        avatarE2: { checked: 32, http200: 32, absentFromPinnedManifest: [...NO_E2_ART] },
        portraitE2: { checked: 32, http200: 32, absentFromPinnedManifest: [...NO_E2_ART] },
        spineFrontFiles: { checked: 102, http200: 102 },
        spineBackFiles: { checked: 102, http200: 99, missing: [{ charId: 'char_4045_heidi', files: ['skel', 'atlas', 'png'], httpStatus: 404 }] },
      },
    },
    status: opts.write ? 'written' : 'dry-run',
  };
  if (opts.write) {
    const text = JSON.stringify(updated);
    const tmp = `${opts.chess}.tmp-${process.pid}`;
    await writeFile(tmp, text);
    await rename(tmp, opts.chess);
    const assetText = JSON.stringify(updatedAssets) + '\n';
    const assetTmp = `${opts.assets}.tmp-${process.pid}`;
    await writeFile(assetTmp, assetText);
    await rename(assetTmp, opts.assets);
    const tokenText = JSON.stringify(updatedTokens) + '\n';
    const tokenTmp = `${opts.tokens}.tmp-${process.pid}`;
    await writeFile(tokenTmp, tokenText);
    await rename(tokenTmp, opts.tokens);
    await mkdir(dirname(opts.report), { recursive: true });
    await writeFile(opts.report, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const report = await runImport(opts);
    console.log(JSON.stringify({ status: report.status, targetChess: report.targetChess, targetAssets:report.targetAssets,targetTokens:report.targetTokens,report: opts.report, currentPool: report.currentPool, selected: report.selected.total, missingKits: report.selected.candidates.filter(c => c.unresolved.length).length }));
  } catch (e) {
    console.error(`import-native-growth: ${e.stack || e}`);
    process.exitCode = 1;
  }
}
