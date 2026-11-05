// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Archive from './Archive.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'

const api = vi.hoisted(() => ({ getPosts: vi.fn() }))
vi.mock('@/api/posts', () => api)
vi.mock('@/components/immersive/ScrollReveal.vue', () => ({ default: { template: '<div><slot /></div>' } }))

describe('Archive scene bridge', () => {
  let wrapper: ReturnType<typeof mount> | undefined

  beforeEach(() => {
    api.getPosts.mockReset()
    api.getPosts.mockResolvedValue({ data: { items: [], total: 25 } })
  })
  afterEach(() => { wrapper?.unmount(); wrapper = undefined })

  it('publishes archive totals and page count after the list request resolves', async () => {
    const runtime = { setPageState: vi.fn(), registerAnchor: vi.fn(() => vi.fn()), measureAnchors: vi.fn() }
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/writing', component: Archive },
      { path: '/post/:slug', component: { template: '<div />' } },
    ] })
    await router.push('/writing'); await router.isReady()
    wrapper = mount(Archive, { attachTo: document.body, global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: ref(runtime) } } })
    await flushPromises()

    expect(runtime.setPageState).toHaveBeenLastCalledWith('archive', { mode: 'archive', query: '', resultCount: 25, page: 1, totalPages: 3 })
    expect(runtime.registerAnchor).toHaveBeenCalledWith('archive-list', wrapper.get('.archive-body').element)
    expect(runtime.measureAnchors).toHaveBeenCalled()
  })

  it('renders archive article titles as second-level headings', async () => {
    api.getPosts.mockResolvedValue({ data: { items: [{
      id: 1,
      title: 'A field note',
      slug: 'a-field-note',
      is_published: true,
      view_count: 0,
      author: { id: 1, username: 'writer' },
      tags: [],
      created_at: '2026-11-04T00:00:00Z',
      updated_at: '2026-11-04T00:00:00Z',
    }], total: 1 } })
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/writing', component: Archive },
      { path: '/post/:slug', component: { template: '<div />' } },
    ] })
    await router.push('/writing'); await router.isReady()
    wrapper = mount(Archive, { attachTo: document.body, global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.get('.article-link h2').text()).toBe('A field note')
  })
})
