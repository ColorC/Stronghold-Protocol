import { createSession, applyAction, viewSession, validateSession } from './engine/server/modes/independent/session.js';
import { getData } from './engine/server/data.js';
import { getCatalog } from './engine/server/modes/independent/catalog.js';
import { independentDisplayCatalog, independentSessionView } from './engine/server/modes/independent/display.js';

const data = getData();
const catalog = getCatalog(data);
const display = independentDisplayCatalog(data, catalog, data['independent-game-text']);
const view = (state) => independentSessionView(state, { data, catalog, display, viewSession });

self.addEventListener('message', (event) => {
  const { requestId, op, args = {} } = event.data || {};
  try {
    if (op === 'catalog') {
      self.postMessage({ requestId, ok: true, catalog: display });
      return;
    }
    if (op === 'create') {
      const state = createSession({ ...args, data, catalog });
      self.postMessage({ requestId, ok: true, rawState: state, state: view(state) });
      return;
    }
    if (op === 'restore') {
      const errors = validateSession(args.rawState);
      if (errors.length) { self.postMessage({ requestId, ok: false, error: { code: 'INVALID_SESSION', message: '对局存档无效', details: errors } }); return; }
      self.postMessage({ requestId, ok: true, rawState: args.rawState, state: view(args.rawState) });
      return;
    }
    if (op === 'act') {
      const errors = validateSession(args.rawState);
      if (errors.length) { self.postMessage({ requestId, ok: false, error: { code: 'INVALID_SESSION', message: '对局存档无效', details: errors } }); return; }
      const result = applyAction(args.rawState, args.action, { data, catalog });
      if (!result.ok) {
        self.postMessage({ requestId, ok: false, error: result.error, rawState: args.rawState, state: view(args.rawState) });
        return;
      }
      self.postMessage({ requestId, ok: true, rawState: result.state, state: view(result.state), events: result.events || [], replay: result.replay || null });
      return;
    }
    self.postMessage({ requestId, ok: false, error: { code: 'BAD_OPERATION', message: '无法执行操作' } });
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: { code: 'ENGINE', message: error?.message || '引擎运行失败' } });
  }
});
self.postMessage({ type: 'ready' });
