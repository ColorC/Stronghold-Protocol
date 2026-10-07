# Workshop client-compute mode

The workshop can run its independent session engine in a browser module worker. The existing server-compute mode remains the default. Client-compute mode is selected explicitly in the URL with `?execution=client`.

## Build and run

Build the browser module graph from the same checkout that supplies the server's rules and data:

```powershell
$out = Join-Path (Get-Location) 'public/js/independent/engine'
node tools/build-client-engine.mjs --out $out
npm start
```

Open `http://localhost:3000/independent.html?execution=client`. To resume, keep the session identifier and the mode in the URL, for example `http://localhost:3000/independent.html?execution=client&session=<session-id>`.

The generator copies the original session and battle import graph, supplies the current `data/*.json` as a read-only browser data module, and emits the catalog produced by the existing catalog builder. Release output belongs below this checkout's `public/js/independent/`; test fixtures may be generated under `.omni/tmp/`. Generated files are ignored by Git and must be rebuilt after changing engine rules, catalog rules, or raw game data. The release output must be served with the same release as the source checkout.

The browser worker calls the existing `createSession`, `applyAction`, `viewSession`, and `runIndependentBattle` implementation, and supplies the same display catalog as the server. The server stores and validates bounded checkpoints and uses revision compare-and-swap; it does not apply client-mode actions or create client-mode battle recordings. Action requests send only changed top-level state values; the server merges them into the current validated state under the session lock. Full state remains supported for the initial create/load and for compatibility. Replays stay in the current browser's IndexedDB, with retention capped at eight recordings and 32 MiB total.

The largest complete 15-round state measured 101,299 bytes; fifty full states use about 5.1 MB before filesystem overhead. A representative buy, move, equip, refresh, and battle checkpoint delta measured 5,340 B, 529 B, 653 B, 678 B, and 11,719 B respectively. At one interactive action per user every five seconds, fifty users average about 144 kbit/s for the measured non-battle actions. The largest replay in that 15-round run was 5,924,827 bytes and is browser-local. Server checkpoint files currently have no time-to-live, so deployments must define storage retention and capacity protection before exposing the endpoint broadly. Keep the configured independent-session directory outside the release tree and on a volume with enough free space. See the exact round matrix and measured request model in the generated `footprint.json` test artifact.

Client-compute is a single-player convenience mode. Its browser owns the session state and can change it, so it is not an authority for rankings, rewards, or other competitive records. The existing server-compute mode remains available for sessions that need server-owned state and recordings.
