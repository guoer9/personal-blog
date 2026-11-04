// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { DomAnchorRegistry } from './DomAnchorRegistry'

describe('DomAnchorRegistry', () => {
  it('registers, measures only registered anchors, returns cached rectangles, and unregisters safely', () => {
    const registry = new DomAnchorRegistry()
    const registered = document.createElement('div')
    const unregistered = document.createElement('div')
    vi.spyOn(registered, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 20, top: 20, right: 110, bottom: 70, left: 10, width: 100, height: 50,
      toJSON: () => ({}),
    } as DOMRect)
    const unregisteredMeasure = vi.spyOn(unregistered, 'getBoundingClientRect')

    const unregister = registry.register('hero', registered)
    registry.measure()

    expect(registered.getBoundingClientRect).toHaveBeenCalledTimes(1)
    expect(unregisteredMeasure).not.toHaveBeenCalled()
    expect(registry.get('hero')).toEqual({ x: 10, y: 20, top: 20, right: 110, bottom: 70, left: 10, width: 100, height: 50 })

    const cached = registry.get('hero')
    if (cached) cached.x = 999
    expect(registry.get('hero')?.x).toBe(10)

    unregister()
    registry.measure()
    expect(registry.get('hero')).toBeUndefined()
    expect(registered.getBoundingClientRect).toHaveBeenCalledTimes(1)
  })

  it('does not let an old disposer remove a replacement anchor with the same id', () => {
    const registry = new DomAnchorRegistry()
    const first = document.createElement('div')
    const second = document.createElement('div')
    const removeFirst = registry.register('shared', first)
    registry.register('shared', second)
    removeFirst()
    expect(registry.has('shared')).toBe(true)
  })
})
