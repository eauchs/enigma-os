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

export type SnapshotOperationStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'ERROR' | 'CANCELLED';

export interface SnapshotProgressUpdate {
  id?: string | null;
  status: SnapshotOperationStatus;
  progress: number;
  loaded?: number;
  total?: number;
  message?: string;
  error?: Error;
}

export type SnapshotImportSource = File | { url: string; fileName?: string } | Blob | string;

export interface SnapshotImportOptions {
  profileId?: string;
  signal?: AbortSignal;
  onProgress?: (update: SnapshotProgressUpdate) => void;
  name?: string;
  timestamp?: number;
}

export interface SnapshotCaptureOptions {
  profileId?: string;
  signal?: AbortSignal;
  onProgress?: (update: SnapshotProgressUpdate) => void;
  name?: string;
  timestamp?: number;
}

export interface SnapshotExportResult {
  blob: Blob;
  metadata: SnapshotMetadata;
}

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

const asError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
};

const createAbortError = () => {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    return abortError;
  }
};

const isAbortError = (error: unknown) => {
  if (!error) {
    return false;
  }
  const message = (error as Error)?.message ?? '';
  const name = (error as Error)?.name ?? '';
  return name === 'AbortError' || message.toLowerCase().includes('abort');
};

const emitProgress = (
  callback: ((update: SnapshotProgressUpdate) => void) | undefined,
  update: SnapshotProgressUpdate
) => {
  if (typeof callback === 'function') {
    callback(update);
  }
};

const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const concatenateChunks = (chunks: Uint8Array[], totalSize: number): ArrayBuffer => {
  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
};

const nameFromUrl = (input: string): string => {
  if (!input) {
    return 'snapshot.bin';
  }
  try {
    const url = new URL(input, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    const candidate = segments[segments.length - 1];
    return candidate && candidate.length ? candidate : 'snapshot.bin';
  } catch {
    const sanitized = input.split('?')[0]?.split('#')[0] ?? input;
    const segments = sanitized.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? 'snapshot.bin';
  }
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

export const importSnapshot = async (
  source: SnapshotImportSource,
  options: SnapshotImportOptions = {}
): Promise<SnapshotMetadata> => {
  const { profileId, signal, onProgress, name, timestamp } = options;
  const startedAt = safeNumber(timestamp, Date.now());
  let loadedBytes = 0;
  let totalBytes: number | undefined;

  const emit = (update: SnapshotProgressUpdate) => emitProgress(onProgress, update);

  try {
    throwIfAborted(signal);
    emit({ status: 'IN_PROGRESS', progress: 0, message: 'Preparing snapshot import' });

    let buffer: ArrayBuffer;
    let resolvedName = name?.trim() || 'snapshot.bin';

    if (typeof File !== 'undefined' && source instanceof File) {
      resolvedName = name?.trim() || source.name || resolvedName;
      buffer = await source.arrayBuffer();
      loadedBytes = buffer.byteLength;
      totalBytes = buffer.byteLength;
    } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
      buffer = await source.arrayBuffer();
      loadedBytes = buffer.byteLength;
      totalBytes = buffer.byteLength;
    } else {
      const url = typeof source === 'string' ? source : source.url;
      resolvedName =
        name?.trim() || (typeof source === 'string' ? nameFromUrl(source) : source.fileName ?? nameFromUrl(url));

      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`Failed to download snapshot (${response.status})`);
      }

      const headerSize = response.headers.get('content-length');
      const parsedSize = headerSize ? Number(headerSize) : undefined;
      totalBytes = Number.isFinite(parsedSize) ? Number(parsedSize) : undefined;

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        loadedBytes = 0;
        while (true) {
          throwIfAborted(signal);
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            chunks.push(value);
            loadedBytes += value.byteLength;
            const progress = totalBytes
              ? Math.min(99, Math.floor((loadedBytes / totalBytes) * 100))
              : Math.min(95, chunks.length > 0 ? 50 + Math.min(45, loadedBytes / 1024) : 10);
            emit({
              status: 'IN_PROGRESS',
              progress,
              loaded: loadedBytes,
              total: totalBytes,
              message: 'Downloading snapshot…'
            });
          }
        }
        buffer = concatenateChunks(chunks, loadedBytes);
      } else {
        buffer = await response.arrayBuffer();
        loadedBytes = buffer.byteLength;
        totalBytes = buffer.byteLength;
      }
    }

    throwIfAborted(signal);

    emit({
      status: 'IN_PROGRESS',
      progress: totalBytes ? Math.min(99, Math.floor((loadedBytes / totalBytes) * 100)) : 95,
      loaded: loadedBytes,
      total: totalBytes,
      message: 'Persisting snapshot to vault…'
    });

    const metadata = await storeSnapshot({
      buffer,
      name: resolvedName,
      savedAt: startedAt,
      profileId
    });

    emit({
      id: metadata.id,
      status: 'SUCCESS',
      progress: 100,
      loaded: buffer.byteLength,
      total: buffer.byteLength,
      message: 'Snapshot imported successfully'
    });

    return metadata;
  } catch (error) {
    const resolvedError = asError(error);
    if (isAbortError(resolvedError) || signal?.aborted) {
      emit({ status: 'CANCELLED', progress: 0, error: resolvedError, message: 'Snapshot import cancelled' });
    } else {
      emit({ status: 'ERROR', progress: 0, error: resolvedError, message: 'Snapshot import failed' });
    }
    throw resolvedError;
  }
};

export type SnapshotCaptureSource = () => Promise<ArrayBuffer>;

export const captureSnapshot = async (
  source: SnapshotCaptureSource,
  options: SnapshotCaptureOptions = {}
): Promise<SnapshotMetadata> => {
  const { profileId, signal, onProgress, name, timestamp } = options;
  const emit = (update: SnapshotProgressUpdate) => emitProgress(onProgress, update);

  try {
    throwIfAborted(signal);
    emit({ status: 'IN_PROGRESS', progress: 0, message: 'Capturing snapshot from emulator' });

    const buffer = await source();
    throwIfAborted(signal);

    emit({
      status: 'IN_PROGRESS',
      progress: 60,
      loaded: buffer.byteLength,
      total: buffer.byteLength,
      message: 'Persisting captured snapshot…'
    });

    const metadata = await storeSnapshot({
      buffer,
      name: name?.trim() || undefined,
      savedAt: safeNumber(timestamp, Date.now()),
      profileId
    });

    emit({
      id: metadata.id,
      status: 'SUCCESS',
      progress: 100,
      loaded: buffer.byteLength,
      total: buffer.byteLength,
      message: 'Snapshot captured successfully'
    });

    return metadata;
  } catch (error) {
    const resolvedError = asError(error);
    if (isAbortError(resolvedError) || signal?.aborted) {
      emit({ status: 'CANCELLED', progress: 0, error: resolvedError, message: 'Snapshot capture cancelled' });
    } else {
      emit({ status: 'ERROR', progress: 0, error: resolvedError, message: 'Snapshot capture failed' });
    }
    throw resolvedError;
  }
};

export const exportSnapshot = async (id: string): Promise<SnapshotExportResult> => {
  if (!id) {
    throw new Error('Snapshot id is required to export.');
  }
  const metadataList = await listSnapshots();
  const metadata = metadataList.find((entry) => entry.id === id);
  if (!metadata) {
    throw new Error(`Snapshot with id ${id} was not found.`);
  }
  const buffer = await loadSnapshotData(id);
  if (!buffer) {
    throw new Error('Snapshot payload is empty.');
  }
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  return { blob, metadata };
};

export const selectSnapshotsByProfile = async (profileId?: string | null): Promise<SnapshotMetadata[]> => {
  const snapshots = await listSnapshots();
  if (!profileId) {
    return snapshots;
  }
  return snapshots.filter((snapshot) => !snapshot.profileId || snapshot.profileId === profileId);
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
