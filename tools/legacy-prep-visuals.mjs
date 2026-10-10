const classSet = (node) => new Set(String(node?.attributes?.class || '').split(/\s+/).filter(Boolean));

function attachSerialized(nodes, serialized, parentId = null) {
  if (!serialized || typeof serialized !== 'object' || !Number.isInteger(serialized.id)) return;
  const node = { id: serialized.id, tagName: serialized.tagName || '', textContent: serialized.textContent || '',
    attributes: { ...(serialized.attributes || {}) }, parentId, children: [] };
  nodes.set(node.id, node);
  for (const child of serialized.childNodes || []) {
    if (!child || typeof child !== 'object') continue;
    node.children.push(child.id);
    attachSerialized(nodes, child, node.id);
  }
}

function removeNode(nodes, id) {
  const node = nodes.get(id);
  if (!node) return;
  for (const child of node.children) removeNode(nodes, child);
  nodes.delete(id);
}

function parseBadgePosition(node) {
  const uid = Number(node.attributes['data-n']);
  const style = node.attributes.style;
  if (!Number.isInteger(uid) || typeof style !== 'string') return null;
  const match = /translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*\)/.exec(style);
  if (!match) return { uid, x: null, bottom: null, unresolved: 'badge-style-not-translatable' };
  return { uid, x: Number(match[1]), bottom: Number(match[2]) };
}

function modeOf(nodes) {
  let prep = false, combat = false, result = false;
  for (const node of nodes.values()) {
    const classes = classSet(node);
    if (classes.has('gm--prep')) prep = true;
    if (classes.has('gm--combat')) combat = true;
    if (classes.has('ix-result') && node.attributes.hidden !== true
      && node.attributes['aria-hidden'] !== 'true' && node.attributes.style?.display !== 'none') result = true;
  }
  const mode = combat ? 'combat' : prep ? 'prep' : 'other';
  return result && mode === 'prep' ? 'result' : mode;
}

function currentBadges(nodes) {
  const out = [];
  for (const node of nodes.values()) if (classSet(node).has('ix-badge')) {
    const pos = parseBadgePosition(node);
    if (pos) out.push(pos);
  }
  return out.sort((a, b) => a.uid - b.uid);
}

function currentFacing(nodes) {
  const out = [];
  for (const node of nodes.values()) {
    const classes = classSet(node);
    if (!classes.has('fwheel')) continue;
    const label = String(node.attributes['aria-label'] || '');
    const match = label.match(/选择「(.+?)」的朝向/);
    const sr = [...nodes.values()].find((candidate) => candidate.parentId === node.id && classSet(candidate).has('fwheel__sr'));
    const direction = ['up', 'right', 'down', 'left'].find((dir) => classes.has(`is-${dir}`))?.toUpperCase()
      || ({ '朝向：上': 'UP', '朝向：右': 'RIGHT', '朝向：下': 'DOWN', '朝向：左': 'LEFT' }[sr?.textContent] || null);
    const dia = [...nodes.values()].find((candidate) => candidate.parentId === node.id && classSet(candidate).has('fwheel__dia'));
    const style = String(dia?.attributes?.style || '');
    const get = (property) => Number(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`).exec(style)?.[1]);
    const left = get('left'), top = get('top'), width = get('width'), height = get('height');
    out.push({ label, name: match?.[1] || null, direction,
      centerX: Number.isFinite(left) && Number.isFinite(width) ? left + width / 2 : null,
      centerY: Number.isFinite(top) && Number.isFinite(height) ? top + height / 2 : null });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function visibleState(nodes) {
  const mode = modeOf(nodes);
  return { mode, badges: mode === 'prep' ? currentBadges(nodes) : [], facing: mode === 'prep' ? currentFacing(nodes) : [] };
}

/** Rebuild only the RRWeb DOM facts needed to recover the game-field badge poses; no screenshot or event payload dump. */
export function recoverPrepVisualEvents(events, { recordingId, recordingStartedAt, includePointerEvents = true } = {}) {
  const origin = Date.parse(recordingStartedAt);
  if (!Number.isFinite(origin) || typeof recordingId !== 'string' || !recordingId) throw new TypeError('legacy visual recovery requires recording ID and recording start');
  const nodes = new Map(), states = [], pointerEvents = [], facingEvents = [];
  let previousSignature = '', snapshotCount = 0, mutationCount = 0, active = false;
  for (const event of events || []) {
    if (event?.sid !== recordingId) continue;
    if (includePointerEvents && event.kind === 'interaction') {
      const p = event.p || {};
      if (['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].includes(p.action)
        && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
        pointerEvents.push({ at: (Number(p.at) - origin) / 1000, action: p.action, x: Number(p.x), y: Number(p.y),
          buttons: Number(p.buttons) || 0, targetTag: p.target?.tag || null, targetLabel: p.target?.label || '' });
      }
      continue;
    }
    if (event.kind !== 'rrweb') continue;
    const payload = event.p || {}, data = payload.data || {}, at = (Number(payload.timestamp ?? event.ts) - origin) / 1000;
    if (!Number.isFinite(at)) continue;
    if (payload.type === 2) {
      nodes.clear(); attachSerialized(nodes, data.node);
      snapshotCount++;
    } else if (payload.type === 3) {
      if (data.source === 2) {
        if (data.type === 0) {
          const facing = currentFacing(nodes);
          if (facing.length) facingEvents.push({ at, sourceSeq: Number(event.seq) || null,
            x: Number(data.x), y: Number(data.y), facing });
        }
        continue;
      }
      if (data.source !== 0) continue;
      mutationCount++;
      for (const remove of data.removes || []) removeNode(nodes, remove.id);
      for (const add of data.adds || []) {
        const parent = nodes.get(add.parentId);
        if (parent && Number.isInteger(add.node?.id)) {
          attachSerialized(nodes, add.node, add.parentId);
          if (!parent.children.includes(add.node.id)) parent.children.push(add.node.id);
        }
      }
      for (const change of data.attributes || []) {
        const node = nodes.get(change.id); if (!node) continue;
        for (const [key, value] of Object.entries(change.attributes || {})) {
          if (value === null) delete node.attributes[key];
          else if (key === 'style' && value && typeof value === 'object' && !Array.isArray(value)) {
            const style = new Map(String(node.attributes.style || '').split(';').map((part) => part.trim()).filter(Boolean)
              .map((part) => { const i = part.indexOf(':'); return i < 0 ? [part, ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()]; }));
            for (const [name, item] of Object.entries(value)) {
              const cssName = name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
              if (item == null || item === '') style.delete(cssName); else style.set(cssName, String(item));
            }
            node.attributes.style = [...style].map(([name, item]) => `${name}: ${item};`).join(' ');
          } else node.attributes[key] = value;
        }
      }
      for (const change of data.texts || []) { const node = nodes.get(change.id); if (node) node.textContent = change.value || ''; }
    } else continue;
    const state = visibleState(nodes);
    const signature = JSON.stringify(state);
    if (signature !== previousSignature) {
      states.push({ at, sourceSeq: Number(event.seq) || null, screenMode: state.mode,
        badges: state.mode === 'prep' ? state.badges : [], facing: state.facing });
    }
    active = state.mode === 'prep';
    previousSignature = signature;
  }
  return { states, pointerEvents, facingEvents, coverage: { snapshotCount, mutationCount, stateCount: states.length,
    pointerEventCount: pointerEvents.length, facingEventCount: facingEvents.length, finalModePrep: active } };
}
