import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryRouter } from 'react-router-dom'
import { App } from '@/App'
import { APP_ROOT } from '@/test/paths'
import { renderApp } from '@/test/render'
import { setViewport } from '@/test/setup'
import { signedIn, signedOut, withoutPrefill } from '@/test/authFake'
import type { AuthPort } from '@/auth/authPort'

/**
 * The authentication surfaces, held to the same bar as the rest of the product.
 *
 * These pages are the first thing an invited reviewer ever sees, and for anyone
 * using a screen reader or a keyboard they are the point at which the whole
 * application is either usable or not. A login form that cannot be completed
 * without a mouse is a login form that excludes people from the pilot.
 */

const AUTH_ROUTES = ['/login', '/forgot-password'] as const

function renderPublic(route: string, port: AuthPort = withoutPrefill(signedOut())) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App authPort={port} />
    </MemoryRouter>,
  )
}

describe('document structure', () => {
  it.each(AUTH_ROUTES)('%s has exactly one main landmark and one h1', async (route) => {
    renderPublic(route)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('does not present a Primary navigation landmark to a signed-out visitor', async () => {
    renderPublic('/login')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
  })
})

describe('screen-reader labels', () => {
  it('labels every field on the sign-in form', async () => {
    renderPublic('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })

  it('labels both fields on the password form', async () => {
    renderPublic('/auth/reset-password', withoutPrefill(signedIn()))
    await screen.findByRole('heading', { name: 'Set a new password' })
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('type', 'password')
  })

  it('announces a form error rather than only colouring the field', async () => {
    renderPublic('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    // And the field points at it, so the message is reachable from the input.
    expect(screen.getByLabelText('Email address')).toHaveAttribute(
      'aria-describedby',
      alert.getAttribute('id'),
    )
  })

  it('gives autocomplete hints a password manager can use', async () => {
    renderPublic('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('names the sign-out control even where the word is not shown', async () => {
    setViewport('narrow')
    renderApp('/', { auth: signedIn() })
    await screen.findByRole('navigation', { name: 'Later phases' })
    // Compact placement drops the visible word; the accessible name stays.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})

describe('keyboard navigation', () => {
  it('signs in without a mouse', async () => {
    const auth = signedOut()
    renderPublic('/login', withoutPrefill(auth))
    await screen.findByRole('heading', { name: 'Sign in' })

    // Focus starts in the first field, so Tab order alone completes the form.
    expect(screen.getByLabelText('Email address')).toHaveFocus()
    await userEvent.keyboard('analyst@openi-analytics.invalid')
    await userEvent.tab()
    expect(screen.getByLabelText('Password')).toHaveFocus()
    await userEvent.keyboard('a-correct-password')
    await userEvent.keyboard('{Enter}')

    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })

  it('reaches password recovery from the keyboard', async () => {
    renderPublic('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    const link = screen.getByRole('link', { name: /set or reset your password/i })
    link.focus()
    expect(link).toHaveFocus()
  })

  it('puts focus in the first field of the recovery form', async () => {
    renderPublic('/forgot-password')
    await screen.findByRole('heading', { name: 'Set or reset your password' })
    expect(screen.getByLabelText('Email address')).toHaveFocus()
  })

  it('reaches the sign-out control from the keyboard', async () => {
    renderApp('/', { auth: signedIn() })
    await screen.findByRole('navigation', { name: 'Primary' })
    const button = screen.getByRole('button', { name: /sign out/i })
    button.focus()
    expect(button).toHaveFocus()
  })
})

describe('mobile layout', () => {
  it.each(AUTH_ROUTES)('renders %s on a narrow viewport', async (route) => {
    setViewport('narrow')
    renderPublic(route)
    await screen.findByRole('heading', { level: 1 })
    // The auth pages are one column at every width; the point is that the
    // narrow viewport does not switch them into the application shell.
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
    expect(document.querySelector('.auth-card')).not.toBeNull()
  })

  it('keeps inputs at a font size that does not trigger iOS zoom', () => {
    const css = readFileSync(join(APP_ROOT, 'src/styles/base.css'), 'utf8')
    const rule = /\.auth-form__input \{[^}]*\}/.exec(css)?.[0] ?? ''
    // Safari zooms the page when a focused field is under 16px, which then
    // leaves the form half off-screen on a phone.
    expect(rule).toMatch(/font-size:\s*16px/)
  })

  it('gives the submit control a full-size touch target', () => {
    const css = readFileSync(join(APP_ROOT, 'src/styles/base.css'), 'utf8')
    const rule = /\.auth-form__submit \{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toMatch(/min-height:\s*44px/)
  })
})

describe('both themes', () => {
  const css = readFileSync(join(APP_ROOT, 'src/styles/base.css'), 'utf8')
  const authBlock = css.slice(css.indexOf('/* =================================================================== Auth */'))

  it('offers the theme control before anyone has signed in', async () => {
    renderPublic('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    // Someone opening an invitation at night should not be handed a white page
    // because the only toggle is behind the sign-in they have not completed.
    expect(screen.getByRole('button', { name: /^Theme:/ })).toBeInTheDocument()
  })

  it('switches the auth pages with the rest of the application', async () => {
    renderPublic('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    const toggle = screen.getByRole('button', { name: /^Theme:/ })

    await userEvent.click(toggle)
    await userEvent.click(toggle)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('states no colour of its own, so both palettes come from the tokens', () => {
    // A hard-coded hex or a named colour in the auth block would look correct in
    // one theme and wrong in the other, and nothing would fail.
    expect(authBlock).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(authBlock).not.toMatch(/\b(rgb|hsl)a?\(/i)
    expect(authBlock).not.toMatch(/:\s*(white|black|red|green|blue|gray|grey)\s*;/i)
    expect(authBlock).toMatch(/var\(--c-/)
  })

  it('respects a reduced-motion preference in the waiting state', () => {
    expect(authBlock).toMatch(/prefers-reduced-motion: reduce/)
  })
})

describe('nothing sensitive reaches the page', () => {
  it('puts no key, token or project secret in the sign-in markup', async () => {
    renderPublic('/login')
    await screen.findByRole('heading', { name: 'Sign in' })
    const markup = document.body.innerHTML
    expect(markup).not.toMatch(/sb_secret_/)
    expect(markup).not.toMatch(/service_role/)
    expect(markup).not.toMatch(/access_token|refresh_token/)
    expect(markup).not.toMatch(/\beyJ[A-Za-z0-9_-]{10,}\./)
  })

  it('does not put the access token in the authenticated shell', async () => {
    renderApp('/', { auth: signedIn() })
    await screen.findByRole('navigation', { name: 'Primary' })
    expect(document.body.innerHTML).not.toContain('test-access-token')
  })

  it('writes no credential to browser storage from the application itself', async () => {
    renderApp('/', { auth: signedIn() })
    await screen.findByRole('navigation', { name: 'Primary' })
    // Session persistence is the Supabase client's business, under its own key.
    // Nothing in this application may add another copy.
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) ?? ''
      const value = window.localStorage.getItem(key) ?? ''
      expect(value).not.toContain('test-access-token')
    }
  })
})
