import { describe, expect, it } from 'vitest'
import { createVisualState, normalizeVisualState } from './VisualState'

describe('VisualState', () => {
  it('normalizes non-finite, out-of-range, and invalid quality input', () => {
    const state = normalizeVisualState({
      timeMs: Number.NaN,
      deltaSeconds: 10,
      pointerX: 3,
      pointerY: -4,
      pointerVelocity: { x: Number.POSITIVE_INFINITY, y: -2 },
      scrollY: Number.NEGATIVE_INFINITY,
      scrollVelocity: Number.NaN,
      documentProgress: 2,
      viewportWidth: -10,
      viewportHeight: Number.NaN,
      dpr: 0,
      qualityTier: 'broken' as never,
      reducedMotion: 1 as never,
      documentHidden: 0 as never,
      canvasVisible: 'yes' as never,
    })

    expect(state).toEqual(expect.objectContaining({
      timeMs: 0,
      deltaSeconds: 0.1,
      pointerX: 1,
      pointerY: -1,
      scrollY: 0,
      scrollVelocity: 0,
      documentProgress: 1,
      viewportWidth: 0,
      viewportHeight: 0,
      dpr: 1,
      qualityTier: 'high',
      reducedMotion: true,
      documentHidden: false,
      canvasVisible: true,
    }))
    expect(state.pointerVelocity).toEqual({ x: 0, y: -2 })
  })

  it('creates an independent complete state from defaults and partial values', () => {
    const state = createVisualState({ pointerX: 0.4, viewportWidth: 800 })
    expect(state).toEqual(expect.objectContaining({ pointerX: 0.4, pointerPixelX: 0, pointerPixelY: 0, viewportWidth: 800 }))
    expect(state.deltaSeconds).toBeGreaterThan(0)
    expect(state.qualityTier).toBe('high')
  })
})
