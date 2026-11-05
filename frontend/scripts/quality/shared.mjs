import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const baseURL = getBaseURL()
// The retired post URL also checks that compatibility redirects remain accessible.
export const publicPaths = ['/', '/writing', '/search', '/about', '/post/quality-check-missing-post']

function getBaseURL() {
  const url = new URL(process.env.QUALITY_BASE_URL || 'http://127.0.0.1:4173')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('QUALITY_BASE_URL must be an HTTP(S) URL without embedded credentials.')
  }
  return url.origin
}

export async function reportDirectory(tool) {
  const root = fileURLToPath(new URL('../../../output/quality/', import.meta.url))
  const directory = resolve(root, `${tool}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(directory, { recursive: true })
  return directory
}

export async function assertSiteReady() {
  for (const path of ['/', '/api/v1/posts?page_size=1']) {
    const response = await fetch(new URL(path, baseURL), { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`Site readiness check failed: ${path} returned HTTP ${response.status}.`)
    if (path.startsWith('/api/')) {
      const data = await response.json()
      if (!Array.isArray(data.items)) throw new Error('The article API did not return an items array.')
    }
  }
}

export function safeError(error) {
  let message = error instanceof Error ? error.message : String(error)
  for (const key of ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY', 'SENTRY_AUTH_TOKEN']) {
    const secret = process.env[key]
    if (secret) message = message.replaceAll(secret, '<redacted>').replaceAll(encodeURIComponent(secret), '<redacted>')
  }
  return message.replace(/caps=[^\s]+/g, 'caps=<redacted>')
}
