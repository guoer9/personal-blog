import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { baseURL, safeError } from './shared.mjs'

const require = createRequire(import.meta.url)
const dependencies = ['lighthouse', 'chrome-launcher', '@axe-core/playwright', 'axe-core', 'playwright', 'browserstack-local', '@sentry/vue']
const settings = ['VITE_SENTRY_ENABLED', 'VITE_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY']

try {
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
  console.log(JSON.stringify({
    node: process.version,
    baseURL,
    dependencies: Object.fromEntries(dependencies.map((name) => {
      require.resolve(name)
      return [name, lock.packages[`node_modules/${name}`].version]
    })),
    settings: Object.fromEntries(settings.map((key) => [key, key === 'VITE_SENTRY_ENABLED' ? process.env[key] === 'true' : Boolean(process.env[key]?.trim())])),
    note: 'Package installation does not verify cloud authentication or production telemetry.',
  }, null, 2))
} catch (error) {
  console.error(safeError(error))
  process.exitCode = 1
}
