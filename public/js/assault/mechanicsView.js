import { pieceRecord } from './model.js';
import { N_, t } from '../../../shared/i18n.js';
import { RUN_CARD_GROWTH, runGrowthPoints } from '../../../shared/assault/growth-policy.js';

const SKILL_FALLBACK = N_('技能');
const PASSIVE_FALLBACK = N_('被动');
const ORIGINAL_SKILL_COST = N_('技力消耗{cost}，初始技力{init}。');

function clean(value) {
  const source = String(value || '').split(/\s*星级变化[:：]/)[0].trim().replace(/^[:：]\s*/, '');
  return String(t(source)).trim();
}

// A current-star value replaces only explicit four-value progressions; full authored text stays available.
export function currentStarText(value, star) {
  const index = Math.max(0, Math.min(3, (Number(star) || 1) - 1));
  return clean(value).replace(/[+-]?\d+(?:\.\d+)?(?:%|秒|点|次|发|倍)?(?:\/[+-]?\d+(?:\.\d+)?(?:%|秒|点|次|发|倍)?){3}/g,
    values => selectProgression(values, index));
}

function selectProgression(values, index) {
      const levels = values.split('/');
      let selected = levels[Math.min(index, levels.length - 1)];
      // Authors may write a shared sign/unit only once: -8/10/12/15%.
      if (/^[+-]/.test(levels[0]) && levels.slice(1).every(level => !/^[+-]/.test(level)) && !/^[+-]/.test(selected))
        selected = levels[0][0] + selected;
      const unit=levels.at(-1).match(/(%|秒|点|次|发|倍)$/)?.[1];
      if (unit && levels.slice(0,-1).every(level=>!/(%|秒|点|次|发|倍)$/.test(level)) && !selected.endsWith(unit))
        selected += unit;
      return selected;
}

/** Resolve authored rank progressions without showing values below a design's starting rank. */
export function strategySkillText(skill, rank) {
  if (!skill) return '';
  const start = Math.max(1, Math.min(4, Number(skill.startingStar) || 1));
  const current = Math.max(start, Math.min(4, Number(rank) || start));
  const count = 4 - start + 1;
  const pattern = new RegExp(`[+-]?\\d+(?:\\.\\d+)?%?(?:\\/[+-]?\\d+(?:\\.\\d+)?%?){${count - 1}}`, 'g');
  return clean(skill.description).replace(pattern, values => selectProgression(values, current - start));
}

function shortText(value) {
  const text = clean(value);
  // Do not cut at the first semicolon: the second clause can be the cost,
  // duration, or trigger that makes this effect usable in a build.
  return text.replace(/^本效果[:：]/, '').replace(/该编入队伍阵营被动。?|个人再部署缩短。?$/, '').trim();
}

function usefulTalent(binding) {
  const translation = binding?.translation;
  return translation && translation.mode !== 'disabled' && translation.mode !== 'none'
    && !/^modePassive:/i.test(translation.runtimeBinding || '')
    && !/空.*槽|隐蔽天赋槽|没有额外效果|无效果的空/.test(`${translation.name || ''} ${binding.nativeTalent?.name || ''} ${translation.description || ''}`);
}

export function operatorMechanics(catalog, piece) {
  const body = pieceRecord(catalog, piece);
  if (!body) return { role: '', skill: null, passives: [], original: { skills: [], talents: [] }, notes: [] };
  const text = catalog.publicText?.operators?.[piece.charId] || {};
  const fixed = body.fixedSkill;
  const skillDescription = clean(text.skill?.description || fixed?.description);
  const effects = (fixed?.effects || []).map(effect => effect.description).filter(Boolean);
  const skillSummary = currentStarText(text.skill?.summary || (effects.length ? effects.join('\n') : fixed?.description || text.skill?.description), piece.star);
  const skill = fixed ? { id: fixed.sourceSkillId, name: t(text.skill?.name || fixed.name || SKILL_FALLBACK),
    kind: fixed.kind, description: skillDescription, summary: skillSummary,
    lines: skillSummary.split('\n').filter(Boolean) } : null;
  const retained = (body.talentBindings || []).filter(usefulTalent).map(binding => {
    const translation = binding.translation;
    const sourceName = translation.name || binding.nativeTalent?.name;
    const copy = (text.talents || []).find(talent => talent.name === sourceName || talent.name === binding.nativeTalent?.name);
    const name = t(copy?.name || sourceName || PASSIVE_FALLBACK);
    const description = clean(copy?.description || translation.description);
    return { name, category: translation.mode === 'rewrite' ? 'mode' : 'retained', trigger: '', unlockStar: translation.unlockStar ?? 1,
      description, summary: currentStarText(copy?.summary || shortText(description), piece.star) };
  });
  const passives = (body.modePassives || []).map((passive, index) => {
    const copy = text.modePassives?.[index];
    const description = clean(copy?.description || passive.description);
    const binding = (body.talentBindings || []).find(entry => entry.translation?.runtimeBinding === `modePassive:${index}`);
    return { name: t(copy?.name || PASSIVE_FALLBACK), category: binding?.translation?.mode === 'retain' ? 'retained' : 'mode', trigger: t(copy?.trigger || passive.trigger || ''),
      unlockStar: passive.unlockStar ?? passive.values?.unlockStar ?? 1,
      description, summary: currentStarText(copy?.summary || shortText(description), piece.star) };
  });
  const originalSource = text.original || {
    trait: body.source?.trait?.description || '',
    skills: (body.source?.skills || []).map(s => ({ name: s.name,
      description: s.description || t(ORIGINAL_SKILL_COST, { cost: s.spData?.spCost ?? '—', init: s.spData?.initSp ?? '—' }) })),
    talents: (body.source?.talents || []).filter(t => !t.hidden && t.name && !/空槽位/.test(t.name))
      .map(t => ({ name: t.name, description: t.description || '' })),
  };
  const original = { ...originalSource,
    trait: t(originalSource.trait || ''),
    skills: (originalSource.skills || []).map(entry => ({ ...entry, name: t(entry.name || ''), description: t(entry.description || '') })),
    talents: (originalSource.talents || []).map(entry => ({ ...entry, name: t(entry.name || ''), description: t(entry.description || '') })),
  };
  // Some native-mechanism adapters expose the same converted talent through both
  // bindings and modePassives. Show its authored numerical summary once.
  const converted = passives.map(passive => {
    const binding = retained.find(entry => entry.category === 'mode' && entry.name === passive.name);
    return binding ? { ...passive, summary: binding.summary, description: binding.description } : passive;
  });
  const bindings = retained.filter(entry => entry.category !== 'mode' || !passives.some(passive => passive.name === entry.name));
  const adapted = body.adaptation ? (text.innates ?? body.adaptation.innates ?? []).map(description => ({
    name: t(PASSIVE_FALLBACK), category: 'retained', trigger: '', unlockStar: 1,
    description: t(description), summary: t(description),
  })) : null;
  return { role: t(text.role || ''), skill, passives: adapted ?? [...converted, ...bindings], original, notes: [] };
}

const own = (value, key) => Object.hasOwn(value ?? {}, key);

function list(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function copy(value) {
  return value == null ? null : structuredClone(value);
}

function rankText(description, startingStar, rank) {
  const count = 4 - startingStar + 1;
  if (count <= 1) return String(description || '').trim();
  const progression = new RegExp(`([+-]?\\d+(?:\\.\\d+)?%?(?:\\/[+-]?\\d+(?:\\.\\d+)?%?){${count - 1}})`, 'g');
  return String(description || '').replace(progression, (values) => {
    const levels = values.split('/');
    let selected = levels[rank - startingStar];
    if (/^[+-]/.test(levels[0]) && levels.slice(1).every((level) => !/^[+-]/.test(level)) && !/^[+-]/.test(selected)) {
      selected = levels[0][0] + selected;
    }
    if (levels.at(-1).endsWith('%') && levels.slice(0, -1).every((level) => !level.endsWith('%')) && !selected.endsWith('%')) {
      selected += '%';
    }
    return selected;
  }).trim();
}

/** Build the single public definition set for collectibles and ranked strategy skills. */
export function collectionSkillDefinitions({ collectibles, strategySkills }) {
  const items = list(collectibles, 'collectibles');
  const skills = list(strategySkills, 'strategySkills');
  const definitions = [
    ...items.map((item) => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string') {
        throw new TypeError('collectible definition requires id and name');
      }
      return {
        id: item.id,
        kind: 'collectible',
        name: item.name,
        description: String(item.description || ''),
        tier: item.rarity ?? null,
        iconSource: { kind: 'collectible', id: item.iconId ?? item.id },
        source: { kind: 'acquisition', rules: copy(item.acquisition) },
        startingStar: null,
      };
    }),
    ...skills.map((skill) => {
      if (!skill || typeof skill.id !== 'string' || !skill.id || typeof skill.name !== 'string') {
        throw new TypeError('strategy skill definition requires id and name');
      }
      const startingStar = skill.startingStar ?? 1;
      if (!Number.isInteger(startingStar) || startingStar < 1 || startingStar > 4) {
        throw new TypeError(`invalid startingStar for ${skill.id}`);
      }
      return {
        id: skill.id,
        kind: 'ranked-skill',
        name: skill.name,
        description: String(skill.description || ''),
        tier: 'ranked',
        iconSource: { kind: 'strategy-skill', icon: copy(skill.icon) },
        source: { kind: 'upgrade', sourceRef: copy(skill.sourceRef), startingStar },
        startingStar,
      };
    }),
  ];
  const seen = new Set();
  for (const definition of definitions) {
    if (seen.has(definition.id)) throw new TypeError(`duplicate collection skill id: ${definition.id}`);
    seen.add(definition.id);
  }
  return definitions;
}

/** Project legacy save fields into one read-only owned/passive card list. */
export function projectCollectionSkills(design, state = {}) {
  const definitions = collectionSkillDefinitions({
    collectibles: design?.collectibles?.items,
    strategySkills: design?.system?.strategySkills,
  });
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const relicIds = list(state.relicIds ?? [], 'state.relicIds');
  const skillRanks = state.skillRanks ?? {};
  if (!skillRanks || typeof skillRanks !== 'object' || Array.isArray(skillRanks)) {
    throw new TypeError('state.skillRanks must be an object');
  }
  const relicSet = new Set();
  for (const id of relicIds) {
    if (!byId.has(id) || byId.get(id).kind !== 'collectible') throw new TypeError(`unknown collectible id: ${id}`);
    if (relicSet.has(id)) throw new TypeError(`duplicate owned collectible id: ${id}`);
    relicSet.add(id);
  }
  for (const id of Object.keys(skillRanks)) {
    if (!byId.has(id) || byId.get(id).kind !== 'ranked-skill') throw new TypeError(`unknown strategy skill id: ${id}`);
  }

  return definitions.map((definition) => {
    if (definition.kind === 'collectible') return { ...definition, owned: relicSet.has(definition.id), rank: null };
    const rank = own(skillRanks, definition.id) ? skillRanks[definition.id] : 0;
    if (!Number.isInteger(rank) || rank < 0 || rank > 4 || (rank > 0 && rank < definition.startingStar)) {
      throw new TypeError(`invalid strategy skill rank for ${definition.id}: ${rank}`);
    }
    return {
      ...definition,
      description: rank === 0 ? '' : rankText(definition.description, definition.startingStar, rank),
      owned: rank > 0,
      rank,
      tier: rank,
    };
  });
}

// Bazaar-style card face (docs/assault-mode/bazaar-skill-style.md): the public
// card text is compiled from the same four-star params the card's runtime reads.
// Keywords of the standard's vocabulary are highlighted with an icon; longer
// words first so 「暴击率」 wins over 「暴击」.
export const CARD_KEYWORDS = Object.freeze([
  [N_('所需技力'), 'hourglass'], [N_('加速'), 'chevrons'], [N_('充能'), 'bolt'], [N_('减速'), 'chevronLeft'],
  [N_('寒冷'), 'snow'], [N_('冻结'), 'snow'], [N_('护盾'), 'shield'], [N_('治疗'), 'plus'], [N_('再生'), 'plus'],
  [N_('灼燃损伤'), 'target'], [N_('凋亡损伤'), 'target'], [N_('神经损伤'), 'target'], [N_('侵蚀损伤'), 'target'],
  [N_('元素损伤'), 'target'], [N_('暴击率'), 'sword'], [N_('暴击'), 'sword'], [N_('费用'), 'dp'],
  [N_('再部署'), 'refresh'], [N_('本场战斗中'), 'flag'],
]);

/** Split a card line into plain text and highlighted vocabulary keywords. */
export function keywordSegments(text) {
  const source = String(text ?? '');
  const words = CARD_KEYWORDS.map(([word, icon]) => [t(word), icon]).filter(([word]) => word).sort((a, b) => b[0].length - a[0].length);
  const segments = [];
  let plain = '';
  for (let i = 0; i < source.length;) {
    const hit = words.find(([word]) => source.startsWith(word, i));
    if (hit) {
      if (plain) segments.push({ text: plain });
      plain = '';
      segments.push({ text: hit[0], icon: hit[1] });
      i += hit[0].length;
    } else { plain += source[i]; i += 1; }
  }
  if (plain) segments.push({ text: plain });
  return segments;
}

function tierSegments(template, params, current) {
  return String(template || '').split(/(\{\w+\})/).filter(Boolean).map((part) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    const values = key ? params?.[key] : null;
    return Array.isArray(values) ? { tiers: values.map((value) => (value == null ? null : String(value))), current } : { text: part };
  });
}

/** The card face of an operator at its current star: type label, skill cost, effect lines and the chosen module line. */
export function bazaarCard(catalog, piece, moduleId = null) {
  const card = catalog?.publicText?.operators?.[piece?.charId]?.card;
  if (!card) return null;
  const star = Math.max(1, Math.min(4, Number(piece.star) || 1));
  const index = star - 1;
  const lineOf = (line) => ({ kind: line.kind, text: line.textByStar[index], tiers: tierSegments(line.template, line.params, index),
    ...(line.kind==='growth'&&RUN_CARD_GROWTH[piece.charId]?{growthPoints:runGrowthPoints(piece)}:{}) });
  const module = moduleId && star >= 3 ? card.modules?.[moduleId] : null;
  const body=catalog.runtime?.bodies?.[piece.charId],fixed=body?.fixedSkill,rawCharges=fixed?.maxCharges;
  const baseCharges=Array.isArray(rawCharges)?rawCharges[index]:rawCharges??1;
  const alias=body?.adaptation?.moduleAliases?.[moduleId]??moduleId;
  const upgrade=star>=3?body?.modulePlans?.find(m=>m.id===alias)?.adaptationUpgrade:null;
  return {
    star, typeLabel: card.typeLabel,
    charges:baseCharges+(upgrade?.key==='moduleStorage'?upgrade.value:0),
    ammo:body?.adaptation?.type==='D'?body.adaptation.ammo+(upgrade?.key==='moduleAmmo'?upgrade.value:0):null,
    sp: Array.isArray(card.sp) ? card.sp[index] : null,
    spTiers: Array.isArray(card.sp) ? tierSegments('{sp}', { sp: card.sp }, index) : null,
    lines: card.lines.map(lineOf).filter((line) => line.text),
    module: module?.line?.textByStar?.[index] ? { id: moduleId, name: module.name, ...lineOf(module.line) } : null,
  };
}

/** One module's line for the module chooser: the current star once unlocked, otherwise its three-star text. */
export function moduleCardText(catalog, piece, moduleId) {
  const module = catalog?.publicText?.operators?.[piece?.charId]?.card?.modules?.[moduleId];
  if (!module) return null;
  if (!module.line) return '';
  const star = Math.max(1, Math.min(4, Number(piece.star) || 1));
  return module.line.textByStar[Math.max(2, star - 1)] ?? module.line.textByStar[2] ?? '';
}
