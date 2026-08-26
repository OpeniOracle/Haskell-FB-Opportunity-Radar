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
const invite = read('scripts/Send-BootstrapInvitation.ps1')
const guards = read('scripts/OperatorGuards.psm1')
const runbook = read('docs/HOSTED_VALIDATION_RUNBOOK.md')

/** The two validators, which run the same named checks as each other. */
const scripts: [string, string][] = [
  ['Invoke-HostedValidation.ps1', ps],
  ['hosted-validation.sh', sh],
]

/** Every script that handles the Supabase secret key. */
const operatorScripts: [string, string][] = [
  ['Invoke-HostedValidation.ps1', ps],
  ['hosted-validation.sh', sh],
  ['Send-BootstrapInvitation.ps1', invite],
]

/** The exact preview callback the bootstrap invitation must name. */
const PREVIEW_CALLBACK =
  'https://deploy-preview-9--haskell-fb-opportunity-radar.netlify.app/auth/callback'

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
    expect(guards).toMatch(/Read-Host\s+-Prompt\s+\$Prompt\s+-AsSecureString/)
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
    // PowerShell's half is in the shared module; see the parity block below for
    // the assertion that both scripts actually import it.
    expect(guards).toContain('$VerbosePreference')
    expect(guards).toContain('$DebugPreference')
    expect(guards).toContain('Get-PSBreakpoint')
    expect(guards).toContain('Stop-Transcript')
    expect(guards).toContain('Set-PSDebug -Off')
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
    expect(guards).toContain('-AsSecureString')
    expect(guards).toContain('SecureStringToBSTR')
    // The BSTR must be zeroed, not merely dropped.
    expect(guards).toContain('ZeroFreeBSTR')
    expect(guards).toMatch(/function Use-Plain/)
    // And every PowerShell script must go through it rather than converting a
    // SecureString itself.
    for (const [name, text] of [
      ['Invoke-HostedValidation.ps1', ps],
      ['Send-BootstrapInvitation.ps1', invite],
    ] as const) {
      expect(text, name).toMatch(/Use-Plain -Secure/)
      expect(text, `${name} must not marshal a SecureString itself`).not.toContain(
        'SecureStringToBSTR',
      )
    }
  })

  it('contains no secret of its own', () => {
    for (const [name, text] of operatorScripts) {
      expect(text, `${name} must carry no secret key`).not.toMatch(/sb_secret_[A-Za-z0-9]/)
      // Everything JWT-shaped must be the invalid probe and nothing else.
      const jwts = text.match(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g) ?? []
      expect(new Set(jwts), `${name} carries a JWT that is not the probe`).toEqual(
        jwts.length ? new Set([PROBE_TOKEN]) : new Set(),
      )
      // The publishable key IS committed in the validators, on purpose, and is
      // labelled. The invitation helper never needs it: it acts as the server.
      if (text.includes('sb_publishable_')) {
        expect(text, `${name} must label the publishable key`).toMatch(
          /[Nn]ot secret|not confidential|grants nothing/,
        )
      }
    }
  })
})

describe('hosted validation scripts — repository guard', () => {
  it('refuses a repository other than this one', () => {
    // The bash validator carries its own copy; the PowerShell scripts share the
    // module. Both spellings are checked, in the place each one lives.
    expect(sh).toMatch(/remote get-url origin/)
    expect(guards).toMatch(/remote get-url origin/)
    for (const [name, text] of operatorScripts) {
      expect(text, name).toContain('OpeniOracle/Haskell-FB-Opportunity-Radar')
    }
  })

  it('refuses a dirty working tree', () => {
    expect(sh).toMatch(/status --porcelain/)
    expect(guards).toMatch(/status --porcelain/)
  })

  it("refuses a checkout that is not PR #9's head", () => {
    for (const [name, text] of operatorScripts) {
      // The head branch of PR #9 — NOT the old design branch.
      expect(text, name).toContain('claude/production-foundation')
      expect(text, name).not.toContain('master-prompt-setup')
    }
    for (const [name, text] of [['hosted-validation.sh', sh], ['OperatorGuards.psm1', guards]] as const) {
      expect(text, name).toMatch(/fetch origin/)
      expect(text, name).toMatch(/FETCH_HEAD/)
    }
  })

  it('guards before it prompts, so a wrong tree never sees a credential', () => {
    for (const [name, text] of [
      ['Invoke-HostedValidation.ps1', ps],
      ['Send-BootstrapInvitation.ps1', invite],
    ] as const) {
      const guard = text.indexOf('Assert-CorrectCheckout -Repository')
      const prompt = text.indexOf('Read-SecretValue -Prompt')
      expect(guard, `${name} must guard the checkout`).toBeGreaterThan(-1)
      expect(prompt, `${name} must prompt for a secret`).toBeGreaterThan(guard)
    }

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
      expect(text, name).toMatch(/informational (--|\u2014) \/api\/status after sign-out/)
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

// ---------------------------------------------------------------------------

describe('the guards are shared, not merely similar', () => {
  it('defines the repository and observation checks exactly once', () => {
    for (const check of [
      'function Assert-NoObservation',
      'function Assert-CorrectCheckout',
      'function Read-SecretValue',
      'function Use-Plain',
    ]) {
      expect(guards, `OperatorGuards.psm1 must define ${check}`).toContain(check)
      // A second definition in a script would be a copy that can drift, and a
      // guard that exists in two places gets strengthened in one.
      expect(ps, `Invoke-HostedValidation.ps1 must not redefine ${check}`).not.toContain(check)
      expect(invite, `Send-BootstrapInvitation.ps1 must not redefine ${check}`).not.toContain(check)
    }
  })

  it('is imported by both PowerShell scripts', () => {
    for (const [name, text] of [
      ['Invoke-HostedValidation.ps1', ps],
      ['Send-BootstrapInvitation.ps1', invite],
    ] as const) {
      expect(text, name).toMatch(/Import-Module \(Join-Path \$PSScriptRoot 'OperatorGuards\.psm1'\)/)
      expect(text, name).toContain('Assert-NoObservation')
      expect(text, name).toContain('Assert-CorrectCheckout')
    }
  })

  it("survives git writing its normal progress to stderr", () => {
    // `git fetch` announces "From https://github.com/..." on stderr on every
    // SUCCESSFUL fetch. Windows PowerShell 5.1 turns a native command's stderr
    // into an ErrorRecord, and under $ErrorActionPreference = 'Stop' that
    // becomes a terminating error even though git exited 0 -- so the script
    // aborted with the fetch banner as its reason, right after passing the
    // branch check. PowerShell 7 does not do this, so nothing running on 7 can
    // see it.
    const body = /function Invoke-OperatorGit \{[\s\S]*?\n\}/.exec(guards)?.[0] ?? ''
    expect(body, 'Invoke-OperatorGit must not be left at the caller preference').toMatch(
      /\$ErrorActionPreference = 'Continue'/,
    )
    expect(body, 'the caller preference must be restored').toMatch(
      /finally \{[\s\S]*?\$ErrorActionPreference = \$previous/,
    )
    // The exit code has to be captured before the next statement overwrites it.
    expect(body).toMatch(/\$code = \$LASTEXITCODE/)
    expect(body, 'stderr lines arrive as ErrorRecords and must be flattened').toMatch(
      /ForEach-Object \{ \$_\.ToString\(\) \}/,
    )
  })

  it('checks the repository, the tree, the branch and the remote head', () => {
    expect(guards).toMatch(/remote get-url origin/)
    expect(guards).toMatch(/status --porcelain/)
    expect(guards).toMatch(/rev-parse --abbrev-ref HEAD/)
    expect(guards).toMatch(/fetch origin/)
    expect(guards).toMatch(/FETCH_HEAD/)
  })

  it('refuses every way the console could be recorded', () => {
    expect(guards).toContain('$VerbosePreference')
    expect(guards).toContain('$DebugPreference')
    expect(guards).toContain('Get-PSBreakpoint')
    expect(guards).toContain('PSDebugContext')
    expect(guards).toContain('PSDefaultParameterValues')
    expect(guards).toContain('Stop-Transcript')
    expect(guards).toContain('Set-PSDebug -Off')
  })
})

describe('the bootstrap invitation helper', () => {
  it('takes the address visibly and the secret invisibly', () => {
    // The address is not a credential and the operator must be able to see they
    // typed it correctly before an email goes anywhere.
    expect(invite).toMatch(/Read-Host -Prompt 'Openi email address to invite'/)
    expect(invite).not.toMatch(/Read-Host[^\n]*email[^\n]*-AsSecureString/i)
    // The key is never visible and never leaves SecureString except inside
    // Use-Plain.
    expect(invite).toMatch(/Read-SecretValue -Prompt 'Supabase secret key/)
    expect(invite).toMatch(/Use-Plain -Secure \$script:SecretSecure/)
  })

  it('never accepts the secret through any channel but the prompt', () => {
    // Not a parameter…
    expect(invite).not.toMatch(/param\([\s\S]*?\$(Secret|Key|Token)\b/)
    // …not an environment variable…
    expect(invite).not.toMatch(/\$env:(SUPABASE_SECRET_KEY|SECRET|SB|TOKEN)/)
    // …and not a file.
    expect(invite).not.toMatch(/\bmktemp\b|New-TemporaryFile|GetTempFileName/)
    expect(invite).not.toMatch(/(Out-File|Set-Content|Add-Content)[^\n]*\$script:SecretSecure/)
  })

  it('clears the secret on every exit path', () => {
    expect(invite).toMatch(/function Clear-Secrets/)
    expect(invite).toMatch(/finally \{[\s\S]*?Clear-Secrets/)
    expect(invite).toContain('PowerShell.Exiting')
    expect(invite).toContain('Dispose()')
    // The unmanaged buffer is zeroed in the shared module, which is the only
    // place a SecureString is ever marshalled.
    expect(guards).toContain('ZeroFreeBSTR')
  })

  it('names the preview callback exactly, and does not let it be overridden', () => {
    expect(invite).toContain(PREVIEW_CALLBACK)
    // A constant, not a parameter: a redirect that can be overridden on the
    // command line is one that will eventually be overridden back to the
    // production Site URL, which is the bug this script exists to avoid.
    const paramBlock = /^param\(([\s\S]*?)^\)/m.exec(invite)?.[1] ?? ''
    expect(paramBlock).not.toMatch(/RedirectTo|Redirect|Callback/i)
    expect(invite).toMatch(/\$RedirectTo = '/)
    expect(invite).toMatch(/redirectTo = \$RedirectTo/)
    // Production must never be the destination while PR #9 is unmerged.
    expect(invite).not.toMatch(/redirectTo[^\n]*https:\/\/haskell-fb-opportunity-radar\.netlify\.app/)
  })

  it('posts to the trusted Admin invitation endpoint', () => {
    expect(invite).toMatch(/-Method POST -Path '\/auth\/v1\/invite'/)
    expect(invite).toMatch(/Authorization = "Bearer \$key"/)
    expect(invite).toMatch(/apikey = \$key/)
  })

  it('refuses the reserved SEC mailbox before a secret is even typed', () => {
    expect(invite).toContain('oracles@openi-analytics.com')
    expect(invite).toMatch(/\$normalised -eq \$ReservedAddress/)
    // Order matters: the address is taken and checked in section 1, the key in
    // section 2. A refusal must not cost the operator a credential entry.
    expect(invite.indexOf('$ReservedAddress')).toBeLessThan(
      invite.indexOf("Read-SecretValue -Prompt 'Supabase secret key"),
    )
  })

  it('requires an existing allowlist entry before inviting', () => {
    expect(invite).toMatch(/rest\/v1\/auth_invite_allowlist\?select=email_normalized&email_normalized=eq\./)
    expect(invite).toMatch(/is not on auth_invite_allowlist/)
    // The address goes into a URL, so it must be encoded rather than pasted.
    expect(invite).toContain('[uri]::EscapeDataString($normalised)')
  })

  it('refuses an address a confirmed account already occupies', () => {
    expect(invite).toMatch(/admin\/users/)
    expect(invite).toContain('email_confirmed_at')
    expect(invite).toContain('confirmed_at')
    expect(invite).toMatch(/already exists and has been confirmed/)
    // An UNCONFIRMED invitation is exactly the thing worth resending.
    expect(invite).toMatch(/unconfirmed invitation already exists/)
  })

  it('prints no secret, no link, no token and no response body', () => {
    expect(invite).toMatch(/function Protect-Text/)
    expect(invite).toMatch(/'<SECRET>'/)

    // Every Write-Host argument, checked for a value that must never be shown.
    const printed = invite.match(/Write-Host[^\n]*/g) ?? []
    for (const line of printed) {
      for (const forbidden of [
        '$key',
        '$script:SecretSecure',
        '$invite.Body',
        '$users.Body',
        '$allow.Body',
        '$payload',
        'action_link',
        'ConfirmationURL',
      ]) {
        expect(line, `Write-Host must not print ${forbidden}`).not.toContain(forbidden)
      }
    }
    // The one place a Supabase body is surfaced at all is redacted, and capped
    // so a long body cannot smuggle something past a skim.
    expect(invite).toMatch(/\$reason = Protect-Text \$invite\.Body/)
    expect(invite).toMatch(/Substring\(0, 300\)/)
    // The response carries a full user record; only two fields are read.
    expect(invite).toMatch(/ConvertFrom-Json\)\.email/)
  })

  it('says plainly why the dashboard button is not used', () => {
    expect(invite).toMatch(/Site URL/)
    expect(invite).toMatch(/unmerged/)
  })
})

describe('the runbook stops recommending the dashboard invite button', () => {
  it('points at the helper as the primary procedure', () => {
    expect(runbook).toContain('Send-BootstrapInvitation.ps1')
    expect(runbook).toContain(PREVIEW_CALLBACK)
  })

  it('does not tell the operator to press Invite user', () => {
    const fenced = runbook.match(/```[\s\S]*?```/g) ?? []
    for (const block of fenced) {
      expect(block).not.toMatch(/Invite user/i)
    }
    // Where the phrase appears at all it must be either a warning about the
    // dashboard action, or a reference to the email TEMPLATE of that name —
    // which is a different thing and does have to be inspected.
    // By paragraph, not by line: prose wraps, and a qualification three words
    // into the next line is still a qualification.
    for (const paragraph of runbook.split(/\n\s*\n/)) {
      if (!/Invite user/i.test(paragraph)) continue
      expect(paragraph, `unqualified mention: "${paragraph.trim().slice(0, 90)}…"`).toMatch(
        /Do not use|never used|Site URL|template|TEMPLATES|instead|see step 2/i,
      )
    }
  })
})

// ---------------------------------------------------------------------------

describe('the operator scripts are readable by Windows PowerShell 5.1', () => {
  /**
   * WHY THIS TEST EXISTS.
   *
   * Windows PowerShell 5.1 reads a `.ps1` or `.psm1` file WITHOUT a byte-order
   * mark as **Windows-1252**, not UTF-8. An em dash (U+2014) is `E2 80 94` in
   * UTF-8, which cp1252 decodes as `a-circumflex, euro, right-double-quote` —
   * and that final quote character opens a string the parser never sees closed.
   * The reported symptom was `â€"` on screen followed by unexpected-token,
   * unterminated-string and missing-brace errors dozens of lines later, nowhere
   * near the actual character.
   *
   * A BOM would also fix it. ASCII is better: an ASCII file is byte-identical
   * whether the reader assumes UTF-8, Windows-1252, or anything else in that
   * family, so it cannot be broken by a tool that strips a BOM, by a copy
   * through a text field, or by an editor saving in the local code page.
   *
   * `.psm1` matters as much as `.ps1`: the module is imported by both scripts,
   * so a single non-ASCII character in it takes down every operator procedure
   * on the project — which is exactly what happened.
   */
  const OPERATOR_SOURCES: [string, string][] = [
    ['scripts/OperatorGuards.psm1', guards],
    ['scripts/Send-BootstrapInvitation.ps1', invite],
    ['scripts/Invoke-HostedValidation.ps1', ps],
    ['scripts/hosted-validation.sh', sh],
  ]

  it.each(OPERATOR_SOURCES)('%s contains no non-ASCII character', (name, text) => {
    const offenders: string[] = []
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      for (const character of line) {
        const code = character.codePointAt(0) ?? 0
        if (code > 127) {
          offenders.push(
            `${name}:${index + 1} U+${code.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(character)}`,
          )
        }
      }
    })
    expect(
      offenders,
      `Windows PowerShell 5.1 decodes these as Windows-1252 and the file stops parsing.\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it.each(OPERATOR_SOURCES)('%s survives a round trip through Windows-1252', (name, text) => {
    // The decisive property, stated directly rather than inferred from the
    // character scan: the bytes mean the same thing under either decoder.
    const utf8 = Buffer.from(text, 'utf8')
    const asLatin = utf8.toString('latin1')
    expect(asLatin, `${name} changes meaning when read as Windows-1252`).toBe(text)
  })

  it('names the punctuation that caused this, so it cannot come back quietly', () => {
    for (const [name, text] of OPERATOR_SOURCES) {
      for (const [label, character] of [
        ['em dash', '\u2014'],
        ['en dash', '\u2013'],
        ['curly left quote', '\u201C'],
        ['curly right quote', '\u201D'],
        ['curly apostrophe', '\u2019'],
        ['ellipsis', '\u2026'],
        ['section sign', '\u00A7'],
        ['non-breaking space', '\u00A0'],
      ] as const) {
        expect(text.includes(character), `${name} contains a ${label}`).toBe(false)
      }
    }
  })

  it('adds no byte-order mark, because ASCII does not need one', () => {
    for (const [name, text] of OPERATOR_SOURCES) {
      expect(text.charCodeAt(0), `${name} starts with a BOM`).not.toBe(0xfeff)
    }
  })
})
