import { h, render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);
const API = new URL('./independent/api/', location.href);
const STORAGE_KEY = 'stronghold.independent.session';
const DIFFICULTIES = [['FUNNY', '轻松'], ['NORMAL', '标准'], ['HARD', '困难'], ['ABYSS', '深渊']];
const BADGE_NAMES = { precision: '精准', agility: '灵巧', vitality: '坚守', defense: '助力', assault: '突袭', recovery: '迅捷', arcane: '奥术', foresight: '远见', miracle: '奇迹', investor: '投资人', unyielding: '不屈', harmony: '调和', coordination: '协防', solitary: '独行', mastery: '绝技' };
const friendly = { NO_FUNDS: '采购资金不足。', NO_DEPLOYED_PIECES: '请先部署至少一名干员。', ILLEGAL_TILE: '这个位置不适合当前干员。', OCCUPIED: '这个位置已有干员。', DEPLOY_CAP: '部署人数已达上限。', NEED_UNIQUE_SELECTION: '请先选择要保留的装备。', CAPACITY: '装备数量超过携带上限。', BAD_TARGET: '请重新选择目标。', CONFLICT: '状态已更新，已重新载入。' };

async function request(path, init = {}) {
  const response = await fetch(new URL(path, API), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  let body;
  try { body = await response.json(); } catch { throw new Error('服务暂时不可用，请稍后重试。'); }
  if (!response.ok || body?.ok === false) {
    const error = new Error(friendly[body?.error?.code] || '操作未完成，请检查选择后重试。');
    error.status = response.status; error.body = body; throw error;
  }
  return body;
}
function safeText(value) { return value == null ? '' : String(value); }
function opRecord(catalog, id) { return catalog?.operators?.[id] || {}; }
function gearRecord(catalog, id) { return catalog?.gear?.[id] || catalog?.equipment?.[id] || catalog?.badges?.[id] || {}; }
function gearName(catalog, id) { return gearRecord(catalog, id).name || BADGE_NAMES[id] || '装备'; }
function itemName(catalog, id) { return gearRecord(catalog, id).name || catalog?.prizes?.[id]?.name || catalog?.attachments?.[id]?.name || BADGE_NAMES[id] || '物品'; }
function skillRows(piece) {
  const source = piece?.skills;
  if (Array.isArray(source)) return source;
  if (source && typeof source === 'object') return Object.values(source);
  return [];
}
function slotName(slot, catalog) { return slot?.kind === 'chess' ? opRecord(catalog, slot.id).name || '干员' : gearName(catalog, slot?.id); }
function steamChoices(item, catalog) { return item?.steamOptions || gearRecord(catalog, item?.id).steamOptions || []; }
function steamLimit(item, catalog) {
  const value = gearRecord(catalog, item?.id).steamLimit;
  return Number(typeof value === 'object' ? value?.[item?.elite ? 'elite' : 'normal'] : value) || (item?.elite ? 2 : 1);
}
function copyLink(kind, id) {
  const url = new URL(location.href); url.hash = kind === 'anchor' ? id : `${kind}-${encodeURIComponent(id)}`;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url.href).catch(() => fallbackCopy(url.href));
  else fallbackCopy(url.href);
}
function fallbackCopy(text) { const box = document.createElement('textarea'); box.value = text; box.style.position = 'fixed'; box.style.opacity = '0'; document.body.append(box); box.select(); document.execCommand('copy'); box.remove(); }
function setSessionUrl(id) {
  const url = new URL(location.href); url.searchParams.set('session', id); history.replaceState(null, '', url);
}
function unwrap(body, previousCatalog) {
  return { state: body.state, catalog: body.catalog || previousCatalog || body.state?.catalog || {} };
}

function App() {
  const [catalog, setCatalog] = useState(null);
  const [state, setState] = useState(null);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailUid, setDetailUid] = useState('');
  const [modal, setModal] = useState('');
  const [fold, setFold] = useState({ inventory: false, effects: false });
  const [selectedItem, setSelectedItem] = useState('');
  const [equipQuantity, setEquipQuantity] = useState(1);
  const [inherit, setInherit] = useState({ donorUid: '', receiverUid: '', preview: null, choices: {} });
  const [mergeChoices, setMergeChoices] = useState({});
  const [selectedFaction, setSelectedFaction] = useState('');
  const [skillIndex, setSkillIndex] = useState(0);
  const [moduleId, setModuleId] = useState('none');
  const [difficulty, setDifficulty] = useState('FUNNY');
  const [roundLimit, setRoundLimit] = useState(9);
  const [anchor, setAnchor] = useState(location.hash);
  const [battleBusy, setBattleBusy] = useState(false);

  useEffect(() => {
    const root = document.getElementById('app');
    const copied = (event) => { event.preventDefault(); const target = event.target.closest('[id]'); copyLink('anchor', target?.id || 'app'); };
    root.addEventListener('contextmenu', copied);
    return () => root.removeEventListener('contextmenu', copied);
  }, []);
  useEffect(() => {
    const counts = new Map();
    for (const el of document.querySelectorAll('#app button,#app article,#app section,#app p,#app label,#app details,#app h2,#app h3,#app input,#app select,#app summary')) {
      if (el.id) continue;
      const parent = el.parentElement.closest('[id]')?.id || 'app';
      const stem = parent + '-' + el.tagName.toLowerCase() + '-' + el.textContent.trim().slice(0, 24).replace(/\s+/g, '-');
      const n = counts.get(stem) || 0; counts.set(stem, n + 1); el.id = stem + (n ? '-' + n : '');
    }
  });
  const activePiece = useMemo(() => state?.pieces?.find((p) => p.uid === detailUid) || null, [state, detailUid]);
  const action = async (type, args = {}) => {
    if (!sessionId || busy) return;
    setBusy(true); setBattleBusy(type === 'ready'); setError('');
    try {
      const body = await request(`sessions/${encodeURIComponent(sessionId)}/actions`, { method: 'POST', body: JSON.stringify({ expectedRevision: state.revision, action: { type, ...args } }) });
      const next = unwrap(body, catalog); setState(next.state); setCatalog(next.catalog);
      if (body.events?.some((x) => x.type === 'inherit-preview')) setInherit((v) => ({ ...v, preview: body.events.find((x) => x.type === 'inherit-preview').preview }));
      if (type === 'ready') setModal('');
    } catch (e) {
      if (e.status === 409) {
        try { const body = await request(`sessions/${encodeURIComponent(sessionId)}`); const next = unwrap(body, catalog); setState(next.state); setCatalog(next.catalog); setError(friendly.CONFLICT); }
        catch { setError('状态载入失败，请刷新页面重试。'); }
      } else setError(e.message);
    } finally { setBusy(false); setBattleBusy(false); }
  };
  const createSession = async () => {
    setBusy(true); setError('');
    try {
      const body = await request('sessions', { method: 'POST', body: JSON.stringify({ seed: 1, difficulty, roundLimit }) });
      const next = unwrap(body, catalog); setState(next.state); setCatalog(next.catalog); setSessionId(body.id); localStorage.setItem(STORAGE_KEY, body.id); setSessionUrl(body.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const catBody = await request('catalog'); if (dead) return;
        setCatalog(catBody.catalog);
        const urlId = new URL(location.href).searchParams.get('session');
        const stored = urlId || localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            const body = await request(`sessions/${encodeURIComponent(stored)}`); if (dead) return;
            const next = unwrap(body, catBody.catalog); setState(next.state); setCatalog(next.catalog); setSessionId(body.id || stored); localStorage.setItem(STORAGE_KEY, body.id || stored); setSessionUrl(body.id || stored);
          } catch (e) { if (e.status === 404) localStorage.removeItem(STORAGE_KEY); else throw e; }
        }
      } catch (e) { if (!dead) setError(e.message); }
    })();
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    const changed = () => setAnchor(location.hash);
    addEventListener('hashchange', changed);
    return () => removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (activePiece) { setSkillIndex(activePiece.skillIndex || 0); setModuleId(activePiece.moduleId || 'none'); }
  }, [activePiece?.uid, activePiece?.skillIndex, activePiece?.moduleId]);
  useEffect(() => {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash || !state) return;
    if (hash.startsWith('piece-')) { setDetailUid(hash.slice(6).split('-')[0]); setModal('detail'); }
    if (hash.startsWith('offer-')) setModal('offers');
    if (hash.startsWith('item-')) { setFold((v) => ({ ...v, inventory: true })); setSelectedItem(hash.slice(5)); setModal('inventory'); }
    setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: 'center' }), 0);
  }, [anchor, !!state]);

  if (!catalog) return html`<main class="shell"><div class="loading">${error || '正在载入备战界面…'}</div></main>`;
  if (!state) return html`<main class="start shell"><div class="topline"><span class="mark">RHODES ISLAND</span><a class="fullscreen" href=${location.href} target="_blank" rel="noopener">全屏打开 ↗</a></div><section class="start-card"><p class="eyebrow">INDEPENDENT OPERATION</p><h1>罗德岛战备演习</h1><p class="muted">安排干员、配置装备，迎接接下来的战斗。</p><label>演习模式<select value=${`${difficulty}|${roundLimit}`} onChange=${(e) => { const [d, r] = e.currentTarget.value.split('|'); setDifficulty(d); setRoundLimit(Number(r)); }}>${(catalog.modes || []).map((mode) => html`<option value=${`${mode.difficulty}|${mode.roundLimit}`}>${mode.name}</option>`)}</select></label><button class="primary" disabled=${busy} onClick=${createSession}>${busy ? '正在准备…' : '开始演习'}</button>${error && html`<p class="error">${error}</p>`}</section></main>`;

  const deployed = state.pieces.filter((p) => p.row != null && p.col != null);
  const benched = state.pieces.filter((p) => p.row == null || p.col == null);
  const selected = activePiece;
  const offers = state.offers || [];
  const gearCatalog = catalog.gear || catalog.equipment || catalog.badges || {};
  const boardCells = (state.board?.map || []).map(([key, type]) => {
    const [row, col] = String(key).split(',').map(Number);
    return { key: `${row},${col}`, row, col, type, piece: deployed.find((p) => p.row === row && p.col === col) };
  });
  const doMove = (cell) => selected && action('move', { uid: selected.uid, row: cell.row, col: cell.col, dir: selected.dir || 'RIGHT' });
  const equip = async (piece) => {
    if (!selectedItem || !piece) return;
    const record = gearRecord(catalog, state.inventory.find((x) => x.uid === selectedItem)?.id);
    const needsFaction = record.mechanism === 'identityTag';
    await action('equip', { itemUid: selectedItem, targetUid: piece.uid, quantity: equipQuantity, faction: needsFaction ? selectedFaction : undefined });
    setSelectedItem(''); setModal('');
  };
  const setUniqueChoice = (key, value) => setMergeChoices((v) => ({ ...v, [key]: value }));
  const availableFactions = (gear) => gear.identityFactions || catalog.config?.tavernFactions || ['炎','维多利亚','拉特兰','阿戈尔','谢拉格','萨尔贡','叙拉古','卡西米尔'];
  const offerTitle = (offer) => offer.type === 'prize' ? '选择奖励' : offer.type === 'attachment' ? '选择附加效果' : offer.type === 'operatorMerge' ? `合成精锐干员 · 需要${offer.required || 3}份` : '选择招募干员';
  const offerName = (offer, id) => offer.type === 'prize' ? catalog.prizes?.[id]?.name || '奖励' : offer.type === 'attachment' ? catalog.attachments?.[id]?.name || '附加效果' : opRecord(catalog, id).name || '干员';
  const chooseOffer = (offer, index) => {
    const targetUid = document.getElementById(`prize-target-${offer.id}`)?.value || offer.targetUid || selected?.uid || undefined;
    return action('choose', { offerId: offer.id, index, targetUid });
  };

  return html`<main class="shell ${busy ? 'is-busy' : ''}">
    <header class="topbar"><div><span class="mark">RHODES ISLAND</span><strong>战备演习</strong></div><div class="resources" hidden=${battleBusy}><span>第 ${state.round} 轮</span><span>资金 <b>${state.funds}</b></span><span>生命 <b>${state.lp}</b></span><span>调度中心 <b>${state.shop?.level}</b></span><a class="fullscreen" href=${location.href} target="_blank" rel="noopener">全屏打开 ↗</a></div></header>
    ${error && html`<div class="notice" role="status">${error}<button onClick=${() => setError('')}>关闭</button></div>`}
    ${busy && html`<div class="busy-strip"><b>${battleBusy ? '战斗进行中' : '正在处理'}</b><span>${deployed.map((p) => `${p.name} · 装备${p.equipmentLevel}级`).join('　')}</span></div>`}
    ${!busy && html`<div class="layout">
      <section class="field panel"><div class="section-head"><div><span class="eyebrow">阵地</span><h2>部署与候补</h2></div><div class="field-actions"><button class="small" disabled=${!selected} onClick=${() => selected && action('bench', { uid: selected.uid })}>撤回</button><button class="small" disabled=${!selected} onClick=${() => selected && action('move', { uid: selected.uid, row: selected.row, col: selected.col, dir: ['RIGHT','DOWN','LEFT','UP'][(('RIGHT,DOWN,LEFT,UP'.split(',').indexOf(selected.dir || 'RIGHT') + 1) % 4)] })}>转向</button></div></div>
        <div class="board" aria-label="部署阵地">${boardCells.map((cell) => html`<button id=${`tile-${cell.key}`} style=${`grid-row:${cell.row - 8};grid-column:${cell.col - 1}`} class=${`tile ${cell.type} ${cell.piece ? 'occupied' : ''} ${selected && !cell.piece ? 'target' : ''}`} title=${`阵地 ${cell.row}-${cell.col}`} onClick=${() => cell.piece ? (setDetailUid(cell.piece.uid), setModal('detail')) : doMove(cell)}>${cell.piece ? html`<span class="tile-name">${cell.piece.name}</span><small>装备 ${cell.piece.equipmentLevel}级</small>` : selected ? '部署到此' : ''}</button>`)}</div>
        <div class="roster">${deployed.map((p) => html`<article id=${`piece-${p.uid}`} role="button" tabIndex="0" class=${`roster-card ${selected?.uid === p.uid ? 'selected' : ''}`} onClick=${() => { setDetailUid(p.uid); setSkillIndex(Number(p.skillIndex || 0)); setModuleId(p.moduleId || 'none'); setModal('detail'); }}><span>${p.name}</span><b>装备 ${p.equipmentLevel}级</b><small>${p.elite ? '精锐' : '普通'}</small><button class="copy" title="复制定位链接" onClick=${(e) => { e.stopPropagation(); copyLink('piece', p.uid); }}>复制链接</button></article>`)}</div>
        <div class="bench-list"><strong>候补 ${benched.length}</strong>${benched.map((p) => html`<button onClick=${() => { setDetailUid(p.uid); setSkillIndex(Number(p.skillIndex || 0)); setModuleId(p.moduleId || 'none'); setModal('detail'); }}>${p.name} · 装备${p.equipmentLevel}级</button>`)}</div>
      </section>
      <section class="shop panel"><div class="section-head"><div><span class="eyebrow">SHOP</span><h2>调度中心</h2></div><div class="shop-actions"><button class="small" disabled=${busy} onClick=${() => action('refresh')}>刷新 · ${state.shop?.freeRefreshes > 0 ? '免费' : (state.shop?.refreshPrice ?? 1)}</button><button class=${`small ${state.shop?.frozen ? 'active' : ''}`} onClick=${() => action('freeze')}>${state.shop?.frozen ? '已冻结' : '冻结'}</button><button class="small" onClick=${() => action('upgrade')}>升级 · ${state.shop?.upgradePrice}</button></div></div>
        <div class="shop-slots">${(state.shop?.slots || []).map((slot, i) => slot.sold ? html`<div class="slot sold" id=${`shop-${i}`}>已选购</div>` : html`<article class="slot" id=${`shop-${i}`}><div class="slot-kind">${slot.kind === 'chess' ? `科技 ${opRecord(catalog, slot.id).tier || ''}` : `装备 ${gearRecord(catalog, slot.id).level || ''}级`}</div><strong>${slotName(slot, catalog)}</strong>${slot.equipment?.length ? html`<small>附带${slot.equipment.map((x) => gearName(catalog, x.id)).join('、')}</small>` : null}<button class="primary" onClick=${() => action('buy', { slot: i })}>购买 · ${slot.price}</button><button class="copy" title="复制定位链接" onClick=${() => copyLink('shop', i)}>复制链接</button></article>`)}</div>
        <div class="shop-footer"><button class="primary ready" onClick=${() => action('ready')}>开始战斗</button><button class="small" onClick=${() => setModal('inventory')}>装备库存 ${state.inventory?.reduce((n, x) => n + x.quantity, 0) || 0}</button><button class="small" onClick=${() => setModal('inherit')}>干员交接</button></div>
      </section>
    </div>`}
    ${offers.length > 0 && html`<aside class="offers"><div class="section-head"><h2>待处理选择</h2></div>${offers.map((offer) => html`<div class="offer-chip" id=${`offer-${offer.id}`} role="button" tabIndex="0" onClick=${() => { setModal('offers'); setMergeChoices({}); }}>${offerTitle(offer)} <span>选择</span><button class="copy" onClick=${(e) => { e.stopPropagation(); copyLink('offer', offer.id); }}>复制链接</button></div>`)}</aside>`}
    ${(state.battleSummary || state.lastBattle) && html`<section class="result panel"><div class="section-head"><div><span class="eyebrow">BATTLE REPORT</span><h2>第 ${state.lastBattle?.round || state.round - 1 || state.round} 轮战斗</h2></div><strong>${state.outcome === 'win' ? '胜利' : state.outcome === 'loss' ? '失败' : '已结算'}</strong></div><p>${state.lastBattle?.lpLost != null ? `本轮损失生命 ${state.lastBattle.lpLost}` : ''}${state.lastBattle?.result?.bossHpLeft != null ? `　领袖剩余生命 ${state.lastBattle.result.bossHpLeft}` : ''}</p><details><summary>战斗采样</summary><div class="samples">${(state.battleSummary?.samples || []).slice(0, 18).map((s) => html`<div><b>${Number(s.t ?? s.time ?? 0).toFixed(1)}秒</b><span>${(s.units || []).map((u) => `${state.pieces.find(p => p.uid === u.uid)?.name || '干员'} · 生命 ${Math.round(u.hp || 0)}/${Math.round(u.maxHp || 0)} · 装备${state.pieces.find(p => p.uid === u.uid)?.equipmentLevel || 0}级`).join('　') || safeText(s.type || '战况更新')}</span></div>`)}</div></details></section>`}
    <footer class="footer">当前演习会自动保存。<button onClick=${() => { localStorage.removeItem(STORAGE_KEY); const u = new URL(location.href); u.searchParams.delete('session'); history.replaceState(null, '', u); setState(null); setSessionId(''); }}>结束本次演习</button></footer>
    ${modal === 'detail' && selected && html`<div class="shade" onClick=${() => setModal('')}><section id=${`piece-${selected.uid}-detail`} class="drawer" onClick=${(e) => e.stopPropagation()}><button class="close" onClick=${() => setModal('')}>关闭</button><span class="eyebrow">${selected.elite ? '精锐干员' : '干员'}</span><h2>${selected.name}</h2><p>${selected.nativeTrait || ''}</p><div class="detail-grid"><label>技能<select value=${skillIndex} onChange=${(e) => setSkillIndex(Number(e.currentTarget.value))}>${skillRows(selected).map((s, i) => html`<option value=${i}>${s.name || `技能${i + 1}`}</option>`)}</select></label><label>模块<select value=${moduleId} onChange=${(e) => setModuleId(e.currentTarget.value)}><option value="none">无</option>${(selected.modules || []).map((m) => html`<option value=${m.id}>${m.name || m.typeName || '模块'}</option>`)}</select></label><button class="small" onClick=${() => action('loadout', { uid: selected.uid, skillIndex, moduleId })}>保存配置</button></div><h3>穿戴装备 · ${selected.equipmentLevel}级</h3>${(selected.equipmentDetails || []).map((item) => html`<article class="detail-item"><b>${gearName(catalog, item.id)}</b><p>${item.elite ? item.record?.elite : item.record?.normal}</p><span>${item.quantity}件 · ${(item.elite ? item.record?.eliteLevel || item.record?.level : item.record?.level) || 1}级${item.elite ? '精锐' : ''}</span>${(steamChoices(item, catalog).length > 0) && html`<button class="small" onClick=${() => { setSelectedItem(item.uid); setModal('steam'); }}>配置重锤</button>`}</article>`)}<h3>外来附加效果</h3>${(selected.attachmentDetails || []).length ? selected.attachmentDetails.map((x) => html`<article class="detail-item"><b>${x.record?.name || '附加效果'}</b><span>${x.record?.effect || ''}</span></article>`) : html`<p class="muted">暂无附加效果</p>`}<details><summary>干员能力与交接资格</summary><p>${selected.permission ? `${selected.permission.name || '本体交接资格'} · ${selected.permission.limit || selected.permission.description || ''}` : '没有专属交接资格'}</p></details><div class="drawer-actions"><button class="small" onClick=${() => { setSelectedItem(''); setModal('inventory'); }}>装备库存</button><button class="small" onClick=${() => action('sell', { uid: selected.uid })}>出售</button><button class="small" onClick=${() => { setInherit({ donorUid: selected.uid, receiverUid: '', preview: null, choices: {} }); setModal('inherit'); }}>交接预览</button><button class="copy" onClick=${() => copyLink('piece', selected.uid)}>复制角色链接</button></div></section></div>`}
    ${modal === 'inventory' && html`<div class="shade" onClick=${() => setModal('')}><section class="modal" onClick=${(e) => e.stopPropagation()}><button class="close" onClick=${() => setModal('')}>关闭</button><h2>装备库存</h2><div class="inventory">${(state.inventory || []).map((item) => html`<article id=${`item-${item.uid}`} class=${`inv-item ${selectedItem === item.uid ? 'selected' : ''}`}><button onClick=${() => { setSelectedItem(item.uid); setEquipQuantity(1); }}><b>${gearName(catalog, item.id)}</b><p>${item.elite ? item.record?.elite : item.record?.normal}</p><span>${item.quantity}件 · ${gearRecord(catalog, item.id).level || 1}级</span></button><button class="copy" onClick=${() => copyLink('item', item.uid)}>复制链接</button><div class="inv-equip"><select aria-label="选择装备目标" onChange=${(e) => setDetailUid(e.currentTarget.value)}><option value="">选择干员</option>${state.pieces.map((p) => html`<option value=${p.uid}>${p.name}</option>`)}</select><input class="quantity" type="number" min="1" max=${item.quantity} value=${equipQuantity} aria-label="穿戴数量" onInput=${(e) => setEquipQuantity(Math.max(1, Math.min(item.quantity, Number(e.currentTarget.value) || 1)))} /><button class="small" disabled=${selectedItem !== item.uid || !selected} onClick=${() => { const rec = gearRecord(catalog, item.id); if (rec.mechanism === 'identityTag') { setSelectedFaction(''); setModal('identity'); } else equip(selected); }}>穿戴</button></div></article>`)}</div></section></div>`}
    ${modal === 'identity' && html`<div class="shade"><section class="modal"><button class="close" onClick=${() => setModal('inventory')}>返回</button><h2>选择阵营标签</h2><select value=${selectedFaction} onChange=${(e) => setSelectedFaction(e.currentTarget.value)}><option value="">选择一个阵营</option>${availableFactions(gearRecord(catalog, state.inventory.find((x) => x.uid === selectedItem)?.id)).map((f) => html`<option>${f}</option>`)}</select><button class="primary" disabled=${!selectedFaction || !selected} onClick=${() => equip(selected)}>确认穿戴</button></section></div>`}
    ${modal === 'steam' && html`<div class="shade"><section class="modal"><button class="close" onClick=${() => setModal('detail')}>返回</button><h2>配置维式重锤</h2><p>最多选择 ${steamLimit(activePiece?.equipmentDetails?.find((x) => x.uid === selectedItem), catalog)} 种款式。</p>${steamChoices(activePiece?.equipmentDetails?.find((x) => x.uid === selectedItem), catalog).map((o) => html`<label class="check"><input type="checkbox" value=${o.sourceId} />${o.name}</label>`)}<button class="primary" onClick=${(e) => { const picks = [...e.currentTarget.parentElement.querySelectorAll('input:checked')].map((x) => x.value); if (picks.length > steamLimit(activePiece?.equipmentDetails?.find((x) => x.uid === selectedItem), catalog)) { setError('选择的款式数量超过上限。'); return; } action('configure-equipment', { targetUid: activePiece.uid, itemUid: selectedItem, hammerSourceIds: picks }); setModal('detail'); }}>保存配置</button></section></div>`}
    ${modal === 'inherit' && html`<div class="shade"><section class="modal"><button class="close" onClick=${() => setModal('')}>关闭</button><h2>干员交接</h2><label>交出本体<select value=${inherit.donorUid} onChange=${(e) => setInherit({ donorUid: e.currentTarget.value, receiverUid: '', preview: null, choices: {} })}><option value="">选择干员</option>${state.pieces.map((p) => html`<option value=${p.uid}>${p.name}</option>`)}</select></label><label>接收本体<select value=${inherit.receiverUid} onChange=${(e) => setInherit((v) => ({ ...v, receiverUid: e.currentTarget.value, preview: null, choices: {} }))}><option value="">选择干员</option>${state.pieces.filter((p) => p.uid !== inherit.donorUid).map((p) => html`<option value=${p.uid}>${p.name}</option>`)}</select></label><button class="primary" disabled=${!inherit.donorUid || !inherit.receiverUid} onClick=${() => action('inherit-preview', { donorUid: inherit.donorUid, receiverUid: inherit.receiverUid })}>预览变化</button>${inherit.preview && html`<div class="preview"><b>${inherit.preview.ok ? '可以交接' : '暂不能交接'}</b><p>${inherit.preview.oldBody?.nativeTrait || ''} → ${inherit.preview.newBody?.nativeTrait || ''}</p><p>接收本体的原生攻击与生命损耗20%，已损耗的本体不重复扣除；装备贡献不扣减。</p><p>转移装备 ${inherit.preview.transferredEquipment?.length || 0} 件；装备冲突 ${inherit.preview.equipmentConflicts?.length || 0} 项。</p>${(inherit.preview.equipmentConflicts || []).map((c) => html`<label>${gearName(catalog, c.id)}<select onChange=${(e) => setInherit((v) => ({ ...v, choices: { ...v.choices, [c.id]: e.currentTarget.value } }))}><option value="">选择保留来源</option><option value="donor">交出方</option><option value="receiver">接收方</option></select></label>`)}${(inherit.preview.attachmentConflicts || []).map((c) => html`<label>附加效果<select onChange=${(e) => setInherit((v) => ({ ...v, choices: { ...v.choices, [`attachment:${c.id}`]: e.currentTarget.value } }))}><option value="">选择保留来源</option><option value="donor">交出方</option><option value="receiver">接收方</option></select></label>`)}${inherit.preview.ok && html`<button class="primary" disabled=${(inherit.preview.equipmentConflicts || []).some((c) => !["donor","receiver"].includes(inherit.choices[c.id])) || (inherit.preview.attachmentConflicts || []).some((c) => !["donor","receiver"].includes(inherit.choices[`attachment:${c.id}`]))} onClick=${() => action('inherit', { donorUid: inherit.donorUid, receiverUid: inherit.receiverUid, uniqueSelections: inherit.choices })}>确认交接</button>`}</div>`}</section></div>`}
    ${modal === 'offers' && html`<div class="shade"><section class="modal"><button class="close" onClick=${() => setModal('')}>关闭</button>${offers.map((offer) => html`<article class="offer" id=${`offer-${offer.id}`}><h2>${offerTitle(offer)}</h2>${offer.type === 'operatorMerge' ? html`<p>需要${offer.required || 3}份本体合成为精锐。冲突装备必须明确选择保留项。</p>${(offer.conflicts?.equipment || []).map((c) => html`<label>${gearName(catalog, c.choices[0]?.id)}<select value=${mergeChoices[`equipment:${c.key}`] || ''} onChange=${(e) => setUniqueChoice(`equipment:${c.key}`, e.currentTarget.value)}><option value="">选择保留装备</option>${c.choices.map((x) => html`<option value=${x.uid}>${x.ownerUid === offer.pieceUids[0] ? '干员甲' : x.ownerUid === offer.pieceUids[1] ? '干员乙' : '干员丙'}</option>`)}</select></label>`)}${(offer.conflicts?.attachments || []).map((c) => html`<label>附加效果<select value=${mergeChoices[`attachment:${c.id}`] || ''} onChange=${(e) => setUniqueChoice(`attachment:${c.id}`, e.currentTarget.value)}><option value="">选择保留来源</option>${c.choices.map((x) => html`<option value=${x.ownerUid}>${x.ownerUid === offer.pieceUids[0] ? '干员甲' : x.ownerUid === offer.pieceUids[1] ? '干员乙' : '干员丙'}</option>`)}</select></label>`)}<button class="primary" onClick=${() => action('choose', { offerId: offer.id, uniqueSelections: mergeChoices })}>确认合成</button>` : offer.type === 'prize' ? html`<label>目标干员（如需）<select id=${`prize-target-${offer.id}`}><option value="">选择干员（可选）</option>${state.pieces.map((p) => html`<option value=${p.uid}>${p.name}</option>`)}</select></label>${offer.choices.map((id, i) => html`<button class="choice" onClick=${() => chooseOffer(offer, i)}>${offerName(offer, id)} · 选择奖励</button>`)}` : offer.type === 'attachment' ? html`<label>赋予对象<select id=${`attachment-target-${offer.id}`}><option value="">选择干员</option>${state.pieces.filter((p) => p.row != null).map((p) => html`<option value=${p.uid}>${p.name}</option>`)}</select></label>${offer.choices.map((id, i) => html`<button class="choice" onClick=${() => action('choose', { offerId: offer.id, index: i, targetUid: document.getElementById(`attachment-target-${offer.id}`)?.value || offer.targetUid })}>${offerName(offer, id)}</button>`)}` : html`${offer.choices?.map((id, i) => html`<button class="choice" onClick=${() => chooseOffer(offer, i)}>${offerName(offer, id)}</button>`)}`}</article>`)}</section></div>`}
  </main>`;
}

render(html`<${App} />`, document.getElementById('app'));
