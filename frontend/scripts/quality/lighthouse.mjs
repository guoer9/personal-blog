import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import { launch } from 'chrome-launcher'
import { assertSiteReady, baseURL, reportDirectory, safeError } from './shared.mjs'

let chrome
try {
  const profile = process.argv[2] || 'mobile'
  if (!['desktop', 'mobile'].includes(profile)) throw new Error('Choose lighthouse profile: desktop or mobile.')
  await assertSiteReady()
  const directory = await reportDirectory(`lighthouse-${profile}`)
  chrome = await launch({ chromeFlags: ['--headless=new', '--disable-background-networking'] })
  const result = await lighthouse(baseURL, {
    port: chrome.port,
    output: ['html', 'json'],
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  }, profile === 'desktop' ? desktopConfig : undefined)
  if (!result) throw new Error('Lighthouse returned no result.')
  await writeFile(resolve(directory, 'report.html'), result.report[0])
  await writeFile(resolve(directory, 'report.json'), result.report[1])
  console.log(JSON.stringify({
    url: result.lhr.finalDisplayedUrl,
    profile,
    scores: Object.fromEntries(Object.entries(result.lhr.categories).map(([key, category]) => [key, category.score == null ? null : Math.round(category.score * 100)])),
    warnings: result.lhr.runWarnings,
    runtimeError: result.lhr.runtimeError,
    reports: directory,
  }, null, 2))
  if (result.lhr.runtimeError) process.exitCode = 1
} catch (error) {
  console.error(safeError(error))
  process.exitCode = 2
} finally {
  await chrome?.kill()
}
