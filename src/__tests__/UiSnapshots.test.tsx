import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { forwardRef, useImperativeHandle, useMemo } from 'react';
import App from '../App';
import { server } from '../setupTests';
import type { SnapshotMetadata } from '../services/snapshotVault';

const originalToLocaleString = Date.prototype.toLocaleString;

const {
  snapshotStore,
  listSnapshotsMock,
  storeSnapshotMock,
  loadSnapshotDataMock,
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
    ensureVaultMigratedMock: vi.fn(),
    getStoredActiveSnapshotIdMock: vi.fn(),
    storeActiveSnapshotIdMock: vi.fn()
  };
});

vi.mock('../services/snapshotVault', async () => {
  listSnapshotsMock.mockImplementation(async () =>
    Array.from(snapshotStore.values()).map((entry) => entry.metadata)
  );
  storeSnapshotMock.mockImplementation(async ({ buffer, name, profileId }) => {
    const id = `${Date.now()}`;
    const metadata = { id, name, size: buffer.byteLength, savedAt: Date.now(), profileId };
    snapshotStore.set(id, { metadata, buffer });
    return metadata;
  });
  loadSnapshotDataMock.mockImplementation(async (id: string) => snapshotStore.get(id)?.buffer ?? null);
  ensureVaultMigratedMock.mockResolvedValue(undefined);
  getStoredActiveSnapshotIdMock.mockReturnValue(null);
  storeActiveSnapshotIdMock.mockReturnValue(undefined);

  return {
    ensureVaultMigrated: ensureVaultMigratedMock,
    listSnapshots: listSnapshotsMock,
    loadSnapshotData: loadSnapshotDataMock,
    storeSnapshot: storeSnapshotMock,
    removeSnapshot: vi.fn(async (id: string) => snapshotStore.delete(id)),
    renameSnapshot: vi.fn(async () => null),
    clearSnapshotVault: vi.fn(async () => snapshotStore.clear()),
    getStoredActiveSnapshotId: getStoredActiveSnapshotIdMock,
    storeActiveSnapshotId: storeActiveSnapshotIdMock
  };
});

vi.mock('../components/Emulator', () => {
  const mock = forwardRef((_, ref) => {
    const instance = useMemo(
      () => ({
        runCommand: vi.fn(),
        runSerialCommand: vi.fn(),
        runKeyboardCommand: vi.fn(),
        serial0_send: vi.fn(),
        keyboardType: vi.fn(),
        saveState: vi.fn(async () => new ArrayBuffer(4))
      }),
      []
    );

    useImperativeHandle(ref, () => instance, [instance]);

    return <div data-testid="emulator-snapshot-mock">Mock Emulator</div>;
  });
  mock.displayName = 'UiSnapshotEmulatorMock';

  return {
    __esModule: true,
    default: mock
  };
});

describe('UI snapshot states', () => {
  beforeAll(() => {
    vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function toLocaleStringMock() {
      return originalToLocaleString.call(this, 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
      });
    });
  });

  afterAll(() => {
    (Date.prototype.toLocaleString as unknown as vi.Mock).mockRestore();
  });

  beforeEach(() => {
    snapshotStore.clear();
    listSnapshotsMock.mockClear();
    storeSnapshotMock.mockClear();
    loadSnapshotDataMock.mockClear();
    ensureVaultMigratedMock.mockClear();
    getStoredActiveSnapshotIdMock.mockClear();
    storeActiveSnapshotIdMock.mockClear();
    server.resetHandlers();
    server.use(
      http.head('/images/dsl_disk.img', () => HttpResponse.text('', { headers: { 'Content-Length': '1024' } })),
      http.head('/images/dsl-2024.rc7.iso', () => HttpResponse.text('', { headers: { 'Content-Length': '2048' } }))
    );
  });

  it('matches snapshot for empty vault', async () => {
    const { asFragment } = render(<App />);
    await screen.findByText(/No Âme stored yet/i);
    expect(asFragment()).toMatchSnapshot('empty-vault');
  });

  it('matches snapshot during import in progress', async () => {
    const pending = new Promise(() => undefined);
    storeSnapshotMock.mockImplementationOnce(() => pending);
    const { asFragment } = render(<App />);
    await screen.findByText(/No Âme stored yet/i);

    const input = screen.getByTestId('snapshot-file-input');
    const file = new File([new Uint8Array([1, 2])], 'pending.bin', { type: 'application/octet-stream' });
    await userEvent.upload(input, file);

    const importingLabels = await screen.findAllByText(/Importing/i);
    expect(importingLabels.length).toBeGreaterThan(0);
    expect(asFragment()).toMatchSnapshot('importing');
  });

  it('matches snapshot with stored snapshot ready', async () => {
    const buffer = new ArrayBuffer(4);
    const savedAt = Date.UTC(2024, 0, 1, 12, 0, 0);
    const metadata = { id: 'stored', name: 'stored.bin', size: 4, savedAt, profileId: 'dsl-2024' };
    snapshotStore.set('stored', { metadata, buffer });
    getStoredActiveSnapshotIdMock.mockReturnValue('stored');
    loadSnapshotDataMock.mockImplementation(async () => buffer);

    const { asFragment } = render(<App />);
    await screen.findByText('stored.bin');
    expect(asFragment()).toMatchSnapshot('stored-ready');
  });
});
