import type { InjectionKey } from 'vue'
import type { HomeSphereInteraction, HomeSphereInteractionType } from '@/graphics/scenes/pageStates'

export interface HomeSphereInteractionOptions {
  longPressDurationMs: number
  allowableMovementCssPx: number
}

export const homeSphereInteractionOptionsKey: InjectionKey<HomeSphereInteractionOptions> = Symbol('home-sphere-interaction-options')

export const defaultHomeSphereInteractionOptions: HomeSphereInteractionOptions = {
  longPressDurationMs: 520,
  allowableMovementCssPx: 12,
}

interface ActivePointer {
  id: number
  startX: number
  startY: number
  longPressStarted: boolean
  cancelled: boolean
}

interface HomeSphereInteractionBridgeOptions {
  options: HomeSphereInteractionOptions
  emit: (interaction: HomeSphereInteraction) => void
  viewport?: () => { width: number; height: number }
}

function pointerId(event: PointerEvent): number { return Number.isFinite(event.pointerId) ? event.pointerId : 1 }

function viewportSize(): { width: number; height: number } {
  return {
    width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
    height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1),
  }
}

function toViewportNdc(event: PointerEvent, viewport: () => { width: number; height: number }): { x: number; y: number } {
  const { width, height } = viewport()
  return {
    x: Math.min(1, Math.max(-1, (event.clientX / Math.max(1, width)) * 2 - 1)),
    y: Math.min(1, Math.max(-1, -((event.clientY / Math.max(1, height)) * 2 - 1))),
  }
}

export function createHomeSphereInteractionBridge({ options, emit, viewport = viewportSize }: HomeSphereInteractionBridgeOptions) {
  let active: ActivePointer | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let sequence = 0
  let suppressNextClick = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const publish = (type: HomeSphereInteractionType, event: PointerEvent) => {
    const point = toViewportNdc(event, viewport)
    sequence += 1
    emit({ sequence, type, ndcX: point.x, ndcY: point.y })
  }

  const cancelActive = (event?: PointerEvent) => {
    if (!active) return
    clearTimer()
    if (active.longPressStarted && event) {
      publish('press-end', event)
      suppressNextClick = true
    }
    active = null
  }

  return {
    onPointerDown(event: PointerEvent) {
      if (active || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return
      const id = pointerId(event)
      active = { id, startX: event.clientX, startY: event.clientY, longPressStarted: false, cancelled: false }
      timer = setTimeout(() => {
        if (!active || active.id !== id || active.cancelled) return
        active.longPressStarted = true
        publish('press-start', event)
      }, Math.max(0, options.longPressDurationMs))
    },
    onPointerMove(event: PointerEvent) {
      if (!active || active.id !== pointerId(event)) return
      const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY)
      if (distance <= Math.max(0, options.allowableMovementCssPx)) return
      active.cancelled = true
      cancelActive(event)
    },
    onPointerUp(event: PointerEvent) {
      if (!active || active.id !== pointerId(event)) return
      clearTimer()
      if (!active.cancelled) {
        if (active.longPressStarted) {
          publish('press-end', event)
          suppressNextClick = true
        } else {
          publish('tap', event)
        }
      }
      active = null
    },
    onPointerCancel(event: PointerEvent) { cancelActive(event) },
    onPointerLeave(event: PointerEvent) {
      if (active && !active.longPressStarted) cancelActive(event)
    },
    onClickCapture(event: MouseEvent) {
      if (!suppressNextClick) return
      suppressNextClick = false
      event.preventDefault()
      event.stopPropagation()
    },
    dispose() {
      clearTimer()
      active = null
      suppressNextClick = false
    },
  }
}
