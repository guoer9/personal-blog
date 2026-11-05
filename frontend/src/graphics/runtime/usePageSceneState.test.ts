// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createPageSceneBridge } from './usePageSceneState'

describe('PageSceneBridge', () => {
  it('isolates page state and exposes no scene instance', () => {
    const first = createPageSceneBridge({ category: 'code', itemCount: 1 })
    const second = createPageSceneBridge({ category: 'film', itemCount: 2 })

    first.setState({ category: 'music', itemCount: 3 })
    const snapshot = first.getState()
    expect(snapshot).toEqual({ category: 'music', itemCount: 3 })
    expect(second.getState()).toEqual({ category: 'film', itemCount: 2 })
    expect('scene' in first).toBe(false)

    ;(snapshot as { itemCount: number }).itemCount = 99
    expect(first.getState().itemCount).toBe(3)
  })

  it('registers anchors through the bridge and clears state and anchors', () => {
    const bridge = createPageSceneBridge({ paused: false })
    const element = document.createElement('section')
    const unregister = bridge.registerAnchor('hero', element)

    expect(bridge.anchors.has('hero')).toBe(true)
    unregister()
    expect(bridge.anchors.has('hero')).toBe(false)

    bridge.registerAnchor('hero', element)
    bridge.clear()
    expect(bridge.getState()).toEqual({ paused: false })
    expect(bridge.anchors.has('hero')).toBe(false)
  })
})
