#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANVAS_ID = 'canvas-0470c0a1';
const UPSTREAM_CARD_ID = 'text-c536b659-3c89-40ab-ba70-db5648e64081';
const PLAY_CARD_ID = 'resonance-play-20261009';
const DESIGN_CARD_ID = 'resonance-design-20261009';
const SERVER_FALLBACK = 'https://workshop.colorc.cc/bside';
const PROJECT_ID = 'arknights';
const CONFIG_PATH = 'C:/Users/lilithgames/AppData/Roaming/wsh/config.json';
const WSH_CLI_PATH = process.env.WSH_CLI_PATH
  || 'E:/WindowsWorkspace/spark.workshop/releases/remote-play-card-20261004/wt/remote-play-card-20261004-5ba073215a31/workshop/cli/dist/wsh.mjs';

const DESIGN_SECTIONS = new Set([
  '体验与内容范围', '经济与招募', '费用与角色职责', '盟约设计原则',
  '需求明确的终端', '装备、策略与开局事件', '成型窗口与遭遇预算',
]);

function playerFacingDesign(markdown) {
  const current = markdown.match(/^## 玩法说明\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim();
  if (current) {
    if (/(?:[A-Z]:[\\/]|rulesVersion|battleId|sourceRevision|T-\d+|未实现|取证|(?<!经)验收)/.test(current)) {
      throw new Error('玩法说明包含非玩家内容');
    }
    return `## 玩法说明\n\n${current}`;
  }
  const blocks = markdown.split(/(?=^#{2,3} )/m).slice(1);
  const included = [];
  for (const block of blocks) {
    const heading = block.match(/^#{2,3} (.+)$/m)?.[1]?.trim();
    if (!DESIGN_SECTIONS.has(heading)) continue;
    const body = block.replace(/^#{2,3} .+\r?\n/, '').trim();
    const paragraphs = body.split(/\r?\n\s*\r?\n/).filter(Boolean).filter(paragraph => !(
      /完整招募目录采用|完整干员资料采用|界面沿用工坊|界面以最新上游|概率采用当前 Set18|五费名单：|费用映射以现有设计 tier|^- 原[一二三四五六]档|完整内容表需包括|经营状态、配置与战斗核心共用|日常使用 `recording:false`|测试覆盖经济边界|推演后逐次修订|全部配置与完整用户故事|磁盘工具持续计入|每个保留的新增机制|用户明确指定|必须包含的主逻辑/i.test(paragraph)
    )).map(paragraph => paragraph
      .replace(/这个循环参考历史 Sentinel .*?不要求先受伤或等破盾才能获得增益。/g, '屏障与攻速在周期开始时同时获得。')
      .replace(/未实现的火墙、狼影与其它大档附加效果.*?虚构收益。/g, ''));
    if (paragraphs.length) included.push(`## ${heading}\n\n${paragraphs.join('\n\n')}`);
  }
  const result = included.join('\n\n');
  if (!result || /(?:[A-Z]:\\|(?:^|\s)T-\d+|reference\/|18\.2|2026-\d\d-\d\d)/m.test(result)) {
    throw new Error('设计卡正文包含非玩家内容或未提取到规则');
  }
  return result;
}

const DESIGN_BODY = (entryUrl, referenceUrl, designRules) => [
  '# 共鸣玩法与参考',
  '',
  `打开[共鸣玩法](${entryUrl})。完整资料可从[参考资料包](${referenceUrl})下载。`,
  '',
  designRules,
].join('\n');

const HELP = `用法：node tools/resonance/workshop-delivery.mjs [--dry-run|--execute] --entry-url URL [--embed-url URL] --reference-url URL --release-receipt FILE --receipt FILE\n       node tools/resonance/workshop-delivery.mjs --refresh-existing [--dry-run|--execute] --entry-url URL [--embed-url URL] --reference-url URL --release-receipt FILE --receipt FILE\n       node tools/resonance/workshop-delivery.mjs --repair-play-card [--dry-run|--execute] --embed-url URL --release-receipt FILE --receipt FILE\n       node tools/resonance/workshop-delivery.mjs --self-test\n默认只执行只读预览；只有显式 --execute 才写入 Workshop。`;

function parseArgs(argv) {
  const options = { execute: false, selfTest: false, repairPlayCard: false, refreshExisting: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--dry-run') options.execute = false;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--repair-play-card') options.repairPlayCard = true;
    else if (arg === '--refresh-existing') options.refreshExisting = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (['--entry-url', '--embed-url', '--reference-url', '--release-receipt', '--receipt'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`缺少 ${arg} 的值`);
      options[arg.slice(2)] = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (argv.includes('--execute') && argv.includes('--dry-run')) throw new Error('--execute 与 --dry-run 不能同时使用');
  if (options.repairPlayCard && options.refreshExisting) throw new Error('--repair-play-card 与 --refresh-existing 不能混用');
  return options;
}

function absoluteFile(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} 必须是绝对文件路径`);
  return path.resolve(value);
}

function httpsUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} 必须是有效的 HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} 必须是无凭据的 HTTPS URL`);
  return url.toString();
}

function validateReleaseReceipt(receiptPath) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const revision = receipt?.sourceRevision;
  if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error('release receipt 缺少原生 Git sourceRevision');
  }
  const resolved = execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' }).trim();
  if (resolved.toLowerCase() !== revision.toLowerCase()) throw new Error('release receipt 的 sourceRevision 不是可解析的原生 commit');
  const artifact = (receipt.artifacts ?? []).find(item => path.basename(String(item?.path ?? '')) === 'resonance-references.zip');
  if (!artifact || typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path) || !fs.statSync(artifact.path).isFile()) {
    throw new Error('release receipt 未包含已生成的 resonance-references.zip');
  }
  return { sourceRevision: resolved, archivePath: path.resolve(artifact.path) };
}

function noOverlap(cards) {
  for (let i = 0; i < cards.length; i += 1) {
    const a = cards[i];
    for (let j = i + 1; j < cards.length; j += 1) {
      const b = cards[j];
      if (intersects(a, b)) return false;
    }
  }
  return true;
}

function intersects(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x
    || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function apiUrl(serverBase, endpoint) {
  return new URL(`${serverBase.replace(/\/+$/, '')}${endpoint}`);
}

function validateEmbedUrl(embedUrl, workshopOrigin) {
  const target = new URL(embedUrl);
  if (target.origin !== workshopOrigin || !target.pathname.endsWith('/resonance.html')) {
    throw new Error('--embed-url 必须是 Workshop 同源的 resonance.html 页面');
  }
  return target.toString();
}

function absoluteBoxes(cards) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const memo = new Map();
  function origin(card, visiting = new Set()) {
    if (memo.has(card.id)) return memo.get(card.id);
    if (visiting.has(card.id)) throw new Error('画布卡片parent关系存在循环');
    visiting.add(card.id);
    const parent = card.parentId ? byId.get(card.parentId) : null;
    const parentOrigin = parent ? origin(parent, visiting) : { x: 0, y: 0 };
    const point = { x: parentOrigin.x + Number(card.x || 0), y: parentOrigin.y + Number(card.y || 0) };
    memo.set(card.id, point);
    return point;
  }
  return cards.map(card => {
    const point = origin(card);
    return { ...point, width: Number(card.width || 0), height: Number(card.height || 0) };
  });
}

function layoutFor(cards) {
  const boxes = absoluteBoxes(cards);
  const right = boxes.reduce((max, card) => Math.max(max, card.x + card.width), 40);
  const sourceIndex = cards.findIndex(card => card.id === UPSTREAM_CARD_ID);
  const y = sourceIndex >= 0 ? boxes[sourceIndex].y : 80;
  const design = { x: right + 80, y, width: 560, height: 460 };
  const play = { x: design.x + design.width + 64, y, width: 1120, height: 800 };
  if (!noOverlap([design, play]) || [design, play].some(next => boxes.some(existing => intersects(next, existing)))) {
    throw new Error('新增卡片布局与现有内容发生重叠');
  }
  return { design, play };
}

function plannedCards(layout, embedUrl, textSource) {
  return [
    {
      id: DESIGN_CARD_ID, kind: 'text', adapter: 'text', title: '共鸣玩法与参考',
      source: textSource, x: layout.design.x, y: layout.design.y,
      width: layout.design.width, height: layout.design.height, fontSize: 14,
    },
    {
      id: PLAY_CARD_ID, kind: 'material', adapter: 'web', title: '进入共鸣玩法',
      source: { kind: 'link', url: embedUrl }, x: layout.play.x, y: layout.play.y,
      width: layout.play.width, height: layout.play.height,
    },
  ];
}

function plannedRelations() {
  return [
    {
      id: 'resonance-upstream-to-design-20261009', source: UPSTREAM_CARD_ID, target: DESIGN_CARD_ID,
      kind: 'derived', programLabel: '设计与参考', path: 'curve', arrow: 'closed',
    },
    {
      id: 'resonance-upstream-to-play-20261009', source: UPSTREAM_CARD_ID, target: PLAY_CARD_ID,
      kind: 'derived', programLabel: '玩法实现', path: 'curve', arrow: 'closed',
    },
  ];
}

function repairedPlayCard(card, embedUrl) {
  if (!card || card.id !== PLAY_CARD_ID || card.kind !== 'material' || card.adapter !== 'web'
    || card.source?.kind !== 'link' || card.source?.url !== embedUrl) {
    throw new Error('现有游玩卡身份或source与预期不符；拒绝改动');
  }
  return { ...card, material: { ...(card.material ?? {}), live_entry: embedUrl } };
}

const UI_OPERATION_SECTION = [
  '## 界面与操作', '',
  '进入玩法后选择难度，阅读关卡介绍，再进入备战。每局使用固定赛季招募名单；完整干员图鉴位于首页的「战术图鉴」。',
  '备战时，底部显示金币、等级和商店；开始战斗后商店收起。点击金币图标查看利息与预计收入。招募卡整张底色区分费用，卡上可查看干员详情。',
  '左侧盟约列表用图标和当前人数展示队伍羁绊。点击“查看全部”可浏览所有盟约及全部人数档位；点击盟约名称或干员可查看详情。',
  '点击左侧装备栏入口查看装备与配方。装备图标显示在穿戴者身上；把组件拖到装备或干员上可合成、穿戴。奖励区默认显示当前和下一只宝箱，展开后查看完整奖励档位。',
  '“本局信息”可查看策略、操作说明和最近结算。备战时 D 刷新商店、F 购买经验、E 出售所指干员、W 部署或移回备战区；开始实时战斗后可暂停。退出时先暂停战斗并保存进度后返回；回到首页可继续本局。',
].join('\n');

function refreshedDesignBody(existingBody, entryUrl, referenceUrl, designRules) {
  if (typeof existingBody !== 'string' || !/^# 共鸣玩法与参考\r?\n/m.test(existingBody)
    || !/^## (?:体验与内容范围|玩法说明)\r?$/m.test(existingBody)) throw new Error('现有设计正文身份或玩法内容无法确认；拒绝覆盖');
  if (typeof designRules !== 'string' || !designRules.trim()) throw new Error('缺少当前正式设计规则');
  return `${DESIGN_BODY(entryUrl, referenceUrl, designRules).trim()}\n\n${UI_OPERATION_SECTION}\n`;
}

function validateRefreshTargets(cards, relations, embedUrl) {
  const byId = id => cards.filter(card => card.id === id);
  const [design] = byId(DESIGN_CARD_ID), [play] = byId(PLAY_CARD_ID);
  if (byId(DESIGN_CARD_ID).length !== 1 || byId(PLAY_CARD_ID).length !== 1
    || design?.kind !== 'text' || design.adapter !== 'text' || design.source?.kind !== 'file'
    || design.source.editableId !== DESIGN_CARD_ID || typeof design.source.path !== 'string'
    || typeof (design.source.token ?? design.source.open_token) !== 'string') {
    throw new Error('现有设计卡身份/source与预期不符；拒绝重建或修改');
  }
  repairedPlayCard(play, embedUrl);
  const expected = plannedRelations();
  for (const relation of expected) {
    const matches = relations.filter(item => item.id === relation.id);
    if (matches.length !== 1 || matches[0].source !== relation.source || matches[0].target !== relation.target
      || matches[0].kind !== relation.kind || matches[0].programLabel !== relation.programLabel) {
      throw new Error(`既有关联身份不符：${relation.id}；拒绝重建关系`);
    }
  }
  return { design, play };
}

function refreshedCards(design, play, bodyResult, embedUrl) {
  const bodyPath = bodyResult?.path;
  const bodyToken = bodyResult?.open_token ?? bodyResult?.token;
  const editableId = bodyResult?.editableId ?? bodyResult?.editable_id ?? DESIGN_CARD_ID;
  if (typeof bodyPath !== 'string' || !bodyPath || typeof bodyToken !== 'string' || !bodyToken || editableId !== DESIGN_CARD_ID) {
    throw new Error('文字正文桥未返回design卡对应的file、token与editableId');
  }
  const source = { ...design.source, kind: 'file', path: bodyPath, token: bodyToken,
    mime: bodyResult.mime ?? design.source.mime ?? 'text/markdown', editableId };
  return [
    { ...design, source },
    { ...play, material: { ...(play.material ?? {}), live_entry: embedUrl } },
  ];
}

function sameCardExceptSource(a, b) {
  const left = structuredClone(a), right = structuredClone(b);
  delete left.source; delete right.source;
  if (left.provenance && typeof left.provenance === 'object') delete left.provenance.updated;
  if (right.provenance && typeof right.provenance === 'object') delete right.provenance.updated;
  if (left.material?.revision_ref && typeof left.material.revision_ref === 'object') delete left.material.revision_ref.revision;
  if (right.material?.revision_ref && typeof right.material.revision_ref === 'object') delete right.material.revision_ref.revision;
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function verifyRefreshSnapshot(beforeCards, beforeRelations, afterCards, afterRelations, expectedCards, embedUrl) {
  if (afterCards.length !== beforeCards.length || JSON.stringify(stable(afterRelations)) !== JSON.stringify(stable(beforeRelations))) {
    throw new Error('刷新意外改变卡片数量或既有关联');
  }
  const expectedById = new Map(expectedCards.map(card => [card.id, card]));
  for (const original of beforeCards) {
    const now = afterCards.find(card => card.id === original.id);
    if (!now) throw new Error(`刷新后既有卡缺失：${original.id}`);
    if (original.id === DESIGN_CARD_ID) {
      const expected = expectedById.get(DESIGN_CARD_ID);
      if (!sameCardExceptSource(now, original) || JSON.stringify(stable(now.source)) !== JSON.stringify(stable(expected.source))) {
        throw new Error('设计卡几何或非source字段意外改变');
      }
    } else if (original.id === PLAY_CARD_ID) {
      if (!equalExceptNativeStamps(now, original) || now.material?.live_entry !== embedUrl) {
        throw new Error('玩法卡回读超出live_entry单字段更新');
      }
    } else if (JSON.stringify(stable(now)) !== JSON.stringify(stable(original))) {
      throw new Error(`其他卡片被意外改动：${original.id}`);
    }
  }
}

function equalExceptNativeStamps(a, b) {
  const withoutNativeStamps = value => {
    const copy = structuredClone(value);
    if (copy.material && typeof copy.material === 'object') delete copy.material.live_entry;
    if (copy.provenance && typeof copy.provenance === 'object') delete copy.provenance.updated;
    if (copy.material?.revision_ref && typeof copy.material.revision_ref === 'object') {
      delete copy.material.revision_ref.revision;
    }
    return stable(copy);
  };
  return JSON.stringify(withoutNativeStamps(a)) === JSON.stringify(withoutNativeStamps(b));
}

function selfTest() {
  if (httpErrorDetail({ error: 'workspace_scope_required', code: 'WORKSPACE_SCOPE' }) !== 'error=workspace_scope_required; code=WORKSPACE_SCOPE'
    || httpErrorDetail({ ok: false }) !== '') throw new Error('Workshop响应错误诊断纯测试失败');
  const headers = cliWriterHeaders({ machine: 'cm-1234567890abcdef', session: 'codex-thread', runtime: 'codex/1.0', software: 'wsh/0.18.0' });
  if (headers['x-workshop-machine'] !== 'cm-1234567890abcdef' || headers['x-workshop-session'] !== 'codex-thread'
    || headers['x-workshop-runtime'] !== 'codex/1.0' || headers['x-workshop-software'] !== 'wsh/0.18.0') {
    throw new Error('WSH写入身份头映射纯测试失败');
  }
  const layout = layoutFor([
    { id: 'a', x: 80, y: 80, width: 400, height: 300 },
    { id: 'group', x: 520, y: 100, width: 300, height: 500 },
    { id: UPSTREAM_CARD_ID, x: 80, y: 126, width: 100, height: 100 },
    { id: 'inside', parentId: 'group', x: 20, y: 40, width: 100, height: 100 },
  ]);
  const entryUrl = 'https://colorc.cc/stronghold/resonance.html';
  const embedUrl = 'https://workshop.colorc.cc/stronghold/resonance.html';
  const designRules = playerFacingDesign(fs.readFileSync(path.join(ROOT, 'docs/resonance/design.md'), 'utf8'));
  const cards = plannedCards(layout, embedUrl, { kind: 'file', path: '/tmp/ref.md', token: 'not-used' });
  const relations = plannedRelations();
  const testPlay = {
    id: PLAY_CARD_ID, kind: 'material', adapter: 'web', title: '进入共鸣玩法',
    source: { kind: 'link', url: embedUrl }, x: 100, y: 200, width: 1120, height: 800,
    material: { representations: [{ id: 'canvas-card', media_type: 'text/markdown', role: 'primary' }] },
  };
  const repaired = repairedPlayCard(testPlay, embedUrl);
  const testDesign = { id: DESIGN_CARD_ID, kind: 'text', adapter: 'text', title: '共鸣玩法与参考',
    source: { kind: 'file', path: '/old/design.md', token: 'old-token', mime: 'text/markdown', editableId: DESIGN_CARD_ID },
    material: { revision_ref: { provider: 'material-note', object: 'canvas#card=design', revision: 'r267' } },
    x: 900, y: 126, width: 560, height: 460, fontSize: 14 };
  const oldDesignBody = '# 共鸣玩法与参考\n\n打开[共鸣玩法](https://old.invalid/resonance.html)。完整资料可从[参考资料包](https://old.invalid/reference.zip)下载。\n\n## 体验与内容范围\n\n玩家按局内节点构建阵容。\n\n谢拉格寒冷/冻结/地板。\n\n## 界面与操作\n\n旧操作说明。';
  const nextDesignBody = refreshedDesignBody(oldDesignBody, entryUrl, 'https://example.invalid/reference.zip', designRules);
  if (nextDesignBody.includes('旧操作说明。') || nextDesignBody.includes('谢拉格寒冷/冻结/地板')
    || !nextDesignBody.includes('固定赛季') || !nextDesignBody.includes('全部人数档位')
    || !nextDesignBody.includes('实时战斗') || nextDesignBody.includes('选择难度、战场')
    || !nextDesignBody.includes(UI_OPERATION_SECTION) || !nextDesignBody.includes(entryUrl)) throw new Error('refresh正式规则/固定赛季/操作说明纯测试失败');
  if(refreshedDesignBody(nextDesignBody,entryUrl,'https://example.invalid/reference.zip',designRules)!==nextDesignBody)throw new Error('refresh重复执行不能累加旧说明');
  const refreshSources = refreshedCards(testDesign, testPlay, { path: '/new/design.md', open_token: 'new-token', editableId: DESIGN_CARD_ID }, embedUrl);
  const refreshBeforeCards = [testDesign, testPlay, { id: 'user-card', kind: 'text', source: { path: '/user.md' }, x: 10, y: 12, width: 200, height: 100 }];
  const refreshAfterCards = [...refreshBeforeCards.filter(card => ![DESIGN_CARD_ID, PLAY_CARD_ID].includes(card.id)), ...refreshSources];
  refreshAfterCards.find(card => card.id === DESIGN_CARD_ID).material.revision_ref.revision = 'r268';
  const refreshRelations = plannedRelations();
  verifyRefreshSnapshot(refreshBeforeCards, refreshRelations, refreshAfterCards, refreshRelations, refreshSources, embedUrl);
  const movedDesignCards = structuredClone(refreshAfterCards);
  movedDesignCards.find(card => card.id === DESIGN_CARD_ID).x += 1;
  let geometryChangeRejected = false;
  try { verifyRefreshSnapshot(refreshBeforeCards, refreshRelations, movedDesignCards, refreshRelations, refreshSources, embedUrl); }
  catch { geometryChangeRejected = true; }
  if (!geometryChangeRejected) throw new Error('refresh必须拒绝设计卡几何变化');
  if (refreshSources[0].source.token !== 'new-token' || refreshSources[0].source.editableId !== DESIGN_CARD_ID
    || refreshSources[0].x !== testDesign.x || refreshSources[1].x !== testPlay.x) throw new Error('refresh只更新正文source与live_entry纯测试失败');
  for (const args of [['--repair-play-card','--refresh-existing'], ['--refresh-existing','--execute','--dry-run']]) {
    let rejected = false; try { parseArgs(args); } catch { rejected = true; }
    if (!rejected) throw new Error('repair/refresh或execute/dry-run混用保护纯测试失败');
  }
  let missingDesignRejected = false;
  try { validateRefreshTargets([testPlay], refreshRelations, embedUrl); } catch { missingDesignRejected = true; }
  if (!missingDesignRejected) throw new Error('refresh固定设计目标缺失保护纯测试失败');
  const stampedPlay = structuredClone(repaired);
  stampedPlay.provenance = { created: { kind: 'agent', ref: 'original-creator' }, updated: { kind: 'agent', ref: 'native-writer' } };
  stampedPlay.material.revision_ref = { provider: 'material-note', object: 'canvas#card=play', revision: 'r265' };
  testPlay.provenance = { created: { kind: 'agent', ref: 'original-creator' }, updated: { kind: 'agent', ref: 'original-writer' } };
  testPlay.material.revision_ref = { provider: 'material-note', object: 'canvas#card=play', revision: 'r264' };
  if (!equalExceptNativeStamps(testPlay, stampedPlay) || repaired.material.live_entry !== embedUrl
    || repairedPlayCard(repaired, embedUrl).material.live_entry !== embedUrl) throw new Error('游玩卡单字段/幂等纯测试失败');
  const semanticallyChanged = structuredClone(stampedPlay);
  semanticallyChanged.material.displaySummary = 'unexpected semantic change';
  if (equalExceptNativeStamps(testPlay, semanticallyChanged)) throw new Error('非系统戳语义字段变更未被拒绝');
  let wrongSourceRejected = false;
  try { repairedPlayCard({ ...testPlay, source: { kind: 'link', url: 'https://elsewhere.invalid/resonance.html' } }, embedUrl); }
  catch { wrongSourceRejected = true; }
  if (!wrongSourceRejected) throw new Error('游玩卡source保护纯测试失败');
  if (!noOverlap([...cards.map(card => ({ ...card })), { x: 0, y: 0, width: 1, height: 1 }])) throw new Error('布局纯测试失败');
  if (cards[0].kind !== 'text' || cards[0].source.kind !== 'file' || cards[1].kind !== 'material'
    || cards[1].adapter !== 'web' || cards[1].source.url !== embedUrl || cards[1].source.url === entryUrl
    || !DESIGN_BODY(entryUrl, 'https://example.invalid/reference.zip', designRules).includes(entryUrl)) throw new Error('独立入口与嵌入入口分离纯测试失败');
  for (const phrase of ['经验', '全部人数档位', '独立装备库存', '实时战斗', '最终结果']) if (!designRules.includes(phrase)) throw new Error(`设计卡正文缺少玩法说明：${phrase}`);
  if (/完整招募目录采用|recording:false|reference\/|T-\d+|E:\\WindowsWorkspace/i.test(designRules)) throw new Error('设计卡正文包含内部说明或绝对路径');
  if (validateEmbedUrl(embedUrl, 'https://workshop.colorc.cc') !== embedUrl) throw new Error('Workshop同源嵌入页验证失败');
  for (const invalid of ['https://colorc.cc/stronghold/resonance.html', 'https://workshop.colorc.cc/stronghold/independent.html']) {
    let rejected = false; try { validateEmbedUrl(invalid, 'https://workshop.colorc.cc'); } catch { rejected = true; }
    if (!rejected) throw new Error('非Workshop同源或非共鸣页面未被拒绝');
  }
  if (relations.length !== 2 || relations.some(relation => relation.source !== UPSTREAM_CARD_ID || relation.arrow !== 'closed' || relation.kind !== 'derived')
    || relations[0].programLabel !== '设计与参考' || relations[1].programLabel !== '玩法实现') throw new Error('关系schema纯测试失败');
  if (apiUrl('https://workshop.colorc.cc/bside/', '/api/canvases/x').pathname !== '/bside/api/canvases/x') throw new Error('Workshop网关路径纯测试失败');
  process.stdout.write(JSON.stringify({ ok: true, layout: { design: layout.design, play: layout.play }, cards: cards.length, relations: relations.length }) + '\n');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function unwrap(value) {
  return value && typeof value === 'object' && 'result' in value ? value.result : value;
}

function contentItems(response) {
  const payload = unwrap(response) ?? {};
  const items = payload.items ?? payload.materials ?? payload.texts ?? [];
  return Array.isArray(items) ? items : Object.values(items);
}

function httpErrorDetail(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const parts = [];
  for (const key of ['error', 'message', 'code', 'hint', 'detail']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) parts.push(`${key}=${value.trim().slice(0, 400)}`);
  }
  if (Array.isArray(payload.missing)) parts.push(`missing=${payload.missing.filter(value => typeof value === 'string').join(',').slice(0, 200)}`);
  return parts.join('; ');
}

function cliWriterHeaders(writer) {
  const values = {
    'x-workshop-machine': writer?.machine,
    'x-workshop-session': writer?.session,
    'x-workshop-runtime': writer?.runtime,
    'x-workshop-software': writer?.software,
  };
  if (Object.values(values).some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('WSH写入身份不完整；请按官方CLI登记机器并确认会话身份');
  }
  return values;
}

function readCliWriterHeaders(serverBase) {
  let response;
  try {
    const stdout = execFileSync(process.execPath, [WSH_CLI_PATH, 'whoami', '--json', '--server', serverBase, '--project', PROJECT_ID], {
      encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    response = JSON.parse(stdout);
  } catch {
    throw new Error('无法从正式 WSH CLI 读取写入身份；未发送任何写请求');
  }
  return cliWriterHeaders(response?.writer);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(`${HELP}\n`);
  if (options.selfTest) return selfTest();
  if (options.repairPlayCard && (options['entry-url'] || options['reference-url'])) throw new Error('--repair-play-card 不接受新交付内容参数');
  const entryUrl = options.repairPlayCard ? null : httpsUrl(options['entry-url'], '--entry-url');
  const embedUrl = options['embed-url'] ? httpsUrl(options['embed-url'], '--embed-url') : entryUrl;
  if (options.repairPlayCard && !options['embed-url']) throw new Error('--repair-play-card 必须提供 --embed-url');
  const referenceUrl = options.repairPlayCard ? null : httpsUrl(options['reference-url'], '--reference-url');
  const designRules = options.repairPlayCard ? null : playerFacingDesign(fs.readFileSync(path.join(ROOT, 'docs/resonance/design.md'), 'utf8'));
  const releaseReceiptPath = absoluteFile(options['release-receipt'], '--release-receipt');
  const receiptPath = absoluteFile(options.receipt, '--receipt');
  if (fs.existsSync(receiptPath)) throw new Error(`receipt 已存在，为避免覆盖而停止：${receiptPath}`);
  if (!fs.statSync(path.dirname(receiptPath)).isDirectory()) throw new Error('--receipt 的父目录必须已存在');
  const release = validateReleaseReceipt(releaseReceiptPath);
  const localConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (typeof localConfig.token !== 'string' || !localConfig.token.trim()) throw new Error('WSH 配置中没有有效令牌');
  const serverUrl = new URL(localConfig.server || SERVER_FALLBACK);
  if (serverUrl.protocol !== 'https:' || serverUrl.username || serverUrl.password) throw new Error('WSH server 必须是无凭据的 HTTPS URL');
  if (options['embed-url']) validateEmbedUrl(embedUrl, serverUrl.origin);
  const serverBase = serverUrl.toString().replace(/\/+$/, '');
  const writerHeaders = readCliWriterHeaders(serverBase);
  const headers = {
    accept: 'application/json', authorization: `Bearer ${localConfig.token}`,
    'content-type': 'application/json', 'x-workshop-project': PROJECT_ID,
    ...writerHeaders,
  };
  async function request(method, endpoint, body) {
    const response = await fetch(apiUrl(serverBase, endpoint), {
      method, headers, signal: AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let result;
    try { result = raw ? JSON.parse(raw) : null; } catch { throw new Error(`Workshop 返回非JSON响应（HTTP ${response.status}）`); }
    if (!response.ok) {
      const detail = httpErrorDetail(result);
      throw new Error(`Workshop 请求失败（HTTP ${response.status}，${method} ${endpoint}${detail ? `：${detail}` : ''}）`);
    }
    return result;
  }
  const readCanvas = () => request('GET', `/api/canvases/${encodeURIComponent(CANVAS_ID)}`);
  const readTexts = async ids => contentItems(await request('POST', '/lofa/overlay/invoke', {
    cmd: 'notes_text_get_many', args: { ids },
  }));
  const currentResponse = await readCanvas();
  const current = currentResponse?.document;
  if (!current || !Array.isArray(current.cards) || !Array.isArray(current.relations)) throw new Error('画布文档结构无效');
  if (options.refreshExisting) {
    const { design, play } = validateRefreshTargets(current.cards, current.relations, embedUrl);
    const textIds = current.cards.filter(card => card.kind === 'text').map(card => card.source?.editableId ?? card.id);
    const textsBefore = await readTexts(textIds);
    const designText = textsBefore.find(item => (item.id ?? item.editableId) === DESIGN_CARD_ID);
    const existingBody = designText?.content ?? designText?.text ?? designText?.body;
    const nextBody = refreshedDesignBody(existingBody, entryUrl, referenceUrl, designRules);
    const beforeCards = structuredClone(current.cards), beforeRelations = structuredClone(current.relations);
    const workspaceRef = currentResponse.workspace_ref ?? current._workspaceRef;
    if (!workspaceRef) throw new Error('画布缺少workspace_ref，无法安全提交');
    const preview = {
      status: options.execute ? 'prepared' : 'dry-run', mode: 'refresh-existing', canvas: CANVAS_ID,
      baseRevision: current.revision, sourceRevision: release.sourceRevision,
      designCardId: DESIGN_CARD_ID, playCardId: PLAY_CARD_ID, entryUrl, embedUrl,
      existingRelationsPreserved: true, bodyRefreshPlanned: true,
      mutationPlanned: Boolean(options.execute), receiptPath,
    };
    fs.writeFileSync(receiptPath, JSON.stringify(preview, null, 2) + '\n', { flag: 'wx' });
    if (!options.execute) {
      process.stdout.write(JSON.stringify(preview) + '\n');
      return;
    }
    try {
      const bodyResult = unwrap(await request('POST', '/lofa/overlay/invoke', {
        cmd: 'notes_text_put', args: { id: DESIGN_CARD_ID, content: nextBody },
      })) ?? {};
      const nextCards = refreshedCards(design, play, bodyResult, embedUrl);
      const mutation = await request('POST', `/api/canvases/${encodeURIComponent(CANVAS_ID)}/mutations`, {
        workspace_ref: workspaceRef,
        actor_ref: { kind: 'agent', ref: 'resonance-workshop-delivery' },
        base_revision: current.revision,
        idempotency_key: `resonance-refresh-${crypto.randomUUID()}`,
        purpose: '刷新共鸣玩法说明与界面入口',
        patch: { upsert_cards: nextCards },
      });
      const afterResponse = await readCanvas();
      const after = afterResponse?.document;
      if (!after || after.revision <= current.revision) throw new Error('画布回读revision未前进');
      verifyRefreshSnapshot(beforeCards, beforeRelations, after.cards, after.relations, nextCards, embedUrl);
      const textsAfter = await readTexts(textIds);
      const bodyOf = item => item?.content ?? item?.text ?? item?.body;
      for (const before of textsBefore) {
        const id = before.id ?? before.editableId;
        const afterText = textsAfter.find(item => (item.id ?? item.editableId) === id);
        if (!afterText || bodyOf(afterText) !== (id === DESIGN_CARD_ID ? nextBody : bodyOf(before))) {
          throw new Error(`文字正文回读超出设计卡更新范围：${id}`);
        }
      }
      const result = {
        ...preview, status: 'complete', revision: after.revision,
        mutationRevision: mutation?.document?.revision ?? after.revision,
        verified: { designBodyUpdated: true, designGeometryPreserved: true, playLiveEntryUpdated: true, otherCardsUnchanged: true, relationsUnchanged: true, otherTextBodiesUnchanged: true },
      };
      fs.writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n');
      process.stdout.write(JSON.stringify(result) + '\n');
    } catch (error) {
      const failed = { ...preview, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      fs.writeFileSync(receiptPath, JSON.stringify(failed, null, 2) + '\n');
      throw error;
    }
    return;
  }
  if (options.repairPlayCard) {
    const oldPlay = current.cards.find(card => card.id === PLAY_CARD_ID);
    const nextPlay = repairedPlayCard(oldPlay, embedUrl);
    const beforeCards = new Map(current.cards.map(card => [card.id, stable(card)]));
    const beforeRelations = stable(current.relations);
    const textIds = current.cards.filter(card => card.kind === 'text').map(card => card.id);
    const textsBefore = stable(await readTexts(textIds));
    const workspaceRef = currentResponse.workspace_ref ?? current._workspaceRef;
    if (!workspaceRef) throw new Error('画布缺少workspace_ref，无法安全提交');
    const alreadyCorrect = oldPlay.material?.live_entry === embedUrl;
    const preview = {
      status: options.execute ? 'prepared' : 'dry-run', mode: 'repair-play-card', canvas: CANVAS_ID,
      baseRevision: current.revision, sourceRevision: release.sourceRevision,
      cardId: PLAY_CARD_ID, embedUrl, alreadyCorrect,
      mutationPlanned: Boolean(options.execute && !alreadyCorrect), receiptPath,
    };
    fs.writeFileSync(receiptPath, JSON.stringify(preview, null, 2) + '\n', { flag: 'wx' });
    if (!options.execute || alreadyCorrect) {
      const result = { ...preview, status: alreadyCorrect ? 'already-correct' : 'dry-run', verified: { targetIdentity: true, sourceUnchanged: true } };
      fs.writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n');
      process.stdout.write(JSON.stringify(result) + '\n');
      return;
    }
    try {
      const mutation = await request('POST', `/api/canvases/${encodeURIComponent(CANVAS_ID)}/mutations`, {
        workspace_ref: workspaceRef,
        actor_ref: { kind: 'agent', ref: 'resonance-workshop-delivery' },
        base_revision: current.revision,
        idempotency_key: `resonance-play-repair-${crypto.randomUUID()}`,
        purpose: '为现有共鸣玩法卡补充游玩入口',
        patch: { upsert_cards: [nextPlay] },
      });
      const afterResponse = await readCanvas();
      const after = afterResponse?.document;
      if (!after || after.revision <= current.revision) throw new Error('画布回读revision未前进');
      if (after.cards.length !== beforeCards.size || JSON.stringify(stable(after.relations)) !== JSON.stringify(beforeRelations)) {
        throw new Error('卡片数量或关系被意外改动');
      }
      for (const [id, original] of beforeCards) {
        const now = after.cards.find(card => card.id === id);
        if (!now) throw new Error(`既有卡缺失：${id}`);
        if (id === PLAY_CARD_ID) {
          if (!equalExceptNativeStamps(now, JSON.parse(JSON.stringify(oldPlay))) || now.material?.live_entry !== embedUrl) {
            throw new Error('游玩卡回读超出live_entry单字段变更');
          }
        } else if (JSON.stringify(stable(now)) !== JSON.stringify(original)) throw new Error(`既有卡被意外改动：${id}`);
      }
      const textsAfter = stable(await readTexts(textIds));
      if (JSON.stringify(textsAfter) !== JSON.stringify(textsBefore)) throw new Error('既有文字正文发生变化');
      const result = {
        ...preview, status: 'complete', revision: after.revision,
        mutationRevision: mutation?.document?.revision ?? after.revision,
        verified: { onlyLiveEntryChanged: true, allOtherCardsUnchanged: true, relationsUnchanged: true, textBodiesUnchanged: true },
      };
      fs.writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n');
      process.stdout.write(JSON.stringify(result) + '\n');
    } catch (error) {
      const failed = { ...preview, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      fs.writeFileSync(receiptPath, JSON.stringify(failed, null, 2) + '\n');
      throw error;
    }
    return;
  }
  const upstream = current.cards.find(card => card.id === UPSTREAM_CARD_ID);
  if (!upstream || upstream.kind !== 'text') throw new Error('指定上游卡不存在或不是文字卡');
  const currentText = (await readTexts([UPSTREAM_CARD_ID])).find(item => (item.id ?? item.editableId) === UPSTREAM_CARD_ID);
  const upstreamBody = currentText?.content ?? currentText?.text ?? currentText?.body;
  if (typeof upstreamBody !== 'string' || !upstreamBody.trim()) throw new Error('指定上游文字卡正文无法读取');
  if (current.cards.some(card => card.id === PLAY_CARD_ID || card.id === DESIGN_CARD_ID)
    || current.relations.some(relation => relation.id === 'resonance-upstream-to-design-20261009' || relation.id === 'resonance-upstream-to-play-20261009')) {
    throw new Error('计划使用的固定卡或关系ID已存在；为避免改动既有内容，停止执行');
  }
  const layout = layoutFor(current.cards);
  const beforeCards = new Map(current.cards.map(card => [card.id, stable(card)]));
  const beforeRelations = new Map(current.relations.map(relation => [relation.id, stable(relation)]));
  const preview = {
    status: options.execute ? 'prepared' : 'dry-run', canvas: CANVAS_ID,
    baseRevision: current.revision, sourceRevision: release.sourceRevision,
    sourceCard: { id: UPSTREAM_CARD_ID, bodyReadable: true },
    plannedCards: [
      { id: DESIGN_CARD_ID, kind: 'text', title: '共鸣玩法与参考', geometry: layout.design },
      { id: PLAY_CARD_ID, kind: 'material', adapter: 'web', title: '进入共鸣玩法', sourceUrl: embedUrl, geometry: layout.play },
    ],
    entryUrl, embedUrl,
    plannedRelations: plannedRelations().map(({ id, source, target, kind, trigger, programLabel }) => ({ id, source, target, kind, trigger, label: programLabel })),
    referencesUrl: referenceUrl, releaseArchivePath: release.archivePath,
    mutationPlanned: Boolean(options.execute), receiptPath,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(preview, null, 2) + '\n', { flag: 'wx' });
  if (!options.execute) {
    process.stdout.write(JSON.stringify(preview) + '\n');
    return;
  }

  try {
    const bodyResult = unwrap(await request('POST', '/lofa/overlay/invoke', {
      cmd: 'notes_text_put', args: { id: DESIGN_CARD_ID, content: DESIGN_BODY(entryUrl, referenceUrl, designRules) },
    })) ?? {};
    const bodyPath = bodyResult.path;
    const bodyToken = bodyResult.open_token ?? bodyResult.token;
    if (typeof bodyPath !== 'string' || typeof bodyToken !== 'string') throw new Error('文字正文桥未返回file source');
    const cards = plannedCards(layout, embedUrl, { kind: 'file', path: bodyPath, token: bodyToken, mime: bodyResult.mime ?? 'text/markdown', editableId: DESIGN_CARD_ID });
    const relations = plannedRelations();
    const workspaceRef = currentResponse.workspace_ref ?? current._workspaceRef;
    if (!workspaceRef) throw new Error('画布缺少workspace_ref，无法安全提交');
    const mutation = await request('POST', `/api/canvases/${encodeURIComponent(CANVAS_ID)}/mutations`, {
      workspace_ref: workspaceRef,
      actor_ref: { kind: 'agent', ref: 'resonance-workshop-delivery' },
      base_revision: current.revision,
      idempotency_key: `resonance-delivery-${crypto.randomUUID()}`,
      purpose: '新增共鸣玩法入口与设计参考卡',
      patch: { upsert_cards: cards, upsert_relations: relations },
    });
    const afterResponse = await readCanvas();
    const after = afterResponse?.document;
    if (!after || after.revision <= current.revision) throw new Error('画布回读revision未前进');
    for (const [id, original] of beforeCards) {
      const now = after.cards.find(card => card.id === id);
      if (!now || JSON.stringify(stable(now)) !== JSON.stringify(original)) throw new Error(`既有卡被意外改动：${id}`);
    }
    for (const [id, original] of beforeRelations) {
      const now = after.relations.find(relation => relation.id === id);
      if (!now || JSON.stringify(stable(now)) !== JSON.stringify(original)) throw new Error(`既有关系被意外改动：${id}`);
    }
    const newDesign = after.cards.find(card => card.id === DESIGN_CARD_ID);
    const newPlay = after.cards.find(card => card.id === PLAY_CARD_ID);
    const relationById = new Map(after.relations.map(relation => [relation.id, relation]));
    if (!newDesign || !newPlay || newDesign.x !== layout.design.x || newDesign.y !== layout.design.y
      || newDesign.width !== layout.design.width || newDesign.height !== layout.design.height
      || newPlay.x !== layout.play.x || newPlay.y !== layout.play.y
      || newPlay.width !== layout.play.width || newPlay.height !== layout.play.height
      || !relationById.has('resonance-upstream-to-design-20261009') || !relationById.has('resonance-upstream-to-play-20261009')) {
      throw new Error('新卡几何或关系回读校验失败');
    }
    if (newDesign.source?.kind !== 'file' || newDesign.source?.editableId !== DESIGN_CARD_ID) throw new Error('设计文字卡source回读失败');
    if (newPlay.source?.kind !== 'link' || newPlay.source?.url !== embedUrl || newPlay.adapter !== 'web') throw new Error('游玩卡嵌入source回读失败');
    const expectedRelations = plannedRelations();
    for (const expected of expectedRelations) {
      const actual = relationById.get(expected.id);
      if (actual?.source !== expected.source || actual?.target !== expected.target || actual?.kind !== expected.kind
        || actual?.programLabel !== expected.programLabel || (expected.trigger && actual?.trigger !== expected.trigger)) {
        throw new Error(`有向语义关系回读失败：${expected.id}`);
      }
    }
    const newBoxes = absoluteBoxes([newDesign, newPlay]);
    const oldBoxes = absoluteBoxes(after.cards.filter(card => card.id !== DESIGN_CARD_ID && card.id !== PLAY_CARD_ID));
    if (!noOverlap(newBoxes) || newBoxes.some(box => oldBoxes.some(existing => intersects(box, existing)))) {
      throw new Error('提交后的新卡与现有内容发生几何重叠');
    }
    const textItems = await readTexts([UPSTREAM_CARD_ID, DESIGN_CARD_ID]);
    const originalAfter = textItems.find(item => (item.id ?? item.editableId) === UPSTREAM_CARD_ID);
    const designAfter = textItems.find(item => (item.id ?? item.editableId) === DESIGN_CARD_ID);
    const originalBodyAfter = originalAfter?.content ?? originalAfter?.text ?? originalAfter?.body;
    const designBodyAfter = designAfter?.content ?? designAfter?.text ?? designAfter?.body;
    if (originalBodyAfter !== upstreamBody || designBodyAfter !== DESIGN_BODY(entryUrl, referenceUrl, designRules)) throw new Error('文字正文回读与预期不符');
    const done = {
      ...preview, status: 'complete', revision: after.revision,
      verified: { originalCardsUnchanged: true, originalRelationsUnchanged: true, sourceBodyUnchanged: true, newDesignBody: true, newPlaySource: true, geometry: true, relations: true },
      mutationRevision: mutation?.document?.revision ?? after.revision,
    };
    fs.writeFileSync(receiptPath, JSON.stringify(done, null, 2) + '\n');
    process.stdout.write(JSON.stringify(done) + '\n');
  } catch (error) {
    const failed = { ...preview, status: 'failed', error: error instanceof Error ? error.message : String(error) };
    fs.writeFileSync(receiptPath, JSON.stringify(failed, null, 2) + '\n');
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
