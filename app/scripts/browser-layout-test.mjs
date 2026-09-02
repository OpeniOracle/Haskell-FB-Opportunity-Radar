/**
 * Rendered-browser layout assertions for the authentication screens.
 *
 * WHY THIS EXISTS, STATED PLAINLY. The status panels shipped visually broken --
 * an icon swallowing the card, the message crushed into a column a few
 * characters wide -- and every DOM-only test passed. They passed honestly:
 * jsdom has no layout engine, so `getBoundingClientRect()` returns zeroes and
 * "the icon is 300px wide" is not a fact jsdom can hold. Accessibility tests
 * asserted roles and text, which were correct the whole time. The only way to
 * catch this class of defect is to measure a real box in a real engine, which
 * is what this does.
 *
 * The harness (`src/test/browser/harness.tsx`) mounts the real pages against
 * the test authentication fake. Nothing here contacts Supabase or Netlify.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = dirname(fileURLToPath(new URL('.', import.meta.url)))
const HARNESS = join(APP, 'dist-harness')
const SHOTS = process.env.SHOT_DIR ?? join(APP, 'browser-screenshots')

/**
 * Prefer a Chromium that is already on the machine.
 *
 * On a CI runner Playwright has installed its own and knows where it is, so the
 * answer is `undefined` and it resolves the browser itself. In this development
 * image one is pre-installed and downloading a second copy is both wasteful and
 * blocked, so it is located by path. Returning `undefined` rather than a guess
 * matters: a wrong explicit path fails with a confusing "executable not found"
 * instead of falling back.
 */
async function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root) return undefined
  try {
    for (const entry of await readdir(root)) {
      if (!entry.startsWith('chromium-') || entry.includes('headless')) continue
      return join(root, entry, 'chrome-linux', 'chrome')
    }
  } catch {
    return undefined
  }
  return undefined
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

/**
 * Serves the harness for EVERY path.
 *
 * That is what makes `/auth/callback#access_token=...` reachable: the browser's
 * real URL carries the fragment, the router sees the real path, and the
 * callback parses what Supabase would actually have sent.
 */
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const path = (request.url ?? '/').split('?')[0]
      let file = join(HARNESS, path)
      if (!extname(path) || path === '/') file = join(HARNESS, 'src/test/browser/harness.html')
      try {
        const body = await readFile(file)
        response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
        response.end(body)
      } catch {
        const body = await readFile(join(HARNESS, 'src/test/browser/harness.html'))
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(body)
      }
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

const VIEWPORTS = [
  { name: '360', width: 360, height: 780 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
]

let pass = 0
const failures = []
function check(what, condition, why = '') {
  if (condition) { pass++; return true }
  failures.push(`${what}${why ? ` -- ${why}` : ''}`)
  return false
}

/**
 * The measurements that would have caught the shipped defect.
 *
 * Stated as properties of the rendered box rather than as pixel snapshots: a
 * snapshot fails on any redesign and tells you nothing about why, while
 * "the icon is at most 24px and the message has most of the width" is the
 * actual requirement and survives restyling.
 */
async function measureCallout(page, selector, label, viewport) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const icon = el.querySelector('svg')
    const text = el.querySelector('[data-status-message]') ?? el.querySelector('span:not([class*="visually-hidden"])')
    const card = el.closest('.auth-card')
    const r = (n) => (n ? n.getBoundingClientRect() : null)
    const cs = getComputedStyle(el)
    return {
      callout: r(el), icon: r(icon), text: r(text), card: r(card),
      styles: { position: cs.position, overflow: cs.overflow },
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      role: el.getAttribute('role'),
      ariaLive: el.getAttribute('aria-live'),
      textContent: (text?.textContent ?? '').trim(),
    }
  }, selector)

  const at = `${label} @${viewport.name}`
  if (!check(`${at}: callout is present`, box !== null, `no element matched ${selector}`)) return

  // 1. THE DEFECT. An icon with no intrinsic size expands to fill its flex
  //    line; `flex: none` then refuses to shrink it. 24px is the stated cap.
  check(`${at}: icon is at most 24px wide`, box.icon && box.icon.width <= 24.5,
    `icon is ${box.icon?.width?.toFixed(1)}px`)
  check(`${at}: icon is at most 24px tall`, box.icon && box.icon.height <= 24.5,
    `icon is ${box.icon?.height?.toFixed(1)}px tall`)
  check(`${at}: icon is at least 16px`, box.icon && box.icon.width >= 15.5,
    `icon is ${box.icon?.width?.toFixed(1)}px -- too small to read`)
  check(`${at}: icon is square, not stretched`, box.icon && Math.abs(box.icon.width - box.icon.height) <= 1.5,
    `icon is ${box.icon?.width?.toFixed(1)}x${box.icon?.height?.toFixed(1)}`)

  // 2. The message gets the remaining width, not a narrow column.
  const share = box.text && box.callout ? box.text.width / box.callout.width : 0
  check(`${at}: message takes most of the callout width`, share >= 0.6,
    `message has ${(share * 100).toFixed(0)}% of the callout`)
  check(`${at}: message column is readable`, box.text && box.text.width >= 180,
    `message column is ${box.text?.width?.toFixed(1)}px`)

  // 3. No fixed-height colour panel, and no overflow past the card.
  check(`${at}: callout is not a tall panel`, box.callout && box.callout.height <= 200,
    `callout is ${box.callout?.height?.toFixed(1)}px tall`)
  check(`${at}: callout stays inside the card`,
    box.card && box.callout && box.callout.left >= box.card.left - 1 && box.callout.right <= box.card.right + 1,
    `callout ${box.callout?.left?.toFixed(0)}-${box.callout?.right?.toFixed(0)} vs card ${box.card?.left?.toFixed(0)}-${box.card?.right?.toFixed(0)}`)
  check(`${at}: page does not scroll sideways`, box.docScrollWidth <= box.innerWidth + 1,
    `document is ${box.docScrollWidth}px wide in a ${box.innerWidth}px viewport`)

  return box
}

/**
 * The "Continue with Microsoft" button, measured rather than inspected.
 *
 * Its shape is the same one that shipped broken once: a fixed-size mark beside
 * a flexible label inside a flex row. An unsized `<svg>` in that position
 * expands to fill the line and squeezes the label to nothing, and no DOM-only
 * test in this repository can see it happen.
 *
 * The 44px floor is not decoration. It is the smallest comfortable touch target
 * on a phone, and this is the primary sign-in control for every reviewer who
 * has no password.
 */
async function measureProviderButton(page, viewport) {
  const box = await page.evaluate(() => {
    const button = document.querySelector('.auth-provider__button')
    if (!button) return null
    const mark = button.querySelector('svg')
    const label = button.querySelector('span')
    const card = button.closest('.auth-card')
    const divider = document.querySelector('.auth-provider__divider')
    const r = (n) => (n ? n.getBoundingClientRect() : null)
    return {
      button: r(button), mark: r(mark), label: r(label), card: r(card), divider: r(divider),
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      text: (button.textContent ?? '').trim(),
    }
  })

  const at = `microsoft button @${viewport.name}`
  if (!check(`${at}: is present`, box !== null, 'no .auth-provider__button')) return

  check(`${at}: says what it does`, /continue with microsoft/i.test(box.text), box.text)

  // The brand mark is a fixed box that can neither grow into the label nor
  // shrink out of sight.
  check(`${at}: mark is at most 24px wide`, box.mark && box.mark.width <= 24.5,
    `mark is ${box.mark?.width?.toFixed(1)}px`)
  check(`${at}: mark is at least 14px`, box.mark && box.mark.width >= 13.5,
    `mark is ${box.mark?.width?.toFixed(1)}px -- too small to recognise`)
  check(`${at}: mark is square`, box.mark && Math.abs(box.mark.width - box.mark.height) <= 1.5,
    `mark is ${box.mark?.width?.toFixed(1)}x${box.mark?.height?.toFixed(1)}`)

  // A comfortable target, and the full width of the card.
  check(`${at}: is at least 44px tall`, box.button && box.button.height >= 43.5,
    `button is ${box.button?.height?.toFixed(1)}px tall`)
  check(`${at}: fills the card width`,
    box.card && box.button && box.button.width >= box.card.width * 0.8,
    `button ${box.button?.width?.toFixed(0)}px in a ${box.card?.width?.toFixed(0)}px card`)
  check(`${at}: stays inside the card`,
    box.card && box.button && box.button.left >= box.card.left - 1 && box.button.right <= box.card.right + 1,
    `button ${box.button?.left?.toFixed(0)}-${box.button?.right?.toFixed(0)} vs card ${box.card?.left?.toFixed(0)}-${box.card?.right?.toFixed(0)}`)

  // The divider between the two ways in. Two flexible rules either side of a
  // label; at a narrow width they must still leave the label readable.
  check(`${at}: the divider stays inside the card`,
    box.card && box.divider && box.divider.width <= box.card.width + 1,
    `divider is ${box.divider?.width?.toFixed(1)}px in a ${box.card?.width?.toFixed(1)}px card`)

  check(`${at}: page does not scroll sideways`, box.docScrollWidth <= box.innerWidth + 1,
    `document is ${box.docScrollWidth}px wide in a ${box.innerWidth}px viewport`)

  return box
}

async function shoot(page, name) {
  await mkdir(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true })
}

const { server, port } = await serve()
const browser = await chromium.launch({ executablePath: await findChromium() })
const base = `http://127.0.0.1:${port}`
const tag = process.env.SHOT_TAG ?? 'after'

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    const page = await context.newPage()

    // ---- 1. Login failure -------------------------------------------------
    await page.goto(`${base}/login?scenario=login`)
    await page.getByLabel(/email/i).fill('analyst@openi-analytics.invalid')
    await page.getByLabel(/password/i).fill('whatever-was-typed')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.getByRole('alert').waitFor()
    await measureCallout(page, '[data-testid="auth-status-error"]', 'login failure', viewport)
    check(`login failure @${viewport.name}: says nothing about whether the account exists`,
      !/no such|unknown|not found|does not exist/i.test(await page.getByRole('alert').innerText()))
    await shoot(page, `${tag}-login-failure-${viewport.name}`)

    // ---- 2. Invitation failure -------------------------------------------
    await page.goto(`${base}/auth/callback?scenario=callback-failure#error=access_denied`)
    await page.getByText(/no longer valid|cannot be used/i).first().waitFor()
    await measureCallout(page, '[data-testid="auth-status-error"]', 'invitation failure', viewport)
    await shoot(page, `${tag}-invitation-failure-${viewport.name}`)

    // ---- 3. Forgot-password confirmation ---------------------------------
    await page.goto(`${base}/forgot-password?scenario=forgot-sent`)
    await page.getByLabel(/email/i).fill('analyst@openi-analytics.invalid')
    await page.getByRole('button', { name: /email me a link/i }).click()
    await page.getByText(/is on its way/i).waitFor()
    const notice = await measureCallout(page, '[data-testid="auth-status-notice"]', 'recovery confirmation', viewport)
    check(`recovery confirmation @${viewport.name}: keeps the non-enumerating wording`,
      /if that address has an account/i.test(notice?.textContent ?? ''), notice?.textContent)
    check(`recovery confirmation @${viewport.name}: is a polite live region, not an alert`,
      notice?.ariaLive === 'polite' || notice?.role === 'status', `role=${notice?.role} aria-live=${notice?.ariaLive}`)
    await shoot(page, `${tag}-recovery-confirmation-${viewport.name}`)

    // ---- 3b. Recovery code entry -----------------------------------------
    //
    // The scanner-resistant recovery step. Measured like every other screen
    // because it is now on the onboarding path for every pre-provisioned
    // reviewer, not an edge case reached after a failure.
    await page.goto(`${base}/auth/reset-password?scenario=recovery-code`)
    await page.getByRole('heading', { name: /enter your recovery code/i }).waitFor()

    const codeField = page.getByLabel(/six-digit code/i)
    check(`recovery code @${viewport.name}: offers the one-time-code autofill hint`,
      (await codeField.getAttribute('autocomplete')) === 'one-time-code',
      await codeField.getAttribute('autocomplete'))
    check(`recovery code @${viewport.name}: asks for a numeric keypad`,
      (await codeField.getAttribute('inputmode')) === 'numeric',
      await codeField.getAttribute('inputmode'))

    const codeBox = await codeField.boundingBox()
    check(`recovery code @${viewport.name}: the code field is a full-size touch target`,
      (codeBox?.height ?? 0) >= 40, `height ${codeBox?.height}`)
    check(`recovery code @${viewport.name}: the code field fits the viewport`,
      (codeBox?.width ?? 0) <= viewport.width, `width ${codeBox?.width} vs ${viewport.width}`)

    await shoot(page, `${tag}-recovery-code-${viewport.name}`)

    // A refused code: generic, recovery-specific, and never invitation wording.
    await page.getByLabel(/email address/i).fill('analyst@openi-analytics.invalid')
    await codeField.fill('999999')
    await page.getByRole('button', { name: /continue/i }).click()
    await page.getByRole('alert').waitFor()
    const refusal = await measureCallout(page, '[data-testid="auth-status-error"]', 'recovery code refusal', viewport)
    check(`recovery code refusal @${viewport.name}: says nothing about the account`,
      /was not accepted/i.test(refusal?.textContent ?? ''), refusal?.textContent)
    check(`recovery code refusal @${viewport.name}: never uses invitation wording`,
      !/invitation|invite/i.test(refusal?.textContent ?? ''), refusal?.textContent)
    check(`recovery code refusal @${viewport.name}: clears the code from the field`,
      (await codeField.inputValue()) === '', await codeField.inputValue())
    await shoot(page, `${tag}-recovery-code-refused-${viewport.name}`)

    // ---- 4. Password policy ----------------------------------------------
    await page.goto(`${base}/auth/set-password?scenario=password-policy`)
    await page.getByLabel(/^new password|^password$/i).first().fill('short')
    await page.getByLabel(/confirm|again|repeat/i).first().fill('short')
    await page.getByRole('button', { name: /save|set|continue/i }).first().click()
    await page.getByRole('alert').waitFor()
    await measureCallout(page, '[data-testid="auth-status-error"]', 'password policy', viewport)
    await shoot(page, `${tag}-password-policy-${viewport.name}`)

    // ---- 5. Password mismatch --------------------------------------------
    await page.goto(`${base}/auth/set-password?scenario=password-mismatch`)
    await page.getByLabel(/^new password|^password$/i).first().fill('a-long-enough-password')
    await page.getByLabel(/confirm|again|repeat/i).first().fill('a-different-password')
    await page.getByRole('button', { name: /save|set|continue/i }).first().click()
    await page.getByRole('alert').waitFor()
    await measureCallout(page, '[data-testid="auth-status-error"]', 'password mismatch', viewport)
    await shoot(page, `${tag}-password-mismatch-${viewport.name}`)

    // ---- 5. "Continue with Microsoft", at every width --------------------
    await page.goto(`${base}/login?scenario=microsoft-login`)
    await page.getByRole('button', { name: /continue with microsoft/i }).waitFor()
    await measureProviderButton(page, viewport)

    // The password form has to survive beside it. A fallback that is pushed
    // off the card, or off the screen, is not a fallback.
    const passwordBox = await page.getByLabel(/password/i).boundingBox()
    check(`microsoft button @${viewport.name}: the password field is still on screen`,
      passwordBox !== null && passwordBox.width > 0 && passwordBox.x >= 0
        && passwordBox.x + passwordBox.width <= viewport.width + 1,
      `password field at ${passwordBox?.x?.toFixed(0)} width ${passwordBox?.width?.toFixed(0)}`)
    await shoot(page, `${tag}-microsoft-login-${viewport.name}`)

    await context.close()
  }

  // ---- 6. The invitation journey, once, at a phone width -----------------
  //
  // A realistic Supabase implicit redirect: the credential arrives in the
  // FRAGMENT, which never reaches a server and is destroyed by any navigation.
  // This proves it is captured, scrubbed from the address bar and from history,
  // and followed by the set-password form -- never by /login.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const fragment =
    '#access_token=eyJhbGciOiJIUzI1NiJ9.fake-invitation-payload.signature' +
    '&expires_at=9999999999&expires_in=3600&refresh_token=fake-refresh-token' +
    '&token_type=bearer&type=invite'
  await page.goto(`${base}/auth/callback?scenario=invitation${fragment}`)
  await page.waitForURL(/\/auth\/set-password/, { timeout: 5000 }).catch(() => {})

  const journey = await page.evaluate(() => ({
    path: window.location.pathname,
    hash: window.location.hash,
    search: window.location.search,
    href: window.location.href,
    historyLength: window.history.length,
    body: document.body.innerText,
  }))
  check('invitation journey: lands on /auth/set-password', journey.path === '/auth/set-password', `landed on ${journey.path}`)
  check('invitation journey: never lands on /login', journey.path !== '/login', `landed on ${journey.path}`)
  check('invitation journey: no token left in the address bar', !/access_token|refresh_token|token_hash|[?&]code=/.test(journey.href), journey.href)
  check('invitation journey: the set-password form is on screen', /password/i.test(journey.body))
  await shoot(page, `${tag}-invitation-journey-390`)

  // Back must not reach the credential either.
  await page.goBack().catch(() => {})
  const afterBack = await page.evaluate(() => window.location.href)
  check('invitation journey: Back does not reach the credential',
    !/access_token|refresh_token/.test(afterBack), afterBack)

  // ---- 6b. The four callback outcomes are four different screens --------
  //
  // A service failure and a missing allowlist row are different problems with
  // different fixes, and conflating them cost an operator an hour looking at a
  // row that was present. These assert the words on the screen, at a phone
  // width, in a real browser.
  const fragment2 = '#access_token=eyJhbGciOiJIUzI1NiJ9.fake.sig&refresh_token=r&type=invite'

  await page.goto(`${base}/auth/callback?scenario=callback-service-failure${fragment2}`)
  await page.getByRole('alert').waitFor()
  const serviceText = await page.evaluate(() => document.body.innerText)
  check('service failure: says it is a service problem', /service problem/i.test(serviceText))
  check('service failure: does NOT blame the allowlist',
    !/invitation list|allowlist|add the address/i.test(serviceText),
    serviceText.replace(/\s+/g, ' ').slice(0, 220))
  check('service failure: says the invitation is not used up',
    /not been used up|open the link again/i.test(serviceText))
  await measureCallout(page, '[data-testid="auth-status-error"]', 'callback service failure', { name: '390' })
  await shoot(page, `${tag}-callback-service-failure-390`)

  await page.goto(`${base}/auth/callback?scenario=callback-not-invited${fragment2}`)
  await page.getByRole('alert').waitFor()
  const delistedText = await page.evaluate(() => document.body.innerText)
  check('removed from allowlist: names the invitation list',
    /invitation list/i.test(delistedText))
  check('removed from allowlist: does not call it a service problem',
    !/service problem/i.test(delistedText))
  await shoot(page, `${tag}-callback-not-invited-390`)

  await context.close()

  // ---- 7. Dark theme, because the callouts are colour-carrying ----------
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const darkPage = await dark.newPage()
  await darkPage.goto(`${base}/login?scenario=login&theme=dark`)
  await darkPage.getByLabel(/email/i).fill('analyst@openi-analytics.invalid')
  await darkPage.getByLabel(/password/i).fill('whatever-was-typed')
  await darkPage.getByRole('button', { name: /sign in/i }).click()
  await darkPage.getByRole('alert').waitFor()
  await measureCallout(darkPage, '[data-testid="auth-status-error"]', 'login failure (dark)', { name: '390-dark' })
  await shoot(darkPage, `${tag}-login-failure-390-dark`)

  // The recovery code page in the dark palette, at mobile width. It is the
  // first screen a pre-provisioned reviewer meets, and half of them will open
  // it on a phone at night.
  await darkPage.goto(`${base}/auth/reset-password?scenario=recovery-code&theme=dark`)
  await darkPage.getByRole('heading', { name: /enter your recovery code/i }).waitFor()

  const darkCode = darkPage.getByLabel(/six-digit code/i)
  const darkBox = await darkCode.boundingBox()
  check('recovery code @390-dark: the code field fits the viewport',
    (darkBox?.width ?? 0) <= 390, `width ${darkBox?.width}`)
  check('recovery code @390-dark: the code field is a full-size touch target',
    (darkBox?.height ?? 0) >= 40, `height ${darkBox?.height}`)

  // Contrast is carried by the tokens, so the check that matters is that the
  // palette actually changed rather than the page rendering light-on-light.
  const darkInk = await darkCode.evaluate((el) => {
    const style = getComputedStyle(el)
    return { color: style.color, background: style.backgroundColor }
  })
  check('recovery code @390-dark: takes its colours from the dark palette',
    darkInk.color !== darkInk.background, JSON.stringify(darkInk))
  await shoot(darkPage, `${tag}-recovery-code-390-dark`)

  await darkPage.getByLabel(/email address/i).fill('analyst@openi-analytics.invalid')
  await darkCode.fill('999999')
  await darkPage.getByRole('button', { name: /continue/i }).click()
  await darkPage.getByRole('alert').waitFor()
  const darkRefusal = await measureCallout(darkPage, '[data-testid="auth-status-error"]', 'recovery code refusal (dark)', { name: '390-dark' })

  // "Continue with Microsoft" in the dark palette, at mobile width. The brand
  // mark is four fixed colours that are NOT themed, so this is the one control
  // on the page whose contrast cannot be fixed by a token -- which is exactly
  // why it sits on a surface-coloured button rather than an accent-filled one.
  await darkPage.goto(`${base}/login?scenario=microsoft-login&theme=dark`)
  await darkPage.getByRole('button', { name: /continue with microsoft/i }).waitFor()
  await measureProviderButton(darkPage, { name: '390-dark' })

  const darkButtonContrast = await darkPage.evaluate(() => {
    const button = document.querySelector('.auth-provider__button')
    if (!button) return null
    const cs = getComputedStyle(button)
    const parse = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const luminance = ([r, g, b]) => {
      const f = (c) => {
        const v = c / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const bg = parse(cs.backgroundColor)
    const fg = parse(cs.color)
    if (bg.length < 3 || fg.length < 3) return null
    const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
  })
  check('microsoft button @390-dark: label meets 4.5:1 against its own background',
    darkButtonContrast !== null && darkButtonContrast >= 4.5,
    `contrast is ${darkButtonContrast?.toFixed(2)}:1`)
  await shoot(darkPage, `${tag}-microsoft-login-390-dark`)

  /*
     AUTHENTICATED BY MICROSOFT, AND REFUSED.

     The screen anybody in either tenant can reach. It must not name an
     allowlist, must not name an address, and must not describe itself in
     invitation language -- a person who signed in with Microsoft was never
     invited by email and has no invitation to be told about.
  */
  await darkPage.goto(`${base}/auth/callback?scenario=microsoft-denied&flow=microsoft&code=harness-code`)
  await darkPage.getByRole('heading', { name: /not authorized/i }).waitFor()
  const deniedText = await darkPage.evaluate(
    () => document.querySelector('.auth-card')?.textContent ?? '',
  )
  check('microsoft denied: does not mention an allowlist',
    !/allowlist|allow list|invitation list/i.test(deniedText), deniedText.slice(0, 120))
  check('microsoft denied: does not use invitation language',
    !/invitation|invite/i.test(deniedText), deniedText.slice(0, 120))
  check('microsoft denied: says access was not granted',
    /not authorized/i.test(deniedText), deniedText.slice(0, 120))
  const deniedUrl = darkPage.url()
  check('microsoft denied: the code is gone from the address bar',
    !deniedUrl.includes('harness-code'), deniedUrl)
  await measureCallout(darkPage, '[data-testid="auth-status-error"]', 'microsoft denied (dark)', { name: '390-dark' })
  await shoot(darkPage, `${tag}-microsoft-denied-390-dark`)
  check('recovery code refusal @390-dark: never uses invitation wording',
    !/invitation|invite/i.test(darkRefusal?.textContent ?? ''), darkRefusal?.textContent)
  await shoot(darkPage, `${tag}-recovery-code-refused-390-dark`)

  await dark.close()
} finally {
  await browser.close()
  server.close()
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const failure of failures) console.log(`  FAIL  ${failure}`)
console.log(`screenshots: ${SHOTS}`)
process.exit(failures.length ? 1 : 0)
