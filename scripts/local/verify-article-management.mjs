/** Real local browser acceptance: existing Notion content plus a disposable manual article. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = new URL(process.env.LOCAL_FRONTEND_URL || 'http://127.0.0.1:5173')
assert(['localhost', '127.0.0.1'].includes(origin.hostname), 'Local acceptance only')
const output = resolve(root, 'output/playwright/article-management')
await mkdir(output, { recursive: true })
const values = Object.fromEntries((await readFile(resolve(root, '.env.local-workspace'), 'utf8')).split('\n')
  .filter(line => line && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))
const stamp = Date.now()
const message = `本地浏览器验收评论 ${stamp}`
const reply = `本地浏览器验收回复 ${stamp}`
const manualTitle = `验收用临时文章 ${stamp}`
const report = { startedAt: new Date().toISOString(), mode: 'real-imported-notion-and-disposable-manual-article', checks: [], pageErrors: [], screenshots: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.on('pageerror', error => report.pageErrors.push(error.message))
let headers
let manual
const ownCommentIds = new Set()
const url = path => new URL(path, origin).href
async function api(path, options = {}) {
  const response = await context.request.fetch(url('/api/v1' + path), { ...options, headers: { ...headers, ...options.headers } })
  assert(response.ok(), `${options.method || 'GET'} ${path}: HTTP ${response.status()}`)
  return response.status() === 204 ? null : response.json()
}
async function screenshot(locator, name) {
  await locator.screenshot({ path: resolve(output, name), animations: 'disabled' })
  report.screenshots.push(name)
}
async function waitForCount(count) {
  await page.waitForFunction(count => document.querySelector('.document-meta')?.textContent.includes(`${count} 条评论`), count)
}
try {
  const listing = await api('/documents')
  const document = listing.items.find(item => item.id === 1) || listing.items[0]
  assert(document, 'Import a real Notion article before running this acceptance')
  report.notion = { id: document.id, title: document.title, originalViews: document.view_count, originalComments: document.comment_count }
  await page.goto(url('/admin/posts'))
  await page.waitForURL('**/admin/login**')
  await page.getByPlaceholder('用户名或邮箱').fill(values.LOCAL_ADMIN_USERNAME)
  await page.getByPlaceholder('输入密码').fill(values.LOCAL_ADMIN_PASSWORD)
  await page.getByRole('button', { name: '进入控制台 ↗', exact: true }).click()
  await page.waitForURL(location => location.pathname === '/admin/posts')
  await page.getByRole('heading', { name: '文章管理', exact: true }).waitFor()
  headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}` }
  report.checks.push('real-admin-login')

  manual = await api('/posts', { method: 'POST', data: { title: manualTitle, content: 'Disposable local acceptance article.', is_published: true } })
  await api('/comments', { method: 'POST', data: { post_id: manual.id, content: `临时手动文章评论 ${stamp}` } })
  await page.reload()
  const table = page.locator('.el-table__body')
  await table.getByText(manualTitle, { exact: false }).waitFor()
  const notionRow = table.locator('tr').filter({ hasText: document.title })
  assert.equal(await notionRow.count(), 1)
  assert((await notionRow.innerText()).includes(document.author_label))
  assert.equal(await notionRow.getByRole('link', { name: '在 Notion 打开 ↗', exact: true }).getAttribute('href'), document.external_url)
  assert.equal(await notionRow.getByRole('link', { name: `${document.title} ↗`, exact: true }).getAttribute('href'), document.public_url)
  for (const label of ['作者', '标签', '评论', '阅读']) assert((await page.locator('.el-table__header').innerText()).includes(label))
  assert.equal(await notionRow.getByRole('button', { name: '下架', exact: true }).isVisible(), true)
  await screenshot(page.locator('.posts-page'), 'admin-unified-articles.png')
  report.checks.push('manual-and-notion-shared-management-metadata-and-links')

  await page.goto(url(document.public_url))
  await page.getByRole('heading', { name: document.title, exact: true }).waitFor()
  await page.locator('.comment-form textarea').waitFor()
  await waitForCount(document.comment_count)
  assert((await page.locator('.document-meta').innerText()).includes(document.author_label))
  assert.equal(await page.getByRole('link', { name: 'Notion 原文 ↗', exact: true }).getAttribute('href'), document.external_url)
  await screenshot(page.locator('.simple-page-header'), 'notion-metadata-desktop.png')
  for (const [content, isReply] of [[message, false], [reply, true]]) {
    if (isReply) await page.locator('.comment-item').filter({ hasText: message }).getByRole('button', { name: '回复', exact: true }).click()
    await page.locator('.comment-form textarea').fill(content)
    const created = page.waitForResponse(response => response.url().endsWith('/api/v1/comments') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '发布评论', exact: true }).click()
    const response = await created
    assert.equal(response.status(), 201)
    const comment = await response.json()
    ownCommentIds.add(comment.id)
    assert.equal(comment.notion_document_id, document.id)
    assert.equal(comment.post_id, null)
    await page.locator('.comment-item').getByText(content, { exact: false }).waitFor()
    await page.getByRole('button', { name: '发布评论', exact: true }).waitFor()
  }
  await waitForCount(document.comment_count + 2)
  await screenshot(page.locator('#discussion'), 'notion-comments-desktop.png')
  report.checks.push('notion-comment-and-reply-created-in-browser')

  const detail = await api('/documents/' + encodeURIComponent(document.slug))
  assert(detail.view_count > document.view_count)
  assert.equal(detail.comment_count, document.comment_count + 2)
  assert.equal(detail.updated_at, document.updated_at)
  report.checks.push('views-increase-without-changing-article-update-time')

  await page.goto(url('/admin/comments'))
  const group = page.locator('.post-card').filter({ hasText: document.title })
  await group.getByText(message, { exact: true }).waitFor()
  assert((await group.innerText()).includes(reply))
  await page.locator('.post-card').filter({ hasText: manualTitle }).waitFor()
  await screenshot(page.locator('.comments-page'), 'admin-shared-comments.png')
  report.checks.push('both-article-types-and-nested-replies-in-admin-comments')

  if (process.env.ARTICLE_ACCEPTANCE_SYNC === '1') {
    await page.goto(url('/admin/notion'))
    const source = page.locator('.sources > li').filter({ has: page.getByRole('heading', { name: document.title, exact: true }) })
    await source.waitFor()
    const synced = page.waitForResponse(response => /\/admin\/notion\/sources\/\d+\/sync$/.test(response.url()), { timeout: 180000 })
    await source.getByRole('button', { name: '同步此来源', exact: true }).click()
    const response = await synced
    assert.equal(response.status(), 200)
    const after = await api('/documents/' + encodeURIComponent(document.slug))
    assert.equal(after.id, document.id)
    assert.equal(after.author_label, document.author_label)
    assert.equal(after.comment_count, document.comment_count + 2)
    assert(after.view_count >= detail.view_count)
    report.syncCounters = (await response.json()).counters
    report.checks.push('real-notion-source-resync-preserves-identity-author-comments-and-views')
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(url(document.public_url))
  await page.locator('.comment-form textarea').waitFor()
  await waitForCount(document.comment_count + 2)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await screenshot(page.locator('.simple-page-header'), 'notion-metadata-mobile.png')
  await screenshot(page.locator('#discussion'), 'notion-comments-mobile.png')
  report.checks.push('mobile-metadata-and-discussion-without-horizontal-overflow')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(url('/admin/comments'))
  const parentRow = page.locator('.post-card').filter({ hasText: document.title }).locator('.el-table__body tr').filter({ hasText: message })
  await parentRow.getByRole('button', { name: '删除', exact: true }).click()
  const removed = page.waitForResponse(response => response.url().endsWith(`/api/v1/comments/${[...ownCommentIds][0]}`) && response.request().method() === 'DELETE')
  await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click()
  assert.equal((await removed).status(), 204)
  ownCommentIds.clear()
  const articles = await api('/admin/articles', { params: { page_size: 50 } })
  assert.equal(articles.items.find(item => item.kind === 'notion' && item.id === document.id).comment_count, document.comment_count)
  report.checks.push('admin-delete-cascades-own-test-reply-and-restores-real-count')

  await page.goto(url('/admin/posts'))
  const manualRow = page.locator('.el-table__body tr').filter({ hasText: manualTitle })
  await manualRow.getByRole('button', { name: '下架', exact: true }).click()
  const unpublished = page.waitForResponse(response => response.url().endsWith(`/admin/articles/post/${manual.id}/unpublish`))
  await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click()
  assert.equal((await unpublished).status(), 200)
  assert.equal((await context.request.get(url('/api/v1/posts/' + manual.slug))).status(), 404)
  report.checks.push('unpublish-through-unified-management-hides-public-post')
  assert.deepEqual(report.pageErrors, [])
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.message
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: false }).catch(() => {})
  process.exitCode = 1
} finally {
  // Remove only records created by this run; existing articles and comments are retained.
  if (headers) {
    for (const id of ownCommentIds) {
      const response = await context.request.delete(url('/api/v1/comments/' + id), { headers })
      assert([204, 404].includes(response.status()))
    }
    if (manual) {
      const current = await api('/posts/id/' + manual.id)
      assert.equal(current.title, manualTitle)
      await api('/posts/' + manual.id, { method: 'DELETE' })
    }
    report.cleanedOwnTestData = true
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify(report, null, 2))
}
