import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.LOCAL_FRONTEND_URL || 'http://127.0.0.1:5173'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Local verification only')
const output = resolve(root, 'output/playwright/notion-acceptance-20261102')
await mkdir(output, { recursive: true })
const env = Object.fromEntries((await readFile(resolve(root, '.env.local-workspace'), 'utf8')).split('\n').filter(line => line && !line.startsWith('#')).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)] }))
const report = { mode: 'controlled-connection-browser-no-remote-token', checks: [], errors: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
const connections = []
const directoryCalls = []
page.on('pageerror', error => report.errors.push(error.message))
await page.route('**/api/v1/admin/notion/connections', async route => {
  if (route.request().method() === 'GET') return route.fulfill({ json: connections })
  const data = route.request().postDataJSON()
  if (data.token === 'ntn_browser_rejected') return route.fulfill({ status: 400, json: { detail: 'Notion 密钥无效或没有访问权限' } })
  const connection = { id: 'browser-' + connections.length, label: data.label, configured: true }
  connections.push(connection)
  await route.fulfill({ status: 201, json: connection })
})
await page.route('**/api/v1/admin/notion/connections/*/workspace*', async route => {
  const id = new URL(route.request().url()).pathname.split('/').at(-2)
  directoryCalls.push(id)
  await route.fulfill({ json: { items: [{ id: 'test-page', kind: 'page', title: '受控目录 ' + id, url: 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', last_edited_at: null }], next_cursor: null } })
})
try {
  await page.goto(origin + '/admin/notion')
  await page.waitForURL('**/admin/login**')
  await page.getByPlaceholder('用户名或邮箱').fill(env.LOCAL_ADMIN_USERNAME)
  await page.getByPlaceholder('输入密码').fill(env.LOCAL_ADMIN_PASSWORD)
  await page.getByRole('button', { name: '进入控制台 ↗', exact: true }).click()
  await page.waitForURL('**/admin/notion')
  const form = page.locator('.add-connection')
  const label = form.getByLabel('连接名称', { exact: true })
  const token = form.getByLabel('Notion 密钥', { exact: true })
  const submit = form.getByRole('button', { name: '添加连接', exact: true })
  assert.equal(await submit.isDisabled(), true)
  await label.fill('拒绝测试')
  await token.fill('ntn_browser_rejected')
  await submit.click()
  await form.getByRole('alert').waitFor()
  await token.waitFor()
  assert.equal(await token.inputValue(), '')
  report.checks.push('invalid-token-feedback-and-clear')
  for (const name of ['受控工作区 A', '受控工作区 B']) {
    await label.fill(name)
    await token.fill('ntn_browser_fixture_' + connections.length)
    await submit.click()
    await page.locator('#notion-connection').getByRole('option', { name, exact: true }).waitFor({ state: 'attached' })
    await page.waitForFunction(() => document.querySelector('input[type="password"]').value === '')
    assert.equal(await page.locator('#notion-connection').inputValue(), 'browser-' + (connections.length - 1))
  }
  report.checks.push('add-two-connections-refresh-and-select')
  await page.getByRole('button', { name: '浏览工作空间', exact: true }).click()
  await page.getByText('受控目录 browser-1', { exact: true }).waitFor()
  await page.locator('#notion-connection').selectOption('browser-0')
  assert.equal(await page.getByText('受控目录 browser-1', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '浏览工作空间', exact: true }).click()
  await page.getByText('受控目录 browser-0', { exact: true }).waitFor()
  assert.deepEqual(directoryCalls, ['browser-1', 'browser-0'])
  report.checks.push('workspace-switch-clears-directory-and-uses-selected-id')
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }))
  assert.equal(stored.includes('ntn_browser_'), false)
  assert.equal((await page.locator('body').innerText()).includes('ntn_browser_'), false)
  report.checks.push('no-token-in-storage-url-or-visible-feedback')
  await page.locator('.el-message').waitFor({ state: 'hidden' })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
    await page.screenshot({ path: resolve(output, `connection-form-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = String(error.message || error)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(resolve(output, 'connections-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
