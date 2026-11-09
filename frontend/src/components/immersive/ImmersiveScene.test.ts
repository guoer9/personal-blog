// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ImmersiveScene from './ImmersiveScene.vue'

describe('portrait semantic and static fallback', () => {
  let wrapper: ReturnType<typeof mount> | undefined
  afterEach(() => { wrapper?.unmount(); document.body.innerHTML = '' })

  it('shows an accurately described demo while the shared renderer is unavailable', () => {
    wrapper = mount(ImmersiveScene, { props: { mode: 'front' }, attachTo: document.body })
    expect(wrapper.get('img').attributes('src')).toBe('/portraits/front/preview.png')
    expect(wrapper.get('img').attributes('alt')).toContain('演示')
    expect(wrapper.text()).toContain('非本人照片')
    expect(wrapper.find('[aria-live]').exists()).toBe(false)
  })

  it('keeps the manually selected image available while paused', async () => {
    wrapper = mount(ImmersiveScene, { props: { paused: true, mode: 'front' } })
    await wrapper.setProps({ mode: 'bass' })
    expect(wrapper.get('img').attributes('src')).toBe('/portraits/bass/preview.png')
    expect(wrapper.get('img').isVisible()).toBe(true)
  })

  it('hides duplicate poster only after the portrait pipeline is ready and recovers after context loss', async () => {
    const canvas = document.createElement('canvas')
    canvas.className = 'visual-runtime-canvas'
    canvas.dataset.portraitState = 'loading'
    document.body.append(canvas)
    wrapper = mount(ImmersiveScene, { attachTo: document.body })
    expect(wrapper.get('.portrait-poster').isVisible()).toBe(true)
    canvas.dataset.portraitState = 'ready'
    await flushPromises()
    expect(wrapper.get('.portrait-poster').isVisible()).toBe(false)
    canvas.dataset.runtimeFailed = 'true'
    await flushPromises()
    expect(wrapper.get('.portrait-poster').isVisible()).toBe(true)
    expect(wrapper.get('.portrait-description').text()).toContain('演示')
  })
})
