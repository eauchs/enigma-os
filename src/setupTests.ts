import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import { Blob as NodeBlob } from 'node:buffer';

class TestFile extends NodeBlob {
  readonly name: string;
  readonly lastModified: number;
  readonly webkitRelativePath = '';

  constructor(fileBits: BlobPart[], fileName: string, options: FilePropertyBag = {}) {
    super(fileBits, options);
    this.name = fileName;
    this.lastModified = options.lastModified ?? Date.now();
  }
}

if (typeof globalThis.Blob === 'undefined' ||
  typeof globalThis.Blob.prototype.arrayBuffer !== 'function') {
  // @ts-expect-error - polyfill for tests
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
}

if (typeof globalThis.File === 'undefined' ||
  typeof globalThis.File.prototype.arrayBuffer !== 'function') {
  // @ts-expect-error - polyfill for tests
  globalThis.File = TestFile as unknown as typeof File;
}

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
