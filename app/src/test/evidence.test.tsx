import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '@/test/render'

/**
 * Evidence detail — `/evidence/:evidenceId`, a contextual surface.
 *
 * Three accepted or proposed rules meet on this page, and each has a failure
 * mode worth a test:
 *
 *   ADR 0004 / D15 (Accepted)  — a month rendered as the first of the month.
 *   ADR 0012 / D24 (Accepted)  — a correction that deletes what it corrects.
 *   ADR 0006 / D19 (Proposed)  — an access mode silently promoted to a claim.
 */
describe('provenance', () => {
  it('keeps published and retrieved as separate values', async () => {
    renderApp('/evidence/ev-fixture-3')
    await screen.findByRole('heading', { level: 1, name: 'Innovation centre programme update' })

    const published = screen.getByText('Published').parentElement!
    const retrieved = screen.getByText('Retrieved').parentElement!
    expect(within(published).getByText('August 2026')).toBeInTheDocument()
    expect(within(retrieved).getByText(/11 August 2026, 16:30 UTC/)).toBeInTheDocument()
    expect(screen.getByText(/never conflated/)).toBeInTheDocument()
  })

  /** The exact failure ADR 0004 exists to prevent. */
  it('never renders a month-precision date as a day', async () => {
    renderApp('/evidence/ev-fixture-3')
    await screen.findByRole('heading', { level: 1, name: 'Innovation centre programme update' })

    const published = screen.getByText('Published').parentElement!
    expect(within(published).getByText('August 2026')).toBeInTheDocument()
    expect(within(published).getByText('(month precision)')).toBeInTheDocument()
    expect(within(published).queryByText(/1 August 2026/)).toBeNull()
  })

  it('never renders a year-precision date as 1 January', async () => {
    renderApp('/evidence/ev-fixture-5')
    await screen.findByRole('heading', { level: 1, name: 'Ownership change filing' })

    const published = screen.getByText('Published').parentElement!
    expect(within(published).getByText('2025')).toBeInTheDocument()
    expect(within(published).getByText('(year precision)')).toBeInTheDocument()
    expect(within(published).queryByText(/1 January 2025/)).toBeNull()
  })

  it('labels an inferred interval as inferred rather than stated', async () => {
    renderApp('/evidence/ev-fixture-7')
    await screen.findByRole('heading', { level: 1, name: 'Cold-storage expansion reported' })

    expect(screen.getByText('(year precision, inferred)')).toBeInTheDocument()
    expect(screen.getByText(/Inferred, not stated/)).toBeInTheDocument()
    expect(screen.getByText(/recorded as an inference, not a source fact/))
      .toBeInTheDocument()
  })

  it('records the access mode without applying a rule to it', async () => {
    renderApp('/evidence/ev-fixture-3')
    await screen.findByRole('heading', { level: 1, name: 'Innovation centre programme update' })

    expect(screen.getAllByText('Archived full text').length).toBeGreaterThan(0)
    const pill = document.querySelector('.pill')!
    expect(pill.getAttribute('title')).toMatch(/no promotion rule is applied/)
  })
})

describe('withheld content', () => {
  it('says a reference-only record has no retained body', async () => {
    renderApp('/evidence/ev-fixture-4')
    await screen.findByRole('heading', { level: 1, name: 'Water withdrawal application filed' })

    expect(
      screen.getByRole('heading', { level: 3, name: 'Reference only — no body retained' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/The reference is preserved so the claim can be traced/))
      .toBeInTheDocument()
    // The locator survives even though the body does not.
    expect(screen.getByText('permits/2026/WD-118-42')).toBeInTheDocument()
  })

  it('says a metadata-only record has neither body nor locator', async () => {
    renderApp('/evidence/ev-fixture-7')
    await screen.findByRole('heading', { level: 1, name: 'Cold-storage expansion reported' })

    expect(
      screen.getByRole('heading', { level: 3, name: 'Metadata only — no body retained' }),
    ).toBeInTheDocument()
    expect(screen.getByText('No locator retained')).toBeInTheDocument()
    expect(screen.getByText(/nothing more is being withheld from you/)).toBeInTheDocument()
  })
})

/** ADR 0012 / D24. A correction is a relationship between immutable records. */
describe('corrections and supersession', () => {
  it('keeps a superseded record readable and marks it superseded', async () => {
    renderApp('/evidence/ev-fixture-1')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Example Beverage Company announces Southeast plant investment',
    })

    expect(screen.getByText('Superseded')).toBeInTheDocument()
    expect(screen.getByText(/Superseded, not replaced/)).toBeInTheDocument()
    // The body of the superseded record is still there to read.
    expect(screen.getByText(/aseptic filling capacity and warehouse automation/))
      .toBeInTheDocument()
  })

  it('links forward from the superseded record to the one that replaced it', async () => {
    const user = userEvent.setup()
    renderApp('/evidence/ev-fixture-1')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Example Beverage Company announces Southeast plant investment',
    })

    await user.click(screen.getByRole('link', { name: 'Open the record that supersedes it' }))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Corrected construction start date for the Southeast plant',
      }),
    ).toBeInTheDocument()
  })

  it('links back from the correcting record to what it corrected', async () => {
    const user = userEvent.setup()
    renderApp('/evidence/ev-fixture-2')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Corrected construction start date for the Southeast plant',
    })

    expect(screen.getByText('Corrects')).toBeInTheDocument()
    expect(screen.queryByText('Superseded')).toBeNull()

    await user.click(
      screen.getByRole('link', {
        name: 'Example Beverage Company announces Southeast plant investment',
      }),
    )
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Example Beverage Company announces Southeast plant investment',
      }),
    ).toBeInTheDocument()
  })

  it('states that nothing is deleted', async () => {
    renderApp('/evidence/ev-fixture-2')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Corrected construction start date for the Southeast plant',
    })
    expect(screen.getByText(/never edits/)).toBeInTheDocument()
    expect(screen.getByText(/nothing is deleted/)).toBeInTheDocument()
  })

  it('reports the absence of corrections rather than an empty section', async () => {
    renderApp('/evidence/ev-fixture-5')
    await screen.findByRole('heading', { level: 1, name: 'Ownership change filing' })
    expect(screen.getByText('No corrections reference this record.')).toBeInTheDocument()
  })
})

describe('source fact versus system inference', () => {
  it('separates what the publisher wrote from what the platform concluded', async () => {
    renderApp('/evidence/ev-fixture-1')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Example Beverage Company announces Southeast plant investment',
    })

    expect(screen.getByText('Source fact')).toBeInTheDocument()
    expect(screen.getByText('System inference')).toBeInTheDocument()
    expect(screen.getByText(/The source does not characterise the project this way/))
      .toBeInTheDocument()
  })

  it('gives the two a different treatment, not just a different word', async () => {
    renderApp('/evidence/ev-fixture-1')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Example Beverage Company announces Southeast plant investment',
    })

    expect(document.querySelectorAll('.assertion--source_fact')).toHaveLength(1)
    expect(document.querySelectorAll('.assertion--system_inference')).toHaveLength(1)
  })

  it('attaches a note explaining every inference', async () => {
    renderApp('/evidence/ev-fixture-4')
    await screen.findByRole('heading', { level: 1, name: 'Water withdrawal application filed' })

    const inference = document.querySelector('.assertion--system_inference')!
    expect(inference.querySelector('.assertion__note')?.textContent).toMatch(
      /The filing itself does not state the relationship/,
    )
  })
})

describe('related records', () => {
  it('reaches the company, facility and opportunity a record supports', async () => {
    renderApp('/evidence/ev-fixture-1')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Example Beverage Company announces Southeast plant investment',
    })

    // Named the way a person would name them; the id stays as the address and
    // in the title attribute, never as the link text.
    const company = screen.getByRole('link', { name: /Example Beverage Company\s+Brand owner/ })
    expect(company).toHaveAttribute('href', '/accounts/org-fixture-1')
    expect(company).toHaveAttribute('title', 'org-fixture-1')

    expect(
      screen.getByRole('link', { name: /Example Beverage Southeast Plant\s+Macon, GA/ }),
    ).toHaveAttribute('href', '/facilities/fac-fixture-1')
    expect(
      screen.getByRole('link', {
        name: /Aseptic filling line and warehouse automation at Southeast plant\s+Confirmed/,
      }),
    ).toHaveAttribute('href', '/opportunities/opp-fixture-1')
  })

  /**
   * The research-claim staging queue is not a Phase 1 surface, so a staged claim
   * is named and NOT linked. Naming it without a destination is the honest
   * option: the reference exists, the queue does not.
   */
  it('names a staged claim without offering a queue that does not exist', async () => {
    renderApp('/evidence/ev-fixture-4')
    await screen.findByRole('heading', { level: 1, name: 'Water withdrawal application filed' })

    expect(
      screen.getByText('Applicant named on a water withdrawal filing'),
    ).toBeInTheDocument()
    expect(screen.getByText(/staging only, no queue in Phase 1/)).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Applicant named on a water withdrawal filing/ }),
    ).toBeNull()
  })

  it('shows an unknown evidence id as unavailable', async () => {
    renderApp('/evidence/no-such-record')
    expect(
      await screen.findByText(/No evidence record matches that address/),
    ).toBeInTheDocument()
  })
})
