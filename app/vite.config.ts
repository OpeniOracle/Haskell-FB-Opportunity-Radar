/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // A tripwire, not a budget: it exists so a heavyweight dependency creeping
    // in is noticed in review rather than discovered later. It has been raised
    // once, deliberately — the authentication gate imports `@supabase/supabase-js`
    // on every page load, which is unavoidable for an application whose first
    // action is to establish a session, and which the tree-shaker previously
    // removed only because nothing imported it. Raise it again only for a
    // dependency someone has argued for.
    chunkSizeWarningLimit: 600,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
