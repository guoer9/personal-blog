import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright'

const baseURL = new URL(process.env.BASE_URL || process.env.QUALITY_BASE_URL || 'http://127.0.0.1:4179')
if (!['http:', 'https:'].includes(baseURL.protocol) || baseURL.username || baseURL.password) throw new Error('BASE_URL must be HTTP(S) without embedded credentials.')
const output = resolve(process.env.PORTRAIT_REPORT_DIR || 'output/playwright/home-portrait')
await mkdir(output, { recursive: true })
const report = { baseURL: baseURL.origin, startedAt: new Date().toISOString(), checks: [], screenshots: [], console: [], pageErrors: [], requests: [], failures: [] }
const timeout = 30000
let browser
const urlFor = (path) => new URL(path, baseURL).href
const mapPattern = /^\/portraits\/(front|bass)\/(diffuse|alpha|depth|normal|roughness|shadow)\.png$/
const pageFixture = { items: [
  { id: 101, title: '把代码、影像与音乐写进同一个持续生长的个人空间', slug: 'continuous-space', summary: '记录一次关于滚动节奏、阅读体验与交互细节的实验，让每一个页面自然地接续。' },
  { id: 102, title: '关于声音与日常的观察', slug: 'sound-notes', summary: '从低音的律动开始，留下一些值得再次聆听的片段。' },
].map(post => ({ ...post, key: `post:${post.id}`, kind: 'post', public_url: `/post/${post.slug}`, is_published: true, view_count: 96, created_at: '2026-11-02T08:00:00Z', updated_at: '2026-11-02T08:00:00Z', author: { id: 1, username: '陈果' }, tags: [{ name: '创作记录', slug: 'creative-notes' }] })), total: 2, page: 1, page_size: 12, total_pages: 1 }
const worksFixture = ['个人空间与交互实验', '声音档案', '影像整理工具'].map((title,index)=>({ slug:`sample-work-${index}`, title, category:'code', caption:'Creative systems', description:'围绕日常创作构建的开放工具，持续记录设计与实现中的思考。', tags:['TypeScript','Creative coding'], accent:['lime','blue','paper'][index], notes:[], featured:true }))
function check(name, passed, evidence = {}) { report.checks.push({ name, passed, ...evidence }); console.log(JSON.stringify({ name, passed, ...evidence })) }

async function fixtures(context) {
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') { report.failures.push({ type: 'unexpected-write', method: request.method(), path }); await route.abort(); return }
    let json
    if (path === '/api/v1/posts/topics/list') json = []
    else if (['/api/v1/posts', '/api/v1/posts/search'].includes(path)) json = pageFixture
    else if (path === '/api/v1/documents') json = { ...pageFixture, items: [], total: 0, total_pages: 0 }
    else if (path === '/api/v1/works') json = { items: worksFixture }
    else { report.failures.push({ type: 'unexpected-api', path }); await route.fulfill({ status: 404, json: { detail: 'No fixture for this endpoint.' } }); return }
    await route.fulfill({ json })
  })
}
async function makePage(name, options = {}, beforePage) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, ...options })
  await fixtures(context)
  if (beforePage) await beforePage(context)
  const page = await context.newPage()
  page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) report.console.push({ profile: name, type: message.type(), text: message.text() }) })
  page.on('pageerror', (error) => report.pageErrors.push({ profile: name, text: error.message }))
  page.on('response', (response) => { const path = new URL(response.url()).pathname; if (mapPattern.test(path)) report.requests.push({ profile: name, path, status: response.status() }) })
  return { page, context, name }
}
async function home(page, expected = 'ready') {
  await page.goto(urlFor('/'), { waitUntil: 'domcontentloaded' })
  await page.locator('#hero-title').waitFor({ state: 'visible', timeout })
  if (expected) await page.waitForFunction((state) => document.querySelector('canvas')?.dataset.portraitState === state, expected, { timeout })
  await page.evaluate(() => document.fonts.ready)
}
async function screenshot(page, name, clip) {
  // Native smooth scrolling can continue after Playwright has clicked a control.
  // Give the scroll handler, anchor measurement, and renderer two settled frames.
  await page.evaluate(() => new Promise((resolve, reject) => {
    let previous = scrollY, stable = 0
    const deadline = performance.now() + 5000
    const sample = () => {
      stable = Math.abs(scrollY - previous) < 0.1 ? stable + 1 : 0
      previous = scrollY
      if (stable >= 4) { resolve(); return }
      if (performance.now() > deadline) { reject(new Error('Scroll did not settle before screenshot.')); return }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  const path = resolve(output, `${name}.png`)
  const buffer = await page.screenshot({ path, ...(clip ? { clip } : {}), animations: 'disabled', scale: 'css' })
  report.screenshots.push({ name, path })
  return buffer
}

// Chromium writes noninterlaced 8-bit RGB(A) PNGs. This small decoder allows
// real rendered-pixel comparisons without a new npm or Python dependency.
function pixels(buffer) {
  let offset = 8, width, height, channels
  const chunks = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), kind = buffer.toString('ascii', offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length)
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0; if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('Unsupported screenshot PNG encoding.') }
    if (kind === 'IDAT') chunks.push(data)
    offset += length + 12
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, decoded = Buffer.alloc(height * stride)
  let cursor = 0
  const paeth = (left, up, upperLeft) => { const predicted = left + up - upperLeft, a = Math.abs(predicted - left), b = Math.abs(predicted - up), c = Math.abs(predicted - upperLeft); return a <= b && a <= c ? left : b <= c ? up : upperLeft }
  for (let row = 0; row < height; row += 1) {
    const filter = raw[cursor++]
    for (let column = 0; column < stride; column += 1) {
      const index = row * stride + column, left = column >= channels ? decoded[index - channels] : 0, up = row ? decoded[index - stride] : 0, upperLeft = row && column >= channels ? decoded[index - stride - channels] : 0
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : NaN
      if (!Number.isFinite(prediction)) throw new Error('Unsupported PNG row filter.')
      decoded[index] = (raw[cursor++] + prediction) & 255
    }
  }
  return { width, height, channels, data: decoded }
}
function difference(first, second) {
  const a = pixels(first), b = pixels(second)
  if (a.width !== b.width || a.height !== b.height) throw new Error('Screenshot dimensions changed during a comparison.')
  let sum = 0, changed = 0
  const count = a.width * a.height
  for (let index = 0; index < count; index += 1) { let delta = 0; for (let channel = 0; channel < 3; channel += 1) delta += Math.abs(a.data[index * a.channels + channel] - b.data[index * b.channels + channel]); sum += delta / 3; if (delta / 3 > 12) changed += 1 }
  return { meanAbsolute: Number((sum / count).toFixed(3)), changedRatio: Number((changed / count).toFixed(4)) }
}
async function state(page) {
  return page.evaluate(() => ({ canvasCount: document.querySelectorAll('canvas').length, portraitState: document.querySelector('canvas')?.dataset.portraitState, portraitMode: document.querySelector('canvas')?.dataset.portraitMode, canvasDisplay: getComputedStyle(document.querySelector('canvas')).display, posterVisible: getComputedStyle(document.querySelector('.portrait-poster')).display !== 'none', posterSource: document.querySelector('.portrait-poster img')?.getAttribute('src'), renderState: document.querySelector('.immersive-scene')?.dataset.renderState, overflow: document.documentElement.scrollWidth - innerWidth, diagnostic: window.__visualRuntimeDiagnostics?.() }))
}
async function scrollProgress(page, progress) {
  // An instant geometry sample is taken after wheel inertia has finished.
  // Native scrollTo during a running Lenis wheel animation is not a reset API.
  await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-smooth'))
  await page.evaluate((p) => {
    const track = document.querySelector('.hero-track')
    scrollTo({ top: track.getBoundingClientRect().top + scrollY + innerHeight * p, behavior: 'instant' })
  }, progress)
  await page.waitForFunction((p) => Math.abs(Number(document.querySelector('.hero-track').style.getPropertyValue('--hero-progress')) - Math.min(1, p)) < 0.001, progress)
  await page.waitForTimeout(80)
}
async function fluidReveal() {
  // Compare matching animation times against an untouched control. A screenshot
  // from several seconds earlier also changes with the live sphere and lights.
  const profiles = []
  for (const name of ['fluid-control', 'fluid-pointer']) {
    const profile = await makePage(name, {}, context => context.addInitScript(() => {
      let seed = 123456789
      Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296)
    }))
    profiles.push(profile)
    const { page } = profile
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
    await page.goto(urlFor('/'), { waitUntil: 'domcontentloaded' })
    for (let i = 0; i < 20 && await page.locator('canvas').getAttribute('data-portrait-state') !== 'ready'; i++) await page.clock.runFor(100)
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(1, 1)
    await page.clock.runFor(Math.max(0, 3000 - await page.evaluate(() => performance.now())))
  }
  const [control, active] = profiles.map(p=>p.page)
  const clip = { x: 317, y: 120, width: 806, height: 740 }
  const capture = async (page, name) => {
    const path = resolve(output, `${name}.png`)
    const buffer = await page.screenshot({ path, clip, scale: 'css' })
    report.screenshots.push({ name, path })
    return buffer
  }
  const baseline = difference(await capture(control,'fluid-control-start'),await capture(active,'fluid-pointer-start'))
  const domBefore = await active.locator('.immersive-scene').innerHTML()
  for (let step = 0; step <= 20; step++) {
    await active.mouse.move(500+step*20, 780-step*16)
    await control.clock.runFor(48)
    await active.clock.runFor(48)
  }
  const reveal = difference(await capture(control,'fluid-control-reveal'),await capture(active,'fluid-pointer-reveal'))
  check('desktop: real fluid reveal changes rendered pixels at matched times without DOM swapping', baseline.meanAbsolute<.5 && reveal.meanAbsolute>Math.max(.6,baseline.meanAbsolute*3) && domBefore===await active.locator('.immersive-scene').innerHTML(), { baseline,reveal })
  await active.mouse.move(1,1)
  await control.clock.runFor(6000)
  await active.clock.runFor(6000)
  const decay = difference(await capture(control,'fluid-control-decay'),await capture(active,'fluid-pointer-decay'))
  check('desktop: pointer reveal decays against a matched-time control', decay.meanAbsolute<reveal.meanAbsolute*.6, { reveal,decay })
  for (const profile of profiles) await profile.context.close()
}
async function signatureState(page) {
  return page.locator('.chen-guo-signature .signature-pen').evaluateAll(paths => paths.map(p => Number(p.getAttribute('stroke-dashoffset'))))
}
async function signatureCoverage(page) {
  const coverage = await page.locator('.chen-guo-signature').evaluate(async element => {
    const svg = element.cloneNode(true)
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg')
    svg.setAttribute('width','1470'); svg.setAttribute('height','600')
    svg.querySelector('.signature-ink').setAttribute('fill','white')
    const render = async () => {
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}))
      try {
        const img = new Image(); img.src = url; await img.decode()
        const canvas = document.createElement('canvas'); canvas.width=1470; canvas.height=600
        const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0)
        return ctx.getImageData(0,0,1470,600).data
      } finally { URL.revokeObjectURL(url) }
    }
    const masked = await render()
    svg.querySelector('.signature-ink').removeAttribute('mask')
    const full = await render()
    let ink = 0, missing = 0
    for(let i=3;i<full.length;i+=4) { ink+=full[i]; missing+=Math.max(0,full[i]-masked[i]) }
    return { missingRatio: missing/ink }
  })
  check('desktop: finished drawing preserves the traced handwritten ink outline',coverage.missingRatio<.001,coverage)
}
async function connectorState(page) {
  return page.evaluate(() => {
    const signature = document.querySelector('.chen-guo-signature'), path = document.querySelector('.signature-continuation path')
    const a = signature.getScreenCTM(), b = path.getScreenCTM(), length = path.getTotalLength()
    const project = (m, p) => ({ x: m.a*p.x+m.c*p.y+m.e, y: m.b*p.x+m.d*p.y+m.f })
    const start = project(b, path.getPointAtLength(0)), next = project(b, path.getPointAtLength(1)), end = project(b, path.getPointAtLength(length))
    const expected = project(a, { x: 1423, y: 443 }), prior = project(a, { x: 1378, y: 415 })
    const tangent = { x: expected.x-prior.x, y: expected.y-prior.y }, actual = { x: next.x-start.x, y: next.y-start.y }
    const kicker = document.querySelector('#writing .section-kicker').getBoundingClientRect()
    const samples = Array.from({length:101}, (_,i) => project(b, path.getPointAtLength(length*i/100)))
    return { progress: Number(path.dataset.progress), d: path.getAttribute('d'), startGap: Math.hypot(start.x-expected.x,start.y-expected.y), endGap: Math.hypot(end.x-kicker.left-28,end.y-kicker.top-kicker.height/2), tangentMatch: (tangent.x*actual.x+tangent.y*actual.y)/Math.hypot(tangent.x,tangent.y)/Math.hypot(actual.x,actual.y), inBounds: samples.every(p=>p.x>=0 && p.x<=innerWidth && p.y<=kicker.top+kicker.height/2+1), strokeGap: Math.abs(parseFloat(path.style.strokeWidth)-5*Math.hypot(a.a,a.b)) }
  })
}
async function wheelContinuity(page, name, delta = 720) {
  await scrollProgress(page, 0)
  await page.evaluate(() => {
    window.__scrollSamples = []
    const sample = () => {
      window.__scrollSamples.push({ y: scrollY, progress: Number(document.querySelector('.hero-track').style.getPropertyValue('--hero-progress')), height: innerHeight })
      if (window.__scrollSamples.length < 90) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.mouse.wheel(0, delta)
  await page.waitForFunction(() => window.__scrollSamples?.length === 90)
  const samples = await page.evaluate(() => window.__scrollSamples)
  const moving = samples.filter(s=>s.y>0), steps = samples.slice(1).filter((s,i)=>s.y>samples[i].y).length
  const maxMismatch = Math.max(...samples.map(s=>Math.abs(s.progress-Math.min(1,s.y/s.height))))
  check(`${name}: wheel advances in shared frames without hero catch-up`, moving.length>0 && moving[0].y<delta*.6 && steps>5 && Math.abs(samples.at(-1).y-delta)<2 && maxMismatch<.003, { first: moving[0], steps, last: samples.at(-1), maxMismatch })
}
async function sectionContinuity(page, name) {
  const samples = []
  for (const id of ['projects','motion','resources']) {
    const target = await page.locator(`#${id} .scroll-reveal`).first().evaluate(e=>e.getBoundingClientRect().top+scrollY-parseFloat(e.style.getPropertyValue('--scroll-rise')||'0'))
    const states = []
    for (const entry of [.88,.72,.55,.72,.88]) {
      await page.evaluate(({target,entry})=>scrollTo({top:target-innerHeight*entry,behavior:'instant'}),{target,entry})
      await page.waitForTimeout(80)
      states.push(await page.locator(`#${id} .scroll-reveal`).first().evaluate(e=>({opacity:+getComputedStyle(e).opacity,rise:parseFloat(e.style.getPropertyValue('--scroll-rise')),top:e.getBoundingClientRect().top})))
    }
    check(`${name}: ${id} enters and reverses on the shared scroll position`, states[0].opacity<states[1].opacity && states[1].opacity<states[2].opacity && Math.abs(states[0].opacity-states[4].opacity)<.01 && Math.abs(states[1].opacity-states[3].opacity)<.01,{states})
    await page.evaluate(target=>scrollTo({top:target-innerHeight*.25,behavior:'instant'}),target)
    await page.waitForTimeout(100)
    await screenshot(page,`${name}-${id}`)
    samples.push(await page.locator(`#${id}`).evaluate(e=>({id:e.id,overflow:e.scrollWidth-e.clientWidth,cards:[...e.querySelectorAll('.project-card,.principle-row,.resource-card')].map(card=>({width:card.clientWidth,text:[...card.querySelectorAll('h3,p,.project-topline,.project-stack')].map(text=>({width:text.clientWidth,overflow:text.scrollWidth-text.clientWidth,inside:text.getBoundingClientRect().left>=card.getBoundingClientRect().left-1 && text.getBoundingClientRect().right<=card.getBoundingClientRect().right+1}))}))})))
  }
  // Oversized rotated glyphs are intentionally cropped decoration. Assert the
  // actual title/body/tag bounds instead of treating that decoration as text.
  check(`${name}: populated lower sections keep card text inside readable columns`, samples.every(s=>s.overflow<2 && s.cards.length>0 && s.cards.every(c=>c.width>200 && c.text.length>0 && c.text.every(t=>t.width>100 && t.overflow<2 && t.inside))), {samples})
}
async function desktopPortrait() {
  const profile = await makePage('desktop'), { page } = profile
  await home(page)
  await page.mouse.move(8, 90)
  await page.waitForTimeout(900)
  const initial = await state(page)
  check('desktop: one shared live canvas with twelve maps', initial.canvasCount === 1 && initial.portraitState === 'ready' && initial.renderState === 'webgl' && initial.diagnostic?.rendererCount === 1 && !initial.diagnostic.fallback && new Set(report.requests.filter(r => r.profile === 'desktop' && r.status === 200).map(r => r.path)).size === 12, initial)
  check('desktop: removed all portrait, motion and boxed identity controls', await page.locator('.portrait-controls,.motion-toggle,.identity-token').count() === 0)
  const frame = await page.locator('.hero').boundingBox()
  check('desktop: portrait begins in a full viewport', frame.x === 0 && frame.y === 0 && frame.width === 1440 && frame.height === 1000, { frame })
  await screenshot(page, 'desktop-front')
  const checkpoints = []
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    await scrollProgress(page, progress)
    const current = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      return { progress: Number(canvas.dataset.portraitProgress), bounds: JSON.parse(canvas.dataset.portraitBounds), sphereScale: Number(canvas.dataset.sphereScale), intro: Number(getComputedStyle(document.querySelector('.hero-copy')).opacity), message: Number(getComputedStyle(document.querySelector('.hero-message')).opacity), signature: [...document.querySelectorAll('.chen-guo-signature .signature-pen')].map(p => Number(p.getAttribute('stroke-dashoffset'))) }
    })
    checkpoints.push(current)
    await screenshot(page, `desktop-scroll-${progress * 100}`)
  }
  check('desktop: contraction eases at both ends', checkpoints[0].bounds.width - checkpoints[1].bounds.width < checkpoints[1].bounds.width - checkpoints[2].bounds.width && checkpoints[3].bounds.width - checkpoints[4].bounds.width < checkpoints[2].bounds.width - checkpoints[3].bounds.width, { checkpoints })
  check('desktop: portrait handoff preserves original sphere base size', checkpoints.every(c => c.sphereScale>.55 && c.sphereScale<.68), { scales: checkpoints.map(c=>c.sphereScale) })
  await scrollProgress(page, 1.1)
  const penMid = await signatureState(page)
  await page.waitForTimeout(500)
  check('desktop: signature has a full viewport of drawing travel and no independent catch-up clock', penMid.some(v=>v>.1) && penMid.some(v=>v<.01) && JSON.stringify(penMid)===JSON.stringify(await signatureState(page)), { penMid })
  await scrollProgress(page, 1.42)
  const penEnd = await signatureState(page)
  check('desktop: name completes before its connecting stroke begins', checkpoints[4].intro === 0 && checkpoints[4].message > .99 && penEnd.length > 4 && penEnd.every(v => v < .01) && (await connectorState(page)).progress<.002, { penEnd })
  await signatureCoverage(page)
  await screenshot(page, 'desktop-signature-complete')
  const rippleBefore = await page.locator('canvas').getAttribute('data-sphere-ripple-sequence')
  await page.mouse.click(720, 500)
  await page.waitForTimeout(200)
  check('desktop: revealed sphere keeps click ripple interaction', await page.locator('canvas').getAttribute('data-sphere-ripple-sequence') !== rippleBefore)
  await scrollProgress(page, 1.7)
  const trailMid = await connectorState(page)
  await scrollProgress(page, 2.04)
  const trailEnd = await connectorState(page)
  await scrollProgress(page, 1.7)
  const trailReverse = await connectorState(page)
  check('desktop: connector joins actual pen endpoint and heading with continuous tangent', [trailMid,trailEnd,trailReverse].every(s=>s.startGap<.1 && s.endGap<.1 && s.tangentMatch>.99 && s.inBounds && s.strokeGap<.01), { trailMid,trailEnd })
  check('desktop: reverse scroll retraces the same signature connector', trailMid.progress>0 && trailMid.progress<1 && trailEnd.progress===1 && trailReverse.progress===trailMid.progress && trailReverse.d===trailMid.d)
  await scrollProgress(page, 0.25)
  const reverse = await page.locator('canvas').evaluate(c => JSON.parse(c.dataset.portraitBounds))
  check('desktop: reverse scroll returns to the same frame', Math.abs(reverse.width - checkpoints[1].bounds.width) < 2, { reverse })
  for (const travel of [1.65, 1.9, 2.2, 2.8]) {
    await scrollProgress(page, travel)
    await page.waitForTimeout(700)
    await screenshot(page, `desktop-writing-transition-${travel}`)
  }
  const writingSphere = await page.locator('canvas').evaluate(c=>({ scale:Number(c.dataset.sphereScale), dock:c.dataset.sphereDeparture }))
  check('desktop: writing retains full-size sphere without sidebar docking', writingSphere.scale>.55 && writingSphere.scale<.68 && !writingSphere.dock && await page.locator('.writing-orb').count()===0, writingSphere)
  await scrollProgress(page, 3.05)
  const exited = await page.evaluate(() => ({ anchor: document.querySelector('.immersive-scene').getBoundingClientRect().bottom, writing: document.querySelector('#writing').getBoundingClientRect().top }))
  check('desktop: hero leaves before writing content', exited.anchor < 1 && exited.writing < 400, exited)
  await screenshot(page, 'desktop-portrait-exited')
  await wheelContinuity(page, 'desktop')
  await wheelContinuity(page, 'desktop-fast', 2400)
  const fastSignature = await signatureState(page)
  check('desktop: fast wheel finishes signature and connector without offscreen catch-up',fastSignature.every(v=>v===0) && (await connectorState(page)).progress===1)
  await sectionContinuity(page,'desktop')
  await scrollProgress(page, 0)
  await page.evaluate(() => { window.__portraitAcceptanceCanvas = document.querySelector('canvas') })
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.locator('#mobile-navigation a').last().focus()
  await page.keyboard.press('Tab')
  check('desktop: menu traps focus and makes the content inert', await page.evaluate(() => Boolean(document.activeElement?.closest('.site-header')) && document.querySelector('#main-content').inert))
  await screenshot(page, 'desktop-menu')
  const lockedY = await page.evaluate(()=>scrollY)
  await page.mouse.wheel(0,500)
  await page.waitForTimeout(250)
  check('desktop: open menu suspends page inertia', Math.abs(await page.evaluate(()=>scrollY)-lockedY)<1)
  await page.keyboard.press('Escape')
  await page.mouse.wheel(0,500)
  await page.waitForTimeout(600)
  check('desktop: closing menu resumes scrolling', await page.evaluate(()=>scrollY)>lockedY+100)
  await scrollProgress(page,0)
  return profile
}

async function contactPosition(page, name) {
  await page.waitForURL((url) => url.pathname === '/about' && url.hash === '#connect')
  await page.locator('#connect').waitFor({ state: 'visible', timeout })
  await page.waitForTimeout(1100)
  const position = await page.locator('#connect').evaluate((element) => ({ top: Math.round(element.getBoundingClientRect().top), headerBottom: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom), scrollY }))
  check(name, position.top >= position.headerBottom - 2 && position.top <= position.headerBottom + 80, position)
}
async function navigation(profile) {
  const { page } = profile
  // Explicit Home -> Contact regression: About mounts after the out-in transition.
  await page.locator('.header-contact').click()
  await contactPosition(page, 'navigation: Home Contact actually scrolls to connect after transition')
  for (const path of ['/works', '/about', '/writing', '/documents']) {
    await page.locator(`.desktop-navigation a[href="${path}"]`).click()
    await page.waitForURL((url) => url.pathname === path)
    await page.locator('main h1').waitFor({ state: 'visible', timeout })
    const sameCanvas = await page.evaluate(() => window.__portraitAcceptanceCanvas === document.querySelector('canvas'))
    check(`navigation: ${path} preserves shared canvas and active state`, sameCanvas && await page.locator('canvas').count() === 1 && await page.locator(`.desktop-navigation a[href="${path}"]`).getAttribute('aria-current') === 'page', { sameCanvas })
  }
  await page.locator('.header-contact').click()
  await contactPosition(page, 'navigation: Documents Contact actually scrolls to connect')
  await page.locator('.search-toggle').click()
  await page.locator('#header-search-input').fill(' portrait acceptance ')
  await page.locator('#header-search-input').press('Enter')
  await page.waitForURL((url) => url.pathname === '/search' && url.searchParams.get('q') === 'portrait acceptance')
  await page.locator('main h1').waitFor({ state: 'visible', timeout })
  const searchSharesCanvas = await page.evaluate(() => window.__portraitAcceptanceCanvas === document.querySelector('canvas') && document.querySelectorAll('canvas').length === 1)
  check('navigation: search keeps named query route and shared canvas', searchSharesCanvas, { path: new URL(page.url()).pathname + new URL(page.url()).search, searchSharesCanvas })
  await page.locator('.account-link[href="/login"]').click()
  await page.waitForURL((url) => url.pathname === '/login')
  await page.locator('h1').waitFor({ state: 'visible', timeout })
  check('navigation: public login is isolated from shared canvas', await page.locator('canvas').count() === 0)
  await page.getByRole('link', { name: '返回博客首页', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.portraitState === 'ready', undefined, { timeout })
  const returned = await state(page)
  check('navigation: login return creates one healthy shared canvas', returned.canvasCount === 1 && returned.diagnostic.rendererCount === 1)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 2, mobile: false })
  await page.waitForTimeout(700)
  const resized = await page.locator('canvas').evaluate((canvas) => ({ width: canvas.width, height: canvas.height, state: canvas.dataset.portraitState, dpr: devicePixelRatio }))
  check('desktop: resize and DPR change retain ready renderer', resized.state === 'ready' && resized.dpr === 2 && resized.width >= 1180, resized)
  await session.send('Emulation.clearDeviceMetricsOverride')
  await session.detach()
}
async function mobile(width, height) {
  const profile = await makePage(`mobile-${width}x${height}`, { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), { page } = profile
  await home(page)
  const initial = await state(page)
  check(`mobile-${width}x${height}: one ready canvas without horizontal overflow`, initial.canvasCount === 1 && initial.portraitState === 'ready' && initial.overflow === 0, initial)
  const heroFrame = await page.evaluate(() => { const rect = document.querySelector('.immersive-scene').getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewport: { width: innerWidth, height: innerHeight } } })
  check(`mobile-${width}x${height}: portrait scene remains viewport-filling`, Math.abs(heroFrame.x) < 1 && Math.abs(heroFrame.y) < 1 && Math.abs(heroFrame.width - heroFrame.viewport.width) < 1 && Math.abs(heroFrame.height - heroFrame.viewport.height) < 1, heroFrame)
  check(`mobile-${width}x${height}: no cluttering controls`, await page.locator('.portrait-controls,.motion-toggle,.identity-token').count() === 0)
  await screenshot(page, `mobile-${width}x${height}-front`)
  const anchor = await page.locator('.immersive-scene').boundingBox(), before = await page.evaluate(() => scrollY), session = await page.context().newCDPSession(page)
  try {
    const start = { x: Math.min(width - 30, anchor.x + anchor.width * 0.5), y: Math.min(height - 60, anchor.y + anchor.height * 0.75) }
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...start, radiusX: 4, radiusY: 4, force: 1 }] })
    for (let step = 1; step <= 7; step += 1) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: start.x, y: start.y - step * 30, radiusX: 4, radiusY: 4, force: 1 }] }); await page.waitForTimeout(25) }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => scrollY)
    check(`mobile-${width}x${height}: vertical touch swipe on visual scrolls page`, after > before + 40, { before, after })
  } finally { await session.detach() }
  await scrollProgress(page, 1.42)
  await screenshot(page, `mobile-${width}x${height}-signature`)
  const signed = await page.locator('.chen-guo-signature').boundingBox()
  check(`mobile-${width}x${height}: signature stays inside viewport`, signed && signed.x >= 0 && signed.x + signed.width <= width + 1 && signed.y >= 70 && signed.y + signed.height < height, { signed })
  await scrollProgress(page, 3.05)
  await page.waitForTimeout(700)
  await screenshot(page, `mobile-${width}x${height}-writing`)
  const layout = await page.evaluate(()=>({ articles:[...document.querySelectorAll('.article-body')].map(e=>({width:e.clientWidth,overflow:e.scrollWidth-e.clientWidth})), columns:getComputedStyle(document.querySelector('.writing-grid')).gridTemplateColumns, sphereScale:Number(document.querySelector('canvas').dataset.sphereScale), width:innerWidth,height:innerHeight }))
  check(`mobile-${width}x${height}: real articles remain readable in one column`, layout.articles.length===2 && layout.articles.every(a=>a.width>width*.65 && a.overflow<2) && !layout.columns.includes(' '), layout)
  check(`mobile-${width}x${height}: sphere retains original responsive scale`, layout.sphereScale>.55*Math.min(1,width/height) && layout.sphereScale<.68*Math.min(1,width/height), layout)
  await scrollProgress(page, 2.04)
  const trail = await connectorState(page)
  check(`mobile-${width}x${height}: pen continuation stays inside the screen and meets heading`, trail.startGap<.1 && trail.endGap<.1 && trail.inBounds && trail.tangentMatch>.98, trail)
  await screenshot(page, `mobile-${width}x${height}-connector`)
  await sectionContinuity(page,`mobile-${width}x${height}`)
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  const menuLinks = await page.locator('#mobile-navigation a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  check(`mobile-${width}x${height}: menu keeps primary Contact secondary order`, JSON.stringify(menuLinks) === JSON.stringify(['/works', '/about', '/about#connect', '/writing', '/documents']), { menuLinks })
  await page.locator('#mobile-navigation a').last().focus()
  await page.keyboard.press('Tab')
  check(`mobile-${width}x${height}: menu focus remains visible with background inert`, await page.evaluate(() => Boolean(document.activeElement?.closest('.site-header')) && document.querySelector('#main-content').inert))
  await page.locator('.mobile-contact').click()
  await contactPosition(page, `mobile-${width}x${height}: Contact actually scrolls to connect`)
  check(`mobile-${width}x${height}: Contact closes mobile menu`, await page.locator('.menu-toggle').getAttribute('aria-expanded') === 'false')
  check(`mobile-${width}x${height}: Contact restores background interaction`, await page.evaluate(() => !document.querySelector('#main-content').inert && !document.querySelector('.footer').inert))
  await profile.context.close()
}
async function fullMotionPreference() {
  const profile = await makePage('system-reduced', { reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, context => context.addInitScript(() => localStorage.setItem('field-notes:motion-paused', '1')))
  await home(profile.page)
  await profile.page.waitForTimeout(900)
  const current = await state(profile.page)
  check('system reduced preference and legacy pause do not stop full animation', current.renderState === 'webgl' && current.canvasDisplay !== 'none' && current.diagnostic?.rafActive === true, current)
  await scrollProgress(profile.page, 1.42)
  await screenshot(profile.page, 'system-reduced-full-motion')
  check('system reduced preference still reaches sphere and signature', (await signatureState(profile.page)).every(v=>v<.01) && Number(await profile.page.locator('canvas').getAttribute('data-sphere-scale'))>.25)
  await profile.context.close()
}
async function fallbackProfile(name, options, beforePage, expectedState) {
  const profile = await makePage(name, options, beforePage), { page } = profile
  await home(page, expectedState)
  await page.waitForFunction(() => document.querySelector('.immersive-scene')?.dataset.renderState === 'poster', undefined, { timeout })
  const current = await state(page)
  const expected = name === 'webgl-disabled' ? current.canvasDisplay === 'none' && current.diagnostic?.fallback === true && current.diagnostic.rendererCount === 0 : current.portraitState === 'error'
  check(`${name}: honest static fallback without obsolete controls`, expected && current.posterVisible && current.posterSource === '/portraits/front/preview.png' && current.canvasCount === 1 && await page.locator('.motion-toggle,.portrait-controls').count() === 0, current)
  await screenshot(page, name)
  await wheelContinuity(page, name)
  await profile.context.close()
}

try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true })
  report.browser = browser.version()
  const desktop = await desktopPortrait()
  await navigation(desktop)
  await desktop.context.close()
  await mobile(390, 844)
  await mobile(320, 740)
  await mobile(320, 568)
  await fullMotionPreference()
  await fallbackProfile('webgl-disabled', {}, async (context) => { await context.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/i.test(type) ? null : original.call(this, type, ...args) } }) }, null)
  await fallbackProfile('missing-texture', {}, async (context) => { await context.route('**/portraits/bass/depth.png', (route) => route.fulfill({ status: 404, body: 'Intentional portrait acceptance failure' })) }, 'error')
  await fluidReveal()
} catch (error) { report.fatalError = error instanceof Error ? error.stack || error.message : String(error) }
finally {
  await browser?.close()
  const webglErrors = report.console.filter((entry) => entry.type === 'error' && /WebGL|shader|GL_INVALID|framebuffer|GL ERROR/i.test(entry.text) && entry.profile !== 'webgl-disabled')
  check('all WebGL-enabled profiles: no shader or WebGL console errors', webglErrors.length === 0, { webglErrors })
  check('all profiles: no uncaught page errors or unexpected API calls', report.pageErrors.length === 0 && report.failures.length === 0, { pageErrors: report.pageErrors, failures: report.failures })
  report.finishedAt = new Date().toISOString()
  report.summary = { checks: report.checks.length, passed: report.checks.filter((entry) => entry.passed).length, failed: report.checks.filter((entry) => !entry.passed).length, screenshots: report.screenshots.length, pageErrors: report.pageErrors.length }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, summary: report.summary, fatalError: report.fatalError || null }, null, 2))
}
if (report.fatalError || report.checks.some((entry) => !entry.passed)) process.exitCode = 1
