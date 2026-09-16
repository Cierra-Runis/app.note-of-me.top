// Persistence for the MIDI player: track files live in IndexedDB (binary
// friendly, no size limit worth worrying about), small settings in
// localStorage.

import type { PlayMode } from './use-midi-player';

export interface StoredTrack {
  addedAt: number;
  data: ArrayBuffer;
  duration: number;
  id: string;
  name: string;
  trackNames: string[];
}

export interface StoredSettings {
  currentId: null | string;
  playMode: PlayMode;
}

const DB_NAME = 'midi-player';
const DB_VERSION = 1;
const STORE = 'tracks';
const SETTINGS_KEY = 'midi-player:settings';

const DEFAULT_SETTINGS: StoredSettings = {
  currentId: null,
  playMode: 'sequential',
};

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

export const loadTracks = async () => {
  const tracks = await runTransaction<StoredTrack[]>('readonly', (store) =>
    store.getAll(),
  );
  return tracks.sort((a, b) => a.addedAt - b.addedAt);
};

export const saveTracks = async (tracks: StoredTrack[]) => {
  if (tracks.length === 0) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      tracks.forEach((track) => store.put(track));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

export const deleteTrack = (id: string) =>
  runTransaction('readwrite', (store) => store.delete(id));

export const loadSettings = (): StoredSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as StoredSettings) };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const saveSettings = (settings: StoredSettings) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode, quota); playback still works.
  }
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');


// Content hash used as the track id, so the same file is never added twice.
export const hashFile = async (data: ArrayBuffer) => {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
};
