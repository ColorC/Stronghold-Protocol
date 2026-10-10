const CANVAS_ID = 'canvas-0470c0a1';
const PROJECT_ID = 'arknights';
const CARD_WIDTH = 1440;
const CARD_HEIGHT = 1060;
const CARD_GAP = 160;

function responseError(status, body) {
  const code = typeof body?.error === 'string' ? body.error : '';
  const detail = typeof body?.detail === 'string' ? body.detail : '';
  if (status === 401) return Object.assign(new Error('Workshop 会话已失效，请先在当前浏览器登录后重试。'), { status });
  if (status === 403) return Object.assign(new Error('当前 Workshop 账号无权编辑这张项目画布。'), { status });
  return Object.assign(new Error('画布操作未完成，请稍后重试。'), { status, code, detail });
}

async function readJson(response) {
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw responseError(response.status, body);
  return body;
}

function randomId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') throw new Error('当前浏览器不支持安全随机标识，未写入画布。');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateInput(recordingId, reviewUrl) {
  if (typeof recordingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recordingId)) {
    throw new Error('录像标识无效，未写入画布。');
  }
  if (typeof reviewUrl !== 'string' || !reviewUrl.trim()) throw new Error('回放页面地址缺失，未写入画布。');
  let parsed;
  try { parsed = new URL(reviewUrl, globalThis.location?.href); } catch { throw new Error('回放页面地址无效，未写入画布。'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('回放地址必须是普通网页链接，未写入画布。');
  }
  return { recordingId: recordingId.toLowerCase(), reviewUrl: parsed.href };
}

function positionRightOfCards(cards) {
  const topLevel = cards.filter((card) => !card.parentId && [card.x, card.y, card.width, card.height].every(Number.isFinite));
  if (!topLevel.length) return { x: 80, y: 80 };
  const right = Math.max(...topLevel.map((card) => card.x + card.width));
  const top = Math.min(...topLevel.map((card) => card.y));
  return { x: right + CARD_GAP, y: top };
}

function makeCard(recordingId, reviewUrl, position) {
  const cardId = `replay-${recordingId}`;
  const materialRef = `material:arknights/replay/${recordingId}`;
  const representationId = `replay-iframe-${recordingId}`;
  return {
    id: cardId,
    kind: 'material',
    title: '本局游玩回放与批注',
    text: '',
    material: {
      material_ref: materialRef,
      representation_id: representationId,
      runtime: 'iframe',
      metadata: {
        referenced_material_id: materialRef,
        representation_id: representationId,
        runtime: 'iframe',
        recording_id: recordingId,
      },
    },
    source: { kind: 'link', url: reviewUrl },
    adapter: 'web',
    x: position.x,
    y: position.y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  };
}

function canvasUrl(documentId, cardId) {
  return `/bside/canvas?project=${encodeURIComponent(PROJECT_ID)}&canvas=${encodeURIComponent(documentId)}#card=${encodeURIComponent(cardId)}`;
}

/** Add or locate one replay card on the existing Arknights review canvas. */
export async function mountReplayInCanvas({ recordingId, reviewUrl, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('当前浏览器无法连接 Workshop，未写入画布。');
  const input = validateInput(recordingId, reviewUrl);
  const cardId = `replay-${input.recordingId}`;
  const headers = { 'x-workshop-project': PROJECT_ID, accept: 'application/json' };
  const request = async (path, init = {}) => readJson(await fetchImpl(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...headers, ...(init.headers ?? {}) },
  }));

  // Resolve identity from the existing browser session so the mutation is attributed to
  // the signed-in Workshop user; do not synthesize an actor or fall back to machine auth.
  const principal = await request('/bside/api/workspace-auth/principal');
  const userId = principal?.user?.id;
  const userName = principal?.user?.name;
  if (typeof userId !== 'string' || !userId || typeof userName !== 'string' || !userName) {
    throw new Error('Workshop 登录身份无法确认，未写入画布。');
  }

  const readCanvas = async () => {
    const response = await request(`/bside/api/canvases/${encodeURIComponent(CANVAS_ID)}`);
    const document = response?.document;
    if (!document || !Number.isInteger(document.revision) || !Array.isArray(document.cards)) {
      throw new Error('Workshop 返回的画布内容不完整，未写入画布。');
    }
    const workspaceRef = response.workspace_ref ?? document._workspaceRef;
    if (!workspaceRef || typeof workspaceRef.kind !== 'string' || typeof workspaceRef.ref !== 'string') {
      throw new Error('无法识别画布，请重新打开工坊后重试。');
    }
    return { document, workspaceRef };
  };

  let current = await readCanvas();
  const existing = current.document.cards.find((card) => card.id === cardId);
  if (existing) return { ok: true, created: false, cardId, revision: current.document.revision, url: canvasUrl(CANVAS_ID, cardId) };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const mutationId = randomId();
    const card = makeCard(input.recordingId, input.reviewUrl, positionRightOfCards(current.document.cards));
    const payload = {
      workspace_ref: current.workspaceRef,
      actor_ref: { kind: 'user', ref: userId },
      base_revision: current.document.revision,
      idempotency_key: `replay-canvas-${input.recordingId}-${mutationId}`,
      mutation_id: mutationId,
      identity: {
        principal: 'human',
        machine: { id: 'stronghold-protocol-review-browser', owner: userId },
        human: { name: userName, input: 'mouse', device: 'browser' },
        software: { name: 'Stronghold Protocol review' },
        purpose: '将本局回放关联到项目画布',
        captured_by: 'browser',
        at: new Date().toISOString(),
      },
      patch: { upsert_cards: [card] },
    };

    let result;
    try {
      result = await request(`/bside/api/canvases/${encodeURIComponent(CANVAS_ID)}/mutations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (error?.status !== 409 || attempt !== 0) throw error;
      current = await readCanvas();
      const racedCard = current.document.cards.find((item) => item.id === cardId);
      if (racedCard) return { ok: true, created: false, cardId, revision: current.document.revision, url: canvasUrl(CANVAS_ID, cardId) };
      continue;
    }

    const expectedRevision = result?.revision;
    const verified = await readCanvas();
    const saved = verified.document.cards.find((item) => item.id === cardId);
    if (!saved) throw new Error('画布写入后回读未找到回放卡，请稍后检查画布。');
    return {
      ok: true,
      created: true,
      cardId,
      revision: verified.document.revision,
      mutationRevision: Number.isInteger(expectedRevision) ? expectedRevision : null,
      url: canvasUrl(CANVAS_ID, cardId),
    };
  }
  throw new Error('画布正在被其他人修改，请重试本次关联。');
}

export { CANVAS_ID as REPLAY_CANVAS_ID };
