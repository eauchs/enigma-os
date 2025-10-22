import { useCallback, useRef, useState } from 'react';
import { del, get, set } from 'idb-keyval';
import { normalizeResourceName } from '../utils/format';

export type SnapshotStage = 'checking' | 'missing' | 'importing' | 'ready' | 'error';
export type SnapshotSource = 'none' | 'stored' | 'uploaded' | 'remote' | 'captured';

export interface SnapshotMeta {
  name: string;
  size: number;
  savedAt: number;
}

export interface StoredSnapshotRecord extends SnapshotMeta {
  buffer: ArrayBuffer;
}

const SNAPSHOT_DB_KEY = 'enigma-shell:snapshot';

interface StoreOptions {
  source?: Exclude<SnapshotSource, 'none'>;
  updateInitialState?: boolean;
}

interface LoadResult {
  found: boolean;
  record: StoredSnapshotRecord | null;
  error?: string;
}

export const useSnapshotStorage = () => {
  const recordRef = useRef<StoredSnapshotRecord | null>(null);
  const [initialState, setInitialState] = useState<ArrayBuffer | null>(null);
  const [snapshotStage, setSnapshotStage] = useState<SnapshotStage>('checking');
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotMeta, setSnapshotMeta] = useState<SnapshotMeta | null>(null);
  const [snapshotSource, setSnapshotSource] = useState<SnapshotSource>('none');

  const setFromRecord = useCallback(
    (record: StoredSnapshotRecord | null, source: SnapshotSource) => {
      recordRef.current = record;
      if (record) {
        setInitialState(record.buffer);
        setSnapshotMeta({ name: record.name, size: record.size, savedAt: record.savedAt });
        setSnapshotStage('ready');
        setSnapshotSource(source);
        setSnapshotError(null);
      } else {
        setInitialState(null);
        setSnapshotMeta(null);
        setSnapshotStage('missing');
        setSnapshotSource('none');
      }
    },
    []
  );

  const loadSnapshot = useCallback(async (): Promise<LoadResult> => {
    setSnapshotStage('checking');
    setSnapshotError(null);
    try {
      const stored = await get<StoredSnapshotRecord | undefined>(SNAPSHOT_DB_KEY);
      if (stored && stored.buffer) {
        setFromRecord(
          {
            buffer: stored.buffer,
            name: stored.name ?? 'session.bin',
            size: stored.size ?? stored.buffer.byteLength,
            savedAt: stored.savedAt ?? Date.now()
          },
          'stored'
        );
        return { found: true, record: recordRef.current };
      }
      setFromRecord(null, 'none');
      return { found: false, record: null };
    } catch (error) {
      console.error('Failed to load stored snapshot', error);
      setSnapshotError((error as Error)?.message ?? 'Unable to access IndexedDB.');
      setSnapshotStage('error');
      setSnapshotSource('none');
      return {
        found: false,
        record: null,
        error: (error as Error)?.message ?? 'Unable to access IndexedDB.'
      };
    }
  }, [setFromRecord]);

  const storeSnapshotFromBuffer = useCallback(
    async (
      buffer: ArrayBuffer,
      meta: Partial<Omit<SnapshotMeta, 'size'>> & { size?: number },
      options?: StoreOptions
    ): Promise<StoredSnapshotRecord> => {
      const size = typeof meta.size === 'number' ? meta.size : buffer.byteLength;
      const record: StoredSnapshotRecord = {
        buffer,
        name: meta.name ?? 'session.bin',
        size,
        savedAt: meta.savedAt ?? Date.now()
      };
      await set(SNAPSHOT_DB_KEY, record);
      recordRef.current = record;
      setSnapshotMeta({ name: record.name, size: record.size, savedAt: record.savedAt });
      setSnapshotStage('ready');
      setSnapshotSource(options?.source ?? 'uploaded');
      setSnapshotError(null);
      if (options?.updateInitialState !== false) {
        setInitialState(buffer);
      }
      return record;
    },
    []
  );

  const importSnapshotFromFile = useCallback(
    async (file: File): Promise<StoredSnapshotRecord> => {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.zst')) {
        throw new Error('Compressed snapshots (.zst) are not supported yet. Decompress before importing.');
      }
      setSnapshotStage('importing');
      setSnapshotError(null);
      const buffer = await file.arrayBuffer();
      return storeSnapshotFromBuffer(
        buffer,
        { name: file.name, size: file.size, savedAt: Date.now() },
        { source: 'uploaded' }
      );
    },
    [storeSnapshotFromBuffer]
  );

  const importSnapshotFromUrl = useCallback(
    async (url: string): Promise<StoredSnapshotRecord> => {
      setSnapshotStage('importing');
      setSnapshotError(null);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download snapshot (${response.status} ${response.statusText})`);
      }
      const buffer = await response.arrayBuffer();
      const resourceName = normalizeResourceName(url);
      return storeSnapshotFromBuffer(
        buffer,
        { name: resourceName, size: buffer.byteLength, savedAt: Date.now() },
        { source: 'remote' }
      );
    },
    [storeSnapshotFromBuffer]
  );

  const forgetSnapshot = useCallback(async () => {
    await del(SNAPSHOT_DB_KEY);
    recordRef.current = null;
    setInitialState(null);
    setSnapshotMeta(null);
    setSnapshotSource('none');
    setSnapshotStage('missing');
    setSnapshotError(null);
  }, []);

  const getSnapshotRecord = useCallback(() => recordRef.current, []);

  const hasStoredSnapshot = snapshotStage === 'ready' && Boolean(recordRef.current?.buffer);

  return {
    initialState,
    snapshotStage,
    snapshotMeta,
    snapshotError,
    snapshotSource,
    hasStoredSnapshot,
    loadSnapshot,
    importSnapshotFromFile,
    importSnapshotFromUrl,
    storeSnapshotFromBuffer,
    forgetSnapshot,
    getSnapshotRecord
  };
};

