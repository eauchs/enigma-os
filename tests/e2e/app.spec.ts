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

  await page.setInputFiles('input[type="file"]', {
    name: 'import.bin',
    mimeType: 'application/octet-stream',
    buffer: createMockBinary(5, 6, 7)
  });

  await expect(page.getByText('import.bin')).toBeVisible();

  await page.getByRole('button', { name: /Capture from VM/i }).click();
  await expect(page.getByRole('button', { name: /Captured-/i })).toBeVisible();

  const snapshotItem = page.locator('li', { hasText: 'import.bin' });
  await snapshotItem.getByRole('button', { name: 'Rename' }).click();
  await snapshotItem.locator('input').fill('renamed.bin');
  await snapshotItem.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('renamed.bin')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await snapshotItem.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('renamed');

  await expect(page.getByText(/Âme captured/i)).toBeVisible();
});
