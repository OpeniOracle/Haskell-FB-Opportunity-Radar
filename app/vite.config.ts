/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
        THE ILLUSTRATIVE CORPUS IS NOT BUILT INTO PRODUCTION.

        `DataSourceContext` reaches the fixtures through a dynamic import
        guarded by `import.meta.env.DEV`, so the application never executes it
        in production — but Vite still emitted the real module as its own
        chunk, and a chunk in `dist/` is deployed whether or not anything asks
        for it. Aliasing it to a stub for `vite build` means the fabricated
        records are not in the output at all, which is the difference between
        "unreachable" and "absent".

        `vite dev` and the test run keep the real module, which is where it is
        genuinely useful. The harness build has its own config.
      */
      ...(command === 'build'
        ? { '@/data/fixtureDataSource': src('data/fixtureDataSource.production-stub.ts') }
        : {}),
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
}))
