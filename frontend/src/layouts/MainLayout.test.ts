// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VisualRuntime } from '@/graphics/runtime/VisualRuntime'
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
  { path: '/works', component: { template: '<div />' } },
  { path: '/transfer', component: { template: '<div />' } },
  { path: '/test-layout', component: { template: '<p>Home</p>' } },
]
const router = createRouter({ history: createMemoryHistory(), routes })

describe('MainLayout skip link', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('moves keyboard focus to the main content when activated', async () => {
    await router.push('/test-layout')
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
  it('includes the public temporary transfer link in the footer', async () => {
    await router.push('/test-layout')
    await router.isReady()
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    expect(wrapper.get('footer a[href="/transfer"]').text()).toContain('临时传输')
    wrapper.unmount()
  })

  it('owns one persistent visual canvas alongside the public layout', async () => {
    await router.push('/test-layout')
    await router.isReady()
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    expect(wrapper.findAll('canvas')).toHaveLength(1)
    expect(wrapper.get('canvas').attributes('aria-hidden')).toBe('true')
    expect(wrapper.findAll('.skip-link')).toHaveLength(1)
    expect(wrapper.findAll('footer')).toHaveLength(1)
    wrapper.unmount()
  })

  it('passes operating-system reduced-motion changes to the shared runtime', async () => {
    await router.push('/test-layout')
    await router.isReady()
    let onChange: ((event: MediaQueryListEvent) => void) | undefined
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        onChange = listener as (event: MediaQueryListEvent) => void
      }),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery)
    const setReducedMotion = vi.spyOn(VisualRuntime.prototype, 'setReducedMotion')

    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    expect(setReducedMotion).toHaveBeenCalledWith(true)

    onChange?.({ matches: false } as MediaQueryListEvent)
    expect(setReducedMotion).toHaveBeenCalledWith(false)

    wrapper.unmount()
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('coalesces scroll anchor measurements while updating scroll state immediately', async () => {
    await router.push('/test-layout')
    await router.isReady()
    const setScroll = vi.spyOn(VisualRuntime.prototype, 'setScroll')
    const measureAnchors = vi.spyOn(VisualRuntime.prototype, 'measureAnchors')
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    setScroll.mockClear()
    measureAnchors.mockClear()

    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('scroll'))

    expect(setScroll).toHaveBeenCalledTimes(2)
    expect(measureAnchors).not.toHaveBeenCalled()
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    expect(measureAnchors).toHaveBeenCalledTimes(1)
    expect(setScroll.mock.invocationCallOrder[0]).toBeLessThan(measureAnchors.mock.invocationCallOrder[0]!)
    wrapper.unmount()
  })

})
