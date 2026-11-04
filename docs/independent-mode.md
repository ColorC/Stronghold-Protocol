# independent-mode.md — the 工坊 (independent mode) extension

This fork extends the remake with a self-contained single-player mode besides the official modes. The upstream design
document covers the official mode; this file documents the extension. It is not part of the upstream sections — the
design index (`docs/DESIGN.md`) only points here.

## What it is

A solo campaign with its own operator roster, equipment and battles (its content lives in
`server/sim/content/independent/`), played through a browser page (`public/independent.html`,
`public/js/independent/`). The server keeps each session as a JSON file and runs the battles — or a frontend-only
deploy hands the execution to the page. Because one public server can be shared by many visitors, an admission queue
guards the page and the API, and the public assets may be delivered from a deployer-supplied Git revision instead of
the server's own mounts.

## HTTP API and storage (`server/modes/independent/`)

All routes are `GET`/`POST`/`HEAD` under `/independent/api/`; every one is answered before the static mounts
(`server/http/routes.js` wiring in `server/index.js`), and an OpenAPI-style description of the packets is in
`server/modes/independent/http.js` (the header of each route):

| route | methods | what |
|---|---|---|
| `/independent/api/catalog` | GET | the mode's data catalog (operators, equipment, enemies, stages) — computed once from the loaded game data |
| `/independent/api/sessions` | POST | create a session, either from a seed/options or from a `rawState` checkpoint (revision 0) |
| `/independent/api/sessions/<id>` | GET | the session view (`?raw=1` the whole state, `?catalog=0` without the catalog) |
| `/independent/api/sessions/<id>/actions` | POST | apply one action (buy, move, ready, …) with `expectedRevision`; `422` on invalid, `409` + current state on a stale revision |
| `/independent/api/sessions/<id>/checkpoint` | POST | overwrite the state (`changes` merge or full `state`) under `expectedRevision` |
| `/independent/api/sessions/<id>/replays/<round>` | GET/HEAD | the gzip replay of a fought round (plain or gzip by `Accept-Encoding`) |

Storage (`server/modes/independent/http.js` `createIndependentHttp({ data, directory })`):

- `directory` comes from the `independentDirectory` startServer option or `SP_INDEPENDENT_DIRECTORY` — **must be an
  absolute canonical runtime path** (default `runtime/independent-sessions` relative to the repository root).
- One JSON file per session id (`<id>.json`), one gzip replay per fought round (`<id>.replay-r<round>.json.gz`).
- Every write is atomic: a uuid-named `.pending` file is written with `flag: 'wx'` and renamed over the target.
- Every mutation runs inside a per-session lock (`exclusive(id, task)`), so concurrent actions serialize; revisions
  make the client's optimistic concurrency safe.
- The rules validator `validateSession` is treated as untrusted-input safe: malformed external JSON shapes become a
  normal `422` instead of a throw.

Execution parameter: `SP_INDEPENDENT_EXECUTION` (startServer option `independentExecution`; default `'server'`). With
`'client'` the server still serves the catalog and the sessions but refuses `…/actions` with
`CLIENT_EXECUTION_REQUIRED` (409), and every admission lease carries `execution: 'client'`.

## Admission queue (`server/hosting/admission.js`)

A bounded in-memory visitor lease + FIFO waiting line, off by default (`independentMaxActive` / `SP_INDEPENDENT_MAX_ACTIVE`
0). When enabled:

- `POST`/`DELETE /independent/api/admission` obtains or releases a lease (cookie `sp_ix_lease`, HttpOnly, SameSite,
  secure on HTTPS); a queued visitor polls with `?wait=1` and gets `202` position updates until a slot opens (200) or
  the wait expires (`410`, `QUEUE_EXPIRED`). `?execution` names the mode.
- `GET /independent.html` is the game page; while every slot is held it answers the slim waiting page of
  `public/js/hostingWait.js` (the queue UI's controller is always served from this origin, before the hosting static
  delivery).
- Every `/independent/api/*` route requires a live lease (`403` `ADMISSION_REQUIRED` otherwise).
- `/healthz` reports `admission: admission.stats()` (active / waiting / limits).
- WebSocket upgrades and multi-player sockets share capacity: a released socket frees a shared visitor slot
  (`admission.canEnter()` on `ws` close and before an upgrade).

## Hosting static delivery (`server/hosting/staticDelivery.js`)

With `SP_STATIC_BASE` (an HTTPS URL ending in the full 40-hex Git commit) plus an optional per-file source map
(`SP_ASSET_SOURCE_MAP` or the `assetSources` option, validated to the exact version-1 schema with a full Git
revision), the public mounting paths — `/js/`, `/css/`, `/vendor/`, `/fonts/`, `/assets/`, `/data/`, `/shared/`,
`/sim/`, `/media/`, `/data.js` — answer with a `307` to that native revision (an exact asset source first), so a game
server can stay a thin origin while the deployer serves the static files. `public/js/hostingBootstrap.js` is never
redirected (the bootstrap must stay same-origin), and the `client-worker.js` import is rewritten to the CDN under CORS.
Without `SP_STATIC_BASE` the delivery answers nothing and the mounts serve as usual.

## Install-dir serving (`installDir` / `STRONGHOLD_INSTALL_DIR`)

A checkout without its own install (a Git worktree: `public/assets`, `public/vendor`, `public/fonts` and
`data/local-assets.json` are git-ignored) serves those folders read-only from a full install's `public/` (the checkout's
own folders always win), its `public/dev/` demo pages as a fallback, and its `data/local-assets.json` as the local-art
manifest (`server/http/static.js` `createStaticHandler`).

## Wiring (`server/index.js` / `server/http/`)

The entry wires everything through explicit `startServer()` options: `independentDirectory`, `independentExecution`,
`independentMaxActive`, `independentMaxWaiting`, `admissionTtlMs`, `admissionQueueTtlMs`, `admissionWaitTimeoutMs`,
`staticBase`, `assetSources`, `installDir`. The request listener (`server/http/routes.js`) runs the admission queue,
then the 工坊 API, then the method/healthz/wait-script/static-delivery chain; `server/http/websocket.js` guards
upgrades and frees slots on socket close; `server/http/files.js` keeps a `Cache-Control` a caller set (the admission
page's `private, no-store`). Without the options the server behaves exactly like the upstream remake.