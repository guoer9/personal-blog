// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

const use = vi.fn()
const component = vi.fn()
const installed = { name: 'ElementPlus' }

vi.mock('element-plus', () => ({
  default: installed,
}))
vi.mock('element-plus/dist/index.css', () => ({}))
vi.mock('element-plus/es/locale/lang/zh-cn', () => ({ default: { name: 'zh-cn' } }))
vi.mock('@element-plus/icons-vue', () => ({
  ArrowLeft: { name: 'ArrowLeft' },
  ChatDotRound: { name: 'ChatDotRound' },
  DataBoard: { name: 'DataBoard' },
  Document: { name: 'Document' },
  FolderOpened: { name: 'FolderOpened' },
  Plus: { name: 'Plus' },
  PriceTag: { name: 'PriceTag' },
  Upload: { name: 'Upload' },
  View: { name: 'View' },
}))

function appStub() {
  return { use, component } as unknown as ReturnType<typeof createApp>
}

describe('Element Plus route installer', () => {
  beforeEach(() => {
    vi.resetModules()
    use.mockReset()
    component.mockReset()
  })

  it('installs once when concurrent callers share the same promise', async () => {
    const { bindElementPlusApp, installElementPlus } = await import('./element-plus')
    const app = appStub()
    bindElementPlusApp(app)

    await Promise.all([installElementPlus(), installElementPlus()])

    expect(use).toHaveBeenCalledTimes(1)
    expect(component).toHaveBeenCalledTimes(9)
  })

  it('loads Element Plus only for protected or registration routes', async () => {
    const { bindElementPlusApp, installElementPlusForRoute } = await import('./element-plus')
    bindElementPlusApp(appStub())

    await Promise.all([
      installElementPlusForRoute('/'),
      installElementPlusForRoute('/writing'),
      installElementPlusForRoute('/post/fixture'),
    ])
    expect(use).not.toHaveBeenCalled()

    await installElementPlusForRoute('/admin')
    await installElementPlusForRoute('/admin/login')
    await installElementPlusForRoute('/login')
    await installElementPlusForRoute('/register')
    expect(use).toHaveBeenCalledTimes(1)
  })
})
