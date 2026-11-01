import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPost } from './posts'

const get = vi.fn()

vi.mock('@/utils/request', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
  },
}))

describe('post detail request notifications', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ data: {} })
  })

  it('suppresses the global toast because the article page renders its own error state', async () => {
    await getPost('round15-failure')

    expect(get).toHaveBeenCalledWith('/posts/round15-failure', {
      suppressErrorToast: true,
    })
  })
})
