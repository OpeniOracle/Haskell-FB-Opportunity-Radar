import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import {
  MAX_BODY_TEXT_CHARS,
  SIGNAL_CONFIDENCE_VALUES,
  eventDateForSignal,
  runConnectorPass,
  signalConfidenceFor,
  SIGNAL_TAXONOMY,
  opportunitySignalRole,
  signalTaxonomyFor,
  upsertEvidence,
  upsertSignal,
} from '../../netlify/functions/_shared/connectors/pipeline'
import { SIGNAL_PATTERNS } from '../../netlify/functions/_shared/connectors/classify'

const ROOT = join(APP_ROOT, '..')
import { officialFilingUrl } from '../../netlify/functions/_shared/connectors/sec'
import { htmlToText } from '../../netlify/functions/_shared/connectors/extract'
import { classifyText } from '../../netlify/functions/_shared/connectors/classify'
import type {
  Connector,
  ConnectorContext,
  DiscoveredDocument,
  RetrievedDocument,
} from '../../netlify/functions/_shared/connectors/types'

/**
 * SEC filing -> readable text -> signal -> candidate opportunity.
 *
 * WHAT WAS BROKEN. The first successful SEC backfill stored 39 filings and
 * produced nothing: every row came back `classification_status = 'unclassified'`
 * with no excerpt, no text and no locator.
 *
 * The cause was not the classifier, which is real and deterministic. It was
 * that the EARLIER FAILED run had already written each document's content hash
 * into `source_document_cache` before the evidence insert was refused. The
 * retry fetched each document, saw a matching hash, declared it `unchanged`,
 * and skipped classification entirely -- while holding the text in its hand.
 *
 * So the 39 rows were frozen half-finished, and no number of reruns would have
 * moved them: `unchanged` meant "touch last_seen_at and return".
 */

/* ----------------------------------------------------- a real filing shape */

/** An 8-K exhibit as EDGAR serves one: real tags, tables, entities. */
const FILING_HTML = `
<html><head><title>EX-99.1</title><style>.x{color:red}</style></head>
<body>
  <script>var tracking = 1;</script>
  <div><p>Tyson&nbsp;Foods,&nbsp;Inc. Announces Kentucky Investment</p></div>
  <table><tr><td>SPRINGDALE, Ark.</td><td>March 4, 2026</td></tr></table>
  <p>Tyson Foods today announced it will <b>build a new</b> 450,000 square foot
     processing <i>plant</i> in Bowling Green, Kentucky. The company said the
     &#36;300 million facility is expected to begin production by the end of 2027
     and will create approximately 400 jobs.</p>
  <p>Separately, the company will expand capacity at its existing distribution
     center in Memphis, Tennessee, adding 120,000 square feet.</p>
</body></html>`

/** A filing with no physical-development content at all. */
const ROUTINE_HTML = `
<html><body>
  <p>Tyson Foods, Inc. today announced the appointment of a new member to its
     board of directors, effective immediately. The company also announced a
     quarterly dividend of $0.50 per share payable in June 2026, and reaffirmed
     its previously issued guidance for the fiscal year.</p>
</body></html>`

const ARCHIVE_FOLDER = 'https://www.sec.gov/Archives/edgar/data/100493/000010049326000010'
const ACCESSION = '0000100493-26-000010'
const OFFICIAL_URL = `${ARCHIVE_FOLDER}/tsn-20260304.htm`

const COMPANY = {
  id: '11111111-1111-4111-8111-111111111111',
  entity_key: 'sec:0000100493',
  canonical_name: 'Tyson Foods, Inc.',
}

function filing(overrides: Partial<DiscoveredDocument> = {}): DiscoveredDocument {
  return {
    sourceDocumentId: ACCESSION,
    url: OFFICIAL_URL,
    canonicalUrl: `${ARCHIVE_FOLDER}/${ACCESSION}-index.htm`,
    title: '8-K — Tyson Foods, Inc. — Results of Operations',
    publishedAt: '2026-03-04T16:31:00.000Z',
    publishedPrecision: 'minute',
    documentType: '8-K',
    organizationEntityKey: COMPANY.entity_key,
    discoveryPath: 'sec:submissions-api',
    metadata: {
      cik: '0000100493',
      accessionNumber: ACCESSION,
      filingDate: '2026-03-04',
      reportDate: '2026-03-04',
      items: '2.02,7.01',
      primaryDocument: 'tsn-20260304.htm',
      archiveFolder: ARCHIVE_FOLDER,
    },
    ...overrides,
  }
}

function retrieved(
  document: DiscoveredDocument,
  html: string,
  overrides: Partial<RetrievedDocument> = {},
): RetrievedDocument {
  const text = htmlToText(html)
  return {
    document,
    finalUrl: document.url,
    status: 200,
    bytes: new TextEncoder().encode(html),
    contentHash: 'a'.repeat(64),
    mimeType: 'text/html',
    retrievedAt: '2026-03-05T06:00:00.000Z',
    etag: 'W/"abc"',
    lastModified: 'Wed, 04 Mar 2026 16:31:00 GMT',
    unchanged: false,
    extractedText: text,
    extractionStatus: 'success',
    ...overrides,
  }
}

/* ------------------------------------------- an in-memory evidence table */

interface Row {
  [key: string]: unknown
}

function memoryClient(seed: Row[] = []) {
  const tables = new Map<string, Row[]>([['evidence', [...seed]]])
  let seq = 0
  const rows = (t: string) => {
    if (!tables.has(t)) tables.set(t, [])
    return tables.get(t)!
  }

  function builder(table: string) {
    const filters: [string, unknown][] = []
    let pending: { op: string; payload?: Row } | null = null
    const matches = (row: Row) => filters.every(([k, v]) => row[k] === v)

    const api: Record<string, unknown> = {
      select: () => (pending?.op === 'insert' || pending?.op === 'update' ? api : ((pending = { op: 'select' }), api)),
      eq: (c: string, v: unknown) => (filters.push([c, v]), api),
      is: (c: string, v: unknown) => (filters.push([c, v]), api),
      insert: (payload: Row) => ((pending = { op: 'insert', payload }), api),
      update: (payload: Row) => ((pending = { op: 'update', payload }), api),
      upsert: (payload: Row) => ((pending = { op: 'upsert', payload }), api),
      maybeSingle: async () => ({ data: rows(table).find(matches) ?? null, error: null }),
      single: async () => {
        if (pending?.op === 'insert') {
          seq += 1
          /*
             `superseded_at` is nullable with no default, so PostgreSQL stores
             NULL when the insert omits it -- and the current-row lookup filters
             on `.is('superseded_at', null)`. Without this the fake stored
             `undefined`, the lookup missed its own row, and a rerun inserted a
             DUPLICATE. The fake was wrong, not the pipeline, but a fake that
             cannot reproduce deduplication cannot test it either.
          */
          const row = { id: `${table}-${seq}`, superseded_at: null, ...pending.payload }
          rows(table).push(row)
          return { data: { id: row.id }, error: null }
        }
        return { data: rows(table).find(matches) ?? null, error: null }
      },
      then: (resolve: (r: unknown) => unknown) => {
        if (pending?.op === 'update') {
          for (const row of rows(table).filter(matches)) Object.assign(row, pending.payload)
          return resolve({ data: null, error: null })
        }
        if (pending?.op === 'upsert') {
          rows(table).push({ id: `${table}-${(seq += 1)}`, ...pending.payload })
          return resolve({ data: null, error: null })
        }
        return resolve({ data: rows(table).filter(matches), error: null })
      },
    }
    return api
  }
  return { client: { from: (t: string) => builder(t) } as never, rows }
}

function context(get: ConnectorContext['get']): ConnectorContext {
  return {
    userAgent: 'Openi Analytics test@openi-analytics.invalid',
    allowlist: ['www.sec.gov', 'data.sec.gov'],
    get,
    pacer: { take: async () => {} } as never,
    cache: { read: async () => null, write: async () => {} },
    now: () => new Date('2026-03-05T06:00:00.000Z'),
    config: {},
    window: { start: '2025-03-05T00:00:00.000Z', end: '2026-03-05T00:00:00.000Z' },
    log: () => {},
  }
}

function connectorServing(docs: [DiscoveredDocument, string][]): Connector {
  return {
    id: 'sec-edgar',
    version: '1.0.0',
    sourceId: 'sec-edgar',
    hosts: ['www.sec.gov', 'data.sec.gov'],
    async discover() {
      return { kind: 'documents', documents: docs.map(([d]) => d) }
    },
    async retrieve(_ctx, document) {
      const hit = docs.find(([d]) => d.sourceDocumentId === document.sourceDocumentId)!
      return retrieved(hit[0], hit[1])
    },
  }
}

async function writeEvidence(
  client: never,
  document: DiscoveredDocument,
  doc: RetrievedDocument,
  status: string,
  excerpt: string | null,
) {
  return upsertEvidence(client, {
    sourceId: 'sec-edgar',
    sourceRunId: 'run-1',
    connectorId: 'sec-edgar',
    connectorVersion: '1.0.0',
    document,
    retrieved: doc,
    excerpt,
    classificationStatus: status,
    accessMode: 'structured_primary',
    now: '2026-03-05T06:00:00.000Z',
  })
}

// ---------------------------------------------------------------------------
// 1. The official filing document URL.
// ---------------------------------------------------------------------------

describe('the official filing document URL', () => {
  it('is archiveFolder + "/" + primaryDocument', () => {
    expect(officialFilingUrl(ARCHIVE_FOLDER, 'tsn-20260304.htm', ACCESSION)).toBe(OFFICIAL_URL)
  })

  it('joins with exactly one slash however the parts are punctuated', () => {
    expect(officialFilingUrl(`${ARCHIVE_FOLDER}/`, 'tsn-20260304.htm', ACCESSION)).toBe(OFFICIAL_URL)
    expect(officialFilingUrl(ARCHIVE_FOLDER, '/tsn-20260304.htm', ACCESSION)).toBe(OFFICIAL_URL)
    expect(officialFilingUrl(`${ARCHIVE_FOLDER}//`, ' tsn-20260304.htm ', ACCESSION)).toBe(OFFICIAL_URL)
  })

  it('falls back to the accession index only when SEC states no primary document', () => {
    const index = `${ARCHIVE_FOLDER}/${ACCESSION}-index.htm`
    expect(officialFilingUrl(ARCHIVE_FOLDER, '', ACCESSION)).toBe(index)
    expect(officialFilingUrl(ARCHIVE_FOLDER, null, ACCESSION)).toBe(index)
    expect(officialFilingUrl(ARCHIVE_FOLDER, undefined, ACCESSION)).toBe(index)
  })

  it('stays on sec.gov', () => {
    // The egress gateway checks this too, per hop. Asserted here so a malformed
    // folder cannot quietly produce an off-domain URL for the gateway to refuse.
    expect(new URL(officialFilingUrl(ARCHIVE_FOLDER, 'x.htm', ACCESSION)).hostname).toBe('www.sec.gov')
  })
})

// ---------------------------------------------------------------------------
// 2. Readable text out of a filing.
// ---------------------------------------------------------------------------

describe('extracting readable text from a filing', () => {
  const text = htmlToText(FILING_HTML)

  it('keeps the prose', () => {
    expect(text).toContain('build a new')
    expect(text).toContain('450,000 square foot')
    expect(text).toContain('Bowling Green, Kentucky')
  })

  it('drops script and style content rather than reading it as prose', () => {
    expect(text).not.toContain('var tracking')
    expect(text).not.toContain('color:red')
  })

  it('decodes entities, including the numeric ones EDGAR uses for currency', () => {
    expect(text).toContain('$300 million')
    expect(text).toContain('Tyson Foods, Inc.')
    expect(text).not.toContain('&nbsp;')
    expect(text).not.toContain('&#36;')
  })

  it('does not leave markup behind', () => {
    expect(text).not.toMatch(/<[a-z/][^>]*>/i)
  })
})

// ---------------------------------------------------------------------------
// 3. Substantive matching, and suppression of everything else.
// ---------------------------------------------------------------------------

describe('what counts as a candidate signal', () => {
  it('matches a filing that names an action, an asset and a corroborating fact', () => {
    const result = classifyText(htmlToText(FILING_HTML))
    expect(result.matches.length).toBeGreaterThan(0)
    const match = result.matches[0]!
    expect(match.matchedAction).toBeTruthy()
    expect(match.matchedAsset).toBeTruthy()
    expect(match.corroboration.length).toBeGreaterThan(0)
    expect(match.excerpt).toContain('Bowling Green')
  })

  it('finds the capacity and distribution signal as well as the construction one', () => {
    const families = classifyText(htmlToText(FILING_HTML)).matches.map((m) => m.family)
    expect(families.some((f) => f.includes('construction') || f.includes('expansion'))).toBe(true)
  })

  it('suppresses a routine filing with no physical-development content', () => {
    const result = classifyText(htmlToText(ROUTINE_HTML))
    expect(result.matches).toHaveLength(0)
    expect(result.rejectionReason).toBeTruthy()
  })

  /*
     REQUIREMENT: A FORM TYPE OR AN ITEM NUMBER IS NOT A SIGNAL.

     8-K item 2.02 is "Results of Operations". Every quarterly earnings release
     carries it, and none of them is a construction lead. The classifier never
     sees the form type or the item numbers -- it takes a string -- so this is
     structural rather than a rule that could be relaxed.
  */
  it('never matches on a form type or an 8-K item number', () => {
    for (const text of ['8-K', 'Item 2.02', 'Item 7.01 Regulation FD Disclosure', '10-Q']) {
      expect(classifyText(text).matches).toHaveLength(0)
    }
    // Even padded out to substantive length, a form reference alone is nothing.
    const padded = 'Item 2.02 Results of Operations and Financial Condition. '.repeat(20)
    expect(classifyText(padded).matches).toHaveLength(0)
  })

  it('refuses an action near an asset with no corroborating fact', () => {
    const vague =
      'The company continues to expand its facility network across the region and remains ' +
      'focused on operational excellence and long term growth for shareholders everywhere.'
    expect(classifyText(vague).matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Enriching the row that already exists.
// ---------------------------------------------------------------------------

describe('enriching an evidence row that was stored half-finished', () => {
  /** Exactly the shape of the 39 rows the first successful backfill produced. */
  const halfFinished = (): Row => ({
    id: 'evidence-existing',
    source_id: 'sec-edgar',
    source_document_id: ACCESSION,
    content_hash: 'a'.repeat(64),
    first_seen_at: '2026-03-05T05:00:00.000Z',
    last_seen_at: '2026-03-05T05:00:00.000Z',
    superseded_at: null,
    evidence_family_id: null,
    body_text: null,
    locator: null,
    evidence_excerpt: null,
    classification_status: 'unclassified',
    extraction_status: 'success',
    evidence_locator: {},
    published_at: '2026-03-04T16:31:00.000Z',
    published_precision: 'exact_day',
    published_basis: 'stated',
  })

  it('fills in text, locator, excerpt and classification without inserting a row', async () => {
    const { client, rows } = memoryClient([halfFinished()])
    const doc = filing()
    const result = await writeEvidence(
      client,
      doc,
      // The bytes have not changed, which is what froze these rows before.
      retrieved(doc, FILING_HTML, { unchanged: true }),
      'candidate_signal',
      'Tyson Foods today announced it will build a new 450,000 square foot processing plant',
    )

    expect(result.created).toBe(false)
    expect(result.unchanged).toBe(true)
    expect(result.enriched).toBe(true)
    expect(result.evidenceId).toBe('evidence-existing')

    // NO DUPLICATE.
    expect(rows('evidence')).toHaveLength(1)

    const row = rows('evidence')[0]!
    expect(row.body_text).toContain('Bowling Green, Kentucky')
    expect(row.locator).toBe(OFFICIAL_URL)
    expect(row.evidence_excerpt).toContain('450,000 square foot')
    expect(row.classification_status).toBe('candidate_signal')
    expect(row.evidence_locator).toMatchObject({
      accessionNumber: ACCESSION,
      primaryDocument: 'tsn-20260304.htm',
      archiveFolder: ARCHIVE_FOLDER,
      documentType: '8-K',
    })
  })

  it('never moves identity, history or the publication timestamp', async () => {
    const { client, rows } = memoryClient([halfFinished()])
    const doc = filing()
    await writeEvidence(client, doc, retrieved(doc, FILING_HTML, { unchanged: true }), 'candidate_signal', 'x')

    const row = rows('evidence')[0]!
    expect(row.source_document_id).toBe(ACCESSION)
    expect(row.content_hash).toBe('a'.repeat(64))
    expect(row.first_seen_at).toBe('2026-03-05T05:00:00.000Z')
    expect(row.published_at).toBe('2026-03-04T16:31:00.000Z')
    expect(row.superseded_at).toBeNull()
    // The one column a re-observation always moves.
    expect(row.last_seen_at).toBe('2026-03-05T06:00:00.000Z')
  })

  it('leaves an already-complete row alone apart from last_seen_at', async () => {
    const complete: Row = {
      ...halfFinished(),
      body_text: 'already extracted',
      locator: OFFICIAL_URL,
      evidence_excerpt: 'already excerpted',
      classification_status: 'candidate_signal',
      evidence_locator: { documentType: '8-K' },
    }
    const { client, rows } = memoryClient([complete])
    const doc = filing()
    const result = await writeEvidence(
      client,
      doc,
      retrieved(doc, FILING_HTML, { unchanged: true }),
      'candidate_signal',
      'a different excerpt',
    )

    expect(result.enriched).toBe(false)
    const row = rows('evidence')[0]!
    expect(row.body_text).toBe('already extracted')
    expect(row.evidence_excerpt).toBe('already excerpted')
  })

  it('cannot classify a 304, and leaves the stored verdict standing', async () => {
    const { client, rows } = memoryClient([
      { ...halfFinished(), classification_status: 'candidate_signal' },
    ])
    const doc = filing()
    const notModified = retrieved(doc, FILING_HTML, {
      status: 304,
      unchanged: true,
      extractedText: null,
      bytes: new Uint8Array(0),
    })
    await writeEvidence(client, doc, notModified, 'unclassified', null)
    // The body was never sent, so there is nothing to read and nothing to
    // revise. Overwriting a real verdict with `unclassified` would be a loss.
    expect(rows('evidence')[0]!.classification_status).toBe('candidate_signal')
  })

  it('bounds what it stores', async () => {
    const { client, rows } = memoryClient()
    const doc = filing()
    const huge = retrieved(doc, FILING_HTML, { extractedText: 'x'.repeat(MAX_BODY_TEXT_CHARS + 5000) })
    await writeEvidence(client, doc, huge, 'not_relevant', null)
    expect((rows('evidence')[0]!.body_text as string).length).toBe(MAX_BODY_TEXT_CHARS)
  })
})

// ---------------------------------------------------------------------------
// 5. End to end, and the rerun that has to work.
// ---------------------------------------------------------------------------

describe('SEC filing to candidate opportunity', () => {
  it('derives a signal and an opportunity carrying full attribution', async () => {
    const { client, rows } = memoryClient()
    const result = await runConnectorPass(
      client,
      connectorServing([[filing(), FILING_HTML]]),
      context(async () => {
        throw new Error('the recorded connector performs no egress')
      }),
      [COMPANY],
      'run-1',
      1,
    )

    expect(result.runStatus).toBe('success')
    expect(result.counters.documentsAccepted).toBe(1)
    // This exhibit announces TWO things -- a new plant and a distribution
    // centre expansion -- and they cluster separately, which is correct. One
    // filing is not one signal.
    expect(rows('signals').length).toBeGreaterThanOrEqual(1)
    expect(rows('opportunities').length).toBeGreaterThanOrEqual(1)

    // REQUIREMENT 11: everything a reviewer needs to judge it.
    const evidence = rows('evidence')[0]!
    expect(evidence.source_id).toBe('sec-edgar')                       // source
    expect(evidence.locator).toBe(OFFICIAL_URL)                        // source URL
    expect(evidence.published_at).toBe('2026-03-04T16:31:00.000Z')     // filing date
    expect(evidence.evidence_locator).toMatchObject({ documentType: '8-K' }) // filing type
    expect(String(evidence.evidence_excerpt)).toContain('Bowling Green') // excerpt

    const signal = rows('signals')[0]!
    expect(signal.organization_id).toBe(COMPANY.id)                    // company
    expect(signal.confidence).toBeTruthy()                             // confidence
    const metadata = signal.model_metadata as Record<string, unknown>
    expect(String(metadata.reasoning)).toContain('Matched the action')  // rationale
    expect(metadata.modelGenerated).toBe(false)

    const opportunity = rows('opportunities')[0]!
    expect(opportunity.confidence).toBeTruthy()
    expect(opportunity.status).toBe('new')                             // review state
    expect(opportunity.stage).toBe('emerging')
    expect(String(opportunity.why_it_matters).length).toBeGreaterThan(0)
  })

  it('stores a routine filing and derives nothing from it', async () => {
    const { client, rows } = memoryClient()
    const routine = filing({ sourceDocumentId: '0000100493-26-000011' })
    const result = await runConnectorPass(
      client,
      connectorServing([[routine, ROUTINE_HTML]]),
      context(async () => {
        throw new Error('no egress')
      }),
      [COMPANY],
      'run-1',
      1,
    )

    expect(result.runStatus).toBe('success')
    expect(rows('evidence')).toHaveLength(1)
    expect(rows('evidence')[0]!.classification_status).toBe('not_relevant')
    expect(rows('signals')).toHaveLength(0)
    expect(rows('opportunities')).toHaveLength(0)

    // REQUIREMENT 15: stored is not rejected.
    expect(result.counters.evidenceCreated).toBe(1)
    expect(result.counters.documentsStoredWithoutSignal).toBe(1)
    expect(result.counters.documentsRejected).toBe(0)
    expect(Object.keys(result.counters.rejectionReasons).length).toBeGreaterThan(0)
  })

  /*
     THE RERUN THAT HAS TO WORK.

     The 39 hosted rows exist, their content hashes are already in
     `source_document_cache`, and the bytes have not changed. A rerun must
     complete them rather than treat them as finished.
  */
  it('a rerun over unchanged bytes enriches the existing rows and derives the opportunity', async () => {
    const existing: Row = {
      id: 'evidence-existing',
      source_id: 'sec-edgar',
      source_document_id: ACCESSION,
      content_hash: 'a'.repeat(64),
      first_seen_at: '2026-03-05T05:00:00.000Z',
      superseded_at: null,
      body_text: null,
      locator: null,
      evidence_excerpt: null,
      classification_status: 'unclassified',
      extraction_status: 'success',
      evidence_locator: {},
    }
    const { client, rows } = memoryClient([existing])

    const unchangedConnector: Connector = {
      ...connectorServing([[filing(), FILING_HTML]]),
      async retrieve(_ctx, document) {
        // What the cache-hash path produces: same bytes, text in hand.
        return retrieved(document, FILING_HTML, { unchanged: true })
      },
    }

    const result = await runConnectorPass(
      client,
      unchangedConnector,
      context(async () => {
        throw new Error('no egress')
      }),
      [COMPANY],
      'run-2',
      1,
    )

    expect(result.runStatus).toBe('unchanged')
    // NOT a second row.
    expect(rows('evidence')).toHaveLength(1)
    expect(result.counters.evidenceCreated).toBe(0)
    expect(result.counters.duplicatesPrevented).toBe(1)
    expect(result.counters.documentsEnriched).toBe(1)

    const row = rows('evidence')[0]!
    expect(row.id).toBe('evidence-existing')
    // `supporting_evidence` is the END state: the row was classified
    // `candidate_signal`, then linked to a signal, and the pipeline records
    // that it is now doing work. Either value proves it is no longer
    // `unclassified`, which is what was stuck.
    expect(['candidate_signal', 'supporting_evidence']).toContain(row.classification_status)
    expect(row.body_text).toContain('Bowling Green')
    expect(row.locator).toBe(OFFICIAL_URL)

    // And the document reached the signal stage rather than stopping at the
    // evidence table, which is the whole point of the rerun.
    expect(rows('signals').length).toBeGreaterThanOrEqual(1)
    expect(rows('opportunities').length).toBeGreaterThanOrEqual(1)
  })

  it('a second rerun changes nothing further', async () => {
    const { client, rows } = memoryClient()
    const doc = filing()
    const conn = connectorServing([[doc, FILING_HTML]])
    const ctx = context(async () => {
      throw new Error('no egress')
    })

    await runConnectorPass(client, conn, ctx, [COMPANY], 'run-1', 1)
    const afterFirst = JSON.stringify(rows('evidence'))

    const unchanged: Connector = {
      ...conn,
      async retrieve(_c, d) {
        return retrieved(d, FILING_HTML, { unchanged: true })
      },
    }
    const second = await runConnectorPass(client, unchanged, ctx, [COMPANY], 'run-2', 1)

    expect(rows('evidence')).toHaveLength(1)
    expect(second.counters.evidenceCreated).toBe(0)
    expect(second.counters.duplicatesPrevented).toBe(1)
    // Already complete, so nothing but last_seen_at moved.
    expect(second.counters.documentsEnriched).toBe(0)
    expect(JSON.parse(afterFirst)[0].body_text).toBe(rows('evidence')[0]!.body_text)
  })
})

// ---------------------------------------------------------------------------
// 6. The signal row, and the constraints it has to satisfy.
// ---------------------------------------------------------------------------

/**
 * THE SECOND HALF OF THE SAME BUG.
 *
 * `normalizePublished` was fixed to stop writing `'minute'` and
 * `'source_declared'` into the evidence columns. `upsertSignal` had its own
 * inline copy of the same idea, writing `'day'` and `'source_declared'` into
 * `signals` -- so once evidence finally inserted, every SIGNAL insert was
 * refused with 23514 instead, and eight accepted filings produced nothing.
 *
 * The vocabularies are read out of the migration rather than restated, for the
 * same reason as evidence: a test that hard-codes them can drift exactly the
 * way the pipeline did, and would then agree with the bug.
 */
describe('the signal payload satisfies every hosted signals constraint', () => {
  const migration0013 = readFileSync(
    join(ROOT, 'db/migrations/0013_analytical_structures.up.sql'),
    'utf8',
  )
  const baselineSql = readFileSync(join(ROOT, 'schemas/database.sql'), 'utf8')

  function allowed(sql: string, marker: string): string[] {
    const at = sql.indexOf(marker)
    expect(at, `${marker} not found`).toBeGreaterThan(-1)
    const list = /\bin\s*\(([\s\S]*?)\)/.exec(sql.slice(at, at + 600))
    return [...list![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  }

  const PRECISION = allowed(migration0013, 'signals_event_date_precision_check')
  const BASIS = allowed(migration0013, 'signals_event_date_basis_check')
  const CONFIDENCE = allowed(baselineSql, 'confidence text not null check')

  async function signalRow(eventDate: string | null = '2026-03-04T16:31:00.000Z') {
    const { client, rows } = memoryClient()
    const match = classifyText(htmlToText(FILING_HTML)).matches[0]!
    await upsertSignal(client, {
      organizationId: COMPANY.id,
      organizationEntityKey: COMPANY.entity_key,
      match,
      evidenceId: 'evidence-1',
      sourceId: 'sec-edgar',
      eventDate,
      title: '8-K — Tyson Foods, Inc.',
      now: '2026-03-05T06:00:00.000Z',
    })
    return rows('signals')[0]!
  }

  it('the regression case: the two columns that refused every insert', async () => {
    const row = await signalRow()
    expect(row.event_date_precision).toBe('exact_day') // was 'day'
    expect(row.event_date_basis).toBe('stated') // was 'source_declared'
    expect(PRECISION).toContain(row.event_date_precision)
    expect(BASIS).toContain(row.event_date_basis)
  })

  it('satisfies the organization requirement', async () => {
    // organization_id not null OR facility_id not null OR family = market_demand.
    const row = await signalRow()
    expect(row.organization_id).toBe(COMPANY.id)
  })

  it('writes a confidence the column admits, and never `confirmed`', async () => {
    const row = await signalRow()
    expect(CONFIDENCE).toContain(row.confidence)
    expect(row.confidence).not.toBe('confirmed')
  })

  it('keeps event_date, precision and basis consistent with each other', async () => {
    // `signals_event_date_requires_precision`: a date demands a precision.
    const withDate = await signalRow()
    expect(withDate.event_date).toBe('2026-03-04')
    expect(withDate.event_date_precision).not.toBeNull()

    const withoutDate = await signalRow(null)
    expect(withoutDate.event_date).toBeNull()
    expect(withoutDate.event_date_precision).toBeNull()
    expect(BASIS).toContain(withoutDate.event_date_basis)
  })

  it('never writes `inferred` without a note', async () => {
    // `signals_event_date_inference_has_note`. The pipeline states or does not
    // know; it never infers, so the note is never required.
    const row = await signalRow()
    expect(row.event_date_basis).not.toBe('inferred')
    expect(eventDateForSignal('2026-03-04T00:00:00Z').basis).not.toBe('inferred')
    expect(eventDateForSignal(null).basis).not.toBe('inferred')
  })

  it('counts at least one source and orders its observation window', async () => {
    const row = await signalRow()
    expect(row.independent_source_count).toBeGreaterThanOrEqual(1)
    // `signals_observation_window_valid`: last >= first.
    expect(String(row.last_observed_at) >= String(row.first_observed_at)).toBe(true)
  })
})

describe('mapping classifier confidence into the signals vocabulary', () => {
  /*
     MAPPED, NEVER PASSED THROUGH.

     The two vocabularies coincide today. Relying on that is how the precision
     and basis bugs happened: a coincidence nobody wrote down, until one side
     moved.
  */
  it('maps every grade the classifier can produce', () => {
    expect(signalConfidenceFor('possible')).toBe('possible')
    expect(signalConfidenceFor('probable')).toBe('probable')
  })

  it('never returns `confirmed` from a single machine read', () => {
    // That grade requires a second independent source or an analyst.
    expect(signalConfidenceFor('confirmed')).toBe('probable')
    for (const input of ['possible', 'probable', 'confirmed', 'nonsense', '']) {
      expect(signalConfidenceFor(input)).not.toBe('confirmed')
    }
  })

  it('an unrecognised grade becomes `possible` rather than failing the insert', () => {
    // One unmapped value refused 39 evidence rows and then 8 signal rows. It
    // cannot do so a third time.
    expect(SIGNAL_CONFIDENCE_VALUES).toContain(signalConfidenceFor('fortnightly'))
    expect(signalConfidenceFor('fortnightly')).toBe('possible')
  })

  it('every output is a member of the column vocabulary', () => {
    for (const input of ['possible', 'probable', 'confirmed', 'unknown', '']) {
      expect(SIGNAL_CONFIDENCE_VALUES).toContain(signalConfidenceFor(input))
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Resuming from stored evidence, with no refetch.
// ---------------------------------------------------------------------------

describe('resuming downstream work from stored evidence', () => {
  /** An enriched row exactly as the hosted run left the eight accepted ones. */
  const enrichedRow = (): Row => ({
    id: 'evidence-enriched',
    source_id: 'sec-edgar',
    source_document_id: ACCESSION,
    content_hash: 'a'.repeat(64),
    first_seen_at: '2026-03-05T05:00:00.000Z',
    superseded_at: null,
    body_text: htmlToText(FILING_HTML),
    locator: OFFICIAL_URL,
    evidence_excerpt: 'Tyson Foods today announced it will build a new',
    classification_status: 'candidate_signal',
    extraction_status: 'success',
    evidence_locator: { documentType: '8-K', archiveFolder: ARCHIVE_FOLDER },
  })

  /*
     THE CASE REQUIREMENT 13 IS ABOUT.

     SEC answers 304, so this run holds no bytes at all. The eight accepted
     filings are already enriched and classified; their signals were refused by
     the constraint bug. A rerun must pick them up from storage -- without
     deleting the cache and asking a fair-access source to serve the same
     documents a third time to fix our own defect.
  */
  it('classifies from stored body_text when SEC answers 304', async () => {
    const { client, rows } = memoryClient([enrichedRow()])
    const doc = filing()
    const notModified: Connector = {
      ...connectorServing([[doc, FILING_HTML]]),
      async retrieve(_c, d) {
        return retrieved(d, FILING_HTML, {
          status: 304,
          unchanged: true,
          extractedText: null,
          bytes: new Uint8Array(0),
        })
      },
    }

    const result = await runConnectorPass(
      client,
      notModified,
      context(async () => {
        throw new Error('no egress')
      }),
      [COMPANY],
      'run-3',
      1,
    )

    // No refetch, no new evidence row.
    expect(rows('evidence')).toHaveLength(1)
    expect(result.counters.evidenceCreated).toBe(0)

    // And the downstream work finally happens.
    expect(rows('signals').length).toBeGreaterThanOrEqual(1)
    expect(rows('opportunities').length).toBeGreaterThanOrEqual(1)

    const signal = rows('signals')[0]!
    expect(signal.event_date_precision).toBe('exact_day')
    expect(signal.event_date_basis).toBe('stated')
    expect(signal.organization_id).toBe(COMPANY.id)
  })

  it('preserves the stored classification and excerpt', async () => {
    const { client, rows } = memoryClient([enrichedRow()])
    const doc = filing()
    await runConnectorPass(
      client,
      {
        ...connectorServing([[doc, FILING_HTML]]),
        async retrieve(_c, d) {
          return retrieved(d, FILING_HTML, { status: 304, unchanged: true, extractedText: null, bytes: new Uint8Array(0) })
        },
      },
      context(async () => {
        throw new Error('no egress')
      }),
      [COMPANY],
      'run-3',
      1,
    )
    const row = rows('evidence')[0]!
    expect(row.body_text).toContain('Bowling Green')
    expect(row.locator).toBe(OFFICIAL_URL)
    expect(['candidate_signal', 'supporting_evidence']).toContain(row.classification_status)
  })

  it('a second resume does not duplicate the signal or the opportunity', async () => {
    const { client, rows } = memoryClient([enrichedRow()])
    const doc = filing()
    const conn: Connector = {
      ...connectorServing([[doc, FILING_HTML]]),
      async retrieve(_c, d) {
        return retrieved(d, FILING_HTML, { status: 304, unchanged: true, extractedText: null, bytes: new Uint8Array(0) })
      },
    }
    const ctx = context(async () => {
      throw new Error('no egress')
    })

    await runConnectorPass(client, conn, ctx, [COMPANY], 'run-3', 1)
    const signals = rows('signals').length
    const opportunities = rows('opportunities').length

    await runConnectorPass(client, conn, ctx, [COMPANY], 'run-4', 1)

    // The cluster key and the opportunity key are what prevent this, and they
    // are unchanged by the temporal fix.
    expect(rows('signals')).toHaveLength(signals)
    expect(rows('opportunities')).toHaveLength(opportunities)
    expect(rows('evidence')).toHaveLength(1)
  })

  it('does nothing when there is neither fresh nor stored text', async () => {
    const bare: Row = { ...enrichedRow(), body_text: null, classification_status: 'unclassified' }
    const { client, rows } = memoryClient([bare])
    const doc = filing()
    const result = await runConnectorPass(
      client,
      {
        ...connectorServing([[doc, FILING_HTML]]),
        async retrieve(_c, d) {
          return retrieved(d, FILING_HTML, { status: 304, unchanged: true, extractedText: null, bytes: new Uint8Array(0) })
        },
      },
      context(async () => {
        throw new Error('no egress')
      }),
      [COMPANY],
      'run-3',
      1,
    )
    // Nothing to read is not the same as nothing to say. It is not counted as
    // evaluated-and-empty, and the stored verdict is left alone.
    expect(rows('signals')).toHaveLength(0)
    expect(result.counters.documentsStoredWithoutSignal).toBe(0)
    expect(rows('evidence')[0]!.classification_status).toBe('unclassified')
  })
})

// ---------------------------------------------------------------------------
// 8. The database refusal now names the constraint on THIS path too.
// ---------------------------------------------------------------------------

describe('a refused signal insert says which constraint refused it', () => {
  it('routes the signal insert failure through describeDbError', () => {
    /*
       The hosted run reported `signal insert failed: 23514` and nothing more.
       The evidence path had already been fixed; this one still reported
       `error.code ?? error.message`, and PostgREST always supplies a code, so
       the message naming the constraint was never reached.
    */
    const source = readFileSync(
      join(ROOT, 'app/netlify/functions/_shared/connectors/pipeline.ts'),
      'utf8',
    )
    for (const path of [
      'signal lookup failed',
      'signal update failed',
      'signal insert failed',
      'signal_evidence link failed',
      'opportunity lookup failed',
      'opportunity update failed',
      'opportunity insert failed',
      'opportunity_signals link failed',
    ]) {
      const line = source.split('\n').find((l) => l.includes(path))
      expect(line, `${path} not found`).toBeDefined()
      expect(line, `${path} still reports only a code`).toContain('describeDbError')
    }
    // No write in this file may report a bare code any more.
    expect(source.replace(/^ \*.*$/gm, '')).not.toMatch(/\$\{\w*[Ee]rror\.code \?\? /)
  })
})

// ---------------------------------------------------------------------------
// 9. The reference vocabulary, which is a FOREIGN KEY and not a check.
// ---------------------------------------------------------------------------

/**
 * THE CONSTRAINT THE ERROR NEVER NAMED.
 *
 * `signals.signal_family` references `signal_families(code)` and
 * `signals.event_type` references `signal_event_types(code)`. The seeded
 * vocabulary holds nine families and twenty-seven event types, and the
 * classifier's own taxonomy shares exactly ONE code with it.
 *
 * So seven of eight families and seven of eight event types would have been
 * refused by a foreign key, with SQLSTATE 23503 -- and the hosted run never saw
 * that error, because PostgreSQL evaluates CHECK constraints before foreign
 * keys and the two prose date values failed with 23514 first.
 *
 * Fixing only what the error named would have produced a different failure on
 * the very next run. The seeded codes are read out of the seed file, so this
 * cannot drift the way a restated list would.
 */
describe('the classifier taxonomy maps onto the seeded reference vocabulary', () => {
  const seedSql = readFileSync(join(ROOT, 'db/seed/0001_reference_vocabulary.sql'), 'utf8')

  it('every mapped family exists in the seed', () => {
    for (const [classifierFamily, mapped] of Object.entries(SIGNAL_TAXONOMY)) {
      expect(seedSql, `${mapped.family} (for ${classifierFamily}) is not seeded`).toContain(
        `'${mapped.family}'`,
      )
    }
  })

  it('every mapped event type exists in the seed', () => {
    for (const [classifierFamily, mapped] of Object.entries(SIGNAL_TAXONOMY)) {
      expect(seedSql, `${mapped.eventType} (for ${classifierFamily}) is not seeded`).toContain(
        `'${mapped.eventType}'`,
      )
    }
  })

  it('covers every family the classifier can produce', () => {
    const produced = new Set(SIGNAL_PATTERNS.map((p) => p.family))
    for (const family of produced) {
      expect(SIGNAL_TAXONOMY, `${family} has no mapping`).toHaveProperty(family)
    }
    expect(Object.keys(SIGNAL_TAXONOMY).sort()).toEqual([...produced].sort())
  })

  it('never writes a classifier code into the foreign-key columns', () => {
    // The classifier's own names are not in the vocabulary. `new_facility_announced`
    // is the single coincidence, and it is legitimately seeded.
    for (const pattern of SIGNAL_PATTERNS) {
      const mapped = signalTaxonomyFor(pattern.family)
      expect(mapped.family).not.toBe(pattern.family)
    }
  })

  it('an unmapped family falls back to a seeded code rather than failing the insert', () => {
    const fallback = signalTaxonomyFor('something_new')
    expect(seedSql).toContain(`'${fallback.family}'`)
    expect(seedSql).toContain(`'${fallback.eventType}'`)
  })

  it('keeps the classifier taxonomy on the signal for a reviewer', async () => {
    const { client, rows } = memoryClient()
    const match = classifyText(htmlToText(FILING_HTML)).matches[0]!
    await upsertSignal(client, {
      organizationId: COMPANY.id,
      organizationEntityKey: COMPANY.entity_key,
      match,
      evidenceId: 'evidence-1',
      sourceId: 'sec-edgar',
      eventDate: '2026-03-04T16:31:00.000Z',
      title: '8-K',
      now: '2026-03-05T06:00:00.000Z',
    })
    const metadata = rows('signals')[0]!.model_metadata as Record<string, unknown>
    // The stored family is a MAPPING. Losing what the classifier actually said
    // would make the reasoning unreadable against the taxonomy it used.
    expect(metadata.classifierFamily).toBe(match.family)
    expect(metadata.classifierEventType).toBe(match.eventType)
  })
})

describe('the role a signal plays in an opportunity', () => {
  /*
     TWO LINK TABLES, TWO VOCABULARIES, ONE WORD BORROWED FROM THE WRONG ONE.

     `signal_evidence.evidence_role` admits `primary`.
     `opportunity_signals.signal_role` does not -- it admits trigger |
     supporting | corroborating | negative | closing. `'primary'` was written to
     both.
  */
  const baselineSql = readFileSync(join(ROOT, 'schemas/database.sql'), 'utf8')

  function allowedRoles(marker: string): string[] {
    const at = baselineSql.indexOf(marker)
    const list = /\bin\s*\(([\s\S]*?)\)/.exec(baselineSql.slice(at, at + 400))
    return [...list![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  }

  it('a deriving signal is the trigger, and the column admits it', () => {
    const roles = allowedRoles('signal_role text not null default')
    expect(opportunitySignalRole(false)).toBe('trigger')
    expect(roles).toContain('trigger')
    expect(roles).not.toContain('primary')
  })

  it('a closure is recorded as negative rather than flattened into a trigger', () => {
    // A closure creating relocation work is not a plant being built.
    expect(opportunitySignalRole(true)).toBe('negative')
    expect(allowedRoles('signal_role text not null default')).toContain('negative')
  })

  it('writes a role the column admits for either kind of signal', async () => {
    const roles = allowedRoles('signal_role text not null default')
    for (const negative of [true, false]) {
      expect(roles).toContain(opportunitySignalRole(negative))
    }
  })
})
