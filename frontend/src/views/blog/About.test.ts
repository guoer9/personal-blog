// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import About from './About.vue'
import { stageAssets } from '@/data/stage'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'

const getWorks = vi.hoisted(() => vi.fn())
vi.mock('@/api/works', () => ({ getWorks }))
beforeEach(() => { getWorks.mockReset().mockResolvedValue({ data: { items: [] } }) })

describe('About page scene bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([false, true])('smoothly navigates and publishes the active section with OS reduced motion %s', async (reducedMotion) => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    vi.spyOn(preference, 'matches', 'get').mockReturnValue(reducedMotion)
    vi.spyOn(window, 'matchMedia').mockReturnValue(preference)
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/about', name: 'About', component: About }] })
    await router.push('/about'); await router.isReady()
    const runtime = { setPageState: vi.fn() }
    const wrapper = mount(About, { attachTo: document.body, global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: shallowRef(runtime) } } })
    try {
      const scrollIntoView = vi.spyOn(wrapper.get('section#practice').element, 'scrollIntoView')
      await wrapper.get('a[href="#practice"]').trigger('click')
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
      expect(runtime.setPageState).toHaveBeenLastCalledWith('about', { activeSection: 'practice' })
      expect(wrapper.findAll('section#practice')).toHaveLength(1)
    } finally { wrapper.unmount() }
  })
})


describe('About creative identity', () => {
  async function mountAbout() {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/about', component: About }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
    await router.push('/about'); await router.isReady()
    const wrapper = mount(About, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }
  afterEach(() => vi.unstubAllGlobals())

  it('presents music and actual film links before technical practice', async () => {
    getWorks.mockResolvedValue({ data: { items: [{ slug: 'film-real', title: 'A real film', category: 'film', caption: 'Film', description: '', tags: [], accent: 'paper', notes: [], cover: '/real-frame.jpg' }] } })
    const wrapper = await mountAbout()
    try {
      expect(wrapper.get('h1').text()).toContain('陈果')
      expect(wrapper.get('h1').text()).toContain('GUOER')
      expect(wrapper.find('[aria-label="陈果签名"]').exists()).toBe(true)
      expect(wrapper.find('a[href="/works?type=music"]').exists()).toBe(true)
      const film = wrapper.get('a[href="/works/film-real"]').element
      const technical = wrapper.get('section#practice').element
      expect(film.compareDocumentPosition(technical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(wrapper.get('.about-film img').attributes('src')).toBe('/real-frame.jpg')
    } finally { wrapper.unmount() }
  })

  it('keeps a complete identity and creative destinations when the film request fails', async () => {
    getWorks.mockRejectedValue(new Error('offline'))
    const wrapper = await mountAbout()
    try {
      expect(wrapper.findAll('.about-film')).toHaveLength(0)
      expect(wrapper.find('a[href="/works?type=film"]').exists()).toBe(true)
      expect(wrapper.get('.portrait img').attributes('src')).toBeTruthy()
      expect(wrapper.get('h1').text()).toContain('陈果')
    } finally { wrapper.unmount() }
  })

  it('falls back from an unavailable personal portrait without hiding the identity', async () => {
    const previous = stageAssets.artistPortrait
    stageAssets.artistPortrait = '/unavailable-portrait.jpg'
    const wrapper = await mountAbout()
    try {
      expect(wrapper.get('.portrait img').attributes('src')).toBe('/unavailable-portrait.jpg')
      await wrapper.get('.portrait img').trigger('error')
      expect(wrapper.get('.portrait img').attributes('src')).not.toBe('/unavailable-portrait.jpg')
      await wrapper.get('.portrait img').trigger('error')
      expect(wrapper.find('.portrait img').exists()).toBe(false)
      expect(wrapper.get('h1').text()).toContain('陈果')
    } finally { stageAssets.artistPortrait = previous; wrapper.unmount() }
  })
})
