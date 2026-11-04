// Chrome flags for GPU-rendered, native-captured film runs (no software rasterizer flags).
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const GPU_ARGS = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-zero-copy',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--autoplay-policy=no-user-gesture-required', '--disable-component-update', '--window-size=1920,1080'];
export const CAPTURE_ARGS = ['--auto-accept-this-tab-capture', '--auto-select-tab-capture-source-by-title=STRONGHOLD'];
