// 卫戍协议：工坊 entry: the original client's device support, data store and dialogs, then the independent app.
import '../ui/compat.js';
import { render } from '../../vendor/preact.module.js';
import { html, UiHosts } from '../ui/components.js';
import { installDeviceSupport } from '../ui/device.js';
import { ToastHost } from '../ui/toasts.js';
import { installAudio } from '../audio.js';
import { settingsStore } from '../ui/settings.js';
import { data } from '../data.js';
import { App } from './app.js';

installDeviceSupport();
// the original client's sound: BGM, UI and battle SFX, operator voices (the game screen picks the tracks)
installAudio({ getManifest: () => data.get('assets'), settings: settingsStore.get() });
const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} /><${ToastHost} /><${UiHosts} />`, root);
