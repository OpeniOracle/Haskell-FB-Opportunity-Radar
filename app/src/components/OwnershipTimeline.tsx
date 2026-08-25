import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { evidencePath } from '@/lib/links'
import { RELATIONSHIP_LABEL, intervalLabel, intervalNotation, isActiveOn } from '@/lib/ownership'
import type { OrganizationRelationship } from '@/types/domain'

/**
 * Every relationship a company has had, with its half-open interval.
 *
 * Ended relationships are shown, not hidden. A demerger where the former parent
 * retained a stake is not a clean termination, and a list that only showed
 * current edges would assert a separation that did not happen.
 */
export function OwnershipTimeline({
  relationships,
  asOf,
  search,
}: {
  relationships: OrganizationRelationship[]
  asOf: string
  search: string
}) {
  if (relationships.length === 0) {
    return (
      <p className="drawer__prose drawer__prose--small">
        No related organizations are recorded for this company.
      </p>
    )
  }

  const ordered = [...relationships].sort((a, b) =>
    (a.fromDate ?? '').localeCompare(b.fromDate ?? ''),
  )

  return (
    <ul className="ownership">
      {ordered.map((relationship) => {
        const active = isActiveOn(relationship, asOf)
        return (
          <li
            className={`ownership__row${active ? ' ownership__row--active' : ''}`}
            key={relationship.id}
          >
            <span className="ownership__state">
              <Icon
                name={active ? 'check' : 'dot'}
                className="ownership__state-icon"
              />
              {active ? 'In force' : 'Not in force'}
              <span className="visually-hidden"> on {asOf}</span>
            </span>

            <span className="ownership__party">
              <strong>{relationship.counterpartyName}</strong>
              <span className="ownership__kind">
                {RELATIONSHIP_LABEL[relationship.relationship]}
                {relationship.ownershipPercent !== null && (
                  <> — {relationship.ownershipPercent.toFixed(1)}%
                    {relationship.ownershipPercentBasis && (
                      <span className="fact__qualifier">
                        {' '}
                        ({relationship.ownershipPercentBasis})
                      </span>
                    )}
                  </>
                )}
              </span>
              {relationship.note && (
                <span className="ownership__note">{relationship.note}</span>
              )}
            </span>

            <span className="ownership__interval" title={intervalNotation(relationship)}>
              {intervalLabel(relationship)}
              <span className="ownership__notation">{intervalNotation(relationship)}</span>
            </span>

            <span className="ownership__evidence">
              {relationship.evidenceId ? (
                <Link to={evidencePath(relationship.evidenceId, search)}>Evidence</Link>
              ) : (
                <span className="fact__qualifier">No evidence linked</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
