import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'

const ROOT = join(APP_ROOT, '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

const script = read('scripts/New-PreprovisionedAccounts.ps1')
const loopback = read('scripts/tests/Test-PreprovisionRequest.ps1')
const runbook = read('docs/HOSTED_VALIDATION_RUNBOOK.md')
const workflow = read('.github/workflows/ci.yml')

/**
 * Administrator pre-provisioning — the source-level half of the contract.
 *
 * The behavioural half lives in `scripts/tests/Test-PreprovisionRequest.ps1`,
 * which runs the real script against a loopback listener and inspects every
 * request. That is the stronger evidence and it is where "sends no email" is
 * actually established, because the absence of a call is not visible in source.
 *
 * What these add is that the properties cannot be removed by an edit: a
 * password field reintroduced, a mail endpoint added, a domain guard dropped.
 */
describe('administrator pre-provisioning', () => {
  it('creates accounts through the Auth Admin API, never by touching auth.users', () => {
    expect(script).toMatch(/-Path '\/auth\/v1\/admin\/users'/)
    // GoTrue owns that table. A row inserted behind it is a user that
    // half-works in ways that surface much later. Matched as a STATEMENT --
    // the file explains in prose why it does not do this, and that sentence
    // must not be what trips the check.
    expect(script).not.toMatch(/insert\s+into\s+auth\.users\s*\(/i)
    expect(script).not.toMatch(/rest\/v1\/rpc\/.*user/i)
  })

  it('confirms the address and sets no password', () => {
    expect(script).toMatch(/email_confirm\s*=\s*\$true/)
    // The body is built in one place and contains exactly two keys.
    const payload = /\$payload = @\{ email = \$address; email_confirm = \$true \}/
    expect(script).toMatch(payload)
  })

  it('never generates, stores, displays or transmits a password', () => {
    // No generator of any kind.
    expect(script).not.toMatch(/New-Guid|Get-Random|RandomNumberGenerator|GeneratePassword/i)
    // No password field in any request body.
    expect(script).not.toMatch(/"password"|password\s*=\s*\$/i)
    // And nothing that would print one.
    expect(script).not.toMatch(/Write-Host[^\n]*\$password/i)
  })

  it('calls no endpoint that sends mail', () => {
    for (const path of [
      '/auth/v1/invite',
      '/auth/v1/recover',
      '/auth/v1/magiclink',
      '/auth/v1/otp',
      '/auth/v1/signup',
      '/auth/v1/resend',
    ]) {
      // The loopback test proves this on the wire; this stops one being added.
      expect(script, `${path} must never be requested`).not.toMatch(
        new RegExp(`-Path\\s+["']${path.replace(/\//g, '\\/')}`),
      )
    }
  })

  it('counts allowlist rows in a way Windows PowerShell 5.1 agrees with', () => {
    /*
      `@($body | ConvertFrom-Json)` is not a row count on 5.1.

      Given `[]`, 5.1 emits $null rather than an empty collection, and
      `@($null)` has one element -- so "did this query return a row?" answered
      YES to an empty result, and an address that was NOT on the allowlist was
      reported as allowlisted. It only ever went wrong on the interpreter the
      operator actually runs, which is why the loopback test is the thing that
      found it.
    */
    for (const [name, text] of [
      ['pre-provisioning', script],
      ['the invitation script', read('scripts/Send-BootstrapInvitation.ps1')],
    ] as const) {
      expect(text, `${name} must not count rows through @(ConvertFrom-Json)`).not.toMatch(
        /@\(\s*\$\w+\.Body\s*\|\s*ConvertFrom-Json\s*\)/,
      )
      expect(text, `${name} must use the shared row helper`).toMatch(/ConvertFrom-JsonRows/)
    }
    const guards = read('scripts/OperatorGuards.psm1')
    expect(guards).toMatch(/function ConvertFrom-JsonRows/)
    expect(guards).toMatch(/Export-ModuleMember[\s\S]*ConvertFrom-JsonRows/)
    // Every return in the helper wraps with the comma operator. Without it a
    // one-element array unrolls on the way out and 5.1 loses .Count on the
    // bare object, so a single row would count as none -- the same defect,
    // mirrored.
    const helper = guards.slice(guards.indexOf('function ConvertFrom-JsonRows'))
    const body = helper.slice(0, helper.indexOf('\nExport-ModuleMember'))
    const returns = body.match(/^\s*return [^\n]*/gm) ?? []
    expect(returns.length).toBeGreaterThan(0)
    for (const ret of returns) {
      expect(ret.trim(), 'a return must wrap the array with the comma operator').toMatch(
        /^return ,@\(/,
      )
    }
  })

  it('requires the allowlist row to exist before it creates anything', () => {
    expect(script).toMatch(/auth_invite_allowlist\?select=email_normalized&email_normalized=eq\./)
    expect(script).toMatch(/is not on auth_invite_allowlist/)
    // Section 5 (allowlist) must come before section 6 (create).
    expect(script.indexOf('Allowlist must already contain every address')).toBeLessThan(
      script.indexOf("-Path '/auth/v1/admin/users'"),
    )
    // And a missing row aborts the whole run rather than skipping one address.
    expect(script).toMatch(/NOTHING has been created/)
  })

  it('normalises to lowercase before comparing anything', () => {
    expect(script).toMatch(/ToLowerInvariant\(\)/)
    expect(script).toMatch(/\$normalised = @\(\$addresses \| ForEach-Object \{ \$_\.ToLowerInvariant\(\) \}/)
  })

  it('refuses shared mailboxes and unapproved domains', () => {
    expect(script).toMatch(/\$ApprovedDomains = @\('haskell\.com', 'openi-analytics\.com'\)/)
    expect(script).toMatch(/\$SharedMailboxNames = @\(/)
    for (const name of ['admin', 'info', 'support', 'noreply', 'oracles', 'team']) {
      expect(script, `${name} must be refused as a shared mailbox`).toContain(`'${name}'`)
    }
    expect(script).toMatch(/names a shared mailbox, not an individual/)
    expect(script).toMatch(/is not an approved organization domain/)
  })

  it('shows the whole list and requires an exact confirmation', () => {
    expect(script).toMatch(/Type CREATE to provision/)
    // -cne: case-sensitive. "create" must not be enough.
    expect(script).toMatch(/\$answer -cne 'CREATE'/)
    // The list is displayed before the confirmation is requested.
    expect(script.indexOf('foreach ($address in $acceptable) { Write-Host')).toBeLessThan(
      script.indexOf('Type CREATE to provision'),
    )
  })

  it('asks for the key only after the list is confirmed', () => {
    // A refusal must not cost the operator a credential entry.
    expect(script.indexOf("Type CREATE to provision")).toBeLessThan(
      script.indexOf("Read-SecretValue -Prompt 'Supabase secret key"),
    )
  })

  it('is idempotent and does not modify an existing account', () => {
    expect(script).toMatch(/already has an account -- left exactly as it is/)
    // No update verb anywhere: someone may already have set a password, and
    // overwriting it would lock them out silently.
    expect(script).not.toMatch(/-Method\s+(PUT|PATCH|DELETE)/)
  })

  it('grants no role from the email domain', () => {
    // Scoped to the request body that is actually built. The surrounding prose
    // names these fields precisely to say they are absent.
    const payload = /\$payload = @\{([^}]*)\}/.exec(script)?.[1] ?? ''
    expect(payload).not.toBe('')
    expect(payload).not.toMatch(/app_metadata|role|user_metadata|claims|password/i)
    // Authorization on this project is the allowlist plus row-level security.
    expect(script).toMatch(/authorization on this project is the allowlist/i)
  })

  it('uses the shared repository and observation guards', () => {
    expect(script).toMatch(/Import-Module \(Join-Path \$PSScriptRoot 'OperatorGuards\.psm1'\)/)
    expect(script).toMatch(/Assert-NoObservation/)
    expect(script).toMatch(/Assert-CorrectCheckout/)
    expect(script).toMatch(/Read-SecretValue/)
    expect(script).toMatch(/Use-Plain/)
  })

  it('sends the secret only as apikey, with a non-browser User-Agent', () => {
    expect(script).toMatch(/apikey\s*=\s*\$Key/)
    expect(script).not.toMatch(/Authorization\s*=/)
    expect(script).toContain("$OperatorUserAgent = 'Openi-Haskell-FB-Radar-Operator/1.0'")
  })

  it('prints no user record and no secret', () => {
    expect(script).toMatch(/function Protect-Text/)
    expect(script).toMatch(/never printed/)
    expect(script).toMatch(/finally \{[\s\S]*?Clear-Secrets/)
  })

  /**
   * The approved addresses are personal data. They are supplied to the script
   * at the moment of provisioning and exist nowhere else.
   */
  it('takes its addresses from the operator, never from a committed list', () => {
    // The people being provisioned are personal data. This test deliberately
    // names NOBODY -- a list of forbidden names in a test file would itself be
    // the thing it forbids. The repository-wide guard is the CI step below,
    // which refuses any address on an approved domain that is not a documented
    // placeholder, so it catches a colleague nobody remembered to add to a list.
    expect(script).toMatch(/Enter one approved address per line/)
    expect(script).toMatch(/These are not stored anywhere by this script/)

    // Not a parameter: a value on the command line is visible in the process
    // table and in shell history.
    const paramBlock = /^param\(([\s\S]*?)^\)/m.exec(script)?.[1] ?? ''
    expect(paramBlock).not.toBe('')
    expect(paramBlock).not.toMatch(/\$(Addresses|Emails|Users|Recipients)\b/)

    // And no address on an approved domain is hard-coded into the script.
    const domainAddresses =
      script.match(/[A-Za-z0-9._%+-]+@(?:haskell|openi-analytics)\.com/gi) ?? []
    // Only the reserved SEC mailbox, which is named in order to be refused.
    expect(new Set(domainAddresses)).toEqual(
      domainAddresses.length ? new Set(['oracles@openi-analytics.com']) : new Set(),
    )

    expect(workflow, 'the repository-wide guard must exist').toMatch(
      /No real person is named in the repository/,
    )
  })

  it('refuses an address file kept inside the working tree', () => {
    // A list of individuals stored beside the source is a list that eventually
    // gets committed in a hurry.
    expect(script).toMatch(/they must never be committed/)
  })

  it('is proven on the wire, not only in this file', () => {
    // These source assertions are the weaker half. The absence of a call is
    // invisible in a diff, so "sends no email" is established by running the
    // real script and watching what arrives. This is the pointer to that.
    expect(loopback).toContain('System.Net.HttpListener')
    expect(loopback).toMatch(/AddCommand\(\$ScriptPath/)
    for (const path of ['/auth/v1/invite', '/auth/v1/recover', '/auth/v1/magiclink']) {
      expect(loopback, `${path} must be in the never-requested list`).toContain(path)
    }
    expect(loopback).toMatch(/carries no password field/)
    // All four conditional behaviours are exercised, not just the happy path.
    // Each runs in its own process, named in the dispatch list, because the
    // scenario decides how the loopback double answers.
    for (const scenario of ['happy', 'unlisted', 'existing', 'unconfirmed']) {
      expect(loopback, `the ${scenario} scenario is missing`).toMatch(
        new RegExp(`ValidateSet[^)]*'${scenario}'`, 's'),
      )
    }
    expect(loopback).toMatch(/-Confirm 'yes'/)
    expect(workflow).toContain('scripts\\tests\\Test-PreprovisionRequest.ps1')
  })

  it('is documented as its own onboarding method, distinct from invitation', () => {
    expect(runbook).toMatch(/Administrator pre-provisioning/i)
    expect(runbook).toMatch(/no password/i)
    // And self-registration remains impossible by any route.
    expect(runbook).not.toMatch(/self-registration is (allowed|permitted|enabled)/i)
  })
})

/**
 * Activation is the recovery flow, deliberately.
 *
 * A pre-provisioned account has no password, so its owner's first action is the
 * same one anybody takes when they have forgotten theirs. Sharing the path is
 * what keeps the two indistinguishable from the outside — the page cannot tell
 * you whether an address has a password yet, and it must not.
 */
describe('account activation', () => {
  const login = read('app/src/auth/LoginPage.tsx')
  const forgot = read('app/src/auth/ForgotPasswordPage.tsx')
  const routes = read('app/src/App.tsx')

  it('offers "Set or reset your password" from the sign-in page', () => {
    expect(login).toContain('Set or reset your password')
    expect(login).not.toContain('Forgot your password?')
    // The route is unchanged; only the label describes both errands.
    expect(login).toMatch(/to="\/forgot-password"/)
  })

  it('still offers no way to create an account', () => {
    for (const [name, text] of [
      ['the login page', login],
      ['the recovery page', forgot],
      ['the route table', routes],
    ] as const) {
      // Route paths and user-visible text, not the word "registered" in a
      // sentence about how the route table works.
      expect(text, `${name} offers a registration route`).not.toMatch(
        /path="\/[^"]*(signup|sign-up|register)/i,
      )
      expect(text, `${name} offers to create an account`).not.toMatch(
        /create an account|sign up(?! form)/i,
      )
    }
    expect(routes).not.toMatch(/path="\/(signup|register|create-account)"/)
  })

  it('answers identically whether or not the address has an account', () => {
    expect(forgot).toMatch(/const SAME_ANSWER =/)
    expect(forgot).toMatch(/If that address has an account/)
    // The catch block is what makes a provider failure indistinguishable too.
    expect(forgot).toMatch(/catch \{[\s\S]*?\}\s*setBusy\(false\)\s*setSent\(true\)/)
  })

  it('describes the link as setting or resetting, not as an invitation', () => {
    expect(forgot).toMatch(/set or reset your password/i)
    expect(forgot).not.toMatch(/invitation was sent to/i)
  })
})
