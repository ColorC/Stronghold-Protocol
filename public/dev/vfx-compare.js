// Synchronized before/after battle harness for the extracted Rosmontis VFX.
import { createFieldView } from '../js/render/app.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { GEO } from '../../shared/constants.js';

const $ = (id) => document.getElementById(id);
const rect = { ...GEO.NORMAL_RECT };
const stageId = 'act2autochess_m03';
const fieldId = 'vfx-compare';
const errors = [];
let before;
let after;
let running = true;
let speed = 1;
let scenario = 'full';
let operator = 'rosmon';
let elapsed = 0;
let cursor = 0;
let timeline = [];
let last = performance.now();

window.addEventListener('error', (e) => { errors.push(e.message || '页面错误'); renderErrors(); });
window.addEventListener('unhandledrejection', (e) => { errors.push(String(e.reason?.message || e.reason || '异步错误')); renderErrors(); });

function ros(skillIndex) {
  return { id: 1, kind: 'op', side: 'ally', ownerId: 'P1', defId: 'chess_char_6_12_b', name: '迷迭香', tier: 6, golden: true,
    spine: 'char_391_rosmon', avatar: 'char_391_rosmon_2', x: 4, y: 11, facing: 1, dir: 'RIGHT', maxHp: 2887,
    uid: 106, skillIndex, moduleId: 'uniequip_002_rosmon' };
}

function blkkgt(skillIndex) {
  return { id: 1, kind: 'op', side: 'ally', ownerId: 'P1', defId: 'chess_char_6_19_b', name: '锏', tier: 6, golden: true,
    spine: 'char_4116_blkkgt', avatar: 'char_4116_blkkgt_2', x: 4, y: 11, facing: 1, dir: 'RIGHT', maxHp: 2767,
    uid: 103, skillIndex, moduleId: 'uniequip_002_blkkgt' };
}

function enemy(id, defId, x, y, extra = {}) {
  const e = data.lookup('enemies', defId);
  return { id, kind: 'enemy', side: 'enemy', ownerId: 'P1', defId, name: e?.name || defId, tier: 1, golden: false,
    spine: e?.spine || defId, avatar: e?.iconId || defId, x, y, facing: -1, dir: 'LEFT', maxHp: 10000, ...extra };
}

function unitsFor(skillId) {
  if (operator === 'blkkgt') {
    const skillIndex = skillId === 'skchr_blkkgt_1' ? 0 : skillId === 'skchr_blkkgt_2' ? 1 : 2;
    // S3 is x-1: [2,0], [1,-1..1], [0,-2..2], [-1,-1..1], [-2,0]
    // in the facing-RIGHT frame. Keep every demo victim on that authored
    // 13-tile range so the target-side slash effects can be checked against
    // the map effect instead of being staged outside the skill.
    return [blkkgt(skillIndex), enemy(20, 'enemy_1007_slime', 6, 11), enemy(21, 'enemy_1042_frostd', 5, 10), enemy(22, 'enemy_1006_shield', 5, 12, { elite: true })];
  }
  const skillIndex = skillId === 'skchr_rosmon_1' ? 0 : skillId === 'skchr_rosmon_3' ? 2 : 1;
  return [ros(skillIndex), enemy(20, 'enemy_1007_slime', 7, 11), enemy(21, 'enemy_1042_frostd', 8, 10), enemy(22, 'enemy_1006_shield', 8, 12, { elite: true })];
}

function snapshot(units, t, hp) {
  return units.map((u) => [u.id, u.x, u.y, hp.get(u.id) ?? u.maxHp, u.maxHp, (t * 2 + u.id) % 20, u.kind === 'op' ? 20 : 0, 0, u.side === 'enemy' ? 2 : 0]);
}

function makeTimeline(kind) {
  const a = [];
  const add = (t, ...ev) => a.push([t, ev]);
  if (operator === 'blkkgt') {
    const skillId = kind.startsWith('skchr_blkkgt_') ? kind : 'skchr_blkkgt_3';
    if (skillId === 'skchr_blkkgt_3') {
      // This is the actual server event shape: skill → ten fx:slash/dmg pairs → fx:finale/dmg → skill off.
      // `data/chess.json` and the sim blackboard give d_hit_interval = 0.3 s;
      // each slash resolves against every victim in the x-1 range (up to 5).
      const start = 0.5;
      const victims = [20, 21, 22];
      add(0.15, ['deploy', 1]);
      add(start, ['skill', 1, 1, skillId]);
      for (let i = 0; i < 10; i++) {
        const t = start + i * 0.3;
        add(t, ['fx', 'slash', 4, 11, { id: 1, n: victims.length }]);
        for (const [j, target] of victims.entries()) add(t + 0.012 + j * 0.006, ['dmg', target, 420, 'phys', 1, 0]);
      }
      const finale = start + 10 * 0.3 + 0.08;
      add(finale, ['fx', 'finale', 4, 11, { id: 1 }]);
      for (const [j, target] of victims.entries()) add(finale + 0.333 + j * 0.006, ['dmg', target, 980, 'phys', 1, 0]);
      add(finale + 0.58, ['skill', 1, 0, skillId]);
      return a;
    }
    // S1/S2 retain the extracted action-slot comparison: cast effects plus target hit groups.
    add(0.15, ['deploy', 1]);
    add(0.9, ['atk', 1, 20, 'none', 11, 0]);
    add(1.2, ['dmg', 20, 620, 'phys', 1, 11]);
    add(1.65, ['skill', 1, 1, skillId]);
    add(2.05, ['atk', 1, 20, 'none', 21, 1]);
    add(2.28, ['dmg', 20, 980, 'phys', 1, 21]);
    add(2.55, ['dmg', 20, 980, 'phys', 1, 21]);
    add(2.9, ['atk', 1, 21, 'none', 22, 1]);
    add(3.15, ['dmg', 21, 980, 'phys', 1, 22]);
    add(3.42, ['dmg', 21, 980, 'phys', 1, 22]);
    add(4.5, ['skill', 1, 0, skillId]);
    return a;
  }
  const addSkill = (skillId, start, attackId, targetId, amount) => {
    add(start, ['skill', 1, 1, skillId]);
    add(start + 0.3, ['atk', 1, targetId, 'bolt', attackId, 1]);
    add(start + 0.6, ['dmg', targetId, amount, 'arts', 1, attackId]);
    add(start + 0.9, ['skill', 1, 0, skillId]);
  };
  add(0.15, ['deploy', 1]);
  add(0.8, ['atk', 1, 20, 'bolt', 11, 0]);
  add(1.08, ['dmg', 20, 420, 'arts', 1, 11]);
  addSkill(kind === 'full' ? 'skchr_rosmon_2' : kind, 1.45, 21, 20, 880);
  return a.sort((x, y) => x[0] - y[0]);
}

function resetBattle() {
  elapsed = 0;
  cursor = 0;
  timeline = makeTimeline(scenario);
  const skillId = operator === 'blkkgt' ? (scenario.startsWith('skchr_blkkgt_') ? scenario : 'skchr_blkkgt_3') : (scenario === 'full' ? 'skchr_rosmon_2' : scenario);
  const units = unitsFor(skillId);
  const original = after?.debug?.fx?.originalVfx;
  original?.clear?.();
  if (original && original.root !== (operator === 'blkkgt' ? '/assets/vfx/blkkgt' : '/assets/vfx/rosmon')) {
    original.destroy();
    original.root = operator === 'blkkgt' ? '/assets/vfx/blkkgt' : '/assets/vfx/rosmon';
  }
  const meta = { fieldId, kind: 'normal', rect, stageId, units };
  for (const view of [before, after]) {
    view.enterBattle(meta);
    view.setCamera('normal', { rect, instant: true });
  }
  const hp = new Map(units.map((u) => [u.id, u.maxHp]));
  resetBattle.hp = hp;
  const initial = { t: 'b.snap', fieldId, gt: 0, units: snapshot(units, 0, hp), dp: 10, killed: 0, total: 3 };
  before.pushSnapshot(initial); after.pushSnapshot(initial);
  const label = operator === 'blkkgt' ? `锏 · ${skillId.replace('skchr_blkkgt_', '技能')}` : (scenario === 'full' ? '迷迭香 · 完整流程' : `迷迭香 · ${scenario.replace('skchr_rosmon_', '技能')}`);
  $('status').innerHTML = `<strong>${label}：</strong> 同步播放中`;
}

function sendFrame(t, ev, units) {
  const hp = resetBattle.hp;
  for (const e of ev) if (e[0] === 'dmg' && hp.has(e[1])) hp.set(e[1], Math.max(1, hp.get(e[1]) - Number(e[2] || 0)));
  for (const view of [before, after]) {
    view.pushEvents({ t: 'b.ev', fieldId, gt: t, ev });
    view.pushSnapshot({ t: 'b.snap', fieldId, gt: t, units: snapshot(units, t, hp), dp: 10, killed: 0, total: 3 });
  }
}

function advance(dt) {
  if (!running) return;
  const skillId = operator === 'blkkgt' ? (scenario.startsWith('skchr_blkkgt_') ? scenario : 'skchr_blkkgt_3') : (scenario === 'full' ? 'skchr_rosmon_2' : scenario);
  const units = unitsFor(skillId);
  const next = Math.min(0.1, dt * speed);
  const old = elapsed;
  elapsed += next;
  while (cursor < timeline.length && timeline[cursor][0] <= elapsed + 1e-6) {
    const [t, ev] = timeline[cursor++];
    sendFrame(t, ev, units);
  }
  if (elapsed >= (operator === 'blkkgt' ? (skillId === 'skchr_blkkgt_3' ? 5.2 : 5.4) : (scenario === 'full' ? 7 : 6))) { running = false; $('status').innerHTML = '<strong>播放结束</strong>：点击“重播”或选择另一个场景'; }
  void old;
}

function stats(view) {
  const s = view?.stats?.() || {};
  return `fps ${Number(s.fps || 0).toFixed(0)}  frame ${Number(s.frameMs || 0).toFixed(1)} ms\nFX ${s.particles || 0} 粒子  ${s.projectiles || 0} 投射  原版 ${s.originalVfx || 0}  缺资源 ${s.originalMissing || 0}  未解挂点 ${s.originalUnresolved || 0}`;
}

function renderErrors() { $('errors').textContent = errors.length ? `错误：${errors.slice(-2).join('；')}` : ''; }

function wireControls() {
  const toggle = document.querySelector('[data-action="toggle"]');
  const restart = document.querySelector('[data-action="restart"]');
  for (const b of document.querySelectorAll('[data-scenario]')) b.onclick = () => {
    const blakkScenario = b.dataset.scenario.startsWith('skchr_blkkgt_');
    if ((operator === 'blkkgt') !== blakkScenario) return;
    scenario = b.dataset.scenario;
    document.querySelectorAll('[data-scenario]').forEach((x) => x.classList.toggle('is-on', x === b));
    running = true;
    resetBattle();
  };
  for (const b of document.querySelectorAll('[data-operator]')) b.onclick = () => {
    operator = b.dataset.operator;
    scenario = operator === 'blkkgt' ? 'skchr_blkkgt_3' : 'full';
    document.querySelectorAll('[data-operator]').forEach((x) => x.classList.toggle('is-on', x === b));
    document.querySelectorAll('[data-scenario]').forEach((x) => {
      const isBlakk = x.dataset.scenario.startsWith('skchr_blkkgt_');
      x.hidden = isBlakk !== (operator === 'blkkgt');
      x.classList.toggle('is-on', x.dataset.scenario === scenario);
    });
    running = true;
    resetBattle();
  };
  toggle.onclick = () => { running = !running; toggle.textContent = running ? '❚❚' : '▶'; };
  restart.onclick = () => { running = true; toggle.textContent = '❚❚'; resetBattle(); };
  $('speed').onchange = () => { speed = Number($('speed').value) || 1; };
}

async function main() {
  try {
    await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
    await assets.ready();
    [before, after] = await Promise.all([
      createFieldView($('before-field'), { data, assets, board: '2d', originalVfx: false, settings: { quality: 'high', damageNumbers: true } }),
      createFieldView($('after-field'), { data, assets, board: '2d', originalVfx: { root: '/assets/vfx/rosmon' }, settings: { quality: 'high', damageNumbers: true } }),
    ]);
    wireControls();
    document.querySelectorAll('[data-scenario]').forEach((x) => { const isBlakk = x.dataset.scenario.startsWith('skchr_blkkgt_'); x.hidden = isBlakk; });
    resetBattle();
    window.__vfxCompare = { before, after, reset: resetBattle, stats: () => ({ before: before.stats(), after: after.stats() }),
      coverage: () => after?.debug?.fx?.originalVfx?.coverage?.() || after?.stats?.()?.originalCoverage || null };
    $('status').innerHTML = '<strong>准备完成</strong>：两侧使用同一批战斗事件';
    const loop = (now) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      advance(dt);
      $('before-stats').textContent = stats(before);
      $('after-stats').textContent = stats(after);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (err) {
    errors.push(err?.stack || err?.message || String(err));
    $('status').textContent = '加载失败';
    renderErrors();
  }
}

main();
