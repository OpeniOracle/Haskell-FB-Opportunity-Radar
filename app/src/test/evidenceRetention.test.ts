import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import { accessModeLabel, savedCopyStatement } from '@/lib/format'

/**
 * THE INTERFACE NEVER CLAIMS A SAVED COPY IT CANNOT SEE.
 *
 * `access_mode` is a retention permission. `archived_full_text` means a source
 * MAY be kept in full -- U.S. government material under ADR 0014 -- and says
 * nothing about whether a saved copy exists. That is `archive_uri`, and the
 * browser cannot read it: migration 0015 withholds `archive_uri`, `body_text`,
 * `raw_storage_uri` and `extracted_text_uri` from the `authenticated` grant, and
 * nothing in this change loosens that.
 *
 * The label used to read "Saved copy of the full article". When the pipeline
 * began recording SEC filings with the registry's own mode, that sentence would
 * have appeared on every new filing -- while no archive object existed for any
 * of them, and the evidence proxy had nothing to serve.
 */

const FUNCTIONS = join(APP_ROOT, 'netlify', 'functions')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('no server path writes an archive object yet', () => {
  /*
     The wording below states that no saved copy can be opened. That is true
     because NOTHING WRITES ONE: no function sets archive_uri, raw_storage_uri
     or extracted_text_uri, and none uploads to Storage. The day a change adds
     archiving (audit PR 11), this test fails -- and that change must also give
     the interface a server-verified signal before any surface may say a copy
     exists.
  */
  const sources = walk(FUNCTIONS).map((path) => ({
    path: path.slice(FUNCTIONS.length),
    text: readFileSync(path, 'utf8'),
  }))

  it('finds the functions to check', () => {
    expect(sources.some((s) => s.path.endsWith('pipeline.ts'))).toBe(true)
    expect(sources.some((s) => s.path.endsWith('evidence.ts'))).toBe(true)
  })

  it.each(['archive_uri', 'raw_storage_uri', 'extracted_text_uri'])('never writes %s', (column) => {
    // An object key or an assignment: `archive_uri: x`, `archive_uri = x`.
    // Reading the column (the evidence proxy selects raw_storage_uri) is fine.
    const writes = new RegExp(`\\b${column}\\s*[:=](?!=)`)
    expect(sources.filter((s) => writes.test(s.text)).map((s) => s.path)).toEqual([])
  })

  it('never uploads to Storage', () => {
    const uploads = /\.storage\s*\.\s*from\([^)]*\)\s*\.\s*(upload|update|copy|move)\s*\(/
    expect(sources.filter((s) => uploads.test(s.text)).map((s) => s.path)).toEqual([])
  })
})

describe('the access-mode wording describes permission, not possession', () => {
  it('claims no saved, archived or licensed COPY in any label', () => {
    for (const [mode, label] of Object.entries(accessModeLabel)) {
      expect(label, mode).not.toMatch(/\b(saved|archived|licensed) copy\b/i)
      expect(label, mode).not.toMatch(/copy of the full/i)
    }
  })

  it('says "may be kept" for the modes that permit retention', () => {
    expect(accessModeLabel.archived_full_text).toMatch(/may be kept/)
    expect(accessModeLabel.licensed_full_text).toMatch(/may be kept/)
  })

  it.each([
    'structured_primary',
    'archived_full_text',
    'licensed_full_text',
    'reference_only',
    'metadata_only',
    'something_new',
  ])('%s: the saved-copy statement never says a copy can be opened', (mode) => {
    const statement = savedCopyStatement(mode)
    expect(statement).toMatch(/^(No saved copy is available to open\.|None\.)/)
  })

  it('says where retained text lives, and that it is not shown, for body-bearing modes', () => {
    for (const mode of ['structured_primary', 'archived_full_text', 'licensed_full_text']) {
      expect(savedCopyStatement(mode), mode).toMatch(/holds the extracted text in its database/)
      expect(savedCopyStatement(mode), mode).toMatch(/not shown here/)
    }
  })

  it('appears nowhere in the interface as the old claim', () => {
    const SRC = join(APP_ROOT, 'src')
    const offenders = walkAll(SRC)
      .filter((p) => !p.includes(`${join('src', 'test')}`))
      .filter((p) => /saved copy of the full article/i.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })
})

function walkAll(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walkAll(path) : /\.(ts|tsx)$/.test(path) ? [path] : []
  })
}
