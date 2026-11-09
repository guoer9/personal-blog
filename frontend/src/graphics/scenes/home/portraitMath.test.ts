import { describe, expect, it } from 'vitest'
import { homeScrollSequence, heroScrollProgress, portraitBackdropOpacity, portraitFraming, portraitPointer, portraitRenderBounds, portraitResolution, portraitScrollEase } from './portraitMath'

const bounds = { left: 100, top: 200, width: 400, height: 600 }

describe('shared scroll choreography', () => {
  it('overlaps writing with contraction and completes the name before extending its last stroke', () => {
    expect(homeScrollSequence(0)).toEqual({ portrait: 0, signature: 0, connector: 0 })
    expect(homeScrollSequence(0.7).signature).toBeGreaterThan(0)
    expect(homeScrollSequence(0.7).signature).toBeLessThan(0.6)
    expect(homeScrollSequence(1).signature).toBeLessThan(1)
    expect(homeScrollSequence(1.42)).toMatchObject({ signature: 1, connector: 0 })
    expect(homeScrollSequence(1.7).connector).toBeGreaterThan(0)
    expect(homeScrollSequence(2.1)).toEqual({ portrait: 1, signature: 1, connector: 1 })
  })
  it('returns to the same geometry immediately after reversal or a large jump', () => {
    const at = homeScrollSequence(0.9)
    homeScrollSequence(5)
    expect(homeScrollSequence(0.9)).toEqual(at)
    expect(homeScrollSequence(-1)).toEqual(homeScrollSequence(0))
    expect(homeScrollSequence(NaN)).toEqual(homeScrollSequence(0))
  })
})

describe('portrait framing', () => {
  it('frames a close-up on desktop, giving touch screens room for the face', () => {
    expect(portraitFraming(1440, 0)).toMatchObject({ fitHeight: 1.12, offsetY: -0.03, pointerStrength: 1 })
    expect(portraitFraming(390, 0)).toMatchObject({ fitHeight: 1.12, offsetY: -0.03, pointerStrength: 1 })
})

  it('pulls the camera back and removes pointer motion during the scroll contraction', () => {
    const initial = portraitFraming(1440, 0)
    const settled = portraitFraming(1440, 1)
    expect(settled.fitHeight).toBeGreaterThan(initial.fitHeight)
    expect(settled.pointerStrength).toBe(0)
    expect(portraitFraming(1440, 0.5).pointerStrength).toBe(0)
    expect(portraitFraming(1440, -1)).toEqual(initial)
    expect(portraitFraming(1440, 2)).toEqual(settled)
    expect(portraitFraming(1440, NaN)).toEqual(initial)
  })
})

describe('portrait render target contraction', () => {
  it('eases both ends of the reference scroll curve and remains reversible', () => {
    expect(portraitScrollEase(0.25)).toBeCloseTo(0.125)
    expect(portraitScrollEase(0.75)).toBeCloseTo(0.875)
    expect(portraitScrollEase(0)).toBe(0)
    expect(portraitScrollEase(1)).toBe(1)
    const at = (p: number) => portraitRenderBounds({ left: 0, top: 0, width: 1440, height: 1000 }, 1440, 1000, p).width
    expect(at(0) - at(0.01)).toBeLessThan(at(0.49) - at(0.5))
    expect(at(0.99) - at(1)).toBeLessThan(at(0.49) - at(0.5))
    expect([0, 0.25, 0.5, 0.75, 1].map(at)).toEqual([1, 0.75, 0.5, 0.25, 0].map(at).reverse())
  })
  it('keeps full viewport bounds at rest and contracts to the centered reference footprint', () => {
    const viewport = { left: 0, top: 0, width: 1440, height: 1000 }
    expect(portraitRenderBounds(viewport, 1440, 1000, 0)).toEqual(viewport)
    expect(portraitRenderBounds(viewport, 1440, 1000, 1)).toEqual({ left: 437, top: 317, width: 566, height: 366 })
    expect(portraitRenderBounds(viewport, 1440, 1000, 0.5)).toEqual({ left: 218.5, top: 158.5, width: 1003, height: 683 })
  })

  it('uses a taller target on touch-sized viewports', () => {
    const frame = portraitRenderBounds({ left: 0, top: 0, width: 390, height: 844 }, 390, 844, 1)
    expect(frame.width).toBeCloseTo(335.4)
    expect(frame.height).toBeCloseTo(354.48)
    expect(frame.left).toBeCloseTo(27.3)
    expect(frame.top).toBeCloseTo(244.76)
  })

  it('moves the contracted portrait out with its released sticky anchor', () => {
    expect(portraitRenderBounds({ left: 0, top: -300, width: 1440, height: 1000 }, 1440, 1000, 1))
      .toEqual({ left: 437, top: 17, width: 566, height: 366 })
    const exited = portraitRenderBounds({ left: 0, top: -800, width: 1440, height: 1000 }, 1440, 1000, 1)
    expect(exited.top + exited.height).toBeLessThan(0)
  })
})

describe('portrait backdrop exit', () => {
  it('fades continuously to the original background before the anchor leaves the viewport', () => {
    expect(portraitBackdropOpacity(bounds)).toBe(1)
    expect(portraitBackdropOpacity({ ...bounds, top: -450 })).toBeCloseTo(0.5)
    expect(portraitBackdropOpacity({ ...bounds, top: -599 })).toBeLessThan(0.001)
    expect(portraitBackdropOpacity({ ...bounds, top: -600 })).toBe(0)
    expect(portraitBackdropOpacity({ ...bounds, height: 0 })).toBe(0)
  })
})

describe('full-screen hero scroll progress', () => {
  it('keeps the portrait full size at the start and eases it out across the pinned track', () => {
    expect(heroScrollProgress(0, 0, 1500, 1000)).toBe(0)
    expect(heroScrollProgress(250, 0, 1500, 1000)).toBe(0.5)
    expect(heroScrollProgress(500, 0, 1500, 1000)).toBe(1)
    expect(heroScrollProgress(900, 0, 1500, 1000)).toBe(1)
  })

  it('clamps invalid and short track measurements', () => {
    expect(heroScrollProgress(-20, 0, 1600, 1000)).toBe(0)
    expect(heroScrollProgress(200, 0, 800, 1000)).toBe(1)
    expect(heroScrollProgress(Number.NaN, 0, 1600, 1000)).toBe(0)
  })
})

describe('portrait pointer coordinates', () => {
  it('converts viewport CSS pixels to bottom-origin portrait UVs', () => {
    expect(portraitPointer(bounds, 200, 350)).toEqual({ x: 0.25, y: 0.75 })
    expect(portraitPointer(bounds, 500, 800)).toEqual({ x: 1, y: 0 })
  })

  it('rejects outside, missing, empty and nonfinite bounds instead of painting an edge', () => {
    expect(portraitPointer(bounds, 99, 350)).toBeNull()
    expect(portraitPointer(bounds, 200, 801)).toBeNull()
    expect(portraitPointer(undefined, 200, 350)).toBeNull()
    expect(portraitPointer({ ...bounds, width: 0 }, 100, 200)).toBeNull()
    expect(portraitPointer({ ...bounds, top: NaN }, 200, 350)).toBeNull()
    expect(portraitPointer(bounds, NaN, 350)).toBeNull()
  })
})

describe('portrait quality sizing', () => {
  it('uses capped physical pixels without changing the CSS aspect ratio', () => {
    expect(portraitResolution(400, 600, 3, 'high')).toEqual({ width: 800, height: 1200, segments: 128, fluidWidth: 160, fluidHeight: 240 })
    expect(portraitResolution(400, 600, 2, 'low')).toEqual({ width: 400, height: 600, segments: 64, fluidWidth: 80, fluidHeight: 120 })
  })

  it('caps large portrait allocations and normalizes invalid input', () => {
    const large = portraitResolution(2000, 3000, 3, 'high')
    expect(large.width).toBe(1067)
    expect(large.height).toBe(1600)
    const invalid = portraitResolution(NaN, 0, Infinity, 'balanced')
    expect(invalid.width).toBe(1)
    expect(invalid.height).toBe(1)
  })
})
