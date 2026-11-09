// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './Home.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'
import { createPageScroll, pageScrollKey, type PageScroll } from '@/graphics/runtime/pageScroll'
import { createHomeSphereInteractionBridge, homeSphereInteractionOptionsKey } from './homeInteraction'

const api = vi.hoisted(() => ({ getPosts: vi.fn(), getTags: vi.fn(), getWorks: vi.fn() }))
vi.mock('@/api/posts', () => ({ getPosts: api.getPosts, getArticleTags: api.getTags }))
vi.mock('@/api/tags', () => ({ getTags: api.getTags }))
vi.mock('@/api/works', () => ({ getWorks: api.getWorks }))
vi.mock('@/components/immersive/ImmersiveScene.vue', () => ({ default: { template: '<div class="immersive-scene" />' } }))
vi.mock('@/components/immersive/MagneticLink.vue', () => ({ default: { template: '<a><slot /></a>' } }))
vi.mock('@/components/immersive/ProjectCardMotion.vue', () => ({ default: { template: '<div><slot /></div>' } }))
vi.mock('@/components/immersive/ScrollReveal.vue', () => ({ default: { template: '<div><slot /></div>' } }))
vi.mock('@/components/blog/ArticleRow.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/blog/StatePanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/works/WorkCard.vue', () => ({ default: { template: '<div />' } }))

describe('Home sphere interaction bridge', () => {
  let wrapper: ReturnType<typeof mount> | undefined
  let runtime: { setPageState: ReturnType<typeof vi.fn>; setCanvasVisible: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    api.getPosts.mockResolvedValue({ data: { items: [] } })
    api.getTags.mockResolvedValue({ data: [] })
    api.getWorks.mockResolvedValue({ data: { items: [] } })
    runtime = { setPageState: vi.fn(), setCanvasVisible: vi.fn() }
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.useFakeTimers()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function mountHome(pageScroll?: PageScroll) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'Home', component: Home },
        { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
      ],
    })
    await router.push('/')
    await router.isReady()
    wrapper = mount(Home, {
      attachTo: document.body,
      global: {
        plugins: [router],
        provide: {
          ...(pageScroll ? { [pageScrollKey as symbol]: pageScroll } : {}),
          [visualRuntimeKey as symbol]: shallowRef(runtime),
          [homeSphereInteractionOptionsKey as symbol]: { longPressDurationMs: 60, allowableMovementCssPx: 8 },
        },
      },
    })
    await flushPromises()
    return wrapper
  }

  it('opens with the performance and keeps writing behind the archive entrance', async () => {
    const mounted = await mountHome()
    expect(mounted.get('#setlist h2').text()).toContain('声音')
    expect(mounted.get('.archive-door').attributes('href')).toBe('/writing')
    expect(mounted.find('.projects-section').exists()).toBe(false)
    expect(mounted.find('.artist-portrait').exists()).toBe(false)
    expect(api.getPosts).not.toHaveBeenCalled()
    expect(api.getTags).not.toHaveBeenCalled()
    expect(mounted.get('.program-empty').text()).toContain('下一段声音')
  })

  it('presents published music and films without promoting code projects', async () => {
    api.getWorks.mockResolvedValue({ data: { items: [
      { slug: 'code-only', title: 'A code project', category: 'code' },
      { slug: 'song-one', title: '现有音乐', category: 'music', audio: '/song.mp3', duration: 120 },
      { slug: 'film-one', title: '现有影像', category: 'film', duration: 90 },
    ] } })
    const mounted = await mountHome()
    expect(mounted.get('.track-list').text()).toContain('现有音乐')
    expect(mounted.get('.film-caption').text()).toContain('现有影像')
    expect(mounted.text()).not.toContain('A code project')
    expect(mounted.get('.hero-play').text()).toContain('现有音乐')
  })

  it('lets a visitor retry a failed program request', async () => {
    api.getWorks.mockRejectedValueOnce(new Error('offline'))
    const mounted = await mountHome()
    expect(mounted.get('.program-empty').text()).toContain('没有加载成功')
    await mounted.get('.program-empty button').trigger('click')
    await flushPromises()
    expect(api.getWorks).toHaveBeenCalledTimes(2)
    expect(mounted.get('.program-empty').text()).toContain('下一段声音')
  })

  it('invalidates shared geometry after layout changes without starting a second animation frame', async () => {
    let resized: (() => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe() {}
      disconnect() {}
    })
    const bus = createPageScroll()
    const mounted = await mountHome(bus)
    const track = mounted.get('.hero-track').element as HTMLElement
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ top: -400 } as DOMRect)
    bus.publish({ scrollY: 400, viewportHeight: 800, timeMs: 16 })
    expect(bus.dirty).toBe(false)
    const frame = vi.spyOn(window, 'requestAnimationFrame')
    resized?.()
    expect(bus.dirty).toBe(true)
    expect(frame).not.toHaveBeenCalled()
    bus.publish({ scrollY: 400, viewportHeight: 800, timeMs: 32 })
    expect(runtime.setPageState.mock.lastCall?.[1].portraitExitProgress).toBe(.5)
    const before = runtime.setPageState.mock.calls.length
    mounted.unmount()
    bus.publish({ scrollY: 800, viewportHeight: 800, timeMs: 48 })
    expect(runtime.setPageState.mock.calls.length).toBe(before)
    wrapper = undefined
  })

  it('runs the full scene without portrait or motion controls, ignoring old pause preferences', async () => {
    window.localStorage.setItem('field-notes:motion-paused', '1')
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
    const mounted = await mountHome()
    expect(mounted.find('.portrait-controls').exists()).toBe(false)
    expect(mounted.find('.motion-toggle').exists()).toBe(false)
    expect(runtime.setPageState.mock.lastCall?.[1]).toMatchObject({ paused: false, portraitMode: 'front' })
    expect(runtime.setCanvasVisible).toHaveBeenLastCalledWith(true)
    await mounted.get('.hero-visual').trigger('pointermove', { pointerType: 'mouse', clientX: 600, clientY: 300 })
    expect(runtime.setPageState.mock.lastCall?.[1].portraitPointerActive).toBe(true)
  })

  it('keeps the calling-card next steps and excludes touch from automatic portrait reveal', async () => {
    const mounted = await mountHome()
    expect(mounted.find('.hero-track').exists()).toBe(true)
    expect(mounted.get('.hero').element.parentElement?.classList.contains('hero-track')).toBe(true)
    expect(mounted.get('.hero-copy h1').text()).toContain('GUOER')
    expect(mounted.get('.hero-copy').attributes('data-overlay')).toBe('identity')
    expect(mounted.find('.hero-actions a[href="/about#connect"]').exists()).toBe(true)
    await mounted.get('.hero-visual').trigger('pointermove', { pointerType: 'touch', clientX: 600, clientY: 300 })
    expect(runtime.setPageState.mock.lastCall?.[1].portraitPointerActive).toBe(false)
    await mounted.get('.hero-visual').trigger('pointermove', { pointerType: 'mouse', clientX: 600, clientY: 300 })
    expect(runtime.setPageState.mock.lastCall?.[1].portraitPointerActive).toBe(true)
    await mounted.get('.hero-visual').trigger('pointerleave')
    expect(runtime.setPageState.mock.lastCall?.[1].portraitPointerActive).toBe(false)
  })

  it('publishes the full-screen hero exit progress from the sticky portrait track', async () => {
    const mounted = await mountHome()
    const track = mounted.get('.hero-track').element as HTMLElement
    Object.defineProperty(track, 'offsetHeight', { configurable: true, value: 1600 })
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ top: -400 } as DOMRect)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 400 })
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(20)
    await nextTick()
    expect(runtime.setPageState.mock.lastCall?.[1].portraitExitProgress).toBe(0.5)
    expect(mounted.get('.hero-track').attributes('style')).toContain('--hero-progress: 0.5')
    expect(runtime.setPageState.mock.lastCall?.[1].portraitExitProgress).toBe(0.5)
  })

  it('emits one tap with full viewport NDC when released before the injected long press duration', async () => {
    const mounted = await mountHome()
    const visual = mounted.get('.hero-visual')

    await visual.trigger('pointerdown', { pointerId: 7, button: 0, isPrimary: true, clientX: 250, clientY: 200 })
    await visual.trigger('pointerup', { pointerId: 7, clientX: 250, clientY: 200 })
    visual.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 250, clientY: 200 }))

    const interaction = runtime.setPageState.mock.lastCall?.[1].interaction
    expect(interaction).toMatchObject({ type: 'tap', sequence: 1, ndcX: -0.5, ndcY: 0.5 })
  })

  it('emits a ripple for a click anywhere on the page without cancelling the click', async () => {
    const mounted = await mountHome()
    const text = mounted.get('.hero-copy h1')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 400, clientY: 240 })

    text.element.dispatchEvent(click)

    const interaction = runtime.setPageState.mock.lastCall?.[1].interaction
    expect(interaction).toMatchObject({ type: 'tap' })
    expect(interaction.ndcX).toBeCloseTo(-0.2)
    expect(interaction.ndcY).toBeCloseTo(0.4)
    expect(click.defaultPrevented).toBe(false)
  })

  it('emits drag points after the pointer crosses the movement tolerance', async () => {
    const mounted = await mountHome()
    const home = mounted.get('.home')

    await home.trigger('pointerdown', { pointerId: 14, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    await home.trigger('pointermove', { pointerId: 14, pointerType: 'mouse', clientX: 520, clientY: 400 })
    await home.trigger('pointermove', { pointerId: 14, pointerType: 'mouse', clientX: 530, clientY: 410 })
    await home.trigger('pointerup', { pointerId: 14, pointerType: 'mouse', clientX: 530, clientY: 410 })

    const interactions = runtime.setPageState.mock.calls.map((call) => call[1]?.interaction).filter(Boolean)
    expect(interactions.map((interaction) => interaction.type)).toEqual(['drag', 'drag'])
  })

  it('limits repeated-click selection prevention to decorative text', async () => {
    const mounted = await mountHome()
    const text = mounted.get('h1')
    const first = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 })
    const repeated = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2 })
    text.element.dispatchEvent(first)
    text.element.dispatchEvent(repeated)
    expect(first.defaultPrevented).toBe(false)
    expect(repeated.defaultPrevented).toBe(true)
    const repeatedBodyClick = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2 })
    mounted.get('.principle-intro p').element.dispatchEvent(repeatedBodyClick)
    expect(repeatedBodyClick.defaultPrevented).toBe(false)
    expect(document.body.classList.contains('sphere-gesture-active')).toBe(false)
  })

  it('emits one ripple for label activation and preserves native activation and keyboard clicks', async () => {
    await mountHome()
    const label = document.createElement('label')
    label.htmlFor = 'sphere-search-test'
    const input = document.createElement('input')
    input.id = label.htmlFor
    const activation = vi.fn()
    input.addEventListener('click', activation)
    document.body.append(label, input)
    label.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 120, clientY: 140 }))
    const taps = () => runtime.setPageState.mock.calls.map((call) => call[1]?.interaction).filter((item) => item?.type === 'tap')
    expect(taps()).toHaveLength(1)
    expect(activation).toHaveBeenCalledOnce()
    expect((activation.mock.calls[0]?.[0] as MouseEvent).defaultPrevented).toBe(false)
    expect(taps()[0]).toMatchObject({ ndcX: -0.76, ndcY: 0.65 })
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(taps()).toHaveLength(2)
  })

  it('deduplicates label forwarding that preserves the physical click coordinates', () => {
    const emit = vi.fn()
    const bridge = createHomeSphereInteractionBridge({ options: { longPressDurationMs: 60, allowableMovementCssPx: 8 }, emit })
    const label = document.createElement('label')
    label.htmlFor = 'sphere-search-coordinate-test'
    const input = document.createElement('input')
    input.id = label.htmlFor
    document.body.append(label, input)
    // Model Chromium's event stream explicitly; Happy DOM forwards zero coordinates.
    const sourceClick = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 120, clientY: 140 })
    Object.defineProperty(sourceClick, 'target', { value: label })
    bridge.onClickCapture(sourceClick)
    const forwardedClick = new MouseEvent('click', { bubbles: true, detail: 1, clientX: 120, clientY: 140 })
    Object.defineProperty(forwardedClick, 'target', { value: input })
    bridge.onClickCapture(forwardedClick)
    expect(emit).toHaveBeenCalledTimes(1)
    bridge.dispose()
  })

  it('releases a held dent when the window loses focus', async () => {
    const mounted = await mountHome()
    await mounted.get('.hero-visual').trigger('pointerdown', { pointerId: 21, isPrimary: true, button: 0, clientX: 500, clientY: 400 })
    vi.advanceTimersByTime(60)
    window.dispatchEvent(new Event('blur'))
    const interactions = runtime.setPageState.mock.calls.map((call) => call[1]?.interaction?.type).filter(Boolean)
    expect(interactions).toEqual(['press-start', 'press-end'])
  })

  it('emits press-start and press-end once after the injected long press duration without a tap', async () => {
    const mounted = await mountHome()
    const visual = mounted.get('.hero-visual')

    await visual.trigger('pointerdown', { pointerId: 8, button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    vi.advanceTimersByTime(60)
    await nextTick()
    await visual.trigger('pointerup', { pointerId: 8, clientX: 500, clientY: 400 })

    const interactions = runtime.setPageState.mock.calls
      .map((call) => call[1]?.interaction)
      .filter(Boolean)
    expect(interactions.map((item) => item.type)).toEqual(['press-start', 'press-end'])
    expect(interactions.every((item) => item.ndcX === 0 && item.ndcY === 0)).toBe(true)
  })

  it('cancels the pending gesture after movement beyond the injected tolerance or pointercancel', async () => {
    const mounted = await mountHome()
    const visual = mounted.get('.hero-visual')

    await visual.trigger('pointerdown', { pointerId: 9, pointerType: 'touch', button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    await visual.trigger('pointermove', { pointerId: 9, pointerType: 'touch', clientX: 500, clientY: 420 })
    await visual.trigger('pointerup', { pointerId: 9, pointerType: 'touch', clientX: 500, clientY: 420 })

    await visual.trigger('pointerdown', { pointerId: 10, pointerType: 'touch', button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    await visual.trigger('pointercancel', { pointerId: 10, pointerType: 'touch', clientX: 500, clientY: 400 })
    vi.advanceTimersByTime(100)

    const interactions = runtime.setPageState.mock.calls
      .map((call) => call[1]?.interaction)
      .filter(Boolean)
    expect(interactions).toHaveLength(0)
  })

  it('suppresses the synthetic click after a long press', async () => {
    const mounted = await mountHome()
    const visual = mounted.get('.hero-visual')

    await visual.trigger('pointerdown', { pointerId: 11, button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    vi.advanceTimersByTime(60)
    await nextTick()
    await visual.trigger('pointerup', { pointerId: 11, clientX: 500, clientY: 400 })

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 500, clientY: 400 })
    visual.element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(runtime.setPageState.mock.calls.map((call) => call[1]?.interaction?.type).filter(Boolean)).toEqual(['press-start', 'press-end'])
  })

  it('tracks the pointer globally without capturing and preserves native clicks', async () => {
    const mounted = await mountHome()
    const visual = mounted.get('.hero-visual')
    const capturePointer = vi.fn()
    Object.defineProperty(visual.element, 'setPointerCapture', { configurable: true, value: capturePointer })

    await visual.trigger('pointerdown', { pointerId: 12, button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    await visual.trigger('pointerup', { pointerId: 12, clientX: 500, clientY: 400 })

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    visual.element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(capturePointer).not.toHaveBeenCalled()
    expect(runtime.setPageState.mock.calls.map((call) => call[1]?.interaction?.type).filter(Boolean)).toEqual(['tap'])
  })

  it('does not suppress a later click when a long press is cancelled by the browser', async () => {
    const mounted = await mountHome()
    const visual = mounted.get('.hero-visual')

    await visual.trigger('pointerdown', { pointerId: 13, button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    vi.advanceTimersByTime(60)
    await nextTick()
    await visual.trigger('pointercancel', { pointerId: 13, clientX: 500, clientY: 400 })

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    visual.element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })
})
