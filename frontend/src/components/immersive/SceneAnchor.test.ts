// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import SceneAnchor from './SceneAnchor.vue'
import { visualRuntimeKey } from '@/graphics/runtime/visualRuntimeHandle'

describe('SceneAnchor runtime registration', () => {
  it('registers, measures and unregisters its element with the shared runtime', async () => {
    const unregister = vi.fn()
    const runtime = { registerAnchor: vi.fn(() => unregister), measureAnchors: vi.fn() }
    const wrapper = mount(SceneAnchor, {
      props: { id: 'hero-visual' },
      global: { provide: { [visualRuntimeKey as symbol]: ref(runtime) } },
      slots: { default: '<strong>visual</strong>' },
    })
    await nextTick()

    expect(runtime.registerAnchor).toHaveBeenCalledWith('hero-visual', wrapper.element)
    expect(runtime.measureAnchors).toHaveBeenCalled()
    wrapper.unmount()
    expect(unregister).toHaveBeenCalledOnce()
  })

})
