import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import { FakeAuth, makeSession, signedIn, signedOut, withoutPrefill } from '@/test/authFake'
import type { AuthPort } from '@/auth/authPort'
import {
  classifyFailure,
  isInvitationOnboarding,
  parseUrlCredential,
} from '@/auth/urlCredentials'
import { MIN_PASSWORD_LENGTH, checkPassword } from '@/auth/passwordPolicy'

/**
 * The journey an invited person actually takes.
 *
 * This is the suite that would have caught the reported failure. The invitation
 * was accepted, Supabase redirected to the application, and the application had
 * no route that read the credential — so the user landed signed out at a page
 * that asked them for nothing.
 *
 * `BrowserRouter` throughout, against real `window.history`, because the
 * callback reads `window.location` and then rewrites the history entry. A
 * `MemoryRouter` would let a broken implementation pass by never touching the
 * thing it is supposed to clean up.
 */

const VALID_TOKENS = '#access_token=aaa.bbb.ccc&refresh_token=rrr&expires_in=3600&type=invite'

function renderAt(url: string, port: AuthPort) {
  window.history.replaceState({}, '', url)
  return render(
    <BrowserRouter>
      <App authPort={port} />
    </BrowserRouter>,
  )
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

// ---------------------------------------------------------------------------

describe('parsing the credential Supabase puts in the URL', () => {
  it('reads the implicit fragment form', () => {
    const parsed = parseUrlCredential('', VALID_TOKENS)
    expect(parsed).toMatchObject({ kind: 'fragment', accessToken: 'aaa.bbb.ccc', type: 'invite' })
    expect(isInvitationOnboarding(parsed)).toBe(true)
  })

  it('reads the PKCE code form', () => {
    const parsed = parseUrlCredential('?code=abc123&type=recovery', '')
    expect(parsed).toMatchObject({ kind: 'code', code: 'abc123', type: 'recovery' })
    // A recovery link is not onboarding: the person already has an account.
    expect(isInvitationOnboarding(parsed)).toBe(false)
  })

  it('reads the token-hash form a TokenHash email template produces', () => {
    const parsed = parseUrlCredential('?token_hash=xyz&type=invite', '')
    expect(parsed).toMatchObject({ kind: 'token_hash', tokenHash: 'xyz', type: 'invite' })
    expect(isInvitationOnboarding(parsed)).toBe(true)
  })

  it('reads a reported failure from the fragment or the query', () => {
    expect(
      parseUrlCredential('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
    ).toMatchObject({ kind: 'error', reason: 'expired' })
    expect(
      parseUrlCredential('?error=access_denied&error_code=otp_expired', ''),
    ).toMatchObject({ kind: 'error', reason: 'expired' })
  })

  it('refuses a half-formed fragment rather than building an unrenewable session', () => {
    expect(parseUrlCredential('', '#access_token=aaa.bbb.ccc&type=invite')).toMatchObject({
      kind: 'error',
      reason: 'malformed',
    })
  })

  it('reports an empty callback as missing, not as an error', () => {
    expect(parseUrlCredential('', '')).toEqual({ kind: 'none' })
  })

  it.each([
    ['otp_expired', 'Email link is invalid or has expired', 'expired'],
    [null, 'Token has already been used', 'already_used'],
    [null, 'Invalid token', 'malformed'],
    ['access_denied', null, 'denied'],
    [null, null, 'unknown'],
  ])('classifies (%s, %s) as %s', (code, description, expected) => {
    expect(classifyFailure(code, description)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------

describe('accepting an invitation', () => {
  it('redeems the link and sends the user to choose a password', async () => {
    const auth = signedOut()
    renderAt(`/auth/callback${VALID_TOKENS}`, withoutPrefill(auth))

    expect(await screen.findByRole('heading', { name: 'Choose a password' })).toBeInTheDocument()
    expect(auth.redeemed[0]).toMatchObject({ kind: 'fragment', type: 'invite' })
  })

  it('removes the credential from the address bar and the history entry', async () => {
    const auth = signedOut()
    renderAt(`/auth/callback${VALID_TOKENS}`, withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Choose a password' })

    // Neither the token nor the fragment survives anywhere a browser keeps it.
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('access_token')
    expect(window.location.href).not.toContain('refresh_token')
    expect(window.location.href).not.toContain('aaa.bbb.ccc')
  })

  it('never renders the token, and never puts it in the DOM', async () => {
    const auth = signedOut()
    renderAt(`/auth/callback${VALID_TOKENS}`, withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Choose a password' })

    const markup = document.body.innerHTML
    expect(markup).not.toContain('aaa.bbb.ccc')
    expect(markup).not.toContain('access_token')
    expect(markup).not.toContain('refresh_token')
  })

  it('sends an ordinary magic link straight into the application', async () => {
    const auth = signedOut()
    renderAt('/auth/callback?code=abc123&type=magiclink', withoutPrefill(auth))
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })

  it('routes a recovery link to the reset form, not to onboarding', async () => {
    const auth = signedOut()
    auth.emit('PASSWORD_RECOVERY', makeSession())
    renderAt('/auth/callback?code=abc123&type=recovery', withoutPrefill(auth))
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument()
  })

  it('refuses an invitation for an account that is no longer allowlisted', async () => {
    const auth = new FakeAuth({ initialSession: null, standing: 'not_invited' })
    renderAt(`/auth/callback${VALID_TOKENS}`, withoutPrefill(auth))

    expect(await screen.findByText(/not on the invitation list/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Choose a password' })).toBeNull()
  })

  it('refuses an anonymous session even if one is somehow issued', async () => {
    const auth = new FakeAuth({
      initialSession: null,
      redeemResult: { ok: true, session: makeSession({ email: null, isAnonymous: true }) },
    })
    renderAt(`/auth/callback${VALID_TOKENS}`, withoutPrefill(auth))
    expect(await screen.findByText(/not on the invitation list/i)).toBeInTheDocument()
  })
})

describe('an invitation that cannot be used', () => {
  it.each([
    ['expired', '#error=access_denied&error_code=otp_expired&error_description=Email+link+has+expired'],
    ['already_used', '?error=invalid_request&error_description=Token+has+already+been+used'],
    ['malformed', '#access_token=only-half-of-it&type=invite'],
    ['missing', ''],
  ])('reports %s without saying which it was', async (reason, tail) => {
    const auth = signedOut()
    renderAt(`/auth/callback${tail}`, withoutPrefill(auth))

    expect(
      await screen.findByRole('heading', { name: 'That invitation link cannot be used' }),
    ).toBeInTheDocument()

    // The classification exists for behaviour and for this assertion. It is not
    // visible text — whether a link expired, was spent, or never existed are
    // facts about somebody's account, and the holder of a bad link is not
    // necessarily that somebody.
    expect(screen.getByTestId('callback-failure-reason')).toHaveTextContent(reason)

    // One sentence for all four. Flow-specific since the recovery flow needs its
    // own vocabulary (see callbackVocabulary.test.tsx), but still identical
    // across every reason WITHIN a flow, which is the property that matters.
    expect(screen.getByText(/This invitation link is no longer valid/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Choose a password' })).toBeNull()
  })

  it('gives every failure the identical visible explanation', async () => {
    const seen = new Set<string>()
    for (const tail of [
      '#error=access_denied&error_code=otp_expired',
      '?error=invalid_request&error_description=Token+has+already+been+used',
      '',
    ]) {
      const { unmount } = renderAt(`/auth/callback${tail}`, withoutPrefill(signedOut()))
      await screen.findByRole('heading', { name: 'That invitation link cannot be used' })
      seen.add(screen.getByText(/no longer valid/i).textContent ?? '')
      unmount()
    }
    expect(seen.size).toBe(1)
  })

  it('offers a way back to sign in', async () => {
    renderAt('/auth/callback', withoutPrefill(signedOut()))
    await screen.findByRole('heading', { name: 'That invitation link cannot be used' })
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })

  it('does not redeem twice when React re-invokes the effect', async () => {
    const auth = signedOut()
    renderAt(`/auth/callback${VALID_TOKENS}`, withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Choose a password' })
    // A second read of an already-scrubbed URL would find nothing and report a
    // perfectly good invitation as missing.
    expect(auth.redeemed).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

describe('choosing a password', () => {
  const strong = 'correct-horse-battery-9'

  async function arriveAtSetPassword(auth: FakeAuth) {
    renderAt(`/auth/callback${VALID_TOKENS}`, withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Choose a password' })
  }

  it('shows the requirements before anything is typed', async () => {
    await arriveAtSetPassword(signedOut())
    expect(screen.getByText(`At least ${MIN_PASSWORD_LENGTH} characters`)).toBeInTheDocument()
    expect(screen.getByText('Both entries must match')).toBeInTheDocument()
  })

  it('refuses a password that does not match its confirmation', async () => {
    const auth = signedOut()
    await arriveAtSetPassword(auth)

    await userEvent.type(screen.getByLabelText('New password'), strong)
    await userEvent.type(screen.getByLabelText('Confirm new password'), `${strong}x`)
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The two entries do not match.')
    expect(auth.passwordUpdates).toHaveLength(0)
  })

  it('refuses a password that fails the policy', async () => {
    const auth = signedOut()
    await arriveAtSetPassword(auth)

    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Use at least ${MIN_PASSWORD_LENGTH} characters`,
    )
    expect(auth.passwordUpdates).toHaveLength(0)
  })

  it('refuses a single repeated character however long it is', () => {
    const problems = checkPassword('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa')
    expect(problems.map((problem) => problem.code)).toContain('too_simple')
  })

  it('sets the password and enters the application', async () => {
    const auth = signedOut()
    await arriveAtSetPassword(auth)

    await userEvent.type(screen.getByLabelText('New password'), strong)
    await userEvent.type(screen.getByLabelText('Confirm new password'), strong)
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(auth.passwordUpdates).toEqual([strong])
  })

  it('stays on the form when the provider refuses the password', async () => {
    const auth = signedOut()
    auth.updatePasswordFailure = 'Password is known to be compromised.'
    await arriveAtSetPassword(auth)

    await userEvent.type(screen.getByLabelText('New password'), strong)
    await userEvent.type(screen.getByLabelText('Confirm new password'), strong)
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('known to be compromised')
    // Not sent into the application with no usable password.
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
  })

  it('cannot be reached without a redeemed link', async () => {
    renderAt('/auth/set-password', withoutPrefill(signedOut()))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('associates its errors with the fields they are about', async () => {
    const auth = signedOut()
    await arriveAtSetPassword(auth)

    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'other')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    const field = await screen.findByLabelText('New password')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    const described = field.getAttribute('aria-describedby') ?? ''
    expect(described.split(' ').length).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------

describe('signing in', () => {
  it('signs a known user in', async () => {
    const auth = signedOut()
    renderAt('/login', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Sign in' })

    await userEvent.type(screen.getByLabelText('Email address'), 'analyst@openi-analytics.invalid')
    await userEvent.type(screen.getByLabelText('Password'), 'a-correct-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })

  it('gives one message for a wrong password and for an unknown address', async () => {
    const messages = new Set<string>()
    for (const failure of ['invalid_credentials', 'unknown'] as const) {
      const auth = new FakeAuth({ initialSession: null, signInFailure: { code: failure } })
      const { unmount } = renderAt('/login', withoutPrefill(auth))
      await screen.findByRole('heading', { name: 'Sign in' })
      await userEvent.type(screen.getByLabelText('Email address'), 'someone@example.invalid')
      await userEvent.type(screen.getByLabelText('Password'), 'whatever')
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
      messages.add((await screen.findByRole('alert')).textContent ?? '')
      unmount()
    }
    // One answer. Anything else is an account-enumeration endpoint with a
    // friendly face on it.
    expect(messages.size).toBe(1)
    expect([...messages][0]).toContain('was not accepted')
  })

  it('clears the password box after a failure', async () => {
    const auth = new FakeAuth({
      initialSession: null,
      signInFailure: { code: 'invalid_credentials' },
    })
    renderAt('/login', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Sign in' })
    await userEvent.type(screen.getByLabelText('Email address'), 'someone@example.invalid')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('says to wait when Supabase is rate-limiting the attempts', async () => {
    const auth = new FakeAuth({ initialSession: null, signInFailure: { code: 'rate_limited' } })
    renderAt('/login', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Sign in' })
    await userEvent.type(screen.getByLabelText('Email address'), 'someone@example.invalid')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
  })

  it('does not blame the password when the service is unreachable', async () => {
    const auth = new FakeAuth({ initialSession: null, signInFailure: { code: 'unavailable' } })
    renderAt('/login', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Sign in' })
    await userEvent.type(screen.getByLabelText('Email address'), 'someone@example.invalid')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('not a problem with your password')
  })

  it('offers no way to create an account', async () => {
    renderAt('/login', withoutPrefill(signedOut()))
    await screen.findByRole('heading', { name: 'Sign in' })

    // No affordance of any kind. The page DOES mention creating an account —
    // to say there is no way to — so the assertion is about controls, not about
    // the word appearing anywhere on the page.
    expect(screen.queryByRole('link', { name: /sign up|register|create/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /sign up|register|create/i })).toBeNull()
    expect(screen.queryByLabelText(/confirm password/i)).toBeNull()

    const text = document.body.textContent ?? ''
    expect(text).toMatch(/Access is by invitation/i)
    expect(text).toMatch(/no way to create an account/i)
    expect(text).not.toMatch(/sign up|register/i)
  })

  it('sends an already-signed-in visitor onward instead of showing the form', async () => {
    renderAt('/login', withoutPrefill(signedIn()))
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

describe('password recovery', () => {
  it('answers identically whether or not the address has an account', async () => {
    const answers = new Set<string>()
    for (const address of ['analyst@openi-analytics.invalid', 'stranger@example.invalid']) {
      const auth = signedOut()
      const { unmount } = renderAt('/forgot-password', withoutPrefill(auth))
      await screen.findByRole('heading', { name: 'Reset your password' })
      await userEvent.type(screen.getByLabelText('Email address'), address)
      await userEvent.click(screen.getByRole('button', { name: /email a reset link/i }))
      answers.add((await screen.findByRole('status')).textContent ?? '')
      unmount()
    }
    expect(answers.size).toBe(1)
    expect([...answers][0]).toContain('If that address has an account')
  })

  it('asks the provider to send the link back through the one callback route', async () => {
    const auth = signedOut()
    renderAt('/forgot-password', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Reset your password' })
    await userEvent.type(screen.getByLabelText('Email address'), 'analyst@openi-analytics.invalid')
    await userEvent.click(screen.getByRole('button', { name: /email a reset link/i }))

    await screen.findByRole('status')
    expect(auth.recoveryEmails).toHaveLength(1)
    expect(auth.recoveryEmails[0]!.redirectTo).toBe(`${window.location.origin}/auth/callback`)
  })

  it('gives the same answer even when the provider fails', async () => {
    const auth = signedOut()
    auth.sendRecoveryEmail = async () => {
      throw new Error('provider down')
    }
    renderAt('/forgot-password', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Reset your password' })
    await userEvent.type(screen.getByLabelText('Email address'), 'analyst@openi-analytics.invalid')
    await userEvent.click(screen.getByRole('button', { name: /email a reset link/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('If that address has an account')
  })

  it('refuses an empty box, which reveals nothing about anybody', async () => {
    renderAt('/forgot-password', withoutPrefill(signedOut()))
    await screen.findByRole('heading', { name: 'Reset your password' })
    await userEvent.click(screen.getByRole('button', { name: /email a reset link/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the email address')
  })

  it('is reachable from the sign-in page', async () => {
    renderAt('/login', withoutPrefill(signedOut()))
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.getByRole('link', { name: /forgot your password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })
})

describe('resetting a password', () => {
  it('sets a new password and returns the user to sign in', async () => {
    const auth = signedIn()
    renderAt('/auth/reset-password', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Set a new password' })

    await userEvent.type(screen.getByLabelText('New password'), 'a-brand-new-passphrase-7')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-passphrase-7')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(auth.passwordUpdates).toEqual(['a-brand-new-passphrase-7'])
  })

  it('cannot be reached without a recovery session', async () => {
    renderAt('/auth/reset-password', withoutPrefill(signedOut()))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('leaves no credential in the address bar', async () => {
    renderAt('/auth/reset-password#access_token=aaa.bbb.ccc&refresh_token=rrr', withoutPrefill(signedIn()))
    await screen.findByRole('heading', { name: 'Set a new password' })
    await waitFor(() => {
      expect(window.location.hash).toBe('')
    })
    expect(document.body.innerHTML).not.toContain('aaa.bbb.ccc')
  })
})
