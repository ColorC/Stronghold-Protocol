import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {factionSeason} from '../../shared/resonance/faction-season.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!process.env.SP_DATA_DIR)throw new Error('SP_DATA_DIR must name the canonical frozen native data');
const catalog=getResonanceCatalog(loadData(process.env.SP_DATA_DIR,{log:{warn(){},error(){}}}),{rulesVersion:3,seasonId:factionSeason.id});
const roles={damage:'输出',frontline:'前排',control:'控制',summoner:'召唤',support:'支援',healer:'治疗'};
const report={seasonId:factionSeason.id,source:factionSeason.source,
  poolByCost:factionSeason.costDistribution,
  operators:factionSeason.heroes.map(h=>{const o=catalog.operators[h.sourceChessId];return {id:h.sourceChessId,name:h.operatorName,cost:h.cost,role:roles[h.role],skill:o.fixedSkillId,nativeAffiliation:h.nativeAffiliation,pacts:o.pacts.map(id=>catalog.pacts[id].name),stats:Object.fromEntries([1,2,3].map(star=>[star,o.stars[star].stats]))};}),
  pacts:factionSeason.traits.map(t=>({id:t.id,name:t.name,group:t.group,sourceName:t.sourceName,fees:t.designReference.sourceMemberFees,members:t.members.map(id=>{const h=factionSeason.heroes.find(x=>x.charId===id);return {name:h.operatorName,cost:h.cost};}),description:catalog.pacts[t.id].summaryDescription,detailNotes:catalog.pacts[t.id].detailNotes??[],levels:catalog.pacts[t.id].levels.map(l=>({min:l.minUnits,max:l.maxUnits,text:l.description}))})),
};
const lines=['# 共鸣：阵营赛季','',
'当前共享配置为 `shared/resonance/faction-season.js`；原生归属、固定技能与天赋来自冻结的卫戍数据。旧赛季仍通过原 seasonId 读取。',
'', '人数门槛与各盟约的自然成员费用分布逐项对应云顶 Set 13、14.23。十个不重叠阵营与职业/机制组合形成57人卡池；没有宣称复制原赛季60棋子的完整交叉图。',
'','[Riot 赛季介绍](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/into-the-arcane-overview/) 提供机制背景；精确数值采用已固定的 CommunityDragon 14.23 客户端提取表，见 [完整参考](reference/tft-set13-14.23.md)。',
'','## 成员、门槛与费用','', '| 盟约 | 类别 | 对应机制 | 人数档位 | 自然成员（费用） |','|---|---|---|---|---|',
...report.pacts.map(t=>`| ${t.name} | ${t.group==='faction'?'阵营':'职业/机制'} | ${t.sourceName} | ${t.levels.map(l=>l.min).join(' / ')} | ${t.members.map(h=>`${h.name}（${h.cost}）`).join('、')} |`),
'','## 一星战斗数值','',
'生命与防御按原生PvE尺度设定；攻击使用该职责的持续贡献预算乘原生攻击间隔，固定技能、天赋与召唤收益另做实战验证。二、三星生命/攻击分别为一星的1.8、3.24倍，防御不随星级重复放大。下表为基础值，实战天赋、技能、装备与盟约可能改变它。',
'','| 干员 | 费用 | 职责 | 盟约 | 生命 | 攻击 | 防御 | 法抗 | 攻击间隔 |','|---|---|---|---|---:|---:|---:|---:|---:|',
...report.operators.map(h=>{const s=h.stats[1];return `| ${h.name} | ${h.cost} | ${h.role} | ${h.pacts.join('、')} | ${s.maxHp} | ${s.atk} | ${s.def} | ${s.res} | ${s.bat} |`;}),
'','## 效果与尺度','',
'固定生命、护盾、治疗和伤害单独换算到原生尺度；百分比、触发次数、持续时间、技力、金币与人数保持原义。防护评分通过每名干员的原生防御锚点转换，不能再用云顶原始几十点攻击力算成个位数平防。来源变量保留为证据，运行与界面使用转换后的数值。',
'','废弃的工坊累积盟约层数特质不进入本赛季的战斗记录和原生详情。保留职业特性、天赋、固定技能与实际升星效果。招募价格在费用处显示，免费部署的详情不再混列原版部署点数。',
'',...report.pacts.flatMap(t=>[`### ${t.name}`,'',t.description,'',...t.levels.map(l=>`- ${l.min}人：${l.text}`),'',...t.detailNotes.map(note=>`- ${note.name}实验特效：${note.text}`),'']),
];
for(const [rel,body] of [['docs/resonance/faction-season.json',JSON.stringify(report,null,2)+'\n'],['docs/resonance/faction-season.md',lines.join('\n')+'\n']]){const file=path.join(root,rel);fs.writeFileSync(file,body);console.log(JSON.stringify({path:file,role:'current-season-design',bytes:Buffer.byteLength(body)}));}
