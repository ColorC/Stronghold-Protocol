// The effect implementation is split by concern under render/fx/. This barrel
// preserves the renderer's public import surface.

export { setSimProjectileSpeeds, projSpeed } from './fx/speeds.js';
export { SHOT_HEIGHT, bodyZ } from './fx/camera.js';
export { ensureDamageFonts } from './fx/fonts.js';
export { FX_KINDS, fxSpec, tilesAround, wallTiles } from './fx/kinds.js';
export { FxSystem } from './fx/system.js';
