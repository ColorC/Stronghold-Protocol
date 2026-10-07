const DB_NAME = 'stronghold-independent-client';
const STORE_NAME = 'replays';
const KEEP_REPLAYS = 8;
const MAX_REPLAY_BYTES = 32 * 1024 * 1024;

function database() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB is unavailable')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Cannot open replay store'));
  });
}

export async function saveClientReplay(sessionId, replay) {
  if (!sessionId || !Number.isInteger(replay?.round)) return false;
  const size = new TextEncoder().encode(JSON.stringify(replay)).byteLength;
  if (size > MAX_REPLAY_BYTES) return false;
  let db;
  try {
    db = await database();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key: `${sessionId}:${replay.round}`, sessionId, round: replay.round, createdAt: Date.now(), size, replay });
      const all = store.getAll();
      all.onsuccess = () => {
        const rows = all.result.sort((a, b) => b.createdAt - a.createdAt);
        let kept = 0; let total = 0;
        for (const row of rows) {
          const bytes = row.size || new TextEncoder().encode(JSON.stringify(row.replay)).byteLength;
          if (kept < KEEP_REPLAYS && total + bytes <= MAX_REPLAY_BYTES) { kept++; total += bytes; }
          else store.delete(row.key);
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Cannot save replay'));
      tx.onabort = () => reject(tx.error || new Error('Replay transaction aborted'));
    });
    return true;
  } catch { return false; }
  finally { db?.close(); }
}

export async function loadClientReplay(sessionId, round) {
  let db;
  try {
    db = await database();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(`${sessionId}:${round}`);
      request.onsuccess = () => resolve(request.result?.replay || null);
      request.onerror = () => reject(request.error || new Error('Cannot load replay'));
    });
  } catch { return null; }
  finally { db?.close(); }
}
