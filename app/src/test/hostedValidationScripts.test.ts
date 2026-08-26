import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'

/**
 * The operator scripts, held to their own promises.
 *
 * These scripts are the one place a human handles the two confidential values
 * on this project, and they run on a machine nobody here can inspect. What
 * makes them safe is not that they were written carefully once, but that the
 * properties they claim are asserted:
 *
 *   - nothing confidential is a parameter, an environment variable, or an argv
 *   - nothing confidential reaches a file, shell history, or the process table
 *   - both scripts refuse to run where output is being recorded
 *   - both refuse to run against a tree that is not the pull request
 *   - the canary they create is removed whatever happens
 *
 * The earlier procedure told the operator to `export TOKEN=…`, which put a
 * bearer credential in the shell environment and the command that set it in
 * `.bash_history`. The last block here is what stops that instruction coming
 * back.
 */
const ROOT = join(APP_ROOT, '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

const ps = read('scripts/Invoke-HostedValidation.ps1')
const sh = read('scripts/hosted-validation.sh')
const runbook = read('docs/HOSTED_VALIDATION_RUNBOOK.md')

const scripts: [string, string][] = [
  ['Invoke-HostedValidation.ps1', ps],
  ['hosted-validation.sh', sh],
]

/**
 * Comments are not code. Several assertions below look for a dangerous
 * construct, and both scripts explain in prose why they avoid it — which would
 * otherwise read as the construct being present.
 */
const codeOnly = (text: string) =>
  text
    .replace(/<#[\s\S]*?#>/g, '')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s#(?![{])[^'"]*$/, ''))
    .join('\n')

/**
 * A deliberately INVALID token both scripts send to prove a well-formed
 * signature-less JWT is refused. Its payload is `{"sub":"none"}` and its
 * "signature" is the base64 of `not-a-signature`. Exempted by exact value so
 * the no-JWT assertion stays meaningful for everything else.
 */
const PROBE_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJub25lIn0.bm90LWEtc2lnbmF0dXJl'

describe('hosted validation scripts — secret handling', () => {
  it('prompts for both values with the input hidden', () => {
    expect(ps).toMatch(/Read-Host\s+-Prompt\s+\$Prompt\s+-AsSecureString/)
    expect(sh).toMatch(/read\s+-rs\s+TOKEN/)
    expect(sh).toMatch(/read\s+-rs\s+SECRET/)
  })

  it('takes neither value as a parameter or an environment variable', () => {
    // A parameter lands in shell history; an environment variable is readable
    // by every child process and by anything that dumps the environment.
    expect(ps).not.toMatch(/\$env:(TOKEN|SECRET|SUPABASE_SECRET_KEY)/)
    expect(ps).not.toMatch(/param\([\s\S]*?\$(Token|Secret)\b/)
    expect(sh).not.toMatch(/\$\{TOKEN:[?-]/)
    expect(sh).not.toMatch(/\$\{SECRET:[?-]/)
    // Assignment from the environment, e.g. TOKEN="${TOKEN:-…}".
    expect(sh).not.toMatch(/^\s*(TOKEN|SECRET)="\$\{/m)
    expect(sh).not.toMatch(/^\s*export\s+(TOKEN|SECRET)/m)
  })

  it('never puts a credential in the process table', () => {
    // `curl -H "Authorization: Bearer $TOKEN"` is visible in `ps` to every user
    // on the machine. The request is handed to curl on stdin instead.
    const shCode = codeOnly(sh)
    expect(shCode).toContain('curl --config -')
    expect(shCode).not.toMatch(/curl[^\n]*-H\s+["'][^"'\n]*\$(TOKEN|SECRET)/)
    expect(shCode).not.toMatch(/curl[^\n]*\$(TOKEN|SECRET)/)
    // Redaction by parameter expansion, not by a sed script — which would be
    // an argv carrying the very value it is hiding.
    expect(shCode).toMatch(/\$\{text\/\/\$TOKEN\/<TOKEN>\}/)
    expect(shCode).not.toMatch(/sed[^\n]*\$(TOKEN|SECRET)/)
  })

  it('writes neither value to a file', () => {
    for (const [name, text] of scripts) {
      expect(text, `${name} must not create a temporary file`).not.toMatch(
        /\bmktemp\b|New-TemporaryFile|\[IO\.Path\]::GetTempFileName/,
      )
      expect(text, `${name} must not redirect a credential to a file`).not.toMatch(
        /(Out-File|Set-Content|Add-Content)[^\n]*\$(script:)?(Token|Secret)/i,
      )
      expect(text, `${name} must not redirect a credential with > or >>`).not.toMatch(
        /\$\{?(TOKEN|SECRET)\}?"?\s*>>?\s*[^&\s]/,
      )
    }
    // curl's own on-disk surfaces.
    expect(sh).not.toMatch(/--(cookie-jar|trace|trace-ascii|dump-header)\b/)
    expect(sh).not.toMatch(/-D\s+\S/)
  })

  it('refuses to run where the output would be captured', () => {
    expect(ps).toContain('$VerbosePreference')
    expect(ps).toContain('$DebugPreference')
    expect(ps).toContain('Get-PSBreakpoint')
    expect(ps).toContain('Stop-Transcript')
    expect(ps).toContain('Set-PSDebug -Off')
    expect(sh).toMatch(/case\s+"\$-"\s+in[\s\S]*?\*x\*\)/)
    expect(sh).toMatch(/\*v\*\)/)
    expect(sh).toContain('BASH_XTRACEFD')
    expect(sh).toContain('set +o history')
  })

  it('clears both values on success, failure and interruption', () => {
    expect(ps).toMatch(/function Clear-Secrets/)
    expect(ps).toMatch(/finally\s*\{[\s\S]*?Clear-Secrets/)
    expect(ps).toContain('PowerShell.Exiting')
    expect(sh).toMatch(/trap cleanup EXIT INT TERM HUP/)
    expect(sh).toMatch(/unset TOKEN SECRET/)
  })

  it('holds the PowerShell values as SecureString, materialised per request', () => {
    expect(ps).toContain('-AsSecureString')
    expect(ps).toContain('SecureStringToBSTR')
    // The BSTR must be zeroed, not merely dropped.
    expect(ps).toContain('ZeroFreeBSTR')
    expect(ps).toMatch(/function Use-Plain/)
  })

  it('contains no secret of its own', () => {
    for (const [name, text] of scripts) {
      expect(text, `${name} must carry no secret key`).not.toMatch(/sb_secret_[A-Za-z0-9]/)
      // Everything JWT-shaped must be the invalid probe and nothing else.
      const jwts = text.match(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g) ?? []
      expect(new Set(jwts), `${name} carries a JWT that is not the probe`).toEqual(
        jwts.length ? new Set([PROBE_TOKEN]) : new Set(),
      )
      // The publishable key IS committed here, on purpose, and is labelled.
      expect(text).toContain('sb_publishable_')
      expect(text).toMatch(/[Nn]ot secret|not confidential|grants nothing/)
    }
  })
})

describe('hosted validation scripts — repository guard', () => {
  it('refuses a repository other than this one', () => {
    for (const [name, text] of scripts) {
      expect(text, name).toContain('OpeniOracle/Haskell-FB-Opportunity-Radar')
      expect(text, name).toMatch(/remote get-url origin/)
    }
  })

  it('refuses a dirty working tree', () => {
    for (const [name, text] of scripts) {
      expect(text, name).toMatch(/status --porcelain/)
    }
  })

  it("refuses a checkout that is not PR #9's head", () => {
    for (const [name, text] of scripts) {
      // The head branch of PR #9 — NOT the old design branch.
      expect(text, name).toContain('claude/production-foundation')
      expect(text, name).not.toContain('master-prompt-setup')
      expect(text, name).toMatch(/fetch origin/)
      expect(text, name).toMatch(/FETCH_HEAD/)
    }
  })

  it('guards before it prompts, so a wrong tree never sees a credential', () => {
    const psGuard = ps.indexOf('Assert-CorrectCheckout\n')
    const psPrompt = ps.indexOf('Read-SecretValue ')
    expect(psGuard).toBeGreaterThan(-1)
    expect(psPrompt).toBeGreaterThan(psGuard)

    const shGuard = sh.indexOf('HEAD matches origin/$BRANCH')
    const shPrompt = sh.indexOf('read -rs TOKEN')
    expect(shGuard).toBeGreaterThan(-1)
    expect(shPrompt).toBeGreaterThan(shGuard)
  })
})

describe('hosted validation scripts — canary lifecycle', () => {
  it('creates a canary unique to the run', () => {
    expect(ps).toMatch(/\[guid\]::NewGuid\(\)/)
    expect(sh).toMatch(/CANARY_ARCHIVED="\$\(uuid\)"/)
    // No fixed identifier anywhere: a hard-coded canary id collides between
    // runs and survives a crash.
    for (const [name, text] of scripts) {
      expect(text, `${name} must not hard-code a canary uuid`).not.toMatch(
        /['"](4{8}|5{8}|6{8})-/,
      )
    }
  })

  it('removes the canary whatever happens', () => {
    expect(ps).toMatch(/finally\s*\{[\s\S]*?9\. Canary cleanup/)
    expect(ps).toMatch(/Method DELETE[\s\S]*?rest\/v1\/evidence/)
    expect(sh).toMatch(/cleanup\(\)[\s\S]*?9\. Canary cleanup/)
    expect(sh).toMatch(/http DELETE "\$SUPABASE_URL\/rest\/v1\/evidence/)
    for (const [name, text] of scripts) {
      expect(text, `${name} must prove the rows are gone`).toMatch(/no evidence rows remain/)
      expect(text, `${name} must prove the runs are gone`).toMatch(/no collection runs remain/)
      expect(text, `${name} must prove the object is gone`).toMatch(/and it is gone/)
    }
  })
})

describe('hosted validation scripts — the two runs are comparable', () => {
  const labelsFrom = (text: string, pattern: RegExp) => {
    const found = new Set<string>()
    for (const match of text.matchAll(pattern)) found.add(match[1]!.trim())
    return found
  }

  it('check the same things under the same names', () => {
    // PowerShell labels are single-quoted, except where the label itself
    // contains a quote.
    const psLabels = new Set([
      ...labelsFrom(ps, /\bCheck\s+'([^']+)'/g),
      ...labelsFrom(ps, /\bCheck\s+"([^"$]+)"/g),
    ])
    const shLabels = labelsFrom(sh, /\bcheck\s+"([^"$]+)"/g)
    expect(psLabels.size).toBeGreaterThan(25)

    const onlyInPs = [...psLabels].filter((l) => !shLabels.has(l)).sort()
    const onlyInSh = [...shLabels].filter((l) => !psLabels.has(l)).sort()
    expect(onlyInPs, 'checks the Bash script is missing').toEqual([])
    expect(onlyInSh, 'checks the PowerShell script is missing').toEqual([])
  })

  it('both treat post-sign-out /api/status as informational, not as a pass', () => {
    // Asserting a value there would be asserting a platform behaviour this
    // project does not control and does not change. See ADR 0015.
    for (const [name, text] of scripts) {
      expect(text, name).toMatch(/informational — \/api\/status after sign-out/)
      expect(text, name).toMatch(/property of \/api\/evidence only/)
    }
  })

  it('both prove the token had not merely expired when it was refused', () => {
    for (const [name, text] of scripts) {
      expect(text, name).toContain('and the token had not merely expired')
    }
  })
})

describe('the runbook no longer teaches shell-history exposure', () => {
  it('gives no command that assigns a credential', () => {
    const fenced = runbook.match(/```[\s\S]*?```/g) ?? []
    for (const block of fenced) {
      expect(block, 'a code block assigns TOKEN or SECRET').not.toMatch(
        /^\s*(export|set|\$env:)\s*(TOKEN|SECRET)\s*=/m,
      )
      expect(block).not.toMatch(/^\s*(TOKEN|SECRET)=/m)
    }
  })

  it('says why, so the instruction does not come back', () => {
    expect(runbook).toMatch(/shell history|ConsoleHost_history|bash_history/i)
  })

  it('points at the PowerShell script first', () => {
    expect(runbook).toMatch(/PowerShell is the\s*\n?primary procedure/)
    expect(runbook.indexOf('Invoke-HostedValidation.ps1')).toBeLessThan(
      runbook.indexOf('bash scripts/hosted-validation.sh'),
    )
  })

  it('names PR #9’s actual head branch', () => {
    expect(runbook).toContain('claude/production-foundation')
    expect(runbook).not.toContain('master-prompt-setup')
  })
})
