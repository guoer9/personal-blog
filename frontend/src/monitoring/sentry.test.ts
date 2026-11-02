import { createApp } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeSentry } from './sentry'

const { init, imported } = vi.hoisted(() => ({ init: vi.fn(), imported: vi.fn() }))

vi.mock('@sentry/vue', () => {
  imported()
  return { init }
})

describe('optional Sentry monitoring', () => {
  beforeEach(() => {
    init.mockReset()
    imported.mockClear()
  })

  it('does not load or initialize the SDK unless explicitly enabled', async () => {
    const result = await initializeSentry(createApp({}), {
      VITE_SENTRY_DSN: 'https://public@example.com/1',
    })

    expect(result).toBe('disabled')
    expect(imported).not.toHaveBeenCalled()
    expect(init).not.toHaveBeenCalled()
  })

  it('remains disabled when the DSN is missing or blank', async () => {
    for (const dsn of [undefined, '', '   ']) {
      await expect(initializeSentry(createApp({}), {
        VITE_SENTRY_ENABLED: 'true',
        VITE_SENTRY_DSN: dsn,
      })).resolves.toBe('disabled')
    }
    expect(init).not.toHaveBeenCalled()
  })

  it('initializes Vue error reporting without tracing or replay', async () => {
    const app = createApp({})
    await expect(initializeSentry(app, {
      MODE: 'test',
      VITE_SENTRY_ENABLED: 'true',
      VITE_SENTRY_DSN: 'https://public@example.com/1',
      VITE_SENTRY_ENVIRONMENT: 'production',
      VITE_SENTRY_RELEASE: 'blog@1.2.0',
    })).resolves.toBe('initialized')

    expect(init).toHaveBeenCalledWith(expect.objectContaining({
      app,
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'blog@1.2.0',
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
    }))
    expect(init.mock.calls[0]?.[0].integrations).toBeUndefined()
    expect(init.mock.calls[0]?.[0].tracesSampleRate).toBeUndefined()
  })

  it('lets startup continue when monitoring cannot initialize', async () => {
    init.mockImplementationOnce(() => { throw new Error('invalid monitoring configuration') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await expect(initializeSentry(createApp({}), {
        VITE_SENTRY_ENABLED: 'true',
        VITE_SENTRY_DSN: 'https://public@example.com/1',
      })).resolves.toBe('failed')
      expect(warn).toHaveBeenCalledWith('Sentry could not initialize; the site will continue without monitoring.')
    } finally {
      warn.mockRestore()
    }
  })
})
