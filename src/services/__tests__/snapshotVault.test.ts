import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  captureSnapshot,
  clearSnapshotVault,
  exportSnapshot,
  importSnapshot,
  listSnapshots,
  loadSnapshotData,
  renameSnapshot,
  selectSnapshotsByProfile,
  SnapshotProgressUpdate,
  storeSnapshot
} from '../snapshotVault';
import { server } from '../../setupTests';

const createBuffer = (length: number) => {
  const array = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    array[index] = (index * 17) % 255;
  }
  return array.buffer;
};

describe('snapshotVault service', () => {
  beforeEach(async () => {
    await clearSnapshotVault();
    server.resetHandlers();
  });

  it('imports a snapshot from a File source and emits progress updates', async () => {
    const file = new File([createBuffer(16)], 'vault.bin');
    const progress: SnapshotProgressUpdate[] = [];

    const metadata = await importSnapshot(file, {
      profileId: 'dsl-2024',
      onProgress: (update) => progress.push(update)
    });

    expect(metadata.id).toBeTruthy();
    expect(metadata.profileId).toBe('dsl-2024');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)?.status).toBe('SUCCESS');

    const stored = await loadSnapshotData(metadata.id);
    expect(stored).toBeInstanceOf(ArrayBuffer);
    expect(stored?.byteLength).toBe(16);
  });

  it('imports a snapshot from a URL with download telemetry', async () => {
    const buffer = createBuffer(32);
    server.use(
      http.get('https://example.com/state.bin', async () => {
        return HttpResponse.arrayBuffer(buffer, {
          headers: {
            'Content-Length': buffer.byteLength.toString()
          }
        });
      })
    );

    const progress: SnapshotProgressUpdate[] = [];
    const metadata = await importSnapshot('https://example.com/state.bin', {
      profileId: 'dsl-2024',
      onProgress: (update) => progress.push(update)
    });

    expect(metadata.size).toBe(buffer.byteLength);
    const statuses = progress.map((entry) => entry.status);
    expect(statuses).toContain('IN_PROGRESS');
    expect(statuses.at(-1)).toBe('SUCCESS');
  });

  it('reports error telemetry when import fails', async () => {
    server.use(
      http.get('https://example.com/error.bin', () => HttpResponse.text('fail', { status: 500 }))
    );

    const progress: SnapshotProgressUpdate[] = [];
    await expect(
      importSnapshot('https://example.com/error.bin', {
        onProgress: (update) => progress.push(update)
      })
    ).rejects.toThrow();

    expect(progress.at(-1)?.status).toBe('ERROR');
  });

  it('captures a snapshot from an emulator callback and can be cancelled', async () => {
    const buffer = createBuffer(24);
    const controller = new AbortController();
    const progress: SnapshotProgressUpdate[] = [];

    const capturePromise = captureSnapshot(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          setTimeout(() => resolve(buffer), 30);
        }),
      {
        profileId: 'dsl-2024',
        signal: controller.signal,
        onProgress: (update) => progress.push(update)
      }
    );

    controller.abort();

    await expect(capturePromise).rejects.toThrowError(/aborted/i);
    expect(progress.at(-1)?.status).toBe('CANCELLED');
  });

  it('persists renamed metadata and filters by profile', async () => {
    const first = await storeSnapshot({
      buffer: createBuffer(8),
      name: 'first.bin',
      profileId: 'profile-a'
    });
    const second = await storeSnapshot({
      buffer: createBuffer(8),
      name: 'second.bin',
      profileId: 'profile-b'
    });

    const renamed = await renameSnapshot(first.id, 'renamed.bin');
    expect(renamed?.name).toBe('renamed.bin');

    const profileA = await selectSnapshotsByProfile('profile-a');
    expect(profileA).toHaveLength(1);
    expect(profileA[0].id).toBe(first.id);

    const profileB = await selectSnapshotsByProfile('profile-b');
    expect(profileB).toHaveLength(1);
    expect(profileB[0].id).toBe(second.id);
  });

  it('exports stored snapshots as blobs and preserves binary data', async () => {
    const metadata = await storeSnapshot({
      buffer: createBuffer(10),
      name: 'export.bin'
    });

    const { blob } = await exportSnapshot(metadata.id);
    const arrayBuffer = await blob.arrayBuffer();
    expect(arrayBuffer.byteLength).toBe(10);
  });

  it('lists snapshots sorted by savedAt descending', async () => {
    await storeSnapshot({ buffer: createBuffer(2), name: 'older.bin', savedAt: 1 });
    await storeSnapshot({ buffer: createBuffer(2), name: 'newer.bin', savedAt: 2 });

    const snapshots = await listSnapshots();
    expect(snapshots[0].savedAt).toBeGreaterThanOrEqual(snapshots[1].savedAt);
  });
});
