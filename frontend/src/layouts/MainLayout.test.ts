// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Lenis from 'lenis'
import * as THREE from 'three'
import { defineComponent, inject, nextTick } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VisualRuntime } from '@/graphics/runtime/VisualRuntime'
import { pageScrollKey, type PageScroll } from '@/graphics/runtime/pageScroll'
import { performanceAudioKey, type PerformanceAudio } from '@/audio/performanceAudio'
import type { Work } from '@/data/works'
import MainLayout from './MainLayout.vue'

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  return { ...actual, WebGLRenderer: vi.fn(actual.WebGLRenderer) }
})

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

  it('aligns Contact once against its CSS scroll margin after anchor navigation', async () => {
    await router.push('/test-layout')
    await router.isReady()
    const scrollTo = vi.spyOn(Lenis.prototype, 'scrollTo')
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    const driver = scrollTo.mock.contexts[0] as Lenis
    const target = document.createElement('section')
    target.id = 'connect'
    target.style.scrollMarginTop = '92px'
    const link = document.createElement('a')
    link.href = '#connect'
    document.body.append(target, link)
    vi.spyOn(driver, 'limit', 'get').mockReturnValue(6000)
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 4000 - driver.animatedScroll, 600, 200))
    let browserY = 0
    vi.spyOn(driver, 'actualScroll', 'get').mockImplementation(() => browserY)
    const browserScroll = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
      browserY = (options as ScrollToOptions).top ?? browserY
    })
    try {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      vi.spyOn(click, 'composedPath').mockReturnValue([link])
      window.dispatchEvent(click)
      for (let frame = 0; frame <= 180; frame++) driver.raf(frame * 16)
      expect(driver.animatedScroll).toBeCloseTo(3908, 0)
      expect(target.getBoundingClientRect().top).toBeCloseTo(92, 0)
      expect(browserScroll).toHaveBeenCalledWith({ top: 3908, behavior: 'instant' })
    } finally { wrapper.unmount(); target.remove(); link.remove() }
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

  it('makes covered content inert only while the navigation menu is open', async () => {
    await router.push('/test-layout')
    await router.isReady()
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    const background = ['#main-content', 'footer', '.skip-link']
    try {
      await wrapper.get('.menu-toggle').trigger('click')
      await nextTick()
      for (const selector of background) expect(wrapper.get(selector).attributes('inert')).toBeDefined()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await nextTick()
      for (const selector of background) expect(wrapper.get(selector).attributes('inert')).toBeUndefined()
      await wrapper.get('.menu-toggle').trigger('click')
      await wrapper.get('.search-toggle').trigger('click')
      await nextTick()
      for (const selector of background) expect(wrapper.get(selector).attributes('inert')).toBeUndefined()
    } finally { wrapper.unmount() }
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

  it('keeps the shared runtime animating despite operating-system reduced-motion preferences', async () => {
    const motionRouter = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/test-layout', name: 'About', component: { template: '<p>About</p>' } }, ...routes],
    })
    await motionRouter.push('/test-layout')
    await motionRouter.isReady()
    const mediaQuery = Object.assign(new EventTarget(), {
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery)
    // Keep the runtime and scene real; happy-dom cannot create a WebGL context.
    vi.mocked(THREE.WebGLRenderer).mockImplementationOnce(function (options) {
      return {
        domElement: options?.canvas,
        setClearColor: vi.fn(), setPixelRatio: vi.fn(), setSize: vi.fn(),
        render: vi.fn(), dispose: vi.fn(),
      } as unknown as THREE.WebGLRenderer
    })
    const start = vi.spyOn(VisualRuntime.prototype, 'start')

    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), motionRouter] },
    })
    try {
      await flushPromises()
      const runtime = start.mock.contexts[0] as VisualRuntime
      const expectFullMotion = () => {
        expect(runtime.getVisualState().reducedMotion).toBe(false)
        expect(runtime.getDiagnostics()).toMatchObject({ activePageId: 'about', rendererCount: 1, rafActive: true, fallback: false })
        expect((wrapper.get('canvas').element as HTMLCanvasElement).style.display).not.toBe('none')
      }
      expectFullMotion()
      for (const matches of [false, true]) {
        mediaQuery.matches = matches
        mediaQuery.dispatchEvent(Object.assign(new Event('change'), { matches }))
        await flushPromises()
        expectFullMotion()
      }
    } finally { wrapper.unmount() }
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

  it('publishes layout invalidation on the shared frame without requiring a scroll event', async () => {
    await router.push('/test-layout')
    await router.isReady()
    const queued = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { queued.set(++frameId, callback); return frameId })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { queued.delete(id) })
    let bus!: PageScroll
    const measure = vi.spyOn(VisualRuntime.prototype, 'measureAnchors')
    const wrapper = mount(MainLayout, {
      global: {
        plugins: [createPinia(), router],
        stubs: { SiteHeader: defineComponent({ setup() { bus = inject(pageScrollKey)!; return () => null } }) },
      },
    })
    const runFrame = (time: number) => {
      const pending = [...queued.entries()]
      for (const [id, callback] of pending) { queued.delete(id); callback(time) }
    }
    try {
      await flushPromises()
      runFrame(16)
      measure.mockClear()
      const listener = vi.fn()
      bus.subscribe(listener)
      runFrame(32)
      expect(listener).not.toHaveBeenCalled()
      bus.invalidate()
      bus.invalidate()
      runFrame(48)
      expect(listener).toHaveBeenCalledExactlyOnceWith({ scrollY: window.scrollY, viewportHeight: window.innerHeight, timeMs: 48 })
      expect(measure).toHaveBeenCalledOnce()
      runFrame(64)
      expect(listener).toHaveBeenCalledOnce()
    } finally { wrapper.unmount() }
  })

  it('samples shared audio on the existing frame and pauses only when leaving its music routes', async () => {
    const audioRouter = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', name: 'Home', component: { template: '<p>Home</p>' } },
      { path: '/works', name: 'Works', component: { template: '<p>Works</p>' } },
      { path: '/works/:slug', name: 'WorkDetail', component: { template: '<p>Track</p>' } },
      { path: '/about', name: 'About', component: { template: '<p>About</p>' } },
    ] })
    await audioRouter.push('/')
    await audioRouter.isReady()
    const queued = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { queued.set(++frameId, callback); return frameId })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { queued.delete(id) })
    let audio!: PerformanceAudio
    const wrapper = mount(MainLayout, { global: {
      plugins: [createPinia(), audioRouter],
      stubs: { SiteHeader: defineComponent({ setup() { audio = inject(performanceAudioKey)!; return () => null } }) },
    } })
    const tick = vi.spyOn(audio, 'tick')
    const pause = vi.spyOn(audio, 'pause')
    const dispose = vi.spyOn(audio, 'dispose')
    try {
      await flushPromises()
      for (const [id, callback] of [...queued.entries()]) { queued.delete(id); callback(32) }
      expect(tick).toHaveBeenCalledExactlyOnceWith(32)
      audio.select({ slug: 'song', category: 'music', audio: '/song.mp3' } as Work)
      for (const path of ['/works?type=music', '/works/song', '/']) {
        audio.state.value.playing = true
        pause.mockClear()
        await audioRouter.push(path)
        expect(pause).not.toHaveBeenCalled()
        expect(audio.state.value.playing).toBe(true)
      }
      for (const path of ['/works?type=film', '/works/another-song', '/about']) {
        audio.state.value.playing = true
        pause.mockClear()
        await audioRouter.push(path)
        expect(pause).toHaveBeenCalledOnce()
        expect(audio.state.value.playing).toBe(false)
        expect(wrapper.classes()).not.toContain('main-layout--performance')
      }
    } finally { wrapper.unmount() }
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not feed vertical touch scrolling into the shared scene pointer', async () => {
    await router.push('/test-layout')
    await router.isReady()
    const setPointer = vi.spyOn(VisualRuntime.prototype, 'setPointer')
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    setPointer.mockClear()

    window.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 100,
    }))
    window.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 103, clientY: 130,
    }))
    window.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 160, clientY: 135,
    }))

    wrapper.unmount()
    expect(setPointer).not.toHaveBeenCalled()
  })

  it.each(['pointerup', 'pointercancel'])('tracks deliberate horizontal touch drags until %s', async (endEvent) => {
    await router.push('/test-layout')
    await router.isReady()
    const setPointer = vi.spyOn(VisualRuntime.prototype, 'setPointer')
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    setPointer.mockClear()
    const touch = { pointerId: 7, pointerType: 'touch', isPrimary: true }

    window.dispatchEvent(new PointerEvent('pointerdown', { ...touch, clientX: 100, clientY: 100 }))
    window.dispatchEvent(new PointerEvent('pointermove', { ...touch, clientX: 105, clientY: 103 }))
    const callsBeforeDrag = setPointer.mock.calls.length
    window.dispatchEvent(new PointerEvent('pointermove', { ...touch, clientX: 140, clientY: 103 }))
    window.dispatchEvent(new PointerEvent(endEvent, touch))
    window.dispatchEvent(new PointerEvent('pointermove', { ...touch, clientX: 170, clientY: 103 }))

    wrapper.unmount()
    expect(callsBeforeDrag).toBe(0)
    expect(setPointer).toHaveBeenCalledExactlyOnceWith(140 / window.innerWidth * 2 - 1, -(103 / window.innerHeight * 2 - 1), 140, 103)
  })

  it.each(['mouse', 'pen'])('preserves immediate %s pointer movement', async (pointerType) => {
    await router.push('/test-layout')
    await router.isReady()
    const setPointer = vi.spyOn(VisualRuntime.prototype, 'setPointer')
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    setPointer.mockClear()

    window.dispatchEvent(new PointerEvent('pointermove', { pointerType, clientX: 140, clientY: 103 }))

    wrapper.unmount()
    expect(setPointer).toHaveBeenCalledExactlyOnceWith(140 / window.innerWidth * 2 - 1, -(103 / window.innerHeight * 2 - 1), 140, 103)
  })

  it('cancels touch pointer tracking when a second finger starts a native gesture', async () => {
    await router.push('/test-layout')
    await router.isReady()
    const setPointer = vi.spyOn(VisualRuntime.prototype, 'setPointer')
    const wrapper = mount(MainLayout, {
      attachTo: document.body,
      global: { plugins: [createPinia(), router] },
    })
    setPointer.mockClear()
    const touch = { pointerId: 7, pointerType: 'touch', isPrimary: true }

    window.dispatchEvent(new PointerEvent('pointerdown', { ...touch, clientX: 100, clientY: 100 }))
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, pointerType: 'touch', isPrimary: false, clientX: 150, clientY: 100 }))
    window.dispatchEvent(new PointerEvent('pointermove', { ...touch, clientX: 140, clientY: 103 }))

    wrapper.unmount()
    expect(setPointer).not.toHaveBeenCalled()
  })
})
