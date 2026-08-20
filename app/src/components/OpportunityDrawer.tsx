import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { OpportunityDetail } from '@/components/OpportunityDetail'
import type { LocalDecision, Opportunity } from '@/types/domain'
import { opportunityDetailPath } from '@/lib/opportunityFilters'

/**
 * The drawer preview.
 *
 * `10_DESIGN_RESPONSE.md` §5.3: "card → drawer → 'Open full detail' for the
 * complete record. Deep links always resolve to the full page so a brief or
 * Teams alert lands somewhere shareable."
 *
 * So the drawer is an IN-SESSION affordance only. It holds no URL state: a
 * shared or directly loaded address resolves to `/opportunities/:id`, never to a
 * reopened drawer. Its body is the same `<OpportunityDetail>` the full page
 * renders, so the two cannot drift.
 *
 * Keyboard contract: focus moves to the close button on open, Escape closes, Tab
 * is held inside the panel, and focus returns to whatever opened it.
 */
export function OpportunityDrawer({
  opportunity,
  decision,
  onDecide,
  onClose,
  search = '',
}: {
  opportunity: Opportunity
  decision: LocalDecision | undefined
  onDecide: (opportunityId: string, decision: LocalDecision) => void
  onClose: () => void
  /** Carried onto the full-detail link so the state previewer survives. */
  search?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    returnFocusRef.current = previous && previous !== document.body ? previous : null
    closeRef.current?.focus()

    return () => {
      const target = returnFocusRef.current
      if (target && target.isConnected) target.focus()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const titleId = `drawer-${opportunity.id}-title`

  return (
    <div className="drawer-layer">
      <button
        type="button"
        className="drawer__scrim"
        aria-label="Close opportunity detail"
        onClick={onClose}
      />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <header className="drawer__head">
          <div>
            <p className="drawer__eyebrow">{opportunity.organization.canonicalName}</p>
            <h2 className="drawer__title" id={titleId}>
              {opportunity.title}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn--quiet drawer__close"
            onClick={onClose}
            ref={closeRef}
          >
            Close
          </button>
        </header>

        <div className="drawer__body">
          <Link
            className="btn btn--primary drawer__full"
            to={opportunityDetailPath(opportunity.id, search)}
          >
            Open full detail
            <Icon name="external" className="btn__icon" />
          </Link>

          <OpportunityDetail
            opportunity={opportunity}
            decision={decision}
            onDecide={onDecide}
            headingLevel={3}
          />
        </div>
      </div>
    </div>
  )
}
