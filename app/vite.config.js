import { defineConfig } from 'vite';

export default defineConfig({
  define: { __BUILD__: JSON.stringify(String(Date.now())) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  server: { host: true },
});
