import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { EVENT_FAMILIES, RUN_GROWTH_EVENTS, validateAdaptation } from '../../shared/assault/adaptation.js';
import { RUN_CARD_GROWTH } from '../../shared/assault/growth-policy.js';
import { adaptationKits } from '../../server/sim/content/assault/cards/adaptation-registry.js';
import { extendedGrid } from '../../shared/loadoutRecord.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--runtime', '--public-text', '--output', '--scope'].includes(process.argv[i]) || !process.argv[i + 1]) throw Error('Unknown quota option');
  args.set(process.argv[i], process.argv[i + 1]);
}
const scope = args.get('--scope') ?? 'full';
if (!['core', 'full'].includes(scope)) throw Error('Quota scope must be core or full');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sourceRoot = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel';
const characters = read(path.join(sourceRoot, 'character_table.json'));
const patches = read(path.join(sourceRoot, 'char_patch_table.json')).patchChars;
const skills = read(path.join(sourceRoot, 'skill_table.json'));
const ranges = read(path.join(sourceRoot, 'range_table.json'));
const normalizedGrid = grid => JSON.stringify(grid.map(cell => [...cell]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
const runtime = read(args.get('--runtime') ?? path.join(root, 'data/assault-runtime.json'));
const publicText = read(args.get('--public-text') ?? path.join(root, 'data/assault-public-text.json'));
const bodies = Object.values(runtime.bodies), cards = bodies.filter(body => body.adaptation);
const errors = [], check = (condition, message) => { if (!condition) errors.push(message); };
const families = Object.fromEntries(Object.keys(EVENT_FAMILIES).map(family => [family, { producers: [], consumers: [] }]));
const roles = Object.fromEntries(['direct', 'feed', 'control', 'buffOthers', 'selfGrowth', 'runGrowth', 'aura', 'deploy'].map(role => [role, []]));
const lengths = [], thirdLines = [], rangeProof = [],summonLifeProof=[];
const summonLives={char_108_silent:['token_10000_silent_healrb','description'],char_484_robrta:['token_10018_robrta_mach','token'],
  char_4016_kazema:['token_10022_kazema_shadow','skill'],char_344_beewax:['token_10011_beewax_oblisk','token'],
  char_393_toledo:['token_10067_toledo_tldptm','token'],char_1014_nearl2:['token_10019_nearl2_sword','skill'],
  char_1019_siege2:['token_10040_siege2_vlion','skill']};
for (const body of cards) {
  const id = body.charId, plan = body.adaptation, face = publicText.operators[id]?.card;
  try { validateAdaptation(plan); } catch (error) { errors.push(`${id}: ${error.message}`); }
  check(!plan.pendingDecision, `${id}: unresolved design decision: ${plan.pendingDecision}`);
  check(typeof adaptationKits[id] === 'function', `${id}: missing typed cast/link handler`);
  const nativePassive = plan.passive && plan.sourceSkillId == null && !!plan.sourceTraitId;
  check(nativePassive ? body.source.skills.length === 0 : body.source.skills[plan.sourceIndex]?.skillId === plan.sourceSkillId, `${id}: original skill slot mismatch`);
  const original = characters[id] ?? patches?.[id], level = skills[plan.sourceSkillId]?.levels?.at(-1);
  if(id==='char_4072_ironmn'){
    const token=characters.token_10027_ironmn_pile2,skill=skills[token.skills[0].skillId].levels.at(-1);
    const drain=skill.blackboard.find(entry=>entry.key==='s2.hp_ratio')?.value;
    check(Math.abs(plan.values.deviceCastLoss-level.duration*drain)<1e-9,`${id}: instant device HP cost differs from the full original skill cost`);
  }
  const sourceId = original?.skills?.[plan.sourceIndex]?.skillId;
  check(nativePassive ? original?.skills?.length === 0 && plan.sourceTraitId === `character_table.json#/${id}/talents/${plan.sourceTalent}`
    : sourceId === plan.sourceSkillId, `${id}: slot differs from pinned original character table`);
  const rangeId = level?.rangeId ?? level?.blackboard?.find(entry => entry.key === 'range_id' && entry.valueStr)?.valueStr ?? original?.phases?.at(-1)?.rangeId;
  const extension = level?.blackboard?.find(entry => entry.key === 'ability_range_forward_extend')?.value ?? 0;
  const sourceRange = ranges[rangeId]?.grids?.map(cell => [cell.row, cell.col]);
  const expectedRange=plan.nativeRange === 'forwardLine' && /无限长的直线/.test(level?.description??'')
    ? Array.from({length:21},(_,i)=>[0,i]) : sourceRange && extendedGrid(sourceRange, extension);
  check(!!expectedRange && normalizedGrid(plan.rangeGrid) === normalizedGrid(expectedRange), `${id}: skill range differs from pinned original`);
  const explicitTargets = level?.blackboard?.find(entry => /(?:^|@)max_target$/.test(entry.key))?.value;
  // §8 explicitly retains the user's whole-range cold version of 初雪. This
  // documented exception is visible in the receipt, never used for other cards.
  const targetException = id === 'char_174_slbell' ? 'bazaar-adaptation.md §8：用户原需求的全范围寒冷示范'
    : id === 'char_437_mizuki' ? '原技能主攻击全范围；attack@max_target=2是天赋额外目标数，与基础1名合计3名，非主攻击上限。' : null;
  if (explicitTargets != null && !targetException) check(plan.targetCount === explicitTargets, `${id}: original target count ${explicitTargets} changed to ${plan.targetCount}`);
  rangeProof.push({ id, sourceSkillId: plan.sourceSkillId, rangeId, nativeRange:plan.nativeRange??null, cells: plan.rangeGrid.length, explicitTargets: explicitTargets ?? null, adaptedTargets: plan.targetCount, targetException });
  if(summonLives[id]){const[tokenId,kind]=summonLives[id],token=runtime.summons[tokenId];
    const seconds=kind==='skill'?level?.duration:kind==='description'?Number(level?.description?.match(/(\d+)秒后自动销毁/)?.[1]):
      token?.talents?.find(t=>t.bb?.duration>0)?.bb.duration;
    check(seconds>0&&plan.values.seconds===seconds,`${id}: original summon lifetime ${seconds} must be preserved`);
    summonLifeProof.push({id,tokenId,source:kind,originalSeconds:seconds,adaptedSeconds:plan.values.seconds});
  }
  check(Number.isInteger(plan.sourceTalent) && !!body.source.talents[plan.sourceTalent]?.name, `${id}: link has no original talent`);
  if (!plan.passive) check(new Set(body.fixedSkill.spCosts).size === 1 && body.fixedSkill.spCosts[0] === plan.tempo.cost, `${id}: SP changes with star or differs from tempo`);
  check(!body.bazaar.castPayoff, `${id}: obsolete recast payoff`);
  check(body.modulePlans?.length === 2, `${id}: exactly two module options required`);
  for(const manual of plan.manualSummons??[])check(body.summonTemplateIds?.includes(manual.tokenId),`${id}: manual summon is missing from the owner's deployable templates`);
  for (const module of body.modulePlans ?? []) {
    const patch = module.adaptationUpgrade;
    check(module.unlockStar === 3 && patch && Number.isFinite(patch.value) && Number.isFinite(plan.values[patch.key]), `${id}: module must change one existing numeric effect`);
    const populationSource=id==='char_4037_demetr'&&patch?.key==='modulePopulation'&&module.sourceModuleId==='uniequip_002_demetr'
      &&module.source?.table==='uniequip_table.json'&&module.source.pointer==='/equipDict/uniequip_002_demetr';
    check(populationSource||!!module.source?.pointer && ['skill_table.json', 'character_table.json'].includes(module.source.table), `${id}: module has no original skill/talent/module source`);
    check(typeof module.keyword==='string'&&module.keyword.length>0,`${id}: module must identify its native keyword`);
    check(!['scale','atk','def','hp','aspd','aura','selfDef','selfBonus','allyATK','linkAtk','extraHP','focus','groundATK','perBlock','abyssal','res','healing','amp'].includes(patch?.key),
      `${id}: module is an attribute-only upgrade rather than a keyword`);
    const line=face?.modules?.[module.id]?.line;
    check(line?.textByStar?.length===4,`${id}: missing four-star module text`);
    for(const text of line?.textByStar??[]){
      check([...text].length<=32,`${id}: module exceeds 32 characters`);
      check(!/每\s*[\d.]+\s*秒(?:最多|至多)|永久/.test(text),`${id}: forbidden module cadence/lifetime wording`);
    }
  }
  check(face?.lines?.length >= 1 && face.lines.length <= 3, `${id}: card must have 1–3 lines`);
  let screen = 0;
  for (const [index, line] of (face?.lines ?? []).entries()) {
    for (const text of line.textByStar ?? []) {
      check([...text].length <= 32, `${id}: line ${index + 1} exceeds 32 characters`);
      check(!/每\s*[\d.]+\s*秒(?:最多|至多)|永久|重复施放结算/.test(text), `${id}: forbidden cadence/lifetime/payoff wording`);
    }
    screen += [...(line.textByStar?.[0] ?? '')].length;
  }
  lengths.push(screen);
  if (face?.lines?.length === 3) thirdLines.push(id);
  for (const family of plan.produces ?? []) {
    check(!!families[family], `${id}: unknown produced family ${family}`);
    families[family]?.producers.push(id);
  }
  for (const family of ['skill', 'kill']) if (!families[family].producers.includes(id)) families[family].producers.push(id);
  if (['TANK', 'PIONEER'].includes(body.profession)) families.block.producers.push(id);
  for (const family of plan.consumes ?? []) {
    check(!!families[family], `${id}: unknown consumed family ${family}`);
    families[family]?.consumers.push(id);
  }
  for (const role of plan.roles ?? []) {
    check(!!roles[role], `${id}: unknown role ${role}`); roles[role]?.push(id);
  }
  if (plan.roles?.includes('runGrowth')) check(plan.growthEvents?.length > 0 && plan.growthEvents.every(event => RUN_GROWTH_EVENTS.includes(event)), `${id}: cross-battle growth must use outside-battle events`);
  check(!!plan.roles?.includes('runGrowth')===!!RUN_CARD_GROWTH[id],`${id}: approved run-growth identity mismatch`);
  if(RUN_CARD_GROWTH[id])check(JSON.stringify(plan.runGrowth)===JSON.stringify(RUN_CARD_GROWTH[id]),`${id}: approved growth parameters mismatch`);
  check(!plan.roles?.includes('deploy') || plan.nativeDeploy === true, `${id}: invented deployment trigger`);
}
lengths.sort((a, b) => a - b);
const median = lengths.length ? (lengths[Math.floor((lengths.length - 1) / 2)] + lengths[Math.floor(lengths.length / 2)]) / 2 : null;
check(median != null && median <= 70, `first-screen median exceeds 70 (${median})`);
check(thirdLines.length <= 30, 'more than 30 cards use a third line');
const pending = bodies.filter(body => !body.adaptation).map(body => body.charId);
if (scope === 'core') {
  check(cards.length >= 30, `three leader core lines require about 30 cards; only ${cards.length} adapted`);
  for (const line of ['redeploy', 'ammo', 'workshop']) check(cards.filter(body => body.adaptation.line === line).length >= 9, `${line}: fewer than 9 core cards`);
} else {
  check(bodies.length === 172 && cards.length === 172, `full pool requires 172 adapted cards; ${pending.length} pending`);
  // cold: the pinned official tables give only 6 of the 172 bodies a real 寒冷/冻结 source (凛御银灰, 寒檀, 耶拉, 雪猎,
  // 圣聆初雪, 灵知); 初雪 and 崖心 were reverted to their original mechanics on 2026-10-28, so the producer floor is 6, not 8.
  const minimums = { skill: [172, 15], cold: [6, 5], control: [15, 8], displacement: [8, 4], element: [6, 4],
    sustain: [15, 6], deployment: [10, 8], ammunition: [8, 5], summon: [8, 5], block: [0, 5], kill: [172, 6], economy: [8, 4] };
  for (const [family, [producers, consumers]] of Object.entries(minimums)) {
    check(families[family].producers.length >= producers, `${family}: insufficient producers`);
    check(families[family].consumers.length >= consumers, `${family}: insufficient consumers`);
  }
  const ratio = (role, min, max) => {
    const count = roles[role].length;
    check(count >= Math.ceil(172 * min) && count <= Math.floor(172 * max), `${role}: ${count}/172 outside ${min}–${max}`);
  };
  // The user resolved §4.2 versus §5.3 explicitly: preserve original signature
  // skills and adjust the direct-output range to their actual behavior. Most
  // native attack/heal signatures settle immediately after B conversion.
  // Keep every other quota unchanged; never relabel damage as utility.
  ratio('direct', .85, .95); ratio('feed', .15, .2); ratio('control', .15, .2); ratio('buffOthers', .1, .15);
  ratio('selfGrowth', 0, .15); ratio('aura', .25, .35); ratio('deploy', 0, .18);
  check(roles.runGrowth.length <= 8, 'cross-battle growth exceeds 8 cards');
}
const report = { version: 1, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  sourceClean: !execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  scope, status: errors.length ? 'fail' : 'pass', adapted: cards.length, pending, median, thirdLines,
  families, roles, rangeProof,summonLifeProof, errors,
  directOutputPolicy:{originalRange:[.5,.6],effectiveRange:[.85,.95],count:roles.direct.length,total:bodies.length,
    authorization:'优先保留原技能特色，据实际效果调整输出比例门禁（推荐）',
    rationale:'原持续攻击与治疗签名压缩后仍是直接产出；纯属性状态、范围光环与元素积累不冒充直接输出。'},
  roleDefinitions:{aura:'持续存在并随范围、职业或条件维持的群体加成；有限阵地与触发标记单列，不计常驻光环。',
    control:'承担主要控制职责；寒芒克洛丝0.2秒和雷蛇25%一秒打断保留，列为次要打断。'} };
if (args.has('--output')) fs.writeFileSync(args.get('--output'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ scope, status: report.status, adapted: cards.length, pending: pending.length, median, errors }));
process.exitCode = errors.length ? 1 : 0;
