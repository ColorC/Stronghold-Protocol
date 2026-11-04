#!/usr/bin/env node
// Card face compatibility gate. New cards use bazaar-adaptation.md; the older
// checks below apply only to cards which have not yet been migrated.
// Reads the compiled public text (what players see) plus the card sources for
// declared links, and the runtime DTO for the real skill cost.
//
// usage: node tools/assault/check-bazaar-style.mjs [--public-text <abs>] [--runtime <abs>] [--family assault|ranged|support] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LIMITS = Object.freeze({ line: 30, lines: 3, collectible: 40, minLinkRatio: 0.6 });

// Do not count ASCII spaces or full-width punctuation; Han, digits, %, +/- count 1 each.
const PUNCT = new Set('，。、；：（）「」！？');
export const clen = (text) => [...String(text ?? '')].filter((ch) => ch !== ' ' && !PUNCT.has(ch)).length;

export const BANNED = ['同名刷新', '整次施法', '判定', '取较', '结算', '叠加', '计数', '刷新', '冷却', '口径', '部署费用', '屏障',
  '一次盾', '技力满', '回复', '恢复', '持续到战斗结束', '概率', '倍率', '进击', '天赋', '同名', '共用',
  '重复触发', '溢出', '入账', '实付', '原生', '整场只', '不叠'];
const BANNED_RE = [/每 ?\d+(\.\d+)? ?秒最多/, /技力(?!\s*-)/, /\d+%\s*\/\s*\d+%/];

// keyword -> accepted sentence patterns (vocabulary table of the standard)
export const VOCAB = {
  加速: [/加速[^。；，]{0,14}，持续 ?[\d.]+ ?秒/g, /(被|获得)加速/g],
  充能: [/充能 ?[\d.]+/g, /(被|获得)充能/g],
  所需技力: [/所需技力 ?[-+][\d.]+/g],
  费用: [/获得 ?[\d.]* ?费用/g, /所需费用 ?[-+][\d.]+/g, /所需费用的 ?[\d.]+%/g, /费用最高/g, /支付 ?[\d.]+ ?费用/g],
  减速: [/减速[^。；，]{0,14}，持续 ?[\d.]+ ?秒/g, /(被|获得)减速/g],
  寒冷: [/[\d.]+ ?秒寒冷/g, /(获得|施加)寒冷/g, /寒冷或冻结/g, /寒冷的敌人/g],
  冻结: [/[\d.]+ ?秒冻结/g, /(获得|施加)(寒冷或)?冻结/g, /寒冷或冻结/g, /冻结的敌人/g, /被冻结/g],
  再生: [/[\d.]+ ?再生/g],
  暴击: [/[\d.]+% ?暴击率/g, /暴击时/g],
  损伤: [/(施加 ?[\d.%]+ ?)?(灼燃|凋亡|神经|侵蚀)损伤/g, /元素损伤/g],
  本场战斗: [/本场战斗(?:中|内)/g],
  本局游戏内: [/本局游戏内/g],
  几率: [/[\d.]+% ?几率/g],
};
const POSITION_WORDS = ['相邻', '周围', '前方', '左右', '攻击范围内'];
const PROFS = ['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'];

function vocabErrors(text) {
  const errors = [];
  for (const [word, patterns] of Object.entries(VOCAB)) {
    let at = text.indexOf(word);
    while (at >= 0) {
      const covered = patterns.some((pattern) => [...text.matchAll(pattern)].some((m) => m.index <= at && at < m.index + m[0].length));
      if (!covered) errors.push(`关键词「${word}」写法不在词表句式内`);
      at = text.indexOf(word, at + word.length);
    }
  }
  return errors;
}

function bannedErrors(text) {
  const scrubbed = text.replaceAll('商店刷新', '');
  return [...BANNED.filter((word) => scrubbed.includes(word)).map((word) => `禁用词「${word}」`),
    ...BANNED_RE.filter((re) => re.test(text)).map((re) => `禁用写法 ${re}`)];
}

// Synergy cards (design of 2026-10-21, docs: .omni/tmp/assault/ak-synergy/design-spec.md): the 10-20 bazaar wording
// rules (30 字, 3 行, 词表句式) were withdrawn by the user; what stays is what the design specifies for every card.
const SELF_EVENTS = new Set(['skillReady', 'static', 'aura', 'deployed', 'redeploy']);
function synergyCardErrors({ who, card, source, body, passive }) {
  const errors = [];
  if (!passive) {
    if (!Array.isArray(card.sp) || card.sp.length !== 4) errors.push(`${who}: 技力需四档`);
    else if (body && JSON.stringify(card.sp) !== JSON.stringify(body.fixedSkill.spCosts)) errors.push(`${who}: 卡面技力 ${card.sp.join('/')} 与实际 ${body.fixedSkill.spCosts?.join('/')} 不一致`);
    if (!card.lines.some((line) => line.kind === 'skill')) errors.push(`${who}: 缺技能行`);
  }
  if (!card.lines.some((line) => line.kind === 'deploy')) errors.push(`${who}: 缺部署时行`);
  let linked = false;
  card.lines.forEach((line, index) => {
    const where = `${who} 第${index + 1}行`;
    for (const [key, values] of Object.entries(line.params)) if (values.length !== 4 || values.some((x) => x == null)) errors.push(`${where}: 参数 ${key} 需四档数值`);
    line.textByStar.forEach((text, star) => { if (text == null) errors.push(`${where} ${star + 1}★: 无文字`); });
    const text = line.textByStar[3] ?? '';
    if(source.lines[index]?.suppressed)return;
    if (/char_|uniequip_|skchr_|\{\w+\}/.test(text)) errors.push(`${where}: 卡面含内部 ID 或未填参数：${text}`);
    if (line.kind === 'growth' && !(text.includes('本局游戏内') || text.includes('跨战斗生效'))) errors.push(`${where}: 成长行须说明跨战斗生效：${text}`);
    if (line.kind === 'stack' && !text.includes('本场战斗内')) errors.push(`${where}: 本场效果须说明「本场战斗内」：${text}`);
    const trigger = source.lines[index]?.trigger;
    const subject = trigger?.subject ?? 'self';
    if (trigger?.event && !SELF_EVENTS.has(String(trigger.event).split(':')[0]) && subject !== 'self') linked = true;
  });
  for (const [moduleId, module] of Object.entries(card.modules)) {
    if (!(body?.modulePlans ?? []).some((m) => m.id === moduleId) && body) errors.push(`${who} 模组 ${module.name}: 不是该干员的模组`);
    if (module.line) for (const star of [2, 3]) if (module.line.textByStar[star] == null) errors.push(`${who} 模组 ${module.name}: ${star + 1}★ 无文字`);
  }
  return { errors, linked };
}

const spOrdered = (sp) => sp.every((x, i) => i === 0 || x <= sp[i - 1]) || sp.every((x, i) => i === 0 || x >= sp[i - 1]);

export function checkBazaarStyle({ publicText, runtime, sources, collectibleSources, family = null }) {
  const errors = [];
  if(JSON.stringify(publicText).includes('永久'))errors.push('卡面须写秒数、本场战斗内或本局游戏内，不使用“永久”关键词');
  const warnings = [];
  const typeWords = new Set([...PROFS, '召唤物', '装置']);
  const cardsById = new Map();
  for (const source of sources) for (const card of source.operators) {
    cardsById.set(card.id, { ...card, family: source.family });
    for (const z of [card.branch, card.nation, card.group, card.team]) if (z) { typeWords.add(z); typeWords.add(z.replace('炎-', '')); typeWords.add(z.replace('罗德岛-', '')); }
  }
  const operatorIds = Object.keys(publicText.operators);
  const missing = operatorIds.filter((id) => !publicText.operators[id].card || !cardsById.has(id));
  if (missing.length) errors.push(`卡面覆盖缺 ${missing.length}：${missing.slice(0, 10).join(',')}`);
  let linked = 0, total = 0;
  const lengths = [];
  for (const id of operatorIds) {
    const card = publicText.operators[id].card;
    const source = cardsById.get(id);
    if (!card || !source || (family && source.family !== family)) continue;
    total++;
    const who = `${publicText.operators[id].name}[${id}]`;
    const body = runtime?.bodies?.[id];
    const passive = body ? body.fixedSkill?.kind === 'passive' : source.skillKind === 'passive';
    if (body?.adaptation) {
      if (card.lines.length < 1 || card.lines.length > 3) errors.push(`${who}: 新稿卡面须1–3行`);
      if (!passive && JSON.stringify(card.sp) !== JSON.stringify(body.fixedSkill.spCosts)) errors.push(`${who}: 新稿卡面技力不一致`);
      for (const line of card.lines) for (const text of line.textByStar) {
        if ([...text].length > 32) errors.push(`${who}: 新稿卡面每行至多32字`);
        if (/每\s*[\d.]+\s*秒(?:最多|至多)|重复施放结算/.test(text)) errors.push(`${who}: 新稿禁止旧限频或重复结算文案`);
      }
      if (Number.isInteger(body.adaptation.sourceTalent)) linked++;
      continue;
    }
    if (source.format === 'synergy') {
      const result = synergyCardErrors({ who, card, source, body, passive });
      errors.push(...result.errors);
      if (result.linked) linked++;
      continue;
    }
    if (card.lines.length < 1 || card.lines.length > LIMITS.lines) errors.push(`${who}: 首屏 ${card.lines.length} 行（上限 ${LIMITS.lines}）`);
    if (!passive) {
      if (card.lines[0]?.kind !== 'active') errors.push(`${who}: 主动行必须在第 1 行`);
      if (!Array.isArray(card.sp) || card.sp.length !== 4) errors.push(`${who}: 技力需四档`);
      else {
        if (!spOrdered(card.sp)) errors.push(`${who}: 技力四档乱序 ${card.sp.join('/')}`);
        if (body && JSON.stringify(card.sp) !== JSON.stringify(body.fixedSkill.spCosts)) errors.push(`${who}: 卡面技力 ${card.sp.join('/')} 与实际 ${body.fixedSkill.spCosts?.join('/')} 不一致`);
      }
    } else if (card.sp != null) errors.push(`${who}: 被动形态不显示技力`);
    if (card.lines.filter((line) => line.kind === 'active').length > 1) errors.push(`${who}: 主动行超过 1 行`);
    let opLinked = false;
    card.lines.forEach((line, index) => {
      const where = `${who} 第${index + 1}行`;
      for (const [key, values] of Object.entries(line.params)) if (values.length !== 4 || values.some((x) => x == null)) errors.push(`${where}: 参数 ${key} 需四档数值`);
      line.textByStar.forEach((text, star) => {
        if (text == null) { errors.push(`${where} ${star + 1}★: 无文字`); return; }
        if (star === 3) lengths.push(clen(text));
        if (clen(text) > LIMITS.line) errors.push(`${where} ${star + 1}★: ${clen(text)} 字 > ${LIMITS.line}：${text}`);
      });
      const text = line.textByStar[3] ?? '';
      for (const e of [...bannedErrors(text), ...vocabErrors(text)]) errors.push(`${where}: ${e}：${text}`);
      if (line.kind === 'active' && text.startsWith('当')) errors.push(`${where}: 主动行应以动作开头：${text}`);
      if (line.kind === 'trigger' && !text.startsWith('当') && !text.startsWith('每场战斗')) warnings.push(`${where}: 扳机行建议以「当……时」开头：${text}`);
      if (line.kind === 'trigger' && /本场战斗(?:中|内)|永久/.test(text) && !/最多|每场战斗前|每场战斗首次/.test(text)) errors.push(`${where}: 成长扳机须写上限（最多 N 层／每场战斗前 N 次）：${text}`);
      const link = source.lines[index]?.link;
      if (link) {
        if (link === 'position' && !POSITION_WORDS.some((w) => text.includes(w))) errors.push(`${where}: 声明位置联动但文字无位置词：${text}`);
        if (link === 'type' && ![...typeWords].some((w) => text.includes(w))) errors.push(`${where}: 声明类型联动但文字无类型词：${text}`);
        if (link === 'event' && !(text.includes('当') && !/^当此干员/.test(text))) errors.push(`${where}: 声明事件联动但主体不是其他单位：${text}`);
        opLinked = true;
      }
    });
    if (opLinked) linked++;
    for (const [moduleId, module] of Object.entries(card.modules)) {
      const where = `${who} 模组 ${module.name}`;
      if (!(body?.modulePlans ?? []).some((m) => m.id === moduleId) && body) errors.push(`${where}: 不是该干员的模组`);
      if (!module.line) continue;
      for (const star of [2, 3]) {
        const text = module.line.textByStar[star];
        if (text == null) { errors.push(`${where}: ${star + 1}★ 无文字`); continue; }
        if (!text.startsWith(`${module.name}：`)) errors.push(`${where}: 模组行须以「模组名：」开头：${text}`);
        const rest = text.includes('：') ? text.split('：').slice(1).join('：') : text;
        if (clen(rest) > LIMITS.line) errors.push(`${where} ${star + 1}★: 正文 ${clen(rest)} 字 > ${LIMITS.line}：${text}`);
      }
      const text = module.line.textByStar[3] ?? '';
      const rest = text.includes('：') ? text.split('：').slice(1).join('：') : text;
      for (const e of [...bannedErrors(rest), ...vocabErrors(rest)]) errors.push(`${where}: ${e}：${text}`);
    }
  }
  if (!family) {
    const collectibleIds = Object.keys(publicText.collectibles);
    const lineless = collectibleIds.filter((id) => !publicText.collectibles[id].line);
    if (lineless.length) errors.push(`收藏品卡面缺 ${lineless.length}：${lineless.slice(0, 10).join(',')}`);
    const sourceIds = new Set(collectibleSources.collectibles.map((item) => item.id));
    const extra = [...sourceIds].filter((id) => !collectibleIds.includes(id));
    if (extra.length) errors.push(`收藏品卡面多出 ${extra.length}：${extra.slice(0, 10).join(',')}`);
    for (const id of collectibleIds) {
      const text = publicText.collectibles[id].line;
      if (!text) continue;
      const where = `收藏品 ${publicText.collectibles[id].name}[${id}]`;
      if (clen(text) > LIMITS.collectible) errors.push(`${where}: ${clen(text)} 字 > ${LIMITS.collectible}：${text}`);
      for (const e of [...bannedErrors(text), ...vocabErrors(text)]) errors.push(`${where}: ${e}：${text}`);
    }
  }
  const ratio = total ? linked / total : 0;
  if (!family && ratio < LIMITS.minLinkRatio) errors.push(`跨干员联动形态占比 ${(ratio * 100).toFixed(1)}% < ${LIMITS.minLinkRatio * 100}%`);
  return { operators: total, linked, ratio, lines: lengths.length, averageLength: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
    longest: lengths.length ? Math.max(...lengths) : 0, warnings, errors };
}

function main(argv) {
  const options = { publicText: path.join(ROOT, 'data/assault-public-text.json'), runtime: path.join(ROOT, 'data/assault-runtime.json'), family: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--json') { options.json = true; continue; }
    const value = argv[++i];
    if (key === '--family' && ['assault', 'ranged', 'support'].includes(value)) options.family = value;
    else if ((key === '--public-text' || key === '--runtime') && value && path.isAbsolute(value)) options[key === '--runtime' ? 'runtime' : 'publicText'] = value;
    else { console.error('usage: node tools/assault/check-bazaar-style.mjs [--public-text <abs>] [--runtime <abs>] [--family assault|ranged|support] [--json]'); return 2; }
  }
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = checkBazaarStyle({
    publicText: read(options.publicText), runtime: read(options.runtime),
    sources: ['assault', 'ranged', 'support'].map((family) => read(path.join(ROOT, `data/assault-design/bazaar-cards-${family}.json`))),
    collectibleSources: read(path.join(ROOT, 'data/assault-design/bazaar-collectibles.json')), family: options.family,
  });
  if (options.json) console.log(JSON.stringify({ ...options, ...result }));
  else {
    console.log(`卡面 ${result.operators}${options.family ? `（${options.family}）` : ''}；联动 ${result.linked}/${result.operators} = ${(result.ratio * 100).toFixed(1)}%；4★效果行 ${result.lines} 条，平均 ${result.averageLength.toFixed(1)} 字，最长 ${result.longest} 字`);
    for (const w of result.warnings.slice(0, 20)) console.log('提示', w);
    if (result.errors.length) { console.log(`未通过：${result.errors.length} 项`); for (const e of result.errors.slice(0, 300)) console.log(' -', e); }
    else console.log('通过');
  }
  return result.errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
