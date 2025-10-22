import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import App from '../App';
import type { SnapshotMetadata } from '../services/snapshotVault';

const snapshotStore: Map<string, { metadata: SnapshotMetadata; buffer: ArrayBuffer }> = new Map();

let listSnapshotsMock: ReturnType<typeof vi.fn>;
let storeSnapshotMock: ReturnType<typeof vi.fn>;
let loadSnapshotDataMock: ReturnType<typeof vi.fn>;
let ensureVaultMigratedMock: ReturnType<typeof vi.fn>;
let getStoredActiveSnapshotIdMock: ReturnType<typeof vi.fn>;
let storeActiveSnapshotIdMock: ReturnType<typeof vi.fn>;

vi.mock('../services/snapshotVault', async () => {
  listSnapshotsMock = vi.fn(async () => Array.from(snapshotStore.values()).map((entry) => entry.metadata));
  storeSnapshotMock = vi.fn(async ({ buffer, name, profileId }) => {
    const id = `${Date.now()}`;
    const metadata = { id, name, size: buffer.byteLength, savedAt: Date.now(), profileId };
    snapshotStore.set(id, { metadata, buffer });
    return metadata;
  });
  loadSnapshotDataMock = vi.fn(async (id: string) => snapshotStore.get(id)?.buffer ?? null);
  ensureVaultMigratedMock = vi.fn(async () => undefined);
  getStoredActiveSnapshotIdMock = vi.fn(() => null);
  storeActiveSnapshotIdMock = vi.fn(() => undefined);

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

vi.mock('../components/Emulator', () => ({
  default: vi.fn().mockImplementation(() => <div data-testid="emulator-snapshot-mock">Mock Emulator</div>)
}));

describe('UI snapshot states', () => {
  beforeEach(() => {
    snapshotStore.clear();
    listSnapshotsMock.mockClear();
    storeSnapshotMock.mockClear();
    loadSnapshotDataMock.mockClear();
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

    await screen.findByText(/Importing/i);
    expect(asFragment()).toMatchSnapshot('importing');
  });

  it('matches snapshot with stored snapshot ready', async () => {
    const buffer = new ArrayBuffer(4);
    const metadata = { id: 'stored', name: 'stored.bin', size: 4, savedAt: Date.now(), profileId: 'dsl-2024' };
    snapshotStore.set('stored', { metadata, buffer });
    loadSnapshotDataMock.mockImplementation(async () => buffer);

    const { asFragment } = render(<App />);
    const listItems = await screen.findAllByRole('listitem');
    const storedItem = listItems.find((item) => within(item).queryByText('stored.bin'));
    if (!storedItem) {
      throw new Error('Stored snapshot not rendered');
    }
    expect(asFragment()).toMatchSnapshot('stored-ready');
  });
});
