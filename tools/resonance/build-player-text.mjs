import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const build=path.join(root,'tools/resonance/build-content.mjs');
const result=spawnSync(process.execPath,[build],{cwd:root,stdio:'inherit',env:process.env});
if(result.error) throw result.error;
process.exitCode=result.status??1;
