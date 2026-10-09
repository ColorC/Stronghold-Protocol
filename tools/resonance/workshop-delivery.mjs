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

const DESIGN_BODY = (entryUrl, referenceUrl) => [
  '# 共鸣玩法与参考',
  '',
  `打开[共鸣玩法](${entryUrl})。完整资料可从[参考资料包](${referenceUrl})下载。`,
  '',
  '## 经营与招募',
  '干员按费用分档，玩家在购买干员、追求升星和提升人口之间分配金币。开局选择的环境会影响本局可招募名单，并贯穿本局。',
  '',
  '## 固定技能与盟约',
  '每名干员使用固定技能，星级会改变技能效果。盟约根据上阵干员即时生效；调整阵容会改变盟约档位。',
  '',
  '## 装备与策略',
  '装备由组件按配方合成，可在干员之间调整。经营节点提供策略选择；策略可能带来即时收益、任务目标、延迟回报或规则变化。详情中可以查看技能、盟约、装备配方与策略条件。',
].join('\n');

const HELP = `用法：node tools/resonance/workshop-delivery.mjs [--dry-run|--execute] --entry-url URL [--embed-url URL] --reference-url URL --release-receipt FILE --receipt FILE\n       node tools/resonance/workshop-delivery.mjs --self-test\n默认只执行只读预览；只有显式 --execute 才写入 Workshop。`;

function parseArgs(argv) {
  const options = { execute: false, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--dry-run') options.execute = false;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (['--entry-url', '--embed-url', '--reference-url', '--release-receipt', '--receipt'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`缺少 ${arg} 的值`);
      options[arg.slice(2)] = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (options.execute && argv.includes('--dry-run')) throw new Error('--execute 与 --dry-run 不能同时使用');
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

function selfTest() {
  const layout = layoutFor([
    { id: 'a', x: 80, y: 80, width: 400, height: 300 },
    { id: 'group', x: 520, y: 100, width: 300, height: 500 },
    { id: UPSTREAM_CARD_ID, x: 80, y: 126, width: 100, height: 100 },
    { id: 'inside', parentId: 'group', x: 20, y: 40, width: 100, height: 100 },
  ]);
  const entryUrl = 'https://colorc.cc/stronghold/resonance.html';
  const embedUrl = 'https://workshop.colorc.cc/stronghold/resonance.html';
  const cards = plannedCards(layout, embedUrl, { kind: 'file', path: '/tmp/ref.md', token: 'not-used' });
  const relations = plannedRelations();
  if (!noOverlap([...cards.map(card => ({ ...card })), { x: 0, y: 0, width: 1, height: 1 }])) throw new Error('布局纯测试失败');
  if (cards[0].kind !== 'text' || cards[0].source.kind !== 'file' || cards[1].kind !== 'material'
    || cards[1].adapter !== 'web' || cards[1].source.url !== embedUrl || cards[1].source.url === entryUrl
    || !DESIGN_BODY(entryUrl, 'https://example.invalid/reference.zip').includes(entryUrl)) throw new Error('独立入口与嵌入入口分离纯测试失败');
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

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(`${HELP}\n`);
  if (options.selfTest) return selfTest();
  const entryUrl = httpsUrl(options['entry-url'], '--entry-url');
  const embedUrl = options['embed-url'] ? httpsUrl(options['embed-url'], '--embed-url') : entryUrl;
  const referenceUrl = httpsUrl(options['reference-url'], '--reference-url');
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
  const headers = {
    accept: 'application/json', authorization: `Bearer ${localConfig.token}`,
    'content-type': 'application/json', 'x-workshop-project': PROJECT_ID,
  };
  async function request(method, endpoint, body) {
    const response = await fetch(apiUrl(serverBase, endpoint), {
      method, headers, signal: AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let result;
    try { result = raw ? JSON.parse(raw) : null; } catch { throw new Error(`Workshop 返回非JSON响应（HTTP ${response.status}）`); }
    if (!response.ok) throw new Error(`Workshop 请求失败（HTTP ${response.status}，${method} ${endpoint}）`);
    return result;
  }
  const readCanvas = () => request('GET', `/api/canvases/${encodeURIComponent(CANVAS_ID)}`);
  const readTexts = async ids => contentItems(await request('POST', '/lofa/overlay/invoke', {
    cmd: 'notes_text_get_many', args: { ids },
  }));
  const currentResponse = await readCanvas();
  const current = currentResponse?.document;
  if (!current || !Array.isArray(current.cards) || !Array.isArray(current.relations)) throw new Error('画布文档结构无效');
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
      cmd: 'notes_text_put', args: { id: DESIGN_CARD_ID, content: DESIGN_BODY(entryUrl, referenceUrl) },
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
    if (originalBodyAfter !== upstreamBody || designBodyAfter !== DESIGN_BODY(entryUrl, referenceUrl)) throw new Error('文字正文回读与预期不符');
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
