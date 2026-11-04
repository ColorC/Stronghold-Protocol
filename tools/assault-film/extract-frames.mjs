// Check frames for human review only: pulls single stills out of a finished film (never used to build the film).
// usage: node extract-frames.mjs <mp4> <outDir> name=seconds [name=seconds ...]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const FFMPEG = process.env.FFMPEG || 'C:/Users/lilithgames/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe';
const [mp4, outDir, ...pairs] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
for (const p of pairs) {
  const [name, sec] = p.split('=');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-ss', String(sec), '-i', mp4, '-frames:v', '1', path.join(outDir, name + '.png')]);
  console.log(path.join(outDir, name + '.png'));
}
