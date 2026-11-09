// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScrollReveal from '@/components/immersive/ScrollReveal.vue'
import { createPageScroll, pageScrollKey, type PageScrollFrame } from './pageScroll'

const frame: PageScrollFrame = { scrollY: 400, viewportHeight: 1000, timeMs: 16 }
const wrappers: ReturnType<typeof mount>[] = []

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pageScroll layout invalidation', () => {
  it('coalesces layout changes until the shared frame publishes fresh geometry', () => {
    const bus = createPageScroll()
    bus.publish(frame)
    const received: PageScrollFrame[] = []
    bus.subscribe(value => received.push(value))

    bus.invalidate()
    bus.invalidate()
    expect(bus.dirty).toBe(true)
    expect(received).toEqual([])
    expect(bus.current).toEqual(frame)

    const nextFrame = { ...frame, timeMs: 32 }
    if (bus.dirty) bus.publish(nextFrame)
    expect(received).toEqual([nextFrame])
    expect(bus.dirty).toBe(false)
  })

  it('preserves invalidation raised by a subscriber for the next shared frame', () => {
    const bus = createPageScroll()
    let deliveries = 0
    bus.subscribe(() => { if (++deliveries === 1) bus.invalidate() })

    bus.publish(frame)
    expect(bus.dirty).toBe(true)
    if (bus.dirty) bus.publish({ ...frame, timeMs: 32 })
    expect(deliveries).toBe(2)
    expect(bus.dirty).toBe(false)
  })

  it('drops pending invalidation and listeners when the layout is disposed', () => {
    const bus = createPageScroll()
    const received: PageScrollFrame[] = []
    bus.subscribe(value => received.push(value))
    bus.invalidate()
    bus.clear()

    expect(bus.dirty).toBe(false)
    bus.publish(frame)
    expect(received).toEqual([])
  })
})

function mountReveal(scroll = true) {
  const bus = createPageScroll()
  bus.publish(frame)
  let layoutTop = 1100
  const resizeTargets = new Map<Element, () => void>()
  vi.stubGlobal('ResizeObserver', class {
    private targets = new Set<Element>()
    private callback: () => void
    constructor(callback: () => void) { this.callback = callback }
    observe(target: Element) { this.targets.add(target); resizeTargets.set(target, this.callback) }
    disconnect() { this.targets.forEach(target => resizeTargets.delete(target)); this.targets.clear() }
  })
  // Happy DOM has no layout. Include the real component's current translation
  // in its rect, while allowing upstream content to move it without scrolling.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rise = parseFloat(this.style.getPropertyValue('--scroll-rise'))
    return new DOMRect(0, layoutTop + (Number.isFinite(rise) ? rise : this.dataset.scrollDriven ? 28 : 0), 300, 100)
  })
  const wrapper = mount(ScrollReveal, {
    props: { scroll },
    slots: { default: '<h2>Selected work</h2>' },
    global: { provide: { [pageScrollKey as symbol]: bus } },
  })
  wrappers.push(wrapper)
  const element = wrapper.element as HTMLElement
  return {
    bus, wrapper,
    moveTo(top: number) { layoutTop = top },
    notifyResize() { resizeTargets.get(element)?.() },
    opacity() { return Number(element.style.getPropertyValue('--scroll-reveal')) },
    flushFrame() { if (bus.dirty) bus.publish({ ...frame, timeMs: bus.current.timeMs + 16 }) },
  }
}

describe('ScrollReveal layout invalidation integration', () => {
  it('reveals content moved into view after loading with no additional scroll input', () => {
    const harness = mountReveal()
    harness.flushFrame()
    expect(harness.opacity()).toBe(0)

    // Home's ResizeObserver invalidates the bus when an upstream skeleton shrinks.
    harness.moveTo(790)
    harness.bus.invalidate()
    harness.flushFrame()
    expect(harness.bus.current.scrollY).toBe(400)
    expect(harness.opacity()).toBe(0.5)

    harness.moveTo(620)
    harness.bus.invalidate()
    harness.flushFrame()
    expect(harness.opacity()).toBe(1)
  })

  it('requests a fresh frame on mount and on content resize, then disconnects on unmount', () => {
    const harness = mountReveal()
    expect(harness.bus.dirty).toBe(true)
    harness.flushFrame()
    expect(harness.bus.dirty).toBe(false)

    harness.moveTo(790)
    harness.notifyResize()
    expect(harness.bus.dirty).toBe(true)
    expect(harness.opacity()).toBe(0)
    harness.flushFrame()
    expect(harness.opacity()).toBe(0.5)

    harness.wrapper.unmount()
    harness.notifyResize()
    expect(harness.bus.dirty).toBe(false)
  })

  it('keeps the default non-scroll fallback visible without subscribing to layout invalidation', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    Reflect.deleteProperty(window, 'IntersectionObserver')
    const harness = mountReveal(false)
    expect(harness.wrapper.attributes('data-revealed')).toBe('true')
    expect(harness.wrapper.attributes('data-scroll-driven')).toBeUndefined()
    expect(harness.bus.dirty).toBe(false)
    harness.notifyResize()
    expect(harness.bus.dirty).toBe(false)
  })
})
