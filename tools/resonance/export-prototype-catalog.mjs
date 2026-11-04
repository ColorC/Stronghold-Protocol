import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GIT_COMMON_DIR = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
const CANONICAL_ROOT = path.dirname(path.resolve(ROOT, GIT_COMMON_DIR));
const CANONICAL_DATA = path.resolve(CANONICAL_ROOT, 'data/resonance-native');
const dataDir = path.resolve(process.env.SP_DATA_DIR || CANONICAL_DATA);
if (dataDir.toLowerCase() !== CANONICAL_DATA.toLowerCase()) {
  throw new Error(`PROTOTYPE_CATALOG_REQUIRES_CANONICAL_DATA:${CANONICAL_DATA}`);
}
const output = path.join(ROOT, 'docs/resonance/catalog.md');
const data = getData({ dir: CANONICAL_DATA });
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: prototypeSeason.id, seed: 1 });
const activeIds = catalog.config.activeOperatorIds;
const active = activeIds.map((id) => catalog.operators[id]);
const activeByChar = new Map(active.map((operator) => [operator.charId, operator]));
const powerById = new Map(prototypeSeason.heroes.map((hero) => [hero.sourceChessId, hero.powerReference]));
const costCounts = Object.fromEntries([1, 2, 3, 4, 5].map((cost) => [cost, active.filter((operator) => operator.cost === cost).length]));
const md = [];
const push = (...lines) => md.push(...lines);
const cell = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
const countBy = (items, key) => {
  const counts = {};
  for (const item of items) counts[item[key] ?? '未分类'] = (counts[item[key] ?? '未分类'] ?? 0) + 1;
  return counts;
};

push(
  '# 共鸣当前赛季配置',
  '',
  `本页由运行中的 rulesVersion ${catalog.config.rulesVersion} catalog 生成。赛季：${catalog.season.displayName}（${catalog.season.id}）；当前招募池 ${active.length} 名，费用分布 ${JSON.stringify(costCounts)}。`,
  `独立图鉴记录 ${Object.keys(catalog.operators).length} 名；当前盟约 ${Object.keys(catalog.pacts).length} 项；可用装备记录 ${Object.keys(catalog.equipment).length} 项；配方 ${catalog.recipes.length} 条；策略 ${Object.keys(catalog.strategies).length} 项。`,
  `来源基线：${prototypeSeason.source.set}，${prototypeSeason.source.patch}。生成使用 canonical data：${CANONICAL_DATA}。`,
  '',
  '## 当前招募名单',
  '',
  '| 干员 | 源 ID | 费用 | 职责 | 部署位置 | 可部署高台 | 固定技能 | 一星生命/攻击 | 二星生命/攻击 | 三星生命/攻击 | 护甲/法抗 | 攻击间隔 | 来源射程 | 当前模式技能预算 | 自然盟约 |',
  '|---|---|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|',
);
for (const operator of active) {
  const stars = [1, 2, 3].map((star) => operator.stars[star]?.stats ?? {});
  const power = powerById.get(operator.id) ?? {};
  const pactNames = operator.pacts.map((id) => catalog.pacts[id]?.name ?? id).join('、');
  const interval = power.attackSpeed ? (1 / power.attackSpeed).toFixed(3) : '—';
  const budget = operator.currentFeeAdjustment
    ? `×${operator.currentFeeAdjustment.budgetScale}（本模式PvE固定技能预算调整，保留技能身份与弹药机制；不代表来源干员数值）`
    : '—';
  push(`| ${cell(operator.name)} | ${cell(operator.id)} | ${operator.cost} | ${cell(operator.role)} | ${cell(operator.position)} | ${operator.canDeployHighGround ? '是' : '否'} | ${cell(operator.fixedSkillId || '无')} | ${stars.map((s) => `${s.maxHp ?? '—'}/${s.atk ?? '—'}`).join(' | ')} | ${power.armor ?? '—'}/${power.magicResist ?? '—'} | ${interval} 秒 | ${power.range ?? '—'} | ${cell(budget)} | ${cell(pactNames)} |`);
}

push('', '## 当前自然盟约', '', '| 盟约 | 自然成员 | 档位条件 | 档位效果 |', '|---|---|---|---|');
for (const pact of Object.values(catalog.pacts)) {
  const members = (pact.members ?? []).map((id) => active.find((operator) => operator.id === id)?.name).filter(Boolean);
  const levels = (pact.levels ?? []).map((level) => {
    const min = level.minUnits ?? level.threshold;
    const max = level.maxUnits;
    const threshold = level.exactCount != null
      ? `恰好 ${level.exactCount} 名`
      : max == null || max >= 25000 ? `至少 ${min} 名` : min === max ? `恰好 ${min} 名` : `${min}–${max} 名`;
    const vars = level.sourceVariables ?? {};
    const values = Object.entries(vars).map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`).join('；');
    return `${threshold}：${cell(level.description)}${values ? `（${cell(values)}）` : ''}`;
  });
  push(`| ${cell(pact.name)} | ${cell(members.join('、'))} | ${cell(levels.map((level) => level.split('：')[0]).join('；'))} | ${cell(levels.join('<br>'))} |`);
}

push('', '## 装备与配方', '', `可用装备按类别计数：${JSON.stringify(countBy(Object.values(catalog.equipment), 'kind'))}。`, '', '| 装备 | ID | 类别 | 唯一 | 说明 |', '|---|---|---|---|---|');
for (const item of Object.values(catalog.equipment).filter((entry) => entry.grantAllowed !== false).sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.name).localeCompare(String(b.name)))) {
  push(`| ${cell(item.name)} | ${cell(item.id)} | ${cell(item.kind)} | ${item.unique ? '是' : '否'} | ${cell(item.description)} |`);
}
push('', '| 配方 | 材料 | 成品 |', '|---|---|---|');
for (const recipe of catalog.recipes) {
  push(`| ${cell(recipe.resultId)} | ${cell(recipe.parts.join(' + '))} | ${cell(catalog.equipment[recipe.resultId]?.name ?? recipe.resultId)} |`);
}

push('', '## 策略', '', '| 策略 | ID | 效果 / 选择 |', '|---|---|---|');
for (const strategy of Object.values(catalog.strategies).sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))) {
  const effects = (strategy.effects ?? []).map((effect) => `${effect.kind}: ${JSON.stringify(effect.params ?? {})}`).join('<br>');
  push(`| ${cell(strategy.name)} | ${cell(strategy.id)} | ${cell(strategy.description)}${effects ? `<br>${cell(effects)}` : ''} |`);
}

const economy = catalog.prototypeEconomy?.rules ?? {};
push('', '## 经济与关卡', '', '| 等级 | 升级所需经验 | 商店费用概率（1/2/3/4/5费） |', '|---:|---:|---|');
for (const level of Object.keys(catalog.campaign.shopOdds ?? {}).map(Number).sort((a, b) => a - b)) {
  push(`| ${level} | ${economy.xpToLevel?.[level] ?? '—'} | ${(catalog.campaign.shopOdds[level] ?? []).join('% / ')}% |`);
}
push('', `经验来源版本：${JSON.stringify(economy.sourceVersions ?? {})}。每费牌池份数：${JSON.stringify(catalog.campaign.copiesByCost ?? {})}。当前招募池每费人数：${JSON.stringify(catalog.campaign.poolByCost)}。`, '', '### 关卡节点', '', '| 模式或阶段 | 节点安排 |', '|---|---|');
const schedule = catalog.campaign.nodeSchedule ?? {};
for (const [kind, row] of Object.entries(schedule)) {
  const description = kind === 'FUNNY'
    ? `${row.nodes} 个节点；偶数节点战斗；奇数节点获得 ${row.oddNodeGold} 金币与 ${row.oddNodeXp} 经验。`
    : kind === 'NORMAL' || kind === 'HARD'
      ? `${row.nodes} 个节点；Boss 在第 ${row.bossNode} 节点。`
      : kind === 'ABYSS'
        ? `${row.nodes} 个节点；Boss 第 ${row.baseBossNode} 节点、精英第 ${row.eliteNode} 节点、隐藏Boss第 ${row.hiddenBossNode} 节点。`
        : `${row.max} 个普通波次按 ${row.formula} 计算；Boss 第 ${row.bossWave} 波，隐藏Boss第 ${row.hiddenBossWave} 波。`;
  push(`| ${cell(kind)} | ${cell(description)} |`);
}
push('', '### 敌方数值修正', '', '| 难度 | 普通敌人生命/攻击/防御 | Boss生命/攻击/防御/共享生命池 |', '|---|---|---|');
const enemy = catalog.campaign.enemyBalance ?? {};
for (const difficulty of ['NORMAL', 'FUNNY', 'HARD', 'ABYSS']) {
  // a difficulty's override may set only some fields of a scope: the rest come from the shared profile
  const row = enemy.byDifficulty?.[difficulty] ?? {};
  const regular = { ...enemy.regular, ...row.regular };
  const terminal = { ...enemy.terminal, ...row.terminal };
  push(`| ${difficulty} | ${regular.hpMultiplier ?? '—'} / ${regular.atkMultiplier ?? '—'} / ${regular.defMultiplier ?? '—'} | ${terminal.hpMultiplier ?? '—'} / ${terminal.atkMultiplier ?? '—'} / ${terminal.defMultiplier ?? '—'} / ${terminal.bossPoolMultiplier ?? '—'} |`);
}
const nodeCurve = enemy.nodeCurve ?? {};
if (Object.keys(nodeCurve).length) {
  push('', '普通与精英节点的敌人生命、攻击再乘本难度的节点曲线（节点之间线性过渡，两端之外取端点值）；领袖节点使用上表 Boss 列，与防御一样不乘曲线。', '', '| 难度 | 节点：生命× / 攻击× |', '|---|---|');
  for (const difficulty of ['NORMAL', 'FUNNY', 'HARD', 'ABYSS']) {
    if (nodeCurve[difficulty]) push(`| ${difficulty} | ${nodeCurve[difficulty].map((point) => `${point.node}：${point.hpMultiplier} / ${point.atkMultiplier}`).join('；')} |`);
  }
}
const supply = catalog.campaign.supply ?? {};
push('', `补给：组件节点 ${supply.components?.nodes?.join('、') ?? '—'}（每节点 ${supply.components?.countPerNode ?? '—'} 件）；转职节点 ${(supply.transfers ?? []).map((row) => `${row.node}（${row.count}）`).join('、') || '—'}；经验节点 ${(supply.xp ?? []).map((row) => `${row.node}（${row.amount}）`).join('、') || '—'}。策略节点：${(catalog.campaign.strategyNodes ?? []).join(' / ')}。`, '');

push('## 独立实体与来源适配', '', '| 实体 | 类型 | 生命/防御/法抗 | 部署规则 | 说明 |', '|---|---|---|---|---|');
for (const entity of Object.values(catalog.specialEntities ?? {})) {
  const sourceName = entity.source?.name ?? entity.id;
  const description = entity.source?.description ?? entity.description ?? '';
  push(`| ${cell(sourceName)} | ${cell(entity.kind)} | ${entity.maxHp ?? '—'}/${entity.def ?? '—'}/${entity.res ?? '—'} | 不占自然干员人口；${entity.canMove === false ? '不可移动' : '可移动'}；阻挡 ${entity.blockCount ?? '—'} | ${cell(description)} PvE部署规则独立于来源数据。`);
}
push('', '## 旧存档兼容', '', '新开局使用 rulesVersion 3 与本页列出的固定赛季池。已保存的 rulesVersion 1 会继续解析其旧环境配置；rulesVersion 2 会按存档中的已登记 seasonId 解析旧名单与规则。旧规则只用于兼容既有存档，不混入本页当前赛季清单。', '');

const text = `${md.join('\n').trimEnd()}\n`;
fs.writeFileSync(output, text, 'utf8');
console.log(JSON.stringify({ output, rulesVersion: catalog.config.rulesVersion, seasonId: catalog.season.id, active: active.length, pacts: Object.keys(catalog.pacts).length, items: Object.keys(catalog.equipment).length, recipes: catalog.recipes.length, strategies: Object.keys(catalog.strategies).length, bytes: Buffer.byteLength(text) }));
