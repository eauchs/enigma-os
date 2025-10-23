import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/renderer-preview',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html')
    }
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  }
});
