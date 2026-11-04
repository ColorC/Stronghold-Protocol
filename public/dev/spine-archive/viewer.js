const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const actions = [
  ['Idle', '待机'],
  ['Attack', '普攻'],
  ['Skill_1', '三连斩'],
  ['Skill_2_Begin', '激光起手'],
  ['Skill_2_Loop', '激光持续'],
  ['Skill_2_End', '激光收尾'],
  ['Skill_3_Begin', '自爆起手'],
  ['Skill_3_End', '自爆跪地'],
  ['Stun_Skill_3', '机体重组'],
  ['Die', '阵亡'],
  ['Start', '登场']
];
const parts = [
  ['all', '全身'],
  ['arms', '手臂'],
  ['legs', '腿部'],
  ['feet', '脚部'],
  ['blade', '剑']
];
const safe = (list, value, fallback) => list.some(([key]) => key === value) ? value : fallback;
let action = safe(actions, params.get('action'), 'Attack');
let part = safe(parts, params.get('part'), 'all');
let side = params.get('side') === 'back' ? 'back' : 'front';
let time = Math.max(0, Number(params.get('t')) || 0);
let playing = true;
let app;
let spine;
let duration = 0;
let lastTime = 0;
const baseline = new PIXI.Graphics();

function fillSelect(select, entries, selected) {
  select.replaceChildren(...entries.map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  select.value = selected;
}
fillSelect($('side'), [['front', '正面'], ['back', '背面']], side);
fillSelect($('action'), actions, action);
fillSelect($('part'), parts, part);

function setPlaying(value) {
  playing = value;
  $('pause').textContent = value ? '暂停' : '播放';
}
function writeLocation() {
  const url = new URL(location.href);
  url.searchParams.set('side', side);
  url.searchParams.set('action', action);
  url.searchParams.set('part', part);
  url.searchParams.set('t', time.toFixed(4));
  $('frameLink').href = url.href;
  $('fullscreen').href = url.href;
}
function partVisible(name) {
  if (part === 'all') return true;
  if (part === 'arms') return /^(upperarm|forearm|hand)_/.test(name);
  if (part === 'legs') return /^(thigh|shin)_/.test(name);
  if (part === 'feet') return /^foot_/.test(name);
  return name === 'sword' || name === 'hand_r';
}
function resize() {
  if (!app) return;
  const scene = $('scene');
  app.renderer.resize(scene.clientWidth, scene.clientHeight);
  if (!spine) return;
  const fit = Math.min((scene.clientHeight - 28) / 410, (scene.clientWidth - 36) / 420);
  const scale = Math.max(.15, fit);
  spine.scale.set(scale);
  spine.position.set(scene.clientWidth * .5, scene.clientHeight * .88);
  baseline.clear().lineStyle(1, 0x71818d, .5).moveTo(0, spine.y).lineTo(scene.clientWidth, spine.y);
}
async function loadSide() {
  const filename = side === 'back' ? 'char_diy_2b_back' : 'char_diy_2b';
  const data = await PIXI.Assets.load(`model/${side}/${filename}.json`);
  if (spine) {
    app.stage.removeChild(spine);
    spine.destroy({ children: true });
  }
  spine = new PIXI.spine.Spine(data.spineData);
  spine.autoUpdate = false;
  app.stage.addChild(spine);
  const anim = spine.spineData.findAnimation(action);
  if (!anim) throw new Error('动作资源暂不可用');
  duration = anim.duration;
  time = Math.min(time, duration);
  spine.state.setAnimation(0, action, action === 'Idle' || action === 'Skill_2_Loop');
  lastTime = -1;
  resize();
}
function pose() {
  if (!spine) return;
  const current = spine.state.getCurrent(0);
  if (!current) return;
  spine.skeleton.setToSetupPose();
  current.trackTime = Math.min(time, duration);
  spine.update(0);
  spine.skeleton.slots.forEach((slot, index) => {
    spine.slotContainers[index].visible = partVisible(slot.data.name);
  });
  $('progress').value = duration ? time / duration : 0;
  $('time').textContent = `${time.toFixed(2)} / ${duration.toFixed(2)}`;
  if (time !== lastTime) writeLocation();
  lastTime = time;
}
async function chooseAction(value) {
  action = value;
  time = 0;
  fillSelect($('action'), actions, action);
  await loadSide();
  pose();
}
$('side').addEventListener('change', async event => {
  side = event.target.value;
  await loadSide();
  pose();
});
$('action').addEventListener('change', event => { void chooseAction(event.target.value); });
$('part').addEventListener('change', event => { part = event.target.value; pose(); });
$('pause').addEventListener('click', () => setPlaying(!playing));
$('step').addEventListener('click', () => {
  setPlaying(false);
  time = Math.min(duration, time + 1 / 60);
  pose();
});
$('progress').addEventListener('input', event => {
  setPlaying(false);
  time = Number(event.target.value) * duration;
  pose();
});

try {
  app = new PIXI.Application({ backgroundColor: 0x20272d, antialias: true, resolution: devicePixelRatio, autoDensity: true });
  $('scene').prepend(app.view);
  app.stage.addChild(baseline);
  await loadSide();
  pose();
  window.addEventListener('resize', resize);
  app.ticker.add(() => {
    if (!playing || !spine) return;
    const speed = Number($('speed').value);
    if (action === 'Idle' || action === 'Skill_2_Loop') time = (time + app.ticker.deltaMS / 1000 * speed) % duration;
    else {
      time = Math.min(duration, time + app.ticker.deltaMS / 1000 * speed);
      if (time >= duration) setPlaying(false);
    }
    pose();
  });
  window.__motion = {
    ready: true,
    pose: value => { setPlaying(false); time = Math.max(0, Math.min(Number(value) || 0, duration)); pose(); },
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    setSide: async value => { side = value === 'back' ? 'back' : 'front'; $('side').value = side; await loadSide(); pose(); },
    setAction: value => chooseAction(safe(actions, value, 'Attack')),
    setPart: value => { part = safe(parts, value, 'all'); $('part').value = part; pose(); },
    sp: () => spine
  };
} catch {
  $('error').textContent = '动作资源暂时无法载入。';
  throw new Error('Motion archive failed to initialize');
}
