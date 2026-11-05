// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import SiteHeader from './SiteHeader.vue'
import { useUserStore } from '@/stores/user'

const routes = ['/', '/writing', '/about', '/search', '/works', '/documents', '/login'].map((path) => ({
  path,
  component: { template: '<div />' },
}))

describe('SiteHeader search panel', () => {
  it('keeps admin destinations out of public navigation even for an administrator', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const pinia = createPinia()
    const store = useUserStore(pinia)
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
