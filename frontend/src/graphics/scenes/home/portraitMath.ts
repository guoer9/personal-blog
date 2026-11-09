import type { QualityTier } from '../../runtime/types'

export interface PortraitBounds { left: number; top: number; width: number; height: number }
export interface PortraitPoint { x: number; y: number }

export interface PortraitFraming { fitHeight: number; offsetY: number; pointerStrength: number }

/** The reference's power1.inOut curve, shared by framing and composition. */
export function portraitScrollEase(progress: number): number {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
}

/** Viewport travel from the shared scroll position; no second animation clock. */
export function homeScrollSequence(travel: number) {
  const value = Number.isFinite(travel) ? travel : 0
  const interval = (start: number, end: number) => Math.max(0, Math.min(1, (value - start) / (end - start)))
  return {
    portrait: interval(0, 1),
    signature: interval(0.42, 1.42),
    connector: interval(1.42, 2.04),
  }
}

export function portraitFraming(viewportWidth: number, progress: number): PortraitFraming {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1
  const rawProgress = Number.isFinite(progress) ? progress : 0
  const clamped = Math.max(0, Math.min(1, rawProgress))
  const eased = portraitScrollEase(clamped)
  const mobile = width <= 760
  const initial = { fitHeight: 1.12, offsetY: -0.03 }
  const settled = mobile ? { fitHeight: 1.24, offsetY: -0.02 } : { fitHeight: 1.26, offsetY: 0.02 }
  return {
    fitHeight: initial.fitHeight + (settled.fitHeight - initial.fitHeight) * eased,
    offsetY: initial.offsetY + (settled.offsetY - initial.offsetY) * eased,
    pointerStrength: 1 - portraitScrollEase(clamped / 0.5),
  }
}

/** Render-target bounds used by the portrait pass while the sticky hero contracts. */
export function portraitRenderBounds(bounds: PortraitBounds, viewportWidth: number, viewportHeight: number, progress: number): PortraitBounds {
  if (![bounds.left, bounds.top, bounds.width, bounds.height, viewportWidth, viewportHeight].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return bounds
  const p = portraitScrollEase(progress)
  if (p <= 0) return bounds
  const mobile = viewportWidth <= 760
  const targetWidth = Math.min(bounds.width, mobile ? Math.min(400, bounds.width * 0.86) : 566)
  const targetHeight = Math.min(bounds.height * 0.42, mobile ? 380 : 366)
  const width = bounds.width + (targetWidth - bounds.width) * p
  const height = bounds.height + (targetHeight - bounds.height) * p
  return {
    // The anchor moves once sticky positioning releases. Keep that translation
    // so the portrait leaves with the hero instead of floating over later sections.
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + (bounds.height - height) / 2,
    width,
    height,
  }
}

export function heroScrollProgress(scrollY: number, trackTop: number, trackHeight: number, viewportHeight: number): number {
  if (![scrollY, trackTop, trackHeight, viewportHeight].every(Number.isFinite)) return 0
  const travel = Math.max(1, trackHeight - viewportHeight)
  return Math.max(0, Math.min(1, (scrollY - trackTop) / travel))
}

export function portraitBackdropOpacity(bounds: PortraitBounds): number {
  if (!Number.isFinite(bounds.top) || !Number.isFinite(bounds.height) || bounds.height <= 0) return 0
  const progress = Math.max(0, Math.min(1, (bounds.top + bounds.height) / (bounds.height * 0.5)))
  return progress * progress * (3 - 2 * progress)
}

/** CSS viewport pixels in; bottom-origin, portrait-local UVs out. */
export function portraitPointer(bounds: PortraitBounds | undefined, pixelX: number, pixelY: number): PortraitPoint | null {
  if (!bounds || ![bounds.left, bounds.top, bounds.width, bounds.height, pixelX, pixelY].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) return null
  const x = (pixelX - bounds.left) / bounds.width
  const y = 1 - (pixelY - bounds.top) / bounds.height
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
}

export function portraitResolution(width: number, height: number, dpr: number, tier: QualityTier) {
  const cssWidth = Number.isFinite(width) && width > 0 ? width : 1
  const cssHeight = Number.isFinite(height) && height > 0 ? height : 1
  const dprCap = tier === 'high' ? 2 : tier === 'balanced' ? 1.5 : 1
  const longest = tier === 'high' ? 1600 : tier === 'balanced' ? 1200 : 900
  const ratio = Math.min(Number.isFinite(dpr) ? Math.max(1, dpr) : 1, dprCap, longest / Math.max(cssWidth, cssHeight))
  const targetWidth = Math.max(1, Math.round(cssWidth * ratio))
  const targetHeight = Math.max(1, Math.round(cssHeight * ratio))
  const fluidLongest = tier === 'high' ? 240 : tier === 'balanced' ? 180 : 120
  const fluidRatio = fluidLongest / Math.max(cssWidth, cssHeight)
  return {
    width: targetWidth, height: targetHeight,
    segments: tier === 'high' ? 128 : tier === 'balanced' ? 96 : 64,
    fluidWidth: Math.max(1, Math.round(cssWidth * fluidRatio)),
    fluidHeight: Math.max(1, Math.round(cssHeight * fluidRatio)),
  }
}
