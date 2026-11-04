import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configuredRuntimePath = process.env.ASSAULT_RUNTIME_PATH;
if (configuredRuntimePath && !path.isAbsolute(configuredRuntimePath)) {
  throw new TypeError(`ASSAULT_RUNTIME_PATH must be absolute: ${configuredRuntimePath}`);
}
export const assaultRuntimePath = configuredRuntimePath
  ? path.resolve(configuredRuntimePath)
  : path.join(root, 'data/assault-runtime.json');
export function loadAssaultRuntime() {
  const runtime = JSON.parse(fs.readFileSync(assaultRuntimePath, 'utf8'));
  if (!runtime?.bodies || typeof runtime.bodies !== 'object') throw new Error(`Invalid compiled Assault runtime: ${assaultRuntimePath}`);
  return runtime;
}
