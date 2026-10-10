import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Spinner, Panel } from '../ui/components.js';
import { net, identity } from '../net.js';
import { store, emptyMatch, useStore } from '../store.js';
import { data } from '../data.js';
import { toast } from '../ui/toasts.js';
import { GameScreen } from './native-match-screen.js';

const payload = (msg) => Object.fromEntries(Object.entries(msg ?? {}).filter(([key]) => key !== 't' && key !== 'rid'));
const wsUrlFor = (id) => {
  const apiBase = new URL('resonance/api/', globalThis.location.href);
  const ws = new URL('../ws', apiBase);
  ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:';
  ws.searchParams.set('session', id);
  return ws.href;
};

/** Connect the native match screen to the authoritative Resonance session over the game protocol. */
export function NativeMatchConnection({ id, onLeave, libraryCatalog, activeIds }) {
  const [failure, setFailure] = useState('');
  const pub = useStore((s) => s.match.public);
  const catalog = useStore((s) => s.match.resonanceCatalog);

  useEffect(() => {
    if (typeof id !== 'string' || !id) { setFailure('找不到本局会话'); return undefined; }
    let sequence = 0;
    const listeners = [];
    const listen = (type, fn) => listeners.push(net.on(type, fn));
    const updateConnection = (snap) => store.set({ connection: {
      ...store.get().connection, status: snap.status, ping: snap.ping, attempt: snap.attempt,
      retryAt: snap.retryAt, lastError: snap.lastError,
      everOnline: store.get().connection.everOnline || snap.status === 'online',
    } });

    net.close();
    net.url = wsUrlFor(id);
    identity.saveToken(id);
    store.set({ me: { playerId: 'resonance', name: '共鸣', token: id }, room: null, match: emptyMatch(), ticker: [], emotes: [] });
    setFailure('');

    listen('status', updateConnection);
    listen('welcome', (msg) => {
      identity.saveToken(msg.token || id);
      store.set({ me: { playerId: msg.playerId ?? 'resonance', name: msg.name || '共鸣', token: msg.token || id } });
    });
    listen('r.catalog', (msg) => {
      try {
        const body = payload(msg);
        const snapshot = body.data;
        if (!snapshot || typeof snapshot !== 'object') throw new Error('目录快照缺失');
        data.inject({ chess: snapshot.chess, bonds: snapshot.bonds, items: snapshot.items, config: snapshot.config });
        store.patch('match', { resonanceCatalog: body.catalog ?? null });
      } catch (error) { setFailure(error?.message || '共鸣数据无法载入'); }
    });
    listen('room.state', (msg) => store.set({ room: payload(msg) }));
    listen('m.public', (msg) => store.patch('match', { public: payload(msg) }));
    listen('m.private', (msg) => store.patch('match', { private: payload(msg) }));
    listen('m.field', (msg) => store.patch('match', { field: payload(msg) }));
    listen('m.result', (msg) => store.patch('match', { result: payload(msg) }));
    listen('m.toast', (msg) => toast(msg.text, ['info', 'success', 'warn', 'error'].includes(msg.kind) ? msg.kind : 'info'));
    listen('m.ticker', (msg) => {
      if (typeof msg.text !== 'string') return;
      store.set((s) => ({ ticker: [...s.ticker.slice(-31), { id: ++sequence, text: msg.text, at: Date.now(), type: msg.type ?? null, playerId: msg.playerId ?? null, round: s.match?.public?.round ?? null, priority: Number(msg.priority) || 0 }] }));
    });
    listen('m.emote', (msg) => store.set((s) => ({ emotes: [...s.emotes.slice(-31), { seq: ++sequence, playerId: msg.playerId, id: msg.id, at: Date.now() }] })));

    net.setName('共鸣');
    // `close()` marks the singleton as manually closed. `setName()` intentionally
    // does not reopen a manually closed socket, so explicitly start this session's
    // native WebSocket after installing its URL and identity.
    net.connect();
    return () => {
      for (const off of listeners) off();
      net.close();
      if (net.url === wsUrlFor(id)) net.url = null;
      identity.clearToken();
      store.set({ match: emptyMatch(), room: null });
    };
  }, [id]);

  if (failure) return html`<main class="screen"><${Panel} title="无法连接本局"><p>${failure}</p></${Panel}></main>`;
  if (!catalog || !pub) return html`<div class="screen gload"><${Spinner} size="lg" label="ENTERING SIMULATION" /><p>正在连接共鸣战场…</p></div>`;
  return html`<div class="rs-native-match"><${GameScreen} onLeave=${onLeave} libraryCatalog=${libraryCatalog} activeIds=${activeIds} /></div>`;
}
