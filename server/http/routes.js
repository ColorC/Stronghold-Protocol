// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * the admission queue and the independent (工坊) API first — before the method check: they have methods of their
//     own (docs/independent-mode.md; nothing when the options do not wire them);
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, sockets, sessions,
//     rooms, matches, the admission queue), never cached;
//   * /js/hostingWait.js — the queue UI's tiny controller — is served from the mounts before the hosting static
//     delivery, because it must work from the origin even when every game asset is external;
//   * the hosting static delivery (SP_STATIC_BASE): the public mounting paths answer with a redirect to the native Git
//     revision URL, exact asset sources first (absent, it answers nothing);
//   * everything else → the static files (static.js).
// A route that throws is logged and answers 500.

import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';

const MAX_URL_LENGTH = 4096;

/**
 * The GET /healthz body.
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby,
 *           admission?: ReturnType<typeof import('../hosting/admission.js').createAdmission> }} health
 */
export function healthReport({ startedAt, network, registry, lobby, admission }) {
  return {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
    ...(admission ? { admission: admission.stats() } : {}),
  };
}

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           staticDelivery?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string) => boolean,
 *           admission?: ReturnType<typeof import('../hosting/admission.js').createAdmission>,
 *           independentHttp?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string) => Promise<boolean>,
 *           independentExecution?: string,
 *           health: Parameters<typeof healthReport>[0], log: object }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, staticDelivery, admission, independentHttp, independentExecution, assaultHttp, health, log }) {
  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (admission && admission.handle(req, res, parts.rawPath)) return;
    if (independentExecution === 'client' && independentHttp && /^\/independent\/api\/sessions\/[^/]+\/actions$/.test(parts.rawPath)) {
      sendJson(req, res, 409, { ok: false, error: { code: 'CLIENT_EXECUTION_REQUIRED', message: '请刷新页面后继续' } }); return;
    }
    if (independentHttp && (await independentHttp(req, res, parts.rawPath))) return;
    if (assaultHttp && (await assaultHttp(req, res, parts.rawPath))) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (parts.rawPath === '/healthz') {
      sendJson(req, res, 200, healthReport(health));
      return;
    }
    // Keep the queue UI's tiny controller on this origin; unlike game assets it must work before admission.
    if (parts.rawPath === '/js/hostingWait.js' && (req.method === 'GET' || req.method === 'HEAD')) {
      await serveStatic(req, res, parts.rawPath, parts.query);
      return;
    }
    if (assaultHttp && (parts.rawPath === '/assault.html' || parts.rawPath === '/css/assault.css'
      || ['/js/assault/', '/assault-assets/', '/sim/', '/shared/'].some((prefix) => parts.rawPath.startsWith(prefix))
      || parts.rawPath.startsWith('/assault-engine/')
      || parts.rawPath === '/data.js')) {
      await serveStatic(req, res, parts.rawPath, parts.query);
      return;
    }
    if (!assaultHttp && parts.rawPath.startsWith('/assault-engine/')) {
      sendError(req, res, 404, '页面不存在 · Not found');
      return;
    }
    if (staticDelivery && staticDelivery(req, res, parts.rawPath)) return;
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
