import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7000',
      '/encrypt': 'http://localhost:7000',
      // Vite proxy uses string prefix matching — it cannot proxy /:token/* dynamically.
      // Token-based routes (/manifest.json, /catalog, /stream) are handled via
      // the import.meta.env.DEV workaround in useManifestPoll.ts (see below).
    }
  },
  build: {
    outDir: 'dist',
  }
})
