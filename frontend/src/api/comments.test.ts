// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getComments } from './comments'

const get = vi.fn()

vi.mock('@/utils/request', () => ({
  default: { get: (...args: unknown[]) => get(...args) },
}))

describe('comment request notifications', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ data: [] })
  })

  it('leaves comment-loading errors to the inline discussion alert', async () => {
    await getComments(101)

    expect(get).toHaveBeenCalledWith('/comments/post/101', {
      suppressErrorToast: true,
    })
  })
})
