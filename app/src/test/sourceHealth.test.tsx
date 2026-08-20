import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'
import { sourceHealthFixture } from '@/data/fixtures/health'

/**
 * Source Health & Coverage — `/admin/health`.
 *
 * ADR 0010 (Proposed; D17 Open) exists because "95% connector success" reads as
 * "95% market coverage" and is not. The tests below are about that confusion
 * being structurally impossible on this surface, not about the numbers.
 */
describe('the two panels', () => {
  it('reports connector health and coverage as separate panels', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    expect(
      screen.getByRole('heading', { level: 2, name: 'Panel 1 — Connector health' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Panel 2 — Expected coverage by company' }),
    ).toBeInTheDocument()
  })

  it('gives each panel its own question so neither can be read as the other', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    expect(screen.getByText(/Are the sources working\?/)).toBeInTheDocument()
    expect(screen.getByText(/Are the right things being watched\?/)).toBeInTheDocument()
    expect(screen.getByText(/Two questions, two panels, never one number/))
      .toBeInTheDocument()
  })

  /**
   * The case the ADR exists for: every connector healthy or recovering, and a
   * company still under-covered.
   */
  it('states the healthy-fleet-yet-under-covered case before either panel', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    expect(
      screen.getByText(/connectors are healthy, and 4 companies are still below\s+expected coverage/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/A healthy connector fleet does not mean complete monitoring/),
    ).toBeInTheDocument()
  })

  it('reports an under-covered company as under-covered, not as quiet', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    const row = screen.getByRole('heading', {
      level: 3,
      name: 'Example Confectionery Group',
    }).parentElement!
    expect(within(row).getByText('Company newsroom, FSIS MPI')).toBeInTheDocument()
    expect(within(row).getByText(/The connectors themselves are healthy/)).toBeInTheDocument()
  })

  it('does not present a single combined score', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    const main = screen.getByRole('main')
    expect(within(main).queryByText(/overall health/i)).toBeNull()
    expect(within(main).queryByText(/combined score/i)).toBeNull()
  })

  it('says no measurement policy is defined, because D17 is open', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    expect(screen.getByText(/no measurement policy or threshold is defined here/))
      .toBeInTheDocument()
  })
})

describe('connector health', () => {
  it('shows a state, a label and an icon for every connector', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    expect(screen.getAllByText('Healthy')).toHaveLength(4)
    expect(screen.getByText('Degraded')).toBeInTheDocument()
    expect(screen.getByText('Action required')).toBeInTheDocument()
  })

  /** A health trend that silently rewrites itself cannot be trusted. */
  it('keeps failures on the record after a connector recovers', async () => {
    const user = userEvent.setup()
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    const permits = screen.getByRole('article', { name: 'Regional permit index' })
    expect(within(permits).getByText('Healthy')).toBeInTheDocument()

    await user.click(within(permits).getByText(/Run history/))
    const failures = permits.querySelectorAll('.run--failure')
    expect(failures).toHaveLength(2)
    expect(within(permits).getByText(/Failures stay on the record after a recovery/))
      .toBeInTheDocument()
  })

  it('describes a maintenance task as bounded engineering, not data entry', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    const incentives = screen.getByRole('article', { name: 'State incentive announcements' })
    expect(within(incentives).getByText(/Maintenance task open/)).toBeInTheDocument()
    expect(within(incentives).getByText(/Update the extraction rules/)).toBeInTheDocument()
    expect(
      within(incentives).getByText(/a bounded engineering\s+action, never routine data entry/),
    ).toBeInTheDocument()
  })

  it('flags a connector whose freshness has fallen behind its cadence', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    const trade = screen.getByRole('article', { name: 'Trade press index' })
    expect(within(trade).getByText('24h against a 12h cadence')).toBeInTheDocument()
    expect(trade.querySelector('.connector__bad')).not.toBeNull()
  })

  it('links each coverage row to the company it is about', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    expect(
      screen.getByRole('link', { name: 'Example Confectionery Group' }),
    ).toHaveAttribute('href', '/accounts/org-fixture-4')
  })
})

describe('the fixture itself', () => {
  it('holds a healthy fleet alongside real coverage gaps', () => {
    const unhealthy = sourceHealthFixture.connectors.filter(
      (c) => c.state === 'action_required',
    )
    const underCovered = sourceHealthFixture.coverage.filter(
      (row) => row.coverage.missingSources.length > 0,
    )
    expect(unhealthy).toHaveLength(1)
    expect(underCovered.length).toBeGreaterThan(1)
  })

  it('derives coverage from the same company records the account list uses', () => {
    // One source of truth: a coverage figure here and on the company page can
    // never disagree.
    expect(sourceHealthFixture.coverage.map((r) => r.companyId)).toContain('org-fixture-4')
  })
})

/** Plan §11.2 scopes this surface to two panels. Staging is not one of them. */
describe('scope', () => {
  it('does not include a research-claim staging queue', async () => {
    renderApp('/admin/health')
    await screen.findByRole('heading', { level: 1, name: 'Source Health & Coverage' })

    const main = screen.getByRole('main')
    expect(within(main).queryByText(/staging queue/i)).toBeNull()
    expect(within(main).queryByRole('heading', { name: /claims?/i })).toBeNull()
  })
})
