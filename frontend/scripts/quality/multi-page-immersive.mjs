import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const baseURL = new URL(process.env.BASE_URL || process.env.QUALITY_BASE_URL || 'http://127.0.0.1:5173')
if (!['http:', 'https:'].includes(baseURL.protocol) || baseURL.username || baseURL.password) {
  throw new Error('BASE_URL must be an HTTP(S) URL without embedded credentials.')
}

const reportDirectory = await mkdtemp(join(tmpdir(), 'multi-page-immersive-'))
const report = {
  baseURL: baseURL.origin,
  startedAt: new Date().toISOString(),
  profiles: [],
  skipped: [],
  checks: [],
  pageErrors: [],
}
let browser

function check(name, passed, evidence = {}) {
  report.checks.push({ name, passed, ...evidence })
  console.log(JSON.stringify({ name, result: passed ? 'pass' : 'fail', ...evidence }))
}

function routeURL(path) {
  return new URL(path, baseURL).href
}

function relativeLuminance(rgb) {
  const [red, green, blue] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

async function getFixture(path) {
  try {
    const response = await fetch(routeURL(path), { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function diagnostics(page) {
  return page.evaluate(() => window.__visualRuntimeDiagnostics?.() ?? null)
}

async function waitForPage(page, pageId) {
  await page.waitForFunction((expected) => {
    const state = window.__visualRuntimeDiagnostics?.()
    return state?.activePageId === expected || state?.fallback === true
  }, pageId, { timeout: 15000 })
  await page.waitForTimeout(220)
}

async function clickNavigation(page, path, mobile) {
  if (mobile) {
    await page.getByRole('button', { name: '打开导航' }).click()
    await page.locator(`#mobile-navigation a[href="${path}"]`).click()
  } else {
    await page.locator(`.desktop-navigation a[href="${path}"]`).click()
  }
  await page.waitForURL((url) => url.pathname === path, { timeout: 15000 })
}

async function capturePage(page, profile, name) {
  const pathname = new URL(page.url()).pathname
  const diagnostic = await diagnostics(page)
  const canvasCount = await page.locator('canvas').count()
  const canvasIdentityPreserved = await page.evaluate(() =>
    window.__initialImmersiveCanvas === (document.querySelector('canvas') ?? null),
  )
  const pageId = diagnostic?.activePageId ?? null
  const expected = pathname.startsWith('/works/') ? 'work-detail'
    : pathname.startsWith('/documents/') ? 'library'
    : ({
    '/': 'home',
    '/works': 'works',
    '/about': 'about',
    '/writing': 'archive',
    '/search': 'archive',
    '/documents': 'library',
    '/transfer': null,
    })[pathname]
  const canvasSafe = canvasCount === 1 && await page.locator('canvas').evaluate((element) =>
    element.getAttribute('aria-hidden') === 'true' && getComputedStyle(element).pointerEvents === 'none',
  )
  const sceneMatches = expected === null
    ? diagnostic?.activePageId === null
    : diagnostic?.activePageId === expected

  check(`${profile.name}: ${name} DOM and runtime`, canvasCount === 1 && canvasSafe && sceneMatches, {
    path: pathname,
    canvasCount,
    diagnosticAvailable: Boolean(diagnostic),
    activePageId: pageId,
    rendererCount: diagnostic?.rendererCount ?? null,
    rafActive: diagnostic?.rafActive ?? null,
    qualityTier: diagnostic?.qualityTier ?? null,
    frameTimeMs: diagnostic?.frameTimeMs ?? null,
    fallback: diagnostic?.fallback ?? null,
    canvasSafe,
    sameCanvas: canvasIdentityPreserved,
  })
  if (diagnostic) {
    check(`${profile.name}: ${name} has at most one renderer`, diagnostic.rendererCount <= 1, {
      path: pathname,
      rendererCount: diagnostic.rendererCount,
    })
  }
  const screenshotPath = join(reportDirectory, `${profile.name}-${name}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })
  const record = { profile: profile.name, name, path: pathname, screenshotPath, canvasCount, diagnostic }
  const profileReport = report.profiles.find((item) => item.name === profile.name)
  profileReport.pages.push(record)
}

async function runProfile(profile, fixtures) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.isMobile,
    reducedMotion: profile.reducedMotion ? 'reduce' : 'no-preference',
  })
  const page = await context.newPage()
  const profileReport = { ...profile, pages: [] }
  report.profiles.push(profileReport)
  page.on('pageerror', (error) => report.pageErrors.push({ profile: profile.name, message: error.message }))

  await page.goto(routeURL('/'), { waitUntil: 'domcontentloaded' })
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 20000 })
  await waitForPage(page, 'home')
  await page.evaluate(() => { window.__initialImmersiveCanvas = document.querySelector('canvas') })
  const initialState = await diagnostics(page)
  check(`${profile.name}: diagnostics exposed`, Boolean(initialState), { diagnostic: initialState })
  check(`${profile.name}: Home is readable with one canvas`, await page.locator('main h1').count() > 0 && await page.locator('canvas').count() === 1)
  if (profile.reducedMotion && initialState) {
    check(`${profile.name}: reduced motion keeps runtime static`, initialState.rafActive === false && await page.locator('canvas').evaluate((element) => getComputedStyle(element).display === 'none'))
  }
  await capturePage(page, profile, 'home')
  if (!profile.reducedMotion) {
    await page.locator('.motion-toggle').click()
    await page.waitForFunction(() => window.__visualRuntimeDiagnostics?.()?.rafActive === false)
    check(`${profile.name}: manual pause stops the shared RAF`, (await diagnostics(page))?.rafActive === false)
    await page.locator('.motion-toggle').click()
    await page.waitForFunction(() => window.__visualRuntimeDiagnostics?.()?.rafActive === true)
    check(`${profile.name}: resuming motion restarts the shared RAF`, (await diagnostics(page))?.rafActive === true)
  }

  await clickNavigation(page, '/works', profile.isMobile)
  await page.locator('.work-filters').waitFor({ state: 'visible' })
  await waitForPage(page, 'works')
  check(`${profile.name}: work category filters remain operable`, await page.locator('.work-filters a').count() >= 4)
  if (profile.isMobile) {
    check(`${profile.name}: narrow layout has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  }
  await capturePage(page, profile, 'works')

  const musicFilter = page.locator('.work-filters a[href*="type=music"]')
  await musicFilter.click()
  await page.waitForURL((url) => url.pathname === '/works' && url.searchParams.get('type') === 'music')
  await page.locator('.work-card').first().waitFor({ state: 'visible', timeout: 15000 })
  check(`${profile.name}: music filter updates its visible work list`, await page.locator('.work-card').count() > 0)
  const work = fixtures.musicWork
  if (work) {
    await page.locator(`a.work-card[href="/works/${work.slug}"]`).click()
    await page.waitForURL((url) => url.pathname === `/works/${work.slug}`)
    await page.locator('.work-detail h1').waitFor({ state: 'visible', timeout: 15000 })
    await waitForPage(page, 'work-detail')
    const mediaElement = page.locator('.work-player audio, .work-player video')
    check(`${profile.name}: WorkPlayer stays in the DOM`, await mediaElement.count() === 1 && await mediaElement.getAttribute('preload') === 'none', { slug: work.slug })
    const playerModes = page.locator('.player-modes button')
    if (await playerModes.count() === 2) {
      await page.locator('.player-modes button[data-mode="video"]').click()
      check(`${profile.name}: WorkPlayer switches modes without autoplay`, await page.locator('.work-player video').count() === 1 && await page.locator('.work-player video').getAttribute('preload') === 'none' && await page.locator('.player-modes button[data-mode="video"]').getAttribute('aria-pressed') === 'true')
      await page.locator('.player-modes button[data-mode="audio"]').click()
    }
    await capturePage(page, profile, 'work-detail')
  } else {
    report.skipped.push({ profile: profile.name, check: 'WorkDetail and WorkPlayer', reason: 'No public music work with media was returned by the API.' })
  }

  await clickNavigation(page, '/about', profile.isMobile)
  await page.locator('.about-sidebar').waitFor({ state: 'visible' })
  await waitForPage(page, 'about')
  await page.locator('.about-sidebar a[href="#practice"]').click()
  await page.locator('#practice').waitFor({ state: 'attached' })
  const aboutColors = await page.locator('.about-sidebar a[href="#practice"]').evaluate((element) => ({
    foreground: getComputedStyle(element).color,
    background: getComputedStyle(document.body).backgroundColor,
    active: element.classList.contains('active'),
  }))
  const aboutContrast = contrastRatio(aboutColors.foreground, aboutColors.background)
  check(`${profile.name}: About section navigation remains readable`, await page.locator('#practice h2').count() > 0 && aboutColors.active && aboutContrast >= 4.5, { contrastRatio: Number(aboutContrast.toFixed(2)) })
  await capturePage(page, profile, 'about')

  await clickNavigation(page, '/writing', profile.isMobile)
  await page.locator('.archive-body').waitFor({ state: 'visible' })
  await waitForPage(page, 'archive')
  await capturePage(page, profile, 'writing')
  if (fixtures.post) {
    const articleLink = page.locator(`.archive-body a[href="/post/${fixtures.post.slug}"]`).first()
    if (await articleLink.count()) {
      await articleLink.click()
      await page.waitForURL((url) => url.pathname.startsWith('/post/'))
      await page.locator('.post-detail-page h1').waitFor({ state: 'visible', timeout: 15000 })
      await waitForPage(page, 'article')
      await capturePage(page, profile, 'article')
    } else {
      report.skipped.push({ profile: profile.name, check: 'Article detail', reason: 'A detail API fixture exists but was absent from the current archive page.' })
    }
  }

  await page.locator('.search-toggle').click()
  await page.locator('#header-search-input').fill('runtime')
  await page.locator('#header-search-input').press('Enter')
  await page.waitForURL((url) => url.pathname === '/search' && url.searchParams.get('q') === 'runtime')
  await page.locator('.search-results').waitFor({ state: 'visible' })
  await waitForPage(page, 'archive')
  check(`${profile.name}: Search form is operable`, await page.locator('#search-query').count() === 1)
  await capturePage(page, profile, 'search')

  await clickNavigation(page, '/documents', profile.isMobile)
  await page.locator('.documents-page').waitFor({ state: 'visible' })
  await waitForPage(page, 'library')
  check(`${profile.name}: Documents filters and content stay in DOM`, await page.locator('#documents-query').count() === 1 && await page.locator('.document-card').count() > 0)
  await page.locator('#documents-query').fill('音乐')
  await page.locator('.documents-filters button[type="submit"]').click()
  await page.waitForURL((url) => url.pathname === '/documents' && url.searchParams.get('q') === '音乐')
  await page.locator('#documents-results').waitFor({ state: 'visible' })
  check(`${profile.name}: Documents search updates the route and results`, await page.locator('#documents-results').textContent() === '查找结果')
  await capturePage(page, profile, 'documents')
  if (fixtures.document) {
    await page.locator(`a[href="/documents/${encodeURIComponent(fixtures.document.slug)}"]`).first().click()
    await page.waitForURL((url) => url.pathname.startsWith('/documents/'))
    await page.locator('.document-detail').waitFor({ state: 'visible', timeout: 15000 })
    await waitForPage(page, 'library')
    await capturePage(page, profile, 'document-detail')
  } else {
    report.skipped.push({ profile: profile.name, check: 'DocumentDetail', reason: 'The public document API returned no documents.' })
  }

  await page.locator('footer a[href="/transfer"]').click()
  await page.waitForURL((url) => url.pathname === '/transfer')
  await page.locator('main h1').waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const state = window.__visualRuntimeDiagnostics?.()
    const canvas = document.querySelector('canvas')
    return state?.activePageId === null && state.rafActive === false && canvas && getComputedStyle(canvas).display === 'none'
  }, undefined, { timeout: 15000 })
  const transferState = await diagnostics(page)
  const transferCanvasDisplay = await page.locator('canvas').evaluate((element) => getComputedStyle(element).display)
  check(`${profile.name}: Transfer uses static DOM and stops the scene`, transferState?.activePageId === null && transferState?.rafActive === false && transferCanvasDisplay === 'none', { diagnostic: transferState, canvasDisplay: transferCanvasDisplay })
  await capturePage(page, profile, 'transfer')

  await page.locator('.skip-link').focus()
  await page.keyboard.press('Enter')
  check(`${profile.name}: skip link moves keyboard focus to main`, await page.evaluate(() => document.activeElement?.id === 'main-content'))

  await page.locator('.brand').click()
  await page.waitForURL((url) => url.pathname === '/')
  await clickNavigation(page, '/works', profile.isMobile)
  await clickNavigation(page, '/about', profile.isMobile)
  await page.waitForFunction(() => window.__visualRuntimeDiagnostics?.()?.activePageId === 'about', undefined, { timeout: 15000 })
  const rapidNavigationState = await diagnostics(page)
  check(`${profile.name}: rapid route changes settle on the latest scene`, rapidNavigationState?.activePageId === 'about' && rapidNavigationState.rendererCount === 1 && rapidNavigationState.fallback === false, { diagnostic: rapidNavigationState })

  if (!profile.reducedMotion) {
    await page.locator('.brand').click()
    await page.waitForURL((url) => url.pathname === '/')
    await waitForPage(page, 'home')
    const canvas = page.locator('canvas')
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForFunction(() => window.__visualRuntimeDiagnostics?.()?.rafActive === false)
    check(`${profile.name}: hidden document suspends RAF`, (await diagnostics(page))?.rafActive === false)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForFunction(() => window.__visualRuntimeDiagnostics?.()?.rafActive === true)
    check(`${profile.name}: visible document resumes RAF`, (await diagnostics(page))?.rafActive === true)
    await page.evaluate(() => { delete document.hidden })

    const lost = await canvas.evaluate((element) => {
      const event = new Event('webglcontextlost', { cancelable: true })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
    await page.waitForFunction(() => window.__visualRuntimeDiagnostics?.()?.contextLost === true)
    const lostState = await diagnostics(page)
    check(`${profile.name}: context loss activates static fallback`, lost && lostState?.fallback === true && lostState.rafActive === false)
    await canvas.evaluate((element) => element.dispatchEvent(new Event('webglcontextrestored')))
    await page.waitForFunction(() => {
      const state = window.__visualRuntimeDiagnostics?.()
      return state?.contextLost === false && state?.activePageId === 'home'
    }, undefined, { timeout: 15000 })
    const restored = await diagnostics(page)
    check(`${profile.name}: context restoration reuses one renderer`, restored?.rendererCount === 1 && restored.fallback === false)
  }

  await page.goto(routeURL('/admin/login'), { waitUntil: 'domcontentloaded' })
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15000 })
  check(`${profile.name}: Admin login does not mount the public canvas`, await page.locator('canvas').count() === 0)
  await page.screenshot({ path: join(reportDirectory, `${profile.name}-admin-login.png`), fullPage: true, animations: 'disabled' })
  await context.close()
}

try {
  const [worksResponse, documentsResponse, postsResponse] = await Promise.all([
    getFixture('/api/v1/works'),
    getFixture('/api/v1/documents?page=1&page_size=10'),
    getFixture('/api/v1/posts?page=1&page_size=10'),
  ])
  const works = Array.isArray(worksResponse?.items) ? worksResponse.items : []
  const documents = Array.isArray(documentsResponse?.items) ? documentsResponse.items : []
  const posts = Array.isArray(postsResponse?.items) ? postsResponse.items : []
  let articleFixture = null
  for (const post of posts) {
    if (await getFixture(`/api/v1/posts/${encodeURIComponent(post.slug)}`)) {
      articleFixture = post
      break
    }
  }
  const musicWork = works.find((item) => item.category === 'music' && (item.audio || item.video)) ?? null
  const fixtures = { musicWork, document: documents[0] ?? null, post: articleFixture }
  if (!musicWork) report.skipped.push({ check: 'WorkDetail and WorkPlayer', reason: 'No public music work with media was returned by the API.' })
  if (!fixtures.document) report.skipped.push({ check: 'DocumentDetail', reason: 'The public document API returned no documents.' })
  if (!fixtures.post) report.skipped.push({ check: 'Article detail', reason: posts.length ? 'The listed items did not resolve through the public article detail API.' : 'The public article API returned no posts.' })

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const profile of [
    { name: 'desktop', viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, isMobile: false, reducedMotion: false },
    { name: 'narrow-reduced', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, reducedMotion: true },
  ]) {
    await runProfile(profile, fixtures)
  }

  const initFallbackBrowser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--disable-webgl2', '--disable-software-rasterizer'] })
  try {
    const fallbackPage = await initFallbackBrowser.newPage({ viewport: { width: 1280, height: 800 } })
    fallbackPage.on('pageerror', (error) => report.pageErrors.push({ profile: 'webgl-disabled', message: error.message }))
    await fallbackPage.goto(routeURL('/'), { waitUntil: 'domcontentloaded' })
    await fallbackPage.locator('main h1').waitFor({ state: 'visible', timeout: 20000 })
    await fallbackPage.waitForFunction(() => Boolean(window.__visualRuntimeDiagnostics?.()), undefined, { timeout: 15000 })
    const state = await diagnostics(fallbackPage)
    const readable = await fallbackPage.locator('main h1').isVisible()
    check('WebGL initialization failure preserves DOM fallback', state?.fallback === true && state.rendererCount === 0 && readable && await fallbackPage.locator('canvas').evaluate((element) => getComputedStyle(element).display === 'none'), { diagnostic: state })
    await fallbackPage.screenshot({ path: join(reportDirectory, 'webgl-disabled-fallback.png'), fullPage: true, animations: 'disabled' })
  } finally {
    await initFallbackBrowser.close()
  }
} catch (error) {
  report.fatalError = error instanceof Error ? error.stack || error.message : String(error)
} finally {
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  report.summary = {
    checks: report.checks.length,
    passed: report.checks.filter((item) => item.passed).length,
    failed: report.checks.filter((item) => !item.passed).length,
    skipped: report.skipped.length,
    pageErrors: report.pageErrors.length,
  }
  await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ reportDirectory, summary: report.summary, skipped: report.skipped, fatalError: report.fatalError ?? null }, null, 2))
}

if (report.fatalError || report.checks.some((item) => !item.passed) || report.pageErrors.length > 0) process.exitCode = 1
