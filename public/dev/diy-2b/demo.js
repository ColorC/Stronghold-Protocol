// dev/diy-2b/demo.js — online battle demo of the DIY operator 2B (NieR:Automata), a DRAFT for review.
//   * loads diy-2b/data.json (card, stats, skills, animation contract) and the Spine model it names
//     (model/front, optional model/back); every action maps onto the first clip the skeleton actually has, missing
//     bones / events fall back to fixed offsets / timers, so a half-finished model still plays the whole loop
//   * a small Arknights-like lane: 2B on a tile facing right, waves of the game's own enemy Spines walking left;
//     auto battle with blocking, Attack (2 hits) / S1 三连斩 / Pod talent volley / S2 laser / S3 self-destruct,
//     the dodge talent, damage numbers. Hits, bullets, laser ticks, the blast and the deploy ring are driven by the
//     skeleton's Spine events (OnAttack, OnPodShot, OnLaser, OnBlast, OnStart), timers only fill in for clips
//     that lack them. Body clips run on track 0, Pod clips on track 1 (data.json animContract)
//   * camera: drag to pan, wheel zooms at the cursor, two-finger pinch, double-click / double-tap resets
//   * inspector: any clip on loop (track 0 / track 1), bone overlay, front/back model, speed, pause, single step
// Every URL is relative to this module (the public host serves the app under /stronghold/).
// Query: ?auto=0 (start in the inspector) &speed=<x> &bones=1 &panel=0
// Puppeteer hook: window.__diy = { ready, setAuto(b), play(name), stats(), cast(i), fillSp(), pause(b), step(),
//   setSpeed(x), view(), setView({x,y,zoom}), resetView(), errors }

const PIXI = globalThis.PIXI;
const $ = (id) => document.getElementById(id);
const here = (p) => new URL(p, import.meta.url).href;
const q = new URLSearchParams(location.search);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---- field ----------------------------------------------------------------------------------------------------
const TILE = 96;              // world px per tile at zoom 1
const ROW_H = 76;             // on-screen depth of a tile row (a slight top-down tilt)
const COLS = 12;              // lane length in tiles
const ROWS = [-2, -1, 0, 1, 2];
const LANE = 0;               // the enemy route row
const OP_COL = 3, SPAWN_COL = COLS - 1, GOAL_COL = 0;
const MODEL_K = TILE / 320;   // skeleton units → world px, as the game (render/style.js UNIT.modelScale = 1/320 tile)
const FLY_HOVER = 0.32;       // tiles a flyer floats above the ground (render/units.js FLY_HOVER)
const tileX = (c) => (c + 0.5) * TILE;
const rowY = (r) => r * ROW_H;
const FIELD_END = COLS * TILE;
const ZOOM_MIN = 0.3, ZOOM_MAX = 4;
const FONT_NUM = ['Bender', 'Oxanium', 'Arial', 'sans-serif'];
const FONT_CJK = ['Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'];

// Demo enemies: models / clips from the game's data (data/enemies.json + data/assets.json: 猎狗pro, 妖怪, 大鲍勃),
// HP / ATK scaled for a showcase lane. 妖怪 is a flying drone that never attacks: melee 2B can neither block nor
// hit it — the S2 laser and the S3 blast can. Enemy models face right (render/units.js ENEMY_MODEL_FACES_LEFT =
// false), so they are mirrored to walk left. `speed` is tiles / s, `hit` the strike time when the clip has no event,
// `r` the half body width in tiles (a blocked enemy stands that far clear of 2B so both stay readable).
const ENEMIES = {
  hound: { id: 'enemy_1000_gopro_2', name: '猎狗pro', hp: 1700, atk: 300, def: 0, res: 20, speed: 1.4, bat: 1.4, k: 0.963, hit: 0.6, r: 0.22 },
  drone: { id: 'enemy_1005_yokai', name: '妖怪', hp: 800, atk: 0, def: 50, res: 0, speed: 0.8, bat: 99, k: 0.7407, fly: true, r: 0.25 },
  bigbo: { id: 'enemy_1001_bigbo', name: '大鲍勃', hp: 6500, atk: 700, def: 260, res: 30, speed: 0.55, bat: 3.5, k: 1.1111, hit: 0.167, elite: true, r: 0.42 },
};
const WAVES = [['hound', 'hound'], ['hound', 'drone', 'hound'], ['bigbo', 'hound', 'hound'], ['hound', 'hound', 'drone', 'hound'], ['bigbo', 'drone', 'hound']];

const physDmg = (atk, def) => Math.max(atk - def, atk * 0.05);
const artsDmg = (atk, res) => Math.max(atk * (1 - res / 100), atk * 0.05);

// ---- state ----------------------------------------------------------------------------------------------------
const S = {
  data: null, stats: null, skills: [], app: null, L: {}, TEX: {}, models: { front: null, back: null },
  auto: q.get('auto') !== '0', autoCast: true, speed: clamp(Number(q.get('speed')) || 1, 0.25, 2), paused: false, stepQ: 0,
  showBones: q.get('bones') === '1', showRange: true, showNums: true,
  time: 0, wave: 0, kills: 0, leaked: 0, spawnQ: [], spawnT: 0, waveIdle: 0, sinceWave: 0,
  enemies: [], enemyData: {}, fx: [], pops: [], op: null, sp: [0, 0, 0], s2: null, s3: null, laser: null, podShot: null,
  cam: { x: 0, y: 0, z: 1 }, userMoved: false, shake: 0, flash: 0, numK: 1,
  rangeCells: new Set(), evLog: [], manual: { body: null, pod: null },
  counts: { attacks: 0, hits: 0, podBullets: 0, laserTicks: 0, blasts: 0, dodges: 0, taken: 0, events: {} },
};
const diy = { ready: false, errors: [] };
window.__diy = diy;
window.addEventListener('error', (e) => diy.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => diy.errors.push(String(e.reason?.message || e.reason)));

// ---- Spine helpers --------------------------------------------------------------------------------------------
const animNames = (data) => new Set((data.animations || []).map((a) => a.name));
const animDur = (data, name) => { const a = name && data.findAnimation(name); return a ? a.duration : 0; };
const evName = (e) => (e && e.data && e.data.name) || (e && e.name) || '';
/** Times of the events of clip `name` whose name matches `match` (string = exact, RegExp = test). */
function eventTimes(data, name, match) {
  const a = name && data.findAnimation(name);
  if (!a) return [];
  const out = [];
  for (const tl of a.timelines || []) {
    if (!tl || !Array.isArray(tl.events)) continue;
    for (const e of tl.events) {
      const n = evName(e);
      if (typeof match === 'string' ? n === match : match.test(n)) out.push(e.time);
    }
  }
  return out.sort((x, y) => x - y);
}
function makeSpine(data) {
  const sp = new PIXI.spine.Spine(data);
  sp.autoUpdate = false;           // one clock for everything: speed / pause / step
  sp.stateData.defaultMix = 0.08;
  return sp;
}
/** Action → clip of this skeleton (first that exists), per the contract in data.json animContract. */
function mapAnims(names) {
  const pick = (...c) => c.find((n) => n && names.has(n)) || null;
  return {
    idle: pick('Idle', 'Default'), start: pick('Start'),
    attack: pick('Attack', 'Thrust'), s1: pick('Skill_1', 'Thrust', 'Attack'),
    s2begin: pick('Skill_2_Begin'), s2loop: pick('Skill_2_Loop'), s2end: pick('Skill_2_End'),
    s3begin: pick('Skill_3_Begin'), s3end: pick('Skill_3_End', 'Skill_1', 'Attack'),
    reboot: pick('Stun_Skill_3', 'Stun'), die: pick('Die'), hit: pick('Hit'),
    podIdle: pick('Pod_Idle'), podShot: pick('Pod_Shot'),
    podLaserBegin: pick('Pod_Laser_Begin'), podLaserLoop: pick('Pod_Laser_Loop'), podLaserEnd: pick('Pod_Laser_End'),
  };
}

// ---- generated textures (Canvas2D) ----------------------------------------------------------------------------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return PIXI.Texture.from(c);
}
function buildTextures() {
  const T = S.TEX;
  // crescent slash: outer arc minus an offset circle (tapered tips), cyan glow, white core, fading tail
  T.slash = canvasTex(256, 256, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const crescent = (R, d, a1) => {
      const px = Math.cos(a1) * R, py = Math.sin(a1) * R;
      const r2 = Math.hypot(px + d, py), b1 = Math.atan2(py, px + d);
      g.beginPath();
      g.arc(cx, cy, R, -a1, a1, false);
      g.arc(cx - d, cy, r2, b1, -b1, true);
      g.closePath();
    };
    g.save();
    g.shadowColor = 'rgba(70, 215, 255, 1)'; g.shadowBlur = 22;
    g.fillStyle = 'rgba(150, 236, 255, 0.95)';
    crescent(98, 46, 1.2); g.fill();
    g.shadowBlur = 8; g.shadowColor = 'rgba(200, 250, 255, 1)';
    g.fillStyle = '#ffffff';
    crescent(98, 20, 1.12); g.fill();
    g.restore();
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, cy - 110, 0, cy + 110);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.45, 'rgba(0,0,0,0.85)');
    fade.addColorStop(0.75, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = fade; g.fillRect(0, 0, w, h);
  });
  T.glow = canvasTex(128, 128, (g, w) => {
    const r = w / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
  T.dot = canvasTex(24, 24, (g, w) => {
    const r = w / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
  T.spark = canvasTex(96, 96, (g, w) => {
    const c = w / 2;
    g.translate(c, c);
    for (const [len, wid, rot] of [[46, 5, 0], [46, 5, Math.PI / 2], [26, 3, Math.PI / 4], [26, 3, -Math.PI / 4]]) {
      g.save(); g.rotate(rot);
      const grd = g.createLinearGradient(-len, 0, len, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(-len, 0); g.lineTo(0, -wid); g.lineTo(len, 0); g.lineTo(0, wid); g.closePath(); g.fill();
      g.restore();
    }
  });
  T.ring = canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    g.shadowColor = '#fff'; g.shadowBlur = 16; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 9;
    g.beginPath(); g.arc(c, c, 110, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  });
  const beam = (stops) => canvasTex(8, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    for (const [o, a] of stops) grd.addColorStop(o, `rgba(255,255,255,${a})`);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  T.beam = beam([[0, 0], [0.22, 0.12], [0.42, 0.6], [0.5, 1], [0.58, 0.6], [0.78, 0.12], [1, 0]]);
  T.beamCore = beam([[0, 0], [0.36, 0.04], [0.46, 0.85], [0.5, 1], [0.54, 0.85], [0.64, 0.04], [1, 0]]);
  T.shadow = canvasTex(128, 64, (g, w, h) => {
    g.translate(w / 2, h / 2); g.scale(1, h / w);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.6)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.32)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, w / 2, 0, Math.PI * 2); g.fill();
  });
  T.star = canvasTex(32, 32, (g) => {
    g.translate(16, 16); g.fillStyle = '#ffe066'; g.strokeStyle = '#7a5200'; g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.stroke(); g.fill();
  });
  T.vignette = canvasTex(512, 512, (g, w) => {
    const r = w / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(40, 70, 62, 0.55)'); grd.addColorStop(0.55, 'rgba(22, 34, 31, 0.3)'); grd.addColorStop(1, 'rgba(10, 14, 13, 0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
}

// ---- fx: short-lived sprites and particles ---------------------------------------------------------------------
/** A sprite tween: scale s0→s1 (×sx/sy), alpha a0→a1 (curve exponent `ap`), optional velocity / drag / gravity / spin. */
function burst(tex, x, y, o = {}) {
  const s = new PIXI.Sprite(tex);
  s.anchor.set(o.ax ?? 0.5, o.ay ?? 0.5);
  s.position.set(x, y);
  s.rotation = o.rot || 0;
  s.tint = o.tint ?? 0xffffff;
  if (o.add !== false) s.blendMode = PIXI.BLEND_MODES.ADD;
  (o.layer || S.L.fx).addChild(s);
  const f = { t: -(o.delay || 0), dur: o.dur || 0.3, s, o, vx: o.vx || 0, vy: o.vy || 0 };
  s.visible = f.t >= 0;
  f.update = (dt) => {
    f.t += dt;
    if (f.t < 0) return true;
    s.visible = true;
    const u = Math.min(1, f.t / f.dur), e = easeOut(u);
    const sc = lerp(o.s0 ?? 1, o.s1 ?? 1, o.linear ? u : e);
    s.scale.set(sc * (o.sx || 1) * (o.flip ? -1 : 1), sc * (o.sy || 1));
    s.alpha = lerp(o.a0 ?? 1, o.a1 ?? 0, Math.pow(u, o.ap || 1));
    if (o.drag) { const k = Math.exp(-o.drag * dt); f.vx *= k; f.vy *= k; }
    if (o.grav) f.vy += o.grav * dt;
    s.x += f.vx * dt; s.y += f.vy * dt;
    if (o.spin) s.rotation += o.spin * dt;
    if (o.follow) { const p = o.follow(); s.position.set(p.x, p.y); }
    if (u >= 1) { s.destroy(); return false; }
    return true;
  };
  f.update(0);
  S.fx.push(f);
  return f;
}
function particles(x, y, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = (o.dir ?? 0) + rand(-(o.spread ?? Math.PI), o.spread ?? Math.PI), v = rand(o.v0 ?? 120, o.v1 ?? 360);
    burst(S.TEX.dot, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v * (o.squash ?? 1) + (o.up || 0), drag: o.drag ?? 5, grav: o.grav || 0,
      dur: rand(o.d0 ?? 0.22, o.d1 ?? 0.45), s0: o.s0 ?? 0.55, s1: o.s1 ?? 0.1, a0: 1, a1: 0, tint: o.tint ?? 0xffffff, delay: o.delay || 0 });
  }
}
function slashFx(x, y, rot, flipY, k = 1, tint = 0xc8f6ff) {
  const sy = flipY ? -1 : 1;
  burst(S.TEX.slash, x, y, { rot, s0: 0.3 * k, s1: 0.52 * k, sy, a0: 1, a1: 0, ap: 1.8, dur: 0.24, tint });
  burst(S.TEX.slash, x, y, { rot: rot + 0.1 * sy, s0: 0.28 * k, s1: 0.5 * k, sy, a0: 0.55, a1: 0, dur: 0.32, tint: 0x3fc8ff });
}
// Slash VFX: a designed effect, not a trace of the whole swing (the way the original blade operators do it: 锏's strip sweeps
// over 2 frames and its tail lands on the hit, 史尔特尔's arc opens like a window, then dissolves). The sword is only sampled
// every frame (updateTrail); at each hit, the tip's path over the last 0.14 s is fitted with one circle, and a smooth crescent
// band is drawn along that arc in three layers (dark backing in normal blend so it reads on light ground, a blue-white additive
// body, a thin white additive edge at the outer rim). It unfurls along the swing in 0.05 s, holds, then thins out from its tail.
const ARC = { look: 0.14, open: 0.05, hold: 0.05, fade: 0.2, seg: 48, minSweep: 55, maxSweep: 170 };
function updateTrail(dt) {
  const op = S.op; if (!op || !op.sp) return;
  if (!S.trail) S.trail = [];
  const sk = op.sp.skeleton, sw = sk.findBone('sword'), tp = sk.findBone('sword_tip');
  if (sw && tp && dt > 0) {
    const at = (f) => ({ x: op.x + (sw.worldX + (tp.worldX - sw.worldX) * f) * op.sp.scale.x, y: op.y + (sw.worldY + (tp.worldY - sw.worldY) * f) * op.sp.scale.y });
    S.trail.push({ t: S.time, grip: at(0), tip: at(1) });
  }
  while (S.trail.length && S.time - S.trail[0].t > 0.3) S.trail.shift();
}
function arcTexture(kind) {
  // u: along the arc (0 = tail, 1 = leading end); v: across (0 = inner, 1 = outer rim). A crescent: thick in the leading half,
  // tapering to points at both ends; the body fades toward the tail and toward the inside.
  const W = 256, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), v = 1 - y / (H - 1);
    const thick = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.08)), 0.7);
    const inner = 1 - thick;
    let a = 0;
    if (v >= inner) {
      const w = (v - inner) / Math.max(thick, 1e-3), lead = Math.pow(u, 0.9);
      if (kind === 'dark') a = 0.6 * Math.min(1, w * 2.5) * (0.3 + 0.7 * lead);
      else if (kind === 'body') a = Math.pow(w, 1.6) * (0.2 + 0.8 * lead);
      else a = Math.exp(-Math.pow((w - 0.94) / 0.05, 2)) * (0.3 + 0.7 * lead);
      a *= Math.min(1, (1 - v) * 40 + 0.15) * Math.min(1, u * 12) * Math.min(1, (1 - u) * 30);
    }
    const i = (y * W + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
  }
  g.putImageData(img, 0, 0); return PIXI.Texture.from(c);
}
function fitCircle(P) {                       // Kasa least squares: x^2 + y^2 + D x + E y + F = 0
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0; const n = P.length;
  for (const p of P) { const z = p.x * p.x + p.y * p.y; sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; sz += z; sxz += p.x * z; syz += p.y * z; }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [-sxz, -syz, -sz];
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A); if (Math.abs(d) < 1e-6) return null;
  const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? B[i] : v)));
  const D = det(col(0)) / d, E = det(col(1)) / d, F = det(col(2)) / d;
  const cx = -D / 2, cy = -E / 2, r2 = cx * cx + cy * cy - F; return r2 > 0 ? { x: cx, y: cy, r: Math.sqrt(r2) } : null;
}
function slashArc() {
  const q = (S.trail || []).filter((s) => S.time - s.t <= ARC.look); if (q.length < 3) return;
  const tips = q.map((s) => s.tip), last = q[q.length - 1], blade = Math.hypot(last.tip.x - last.grip.x, last.tip.y - last.grip.y);
  let c = fitCircle(tips);
  if (!c || c.r > blade * 2.2 || c.r < blade * 0.5) c = { x: last.grip.x, y: last.grip.y, r: blade };   // fall back to the hand as the pivot
  let sweep = 0, prev = Math.atan2(tips[0].y - c.y, tips[0].x - c.x);
  for (const p of tips.slice(1)) { const a = Math.atan2(p.y - c.y, p.x - c.x); let d = a - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); sweep += d; prev = a; }
  const sgn = sweep < 0 ? -1 : 1, mag = Math.min(ARC.maxSweep, Math.max(ARC.minSweep, Math.abs(sweep) * 180 / Math.PI)) * Math.PI / 180;
  const aEnd = prev, aStart = aEnd - sgn * mag;
  const layers = [['dark', 0x16202a, PIXI.BLEND_MODES.NORMAL, 0.46, 1.08], ['body', 0x9ad8ff, PIXI.BLEND_MODES.ADD, 0.5, 1.05], ['edge', 0xffffff, PIXI.BLEND_MODES.ADD, 0.5, 1.05]];
  if (!S.arcTex) S.arcTex = Object.fromEntries(['dark', 'body', 'edge'].map((k) => [k, arcTexture(k)]));
  const meshes = layers.map(([kind, tint, blend, ri, ro]) => {
    const N = ARC.seg, idx = new Uint16Array(N * 6);
    for (let j = 0; j < N; j++) idx.set([2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 1, 2 * j + 3, 2 * j + 2], j * 6);
    const m = new PIXI.Mesh(new PIXI.MeshGeometry(new Float32Array((N + 1) * 4), new Float32Array((N + 1) * 4), idx), new PIXI.MeshMaterial(S.arcTex[kind]));
    m.tint = tint; m.blendMode = blend; m.ri = ri; m.ro = ro; S.L.fx.addChild(m); return m;
  });
  let age = 0;
  const draw = () => {
    const tOpen = Math.min(1, age / ARC.open), tFade = Math.max(0, (age - ARC.open - ARC.hold) / ARC.fade);
    const w0 = Math.min(0.98, tFade * 0.9), w1 = Math.max(w0 + 0.02, tOpen);
    const grow = 1 + 0.06 * tFade, alpha = 1 - Math.pow(tFade, 1.5);
    for (const m of meshes) {
      const N = ARC.seg, vtx = new Float32Array((N + 1) * 4), uv = new Float32Array((N + 1) * 4);
      for (let j = 0; j <= N; j++) {
        const u = w0 + (w1 - w0) * j / N, a = aStart + (aEnd - aStart) * u;
        const ci = Math.cos(a), si = Math.sin(a), ri = c.r * m.ri * grow, ro = c.r * m.ro * grow;
        vtx.set([c.x + ci * ri, c.y + si * ri, c.x + ci * ro, c.y + si * ro], j * 4); uv.set([u, 1, u, 0], j * 4);
      }
      m.geometry.getBuffer('aVertexPosition').update(vtx); m.geometry.getBuffer('aTextureCoord').update(uv); m.alpha = alpha;
    }
  };
  draw();
  S.fx.push({ update(dt) { age += dt; if (age > ARC.open + ARC.hold + ARC.fade) { meshes.forEach((m) => m.destroy()); return false; } draw(); return true; } });
}
function hitSpark(x, y, tint = 0xbff3ff, k = 1) {
  burst(S.TEX.spark, x, y, { rot: rand(0, Math.PI), s0: 0.25 * k, s1: 0.75 * k, dur: 0.16, tint: 0xffffff });
  burst(S.TEX.glow, x, y, { s0: 0.15 * k, s1: 0.55 * k, a0: 0.9, dur: 0.2, tint });
  particles(x, y, Math.round(6 * k), { tint, v0: 140, v1: 380, d0: 0.15, d1: 0.32, s0: 0.45, up: -40 });
}
function deployFx() {
  const op = S.op;
  const ring = (delay, tint) => burst(S.TEX.ring, op.x, op.y, { delay, s0: 0.1, s1: 0.62, sy: 0.55, a0: 1, a1: 0, dur: 0.6, tint, layer: S.L.ground2 });
  ring(0, 0x59f4ca); ring(0.12, 0xffffff);
  burst(S.TEX.beam, op.x, op.y + 4, { ax: 0, rot: -Math.PI / 2, sx: 34, sy: 1.6, s0: 1, s1: 1.15, a0: 0.9, a1: 0, dur: 0.55, tint: 0x8ff7d8 });
  burst(S.TEX.glow, op.x, op.y, { s0: 0.4, s1: 1.4, sy: 0.45, a0: 0.8, dur: 0.5, tint: 0x4ed8af, layer: S.L.ground2 });
  particles(op.x, op.y - 4, 16, { dir: -Math.PI / 2, spread: 1.4, v0: 60, v1: 220, squash: 0.6, grav: 160, tint: 0xa8ffe6, d0: 0.4, d1: 0.7 });
}

// ---- floating numbers / labels --------------------------------------------------------------------------------
const POP_STYLE = {
  phys: { fill: ['#ffffff', '#ffc387'], stroke: '#3b1600', size: 30 },
  arts: { fill: ['#fff0fd', '#ff5ad7'], stroke: '#3a0034', size: 30 },
  heal: { fill: ['#f0fff4', '#59f48a'], stroke: '#06301a', size: 30 },
  taken: { fill: ['#ffe2e2', '#ff4d4d'], stroke: '#320000', size: 24 },
  dodge: { fill: ['#ffffff', '#8ff3ff'], stroke: '#00303a', size: 24, cjk: true },
  stun: { fill: ['#fff7cf', '#ffd44d'], stroke: '#2e2300', size: 20, cjk: true },
  skill: { fill: ['#ffffff', '#9df5d9'], stroke: '#03261c', size: 22, cjk: true },
  counter: { fill: ['#ffffff', '#ffb347'], stroke: '#331a00', size: 22, cjk: true },
  info: { fill: ['#ffffff', '#c3cbc7'], stroke: '#0a0e0d', size: 18, cjk: true },
};
const popStyles = {};
function popStyle(kind) {
  if (!popStyles[kind]) {
    const p = POP_STYLE[kind] || POP_STYLE.info;
    popStyles[kind] = new PIXI.TextStyle({
      fontFamily: p.cjk ? FONT_CJK : FONT_NUM, fontSize: p.size, fontWeight: p.cjk ? '700' : '400', fill: p.fill, fillGradientStops: [0.3, 1],
      stroke: p.stroke, strokeThickness: 5, lineJoin: 'round', dropShadow: true, dropShadowColor: '#000000', dropShadowAlpha: 0.45, dropShadowBlur: 3, dropShadowDistance: 2,
    });
  }
  return popStyles[kind];
}
const NUMERIC = new Set(['phys', 'arts', 'heal', 'taken']);
function popup(x, y, str, kind, big = 1) {
  if (!S.showNums && NUMERIC.has(kind)) return;
  const t = new PIXI.Text(String(str), popStyle(kind));
  t.anchor.set(0.5, 1);
  t.resolution = 2;
  S.L.over.addChild(t);
  S.pops.push({ t, x: x + rand(-4, 4), y, age: 0, dur: NUMERIC.has(kind) ? 0.8 : 1.1, big, kind });
}
function updatePops(dt) {
  for (let i = S.pops.length - 1; i >= 0; i--) {
    const p = S.pops[i];
    p.age += dt;
    const u = p.age / p.dur;
    if (u >= 1) { p.t.destroy(true); S.pops.splice(i, 1); continue; }
    const rise = 40 * easeOut(Math.min(1, u * 1.5));
    const pop = u < 0.1 ? lerp(1.6, 1, u / 0.1) : 1;
    p.t.position.set(p.x, p.y - rise * S.numK);
    p.t.scale.set(0.72 * p.big * pop * S.numK);
    p.t.alpha = u > 0.62 ? 1 - (u - 0.62) / 0.38 : 1;
  }
}

// ---- the operator -------------------------------------------------------------------------------------------
class Operator {
  constructor() {
    this.x = tileX(OP_COL); this.y = rowY(LANE);
    this.root = new PIXI.Container();
    this.root.position.set(this.x, this.y);
    this.root.zIndex = this.y * 10 + 5;
    S.L.units.addChild(this.root);
    this.shadow = new PIXI.Sprite(S.TEX.shadow);
    this.shadow.anchor.set(0.5); this.shadow.position.set(this.x, this.y + 2); this.shadow.scale.set(0.62, 0.5);
    S.L.shadows.addChild(this.shadow);
    this.spines = {}; this.sp = null; this.data = null; this.side = 'front';
    this.hp = this.maxHp = S.stats.maxHp;
    this.state = 'off'; this.act = null; this.blocked = []; this.atkCd = 0; this.attacks = 0; this.counter = false;
    this.flash = 0; this.deadT = 0; this.deployFxDone = false;
    this.podFallback = this._makePodFallback();
  }
  setModel(side) {
    const data = S.models[side];
    if (!data) return;
    if (this.sp) this.root.removeChild(this.sp);
    if (!this.spines[side]) {
      const sp = makeSpine(data);
      sp.scale.set(MODEL_K);
      sp.state.addListener({ event: (entry, e) => { if (this.sp === sp) onOpEvent(entry, e); } });
      this.spines[side] = sp;
    }
    this.sp = this.spines[side]; this.data = data; this.side = side;
    this.root.addChildAt(this.sp, 0);
    this.names = animNames(data);
    this.A = mapAnims(this.names);
    this.hasPod = !!this.sp.skeleton.findBone('pod');
    this.podFallback.visible = !this.hasPod;
    this.act = null;
  }
  alive() { return this.state !== 'dead' && this.state !== 'off'; }
  canBlock() { return this.state === 'idle' || this.state === 's3' || this.state === 'reboot'; }
  track(i) { const e = this.sp && this.sp.state.tracks[i]; return e && e.animation ? e : null; }
  play0(name, loop, ts = 1) {
    if (!name) return null;
    const e = this.sp.state.setAnimation(0, name, loop);
    e.timeScale = ts;
    return e;
  }
  play1(name, loop) { return name ? this.sp.state.setAnimation(1, name, loop) : null; }
  restAnim() { return (S.s2 && this.A.s2loop) || this.A.idle; }
  rest() {
    const r = this.restAnim(), cur = this.track(0);
    if (r && (!cur || cur.animation.name !== r || !cur.loop)) this.play0(r, true);
  }
  podRest() { const cur = this.track(1); if (this.A.podIdle && (!cur || cur.animation.name !== this.A.podIdle)) this.play1(this.A.podIdle, true); }
  /** World position of the first existing bone of `names`, else the fixed offset `fb` from the feet. */
  /** The skeleton has a sword tip: the slash is slashArc (fitted to the blade's real path), not the old fixed procedural arc. */
  artSmear() { return !!(this.sp && this.sp.skeleton.findBone('sword_tip')); }
  bone(names, fb) {
    const sk = this.sp && this.sp.skeleton;
    for (const n of names) {
      const b = sk && sk.findBone(n);
      if (b) return { x: this.x + b.worldX * this.sp.scale.x, y: this.y + b.worldY * this.sp.scale.y };
    }
    return { x: this.x + fb[0], y: this.y + fb[1] };
  }
  swordTip() { return this.bone(['sword_tip', 'sword', 'hand_r'], [44, -58]); }
  center() { const p = this.bone(['torso', 'hip'], [0, -52]); return { x: p.x, y: p.y - 8 }; }
  muzzle() {
    if (this.hasPod) return this.bone(['pod_muzzle', 'pod'], [-22, -150]);
    const f = this.podFallback;
    return { x: this.x + f.x + 15, y: this.y + f.y + 1 };
  }
  /** A stand-in Pod (procedural) while the skeleton has no `pod` bone. */
  _makePodFallback() {
    const g = new PIXI.Graphics();
    g.beginFill(0x3a3a36).drawRoundedRect(-11, -8, 22, 16, 3).endFill();
    g.beginFill(0xd8d2bf).drawRoundedRect(-10, -7, 20, 14, 3).endFill();
    g.beginFill(0x2b2b28).drawRect(-10, -1, 20, 2).endFill();
    g.beginFill(0x8b877a).drawRect(9, -3, 7, 6).endFill();
    g.beginFill(0xd8d2bf).drawRect(-6, 7, 3, 6).drawRect(3, 7, 3, 6).endFill();
    g.position.set(-30, -150);
    this.root.addChild(g);
    return g;
  }
}

// ---- enemies ----------------------------------------------------------------------------------------------------
const enemyBounds = {};
class Enemy {
  constructor(kind) {
    const T = ENEMIES[kind], data = S.enemyData[kind];
    this.kind = kind; this.T = T; this.data = data;
    this.hp = this.maxHp = T.hp;
    this.x = tileX(SPAWN_COL) + TILE * 0.25;
    this.y = rowY(LANE) + (T.fly ? -2 : rand(-7, 7));
    this.root = new PIXI.Container();
    this.sp = makeSpine(data);
    const k = MODEL_K * T.k;
    this.sp.scale.set(-k, k);          // models face right: mirror to walk left
    this.root.addChild(this.sp);
    S.L.units.addChild(this.root);
    this.shadow = new PIXI.Sprite(S.TEX.shadow);
    this.shadow.anchor.set(0.5); this.shadow.scale.set(0.5 * T.k * (T.fly ? 0.8 : 1), 0.42 * T.k);
    this.shadow.alpha = T.fly ? 0.45 : 1;
    S.L.shadows.addChild(this.shadow);
    const names = animNames(data), pick = (...c) => c.find((n) => names.has(n)) || null;
    this.A = { move: pick('Move_Loop', 'Move', 'Run_Loop', 'Idle'), idle: pick('Idle', 'Default'), attack: pick('Attack', 'Attack2'), die: pick('Die') };
    this.state = 'walk'; this.atkCd = 0.3; this.act = null; this.stun = 0; this.flash = 0; this.deadT = 0; this.stars = null;
    this.sp.state.addListener({ event: (entry, e) => { if (this.act && entry === this.act.entry && /attack|hit/i.test(evName(e))) this._strike(); } });
    this.sp.state.setAnimation(0, this.A.move || this.A.idle, true);
    this.sp.update(0);
    if (!enemyBounds[kind]) {
      const b = this.sp.getLocalBounds();
      enemyBounds[kind] = { cy: (b.y + b.height * 0.5) * k, top: b.y * k, h: b.height * k };
    }
    this.B = enemyBounds[kind];
    this.hover = T.fly ? -FLY_HOVER * TILE : 0;   // flyers float above their shadow, as in the game
    this._place();
  }
  alive() { return this.state !== 'dead' && this.state !== 'leak'; }
  center() { return { x: this.x - 4, y: this.y + this.hover + this.B.cy }; }
  _place() {
    if (this.T.fly) this.sp.y = this.hover + Math.sin(S.time * 2.6 + this.x * 0.01) * 3;
    this.root.position.set(this.x, this.y);
    this.root.zIndex = this.y * 10 + (this.T.fly ? 8 : 0);
    this.shadow.position.set(this.x, this.y + 2);
  }
  play(name, loop) { if (name) this.sp.state.setAnimation(0, name, loop); }
  _startAttack() {
    const anim = this.A.attack;
    if (!anim) return;
    const entry = this.sp.state.setAnimation(0, anim, false);
    const dur = animDur(this.data, anim) || 1;
    const ev = eventTimes(this.data, anim, /attack|hit/i);
    this.act = { entry, dur, synth: ev.length ? null : Math.min(dur * 0.95, this.T.hit ?? dur * 0.5), struck: false };
    this.atkCd = this.T.bat;
  }
  _strike() {
    if (!this.act || this.act.struck) return;
    this.act.struck = true;
    enemyHitsOp(this);
  }
  hurt(dmg, kind) {
    if (!this.alive()) return;
    dmg = Math.round(dmg);
    this.hp -= dmg;
    this.flash = 0.1;
    const c = this.center(), n = (this.popN = (this.popN || 0) + 1);
    popup(c.x + ((n % 3) - 1) * 20, c.y - 16 - (n % 2) * 12, dmg, kind);   // staggered: rapid ticks stay readable
    if (this.hp <= 0) this.die();
  }
  die() {
    this.state = 'dead'; this.hp = 0; this.act = null; this.stun = 0;
    this._clearStars();
    S.op.blocked = S.op.blocked.filter((e) => e !== this);
    this.sp.tint = 0xffffff;
    if (this.A.die) this.play(this.A.die, false);
    this.dieDur = this.A.die ? animDur(this.data, this.A.die) : 0.05;
    S.kills++;
  }
  stunFor(t) {
    if (!this.alive()) return;
    this.stun = Math.max(this.stun, t);
    this.act = null;
    if (!this.stars) {
      this.stars = new PIXI.Container();
      for (let i = 0; i < 3; i++) { const s = new PIXI.Sprite(S.TEX.star); s.anchor.set(0.5); s.scale.set(0.6); this.stars.addChild(s); }
      S.L.over.addChild(this.stars);
    }
    const c = this.center();
    popup(c.x, this.y + this.hover + this.B.top - 4, '晕眩', 'stun');
  }
  _clearStars() { if (this.stars) { this.stars.destroy({ children: true }); this.stars = null; } }
  leak() { this.state = 'leak'; S.leaked++; S.op.blocked = S.op.blocked.filter((e) => e !== this); this._clearStars(); goalPulse(); }
  update(dt) {
    const op = S.op;
    this.flash = Math.max(0, this.flash - dt);
    if (this.state === 'dead') {
      this.deadT += dt;
      if (this.deadT > this.dieDur) this.root.alpha = Math.max(0, 1 - (this.deadT - this.dieDur) / 0.45);
      this.shadow.alpha = this.root.alpha * (this.T.fly ? 0.45 : 1);
      if (this.T.fly) this.sp.y = Math.min(0, this.sp.y + 160 * dt);   // a downed drone drops to the ground
      this.sp.update(dt);
      if (this.root.alpha <= 0) this.gone = true;
      return;
    }
    if (this.state === 'leak') {
      this.x -= this.T.speed * TILE * dt;
      this.root.alpha = Math.max(0, this.root.alpha - dt * 2.5);
      this.shadow.alpha = this.root.alpha;
      this._place(); this.sp.update(dt);
      if (this.root.alpha <= 0) this.gone = true;
      return;
    }
    if (this.stun > 0) {
      this.stun -= dt;
      this.sp.update(0);                                   // frozen, as stunned units are in the game
      this.sp.tint = 0xa9a9c6;
      if (this.stars) {
        const top = this.y + this.hover + this.B.top - 6;
        this.stars.children.forEach((s, i) => {
          const a = S.time * 4.5 + (i * Math.PI * 2) / 3;
          s.position.set(this.x + Math.cos(a) * 16, top + Math.sin(a) * 5);
          s.alpha = Math.sin(a) > 0 ? 1 : 0.6;
        });
      }
      if (this.stun <= 0) { this._clearStars(); this.sp.tint = 0xffffff; this.play(this.state === 'block' ? this.A.idle : this.A.move, true); }
      return;
    }
    if (this.state === 'block') {
      if (!op.canBlock()) { this.state = 'walk'; this.act = null; this.play(this.A.move, true); op.blocked = op.blocked.filter((e) => e !== this); }
      else {
        this.atkCd -= dt;
        if (this.act) {
          const tt = this.act.entry.trackTime;
          if (this.act.synth != null && tt >= this.act.synth) this._strike();
          if (tt >= this.act.dur) { this.act = null; this.play(this.A.idle, true); }
        } else if (this.T.atk > 0 && this.atkCd <= 0) this._startAttack();
      }
    }
    if (this.state === 'walk') {
      this.x -= this.T.speed * TILE * dt;
      const n = op.blocked.length;
      if (!this.T.fly && op.canBlock() && n < S.stats.blockCnt && this.x <= op.x + TILE * (0.45 + this.T.r + 0.2 * n) && this.x > op.x - TILE * 0.5) {
        this.state = 'block';
        op.blocked.push(this);
        this.y = rowY(LANE) + (n ? 9 : -3);
        this.atkCd = Math.min(this.atkCd, 0.4);
        this.play(this.A.idle, true);
      } else if (this.x < tileX(GOAL_COL)) this.leak();
    }
    this.sp.tint = this.flash > 0 ? 0xffb0b0 : 0xffffff;
    this._place();
    this.sp.update(dt);
  }
  destroy() { this._clearStars(); this.root.destroy({ children: true }); this.shadow.destroy(); }
}

// ---- battle -------------------------------------------------------------------------------------------------------
const SK = (i) => S.skills[i] || {};
function inRange(e) {
  if (!e.alive() || e.T.fly) return false;          // melee: ground units in the range tiles only
  return S.rangeCells.has(`${Math.floor(e.x / TILE)},${Math.round(e.y / ROW_H)}`);
}
function pickTarget(prefer) {
  if (prefer && inRange(prefer)) return prefer;
  const list = S.enemies.filter(inRange);
  list.sort((a, b) => (S.op.blocked.includes(b) - S.op.blocked.includes(a)) || a.x - b.x);
  return list[0] || null;
}
const within = (tiles) => S.enemies.filter((e) => e.alive() && Math.hypot((e.x - S.op.x) / TILE, (e.y - S.op.y) / ROW_H) <= tiles);
const laneAhead = (tiles) => S.enemies.filter((e) => e.alive() && e.x > S.op.x - TILE * 0.3 && e.x < S.op.x + TILE * tiles);

function opDeploy() {
  const op = S.op;
  op.state = 'deploy'; op.hp = op.maxHp; op.root.alpha = 1; op.shadow.alpha = 1; op.act = null; op.blocked = []; op.counter = false;
  op.deployFxDone = false; op.atkCd = 0.2; op.attacks = 0;
  S.sp = S.skills.map((s) => s.initSp || 0);
  S.s2 = null; S.s3 = null; S.podShot = null;
  const e = op.play0(op.A.start || op.A.idle, !op.A.start);
  op.deployEntry = op.A.start ? e : null;
  op.podRest();
  if (!op.A.start || !eventTimes(op.data, op.A.start, 'OnStart').length) { deployFx(); op.deployFxDone = true; }
}
function startAttack(target) {
  const op = S.op, A = op.A, cost = SK(0).spCost || 5;
  const s1 = S.sp[0] >= cost && !!A.s1;
  const anim = s1 ? A.s1 : A.attack;
  if (!anim) return;
  const n = s1 ? 3 : 2;
  if (s1) { S.sp[0] = 0; popup(op.x, op.y - 122, SK(0).name || '轻重连段', 'skill'); }
  else S.sp[0] = Math.min(cost, S.sp[0] + 1);       // INCREASE_WHEN_ATTACK
  const counter = op.counter;
  op.counter = false;
  if (counter) popup(op.x + 14, op.y - 100, '反击 ×1.5', 'counter');
  const dur = animDur(op.data, anim) || 1;
  const ts = Math.max(1, dur / S.stats.bat);          // the clip never outlasts one attack interval
  const entry = op.play0(anim, false, ts);
  const ev = eventTimes(op.data, anim, 'OnAttack');
  const synth = [];
  for (let k = ev.length; k < n; k++) {
    synth.push(Math.min(dur * 0.97, ev.length ? ev[ev.length - 1] + 0.12 * (k - ev.length + 1) : dur * (0.3 + (0.45 * k) / Math.max(1, n - 1))));
  }
  op.act = { entry, anim, s1, n: ev.length + synth.length, mult: (s1 ? (SK(0).mult || 1.6) : 1) * (counter ? 1.5 : 1), hits: 0, synth, dur, target };
  op.atkCd = S.stats.bat;
  op.attacks++;
  S.counts.attacks++;
}
function attackHit(act) {
  const op = S.op;
  const i = act.hits++;
  S.counts.hits++;
  act.target = pickTarget(act.target);
  const tip = op.swordTip();
  const swing = act.s1 ? [[-0.55, false, 1.05], [0.5, true, 1.1], [0.02, false, 1.35]] : [[-0.45, false, 1], [0.42, true, 1]];
  const [rot, flip, k] = swing[i % swing.length];
  const t = act.target;
  const art = op.artSmear();
  if (t) {
    const c = t.center();
    if (!art) slashFx(lerp(tip.x, c.x, 0.55), lerp(tip.y, c.y, 0.55), rot, flip, k); else slashArc();
    hitSpark(c.x + rand(-8, 8), c.y + rand(-10, 10), 0xbff3ff, act.s1 ? 1.2 : 1);
    t.hurt(physDmg(S.stats.atk * act.mult, t.T.def), 'phys');
  } else if (!art) slashFx(tip.x + 18, tip.y, rot, flip, k); else slashArc();
}
function finishAttack() {
  const op = S.op, act = op.act;
  op.act = null;
  if (op.attacks % 3 === 0) podShot(act.target);     // talent 1: every 3rd attack
  op.rest();
}
function podShot(target) {
  const op = S.op, A = op.A;
  const useAnim = !!A.podShot && !S.s2 && !S.laser;   // the Pod is busy while it fires the laser
  const entry = useAnim ? op.play1(A.podShot, false) : null;
  if (entry && A.podIdle) op.sp.state.addAnimation(1, A.podIdle, true, 0);
  const ev = entry ? eventTimes(op.data, A.podShot, 'OnPodShot') : [];
  const synth = [];
  for (let k = ev.length; k < 3; k++) synth.push((ev.length ? ev[ev.length - 1] : -0.05) + 0.1 * (k - ev.length + 1));
  S.podShot = { entry, synth, t: 0, n: ev.length + synth.length, target, dur: entry ? animDur(op.data, A.podShot) : 0.4 };
}
function podBullet() {
  const op = S.op, ps = S.podShot;
  if (!ps) return;
  S.counts.podBullets++;
  ps.target = pickTarget(ps.target);
  const m = op.muzzle(), t = ps.target;
  const end = t ? t.center() : { x: m.x + TILE * 3, y: m.y + 30 };
  end.x += rand(-6, 6); end.y += rand(-10, 10);
  const per = (0.6 / Math.max(1, ps.n)) * S.stats.atk;  // talent: one volley = 60% ATK, split over its bullets
  tracer(m, end, () => { if (t && t.alive()) { t.hurt(physDmg(per, t.T.def), 'phys'); hitSpark(end.x, end.y, 0xffe2a8, 0.6); } });
}
function tracer(a, b, onHit) {
  burst(S.TEX.glow, a.x, a.y, { s0: 0.12, s1: 0.32, a0: 1, dur: 0.1, tint: 0xfff1c4 });
  const s = new PIXI.Sprite(S.TEX.beamCore);
  s.anchor.set(1, 0.5); s.blendMode = PIXI.BLEND_MODES.ADD; s.tint = 0xfff4d6;
  S.L.fx.addChild(s);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), T = Math.max(0.05, len / 2600);
  s.rotation = Math.atan2(dy, dx);
  const f = { t: 0 };
  f.update = (dt) => {
    f.t += dt;
    const u = Math.min(1, f.t / T);
    s.position.set(a.x + dx * u, a.y + dy * u);
    s.scale.set(Math.min(len * u, 70) / 8, 5 / 64 * 1.6);
    if (u >= 1) { s.destroy(); if (onHit) onHit(); return false; }
    return true;
  };
  S.fx.push(f);
}

function castSkill(i) {
  const op = S.op;
  if (!S.auto || !op.alive() || op.state === 'deploy') return false;
  const sk = SK(i);
  if (S.sp[i] < (sk.spCost || 1) || sk.skillType !== 'MANUAL') return false;
  if (i === 1 && !S.s2 && !S.s3) { castS2(); return true; }
  if (i === 2 && !S.s3) { castS3(); return true; }
  return false;
}
function castS2() {
  const op = S.op, A = op.A;
  S.sp[1] = 0;
  S.s2 = { t: 0, dur: SK(1).duration || 8 };
  popup(op.x, op.y - 122, SK(1).name || '激光', 'skill');
  const begin = A.podLaserBegin ? op.play1(A.podLaserBegin, false) : null;
  if (A.podLaserLoop) { if (begin) op.sp.state.addAnimation(1, A.podLaserLoop, true, 0); else op.play1(A.podLaserLoop, true); }
  S.laser = { phase: 'begin', beginDur: begin ? animDur(op.data, A.podLaserBegin) : 0.25, evTicks: !!A.podLaserLoop && eventTimes(op.data, A.podLaserLoop, 'OnLaser').length > 0, tickT: 0, endT: 0 };
  S.podShot = null;
  if (!op.act && op.state === 'idle' && A.s2begin) { op.play0(A.s2begin, false); op.sp.state.addAnimation(0, op.restAnim(), true, 0); }
  else if (!op.act) op.rest();
}
function endS2(now = false) {
  const op = S.op, A = op.A;
  S.s2 = null;
  if (!S.laser) return;
  S.laser.phase = 'end'; S.laser.endT = 0;
  if (now) S.laser = null;
  if (A.podLaserEnd && !now) { op.play1(A.podLaserEnd, false); if (A.podIdle) op.sp.state.addAnimation(1, A.podIdle, true, 0); }
  else op.podRest();
  const cur = op.track(0);
  if (!op.act && op.state === 'idle' && cur && A.s2loop && cur.animation.name === A.s2loop) {
    if (A.s2end) { op.play0(A.s2end, false); op.sp.state.addAnimation(0, A.idle, true, 0); } else op.rest();
  }
}
function laserTick() {
  const op = S.op;
  S.counts.laserTicks++;
  const atk = S.stats.atk * (SK(1).mult || 0.7);
  for (const e of S.enemies) {
    if (!e.alive() || e.x < op.x - TILE * 0.3 || e.x > FIELD_END) continue;   // everything on the lane ahead, flying too
    const c = e.center();
    burst(S.TEX.glow, c.x, c.y, { s0: 0.2, s1: 0.5, a0: 0.9, dur: 0.18, tint: 0xff7be4 });
    particles(c.x, c.y, 3, { tint: 0xbfefff, v0: 80, v1: 220, d0: 0.12, d1: 0.25, s0: 0.35 });
    e.hurt(artsDmg(atk, e.T.res), 'arts');
  }
  if (S.beam) S.beam.pulse = 1;
}
function castS3() {
  const op = S.op, A = op.A;
  S.sp[2] = 0;
  if (S.s2) endS2();
  op.act = null;
  op.state = 's3';
  S.s3 = { phase: 'charge', t: 0, blasted: false };
  popup(op.x, op.y - 122, SK(2).name || '自爆', 'skill');
  op.play0(A.s3begin || A.idle, !A.s3begin);
  S.s3.charge = makeCharge();
}
function makeCharge() {
  const op = S.op, c = op.center();
  const glow = burst(S.TEX.glow, c.x, c.y, { s0: 0.3, s1: 1.6, a0: 0.5, a1: 0.95, dur: 1.05, tint: 0xff9a5c, ap: 0.6, linear: true });
  const core = burst(S.TEX.glow, c.x, c.y, { s0: 0.1, s1: 0.8, a0: 0.4, a1: 1, dur: 1.05, tint: 0xffffff, linear: true });
  const ring = new PIXI.Graphics();
  S.L.ground2.addChild(ring);
  return { glow, core, ring, t: 0, pt: 0 };
}
function updateCharge(ch, dt) {
  const op = S.op, c = op.center();
  ch.t += dt; ch.pt -= dt;
  for (const f of [ch.glow, ch.core]) { f.s.position.set(c.x, c.y); f.s.scale.x *= 0.92 + Math.random() * 0.16; }
  while (ch.pt <= 0) {                                  // sparks converging on 2B
    ch.pt += 0.025;
    const a = rand(0, Math.PI * 2), r = rand(70, 120);
    burst(S.TEX.dot, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.8, { vx: -Math.cos(a) * r * 2.6, vy: -Math.sin(a) * r * 2.1, dur: 0.36, s0: 0.25, s1: 0.6, a0: 0.2, a1: 1, ap: 0.5, tint: Math.random() < 0.5 ? 0xffc48a : 0xffffff });
  }
  const g = ch.ring, u = Math.min(1, ch.t / 1);
  g.clear();
  g.lineStyle(2, 0xff8a5c, 0.25 + 0.5 * u);
  const rx = 2 * TILE, ry = 2 * ROW_H, N = 48;
  for (let i = 0; i < N; i += 2) {                      // dashed 2-tile radius on the ground
    const a0 = (i / N) * Math.PI * 2 + S.time * 0.6, a1 = ((i + 1) / N) * Math.PI * 2 + S.time * 0.6;
    g.moveTo(op.x + Math.cos(a0) * rx, op.y + Math.sin(a0) * ry);
    g.lineTo(op.x + Math.cos(a1) * rx, op.y + Math.sin(a1) * ry);
  }
  g.beginFill(0xff6a3a, 0.06 * u).drawEllipse(op.x, op.y, rx, ry).endFill();
}
function clearCharge() {
  const ch = S.s3 && S.s3.charge;
  if (!ch) return;
  ch.glow.t = ch.glow.dur; ch.core.t = ch.core.dur;
  ch.ring.destroy();
  S.s3.charge = null;
}
function doBlast() {
  const op = S.op;
  if (!S.s3 || S.s3.blasted) return;
  S.s3.blasted = true;
  S.counts.blasts++;
  clearCharge();
  blastFx(true);
  const atk = S.stats.atk * (SK(2).mult || 6);
  for (const e of within(2.15)) { e.hurt(artsDmg(atk, e.T.res), 'arts'); if (e.alive()) e.stunFor(SK(2).stun || 3); }
  void op;
}
function blastFx(withShake) {
  const op = S.op, c = op.center();
  S.flash = 0.55;
  if (withShake) S.shake = 18;
  const T = S.TEX;
  burst(T.glow, c.x, c.y, { s0: 0.6, s1: 4.2, a0: 1, a1: 0, dur: 0.55, tint: 0xffffff });
  burst(T.glow, c.x, c.y, { s0: 1, s1: 5.2, a0: 0.9, a1: 0, dur: 0.8, tint: 0xff8a4a });
  burst(T.spark, c.x, c.y, { s0: 1, s1: 4, a0: 1, a1: 0, dur: 0.3, rot: 0.3 });
  const kx = (2.25 * TILE) / 110, ky = (2.25 * ROW_H) / 110;
  burst(T.ring, op.x, op.y, { s0: 0.08, s1: 1, sx: kx, sy: ky, a0: 1, a1: 0, dur: 0.5, tint: 0xffffff, layer: S.L.ground2 });
  burst(T.ring, op.x, op.y, { s0: 0.05, s1: 1.12, sx: kx, sy: ky, a0: 0.9, a1: 0, dur: 0.7, delay: 0.06, tint: 0xff9b5c, layer: S.L.ground2 });
  burst(T.ring, c.x, c.y, { s0: 0.1, s1: 1.5, sx: 1.2, sy: 1.2, a0: 0.8, a1: 0, dur: 0.45, tint: 0xffe2b0 });
  burst(T.shadow, op.x, op.y, { s0: 2.6, s1: 3.2, sy: 1.3, a0: 0.85, a1: 0, ap: 3, dur: 4, add: false, tint: 0x000000, layer: S.L.ground2 });
  particles(c.x, c.y, 46, { v0: 200, v1: 760, drag: 3.2, grav: 260, d0: 0.4, d1: 0.9, s0: 0.7, s1: 0.1, tint: 0xffc48a, squash: 0.75 });
  particles(c.x, c.y, 18, { v0: 120, v1: 420, drag: 4, d0: 0.3, d1: 0.6, s0: 0.9, s1: 0.2, tint: 0xffffff });
}
function enemyHitsOp(e) {
  const op = S.op;
  if (!op.alive() || !e.alive()) return;
  const c = op.center();
  if (Math.random() < 0.15) {                         // talent 2: dodge, then the next attack hits at 150%
    S.counts.dodges++;
    op.counter = true;
    popup(c.x - 6, c.y - 40, '闪避', 'dodge');
    burst(S.TEX.glow, c.x - 10, c.y, { s0: 0.3, s1: 0.9, sx: 1.8, a0: 0.7, dur: 0.25, tint: 0x6fe9ff });
    return;
  }
  const d = Math.round(physDmg(e.T.atk, S.stats.def));
  op.hp -= d;
  S.counts.taken += d;
  op.flash = 0.13;
  popup(c.x - 14, c.y - 30, d, 'taken', 0.9);
  hitSpark(c.x + 16, c.y + rand(-10, 10), 0xffa070, 0.7);
  if (op.hp <= 0) opDie();
}
function opDie() {
  const op = S.op;
  op.hp = 0;
  if (S.s2) endS2(true);
  S.laser = null;
  clearCharge();
  S.s3 = null; S.podShot = null; op.act = null;
  op.state = 'dead'; op.deadT = 0;
  for (const e of op.blocked) if (e.alive()) { e.state = 'walk'; e.act = null; e.play(e.A.move, true); }
  op.blocked = [];
  op.dieEntry = op.play0(op.A.die || op.A.hit || op.A.idle, false);
  op.dieDur = animDur(op.data, op.A.die || op.A.hit) || 0.4;
  popup(op.x, op.y - 120, '撤退 · 3 秒后再部署（演示）', 'info');
}
function goalPulse() {
  burst(S.TEX.glow, tileX(GOAL_COL), rowY(LANE), { s0: 0.4, s1: 1.4, sy: 0.6, a0: 0.9, dur: 0.5, tint: 0xff4040, layer: S.L.ground2 });
}

function spawn(kind) {
  if (!S.enemyData[kind]) return;
  S.enemies.push(new Enemy(kind));
}
function nextWave() {
  S.wave++;
  let comp = WAVES[S.wave - 1];
  if (!comp) {
    const n = 2 + Math.floor(Math.random() * 3);
    comp = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      comp.push(r < 0.22 && !comp.includes('bigbo') ? 'bigbo' : r < 0.42 ? 'drone' : 'hound');
    }
  }
  S.spawnQ = comp.filter((k) => S.enemyData[k]);
  if (!S.spawnQ.length) S.spawnQ = Object.keys(S.enemyData).slice(0, 2);
  S.spawnT = 0; S.sinceWave = 0;
  popup(tileX(SPAWN_COL), rowY(LANE) - 70, `第 ${S.wave} 波`, 'info', 1.2);
}
function updateWaves(dt) {
  if (S.spawnQ.length) {
    S.spawnT -= dt;
    if (S.spawnT <= 0) { spawn(S.spawnQ.shift()); S.spawnT = rand(0.75, 1.15); }
    return;
  }
  S.sinceWave += dt;
  const alive = S.enemies.some((e) => e.alive());
  S.waveIdle = alive ? 0 : S.waveIdle + dt;
  if ((S.waveIdle >= 1.3 && S.sinceWave > 1) || S.sinceWave > 24) nextWave();
}

/** One tick of the auto battle for 2B: Spine first (fires events), then synthesized hits, then decisions. */
function opBattle(dt) {
  const op = S.op;
  op.flash = Math.max(0, op.flash - dt);
  op.sp.update(dt);
  if (op.state === 'deploy') {
    const e = op.deployEntry;
    if (!e || e.trackTime >= animDur(op.data, op.A.start)) { if (!op.deployFxDone) { deployFx(); op.deployFxDone = true; } op.state = 'idle'; op.rest(); }
    return;
  }
  if (op.state === 'dead') {
    op.deadT += dt;
    if (op.deadT > op.dieDur) op.root.alpha = Math.max(0, 1 - (op.deadT - op.dieDur) / 0.6);
    op.shadow.alpha = op.root.alpha;
    if (op.deadT > op.dieDur + 3) opDeploy();
    return;
  }
  // SP: S1 charges per attack (startAttack); S2 / S3 by time, not while running
  if (!S.s2) S.sp[1] = Math.min(SK(1).spCost || 30, S.sp[1] + dt);
  if (!S.s3) S.sp[2] = Math.min(SK(2).spCost || 40, S.sp[2] + dt);
  op.atkCd -= dt;
  // the Pod volley (talent 1)
  const ps = S.podShot;
  if (ps) {
    ps.t += dt;
    const tt = ps.entry ? ps.entry.trackTime : ps.t;
    while (ps.synth.length && tt >= ps.synth[0]) { ps.synth.shift(); podBullet(); }
    if (!ps.synth.length && tt >= ps.dur) S.podShot = null;
  }
  // S2 laser
  if (S.s2 && S.laser) {
    const L = S.laser;
    S.s2.t += dt;
    if (L.phase === 'begin' && S.s2.t >= L.beginDur) L.phase = 'loop';
    if (L.phase === 'loop' && !L.evTicks) { L.tickT -= dt; if (L.tickT <= 0) { L.tickT += 0.3; laserTick(); } }
    if (S.s2.t >= S.s2.dur) endS2();
  } else if (S.laser && S.laser.phase === 'end') {
    S.laser.endT += dt;
    if (S.laser.endT > 0.6) S.laser = null;
  }
  // S3 self-destruct: charge 1 s → blast clip (OnBlast) → reboot 6 s → full HP
  if (op.state === 's3' && S.s3) {
    const s3 = S.s3;
    s3.t += dt;
    if (s3.phase === 'charge') {
      if (s3.charge) updateCharge(s3.charge, dt);
      if (s3.t >= 1) {
        s3.phase = 'blast';
        s3.endEntry = op.play0(op.A.s3end, false);
        s3.endDur = animDur(op.data, op.A.s3end) || 0.5;
        const ev = eventTimes(op.data, op.A.s3end, 'OnBlast');
        s3.synth = ev.length ? null : Math.min(0.08, s3.endDur);
      }
    } else if (s3.phase === 'blast') {
      const tt = s3.endEntry ? s3.endEntry.trackTime : s3.endDur;
      if (s3.synth != null && tt >= s3.synth) doBlast();
      if (tt >= s3.endDur) {
        doBlast();
        s3.phase = 'reboot'; s3.rebootT = SK(2).reboot || 6;
        if (op.A.reboot) op.play0(op.A.reboot, true);
        else if (op.A.hit) op.play0(op.A.hit, false);
      }
    } else if (s3.phase === 'reboot') {
      s3.rebootT -= dt;
      if (s3.rebootT <= 0) {
        const healed = op.maxHp - op.hp;
        op.hp = op.maxHp;
        const c = op.center();
        popup(c.x, c.y - 30, `+${Math.round(healed)}`, 'heal', 1.1);
        burst(S.TEX.glow, c.x, c.y, { s0: 0.4, s1: 1.6, a0: 0.8, dur: 0.6, tint: 0x59f48a });
        particles(op.x, op.y - 10, 18, { dir: -Math.PI / 2, spread: 0.9, v0: 60, v1: 200, drag: 1.5, tint: 0x9dffc0, d0: 0.5, d1: 0.9 });
        S.s3 = null; op.state = 'idle'; op.rest();
      }
    }
    return;
  }
  // a running attack: synthesized hits for clips without enough OnAttack events, then completion
  if (op.act) {
    const act = op.act, tt = act.entry.trackTime;
    while (act.synth.length && tt >= act.synth[0]) { act.synth.shift(); attackHit(act); }
    if (tt >= act.dur) finishAttack();
  }
  if (op.state !== 'idle') return;
  // auto skills: S3 when enemies crowd 2B (or she is in trouble), S2 when anything walks the lane
  if (S.autoCast && !op.act) {
    const near = within(2.1);
    if (S.sp[2] >= (SK(2).spCost || 40) && !S.s2 && near.length && (near.length >= 2 || near.some((e) => e.T.elite) || op.hp < op.maxHp * 0.45)) { castS3(); return; }
    if (S.sp[1] >= (SK(1).spCost || 30) && !S.s2 && laneAhead(7).length) castS2();
  }
  if (!op.act && op.atkCd <= 0) {
    const t = pickTarget(null);
    if (t) startAttack(t);
  }
  if (!op.act) {
    const cur = op.track(0);
    if (cur && cur.loop === false && cur.trackTime >= cur.animationEnd && !op.sp.state.tracks[0].next) op.rest();
  }
}

/** Spine events of 2B. In the auto battle they deal the damage; in the inspector they only show their effect. */
function onOpEvent(entry, e) {
  const op = S.op, name = evName(e);
  S.counts.events[name] = (S.counts.events[name] || 0) + 1;
  S.evLog.push(`${name}@${(e.time ?? 0).toFixed(2)}`);
  if (S.evLog.length > 8) S.evLog.shift();
  if (S.pauseOn === name) { S.pauseOn = null; S.pauseNow = true; }
  if (!S.auto) { inspectorEventFx(name, entry); return; }
  if (name === 'OnAttack') { if (op.act && entry === op.act.entry && op.act.hits < op.act.n) attackHit(op.act); }
  else if (name === 'OnPodShot') { if (S.podShot && entry === S.podShot.entry) podBullet(); }
  else if (name === 'OnLaser') { if (S.laser && S.laser.phase === 'loop' && S.s2) laserTick(); }
  else if (name === 'OnBlast') { if (S.s3 && entry === S.s3.endEntry) doBlast(); }
  else if (name === 'OnStart') { if (op.state === 'deploy' && !op.deployFxDone) { deployFx(); op.deployFxDone = true; } }
  else if (name === 'OnJolt') joltFx();
}
function joltFx() {
  const op = S.op, c = op.center();
  for (let k = 0; k < 3; k++) {                               // jagged electric arcs around the torso
    const g = new PIXI.Graphics(); g.blendMode = PIXI.BLEND_MODES.ADD; S.L.fx.addChild(g);
    const a0 = rand(0, Math.PI * 2), r = rand(18, 34), pts = [];
    for (let i = 0; i <= 6; i++) { const a = a0 + i * 0.35, rr = r + rand(-7, 7); pts.push(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr * 0.9); }
    let age = 0;
    S.fx.push({ update(dt) {
      age += dt; if (age > 0.25) { g.destroy(); return false; }
      g.clear(); const al = 1 - age / 0.25;
      g.lineStyle(3.5, 0x6fd8ff, 0.6 * al); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] + rand(-2, 2), pts[i + 1] + rand(-2, 2));
      g.lineStyle(1.4, 0xffffff, al); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      return true; } });
  }
  particles(c.x, c.y - 6, 10, { tint: 0xbff3ff, v0: 120, v1: 320, d0: 0.12, d1: 0.28, s0: 0.35, up: -30 });
}
function inspectorEventFx(name) {
  const op = S.op;
  if (name === 'OnAttack') {
    // placed as in battle: between the sword tip and a stand-in target on the tile in front
    const tip = op.swordTip(), n = (S.manual.hitN = (S.manual.hitN || 0) + 1), tx = op.x + TILE * 0.9, ty = op.y - 48;
    if (!op.artSmear()) slashFx(lerp(tip.x, tx, 0.55), lerp(tip.y, ty, 0.55), n % 2 ? -0.45 : 0.42, !(n % 2), 1); else slashArc();
    hitSpark(tx, ty, 0xbff3ff, 0.7);
  } else if (name === 'OnPodShot') {
    const m = op.muzzle();
    tracer(m, { x: m.x + TILE * 3.2, y: m.y + 40 + rand(-8, 8) }, null);
  } else if (name === 'OnLaser') {
    if (S.beam) S.beam.pulse = 1;
  } else if (name === 'OnBlast') blastFx(true);
  else if (name === 'OnStart') deployFx();
  else if (name === 'OnJolt') joltFx();
}

// ---- laser beam (visual; on while the laser loops, in battle or in the inspector) -----------------------------
function makeBeam() {
  const c = new PIXI.Container();
  const sp = (tex, tint, ax = 0) => { const s = new PIXI.Sprite(tex); s.anchor.set(ax, 0.5); s.tint = tint; s.blendMode = PIXI.BLEND_MODES.ADD; c.addChild(s); return s; };
  const B = { c, glow: sp(S.TEX.beam, 0x2fb4ff), mid: sp(S.TEX.beam, 0x9feaff), core: sp(S.TEX.beamCore, 0xffffff),
    muzzle: sp(S.TEX.glow, 0xa8eeff, 0.5), flare: sp(S.TEX.spark, 0xffffff, 0.5), end: sp(S.TEX.glow, 0x63d6ff, 0.5), w: 0, charge: 0, pulse: 0, pt: 0 };
  B.muzzle.anchor.set(0.5); B.flare.anchor.set(0.5); B.end.anchor.set(0.5);
  S.L.fx.addChild(c);
  return B;
}
function updateBeam(dt) {
  const B = S.beam, op = S.op;
  if (!B || !op.sp) return;
  let on, charging;
  if (S.auto) { on = !!(S.laser && S.laser.phase === 'loop'); charging = !!(S.laser && S.laser.phase === 'begin'); }
  else { const t1 = op.track(1); const n = t1 && t1.animation.name; on = !!n && n === op.A.podLaserLoop; charging = !!n && n === op.A.podLaserBegin; }
  B.w += ((on ? 1 : 0) - B.w) * (1 - Math.exp(-dt * (on ? 28 : 9)));
  B.charge += ((charging ? 1 : 0) - B.charge) * (1 - Math.exp(-dt * 8));
  B.pulse = Math.max(0, B.pulse - dt * 6);
  if (B.w < 0.01 && B.charge < 0.01) { B.c.visible = false; return; }
  B.c.visible = true;
  const m = op.muzzle(), ex = FIELD_END + TILE * 0.15, ey = rowY(LANE) - 34;
  const dx = ex - m.x, dy = ey - m.y, len = Math.max(1, Math.hypot(dx, dy)), ang = Math.atan2(dy, dx);
  const fl = 0.86 + 0.14 * Math.random(), W = B.w * fl * (1 + 0.16 * Math.sin(S.time * 44) + 0.45 * B.pulse);
  for (const [s, h, a] of [[B.glow, 58, 0.55], [B.mid, 22, 0.85], [B.core, 8, 1]]) {
    s.position.set(m.x, m.y); s.rotation = ang; s.scale.set(len / 8, (h * W) / 64 + 0.0001); s.alpha = a * Math.min(1, B.w * 1.5);
  }
  const mk = 0.35 + 0.35 * B.w + 0.55 * B.charge + 0.25 * B.pulse;
  B.muzzle.position.set(m.x, m.y); B.muzzle.scale.set(mk * fl); B.muzzle.alpha = Math.min(1, B.w + B.charge);
  B.flare.position.set(m.x, m.y); B.flare.rotation = S.time * 3; B.flare.scale.set(mk * 0.7 * fl); B.flare.alpha = Math.min(1, B.w + B.charge * 0.6);
  B.end.position.set(ex, ey); B.end.scale.set(0.6 * B.w * fl); B.end.alpha = B.w;
  if (B.w > 0.3) {                                      // energy streaming along the beam
    B.pt -= dt;
    while (B.pt <= 0) {
      B.pt += 0.012;
      const u = rand(0, 0.15), off = rand(-6, 6) * W;
      burst(S.TEX.dot, m.x + dx * u - Math.sin(ang) * off, m.y + dy * u + Math.cos(ang) * off, { vx: Math.cos(ang) * 1500, vy: Math.sin(ang) * 1500, dur: rand(0.2, 0.45), s0: 0.45, s1: 0.2, a0: 0.9, a1: 0, tint: Math.random() < 0.5 ? 0xffffff : 0x8fe6ff });
    }
  }
}

// ---- inspector (auto battle off) ------------------------------------------------------------------------------
function setAuto(on) {
  on = !!on;
  const op = S.op;
  if (on === S.auto) return;
  S.auto = on;
  syncSwitch('swAuto', on);
  if (!on) {
    for (const e of S.enemies) e.destroy();
    S.enemies = []; S.spawnQ = [];
    clearCharge();
    S.s2 = null; S.s3 = null; S.laser = null; S.podShot = null;
    op.act = null; op.blocked = []; op.state = 'manual'; op.hp = op.maxHp; op.root.alpha = 1; op.shadow.alpha = 1; op.flash = 0;
    S.manual = { body: op.A.idle, pod: op.A.podIdle };
    if (op.A.idle) op.play0(op.A.idle, true);
    op.podRest();
  } else resetBattle();
}
function play(name) {
  const op = S.op;
  if (!op || !name || !op.names.has(name)) return false;
  if (S.auto) setAuto(false);
  if (/^Pod_/.test(name)) { op.play1(name, true); S.manual.pod = name; }
  else { op.play0(name, true); S.manual.body = name; }
  S.evLog = [];
  return true;
}
function resetBattle() {
  for (const e of S.enemies) e.destroy();
  S.enemies = []; S.spawnQ = []; S.wave = 0; S.kills = 0; S.leaked = 0; S.waveIdle = 0; S.sinceWave = 0;
  clearCharge();
  S.s2 = null; S.s3 = null; S.laser = null; S.podShot = null;
  S.auto = true; syncSwitch('swAuto', true);
  opDeploy();
  S.spawnQ = []; S.waveIdle = 0.3; S.sinceWave = 1;   // first wave right after the deploy
}

// ---- field drawing --------------------------------------------------------------------------------------------
function drawField() {
  const L = S.L;
  const v = new PIXI.Sprite(S.TEX.vignette);
  v.anchor.set(0.5); v.position.set(FIELD_END / 2, 0); v.scale.set((FIELD_END * 1.9) / 512, (ROW_H * 9) / 512);
  L.ground.addChild(v);
  const g = new PIXI.Graphics();
  L.ground.addChild(g);
  // backdrop slab under the whole map
  g.beginFill(0x0e1312, 1).drawRect(-TILE * 0.3, rowY(-2) - ROW_H / 2 - 18, FIELD_END + TILE * 0.6, ROW_H * 5 + 40).endFill();
  for (const r of ROWS) {
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE, y = rowY(r) - ROW_H / 2;
      if (Math.abs(r) === 2) {                            // high ground: raised top + front face
        g.beginFill(0x0b0f0e).drawRect(x + 1, y + ROW_H - 14, TILE - 2, 13).endFill();
        g.beginFill(0x1c2321).drawRect(x + 2, y + 1, TILE - 4, ROW_H - 16).endFill();
        g.lineStyle(1, 0x34403b, 1).moveTo(x + 2, y + 1.5).lineTo(x + TILE - 2, y + 1.5).lineStyle(0);
        if ((c + (r > 0 ? 1 : 0)) % 3 === 0) {           // hazard stripes on some wall tiles
          g.beginFill(0x2a2a1c, 0.6);
          for (let k = 0; k < 4; k++) g.drawPolygon([x + 10 + k * 20, y + ROW_H - 14, x + 20 + k * 20, y + ROW_H - 14, x + 14 + k * 20, y + ROW_H - 1, x + 4 + k * 20, y + ROW_H - 1]);
          g.endFill();
        }
      } else if (r === LANE) {                            // the route
        g.beginFill(0x2b3431).drawRect(x + 2, y + 2, TILE - 4, ROW_H - 4).endFill();
        g.beginFill(0x323d39).drawRect(x + 2, y + 2, TILE - 4, 3).endFill();
        g.lineStyle(1, 0x46534e, 0.9).drawRect(x + 2.5, y + 2.5, TILE - 5, ROW_H - 5).lineStyle(0);
      } else {                                            // ground (deployable)
        g.beginFill(0x1a201e).drawRect(x + 2, y + 2, TILE - 4, ROW_H - 4).endFill();
        g.lineStyle(1, 0x2b3531, 1).drawRect(x + 2.5, y + 2.5, TILE - 5, ROW_H - 5).lineStyle(0);
        g.beginFill(0x2b3531).drawRect(x + TILE / 2 - 4, y + ROW_H / 2 - 0.5, 8, 1).drawRect(x + TILE / 2 - 0.5, y + ROW_H / 2 - 4, 1, 8).endFill();
      }
    }
  }
  // route chevrons (enemies walk right → left)
  g.lineStyle(2, 0x53625c, 0.55);
  for (let c = 1; c < COLS - 1; c++) {
    if (c === OP_COL) continue;
    const x = tileX(c), y = rowY(LANE);
    g.moveTo(x + 5, y - 7).lineTo(x - 3, y).lineTo(x + 5, y + 7);
  }
  g.lineStyle(0);
  // incursion point (red) and protection objective (blue)
  const sx = SPAWN_COL * TILE, sy = rowY(LANE) - ROW_H / 2, bx = GOAL_COL * TILE;
  g.beginFill(0x3a1414).drawRect(sx + 2, sy + 2, TILE - 4, ROW_H - 4).endFill();
  g.lineStyle(2, 0xe73118, 1).drawRect(sx + 3, sy + 3, TILE - 6, ROW_H - 6).lineStyle(0);
  g.lineStyle(3, 0xff5a3c, 0.95);
  for (const o of [-10, 6]) { const x = tileX(SPAWN_COL) + o; g.moveTo(x + 7, sy + ROW_H / 2 - 12).lineTo(x - 5, sy + ROW_H / 2).lineTo(x + 7, sy + ROW_H / 2 + 12); }
  g.lineStyle(0);
  g.beginFill(0x10243a).drawRect(bx + 2, sy + 2, TILE - 4, ROW_H - 4).endFill();
  g.lineStyle(2, 0x3fa0ff, 1).drawRect(bx + 3, sy + 3, TILE - 6, ROW_H - 6).lineStyle(0);
  g.beginFill(0x3fa0ff, 0.9).drawPolygon([tileX(GOAL_COL), sy + 18, tileX(GOAL_COL) + 14, sy + ROW_H / 2, tileX(GOAL_COL), sy + ROW_H - 18, tileX(GOAL_COL) - 14, sy + ROW_H / 2]).endFill();
  const label = (txt, x, y, color) => {
    const t = new PIXI.Text(txt, { fontFamily: FONT_CJK, fontSize: 13, fill: color, fontWeight: '700', stroke: '#0a0e0d', strokeThickness: 3 });
    t.anchor.set(0.5, 0); t.resolution = 2; t.position.set(x, y); L.ground.addChild(t);
  };
  label('入侵点', tileX(SPAWN_COL), sy + ROW_H + 4, '#ff7a5c');
  label('保护目标', tileX(GOAL_COL), sy + ROW_H + 4, '#6fb8ff');
  // range overlay (data.json rangeGrid: [row, col] offsets, +col = the way 2B faces)
  const rg = new PIXI.Graphics();
  L.range = rg;
  L.ground.addChild(rg);
  for (const [dr, dc] of S.data.rangeGrid || [[0, 0], [0, 1]]) {
    const c = OP_COL + dc, r = LANE + dr;
    S.rangeCells.add(`${c},${r}`);
    const x = c * TILE, y = rowY(r) - ROW_H / 2;
    if (dr === 0 && dc === 0) rg.beginFill(0x4ed8af, 0.16).drawRect(x + 3, y + 3, TILE - 6, ROW_H - 6).endFill();
    else rg.beginFill(0xf6a329, 0.13).drawRect(x + 3, y + 3, TILE - 6, ROW_H - 6).endFill();
    rg.lineStyle(2, dr === 0 && dc === 0 ? 0x4ed8af : 0xf6a329, 0.75).drawRect(x + 4, y + 4, TILE - 8, ROW_H - 8).lineStyle(0);
  }
}

// ---- per-frame overlays: HP / SP bars, reboot timer, bones -----------------------------------------------------
function drawBars() {
  const g = S.L.bars, op = S.op;
  g.clear();
  if (op.root.alpha > 0.05 && op.state !== 'off') {
    const w = 64, x = op.x - w / 2, y = op.y + 12;
    g.beginFill(0x000000, 0.75).drawRect(x - 1, y - 1, w + 2, 7).endFill();
    g.beginFill(0x2fa8ff).drawRect(x, y, w * clamp(op.hp / op.maxHp, 0, 1), 5).endFill();
    const sw = (w - 4) / 3;
    for (let i = 0; i < 3; i++) {
      const cost = SK(i).spCost || 1, u = clamp(S.sp[i] / cost, 0, 1), ready = u >= 1;
      const active = (i === 1 && S.s2) || (i === 2 && S.s3);
      const sx = x + i * (sw + 2);
      g.beginFill(0x000000, 0.75).drawRect(sx - 1, y + 7, sw + 2, 5).endFill();
      g.beginFill(active ? 0xffb547 : ready ? 0x59f4ca : 0xb4e05a, active || ready ? 1 : 0.85).drawRect(sx, y + 8, sw * (active ? 1 : u), 3).endFill();
    }
  }
  for (const e of S.enemies) {
    if (!e.alive() || e.hp >= e.maxHp) continue;
    const w = e.T.elite ? 70 : 50, x = e.x - w / 2, y = e.y + 10;
    g.beginFill(0x000000, 0.75).drawRect(x - 1, y - 1, w + 2, 6).endFill();
    g.beginFill(0xff5a2e).drawRect(x, y, w * clamp(e.hp / e.maxHp, 0, 1), 4).endFill();
  }
  const rt = S.L.rebootText;
  const reboot = S.auto && S.s3 && S.s3.phase === 'reboot';
  rt.visible = !!reboot;
  if (reboot) {
    rt.text = `重组中 ${Math.max(0, S.s3.rebootT).toFixed(1)}s`;
    rt.position.set(op.x, op.y - 128);
    rt.scale.set(0.5 * S.numK);
  }
}
const BONE_TAGS = ['pod', 'pod_muzzle', 'sword_tip'];
function drawBones() {
  const g = S.L.bones, op = S.op;
  g.clear();
  const tags = S.L.boneTags;
  for (const t of Object.values(tags)) t.visible = false;
  if (!S.showBones || !op.sp) return;
  const z = S.cam.z, lw = 1.6 / z, sk = op.sp.skeleton, kx = op.sp.scale.x, ky = op.sp.scale.y;
  const P = (b) => ({ x: op.x + b.worldX * kx, y: op.y + b.worldY * ky });
  for (const b of sk.bones) {
    const p = P(b);
    if (b.parent) { const pp = P(b.parent); g.lineStyle(lw, 0x4ed8af, 0.55).moveTo(pp.x, pp.y).lineTo(p.x, p.y); }
    const len = b.data.length || 0;
    if (len > 0) g.lineStyle(lw * 1.6, 0xffb547, 0.9).moveTo(p.x, p.y).lineTo(p.x + b.a * len * kx, p.y + b.c * len * ky);
  }
  g.lineStyle(0);
  for (const b of sk.bones) {
    const p = P(b), special = BONE_TAGS.includes(b.data.name);
    g.beginFill(special ? 0xff5ad7 : 0xffffff, 0.95).drawCircle(p.x, p.y, (special ? 4 : 2.6) / z).endFill();
    if (special) {
      const t = tags[b.data.name];
      t.visible = true; t.position.set(p.x + 6 / z, p.y - 4 / z); t.scale.set(0.5 / z);
    }
  }
}

// ---- camera: pan / zoom / pinch / reset ------------------------------------------------------------------------
function applyCam() {
  const c = S.cam, sx = S.shake > 0.3 ? rand(-S.shake, S.shake) : 0, sy = S.shake > 0.3 ? rand(-S.shake, S.shake) * 0.7 : 0;
  S.L.cam.position.set(c.x + sx, c.y + sy);
  S.L.cam.scale.set(c.z);
  S.numK = Math.pow(c.z, -0.6);
}
function zoomAt(sx, sy, z) {
  const c = S.cam;
  z = clamp(z, ZOOM_MIN, ZOOM_MAX);
  const wx = (sx - c.x) / c.z, wy = (sy - c.y) / c.z;
  c.z = z; c.x = sx - wx * z; c.y = sy - wy * z;
  S.userMoved = true;
}
function panelOpen() { return !document.body.classList.contains('panel-closed') && innerWidth > 760; }
function resetView() {
  const W = innerWidth, H = innerHeight, side = panelOpen() ? 344 + 24 : 0;
  const availW = Math.max(200, W - side - 40), availH = Math.max(200, H - 190);
  const worldW = FIELD_END + TILE * 0.6, worldH = ROW_H * 5 + 170;
  let z = clamp(Math.min(availW / worldW, availH / worldH), 0.45, 1.5);
  // centre the whole lane when it fits, else (phones) ~6 tiles: 2B and the tiles in front of her
  const fits = worldW * z <= availW + 1;
  if (!fits) z = clamp(Math.max(z, availW / (6.4 * TILE)), 0.45, 1.5);
  const wx = fits ? FIELD_END / 2 : tileX(OP_COL) + TILE * 2.2, wy = -40;
  S.cam.z = z;
  S.cam.x = (W - side) / 2 - wx * z;
  S.cam.y = 70 + (H - 190) / 2 + 10 - wy * z;
  S.userMoved = false;
}
function bindCamera(canvas) {
  const pts = new Map();
  let pinch = null, lastTap = { t: 0, x: 0, y: 0 }, moved = 0;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const startPinch = () => {
    const [a, b] = [...pts.values()];
    pinch = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z: S.cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, pos(e));
    if (pts.size === 1) moved = 0;
    if (pts.size === 2) startPinch();
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pos(e), prev = pts.get(e.pointerId);
    pts.set(e.pointerId, p);
    if (pts.size === 1) {
      S.cam.x += p.x - prev.x; S.cam.y += p.y - prev.y;
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      if (moved > 4) S.userMoved = true;
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      S.cam.x += mx - pinch.mx; S.cam.y += my - pinch.my;
      zoomAt(mx, my, (pinch.z * d) / pinch.d);
      pinch.mx = mx; pinch.my = my;
      moved = 99;
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 2) startPinch();
    if (!pts.size) canvas.classList.remove('is-dragging');
    if (e.type === 'pointerup' && e.pointerType !== 'mouse' && moved < 10 && !pts.size) {   // double-tap resets
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) { resetView(); lastTap.t = 0; }
      else lastTap = { t: now, x: p.x, y: p.y };
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pos(e), dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    zoomAt(p.x, p.y, S.cam.z * Math.exp(-dy * 0.0016));
  }, { passive: false });
  canvas.addEventListener('dblclick', () => resetView());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---- DOM: operator card, skill bar, controls, animation list --------------------------------------------------
const POSITION = { MELEE: '近战位', RANGED: '远程位' };
const DMG = { phys: '物理伤害', arts: '法术伤害', heal: '治疗' };
const SP_TYPE = { INCREASE_WHEN_ATTACK: '攻击回复', INCREASE_WITH_TIME: '自动回复', INCREASE_WHEN_TAKEN_DAMAGE: '受击回复' };
const SK_TYPE = { AUTO: '自动触发', MANUAL: '手动触发', PASSIVE: '被动' };
function renderCard() {
  const d = S.data, st = d.stats || {};
  const grid = d.rangeGrid || [[0, 0]];
  const rs = grid.map((p) => p[0]), cs = grid.map((p) => p[1]);
  const r0 = Math.min(...rs), r1 = Math.max(...rs), c0 = Math.min(...cs), c1 = Math.max(...cs);
  let cells = '';
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const on = grid.some((p) => p[0] === r && p[1] === c);
    cells += `<i class="${r === 0 && c === 0 ? 'self' : on ? 'on' : ''}"></i>`;
  }
  const stat = (k, v) => `<div class="stat"><span>${k}</span><b>${esc(v)}</b></div>`;
  const skill = (s, i) => `<div class="skill"><div class="s-ico" data-skill-ico="${i}"><span class="n">${i + 1}</span></div><div>
      <h4 style="margin:0;font:700 13px/1.35 var(--cjk);color:var(--text-hi)">${esc(s.name)}</h4>
      <div class="s-meta"><span class="tag">${esc(SP_TYPE[s.spType] || s.spType)}</span><span class="tag ${s.skillType === 'MANUAL' ? 'mint' : ''}">${esc(SK_TYPE[s.skillType] || s.skillType)}</span>
      <span class="tag">SP ${s.initSp || 0}/${s.spCost}</span>${s.duration ? `<span class="tag">持续 ${s.duration}s</span>` : ''}</div>
      <p style="margin:0;font-size:12px">${esc(s.desc)}</p></div></div>`;
  $('opCard').innerHTML = `
    <div class="op-top"><div class="op-ava" id="opAva"><span class="glyph">2B</span></div><div>
      <div class="op-name">${esc(d.name)}</div><div class="op-app">${esc(d.appellation)}</div>
      <div class="stars">${'★'.repeat(d.rarity || 0)}</div>
      <div class="tags"><span class="tag mint">${esc(d.professionName)} · ${esc(d.subProfessionName)}</span><span class="tag">${esc(POSITION[d.position] || d.position)}</span><span class="tag">${esc(DMG[d.dmgType] || d.dmgType)}</span></div>
    </div></div>
    <div class="stats">${stat('生命上限', st.maxHp)}${stat('攻击', st.atk)}${stat('防御', st.def)}${stat('法术抗性', st.res)}${stat('部署费用', st.cost)}${stat('阻挡数', st.blockCnt)}${stat('攻击间隔', `${st.bat}s`)}${stat('再部署', `${st.respawnTime}s`)}</div>
    <div class="range-row"><span class="micro">Range</span><div class="rgrid" style="grid-template-columns:repeat(${c1 - c0 + 1},12px)">${cells}</div><span style="font-size:12px;color:var(--text-lo)">攻击范围 ${esc(d.rangeId || '')}</span></div>
    <div class="blk"><h4>特性</h4><p>${esc(d.trait?.desc)}</p></div>
    ${(d.talents || []).map((t) => `<div class="blk"><h4>天赋 · ${esc(t.name)}</h4><p>${esc(t.desc)}</p></div>`).join('')}
    <div class="blk"><h4>技能</h4>${(d.skills || []).map(skill).join('')}</div>
    <div class="hint">${esc(d._note || '')}</div>`;
}
/** Art from the icons folder, when the art side has produced it (the avatar decides: no avatar ⇒ no requests for the rest). */
function loadIcons() {
  const a = S.data.assets || {};
  if (!a.avatar) return;
  const img = new Image();
  img.onload = () => {
    $('opAva').replaceChildren(img);
    (a.skillIcons || []).forEach((p, i) => {
      const s = new Image();
      s.onload = () => document.querySelectorAll(`[data-skill-ico="${i}"]`).forEach((el) => { const c = s.cloneNode(); el.querySelector('img')?.remove(); el.prepend(c); el.querySelector('.n')?.remove(); });
      s.src = here(p);
    });
  };
  img.src = here(a.avatar);
}
function buildSkillBar() {
  const box = $('skills');
  box.innerHTML = S.skills.map((s, i) => `
    <div class="sk ${s.skillType === 'MANUAL' ? 'manual' : ''}" data-i="${i}" role="button" tabindex="0" title="${esc(s.desc)}">
      <div class="s-ico" data-skill-ico="${i}"><div class="sp-fill"></div><span class="n">${i + 1}</span></div>
      <div style="min-width:0;flex:1"><div class="s-name">${esc(s.name)}</div><div class="s-info">${esc(SP_TYPE[s.spType] || '')} · ${esc(SK_TYPE[s.skillType] || '')}</div>
      <div class="s-sp">—</div><div class="s-bar"><i></i></div></div></div>`).join('');
  box.querySelectorAll('.sk').forEach((el) => {
    const go = () => castSkill(Number(el.dataset.i));
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
function updateSkillBar() {
  document.querySelectorAll('#skills .sk').forEach((el) => {
    const i = Number(el.dataset.i), s = SK(i), cost = s.spCost || 1;
    const active = (i === 1 && !!S.s2) || (i === 2 && !!S.s3);
    const ready = S.auto && !active && S.sp[i] >= cost;
    let u = clamp(S.sp[i] / cost, 0, 1), txt = `SP ${Math.floor(S.sp[i])} / ${cost}`;
    if (i === 1 && S.s2) { u = 1 - S.s2.t / S.s2.dur; txt = `持续 ${Math.max(0, S.s2.dur - S.s2.t).toFixed(1)}s`; }
    if (i === 2 && S.s3) { u = S.s3.phase === 'reboot' ? S.s3.rebootT / (SK(2).reboot || 6) : 1; txt = S.s3.phase === 'reboot' ? `重组 ${Math.max(0, S.s3.rebootT).toFixed(1)}s` : '蓄力 / 爆发'; }
    if (!S.auto) txt = '自动战斗已停止';
    el.classList.toggle('ready', ready && s.skillType === 'MANUAL');
    el.classList.toggle('active', active);
    el.querySelector('.s-bar i').style.width = `${(u * 100).toFixed(1)}%`;
    el.querySelector('.sp-fill').style.height = `${(active ? 0 : u * 100).toFixed(1)}%`;
    const sp = el.querySelector('.s-sp');
    if (sp.textContent !== txt) sp.textContent = txt;
  });
}
function syncSwitch(id, on) { const el = $(id); el.classList.toggle('on', !!on); el.setAttribute('aria-checked', on ? 'true' : 'false'); }
function bindSwitch(id, fn) {
  const el = $(id);
  const go = () => fn(!el.classList.contains('on'));
  el.addEventListener('click', go);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
}
function setPaused(p) { S.paused = !!p; $('btnPause').textContent = S.paused ? '继续' : '暂停'; $('btnPause').classList.toggle('on', S.paused); }
function setSpeed(x) { S.speed = clamp(Number(x) || 1, 0.25, 2); $('speed').value = String(S.speed); $('speedVal').textContent = `${S.speed.toFixed(2)}×`; }
function buildAnimList() {
  const op = S.op, contract = S.data.animContract || {};
  const all = [...op.names];
  const body = [...(contract.body || []), ...all.filter((n) => !/^Pod_/.test(n) && !(contract.body || []).includes(n))];
  const pod = [...(contract.pod || []), ...all.filter((n) => /^Pod_/.test(n) && !(contract.pod || []).includes(n))];
  const btn = (n) => `<button class="btn ${op.names.has(n) ? '' : 'missing'}" type="button" data-anim="${esc(n)}" title="${op.names.has(n) ? `${n} · ${animDur(op.data, n).toFixed(2)}s` : `${n}：模型里还没有这个动作`}">${esc(n)}</button>`;
  $('animsBody').innerHTML = body.map(btn).join('');
  $('animsPod').innerHTML = pod.map(btn).join('') || '<span class="hint">—</span>';
  document.querySelectorAll('[data-anim]').forEach((el) => el.addEventListener('click', () => play(el.dataset.anim)));
  // contract check line (what the art side still owes)
  const have = (list) => list.filter((n) => op.names.has(n)).length;
  const bones = Object.keys(contract.bones || {}), evs = Object.keys(contract.events || {});
  const evHave = new Set((op.data.events || []).map((e) => e.name));
  const miss = [...(contract.body || []), ...(contract.pod || [])].filter((n) => !op.names.has(n))
    .concat(bones.filter((b) => !op.sp.skeleton.findBone(b)).map((b) => `骨骼 ${b}`), evs.filter((e) => !evHave.has(e)).map((e) => `事件 ${e}`));
  S.contract = { body: `${have(contract.body || [])}/${(contract.body || []).length}`, pod: `${have(contract.pod || [])}/${(contract.pod || []).length}`,
    bones: `${bones.filter((b) => op.sp.skeleton.findBone(b)).length}/${bones.length}`, events: `${evs.filter((e) => evHave.has(e)).length}/${evs.length}`, missing: miss };
  $('contract').innerHTML = `契约检查 · 身体 ${S.contract.body} · Pod ${S.contract.pod} · 骨骼 ${S.contract.bones} · 事件 ${S.contract.events}`
    + (miss.length ? `<br><span style="color:var(--orange)">缺：${esc(miss.join('、'))}（用回退方案代替）</span>` : '<br><span style="color:var(--mint)">全部齐备</span>');
}
function updateNow() {
  const op = S.op;
  if (!op || !op.sp) return;
  const line = (i) => {
    const e = op.track(i);
    if (!e) return `轨${i}  —`;
    const d = e.animationEnd || 0, t = d ? (e.loop ? e.trackTime % d : Math.min(e.trackTime, d)) : 0;
    return `轨${i}  ${e.animation.name.padEnd(15)} ${t.toFixed(2)} / ${d.toFixed(2)}s`;
  };
  const e0 = op.track(0), d0 = e0 ? e0.animationEnd || 0 : 0, u0 = d0 ? ((e0.loop ? e0.trackTime % d0 : Math.min(e0.trackTime, d0)) / d0) : 0;
  $('nowInfo').innerHTML = `${esc(line(0))}\n${esc(line(1))}\n事件  ${esc(S.evLog.slice(-5).join('  ') || '—')}<div class="bar"><i style="width:${(u0 * 100).toFixed(1)}%"></i></div>`;
  const n0 = e0 && e0.animation.name, n1 = op.track(1)?.animation.name;
  document.querySelectorAll('[data-anim]').forEach((el) => el.classList.toggle('on', el.dataset.anim === n0 || el.dataset.anim === n1));
  $('stAnim').textContent = n0 || '—';
  $('stWave').textContent = String(S.wave); $('stKills').textContent = String(S.kills); $('stLeak').textContent = String(S.leaked);
}
function bindUi() {
  bindSwitch('swAuto', (on) => setAuto(on));
  bindSwitch('swCast', (on) => { S.autoCast = on; syncSwitch('swCast', on); });
  bindSwitch('swBones', (on) => { S.showBones = on; syncSwitch('swBones', on); });
  bindSwitch('swRange', (on) => { S.showRange = on; S.L.range.visible = on; syncSwitch('swRange', on); });
  bindSwitch('swNums', (on) => { S.showNums = on; syncSwitch('swNums', on); });
  syncSwitch('swAuto', S.auto); syncSwitch('swBones', S.showBones);
  $('btnPause').addEventListener('click', () => setPaused(!S.paused));
  $('btnStep').addEventListener('click', () => { setPaused(true); S.stepQ++; });
  $('btnReset').addEventListener('click', () => resetBattle());
  $('speed').addEventListener('input', () => setSpeed($('speed').value));
  setSpeed(S.speed);
  $('resetView').addEventListener('click', () => resetView());
  const setPanel = (open) => { document.body.classList.toggle('panel-closed', !open); if (!S.userMoved) resetView(); };
  $('panelToggle').addEventListener('click', () => setPanel(document.body.classList.contains('panel-closed')));
  $('panelClose').addEventListener('click', () => setPanel(false));
  if (innerWidth <= 760 || q.get('panel') === '0') document.body.classList.add('panel-closed');
  $('btnFront').addEventListener('click', () => switchModel('front'));
  $('btnBack').addEventListener('click', () => switchModel('back'));
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); setPaused(!S.paused); }
    else if (e.key === '.') { setPaused(true); S.stepQ++; }
    else if (e.key === '0' || e.key === 'Home') resetView();
  });
}
function switchModel(side) {
  if (!S.models[side] || S.op.side === side) return;
  const op = S.op, n0 = op.track(0)?.animation.name, n1 = op.track(1)?.animation.name;
  op.setModel(side);
  $('btnFront').classList.toggle('on', side === 'front'); $('btnBack').classList.toggle('on', side === 'back');
  buildAnimList();
  if (!S.auto) { if (n0 && op.names.has(n0)) op.play0(n0, true); else op.rest(); if (n1 && op.names.has(n1)) op.play1(n1, true); else op.podRest(); return; }
  // battle: clip entries in flight belonged to the other skeleton — restart the current phase on this one
  const A = op.A, s3 = S.s3;
  S.podShot = null;
  if (op.state === 'dead') op.play0(A.die || A.hit || A.idle, false);
  else if (op.state === 'deploy') op.deployEntry = A.start ? op.play0(A.start, false) : (op.play0(A.idle, true), null);
  else if (op.state === 's3' && s3) {
    if (s3.phase === 'charge') op.play0(A.s3begin || A.idle, !A.s3begin);
    else if (s3.phase === 'blast') {
      s3.endEntry = op.play0(A.s3end, false); s3.endDur = animDur(op.data, A.s3end) || 0.5;
      if (!s3.blasted) s3.synth = eventTimes(op.data, A.s3end, 'OnBlast').length ? null : 0.08;
    } else if (A.reboot) op.play0(A.reboot, true);
    else if (A.hit) op.play0(A.hit, false);
  } else op.rest();
  if (S.laser && S.laser.phase !== 'end') {
    S.laser.evTicks = !!A.podLaserLoop && eventTimes(op.data, A.podLaserLoop, 'OnLaser').length > 0;
    if (S.laser.phase === 'begin') S.laser.phase = 'loop';
    if (A.podLaserLoop) op.play1(A.podLaserLoop, true); else op.podRest();
  } else op.podRest();
}

// ---- boot / frame ---------------------------------------------------------------------------------------------
async function loadSpine(url) {
  const res = await PIXI.Assets.load(url);
  const data = res && (res.spineData || res);
  if (!data || !Array.isArray(data.animations)) throw new Error(`不是 Spine 骨骼数据：${url}`);
  return data;
}
function frame() {
  const real = Math.min(0.05, S.app.ticker.deltaMS / 1000);
  let dt = S.paused ? 0 : real * S.speed;
  if (S.paused && S.stepQ > 0) { dt = 1 / 30; S.stepQ--; }
  S.time += dt;
  const op = S.op;
  if (S.auto) { updateWaves(dt); opBattle(dt); }
  else op.sp.update(dt);
  op.sp.tint = op.flash > 0 ? 0xff8080 : S.auto && S.s3 && S.s3.phase === 'reboot' && !op.A.reboot ? 0x9a9aa8 : 0xffffff;
  if (!op.hasPod) op.podFallback.y = -150 + Math.sin(S.time * 2.2) * 4;
  for (let i = S.enemies.length - 1; i >= 0; i--) {
    const e = S.enemies[i];
    e.update(dt);
    if (e.gone) { e.destroy(); S.enemies.splice(i, 1); }
  }
  for (let i = S.fx.length - 1; i >= 0; i--) if (!S.fx[i].update(dt)) S.fx.splice(i, 1);
  updateTrail(dt);
  updateBeam(dt);
  S.shake = S.shake > 0.3 ? S.shake * Math.exp(-dt * 7) : 0;
  S.flash = Math.max(0, S.flash - dt * 2.4);
  const fl = S.L.flash;
  fl.visible = S.flash > 0.01; fl.alpha = Math.min(1, S.flash); fl.width = S.app.screen.width; fl.height = S.app.screen.height;
  applyCam();
  updatePops(dt);
  drawBars();
  drawBones();
  if (S.pauseNow) { S.pauseNow = false; setPaused(true); }   // __diy.pauseOn(event): freeze the frame that event fired in
  S.uiT = (S.uiT || 0) - real;
  if (S.uiT <= 0) { S.uiT = 0.1; updateSkillBar(); updateNow(); $('zoomVal').textContent = `${Math.round(S.cam.z * 100)}%`; }
}
async function main() {
  const loading = $('loading');
  try {
    if (!PIXI || !PIXI.spine) throw new Error('PixiJS / pixi-spine 未加载');
    S.data = await fetch(here('data.json'), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`data.json ${r.status}`); return r.json(); });
    S.stats = S.data.stats;
    // skill numbers from the draft descriptions (data.json has no multipliers of its own)
    S.skills = (S.data.skills || []).map((s, i) => ({ ...s, ...[{ mult: 1.6 }, { mult: 0.7 }, { mult: 6, stun: 3, reboot: 6 }][i] }));
    await Promise.race([document.fonts?.load('30px Bender').catch(() => null), new Promise((r) => setTimeout(r, 1500))]);
    const app = new PIXI.Application({ resizeTo: window, backgroundColor: 0x0a0e0d, antialias: true, autoDensity: true, resolution: Math.min(2, devicePixelRatio || 1) });
    S.app = app;
    $('field').appendChild(app.view);
    const L = S.L;
    L.cam = new PIXI.Container();
    for (const k of ['ground', 'ground2', 'shadows', 'units', 'fx', 'bones', 'bars', 'over']) { L[k] = new PIXI.Container(); L.cam.addChild(L[k]); }
    L.units.sortableChildren = true;
    L.bones = L.bones.addChild(new PIXI.Graphics());
    L.bars = L.bars.addChild(new PIXI.Graphics());
    L.flash = new PIXI.Sprite(PIXI.Texture.WHITE);
    L.flash.visible = false;
    app.stage.addChild(L.cam, L.flash);
    buildTextures();
    drawField();
    L.boneTags = {};
    for (const n of BONE_TAGS) {
      const t = new PIXI.Text(n, { fontFamily: FONT_NUM, fontSize: 22, fill: '#ff9be8', stroke: '#000', strokeThickness: 4 });
      t.resolution = 2; t.visible = false; L.over.addChild(t); L.boneTags[n] = t;
    }
    L.rebootText = new PIXI.Text('', { fontFamily: FONT_CJK, fontSize: 26, fontWeight: '700', fill: ['#ffffff', '#ffd27a'], stroke: '#1a1000', strokeThickness: 5 });
    L.rebootText.anchor.set(0.5, 1); L.rebootText.resolution = 2; L.rebootText.visible = false;
    L.over.addChild(L.rebootText);

    // models: 2B front (required), back (optional), the three enemies (each optional)
    const a = S.data.assets || {};
    S.models.front = await loadSpine(here(a.front || 'model/front/char_diy_2b.json'));
    const enemyLoads = Object.entries(ENEMIES).map(([k, T]) => loadSpine(here(`../../assets/spine/enemy/${T.id}/${T.id}.skel`))
      .then((d) => { S.enemyData[k] = d; }, (err) => console.warn(`[diy-2b] 敌人模型 ${T.id} 加载失败`, err)));
    await Promise.all(enemyLoads);

    S.op = new Operator();
    S.op.setModel('front');
    S.beam = makeBeam();
    renderCard();
    buildSkillBar();
    bindUi();
    buildAnimList();
    bindCamera(app.view);
    resetView();
    addEventListener('resize', () => { if (!S.userMoved) resetView(); });
    if (S.auto) resetBattle();
    else { S.auto = true; setAuto(false); }
    app.ticker.add(frame);
    loading.classList.add('gone');
    diy.ready = true;
    loadIcons();
    // back model: optional; the toggle shows only when the file exists
    if (a.back) {
      fetch(here(a.back), { cache: 'no-cache' }).then(async (r) => {
        if (!r.ok) return;
        S.models.back = await loadSpine(here(a.back));
        $('modelRow').hidden = false;
      }).catch(() => {});
    }
  } catch (err) {
    console.error(err);
    loading.classList.add('err');
    loading.textContent = `加载失败：${err && err.message ? err.message : err}`;
    diy.errors.push(String(err && err.message ? err.message : err));
  }
}

Object.assign(diy, {
  setAuto: (b) => setAuto(b),
  play: (name) => play(name),
  cast: (i) => castSkill(i),
  fillSp: () => { S.sp = S.skills.map((s) => s.spCost || 0); },
  pause: (b = true) => setPaused(b),
  step: (n = 1) => { setPaused(true); S.stepQ += n; },
  setSpeed: (x) => setSpeed(x),
  setAutoCast: (b) => { S.autoCast = !!b; syncSwitch('swCast', !!b); },
  showBones: (b) => { S.showBones = !!b; syncSwitch('swBones', !!b); },
  view: () => ({ ...S.cam }),
  setView: (v) => { Object.assign(S.cam, { x: v.x ?? S.cam.x, y: v.y ?? S.cam.y, z: clamp(v.zoom ?? v.z ?? S.cam.z, ZOOM_MIN, ZOOM_MAX) }); S.userMoved = true; },
  zoomAt: (sx, sy, z) => zoomAt(sx, sy, z),
  resetView: () => resetView(),
  switchModel: (side) => switchModel(side),
  pauseOn: (name) => { S.pauseOn = name; setPaused(false); },
  stats: () => {
    const op = S.op;
    return {
      ready: diy.ready, time: +S.time.toFixed(3), auto: S.auto, paused: S.paused, speed: S.speed, wave: S.wave, kills: S.kills, leaked: S.leaked,
      fps: S.app ? Math.round(S.app.ticker.FPS) : 0, zoom: +S.cam.z.toFixed(3),
      op: op && op.sp ? { state: op.state, hp: Math.round(op.hp), maxHp: op.maxHp, side: op.side, track0: op.track(0)?.animation.name || null, track1: op.track(1)?.animation.name || null,
        blocked: op.blocked.length, hasPod: op.hasPod, sp: S.sp.map((v) => +v.toFixed(1)) } : null,
      skill: { s2: S.s2 ? +S.s2.t.toFixed(2) : null, laser: S.laser ? S.laser.phase : null, s3: S.s3 ? S.s3.phase : null, beamW: S.beam ? +S.beam.w.toFixed(2) : 0 },
      enemies: S.enemies.map((e) => ({ kind: e.kind, state: e.state, x: Math.round(e.x), hp: Math.round(e.hp), stun: +e.stun.toFixed(1) })),
      enemyModels: Object.keys(S.enemyData), models: { front: !!S.models.front, back: !!S.models.back },
      anims: op && op.data ? op.data.animations.map((a) => a.name) : [], contract: S.contract || null,
      counts: { ...S.counts, events: { ...S.counts.events } }, pops: S.pops.length, fx: S.fx.length, errors: diy.errors.slice(),
    };
  },
});

main();
