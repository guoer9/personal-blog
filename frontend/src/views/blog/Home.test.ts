// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './Home.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'
import { createHomeSphereInteractionBridge, homeSphereInteractionOptionsKey } from './homeInteraction'

const api = vi.hoisted(() => ({ getPosts: vi.fn(), getTags: vi.fn(), getWorks: vi.fn() }))
vi.mock('@/api/posts', () => ({ getPosts: api.getPosts }))
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
  let runtime: { setPageState: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    api.getPosts.mockResolvedValue({ data: { items: [] } })
    api.getTags.mockResolvedValue({ data: [] })
    api.getWorks.mockResolvedValue({ data: { items: [] } })
    runtime = { setPageState: vi.fn() }
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

  async function mountHome() {
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
          [visualRuntimeKey as symbol]: shallowRef(runtime),
          [homeSphereInteractionOptionsKey as symbol]: { longPressDurationMs: 60, allowableMovementCssPx: 8 },
        },
      },
    })
    await flushPromises()
    return wrapper
  }

  it('keeps the project backdrop independent from the content layer', async () => {
    const mounted = await mountHome()
    expect(mounted.get('.projects-section__backdrop').attributes('aria-hidden')).toBe('true')
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
    for (const selector of ['.hero-intro', '.principle-intro p']) {
      const repeatedBodyClick = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2 })
      mounted.get(selector).element.dispatchEvent(repeatedBodyClick)
      expect(repeatedBodyClick.defaultPrevented).toBe(false)
    }
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
