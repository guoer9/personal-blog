export type QualityTier = 'high' | 'balanced' | 'low'

export interface QualityState {
  tier: QualityTier
  slowFrames: number
  fastFrames: number
}

const DEFAULT_ALPHA = 0.12
const HIGH_TO_BALANCED_MS = 19
const BALANCED_TO_LOW_MS = 28
const LOW_RECOVERY_MS = 25
const BALANCED_RECOVERY_MS = 16
const DOWNGRADE_DWELL = 45
const RECOVERY_DWELL = 90

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Smooth frame-time samples while keeping the result finite and non-negative. */
export function frameTimeEma(previous: number, sample: number, alpha = DEFAULT_ALPHA): number {
  const current = finiteNonNegative(previous)
  if (!Number.isFinite(sample)) return current
  const weight = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : DEFAULT_ALPHA
  return finiteNonNegative(current + (Math.max(0, sample) - current) * weight)
}

function resetState(tier: QualityTier): QualityState {
  return { tier, slowFrames: 0, fastFrames: 0 }
}

/** Apply one frame-time sample with directional hysteresis. */
export function resolveQualityState(
  state: Readonly<QualityState>,
  frameTimeEmaMs: number,
): QualityState {
  if (!Number.isFinite(frameTimeEmaMs) || frameTimeEmaMs < 0) return { ...state }

  if (state.tier === 'high') {
    if (frameTimeEmaMs < HIGH_TO_BALANCED_MS) return { tier: 'high', slowFrames: 0, fastFrames: 0 }
    const slowFrames = state.slowFrames + 1
    return slowFrames >= DOWNGRADE_DWELL
      ? resetState('balanced')
      : { tier: 'high', slowFrames, fastFrames: 0 }
  }

  if (state.tier === 'balanced') {
    if (frameTimeEmaMs >= BALANCED_TO_LOW_MS) {
      const slowFrames = state.slowFrames + 1
      return slowFrames >= DOWNGRADE_DWELL
        ? resetState('low')
        : { tier: 'balanced', slowFrames, fastFrames: 0 }
    }
    if (frameTimeEmaMs < BALANCED_RECOVERY_MS) {
      const fastFrames = state.fastFrames + 1
      return fastFrames >= RECOVERY_DWELL
        ? resetState('high')
        : { tier: 'balanced', slowFrames: 0, fastFrames }
    }
    return { tier: 'balanced', slowFrames: 0, fastFrames: 0 }
  }

  if (frameTimeEmaMs < LOW_RECOVERY_MS) {
    const fastFrames = state.fastFrames + 1
    return fastFrames >= RECOVERY_DWELL
      ? resetState('balanced')
      : { tier: 'low', slowFrames: 0, fastFrames }
  }
  return { tier: 'low', slowFrames: 0, fastFrames: 0 }
}
