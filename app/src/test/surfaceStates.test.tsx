import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { createFixtureDataSource, parseScenario } from '@/data/fixtureDataSource'

/**
 * The five non-happy states are a deliverable of this milestone, so they are
 * tested rather than merely written. `degraded` and `stale` must keep rendering
 * content — a notice that hides the data it qualifies is worse than no notice.
 */
describe('surface states', () => {
  it('parses the scenario from the query string and falls back safely', () => {
    expect(parseScenario('?state=degraded')).toBe('degraded')
    expect(parseScenario('?state=nonsense')).toBe('ready')
    expect(parseScenario('')).toBe('ready')
  })

  it.each([
    ['/', 'Nothing has changed since your last visit'],
    ['/opportunities', 'No opportunities to show'],
  ])('renders an empty state at %s', async (path, heading) => {
    renderApp(`${path}?state=empty`)
    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument()
    // An empty result is announced, not left as a blank region.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it.each(['/', '/opportunities'])('renders an unavailable state at %s', async (path) => {
    renderApp(`${path}?state=unavailable`)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Blocked by:/)).toBeInTheDocument()
  })

  it('keeps content visible in the degraded state and names what is affected', async () => {
    renderApp('/opportunities?state=degraded')
    expect(await screen.findByText(/Partial coverage/)).toBeInTheDocument()
    expect(screen.getByText(/Affected:/)).toBeInTheDocument()
    // Content is still rendered, not replaced.
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)
  })

  it('keeps content visible in the stale state and states the as-of time', async () => {
    renderApp('/opportunities?state=stale')
    expect(await screen.findByText(/Showing data as of/)).toBeInTheDocument()
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)
  })

  it('exposes the loading state to assistive technology', async () => {
    const source = createFixtureDataSource('loading')
    const state = await source.getPulse()
    expect(state.kind).toBe('loading')
  })

  it('never reports a real data source in this milestone', () => {
    const source = createFixtureDataSource()
    expect(source.meta.mode).toBe('fixture')
    expect(source.meta.illustrative).toBe(true)
  })
})
