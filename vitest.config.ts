import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/index.tsx',
        'src/index.css',
        'src/llmService.ts',
        'src/types/**',
        'src/config/**',
        'src/services/legacy/**',
        'src/**/__tests__/**',
        'src/setupTests.ts'
      ],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85
      }
    }
  }
});
