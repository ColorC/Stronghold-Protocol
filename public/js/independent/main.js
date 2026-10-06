// 卫戍协议：工坊 entry: the original client's device support, data store and dialogs, then the independent app.
import '../ui/compat.js';
import { render } from '../../vendor/preact.module.js';
import { html, UiHosts } from '../ui/components.js';
import { installDeviceSupport } from '../ui/device.js';
import { ToastHost } from '../ui/toasts.js';
import { App } from './app.js';

installDeviceSupport();
const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} /><${ToastHost} /><${UiHosts} />`, root);
