import { useCallback, useState } from 'react'
import type { LocalDecision } from '@/types/domain'

/**
 * Pursuit decisions taken in the interface, held in memory only.
 *
 * There is no persistence layer in this milestone, so a decision lives for as
 * long as the tab does. That constraint is surfaced in the UI rather than
 * hidden: the action row says the choice is a preview and is not saved. Storing
 * it in `localStorage` would look like persistence without being it, which is
 * the failure mode worth avoiding.
 *
 * Selecting the same decision again clears it, so a misclick is recoverable.
 */
export function useLocalDecisions() {
  const [decisions, setDecisions] = useState<Record<string, LocalDecision>>({})

  const decide = useCallback((opportunityId: string, decision: LocalDecision) => {
    setDecisions((current) => {
      const next = { ...current }
      if (next[opportunityId] === decision) delete next[opportunityId]
      else next[opportunityId] = decision
      return next
    })
  }, [])

  const clearAll = useCallback(() => setDecisions({}), [])

  return { decisions, decide, clearAll }
}

export const DECISION_LABEL: Record<LocalDecision, string> = {
  pursue: 'Pursue',
  watch: 'Watch',
  dismiss: 'Dismiss',
  assign: 'Assign',
}

export const DECISION_CONFIRMATION: Record<LocalDecision, string> = {
  pursue: 'Marked to pursue',
  watch: 'Marked to watch',
  dismiss: 'Marked as dismissed',
  assign: 'Marked for assignment',
}
