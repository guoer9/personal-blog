import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import AxeBuilder from '../../frontend/node_modules/@axe-core/playwright/dist/index.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.LOCAL_FRONTEND_URL || 'http://127.0.0.1:5173'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Local verification only')
const output = resolve(root, 'output/research-profile/browser-workflow')
await mkdir(output, { recursive: true })
const env = Object.fromEntries((await readFile(resolve(root, '.env.local-workspace'), 'utf8')).split('\n').filter(line => line && !line.startsWith('#')).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)] }))
const report = { startedAt: new Date().toISOString(), public: [], admin: {}, library: {}, axe: [], errors: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
report.browser = browser.version()
let adminContext
let adminPage
const stamp = Date.now().toString(36)

async function checkedJSON(path) {
  const response = await fetch(origin + '/api/v1' + path)
  assert.equal(response.status, 200, path)
  return response.json()
}
async function revealCovers(page) {
  for (const img of await page.locator('.work-card img').all()) {
    await img.scrollIntoViewIfNeeded()
    await img.evaluate(element => element.decode())
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}
async function loaded(page, selector) { await page.locator(selector).first().waitFor({ state: 'visible' }) }
async function checkAdminAxe(page, path) {
  const result = await new AxeBuilder({ page }).analyze()
  report.axe.push({ path, viewport: page.viewportSize(), violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length, targets: nodes.map(node => node.target), details: nodes.map(node => node.failureSummary) })) })
}
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    const prematureMedia = []
    page.on('response', response => { if (/^(video|audio)\//.test(response.headers()['content-type'] || '')) prematureMedia.push(response.url()) })
    await page.goto(origin + '/works')
    await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 8)
    await page.getByRole('navigation', { name: '作品分类' }).getByRole('link', { name: /^音乐/ }).click()
    await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 2)
    assert.equal(new URL(page.url()).searchParams.get('type'), 'music')
    await page.getByRole('link', { name: /凌晨的雨/ }).click()
    await loaded(page, 'audio')
    assert.equal(await page.locator('audio').getAttribute('preload'), 'none')
    assert.equal(prematureMedia.length, 0, 'media must not load before user playback')
    const musicAxe = await new AxeBuilder({ page }).analyze()
    report.axe.push({ viewport, path: '/works/rain-at-dawn', violations: musicAxe.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length })) })
    const play = await page.locator('audio').evaluate(async element => { element.muted = true; await element.play(); return { paused: element.paused, duration: element.duration } })
    assert.equal(play.paused, false)
    assert(Math.abs(play.duration - 63) < 0.25)
    await page.getByRole('button', { name: '观看影像' }).click()
    await loaded(page, 'video')
    await page.locator('video').evaluate(async element => { element.muted = true; await element.play() })
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.1)
    await page.locator('video').evaluate(element => element.pause())
    await page.goto(origin + '/works?type=film')
    await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 2)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.equal(overflow, false)
    await revealCovers(page)
    await page.screenshot({ path: resolve(output, `film-${viewport.width}.png`), fullPage: true })
    await page.goto(origin + '/works')
    await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 8)
    await revealCovers(page)
    await page.screenshot({ path: resolve(output, `works-${viewport.width}.png`), fullPage: true })
    const result = await new AxeBuilder({ page }).analyze()
    report.axe.push({ viewport, path: '/works', violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length })) })
    await page.keyboard.press('Tab')
    // A fresh document keeps skip navigation as the first keyboard stop.
    const firstFocus = await page.evaluate(() => document.activeElement?.textContent?.trim())
    assert.equal(firstFocus, '跳到正文')
    report.public.push({ viewport, cards: 8, music: 2, film: 2, noPreload: true, audioDuration: play.duration, videoPlayed: true, overflow, firstFocus })
    await context.close()
  }

  console.log('Public desktop/mobile checks passed')
  adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await adminContext.addInitScript(() => { delete window.showSaveFilePicker })
  const page = await adminContext.newPage()
  adminPage = page
  report.adminResponses = []
  page.on('response', response => { if (/\/admin\/(works|work-assets)/.test(response.url())) report.adminResponses.push({ path: new URL(response.url()).pathname, method: response.request().method(), status: response.status() }) })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(origin + '/admin/works')
  await page.waitForURL('**/admin/login**')
  await page.getByPlaceholder('用户名或邮箱').fill(env.LOCAL_ADMIN_USERNAME)
  await page.getByPlaceholder('输入密码').fill(env.LOCAL_ADMIN_PASSWORD)
  await page.getByRole('button', { name: '进入控制台' }).click()
  await page.waitForURL('**/admin/works')
  await page.getByRole('link', { name: '新建作品', exact: true }).click()
  const slug = 'local-review-' + stamp
  const title = '本地发布流程验收 ' + stamp
  await page.getByLabel('作品标题', { exact: true }).fill(title)
  await page.getByLabel('英文短链').fill(slug)
  await page.getByLabel('作品简介').fill('仅用于本地验证草稿、预览、发布、修改与下架。')
  await page.getByLabel('代码仓库 HTTPS 地址').fill('https://github.com/guoer9/personal-blog')
  await checkAdminAxe(page, '/admin/works/new')
  await page.screenshot({ path: resolve(output, 'admin-work-editor.png'), fullPage: true })
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.waitForURL('**/admin/works/*/edit')
  assert.equal((await fetch(origin + '/api/v1/works/' + slug)).status, 404)
  await page.getByRole('button', { name: '保存并预览', exact: true }).click()
  await loaded(page, '.draft-preview')
  assert.equal((await fetch(origin + '/api/v1/works/' + slug)).status, 404)
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已发布' }).waitFor()
  assert.equal((await checkedJSON('/works/' + slug)).title, title)
  const visitor = await browser.newContext({ reducedMotion: 'reduce' })
  const publicPage = await visitor.newPage()
  await publicPage.goto(origin + '/works')
  await publicPage.locator(`a[href="/works/${slug}"]`).click()
  await publicPage.getByRole('heading', { name: title, exact: true }).waitFor()
  await page.getByLabel('作品标题', { exact: true }).fill(title + ' 更新')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor()
  assert.equal((await checkedJSON('/works/' + slug)).title, title)
  await page.getByRole('button', { name: '发布更新', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已发布' }).waitFor()
  assert.equal((await checkedJSON('/works/' + slug)).title, title + ' 更新')
  await page.getByRole('button', { name: '下架作品', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '作品已下架' }).waitFor()
  assert.equal((await fetch(origin + '/api/v1/works/' + slug)).status, 404)
  await publicPage.reload()
  await publicPage.getByRole('heading', { name: '这件作品还不在这里。', exact: true }).waitFor()
  await visitor.close()
  report.admin = { loginUI: true, createDraft: true, privatePreview: true, publish: true, savePreservesPublic: true, publishUpdate: true, unpublish: true, retainedDraftSlug: slug }

  console.log('Admin publication lifecycle passed')
  await page.goto(origin + '/admin/works/new')
  const mediaSlug = 'local-media-review-' + stamp
  await page.getByLabel('作品标题', { exact: true }).fill('本地音乐发布验收 ' + stamp)
  await page.getByLabel('英文短链').fill(mediaSlug)
  await page.getByLabel(/^分类/).selectOption('music')
  await page.getByLabel('作品简介').fill('验证文件选择、受限预览、公开播放与下架。')
  const prepared = []
  for (const [label, filename] of [['封面', 'rain-at-dawn-cover.jpg'], ['音频', 'rain-at-dawn-audio.m4a']]) {
    await page.locator('.asset-row').filter({ has: page.locator('span', { hasText: label }) }).getByRole('button', { name: '从文件库选择', exact: true }).click()
    const row = page.locator('.asset-picker li').filter({ hasText: filename })
    const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/work-assets' && response.request().method() === 'POST')
    await row.getByRole('button', { name: '选择并准备', exact: true }).click()
    const response = await result
    assert.equal(response.status(), 201)
    prepared.push((await response.json()).id)
    await page.locator('.asset-picker').waitFor({ state: 'hidden' })
  }
  for (const id of prepared) assert.equal((await fetch(origin + '/api/v1/work-assets/' + id)).status, 404)
  await page.getByRole('button', { name: '保存并预览', exact: true }).click()
  await page.waitForURL('**/admin/works/*/edit')
  await loaded(page, '.draft-preview audio')
  const previewAudio = await page.locator('.draft-preview audio').getAttribute('src')
  assert(previewAudio.startsWith('/api/v1/admin/work-assets/'))
  assert.equal((await fetch(origin + previewAudio)).status, 401)
  assert.equal((await adminContext.request.get(origin + previewAudio, { headers: { Range: 'bytes=0-1023' } })).status(), 206)
  await page.locator('.draft-preview audio').evaluate(async element => { element.muted = true; await element.play(); element.pause() })
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已发布' }).waitFor()
  const publicMedia = await checkedJSON('/works/' + mediaSlug)
  assert.equal((await fetch(origin + publicMedia.audio, { headers: { Range: 'bytes=0-1023' } })).status, 206)
  await page.getByRole('button', { name: '下架作品', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '作品已下架' }).waitFor()
  for (const id of prepared) assert.equal((await fetch(origin + '/api/v1/work-assets/' + id)).status, 404)
  assert.equal((await adminContext.request.delete(origin + '/api/v1/admin/work-assets/preview-session')).status(), 204)
  assert.equal((await adminContext.request.get(origin + previewAudio)).status(), 401)
  report.admin.media = { slug: mediaSlug, selectedFromLibrary: true, independentAssetIds: prepared, privateRange: true, previewPlayed: true, publicRange: true, hiddenAfterUnpublish: true, previewCookieCleared: true }

  await page.goto(origin + '/admin/works')
  await page.getByRole('button', { name: '清理过期未引用副本', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已清理' }).waitFor()
  report.admin.assetCleanupUI = true
  await checkAdminAxe(page, '/admin/works')
  await page.screenshot({ path: resolve(output, 'admin-works.png'), fullPage: true })

  console.log('Media publication and cleanup checks passed')
  await page.goto(origin + '/admin/library')
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click()
  const folder = '本地续传验收-' + stamp
  await page.getByRole('dialog').getByLabel('文件夹名称').fill(folder)
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: folder, exact: true }).click()
  const fileName = 'resume-' + stamp + '.bin'
  const buffer = Buffer.alloc(9 * 1024 * 1024 + 37, 91)
  const file = resolve(output, fileName)
  await writeFile(file, buffer)
  let releasePart
  let hold = true
  let partZeroCount = 0
  page.on('request', request => { if (request.method() === 'PUT' && /\/parts\/0$/.test(request.url())) partZeroCount++ })
  await page.route('**/api/v1/library/uploads/*/parts/1', async route => {
    if (hold) await new Promise(resolve => { releasePart = resolve })
    try { await route.continue() } catch { /* The paused request has been cancelled. */ }
  })
  const partOne = page.waitForRequest(request => request.method() === 'PUT' && /\/parts\/1$/.test(request.url()))
  await page.getByLabel('选择文件上传', { exact: true }).setInputFiles(file)
  await partOne
  await page.getByRole('button', { name: '暂停上传', exact: true }).click()
  hold = false
  releasePart?.()
  await page.reload()
  await page.getByLabel('重新选择原文件并续传', { exact: true }).setInputFiles(file)
  await page.getByRole('status').filter({ hasText: '上传完成' }).waitFor({ timeout: 60000 })
  assert.equal(partZeroCount, 1, 'completed first part must not be uploaded again')
  // Resume keeps the original folder although a reload starts the file browser at root.
  await page.getByRole('button', { name: folder, exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 ' + fileName, exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const hash = createHash('sha256')
  for await (const chunk of stream) hash.update(chunk)
  assert.equal(hash.digest('hex'), createHash('sha256').update(buffer).digest('hex'))
  await page.getByRole('button', { name: '重命名 ' + fileName, exact: true }).click()
  const renamed = 'renamed-' + fileName
  await page.getByRole('dialog').getByLabel('新名称').fill(renamed)
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '移入回收站 ' + renamed, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认移入回收站', exact: true }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await page.getByRole('button', { name: '恢复 ' + renamed, exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已恢复' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.library-header > button')?.disabled)
  report.library = { folder, filename: renamed, size: buffer.length, pausedAndReloaded: true, resumedWithoutPartZero: true, downloadHashMatched: true, rename: true, trashAndRestore: true }
  await checkAdminAxe(page, '/admin/library')
  await page.screenshot({ path: resolve(output, 'admin-library.png'), fullPage: true })
  assert.equal(report.errors.length, 0, 'unexpected browser exceptions')
  assert(report.axe.every(result => result.violations.length === 0), 'accessibility violations')
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: true, publicViews: report.public.length, admin: report.admin, library: report.library, axe: report.axe, browser: report.browser }, null, 2))
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  if (adminPage && !adminPage.isClosed()) {
    report.adminPage = { url: adminPage.url(), alerts: await adminPage.getByRole('alert').allTextContents(), statuses: await adminPage.getByRole('status').allTextContents() }
    if (!adminPage.url().includes('/login')) await adminPage.screenshot({ path: resolve(output, 'failure-' + stamp + '.png'), fullPage: true })
  }
  await writeFile(resolve(output, 'result-failed-' + stamp + '.json'), JSON.stringify(report, null, 2))
  console.error(error.message)
  process.exitCode = 1
} finally {
  await adminContext?.close()
  await browser.close()
}
