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

import { narrativeProgress, projectCardTransform, qualityProfile, resolveMotionStage, sceneMood, springStep } from './motion'

describe('resolveMotionStage', () => {
  it('keeps a distinct visual state for each part of the homepage story', () => {
    expect(resolveMotionStage(0)).toBe('idea')
    expect(resolveMotionStage(0.28)).toBe('writing')
    expect(resolveMotionStage(0.62)).toBe('projects')
    expect(resolveMotionStage(0.84)).toBe('signal')
  })

  it('clamps progress outside the narrative range', () => {
    expect(resolveMotionStage(-1)).toBe('idea')
    expect(resolveMotionStage(2)).toBe('signal')
  })
})

describe('springStep', () => {
  it('settles the value while preserving momentum over small frames', () => {
    const first = springStep({ value: 0, velocity: 0 }, 100, 1 / 60)
    const second = springStep(first, 100, 1 / 60)

    expect(first.value).toBeGreaterThan(0)
    expect(second.value).toBeGreaterThan(first.value)
    expect(second.velocity).toBeGreaterThan(0)
  })

  it('returns a stable identical state for an invalid frame delta', () => {
    const state = { value: 20, velocity: -3 }
    expect(springStep(state, 0, 0)).toEqual(state)
  })
})

describe('projectCardTransform', () => {
  it('subtly tilts around the pointer and returns an illumination position', () => {
    const result = projectCardTransform(150, 100, { left: 0, top: 0, width: 300, height: 200 })

    expect(result.rotateX).toBeCloseTo(0)
    expect(result.rotateY).toBeCloseTo(0)
    expect(result.lightX).toBe(50)
    expect(result.lightY).toBe(50)
  })

  it('clamps content near the edges so cards remain readable', () => {
    const result = projectCardTransform(900, -900, { left: 0, top: 0, width: 300, height: 200 })

    expect(Math.abs(result.rotateX)).toBeLessThanOrEqual(2.4)
    expect(Math.abs(result.rotateY)).toBeLessThanOrEqual(2.4)
    expect(result.lightX).toBe(100)
    expect(result.lightY).toBe(0)
  })
})

describe('narrativeProgress', () => {
  it('maps the scrollable homepage distance to a bounded story timeline', () => {
    expect(narrativeProgress(0, 3000, 1000)).toBe(0)
    expect(narrativeProgress(1000, 3000, 1000)).toBe(0.5)
    expect(narrativeProgress(2000, 3000, 1000)).toBe(1)
  })

  it('returns zero when the page cannot scroll', () => {
    expect(narrativeProgress(700, 900, 1000)).toBe(0)
    expect(narrativeProgress(10, 0, 1000)).toBe(0)
  })
})

describe('qualityProfile', () => {
  it('uses a lighter scene on narrow or low-core devices', () => {
    expect(qualityProfile(390, 8).detail).toBe(3)
    expect(qualityProfile(1440, 2).detail).toBe(3)
    expect(qualityProfile(1440, 8).detail).toBe(4)
  })

  it('never raises the device pixel ratio above a bounded budget', () => {
    expect(qualityProfile(390, 8).pixelRatioCap).toBe(1.25)
    expect(qualityProfile(1440, 8).pixelRatioCap).toBe(1.75)
  })
})

describe('sceneMood', () => {
  it('keeps a coherent colour and form language across the story stages', () => {
    const idea = sceneMood('idea')
    const writing = sceneMood('writing')
    const projects = sceneMood('projects')
    const signal = sceneMood('signal')

    expect(idea.lightness).toBeGreaterThan(writing.lightness)
    expect(writing.rotationSpeed).toBeGreaterThan(idea.rotationSpeed)
    expect(projects.particleLift).toBe(signal.particleLift)
    expect(signal.scale).toBeLessThan(projects.scale)
  })
})
