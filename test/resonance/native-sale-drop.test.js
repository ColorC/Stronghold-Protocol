import test from 'node:test';
import assert from 'node:assert/strict';
import { createDragController } from '../../public/js/render/drag.js';
import { dispatchNativeSellDrop, isNativeSellDrop, nativeSellTargetRect } from '../../public/js/resonance/nativeSell.js';

test('captured release over the interactive shop sale strip becomes one outside sale callback', () => {
  const shop = { left: 100, top: 300, right: 500, bottom: 500 };
  const rect = nativeSellTargetRect(shop);
  const piece = { uid: 41, kind: 'chess', area: 'board', row: 10, col: 8, draggable: true };
  const events = [];
  let sellCalls = 0;
  let targetMounted = true;
  const drag = createDragController({
    hitPiece: () => piece,
    pickTile: () => ({ row: 10, col: 8 }), // underlying raycast still sees a legal board cell
    canPlace: () => true,
    isOverCanvas: (x, y) => !(targetMounted && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom),
    threshold: 1,
    emit: (name, event) => {
      events.push(name);
      if (name !== 'pieceDrop') return;
      // Match Native's listener: capture the rect, then end the drag (which unmounts the strip).
      const dropRect = targetMounted ? rect : null;
      targetMounted = false;
      void dispatchNativeSellDrop({ piece: event.piece, showPrep: true, sell: 3, target: event.target, rect: dropRect, onSell: () => { sellCalls += 1; } });
    },
  });
  drag.setEditable(true);
  drag.pointerDown({ pointerId: 1, pointerType: 'mouse', button: 0, x: 10, y: 10, clientX: 10, clientY: 10 });
  drag.pointerMove({ pointerId: 1, pointerType: 'mouse', x: 120, y: 480, clientX: 120, clientY: 480 });
  drag.pointerUp({ pointerId: 1, pointerType: 'mouse', x: 120, y: 480, clientX: 120, clientY: 480 });

  assert.deepEqual(events.filter(name => name === 'pieceDrop'), ['pieceDrop']);
  assert.equal(sellCalls, 1);
  assert.deepEqual(events.slice(-2), ['pieceDrop', 'pieceDragEnd']);
});

test('sale helper rejects unrelated, non-prep, and non-sellable releases', () => {
  const rect = nativeSellTargetRect({ left: 100, top: 300, right: 500, bottom: 500 });
  const target = { area: 'outside', clientX: 120, clientY: 480 };
  assert.equal(isNativeSellDrop({ kind: 'chess', showPrep: true, sell: 3, target, rect }), true);
  assert.equal(isNativeSellDrop({ kind: 'chess', showPrep: false, sell: 3, target, rect }), false);
  assert.equal(isNativeSellDrop({ kind: 'item', showPrep: true, sell: 3, target, rect }), false);
  assert.equal(isNativeSellDrop({ kind: 'chess', showPrep: true, sell: null, target, rect }), false);
  assert.equal(isNativeSellDrop({ kind: 'chess', showPrep: true, sell: 3, target: { ...target, clientX: 99 }, rect }), false);
  assert.equal(isNativeSellDrop({ kind: 'chess', showPrep: true, sell: 3, target: { area: 'board', clientX: 120, clientY: 480 }, rect }), false);
});

test('a pointer-events-none shop overlay lets the underlying legal tile win instead of selling', () => {
  const rect = nativeSellTargetRect({ left: 100, top: 300, right: 500, bottom: 500 });
  const piece = { uid: 41, kind: 'chess', area: 'board', row: 10, col: 8, draggable: true };
  let sellCalls = 0;
  let dropTarget;
  const drag = createDragController({
    hitPiece: () => piece,
    pickTile: () => ({ row: 10, col: 8 }),
    canPlace: () => true,
    isOverCanvas: () => true, // elementFromPoint sees through a pointer-events:none target
    threshold: 1,
    emit: (name, event) => {
      if (name !== 'pieceDrop') return;
      dropTarget = event.target;
      void dispatchNativeSellDrop({ piece, showPrep: true, sell: 3, target: event.target, rect, onSell: () => { sellCalls += 1; } });
    },
  });
  drag.setEditable(true);
  drag.pointerDown({ pointerId: 2, pointerType: 'mouse', button: 0, x: 10, y: 10, clientX: 10, clientY: 10 });
  drag.pointerMove({ pointerId: 2, pointerType: 'mouse', x: 120, y: 480, clientX: 120, clientY: 480 });
  drag.pointerUp({ pointerId: 2, pointerType: 'mouse', x: 120, y: 480, clientX: 120, clientY: 480 });

  assert.equal(dropTarget.area, 'board');
  assert.equal(sellCalls, 0);
});
