// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB;
//                      refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the content packs (/packs/index.json, /packs/<id>/<file> — the registry is packs.js); an
//                      elective install's served folders (installDir, STRONGHOLD_INSTALL_DIR)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400 / 405, GET /healthz → JSON status, the
//                      independent (工坊) API and admission queue, the hosting static delivery, else static
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// The local mode extensions (docs/independent-mode.md): the admission queue (hosting/admission.js) guards the
// 工坊 / independent.html page and every /independent/api/ route of server/modes/independent/http.js — replay sessions,
// checkpoints and actions, run on the server ('server') or handed to the page ('client') — and a released/opened
// socket can free a shared visitor slot (ws close → admission.canEnter). hosting/staticDelivery.js answers the public
// mounting paths from a deployer-supplied native Git revision URL instead (SP_STATIC_BASE / SP_ASSET_SOURCE_MAP, the
// worker bootstrap stays same-origin); when neither is configured it answers nothing. An elective full install
// (STRONGHOLD_INSTALL_DIR) serves the git-ignored public folders a checkout has none of, read-only.
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import path from 'node:path';
import { getData, loadData } from './data.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { DATA_SHIM_JS, createStaticHandler } from './http/static.js';
import { createPackRegistry } from './packs.js';
import { MIME, COMPRESSIBLE, acceptsGzip, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { answerClientError } from './http/common.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';
import { createIndependentHttp } from './modes/independent/http.js';
import { createAssaultContext } from './modes/assault/context.js';
import { createAssaultHttp } from './modes/assault/http.js';
import { createResonanceHttp } from './modes/resonance/http.js';
import { createResonanceLive } from './modes/resonance/live.js';
import { getResonanceData } from './modes/resonance/data.js';
import { createAdmission } from './hosting/admission.js';
import { createStaticDelivery, loadAssetSourceMap } from './hosting/staticDelivery.js';

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string,
 *   independentDirectory?: string, independentExecution?: 'server' | 'client',
 *   independentMaxActive?: number, independentMaxWaiting?: number,
 *   admissionTtlMs?: number, admissionQueueTtlMs?: number, admissionWaitTimeoutMs?: number,
 *   staticBase?: string, assetSources?: Record<string, string>, installDir?: string,
 *   independentEngineArchives?: { revision: string, files: Record<string, string> },
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 * }} [opts]
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPackRegistry>,
 *                     admission: ReturnType<typeof createAdmission>,
 *                     close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  const { port, host } = listenAddress(opts);
  const log = opts.log || makeLogger(!!opts.quiet);
  const { publicDir, dataDir, sharedDir, packsDir } = serveDirs(opts);

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  const { registry, lobby, network } = createSessionStack(opts, { data, log });
  // The 工坊 (independent mode, docs/independent-mode.md): its HTTP API and its storage directory are wired through
  // explicit startServer options — the directory must be an absolute canonical runtime path.
  const independentDirectory = opts.independentDirectory ?? process.env.SP_INDEPENDENT_DIRECTORY ?? path.join(ROOT, 'runtime', 'independent-sessions');
  if (!path.isAbsolute(independentDirectory)) throw new Error('SP_INDEPENDENT_DIRECTORY must be an absolute canonical runtime path');
  const independentHttp = createIndependentHttp({ data, directory: independentDirectory });
  const assaultDirectory = opts.assaultDirectory ?? process.env.SP_ASSAULT_RUN_ROOT;
  const assaultAssetsDir = opts.assaultAssetsDir ?? process.env.SP_ASSAULT_ASSETS_DIR;
  const assaultEnabled = opts.assaultContext !== false && assaultDirectory != null;
  if (assaultEnabled && (!path.isAbsolute(assaultDirectory) || !assaultAssetsDir || !path.isAbsolute(assaultAssetsDir))) {
    throw new Error('Assault storage and assets require explicit absolute canonical directories');
  }
  const assaultContext = assaultEnabled ? (opts.assaultContext ?? createAssaultContext({ data })) : null;
  const assaultHttp = assaultContext ? createAssaultHttp({ context: assaultContext, runRoot: assaultDirectory,
    recordingRoot: opts.assaultRecordingDirectory ?? opts.recordingDirectory ?? process.env.SP_ASSAULT_RECORDING_ROOT ?? path.join(path.dirname(assaultDirectory), 'recordings') }) : null;
  // 共鸣 (resonance mode, docs/resonance/): its HTTP API, its storage directory and its live-match sockets (/resonance/ws).
  const resonanceDirectory = opts.resonanceDirectory ?? process.env.SP_RESONANCE_DIRECTORY ?? path.join(ROOT, 'runtime', 'resonance');
  if (!path.isAbsolute(resonanceDirectory)) throw new Error('SP_RESONANCE_DIRECTORY must be an absolute canonical runtime path');
  // 共鸣 plays on its own data copy (data/resonance-native, server/modes/resonance/data.js), never on data/.
  const resonanceData = opts.resonanceData ?? getResonanceData({ log });
  const resonanceHttp = createResonanceHttp({ data: resonanceData, directory: resonanceDirectory });
  const resonanceLive = createResonanceLive({ store: resonanceHttp.store, data: resonanceData, log });
  const independentExecution = opts.independentExecution ?? process.env.SP_INDEPENDENT_EXECUTION ?? 'server';
  // Admission queue: bounded visitor leases with a FIFO waiting line; `otherActive` counts the game sockets so a
  // released multiplayer socket can free a shared visitor slot.
  const admission = createAdmission({ maxActive: opts.independentMaxActive ?? Number(process.env.SP_INDEPENDENT_MAX_ACTIVE || 0),
    maxWaiting: opts.independentMaxWaiting ?? Number(process.env.SP_INDEPENDENT_MAX_WAITING || 0),
    ttlMs: opts.admissionTtlMs ?? 120000, queueTtlMs: opts.admissionQueueTtlMs ?? 90000,
    waitTimeoutMs: opts.admissionWaitTimeoutMs ?? 25000, execution: independentExecution,
    otherActive: () => network?.connectionCount || 0 });
  // Hosting static delivery: the public files come from a native Git revision URL (SP_STATIC_BASE) with an optional
  // per-file source map (SP_ASSET_SOURCE_MAP / assetSources); absent both, it answers nothing and the mounts serve.
  const sourceMapPath = process.env.SP_ASSET_SOURCE_MAP;
  const assetSources = opts.assetSources ?? (sourceMapPath === undefined ? {} : loadAssetSourceMap(sourceMapPath));
  const staticDelivery = createStaticDelivery({ base: opts.staticBase ?? process.env.SP_STATIC_BASE ?? '', assetSources });

  // content packs (docs/PACKS.md): scanned now — the start log names them — and again whenever their folders change
  const packs = createPackRegistry({ publicDir, dataDir, packsDir }, { log });
  packs.refresh(true);
  // a checkout without its own install (a Git worktree) can serve another install's folders read-only
  const installDir = opts.installDir ?? (process.env.STRONGHOLD_INSTALL_DIR || null);
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, packsDir, packs, installDir,
    assaultAssetsDir: assaultEnabled ? assaultAssetsDir : null, independentEngineArchives: opts.independentEngineArchives, log });
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag();

  const server = http.createServer(createRequestHandler({
    serveStatic, staticDelivery, admission, independentHttp, independentExecution, assaultHttp, resonanceHttp,
    health: { startedAt, network, registry, lobby, admission, resonanceLive }, log,
  }));
  server.on('clientError', answerClientError);
  const wss = attachWebSocket(server, { network, admission, resonanceLive, log });

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;
  } catch (e) {
    network.close(); // stop heartbeat/sweep timers of the half-built server
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${displayHost(boundHost)}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      let closeError = null;
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      try { await resonanceLive.close(); } catch (e) { closeError = e; log.error('[resonance/ws] shutdown', e); }
      try { admission.close(); } catch (e) { closeError ??= e; log.error('[shutdown] admission', e); }
      try { network.close(); } catch (e) { closeError ??= e; log.error('[shutdown] network', e); }
      try {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeIdleConnections?.();
          setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
        });
      } catch (e) { closeError ??= e; log.error('[shutdown] http server', e); }
      try { wss.close(); } catch (e) { closeError ??= e; log.error('[shutdown] websocket server', e); }
      if (closeError) throw closeError;
    })();
    return closing;
  }

  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, resonanceLive, registry, packs, admission, close };
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(startServer);
