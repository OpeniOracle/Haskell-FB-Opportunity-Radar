/**
 * From a document to a defensible signal — or to nothing.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a keyword is not a signal.
 *
 * "Tyson announced a new partnership" contains "new". "PepsiCo expanded its
 * product line" contains "expanded". Both would light up a naive matcher and
 * neither is a construction lead. A single term appearing somewhere in a
 * 200-page 10-K carries no information at all — the form is REQUIRED to
 * discuss properties, so the word "facility" is guaranteed to be there.
 *
 * So a passage qualifies only when three independent things co-occur inside
 * one window of text:
 *
 *   1. a PROJECT ACTION   — building, expanding, converting, closing
 *   2. a PHYSICAL ASSET   — plant, facility, distribution centre, line
 *   3. a CORROBORATING FACT — an amount, a capacity, a named place, a date,
 *                             a job count, or square footage
 *
 * The third is what separates a plan from a mention. An announcement worth a
 * business-development call names something concrete; a passing reference does
 * not. Requiring it costs recall on genuinely vague announcements, which is the
 * correct trade for a system whose failure mode is wasting an analyst's day.
 *
 * WHAT IS STORED IS THE REASONING, NOT THE VERDICT. Every result carries the
 * matched terms, the character span, and the excerpt, so a reviewer can see
 * exactly what the machine read and disagree with it. A confidence that cannot
 * be audited is a number pretending to be a judgement.
 */

export type SignalFamilyCode =
  | 'facility_construction'
  | 'facility_expansion'
  | 'facility_modernization'
  | 'capacity_change'
  | 'distribution_logistics'
  | 'site_acquisition'
  | 'utility_infrastructure'
  | 'closure_consolidation'

export interface SignalPattern {
  readonly family: SignalFamilyCode
  readonly eventType: string
  readonly actions: readonly RegExp[]
  /** A negative signal is still a signal — a closure creates relocation work. */
  readonly negative?: boolean
}

const ASSET_TERMS =
  /\b(plant|facility|facilities|factory|manufactur\w*|production (?:site|line|facility)|distribution cent(?:er|re)|warehouse|processing (?:plant|facility)|campus|mill|bakery|brewery|bottling|cold storage|fulfil?lment cent(?:er|re)|complex|site)\b/i

/**
 * The corroborating fact. Any ONE of these turns a mention into a claim.
 *
 * Deliberately specific: "$300 million", "500,000 square feet", "in Bowling
 * Green, Kentucky", "by the end of 2026", "400 jobs". A vague future tense is
 * not corroboration.
 */
const CORROBORATION: readonly { readonly kind: string; readonly pattern: RegExp }[] = [
  { kind: 'investment_amount', pattern: /(?:US)?\$\s?\d[\d,.]*\s?(?:million|billion|m\b|bn\b)?/i },
  { kind: 'floor_area', pattern: /\b\d[\d,.]*\s?(?:square|sq\.?)\s?(?:feet|foot|ft|metres|meters|m)\b/i },
  { kind: 'job_count', pattern: /\b\d[\d,.]*\s?(?:new\s+)?(?:jobs|positions|employees|roles)\b/i },
  { kind: 'capacity', pattern: /\b\d[\d,.]*\s?(?:tons?|tonnes?|units?|cases?|pounds?|lbs?|litres?|liters?|gallons?)\b/i },
  { kind: 'named_place', pattern: /\bin\s+[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)*,\s*(?:[A-Z]{2}\b|[A-Z][a-z]+)/ },
  { kind: 'timeline', pattern: /\b(?:by|in|during|beginning|opening|complete[sd]?|commissioning)\s+(?:early |mid |late )?(?:20\d{2}|Q[1-4]\s?20\d{2}|the (?:first|second|third|fourth) (?:quarter|half))/i },
]

export const SIGNAL_PATTERNS: readonly SignalPattern[] = [
  {
    family: 'facility_construction',
    eventType: 'new_facility_announced',
    actions: [/\b(break(?:ing|s)? ground|groundbreaking|will build|to build|building a new|constructing|construction of|new (?:plant|facility|factory)|open(?:ing|ed)? a new)\b/i],
  },
  {
    family: 'facility_expansion',
    eventType: 'facility_expansion_announced',
    actions: [/\b(expand(?:ing|s|ed|sion)?|enlarg\w+|add(?:ing|s)? (?:a )?(?:new )?(?:line|capacity|space|square)|extension of)\b/i],
  },
  {
    family: 'facility_modernization',
    eventType: 'facility_modernization_announced',
    actions: [/\b(moderniz\w+|retrofit\w*|upgrad\w+|refurbish\w+|renovat\w+|automat\w+ (?:the|its) )\b/i],
  },
  {
    family: 'capacity_change',
    eventType: 'capacity_increase_announced',
    actions: [/\b(increase\w* (?:its |the )?(?:production |manufacturing )?capacity|double (?:its |the )?(?:output|capacity)|scal(?:e|ing) up (?:production|output))\b/i],
  },
  {
    family: 'distribution_logistics',
    eventType: 'distribution_investment_announced',
    actions: [/\b(distribution cent(?:er|re)|logistics (?:hub|cent(?:er|re)|network)|fulfil?lment cent(?:er|re)|cold[- ]chain)\b/i],
  },
  {
    family: 'site_acquisition',
    eventType: 'site_acquired',
    actions: [/\b(acquir\w+ (?:the |a )?(?:site|land|plant|facility)|purchas\w+ (?:the |a )?(?:site|land|plant|facility)|land purchase)\b/i],
  },
  {
    family: 'utility_infrastructure',
    eventType: 'infrastructure_investment_announced',
    actions: [/\b(wastewater|water treatment|substation|steam plant|boiler|cogeneration|solar array|energy (?:project|infrastructure)|utility (?:upgrade|infrastructure))\b/i],
  },
  {
    family: 'closure_consolidation',
    eventType: 'facility_closure_announced',
    negative: true,
    actions: [/\b(clos(?:e|ing|ure) (?:of )?(?:the |its )?(?:plant|facility|site)|shut(?:ting|s)? down|ceas(?:e|ing) (?:production|operations)|consolidat\w+ (?:its |the )?(?:operations|production|footprint)|exit(?:ing)? the (?:site|facility))\b/i],
  },
]

/** How much text counts as "the same statement". */
const WINDOW_CHARS = 420

export interface ClassificationMatch {
  readonly family: SignalFamilyCode
  readonly eventType: string
  readonly negative: boolean
  readonly excerpt: string
  readonly startOffset: number
  readonly endOffset: number
  readonly matchedAction: string
  readonly matchedAsset: string
  readonly corroboration: readonly { readonly kind: string; readonly value: string }[]
  readonly confidence: 'possible' | 'probable' | 'confirmed'
  readonly reasoning: string
}

export interface ClassificationResult {
  readonly matches: readonly ClassificationMatch[]
  /** Why nothing matched, when nothing did. Shown to an analyst, not swallowed. */
  readonly rejectionReason: string | null
}

/**
 * Confidence from what was actually observed, not from a model's certainty.
 *
 *   possible  — action + asset + one corroborating fact
 *   probable  — two or more corroborating facts, or an amount plus a place
 *   confirmed — never assigned here. A machine read of one document does not
 *               confirm anything; that requires a second independent source or
 *               an analyst, and both of those happen elsewhere.
 */
function gradeConfidence(
  corroboration: readonly { kind: string; value: string }[],
): 'possible' | 'probable' {
  if (corroboration.length >= 2) return 'probable'
  const kinds = new Set(corroboration.map((c) => c.kind))
  if (kinds.has('investment_amount') && kinds.has('named_place')) return 'probable'
  return 'possible'
}

export function classifyText(text: string): ClassificationResult {
  if (!text || text.trim().length < 40) {
    return { matches: [], rejectionReason: 'document carried too little text to evaluate' }
  }

  const matches: ClassificationMatch[] = []
  const seen = new Set<string>()
  let sawAction = false
  let sawAsset = false

  for (const pattern of SIGNAL_PATTERNS) {
    for (const action of pattern.actions) {
      const global = new RegExp(action.source, action.flags.includes('g') ? action.flags : `${action.flags}g`)
      for (const hit of text.matchAll(global)) {
        sawAction = true
        const at = hit.index ?? 0
        const start = Math.max(0, at - WINDOW_CHARS / 2)
        const end = Math.min(text.length, at + hit[0].length + WINDOW_CHARS / 2)
        const window = text.slice(start, end)

        const asset = ASSET_TERMS.exec(window)
        if (!asset) continue
        sawAsset = true

        const corroboration: { kind: string; value: string }[] = []
        for (const rule of CORROBORATION) {
          const found = rule.pattern.exec(window)
          if (found) corroboration.push({ kind: rule.kind, value: found[0].trim() })
        }
        if (corroboration.length === 0) continue

        // One statement, matched by two overlapping patterns, is one match.
        const key = `${pattern.family}:${Math.floor(start / 100)}`
        if (seen.has(key)) continue
        seen.add(key)

        const confidence = gradeConfidence(corroboration)
        matches.push({
          family: pattern.family,
          eventType: pattern.eventType,
          negative: pattern.negative ?? false,
          excerpt: window.trim(),
          startOffset: start,
          endOffset: end,
          matchedAction: hit[0],
          matchedAsset: asset[0],
          corroboration,
          confidence,
          reasoning:
            `Matched the action "${hit[0]}" against the asset "${asset[0]}" within ${WINDOW_CHARS} characters, ` +
            `corroborated by ${corroboration.map((c) => `${c.kind} (${c.value})`).join(', ')}. ` +
            `Graded ${confidence}: a single document read by a machine is never graded confirmed.`,
        })
      }
    }
  }

  if (matches.length > 0) return { matches, rejectionReason: null }

  // Say WHICH of the three requirements failed. "No match" tells a reviewer
  // nothing about whether the classifier is too strict or the document is
  // genuinely irrelevant.
  if (!sawAction) {
    return { matches: [], rejectionReason: 'no project action term appeared in the document' }
  }
  if (!sawAsset) {
    return {
      matches: [],
      rejectionReason: 'a project action appeared but never near a physical asset — the mention is not about a site',
    }
  }
  return {
    matches: [],
    rejectionReason:
      'a project action appeared near an asset but with no corroborating amount, capacity, place, timeline or job count — a mention rather than an announcement',
  }
}

/**
 * A stable identity for "the same announcement", so a filing, its exhibit and
 * a newsroom repost collapse into one signal instead of three.
 */
export function clusterKey(input: {
  organizationEntityKey: string
  family: SignalFamilyCode
  eventDate: string | null
  matchedAsset: string
}): string {
  const month = input.eventDate ? input.eventDate.slice(0, 7) : 'undated'
  const asset = input.matchedAsset.toLowerCase().replace(/[^a-z]+/g, '')
  return `${input.organizationEntityKey}|${input.family}|${month}|${asset}`
}
