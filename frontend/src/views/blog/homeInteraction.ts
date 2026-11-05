import type { InjectionKey } from 'vue'
import type { HomeSphereInteraction, HomeSphereInteractionType } from '@/graphics/scenes/pageStates'

export interface HomeSphereInteractionOptions {
  longPressDurationMs: number
  allowableMovementCssPx: number
}

export const homeSphereInteractionOptionsKey: InjectionKey<HomeSphereInteractionOptions> = Symbol('home-sphere-interaction-options')

export const defaultHomeSphereInteractionOptions: HomeSphereInteractionOptions = {
  longPressDurationMs: 350,
  allowableMovementCssPx: 16,
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

export function createHomeSphereInteractionBridge({ options, emit, viewport = viewportSize }: HomeSphereInteractionBridgeOptions) {
  let active: ActivePointer | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let sequence = 0
  let suppressedClick: { x: number; y: number; time: number } | null = null
  let labelActivation: { control: HTMLElement; source: MouseEvent; time: number } | null = null

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const publish = (type: HomeSphereInteractionType, event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const point = toViewportNdc(event, viewport)
    sequence += 1
    emit({ sequence, type, ndcX: point.x, ndcY: point.y })
  }
  const cancel = () => {
    clearTimer()
    if (active?.longPressStarted) publish('press-end', { clientX: active.startX, clientY: active.startY })
    active = null
    suppressedClick = null
    labelActivation = null
  }
  const isControl = (event: Event) => (event.target as Element | null)?.closest?.('a, button, input, textarea, select, label, summary, [contenteditable]:not([contenteditable="false"]), [role="button"]')

  return {
    onPointerDown(event: PointerEvent) {
      if (event.isPrimary === false) { cancel(); return }
      if (active || (event.button !== undefined && event.button !== 0)) return
      suppressedClick = null
      labelActivation = null
      if (isControl(event)) return
      const id = pointerId(event)
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
        if (active.pointerType === 'touch' && Math.abs(deltaY) >= Math.abs(deltaX)) { cancel(); return }
        active.dragging = true
      }
      if (active.dragging) publish('drag', event)
    },
    onPointerUp(event: PointerEvent) {
      if (!active || active.id !== pointerId(event)) return
      clearTimer()
      if (active.longPressStarted) publish('press-end', event)
      if (active.longPressStarted || active.dragging) suppressedClick = { x: event.clientX, y: event.clientY, time: Date.now() }
      active = null
    },
    onPointerCancel(event: PointerEvent) {
      if (active?.id === pointerId(event)) cancel()
    },
    onMouseDown(event: MouseEvent) {
      if (event.detail > 1 && !isControl(event)
        && (event.target as Element | null)?.closest?.('.hero h1, .hero-visual')) event.preventDefault()
    },
    onContextMenu(event: MouseEvent) {
      if (active && !isControl(event) && (event.target as Element | null)?.closest?.('.hero')) event.preventDefault()
    },
    onClickCapture(event: MouseEvent) {
      const activation = labelActivation
      labelActivation = null
      if (activation && event.target === activation.control
        && Date.now() - activation.time < 300
        && ((event.detail === 0 && event.clientX === 0 && event.clientY === 0)
          || (event.detail === activation.source.detail && event.clientX === activation.source.clientX && event.clientY === activation.source.clientY))) return
      const label = (event.target as Element | null)?.closest?.('label') as HTMLLabelElement | null
      if (label?.control && label.control !== event.target) labelActivation = { control: label.control, source: event, time: Date.now() }
      const suppressed = suppressedClick
      suppressedClick = null
      if (suppressed && event.detail > 0 && Date.now() - suppressed.time < 800
        && Math.hypot(event.clientX - suppressed.x, event.clientY - suppressed.y) < 24) return
      const point = event.detail === 0 && event.clientX === 0 && event.clientY === 0
        ? { clientX: viewport().width / 2, clientY: viewport().height / 2 }
        : event
      publish('tap', point)
    },
    cancel,
    dispose: cancel,
  }
}
