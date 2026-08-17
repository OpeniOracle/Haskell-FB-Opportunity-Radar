import { Icon, type IconName } from '@/components/Icon'
import type { ChangeTone } from '@/types/domain'

export type PillTone = ChangeTone

/**
 * A status indicator that is legible without colour.
 *
 * Three things always travel together — colour, a distinct icon SHAPE, and a
 * text label. `04_UX_DESIGN_SPEC.md` requires that status meanings survive
 * greyscale printing and colour-vision deficiency, so there is no icon-only or
 * colour-only variant of this component and no prop that removes the label.
 */
interface StatusPillProps {
  tone: PillTone
  icon: IconName
  label: string
  /** Optional longer description exposed to assistive technology. */
  title?: string
}

export function StatusPill({ tone, icon, label, title }: StatusPillProps) {
  return (
    <span className={`pill pill--${tone}`} title={title}>
      <Icon name={icon} className="pill__icon" />
      {label}
    </span>
  )
}
