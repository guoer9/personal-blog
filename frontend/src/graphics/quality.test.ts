import { describe, expect, it } from 'vitest'
import { frameTimeEma, resolveQualityState, type QualityState } from './quality'

function advance(state: QualityState, frames: number, frameTimeEmaMs: number): QualityState {
  let next = state
  for (let index = 0; index < frames; index += 1) {
    next = resolveQualityState(next, frameTimeEmaMs)
  }
  return next
}

describe('adaptive scene quality', () => {
  it('keeps high quality below the slow-frame threshold', () => {
    const state = advance({ tier: 'high', slowFrames: 0, fastFrames: 0 }, 90, 18.99)

    expect(state).toEqual({ tier: 'high', slowFrames: 0, fastFrames: 0 })
  })

  it('moves high to balanced only after 45 consecutive slow frames', () => {
    const start = { tier: 'high', slowFrames: 0, fastFrames: 0 } as const

    expect(advance(start, 44, 19)).toEqual({ tier: 'high', slowFrames: 44, fastFrames: 0 })
    expect(advance(start, 45, 19)).toEqual({ tier: 'balanced', slowFrames: 0, fastFrames: 0 })
  })

  it('moves balanced to low only after 45 consecutive very slow frames', () => {
    const start = { tier: 'balanced', slowFrames: 0, fastFrames: 0 } as const

    expect(advance(start, 44, 28)).toEqual({ tier: 'balanced', slowFrames: 44, fastFrames: 0 })
    expect(advance(start, 45, 28.01)).toEqual({ tier: 'low', slowFrames: 0, fastFrames: 0 })
  })

  it('requires sustained recovery and resets the opposite direction', () => {
    const recoveringLow = advance({ tier: 'low', slowFrames: 0, fastFrames: 0 }, 89, 24.99)
    expect(recoveringLow).toEqual({ tier: 'low', slowFrames: 0, fastFrames: 89 })
    expect(resolveQualityState(recoveringLow, 28)).toEqual({ tier: 'low', slowFrames: 0, fastFrames: 0 })
    expect(advance(recoveringLow, 90, 24.99)).toEqual({ tier: 'balanced', slowFrames: 0, fastFrames: 0 })

    const recoveringBalanced = advance({ tier: 'balanced', slowFrames: 0, fastFrames: 0 }, 89, 15.99)
    expect(recoveringBalanced).toEqual({ tier: 'balanced', slowFrames: 0, fastFrames: 89 })
    expect(advance(recoveringBalanced, 90, 15.99)).toEqual({ tier: 'high', slowFrames: 0, fastFrames: 0 })
  })

  it('preserves the current state for invalid EMA input', () => {
    const state = { tier: 'balanced', slowFrames: 12, fastFrames: 8 } as const

    expect(resolveQualityState(state, -1)).toEqual(state)
    expect(resolveQualityState(state, Number.NaN)).toEqual(state)
    expect(resolveQualityState(state, Number.POSITIVE_INFINITY)).toEqual(state)
  })

  it('clamps EMA inputs to finite non-negative values', () => {
    expect(frameTimeEma(16, 32)).toBeCloseTo(17.92, 5)
    expect(frameTimeEma(-4, 20)).toBe(2.4)
    expect(frameTimeEma(Number.NaN, 20)).toBe(2.4)
    expect(frameTimeEma(16, -20)).toBeCloseTo(14.08, 5)
    expect(frameTimeEma(16, Number.POSITIVE_INFINITY)).toBe(16)
  })
})
