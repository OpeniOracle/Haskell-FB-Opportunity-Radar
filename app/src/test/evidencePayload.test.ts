import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import {
  PUBLISHED_BASIS_VALUES,
  PUBLISHED_PRECISION_VALUES,
  describeDbError,
  normalizePublished,
  publishedPrecisionForColumn,
  upsertEvidence,
} from '../../netlify/functions/_shared/connectors/pipeline'
import type {
  DiscoveredDocument,
  RetrievedDocument,
} from '../../netlify/functions/_shared/connectors/types'

/**
 * The evidence insert, checked against the constraints that actually guard it.
 *
 * WHAT HAPPENED. The first live SEC backfill discovered 39 filings, fetched all
 * 39, and stored none. Every insert was refused with PostgreSQL `23514` — a
 * check-constraint violation — and the run recorded nothing but that code.
 *
 * Two columns were wrong, and both on every row:
 *
 *   published_precision  the connector said 'minute'; the column admits
 *                        exact_day | month | quarter | season | half_year |
 *                        year | range | relative | unknown, and has no sub-day
 *                        member at all
 *   published_basis      the pipeline wrote 'source_declared'; the column
 *                        admits stated | inferred | unknown
 *
 * Nothing mapped the connector's vocabulary onto the schema's. Both sets are
 * reasonable and they were never the same set.
 *
 * SO THE VOCABULARIES ARE READ OUT OF THE MIGRATION rather than restated here.
 * A test that hard-codes the allowed values can drift from the database exactly
 * the way the pipeline did, and would then agree with the bug.
 */

const ROOT = join(APP_ROOT, '..')
const migration0004 = readFileSync(
  join(ROOT, 'db/migrations/0004_evidence_temporal_access_confidence.up.sql'),
  'utf8',
)
const migration0021 = readFileSync(
  join(ROOT, 'db/migrations/0021_live_source_ingestion.up.sql'),
  'utf8',
)
const baseline = readFileSync(join(ROOT, 'schemas/database.sql'), 'utf8')

/** The members of one `check (... in ('a', 'b'))` list, straight from the SQL. */
function allowedValues(sql: string, constraintOrColumn: string): string[] {
  const at = sql.indexOf(constraintOrColumn)
  expect(at, `${constraintOrColumn} not found in the SQL`).toBeGreaterThan(-1)
  const window = sql.slice(at, at + 600)
  const list = /\bin\s*\(([\s\S]*?)\)/.exec(window)
  expect(list, `no IN list after ${constraintOrColumn}`).not.toBeNull()
  return [...list![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

const ALLOWED = {
  published_precision: allowedValues(migration0004, 'evidence_published_precision_check'),
  published_basis: allowedValues(migration0004, 'evidence_published_basis_check'),
  access_mode: allowedValues(migration0004, 'evidence_access_mode_check'),
  data_sensitivity_class: allowedValues(migration0004, 'evidence_sensitivity_check'),
  classification_status: allowedValues(migration0021, 'evidence_classification_status_check'),
  review_status: allowedValues(migration0021, 'evidence_review_status_check'),
  extraction_status: allowedValues(baseline, 'extraction_status text not null check'),
}

/* ------------------------------------------------ a representative filing */

/**
 * A Tyson Foods 8-K as EDGAR's submissions API actually describes one:
 * an accession number, an acceptance instant to the MINUTE, and an archive URL.
 * This is the exact shape that produced 39 rejections.
 */
const SEC_DOCUMENT: DiscoveredDocument = {
  sourceDocumentId: '0000100493-26-000010',
  url: 'https://www.sec.gov/Archives/edgar/data/100493/000010049326000010/tsn-20260304.htm',
  canonicalUrl:
    'https://www.sec.gov/Archives/edgar/data/100493/000010049326000010/0000100493-26-000010-index.htm',
  title: '8-K — Tyson Foods, Inc. — Results of Operations',
  publishedAt: '2026-03-04T16:31:00.000Z',
  publishedPrecision: 'minute',
  documentType: '8-K',
  organizationEntityKey: 'sec:0000100493',
  discoveryPath: 'sec:submissions-api',
  metadata: {
    cik: '0000100493',
    accessionNumber: '0000100493-26-000010',
    filingDate: '2026-03-04',
    acceptanceDateTime: '2026-03-04T16:31:00.000Z',
  },
}

const SEC_RETRIEVED: RetrievedDocument = {
  document: SEC_DOCUMENT,
  finalUrl: SEC_DOCUMENT.url,
  status: 200,
  bytes: new TextEncoder().encode('<html><body>Tyson Foods announced…</body></html>'),
  contentHash: 'a'.repeat(64),
  mimeType: 'text/html',
  retrievedAt: '2026-03-05T06:00:00.000Z',
  etag: 'W/"abc"',
  lastModified: 'Wed, 04 Mar 2026 16:31:00 GMT',
  unchanged: false,
  extractedText: 'Tyson Foods announced a new processing plant in Bowling Green, Kentucky.',
  extractionStatus: 'success',
}

/** Records the row the pipeline would insert, without a database. */
function recordingClient() {
  let inserted: Record<string, unknown> | null = null
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    is: () => api,
    insert: (row: Record<string, unknown>) => {
      inserted = row
      return api
    },
    update: () => api,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: { id: 'evidence-1' }, error: null }),
    then: (resolve: (r: unknown) => unknown) => resolve({ data: null, error: null }),
  }
  return { client: { from: () => api } as never, row: () => inserted }
}

async function secEvidenceRow(): Promise<Record<string, unknown>> {
  const { client, row } = recordingClient()
  await upsertEvidence(client, {
    sourceId: 'sec-edgar',
    sourceRunId: 'e31b56a7-1079-4bcf-b94e-89c7862e401f',
    connectorId: 'sec-edgar',
    connectorVersion: '1.0.0',
    document: SEC_DOCUMENT,
    retrieved: SEC_RETRIEVED,
    excerpt: 'Tyson Foods announced a new processing plant',
    classificationStatus: 'candidate_signal',
    accessMode: 'structured_primary',
    now: '2026-03-05T06:00:00.000Z',
  })
  const inserted = row()
  expect(inserted, 'no row was built').not.toBeNull()
  return inserted!
}

// ---------------------------------------------------------------------------

describe('the SEC evidence payload satisfies every evidence check constraint', () => {
  it('the regression case itself: a minute-precision filing is accepted', async () => {
    const row = await secEvidenceRow()
    // The two columns that refused all 39 documents.
    expect(row.published_precision).toBe('exact_day')
    expect(row.published_basis).toBe('stated')
    expect(ALLOWED.published_precision).toContain(row.published_precision)
    expect(ALLOWED.published_basis).toContain(row.published_basis)
  })

  for (const column of Object.keys(ALLOWED) as (keyof typeof ALLOWED)[]) {
    it(`${column} is a member of its constraint's vocabulary`, async () => {
      const row = await secEvidenceRow()
      const value = row[column]
      if (value === null || value === undefined) return // every one is nullable except those with defaults
      expect(
        ALLOWED[column],
        `${column} = ${String(value)} is not in (${ALLOWED[column].join(', ')})`,
      ).toContain(value)
    })
  }

  it('keeps the minute the source actually stated', async () => {
    const row = await secEvidenceRow()
    // Mapping the LABEL to exact_day loses nothing: the instant is in
    // published_at, and the source's own word is kept in the locator.
    expect(row.published_at).toBe('2026-03-04T16:31:00.000Z')
    expect(row.evidence_locator).toMatchObject({ publishedPrecisionObserved: 'minute' })
  })

  it('preserves source-document identity and the deduplication key', async () => {
    const row = await secEvidenceRow()
    expect(row.source_document_id).toBe('0000100493-26-000010')
    expect(row.source_id).toBe('sec-edgar')
    expect(row.content_hash).toBe('a'.repeat(64))
    expect(row.canonical_url).toBe(SEC_DOCUMENT.canonicalUrl)
    // `evidence_current_document_uidx` is (source_id, source_document_id); the
    // fix must not have touched either half of it.
    expect(row.connector_id).toBe('sec-edgar')
    expect(row.connector_version).toBe('1.0.0')
  })

  it('does not carry a body or archive URI against structured_primary', async () => {
    const row = await secEvidenceRow()
    expect(row.access_mode).toBe('structured_primary')
    // The reference_only / metadata_only constraints do not apply here, but a
    // change of access_mode without a change of payload would trip them.
    expect(row.body_text ?? null).toBeNull()
    expect(row.archive_uri ?? null).toBeNull()
  })

  it('sets no temporal_* column, so their paired constraints cannot fire', async () => {
    const row = await secEvidenceRow()
    // `evidence_inference_requires_note` and the temporal precision/basis pair
    // only bite when a temporal date is written. The pipeline writes none.
    for (const key of ['temporal_basis', 'temporal_precision', 'temporal_inference_note']) {
      expect(row[key] ?? null, `${key} must be left alone`).toBeNull()
    }
  })
})

describe('mapping a connector precision onto the column vocabulary', () => {
  const CASES: [string | null, string | null][] = [
    ['minute', 'exact_day'],
    ['hour', 'exact_day'],
    ['day', 'exact_day'],
    ['month', 'month'],
    ['quarter', 'quarter'],
    ['year', 'year'],
    [null, null],
  ]

  for (const [input, expected] of CASES) {
    it(`${input ?? 'null'} becomes ${expected ?? 'null'}`, () => {
      expect(publishedPrecisionForColumn(input)).toBe(expected)
    })
  }

  it('every mapped value is one the constraint admits', () => {
    for (const [input] of CASES) {
      const mapped = publishedPrecisionForColumn(input)
      if (mapped === null) continue
      expect(ALLOWED.published_precision).toContain(mapped)
    }
  })

  /*
     A NEW CONNECTOR WORD MUST NOT BE ABLE TO FAIL AN ENTIRE RUN.

     That is the shape of this incident: one unrecognised value, written
     straight through, refused 39 of 39 documents. An unknown precision now
     becomes `unknown`, which the column admits, and the source's own word is
     still recorded in the locator.
  */
  it('an unrecognised precision becomes "unknown" rather than being written through', () => {
    expect(publishedPrecisionForColumn('fortnight')).toBe('unknown')
    expect(ALLOWED.published_precision).toContain('unknown')
  })

  it('the exported vocabularies match the migration exactly', () => {
    expect([...PUBLISHED_PRECISION_VALUES].sort()).toEqual([...ALLOWED.published_precision].sort())
    expect([...PUBLISHED_BASIS_VALUES].sort()).toEqual([...ALLOWED.published_basis].sort())
  })

  it('a source that stated no date records basis "unknown", not prose', () => {
    const none = normalizePublished({ ...SEC_DOCUMENT, publishedAt: null, publishedPrecision: null })
    expect(none.publishedAt).toBeNull()
    expect(none.precision).toBeNull()
    expect(none.basis).toBe('unknown')
    expect(ALLOWED.published_basis).toContain(none.basis)
  })

  it('a stated date records basis "stated"', () => {
    expect(normalizePublished(SEC_DOCUMENT).basis).toBe('stated')
  })
})

describe('a database refusal says which constraint refused it', () => {
  /*
     39 documents were rejected with the word "23514" and nothing else, because
     every write reported `error.code ?? error.message` and PostgREST always
     supplies a code -- so the message, the half that names the constraint,
     was never reached.
  */
  it('names the constraint, not just the SQLSTATE', () => {
    const described = describeDbError({
      code: '23514',
      message:
        'new row for relation "evidence" violates check constraint "evidence_published_precision_check"',
    })
    expect(described).toContain('23514')
    expect(described).toContain('evidence_published_precision_check')
    expect(described).toContain('constraint evidence_published_precision_check')
  })

  it('never includes the failing row', () => {
    // PostgreSQL puts the whole row in `details`. For evidence that means
    // titles, URLs and an excerpt, and this string reaches a terminal, a run
    // record and a log.
    const described = describeDbError({
      code: '23514',
      message: 'violates check constraint "evidence_published_basis_check"',
      // @ts-expect-error deliberately passing a field the helper must ignore
      details: 'Failing row contains (abc, sec-edgar, SECRET TITLE, https://…).',
    })
    expect(described).not.toContain('Failing row')
    expect(described).not.toContain('SECRET TITLE')
  })

  it('survives an error carrying nothing useful', () => {
    expect(describeDbError({})).toBe('unknown database error')
    expect(describeDbError({ code: '23514' })).toContain('23514')
    expect(describeDbError({ message: 'boom' })).toContain('boom')
  })

  it('bounds what it repeats', () => {
    const long = describeDbError({ code: '23514', message: 'x'.repeat(5000) })
    expect(long.length).toBeLessThan(700)
  })

  it('carries a hint when the database supplies one', () => {
    expect(describeDbError({ code: '23514', hint: 'try harder' })).toContain('try harder')
  })
})
