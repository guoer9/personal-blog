// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SiteHeader from './SiteHeader.vue'
import { profile } from '@/data/portfolio'
import { useUserStore } from '@/stores/user'

const routes = [
  ['/', 'Home'], ['/writing', 'Archive'], ['/about', 'About'], ['/search', 'Search'],
  ['/works', 'Works'], ['/works/:slug', 'WorkDetail'], ['/documents', 'Documents'],
  ['/documents/:slug', 'DocumentDetail'], ['/login', 'Login'], ['/transfer', 'Transfer'],
].map(([path, name]) => ({
  path: path!,
  name,
  component: { template: '<div />' },
}))

beforeEach(() => localStorage.clear())

describe('SiteHeader search panel', () => {
  it('keeps admin destinations out of public navigation even for an administrator', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const pinia = createPinia()
    const store = useUserStore(pinia)
    store.token = 'access-token'
    store.userInfo = { id: 1, username: 'admin', is_admin: true } as typeof store.userInfo
    const wrapper = mount(SiteHeader, { global: { plugins: [pinia, router] } })
    expect(wrapper.findAll('a').some((link) => link.attributes('href')?.startsWith('/admin'))).toBe(false)
    expect(wrapper.text()).not.toContain('控制台')
    wrapper.unmount()
  })

  it('shows the login link while signed out and the username after sign-in', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      ...routes,
    ] })
    await router.push('/')
    const pinia = createPinia()
    const store = useUserStore(pinia)
    const wrapper = mount(SiteHeader, { global: { plugins: [pinia, router] } })

    expect(wrapper.get('.account-link').text()).toBe('登录')
    expect(wrapper.get('.account-link').attributes('href')).toBe('/login')

    store.token = 'access-token'
    store.userInfo = { id: 7, username: 'reader7', is_admin: false } as typeof store.userInfo
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.account-link').text()).toBe('reader7')
    wrapper.unmount()
  })

  it('lets a signed-in reader log out from the public header', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const pinia = createPinia()
    const store = useUserStore(pinia)
    store.token = 'access-token'
    store.userInfo = { id: 7, username: 'reader7', is_admin: false } as typeof store.userInfo
    const wrapper = mount(SiteHeader, { global: { plugins: [pinia, router] } })

    await wrapper.get('[data-action="logout"]').trigger('click')

    expect(store.isLoggedIn).toBe(false)
    expect(wrapper.get('.account-link').text()).toBe('登录')
    wrapper.unmount()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns focus to the search trigger when Escape closes the panel', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(SiteHeader, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    const trigger = wrapper.get('.search-toggle')
    const input = wrapper.get('#header-search-input')

    await trigger.trigger('click')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(document.activeElement).toBe(input.element)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })
})

describe('SiteHeader calling-card navigation', () => {
  const mountedHeaders: Array<{ unmount: () => void }> = []

  async function mountHeader(path = '/') {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(path)
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(SiteHeader, { attachTo: document.body, global: { plugins: [pinia, router] } })
    mountedHeaders.push(wrapper)
    return { wrapper, router, store: useUserStore(pinia) }
  }

  afterEach(() => {
    mountedHeaders.splice(0).forEach((wrapper) => wrapper.unmount())
    document.body.innerHTML = ''
  })

  it.each(['/', '/works', '/about', '/documents'])('opens the same full-screen directory on %s', async (path) => {
    const { wrapper } = await mountHeader(path)
    expect(wrapper.find('.desktop-navigation').exists()).toBe(false)
    await wrapper.get('.menu-toggle').trigger('click')
    expect(wrapper.get('#mobile-navigation').isVisible()).toBe(true)
    expect(wrapper.findAll('.mobile-nav-link--primary').map(link => link.attributes('href'))).toEqual([
      '/works?type=music', '/works?type=film', '/about',
    ])
    expect(wrapper.findAll('.mobile-nav-link--secondary').map(link => link.attributes('href'))).toEqual([
      '/writing', '/works?type=code', '/transfer',
    ])
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.menu-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('keeps the home top edge to identity, account and utility controls', async () => {
    const { wrapper } = await mountHeader()

    expect(wrapper.find('.desktop-navigation').exists()).toBe(false)
    expect(wrapper.get('.brand').attributes('href')).toBe('/')
    expect(wrapper.get('.account-link').attributes('href')).toBe('/login')
    expect(wrapper.get('.header-contact').attributes('href')).toBe('/about#connect')
    expect(wrapper.find('.search-toggle').exists()).toBe(true)
    expect(wrapper.get('.menu-toggle').attributes('aria-expanded')).toBe('false')
  })

  it('opens the home route directory and closes it after choosing a destination', async () => {
    const { wrapper, router } = await mountHeader()
    const toggle = wrapper.get('.menu-toggle')

    await toggle.trigger('click')

    const directory = wrapper.get(`#${toggle.attributes('aria-controls')}`)
    expect(directory.isVisible()).toBe(true)
    expect(directory.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/works?type=music', '/works?type=film', '/about', '/about#connect', '/writing', '/works?type=code', '/transfer',
    ])

    await directory.get('a[href="/writing"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/writing')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(directory.isVisible()).toBe(false)
  })

  it('provides Contact on desktop and before secondary mobile destinations', async () => {
    const { wrapper, router } = await mountHeader()
    expect(wrapper.get('.header-contact').attributes('href')).toBe('/about#connect')
    expect(wrapper.get('.header-contact').text()).toContain('Contact')
    expect(wrapper.findAll('#mobile-navigation a').map((link) => link.attributes('href'))).toEqual([
      '/works?type=music', '/works?type=film', '/about', '/about#connect', '/writing', '/works?type=code', '/transfer',
    ])
    expect(wrapper.get('.mobile-identity').text()).toContain(profile.role)

    await wrapper.get('.menu-toggle').trigger('click')
    await wrapper.get('.mobile-contact').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/about#connect')
    expect(wrapper.get('.menu-toggle').attributes('aria-expanded')).toBe('false')
  })

  it.each([
    ['/works', '/works?type=music'], ['/works?type=music', '/works?type=music'],
    ['/works?type=film', '/works?type=film'], ['/works?type=code', '/works?type=code'],
    ['/documents/a-note', '/writing'], ['/writing', '/writing'], ['/about#connect', '/about'],
  ])('marks only the matching destination active at %s', async (path, activeTarget) => {
    const { wrapper } = await mountHeader(path)
    const activeLink = wrapper.get(`#mobile-navigation a[href="${activeTarget}"]`)
    expect(activeLink.attributes('aria-current')).toBe('page')
    expect(wrapper.findAll('#mobile-navigation a[aria-current="page"]')).toHaveLength(1)
  })

  it('does not label all works as a music-only page', async () => {
    const { wrapper } = await mountHeader('/works?type=all')
    expect(wrapper.findAll('#mobile-navigation a[aria-current="page"]')).toHaveLength(0)
  })

  it('changes the visual preview for keyboard focus and falls back after image errors', async () => {
    const { wrapper } = await mountHeader()
    await wrapper.get('.menu-toggle').trigger('click')
    const music = wrapper.get('.menu-preview img').attributes('src')
    await wrapper.get('a[href="/works?type=film"]').trigger('focus')
    expect(wrapper.get('.menu-preview img').attributes('src')).not.toBe(music)
    await wrapper.get('.menu-preview img').trigger('error')
    expect(wrapper.get('.menu-preview img').attributes('src')).toBeTruthy()
    await wrapper.get('.menu-preview img').trigger('error')
    expect(wrapper.find('.menu-preview img').exists()).toBe(false)
    expect(wrapper.get('a[href="/works?type=film"]').isVisible()).toBe(true)
  })

  it('traps keyboard focus, publishes modal state, and releases it on unmount', async () => {
    const { wrapper } = await mountHeader('/about')
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 44, height: 44 }] as unknown as DOMRectList)
    try {
      await wrapper.get('.menu-toggle').trigger('click')
      expect(document.activeElement).toBe(wrapper.get('.mobile-nav-link--primary').element)
      expect(wrapper.emitted('menu-change')?.slice(-1)[0]).toEqual([true])
      const last = wrapper.get('a[href="/transfer"]').element as HTMLAnchorElement
      last.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      expect(document.activeElement).toBe(wrapper.get('.brand').element)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
      expect(document.activeElement).toBe(last)
      wrapper.unmount()
      expect(wrapper.emitted('menu-change')?.slice(-1)[0]).toEqual([false])
    } finally { vi.restoreAllMocks() }
  })

  it('preserves the full account name and utility controls for long usernames', async () => {
    const { wrapper, store } = await mountHeader()
    const username = 'a-very-long-reader-name-用于检查窄屏账号显示'
    store.token = 'access-token'
    store.userInfo = { id: 7, username, is_admin: false } as typeof store.userInfo
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.account-link').text()).toBe(username)
    expect(wrapper.get('.account-link').attributes('title')).toBe(username)
    expect(wrapper.get('[data-action="logout"]').text()).toBe('退出')
    expect(wrapper.find('.search-toggle').exists()).toBe(true)
    expect(wrapper.find('.menu-toggle').exists()).toBe(true)
  })

  it.each([['/', '.brand'], ['/about#connect', '.header-contact']])('closes the menu for an already-current destination at %s', async (path, link) => {
    const { wrapper } = await mountHeader(path)
    await wrapper.get('.menu-toggle').trigger('click')
    await wrapper.get(link).trigger('click')
    await flushPromises()
    expect(wrapper.get('.menu-toggle').attributes('aria-expanded')).toBe('false')
    expect(wrapper.emitted('menu-change')?.slice(-1)[0]).toEqual([false])
  })

  it('keeps search and mobile navigation mutually exclusive', async () => {
    const { wrapper } = await mountHeader()
    await wrapper.get('.menu-toggle').trigger('click')
    expect(wrapper.get('.menu-toggle').attributes('aria-expanded')).toBe('true')

    await wrapper.get('.search-toggle').trigger('click')
    expect(wrapper.get('.search-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.menu-toggle').attributes('aria-expanded')).toBe('false')

    await wrapper.get('.menu-toggle').trigger('click')
    expect(wrapper.get('.search-toggle').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.menu-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('focuses search, trims the query, and closes panels after submitting', async () => {
    const { wrapper, router } = await mountHeader()
    await wrapper.get('.search-toggle').trigger('click')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(document.activeElement).toBe(wrapper.get('#header-search-input').element)

    await wrapper.get('#header-search-input').setValue('  portrait notes  ')
    await wrapper.get('#site-search').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('Search')
    expect(router.currentRoute.value.query).toEqual({ q: 'portrait notes' })
    expect(wrapper.get('.search-toggle').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.menu-toggle').attributes('aria-expanded')).toBe('false')
  })

  it('keeps an empty search open without changing the current route', async () => {
    const { wrapper, router } = await mountHeader('/works')
    await wrapper.get('.search-toggle').trigger('click')
    await wrapper.get('#header-search-input').setValue('   ')
    await wrapper.get('#site-search').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/works')
    expect(wrapper.get('.search-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('returns focus to the menu trigger when Escape closes the menu', async () => {
    const { wrapper } = await mountHeader()
    const trigger = wrapper.get('.menu-toggle')
    await trigger.trigger('click')
    const firstLink = wrapper.get('#mobile-navigation a').element as HTMLAnchorElement
    firstLink.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
  })

  it.each(['search', 'menu'])('closes the %s panel on an external route change', async (panel) => {
    const { wrapper, router } = await mountHeader()
    await wrapper.get(`.${panel}-toggle`).trigger('click')
    await router.push('/documents/a-note')
    await wrapper.vm.$nextTick()

    expect(wrapper.get(`.${panel}-toggle`).attributes('aria-expanded')).toBe('false')
  })
})
