// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TagPosts from './TagPosts.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'

const api = vi.hoisted(() => ({ getPosts: vi.fn() }))
vi.mock('@/api/posts', () => api)

describe('TagPosts scene bridge', () => {
  let wrapper: ReturnType<typeof mount> | undefined

  beforeEach(() => {
    api.getPosts.mockReset()
    api.getPosts.mockResolvedValue({ data: { items: [], total: 13 } })
  })
  afterEach(() => { wrapper?.unmount(); wrapper = undefined })

  it('publishes tag and pagination state to the shared archive module', async () => {
    const runtime = { setPageState: vi.fn(), registerAnchor: vi.fn(() => vi.fn()), measureAnchors: vi.fn() }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/tag/:slug', component: TagPosts }, { path: '/writing', component: { template: '<div />' } }] })
    await router.push('/tag/visual-notes'); await router.isReady()
    wrapper = mount(TagPosts, { attachTo: document.body, global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: ref(runtime) } } })
    await flushPromises()

    expect(runtime.setPageState).toHaveBeenLastCalledWith('archive', { mode: 'tag', query: 'visual-notes', resultCount: 13, page: 1, totalPages: 2 })
    expect(runtime.registerAnchor).toHaveBeenCalledWith('tag-results', wrapper.get('.tag-results').element)
    expect(runtime.measureAnchors).toHaveBeenCalled()
  })
})
