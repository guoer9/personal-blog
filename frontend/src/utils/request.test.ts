// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosAdapter } from 'axios'
import request from './request'

const messageError = vi.fn()

vi.mock('@/ui/feedback', () => ({
  showError: (...args: unknown[]) => messageError(...args),
}))

vi.mock('@/stores/user', () => ({
  useUserStore: () => ({
    token: '',
    refreshToken: '',
    logout: vi.fn(),
  }),
}))

vi.mock('@/router', () => ({
  default: {
    currentRoute: { value: { path: '/' } },
    push: vi.fn(),
  },
}))

function adapterFor(status: number): AxiosAdapter {
  return (config) =>
    Promise.reject({
      response: {
        status,
        data: { detail: 'request failed' },
      },
      config,
    })
}

describe('request error notifications', () => {
  beforeEach(() => {
    messageError.mockReset()
  })

  it('keeps the global error toast for ordinary requests', async () => {
    await expect(request.get('/posts', { adapter: adapterFor(503) })).rejects.toMatchObject({
      response: { status: 503 },
    })
    expect(messageError).toHaveBeenCalledWith('request failed')
  })

  it('does not globally repeat an error already rendered inline in search', async () => {
    await expect(
      request.get('/posts/search', { adapter: adapterFor(503), suppressErrorToast: true })
    ).rejects.toMatchObject({
      response: { status: 503 },
    })
    expect(messageError).not.toHaveBeenCalled()
  })
})

