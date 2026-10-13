// 卫戍协议：共鸣「音浪」的界面音色：用 WebAudio 合成，不用音频素材。核心是共鸣：音叉与木琴的叩击、拨弦、失谐收拢成齐音、
// 上行八度、随档位丰富的和弦、共鸣钟、泛音叠加成的音浪、下滑渐弱的失谐。
//
// 作为 audio.js 的界面音色（AudioManager.setUiVoicing）接在音效通道上：跟随设置里的音效音量与静音，第一次点按之前不发声。
// 每个音色先过一道柔和的低通（去掉刺耳的高频），起音至少 1.5 ms（不出爆音），峰值比它替换的原版音效低 5～9 dB。
// 没有音色的界面音（报错、倒计时、结算、首领……）仍播放原版音效。

/** Chords and fifths are tuned just (3 : 2, 5 : 4): pure sines in equal temperament beat slowly against each other's
 *  overtones. The parameter choices were compared by sensory roughness (Vassilakis) on offline renders.
 *  UI sound name → resonance voice. Names without a voice keep the manifest's sample. */
export const RESONANCE_VOICES = Object.freeze({
  click: 'knock', tab: 'knock', pick: 'knock', confirm: 'knock', equip: 'equip',
  buy: 'pluck', drop: 'place', ready: 'ready',   // (lifting a piece plays the native 'pick': a knock)
  refresh: 'refresh', levelup: 'xp', levelBurst: 'levelBurst',
  combine: 'unison', starUp: 'octave', claim: 'claim', merge: 'chime',
  pactTier: 'pact', bondUp: 'silent',   // the tier cue (with its tier) is the match screen's own; the native count cue is dropped
  // a round starts: ROUND_START's cue, or 休整 when the round opens straight into its prep (a solo run never shows ROUND_START)
  roundStart: 'bell', rest: 'bell', battleStart: 'swell',
  sell: 'fall', retreat: 'fallSoft', back: 'fallTiny',
});

const PENTATONIC = [523.25, 587.33, 659.26, 783.99, 880];   // C5 D5 E5 G5 A5: presses never clash with each other
const MAX_VOICES = 14;
let voices = 0;
let lastPress = 0;
let lastBell = 0;
let pressNote = 0;

/** A voice's bus: a gentle low-pass in front of the sfx channel; counts the voice until its last source ends. */
function bus(ctx, out, cutoff = 5200) {   // (ctx is also read by run's safety close)
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = .4;
  lp.connect(out);
  const sources = [], nodes = [lp];
  voices += 1;
  return {
    input: lp, nodes,
    add(source, stopAt) { sources.push([source, stopAt]); },
    run(startAt) {
      let left = sources.length, closed = false;
      const close = () => { if (closed) return; closed = true; voices = Math.max(0, voices - 1); for (const n of nodes) { try { n.disconnect(); } catch { /* ignore */ } } };
      const end = () => { left -= 1; if (left <= 0) close(); };
      let last = startAt;
      for (const [s, stop] of sources) { s.onended = end; s.start(Math.max(startAt, s.__at ?? startAt)); s.stop(stop); last = Math.max(last, stop); }
      setTimeout(close, (last - (ctx.currentTime || 0)) * 1000 + 500);   // a suspended context may never end its sources
    },
  };
}

/** One partial: a linear attack from silence, then an exponential fall to -60 dB at `decay` seconds. */
function tone(ctx, b, t, { freq, gain, attack = .002, decay = .3, type = 'sine', glideTo = null, glideTime = .3, glideCurve = 'exp', detuneTo = null }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) { if (glideCurve === 'exp') o.frequency.exponentialRampToValueAtTime(glideTo, t + glideTime); else o.frequency.linearRampToValueAtTime(glideTo, t + glideTime); }
  if (detuneTo != null) { o.detune.setValueAtTime(0, t); o.detune.linearRampToValueAtTime(detuneTo, t + decay); }
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay / 6.9);
  o.connect(g); g.connect(b.input); b.nodes.push(g);
  o.__at = t; b.add(o, t + attack + decay * 1.15);
  return o;
}

let noiseBuffer = null;
function noise(ctx) {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 2.4);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** A short band of noise (a mallet's contact, a swell's breath). */
function hiss(ctx, b, t, { gain, attack = .001, decay = .012, type = 'bandpass', freq = 2400, q = .9, sweepTo = null, sweepTime = .3 }) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise(ctx);
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + sweepTime);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.setTargetAtTime(0, t + attack, decay / 6.9);
  s.connect(f); f.connect(g); g.connect(b.input); b.nodes.push(f, g);
  s.__at = t; b.add(s, t + attack + decay * 1.2);
}

const plucks = new Map();
/** Karplus–Strong: a soft noise burst circulating in a damped delay line of one period — a plucked string. */
function pluckBuffer(ctx, freq, seconds = .9, bright = .7, damp = .996) {
  const key = `${ctx.sampleRate}:${freq}:${bright}:${damp}`;
  if (plucks.has(key)) return plucks.get(key);
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), period = Math.max(2, Math.round(sr / freq));
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < period; i++) { lp += bright * ((Math.random() * 2 - 1) - lp); d[i] = lp; }
  for (let i = period; i < n; i++) d[i] = damp * .5 * (d[i - period] + d[i - period - 1 < 0 ? 0 : i - period - 1]);
  // a DC blocker (the circulating burst keeps its mean), then a 2 ms fade-in and a 60 ms fade-out: no steps at either end
  for (let i = 0, x1 = 0, y1 = 0; i < n; i++) { const x = d[i]; y1 = x - x1 + .995 * y1; x1 = x; d[i] = y1; }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < n; i++) d[i] /= peak;
  // a 2 ms fade-in: the burst never starts on a step
  for (let i = 0, m = Math.floor(sr * .002); i < m; i++) d[i] *= i / m;
  for (let i = 0, m = Math.floor(sr * .06); i < m; i++) d[n - 1 - i] *= i / m;
  if (plucks.size > 24) plucks.delete(plucks.keys().next().value);
  plucks.set(key, buf);
  return buf;
}
function pluck(ctx, b, t, { freq, gain, bright = .7, damp = .996, seconds = .9 }) {
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = pluckBuffer(ctx, freq, seconds, bright, damp);
  g.gain.value = gain;
  s.connect(g); g.connect(b.input); b.nodes.push(g);
  s.__at = t; b.add(s, t + seconds);
}

// ---- the voices ------------------------------------------------------------------------------------------------------

/** 共鸣叩击: a tuning fork struck like a xylophone bar — the note, its octave, the bar's inharmonic modes, the mallet. */
function knock(ctx, b, t, freq, gain, { decay = .42, mallet = true } = {}) {
  tone(ctx, b, t, { freq, gain, attack: .0015, decay });
  tone(ctx, b, t, { freq: freq * 2, gain: gain * .16, attack: .0015, decay: decay * .36 });
  tone(ctx, b, t, { freq: freq * 2.76, gain: gain * .07, attack: .0015, decay: decay * .14 });
  tone(ctx, b, t, { freq: freq * 5.4, gain: gain * .02, attack: .0015, decay: decay * .07 });
  if (mallet) hiss(ctx, b, t, { gain: gain * .1, decay: .012, freq: Math.min(3200, freq * 3) });
}
/** A bell-like tone (the octave chord, the chimes): the note with a soft octave and twelfth. */
function bellTone(ctx, b, t, freq, gain, decay = .9) {
  tone(ctx, b, t, { freq, gain, attack: .003, decay });
  tone(ctx, b, t, { freq: freq * 2, gain: gain * .22, attack: .003, decay: decay * .5 });
  tone(ctx, b, t, { freq: freq * 3, gain: gain * .06, attack: .003, decay: decay * .22 });
}

const VOICE = {
  knock(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 5600);
    knock(ctx, b, t, PENTATONIC[pressNote++ % PENTATONIC.length], gain);
    return b;
  },
  place(ctx, out, t, { gain }) {   // setting it down: a lower, rounder knock
    const b = bus(ctx, out, 4200);
    knock(ctx, b, t, 392, gain * .9, { decay: .3 });
    return b;
  },
  ready(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 5600);
    knock(ctx, b, t, 523.25, gain * .85);
    knock(ctx, b, t + .085, 784.88, gain * .85);
    return b;
  },
  equip(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 5000);
    knock(ctx, b, t, 587.33, gain * .7, { decay: .2 });
    pluck(ctx, b, t + .02, { freq: 293.66, gain: gain * .55, bright: .4, seconds: .6 });
    return b;
  },
  /** 购买：拨弦 — a plucked fifth (D5 then A5). */
  pluck(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 4000);
    pluck(ctx, b, t, { freq: 587.33, gain, seconds: .9 });
    pluck(ctx, b, t + .045, { freq: 880.99, gain: gain * .55, seconds: .7 });
    return b;
  },
  /** 商店刷新: a quick rising arpeggio (C E G C E, just), like a spectrum sweeping up — no seconds ring against each other. */
  refresh(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 5200);
    [523.25, 654.06, 784.88, 1046.5, 1308.1].forEach((freq, i) => knock(ctx, b, t + i * .032, freq, gain * (.55 + i * .07), { decay: .16, mallet: i === 0 }));
    hiss(ctx, b, t, { gain: gain * .05, attack: .06, decay: .2, type: 'bandpass', freq: 900, q: 1.4, sweepTo: 3600, sweepTime: .18 });
    return b;
  },
  /** 购买经验: two knocks a fifth apart. */
  xp(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 5600);
    knock(ctx, b, t, 659.26, gain * .8, { decay: .18 });
    knock(ctx, b, t + .06, 988.38, gain * .7, { decay: .22, mallet: false });
    return b;
  },
  /** 升级：一次共振爆发 — a major chord struck at once, an upward glide ringing over it. */
  levelBurst(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 5200);
    for (const [freq, g] of [[523.25, 1], [654.06, .8], [784.88, .8], [1046.5, .6]]) bellTone(ctx, b, t, freq, gain * g * .42, 1.1);
    tone(ctx, b, t, { freq: 523.25, gain: gain * .16, attack: .02, decay: .5, glideTo: 1046.5, glideTime: .22 });
    return b;
  },
  /** 合成：两个略失谐的音收拢成齐音 — ±32 cents gliding into one A4 (the beating slows to nothing), then the locked note rings. */
  unison(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 3800);
    const f = 440, d = 2 ** (32 / 1200);
    for (const start of [f * d, f / d]) {
      tone(ctx, b, t, { freq: start, gain: gain * .42, attack: .03, decay: 1.05, type: 'triangle', glideTo: f, glideTime: .34 });
    }
    bellTone(ctx, b, t + .34, f * 2, gain * .34, .7);
    return b;
  },
  /** 升星：上行八度和弦 — C5, G5, C6 struck upward, C7 shimmering on top. */
  octave(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 5400);
    [[523.25, 0, 1], [784.88, .07, .85], [1046.5, .14, .8], [2093, .22, .22]].forEach(([freq, dt, g]) => bellTone(ctx, b, t + dt, freq, gain * g * .62, 1));
    return b;
  },
  /** 盟约升档：和弦随档位丰富 — root and fifth, then the third, the octave, the tenth, the twelfth …; high tiers add overtones. */
  pact(ctx, out, t, { gain, tier = 1 }) {
    const b = bus(ctx, out, 4800);
    const root = 293.66;   // D4
    // the harmonic series of D2 (4 : 6 : 5 : 8 : 10 : 12 : 16 : 20): every added voice is consonant with the others
    const steps = [1, 1.5, 1.25, 2, 2.5, 3, 4, 5];
    const n = Math.max(2, Math.min(steps.length, Number(tier) + 1));
    const each = gain * .62 / Math.sqrt(n);
    steps.slice(0, n).forEach((ratio, i) => {
      tone(ctx, b, t + i * .018, { freq: root * ratio, gain: each, attack: .025, decay: 1.3 });
      tone(ctx, b, t + i * .018, { freq: root * ratio * 2, gain: each * .12, attack: .02, decay: .6 });
    });
    for (let k = 3; k <= Math.min(6, tier); k++) tone(ctx, b, t + .05 * (k - 2), { freq: root * 2 * k, gain: gain * .035, attack: .01, decay: .5 });
    return b;
  },
  claim(ctx, out, t, { gain }) {   // a strategy / a supply taken: a small chime of two bells
    const b = bus(ctx, out, 5200);
    bellTone(ctx, b, t, 659.26, gain * .55, .8);
    bellTone(ctx, b, t + .07, 988.89, gain * .45, .8);
    return b;
  },
  chime(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 5200);
    bellTone(ctx, b, t, 783.99, gain * .55, .8);
    return b;
  },
  /** 回合开始：一声清亮的共鸣钟 — Risset's inharmonic bell partials on 880 Hz, the low ones paired and slightly detuned. */
  bell(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 6200);
    const f = 880, total = 2.2;
    const partials = [[.56, 1, 1], [.56, .67, .9, 1], [.92, 1, .65], [.92, 1.8, .55, 1.7], [1.19, 2.67, .325], [1.7, 1.67, .35], [2, 1.46, .25], [2.74, 1.33, .2], [3, 1.33, .15], [3.76, .6, .1], [4.07, .5, .075]];
    const sum = partials.reduce((s, p) => s + p[1], 0);
    for (const [ratio, amp, dur, offset = 0] of partials) tone(ctx, b, t, { freq: f * ratio + offset, gain: gain * 1.25 * amp / sum, attack: .002, decay: total * dur });
    return b;
  },
  /** 战斗开始：泛音逐层叠加成音浪 — D3's harmonics entering one by one, swelling together, then falling away. */
  swell(ctx, out, t, { gain }) {
    const b = bus(ctx, out, 4400);
    const f = 146.83;
    for (let n = 1; n <= 8; n++) {
      const at = t + (n - 1) * .075, peak = gain * .5 / n ** .7;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f * n, at);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + .22);
      g.gain.setValueAtTime(peak, t + .9); g.gain.setTargetAtTime(0, t + .9, .16);
      o.connect(g); g.connect(b.input); b.nodes.push(g);
      o.__at = at; b.add(o, t + 2);
    }
    hiss(ctx, b, t, { gain: gain * .04, attack: .45, decay: 1.1, type: 'bandpass', freq: 260, q: 2, sweepTo: 1000, sweepTime: .8 });
    return b;
  },
  /** 出售：音高下滑、失谐渐弱 — two voices on G5 falling an octave, drifting apart (the beating quickens) as they fade. */
  fall(ctx, out, t, { gain, ratio = .5, dur = .55 }) {
    const b = bus(ctx, out, 3600);
    tone(ctx, b, t, { freq: 783.99, gain: gain * .5, attack: .006, decay: dur, glideTo: 783.99 * ratio, glideTime: dur * .9 });
    tone(ctx, b, t, { freq: 783.99 * 1.004, gain: gain * .42, attack: .006, decay: dur, glideTo: 783.99 * ratio, glideTime: dur * .9, detuneTo: -70 });
    tone(ctx, b, t, { freq: 1567.98, gain: gain * .08, attack: .004, decay: dur * .4, glideTo: 1567.98 * ratio, glideTime: dur * .4 });
    return b;
  },
  fallSoft(ctx, out, t, o) { return VOICE.fall(ctx, out, t, { ...o, gain: o.gain * .8, ratio: .75, dur: .45 }); },
  fallTiny(ctx, out, t, o) { return VOICE.fall(ctx, out, t, { ...o, gain: o.gain * .5, ratio: .84, dur: .28 }); },
  silent() { return null; },
};

/** Peak gain of each voice before the callers' relative volume: at the default sfx volume each peaks about 4–9 dB under the
 *  original sample of the same name (offline renders: click 0.52 → 0.21, buy 0.41 → 0.21, 开战 0.50 → 0.27, 回合 0.52 / 休整
 *  0.30 → 0.19, drop 0.23 → 0.11, sell 0.25 → 0.13). */
export const VOICE_GAIN = Object.freeze({
  knock: .34, place: .21, ready: .34, equip: .3, pluck: .42, refresh: .24, xp: .32, levelBurst: .2,
  unison: .5, octave: .42, pact: .4, claim: .4, chime: .38, bell: .42, swell: .34, fall: .24, fallSoft: .24, fallTiny: .24, silent: 0,
});

/** Play one voice by its kind (the audition tools call this directly). */
export function playResonanceVoice(kind, ctx, destination, t = ctx.currentTime + .005, opts = {}) {
  const make = VOICE[kind];
  if (!make) return false;
  const level = Math.max(.2, Math.min(1, opts.volume ?? .9));
  const b = make(ctx, destination, t, { ...opts, gain: (VOICE_GAIN[kind] ?? .3) * level });
  b?.run(t);
  return true;
}

/**
 * The resonance voicing for AudioManager.setUiVoicing: plays the voice of a UI sound name and returns true, or false when
 * the name has none (the manifest's sample plays).
 * @param {string} name @param {{ volume?: number, tier?: number }} o @param {{ ctx: AudioContext, destination: AudioNode }} out
 */
export function resonanceVoicing(name, o, { ctx, destination }) {
  const kind = RESONANCE_VOICES[name];
  if (!kind) return false;
  if (kind === 'silent' || voices >= MAX_VOICES) return true;   // (a burst of presses past the cap is dropped, not queued)
  const now = Date.now();
  if (kind === 'knock' || kind === 'place') { if (now - lastPress < 30) return true; lastPress = now; }
  if (kind === 'bell') { if (now - lastBell < 3000) return true; lastBell = now; }   // ROUND_START, then 休整: one bell a round
  try { playResonanceVoice(kind, ctx, destination, ctx.currentTime + .005, { volume: kind === 'bell' ? .9 : o?.volume, tier: o?.tier }); }
  catch { /* a missing node type: stay silent */ }
  return true;
}
