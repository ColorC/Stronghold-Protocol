import { copyText } from '../ui/clipboard.js';
import { toast } from '../ui/toasts.js';
export { parseComponentLinkHash } from './componentLinkHash.js';

export function copyComponentLink(event, anchor) {
  event.preventDefault(); event.stopPropagation();
  const url = new URL(location.href); url.hash = anchor;
  copyText(url.href).then((ok) => toast(ok ? '链接已复制' : '未能复制链接', ok ? 'info' : 'warn'));
}
