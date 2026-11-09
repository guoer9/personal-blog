import type { InjectionKey } from 'vue'

export interface PageScrollFrame {
  readonly scrollY: number
  readonly viewportHeight: number
  readonly timeMs: number
}

/** One scroll position shared by DOM choreography and the existing VisualState. */
export function createPageScroll() {
  let current: PageScrollFrame = { scrollY: 0, viewportHeight: 1, timeMs: 0 }
  let dirty = true
  const listeners = new Set<(frame: PageScrollFrame) => void>()
  return {
    get current() { return current },
    get dirty() { return dirty },
    /** Request fresh geometry on the existing frame loop, even without scrolling. */
    invalidate() { dirty = true },
    publish(frame: PageScrollFrame) {
      current = frame
      // A listener may invalidate again; retain that request for the next frame.
      dirty = false
      for (const listener of listeners) listener(current)
    },
    subscribe(listener: (frame: PageScrollFrame) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    clear() { listeners.clear(); dirty = false },
  }
}

export type PageScroll = ReturnType<typeof createPageScroll>
export const pageScrollKey: InjectionKey<PageScroll> = Symbol('page-scroll')
