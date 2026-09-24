// Almacén local (IndexedDB) de los PDF creados o importados.

const DB_NAME = 'escaner-pdf';
const STORE = 'docs';
let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Operación cancelada (¿sin espacio?).'));
  });
}

export const listDocs = () => run('readonly', (store) => store.getAll());
export const saveDoc = (doc) => run('readwrite', (store) => store.put(doc));
export const deleteDoc = (id) => run('readwrite', (store) => store.delete(id));
