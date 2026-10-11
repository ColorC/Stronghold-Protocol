#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolveExecutable, resolveFfprobe } from './render-independent-recording.mjs';


function run(exe, args) {
  const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  return once(child, 'close').then(([code]) => {
    if (code !== 0) throw new Error(`${path.basename(exe)} exit ${code}: ${stderr.slice(-3000)}`);
    return { stdout, stderr };
  });
}

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (index % 2 === 0) pairs.push([value.replace(/^--/, ''), all[index + 1]]);
  return pairs;
}, []));
for (const key of ['manifest', 'media-dir', 'output-dir', 'rounds']) if (!args[key]) throw new Error(`missing --${key}`);
const FFMPEG = resolveExecutable(args.ffmpeg || process.env.SP_FFMPEG_PATH || 'ffmpeg');
const FFPROBE = resolveFfprobe({ explicitPath: args.ffprobe || process.env.SP_FFPROBE_PATH, ffmpegPath: FFMPEG });
const manifest = JSON.parse(await fs.readFile(path.resolve(args.manifest), 'utf8'));
const mediaDir = path.resolve(args['media-dir']), outputDir = path.resolve(args['output-dir']);
const rounds = args.rounds.split(',').map(Number);
const report = { schemaVersion: 1, sourceRecordingId: manifest.recordingId, decoder: 'ffmpeg sequential decode to MJPEG q:v=1', encoding: 'JPEG quality scale 1', clips: [] };
await fs.mkdir(outputDir, { recursive: true });
for (const round of rounds) {
  const clip = manifest.clips.find((item) => Number(item.round) === round);
  if (!clip) throw new Error(`manifest has no round ${round}`);
  const input = path.resolve(mediaDir, clip.file), targetDir = path.join(outputDir, `round-${round}`);
  await fs.mkdir(targetDir, { recursive: true });
  const probe = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration', '-of', 'json', input]);
  const stream = JSON.parse(probe.stdout).streams?.[0];
  if (!stream || !Number.isInteger(Number(stream.width)) || !Number.isInteger(Number(stream.height)) || Number(stream.width) < 2 || Number(stream.height) < 2) throw new Error(`unexpected source dimensions R${round}: ${JSON.stringify(stream)}`);
  const firstProbe = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,pts_time,pkt_duration_time', '-of', 'json', input]);
  const firstFrame = JSON.parse(firstProbe.stdout).frames?.[0];
  const fullProbe = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', input]);
  const probedFrames = JSON.parse(fullProbe.stdout).frames || [];
  const firstPts = probedFrames.map((frame) => Number(frame.best_effort_timestamp_time)).find(Number.isFinite);
  const framePts = probedFrames.map((frame) => Number(frame.best_effort_timestamp_time) - firstPts);
  if (!Number.isFinite(firstPts) || framePts.some((time, index) => !Number.isFinite(time) || (index > 0 && time < framePts[index - 1]))) throw new Error(`source PTS invalid R${round}`);
  process.stdout.write(`decode R${round} start source=${clip.startSecond}-${clip.endSecond} fps=${stream.r_frame_rate} frames=${stream.nb_frames}\n`);
  const outputPattern = path.join(targetDir, 'frame-%06d.jpg');
  const decoded = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0:v:0', '-fps_mode', 'passthrough', '-start_number', '0', '-q:v', '1', '-y', outputPattern]);
  const files = (await fs.readdir(targetDir)).filter((name) => /^frame-\d{6}\.jpg$/.test(name)).sort();
  const entry = { round, file: clip.file, input, sourceStartSecond: clip.startSecond, sourceEndSecond: clip.endSecond,
    sourceMediaDuration: clip.mediaDuration, reported: { width: Number(stream.width), height: Number(stream.height), rFrameRate: stream.r_frame_rate,
      avgFrameRate: stream.avg_frame_rate, nbFrames: stream.nb_frames, duration: stream.duration }, decodedFrameCount: files.length,
    decoderProcess: { executable: FFMPEG, exitCode: 0, status: 'complete' }, framePts,
    actualFirstFrame: firstFrame ? { bestEffortTimestampTime: firstFrame.best_effort_timestamp_time, ptsTime: firstFrame.pts_time, packetDurationTime: firstFrame.pkt_duration_time } : null,
    firstDecodedFile: files[0] ? path.join(targetDir, files[0]) : null, lastDecodedFile: files.at(-1) ? path.join(targetDir, files.at(-1)) : null,
    firstFrameIndex: 0, indexTimeRule: 'choose greatest frame PTS less than or equal to the requested media time, clamped to decoded frame count' };
  if (!files.length || (stream.nb_frames && Number(stream.nb_frames) !== files.length)) throw new Error(`decoded frame count mismatch R${round}: expected=${stream.nb_frames} actual=${files.length}; ${decoded.stderr}`);
  if (framePts.length !== files.length) throw new Error(`source PTS/cache frame count mismatch R${round}: pts=${framePts.length} jpeg=${files.length}`);
  report.clips.push(entry);
  process.stdout.write(`decode R${round} done count=${files.length} last=${entry.lastDecodedFile}\n`);
}
const reportPath = path.join(outputDir, 'decode-manifest.json');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`report ${reportPath}\n`);
