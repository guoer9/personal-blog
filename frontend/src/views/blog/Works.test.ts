// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import Works from './Works.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'

const getWorks = vi.hoisted(() => vi.fn())
vi.mock('@/api/works', () => ({ getWorks }))
const work = { slug: 'project-a', title: 'Project A', category: 'music', caption: 'Music', description: 'Notes', tags: [], accent: 'paper', notes: [] }

describe('Works page scene bridge', () => {
  it('publishes category and result count without exposing work identity', async () => {
    getWorks.mockResolvedValue({ data: { items: [work] } })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/works', name: 'Works', component: Works }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
    await router.push('/works?type=music'); await router.isReady()
    const runtime = { setPageState: vi.fn() }
    const wrapper = mount(Works, { global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: shallowRef(runtime) } } })
    await flushPromises()
    expect(runtime.setPageState).toHaveBeenCalledWith('works', { category: 'music', itemCount: 1, focusedIndex: null })
    expect(runtime.setPageState.mock.calls.flat().join(' ')).not.toContain('project-a')
    wrapper.unmount()
  })

  it('publishes focused card state for pointer and keyboard navigation', async () => {
    getWorks.mockResolvedValue({ data: { items: [work] } })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/works', name: 'Works', component: Works }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
    await router.push('/works'); await router.isReady()
    const runtime = { setPageState: vi.fn() }
    const wrapper = mount(Works, { global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: shallowRef(runtime) } } })
    await flushPromises()

    await wrapper.get('.work-card').trigger('pointerenter')
    expect(runtime.setPageState).toHaveBeenLastCalledWith('works', { category: 'music', itemCount: 1, focusedIndex: 0 })
    await wrapper.get('.work-card').trigger('pointerleave')
    expect(runtime.setPageState).toHaveBeenLastCalledWith('works', { category: 'music', itemCount: 1, focusedIndex: null })
    await wrapper.get('.work-card').trigger('focusin')
    expect(runtime.setPageState).toHaveBeenLastCalledWith('works', { category: 'music', itemCount: 1, focusedIndex: 0 })
    await wrapper.get('.work-card').trigger('focusout', { relatedTarget: document.body })
    expect(runtime.setPageState).toHaveBeenLastCalledWith('works', { category: 'music', itemCount: 1, focusedIndex: null })
    wrapper.unmount()
  })
})


describe('Works music-first browsing', () => {
  async function mountGallery(path = '/works') {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/works', component: Works }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
    await router.push(path); await router.isReady()
    const wrapper = mount(Works, { global: { plugins: [router] } })
    await flushPromises()
    return { wrapper, router }
  }

  it('defaults to music and keeps the explicit all query reachable', async () => {
    getWorks.mockReset().mockResolvedValue({ data: { items: [work] } })
    const { wrapper, router } = await mountGallery()
    try {
      expect(getWorks).toHaveBeenLastCalledWith({ category: 'music' }, expect.any(AbortSignal))
      expect(wrapper.get('.work-filters a[aria-current="page"]').attributes('href')).toBe('/works?type=music')
      await wrapper.get('.work-filters a[href="/works?type=all"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.query.type).toBe('all')
      expect(getWorks).toHaveBeenLastCalledWith({}, expect.any(AbortSignal))
    } finally { wrapper.unmount() }
  })

  it('leads all results with music while preserving film and code access', async () => {
    getWorks.mockReset().mockResolvedValue({ data: { items: [
      { ...work, slug: 'code-a', category: 'code' }, { ...work, slug: 'film-a', category: 'film' }, work,
    ] } })
    const { wrapper } = await mountGallery('/works?type=all')
    try {
      expect(wrapper.findAll('.work-card').map(card => card.attributes('href'))).toEqual(['/works/project-a', '/works/film-a', '/works/code-a'])
      expect(wrapper.find('.work-filters a[href="/works?type=film"]').exists()).toBe(true)
      expect(wrapper.find('.work-filters a[href="/works?type=code"]').exists()).toBe(true)
    } finally { wrapper.unmount() }
  })

  it('retries failed requests and shows an honest empty state without fake works', async () => {
    getWorks.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { items: [] } })
    const { wrapper } = await mountGallery()
    try {
      expect(wrapper.findAll('.work-card')).toHaveLength(0)
      await wrapper.get('.works-state button').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.work-card')).toHaveLength(0)
      expect(wrapper.get('.works-state').text()).toContain('没有')
      expect(wrapper.find('.works-state button').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })

  it('ignores results from an aborted category request', async () => {
    let resolveMusic!: (value: unknown) => void
    getWorks.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveMusic = resolve }))
      .mockResolvedValueOnce({ data: { items: [{ ...work, slug: 'film-only', category: 'film' }] } })
    const { wrapper, router } = await mountGallery()
    try {
      const musicSignal = getWorks.mock.calls[0]![1] as AbortSignal
      await router.push('/works?type=film'); await flushPromises()
      expect(musicSignal.aborted).toBe(true)
      resolveMusic({ data: { items: [work] } }); await flushPromises()
      expect(wrapper.findAll('.work-card').map(card => card.attributes('href'))).toEqual(['/works/film-only'])
    } finally { wrapper.unmount() }
  })
})
