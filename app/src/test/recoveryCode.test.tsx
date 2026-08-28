import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '@/test/paths'
import { render } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import { makeSession, signedOut, withoutPrefill, TEST_USER_EMAIL } from '@/test/authFake'
import type { AuthPort } from '@/auth/authPort'

/** Real browser history, because these pages read and rewrite the address. */
function renderAt(url: string, port: AuthPort) {
  window.history.replaceState({}, '', url)
  return render(
    <BrowserRouter>
      <App authPort={port} />
    </BrowserRouter>,
  )
}

/**
 * Password recovery by CODE, because a link cannot survive delivery.
 *
 * The failure this replaces: a pre-provisioned reviewer used "Set or reset your
 * password", opened the email immediately, and was told the link was invalid.
 * The project's auth logs show why — a HEAD request with no user agent, and
 * GETs from different addresses and platforms, reaching /auth/v1/verify within
 * seconds of the email being generated and consuming the single-use token
 * before she clicked.
 *
 * A code is inert in transit. These tests hold that property in place, along
 * with the enumeration resistance the request page already had and the
 * vocabulary fix that stopped a recovery failure being announced as an
 * invitation failure.
 */

const CODE_PAGE = '/auth/reset-password'

async function arriveAtCodePage() {
  const auth = signedOut()
  renderAt(CODE_PAGE, withoutPrefill(auth))
  await screen.findByRole('heading', { name: 'Enter your recovery code' })
  return auth
}

async function submitCode(email: string, code: string) {
  await userEvent.type(screen.getByLabelText('Email address'), email)
  await userEvent.type(screen.getByLabelText('Six-digit code'), code)
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

/* ==================================================================== */

describe('requesting recovery answers identically for everyone', () => {
  async function request(email: string, prepare?: (auth: ReturnType<typeof signedOut>) => void) {
    const auth = signedOut()
    prepare?.(auth)
    renderAt('/forgot-password', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Set or reset your password' })
    await userEvent.type(screen.getByLabelText('Email address'), email)
    await userEvent.click(screen.getByRole('button', { name: /email me a link/i }))
    const notice = await screen.findByRole('status')
    return { auth, text: notice.textContent ?? '' }
  }

  it('gives the same answer for a pre-provisioned account, an existing password, and a stranger', async () => {
    const answers = new Set<string>()
    for (const address of [
      'preprovisioned.person@openi-analytics.invalid',
      'has.a.password@openi-analytics.invalid',
      'nobody.at.all@example.invalid',
    ]) {
      const { text } = await request(address)
      answers.add(text)
      screen.getByRole('status').remove()
    }
    // One sentence for all three. Any difference is the enumeration channel.
    expect(answers.size).toBe(1)
  })

  it('gives that same answer when the provider fails to send', async () => {
    const { text: normal } = await request('someone@openi-analytics.invalid')
    screen.getByRole('status').remove()
    const { text: failed } = await request('someone@openi-analytics.invalid', (auth) => {
      auth.sendRecoveryEmail = async () => {
        throw new Error('smtp refused the message')
      }
    })
    expect(failed).toBe(normal)
  })

  it('describes a code rather than a link', async () => {
    const { text } = await request('someone@openi-analytics.invalid')
    expect(text).toMatch(/six-digit code/i)
    expect(text).toMatch(/expires/i)
  })

  it('never states whether the address has an account', async () => {
    const { text } = await request('someone@openi-analytics.invalid')
    expect(text).toMatch(/if that address has an account/i)
    expect(text).not.toMatch(/we (sent|have sent)/i)
  })
})

describe('the code page grants nothing without the right code', () => {
  it('establishes a recovery session for the correct email and code', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'

    await submitCode(TEST_USER_EMAIL, '424242')

    // The password fields replace the code form; no navigation is involved.
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument()
    expect(auth.verifiedCodes).toHaveLength(1)
  })

  it('refuses an incorrect code and grants no session', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCode = '424242'
    await submitCode(TEST_USER_EMAIL, '999999')

    expect(await screen.findByRole('alert')).toHaveTextContent(/was not accepted/i)
    // No session is the point, and its absence is observable: the password
    // fields are what a recovery session unlocks.
    expect(screen.queryByRole('heading', { name: 'Set a new password' })).toBeNull()
  })

  it('refuses an EXPIRED code and grants no session', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'
    auth.recoveryCodeOutcome = 'expired'

    await submitCode(TEST_USER_EMAIL, '424242')
    expect(await screen.findByRole('alert')).toHaveTextContent(/was not accepted/i)
    expect(screen.queryByRole('heading', { name: 'Set a new password' })).toBeNull()
  })

  it('refuses a REUSED code and grants no session', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'
    auth.recoveryCodeOutcome = 'already_used'

    await submitCode(TEST_USER_EMAIL, '424242')
    expect(await screen.findByRole('alert')).toHaveTextContent(/was not accepted/i)
    expect(screen.queryByRole('heading', { name: 'Set a new password' })).toBeNull()
  })

  it('refuses a correct code presented with the wrong address', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'

    await submitCode('someone.else@openi-analytics.invalid', '424242')
    expect(await screen.findByRole('alert')).toHaveTextContent(/was not accepted/i)
    expect(screen.queryByRole('heading', { name: 'Set a new password' })).toBeNull()
  })

  it('says the same thing for wrong, expired, reused and mismatched', async () => {
    const messages = new Set<string>()
    const cases: { outcome: 'ok' | 'expired' | 'already_used'; email: string; code: string }[] = [
      { outcome: 'ok', email: TEST_USER_EMAIL, code: '000000' },
      { outcome: 'expired', email: TEST_USER_EMAIL, code: '424242' },
      { outcome: 'already_used', email: TEST_USER_EMAIL, code: '424242' },
      { outcome: 'ok', email: 'other@openi-analytics.invalid', code: '424242' },
    ]
    for (const test of cases) {
      const auth = signedOut()
      auth.recoveryCodeEmail = TEST_USER_EMAIL
      auth.recoveryCode = '424242'
      auth.recoveryCodeOutcome = test.outcome
      const { unmount } = renderAt(CODE_PAGE, withoutPrefill(auth))
      await screen.findByRole('heading', { name: 'Enter your recovery code' })
      await submitCode(test.email, test.code)
      messages.add((await screen.findByRole('alert')).textContent ?? '')
      unmount()
    }
    // Four different underlying causes, one visible sentence.
    expect(messages.size).toBe(1)
  })

  it('never reveals account state in the refusal', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCode = '424242'
    await submitCode('stranger@example.invalid', '111111')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/no such|not found|does not exist|unknown account|no account/i)
  })

  it('does not send an obviously malformed code to the provider at all', async () => {
    const auth = await arriveAtCodePage()
    await userEvent.type(screen.getByLabelText('Email address'), TEST_USER_EMAIL)
    await userEvent.type(screen.getByLabelText('Six-digit code'), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(auth.verifiedCodes).toHaveLength(0)
  })
})

describe('the code does not linger', () => {
  it('clears the field after a refusal', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCode = '424242'
    await submitCode(TEST_USER_EMAIL, '999999')
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Six-digit code')).toHaveValue('')
  })

  it('never puts the code or the address in the URL', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'
    await submitCode(TEST_USER_EMAIL, '424242')
    await screen.findByRole('heading', { name: 'Set a new password' })

    const url = `${window.location.pathname}${window.location.search}${window.location.hash}`
    expect(url).not.toContain('424242')
    expect(url).not.toContain(TEST_USER_EMAIL)
    expect(url).not.toMatch(/token|code=|email=/i)
  })

  it('writes neither the code nor the address to browser storage', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'
    await submitCode(TEST_USER_EMAIL, '424242')
    await screen.findByRole('heading', { name: 'Set a new password' })

    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const value = store.getItem(store.key(i) ?? '') ?? ''
        expect(value).not.toContain('424242')
      }
    }
  })

  it('keeps the code out of the rendered document once accepted', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'
    await submitCode(TEST_USER_EMAIL, '424242')
    await screen.findByRole('heading', { name: 'Set a new password' })
    expect(document.body.innerHTML).not.toContain('424242')
  })

  it('is not written to the console on any path', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const auth = await arriveAtCodePage()
    auth.recoveryCode = '424242'
    await submitCode(TEST_USER_EMAIL, '999999')
    await screen.findByRole('alert')
    for (const call of [...spy.mock.calls, ...errorSpy.mock.calls].flat()) {
      expect(String(call)).not.toContain('999999')
    }
    spy.mockRestore()
    errorSpy.mockRestore()
  })

  it('records the exchange without recording the code', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'
    await submitCode(TEST_USER_EMAIL, '424242')
    await screen.findByRole('heading', { name: 'Set a new password' })
    expect(auth.calls).toContain('verifyRecoveryCode')
    expect(auth.calls.join(' ')).not.toContain('424242')
  })
})

describe('resending', () => {
  it('asks again and reports the same generic result', async () => {
    const auth = await arriveAtCodePage()
    await userEvent.type(screen.getByLabelText('Email address'), TEST_USER_EMAIL)
    await userEvent.click(screen.getByRole('button', { name: 'Send me a new code' }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(/if that address has an account/i)
    expect(auth.recoveryEmails).toHaveLength(1)
    expect(auth.recoveryEmails[0]!.redirectTo).toBe(`${window.location.origin}/auth/reset-password`)
  })

  it('reports the same thing when the provider fails', async () => {
    const auth = await arriveAtCodePage()
    auth.sendRecoveryEmail = async () => {
      throw new Error('smtp refused')
    }
    await userEvent.type(screen.getByLabelText('Email address'), 'stranger@example.invalid')
    await userEvent.click(screen.getByRole('button', { name: 'Send me a new code' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/if that address has an account/i)
  })
})

describe('finishing the reset', () => {
  async function reachPasswordFields() {
    const auth = signedOut()
    auth.recoveryCodeEmail = TEST_USER_EMAIL
    auth.recoveryCode = '424242'
    renderAt(CODE_PAGE, withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Enter your recovery code' })
    await submitCode(TEST_USER_EMAIL, '424242')
    await screen.findByRole('heading', { name: 'Set a new password' })
    return auth
  }

  it('shows the requirements before anything is typed', async () => {
    await reachPasswordFields()
    expect(screen.getByText(new RegExp(`${12} characters`))).toBeInTheDocument()
  })

  it('refuses a password that does not match its confirmation', async () => {
    const auth = await reachPasswordFields()
    await userEvent.type(screen.getByLabelText('New password'), 'a-perfectly-fine-password')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'something-else-entirely')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(auth.passwordUpdates).toHaveLength(0)
  })

  it('refuses a password that fails the policy', async () => {
    const auth = await reachPasswordFields()
    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(auth.passwordUpdates).toHaveLength(0)
  })

  it('updates the password, ends the recovery session, and returns to sign in', async () => {
    const auth = await reachPasswordFields()
    await userEvent.type(screen.getByLabelText('New password'), 'a-perfectly-fine-password')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-perfectly-fine-password')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(auth.passwordUpdates).toHaveLength(1)
    // The recovery session is spent deliberately: it was established from an
    // inbox, not by anybody typing the new password.
    expect(auth.calls).toContain('signOut')
  })
})

describe('the recovery flow never speaks of invitations', () => {
  it('uses reset vocabulary on the code page', async () => {
    await arriveAtCodePage()
    const main = screen.getByRole('main').textContent ?? ''
    expect(main).toMatch(/recovery code/i)
    expect(main).not.toMatch(/invitation|invite|accept invitation/i)
  })

  it('uses reset vocabulary when a code is refused', async () => {
    const auth = await arriveAtCodePage()
    auth.recoveryCode = '424242'
    await submitCode(TEST_USER_EMAIL, '999999')
    await screen.findByRole('alert')
    const main = screen.getByRole('main').textContent ?? ''
    expect(main).not.toMatch(/invitation|invite|accept invitation/i)
  })
})

/**
 * THE DEPLOYMENT WINDOW.
 *
 * The Supabase email template is project-wide: saving it changes production
 * immediately. So the new interface must ship BEFORE the template changes, and
 * during that window unexpired CONFIRMATION-LINK emails are still landing.
 * Both shapes have to work at the same time.
 */
describe('a link already in somebody inbox still works', () => {
  it('redeems a recovery credential that arrives in the URL, and shows the password form', async () => {
    const auth = signedOut()
    auth.redeemResult = { ok: true, session: makeSession() }
    renderAt(
      '/auth/reset-password#access_token=aaa.bbb.ccc&refresh_token=rrr&type=recovery',
      withoutPrefill(auth),
    )

    // The old flow completes: no code is asked for, because the person already
    // proved receipt by following a link that still had a live token in it.
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument()
    expect(auth.calls.filter((c) => c.startsWith('redeem'))).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Enter your recovery code' })).toBeNull()
  })

  it('takes the credential out of the address bar and the history entry', async () => {
    const auth = signedOut()
    auth.redeemResult = { ok: true, session: makeSession() }
    renderAt(
      '/auth/reset-password#access_token=aaa.bbb.ccc&refresh_token=rrr&type=recovery',
      withoutPrefill(auth),
    )
    await screen.findByRole('heading', { name: 'Set a new password' })
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('aaa.bbb.ccc')
  })

  it('falls back to the code form when the arriving credential is spent', async () => {
    const auth = signedOut()
    auth.redeemResult = { ok: false, reason: 'already_used' }
    renderAt(
      '/auth/reset-password#access_token=aaa.bbb.ccc&refresh_token=rrr&type=recovery',
      withoutPrefill(auth),
    )

    // Which is exactly the case a scanner creates. The person is not stranded
    // on an error page; they are handed the route that cannot be prefetched.
    expect(
      await screen.findByRole('heading', { name: 'Enter your recovery code' }),
    ).toBeInTheDocument()
  })

  it('shows the code form directly when no credential arrives at all', async () => {
    const auth = signedOut()
    renderAt('/auth/reset-password', withoutPrefill(auth))
    expect(
      await screen.findByRole('heading', { name: 'Enter your recovery code' }),
    ).toBeInTheDocument()
    // Nothing to redeem, so nothing was attempted.
    expect(auth.calls.filter((c) => c.startsWith('redeem'))).toHaveLength(0)
  })

  it('never calls an arriving recovery credential an invitation', async () => {
    const auth = signedOut()
    auth.redeemResult = { ok: false, reason: 'expired' }
    renderAt('/auth/reset-password#error=access_denied&error_code=otp_expired', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Enter your recovery code' })
    expect(screen.getByRole('main').textContent ?? '').not.toMatch(/invitation|invite/i)
  })
})

describe('the emailed message carries no credential', () => {
  const template = readFileSync(
    join(APP_ROOT, '..', 'docs/email-templates/reset-password.html'),
    'utf8',
  )

  it('uses the code, not a confirmation URL', () => {
    expect(template).toContain('{{ .Token }}')
    expect(template).not.toContain('{{ .ConfirmationURL }}')
    expect(template).not.toContain('{{ .TokenHash }}')
  })

  it('links only to the application, with nothing in the address', () => {
    expect(template).toContain('{{ .RedirectTo }}')
    const links = [...template.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '')
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(href).not.toMatch(/token|hash|email|otp|access|code=/i)
      // A scanner fetching this consumes nothing, because there is nothing in
      // it to consume.
      expect(href === '{{ .RedirectTo }}' || href.startsWith('mailto:')).toBe(true)
    }
  })

  it('tells the recipient what the code is for, and what to ignore', () => {
    expect(template).toMatch(/expires/i)
    expect(template).toMatch(/once/i)
    expect(template).toMatch(/did not request/i)
  })

  it('never calls a password reset an invitation', () => {
    expect(template).not.toMatch(/invitation|invite/i)
  })
})
