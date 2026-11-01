// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import SiteHeader from './SiteHeader.vue'

const routes = ['/', '/writing', '/about', '/search'].map((path) => ({
  path,
  component: { template: '<div />' },
}))

describe('SiteHeader search panel', () => {
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
