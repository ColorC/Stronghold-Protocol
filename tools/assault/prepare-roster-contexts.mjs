import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const worktree = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canonical = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const sourceRoot = path.join(canonical, 'data/assault-sources/arknights');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const index = read(path.join(worktree, 'data/assault-operator-index.json'));
const characters = read(path.join(sourceRoot, 'excel/character_table.json'));
const skills = read(path.join(sourceRoot, 'excel/skill_table.json'));
const equip = read(path.join(sourceRoot, 'excel/uniequip_table.json'));
const chess = read(path.join(canonical, 'data/chess.json'));
const workshop = read(path.join(canonical, 'data/independent-design.json'));
const known = new Map(index.operators.map(o => [o.charId, o]));
const nativeIds = new Set(Object.values(chess).map(c => c.charId).filter(id => known.has(id)));
const originalIds = new Set(Object.values(chess).filter(c => c.visible === true && !c.isGolden)
  .map(c => c.charId).filter(id => known.has(id)));
const workshopIds = new Set(workshop.operators.filter(o => o.active === true)
  .map(o => o.charId).filter(id => known.has(id)));
const additions = new Set(['凛御银灰', '新约能天使', '白铁', '初雪', '灵知', '圣聆初雪', '桃金娘',
  '极境', '风笛', '琴柳', '晓歌', '伊内丝', '赫拉格', '百炼嘉维尔', '玛恩纳', '佩佩', '莱伊',
  '缄默德克萨斯', '烛煌', '余', '遥', '维什戴尔', '逻各斯', '令', '黍', '圣约送葬人',
  'Mon3tr', '森蚺', '泥岩', '仇白', '霍尔海雅', '阿米娅', '德·托莱多', '旅骨', '克莱门莎']);
for (const name of additions) {
  if (!index.operators.some(o => o.name === name)) throw new Error(`Required operator absent: ${name}`);
}
const selected = new Set([...nativeIds, ...workshopIds,
  ...index.operators.filter(o => additions.has(o.name)).map(o => o.charId)]);
const groups = {
  support: ['PIONEER', 'TANK', 'MEDIC'],
  assault: ['WARRIOR', 'SPECIAL'],
  ranged: ['SNIPER', 'CASTER', 'SUPPORT'],
};
const selections = index.operators.map(o => ({
  charId: o.charId, name: o.name, profession: o.profession,
  selected: selected.has(o.charId),
  reasons: [originalIds.has(o.charId) && '原盟约可招募池', nativeIds.has(o.charId) && '已有棋子身体资料',
    workshopIds.has(o.charId) && '现工坊活跃池', additions.has(o.name) && '进击主题与特色支点'].filter(Boolean),
  candidateRole: selected.has(o.charId) ? null : `${o.profession}/${o.subProfessionId}后续候选；首版先覆盖现本体和工坊角色及新增主题支点`,
  source: { file: o.source.characterTable, pointer: o.pointers.record },
}));
const selectionPath = path.join(worktree, 'data/assault-roster-selection.json');
const contextRoot = path.join(canonical, '.omni/tmp/assault/roster-contexts');
fs.mkdirSync(contextRoot, { recursive: true });
const selection = {
  schema: 'assault-roster-selection/v1', status: 'design-input',
  sourceRevision: '17759cc8cdf37388414145d16262a3a06f3ab25e',
  gameSource: { root: canonical, workingTree: true, files: ['data/chess.json', 'data/independent-design.json'] },
  count: selected.size, candidateCount: selections.length,
  note: '纳入设计不代表已有可执行技能、完整资产或已完成实现；逐卡设计和因果验收仍须完成。',
  candidates: selections,
};
fs.writeFileSync(selectionPath, JSON.stringify(selection, null, 2));
const files = [];
for (const [group, professions] of Object.entries(groups)) {
  const operators = index.operators.filter(o => selected.has(o.charId) && professions.includes(o.profession)).map(o => {
    const raw = characters[o.charId];
    if (!raw) throw new Error(`Missing source ${o.charId}`);
    const nativeChess = Object.values(chess).find(c => c.charId === o.charId && !c.isGolden);
    return {
      charId: o.charId, name: o.name, profession: o.profession, subProfessionId: o.subProfessionId,
      affiliation: o.affiliation, rarity: o.rarity, position: o.position, tags: raw.tagList,
      trait: { description: raw.description, candidates: raw.trait?.candidates ?? [] },
      phases: raw.phases.map(p => ({ maxLevel: p.maxLevel, rangeId: p.rangeId,
        attributesKeyFrames: p.attributesKeyFrames })),
      favorKeyFrames: raw.favorKeyFrames,
      talents: (raw.talents ?? []).map((t, i) => ({ index: i,
        candidates: t.candidates.filter(c => Number(c.requiredPotentialRank ?? 0) === 0) })),
      skills: raw.skills.map((s, i) => {
        if (!skills[s.skillId]) throw new Error(`Unresolved skill ${s.skillId}`);
        const source = skills[s.skillId];
        const levelIndices = [...new Set([Math.min(6, source.levels.length - 1), source.levels.length - 1])];
        return { index: i, ...s, source: { skillId: source.skillId, iconId: source.iconId,
          levels: levelIndices.map(index => ({ index, ...source.levels[index],
            pointer: `/${s.skillId}/levels/${index}` })) }, pointer: `/${s.skillId}` };
      }),
      modules: (equip.charEquip[o.charId] ?? []).map(id => ({
        id, name: equip.equipDict[id]?.uniEquipName, type: equip.equipDict[id]?.type,
        source: { file: path.join(sourceRoot, 'excel/battle_equip_table.json'), pointer: `/${id}` },
      })),
      existingBody: nativeChess ? {
        chessId: nativeChess.chessId, tier: nativeChess.tier, status: nativeChess.status,
        stats: nativeChess.stats, canHitFly: nativeChess.canHitFly, attackKind: nativeChess.attackKind,
        dmgType: nativeChess.dmgType, tokens: nativeChess.tokens,
        skillId: nativeChess.skill?.skillId,
      } : null,
      source: o.source, pointers: o.pointers,
    };
  });
  const target = path.join(contextRoot, `${group}.json`);
  fs.writeFileSync(target, JSON.stringify({ group, count: operators.length, professions,
    sourceRevision: selection.sourceRevision, operators }));
  files.push({ path: target, count: operators.length, bytes: fs.statSync(target).size });
}
if (files.reduce((n, f) => n + f.count, 0) !== selected.size) throw new Error('Profession partition does not cover selected pool');
const receiptPath = path.join(canonical, 'runtime/assault/roster-contexts.json');
const receipt = { selection: selectionPath, selected: selected.size, candidates: selections.length,
  original: originalIds.size, nativeBodies: nativeIds.size, workshop: workshopIds.size,
  addedBeyondNative: index.operators.filter(o => selected.has(o.charId) && !nativeIds.has(o.charId)).map(o => ({ charId: o.charId, name: o.name })),
  contexts: files, receipt: receiptPath };
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
