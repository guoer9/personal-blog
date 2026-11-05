// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

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

  it('keeps administrator authentication on its private route', () => {
    const router = readSource('router/index.ts')
    expect(router).toMatch(/path:\s*['"]\/admin\/login['"][\s\S]*?name:\s*['"]AdminLogin['"]/)
    expect(router).toMatch(/return next\(\{\s*name:\s*['"]AdminLogin['"]/)
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

describe('public transfer route', () => {
  it('resolves library list and detail without admin metadata', async () => {
    const { default: router } = await import('./index')
    expect(router.resolve('/documents').name).toBe('Documents')
    expect(router.resolve('/documents/a-note').name).toBe('DocumentDetail')
    expect(router.resolve('/documents/a-note').matched.some(record => record.meta.requiresAuth)).toBe(false)
  })
  it('resolves the visitor transfer page without admin authentication metadata', async () => {
    const { default: router } = await import('./index')
    const route = router.resolve('/transfer')
    expect(route.name).toBe('Transfer')
    expect(route.matched.some(record => record.meta.requiresAuth)).toBe(false)
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
