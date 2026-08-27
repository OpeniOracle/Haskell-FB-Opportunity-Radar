import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryRouter } from 'react-router-dom'
import { APP_ROOT } from '@/test/paths'
import { normalizePublished } from '../../netlify/functions/_shared/connectors/pipeline'
import type { DiscoveredDocument } from '../../netlify/functions/_shared/connectors/types'
import { OpportunityDetail } from '@/components/OpportunityDetail'
import { OpportunityCard } from '@/components/OpportunityCard'
import { priorityBand, byScoreDescending } from '@/lib/opportunityFilters'
import { opportunityFixtures } from '@/data/fixtures/opportunities'
import type { Opportunity } from '@/types/domain'

/**
 * Publication and retrieval are two different facts that may coincide.
 *
 * An earlier version of this work enforced `published_at <> retrieved_at` in
 * the database AND discarded a source-stated timestamp that happened to equal
 * the retrieval time. Both were wrong: a feed polled seconds after publication,
 * a source stating times to the minute, and historical metadata normalised to
 * the retrieval precision all produce legitimate equality. The rule guarded
 * against a copied value by destroying real ones.
 *
 * What these tests hold in place is the ACTUAL requirement: the publication
 * time comes from the source or is null, the retrieval time is always
 * recorded, and nothing ever substitutes one for the other.
 */

const RETRIEVED_AT = '2026-03-04T18:00:00.000Z'

function document(overrides: Partial<DiscoveredDocument> = {}): DiscoveredDocument {
  return {
    sourceDocumentId: '0000100493-26-000010',
    url: 'https://www.sec.gov/Archives/edgar/data/100493/x/tsn.htm',
    canonicalUrl: 'https://www.sec.gov/Archives/edgar/data/100493/x/index.htm',
    title: '8-K',
    publishedAt: '2026-03-04T16:31:00.000Z',
    publishedPrecision: 'minute',
    documentType: '8-K',
    organizationEntityKey: 'sec:0000100493',
    discoveryPath: 'sec:submissions-api',
    metadata: {},
    ...overrides,
  }
}

describe('1. equal timestamps are accepted, not discarded', () => {
  it('keeps a source-stated publication time that happens to equal retrieval', () => {
    const result = normalizePublished(document({ publishedAt: RETRIEVED_AT }))
    expect(result.publishedAt).toBe(RETRIEVED_AT)
    expect(result.basis).toBe('source_declared')
  })

  it('does not carry any notion of rejecting equality', () => {
    const source = readFileSync(
      join(APP_ROOT, 'netlify/functions/_shared/connectors/pipeline.ts'),
      'utf8',
    )
    expect(source).not.toContain('rejected_equal_to_retrieval')
    // The function cannot compare against a value it is not given.
    expect(source).toMatch(/export function normalizePublished\(\s*document: DiscoveredDocument,\s*\)/)
  })

  it('is not forbidden by the schema either', () => {
    const migration = readFileSync(
      join(APP_ROOT, '..', 'db/migrations/0019_live_source_ingestion.up.sql'),
      'utf8',
    )
    // Comments are stripped first. The migration EXPLAINS why the rule was
    // removed, so the words appear in prose; asserting against the prose would
    // fail on the very comment that documents the fix.
    const sql = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    expect(sql).not.toMatch(/published_at\s*<>\s*retrieved_at/)
    expect(sql).not.toContain('evidence_published_is_not_retrieved')
  })
})

describe('2. a missing publication timestamp stays null', () => {
  it('returns null when the source states nothing', () => {
    const result = normalizePublished(document({ publishedAt: null }))
    expect(result.publishedAt).toBeNull()
    expect(result.precision).toBeNull()
    expect(result.basis).toBe('source_stated_none')
  })

  it('treats an empty string from the source as absent, not as a value', () => {
    const result = normalizePublished(document({ publishedAt: '' }))
    expect(result.publishedAt).toBeNull()
  })
})

describe('3. retrieval time is never copied into the publication field', () => {
  it('leaves publication null rather than reaching for the retrieval time', () => {
    const result = normalizePublished(document({ publishedAt: null }))
    expect(result.publishedAt).not.toBe(RETRIEVED_AT)
    expect(result.publishedAt).toBeNull()
  })

  it('never assigns retrieved_at to published_at anywhere in the write path', () => {
    const source = readFileSync(
      join(APP_ROOT, 'netlify/functions/_shared/connectors/pipeline.ts'),
      'utf8',
    )
    // The row builder must take published_at from the normalised source value.
    expect(source).toMatch(/published_at: published\.publishedAt/)
    expect(source).not.toMatch(/published_at:\s*[^,\n]*retriev/i)
  })
})

describe('4. a source-provided publication timestamp is preserved exactly', () => {
  it('does not round, shift or re-format it', () => {
    for (const stated of [
      '2026-03-04T16:31:00.000Z',
      '2026-03-04T16:31:07.123Z',
      '2025-11-17T00:00:00Z',
    ]) {
      expect(normalizePublished(document({ publishedAt: stated })).publishedAt).toBe(stated)
    }
  })

  it('keeps the precision the source actually supported', () => {
    expect(normalizePublished(document({ publishedPrecision: 'minute' })).precision).toBe('minute')
    expect(normalizePublished(document({ publishedPrecision: 'day' })).precision).toBe('day')
    // No precision stated alongside a real date: recorded as a day, which is
    // the weakest honest reading, never invented upward to a timestamp.
    expect(normalizePublished(document({ publishedPrecision: null })).precision).toBe('day')
  })
})

describe('5. re-ingestion does not change the original publication timestamp', () => {
  const source = readFileSync(
    join(APP_ROOT, 'netlify/functions/_shared/connectors/pipeline.ts'),
    'utf8',
  )

  it('touches only last_seen_at when a document is unchanged', () => {
    const touch = /\.update\(\{ last_seen_at: input\.now \}\)/
    expect(source).toMatch(touch)
    // The unchanged branch updates nothing else — no published_at, no
    // first_seen_at, no retrieved_at.
    const branch = source.slice(source.indexOf('if (existing && (retrieved.unchanged'))
    const untilReturn = branch.slice(0, branch.indexOf('return { evidenceId: existing.id'))
    expect(untilReturn).not.toMatch(/published_at/)
    expect(untilReturn).not.toMatch(/first_seen_at/)
    expect(untilReturn).not.toMatch(/retrieved_at/)
  })

  it('carries the original first_seen_at forward onto a superseding version', () => {
    expect(source).toMatch(/first_seen_at: existing\?\.first_seen_at \?\? input\.now/)
  })
})

describe('6. the API and the UI keep the two concepts separate', () => {
  const api = readFileSync(join(APP_ROOT, 'src/data/apiDataSource.ts'), 'utf8')

  it('selects publication and retrieval as distinct columns', () => {
    expect(api).toContain('published_at')
    expect(api).toContain('retrieved_at')
    expect(api).toContain('first_seen_at')
    expect(api).toContain('last_seen_at')
  })

  it('never substitutes one for the other in the mapping', () => {
    expect(api).not.toMatch(/published_at:\s*[^,\n]*retrieved/i)
    expect(api).not.toMatch(/publishedAt:\s*[^,\n]*retrieved/i)
  })

  it('reports evidence freshness from the run, not from a publication date', () => {
    // `newestRetrievedAt` is about when we last fetched, and must not be
    // populated from when a publisher published.
    expect(api).toMatch(/newestRetrievedAt/)
    expect(api).not.toMatch(/newestRetrievedAt:\s*[^,\n]*published/i)
  })
})

/**
 * The consequence of collecting before scoring: an opportunity with no score.
 *
 * `ScoreComponents` used to declare plain numbers, and the API provider cast a
 * null-filled object through `unknown` to satisfy it. That compiled, and the
 * detail view would have thrown on `confidenceMultiplier.toFixed(2)` the first
 * time anyone opened a collected opportunity.
 */
describe('an unscored opportunity renders, and says it is unscored', () => {
  const unscored: Opportunity = {
    ...opportunityFixtures[0]!,
    id: 'unscored-1',
    scores: {
      haskellFit: null,
      projectMaturity: null,
      potentialScope: null,
      timingMomentum: null,
      accountStrategy: null,
      rawScore: null,
      confidenceMultiplier: null,
      finalScore: null,
    },
  }

  it('has no priority band rather than the lowest one', () => {
    expect(priorityBand(null)).toBeNull()
    expect(priorityBand(0)).toBe('low')
  })

  it('sorts after everything that has been scored', () => {
    const sorted = [unscored, opportunityFixtures[0]!, opportunityFixtures[1]!].sort(byScoreDescending)
    expect(sorted[sorted.length - 1]!.id).toBe('unscored-1')
  })

  it('renders the card without throwing, showing a dash and "Not scored"', () => {
    render(
      <MemoryRouter>
        <OpportunityCard
          opportunity={unscored}
          decision={undefined}
          onDecide={() => {}}
          onReview={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Not scored')).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('renders the detail without throwing, and explains why there is no score', () => {
    render(
      <MemoryRouter>
        <OpportunityDetail opportunity={unscored} decision={undefined} onDecide={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Not scored yet')).toBeInTheDocument()
    expect(screen.getByText(/has not been scored yet/i)).toBeInTheDocument()
    // The arithmetic sentence must not appear at all, rather than appearing
    // with holes in it.
    expect(screen.queryByText(/multiplied by a confidence factor/i)).toBeNull()
  })

  it('still renders a scored opportunity the way it always did', () => {
    render(
      <MemoryRouter>
        <OpportunityDetail
          opportunity={opportunityFixtures[0]!}
          decision={undefined}
          onDecide={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(/multiplied by a confidence factor/i)).toBeInTheDocument()
  })
})
