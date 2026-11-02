import type { App } from 'vue'

interface SentryEnvironment {
  MODE?: string
  VITE_SENTRY_ENABLED?: string
  VITE_SENTRY_DSN?: string
  VITE_SENTRY_ENVIRONMENT?: string
  VITE_SENTRY_RELEASE?: string
}

export async function initializeSentry(
  app: App,
  env: SentryEnvironment = import.meta.env,
): Promise<'disabled' | 'initialized' | 'failed'> {
  const dsn = env.VITE_SENTRY_DSN?.trim()
  if (env.VITE_SENTRY_ENABLED !== 'true' || !dsn) return 'disabled'

  try {
    const { init } = await import('@sentry/vue')
    init({
      app,
      dsn,
      environment: env.VITE_SENTRY_ENVIRONMENT || env.MODE || 'development',
      release: env.VITE_SENTRY_RELEASE || undefined,
      attachProps: false,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    })
    return 'initialized'
  } catch {
    console.warn('Sentry could not initialize; the site will continue without monitoring.')
    return 'failed'
  }
}
