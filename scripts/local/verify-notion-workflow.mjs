import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import AxeBuilder from '../../frontend/node_modules/@axe-core/playwright/dist/index.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.LOCAL_FRONTEND_URL || 'http://127.0.0.1:5173'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Local verification only')
// Explicit scope is required; discovering the workspace never approves importing it.
const connection = process.env.NOTION_ACCEPTANCE_CONNECTION
const targetUrl = process.env.NOTION_ACCEPTANCE_URL
if (!connection || !targetUrl) throw new Error('Set NOTION_ACCEPTANCE_CONNECTION and NOTION_ACCEPTANCE_URL to an explicitly approved source')
const output = resolve(root, 'output/playwright/notion-acceptance-20261102')
await mkdir(output, { recursive: true })
const env = Object.fromEntries((await readFile(resolve(root, '.env.local-workspace'), 'utf8')).split('\n').filter(line => line && !line.startsWith('#')).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)] }))
const report = { startedAt: new Date().toISOString(), mode: 'real-notion-selected-source', connection, checks: [], axe: [], errors: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
report.browser = browser.version()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.on('pageerror', error => report.errors.push(error.message))
async function audit(page, label) {
  const result = await new AxeBuilder({ page }).analyze()
  report.axe.push({ label, viewport: page.viewportSize(), violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) })) })
}
async function waitDone(page) { await page.getByRole('status').filter({ hasText: '操作完成' }).waitFor({ timeout: 600000 }) }
async function screenshot(page, name) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  await page.screenshot({ path: resolve(output, name), fullPage: true, animations: 'disabled' })
}
try {
  assert.equal((await fetch(origin + '/api/v1/admin/notion/connections')).status, 401)
  assert.equal((await fetch(origin + `/api/v1/admin/notion/connections/${encodeURIComponent(connection)}/workspace`)).status, 401)
  report.checks.push('anonymous-admin-directory-denied')
  await page.goto(origin + '/admin/notion')
  await page.waitForURL('**/admin/login**')
  await page.getByPlaceholder('用户名或邮箱').fill(env.LOCAL_ADMIN_USERNAME)
  await page.getByPlaceholder('输入密码').fill(env.LOCAL_ADMIN_PASSWORD)
  await page.getByRole('button', { name: '进入控制台 ↗', exact: true }).click()
  await page.waitForURL('**/admin/notion')
  await page.locator('#notion-connection option').filter({ hasText: '个人博客' }).waitFor({ state: 'attached' })
  await page.locator('#notion-connection').selectOption(connection)
  const directoryResponse = page.waitForResponse(response => response.url().includes(`/connections/${encodeURIComponent(connection)}/workspace`) && response.request().method() === 'GET')
  await page.getByRole('button', { name: '浏览工作空间', exact: true }).click()
  const directoryResult = await directoryResponse
  assert.equal(directoryResult.status(), 200)
  const directory = await directoryResult.json()
  report.directory = { returned: directory.items.length, more: !!directory.next_cursor }
  await page.locator('.directory').waitFor()
  await screenshot(page, 'admin-directory-desktop.png')
  report.checks.push('real-workspace-discovery')
  await page.locator('#notion-database-url').fill(targetUrl)
  const inspectResponse = page.waitForResponse(response => response.url().endsWith('/admin/notion/sources/inspect'), { timeout: 600000 })
  await page.getByRole('button', { name: '检查并预览', exact: true }).click()
  const inspection = await inspectResponse
  const preview = await inspection.json()
  assert.equal(inspection.status(), 200, 'real source inspection failed')
  report.preview = { sourceType: preview.source_type, pageCount: preview.page_count, publishable: preview.publishable_count, isolated: preview.isolated_count, dataSources: preview.data_source_count }
  assert(preview.publishable_count > 0, 'selected source has no publishable content; do not bypass isolation')
  await page.locator('[data-testid="source-preview"]').waitFor()
  assert.equal(await page.getByRole('button', { name: '确认导入并公开', exact: true }).isDisabled(), true)
  await screenshot(page, 'admin-source-preview.png')
  await page.locator('#confirm-source').check()
  const imported = page.waitForResponse(response => response.url().endsWith('/admin/notion/sources') && response.request().method() === 'POST', { timeout: 600000 })
  await page.getByRole('button', { name: '确认导入并公开', exact: true }).click()
  const importResponse = await imported
  assert.equal(importResponse.status(), 200)
  report.import = (await importResponse.json()).counters
  await waitDone(page)
  report.checks.push('real-inspect-confirm-import')
  await page.locator('.sources > li').first().waitFor()
  const sources = await page.locator('.sources > li').count()
  assert(sources > 0)
  const syncResponse = page.waitForResponse(response => /\/admin\/notion\/sources\/\d+\/sync$/.test(response.url()), { timeout: 600000 })
  // Choose the imported source by its inspected title, even when other local sources exist.
  const selectedSource = page.locator('.sources > li').filter({ has: page.getByRole('heading', { name: preview.title, exact: true }) })
  assert.equal(await selectedSource.count(), 1)
  await selectedSource.getByRole('button', { name: '同步此来源', exact: true }).click()
  const synchronized = await syncResponse
  assert.equal(synchronized.status(), 200)
  report.sync = (await synchronized.json()).counters
  await waitDone(page)
  report.checks.push('real-manual-resync')
  await audit(page, 'admin-notion-desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot(page, 'admin-notion-mobile.png')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await audit(page, 'admin-notion-mobile')

  const listing = await fetch(origin + '/api/v1/documents')
  assert.equal(listing.status, 200)
  const documents = await listing.json()
  const selectedDocument = documents.items.find(item => item.title === preview.title)
  assert(selectedDocument, 'imported document should be publicly listed')
  report.document = { slug: selectedDocument.slug, categories: selectedDocument.categories.length }
  const detail = await (await fetch(origin + '/api/v1/documents/' + encodeURIComponent(selectedDocument.slug))).json()
  report.document.blockTypes = Object.fromEntries([...new Set((detail.blocks || []).map(block => block.type))].map(type => [type, detail.blocks.filter(block => block.type === type).length]))
  report.document.contentLength = detail.content.length
  assert(detail.content.length > 0)
  const titleSearch = selectedDocument.title.slice(0, 100)
  const search = await (await fetch(origin + '/api/v1/documents?q=' + encodeURIComponent(titleSearch))).json()
  assert(search.items.some(item => item.slug === selectedDocument.slug))
  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const publicPage = await anonymous.newPage()
  publicPage.on('pageerror', error => report.errors.push(error.message))
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await publicPage.setViewportSize(viewport)
    await publicPage.goto(origin + '/documents')
    await publicPage.locator('.document-card').first().waitFor()
    await screenshot(publicPage, `documents-${viewport.width}.png`)
    await audit(publicPage, 'public-documents')
    assert.equal(await publicPage.locator('a[href^="/admin"]').count(), 0)
    await publicPage.locator('#documents-query').fill(titleSearch)
    await publicPage.locator('#documents-query').press('Enter')
    await publicPage.waitForURL(url => url.searchParams.get('q') === titleSearch)
    await publicPage.locator(`a[href="/documents/${encodeURIComponent(selectedDocument.slug)}"]`).first().waitFor()
    await publicPage.waitForFunction(() => document.activeElement?.id === 'documents-results')
    await publicPage.locator(`a[href="/documents/${encodeURIComponent(selectedDocument.slug)}"]`).first().click()
    await publicPage.locator('.document-content').waitFor()
    if (detail.blocks) {
      assert.equal(await publicPage.locator('.notion-blocks > .notion-paragraph').count(), detail.blocks.filter(block => block.type === 'paragraph').length)
      assert.equal(await publicPage.locator('.notion-blocks figure img').count(), detail.blocks.filter(block => block.type === 'image').length)
      for (const img of await publicPage.locator('.document-content img').all()) {
        await img.scrollIntoViewIfNeeded()
        await img.evaluate(element => element.decode())
        assert.equal(await img.evaluate(element => element.naturalWidth > 0 && element.complete), true)
      }
      await publicPage.evaluate(() => window.scrollTo(0, 0))
    }
    assert.equal(await publicPage.locator('h1').textContent(), selectedDocument.title)
    assert.equal(await publicPage.locator('.comments-section').count(), 0)
    assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await screenshot(publicPage, `document-${viewport.width}.png`)
    await audit(publicPage, 'public-document-detail')
    await publicPage.reload()
    await publicPage.locator('.document-content').waitFor()
  }
  report.checks.push('anonymous-desktop-mobile-list-search-detail-reload', 'keyboard-enter-and-focus', 'no-horizontal-overflow')
  await publicPage.goto(origin + '/documents/not-a-real-document-20261102')
  await publicPage.getByRole('heading', { name: '资料未找到', exact: true }).waitFor()
  report.checks.push('public-document-404')
  await anonymous.close()
  assert.equal(report.errors.length, 0)
  assert.equal(report.axe.reduce((count, row) => count + row.violations.length, 0), 0, 'axe violations need review')
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = String(error.message || error)
  // Do not capture credentials or login page contents on failure.
  if (!page.url().includes('/login')) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify(report, null, 2))
}
