import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(scriptDir, '../dist')
const html = readFileSync(resolve(distDir, 'index.html'), 'utf8')
const scriptMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)
const styleMatch = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/)

if (!scriptMatch || !styleMatch) {
  throw new Error('Could not find the public entry script and stylesheet in dist/index.html')
}

function measure(url) {
  const file = resolve(distDir, url.replace(/^\//, ''))
  const raw = readFileSync(file)
  return { url, raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length }
}

const mainJs = measure(scriptMatch[1])
const globalCss = measure(styleMatch[1])
const budgets = { mainJsGzip: 230 * 1024, globalCssGzip: 20 * 1024 }

console.log(JSON.stringify({ mainJs, globalCss, budgets }, null, 2))

if (mainJs.gzip > budgets.mainJsGzip || globalCss.gzip > budgets.globalCssGzip) {
  process.exitCode = 1
  console.error('Bundle budget failed.')
} else {
  console.log('Bundle budget passed.')
}
