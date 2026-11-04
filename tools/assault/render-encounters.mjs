#!/usr/bin/env node
// Deterministically render the encounter design source into its review document.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'data/assault-design/encounters.json');
const target = path.join(root, 'docs/assault-mode/encounters.md');
const doc = JSON.parse(fs.readFileSync(source, 'utf8'));
if (!Array.isArray(doc.encounters) || doc.encounters.length !== 36) {
  throw new Error(`Expected exactly 36 encounters, got ${doc.encounters?.length}`);
}
const ids = new Set();
for (const e of doc.encounters) {
  if (!e.id || !e.name || ids.has(e.id)) throw new Error(`Invalid or duplicate encounter: ${e.id}`);
  ids.add(e.id);
}
const esc = s => String(s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const band = e => {
  const match = e.id.match(/enc_band(\d+)/);
  return match ? `Band ${match[1]}` : `第${e.dayRange?.[0] ?? '?'}-${e.dayRange?.[1] ?? '?'}天`;
};
const rows = doc.encounters.map(e => `| ${esc(band(e))} | ${esc(e.kind)} | \`${esc(e.id)}\` | ${esc(e.name)} | ${e.rewards?.gold ?? '—'}金 / ${e.rewards?.xp ?? '—'}经验 | ${e.rewards?.relicChoice ? '胜利收藏' : '—'} |`);
const soloRoutes = [
  '## 当前单人场路线', '',
  '普通场只使用当前单侧战场的真实原生入口和出口，保留波次人数、时序及路线索引。多人来源中的对侧入口已投影到对应的同侧原生入口，原坐标保存在配置的 routeProjection 中；禁止截断坐标后以直线穿越障碍。地面单位使用原生可走格、工事和寻路，飞行单位遵循原生飞行规则。下方机制段中的来源波次说明保留作为设计来历；本表是当前执行路线。', '',
  '| 遭遇 | 地图 | 场地 | 当前路线（行,列） |',
  '| --- | --- | --- | --- |',
  ...doc.encounters.map(e => `| \`${esc(e.id)}\` | \`${esc(e.stageId)}\` | ${esc(e.boardRegion?.deployField || 'normal')} | ${(e.wave?.routes || []).map(r => `${r.motion}: ${[r.start, ...(r.checkpoints || []), r.end].map(p => `(${p.join(',')})`).join(' → ')}`).join('；')} |`), '',
];
const body = [
  '# 进击遭遇设计', '',
  `由 \`data/assault-design/encounters.json\` 确定性渲染；当前共 ${doc.encounters.length} 场，覆盖六个 band 的普通、风险与精英遭遇。`, '',
  '| 阶段 | 类型 | ID | 名称 | 奖励 | 收藏 |',
  '| --- | --- | --- | --- | --- | --- |', ...rows, '',
  ...soloRoutes, '## 遭遇机制与路线', '',
  ...doc.encounters.flatMap(e => [`### ${e.name}（${e.id}）`, '', e.description || '（未提供描述）', '', `- 风险说明：${e.riskExplanation || '无'}`, `- 机制与路线：${e.implementationPlan || '按遭遇 JSON 配置执行。'}`, `- 关键检查：${(e.causalChecks || []).map(esc).join('；') || '无'}`, '']),
];
fs.writeFileSync(target, body.join('\n'), 'utf8');
console.log(`Rendered ${doc.encounters.length} encounters to ${target}`);
