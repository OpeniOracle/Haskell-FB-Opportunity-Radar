import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '@/App'
import { FakeAuth } from '@/test/authFake'

/**
 * An invitation failure and a recovery failure must not borrow each other's words.
 *
 * WHAT WENT WRONG. One set of sentences served both flows and it was written
 * for invitations. Somebody who requested a password reset, opened the emailed
 * link and hit a service failure was told *"Your invitation has not been used
 * up by this"* — about a link that was not an invitation, and carrying a
 * promise the application is not in a position to make. Whether a link survives
 * after GoTrue has verified or exchanged it is Supabase's business; this page
 * cannot see it, so it must not assert it.
 *
 * These tests are written as EXCLUSIONS in both directions, because that is the
 * failure mode: not "does the right word appear" but "can the wrong one".
 */

const INVITATION_WORDS = /invitation|invited|administrator to send/i
const RECOVERY_WORDS = /password reset|reset link/i
/** Any claim that this particular link is still good. */
const SURVIVAL_PROMISE = /has not been used up|open the link again|reload this page/i

/**
 * `CallbackPage` reads `window.location` directly — that is the point of it, a
 * fragment never reaches the router — so the location is set before rendering.
 */
function renderCallback(hash: string, auth: FakeAuth) {
  window.history.replaceState({}, '', `/auth/callback${hash}`)
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${hash}`]}>
      <App authPort={auth} />
    </MemoryRouter>,
  )
}

const INVITE_FRAGMENT = '#access_token=aaa.bbb.ccc&refresh_token=rrr&type=invite'
const RECOVERY_FRAGMENT = '#access_token=aaa.bbb.ccc&refresh_token=rrr&type=recovery'

/** The routing fault: /api/session answered HTML, so standing was unknowable. */
const serviceFailure = () => new FakeAuth({ standing: 'unknown' })
/** A spent or expired link. */
const spentLink = () => new FakeAuth({ redeemResult: { ok: false, reason: 'expired' } })

describe('callback vocabulary', () => {
  describe('a recovery link never speaks about invitations', () => {
    it('service failure names the password reset, not an invitation', async () => {
      renderCallback(RECOVERY_FRAGMENT, serviceFailure())
      const main = await screen.findByRole('main')
      await waitFor(() => expect(main).toHaveTextContent(/service problem/i))

      expect(main.textContent).toMatch(RECOVERY_WORDS)
      expect(main.textContent).not.toMatch(INVITATION_WORDS)
    })

    it('service failure makes no promise that this link still works', async () => {
      renderCallback(RECOVERY_FRAGMENT, serviceFailure())
      const main = await screen.findByRole('main')
      await waitFor(() => expect(main).toHaveTextContent(/service problem/i))

      // The decisive one. The application cannot see whether GoTrue has already
      // spent the link, so it must not say the link survived.
      expect(main.textContent).not.toMatch(SURVIVAL_PROMISE)
      // And it must give the instruction that is safe either way.
      expect(main.textContent).toMatch(/request a new password reset link/i)
    })

    it('a spent recovery link names reset links, not invitations', async () => {
      renderCallback(RECOVERY_FRAGMENT, spentLink())
      const main = await screen.findByRole('main')
      await waitFor(() => expect(main).toHaveTextContent(/no longer valid/i))

      expect(main.textContent).toMatch(RECOVERY_WORDS)
      expect(main.textContent).not.toMatch(INVITATION_WORDS)
    })
  })

  describe('an invitation never speaks about password resets', () => {
    it('service failure names the invitation, not a reset link', async () => {
      renderCallback(INVITE_FRAGMENT, serviceFailure())
      const main = await screen.findByRole('main')
      await waitFor(() => expect(main).toHaveTextContent(/service problem/i))

      expect(main.textContent).toMatch(INVITATION_WORDS)
      expect(main.textContent).not.toMatch(RECOVERY_WORDS)
    })

    it('a spent invitation names invitations, not reset links', async () => {
      renderCallback(INVITE_FRAGMENT, spentLink())
      const main = await screen.findByRole('main')
      await waitFor(() => expect(main).toHaveTextContent(/no longer valid/i))

      expect(main.textContent).toMatch(INVITATION_WORDS)
      expect(main.textContent).not.toMatch(RECOVERY_WORDS)
    })

    it('an invitation MAY say the link is unspent, because nothing was exchanged', async () => {
      // Not a double standard. A service failure before redemption means the
      // invitation genuinely was not consumed; the recovery case differs only
      // because a reset link may already have been verified by GoTrue.
      renderCallback(INVITE_FRAGMENT, serviceFailure())
      const main = await screen.findByRole('main')
      await waitFor(() => expect(main).toHaveTextContent(/service problem/i))
      expect(main.textContent).toMatch(/has not been used up/i)
    })
  })

  describe('neither flow blames the allowlist for a service failure', () => {
    it.each([
      ['invitation', INVITE_FRAGMENT],
      ['recovery', RECOVERY_FRAGMENT],
    ])('%s service failure says nothing about the invitation list', async (_name, fragment) => {
      renderCallback(fragment, serviceFailure())
      const main = await screen.findByRole('main')
      await waitFor(() => expect(main).toHaveTextContent(/service problem/i))

      expect(main.textContent).not.toMatch(/invitation list|allowlist|add the address/i)
      expect(main.textContent).toMatch(/nothing wrong with your account/i)
    })
  })
})
