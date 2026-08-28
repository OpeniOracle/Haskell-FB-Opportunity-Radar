/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    /*
      ORDERED, AND THE SPECIFIC ENTRY FIRST.

      This was an object, and the `'@'` prefix entry shadowed the specific one:
      `@/data/fixtureDataSource` matched `'@'` first and resolved to the real
      module, so the alias below never fired. The production build looked clean
      only because tree-shaking removed a dynamic import behind a false
      `import.meta.env.DEV` -- and the moment a build ran with NODE_ENV=test,
      DEV inlined as true, the import survived, and the entire illustrative
      corpus was emitted into dist/ as its own chunk.

      Vite evaluates the ARRAY form in order and `find` is matched exactly, so
      the fixture module is replaced before the `@` prefix rule is reached. The
      guarantee no longer depends on a tree-shaker's judgement.
    */
    alias: [
      ...(command === 'build'
        ? [
            {
              find: /^@\/data\/fixtureDataSource$/,
              replacement: src('data/fixtureDataSource.production-stub.ts'),
            },
          ]
        : []),
      { find: /^@\//, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/` },
    ],
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
