import { Icon } from '@/components/Icon'
import type { UnavailableAttribute } from '@/types/domain'

/**
 * An attribute that exists in the model but cannot be populated.
 *
 * Used for target tier, engagement and the account-strategy score, all of which
 * plan §13 lists as blocked by **D14-L** pending external legal review. The
 * component takes an `UnavailableAttribute`, which has no value member at all —
 * so there is nothing here that could accidentally render a plausible-looking
 * number and imply the licence question is settled.
 */
export function UnavailableField({
  label,
  attribute,
}: {
  label: string
  attribute: UnavailableAttribute
}) {
  return (
    <div className="fact unavailable-field">
      <dt>{label}</dt>
      <dd>
        <span className="unavailable-field__tag">
          <Icon name="lock" className="unavailable-field__icon" />
          Not available
        </span>
        <span className="unavailable-field__reason">{attribute.reason}</span>
        <span className="unavailable-field__blocked">{attribute.blockedBy}</span>
      </dd>
    </div>
  )
}
