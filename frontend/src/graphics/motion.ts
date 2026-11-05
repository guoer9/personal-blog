export function damp(current: number, target: number, lambda: number, deltaSeconds: number): number {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0
  if (!Number.isFinite(target) || !Number.isFinite(lambda) || deltaSeconds <= 0) return current
  return target + (current - target) * Math.exp(-Math.max(0, lambda) * deltaSeconds)
}

/** Combine recent pointer/scroll movement into a frame-rate-independent impulse. */
export class MotionEnergy {
  private value = 0
  private previousTimeMs: number | null = null

  pulse(distance: number, elapsedSeconds: number, referenceSpeed: number): void {
    if (
      !Number.isFinite(distance)
      || !Number.isFinite(elapsedSeconds)
      || !Number.isFinite(referenceSpeed)
      || elapsedSeconds <= 0
      || referenceSpeed <= 0
    ) return

    const speed = Math.abs(distance) / elapsedSeconds
    this.value = Math.max(this.value, clamp(speed / referenceSpeed, 0, 1))
  }

  advance(timeMs: number, decayRate = 5): number {
    if (!Number.isFinite(timeMs) || !Number.isFinite(decayRate) || decayRate < 0) return this.value
    if (this.previousTimeMs !== null) {
      const elapsedSeconds = Math.max(0, (timeMs - this.previousTimeMs) / 1000)
      this.value *= Math.exp(-decayRate * elapsedSeconds)
    }
    this.previousTimeMs = timeMs
    return this.value
  }

  reset(): void {
    this.value = 0
    this.previousTimeMs = null
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function pointerToNdc(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
    y: clamp(-((clientY - rect.top) / rect.height) * 2 + 1, -1, 1),
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export type MotionStage = 'idea' | 'writing' | 'projects' | 'signal'

const MOTION_STAGE_BOUNDARIES = [0.18, 0.48, 0.78] as const
const STAGE_TRANSITION_WIDTH = 0.055

export interface SpringState {
  value: number
  velocity: number
}

export interface ProjectCardMotion {
  rotateX: number
  rotateY: number
  lightX: number
  lightY: number
}

export function resolveMotionStage(progress: number): MotionStage {
  const normalized = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0
  if (normalized < MOTION_STAGE_BOUNDARIES[0]) return 'idea'
  if (normalized < MOTION_STAGE_BOUNDARIES[1]) return 'writing'
  if (normalized < MOTION_STAGE_BOUNDARIES[2]) return 'projects'
  return 'signal'
}

function smoothstep(value: number): number {
  const normalized = clamp(value, 0, 1)
  return normalized * normalized * (3 - 2 * normalized)
}

export function stageFocus(progress: number, stageIndex: number): number {
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex > 3) return 0
  const normalized = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0
  const entry = stageIndex === 0 ? 0 : MOTION_STAGE_BOUNDARIES[stageIndex - 1]
  const exit = stageIndex === 3 ? 1 : MOTION_STAGE_BOUNDARIES[stageIndex]

  if (stageIndex > 0) {
    const transitionStart = entry - STAGE_TRANSITION_WIDTH
    const transitionEnd = entry + STAGE_TRANSITION_WIDTH
    if (normalized < transitionEnd) {
      if (normalized <= transitionStart) return 0
      return smoothstep((normalized - transitionStart) / (transitionEnd - transitionStart))
    }
  }

  if (stageIndex < 3) {
    const transitionStart = exit - STAGE_TRANSITION_WIDTH
    const transitionEnd = exit + STAGE_TRANSITION_WIDTH
    if (normalized > transitionStart) {
      if (normalized >= transitionEnd) return 0
      return 1 - smoothstep((normalized - transitionStart) / (transitionEnd - transitionStart))
    }
  }

  return 1
}

export function springStep(state: SpringState, target: number, deltaSeconds: number): SpringState {
  if (!Number.isFinite(target) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return state
  const safeDelta = Math.min(deltaSeconds, 0.05)
  const stiffness = 150
  const damping = 22
  const acceleration = (target - state.value) * stiffness - state.velocity * damping
  const velocity = state.velocity + acceleration * safeDelta
  const value = state.value + velocity * safeDelta
  return { value, velocity }
}

export function projectCardTransform(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): ProjectCardMotion {
  if (rect.width <= 0 || rect.height <= 0) return { rotateX: 0, rotateY: 0, lightX: 50, lightY: 50 }
  const x = clamp((clientX - rect.left) / rect.width, 0, 1)
  const y = clamp((clientY - rect.top) / rect.height, 0, 1)
  return {
    rotateX: (0.5 - y) * 4.8,
    rotateY: (x - 0.5) * 4.8,
    lightX: x * 100,
    lightY: y * 100,
  }
}

export function narrativeProgress(scrollY: number, documentHeight: number, viewportHeight: number): number {
  const distance = Math.max(0, documentHeight - viewportHeight)
  if (distance <= 0) return 0
  return clamp(scrollY / distance, 0, 1)
}

export interface QualityProfile {
  detail: number
  pixelRatioCap: number
  particleCount: number
}

export function qualityProfile(viewportWidth: number, hardwareConcurrency: number): QualityProfile {
  const constrained = viewportWidth < 760 || hardwareConcurrency <= 4
  return constrained
    ? { detail: 3, pixelRatioCap: 1.25, particleCount: 54 }
    : { detail: 4, pixelRatioCap: 1.75, particleCount: 96 }
}

export interface SceneMood {
  lightness: number
  rotationSpeed: number
  particleLift: number
  scale: number
}

export function sceneMood(stage: MotionStage): SceneMood {
  const moods: Record<MotionStage, SceneMood> = {
    idea: { lightness: 0.82, rotationSpeed: 0.24, particleLift: 0.28, scale: 1 },
    writing: { lightness: 0.68, rotationSpeed: 0.45, particleLift: 0.5, scale: 1.08 },
    projects: { lightness: 0.56, rotationSpeed: 0.62, particleLift: 0.82, scale: 1.15 },
    signal: { lightness: 0.48, rotationSpeed: 0.36, particleLift: 0.82, scale: 0.94 },
  }
  return moods[stage]
}

export function sceneMoodAt(progress: number): SceneMood {
  const normalized = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0
  const stops = [
    { progress: 0, mood: sceneMood('idea') },
    { progress: MOTION_STAGE_BOUNDARIES[0], mood: sceneMood('writing') },
    { progress: MOTION_STAGE_BOUNDARIES[1], mood: sceneMood('projects') },
    { progress: MOTION_STAGE_BOUNDARIES[2], mood: sceneMood('signal') },
    { progress: 1, mood: sceneMood('signal') },
  ]

  for (let index = 1; index < stops.length; index += 1) {
    const to = stops[index]
    if (normalized > to.progress) continue
    const from = stops[index - 1]
    const range = to.progress - from.progress
    const amount = range > 0 ? smoothstep((normalized - from.progress) / range) : 1
    return {
      lightness: from.mood.lightness + (to.mood.lightness - from.mood.lightness) * amount,
      rotationSpeed: from.mood.rotationSpeed + (to.mood.rotationSpeed - from.mood.rotationSpeed) * amount,
      particleLift: from.mood.particleLift + (to.mood.particleLift - from.mood.particleLift) * amount,
      scale: from.mood.scale + (to.mood.scale - from.mood.scale) * amount,
    }
  }

  return sceneMood('signal')
}
