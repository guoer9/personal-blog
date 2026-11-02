import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import browserstack from 'browserstack-local'
import { assertSiteReady, baseURL, reportDirectory, safeError } from './shared.mjs'

const require = createRequire(import.meta.url)
const required = ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY']
const missing = required.filter((key) => !process.env[key]?.trim())
const checkOnly = process.argv.includes('--check')
let browser
let tunnel
let tunnelStarted = false

try {
  if (checkOnly) {
    console.log(JSON.stringify({
      mode: 'configuration-only; no cloud session started', baseURL,
      configured: required.filter((key) => !missing.includes(key)), missing,
      localTunnel: true,
    }, null, 2))
    if (missing.length) process.exitCode = 2
  } else {
    if (missing.length) throw new Error(`Set these keys in .env.local before running cloud tests: ${missing.join(', ')}`)
    await assertSiteReady()
    const directory = await reportDirectory('browserstack')
    const localIdentifier = `personal-blog-${Date.now()}-${process.pid}`
    tunnel = new browserstack.Local()
    await new Promise((resolveStart, reject) => {
      tunnel.start({ key: process.env.BROWSERSTACK_ACCESS_KEY, localIdentifier, onlyAutomate: true }, (error) => error ? reject(error) : resolveStart())
    })
    tunnelStarted = true
    const caps = {
      browser: process.env.BROWSERSTACK_BROWSER || 'playwright-chromium',
      os: process.env.BROWSERSTACK_OS || 'Windows',
      os_version: process.env.BROWSERSTACK_OS_VERSION || '11',
      project: process.env.BROWSERSTACK_PROJECT || 'Personal Blog',
      build: `local-smoke-${new Date().toISOString().slice(0, 10)}`,
      name: 'Homepage, article API and writing navigation',
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
      'browserstack.local': 'true',
      'browserstack.localIdentifier': localIdentifier,
      'client.playwrightVersion': require('playwright/package.json').version,
    }
    browser = await chromium.connect({
      wsEndpoint: `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`,
      timeout: 60000,
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(safeError(error)))
    try {
      await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60000 })
      await page.locator('h1').first().waitFor({ state: 'visible' })
      const articles = await page.request.get(new URL('/api/v1/posts?page_size=1', baseURL).href)
      assert.equal(articles.status(), 200)
      assert.ok(Array.isArray((await articles.json()).items))
      await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '文章 Writing' }).click()
      await page.waitForURL('**/writing')
      await page.locator('h1').first().waitFor({ state: 'visible' })
      assert.deepEqual(pageErrors, [])
      await page.evaluate(() => {}, `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status: 'passed', reason: 'Homepage, real API and writing navigation passed.' } })}`)
      await writeFile(resolve(directory, 'summary.json'), JSON.stringify({ baseURL, status: 'passed', browser: browser.version(), pageErrors }, null, 2))
      console.log(`Cloud smoke test passed. Reports: ${directory}`)
    } catch (error) {
      await page.evaluate(() => {}, `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status: 'failed', reason: 'Local-site smoke check failed; inspect the local report.' } })}`).catch(() => {})
      await writeFile(resolve(directory, 'summary.json'), JSON.stringify({ baseURL, status: 'failed', error: safeError(error), pageErrors }, null, 2))
      throw error
    }
  }
} catch (error) {
  console.error(safeError(error))
  process.exitCode = 2
} finally {
  await browser?.close().catch(() => {})
  if (tunnelStarted) {
    await new Promise((resolveStop) => tunnel.stop(resolveStop))
  }
}
