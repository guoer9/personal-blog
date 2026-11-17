// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/ui/element-plus', () => ({ installElementPlusForRoute: vi.fn(async () => {}) }))

const sourceRoot = resolve(__dirname, '..')
const readSource = (file: string) => readFileSync(resolve(sourceRoot, file), 'utf8')

describe('public blog access boundary', () => {
  it('keeps Element Plus out of the public entry and public views', () => {
    expect(readSource('main.ts')).not.toMatch(/(?:from|import)\s+['"](?:element-plus|element-plus\/dist\/index\.css|element-plus\/es\/locale)/)
    for (const file of [
      'layouts/MainLayout.vue',
      'components/navigation/SiteHeader.vue',
      'views/blog/Home.vue',
      'views/blog/Archive.vue',
      'views/blog/Search.vue',
      'views/blog/TagPosts.vue',
      'views/blog/DocumentDetail.vue',
    ]) {
      expect(readSource(file)).not.toMatch(/from ['"](?:element-plus|@element-plus\/icons-vue)/)
    }
  })

  it('keeps administrator authentication on its private route', async () => {
    setActivePinia(createPinia())
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    const { default: router } = await import('./index')
    await router.push('/admin')
    expect(router.currentRoute.value.name).toBe('AdminLogin')
  })

  it('redirects expired sessions only from private admin routes', () => {
    const request = readSource('utils/request.ts')
    expect(request.match(/startsWith\('\/admin'\)/g)).toHaveLength(2)
  })

  it('resolves the public login route outside the protected admin routes', async () => {
    const { default: router } = await import('./index')
    const route = router.resolve('/login')
    expect(route.name).toBe('Login')
    expect(route.matched.some(record => record.meta.requiresAuth)).toBe(false)
  })
})

describe('transfer route access', () => {
  it('resolves library list and detail without admin metadata', async () => {
    const { default: router } = await import('./index')
    expect(router.resolve('/documents').name).toBe('Documents')
    expect(router.resolve('/documents/a-note').name).toBe('DocumentDetail')
    expect(router.resolve('/documents/a-note').matched.some(record => record.meta.requiresAuth)).toBe(false)
  })
  it('requires a regular authenticated account, not administrator privileges', async () => {
    const { default: router } = await import('./index')
    const route = router.resolve('/transfer')
    expect(route.name).toBe('Transfer')
    expect(route.matched.some(record => record.meta.requiresAuth)).toBe(true)
    expect(route.matched.some(record => record.meta.requiresAdmin)).toBe(false)
  })

  it('sends signed-out visitors to account login and preserves the transfer destination', async () => {
    setActivePinia(createPinia())
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    const { default: router } = await import('./index')
    await router.push('/transfer')
    expect(router.currentRoute.value.name).toBe('Login')
    expect(router.currentRoute.value.query.redirect).toBe('/transfer')
  })
})

describe('canonical article route', () => {
  it('keeps old post links as redirects to the document detail route', async () => {
    setActivePinia(createPinia())
    const { default: router } = await import('./index')
    await router.push('/post/legacy-note?source=archive#discussion')
    expect(router.currentRoute.value.name).toBe('DocumentDetail')
    expect(router.currentRoute.value.fullPath).toBe('/documents/legacy-note?source=archive#discussion')
  })
})

describe('Notion publication management route', () => {
  it('keeps the sync panel in the authenticated admin area', async () => {
    const { default: router } = await import('./index')
    const route = router.resolve('/admin/notion')
    expect(route.name).toBe('AdminNotion')
    expect(route.matched.some(record => record.meta.requiresAdmin)).toBe(true)
  })
})

describe('Codex console route', () => {
  it('keeps the external console entry inside the authenticated admin area', async () => {
    const { default: router } = await import('./index')
    const route = router.resolve('/admin/codex')
    expect(route.name).toBe('AdminCodex')
    expect(route.matched.some(record => record.meta.requiresAuth)).toBe(true)
    expect(route.matched.some(record => record.meta.requiresAdmin)).toBe(true)
  })

  it('sends signed-out visitors to administrator login', async () => {
    setActivePinia(createPinia())
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    const { default: router } = await import('./index')
    await router.push('/admin/codex')
    expect(router.currentRoute.value.name).toBe('AdminLogin')
    expect(router.currentRoute.value.query.redirect).toBe('/admin/codex')
  })

  it('blocks a signed-in non-admin account', async () => {
    setActivePinia(createPinia())
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    const { useUserStore } = await import('@/stores/user')
    const userStore = useUserStore()
    userStore.$patch({
      token: 'test-session',
      userInfo: {
        id: 7,
        username: 'reader',
        email: 'reader@example.test',
        is_admin: false,
        is_active: true,
        created_at: '2026-11-17T00:00:00Z',
      },
    })
    const { default: router } = await import('./index')
    await router.push('/admin/codex')
    expect(router.currentRoute.value.name).toBe('Home')
  })

  it('allows an administrator account', async () => {
    setActivePinia(createPinia())
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    const { useUserStore } = await import('@/stores/user')
    const userStore = useUserStore()
    userStore.$patch({
      token: 'test-session',
      userInfo: {
        id: 1,
        username: 'admin',
        email: 'admin@example.test',
        is_admin: true,
        is_active: true,
        created_at: '2026-11-17T00:00:00Z',
      },
    })
    const { default: router } = await import('./index')
    await router.push('/admin/codex')
    expect(router.currentRoute.value.name).toBe('AdminCodex')
  })

  it('uses a credential-free HTTPS destination', async () => {
    const { CODEX_CONSOLE_URL } = await import('@/config/codex')
    expect(CODEX_CONSOLE_URL).toBe('https://codex.guoer9.me')
    expect(CODEX_CONSOLE_URL).not.toMatch(/[?#]/)
  })
})
