import type {
  Company,
  OrganizationRelationship,
  OrganizationRelationshipType,
} from '@/types/domain'

/**
 * Time-bounded ownership — the accepted half of ADR 0005.
 *
 * ADR 0005 is **Accepted in part** via D18: the conservative-resolution ladder
 * is still Proposed pending Gate G-4, but "relationships are time-bounded and
 * evidence-backed" is approved. This module implements only that corollary.
 *
 * ## The interval convention
 *
 * Intervals are **half-open**: `fromDate` is INCLUSIVE, `toDate` is
 * **EXCLUSIVE**, `null` on either end means open. Written `[from, to)`.
 *
 * The exclusivity is the whole point. A relationship ending on the same date
 * another begins produces neither an overlap nor a gap — so a demerger dated
 * 6 December has the old parent edge ending at `2027-12-06` and the retained
 * stake beginning at `2027-12-06`, and asking "who owned this on 6 December"
 * returns exactly one answer. An inclusive `to_date` would return two.
 */

/** Is the relationship in force on `date`? Half-open: `from <= date < to`. */
export function isActiveOn(
  relationship: Pick<OrganizationRelationship, 'fromDate' | 'toDate'>,
  date: string,
): boolean {
  const { fromDate, toDate } = relationship
  if (fromDate !== null && date < fromDate) return false
  // EXCLUSIVE upper bound: a date equal to toDate is NOT covered.
  if (toDate !== null && date >= toDate) return false
  return true
}

export function relationshipsAsOf(
  relationships: OrganizationRelationship[],
  date: string,
): OrganizationRelationship[] {
  return relationships.filter((r) => isActiveOn(r, date))
}

/**
 * Which organization is the controlling parent as at a date?
 *
 * A retained `minority_interest` is deliberately NOT control. After a demerger
 * the former parent may still hold a commercially significant stake, and the
 * surface must show that stake without implying the company is still a
 * subsidiary.
 */
const CONTROLLING: OrganizationRelationshipType[] = ['parent_subsidiary', 'division']

export function controllingParentAsOf(
  relationships: OrganizationRelationship[],
  date: string,
): OrganizationRelationship | null {
  return (
    relationshipsAsOf(relationships, date).find((r) =>
      CONTROLLING.includes(r.relationship),
    ) ?? null
  )
}

/**
 * Who operates a facility as at a date?
 *
 * The brand owner is the fallback. An explicit operating relationship —
 * franchise bottler or co-manufacturer — takes precedence, because the operator
 * is the entity that actually runs the plant (D13).
 */
const OPERATING: OrganizationRelationshipType[] = ['franchise_bottler', 'co_manufacturer']

export function operatorAsOf(
  company: Pick<Company, 'canonicalName' | 'relationships'>,
  date: string,
): { name: string; via: OrganizationRelationshipType | 'brand_owner' } {
  const operating = relationshipsAsOf(company.relationships, date).find((r) =>
    OPERATING.includes(r.relationship),
  )
  if (operating) {
    return { name: operating.counterpartyName, via: operating.relationship }
  }
  return { name: company.canonicalName, via: 'brand_owner' }
}

/** Retained stakes in force as at a date, whoever holds them. */
export function retainedStakesAsOf(
  relationships: OrganizationRelationship[],
  date: string,
): OrganizationRelationship[] {
  return relationshipsAsOf(relationships, date).filter(
    (r) => r.relationship === 'minority_interest',
  )
}

/* ------------------------------------------------------------------ Labels */

export const RELATIONSHIP_LABEL: Record<OrganizationRelationshipType, string> = {
  parent_subsidiary: 'Parent',
  brand_owner: 'Brand owner',
  division: 'Division of',
  joint_venture: 'Joint venture with',
  franchise_bottler: 'Franchise bottler',
  co_manufacturer: 'Co-manufacturer',
  former_parent: 'Former parent',
  minority_interest: 'Retained minority interest',
}

/**
 * Render a half-open interval so the exclusivity is visible, not implied.
 *
 * "to 6 December" would be ambiguous about whether the sixth is included. The
 * interface says "until" and states the convention alongside, because a reader
 * who guesses wrong mis-attributes a project by one day.
 */
export function intervalLabel(
  relationship: Pick<OrganizationRelationship, 'fromDate' | 'toDate'>,
): string {
  const { fromDate, toDate } = relationship
  if (fromDate && toDate) return `${fromDate} until ${toDate}`
  if (fromDate) return `${fromDate} — present`
  if (toDate) return `until ${toDate}`
  return 'No dates recorded'
}

/** Machine-readable form, for a tooltip and for anyone reading the DOM. */
export function intervalNotation(
  relationship: Pick<OrganizationRelationship, 'fromDate' | 'toDate'>,
): string {
  const from = relationship.fromDate ?? '−∞'
  const to = relationship.toDate ?? '∞'
  return `[${from}, ${to})`
}

/**
 * Relevance-metric eligibility (D11).
 *
 * D11 is **Approved provisionally**: the four non-core classifications await
 * F&B market-leader confirmation. A provisionally classified company is excluded
 * from relevance metrics until then, so any count the interface presents as a
 * denominator has to filter on this.
 */
export function countsTowardRelevanceMetrics(
  company: Pick<Company, 'scopeClassStatus'>,
): boolean {
  return company.scopeClassStatus === 'confirmed'
}
