// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import WorkDetail from './WorkDetail.vue'
import WorkPlayer from '@/components/works/WorkPlayer.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'

const api = vi.hoisted(() => ({ getWork: vi.fn(), getWorks: vi.fn() }))
vi.mock('@/api/works', () => api)
const work = { slug: 'private-slug', title: 'Untitled', category: 'film', caption: 'Film', description: 'Details', tags: [], accent: 'paper', notes: [], video: '/movie.mp4' }

describe('WorkDetail page scene bridge', () => {
  it('publishes explicit category and media state without publishing slug', async () => {
    api.getWork.mockResolvedValue({ data: work })
    api.getWorks.mockResolvedValue({ data: { items: [] } })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/works', component: { template: '<div />' } }, { path: '/works/:slug', name: 'WorkDetail', component: WorkDetail }] })
    await router.push('/works/private-slug'); await router.isReady()
    const runtime = { setPageState: vi.fn() }
    const wrapper = mount(WorkDetail, { global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: shallowRef(runtime) } } })
    await flushPromises()
    expect(runtime.setPageState).toHaveBeenCalledWith('work-detail', { category: 'film', hasMedia: true, playing: false, playbackProgress: 0 })
    expect(JSON.stringify(runtime.setPageState.mock.calls)).not.toContain('private-slug')
    wrapper.unmount()
  })

  it('publishes neutral state while a reused detail view loads a new slug', async () => {
    api.getWork.mockReset()
    api.getWorks.mockResolvedValue({ data: { items: [] } })
    api.getWork
      .mockResolvedValueOnce({ data: work })
      .mockRejectedValueOnce({ response: { status: 404 } })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/works', component: { template: '<div />' } }, { path: '/works/:slug', name: 'WorkDetail', component: WorkDetail }] })
    await router.push('/works/first'); await router.isReady()
    const runtime = { setPageState: vi.fn() }
    const wrapper = mount(WorkDetail, { global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: shallowRef(runtime) } } })
    await flushPromises()
    runtime.setPageState.mockClear()

    await router.push('/works/second')
    await flushPromises()
    expect(runtime.setPageState).toHaveBeenLastCalledWith('work-detail', { category: null, hasMedia: false, playing: false, playbackProgress: 0 })
    wrapper.unmount()
  })

  it('forwards playback events from the player to the scene bridge', async () => {
    api.getWork.mockReset().mockResolvedValue({ data: { ...work, category: 'music', audio: '/audio.mp3', video: undefined } })
    api.getWorks.mockResolvedValue({ data: { items: [] } })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/works/:slug', name: 'WorkDetail', component: WorkDetail }] })
    await router.push('/works/music'); await router.isReady()
    const runtime = { setPageState: vi.fn() }
    const wrapper = mount(WorkDetail, { global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: shallowRef(runtime) } } })
    await flushPromises()
    wrapper.getComponent(WorkPlayer).vm.$emit('playback', { playing: true, playbackProgress: 0.25 })
    expect(runtime.setPageState).toHaveBeenLastCalledWith('work-detail', { category: 'music', hasMedia: true, playing: true, playbackProgress: 0.25 })
    wrapper.getComponent(WorkPlayer).vm.$emit('playback', { playing: false, playbackProgress: 0.25 })
    expect(runtime.setPageState).toHaveBeenLastCalledWith('work-detail', { category: 'music', hasMedia: true, playing: false, playbackProgress: 0.25 })
    wrapper.unmount()
  })
})


describe('Work detail category presentation', () => {
  async function mountDetail() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/works', component: { template: '<div />' } }, { path: '/works/:slug', component: WorkDetail }] })
    await router.push('/works/test-work'); await router.isReady()
    const wrapper = mount(WorkDetail, { global: { plugins: [router] } })
    await flushPromises()
    return { wrapper, router }
  }

  it('keeps unplayable music honest and returns to the music filter', async () => {
    api.getWork.mockReset().mockResolvedValue({ data: { ...work, category: 'music', video: undefined, cover: '/music-cover.jpg' } })
    api.getWorks.mockResolvedValue({ data: { items: [] } })
    const { wrapper } = await mountDetail()
    try {
      expect(wrapper.get('.back-link').attributes('href')).toBe('/works?type=music')
      expect(wrapper.findComponent(WorkPlayer).exists()).toBe(false)
      expect(wrapper.find('.repository-feature').exists()).toBe(false)
      expect(wrapper.find('.media-unavailable[role="status"]').exists()).toBe(true)
      expect(wrapper.get('.detail-artwork img').attributes('src')).toBe('/music-cover.jpg')
    } finally { wrapper.unmount() }
  })

  it('keeps film playback and repository actions in their own categories', async () => {
    api.getWork.mockReset().mockResolvedValueOnce({ data: work }).mockResolvedValueOnce({ data: { ...work, slug: 'code-work', category: 'code', video: undefined, repository: 'https://github.com/guoer9/example' } })
    api.getWorks.mockResolvedValue({ data: { items: [] } })
    const { wrapper, router } = await mountDetail()
    try {
      expect(wrapper.findComponent(WorkPlayer).exists()).toBe(true)
      expect(wrapper.get('.back-link').attributes('href')).toBe('/works?type=film')
      await router.push('/works/code-work'); await flushPromises()
      expect(wrapper.findComponent(WorkPlayer).exists()).toBe(false)
      expect(wrapper.get('.repository-feature a').attributes('href')).toBe('https://github.com/guoer9/example')
      expect(wrapper.get('.back-link').attributes('href')).toBe('/works?type=code')
    } finally { wrapper.unmount() }
  })

  it('preserves the main work when related works fail, and retries detail failures', async () => {
    api.getWork.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: work })
    api.getWorks.mockRejectedValue(new Error('related offline'))
    const { wrapper } = await mountDetail()
    try {
      await wrapper.get('.missing-work button').trigger('click'); await flushPromises()
      expect(wrapper.get('h1').text()).toBe('Untitled')
      expect(wrapper.findComponent(WorkPlayer).exists()).toBe(true)
    } finally { wrapper.unmount() }
  })
})
