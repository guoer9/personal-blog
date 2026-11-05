// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './Home.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'
import { homeSphereInteractionOptionsKey } from './homeInteraction'

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

  it('emits one tap with full viewport NDC when released before the injected long press duration', async () => {
    const mounted = await mountHome()
    const visual = mounted.get('.hero-visual')

    await visual.trigger('pointerdown', { pointerId: 7, button: 0, isPrimary: true, clientX: 250, clientY: 200 })
    await visual.trigger('pointerup', { pointerId: 7, clientX: 250, clientY: 200 })

    const interaction = runtime.setPageState.mock.lastCall?.[1].interaction
    expect(interaction).toMatchObject({ type: 'tap', sequence: 1, ndcX: -0.5, ndcY: 0.5 })
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

    await visual.trigger('pointerdown', { pointerId: 9, button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    await visual.trigger('pointermove', { pointerId: 9, clientX: 520, clientY: 400 })
    await visual.trigger('pointerup', { pointerId: 9, clientX: 520, clientY: 400 })

    await visual.trigger('pointerdown', { pointerId: 10, button: 0, isPrimary: true, clientX: 500, clientY: 400 })
    await visual.trigger('pointercancel', { pointerId: 10, clientX: 500, clientY: 400 })
    vi.advanceTimersByTime(100)

    const interactions = runtime.setPageState.mock.calls
      .map((call) => call[1]?.interaction)
      .filter(Boolean)
    expect(interactions).toHaveLength(0)
  })
})
