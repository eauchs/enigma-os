import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { clearSnapshotVault, storeSnapshot, SnapshotProgressUpdate } from '../../services/snapshotVault';
import * as snapshotVault from '../../services/snapshotVault';
import useSnapshotVault from '../useSnapshotVault';

const createBuffer = (length: number) => {
  const array = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    array[index] = (index * 19) % 255;
  }
  return array.buffer;
};

describe('useSnapshotVault', () => {
  beforeEach(async () => {
    await clearSnapshotVault();
  });

  it('exposes initial empty state once loading completes', async () => {
    const { result } = renderHook(() => useSnapshotVault());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBeNull();
  });

  it('imports snapshots and records telemetry', async () => {
    const file = new File([createBuffer(12)], 'vault.bin');
    const { result } = renderHook(() => useSnapshotVault('dsl-2024'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.importFromSource(file, { profileId: 'dsl-2024' });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].profileId).toBe('dsl-2024');
    expect(result.current.progressLog.at(-1)?.status).toBe('SUCCESS');
  });

  it('handles import errors gracefully', async () => {
    const spy = vi.spyOn(snapshotVault, 'importSnapshot').mockRejectedValue(new Error('boom'));
    const file = new File([createBuffer(4)], 'broken.bin');
    const { result } = renderHook(() => useSnapshotVault());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let caught: unknown;
    try {
      await act(async () => {
        try {
          await result.current.importFromSource(file);
        } catch (error) {
          caught = error;
        }
      });
    } finally {
      spy.mockRestore();
    }

    expect((caught as Error)?.message).toBe('boom');
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('captures snapshots and allows cancellation mid-flight', async () => {
    const { result } = renderHook(() => useSnapshotVault('dsl-2024'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const captureSpy = vi
      .spyOn(snapshotVault, 'captureSnapshot')
      .mockImplementation(async (_source, options) => {
        options?.onProgress?.({ status: 'IN_PROGRESS', progress: 10 } as SnapshotProgressUpdate);
        if (options?.signal?.aborted) {
          options.onProgress?.({ status: 'CANCELLED', progress: 0 } as SnapshotProgressUpdate);
          return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (options?.signal?.aborted) {
          options.onProgress?.({ status: 'CANCELLED', progress: 0 } as SnapshotProgressUpdate);
          return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }
        options?.onProgress?.({ status: 'CANCELLED', progress: 0 } as SnapshotProgressUpdate);
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });

    let captureError: unknown;
    await act(async () => {
      try {
        const promise = result.current.capture(async () => createBuffer(4));
        result.current.cancelCurrent();
        await promise;
      } catch (error) {
        captureError = error;
      }
    });

    expect(captureError).toBeInstanceOf(Error);
    await waitFor(() => expect(result.current.progressLog.at(-1)?.status).toBe('CANCELLED'));
    expect(result.current.error).toBeNull();
    captureSpy.mockRestore();
  });

  it('filters entries by active profile and refreshes when switching', async () => {
    const first = await storeSnapshot({ buffer: createBuffer(6), name: 'a.bin', profileId: 'profile-a' });
    await storeSnapshot({ buffer: createBuffer(6), name: 'b.bin', profileId: 'profile-b' });

    const { result } = renderHook(() => useSnapshotVault('profile-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries.map((entry) => entry.id)).toEqual([first.id]);

    await act(async () => {
      result.current.selectProfile('profile-b');
    });

    await waitFor(() => expect(result.current.entries[0].profileId).toBe('profile-b'));
  });

  it('renames and exports snapshots through the service', async () => {
    const file = new File([createBuffer(8)], 'vault.bin');
    const { result } = renderHook(() => useSnapshotVault('dsl-2024'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.importFromSource(file, { profileId: 'dsl-2024' });
    });

    const snapshot = result.current.entries[0];

    await act(async () => {
      await result.current.rename(snapshot.id, 'renamed.bin');
    });

    await waitFor(() => expect(result.current.entries[0].name).toBe('renamed.bin'));

    let exportBlob: Blob | null = null;
    await act(async () => {
      const resultData = await result.current.exportSnapshot(snapshot.id);
      exportBlob = resultData.blob;
    });

    expect(exportBlob).not.toBeNull();
    expect(exportBlob?.size ?? 0).toBeGreaterThan(0);
  });
});
