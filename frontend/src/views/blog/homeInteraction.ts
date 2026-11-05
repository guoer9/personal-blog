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
  dragging: boolean
  pointerType: string
}

interface HomeSphereInteractionBridgeOptions {
  options: HomeSphereInteractionOptions
  emit: (interaction: HomeSphereInteraction) => void
  onGestureActive?: (active: boolean) => void
  viewport?: () => { width: number; height: number }
}

function pointerId(event: PointerEvent): number { return Number.isFinite(event.pointerId) ? event.pointerId : 1 }

function viewportSize(): { width: number; height: number } {
  return {
    width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
    height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1),
  }
}

function toViewportNdc(event: Pick<PointerEvent, 'clientX' | 'clientY'>, viewport: () => { width: number; height: number }): { x: number; y: number } {
  const { width, height } = viewport()
  return {
    x: Math.min(1, Math.max(-1, (event.clientX / Math.max(1, width)) * 2 - 1)),
    y: Math.min(1, Math.max(-1, -((event.clientY / Math.max(1, height)) * 2 - 1))),
  }
}

export function createHomeSphereInteractionBridge({ options, emit, onGestureActive, viewport = viewportSize }: HomeSphereInteractionBridgeOptions) {
  let active: ActivePointer | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let gestureTimer: ReturnType<typeof setTimeout> | null = null
  let sequence = 0
  let suppressNextClick = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const publish = (type: HomeSphereInteractionType, event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const point = toViewportNdc(event, viewport)
    sequence += 1
    emit({ sequence, type, ndcX: point.x, ndcY: point.y })
  }

  const finishGesture = () => {
    if (gestureTimer !== null) clearTimeout(gestureTimer)
    gestureTimer = setTimeout(() => {
      gestureTimer = null
      onGestureActive?.(false)
    }, 100)
  }

  const cancelActive = (event?: PointerEvent, suppressClick = false) => {
    if (!active) return
    clearTimer()
    if (active.longPressStarted && event) {
      publish('press-end', event)
      suppressNextClick = suppressClick
    }
    active = null
    finishGesture()
  }

  return {
    onPointerDown(event: PointerEvent) {
      if (active || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return
      suppressNextClick = false
      const eventTarget = event.target as Element | null
      if (eventTarget?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (gestureTimer !== null) clearTimeout(gestureTimer)
      gestureTimer = null
      onGestureActive?.(true)
      const id = pointerId(event)
      const target = event.currentTarget as (HTMLElement & { setPointerCapture?: (pointerId: number) => void }) | null
      try { target?.setPointerCapture?.(id) } catch { /* The browser may have ended the pointer stream. */ }
      active = { id, startX: event.clientX, startY: event.clientY, longPressStarted: false, dragging: false, pointerType: event.pointerType || 'mouse' }
      timer = setTimeout(() => {
        if (!active || active.id !== id || active.dragging) return
        active.longPressStarted = true
        publish('press-start', event)
      }, Math.max(0, options.longPressDurationMs))
    },
    onPointerMove(event: PointerEvent) {
      if (!active || active.id !== pointerId(event)) return
      const deltaX = event.clientX - active.startX
      const deltaY = event.clientY - active.startY
      if (!active.dragging && Math.hypot(deltaX, deltaY) > Math.max(0, options.allowableMovementCssPx)) {
        clearTimer()
        if (active.longPressStarted) publish('press-end', event)
        active.longPressStarted = false
        if (active.pointerType === 'touch' && Math.abs(deltaY) >= Math.abs(deltaX)) {
          active = null
          finishGesture()
          return
        }
        active.dragging = true
      }
      if (active.dragging) publish('drag', event)
    },
    onPointerUp(event: PointerEvent) {
      if (!active || active.id !== pointerId(event)) return
      clearTimer()
      if (active.longPressStarted) {
        publish('press-end', event)
        suppressNextClick = true
      }
      active = null
      finishGesture()
    },
    onPointerCancel(event: PointerEvent) {
      suppressNextClick = false
      cancelActive(event)
    },
    onClickCapture(event: MouseEvent) {
      if (suppressNextClick) {
        suppressNextClick = false
        return
      }
      const point = event.detail === 0 && event.clientX === 0 && event.clientY === 0
        ? { clientX: viewport().width / 2, clientY: viewport().height / 2 }
        : event
      publish('tap', point)
    },
    dispose() {
      clearTimer()
      if (gestureTimer !== null) clearTimeout(gestureTimer)
      onGestureActive?.(false)
      gestureTimer = null
      active = null
      suppressNextClick = false
    },
  }
}
