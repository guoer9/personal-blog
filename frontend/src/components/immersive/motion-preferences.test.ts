// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MagneticLink from './MagneticLink.vue'
import ProjectCardMotion from './ProjectCardMotion.vue'
import ScrollReveal from './ScrollReveal.vue'

describe('full motion with the operating-system reduced-motion preference enabled', () => {
  let frame: FrameRequestCallback | undefined

  beforeEach(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    vi.spyOn(preference, 'matches', 'get').mockReturnValue(true)
    vi.spyOn(window, 'matchMedia').mockReturnValue(preference)
    frame = undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reveals content only when it enters the viewport', () => {
    let intersect: IntersectionObserverCallback | undefined
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback }
      observe() {}
      disconnect = disconnect
    })
    const wrapper = mount(ScrollReveal)
    try {
      expect(wrapper.attributes('data-revealed')).toBeUndefined()
      intersect?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
      expect(wrapper.attributes('data-revealed')).toBeUndefined()
      intersect?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      expect(wrapper.attributes('data-revealed')).toBe('true')
      expect(disconnect).toHaveBeenCalledOnce()
    } finally { wrapper.unmount() }
  })

  it.each(['mouse', 'pen', 'touch'])('preserves magnetic-link behavior for %s input', async (pointerType) => {
    const wrapper = mount(MagneticLink, { props: { href: '/about' } })
    vi.spyOn(wrapper.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
    try {
      await wrapper.trigger('pointermove', { pointerType, clientX: 150, clientY: 25 })
      frame?.(16)
      const transform = (wrapper.element as HTMLElement).style.transform
      if (pointerType === 'touch') expect(transform).toBe('')
      else expect(Number(transform.match(/translate3d\(([-\d.]+)px/)?.[1])).toBeGreaterThan(0)
    } finally { wrapper.unmount() }
  })

  it.each(['mouse', 'pen', 'touch'])('preserves project-card behavior for %s input', async (pointerType) => {
    const wrapper = mount(ProjectCardMotion, { props: { accent: 'lime' } })
    vi.spyOn(wrapper.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
    try {
      await wrapper.trigger('pointermove', { pointerType, clientX: 150, clientY: 25 })
      frame?.(16)
      const style = (wrapper.element as HTMLElement).style
      if (pointerType === 'touch') {
        expect(wrapper.attributes('data-active')).toBe('false')
        expect(style.getPropertyValue('--card-rotate-y')).toBe('')
      } else {
        expect(wrapper.attributes('data-active')).toBe('true')
        expect(parseFloat(style.getPropertyValue('--card-rotate-y'))).toBeGreaterThan(0)
        expect(style.getPropertyValue('--card-lift')).toBe('-8px')
      }
    } finally { wrapper.unmount() }
  })
})
