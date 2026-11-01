// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const installElementPlus = vi.fn()
const error = vi.fn()

vi.mock('./element-plus', () => ({
  installElementPlus,
  getElementPlusApp: vi.fn(() => ({ use: vi.fn() })),
}))
vi.mock('element-plus', () => ({
  ElMessage: { error },
  ElMessageBox: { confirm: vi.fn() },
}))

describe('feedback bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    installElementPlus.mockReset()
    error.mockReset()
  })

  it('shares one installer across concurrent error notifications', async () => {
    installElementPlus.mockResolvedValue(undefined)
    const { showError } = await import('./feedback')

    await Promise.all([showError('first'), showError('second')])

    expect(installElementPlus).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenNthCalledWith(1, 'first')
    expect(error).toHaveBeenNthCalledWith(2, 'second')
  })
})
