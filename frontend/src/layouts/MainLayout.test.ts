// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import MainLayout from './MainLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: MainLayout,
    children: [{ path: '', component: { template: '<p>Home</p>' } }],
  },
  { path: '/writing', component: { template: '<div />' } },
  { path: '/about', component: { template: '<div />' } },
  { path: '/search', component: { template: '<div />' } },
]
const router = createRouter({ history: createMemoryHistory(), routes })

describe('MainLayout skip link', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('moves keyboard focus to the main content when activated', async () => {
    await router.push('/')
    await router.isReady()
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    const skipLink = wrapper.get('.skip-link')
    const main = wrapper.get('#main-content')

    ;(skipLink.element as HTMLElement).focus()
    await skipLink.trigger('click')
    await nextTick()

    expect(main.attributes('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(main.element)
    expect(window.location.hash).toBe('#main-content')

    wrapper.unmount()
  })
})
