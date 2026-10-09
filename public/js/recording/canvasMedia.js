export const DEFAULT_MEDIA_OPTIONS = Object.freeze({ maxDimension: 1280, fps: 24, videoBitsPerSecond: 900_000, timesliceMs: 5000 });

const bounded = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};

export function resolveMediaOptions(searchParams, defaults = DEFAULT_MEDIA_OPTIONS) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || '');
  return {
    maxDimension: bounded(params.get('recordMax'), defaults.maxDimension, 320, 2560),
    fps: bounded(params.get('recordFps'), defaults.fps, 5, 60),
    videoBitsPerSecond: bounded(params.get('recordBitrate'), defaults.videoBitsPerSecond, 200_000, 8_000_000),
    timesliceMs: bounded(params.get('recordChunkMs'), defaults.timesliceMs, 1000, 15_000),
  };
}

export function fitRecordingDimensions(width, height, maxDimension = DEFAULT_MEDIA_OPTIONS.maxDimension) {
  const w = Math.max(1, Number(width) || 1); const h = Math.max(1, Number(height) || 1);
  const cap = Math.max(1, Number(maxDimension) || DEFAULT_MEDIA_OPTIONS.maxDimension);
  const ratio = Math.min(1, cap / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

export function createCanvasMediaRecorder({ stream, MediaRecorderCtor = globalThis.MediaRecorder, options = {}, onChunk = () => {}, onError = () => {} } = {}) {
  if (!stream || typeof MediaRecorderCtor !== 'function') throw new TypeError('canvas media recording requires a stream and MediaRecorder');
  const config = { ...DEFAULT_MEDIA_OPTIONS, ...options };
  const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorderCtor.isTypeSupported?.(type)) || '';
  if (!mimeType) throw new Error('no supported WebM media type');
  const recorder = new MediaRecorderCtor(stream, { mimeType, videoBitsPerSecond: config.videoBitsPerSecond, videoKeyFrameIntervalDuration: 1000 });
  recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) onChunk({ blob: event.data, timecode: event.timecode, mimeType }); });
  recorder.addEventListener('error', (event) => onError(event.error || new Error('MediaRecorder error')));
  return {
    recorder, stream, mimeType,
    start() { recorder.start(config.timesliceMs); },
    stop() {
      if (recorder.state === 'inactive') return Promise.resolve();
      return new Promise((resolve) => { recorder.addEventListener('stop', resolve, { once: true }); recorder.stop(); });
    },
    dispose() { for (const track of stream.getTracks()) track.stop(); },
  };
}
