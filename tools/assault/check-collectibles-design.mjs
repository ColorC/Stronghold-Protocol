import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 进击收藏品结构 / 来源校验器。
// 校验真实内容：普通字段只按契约要求检查，来源字段回读原生 roguelike_topic_table.json
// 实体，核对 name/iconId 与指针一致，不制造镜像测试。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const partial = args.includes('--partial');
const target = path.join(root, 'data/assault-design/collectibles.json');
const outputArg = args.indexOf('--output');
const output = outputArg >= 0 ? args[outputArg + 1] : path.join(root, 'docs/assault-mode/collectibles.md');
if (!output || !path.isAbsolute(output)) throw new Error('--output must be an absolute document path');
const SOURCE_FILE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json';

const TRACKS = ['cold', 'redeploy', 'ammo', 'element', 'summon', 'healShield', 'blockCounter', 'pierceCrit', 'skillCycle', 'economyGrowth'];
const ALL_TRACKS = [...TRACKS, 'cross', 'leader'];
const RARITIES = new Set(['common', 'rare', 'epic', 'starter']);
const TRACK_RARITY = { common: 2, rare: 2, epic: 2 };
const TRIGGERS = new Set(['attack', 'hit', 'damageTaken', 'skillStart', 'skillResolved', 'deploymentCost', 'statusApplied', 'debuffApplied', 'heal', 'shieldBroken', 'elementBurst', 'ammoUsed', 'reloaded', 'summonSpawned', 'summonDied', 'redeploy', 'deployed', 'death', 'battleStart', 'battleEnd', 'kill', 'hourStarted', 'purchase', 'merge']);
const IMPLEMENTATION_EVENTS = new Set([...TRIGGERS, 'enemySpawn']);
const ACTIONS = new Set(['damage', 'heal', 'shield', 'applyStatus', 'addBuff', 'spGain', 'haste', 'spCost', 'redeploy', 'summon', 'ammo', 'economy', 'growth', 'modifyTag']);
const GEOMETRIES = new Set(['self', 'adjacent4', 'adjacent8', 'front1', 'attackRange', 'field', 'radius']);
const LIFECYCLES = new Set(['instant', 'battle', 'run']);
const TEAMS = new Set(['ally', 'enemy', 'neutral']);
const ACQ = new Set(['shop', 'reward', 'event', 'leader']);
const LEADER_CHARS = { 'char_1045_svash2': '凛御银灰', 'char_4072_ironmn': '白铁', 'char_1041_angel2': '新约能天使' };
const CURRENCIES = new Set(['gold', 'dp', 'xp', 'hp']);

const errors = [];
const design = JSON.parse(fs.readFileSync(target, 'utf8'));
if (design.schema !== 'assault-collectibles-design/v1') errors.push('wrong schema');
if (!Array.isArray(design.items)) errors.push('items must be an array');
const items = Array.isArray(design.items) ? design.items : [];

// 读取原生源表，只用于按指针核对来源实体。
let source = null;
try { source = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8')); } catch (e) { errors.push(`cannot read native source: ${e.message}`); }
function resolvePointer(pointer) {
  if (!source || typeof pointer !== 'string' || !pointer.startsWith('/')) return null;
  return pointer.slice(1).split('/').reduce((node, key) => (node == null ? node : node[key]), source);
}

const ids = new Set();
const seenLeader = new Set();
const counts = { track: {}, rarity: {} };
function checkEffect(effect, label, item) {
  if (!effect || typeof effect !== 'object') { errors.push(`${label}: effect must be an object`); return; }
  if (!TRIGGERS.has(effect.trigger)) errors.push(`${label}: invalid trigger ${effect.trigger}`);
  if (!effect.condition || typeof effect.condition !== 'object' || Array.isArray(effect.condition)) errors.push(`${label}: condition object required`);
  const t = effect.target;
  if (!t || typeof t !== 'object') errors.push(`${label}: target required`);
  else {
    if (!TEAMS.has(t.team)) errors.push(`${label}: invalid target.team ${t.team}`);
    if (typeof t.selection !== 'string' || !t.selection.trim()) errors.push(`${label}: target.selection required`);
    if (!GEOMETRIES.has(t.geometry)) errors.push(`${label}: invalid geometry ${t.geometry}`);
    if (t.count == null) errors.push(`${label}: target.count required`);
    if (t.geometry === 'radius' && !(Number.isFinite(t.radius) && t.radius > 0)) errors.push(`${label}: radius geometry needs exact positive radius`);
    const blob = JSON.stringify(t);
    if (t.geometry === 'adjacent8' && /8/.test(String(t.radius ?? ''))) errors.push(`${label}: adjacent8 must not carry radius 8`);
    if (/周围\s*8\s*格|半径\s*8|半径八/.test(blob)) errors.push(`${label}: adjacent eight tiles is not radius eight`);
  }
  if (!ACTIONS.has(effect.action)) errors.push(`${label}: invalid action ${effect.action}`);
  if (effect.action === 'modifyTag') {
    // modifyTag 只允许增删真实阵营/职业/机制身份标签，不能冒充属性 modifier。
    const p = effect.params ?? {};
    const hasIdentity = Array.isArray(p.addTags) && p.addTags.every(x => typeof x === 'string') || Array.isArray(p.removeTags) && p.removeTags.every(x => typeof x === 'string');
    if (!hasIdentity) errors.push(`${label}: modifyTag may only addTags/removeTags identity labels`);
    for (const [k, v] of Object.entries(p)) {
      if (['addTags', 'removeTags', 'note'].includes(k)) continue;
      if (typeof v === 'number' || ['op', 'value', 'stat', 'tag', 'maxStacks', 'scope'].includes(k)) errors.push(`${label}: modifyTag must not carry attribute modifier '${k}'`);
    }
  }
  if (effect.action === 'redeploy') {
    if (!Object.keys(effect.params ?? {}).some(k => Number.isFinite(effect.params[k]))) errors.push(`${label}: redeploy modifier needs an exact numeric value`);
  }
  if (!effect.params || typeof effect.params !== 'object' || Array.isArray(effect.params) || !Object.keys(effect.params).length) errors.push(`${label}: params object with exact values required`);
  if (effect.action === 'economy') {
    if (!CURRENCIES.has(effect.params?.currency)) errors.push(`${label}: economy effect needs currency gold/dp/xp/hp`);
  }
  if (effect.action === 'spCost' && effect.params?.currency === 'dp' && effect.params?.min !== 0) errors.push(`${label}: deployment cost minimum is 0, not the SP minimum`);
  if (effect.trigger === 'skillResolved' && effect.limits?.perBattle != null && effect.limitScope !== 'unit') errors.push(`${label}: skillResolved per-unit limits need explicit unit scope`);
  if (!LIFECYCLES.has(effect.lifecycle)) errors.push(`${label}: invalid lifecycle ${effect.lifecycle}`);
  const s = effect.stacking;
  if (!s || typeof s !== 'object' || typeof s.same !== 'string' || !s.same.trim() || typeof s.cross !== 'string' || !s.cross.trim()) errors.push(`${label}: stacking same/cross required`);
  if (effect.limits !== null) {
    const l = effect.limits;
    if (!l || typeof l !== 'object') errors.push(`${label}: limits must be object or null`);
    else {
      for (const k of ['perBattle', 'perDeployment', 'perHour', 'perRun']) {
        if (!(k in l)) errors.push(`${label}: limits.${k} required (use null for unlimited)`);
        else if (l[k] !== null && !(Number.isInteger(l[k]) && l[k] >= 0)) errors.push(`${label}: limits.${k} must be nonnegative integer or null`);
      }
      if (typeof l.reason !== 'string' || !l.reason.trim()) errors.push(`${label}: limits.reason required`);
    }
  }
  if (typeof effect.description !== 'string' || effect.description.trim().length < 4) errors.push(`${label}: effect description required`);
}

for (const item of items) {
  const tag = item?.id ?? '<no-id>';
  if (!item || typeof item !== 'object') { errors.push('item must be an object'); continue; }
  if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) errors.push(`${tag}: id must be stable lowercase ASCII`);
  if (ids.has(item.id)) errors.push(`${tag}: duplicate id`);
  ids.add(item.id);
  if (typeof item.name !== 'string' || !item.name.trim()) errors.push(`${tag}: name required`);
  if (!ALL_TRACKS.includes(item.track)) errors.push(`${tag}: invalid track ${item.track}`);
  if (!RARITIES.has(item.rarity)) errors.push(`${tag}: invalid rarity ${item.rarity}`);
  else counts.rarity[item.rarity] = (counts.rarity[item.rarity] ?? 0) + 1;
  counts.track[item.track] = (counts.track[item.track] ?? 0) + 1;
  if (typeof item.description !== 'string' || item.description.trim().length < 10) errors.push(`${tag}: description too short`);
  if (!['nativeAdaptation', 'original'].includes(item.sourceStatus)) errors.push(`${tag}: invalid sourceStatus`);
  if (typeof item.adaptationReason !== 'string' || item.adaptationReason.trim().length < 6) errors.push(`${tag}: adaptationReason required`);
  if (!Number.isInteger(item.unlockDay) || item.unlockDay < 1 || item.unlockDay > 10) errors.push(`${tag}: unlockDay must be 1..10`);
  if (!Array.isArray(item.acquisition) || !item.acquisition.length) errors.push(`${tag}: acquisition must be a nonempty array`);
  else for (const [i, a] of item.acquisition.entries()) {
    if (!a || !ACQ.has(a.type)) errors.push(`${tag}: acquisition[${i}] invalid type`);
  }
  if (!Array.isArray(item.effects) || !item.effects.length) errors.push(`${tag}: at least one effect required`);
  else for (const [i, e] of item.effects.entries()) checkEffect(e, `${tag}: effect ${i}`, item);
  if (!Array.isArray(item.causalChecks) || item.causalChecks.length < 2) errors.push(`${tag}: at least two causalChecks required`);
  else for (const [i, c] of item.causalChecks.entries()) {
    if (!c || typeof c.scenario !== 'string' || c.scenario.trim().length < 6 || typeof c.expect !== 'string' || c.expect.trim().length < 6) errors.push(`${tag}: causalChecks[${i}] needs scenario and expect`);
  }
  const ip = item.implementationPlan;
  if (!ip || typeof ip !== 'object' || !Array.isArray(ip.events) || !ip.events.length || !Array.isArray(ip.primitives) || !ip.primitives.length) errors.push(`${tag}: implementationPlan needs events[] and primitives[]`);
  else {
    for (const ev of ip.events) if (!IMPLEMENTATION_EVENTS.has(ev)) errors.push(`${tag}: implementationPlan event ${ev} not a machine trigger`);
  }

  if (item.sourceStatus === 'nativeAdaptation') {
    const ref = item.sourceRef;
    if (!ref || !ref.file || !ref.pointer) { errors.push(`${tag}: nativeAdaptation needs sourceRef`); continue; }
    if (!String(ref.file).replace(/\\/g, '/').endsWith('/arknights/excel/roguelike_topic_table.json')) errors.push(`${tag}: sourceRef.file must be native source json`);
    const entity = resolvePointer(ref.pointer);
    if (!entity || entity.type !== 'RELIC') { errors.push(`${tag}: sourceRef.pointer does not resolve to a RELIC item`); continue; }
    if (entity.name !== item.name) errors.push(`${tag}: name mismatch with native ${entity.name}`);
    if (entity.iconId !== item.iconId) errors.push(`${tag}: iconId mismatch with native ${entity.iconId}`);
    if (item.nativeUsage !== entity.usage) errors.push(`${tag}: nativeUsage must be the original usage text`);
    if (typeof item.nativeUsage !== 'string' || !item.nativeUsage.trim()) errors.push(`${tag}: nativeUsage required`);
    const er = item.sourceEffectRef;
    const relic = er ? resolvePointer(er.pointer) : null;
    if (!relic || !Array.isArray(relic.buffs)) errors.push(`${tag}: sourceEffectRef must resolve to native relic blackboard`);
    // 指针末尾 id 必须与 item 实体 id 相同，防止张冠李戴。
    if (ref.pointer.split('/').pop() !== entity.id) errors.push(`${tag}: sourceRef pointer tail must equal entity id`);
    if (er && er.pointer.split('/').pop() !== entity.id) errors.push(`${tag}: sourceEffectRef pointer tail must equal entity id`);
  } else {
    if (item.sourceRef != null || item.sourceEffectRef != null) errors.push(`${tag}: original items must not carry native refs (no fabricated ids)`);
    if (typeof item.iconId !== 'string' || !item.iconId.trim()) errors.push(`${tag}: original icon plan required`);
    if (item.track !== 'leader' || item.rarity !== 'starter') errors.push(`${tag}: original content only allowed for leader starter`);
    if (!LEADER_CHARS[item.leaderCharId]) errors.push(`${tag}: leaderCharId must be one of the three leaders`);
    else seenLeader.add(item.leaderCharId);
  }
  if (item.rarity === 'starter' && item.track !== 'leader') errors.push(`${tag}: starter rarity only for leader`);
  if (item.track === 'leader' && !item.leaderCharId) errors.push(`${tag}: leader item needs leaderCharId`);
  if (item.track !== 'leader' && item.leaderCharId != null) errors.push(`${tag}: leaderCharId only on leader starter`);
  const text = JSON.stringify(item);
  if (/待设计|TBD|TODO|占位|尚未决定/.test(text)) errors.push(`${tag}: unresolved placeholder`);
}

if (!partial) {
  if (items.length !== 72) errors.push(`expected 72 items, got ${items.length}`);
  for (const t of TRACKS) {
    const group = items.filter(i => i.track === t);
    if (group.length !== 6) errors.push(`track ${t} expected 6, got ${group.length}`);
    for (const [r, n] of Object.entries(TRACK_RARITY)) if (group.filter(i => i.rarity === r).length !== n) errors.push(`track ${t} rarity ${r} expected ${n}`);
  }
  const cross = items.filter(i => i.track === 'cross');
  if (cross.length !== 9) errors.push(`cross expected 9, got ${cross.length}`);
  if (cross.some(i => i.rarity === 'starter')) errors.push('cross items must not be starter');
  const leader = items.filter(i => i.track === 'leader');
  if (leader.length !== 3) errors.push(`leader expected 3, got ${leader.length}`);
  if (seenLeader.size !== 3) errors.push('each of the three leaders must have exactly one starter item');
}

function renderMarkdown(design) {
  const order = [...TRACKS, 'cross', 'leader'];
  const rank = { common: 1, rare: 2, epic: 3, starter: 0 };
  const lines = [];
  lines.push('# 进击首发收藏品完整池（72 件）', '');
  lines.push(`本文件由 \`tools/assault/check-collectibles-design.mjs --render\` 从 \`data/assault-design/collectibles.json\` 确定性生成，请勿手改。`, '');
  lines.push(design.note ?? '', '');
  lines.push('| 路线 | 普通 | 稀有 | 珍贵 | 合计 |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const t of TRACKS) {
    const g = design.items.filter(i => i.track === t);
    lines.push(`| ${t} | ${g.filter(i => i.rarity === 'common').length} | ${g.filter(i => i.rarity === 'rare').length} | ${g.filter(i => i.rarity === 'epic').length} | ${g.length} |`);
  }
  const cross = design.items.filter(i => i.track === 'cross');
  const leader = design.items.filter(i => i.track === 'leader');
  lines.push(`| cross | ${cross.filter(i => i.rarity === 'common').length} | ${cross.filter(i => i.rarity === 'rare').length} | ${cross.filter(i => i.rarity === 'epic').length} | ${cross.length} |`);
  lines.push(`| leader | | | | ${leader.length}（starter）|`);
  lines.push(`| **合计** | | | | **${design.items.length}** |`, '');
  lines.push('货币账目约定：gold=整局金币（无利息），dp=本战斗部署点数（最低 0），xp=科技经验，hp=行动生命。技力费用最低 0.5；加速指自然技力回复额外 +100%；充能按实际净入账。', '');
  for (const t of order) {
    const group = design.items.filter(i => i.track === t).sort((a, b) => rank[a.rarity] - rank[b.rarity] || (a.id < b.id ? -1 : 1));
    if (!group.length) continue;
    lines.push(`## 路线 ${t}`, '');
    for (const it of group) {
      lines.push(`### ${it.name}（\`${it.id}\`）— ${it.rarity}`, '');
      lines.push(`- 来源状态：${it.sourceStatus}；解锁日：第 ${it.unlockDay} 天`);
      lines.push(`- 图标：\`${it.iconId}\``);
      if (it.track === 'leader') lines.push(`- 领袖：${it.leaderCharId}`);
      lines.push(`- 获取：${it.acquisition.map(a => a.type + (a.pool ? `(${a.pool})` : '') + (a.source ? `(${a.source})` : '') + (a.charId ? `(${a.charId})` : '')).join('、')}`);
      if (it.sourceRef) lines.push(`- 原生条目：\`${it.sourceRef.pointer}\``);
      if (it.sourceEffectRef) lines.push(`- 原生黑板：\`${it.sourceEffectRef.pointer}\``);
      if (it.nativeUsage) lines.push(`- 原生用途（内部）：${it.nativeUsage}`);
      lines.push(`- 转译理由：${it.adaptationReason}`);
      lines.push(`- 描述：${it.description}`);
      lines.push('- 效果：');
      for (const e of it.effects) {
        lines.push(`  - trigger=\`${e.trigger}\` action=\`${e.action}\` lifecycle=\`${e.lifecycle}\``);
        lines.push(`    - target：team=${e.target.team}，selection=${e.target.selection}，geometry=${e.target.geometry}${e.target.radius ? `(radius=${e.target.radius})` : ''}，count=${e.target.count}`);
        lines.push(`    - params：\`${JSON.stringify(e.params)}\``);
        lines.push(`    - condition：\`${JSON.stringify(e.condition)}\``);
        lines.push(`    - stacking：同源=${e.stacking.same}；异源=${e.stacking.cross}`);
        lines.push(`    - limits：${e.limits === null ? 'null（不限）' : JSON.stringify(e.limits)}`);
        lines.push(`    - ${e.description}`);
      }
      lines.push('- 因果检查：');
      for (const c of it.causalChecks) lines.push(`  - 场景：${c.scenario} → 预期：${c.expect}`);
      lines.push(`- 实现计划：events=[${it.implementationPlan.events.join(', ')}]；primitives=[${it.implementationPlan.primitives.join(', ')}]`);
      lines.push(`  - ${it.implementationPlan.note}`);
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}

let rendered = false;
if (args.includes('--render') && !errors.length && design.items.length === 72) {
  fs.writeFileSync(output, renderMarkdown(design), 'utf8');
  rendered = true;
}

console.log(JSON.stringify({ file: target, output: rendered ? output : null, partial, total: items.length, tracks: counts.track, rarities: counts.rarity, rendered, ok: !errors.length, errors }, null, 1));
process.exitCode = errors.length ? 1 : 0;
