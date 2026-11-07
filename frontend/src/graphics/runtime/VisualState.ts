import type { QualityTier, Vector2, VisualState } from './types'

const DEFAULT_STATE: VisualState = {
  timeMs: 0, deltaSeconds: 1 / 60, pointerX: 0, pointerY: 0, pointerPixelX: 0, pointerPixelY: 0,
  pointerVelocity: { x: 0, y: 0 }, scrollY: 0, scrollVelocity: 0,
  documentProgress: 0, viewportWidth: 0, viewportHeight: 0, dpr: 1,
  qualityTier: 'high', reducedMotion: false, documentHidden: false, canvasVisible: true,
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }
function normalizeVector(value: unknown, fallback: Vector2): Vector2 {
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as { x?: unknown; y?: unknown }
  return { x: finite(candidate.x, fallback.x), y: finite(candidate.y, fallback.y) }
}
function normalizeQualityTier(value: unknown): QualityTier { return value === 'balanced' || value === 'low' ? value : 'high' }

export function normalizeVisualState(input: Partial<VisualState> = {}): VisualState {
  return {
    timeMs: Math.max(0, finite(input.timeMs, DEFAULT_STATE.timeMs)),
    deltaSeconds: clamp(finite(input.deltaSeconds, DEFAULT_STATE.deltaSeconds), 0, 0.1),
    pointerX: clamp(finite(input.pointerX, DEFAULT_STATE.pointerX), -1, 1),
    pointerY: clamp(finite(input.pointerY, DEFAULT_STATE.pointerY), -1, 1),
    pointerPixelX: Math.max(0, finite(input.pointerPixelX, DEFAULT_STATE.pointerPixelX)),
    pointerPixelY: Math.max(0, finite(input.pointerPixelY, DEFAULT_STATE.pointerPixelY)),
    pointerVelocity: normalizeVector(input.pointerVelocity, DEFAULT_STATE.pointerVelocity),
    scrollY: Math.max(0, finite(input.scrollY, DEFAULT_STATE.scrollY)),
    scrollVelocity: finite(input.scrollVelocity, DEFAULT_STATE.scrollVelocity),
    documentProgress: clamp(finite(input.documentProgress, DEFAULT_STATE.documentProgress), 0, 1),
    viewportWidth: Math.max(0, finite(input.viewportWidth, DEFAULT_STATE.viewportWidth)),
    viewportHeight: Math.max(0, finite(input.viewportHeight, DEFAULT_STATE.viewportHeight)),
    dpr: Math.max(1, finite(input.dpr, DEFAULT_STATE.dpr)),
    qualityTier: normalizeQualityTier(input.qualityTier),
    reducedMotion: Boolean(input.reducedMotion),
    documentHidden: Boolean(input.documentHidden),
    canvasVisible: input.canvasVisible === undefined ? DEFAULT_STATE.canvasVisible : Boolean(input.canvasVisible),
  }
}
export function createVisualState(input: Partial<VisualState> = {}): VisualState { return normalizeVisualState(input) }
