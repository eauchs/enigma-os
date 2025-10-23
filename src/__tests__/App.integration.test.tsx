import { render, screen, within } from '@testing-library/react';
import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import App from '../App';
import { server } from '../setupTests';
import type { SnapshotMetadata } from '../services/snapshotVault';
import type { ForwardedRef } from 'react';

const {
  snapshotStore,
  listSnapshotsMock,
  storeSnapshotMock,
  loadSnapshotDataMock,
  removeSnapshotMock,
  renameSnapshotMock,
  ensureVaultMigratedMock,
  getStoredActiveSnapshotIdMock,
  storeActiveSnapshotIdMock
} = vi.hoisted(() => {
  const store = new Map<string, { metadata: SnapshotMetadata; buffer: ArrayBuffer }>();
  return {
    snapshotStore: store,
    listSnapshotsMock: vi.fn(),
    storeSnapshotMock: vi.fn(),
    loadSnapshotDataMock: vi.fn(),
    removeSnapshotMock: vi.fn(),
    renameSnapshotMock: vi.fn(),
    ensureVaultMigratedMock: vi.fn(),
    getStoredActiveSnapshotIdMock: vi.fn(),
    storeActiveSnapshotIdMock: vi.fn()
  };
});

vi.mock('../services/snapshotVault', async () => ({
  ensureVaultMigrated: ensureVaultMigratedMock,
  listSnapshots: listSnapshotsMock,
  loadSnapshotData: loadSnapshotDataMock,
  storeSnapshot: storeSnapshotMock,
  removeSnapshot: removeSnapshotMock,
  renameSnapshot: renameSnapshotMock,
  clearSnapshotVault: vi.fn(async () => snapshotStore.clear()),
  getStoredActiveSnapshotId: getStoredActiveSnapshotIdMock,
  storeActiveSnapshotId: storeActiveSnapshotIdMock
}));

vi.mock('../components/Emulator', () => {
  const mock = forwardRef(
    (
      { onReady, className }: { onReady?: () => void; className?: string },
      ref: ForwardedRef<unknown>
    ) => {
      const instance = useMemo(
        () => ({
          runCommand: vi.fn(),
          runSerialCommand: vi.fn(),
          runKeyboardCommand: vi.fn(),
          serial0_send: vi.fn(),
          keyboardType: vi.fn(),
          saveState: vi.fn(async () => new ArrayBuffer(4)),
          captureScreenshot: vi.fn(async () => 'data:image/png;base64,integration')
        }),
        []
      );

      useImperativeHandle(
        ref,
        () => instance,
        [instance]
      );

      useEffect(() => {
        onReady?.();
      }, [onReady]);

      return (
        <div data-testid="emulator-mock" className={className}>
          Emulator mock
        </div>
      );
    }
  );
  mock.displayName = 'AppIntegrationEmulatorMock';

  return {
    __esModule: true,
    default: mock
  };
});

describe('App integration', () => {
  beforeEach(() => {
    snapshotStore.clear();
    listSnapshotsMock.mockReset();
    storeSnapshotMock.mockReset();
    loadSnapshotDataMock.mockReset();
    removeSnapshotMock.mockReset();
    renameSnapshotMock.mockReset();
    ensureVaultMigratedMock.mockReset();
    getStoredActiveSnapshotIdMock.mockReset();
    storeActiveSnapshotIdMock.mockReset();

    listSnapshotsMock.mockImplementation(async () => {
      return Array.from(snapshotStore.values()).map((entry) => entry.metadata).sort((a, b) => b.savedAt - a.savedAt);
    });

    storeSnapshotMock.mockImplementation(async ({ buffer, name, profileId }: { buffer: ArrayBuffer; name: string; profileId?: string }) => {
      const id = `${Date.now()}-${Math.random()}`;
      const metadata: SnapshotMetadata = {
        id,
        name,
        size: buffer.byteLength,
        savedAt: Date.now(),
        profileId
      };
      snapshotStore.set(id, { metadata, buffer });
      return metadata;
    });

    loadSnapshotDataMock.mockImplementation(async (id: string) => snapshotStore.get(id)?.buffer ?? null);
    removeSnapshotMock.mockImplementation(async (id: string) => {
      snapshotStore.delete(id);
    });
    renameSnapshotMock.mockImplementation(async (id: string, newName: string) => {
      const record = snapshotStore.get(id);
      if (!record) {
        return null;
      }
      record.metadata = { ...record.metadata, name: newName };
      snapshotStore.set(id, record);
      return record.metadata;
    });
    ensureVaultMigratedMock.mockResolvedValue(undefined);
    getStoredActiveSnapshotIdMock.mockReturnValue(null);
    storeActiveSnapshotIdMock.mockReturnValue(undefined);
    server.resetHandlers();
    server.use(
      http.head('/images/dsl_disk.img', () => HttpResponse.text('', { headers: { 'Content-Length': '1024' } })),
      http.head('/images/dsl-2024.rc7.iso', () => HttpResponse.text('', { headers: { 'Content-Length': '2048' } }))
    );
  });

  it('walks through the happy path workflow', async () => {
    render(<App />);
    const user = userEvent.setup();

    await screen.findByText(/No Âme stored yet/i);

    const importFile = new File([new Uint8Array([1, 2, 3])], 'imported.bin', { type: 'application/octet-stream' });
    const fileInput = screen.getByTestId('snapshot-file-input');
    await user.upload(fileInput, importFile);

    await screen.findByText('imported.bin');
    expect(storeSnapshotMock).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Capture instantanée/i }));
    await screen.findByRole('button', { name: /Captured-/i });

    const listItems = screen.getAllByRole('listitem');
    const snapshotItem = listItems.find((item) => within(item).queryByText('imported.bin'));
    if (!snapshotItem) {
      throw new Error('Snapshot item not found');
    }

    await user.click(within(snapshotItem).getByRole('button', { name: 'Rename' }));
    const renameInput = within(snapshotItem).getByRole('textbox');
    await user.clear(renameInput);
    await user.type(renameInput, 'renamed.bin');
    await user.click(within(snapshotItem).getByRole('button', { name: 'Save' }));

    await screen.findByText('renamed.bin');

    const createElementSpy = vi.spyOn(document, 'createElement');
    const clickSpy = vi.fn();
    createElementSpy.mockImplementation((tagName: string) => {
      const element = Document.prototype.createElement.call(document, tagName);
      if (tagName === 'a') {
        element.click = clickSpy;
      }
      return element;
    });
    if (typeof URL.createObjectURL !== 'function') {
      // @ts-expect-error - polyfill for test environment
      URL.createObjectURL = vi.fn();
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      // @ts-expect-error - polyfill for test environment
      URL.revokeObjectURL = vi.fn();
    }
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const exportButton = within(snapshotItem).getByRole('button', { name: 'Export' });
    await user.click(exportButton);

    expect(clickSpy).toHaveBeenCalled();
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();

    createElementSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('surfaces errors when imports fail and keeps state untouched', async () => {
    storeSnapshotMock.mockRejectedValueOnce(new Error('network failure'));
    render(<App />);
    const user = userEvent.setup();

    await screen.findByText(/No Âme stored yet/i);

    const importFile = new File([new Uint8Array([9, 9, 9])], 'failing.bin', { type: 'application/octet-stream' });
    const fileInput = screen.getByTestId('snapshot-file-input');
    await user.upload(fileInput, importFile);

    await screen.findByText(/No Âme cached for this profile/i);
    expect(screen.queryByText('failing.bin')).not.toBeInTheDocument();
  });
});
