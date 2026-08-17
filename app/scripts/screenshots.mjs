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
