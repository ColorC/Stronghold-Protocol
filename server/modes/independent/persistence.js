import { rename } from 'node:fs/promises';

const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RETRY_DELAYS_MS = [25, 50, 100, 200, 200, 200, 200];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Retry only transient Windows destination/source sharing failures, reusing the same pending file. */
export async function renameWithTransientRetry(from, to, { renameImpl = rename, wait = delay } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await renameImpl(from, to);
    } catch (error) {
      const retryDelay = RETRY_DELAYS_MS[attempt];
      if (!TRANSIENT_RENAME_CODES.has(error?.code) || retryDelay === undefined) throw error;
      await wait(retryDelay);
    }
  }
}
