import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createResonanceLive } from '../../server/modes/resonance/live.js';

// Resonance players live on /resonance/ws, outside the multiplayer `sockets` count: /healthz reports them and the
// last closes (code, reason, lifetime) so a reconnect can be traced to a restart, a replaced session or a timeout.
test('resonance live stats count its own sockets and keep the recent closes', async () => {
  const store = { loadOwnedSession: async () => null, saveSession: async () => {}, exclusive: async (id, fn) => fn() };
  const live = createResonanceLive({ store, data: {}, log: { error() {}, debug() {} } });
  assert.deepEqual(live.stats(), { sockets: 0, matches: 0, recentCloses: [] });
  const ws = Object.assign(new EventEmitter(), { readyState: 1, send() {}, close(code, reason) { this.emit('close', code, Buffer.from(reason ?? '')); } });
  const id = '12345678-1234-4123-8123-123456789abc';
  await live.attach(ws, { url: `/resonance/ws?session=${id}`, headers: { host: 'localhost' }, socket: {} });
  assert.equal(live.stats().sockets, 1);
  ws.close(4000, 'heartbeat timeout');
  const { sockets, recentCloses } = live.stats();
  assert.equal(sockets, 0);
  assert.equal(recentCloses.length, 1);
  assert.deepEqual({ session: recentCloses[0].session, code: recentCloses[0].code, reason: recentCloses[0].reason }, { session: '12345678', code: 4000, reason: 'heartbeat timeout' });
});
