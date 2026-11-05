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

async function sphereInteractionPoints(page) {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('The home viewport is not measurable.')
  return {
    inside: { x: viewport.width / 2, y: viewport.height * 0.45 },
    outside: { x: 12, y: viewport.height * 0.25 },
  }
}

async function captureSphereState(page, profile, state) {
  const path = join(reportDirectory, `${profile.name}-sphere-${state}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  report.profiles.find((item) => item.name === profile.name).sphereScreenshots ??= []
  report.profiles.find((item) => item.name === profile.name).sphereScreenshots.push({ state, path })
}

async function sphereDataset(page) {
  return page.locator('canvas').evaluate((element) => ({
    hover: element.getAttribute('data-sphere-hover'),
    rippleCount: Number(element.getAttribute('data-sphere-ripple-count') || 0),
    rippleSequence: Number(element.getAttribute('data-sphere-ripple-sequence') || 0),
    pressDepth: Number(element.getAttribute('data-sphere-press-depth') || 0),
    trailStrength: Number(element.getAttribute('data-sphere-trail-strength') || 0),
    scale: Number(element.getAttribute('data-sphere-scale') || 0),
    wakeCount: Number(element.getAttribute('data-sphere-wake-count') || 0),
  }))
}

async function clickAt(page, profile, point) {
  if (profile.isMobile) await page.touchscreen.tap(point.x, point.y)
  else await page.mouse.click(point.x, point.y)
}

async function waitForSphereRest(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000
    let settledFrames = 0
    const sample = () => {
      const depth = Number(document.querySelector('canvas')?.getAttribute('data-sphere-press-depth') || 0)
      settledFrames = Math.abs(depth) < 0.005 ? settledFrames + 1 : 0
      if (settledFrames >= 12) { resolve(); return }
      if (performance.now() > deadline) { reject(new Error('The sphere did not settle after release.')); return }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
}

async function touchLongPress(page, point, profile) {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1 }],
    })
    await page.waitForFunction(() => Number(document.querySelector('canvas')?.getAttribute('data-sphere-press-depth') || 0) > 0.2, undefined, { timeout: 5000 })
    const heldDepth = (await sphereDataset(page)).pressDepth
    await captureSphereState(page, profile, 'held')
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-press-depth') || 0) < before, heldDepth, { timeout: 5000 })
    return heldDepth
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    await session.detach()
  }
}

async function touchDrag(page, start, end) {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, ...start }] })
    for (let index = 1; index <= 8; index += 1) {
      const amount = index / 8
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 3, x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount }] })
      await page.waitForTimeout(20)
    }
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, start.rippleSequence, { timeout: 3000 })
    return await sphereDataset(page)
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    await session.detach()
  }
}

async function touchSwipe(page, start, end) {
  const session = await page.context().newCDPSession(page)
  const before = await page.evaluate(() => window.scrollY)
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 2, x: start.x, y: start.y, radiusX: 4, radiusY: 4, force: 1 }],
    })
    for (let step = 1; step <= 6; step += 1) {
      const amount = step / 6
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 2, x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount, radiusX: 4, radiusY: 4, force: 1 }],
      })
      await page.waitForTimeout(20)
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForFunction((scrollY) => window.scrollY > scrollY, before, { timeout: 5000 })
    return await page.evaluate(() => window.scrollY)
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    await session.detach()
  }
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
  await captureSphereState(page, profile, 'idle')
  if (!profile.reducedMotion) {
    const scaleAtTop = (await sphereDataset(page)).scale
    const maxTopScale = profile.isMobile ? 0.5 : 0.72
    check(`${profile.name}: sphere no longer dominates the first viewport`, scaleAtTop > 0 && scaleAtTop < maxTopScale, { scale: scaleAtTop, maxTopScale })

    const firstClickTarget = await page.locator('main h1').first().boundingBox()
    if (!firstClickTarget) throw new Error('The home title is not measurable for the first-click check.')
    const firstClickSequence = (await sphereDataset(page)).rippleSequence
    await clickAt(page, profile, { x: firstClickTarget.x + firstClickTarget.width * 0.5, y: firstClickTarget.y + firstClickTarget.height * 0.5 })
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, firstClickSequence)
    check(`${profile.name}: first page click produces immediate sphere feedback`, (await sphereDataset(page)).rippleSequence > firstClickSequence)

    const beforeSearchToggle = (await sphereDataset(page)).rippleSequence
    await page.locator('.search-toggle').click()
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, beforeSearchToggle)
    const beforeLabelClick = (await sphereDataset(page)).rippleSequence
    const searchLabel = await page.locator('label[for="header-search-input"]').boundingBox()
    if (!searchLabel) throw new Error('The search label is not measurable.')
    await clickAt(page, profile, { x: searchLabel.x + searchLabel.width / 2, y: searchLabel.y + searchLabel.height / 2 })
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, beforeLabelClick)
    const afterLabelClick = await sphereDataset(page)
    const searchInputFocused = await page.locator('#header-search-input').evaluate((element) => document.activeElement === element)
    check(`${profile.name}: native search label focuses the input with exactly one ripple`, afterLabelClick.rippleSequence === beforeLabelClick + 1 && searchInputFocused,
      { before: beforeLabelClick, after: afterLabelClick.rippleSequence, searchInputFocused })
    await page.locator('.search-toggle').click()

    const points = await sphereInteractionPoints(page)
    await page.mouse.move(points.inside.x, points.inside.y)
    await page.waitForFunction(() => document.querySelector('canvas')?.getAttribute('data-sphere-hover') === '1')
    check(`${profile.name}: sphere hover follows the pointer`, (await sphereDataset(page)).hover === '1')

    const rippleBefore = (await sphereDataset(page)).rippleSequence
    await clickAt(page, profile, points.inside)
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, rippleBefore)
    check(`${profile.name}: sphere tap produces one ripple`, (await sphereDataset(page)).rippleSequence === rippleBefore + 1)

    const outsideRippleBefore = (await sphereDataset(page)).rippleSequence
    await clickAt(page, profile, points.outside)
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, outsideRippleBefore)
    check(`${profile.name}: clicks outside the visible sphere still create a ripple`, (await sphereDataset(page)).rippleSequence > outsideRippleBefore)

    await page.mouse.move(points.outside.x, points.outside.y)
    await page.mouse.move(points.inside.x, points.inside.y)
    await page.waitForFunction(() => Number(document.querySelector('canvas')?.getAttribute('data-sphere-trail-strength') || 0) > 0)
    await page.waitForTimeout(160)
    await page.waitForFunction(() => Number(document.querySelector('canvas')?.getAttribute('data-sphere-wake-count') || 0) > 0)
    await captureSphereState(page, profile, 'wake')
    const movingTrail = (await sphereDataset(page)).trailStrength
    check(`${profile.name}: pointer trail is visible at the top of the page`, movingTrail > 0, { trailStrength: movingTrail })
    await page.waitForTimeout(600)
    const restingTrail = (await sphereDataset(page)).trailStrength
    check(`${profile.name}: particle trail fades while the pointer rests`, restingTrail < movingTrail, { movingTrail, restingTrail })
    await page.waitForFunction(() => Number(document.querySelector('canvas')?.getAttribute('data-sphere-wake-count') || 0) === 0, undefined, { timeout: 3000 })
    check(`${profile.name}: cursor water rings expire at rest`, (await sphereDataset(page)).wakeCount === 0)

    let heldDepth
    if (profile.isMobile) {
      heldDepth = await touchLongPress(page, points.inside, profile)
    } else {
      await page.mouse.move(points.inside.x, points.inside.y)
      await page.mouse.down()
      await page.waitForFunction(() => Number(document.querySelector('canvas')?.getAttribute('data-sphere-press-depth') || 0) > 0.2, undefined, { timeout: 5000 })
      heldDepth = (await sphereDataset(page)).pressDepth
      await captureSphereState(page, profile, 'held')
      await page.mouse.up()
      await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-press-depth') || 0) < before, heldDepth, { timeout: 5000 })
    }
    await waitForSphereRest(page)
    await captureSphereState(page, profile, 'released')
    check(`${profile.name}: long press dents and release springs back`, Math.abs((await sphereDataset(page)).pressDepth) < 0.005, { heldDepth })

    if (!profile.isMobile) {
      const dragRippleBefore = (await sphereDataset(page)).rippleSequence
      await page.mouse.move(points.inside.x, points.inside.y)
      await page.mouse.down()
      await page.mouse.move(points.inside.x + 24, points.inside.y + 5, { steps: 3 })
      await page.mouse.move(points.inside.x + 48, points.inside.y + 10, { steps: 3 })
      await page.mouse.up()
      await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, dragRippleBefore)
      check(`${profile.name}: dragging creates a continuous ripple trail`, (await sphereDataset(page)).rippleSequence > dragRippleBefore)

      await page.locator('main h1').first().dblclick()
      check(`${profile.name}: repeated clicks do not select decorative hero text`, await page.evaluate(() => window.getSelection()?.toString() === ''))

      const intro = await page.locator('.hero-intro').boundingBox()
      if (!intro) throw new Error('The introduction is not measurable for text selection.')
      await page.mouse.move(intro.x + 2, intro.y + 12)
      await page.mouse.down()
      await page.mouse.move(intro.x + Math.min(180, intro.width - 4), intro.y + 12, { steps: 8 })
      await page.mouse.up()
      check(`${profile.name}: ordinary introduction text can still be selected for copying`, await page.evaluate(() => (window.getSelection()?.toString().length || 0) > 0))
      await page.evaluate(() => window.getSelection()?.removeAllRanges())
      await page.locator('.principle-intro p').last().dblclick()
      check(`${profile.name}: body text still supports native double-click selection`, await page.evaluate(() => (window.getSelection()?.toString().length || 0) > 0))
      await page.evaluate(() => window.getSelection()?.removeAllRanges())
    } else {
      const beforeDrag = await sphereDataset(page)
      const duringDrag = await touchDrag(page, { x: 70, y: points.inside.y, rippleSequence: beforeDrag.rippleSequence }, { x: 260, y: points.inside.y + 3 })
      check(`${profile.name}: horizontal touch drag creates ripples and a pointer wake before release`, duringDrag.rippleSequence > beforeDrag.rippleSequence && duringDrag.wakeCount > 0, { wakeCount: duringDrag.wakeCount })
    }

    await page.locator('#writing-title').scrollIntoViewIfNeeded()
    const writingTitle = await page.locator('#writing-title').boundingBox()
    if (!writingTitle) throw new Error('The writing title is not measurable for the post-scroll click check.')
    const scrolledClickBefore = (await sphereDataset(page)).rippleSequence
    await clickAt(page, profile, { x: writingTitle.x + writingTitle.width * 0.5, y: writingTitle.y + writingTitle.height * 0.5 })
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, scrolledClickBefore)
    check(`${profile.name}: page click still works after scrolling`, (await sphereDataset(page)).rippleSequence > scrolledClickBefore)

    await page.locator('#projects-title').evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await page.waitForTimeout(600)
    const projectTitle = await page.locator('#projects-title').boundingBox()
    if (!projectTitle) throw new Error('The project title is not measurable.')
    const projectClickBefore = (await sphereDataset(page)).rippleSequence
    await clickAt(page, profile, { x: projectTitle.x + projectTitle.width / 2, y: projectTitle.y + projectTitle.height / 2 })
    await page.waitForFunction((before) => Number(document.querySelector('canvas')?.getAttribute('data-sphere-ripple-sequence') || 0) > before, projectClickBefore)
    await captureSphereState(page, profile, 'projects')
    check(`${profile.name}: project section clicks still create sphere feedback`, (await sphereDataset(page)).rippleSequence > projectClickBefore)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(120)

    if (profile.isMobile) {
      const heroVisual = await page.locator('.hero-visual').boundingBox()
      if (!heroVisual) throw new Error('The touch scroll region is not measurable.')
      const touchScrollBefore = await page.evaluate(() => window.scrollY)
      const touchScrollAfter = await touchSwipe(page, {
        x: heroVisual.x + heroVisual.width * 0.5,
        y: Math.min(profile.viewport.height - 24, heroVisual.y + heroVisual.height * 0.82),
      }, {
        x: heroVisual.x + heroVisual.width * 0.5,
        y: Math.min(profile.viewport.height - 24, heroVisual.y + heroVisual.height * 0.82) - 140,
      })
      check(`${profile.name}: vertical touch swipe still scrolls the page`, touchScrollAfter > touchScrollBefore)
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await page.waitForTimeout(120)
    }

    const scaleSteps = await page.evaluate(async () => {
      const values = []
      window.scrollTo(0, 0)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      window.scrollTo(0, document.documentElement.scrollHeight)
      for (let index = 0; index < 36; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        values.push(Number(document.querySelector('canvas')?.getAttribute('data-sphere-scale') || 0))
      }
      return values.slice(1).reduce((largest, value, index) => Math.max(largest, Math.abs(value - values[index])), 0)
    })
    check(`${profile.name}: fast scroll keeps sphere scale smooth`, scaleSteps < 0.025, { largestScaleStep: scaleSteps })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(120)
  } else {
    const points = await sphereInteractionPoints(page)
    await page.mouse.click(points.inside.x, points.inside.y)
    await page.waitForTimeout(120)
    const reducedInteraction = await sphereDataset(page)
    check(`${profile.name}: reduced motion suppresses sphere feedback`, reducedInteraction.rippleCount === 0 && reducedInteraction.pressDepth === 0 && reducedInteraction.trailStrength === 0)
  }
  if (!profile.reducedMotion) {
    const points = await sphereInteractionPoints(page)
    await page.locator('.motion-toggle').click()
    await page.waitForFunction(() => window.__visualRuntimeDiagnostics?.()?.rafActive === false)
    const pausedRippleBefore = (await sphereDataset(page)).rippleCount
    await page.mouse.click(points.inside.x, points.inside.y)
    await page.waitForTimeout(120)
    check(`${profile.name}: manual pause stops the shared RAF`, (await diagnostics(page))?.rafActive === false)
    check(`${profile.name}: manual pause suppresses new sphere feedback`, (await sphereDataset(page)).rippleCount === pausedRippleBefore)
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
    { name: 'narrow-touch', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, reducedMotion: false },
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
