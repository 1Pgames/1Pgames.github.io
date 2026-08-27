import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    // Single self-contained bundle keeps screen-recording setups trivial.
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 2048,
  },
});
