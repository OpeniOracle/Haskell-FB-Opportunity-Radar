import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { NARROW_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'
import {
  ANY,
  PRIORITY_SHORT,
  SORT_OPTIONS,
  type OpportunityQuery,
  type SortKey,
} from '@/lib/opportunityFilters'
import { stageLabel, statusLabel } from '@/lib/format'
import type {
  ConfidenceLevel,
  OpportunityStage,
  OpportunityStatus,
  PriorityBand,
} from '@/types/domain'

const PRIORITY_VALUES: PriorityBand[] = ['critical', 'high', 'moderate', 'low']
const STAGE_VALUES: OpportunityStage[] = ['confirmed', 'developing', 'emerging']
const CONFIDENCE_VALUES: ConfidenceLevel[] = ['high', 'moderate', 'low']

/**
 * Filter and sort controls.
 *
 * Everything here operates in the browser on the array the `DataSource` already
 * returned — no request, no endpoint, no backend dependency. The status options
 * are derived from the data rather than from the full status enum, so the list
 * never offers a filter that would return nothing.
 */
export function OpportunityFilters({
  query,
  onChange,
  onClear,
  regions,
  capabilities,
  statuses,
  activeCount,
}: {
  query: OpportunityQuery
  onChange: (patch: Partial<OpportunityQuery>) => void
  onClear: () => void
  regions: string[]
  capabilities: string[]
  statuses: OpportunityStatus[]
  activeCount: number
}) {
  // Seven controls fill an entire phone screen before a single opportunity is
  // visible, so on narrow viewports they start folded away behind a summary that
  // reports how many are active. Search stays out in the open either way.
  const narrow = useMediaQuery(NARROW_QUERY)
  const [open, setOpen] = useState(!narrow)

  return (
    <section className="filters" aria-label="Filter and sort opportunities">
      <div className="filters__search">
        <Icon name="target" className="filters__search-icon" />
        <input
          type="search"
          className="filters__input"
          placeholder="Search account, project, location or capability"
          aria-label="Search opportunities"
          value={query.search}
          onChange={(event) => onChange({ search: event.target.value })}
        />
      </div>

      <details
        className="filters__disclosure"
        open={open}
        onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary className="filters__summary">
          <Icon name="settings" className="filters__summary-icon" />
          Filters and sort
          {activeCount > 0 && <span className="filters__count">{activeCount}</span>}
        </summary>
        <div className="filters__row">
        <Select
          label="Priority"
          value={query.priority}
          onChange={(value) => onChange({ priority: value as OpportunityQuery['priority'] })}
          options={PRIORITY_VALUES.map((v) => ({ value: v, label: PRIORITY_SHORT[v] }))}
          anyLabel="Any priority"
        />
        <Select
          label="Stage"
          value={query.stage}
          onChange={(value) => onChange({ stage: value as OpportunityQuery['stage'] })}
          options={STAGE_VALUES.map((v) => ({ value: v, label: stageLabel[v] }))}
          anyLabel="Any stage"
        />
        <Select
          label="Status"
          value={query.status}
          onChange={(value) => onChange({ status: value as OpportunityQuery['status'] })}
          options={statuses.map((v) => ({ value: v, label: statusLabel[v] }))}
          anyLabel="Any status"
        />
        <Select
          label="Confidence"
          value={query.confidence}
          onChange={(value) =>
            onChange({ confidence: value as OpportunityQuery['confidence'] })
          }
          options={CONFIDENCE_VALUES.map((v) => ({ value: v, label: v }))}
          anyLabel="Any confidence"
        />
        <Select
          label="Geography"
          value={query.region}
          onChange={(value) => onChange({ region: value })}
          options={regions.map((v) => ({ value: v, label: v }))}
          anyLabel="Anywhere"
        />
        <Select
          label="Capability"
          value={query.capability}
          onChange={(value) => onChange({ capability: value })}
          options={capabilities.map((v) => ({ value: v, label: v }))}
          anyLabel="Any capability"
        />
        <Select
          label="Sort by"
          value={query.sort}
          onChange={(value) => onChange({ sort: value as SortKey })}
          options={SORT_OPTIONS}
        />

        <button
          type="button"
          className="btn btn--quiet filters__clear"
          onClick={onClear}
          disabled={activeCount === 0}
        >
          Clear filters
          {activeCount > 0 && <span className="filters__count">{activeCount}</span>}
        </button>
        </div>
      </details>
    </section>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  anyLabel?: string
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select
        className="field__select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {anyLabel && <option value={ANY}>{anyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
