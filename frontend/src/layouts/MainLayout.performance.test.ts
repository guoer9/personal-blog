// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, inject } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'
import MainLayout from './MainLayout.vue'
import WorkDetail from '@/views/blog/WorkDetail.vue'
import { performanceAudioKey, type PerformanceAudio } from '@/audio/performanceAudio'
import type { Work } from '@/data/works'

const works = vi.hoisted(() => {
  const common = { caption: '', description: '', tags: [], notes: [], accent: 'lime' }
  return [
    { ...common, slug: 'video-song', title: 'Video song', category: 'music', video: '/song.mp4' },
    { ...common, slug: 'unavailable-song', title: 'Unavailable song', category: 'music' },
    { ...common, slug: 'film', title: 'Film', category: 'film', video: '/film.mp4' },
  ]
})
vi.mock('@/api/works', () => ({
  getWork: vi.fn(async (slug: string) => ({ data: works.find(work => work.slug === slug) })),
  getWorks: vi.fn(async () => ({ data: { items: [] } })),
}))
vi.mock('three', async load => ({ ...await load<typeof import('three')>(), WebGLRenderer: class { constructor() { throw new Error('WebGL unavailable') } } }))
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

async function open(slug: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'Home', component: { template: '<p>Home</p>' } },
    { path: '/works/:slug', name: 'WorkDetail', component: WorkDetail },
  ] })
  await router.push(`/works/${slug}`)
  await router.isReady()
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  let audio!: PerformanceAudio
  const header = defineComponent({ setup() { audio = inject(performanceAudioKey)!; return () => null } })
  const wrapper = mount(MainLayout, { global: { plugins: [router], stubs: { SiteHeader: header } } })
  await flushPromises()
  return { wrapper, router, audio }
}

it.each(['video-song', 'unavailable-song'])('keeps the fallback music stage independent of audio selection: %s', async slug => {
  const { wrapper, audio } = await open(slug)
  try {
    expect(audio.state.value.work).toBeNull()
    expect(wrapper.get('canvas').attributes('data-runtime-failed')).toBe('true')
    expect(wrapper.find('.work-detail--music').exists()).toBe(true)
    expect(wrapper.find('.stage-fallback').exists()).toBe(true)
  } finally { wrapper.unmount() }
})

it('removes the fallback music stage when navigating to a film despite retained audio selection', async () => {
  const { wrapper, router, audio } = await open('video-song')
  try {
    audio.select({ ...works[0], audio: '/song.mp3' } as Work)
    await router.push('/works/film')
    await flushPromises()
    expect(wrapper.find('video').exists()).toBe(true)
    expect(wrapper.find('.stage-fallback').exists()).toBe(false)
  } finally { wrapper.unmount() }
})
