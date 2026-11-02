import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { assertSiteReady, baseURL, publicPaths, reportDirectory, safeError } from './shared.mjs'

let browser
try {
  await assertSiteReady()
  const directory = await reportDirectory('axe')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const summaries = []
  for (const profile of [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true },
  ]) {
    const { name, ...options } = profile
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' })
    for (const [index, path] of publicPaths.entries()) {
      const page = await context.newPage()
      try {
        const url = new URL(path, baseURL).href
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
        await page.locator('h1').first().waitFor({ state: 'visible' })
        await page.evaluate(() => document.fonts.ready)
        const result = await new AxeBuilder({ page }).analyze()
        await writeFile(resolve(directory, `${name}-${index}.json`), JSON.stringify(result, null, 2))
        const summary = {
          profile: name, path, violations: result.violations.length,
          manualReview: result.incomplete.length,
          issues: result.violations.map(({ id, impact, nodes }) => ({ id, impact, elements: nodes.length })),
        }
        summaries.push(summary)
        console.log(JSON.stringify(summary))
      } finally {
        await page.close()
      }
    }
    await context.close()
  }
  await writeFile(resolve(directory, 'summary.json'), JSON.stringify({
    baseURL, browser: browser.version(), reducedMotion: 'reduce', summaries,
  }, null, 2))
  console.log(`Reports: ${directory}`)
  if (summaries.some((result) => result.violations > 0)) process.exitCode = 1
} catch (error) {
  console.error(safeError(error))
  process.exitCode = 2
} finally {
  await browser?.close()
}
