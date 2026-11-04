// Original-client VFX bridge. The player stays optional for headless tests and installations without extracted art.

import { OriginalVfxPlayer } from '../originalVfx.js';

export class FxOriginal {
  playOriginalVfx(prefab, options) { return this.originalVfx ? this.originalVfx.play(prefab, options) : false; }
  playOriginalMesh(prefab, options) { return this.originalVfx ? this.originalVfx.playMesh(prefab, options) : false; }
  playOriginalGroundFrame(options) { return this.originalVfx ? this.originalVfx.playGroundFrame(options) : false; }
  playOriginalGroundSheathe(options) { return this.originalVfx ? this.originalVfx.playGroundSheathe(options) : false; }
  markOriginalVfxProcedural(prefab) { this.originalVfx?.markProcedural(prefab); }
  markOriginalVfxUnresolved(prefab) { this.originalVfx?.markUnresolved(prefab); }
  stopOriginalVfx(group) { this.originalVfx?.stopGroup(group); }
}

export function createOriginalVfx(ctx) {
  return ctx.originalVfx ? new OriginalVfxPlayer({
    P: ctx.P, layers: ctx.layers, cam: ctx.cam, view: ctx.view, renderer: ctx.renderer,
    root: ctx.originalVfx.root, cacheKey: ctx.originalVfx.cacheKey,
  }) : null;
}
