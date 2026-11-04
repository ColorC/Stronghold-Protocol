// Measure a finished film with ffprobe (parameters only; nothing is re-encoded). usage: node probe.mjs <mp4> [out.json]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const FFPROBE = process.env.FFPROBE || 'C:/Users/lilithgames/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffprobe.exe';
const probe = (...args) => execFileSync(FFPROBE, ['-v', 'error', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

export function probeFilm(file) {
  const meta = JSON.parse(probe('-show_entries', 'format=duration,bit_rate,size,format_name:stream=index,codec_type,codec_name,profile,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels', '-of', 'json', file));
  const video = meta.streams.find((s) => s.codec_type === 'video'); const audio = meta.streams.find((s) => s.codec_type === 'audio');
  const pts = probe('-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file).trim().split('\n').map(Number).sort((a, b) => a - b);
  const span = pts.at(-1) - pts[0];
  const gaps = []; for (let i = 1; i < pts.length; i++) gaps.push([pts[i] - pts[i - 1], pts[i - 1]]);
  gaps.sort((a, b) => b[0] - a[0]);
  const perFive = []; for (let s = 0; s < span; s += 5) perFive.push(+(pts.filter((x) => x >= pts[0] + s && x < pts[0] + s + 5).length / 5).toFixed(1));
  const [num, den] = String(video.avg_frame_rate).split('/').map(Number);
  return {
    file, resolution: `${video.width}x${video.height}`, videoCodec: `${video.codec_name}/${video.profile}`,
    durationSec: +Number(meta.format.duration).toFixed(2), sizeBytes: Number(meta.format.size), sizeMB: +(meta.format.size / 1048576).toFixed(2),
    bitrateMbps: +(Number(meta.format.bit_rate) / 1e6).toFixed(2),
    frames: pts.length, avgFps: +(pts.length / span).toFixed(2), declaredAvgFps: +(num / den).toFixed(2),
    longestNoNewFrameMs: +(gaps[0][0] * 1000).toFixed(1), longestGapAtSec: +gaps[0][1].toFixed(2),
    top5GapsMs: gaps.slice(0, 5).map((g) => `${(g[0] * 1000).toFixed(0)}ms@${g[1].toFixed(1)}s`),
    framesOver150msGap: gaps.filter((g) => g[0] >= 0.15).length, fpsPerFiveSeconds: perFive,
    audio: audio ? { codec: audio.codec_name, sampleRate: audio.sample_rate, channels: audio.channels } : null,
  };
}

if (process.argv[2]) {
  const res = probeFilm(process.argv[2]);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(res, null, 2) + '\n');
  console.log(JSON.stringify(res, null, 2));
}
