import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {factionSeasonV2 as factionSeason} from '../../shared/resonance/faction-season-v2.js';
import {factionSeason as firstFactionSeason} from '../../shared/resonance/faction-season.js';
import {STRONGHOLD_PACT_TUNING,STRONGHOLD_RETIRED_AUGMENTS,STRONGHOLD_RETIRED_ECONOMY_TRAITS,STRONGHOLD_EMISSARY_FIXED_WINS} from '../../shared/resonance/stronghold-pacts.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!process.env.SP_DATA_DIR)throw new Error('SP_DATA_DIR must name the canonical frozen native data');
const catalog=getResonanceCatalog(loadData(process.env.SP_DATA_DIR,{log:{warn(){},error(){}}}),{rulesVersion:3,seasonId:factionSeason.id});
const roles={damage:'输出',frontline:'前排',control:'控制',summoner:'召唤',support:'支援',healer:'治疗'};
const report={seasonId:factionSeason.id,source:factionSeason.source,
  poolByCost:factionSeason.costDistribution,
  operators:factionSeason.heroes.map(h=>{const o=catalog.operators[h.sourceChessId];return {id:h.sourceChessId,name:h.operatorName,cost:h.cost,role:roles[h.role],skill:o.fixedSkillId,nativeAffiliation:h.nativeAffiliation,pacts:o.pacts.map(id=>catalog.pacts[id].name),stats:Object.fromEntries([1,2,3].map(star=>[star,o.stars[star].stats]))};}),
  retiredAugments:[...STRONGHOLD_RETIRED_AUGMENTS],retiredEconomyTraits:[...STRONGHOLD_RETIRED_ECONOMY_TRAITS],
  pacts:factionSeason.traits.map(t=>({id:t.id,name:t.name,group:t.group,sourceName:t.sourceName,mechanic:catalog.pacts[t.id].levels[0].effects[0].params.mechanic,redesigned:!!t.strongholdPact,tuning:STRONGHOLD_PACT_TUNING[t.id]??null,fees:t.designReference.sourceMemberFees,members:t.members.map(id=>{const h=factionSeason.heroes.find(x=>x.charId===id);return {name:h.operatorName,cost:h.cost};}),description:catalog.pacts[t.id].summaryDescription,detailNotes:catalog.pacts[t.id].detailNotes??[],levels:catalog.pacts[t.id].levels.map(l=>({min:l.minUnits,max:l.maxUnits,text:l.description}))})),
};
const lines=['# 共鸣：阵营赛季','',
`当前赛季为 \`${factionSeason.id}\`，共享配置为 \`shared/resonance/faction-season-v2.js\`，盟约效果与玩家文案为 \`shared/resonance/stronghold-pacts.js\`，战斗实现为 \`server/sim/content/resonance/stronghold-pacts.js\`。原生归属、固定技能与天赋来自冻结的卫戍数据。\`resonance-factions-1\` 及更早赛季的存档仍按原 seasonId 与原规则读取。`,
'', '人数门槛与各盟约的自然成员费用分布沿用阵营赛季一，逐项对应云顶 Set 13、14.23。十个不重叠阵营与职业/机制组合形成57人卡池；没有宣称复制原赛季60棋子的完整交叉图。',
'','[Riot 赛季介绍](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/into-the-arcane-overview/) 提供机制背景；精确数值采用已固定的 CommunityDragon 14.23 客户端提取表，见 [完整参考](reference/tft-set13-14.23.md)。',
'','## 成员、门槛与费用','', '| 盟约 | 类别 | 机制 | 人数档位 | 自然成员（费用） |','|---|---|---|---|---|',
...report.pacts.map(t=>`| ${t.name} | ${t.group==='faction'?'阵营':'职业/机制'} | ${t.mechanic}${t.redesigned?'（重做）':''} | ${t.levels.map(l=>l.min).join(' / ')} | ${t.members.map(h=>`${h.name}（${h.cost}）`).join('、')} |`),
'','## 盟约口径','',
'- 阵营盟约是不叠层的卫戍协议盟约：按上阵人数分档，每档写明数值；战斗内效果有上限或持续时间，任何盟约效果都不跨战斗累计。',
'- 每个阵营有一条改变战场逻辑的机制（通缉、寒冷与冻结、炎佑、复活、装备、隐匿与恐惧、真实伤害与阻挡、技能联动、屏障、医疗协同），与成员自己的技能、天赋配合；纯数值只作陪衬。强度主要放在干员技能与装备搭配上。',
'- 狙击、术式、坚阵、突袭、技力协同对应原版精准、奥术、坚守、突袭、迅捷的常规机制；其余十一个职业/机制盟约沿用原实现，数值按同一量级修正（见下）。',
`- 退出新赛季的经济：${STRONGHOLD_RETIRED_ECONOMY_TRAITS.map(id=>catalog.pacts[id].name).join('、')}原有的赞助装备、交易市场、宝箱与临时合成；同袍、铸军、圣枪的经济不变。维多利亚5人起每3场战斗发放1件${catalog.equipment.blade.name}。`,
`- 新赛季候选池移除依附被替换机制的强化：${STRONGHOLD_RETIRED_AUGMENTS.map(api=>{const row=firstFactionSeason.augmentCandidates.find(entry=>entry.apiName===api);return `${row?.displayName??row?.name??api}（${api}）`;}).join('、')}。领军中号角的防御加成固定按${STRONGHOLD_EMISSARY_FIXED_WINS}场胜利计算，不随战绩成长。`,
'','### 沿用盟约的数值修正','',
...report.pacts.filter(t=>t.tuning).map(t=>`- ${t.name}：${Object.entries(t.tuning).map(([min,values])=>`${min}人 ${Object.entries(values).map(([key,value])=>`${key}=${value}`).join('，')}`).join('；')}`),
'','## 一星战斗数值','',
'生命与防御按原生PvE尺度设定；攻击使用该职责的持续贡献预算乘原生攻击间隔，固定技能、天赋与召唤收益另做实战验证。二、三星生命/攻击分别为一星的1.8、3.24倍，防御不随星级重复放大。下表为基础值，实战天赋、技能、装备与盟约可能改变它。',
'','| 干员 | 费用 | 职责 | 盟约 | 生命 | 攻击 | 防御 | 法抗 | 攻击间隔 |','|---|---|---|---|---:|---:|---:|---:|---:|',
...report.operators.map(h=>{const s=h.stats[1];return `| ${h.name} | ${h.cost} | ${h.role} | ${h.pacts.join('、')} | ${s.maxHp} | ${s.atk} | ${s.def} | ${s.res} | ${s.bat} |`;}),
'','## 效果与尺度','',
'重做的十五个盟约直接使用原生尺度的百分比、秒数与技力；沿用的十一个盟约中固定生命、屏障、治疗和伤害换算到原生尺度，百分比、触发次数、持续时间、技力、金币与人数保持原义。防护评分通过每名干员的原生防御锚点转换。',
'','废弃的工坊累积盟约层数特质不进入本赛季的战斗记录和原生详情。保留职业特性、天赋、固定技能与实际升星效果。招募价格在费用处显示，免费部署的详情不再混列原版部署点数。',
'',...report.pacts.flatMap(t=>[`### ${t.name}`,'',t.description,'',...t.levels.map(l=>`- ${l.min}人：${l.text}`),'',...t.detailNotes.map(note=>`- ${note.name}实验特效：${note.text}`),'']),
];
for(const [rel,body] of [['docs/resonance/faction-season.json',JSON.stringify(report,null,2)+'\n'],['docs/resonance/faction-season.md',lines.join('\n')+'\n']]){const file=path.join(root,rel);fs.writeFileSync(file,body);console.log(JSON.stringify({path:file,role:'current-season-design',bytes:Buffer.byteLength(body)}));}
