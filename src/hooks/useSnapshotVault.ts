import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  captureSnapshot,
  exportSnapshot,
  importSnapshot,
  removeSnapshot,
  renameSnapshot,
  selectSnapshotsByProfile,
  SnapshotCaptureOptions,
  SnapshotCaptureSource,
  SnapshotExportResult,
  SnapshotImportOptions,
  SnapshotImportSource,
  SnapshotMetadata,
  SnapshotProgressUpdate
} from '../services/snapshotVault';

export interface UseSnapshotVaultState {
  loading: boolean;
  error: string | null;
  entries: SnapshotMetadata[];
  profileId: string | null;
  progress: SnapshotProgressUpdate | null;
  progressLog: SnapshotProgressUpdate[];
}

export interface UseSnapshotVaultControls {
  refresh: () => Promise<void>;
  selectProfile: (profileId: string | null) => void;
  importFromSource: (source: SnapshotImportSource, options?: SnapshotImportOptions) => Promise<SnapshotMetadata>;
  importFromUrl: (url: string, options?: Omit<SnapshotImportOptions, 'name'> & { name?: string }) => Promise<SnapshotMetadata>;
  capture: (source: SnapshotCaptureSource, options?: SnapshotCaptureOptions) => Promise<SnapshotMetadata>;
  rename: (id: string, name: string) => Promise<SnapshotMetadata | null>;
  remove: (id: string) => Promise<void>;
  exportSnapshot: (id: string) => Promise<SnapshotExportResult>;
  cancelCurrent: () => void;
}

export type UseSnapshotVaultResult = UseSnapshotVaultState & UseSnapshotVaultControls;

const toErrorMessage = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return 'Unknown error';
  }
};

const isAbortError = (value: unknown) => {
  if (!value) {
    return false;
  }
  const name = (value as Error).name;
  const message = (value as Error).message ?? '';
  return name === 'AbortError' || message.toLowerCase().includes('aborted');
};

const mergeSignals = (controller: AbortController, signal?: AbortSignal) => {
  if (!signal) {
    return controller.signal;
  }
  if (signal.aborted) {
    controller.abort();
  } else {
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', () => signal.removeEventListener('abort', abort));
  }
  return controller.signal;
};

export const useSnapshotVault = (initialProfileId: string | null = null): UseSnapshotVaultResult => {
  const [entries, setEntries] = useState<SnapshotMetadata[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(initialProfileId);
  const [progress, setProgress] = useState<SnapshotProgressUpdate | null>(null);
  const [progressLog, setProgressLog] = useState<SnapshotProgressUpdate[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetProgress = useCallback(() => {
    setProgress(null);
    setProgressLog([]);
  }, []);

  const updateEntriesForProfile = useCallback(
    async (targetProfile: string | null) => {
      setLoading(true);
      try {
        const snapshotList = await selectSnapshotsByProfile(targetProfile);
        setEntries(snapshotList);
        setError(null);
      } catch (fetchError) {
        setError(toErrorMessage(fetchError));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void updateEntriesForProfile(profileId);
  }, [profileId, updateEntriesForProfile]);

  const registerProgress = useCallback((update: SnapshotProgressUpdate) => {
    setProgress(update);
    setProgressLog((previous) => [...previous, update]);
  }, []);

  const beginOperation = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setError(null);
    resetProgress();
    return controller;
  }, [resetProgress]);

  const endOperation = useCallback(() => {
    setLoading(false);
    abortControllerRef.current = null;
  }, []);

  const refresh = useCallback(async () => {
    await updateEntriesForProfile(profileId);
  }, [profileId, updateEntriesForProfile]);

  const importFromSource = useCallback(
    async (source: SnapshotImportSource, options?: SnapshotImportOptions) => {
      const controller = beginOperation();
      try {
        const metadata = await importSnapshot(source, {
          ...options,
          signal: mergeSignals(controller, options?.signal),
          onProgress: (update) => registerProgress(update)
        });
        setEntries((previous) => {
          if (profileId && metadata.profileId && metadata.profileId !== profileId) {
            return previous;
          }
          const filtered = previous.filter((snapshot) => snapshot.id !== metadata.id);
          return [metadata, ...filtered];
        });
        return metadata;
      } catch (importError) {
        if (!isAbortError(importError)) {
          setError(toErrorMessage(importError));
        } else {
          setError(null);
        }
        throw importError;
      } finally {
        endOperation();
      }
    },
    [beginOperation, endOperation, profileId, registerProgress]
  );

  const importFromUrl = useCallback(
    async (url: string, options?: Omit<SnapshotImportOptions, 'name'> & { name?: string }) => {
      return importFromSource({ url, fileName: options?.name }, options);
    },
    [importFromSource]
  );

  const capture = useCallback(
    async (source: SnapshotCaptureSource, options?: SnapshotCaptureOptions) => {
      const controller = beginOperation();
      try {
        const metadata = await captureSnapshot(source, {
          ...options,
          signal: mergeSignals(controller, options?.signal),
          onProgress: (update) => registerProgress(update)
        });
        setEntries((previous) => {
          if (profileId && metadata.profileId && metadata.profileId !== profileId) {
            return previous;
          }
          const filtered = previous.filter((snapshot) => snapshot.id !== metadata.id);
          return [metadata, ...filtered];
        });
        return metadata;
      } catch (captureError) {
        if (!isAbortError(captureError)) {
          setError(toErrorMessage(captureError));
        } else {
          setError(null);
        }
        throw captureError;
      } finally {
        endOperation();
      }
    },
    [beginOperation, endOperation, profileId, registerProgress]
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      setLoading(true);
      try {
        const updated = await renameSnapshot(id, name);
        if (!updated) {
          return null;
        }
        setEntries((previous) =>
          previous.map((snapshot) => (snapshot.id === updated.id ? { ...snapshot, name: updated.name } : snapshot))
        );
        return updated;
      } catch (renameError) {
        setError(toErrorMessage(renameError));
        throw renameError;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const remove = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        await removeSnapshot(id);
        setEntries((previous) => previous.filter((snapshot) => snapshot.id !== id));
      } catch (removeError) {
        setError(toErrorMessage(removeError));
        throw removeError;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const exportSnapshotHandler = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const result = await exportSnapshot(id);
      return result;
    } catch (exportError) {
      setError(toErrorMessage(exportError));
      throw exportError;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelCurrent = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const selectProfile = useCallback((nextProfileId: string | null) => {
    setProfileId(nextProfileId);
  }, []);

  const state: UseSnapshotVaultState = useMemo(
    () => ({ loading, error, entries, profileId, progress, progressLog }),
    [entries, error, loading, profileId, progress, progressLog]
  );

  return {
    ...state,
    refresh,
    selectProfile,
    importFromSource,
    importFromUrl,
    capture,
    rename,
    remove,
    exportSnapshot: exportSnapshotHandler,
    cancelCurrent
  };
};

export default useSnapshotVault;
