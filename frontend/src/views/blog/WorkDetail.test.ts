// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import WorkDetail from './WorkDetail.vue'
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
    const audio = wrapper.get('audio').element as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 25 })
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 })
    await wrapper.get('audio').trigger('play')
    expect(runtime.setPageState).toHaveBeenLastCalledWith('work-detail', { category: 'music', hasMedia: true, playing: true, playbackProgress: 0.25 })
    await wrapper.get('audio').trigger('pause')
    expect(runtime.setPageState).toHaveBeenLastCalledWith('work-detail', { category: 'music', hasMedia: true, playing: false, playbackProgress: 0.25 })
    wrapper.unmount()
  })
})
