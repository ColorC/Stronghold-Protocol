import { ERR, PROTOCOL_VERSION } from '../../../shared/constants.js';
import { C2S, validateC2S } from '../../../shared/protocol.js';
import { errorMsg, send } from '../../net.js';
import { ResonanceMatch, resonanceCatalogPacket } from './native-match.js';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sameOrigin = (req) => {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    const protocol = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
    return origin.host === req.headers.host && origin.protocol === protocol;
  } catch { return false; }
};

/** WebSocket transport sharing native protocol validators, encoders, and b.* payloads. */
export function createResonanceLive({ store, data, log = console } = {}) {
  if (!store?.loadOwnedSession || !store?.saveSession) throw new TypeError('resonance store required');
  const matches = new Map();
  const sockets = new Map();
  const completionWrites = new Map();
  let closing = false;

  function releaseCompleted(sessionId, instance) {
    if (!instance || closing || instance.state?.phase !== 'complete' || !instance.ended) return Promise.resolve(false);
    const previous = completionWrites.get(sessionId);
    if (previous?.instance === instance) return previous.promise;
    const entry = { instance, promise: null };
    const promise = (async () => {
      try {
        await instance._sessionWrite;
        await store.exclusive(sessionId, () => store.saveSession(sessionId, instance.state));
        if (matches.get(sessionId) !== instance) return false;
        instance.dispose();
        matches.delete(sessionId);
        return true;
      } catch (error) {
        log.error?.('[resonance/ws] persist completed session failed; retaining live match', error);
        return false;
      } finally {
        if (completionWrites.get(sessionId) === entry) completionWrites.delete(sessionId);
      }
    })();
    entry.promise = promise;
    completionWrites.set(sessionId, entry);
    return promise;
  }

  async function attach(ws, req) {
    const url = new URL(req.url || '/', 'http://localhost');
    const sessionId = url.searchParams.get('session');
    if (url.pathname !== '/resonance/ws' || !SESSION_ID.test(sessionId || '') || !sameOrigin(req)) {
      try { ws.close(1008, 'invalid resonance session'); } catch { /* closed */ }
      return;
    }
    const prior = sockets.get(sessionId);
    if (prior && prior !== ws) { try { prior.close(4001, 'session replaced'); } catch { /* closed */ } }
    sockets.set(sessionId, ws);
    let match = matches.get(sessionId) || null;
    let hello = false;
    const reply = (msg) => send(ws, msg);
    const sendCurrent = (msg) => {
      const current = sockets.get(sessionId);
      return current ? send(current, msg) : false;
    };
    const cleanup = () => {
      if (sockets.get(sessionId) !== ws) return;
      sockets.delete(sessionId);
      const current = matches.get(sessionId);
      if (hello && current) current.onDisconnect('resonance');
    };
    ws.on('message', (raw, isBinary) => {
      void (async () => {
        if (isBinary) { reply(errorMsg(ERR.BAD_MSG, undefined, 'binary frame')); return; }
        let msg;
        try { msg = JSON.parse(raw.toString('utf8')); } catch { reply(errorMsg(ERR.BAD_MSG, undefined, 'invalid json')); return; }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string' || !Object.hasOwn(C2S, msg.t)) {
          reply(errorMsg(ERR.BAD_MSG, msg?.rid, 'unknown message type')); return;
        }
        const invalid = validateC2S(msg);
        if (invalid) { reply(errorMsg(ERR.BAD_MSG, msg.rid, invalid)); return; }
        if (msg.t === 'ping') { reply({ t: 'pong', c: msg.c, s: Date.now(), ...(Number.isInteger(msg.rid) ? { rid: msg.rid } : {}) }); return; }
        if (!hello) {
          if (msg.t !== 'hello' || (msg.token && msg.token !== sessionId) || (msg.version != null && msg.version !== PROTOCOL_VERSION)) {
            reply(errorMsg(ERR.BAD_MSG, msg.rid, 'resonance session token/version mismatch')); return;
          }
          try {
            let created = false;
            if (!match) {
              const { state, catalog } = await store.loadOwnedSession(sessionId);
              match = new ResonanceMatch({ sessionId, state, catalog, store, data,
                send: (_player, packet) => sendCurrent(packet), broadcast: (packet) => sendCurrent(packet), log,
                onEnd: () => { void releaseCompleted(sessionId, match); },
              });
              matches.set(sessionId, match);
              store.activate?.(sessionId);
              created = true;
            } else {
              // full state is resent only after welcome/catalog have reached the client
            }
            hello = true;
            reply({ t: 'welcome', playerId: 'resonance', token: sessionId, name: msg.name || '共鸣', serverNow: Date.now(), version: PROTOCOL_VERSION, resumed: !created });
            reply(resonanceCatalogPacket(match));
            reply({ t: 'room.state', code: 'RSN', hostId: 'resonance', mode: 'solo', difficulty: match.state.difficulty,
              inMatch: match.state.phase !== 'complete', seats: [{ seat: 0, playerId: 'resonance', name: '共鸣', isBot: false, ready: true, connected: true }], spectators: [] });
            if (created) match.start();
            else match.onReconnect('resonance');
            if (match.phase === 'LOBBY' || match.phase === 'INFO_CHECK') match.flush(true);
          } catch (error) {
            log.error?.('[resonance/ws] attach failed', error);
            reply(errorMsg(ERR.NOT_IN_ROOM, msg.rid, error?.code || 'session unavailable'));
            ws.close(1011, 'session unavailable');
            return;
          }
          if (Number.isInteger(msg.rid)) reply({ t: 'ok', rid: msg.rid });
          return;
        }
        if (msg.t === 'hello') {
          if (Number.isInteger(msg.rid)) reply({ t: 'ok', rid: msg.rid });
          if (match) reply({ t: 'room.state', code: 'RSN', hostId: 'resonance', mode: 'solo', difficulty: match.state.difficulty,
            inMatch: match.state.phase !== 'complete', seats: [{ seat: 0, playerId: 'resonance', name: '共鸣', isBot: false, ready: true, connected: true }], spectators: [] });
          match?.onReconnect('resonance');
          return;
        }
        if (!match) { reply(errorMsg(ERR.NOT_IN_ROOM, msg.rid)); return; }
        const result = await match.handle('resonance', msg);
        if (result?.error) reply(errorMsg(result.error, msg.rid, result.detail));
        else if (Number.isInteger(msg.rid)) reply({ t: 'ok', rid: msg.rid });
      })().catch((error) => {
        log.error?.('[resonance/ws] message failed', error);
        reply(errorMsg(ERR.INTERNAL));
      });
    });
    ws.on('close', cleanup);
    ws.on('error', (error) => log.debug?.('[resonance/ws] socket error', error?.message));
  }

  return Object.freeze({ attach, matches, async close() {
    closing = true;
    await Promise.allSettled([...completionWrites.values()].map((entry) => entry.promise));
    const writes = [];
    const closingIds=[...matches.keys()];
    for (const [id, match] of matches) {
      const pendingWrites = match._sessionWrite;
      writes.push(Promise.resolve(pendingWrites).then(() => store.exclusive(id, () => store.saveSession(id, match.state)))
        .catch((error) => { log.error?.('[resonance/ws] persist during shutdown failed', error); throw error; }));
      match.dispose();
    }
    matches.clear(); sockets.clear();
    const results = await Promise.allSettled(writes);
    for(const id of closingIds)store.deactivate?.(id);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  } });
}
