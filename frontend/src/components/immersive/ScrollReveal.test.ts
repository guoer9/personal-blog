// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPageScroll, pageScrollKey } from '@/graphics/runtime/pageScroll'
import ScrollReveal from './ScrollReveal.vue'

afterEach(() => vi.restoreAllMocks())

function createHarness() {
  const bus = createPageScroll()
  let scrollY = 0
  let timeMs = 0
  const wrappers: ReturnType<typeof mount>[] = []
  // Happy DOM has no layout. Model a fixed document position plus the
  // component's own live translation, as getBoundingClientRect does in a browser.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = Number(this.dataset.documentTop ?? 1100) - scrollY
    const rise = parseFloat(this.style.getPropertyValue('--scroll-rise')) || 0
    const initialRise = this.dataset.scrollDriven === 'true' && !this.style.getPropertyValue('--scroll-rise') ? 28 : rise
    return new DOMRect(0, top + initialRise, 300, 100)
  })
  function publish(nextScrollY: number) {
    scrollY = nextScrollY
    bus.publish({ scrollY, viewportHeight: 1000, timeMs: timeMs += 16 })
  }
  publish(0)
  return {
    bus, publish,
    mountReveal(documentTop = 1100) {
      const wrapper = mount(ScrollReveal, {
        props: { scroll: true },
        attrs: { 'data-document-top': documentTop },
        global: { provide: { [pageScrollKey as symbol]: bus } },
      })
      wrappers.push(wrapper)
      return wrapper
    },
    dispose() { wrappers.forEach(wrapper => wrapper.unmount()) },
  }
}

function readReveal(element: Element) {
  const style = (element as HTMLElement).style
  return {
    opacity: Number(style.getPropertyValue('--scroll-reveal')),
    rise: parseFloat(style.getPropertyValue('--scroll-rise')),
  }
}

describe('ScrollReveal shared scroll lifecycle', () => {
  it('reverses from fully revealed through the same midpoint back to hidden without transform drift', () => {
    const harness = createHarness()
    const wrapper = harness.mountReveal()
    try {
      expect(readReveal(wrapper.element)).toEqual({ opacity: 0, rise: 28 })
      harness.publish(310) // Layout top 790: halfway through the 960..620 reveal interval.
      expect(readReveal(wrapper.element)).toEqual({ opacity: 0.5, rise: 14 })
      const middle = readReveal(wrapper.element)
      harness.publish(310)
      expect(readReveal(wrapper.element)).toEqual(middle)
      harness.publish(500)
      expect(readReveal(wrapper.element)).toEqual({ opacity: 1, rise: 0 })
      harness.publish(310)
      expect(readReveal(wrapper.element)).toEqual(middle)
      harness.publish(0)
      expect(readReveal(wrapper.element)).toEqual({ opacity: 0, rise: 28 })
    } finally { harness.dispose() }
  })

  it('uses the current bus frame when mounted after scrolling without waiting for another scroll event', () => {
    const harness = createHarness()
    harness.publish(500)
    const wrapper = harness.mountReveal()
    try {
      expect(readReveal(wrapper.element)).toEqual({ opacity: 1, rise: 0 })
      harness.publish(0)
      expect(readReveal(wrapper.element)).toEqual({ opacity: 0, rise: 28 })
    } finally { harness.dispose() }
  })

  it('removes the unmounted listener while other reveals keep receiving the shared bus', () => {
    const harness = createHarness()
    const subscribed: ReturnType<typeof vi.fn>[] = []
    const subscribe = harness.bus.subscribe.bind(harness.bus)
    vi.spyOn(harness.bus, 'subscribe').mockImplementation(listener => {
      // Wrap callbacks, but retain the real bus and its unsubscribe operation.
      // Checking the detached element alone would miss a leaked listener whose
      // root ref is null and therefore silently returns on every later frame.
      const callback = vi.fn(listener)
      subscribed.push(callback)
      return subscribe(callback)
    })
    const first = harness.mountReveal()
    const second = harness.mountReveal(1200)
    try {
      harness.publish(400)
      expect(subscribed).toHaveLength(2)
      expect(subscribed[0]).toHaveBeenCalledOnce()
      expect(subscribed[1]).toHaveBeenCalledOnce()
      first.unmount()
      harness.publish(800)
      expect(subscribed[0]).toHaveBeenCalledOnce()
      expect(subscribed[1]).toHaveBeenCalledTimes(2)
      expect(readReveal(second.element)).toEqual({ opacity: 1, rise: 0 })
      harness.publish(0)
      expect(readReveal(second.element)).toEqual({ opacity: 0, rise: 28 })
      second.unmount()
      const activeCalls = subscribed[1]!.mock.calls.length
      harness.publish(800)
      expect(subscribed[0]).toHaveBeenCalledOnce()
      expect(subscribed[1]).toHaveBeenCalledTimes(activeCalls)
    } finally { harness.dispose() }
  })
})
