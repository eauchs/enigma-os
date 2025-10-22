import { expect, test } from '@playwright/test';

const createMockBinary = (...values: number[]) => Buffer.from(values);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class MockV86Starter {
      listeners: Record<string, ((payload?: unknown) => void)[]> = {};
      constructor() {
        setTimeout(() => this.emit('emulator-ready'), 0);
      }
      add_listener(event: string, callback: (payload?: unknown) => void) {
        if (!this.listeners[event]) {
          this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
      }
      emit(event: string, payload?: unknown) {
        this.listeners[event]?.forEach((listener) => listener(payload));
      }
      serial0_send() {}
      keyboard_send_text() {}
      save_state() {
        return Promise.resolve(new ArrayBuffer(4));
      }
      destroy() {}
    }
    // @ts-expect-error V86 mock only needed for tests
    window.V86Starter = MockV86Starter;
  });

  await page.route('**/images/**', async (route) => {
    if (route.request().method() === 'HEAD') {
      await route.fulfill({ status: 200, body: '' });
      return;
    }
    await route.fulfill({ status: 200, body: createMockBinary(1, 2, 3) });
  });

  await page.route('**/v86/**', async (route) => {
    await route.fulfill({ status: 200, body: '' });
  });
});

test('happy path flow through the web host', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Enigma Shell')).toBeVisible();
  await expect(page.getByText('No Âme stored yet', { exact: false })).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__enigmaTestHarness));

  await page.setInputFiles('input[type="file"]', {
    name: 'import.bin',
    mimeType: 'application/octet-stream',
    buffer: createMockBinary(5, 6, 7)
  });

  await expect(page.getByRole('button', { name: /^import\.bin/i })).toBeVisible();
  const importSnapshotHandle = await page.waitForFunction(() => {
    const snapshots = window.__enigmaTestHarness?.listSnapshots() ?? [];
    const target = snapshots.find((snapshot) => snapshot.name === 'import.bin');
    return target?.id ?? null;
  });
  const importSnapshotId = await importSnapshotHandle.jsonValue<string>();

  await page.evaluate(() => window.__enigmaTestHarness?.captureMock());
  await expect(page.locator('.snapshot-vault__item').first()).toContainText(/Captured-/i);
  await page.evaluate((id) => window.__enigmaTestHarness?.renameMock(id as string, 'renamed.bin'), importSnapshotId);
  await expect(page.getByText('renamed.bin')).toBeVisible();

  const snapshotItem = page.locator('li', { hasText: 'renamed.bin' });
  const downloadPromise = page.waitForEvent('download');
  const exportButton = snapshotItem.getByRole('button', { name: 'Export' });
  await exportButton.evaluate((button) => (button as HTMLButtonElement).click());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('renamed');

  await expect(page.getByRole('heading', { name: 'Boot timeline' })).toBeVisible();
  const snapshotNames = await page.evaluate(() =>
    (window.__enigmaTestHarness?.listSnapshots() ?? []).map((snapshot) => snapshot.name)
  );
  expect(snapshotNames).toEqual(expect.arrayContaining(['renamed.bin']));
});
