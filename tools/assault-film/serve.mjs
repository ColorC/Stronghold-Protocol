// Local assault service for the replay film: same code and rules as tools/assault/local-service.mjs,
// but every piece of state (runs, recordings, independent state) lives under an isolated data directory.
// usage: SP_ASSAULT_CANONICAL_ROOT=<canonical root> SP_ASSAULT_PORT=13004 SP_FILM_DATA=<dir> node tools/assault-film/serve.mjs
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveAssaultServiceConfig } from '../assault/local-service.mjs';

const dataDir = process.env.SP_FILM_DATA;
if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('SP_FILM_DATA must be an absolute directory');
const config = resolveAssaultServiceConfig();
process.env.SP_DATA_DIR = config.dataRoot;
process.env.SP_ASSAULT_RULES_ROOT = config.rulesRoot;
process.env.SP_INDEPENDENT_DESIGN_PATH = path.join(config.dataRoot, 'independent-design.json');
process.env.SP_INDEPENDENT_GAME_TEXT_PATH = path.join(config.dataRoot, 'independent-game-text.json');
if (config.mode === 'development')
  process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH = path.join(config.dataRoot, 'independent-darkmoon-design-addon.json');
else delete process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH;
for (const sub of ['player-sessions', 'recordings', 'independent-service-state']) fs.mkdirSync(path.join(dataDir, sub), { recursive: true });

const { startServer } = await import(pathToFileURL(path.join(config.sourceRoot, 'server', 'index.js')).href);
const service = await startServer({
  port: Number(process.env.SP_ASSAULT_PORT || 13004), host: '127.0.0.1', quiet: true,
  publicDir: config.publicDir, dataDir: config.dataRoot, sharedDir: config.sharedDir, installDir: config.canonicalRoot,
  assaultDirectory: path.join(dataDir, 'player-sessions'),
  assaultAssetsDir: config.assaultAssetsDir,
  independentDirectory: path.join(dataDir, 'independent-service-state'),
  recordingDirectory: path.join(dataDir, 'recordings'),
  staticBase: '', assetSources: {},
  independentEngineArchives: { revision: config.preservedEngine.sourceRevision, files: config.engineArchiveFiles },
});
console.log(JSON.stringify({ kind: 'assault-film-service', sourceRevision: config.sourceRevision, dataDir, url: service.url, pid: process.pid, startedAt: new Date().toISOString() }));
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, async () => { try { await service.close(); } finally { process.exit(0); } });
