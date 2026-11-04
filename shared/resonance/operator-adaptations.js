/**
 * Faction season 2 operator adaptations: the operators' own effects rewritten for this mode.
 *
 * Two kinds of change, both season-2 only (season-1 and Set 13 saves read their records unchanged):
 * - Rewritten effects that do nothing in this mode. Every battle starts with 20 部署费用 that refill at 1 per second up
 *   to 99 and only pay for the automatic redeploys, so no gain of 部署费用 and no 部署费用 reduction ever matters; they
 *   become 技力 for the team or a small economy effect. Redeploy time is real (a knocked-out operator comes back on its
 *   tile after its 再部署 time), so those effects stay. 贾维's 支援机械 bonus names a class the season has none of.
 * - Pilot adaptations in the manner of other auto-battlers: an economy hook (格拉尼), a position hook (见行者), a summon
 *   that grows with the stars (夕), a pact-count hook (银灰) and three-star skills that gain an effect (焰尾, 塞雷娅,
 *   玛恩纳). Each keeps the skill name, the skill's core and the class identity.
 *
 * `edits` rewrite the player-visible texts: `field` is 'trait', 'skill' (the record's skill text and the player skill
 * description) or 'talent:<index>'; `from` is the exact plain text and must be found in every star, `to` its
 * replacement (a function of the star for star-dependent numbers). The rich-text copy (`descRaw`) is matched with its
 * markup tags allowed anywhere inside `from`; `bb` overrides that field's blackboard (what the kit reads). `star3`
 * replaces the three-star passive and `keepStar3` keeps the old one as its additional effect; `dropStar3` removes it.
 * Battle behaviour: server/sim/content/resonance/operator-adaptations.js; economy: server/modes/resonance/session.js.
 */
const freeze = (value) => Object.freeze(value);

/** The transcription rules, in the order of the season design (docs/resonance/design.md). */
export const OPERATOR_ADAPTATION_RULES = freeze({
  dpToSp: '战斗中获得部署费用 → 为其他友方干员回复技力：一次性大量获得的给全体，频繁或逐渐获得的给周围8格，按技能频率换算',
  bounty: '击杀获得部署费用、撤退返还部署费用 → 击杀敌人获得金币，每场战斗有上限（经济试点）',
  mergeGold: '自身部署费用-N → 升星时获得N金币（不能降低招募价格，一费不能变成零费）',
  factionInitialSp: '某类干员部署费用-N → 这些干员的初始技力+N，类别换成本模式可见的盟约',
  factionScaling: '指向本季不存在的干员类别（支援机械）的加成 → 改为按自身阵营在场人数计算，并去掉其再部署部分',
  firstCastTeamSp: '三星“首次产生部署费用时额外获得5点” → 首次开启技能时为所有其他友方干员回复2点技力',
  returnStrike: '三星“首次再部署等待时间减半” → 写明实际效果：首次被击倒后再部署等待时间减半，重新部署时冲击周围8格的敌人',
  onField: '“编入队伍时” → “上阵时”（本模式只有上阵的干员参战）',
});

const FIRST_CAST_TEAM_SP = freeze({ kind: 'star3_first_cast_team_sp', params: freeze({ sp: 2 }),
  description: '本场首次开启技能时，额外为所有其他友方干员回复2点技力。' });
const RETURN_STRIKE = freeze({ kind: 'star3_return_strike', params: freeze({ timeMultiplier: 0.5, damage: 100 }),
  description: '本场首次被击倒后，再部署等待时间减半；重新部署时对周围8格内的敌人造成相当于攻击力100%的法术伤害。' });

export const OPERATOR_ADAPTATIONS = freeze({
  chess_native_char_240_wyvern_a: freeze({ name: '香草', rules: ['dpToSp', 'firstCastTeamSp'],
    dpToSp: freeze({ everyDp: 6, sp: 1, scope: 'all' }),
    edits: [{ field: 'skill', from: '获得6点部署费用，', to: '为所有其他友方干员回复1点技力，' }],
    star3: FIRST_CAST_TEAM_SP }),
  chess_native_char_349_chiave_a: freeze({ name: '贾维', rules: ['dpToSp', 'factionScaling', 'firstCastTeamSp'],
    dpToSp: freeze({ everyDp: 11, sp: 2, scope: 'around' }),
    factionScaling: freeze({ pact: 'risk', atkPct: 0.07, defPct: 0.07, max: 3 }),
    edits: [
      { field: 'skill', from: '立即获得11点费用；', to: '为周围8格内的友方干员回复2点技力；' },
      { field: 'talent:0', from: '在场时，所有【支援机械】干员的再部署时间-60%；场上每有一名【支援机械】干员，自身的攻击力和防御力+7%',
        to: '场上每有一名其他【叙拉古】干员，自身的攻击力和防御力+7%（至多叠加3次）' },
    ],
    star3: FIRST_CAST_TEAM_SP }),
  chess_native_char_4017_puzzle_a: freeze({ name: '谜图', rules: ['dpToSp', 'returnStrike'],
    dpToSp: freeze({ everyDp: 3, sp: 1, scope: 'around' }),
    edits: [{ field: 'skill', from: '，并获得3点部署费用', to: '，并为周围8格内的友方干员回复1点技力' }],
    star3: RETURN_STRIKE }),
  chess_char_4_19_a: freeze({ name: '焰尾', rules: ['dpToSp', 'pilot:star3'], pilot: 'star3',
    dpToSp: freeze({ everyDp: 2, sp: 1, scope: 'around' }),
    edits: [{ field: 'skill', from: '技能持续时间内逐渐获得8点部署费用，', to: '技能持续期间每2秒为周围8格内的友方干员回复1点技力，' }],
    star3: freeze({ kind: 'star3_flametail_stun', params: freeze({ stun: 0.5, targetCooldown: 3 }),
      description: '焰心期间触发闪避时，使攻击者晕眩0.5秒（同一敌人每3秒至多1次）。' }) }),
  chess_char_6_11_a: freeze({ name: '缪尔赛思', rules: ['dpToSp', 'factionInitialSp'],
    dpToSp: freeze({ everyDp: 13, sp: 2, scope: 'all' }),
    factionInitialSp: freeze({ pact: 'rhodes', sp: 2 }),
    edits: [
      { field: 'skill', from: '立即获得13点费用，', to: '为所有其他友方干员回复2点技力，' },
      { field: 'talent:1', from: '携带时【莱茵生命】干员部署费用-2，首名【莱茵生命】干员部署费用额外-1', to: '上阵时，所有【哥伦比亚】干员的初始技力+2' },
    ] }),
  chess_native_char_220_grani_a: freeze({ name: '格拉尼', rules: ['bounty', 'pilot:economy'], pilot: 'economy',
    bounty: freeze({ gold: 1, capByStar: freeze([1, 2, 3]) }),
    // the economy pays for a weaker body: 20% less health than the cost-1 frontline budget (her attack stays above the
    // DEF 300 floor that the season-2 reference DEF guarantees)
    budget: freeze({ hp: 0.8 }),
    edits: [{ field: 'trait', from: '击杀敌人后获得1点部署费用，撤退时返还初始部署费用',
      to: (star) => `击杀敌人后获得1金币，每场战斗至多获得${[1, 2, 3][star - 1]}金币` }],
    // the old star-three rider gave 部署费用; the three-star step of the bounty is its higher cap (the trait says it)
    dropStar3: true }),
  chess_char_2_12_a: freeze({ name: '砾', rules: ['mergeGold', 'returnStrike'],
    mergeGold: freeze({ gold: 1 }),
    edits: [{ field: 'talent:0', from: '自身部署费用-1', to: '升星时获得1金币' }],
    star3: RETURN_STRIKE }),
  chess_char_3_05_a: freeze({ name: '斯卡蒂', rules: ['onField'],
    edits: [{ field: 'talent:0', from: '编入队伍时，', to: '上阵时，' }] }),
  chess_char_6_18_a: freeze({ name: '荒芜拉普兰德', rules: ['onField'],
    edits: [{ field: 'talent:1', from: '编入队伍时', to: '上阵时，' }] }),
  chess_char_3_07_a: freeze({ name: '见行者', rules: ['pilot:position'], pilot: 'position',
    position: freeze({ adjacentAllies: 2, fragile: 0.2, duration: 6 }),
    edits: [{ field: 'skill', from: '若目标碰撞其他敌人，使其晕眩1.9秒。',
      to: '若目标碰撞其他敌人，使其晕眩1.9秒。周围8格内至少有2名友方干员时，被晕眩的敌人还会获得20%的脆弱效果，持续6秒。' }] }),
  chess_char_5_12_a: freeze({ name: '夕', rules: ['pilot:summon'], pilot: 'summon',
    summon: freeze({ durationByStar: freeze([25, 45, null]), resummon: 1 }),
    edits: [{ field: 'talent:1', from: '部署后首次攻击敌人时，在目标位置（可部署地面）召唤一个“小自在”（持续25秒）',
      to: (star) => star >= 3
        ? '开战后首次攻击敌人时，在目标位置（没有空的可部署地面时为离目标最近的可部署地面）召唤一个“小自在”，“小自在”不会消失'
        : `开战后首次攻击敌人时，在目标位置（没有空的可部署地面时为离目标最近的可部署地面）召唤一个“小自在”（持续${star === 2 ? 45 : 25}秒）` }],
    star3: freeze({ kind: 'star3_dusk_lasting', params: freeze({ resummon: 1 }),
      description: '“小自在”被击倒后，夕的下一次攻击重新召唤一个（每场战斗1次）。' }), keepStar3: true }),
  chess_char_4_22_a: freeze({ name: '银灰', rules: ['pilot:pact'], pilot: 'pact',
    factionAspd: freeze({ pact: 'creation', aspd: 5, max: 4 }),
    edits: [{ field: 'talent:0', from: '攻击力+10%，编入队伍时所有我方单位的再部署时间-10%',
      to: '攻击力+10%；场上每有一名其他【谢拉格】干员，攻击速度+5（至多+20）', bb: { respawn_time: 0 } }] }),
  chess_char_5_11_a: freeze({ name: '塞雷娅', rules: ['pilot:star3'], pilot: 'star3',
    star3: freeze({ kind: 'star3_saria_calcify', params: freeze({ slow: 0.3, artsFragile: 0.2, duration: 5 }),
      description: '药物配置同时使范围内的敌人移动速度-30%并获得20%的法术脆弱，持续5秒。' }), keepStar3: true }),
  chess_char_5_19_a: freeze({ name: '玛恩纳', rules: ['pilot:star3'], pilot: 'star3',
    star3: freeze({ kind: 'star3_mlynar_all', params: freeze({}),
      description: '未照耀的荣光附带的真实伤害对所有友方干员的攻击生效，不再限于卡西米尔干员。' }), keepStar3: true }),
});

const escapeChar = (ch) => ch.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
/** `from` as a pattern that tolerates rich-text tags (`<@ba.vup>`, `</>`) between any two characters. */
function richPattern(from) {
  return new RegExp([...from].map(escapeChar).join('(?:<[^>]*>)*'));
}
function rewrite(text, from, to, where) {
  if (typeof text !== 'string') throw new Error(`OPERATOR_ADAPTATION_TEXT_MISSING:${where}`);
  if (text.includes(from)) return text.replace(from, to);
  const pattern = richPattern(from);
  if (!pattern.test(text)) throw new Error(`OPERATOR_ADAPTATION_TEXT_DRIFT:${where}`);
  return text.replace(pattern, to);
}
function editTarget(record, field) {
  if (field === 'trait') return record.trait;
  if (field === 'skill') return record.skill;
  const match = /^talent:(\d+)$/.exec(field);
  if (match) return (record.talents ?? []).find((talent) => talent?.index === Number(match[1])) ?? record.talents?.[Number(match[1])];
  return null;
}
/** A three-star passive also listed as a talent row: the in-match operator card lists talents but no passive. */
export const STAR3_TALENT_INDEX = 90;
export function star3Talent(description) {
  return { index: STAR3_TALENT_INDEX, name: '升星特性', desc: description, descRaw: description, bb: {}, bbStr: {}, rangeGrid: null,
    tokenKey: null, hidden: false, fromModule: false, resonancePassive: true, unlockStar: 3 };
}
/**
 * The passive an operator gains at three stars: its star-three passive, or null when it has none or already has a passive
 * at one star (正义骑士号's 被动支援 is there from the start, so it is no 升星特性).
 */
export function starThreePassive(operator) {
  const has = (passive) => passive && passive.kind && passive.kind !== 'none';
  const gained = operator?.stars?.[3]?.passive;
  if (!has(gained) || !gained.description) return null;
  return [1, 2].some((star) => has(operator.stars?.[star]?.passive)) ? null : gained;
}
/** The battle and economy parameters an adapted operator carries (catalog.operators[id].adaptation). */
function adaptationView(id, row) {
  const keys = ['dpToSp', 'bounty', 'mergeGold', 'factionInitialSp', 'factionScaling', 'factionAspd', 'position', 'summon'];
  return { id, rules: [...row.rules], ...(row.pilot ? { pilot: row.pilot } : {}),
    ...Object.fromEntries(keys.filter((key) => row[key]).map((key) => [key, structuredClone(row[key])])) };
}

/**
 * Apply a season's adaptation table to a composed catalog: returns `{ operators, playerText }` with the adapted
 * operators cloned (records, star-three passive, `adaptation` parameters) and their player skill text rewritten.
 * Throws when a text to rewrite is not found, so a changed native record cannot silently keep the old wording.
 */
export function applyOperatorAdaptations(catalog, table = OPERATOR_ADAPTATIONS) {
  const operators = { ...catalog.operators };
  const playerOperators = { ...(catalog.playerText?.operators ?? {}) };
  for (const [id, row] of Object.entries(table)) {
    const original = operators[id];
    if (!original) throw new Error(`OPERATOR_ADAPTATION_UNKNOWN:${id}`);
    if (original.name !== row.name) throw new Error(`OPERATOR_ADAPTATION_NAME:${id}:${original.name}`);
    const stars = {};
    const text = structuredClone(playerOperators[id] ?? { stars: {} });
    text.stars ??= {};
    for (const star of [1, 2, 3]) {
      const spec = structuredClone(original.stars[star]);
      for (const edit of row.edits ?? []) {
        const target = editTarget(spec.record, edit.field);
        if (!target) throw new Error(`OPERATOR_ADAPTATION_FIELD:${id}:${edit.field}`);
        if (edit.bb) target.bb = { ...(target.bb ?? {}), ...edit.bb };
        if (edit.from == null) continue;
        const to = typeof edit.to === 'function' ? edit.to(star) : edit.to;
        target.desc = rewrite(target.desc, edit.from, to, `${row.name}:${star}:${edit.field}`);
        if (typeof target.descRaw === 'string') target.descRaw = rewrite(target.descRaw, edit.from, to, `${row.name}:${star}:${edit.field}:raw`);
        if (edit.field === 'skill') {
          text.stars[star] ??= {};
          text.stars[star].skillDescription = rewrite(text.stars[star].skillDescription ?? target.desc, edit.from, to, `${row.name}:${star}:player`);
        }
      }
      if (star === 3 && row.dropStar3) spec.passive = { kind: 'none', params: {}, description: '' };
      if (star === 3 && row.star3) {
        const previous = spec.passive && spec.passive.kind !== 'none' ? spec.passive : null;
        const kept = row.keepStar3 && previous ? previous : null;
        spec.passive = { ...structuredClone(row.star3), ...(kept ? { additionalEffect: structuredClone(kept),
          description: `${kept.description} ${row.star3.description}` } : {}) };
        spec.record.talents = [...(spec.record.talents ?? []).filter((talent) => !talent?.resonancePassive), star3Talent(spec.passive.description)];
      }
      stars[star] = spec;
    }
    operators[id] = { ...original, stars, adaptation: adaptationView(id, row) };
    playerOperators[id] = text;
  }
  return { operators, playerText: { ...(catalog.playerText ?? {}), operators: playerOperators } };
}

/** Season heroes with an adaptation's budget scale (`nativeKitBudget`, shared/resonance/native-power.js). */
export function adaptedHeroes(heroes, table = OPERATOR_ADAPTATIONS) {
  return heroes.map((hero) => table[hero.sourceChessId]?.budget
    ? { ...hero, nativeKitBudget: { ...(hero.nativeKitBudget ?? {}), ...table[hero.sourceChessId].budget } } : hero);
}
