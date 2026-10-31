export function damp(current: number, target: number, lambda: number, deltaSeconds: number): number {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0
  if (!Number.isFinite(target) || !Number.isFinite(lambda) || deltaSeconds <= 0) return current
  return target + (current - target) * Math.exp(-Math.max(0, lambda) * deltaSeconds)
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
  if (normalized < 0.18) return 'idea'
  if (normalized < 0.48) return 'writing'
  if (normalized < 0.78) return 'projects'
  return 'signal'
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
