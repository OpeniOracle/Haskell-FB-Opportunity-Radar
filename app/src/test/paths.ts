import { resolve } from 'node:path'

/**
 * Package root for tests that read source files off disk.
 *
 * `import.meta.url` is not a `file:` URL under the jsdom environment, so
 * `fileURLToPath` cannot be used here. Vitest runs with the package directory as
 * cwd, which is stable in CI and locally alike.
 */
export const APP_ROOT = process.cwd()

export const fromRoot = (relativePath: string) => resolve(APP_ROOT, relativePath)
