import { describe, expect, it } from 'vitest'
import { clamp, damp, pointerToNdc } from './motion'

describe('damp', () => {
  it('is effectively independent of frame subdivision', () => {
    const wholeStep = damp(10, 0, 6, 1 / 30)
    const firstHalf = damp(10, 0, 6, 1 / 60)
    const twoHalfSteps = damp(firstHalf, 0, 6, 1 / 60)

    expect(twoHalfSteps).toBeCloseTo(wholeStep, 12)
  })

  it('keeps the current value when elapsed time is zero or negative', () => {
    expect(damp(2, 10, 6, 0)).toBe(2)
    expect(damp(2, 10, 6, -1)).toBe(2)
  })

  it('falls back safely when a numeric input is not finite', () => {
    expect(damp(Number.NaN, 5, 6, 1 / 60)).toBe(5)
    expect(damp(5, Number.NaN, 6, 1 / 60)).toBe(5)
    expect(damp(5, 10, Number.NaN, 1 / 60)).toBe(5)
  })

  it('moves toward the target without overshooting it', () => {
    const next = damp(10, 0, 4, 0.25)

    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(10)
  })
})

describe('clamp', () => {
  it('keeps values inside the inclusive bounds', () => {
    expect(clamp(-2, -1, 1)).toBe(-1)
    expect(clamp(0, -1, 1)).toBe(0)
    expect(clamp(3, -1, 1)).toBe(1)
  })
})

describe('pointerToNdc', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 }

  it('maps the rectangle center to the coordinate origin', () => {
    expect(pointerToNdc(300, 150, rect)).toEqual({ x: 0, y: 0 })
  })

  it('maps each edge to the corresponding normalized coordinate', () => {
    expect(pointerToNdc(100, 250, rect)).toEqual({ x: -1, y: -1 })
    expect(pointerToNdc(500, 50, rect)).toEqual({ x: 1, y: 1 })
  })

  it('clamps pointer positions outside the rectangle', () => {
    expect(pointerToNdc(-200, 900, rect)).toEqual({ x: -1, y: -1 })
  })

  it('returns the origin for a rectangle without area', () => {
    expect(pointerToNdc(10, 20, { left: 0, top: 0, width: 0, height: 100 })).toEqual({ x: 0, y: 0 })
    expect(pointerToNdc(10, 20, { left: 0, top: 0, width: 100, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})
