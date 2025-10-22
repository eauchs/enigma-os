import { get, set, del } from 'idb-keyval';

const LEGACY_KEY = 'enigma-shell:snapshot';
const VAULT_INDEX_KEY = 'enigma-shell:vault:index';
const VAULT_DATA_PREFIX = 'enigma-shell:vault:data:';
const ACTIVE_SNAPSHOT_STORAGE_KEY = 'enigma-shell:vault:active';

interface LegacySnapshotRecord {
  buffer?: ArrayBuffer;
  name?: string;
  size?: number;
  savedAt?: number;
}

export type SnapshotMetadata = {
  id: string;
  name: string;
  size: number;
  savedAt: number;
  profileId?: string;
};

export interface SaveSnapshotParams {
  buffer: ArrayBuffer;
  name?: string;
  id?: string;
  savedAt?: number;
  profileId?: string;
}

const isArrayBuffer = (value: unknown): value is ArrayBuffer => {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]';
};

const safeNumber = (value: unknown, fallback: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const generateSnapshotId = () => {
  const cryptoRef: Crypto | undefined = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  if (cryptoRef?.getRandomValues) {
    const buffer = new Uint32Array(2);
    cryptoRef.getRandomValues(buffer);
    return `snapshot-${buffer[0].toString(16)}${buffer[1].toString(16)}`;
  }
  return `snapshot-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

const readIndex = async (): Promise<SnapshotMetadata[]> => {
  const value = await get<SnapshotMetadata[] | undefined>(VAULT_INDEX_KEY);
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is SnapshotMetadata => Boolean(entry && typeof entry.id === 'string'))
    .map((entry) => ({
      id: entry.id,
      name: entry.name ?? 'snapshot.bin',
      size: safeNumber(entry.size, 0),
      savedAt: safeNumber(entry.savedAt, Date.now()),
      profileId:
        entry && typeof (entry as SnapshotMetadata).profileId === 'string'
          ? (entry as SnapshotMetadata).profileId
          : undefined
    }));
};

const writeIndex = async (entries: SnapshotMetadata[]) => {
  await set(VAULT_INDEX_KEY, entries);
};

export const ensureVaultMigrated = async () => {
  const legacyRecord = await get<LegacySnapshotRecord | undefined>(LEGACY_KEY);
  if (!legacyRecord || !legacyRecord.buffer || !isArrayBuffer(legacyRecord.buffer)) {
    return;
  }

  const id = generateSnapshotId();
  const metadata: SnapshotMetadata = {
    id,
    name: legacyRecord.name ?? 'session.bin',
    size: safeNumber(legacyRecord.size, legacyRecord.buffer.byteLength),
    savedAt: safeNumber(legacyRecord.savedAt, Date.now())
  };

  await set(`${VAULT_DATA_PREFIX}${id}`, legacyRecord.buffer);
  const index = await readIndex();
  const filtered = index.filter((entry) => entry.id !== id);
  filtered.push(metadata);
  filtered.sort((a, b) => b.savedAt - a.savedAt);
  await writeIndex(filtered);
  await del(LEGACY_KEY);
};

export const listSnapshots = async (): Promise<SnapshotMetadata[]> => {
  await ensureVaultMigrated();
  const entries = await readIndex();
  return [...entries].sort((a, b) => b.savedAt - a.savedAt);
};

export const loadSnapshotData = async (id: string): Promise<ArrayBuffer | null> => {
  if (!id) {
    return null;
  }
  const value = await get<ArrayBuffer | undefined>(`${VAULT_DATA_PREFIX}${id}`);
  return value && isArrayBuffer(value) ? value : null;
};

export const storeSnapshot = async ({ buffer, name, id, savedAt, profileId }: SaveSnapshotParams): Promise<SnapshotMetadata> => {
  await ensureVaultMigrated();
  const snapshotId = id ?? generateSnapshotId();
  const timestamp = safeNumber(savedAt, Date.now());
  const resolvedName = (name ?? '').trim() || `snapshot-${new Date(timestamp).toISOString().replace(/[:.]/g, '-')}.bin`;
  const size = buffer.byteLength;

  await set(`${VAULT_DATA_PREFIX}${snapshotId}`, buffer);
  const index = await readIndex();
  const nextEntries = index.filter((entry) => entry.id !== snapshotId);
  const metadata: SnapshotMetadata = {
    id: snapshotId,
    name: resolvedName,
    size,
    savedAt: timestamp,
    profileId: profileId && profileId.length ? profileId : undefined
  };
  nextEntries.push(metadata);
  nextEntries.sort((a, b) => b.savedAt - a.savedAt);
  await writeIndex(nextEntries);
  return metadata;
};

export const removeSnapshot = async (id: string) => {
  if (!id) {
    return;
  }
  await del(`${VAULT_DATA_PREFIX}${id}`);
  const index = await readIndex();
  const nextEntries = index.filter((entry) => entry.id !== id);
  await writeIndex(nextEntries);
};

export const renameSnapshot = async (id: string, newName: string): Promise<SnapshotMetadata | null> => {
  if (!id) {
    return null;
  }
  const trimmed = newName.trim();
  if (!trimmed) {
    return null;
  }
  const index = await readIndex();
  const entry = index.find((item) => item.id === id);
  if (!entry) {
    return null;
  }
  entry.name = trimmed;
  await writeIndex([...index]);
  return { ...entry };
};

export const clearSnapshotVault = async () => {
  const index = await readIndex();
  await Promise.all(index.map((entry) => del(`${VAULT_DATA_PREFIX}${entry.id}`)));
  await del(VAULT_INDEX_KEY);
};

export const getStoredActiveSnapshotId = (): string | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const value = window.localStorage.getItem(ACTIVE_SNAPSHOT_STORAGE_KEY);
    return value && value.length ? value : null;
  } catch (error) {
    console.warn('Unable to read active snapshot id from storage.', error);
    return null;
  }
};

export const storeActiveSnapshotId = (id: string | null) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_SNAPSHOT_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_SNAPSHOT_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Unable to persist active snapshot id.', error);
  }
};
