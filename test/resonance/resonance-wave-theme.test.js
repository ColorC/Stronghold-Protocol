// 共鸣「音浪」主题：色值层与样式表的范围、直线边框、动效时长、程序合成的共鸣音色与局内变化的识别。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWaveRemap, remapValue, isMintGreen, WAVE_REMAP_PATH } from '../../tools/resonance/build-resonance-wave-theme.mjs';
import { AudioManager } from '../../public/js/audio.js';
import { RESONANCE_VOICES, resonanceVoicing, playResonanceVoice } from '../../public/js/resonance/resonanceWaveSound.js';
import { resonanceChanges, wavefrontCue, cueSounds, pactTiers, pactMembers } from '../../public/js/resonance/resonanceWave.js';
import { PHASE } from '../../shared/constants.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const css = read('public/css/resonance-wave.css');

test('the colour layer is generated from the stylesheets resonance.html loads and is up to date', () => {
  assert.equal(read(WAVE_REMAP_PATH), buildWaveRemap(), 'run node tools/resonance/build-resonance-wave-theme.mjs after changing a resonance stylesheet');
});

test('every theme rule is scoped to the resonance root; the original game and the workshop never load the theme', () => {
  const remap = read(WAVE_REMAP_PATH).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...remap.matchAll(/(?:^|\})\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter((s) => !/^(from|to|\d)/.test(s));
  assert.ok(selectors.length > 300);
  for (const list of selectors) for (const sel of list.split(/,(?![^(]*\))/)) {
    assert.match(sel.trim(), /^(:where\(html\.rs-resonance-wave\)|html:where\(\.rs-resonance-wave\)|:root:where\(\.rs-resonance-wave\))/, sel);
  }
  const own = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const m of own.matchAll(/(?:^|\}|\{)\s*([^{}@]+)\{/g)) {
    for (const sel of m[1].split(/,(?![^(]*\))/)) assert.match(sel.trim(), /^(html\.rs-resonance-wave|\.rw-)/, sel.trim());
  }
  const html = read('public/resonance.html');
  assert.match(html, /<html[^>]*class="[^"]*\brs-resonance-wave\b/);
  const links = [...html.matchAll(/href="\.\/css\/([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links.slice(-3), ['resonance.css', 'resonance-wave-remap.css', 'resonance-wave.css'], 'the theme layers load last');
  for (const page of ['public/index.html', 'public/independent.html']) assert.doesNotMatch(read(page), /resonance-wave|rs-resonance-wave/, page);
  for (const file of ['public/resonance.html', 'public/js/resonance/main.js', 'public/js/resonance/native-match-screen.js', 'public/js/audio.js'])
    assert.doesNotMatch(read(file), /\btide\b|潮汐|rs-tide/, `${file}: the 潮汐 names are gone`);
});

test('borders and dividers stay straight: no wave on the HUD edges, waves and fringes only as textures inside', () => {
  const own = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const edge of ['.gtop__center::before', '.gtop__center::after', '.shopbar__row::before', '.shopbar__row::after'])
    assert.ok(!own.includes(edge), `${edge} is the original's straight line (or nothing)`);
  assert.doesNotMatch(own, /border-image/);
  // the fringes sit under the panels' content, never over their frame
  assert.match(own, /\.spov__inner\)::before \{[^}]*inset: 0; z-index: -1; pointer-events: none;/);
  assert.match(own, /isolation: isolate/);
});

test('mint and green-black become sea blue; semantic greens (2-cost, heal, HP) stay', () => {
  assert.equal(remapValue('rgba(78, 216, 175, .35)'), 'color-mix(in srgb, var(--mint-500) 35%, transparent)');
  assert.equal(remapValue('#17f9b7'), 'var(--mint-glow)');
  assert.equal(remapValue('#d7e5dc'), 'var(--rw-ink)');
  assert.equal(remapValue('#101814'), 'var(--rw-deep)');
  for (const keep of ['#7fd37a', '#28b66a', '#3fdc6a', '#6dfa9c', '#56e08a', '#2bb65a', '#0b1a0a', '#ffc600', '#e73118', '#9fd4ff', '#86cfee'])
    assert.equal(remapValue(`linear-gradient(${keep}, ${keep})`), null, keep);
  assert.equal(isMintGreen([127, 211, 122]), false);
});

test('one-off effects stay within 150–600 ms and stop for reduced motion; the effect layer takes no pointer', () => {
  const rules = [...css.matchAll(/(\.rw-[^{]*|html\.rs-resonance-wave[^{]*(?:spov__grid|dpanel|level-card)[^{]*)\{([^}]*)\}/g)];
  const durations = rules.flatMap(([, , body]) => [...body.matchAll(/animation(?:-duration)?:[^;]*?(\d+)ms/g)].map((m) => Number(m[1])));
  assert.ok(durations.length >= 12, `${durations.length} durations`);
  for (const ms of durations) assert.ok(ms >= 150 && ms <= 600, `${ms} ms`);
  // an effect's delay plus its duration ends by 600 ms
  for (const [, sel, body] of rules) for (const m of body.matchAll(/animation:[^;]*?(\d+)ms\s+(\d+)ms/g)) assert.ok(Number(m[1]) + Number(m[2]) <= 600, `${sel.trim()}: ${m[0]}`);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.rw-wavefront, \.rw-voice, \.rw-octave/);
  assert.match(reduced, /animation: none/);
  assert.match(css, /html\.rs-resonance-wave\.sp-reduced-motion \.rw-wavefront \{ display: none; \}/);
  assert.match(css, /\.rw-fx \{[^}]*pointer-events: none/);
});

// ---- sound -----------------------------------------------------------------------------------------------------

function fakeContext() {
  const made = { osc: 0, noise: 0, starts: [], buffers: [], connections: [] };
  class Param { constructor(v = 1) { this.value = v; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } exponentialRampToValueAtTime(v) { assert.ok(v > 0, 'exponential ramps never reach 0'); this.value = v; } setTargetAtTime() {} }
  class Node { connect(to) { made.connections.push([this, to]); return to; } disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.frequency = new Param(440); this.detune = new Param(0); this.playbackRate = new Param(); this.type = 'sine'; } start(at) { made.starts.push(at); } stop() {} }
  class Filter extends Node { constructor() { super(); this.frequency = new Param(350); this.Q = new Param(1); } }
  const ctx = {
    currentTime: 3, sampleRate: 8000, state: 'running', destination: new Node(),
    createGain: () => new Gain(), createBiquadFilter: () => new Filter(),
    createOscillator: () => { made.osc++; return new Src(); },
    createBufferSource: () => { made.noise++; return new Src(); },
    createBuffer: (channels, length, sampleRate) => { const data = new Float32Array(length); made.buffers.push(data); return { sampleRate, length, getChannelData: () => data }; },
  };
  return { ctx, made };
}

test('the resonance voices are synthesized into the sfx channel, start at their envelopes and never on a step', () => {
  const { ctx, made } = fakeContext();
  const destination = { connect() {} };
  for (const name of ['click', 'buy', 'drop', 'pick', 'refresh', 'levelup', 'levelBurst', 'combine', 'starUp', 'claim', 'roundStart', 'battleStart', 'sell', 'retreat', 'back'])
    assert.equal(resonanceVoicing(name, { volume: .5 }, { ctx, destination }), true, name);
  assert.ok(made.osc > 0 && made.noise > 0);
  assert.ok(made.connections.some(([, to]) => to === destination), 'every voice ends on the given sfx destination');
  assert.ok(!made.connections.some(([, to]) => to === ctx.destination), 'never straight to the speakers (volume and mute apply)');
  assert.ok(made.starts.every((at) => at > ctx.currentTime), 'every source starts at its envelope (a gain holds 1 until its first event)');
  // the plucked string (Karplus–Strong) starts and ends at silence: no click at either end
  const plucks = made.buffers.filter((d) => d.length < 8000 * 2);
  assert.ok(plucks.length >= 1);
  for (const d of plucks) { assert.ok(Math.abs(d[0]) < 1e-6 && Math.abs(d.at(-1)) < 1e-3); }
  for (const name of ['error', 'timer', 'settlementFail', 'yourTurn']) assert.equal(resonanceVoicing(name, {}, { ctx, destination }), false, `${name} keeps its sample`);
  assert.equal(RESONANCE_VOICES.buy, 'pluck');
  assert.equal(RESONANCE_VOICES.combine, 'unison');
  assert.equal(RESONANCE_VOICES.starUp, 'octave');
  assert.equal(RESONANCE_VOICES.battleStart, 'swell');
  assert.equal(RESONANCE_VOICES.rest, 'bell', '休整 opens a round when ROUND_START is not shown');
});

test('a pact tier sounds a chord that grows richer with the tier; the native count cue is silent', () => {
  const partials = (tier) => { const { ctx, made } = fakeContext(); playResonanceVoice('pact', ctx, { connect() {} }, 3.01, { tier }); return made.osc; };
  assert.ok(partials(1) < partials(2) && partials(2) < partials(3) && partials(3) < partials(5), 'more voices and overtones each tier');
  const { ctx, made } = fakeContext();
  assert.equal(resonanceVoicing('bondUp', {}, { ctx, destination: { connect() {} } }), true);
  assert.equal(made.osc + made.noise, 0, 'bondUp plays nothing: the tier cue carries the sound');
});

test('AudioManager asks the UI voicing only after the unlock and while the sfx channel is audible', () => {
  const urls = [];
  const a = new AudioManager({ win: null, getManifest: () => ({ audio: { sfx: { ui: { click: '/a/click.mp3', error: '/a/error.mp3' } } } }) });
  a._play = (url) => urls.push(url);
  const asked = [];
  a.setUiVoicing((name) => { asked.push(name); return name === 'click'; });
  a.sfx('click');
  assert.deepEqual(asked, [], 'locked: no context yet');
  const { ctx } = fakeContext();
  a.ctx = ctx; a.sfxGain = { connect() {} };
  a.sfx('click'); a.sfx('error');
  assert.deepEqual(asked, ['click', 'error']);
  assert.deepEqual(urls.slice(-1), ['/a/error.mp3'], 'a voiced name skips its sample; an unvoiced one plays it');
  a.setVolumes({ muted: true }); a.sfx('click');
  a.setVolumes({ muted: false, sfx: 0 }); a.sfx('click');
  ctx.state = 'suspended'; a.setVolumes({ sfx: .8 }); a.sfx('click');
  assert.equal(asked.length, 2, 'muted, silent or suspended: the voicing is not asked');
  a.setUiVoicing(null); ctx.state = 'running'; a.sfx('click');
  assert.equal(urls.at(-1), '/a/click.mp3');
});

// ---- what changed --------------------------------------------------------------------------------------------------

const catalog = {
  operators: { a: { pacts: ['blade'] }, b: { pacts: ['blade', 'sky'] }, c: { pacts: ['sky'] } },
  pacts: { blade: { levels: [{ minUnits: 2 }, { minUnits: 4 }] }, sky: { levels: [{ minUnits: 1 }] } },
  equipment: { crest: { kind: 'emblem', effects: [{ kind: 'pact_transfer', params: { pactId: 'sky' } }] } },
};
const piece = (uid, operatorId, star = 1, row = 9, extra = {}) => ({ uid, nativeUid: Number(uid.slice(1)) + 10, operatorId, star, row, col: 3, equipment: [], ...extra });
const base = {
  gold: 10, level: 3,
  pieces: [piece('p1', 'a'), piece('p2', 'a', 1, null)],
  inventory: [{ uid: 'i1', nativeUid: 71, itemId: 'blade' }, { uid: 'i2', nativeUid: 72, itemId: 'staff' }],
  shop: { offers: [{ uid: 'o1', operatorId: 'a' }, { uid: 'o2', operatorId: 'b' }, { uid: 'o3', operatorId: 'c' }, { uid: 'o4', operatorId: 'a' }, { uid: 'o5', operatorId: 'b' }] },
  pendingChoices: [{ uid: 'c1' }], pacts: { blade: { count: 1, activeThreshold: 0 }, sky: { count: 0, activeThreshold: 0 } },
};
const kinds = (cues) => cues.map((c) => c.kind);

test('star-ups, sales, combines, purchases, refreshes, levels, pact tiers and claims are told apart', () => {
  assert.deepEqual(resonanceChanges(base, base, catalog), []);
  assert.deepEqual(resonanceChanges(null, base, catalog), []);
  // a purchase merges the copies into a new 2-star piece: a star-up and a purchase at offer 0
  const bought = { ...base, gold: 9, pieces: [piece('p3', 'a', 2)], shop: { offers: [{ uid: 'o9', operatorId: null }, ...base.shop.offers.slice(1)] } };
  assert.deepEqual(resonanceChanges(base, bought, catalog), [{ kind: 'starUp', nativeUid: 13 }, { kind: 'buy', index: 0 }]);
  // a sale: the piece is gone and the gold rose
  assert.deepEqual(resonanceChanges(base, { ...base, gold: 11, pieces: [base.pieces[0]] }, catalog), [{ kind: 'sell', nativeUid: 12 }]);
  // two components become one completed item on the piece wearing it; the parts are named
  const combined = { ...base, inventory: [], pieces: [{ ...base.pieces[0], equipment: [{ uid: 'i9', nativeUid: 90, itemId: 'spellblade' }] }, base.pieces[1]] };
  assert.deepEqual(resonanceChanges(base, combined, catalog), [{ kind: 'combine', itemUid: 90, nativeUid: 11, parts: [71, 72] }]);
  // an equip moves an item: nothing
  assert.deepEqual(resonanceChanges(base, { ...base, inventory: [base.inventory[1]], pieces: [{ ...base.pieces[0], equipment: [base.inventory[0]] }, base.pieces[1]] }, catalog), []);
  // a refresh replaces the offers
  const refreshed = { ...base, gold: 8, shop: { offers: base.shop.offers.map((o, i) => ({ uid: `n${i}`, operatorId: o.operatorId })) } };
  assert.deepEqual(kinds(resonanceChanges(base, refreshed, catalog)), ['refresh']);
  assert.deepEqual(resonanceChanges(base, { ...base, level: 4 }, catalog), [{ kind: 'levelUp', level: 4 }]);
  // a claim, also when the strategy opens the next choice at once
  assert.deepEqual(kinds(resonanceChanges(base, { ...base, pendingChoices: [] }, catalog)), ['claim']);
  assert.deepEqual(kinds(resonanceChanges(base, { ...base, pendingChoices: [{ uid: 'c2' }] }, catalog)), ['claim']);
  // a pact reaching its first and next tier
  const two = { ...base, pacts: { blade: { count: 2, activeThreshold: 2 }, sky: { count: 0, activeThreshold: 0 } } };
  assert.deepEqual(resonanceChanges(base, two, catalog), [{ kind: 'pactUp', pactId: 'blade', tier: 1 }]);
  assert.deepEqual(resonanceChanges(two, { ...two, pacts: { ...two.pacts, blade: { count: 4, activeThreshold: 4 } } }, catalog), [{ kind: 'pactUp', pactId: 'blade', tier: 2 }]);
  assert.deepEqual(pactTiers(two, catalog), { blade: 1, sky: 0 });
});

test('a pact\'s members are its deployed operators, granted pacts and emblem wearers', () => {
  const state = { pieces: [piece('p1', 'a'), piece('p2', 'b', 1, null), piece('p3', 'c'), piece('p4', 'a', 1, 9, { equipment: [{ uid: 'i1', itemId: 'crest' }] }), piece('p5', 'a', 1, 9, { extraPacts: ['sky'] })] };
  assert.deepEqual(pactMembers(state, catalog, 'blade').map((p) => p.uid), ['p1', 'p4', 'p5'], 'the bench does not count');
  assert.deepEqual(pactMembers(state, catalog, 'sky').map((p) => p.uid), ['p3', 'p4', 'p5']);
});

test('one sound per update: the most telling cue, a pact tier rising under it a moment later', () => {
  assert.deepEqual(cueSounds([{ kind: 'buy' }]), []);
  assert.deepEqual(cueSounds([{ kind: 'starUp' }, { kind: 'buy' }]), [{ name: 'starUp', tier: null, delay: 0 }]);
  assert.deepEqual(cueSounds([{ kind: 'starUp' }, { kind: 'pactUp', tier: 1 }, { kind: 'pactUp', tier: 3 }]), [{ name: 'starUp', tier: null, delay: 0 }, { name: 'pactTier', tier: 3, delay: 240 }]);
  assert.deepEqual(cueSounds([{ kind: 'pactUp', tier: 2 }]), [{ name: 'pactTier', tier: 2, delay: 0 }]);
  assert.deepEqual(cueSounds([{ kind: 'levelUp' }]), [{ name: 'levelBurst', tier: null, delay: 0 }]);
});

test('a wavefront marks a round start and a fight start, once per change', () => {
  assert.equal(wavefrontCue(PHASE.SETTLE, PHASE.ROUND_START), 'round');
  for (const fight of [PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]) assert.equal(wavefrontCue(PHASE.PREP, fight), 'battle');
  assert.equal(wavefrontCue(null, PHASE.COMBAT), null, 'opening a match mid-fight is not a fight start');
  assert.equal(wavefrontCue(PHASE.COMBAT, PHASE.COMBAT), null);
  assert.equal(wavefrontCue(PHASE.ROUND_START, PHASE.PREP), null);
  for (const from of [PHASE.SETTLE, PHASE.INFO_CHECK]) assert.equal(wavefrontCue(from, PHASE.PREP), 'round', 'a solo run opens its round straight into the prep');
});
