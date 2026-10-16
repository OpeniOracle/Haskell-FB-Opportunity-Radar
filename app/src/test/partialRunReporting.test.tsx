import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp, fixtureSource } from '@/test/render'
import { sourceHealthFixture } from '@/data/fixtures/health'
import { deferredOf, runNote, runOutcome } from '@/data/apiDataSource'
import type { DataSource } from '@/data/DataSource'
import type { SourceHealthSnapshot } from '@/types/domain'

/**
 * A RUN THAT STOPPED EARLY IS NEVER PRESENTED AS COVERAGE.
 *
 * The runner stops starting documents when an invocation's time budget is
 * spent, and records the rest as `documentsDeferred` in the run's metrics. The
 * run closes as `partial_success`, `sources.last_success_at` does not move, and
 * the source's health is degraded. Until runs can resume where the last one
 * stopped (durable continuation, audit PR 4), each run starts over -- so a
 * source that always stops early is never fully checked.
 *
 * Before this, the interface read run notes from `error_summary` alone, which is
 * EMPTY when nothing failed: a run that checked 13 of 53 pages would have shown
 * "partial success" and no explanation, beside a "last successful collection"
 * that a partial run used to advance.
 */

describe('reading a run from the database', () => {
  it('reports each run status as what it is, not as a failure', () => {
    expect(runOutcome('success')).toBe('success')
    expect(runOutcome('unchanged')).toBe('unchanged')
    expect(runOutcome('partial_success')).toBe('partial_success')
    expect(runOutcome('running')).toBe('running')
    expect(runOutcome('failure')).toBe('failure')
    // Unrecognised stays in the safe direction.
    expect(runOutcome('something_else')).toBe('failure')
    expect(runOutcome(null)).toBe('failure')
  })

  it('takes deferral from the recorded metrics, and nothing else', () => {
    expect(deferredOf({ documentsDeferred: 40 })).toBe(40)
    expect(deferredOf({ documentsDeferred: 0 })).toBe(0)
    expect(deferredOf({})).toBe(0)
    expect(deferredOf(null)).toBe(0)
    expect(deferredOf({ documentsDeferred: 'many' })).toBe(0)
  })

  it('says a run stopped early, even when nothing failed', () => {
    const note = runNote(null, 40, 53)
    expect(note).toMatch(/^Stopped early: 40 of 53 discovered document\(s\) were not checked/)
    expect(note).toMatch(/did not cover the whole source/)
    expect(runNote('one document failed', 40, 53)).toMatch(/Stopped early.*one document failed$/)
    expect(runNote(null, 0, 53)).toBe('')
  })
})

describe('Source Health with a run that stopped early', () => {
  function withStoppedRun(): (scenario: string | undefined) => DataSource {
    const snapshot: SourceHealthSnapshot = structuredClone(sourceHealthFixture)
    const connector = snapshot.connectors[0]!
    connector.state = 'degraded'
    connector.lastOutcome = 'partial_success'
    connector.lastSuccessfulCollectionAt = null
    connector.runHistory = [
      {
        id: 'r-stopped',
        startedAt: '2026-08-17T06:00:00Z',
        completedAt: '2026-08-17T06:00:21Z',
        outcome: 'partial_success',
        itemsSeen: 53,
        itemsStored: 0,
        documentsDeferred: 40,
        note: runNote(null, 40, 53),
      },
      ...connector.runHistory,
    ]
    return (scenario) => {
      const base = fixtureSource(scenario)
      return {
        ...base,
        meta: base.meta,
        getSourceHealth: async () => ({ kind: 'ready', data: snapshot, checkedAt: '2026-08-17T07:00:00Z' }),
      }
    }
  }

  it('states that the latest run did not check the whole source', async () => {
    renderApp('/admin/health', { data: withStoppedRun() })
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    expect(screen.getByText(/The latest run did not check the whole source\./)).toBeInTheDocument()
    // Once in the card's notice, once in the run's own history line.
    expect(screen.getAllByText(/40 of 53 discovered document\(s\) were not checked/)).toHaveLength(2)
    expect(screen.getByText(/Coverage of this source is incomplete/)).toBeInTheDocument()
  })

  it('labels the run partial in words, and never as complete', async () => {
    renderApp('/admin/health', { data: withStoppedRun() })
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    expect(screen.getAllByText(/partial — did not check everything/).length).toBeGreaterThan(0)
    // The freshness line is about COMPLETE collections, and there has been none.
    expect(screen.getAllByText('Last complete collection').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/No complete collection yet/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Last successful collection')).toBeNull()
  })

  it('shows no such notice when the latest run checked everything', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })
    expect(screen.queryByText(/did not check the whole source/)).toBeNull()
  })
})
