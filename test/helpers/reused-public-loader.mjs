import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const canonicalPublic = path.resolve(process.env.SP_REUSED_PUBLIC_DIR || '');
const vendorMarker = `${path.sep}public${path.sep}vendor${path.sep}`;

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith('file:') && canonicalPublic) {
    const resolved = new URL(specifier, context.parentURL);
    if (resolved.protocol !== 'file:') return nextResolve(specifier, context);
    const target = path.resolve(fileURLToPath(resolved));
    const lower = target.toLowerCase();
    const marker = vendorMarker.toLowerCase();
    const index = lower.indexOf(marker);
    if (index >= 0 && !lower.startsWith(`${canonicalPublic.toLowerCase()}${path.sep}`)) {
      const relativeVendorPath = target.slice(index + vendorMarker.length);
      return { url: pathToFileURL(path.join(canonicalPublic, 'vendor', relativeVendorPath)).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
