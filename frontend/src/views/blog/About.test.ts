// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import About from './About.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'

describe('About page scene bridge', () => {
  it('publishes the actively navigated section while keeping navigation in the DOM', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/about', name: 'About', component: About }] })
    await router.push('/about'); await router.isReady()
    const runtime = { setPageState: vi.fn() }
    const wrapper = mount(About, { attachTo: document.body, global: { plugins: [router], provide: { [visualRuntimeKey as symbol]: shallowRef(runtime) } } })
    await wrapper.get('a[href="#practice"]').trigger('click')
    expect(runtime.setPageState).toHaveBeenLastCalledWith('about', { activeSection: 'practice' })
    expect(wrapper.findAll('section#practice')).toHaveLength(1)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
