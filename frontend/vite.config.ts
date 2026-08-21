import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // paint.js is shared with the repo's car_3d module; single source of truth.
    // It imports 'three' from outside this package, so pin that to our copy.
    alias: {
      '@car3d': fileURLToPath(new URL('../car_3d/viewer', import.meta.url)),
      three: fileURLToPath(new URL('./node_modules/three', import.meta.url)),
    },
  },
  server: {
    fs: { allow: [repoRoot] },
    proxy: { '/api': 'http://localhost:8000' },
  },
})
