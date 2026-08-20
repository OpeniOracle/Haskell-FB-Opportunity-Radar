import { Link } from 'react-router-dom'
import { Icon, type IconName } from '@/components/Icon'
import type { RecordRef } from '@/types/domain'

/**
 * A link to another record, labelled the way a person would name it.
 *
 * The id is deliberately not the link text. A business-development user reading
 * "fac-fixture-3" has to open it to find out whether it is worth opening, which
 * is the opposite of what a list of related records is for. The id stays
 * available as the address and in the title attribute.
 */
export function RecordLink({
  to,
  icon,
  record,
}: {
  to: string
  icon: IconName
  record: RecordRef
}) {
  return (
    <Link className="record-link" to={to} title={record.id}>
      <Icon name={icon} className="record-link__icon" />
      <span className="record-link__text">
        <span className="record-link__label">{record.label}</span>
        {record.detail && <span className="record-link__detail">{record.detail}</span>}
      </span>
      <Icon name="chevron" className="record-link__chevron" />
    </Link>
  )
}

/**
 * A record that is named but has nowhere to go.
 *
 * Used for a staged research claim: the reference exists, the staging queue is
 * not a Phase 1 surface, and offering a link to a page that does not exist would
 * be worse than naming it plainly.
 */
export function RecordMention({
  icon,
  record,
  note,
}: {
  icon: IconName
  record: RecordRef
  note: string
}) {
  return (
    <span className="record-link record-link--static" title={record.id}>
      <Icon name={icon} className="record-link__icon" />
      <span className="record-link__text">
        <span className="record-link__label">{record.label}</span>
        <span className="record-link__detail">
          {record.detail ? `${record.detail} · ${note}` : note}
        </span>
      </span>
    </span>
  )
}
