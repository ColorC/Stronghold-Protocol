// A sparse resonance checkout has no public/vendor: importing this makes the browser components a test loads resolve
// their vendored modules from the canonical install instead.
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const CANONICAL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const vendor = pathToFileURL(path.join(PUBLIC, 'vendor')).href + '/';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && specifier.startsWith('.')) {
      const requested = new URL(specifier, context.parentURL);
      if (requested.href.startsWith(vendor) && !fs.existsSync(fileURLToPath(requested))) {
        return nextResolve(pathToFileURL(path.join(CANONICAL, 'public/vendor', requested.href.slice(vendor.length))).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
