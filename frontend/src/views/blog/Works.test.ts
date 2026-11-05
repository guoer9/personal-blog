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
    expect(runtime.setPageState).toHaveBeenLastCalledWith('works', { category: 'all', itemCount: 1, focusedIndex: 0 })
    await wrapper.get('.work-card').trigger('pointerleave')
    expect(runtime.setPageState).toHaveBeenLastCalledWith('works', { category: 'all', itemCount: 1, focusedIndex: null })
    await wrapper.get('.work-card').trigger('focusin')
    expect(runtime.setPageState).toHaveBeenLastCalledWith('works', { category: 'all', itemCount: 1, focusedIndex: 0 })
    await wrapper.get('.work-card').trigger('focusout', { relatedTarget: document.body })
    expect(runtime.setPageState).toHaveBeenLastCalledWith('works', { category: 'all', itemCount: 1, focusedIndex: null })
    wrapper.unmount()
  })
})
