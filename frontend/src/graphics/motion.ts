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
