import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDocument } from './documents'

const get = vi.fn()

vi.mock('@/utils/request', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
  },
}))

describe('document detail request notifications', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ data: {} })
  })

  it('suppresses the global toast because the article page renders its own error state', async () => {
    await getDocument('round15-failure')

    expect(get).toHaveBeenCalledWith('/documents/round15-failure', {
      signal: undefined,
      suppressErrorToast: true,
    })
  })
})
