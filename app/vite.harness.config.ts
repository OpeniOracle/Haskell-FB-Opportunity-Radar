import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * The browser-layout harness build. Separate from `vite.config.ts` ON PURPOSE.
 *
 * The harness imports `src/test/authFake.ts`, an authentication port that
 * answers yes. Building it alongside the application would put that port in a
 * shipped chunk. Keeping it in its own config, its own entry and its own
 * gitignored output directory means `npm run build` cannot reach it, and the
 * boundary suite asserts exactly that.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist-harness',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: fileURLToPath(new URL('./src/test/browser/harness.html', import.meta.url)) },
  },
})
