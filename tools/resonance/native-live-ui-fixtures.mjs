/**
 * Live UI checks for the isolated Resonance fixtures prepared by
 * native-live-ui-check.mjs. All gameplay actions use Puppeteer input events;
 * the only API requests here are read-only session/catalog GETs.
 */
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readSession(page, id) {
  const packet = await page.evaluate(async (sessionId) => {
    const response = await fetch(`/resonance/api/sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`session GET failed: ${response.status}`);
    return response.json();
  }, id);
  assert(packet?.ok !== false && packet?.state, `session GET returned no state for ${id}`);
  return packet.state;
}

async function readCatalog(page, seed) {
  const packet = await page.evaluate(async (catalogSeed) => {
    const response = await fetch(`/resonance/api/catalog?seed=${encodeURIComponent(catalogSeed)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`catalog GET failed: ${response.status}`);
    return response.json();
  }, seed);
  assert(packet?.catalog?.equipment, 'catalog GET returned no equipment records');
  return packet.catalog;
}

async function waitPublicPrep(attempt, waitReceived, fromIndex, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let cursor = fromIndex;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const message = await waitReceived(attempt, 'm.public', Math.min(remaining, 1_000), cursor);
    if (!message) continue;
    const index = attempt.ws.received.indexOf(message, cursor);
    if (index >= cursor) cursor = index + 1;
    if (String(message.phase).toUpperCase() === 'PREP') return message;
  }
  return null;
}

function fixtureFile(fixtureSetup, key) {
  const file = fixtureSetup?.files?.[key];
  assert(file?.id && Number.isFinite(Number(file.seed)), `fixtureSetup.files.${key} is unavailable`);
  return file;
}

async function openFixture(page, baseUrl, file, difficulty, attempt, waitSent, waitReceived, clickVisibleButtonText) {
  const url = new URL(baseUrl);
  url.searchParams.set('seed', String(file.seed));
  url.searchParams.set('difficulty', difficulty);
  url.searchParams.set('session', file.id);
  url.hash = '';
  const infoOffset = attempt.ws.sent.length;
  const publicOffset = attempt.ws.received.length;
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.rs-native-match', { timeout: 35_000 });
  await page.waitForSelector('footer.brief__foot button', { timeout: 25_000 });
  const ready = await clickVisibleButtonText(page, /准备就绪/);
  const infoReady = await waitSent(attempt, 'g.infoReady', 12_000, infoOffset);
  assert(infoReady, `fixture ${file.id} did not send g.infoReady after the UI action`);
  const [publicPrep] = await Promise.all([
    waitPublicPrep(attempt, waitReceived, publicOffset),
    page.waitForFunction(async () => {
      const { store } = await import('/js/store.js');
      const match = store.get().match;
      return match?.public?.phase === 'PREP' && match?.private?.phase === 'PREP'
        && !match.private.ready && !!document.querySelector('.shopbar');
    }, { timeout: 25_000 }),
  ]);
  assert(publicPrep, `fixture ${file.id} did not receive m.public PREP after g.infoReady`);
  const nativeState = await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    const match = store.get().match;
    return { publicPhase: match?.public?.phase, privatePhase: match?.private?.phase, ready: match?.private?.ready,
      shopPresent: !!document.querySelector('.shopbar') };
  });
  assert(nativeState.publicPhase === 'PREP' && nativeState.privatePhase === 'PREP' && nativeState.ready === false && nativeState.shopPresent,
    `fixture ${file.id} Native store did not reach editable PREP: ${JSON.stringify(nativeState)}`);
  const state = await readSession(page, file.id);
  assert(['prep', 'choice'].includes(state.phase), `fixture ${file.id} did not enter Native PREP: ${state.phase}`);
  assert(String(state.difficulty).toUpperCase() === String(difficulty).toUpperCase(),
    `fixture ${file.id} loaded the wrong difficulty: expected ${difficulty}, got ${state.difficulty}`);
  return { url: url.href, ready, infoReady, state };
}

async function clickMeasured(page, handle, label) {
  const rect = await handle?.boundingBox();
  assert(rect && rect.width > 0 && rect.height > 0, `${label} is not visibly clickable`);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function buyOneThroughShop(page, file, attempt, waitSent) {
  const before = await readSession(page, file.id);
  const offset = attempt.ws.sent.length;
  const beforeUi = await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    const runtime = store.get(), priv = runtime.match?.private, session = priv?.resonance?.state, shop = document.querySelector('.shopbar');
    const panels = [...document.querySelectorAll('.dpanel, .rs-detail-panel')]
      .filter(node => { const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!node.closest('.rs-native-equipment-dock,.rs-native-equipment-rail'); })
      .map(node => ({className:String(node.className||''),text:(node.innerText||'').slice(0,90)}));
    const card = document.querySelector('.shopbar__cards .scard:not(.scard--sold)');
    const component = await fetch('/js/ui/shopBar.js', {cache:'no-store'});
    const source = await component.text();
    const properties = card ? Object.getOwnPropertyNames(card) : [];
    return {playerId:runtime.me?.playerId, phase:runtime.match?.public?.phase, privatePhase:priv?.phase,
      ready:priv?.ready, alive:priv?.alive, canReady:priv?.canReady, pendingPersonalChoice:!!priv?.personalChoice,
      sessionPhase:session?.phase, choiceCount:session?.pendingChoices?.length||0, shopLocked:shop?.classList.contains('is-locked'),
      detailPanels:panels, cardClass:String(card?.className||''), cardAriaPressed:card?.getAttribute('aria-pressed'),
      cardDisabled:card?.matches(':disabled')||card?.getAttribute('aria-disabled')==='true',
      cardListenerProps:properties.filter(key=>/listener|click/i.test(key)),
      cardClickListenerType:typeof card?._listeners?.click,
      shopBarSource:{status:component.status,directBranch:source.includes("interaction !== 'direct' ? (idx) => tapCard"),
        chessCardFallback:source.includes("else if (!disabled) onBuy(idx); else onDetail(slot.id, 'chess', hint);")}};
  });
  await page.evaluate(() => {
    window.__fixtureShopEvents = [];
    for (const type of ['pointerdown','pointerup','mousedown','mouseup','click','contextmenu']) {
      document.addEventListener(type, event => {
        const target=event.target?.closest?.('.shopbar__cards .scard');
        if (!target) return;
        window.__fixtureShopEvents.push({type,button:event.button,buttons:event.buttons,pointerType:event.pointerType||null,
          isTrusted:event.isTrusted,defaultPrevented:event.defaultPrevented,detail:target.querySelector('.scard__name')?.textContent||null});
      }, true);
    }
  });
  let card = await page.$('.shopbar__cards .scard:not(.scard--sold)');
  assert(card, 'no visible unsold shop card in the choice fixture');
  const inspectShop = () => page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    const runtime = store.get();
    const sourceResponse = await fetch('/js/resonance/native-match-screen.js', { cache: 'no-store' });
    const nativeScreenSource = await sourceResponse.text();
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const details = [...new Set(document.querySelectorAll('.dpanel, .rs-detail-panel'))]
      .filter((node) => visible(node) && !node.closest('.rs-native-equipment-dock, .rs-native-equipment-rail'));
    const shop = document.querySelector('.shopbar');
    const cards = [...document.querySelectorAll('.shopbar__cards .scard:not(.scard--sold)')];
    const b = shop?.getBoundingClientRect();
    const overlap = details.some((panel) => {
      const a = panel.getBoundingClientRect();
      return !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
    return {
      detailVisible: details.length > 0, detailPanels: details.map((panel) => ({
        className: String(panel.className || ''), label: panel.getAttribute('aria-label') || null,
        text: (panel.innerText || '').slice(0, 120),
        closeVisible: [...panel.querySelectorAll('.dpanel__close, button[aria-label="关闭面板"]')].some(visible),
      })),
      runtime: { playerId: runtime.me?.playerId, phase: runtime.match?.private?.phase,
        hasResonanceCatalog: !!runtime.match?.resonanceCatalog, hasResonanceState: !!runtime.match?.private?.resonance?.state },
      shopClass: String(shop?.className || ''), fixtureShopEvents: window.__fixtureShopEvents || [],
      deliveredNativeScreen: { status: sourceResponse.status,
        fixedIdentityDirect: nativeScreenSource.includes("interaction=${myId === 'resonance' ? 'direct' : 'two-tap'}") },
      shopVisible: visible(shop), overlap,
      cards: cards.map((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          text: (node.innerText || '').trim(), className: String(node.className || ''),
          armed: node.getAttribute('aria-pressed') === 'true' || node.classList.contains('is-armed'),
          ariaPressed: node.getAttribute('aria-pressed'),
          disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true',
          title: node.getAttribute('title'), width: rect.width, height: rect.height,
          centerHit: hit ? `${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? `.${hit.className.trim().replace(/\\s+/g, '.')}` : ''}` : null,
          centerHitInsideCard: !!hit && (hit === node || node.contains(hit)),
        };
      }),
    };
  });
  const click = await clickMeasured(page, card, '购买商店干员');
  const buy = await waitSent(attempt, 'g.buy', 8_000, offset);
  if (!buy) {
    const [failureEvidence, revisionState] = await Promise.all([inspectShop(), readSession(page, file.id)]);
    // A failed single tap is diagnostic only. Never issue a second purchase tap,
    // even if the card looks armed or details obscure its hit target.
    assert(false, `single native shop click did not send g.buy: ${JSON.stringify({
      click, before: { phase: before.phase, revision: before.revision, pieces: before.pieces.length, gold: before.gold },
      after: { revision: revisionState.revision, pieces: revisionState.pieces?.length, gold: revisionState.gold },
      beforeUi, shop: failureEvidence, sentFrames: attempt.ws.sent.slice(offset),
    })}`);
  }
  await page.waitForFunction(async (id, revision) => {
    const response = await fetch(`/resonance/api/sessions/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const packet = await response.json();
    return Number(packet.state?.revision) > revision;
  }, { timeout: 12_000 }, file.id, before.revision);
  const after = await readSession(page, file.id);
  assert(after.pieces.length > before.pieces.length && after.gold < before.gold,
    `g.buy did not produce a purchased piece and spend gold: ${JSON.stringify({ before: before.pieces.length, after: after.pieces.length, goldBefore: before.gold, goldAfter: after.gold })}`);
  return { buy, before: { revision: before.revision, pieces: before.pieces.length, gold: before.gold },
    after: { revision: after.revision, pieces: after.pieces.length, gold: after.gold } };
}

async function verifyChoiceRoundTrip({ page, baseUrl, file, attempt, check, capture, waitSent, waitReceived, clickVisibleButtonText }) {
  const opened = await openFixture(page, baseUrl, file, 'NORMAL', attempt, waitSent, waitReceived, clickVisibleButtonText);
  let state = await readSession(page, file.id);
  assert(state.phase === 'choice' && state.pendingChoices?.length, `choice fixture did not expose a pending reward after PREP: ${state.phase}`);
  const choiceUid = state.pendingChoices[0].uid;
  await page.waitForSelector('.rs-native-choice[role="dialog"]', { timeout: 15_000 });
  const deferred = await page.$('.rs-native-choice__later');
  await clickMeasured(page, deferred, '稍后整理');
  await page.waitForSelector('.rs-native-choice-tab', { timeout: 8_000 });
  const stateAfterCollapse = await readSession(page, file.id);
  assert(stateAfterCollapse.pendingChoices?.some((row) => row.uid === choiceUid), 'collapsing the choice incorrectly removed the pending reward');

  const purchase = await buyOneThroughShop(page, file, attempt, waitSent);
  const reopen = await page.$('.rs-native-choice-tab');
  await clickMeasured(page, reopen, '重新打开待领取选择');
  await page.waitForSelector('.rs-native-choice[role="dialog"] .rs-choice-option button', { timeout: 8_000 });
  const option = await page.$('.rs-native-choice .rs-choice-option button:not(:disabled)');
  assert(option, 'no affordable native reward option is selectable');
  await clickMeasured(page, option, '选择黑市奖励');
  await page.waitForFunction(() => document.querySelector('.rs-native-choice .spov__confirm:not(:disabled)'), { timeout: 8_000 });
  const claimOffset = attempt.ws.sent.length;
  await clickVisibleButtonText(page, /确认选择/);
  const resonance = await waitSent(attempt, 'g.resonance', 10_000, claimOffset);
  assert(resonance?.action === 'claimReward', `reward confirmation did not send g.resonance claimReward: ${JSON.stringify(resonance)}`);
  await page.waitForFunction(async (id, uid) => {
    const response = await fetch(`/resonance/api/sessions/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const packet = await response.json();
    return !(packet.state?.pendingChoices || []).some((row) => row.uid === uid);
  }, { timeout: 15_000 }, file.id, choiceUid);
  state = await readSession(page, file.id);
  const evidence = { sessionId: file.id, phaseAfterInfoReady: opened.state.phase, infoReady: opened.infoReady,
    choiceUid, pendingAfterCollapse: true, purchase, reopened: true, sent: resonance,
    pendingAfterClaim: state.pendingChoices?.some((row) => row.uid === choiceUid) === true ? 'still-pending' : 'claimed',
    revision: state.revision, gold: state.gold, shimmer: state.prototypeMeta?.economy?.chemBaron?.shimmer };
  check('choice-g-resonance-roundtrip', state.phase !== 'choice' && !state.pendingChoices?.some((row) => row.uid === choiceUid)
    && purchase.after.pieces > purchase.before.pieces && resonance.action === 'claimReward', evidence);
  await capture('09-choice-fixture');
  return evidence;
}

async function inspectChemItemDetails(page, file, fixtureSetup) {
  const catalog = await readCatalog(page, file.seed);
  const chemItemIds = Array.isArray(fixtureSetup?.chemItems) ? fixtureSetup.chemItems.map((row) => typeof row === 'string' ? row : row?.id) : [];
  assert(chemItemIds.length === 28 && new Set(chemItemIds).size === 28, `fixtureSetup.chemItems must provide 28 unique IDs, got ${chemItemIds.length}`);
  const items = chemItemIds.map((id) => [id, catalog.equipment[id]]);
  assert(items.every(([, item]) => item), 'one or more Chem-Baron equipment records are absent from the display catalog');
  const pageSession = await page.evaluate(() => new URL(location.href).searchParams.get('session'));
  assert(pageSession === String(file.id), 'Chem details must be checked in the already-open fixture PREP page');
  const rows = [];
  for (const [id, item] of items) {
    await page.evaluate((itemId) => { location.hash = `item-${encodeURIComponent(itemId)}`; }, id);
    await page.waitForFunction((name) => {
      const panel = document.querySelector('.rs-detail-panel');
      return !!panel && (panel.innerText || '').includes(name);
    }, { timeout: 12_000 }, item.name);
    const actual = await page.$eval('.rs-detail-panel .dpanel__scroll', (node) => node.innerText.trim());
    const description = String(item.description || '').trim();
    assert(item.name && description && actual.includes(item.name) && actual.includes(description),
      `Chem item detail did not render its catalog name/effect: ${id}`);
    assert(/[0-9]/.test(description) && !/undefined|@placeholder/i.test(description), `Chem item lacks readable numeric effect text: ${id}`);
    rows.push({ id, name: item.name, renderedDescription: actual.includes(description), numericEffect: /[0-9]/.test(description) });
  }
  return { count: rows.length, rows };
}

async function pactEvidence(page, id = 'emissary') {
  const row = await page.$(`.rs-native-pact-matrix__row[data-pact-id="${id}"]`);
  assert(row, `native pact matrix row missing: ${id}`);
  const sourceLevels = await page.evaluate(async (pactId) => {
    const { store } = await import(new URL('/js/store.js', location.origin).href);
    return store.get().match?.resonanceCatalog?.pacts?.[pactId]?.levels || [];
  }, id);
  return row.evaluate((node, levels) => ({
    text: node.innerText,
    tiers: [...node.querySelectorAll('.rs-native-pact-matrix__tier')].map((tier) => {
      const index = Number(tier.dataset.levelIndex), source = levels[index] || {};
      const min = Number(source.minUnits ?? source.threshold ?? tier.dataset.levelMin);
      const max = Number(source.maxUnits ?? Number.MAX_SAFE_INTEGER);
      const datasetExact = JSON.parse(tier.dataset.levelExact || '[]');
      const sourceExact = Array.isArray(source.exactCounts) ? source.exactCounts.map(Number)
        : Number.isFinite(max) && max === min ? [min] : [];
      return { min, max, exact: datasetExact.length ? datasetExact : sourceExact,
        datasetExact, exactSource: datasetExact.length ? 'data-level-exact' : 'catalog-bounds',
        reached: tier.classList.contains('is-reached'), current: tier.classList.contains('is-current'), text: tier.innerText.trim() };
    }),
  }), sourceLevels);
}

async function setPactPanel(page, open) {
  const visible = !!(await page.$('.rs-native-pact-matrix'));
  if (visible === open) return;
  if (open) {
    const button = await page.$('button[aria-label="盟约与效果"]');
    assert(button, 'native pact matrix button is missing'); await clickMeasured(page, button, '盟约与效果');
    await page.waitForSelector('.rs-native-pact-matrix', { timeout: 8_000 });
  } else {
    const button = await page.$('button[aria-label="关闭面板"]') || await page.$('.rs-native-resonance-panel button[aria-label*="关闭"]');
    assert(button, 'native pact panel close button is missing'); await clickMeasured(page, button, '关闭盟约面板');
    await page.waitForFunction(() => !document.querySelector('.rs-native-pact-matrix'), { timeout: 8_000 });
  }
}

async function withdrawOneViaW(page, file, attempt, waitSent, nativePiecePoint) {
  const state = await readSession(page, file.id);
  const piece = state.pieces.find((row) => row.row != null && row.col != null);
  assert(piece, 'no deployed Emissary remains for a real W withdrawal');
  const live = await page.evaluate(async (pieceUid) => {
    const { store } = await import(new URL('/js/store.js', location.origin).href);
    const match = store.get().match, priv = match?.private, pieces = priv?.resonance?.state?.pieces;
    const nativePiece = Array.isArray(pieces) ? pieces.find((row) => String(row.uid) === String(pieceUid)) : null;
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return { publicPhase: match?.public?.phase, privatePhase: priv?.phase, ready: priv?.ready,
      nativeUid: Number(nativePiece?.nativeUid),
      existingPanels: [...document.querySelectorAll('.dpanel, .rs-detail-panel, .modal, .guide')]
        .filter(visible).map((node) => ({ className: String(node.className || ''), text: (node.innerText || '').slice(0, 100) })) };
  }, piece.uid);
  assert(live.publicPhase === 'PREP' && live.privatePhase === 'PREP' && live.ready === false,
    `Emissary withdrawal requires editable Native PREP: ${JSON.stringify(live)}`);
  const nativeUid = live.nativeUid;
  assert(Number.isSafeInteger(nativeUid), `Emissary has no numeric Native uid: ${piece.uid}`);
  const point = await nativePiecePoint(page, nativeUid);
  assert(point, `deployed Emissary is not pickable on the Native field: ${piece.uid}`);
  const hitEvidence = await page.evaluate(({ x, y }) => {
    const view = globalThis.__SP_VIEW__, hit = view?.pieceAtClient?.(x, y);
    const element = document.elementFromPoint(x, y);
    return { pickedUid: Number(hit?.uid), elementTag: element?.tagName || null,
      point: { x, y } };
  }, { x: point.x, y: point.y });
  assert(hitEvidence.pickedUid === nativeUid && hitEvidence.elementTag === 'CANVAS',
    `nativePiecePoint did not resolve the intended Native canvas hit: ${JSON.stringify({ pieceUid: piece.uid, nativeUid, live, hitEvidence })}`);
  await page.evaluate((uid) => {
    const view = globalThis.__SP_VIEW__;
    if (!view?.on) throw new Error('Native field does not expose pieceClick for click evidence');
    window.__fixtureEmissaryPieceClicks = [];
    window.__fixtureEmissaryPieceClicksOff?.();
    window.__fixtureEmissaryPieceClicksOff = view.on('pieceClick', (event) => {
      if (Number(event?.uid) !== Number(uid)) return;
      window.__fixtureEmissaryPieceClicks.push({ uid: Number(event.uid), button: event.button, detail: !!event.detail,
        clientX: event.clientX, clientY: event.clientY });
    });
  }, nativeUid);
  await page.mouse.move(point.x, point.y);
  await sleep(120);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector(`.uframe[data-uid="${nativeUid}"]`, { timeout: 4_000 });
  const selectionEvidence = await page.evaluate(({ uid, x, y }) => {
    const view = globalThis.__SP_VIEW__, event = window.__fixtureEmissaryPieceClicks?.at(-1) || null;
    const frame = document.querySelector(`.uframe[data-uid="${CSS.escape(String(uid))}"]`);
    const focus = document.activeElement;
    const panels = [...document.querySelectorAll('.dpanel, .rs-detail-panel, .modal, .guide')].map((node) => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        className: String(node.className || ''), text: (node.innerText || '').slice(0, 100) };
    }).filter((row) => row.visible);
    return { event, pickedUid: Number(view?.pieceAtClient?.(x, y)?.uid),
      focus: { tag: focus?.tagName || null, className: typeof focus?.className === 'string' ? focus.className : null },
      frameVisible: !!frame && frame.getBoundingClientRect().width > 0, panels };
  }, { uid: nativeUid, x: point.x, y: point.y });
  assert(selectionEvidence.event?.uid === nativeUid && selectionEvidence.event.button === 0 && !selectionEvidence.event.detail
    && selectionEvidence.pickedUid === nativeUid && selectionEvidence.frameVisible,
  `real mouse click did not select the intended Emissary: ${JSON.stringify({ pieceUid: piece.uid, nativeUid, live, hitEvidence, selectionEvidence })}`);
  await page.evaluate(() => { window.__fixtureEmissaryPieceClicksOff?.(); window.__fixtureEmissaryPieceClicksOff = null; });
  const offset = attempt.ws.sent.length;
  await page.keyboard.press('w');
  const moved = await waitSent(attempt, 'g.move', 8_000, offset);
  assert(moved, `W did not send the Native retreat g.move action: ${JSON.stringify({ pieceUid: piece.uid, nativeUid, live, hitEvidence, selectionEvidence, sent: attempt.ws.sent.slice(offset) })}`);
  const deployedBefore = state.pieces.filter((row) => row.row != null && row.col != null).length;
  await page.waitForFunction(async ({ id, uid }) => {
    const response = await fetch(`/resonance/api/sessions/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const packet = await response.json();
    return packet.state?.pieces?.some((row) => row.uid === uid && row.row == null && row.col == null);
  }, { timeout: 10_000 }, { id: file.id, uid: piece.uid });
  const after = await readSession(page, file.id), deployedAfter = after.pieces.filter((row) => row.row != null && row.col != null).length;
  assert(after.pieces.some((row) => row.uid === piece.uid && row.row == null && row.col == null) && deployedAfter === deployedBefore - 1,
    `g.move did not withdraw exactly the selected piece: ${JSON.stringify({ pieceUid: piece.uid, deployedBefore, deployedAfter, moved })}`);
  return { uid: piece.uid, nativeUid, sent: moved, click: selectionEvidence, hit: hitEvidence,
    before: { phase: state.phase, deployed: deployedBefore }, after: { phase: after.phase, deployed: deployedAfter }, state: after };
}

async function verifyEmissaryExactCounts({ page, baseUrl, fixtureSetup, attempt, check, waitSent, waitReceived, clickVisibleButtonText, nativePiecePoint }) {
  const records = [];
  const file3 = fixtureFile(fixtureSetup, 'emissary3');
  const opened3 = await openFixture(page, baseUrl, file3, 'NORMAL', attempt, waitSent, waitReceived, clickVisibleButtonText);
  assert(opened3.state.pieces.filter((piece) => piece.row != null).length === 3, 'Emissary3 fixture must begin with 3 deployed members');
  await setPactPanel(page, true);
  let state = await readSession(page, file3.id), pact = await pactEvidence(page);
  const exactOne = pact.tiers.find((tier) => tier.exact.includes(1));
  assert(exactOne, 'Emissary exact-one tier is not visible in the native pact matrix');
  assert(state.pacts?.emissary?.count === 3 && !exactOne.reached && !state.pacts?.emissary?.activeThreshold,
    `Emissary 3-count must not activate exact-one effect: ${JSON.stringify({ state: state.pacts?.emissary, exactOne })}`);
  records.push({ count: 3, activeThreshold: state.pacts.emissary.activeThreshold, exactOneReached: exactOne.reached });
  await setPactPanel(page, false);
  const two = await withdrawOneViaW(page, file3, attempt, waitSent, nativePiecePoint);
  await setPactPanel(page, true);
  pact = await pactEvidence(page); state = two.state;
  const tierOneAtTwo = pact.tiers.find((tier) => tier.exact.includes(1));
  assert(state.pacts?.emissary?.count === 2 && !tierOneAtTwo?.reached && !state.pacts?.emissary?.activeThreshold,
    `Emissary 2-count must remain inactive: ${JSON.stringify({ state: state.pacts?.emissary, tier: tierOneAtTwo })}`);
  records.push({ count: 2, activeThreshold: state.pacts.emissary.activeThreshold, exactOneReached: tierOneAtTwo.reached, withdrawal: two.uid,
    withdrawalEvidence: { uid: two.uid, nativeUid: two.nativeUid, sent: two.sent, click: two.click, hit: two.hit, before: two.before, after: two.after } });
  await setPactPanel(page, false);
  const one = await withdrawOneViaW(page, file3, attempt, waitSent, nativePiecePoint);
  await setPactPanel(page, true);
  pact = await pactEvidence(page); state = one.state;
  const tierOneAtOne = pact.tiers.find((tier) => tier.exact.includes(1));
  assert(state.pacts?.emissary?.count === 1 && Number(state.pacts.emissary.activeThreshold) === 1 && tierOneAtOne?.reached,
    `Emissary exact-one effect did not activate at 1: ${JSON.stringify({ state: state.pacts?.emissary, tier: tierOneAtOne })}`);
  records.push({ count: 1, activeThreshold: state.pacts.emissary.activeThreshold, exactOneReached: tierOneAtOne.reached, withdrawal: one.uid,
    withdrawalEvidence: { uid: one.uid, nativeUid: one.nativeUid, sent: one.sent, click: one.click, hit: one.hit, before: one.before, after: one.after } });
  await setPactPanel(page, false);

  const file4 = fixtureFile(fixtureSetup, 'emissary4');
  const opened4 = await openFixture(page, baseUrl, file4, 'NORMAL', attempt, waitSent, waitReceived, clickVisibleButtonText);
  assert(opened4.state.pieces.filter((piece) => piece.row != null).length === 4, 'Emissary4 fixture must begin with 4 deployed members');
  await setPactPanel(page, true);
  const state4 = await readSession(page, file4.id), pact4 = await pactEvidence(page);
  const exactFour = pact4.tiers.find((tier) => tier.exact.includes(4));
  assert(exactFour && state4.pacts?.emissary?.count === 4 && Number(state4.pacts.emissary.activeThreshold) === 4 && exactFour.reached,
    `Emissary exact-four effect is not active with 4: ${JSON.stringify({ state: state4.pacts?.emissary, exactFour })}`);
  records.push({ count: 4, activeThreshold: state4.pacts.emissary.activeThreshold, exactFourReached: exactFour.reached });
  check('emissary-exact-count-2-3', records.every((row) => row.count === 1 ? row.activeThreshold === 1 : row.count === 4 ? row.activeThreshold === 4 : row.activeThreshold === 0),
    { counts: records, realWithdrawals: records.filter((row) => row.withdrawalEvidence).map((row) => row.withdrawalEvidence),
      infoReady: [opened3.infoReady, opened4.infoReady] });
  return records;
}

async function verifyScrapTemporaryGear({ page, baseUrl, fixtureSetup, attempt, check, waitSent, waitReceived, clickVisibleButtonText }) {
  const fixture = fixtureSetup?.scrap;
  const file = fixture?.file;
  assert(file?.id && Number.isFinite(Number(file.seed)), 'fixtureSetup.scrap.file is unavailable');
  assert(fixture.pieceUid && fixture.componentUid && fixture.componentId && fixture.operatorId,
    `Scrap fixture metadata is incomplete: ${JSON.stringify(fixture)}`);
  const opened = await openFixture(page, baseUrl, file, 'NORMAL', attempt, waitSent, waitReceived, clickVisibleButtonText);
  const initial = await readSession(page, file.id);
  assert(initial.phase === 'prep', `Scrap fixture must enter PREP before combat: ${initial.phase}`);
  assert(!fixture.stageId || initial.field?.stageId === fixture.stageId,
    `Scrap fixture field changed: expected ${fixture.stageId}, got ${initial.field?.stageId}`);
  const catalog = await readCatalog(page, file.seed);
  const rhodesMembers = new Set(fixture.sourceMemberIds || catalog.pacts?.rhodes?.members || []);
  assert(rhodesMembers.size >= 2, 'Scrap fixture must carry at least two compiler-verified Rhodes source member IDs');
  const sourcePieces = initial.pieces.filter((piece) => rhodesMembers.has(piece.operatorId));
  assert(sourcePieces.length >= 2, `Scrap fixture needs at least two natural source members: ${JSON.stringify(sourcePieces.map((piece) => piece.operatorId))}`);
  const holder = initial.pieces.find((piece) => piece.uid === fixture.pieceUid);
  assert(holder && holder.operatorId === fixture.operatorId, 'Scrap permanent-component holder does not match fixture metadata');
  const holderGear = holder.equipment || [];
  assert(holderGear.some((item) => item.uid === fixture.componentUid && item.itemId === fixture.componentId),
    'Scrap fixture source component is not persistently equipped on the expected holder');
  assert(!fixture.persistedEquipment || JSON.stringify(holderGear) === JSON.stringify(fixture.persistedEquipment),
    'Scrap fixture persisted-equipment snapshot does not match its setup contract');
  const recipes = (catalog.recipes || []).filter((recipe) => recipe.parts?.includes(fixture.componentId));
  assert(Array.isArray(fixture.possibleResultIds) && fixture.possibleResultIds.length > 0
    && recipes.length > 0 && recipes.some((recipe) => fixture.possibleResultIds.includes(recipe.resultId)),
    `Scrap source component has no exact catalog recipe/result mapping: ${fixture.componentId}`);
  const persistentBefore = {
    equipment: structuredClone(holderGear), inventory: structuredClone(initial.inventory || []),
    history: (initial.history || []).filter((row) => row.type === 'fight-settled').length,
  };
  assert((initial.pieces || []).filter((piece) => piece.row != null && piece.col != null).length >= 2,
    'Scrap fixture does not begin with two legally deployed source members');

  const ready = await page.$('.readybtn:not(:disabled)');
  assert(ready, 'Scrap fixture Native ready control is unavailable');
  const readyOffset = attempt.ws.sent.length, battleStartOffset = attempt.ws.received.length;
  await clickMeasured(page, ready, '开始 Scrap 战斗');
  await sleep(120);
  const readyEconomy = await page.evaluate(() => ({
    warning: document.body.innerText.includes('本回合的剩余资金将清零'),
    dialog: [...document.querySelectorAll('.modal,.guide,[role="dialog"]')].some((node) => {
      const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0;
    }),
  }));
  assert(!readyEconomy.warning && !readyEconomy.dialog,
    `Resonance with carried gold must not show the base game's wipe warning: ${JSON.stringify(readyEconomy)}`);
  const readySent = await waitSent(attempt, 'g.ready', 10_000, readyOffset);
  assert(readySent, 'Scrap fixture did not send g.ready');
  const carriedGoldAtStart = await page.evaluate(async () => {
    const sid = new URL(location.href).searchParams.get('session');
    return (await (await fetch(`/resonance/api/sessions/${sid}`)).json()).state?.gold;
  });
  assert(carriedGoldAtStart === 1, `Resonance prep gold did not carry unchanged into combat: ${carriedGoldAtStart}`);
  const battleStart = await waitReceived(attempt, 'b.start', 20_000, battleStartOffset);
  assert(battleStart?.battleId, 'Scrap fixture did not receive scoped b.start with battleId');
  const combatDeadline = Date.now() + 10_000;
  let publicCombat = null;
  while (Date.now() < combatDeadline) {
    publicCombat = attempt.ws.received.slice(battleStartOffset).find((message) => message.t === 'm.public'
      && String(message.phase || '').toUpperCase() === 'COMBAT') || null;
    if (publicCombat) break;
    await sleep(80);
  }
  assert(publicCombat, `Scrap battle ${battleStart.battleId} did not publish Native COMBAT phase`);

  // Pause through the Native keyboard control so the live model and overlay can
  // be examined without synthesizing equipment or changing session state.
  const pauseOffset = attempt.ws.sent.length, pausePublicOffset = attempt.ws.received.length;
  await page.keyboard.press('Space');
  const paused = await waitSent(attempt, 'g.pause', 8_000, pauseOffset);
  assert(paused?.paused === true, 'Native Space did not send the real pause action for Scrap inspection');
  const pauseDeadline = Date.now() + 5_000;
  let pausedPublic = null;
  while (Date.now() < pauseDeadline) {
    pausedPublic = attempt.ws.received.slice(pausePublicOffset).find((message) => message.t === 'm.public'
      && message.paused === true) || null;
    if (pausedPublic) break;
    await sleep(80);
  }
  assert(pausedPublic, 'Native public state did not confirm the Scrap inspection pause');

  const nativeUid = await page.evaluate(async (pieceUid) => {
    const { store } = await import(new URL('/js/store.js', location.origin).href);
    const pieces = store.get().match?.private?.resonance?.state?.pieces;
    const piece = Array.isArray(pieces) ? pieces.find((row) => String(row.uid) === String(pieceUid)) : null;
    return Number(piece?.nativeUid);
  }, fixture.pieceUid);
  assert(Number.isSafeInteger(nativeUid), `Scrap holder has no live Native UID: ${fixture.pieceUid}`);
  await page.waitForFunction((uid) => {
    const row = document.querySelector(`.rs-unit-items__row[data-unit-key="battle:${uid}"]`);
    return !!row && !row.hidden && !!row.querySelector('.rs-unit-items__item[data-temporary="true"]');
  }, { timeout: 12_000 }, nativeUid);
  await page.waitForFunction((uid) => {
    const row = document.querySelector(`.rs-unit-items__row[data-unit-key="battle:${uid}"]`);
    const button = row?.querySelector('.rs-unit-items__item[data-temporary="true"]');
    const image = button?.querySelector('img');
    return !!image && image.complete && image.naturalWidth > 0;
  }, { timeout: 15_000 }, nativeUid);
  const liveItems = await page.evaluate((uid) => {
    const row = document.querySelector(`.rs-unit-items__row[data-unit-key="battle:${uid}"]`);
    return [...(row?.querySelectorAll('.rs-unit-items__item[data-temporary="true"]') || [])].map((button) => ({
      itemId: button.dataset.itemId, quality: button.dataset.quality || null, badge: button.dataset.badge || null,
      label: button.getAttribute('aria-label') || '', title: button.title || '',
      src: button.querySelector('img')?.currentSrc || button.querySelector('img')?.src || '',
      naturalWidth: button.querySelector('img')?.naturalWidth || 0,
    }));
  }, nativeUid);
  const item = liveItems.find((entry) => (fixture.possibleResultIds || []).includes(entry.itemId));
  assert(item && catalog.equipment?.[item.itemId], `Live Scrap item is not a fixture-supported catalog recipe result: ${JSON.stringify(liveItems)}`);
  const itemRecord = catalog.equipment[item.itemId];
  assert(itemRecord.name && itemRecord.description, `Live Scrap recipe result has no readable name/effect in the catalog: ${item.itemId}`);
  assert(['normal', 'lucky', 'radiant'].includes(item.quality) && item.badge && item.naturalWidth > 0,
    `Live Scrap icon lacks a valid quality badge or loaded image: ${JSON.stringify(item)}`);
  assert(/本场临时/.test(item.label) && item.src, `Live Scrap icon does not expose its temporary label and image URL: ${JSON.stringify(item)}`);
  const sourceRecipe = recipes.find((recipe) => recipe.resultId === item.itemId);
  assert(sourceRecipe, `Live Scrap item has no recipe consuming source component ${fixture.componentId}`);
  const itemButton = await page.$(`.rs-unit-items__row[data-unit-key="battle:${nativeUid}"] .rs-unit-items__item[data-temporary="true"][data-item-id="${item.itemId}"]`);
  assert(itemButton, 'Live temporary item button disappeared before detail inspection');
  await clickMeasured(page, itemButton, '查看本场临时装备');
  await page.waitForFunction(({ name, description }) => {
    const panel = document.querySelector('.rs-detail-panel');
    const text = panel?.innerText || '';
    return !!panel && text.includes(name) && (!description || text.includes(description));
  }, { timeout: 8_000 }, { name: itemRecord.name, description: itemRecord.description || '' });
  const detailText = await page.$eval('.rs-detail-panel .dpanel__scroll', (node) => node.innerText.trim());
  assert(detailText.includes(itemRecord.name) && (!itemRecord.description || detailText.includes(itemRecord.description)),
    `Temporary item detail omitted its actual catalog effect: ${item.itemId}`);
  const detailClose = await page.$('.rs-detail-panel .dpanel__close');
  assert(detailClose, 'temporary item detail close control is unavailable before resuming combat');
  const closeRect = await detailClose.boundingBox();
  assert(closeRect && closeRect.width > 0 && closeRect.height > 0, 'temporary item detail close control has no visible hitbox');
  const closePoint = { x: closeRect.x + closeRect.width / 2, y: closeRect.y + closeRect.height / 2 };
  const closeHit = await page.evaluate(({ x, y }) => {
    const button = document.querySelector('.rs-detail-panel .dpanel__close'), hit = document.elementFromPoint(x, y);
    return { hitTag: hit?.tagName || null, hitClass: String(hit?.className || ''), isButton: !!button && (hit === button || button.contains(hit)) };
  }, closePoint);
  assert(closeHit.isButton, `paused detail close button is covered by another layer: ${JSON.stringify({ closePoint, closeHit })}`);
  await page.mouse.click(closePoint.x, closePoint.y);
  await page.waitForFunction(() => !document.querySelector('.rs-detail-panel'), { timeout: 5_000 });
  const pauseAfterClose = await page.evaluate(async () => {
    const { store } = await import(new URL('/js/store.js', location.origin).href);
    return store.get().match?.public?.paused === true;
  });
  assert(pauseAfterClose, 'closing temporary gear detail unexpectedly resumed combat');
  const during = await readSession(page, file.id);
  const duringHolder = during.pieces.find((piece) => piece.uid === fixture.pieceUid);
  assert(JSON.stringify(duringHolder?.equipment || []) === JSON.stringify(persistentBefore.equipment)
    && JSON.stringify(during.inventory || []) === JSON.stringify(persistentBefore.inventory),
    'Scrap temporary gear changed persistent equipment or inventory while combat was paused');

  const resumeOffset = attempt.ws.sent.length, resumePublicOffset = attempt.ws.received.length;
  await page.keyboard.press('Space');
  const resumed = await waitSent(attempt, 'g.pause', 8_000, resumeOffset);
  assert(resumed?.paused === false, 'Native Space did not resume the Scrap battle');
  const resumeDeadline = Date.now() + 5_000;
  let resumedPublic = null;
  while (Date.now() < resumeDeadline) {
    resumedPublic = attempt.ws.received.slice(resumePublicOffset).find((message) => message.t === 'm.public'
      && message.paused === false) || null;
    if (resumedPublic) break;
    await sleep(80);
  }
  assert(resumedPublic, 'Native public state did not confirm Scrap battle resume');

  const settleDeadline = Date.now() + 180_000;
  let settled = null;
  while (Date.now() < settleDeadline) {
    const state = await readSession(page, file.id);
    const fights = (state.history || []).filter((row) => row.type === 'fight-settled');
    if (fights.length > persistentBefore.history) { settled = { state, settlement: fights.at(-1) }; break; }
    await sleep(400);
  }
  assert(settled, `Scrap battle ${battleStart.battleId} did not reach a real settlement within 180 seconds`);
  const afterHolder = settled.state.pieces.find((piece) => piece.uid === fixture.pieceUid);
  assert(JSON.stringify(afterHolder?.equipment || []) === JSON.stringify(persistentBefore.equipment)
    && JSON.stringify(settled.state.inventory || []) === JSON.stringify(persistentBefore.inventory),
    'Scrap temporary gear persisted into equipment/inventory after settlement');
  await page.waitForFunction(() => !document.querySelector('.rs-unit-items__item[data-temporary="true"]'), { timeout: 10_000 });
  const evidence = { sessionId: file.id, pieceUid: fixture.pieceUid, operatorId: fixture.operatorId, nativeUid,
    sourceMembers: sourcePieces.map((piece) => piece.operatorId), componentUid: fixture.componentUid,
    componentId: fixture.componentId, sourceRecipe: { parts: sourceRecipe.parts, resultId: sourceRecipe.resultId },
    temporaryItem: item, detailEffectVisible: detailText.includes(itemRecord.description || itemRecord.name),
    battleId: battleStart.battleId, readyEconomy, carriedGoldAtStart, publicCombat, pausedPublic, resumedPublic,
    persistentBefore, persistentDuring: { equipment: duringHolder?.equipment || [], inventory: during.inventory || [] },
    persistentAfter: { equipment: afterHolder?.equipment || [], inventory: settled.state.inventory || [] },
    settlement: { round: settled.settlement.round, won: settled.settlement.won, reason: settled.settlement.reason },
    temporaryBadgeRemovedAfterSettlement: true };
  check('scrap-temporary-gear-in-combat', !!battleStart.battleId && !!publicCombat && !!pausedPublic && !!resumedPublic
    && item.itemId && item.naturalWidth > 0 && detailText.includes(itemRecord.name)
    && JSON.stringify(afterHolder?.equipment || []) === JSON.stringify(persistentBefore.equipment)
    && JSON.stringify(settled.state.inventory || []) === JSON.stringify(persistentBefore.inventory), evidence);
  return evidence;
}

async function runTerminalFixture({ page, baseUrl, file, difficulty, attempt, waitSent, waitReceived, clickVisibleButtonText,
  expectedRound, expectedBattleRound, expectedStageId, expectedPhase: phaseOverride }) {
  const opened = await openFixture(page, baseUrl, file, difficulty, attempt, waitSent, waitReceived, clickVisibleButtonText);
  const before = await readSession(page, file.id);
  if (Number.isFinite(expectedRound)) assert(Number(before.round) === Number(expectedRound), `fixture round mismatch: expected ${expectedRound}, got ${before.round}`);
  if (expectedStageId) assert(before.field?.stageId === expectedStageId,
    `fixture resolved the wrong battle field: expected ${expectedStageId}, got ${before.field?.stageId}`);
  assert(before.field?.stageId && before.field?.kind, `fixture has no resolved Native battle field: ${JSON.stringify(before.field)}`);
  const expectedPhase = phaseOverride || (before.field.kind === 'hidden' || (difficulty === 'ABYSS' && Number(before.round) >= 30)
    ? 'HIDDEN_CORE' : before.field.kind === 'boss' || before.field.kind === 'bossL' ? 'FINAL_ASSAULT' : 'COMBAT');
  const expectedBattleKind = expectedPhase === 'FINAL_ASSAULT' ? 'boss'
    : expectedPhase === 'HIDDEN_CORE' ? 'hidden' : 'normal';
  assert(before.phase === 'prep' && (before.pieces || []).length > 0, `terminal fixture is not a readyable real PREP session: ${before.phase}`);
  const ready = await page.$('.readybtn:not(:disabled)');
  assert(ready, 'Native ready button is unavailable for the terminal fixture');
  const readyOffset = attempt.ws.sent.length, startsBefore = attempt.ws.received.length;
  await clickMeasured(page, ready, '开始战斗');
  await sleep(120);
  const readyWarning = await page.evaluate(() => ({
    wipeCopy: document.body.innerText.includes('本回合的剩余资金将清零'),
    dialog: [...document.querySelectorAll('.modal,.guide,[role="dialog"]')].some((node) => {
      const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0;
    }),
  }));
  assert(!readyWarning.wipeCopy && !readyWarning.dialog,
    `Resonance terminal ready must not show a leftover-funds wipe warning: ${JSON.stringify(readyWarning)}`);
  const readySent = await waitSent(attempt, 'g.ready', 10_000, readyOffset);
  assert(readySent, 'terminal fixture did not send g.ready');
  const battleStart = await waitReceived(attempt, 'b.start', 20_000, startsBefore);
  assert(battleStart?.battleId, 'real b.start with battleId was not observed after the scoped g.ready');
  // Native b.start has no round field. The fixture round is checked against
  // the persisted session above; Native selects FINAL_ASSAULT/HIDDEN_CORE for
  // boss nodes and COMBAT for ordinary nodes.
  assert(battleStart.kind === expectedBattleKind && battleStart.specKind === expectedBattleKind,
    `Native b.start kind/spec mismatch: expected ${expectedBattleKind}, got ${battleStart.kind}/${battleStart.specKind}`);
  assert(battleStart.specStageId === before.field.stageId,
    `Native b.start spec stage mismatch: expected ${before.field.stageId}, got ${battleStart.specStageId}`);
  if (Number.isFinite(expectedBattleRound)) assert(Number(battleStart.specRound) === Number(expectedBattleRound),
    `Native b.start spec round mismatch: expected ${expectedBattleRound}, got ${battleStart.specRound}`);
  const publicCombatDeadline = Date.now() + 10_000;
  let publicCombat = null;
  while (Date.now() < publicCombatDeadline) {
    publicCombat = attempt.ws.received.slice(startsBefore).find((message) => message.t === 'm.public'
      && String(message.phase || '').toUpperCase() === expectedPhase
      && (!Number.isFinite(expectedRound) || Number(message.round) === Number(expectedRound))) || null;
    if (publicCombat) break;
    await sleep(80);
  }
  assert(publicCombat, `Native m.public ${expectedPhase} phase was not received for round ${before.round} after b.start ${battleStart.battleId}`);
  const liveMatch = await page.evaluate(async () => {
    const { store } = await import(new URL('/js/store.js', location.origin).href);
    const match = store.get().match || {};
    return { phase: match.public?.phase, stageId: match.public?.stageId, battleRound: match.battle?.round,
      fieldId: match.battle?.fieldId || match.field?.fieldId || null };
  });
  assert(String(liveMatch.phase || '').toUpperCase() === expectedPhase
      && (!expectedStageId || liveMatch.stageId === expectedStageId),
    `Native store did not enter ${expectedPhase} for the expected stage after scoped b.start: ${JSON.stringify({ battleId: battleStart.battleId, publicCombat, liveMatch })}`);
  const resultDeadline = Date.now() + 180_000;
  let terminal = null;
  while (Date.now() < resultDeadline) {
    const current = await readSession(page, file.id);
    const settled = (current.history || []).filter((row) => row.type === 'fight-settled');
    if (current.phase === 'complete' && settled.length > before.history?.filter((row) => row.type === 'fight-settled').length) {
      terminal = { state: current, settlement: settled.at(-1) }; break;
    }
    await sleep(400);
  }
  assert(terminal, `real terminal fixture did not settle within 180 seconds: ${file.id}`);
  await page.waitForSelector('.screen.result .rs-native-result-details__rows', { timeout: 25_000 });
  const state = terminal.state;
  const catalog = await readCatalog(page, file.seed);
  const roster = (state.pieces || []).map((piece) => ({ uid: piece.uid, operatorId: piece.operatorId,
    name: catalog.operators?.[piece.operatorId]?.name || piece.operatorId, star: piece.star,
    gear: (piece.equipment || []).map((item) => catalog.equipment?.[item.itemId]?.name || item.itemId) }));
  const resultView = await page.evaluate(() => ({
    root: !!document.querySelector('.screen.result'),
    players: !!document.querySelector('.screen.result .result__players'),
    details: !!document.querySelector('.screen.result .rs-native-result-details'),
    canvasCount: document.querySelectorAll('.gm__field canvas').length,
    shopCount: document.querySelectorAll('.shopbar').length,
    rows: [...document.querySelectorAll('.rs-native-result-details__rows > article')].map((article) => article.innerText),
    charts: document.querySelectorAll('.rs-native-result-details__chart i').length,
  }));
  const stats = terminal.settlement.combatStats?.units || [];
  assert(resultView.root && resultView.players && resultView.details && resultView.canvasCount === 0 && resultView.shopCount === 0,
    'terminal fixture did not route to the native result screen with Resonance lineup/stat details');
  assert(roster.length > 0 && resultView.rows.length === roster.length && resultView.charts >= roster.length * 2,
    `result did not render all roster/star/equipment/stat chart rows: ${JSON.stringify({ roster: roster.length, rows: resultView.rows.length, charts: resultView.charts })}`);
  assert(roster.every((piece) => resultView.rows.some((row) => row.includes(piece.name) && row.includes(`${piece.star}星`)
    && piece.gear.every((gear) => row.includes(gear)) && row.includes('伤害'))), 'terminal result omitted actual roster name/star/equipment/damage data');
  assert(roster.some((piece) => piece.gear.length > 0), 'terminal fixture has no equipped item to verify in the result lineup');
  assert(stats.length > 0 && stats.some((unit) => Number(unit.dmg) > 0), 'terminal settlement contains no actual damage statistics');
  return { sessionId: file.id, difficulty, expectedStageId: expectedStageId || before.field.stageId, expectedRound: expectedRound ?? null,
    expectedPhase, infoReady: opened.infoReady, readySent, battleStart, phaseFrame: publicCombat, terminalReason: state.terminalReason || terminal.settlement.outcome || null,
    round: state.round, liveMatch, settlement: { round: terminal.settlement.round, won: terminal.settlement.won, reason: terminal.settlement.reason },
    roster, resultView, damageUnits: stats.filter((unit) => Number(unit.dmg) > 0).length };
}

/** Run the post-entry live fixtures against a page and checker-owned browser/server. */
export async function runNativeFixtureChecks({ page, baseUrl, fixtureSetup, attempt, check, capture, waitSent, waitReceived, clickVisibleButtonText, nativePiecePoint }) {
  assert(page && typeof page.goto === 'function' && typeof baseUrl === 'string', 'page/baseUrl are required');
  for (const [name, fn] of Object.entries({ check, capture, waitSent, waitReceived, clickVisibleButtonText, nativePiecePoint })) assert(typeof fn === 'function', `${name} callback is required`);
  assert(attempt?.ws?.sent && attempt?.ws?.received, 'checker attempt must include sent/received WebSocket logs');
  const choiceFile = fixtureFile(fixtureSetup, 'choice');
  const emissary3 = fixtureFile(fixtureSetup, 'emissary3');
  const finalBoss = fixtureFile(fixtureSetup, 'finalBoss');
  const hiddenCore = fixtureFile(fixtureSetup, 'hiddenCore');
  const choice = await verifyChoiceRoundTrip({ page, baseUrl, file: choiceFile, attempt, check, capture, waitSent, waitReceived, clickVisibleButtonText });
  const chem = await inspectChemItemDetails(page, choiceFile, fixtureSetup);
  check('chem-market-28-effects-readable', chem.count === 28 && chem.rows.every((row) => row.renderedDescription && row.numericEffect), chem);
  const emissary = await verifyEmissaryExactCounts({ page, baseUrl, fixtureSetup, attempt, check, waitSent, waitReceived, clickVisibleButtonText, nativePiecePoint });
  const scrap = await verifyScrapTemporaryGear({ page, baseUrl, fixtureSetup, attempt, check, waitSent, waitReceived, clickVisibleButtonText });
  const finalExpected = fixtureSetup.finalExpected || {};
  const final = await runTerminalFixture({ page, baseUrl, file: finalBoss, difficulty: 'NORMAL', attempt, waitSent, waitReceived, clickVisibleButtonText,
    expectedRound: finalExpected.finalRow?.round ?? finalExpected.round, expectedBattleRound: 14,
    expectedStageId: finalExpected.finalRow?.stageId, expectedPhase: 'FINAL_ASSAULT' });
  const hiddenRound = fixtureSetup.hiddenRound;
  const hidden = await runTerminalFixture({ page, baseUrl, file: hiddenCore, difficulty: 'ABYSS', attempt, waitSent, waitReceived, clickVisibleButtonText,
    expectedRound: hiddenRound, expectedBattleRound: 15, expectedPhase: 'HIDDEN_CORE' });
  check('boss-hidden-fixture-result-lineup-gear-chart', [final, hidden].every((row) => row.resultView.root && row.resultView.players && row.resultView.details && row.resultView.canvasCount === 0
    && row.resultView.shopCount === 0 && row.roster.length === row.resultView.rows.length && row.damageUnits > 0), { final, hidden });
  await capture('10-result-fixture');
  return { choice, chem, emissary, scrap, final, hidden };
}
