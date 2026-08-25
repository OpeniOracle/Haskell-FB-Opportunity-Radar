/**
 * Capture desktop and mobile screenshots of the built preview.
 *
 * Runs against the PRODUCTION build served locally — not the dev server — so the
 * images show what Netlify will actually serve, including the SPA fallback.
 *
 * Usage:  npm run build && npm run screenshots
 * Output: app/screenshots/*.png  (git-ignored; attached to the PR, not committed)
 */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const outDir = join(root, 'screenshots')
const PORT = 4319

if (!existsSync(dist)) {
  console.error('No dist/ directory. Run `npm run build` first.')
  process.exit(1)
}

/**
 * Playwright is resolved at runtime rather than declared as a devDependency.
 *
 * It is a ~50MB screenshot tool that neither the Netlify build nor CI needs, and
 * adding it to package.json would make every `npm ci` pay for it. Local first,
 * then the global install if there is one.
 */
async function loadChromium() {
  const require = createRequire(import.meta.url)
  const candidates = ['playwright', 'playwright-core']
  for (const name of candidates) {
    try {
      return (await import(name)).chromium
    } catch {
      /* fall through */
    }
    try {
      return require(name).chromium
    } catch {
      /* fall through */
    }
  }
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    for (const name of candidates) {
      const entry = join(globalRoot, name, 'index.mjs')
      if (existsSync(entry)) return (await import(`file://${entry}`)).chromium
      const cjs = join(globalRoot, name, 'index.js')
      if (existsSync(cjs)) return (await import(`file://${cjs}`)).default.chromium
    }
  } catch {
    /* fall through */
  }
  throw new Error(
    'Playwright is not available. Install it locally (npm i -D playwright) or globally. ' +
      'Chromium itself is already provisioned at PLAYWRIGHT_BROWSERS_PATH; do not run "playwright install".',
  )
}

const chromium = await loadChromium()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

/** Minimal static server with the same SPA fallback Netlify applies. */
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(dist, requested)

  if (!existsSync(filePath) || requested === '/' || requested.endsWith('/')) {
    filePath = join(dist, 'index.html')
  }
  if (!filePath.startsWith(dist)) {
    res.writeHead(403).end()
    return
  }

  try {
    const body = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    const fallback = await readFile(join(dist, 'index.html'))
    res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(fallback)
  }
})

const DESKTOP = { name: 'desktop', width: 1440, height: 1000, scale: 2 }
const MOBILE = { name: 'mobile', width: 390, height: 844, scale: 2 }

/**
 * Shots are declared rather than looped so each one can specify its own
 * interaction. `fullPage: false` is used where the point is what fits above the
 * fold — the ten-minute test is about what a user sees on arrival.
 */
const SHOTS = [
  { name: 'pulse-desktop-light', viewport: DESKTOP, theme: 'light', path: '/' },
  {
    name: 'opportunities-desktop-light',
    viewport: DESKTOP,
    theme: 'light',
    path: '/opportunities',
  },
  {
    name: 'pulse-desktop-light-abovefold',
    viewport: DESKTOP,
    theme: 'light',
    path: '/',
    fullPage: false,
  },
  {
    name: 'opportunities-filtered',
    viewport: DESKTOP,
    theme: 'light',
    path: '/opportunities',
    async act(page) {
      await page.selectOption('select >> nth=1', 'confirmed')
      await page.selectOption('select >> nth=6', 'newest_evidence')
      await page.waitForTimeout(150)
    },
  },
  {
    name: 'opportunity-detail-desktop',
    viewport: DESKTOP,
    theme: 'light',
    path: '/opportunities/opp-fixture-1',
  },
  {
    name: 'opportunity-detail-mobile',
    viewport: MOBILE,
    theme: 'light',
    path: '/opportunities/opp-fixture-1',
  },
  {
    name: 'reserved-market-trends',
    viewport: DESKTOP,
    theme: 'light',
    path: '/trends',
    fullPage: false,
  },
  {
    name: 'opportunity-drawer',
    viewport: DESKTOP,
    theme: 'light',
    path: '/opportunities',
    fullPage: false,
    async act(page) {
      await page.getByRole('button', { name: /^Review opportunity/ }).first().click()
      await page.waitForSelector('[role="dialog"]')
      await page.waitForTimeout(200)
    },
  },
  { name: 'pulse-desktop-dark', viewport: DESKTOP, theme: 'dark', path: '/' },
  {
    name: 'opportunities-desktop-dark',
    viewport: DESKTOP,
    theme: 'dark',
    path: '/opportunities',
  },
  { name: 'pulse-mobile-light', viewport: MOBILE, theme: 'light', path: '/' },
  {
    name: 'opportunities-mobile-light',
    viewport: MOBILE,
    theme: 'light',
    path: '/opportunities',
  },
  {
    name: 'mobile-navigation',
    viewport: MOBILE,
    theme: 'light',
    path: '/opportunities',
    fullPage: false,
  },
  { name: 'pulse-mobile-dark', viewport: MOBILE, theme: 'dark', path: '/' },
  {
    name: 'state-empty',
    viewport: DESKTOP,
    theme: 'light',
    path: '/?state=empty',
    fullPage: false,
  },
  {
    name: 'state-degraded',
    viewport: DESKTOP,
    theme: 'light',
    path: '/opportunities?state=degraded',
    fullPage: false,
  },
  {
    name: 'state-unavailable',
    viewport: DESKTOP,
    theme: 'light',
    path: '/opportunities?state=unavailable',
    fullPage: false,
  },

  /* ---- The five surfaces added in roadmap PR 2, desktop then mobile ---- */
  { name: 'company-list-desktop', viewport: DESKTOP, theme: 'light', path: '/accounts' },
  {
    name: 'company-list-filtered',
    viewport: DESKTOP,
    theme: 'light',
    path: '/accounts',
    async act(page) {
      await page.selectOption('select >> nth=0', 'below')
      await page.waitForTimeout(150)
    },
  },
  {
    name: 'company-detail-desktop',
    viewport: DESKTOP,
    theme: 'light',
    path: '/accounts/org-fixture-2',
  },
  {
    // The as-at date moved past the demerger: no controlling parent, and a
    // retained minority interest that a clean-termination model would have lost.
    name: 'company-detail-after-demerger',
    viewport: DESKTOP,
    theme: 'light',
    path: '/accounts/org-fixture-2?asOf=2027-07-01',
  },
  {
    // Healthy connectors, no resolved facilities, coverage gaps named.
    name: 'company-detail-no-facilities',
    viewport: DESKTOP,
    theme: 'light',
    path: '/accounts/org-fixture-4',
  },
  {
    name: 'facility-detail-desktop',
    viewport: DESKTOP,
    theme: 'light',
    path: '/facilities/fac-fixture-1',
  },
  {
    name: 'facility-detail-candidate',
    viewport: DESKTOP,
    theme: 'light',
    path: '/facilities/fac-fixture-2',
  },
  {
    name: 'evidence-detail-desktop',
    viewport: DESKTOP,
    theme: 'light',
    path: '/evidence/ev-fixture-2',
  },
  {
    name: 'evidence-detail-superseded',
    viewport: DESKTOP,
    theme: 'light',
    path: '/evidence/ev-fixture-1',
  },
  {
    name: 'evidence-detail-metadata-only',
    viewport: DESKTOP,
    theme: 'light',
    path: '/evidence/ev-fixture-7',
  },
  { name: 'source-health-desktop', viewport: DESKTOP, theme: 'light', path: '/admin/health' },
  {
    name: 'source-health-run-history',
    viewport: DESKTOP,
    theme: 'light',
    path: '/admin/health',
    fullPage: false,
    async act(page) {
      await page.getByText(/Run history/).nth(3).click()
      await page.waitForTimeout(150)
    },
  },
  { name: 'saved-views-desktop', viewport: DESKTOP, theme: 'light', path: '/views' },
  {
    name: 'saved-views-renaming',
    viewport: DESKTOP,
    theme: 'light',
    path: '/views',
    fullPage: false,
    async act(page) {
      await page.getByRole('button', { name: 'Rename' }).first().click()
      await page.waitForTimeout(150)
    },
  },

  { name: 'company-list-mobile', viewport: MOBILE, theme: 'light', path: '/accounts' },
  {
    name: 'company-detail-mobile',
    viewport: MOBILE,
    theme: 'light',
    path: '/accounts/org-fixture-2',
  },
  {
    name: 'facility-detail-mobile',
    viewport: MOBILE,
    theme: 'light',
    path: '/facilities/fac-fixture-2',
  },
  {
    name: 'evidence-detail-mobile',
    viewport: MOBILE,
    theme: 'light',
    path: '/evidence/ev-fixture-1',
  },
  { name: 'source-health-mobile', viewport: MOBILE, theme: 'light', path: '/admin/health' },
  { name: 'saved-views-mobile', viewport: MOBILE, theme: 'light', path: '/views' },

  /* ---- Representative non-happy states on the new surfaces ---- */
  {
    name: 'state-company-empty',
    viewport: DESKTOP,
    theme: 'light',
    path: '/accounts?state=empty',
    fullPage: false,
  },
  {
    name: 'state-company-degraded',
    viewport: DESKTOP,
    theme: 'light',
    path: '/accounts?state=degraded',
    fullPage: false,
  },
  {
    name: 'state-health-unavailable',
    viewport: DESKTOP,
    theme: 'light',
    path: '/admin/health?state=unavailable',
    fullPage: false,
  },
  {
    name: 'state-evidence-stale',
    viewport: DESKTOP,
    theme: 'light',
    path: '/evidence/ev-fixture-1?state=stale',
    fullPage: false,
  },
  {
    name: 'state-saved-views-unavailable',
    viewport: DESKTOP,
    theme: 'light',
    path: '/views?state=unavailable',
    fullPage: false,
  },
  {
    // An address that names a record that does not exist.
    name: 'state-unknown-record',
    viewport: DESKTOP,
    theme: 'light',
    path: '/accounts/no-such-company',
    fullPage: false,
  },
  {
    name: 'state-company-empty-mobile',
    viewport: MOBILE,
    theme: 'light',
    path: '/accounts?state=empty',
    fullPage: false,
  },
]

await mkdir(outDir, { recursive: true })
await new Promise((resolve) => server.listen(PORT, resolve))
console.log(`Serving dist/ on http://localhost:${PORT}`)

const browser = await chromium.launch()

try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.viewport.width, height: shot.viewport.height },
      deviceScaleFactor: shot.viewport.scale,
      colorScheme: shot.theme,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()

    await page.goto(`http://localhost:${PORT}${shot.path}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('main', { state: 'visible' })
    // Let the fixture promise resolve into a rendered surface.
    await page.waitForTimeout(250)

    if (shot.act) await shot.act(page)

    await page.screenshot({
      path: join(outDir, `${shot.name}.png`),
      fullPage: shot.fullPage !== false,
    })
    console.log(`  captured ${shot.name}.png`)

    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}

console.log(`\nScreenshots written to ${outDir}`)
