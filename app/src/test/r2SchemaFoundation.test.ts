import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromRoot } from '@/test/paths'
import { upsertOpportunity } from '../../netlify/functions/_shared/connectors/pipeline'
import type { ClassificationMatch } from '../../netlify/functions/_shared/connectors/classify'

/**
 * R2 -- THE SCHEMA FOUNDATION CHANGES NO BEHAVIOUR YET.
 *
 * Migrations 0025 - 0030 add columns, constraints and two server-side tables for
 * LATER phases (R3 derivation, R4 durable execution). The application must neither
 * read nor write any of them yet, and the one place that matters most is the
 * pipeline's opportunity write: a derived opportunity must come out of it
 * unreviewed, of unknown lifecycle and not assessed, which it can only do if the
 * pipeline never tries to say otherwise. The database default is the guarantee;
 * this keeps the writer from competing with it.
 *
 * Two kinds of check:
 *
 *   1. BEHAVIOURAL. The real `upsertOpportunity` runs against a recording client,
 *      and what it sends is inspected.
 *   2. STRUCTURAL. No server function names a new column or table, and the
 *      client's explicit column lists do not read one. Naming one is a deliberate
 *      change (R3, R4, R9) that must update this test and the grants with it.
 */

const NEW_COLUMNS = [
  'review_state',
  'project_lifecycle',
  'commercial_qualification',
  'rights_class',
  'event_date_role',
] as const
const NEW_TABLES = ['ingestion_tasks', 'evidence_text_fingerprints'] as const

/* ------------------------------------------------------------- the recording client */

interface Write {
  table: string
  op: 'insert' | 'update' | 'upsert'
  payload: Record<string, unknown>
}

function recordingClient(options: { existing: boolean }) {
  const writes: Write[] = []

  const client = {
    from(table: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        single: async () => ({ data: { id: 'opp-new' }, error: null }),
        maybeSingle: async () => ({ data: options.existing ? { id: 'opp-existing' } : null, error: null }),
        insert: (payload: Record<string, unknown>) => {
          writes.push({ table, op: 'insert', payload })
          return api
        },
        update: (payload: Record<string, unknown>) => {
          writes.push({ table, op: 'update', payload })
          return api
        },
        upsert: async (payload: Record<string, unknown>) => {
          writes.push({ table, op: 'upsert', payload })
          return { error: null }
        },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }),
      }
      return api
    },
  }
  return { client: client as never, writes }
}

const MATCH: ClassificationMatch = {
  family: 'facility_construction',
  eventType: 'new_facility_announced',
  negative: false,
  excerpt: 'Example Alpha Foods announced a new plant.',
  startOffset: 0,
  endOffset: 40,
  matchedAction: 'announced',
  matchedAsset: 'a new plant',
  corroboration: [],
  confidence: 'probable',
  reasoning: 'A named company announced a named asset.',
}

const INPUT = {
  organizationId: 'org-1',
  organizationEntityKey: 'radar:example-alpha-foods',
  signalId: 'sig-1',
  match: MATCH,
  independentSourceCount: 1,
  eventDate: null,
  now: '2026-10-16T12:00:00.000Z',
}

describe('the pipeline writes no R2 column', () => {
  it('creates a derived opportunity without naming a review state, lifecycle or qualification', async () => {
    const { client, writes } = recordingClient({ existing: false })
    const result = await upsertOpportunity(client, INPUT)

    expect(result.created).toBe(true)
    const insert = writes.find((w) => w.table === 'opportunities' && w.op === 'insert')!
    for (const column of NEW_COLUMNS) expect(insert.payload, column).not.toHaveProperty(column)
    // So the database default decides, and the default asserts nothing: the row is
    // unreviewed, of unknown lifecycle and not assessed, however it was derived.
    expect(insert.payload).toMatchObject({ stage: 'emerging', status: 'new' })
    expect(insert.payload.derived_by).toMatch(/^pipeline@/)
  })

  it('refreshes an existing opportunity without touching review, lifecycle or qualification', async () => {
    const { client, writes } = recordingClient({ existing: true })
    const result = await upsertOpportunity(client, INPUT)

    expect(result.created).toBe(false)
    const update = writes.find((w) => w.table === 'opportunities' && w.op === 'update')!
    for (const column of NEW_COLUMNS) expect(update.payload, column).not.toHaveProperty(column)
    expect(Object.keys(update.payload).sort()).toEqual(['derived_at', 'last_material_change_at', 'updated_at'])
  })

  it('never sets a status other than the untouched one, so a derived row cannot be pursuit-ready', async () => {
    const { client, writes } = recordingClient({ existing: false })
    await upsertOpportunity(client, INPUT)
    const statuses = writes.filter((w) => w.table === 'opportunities').map((w) => w.payload.status)
    expect(statuses).toEqual(['new'])
  })

  it('does not write to the work queue or the fingerprint table', async () => {
    const { client, writes } = recordingClient({ existing: false })
    await upsertOpportunity(client, INPUT)
    for (const table of NEW_TABLES) expect(writes.some((w) => w.table === table)).toBe(false)
  })
})

describe('nothing in the application reads or writes an R2 column or table yet', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path)
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
    })

  // Test files and the type for a future table are excluded on purpose: this is
  // about the code that RUNS.
  const runtime = [...sourceFiles(fromRoot('netlify/functions')), ...sourceFiles(fromRoot('src'))].filter(
    (file) => !/\/src\/test\//.test(file) && !/\.test\.tsx?$/.test(file),
  )

  it.each([...NEW_COLUMNS, ...NEW_TABLES])('%s is named by no runtime file', (name) => {
    const offenders = runtime.filter((file) => readFileSync(file, 'utf8').includes(name))
    expect(offenders.map((file) => file.replace(fromRoot('.'), ''))).toEqual([])
  })
})
