# Versioned static distribution

`tools/assets/build-static-site.mjs` prepares a direct-upload static package for a separate HTTPS GET origin. It is an opt-in build step: it reads an already prepared checkout, performs no network calls, and does not publish or configure a provider. The output is pinned under the full Git commit (`/<commit>/…`) so application code and its worker engine can request one immutable version.

The package includes `public/js`, `public/css`, `public/vendor`, `public/fonts`, `public/assets`, the allow-listed static game JSON in `data/`, browser-safe `shared/` modules, and `server/sim/**/*.js` except `nodedata.js`. It emits `/data.js` from the existing `DATA_SHIM_JS` browser shim. It excludes the application HTML entry, `public/dev`, private documentation, server/API code, `server/data.js`, Node-only simulation loaders, and runtime/session data. The application entry, HTTP/API routes, admission logic, and the tiny same-origin worker bootstrap remain on the application host.

The output places those files at `<base-path>/<file>`, where `base-path` defaults to `/<commit>` and may include a configured static prefix before the full commit. The builder adjusts quoted root-absolute static module references such as the lazy `/sim/constants.js` import to that versioned prefix, and changes root-absolute font CSS URLs to relative font paths. This keeps requests on one pinned origin after a static module or stylesheet is redirected. It does not change asset manifests or gameplay data values; those URLs remain served through the application's exact-path static redirect.

The game requests large audio through extensionless `/media/...` paths to avoid download-manager popups. The builder makes byte-for-byte extensionless copies for those paths and assigns the matching audio MIME type in `_headers`; it never redirects an audio request back to the application host. Current source inventory has 541 MP3 files (36,109,437 bytes), so this compatibility layer adds that many bytes to the static package. The package retains the regular `.mp3` assets for the browser's explicit compatibility retry.

The current canonical generated bundle has 5,717 `public/assets` files (412,377,448 bytes); its largest file is 15,994,892 bytes. `public/fonts` adds 7 files and 230,526 bytes. On the Cloudflare Pages Free Wrangler direct-upload path, that inventory is below the documented 20,000-file and 25 MiB per-file limits. The builder checks the complete package against those limits and fails before reporting success if either is exceeded. A 412 MB package is not itself a Pages file-size violation; each file and the file count are the relevant limits.

Cloudflare Pages `_headers` supports `Access-Control-Allow-Origin: *` and immutable browser caching. The generated rules apply those headers to the full commit prefix and set explicit audio MIME types for extensionless media. Keep each commit prefix available for as long as clients may be running that version; a later deployment that removes an older prefix would invalidate its immutable URL. Pages may evict assets from its edge cache, so the full pinned files must remain in the deployed package or be deployed under a retained version URL.

Build into a new runtime batch directory, outside the worktree. `--source-root` must be a clean Git checkout at the requested commit; ignored generated assets and local-client art are read from that checkout and included as files, not links. The final worker engine must be present in that checkout before producing the release package.

```powershell
node tools/assets/build-static-site.mjs `
  --source-root="E:\WindowsWorkspace\webworks\apps\stronghold-protocol" `
  --revision="<full Git commit>" `
  --base-path="/static/releases/<full Git commit>" `
  --out="E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\client-hosting-YYYYMMDD\asset-distribution\pages-upload"
```

The output contains `_headers`, `static-build.json`, and a directory named for the full source commit. Only that output tree should be uploaded to a static host. The script does not push, deploy, create a project, or request a paid resource.

## Source feasibility

Representative direct upstream files were fetched from a real Chrome page using `fetch(..., { mode: 'cors' })`: avatar, enemy icon, Spine skeleton/atlas/texture, enemy skeleton, official BGM, and original OTF all returned readable HTTP 200 responses. The community resource repositories therefore work for these classes when the game uses the actual upstream paths. Their paths do not match the game's unified `/assets/...` layout; mappings must be exact per file, and the current pipeline changes Spine atlas text (`size:` and enemy `pma`), converts some image assets to WebP, and converts original fonts to WOFF2. Those outputs must come from the versioned static package. The AA2 `voice` branch is not served by jsDelivr (the tested file returned 404); `raw.githubusercontent.com` served the same BGM successfully. The raw GitHub files can be read cross-origin by the tested browser, though response-header inspection is not exposed to page JavaScript. The public jsDelivr sample returned `Access-Control-Allow-Origin: *`.

The full local-client extraction in `data/local-assets.json` and `public/assets/local/` has no one-file public source mapping. It is included in the package from the canonical prepared checkout. Do not infer that every local path can be hotlinked to a public repo.

Sources: [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Cloudflare Pages direct upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/), and [jsDelivr GitHub size limits and cache behavior](https://github.com/jsdelivr/jsdelivr).
