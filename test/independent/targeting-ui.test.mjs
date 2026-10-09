import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const hudSource = fs.readFileSync(new URL('../../public/js/independent/hud.js', import.meta.url), 'utf8');
const helperStart = hudSource.indexOf('export function dispatchShopSlotTap');
const helperEnd = hudSource.indexOf('\n}', helperStart) + 2;
const dispatchShopSlotTap = vm.runInNewContext(hudSource.slice(helperStart, helperEnd).replace(/^export /, '') + '\ndispatchShopSlotTap');

test('eligible shop target click dispatches selection without arming or buying', () => {
  const calls = [];
  dispatchShopSlotTap({ index: 2, slots: [{}, {}, { id: 'target', sold: false }], busy: false, armed: null, targetMode: true, targetSlots: [2], onTargetShopSlot: (i) => calls.push(['target', i]), onArm: (...x) => calls.push(['arm', ...x]), onBuy: (...x) => calls.push(['buy', ...x]), reasonFor: () => null });
  assert.deepEqual(calls, [['target', 2]]);
});

test('non-target shop cards preserve ordinary arm and buy behavior; invalid or busy slots stay inert', () => {
  const calls = [];
  const opts = { index: 1, slots: [{ id: 'a', sold: false }, { id: 'b', sold: false }], busy: false, armed: null, targetSlots: [0], onTargetShopSlot: (i) => calls.push(['target', i]), onArm: (...x) => calls.push(['arm', ...x]), onBuy: (...x) => calls.push(['buy', ...x]), reasonFor: () => null };
  dispatchShopSlotTap(opts);
  dispatchShopSlotTap({ ...opts, armed: 's1' });
  dispatchShopSlotTap({ ...opts, targetMode: true, index: 1 });
  dispatchShopSlotTap({ ...opts, targetMode: true, index: 0, busy: true });
  dispatchShopSlotTap({ ...opts, index: 3 });
  assert.deepEqual(calls, [['arm', 's1', opts.slots[1]], ['buy', 1]]);
  const ignored = [];
  dispatchShopSlotTap({ ...opts, targetMode: true, targetSlots: [0], onTargetShopSlot: () => ignored.push('target'), onArm: () => ignored.push('arm'), onBuy: () => ignored.push('buy') });
  assert.deepEqual(ignored, [], 'a non-eligible shop slot is inert while any target mode is active');
});

test('field targeting uses only the compact prompt and hides the detail pane while active', () => {
  const css = fs.readFileSync(new URL('../../public/css/independent.css', import.meta.url), 'utf8');
  const detail = fs.readFileSync(new URL('../../public/js/independent/detail.js', import.meta.url), 'utf8');
  assert.ok(css.includes('.ix-target-prompt{box-sizing:border-box;width:max-content;max-width:calc(100vw - 20px);min-height:40px;height:40px;'));
  assert.ok(css.includes('font-size:clamp(12px,0.9vw,14px)'));
  assert.ok(css.includes('.ix-game:has(.ix-target-prompt) .ix-dpanel{display:none!important}'));
  assert.doesNotMatch(detail, /ix-buy-targets--field/);
  assert.doesNotMatch(css, /ix-buy-targets--field/);
});


test('field target cancel and success preserve the detail selection hidden underneath', () => {
  const game = fs.readFileSync(new URL('../../public/js/independent/game.js', import.meta.url), 'utf8');
  assert.ok(game.includes('if (L.fieldTarget) { cancelFieldTarget(); e.preventDefault(); return; }'));
  assert.ok(game.includes('cancelFieldTarget(); }}>取消'));
  assert.ok(game.includes('buy(mode.slot, payload, { preserveDetail: true })'));
  assert.ok(game.includes('if (!preserveDetail) setDetail(null)'));
});
