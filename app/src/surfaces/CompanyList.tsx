import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { RecordedAt } from '@/components/RecordedAt'
import { IllustrativeNote } from '@/components/Illustrative'
import { StatusPill } from '@/components/StatusPill'
import {
  DegradedNotice,
  EmptyState,
  LoadingState,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { useDataSource } from '@/data/DataSourceContext'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import { absoluteDate } from '@/lib/format'
import { companyPath, opportunityPath } from '@/lib/links'
import { countsTowardRelevanceMetrics } from '@/lib/ownership'
import type { CompanySummary } from '@/types/domain'

type CoverageFilter = 'any' | 'covered' | 'below'
type ClassFilter = 'any' | 'confirmed' | 'provisional'

/**
 * Company — the account list at `/accounts`.
 *
 * A scanning surface, so each row carries only what decides whether to open it:
 * who, what role, how many sites, how many open opportunities, coverage, and
 * when it last moved. Everything else is on the detail page.
 *
 * Two things are deliberately absent from every row: **target tier** and
 * **engagement**. `04_UX_DESIGN_SPEC.md` lists both in the account list, and both
 * are blocked by D14-L. They appear on the detail page as explicitly
 * unavailable rather than being quietly dropped, so the gap is visible instead
 * of looking like an oversight.
 */
export function CompanyList() {
  const source = useDataSource()
  const load = useCallback(() => source.getCompanies(), [source])
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Company</h1>
          <p className="page-head__sub">
            The monitored accounts, their coverage, and their open opportunities.
          </p>
        </div>
      </header>

      {state.kind === 'loading' && <LoadingState label="Loading companies" rows={3} />}

      {state.kind === 'empty' && (
        <EmptyState
          title="No companies to show"
          body={state.reason}
          next="Companies appear here once identity resolution has run."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="The account list isn’t ready yet"
          reason={state.reason}
          blockedBy={state.blockedBy}
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'degraded' && (
        <DegradedNotice
          notice={state.notice}
          affected={state.affected}
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'stale' && (
        <StaleNotice notice={state.notice} asOf={state.asOf} checkedAt={state.checkedAt} />
      )}

      {hasData && <CompanyWorkspace companies={state.data} />}
    </>
  )
}

function CompanyWorkspace({ companies }: { companies: CompanySummary[] }) {
  const { search } = useLocation()
  const [term, setTerm] = useState('')
  const [coverage, setCoverage] = useState<CoverageFilter>('any')
  const [classification, setClassification] = useState<ClassFilter>('any')
  const [sector, setSector] = useState('any')

  const sectors = useMemo(
    () => [...new Set(companies.flatMap((c) => c.sectors))].sort(),
    [companies],
  )

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return companies.filter((company) => {
      if (needle) {
        const corpus = [company.canonicalName, company.role, company.sectors.join(' ')]
          .join(' ')
          .toLowerCase()
        if (!corpus.includes(needle)) return false
      }
      if (coverage === 'covered' && !isFullyCovered(company)) return false
      if (coverage === 'below' && company.coverage.missingSources.length === 0) return false
      if (classification !== 'any' && company.scopeClassStatus !== classification) return false
      if (sector !== 'any' && !company.sectors.includes(sector)) return false
      return true
    })
  }, [companies, term, coverage, classification, sector])

  const activeFilters =
    (term.trim() ? 1 : 0) +
    (coverage === 'any' ? 0 : 1) +
    (classification === 'any' ? 0 : 1) +
    (sector === 'any' ? 0 : 1)

  // D11 is approved PROVISIONALLY. A provisionally classified company is excluded
  // from relevance metrics until the market leader confirms it, so the
  // denominator this surface presents has to say which population it counted.
  const relevanceEligible = companies.filter(countsTowardRelevanceMetrics).length
  const provisional = companies.length - relevanceEligible

  return (
    <>
      <section className="filters" aria-label="Filter companies">
        <div className="filters__search">
          <Icon name="building" className="filters__search-icon" />
          <input
            type="search"
            className="filters__input"
            placeholder="Search company, role or sector"
            aria-label="Search companies"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <div className="filters__row">
          <label className="field">
            <span className="field__label">Coverage</span>
            <select
              className="field__select"
              value={coverage}
              onChange={(event) => setCoverage(event.target.value as CoverageFilter)}
            >
              <option value="any">Any coverage</option>
              <option value="covered">Fully covered</option>
              <option value="below">Below expected</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Classification</span>
            <select
              className="field__select"
              value={classification}
              onChange={(event) => setClassification(event.target.value as ClassFilter)}
            >
              <option value="any">Any classification</option>
              <option value="confirmed">Confirmed</option>
              <option value="provisional">Provisional</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Sector</span>
            <select
              className="field__select"
              value={sector}
              onChange={(event) => setSector(event.target.value)}
            >
              <option value="any">Any sector</option>
              {sectors.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--quiet filters__clear"
            disabled={activeFilters === 0}
            onClick={() => {
              setTerm('')
              setCoverage('any')
              setClassification('any')
              setSector('any')
            }}
          >
            Clear filters
            {activeFilters > 0 && <span className="filters__count">{activeFilters}</span>}
          </button>
        </div>
      </section>

      <div className="results" role="status">
        <p className="results__count">
          <strong>{visible.length}</strong> of {companies.length} companies
          {activeFilters > 0 && <span className="results__filtered"> · filtered</span>}
        </p>
        <p className="results__preview-note">
          {relevanceEligible} count toward relevance metrics; {provisional} are
          provisionally classified and excluded.
        </p>
        <IllustrativeNote />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No companies match these filters"
          body="Nothing has been hidden — the filters currently exclude every company."
          next="Clear a filter or widen the search to see results again."
          checkedAt={null}
        />
      ) : (
        <div className="opp-list" aria-labelledby="company-results">
          {/* Same reason as Opportunities: the h3 row titles need an h2 anchor. */}
          <h2 className="visually-hidden" id="company-results">
            Matching companies
          </h2>
          {visible.map((company) => (
            <CompanyRow key={company.id} company={company} search={search} />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Fully covered means EVERY EXPECTED SOURCE REPORTED — and that there was an
 * expectation to meet.
 *
 * With an empty expectations table, `missingSources.length === 0` is trivially
 * true for every account, and the list cheerfully labelled six uncovered
 * accounts "Fully covered". An empty denominator is not a full numerator.
 */
function isFullyCovered(company: CompanySummary): boolean {
  return company.coverage.expectedSources.length > 0 && company.coverage.missingSources.length === 0
}

function CompanyRow({
  company,
  search,
}: {
  company: CompanySummary
  search: string
}) {
  const headingId = `company-${company.id}`
  const underCovered = company.coverage.missingSources.length > 0
  const unmeasured = company.coverage.expectedSources.length === 0

  return (
    <article className="company-row" aria-labelledby={headingId}>
      <div className="company-row__body">
        <div className="opp__eyebrow">
          <span>{company.role}</span>
          {company.parentName && (
            <>
              <span className="opp__sep" aria-hidden="true">
                •
              </span>
              <span>Parent: {company.parentName}</span>
            </>
          )}
        </div>

        <h3 className="company-row__title" id={headingId}>
          <Link to={companyPath(company.id, search)}>{company.canonicalName}</Link>
        </h3>

        <div className="opp__pills">
          {company.scopeClassStatus === 'provisional' ? (
            <StatusPill
              tone="developing"
              icon="clock"
              label="Provisional classification"
              title="Excluded from relevance metrics until the classification is confirmed (D11)."
            />
          ) : (
            <StatusPill tone="neutral" icon="dot" label="Confirmed classification" />
          )}
          <StatusPill
            tone={underCovered ? 'attention' : unmeasured ? 'neutral' : 'confirmed'}
            icon={underCovered ? 'alert' : unmeasured ? 'clock' : 'check'}
            label={
              underCovered
                ? 'Below expected coverage'
                : unmeasured
                  ? 'Coverage not yet measured'
                  : 'Fully covered'
            }
            title={company.coverage.gapReason ?? 'Every expected source reported.'}
          />
        </div>

        <div className="opp__meta">
          <span className="opp__meta-item">
            <Icon name="target" className="opp__meta-icon" />
            {company.openOpportunityCount}{' '}
            {company.openOpportunityCount === 1 ? 'opportunity' : 'opportunities'}
          </span>
          <span className="opp__meta-item">
            <Icon name="spark" className="opp__meta-icon" />
            {company.signalCount} {company.signalCount === 1 ? 'signal' : 'signals'}
          </span>
          <span className="opp__meta-item">
            <Icon name="document" className="opp__meta-icon" />
            {company.latestEvidenceAt
              ? `Latest evidence ${absoluteDate(company.latestEvidenceAt)}`
              : 'No evidence linked yet'}
          </span>
          <span className="opp__meta-item">
            <Icon name="settings" className="opp__meta-icon" />
            {company.coverage.observedSources.length > 0
              ? `Covered by ${company.coverage.observedSources.join(', ')}`
              : 'No source has produced a signal here'}
          </span>
          {company.latestActivityAt && (
            <span className="opp__meta-item">
              <Icon name="clock" className="opp__meta-icon" />
              <RecordedAt iso={company.latestActivityAt} prefix="Last activity" />
            </span>
          )}
        </div>

        {/*
          THE ACCOUNT'S BEST OPPORTUNITY, OR A SENTENCE SAYING THERE ISN'T ONE.

          The empty case is the one worth getting right: an account can be
          monitored, collected from, and correctly carry no qualifying project.
          Rendering nothing there reads as a page that failed to finish loading.
        */}
        {company.topOpportunity ? (
          <p className="company-row__top">
            <span className="company-row__top-label">Top opportunity</span>
            <Link to={opportunityPath(company.topOpportunity.id, search)}>
              {company.topOpportunity.label}
            </Link>
            {company.topOpportunity.detail && (
              <span className="company-row__top-detail">
                {company.topOpportunity.detail}
              </span>
            )}
          </p>
        ) : (
          <p className="company-row__top company-row__top--empty">
            No qualifying opportunity yet. Documents collected for this account have been
            evaluated and none carried a supported facility signal.
          </p>
        )}
      </div>

      <div className="company-row__aside">
        <Link className="btn btn--primary" to={companyPath(company.id, search)}>
          Open company
          <Icon name="chevron" className="btn__icon" />
        </Link>
      </div>
    </article>
  )
}
