import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RULES_DIR = path.join(ROOT, 'data', 'resonance-native');
const DATA_DIR = RULES_DIR;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const RUNTIME_DIR = path.join(ROOT, 'runtime', 'resonance');
const RESONANCE_DIR = path.join(RUNTIME_DIR, 'player-sessions');
const INDEPENDENT_DIR = path.join(RUNTIME_DIR, 'independent-service-state');
const RECORDING_DIR = path.join(RUNTIME_DIR, 'independent-service-recordings');

// These modules read the game data while importing, so set their canonical paths first.
process.env.SP_DATA_DIR = DATA_DIR;
process.env.SP_INDEPENDENT_DESIGN_PATH = path.join(RULES_DIR, 'independent-design.json');
process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH = path.join(RULES_DIR, 'independent-darkmoon-design-addon.json');
process.env.SP_INDEPENDENT_GAME_TEXT_PATH = path.join(RULES_DIR, 'independent-game-text.json');

const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server', 'index.js')).href);

let service;
let stopping = false;

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`[resonance-local] ${signal}: closing local service\n`);
  try {
    await service?.close();
    process.stdout.write('[resonance-local] closed\n');
  } catch (error) {
    process.stderr.write(`[resonance-local] shutdown failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

try {
  service = await startServer({
    port: 13001,
    host: '127.0.0.1',
    quiet: true,
    dataDir: DATA_DIR,
    publicDir: PUBLIC_DIR,
    sharedDir: SHARED_DIR,
    installDir: ROOT,
    resonanceDirectory: RESONANCE_DIR,
    independentDirectory: INDEPENDENT_DIR,
    recordingDirectory: RECORDING_DIR,
    staticBase: '',
    assetSources: {},
  });
  process.stdout.write(`[resonance-local] listening at ${service.url}\n`);
  process.stdout.write(`[resonance-local] resonance sessions: ${RESONANCE_DIR}\n`);
  process.stdout.write(`[resonance-local] independent state: ${INDEPENDENT_DIR}\n`);
  process.stdout.write(`[resonance-local] recordings: ${RECORDING_DIR}\n`);
  process.once('SIGINT', () => { void stop('SIGINT'); });
  process.once('SIGTERM', () => { void stop('SIGTERM'); });
} catch (error) {
  process.stderr.write(`[resonance-local] startup failed: ${error.message}\n`);
  process.exitCode = 1;
}
