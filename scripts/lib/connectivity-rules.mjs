/**
 * The connectivity decision, as data and one pure function.
 *
 * ------------------------------------------------------------------ why
 *
 * The pre-flight script used to count every probe the same way: any non-200
 * incremented a failure counter and the script exited 1. So when Mars answered
 * 200 on robots.txt, 200 on the newsroom index and 200 on the sitemap, but 404
 * on one guessed RSS path, the operator was told the check FAILED -- on a
 * source that is completely viable.
 *
 * THE CONNECTOR NEVER HAD THIS BUG. `discoverMars` walks feed -> sitemap ->
 * index, records each miss in `attempts`, and continues; it only reports
 * `unavailable` or `manual_review_required` when NOTHING was discovered by any
 * path. The pre-flight was stricter than the thing it was supposed to predict,
 * which is the worst direction for a check to be wrong in: it argues for
 * disabling a source that works.
 *
 * So candidates have a ROLE, and the verdict is computed from the roles.
 *
 * ------------------------------------------------------------ the rules
 *
 *   required   Every one must answer. For SEC these are the documented APIs
 *              the connector calls unconditionally. For Mars it is robots.txt.
 *
 *   discovery  Optional, and tried in order until one works. ONE is enough.
 *              Each one that does not answer is a WARNING, never a failure --
 *              a guessed URL being wrong is information about the guess.
 *
 * A source is viable when every `required` candidate answered AND at least one
 * `discovery` candidate answered.
 *
 * --------------------------------------------- why robots.txt is required
 *
 * This is deliberately STRICTER than the connector, which treats an
 * unreachable robots.txt as "no policy" and proceeds. A pre-flight that passed
 * while robots.txt was unreachable would greenlight a run whose compliance
 * posture is unknown, and the whole point of running this before a backfill is
 * to find that out first. The asymmetry is intentional and is stated in the
 * runbook rather than left for someone to discover.
 */

/**
 * Confirmed dead, by observation, and therefore not a candidate anywhere.
 *
 * A retired URL earns its place here with a date and an observed status. This
 * list is what stops a dead guess reappearing in the seed, the connector
 * defaults, or either script -- `sourceConnectivity.test.ts` fails if any of
 * them names one.
 */
export const RETIRED_CANDIDATES = [
  {
    url: 'https://www.mars.com/rss.xml',
    observed: 'HTTP 404',
    on: '2026-09-13',
    by: 'operator, from a network with direct egress',
  },
]

/**
 * Every endpoint the pre-flight checks, with the role that decides its weight.
 *
 * `expect` is a string the body must contain for a 200 to count. Empty means
 * any 200 counts -- used where the shape is not ours to predict.
 */
export const PROBES = {
  'sec-edgar': [
    {
      label: 'company_tickers.json',
      url: 'https://www.sec.gov/files/company_tickers.json',
      role: 'required',
      expect: 'cik_str',
    },
    {
      label: 'submissions API',
      url: 'https://data.sec.gov/submissions/CIK0000100493.json',
      role: 'required',
      expect: 'filings',
    },
    {
      label: 'archive folder index',
      url: 'https://www.sec.gov/Archives/edgar/data/100493/',
      role: 'required',
      expect: '',
    },
  ],
  'mars-newsroom': [
    {
      label: 'robots.txt',
      url: 'https://www.mars.com/robots.txt',
      role: 'required',
      expect: '',
    },
    // Tried in the connector's own order: feed, then sitemap, then index.
    {
      label: 'feed candidate (news-and-stories/rss)',
      url: 'https://www.mars.com/news-and-stories/rss',
      role: 'discovery',
      kind: 'feed',
      expect: '',
    },
    { label: 'feed candidate (feed)', url: 'https://www.mars.com/feed', role: 'discovery', kind: 'feed', expect: '' },
    {
      label: 'sitemap candidate',
      url: 'https://www.mars.com/sitemap.xml',
      role: 'discovery',
      kind: 'sitemap',
      expect: '',
    },
    {
      label: 'newsroom index',
      url: 'https://www.mars.com/news-and-stories',
      role: 'discovery',
      kind: 'index',
      expect: '',
    },
    { label: 'index candidate (news)', url: 'https://www.mars.com/news', role: 'discovery', kind: 'index', expect: '' },
    {
      label: 'index candidate (press-releases)',
      url: 'https://www.mars.com/press-releases',
      role: 'discovery',
      kind: 'index',
      expect: '',
    },
  ],
}

export const CHALLENGE_MARKERS =
  /captcha|verify you are human|checking your browser|incapsula|attention required/i

/**
 * What one probe means. Status and body in, one word out.
 *
 * `local_network` is separated from every other failure on purpose. A proxy
 * denying CONNECT and a source returning 403 are the same "it did not work"
 * from the operator's chair and completely different problems, and conflating
 * them is how somebody disables a working source because of a firewall.
 */
export function classifyProbe({ status, body = '', transportError = null }) {
  if (status === 0 || status === null || status === undefined) {
    if (transportError && /proxy|tunnel|407|firewall|forbidden by/i.test(transportError)) {
      return 'local_network'
    }
    return 'unreachable'
  }
  if (status === 200) return 'ok'
  if (status === 301 || status === 302 || status === 307 || status === 308) return 'redirect'
  if (status === 404) return 'absent'
  if (status === 429) return 'rate_limited'
  if (status === 403 || status === 503) {
    return CHALLENGE_MARKERS.test(body) ? 'challenge' : 'refused'
  }
  return 'unexpected'
}

/** A 200 whose body does not carry what the connector needs is not an `ok`. */
export function applyExpectation(outcome, { body = '', expect = '' }) {
  if (outcome !== 'ok' || !expect) return outcome
  return body.includes(expect) ? 'ok' : 'unexpected'
}

const USABLE = new Set(['ok'])
/** Inconclusive, not dead: the connector follows redirects and re-checks per hop. */
const INCONCLUSIVE = new Set(['redirect', 'local_network', 'unreachable', 'rate_limited'])

/**
 * The verdict for one source.
 *
 * `results` is [{ label, url, role, outcome }].
 *
 * Returns:
 *   viable      every required probe answered and >= 1 discovery probe did
 *   blockers    required probes that did not answer
 *   warnings    discovery probes that did not answer -- never fatal alone
 *   attribution 'source' | 'local_network' | null -- WHOSE refusal this was
 *   challenges  discovery or required probes that hit an interstitial
 */
export function sourceVerdict(results) {
  const required = results.filter((r) => r.role === 'required')
  const discovery = results.filter((r) => r.role === 'discovery')

  const blockers = required.filter((r) => !USABLE.has(r.outcome))
  const usableDiscovery = discovery.filter((r) => USABLE.has(r.outcome))
  const warnings = discovery.filter((r) => !USABLE.has(r.outcome))
  const challenges = results.filter((r) => r.outcome === 'challenge')

  /*
     WHOSE REFUSAL WAS IT. If everything that failed failed for a reason that
     is about this machine, the run says nothing about the source and must not
     read as a verdict on it. Only when a real HTTP answer came back is the
     source itself implicated.
  */
  const failures = [...blockers, ...warnings]
  const allLocal = failures.length > 0 && failures.every((r) => r.outcome === 'local_network')
  const anyAnswered = results.some((r) => !INCONCLUSIVE.has(r.outcome))

  let attribution = null
  if (failures.length > 0) attribution = allLocal || !anyAnswered ? 'local_network' : 'source'

  const viable = blockers.length === 0 && (discovery.length === 0 || usableDiscovery.length > 0)

  return {
    viable,
    blockers,
    warnings,
    challenges,
    usableDiscovery,
    attribution,
    /*
       A source with no usable discovery path is NOT automatically dead. If the
       failures are all local, the honest answer is "this machine cannot tell",
       and the runbook says so rather than proposing that a source be disabled.
    */
    conclusive: attribution !== 'local_network',
  }
}

/** 0 only when every source is viable, or the only problem is this machine. */
export function exitCode(verdicts) {
  const decisive = Object.values(verdicts).filter((v) => v.conclusive)
  return decisive.every((v) => v.viable) ? 0 : 1
}
