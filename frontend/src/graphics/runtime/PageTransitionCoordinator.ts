import { createVisualState } from './VisualState'
import type { PageSceneModule, RouteVisualIdentity, SceneContext, VisualState } from './types'
import { initialPageSceneStates } from '../scenes/pageStates'

export interface PageTransitionCoordinatorOptions {
  readonly context: SceneContext
  readonly preload: (identity: RouteVisualIdentity) => PageSceneModule | null | Promise<PageSceneModule | null>
}

export class PageTransitionCoordinator {
  private readonly context: SceneContext
  private readonly preload: PageTransitionCoordinatorOptions['preload']
  private target: RouteVisualIdentity | null = null
  private current: PageSceneModule | null = null
  private currentIdentity: RouteVisualIdentity | null = null
  private preloaded: { sequence: number; identity: RouteVisualIdentity; module: PageSceneModule } | null = null
  private inFlight: { sequence: number; promise: Promise<PageSceneModule | null> } | null = null
  private sequence = 0
  private suspended = false
  private leavingCurrent = false
  private visualState: VisualState = createVisualState()
  private readonly pageStates = new Map<string, unknown>()
  private viewport = { width: 0, height: 0, dpr: 1 }

  constructor(options: PageTransitionCoordinatorOptions) {
    this.context = options.context
    this.preload = options.preload
  }

  setTarget(identity: RouteVisualIdentity): number {
    this.sequence += 1
    this.suspended = false
    this.target = identity
    if (this.preloaded && this.preloaded.sequence !== this.sequence) {
      this.preloaded.module.dispose()
      this.preloaded = null
    }
    return this.sequence
  }

  isCurrent(sequence: number): boolean { return sequence === this.sequence }
  getSequence(): number { return this.sequence }
  getTarget(): RouteVisualIdentity | null { return this.target }
  getPreloadedPageId(): PageSceneModule['id'] | null { return this.preloaded?.module.id ?? null }
  getActiveModule(): PageSceneModule | null { return this.current }

  async preloadTarget(): Promise<PageSceneModule | null> {
    const target = this.target
    const sequence = this.sequence
    if (!target?.pageId) return null
    if (this.current?.id === target.pageId) return this.current
    if (this.preloaded?.sequence === sequence) return this.preloaded.module
    if (this.inFlight?.sequence === sequence) return this.inFlight.promise

    const promise = this.loadTarget(target, sequence)
    this.inFlight = { sequence, promise }
    try { return await promise }
    finally { if (this.inFlight?.promise === promise) this.inFlight = null }
  }

  private async loadTarget(target: RouteVisualIdentity, sequence: number): Promise<PageSceneModule | null> {
    const module = await this.preload(target)
    if (!module) return null
    if (sequence !== this.sequence || this.target?.pageId !== target.pageId) {
      module.dispose()
      return null
    }
    this.preloaded = { sequence, identity: target, module }
    return module
  }

  beforeLeave(): void {
    if (this.current && this.current.id !== this.target?.pageId && !this.leavingCurrent) {
      this.current.leave(this.context, this.target?.pageId ?? undefined)
      this.leavingCurrent = true
    }
  }

  afterLeave(): void {
    if (this.current && this.current.id !== this.target?.pageId) {
      this.current.dispose()
      this.current = null
      this.currentIdentity = null
      this.leavingCurrent = false
    }
  }

  async afterEnter(): Promise<void> {
    if (this.suspended) return
    const target = this.target
    const sequence = this.sequence
    if (!target?.pageId) return
    if (this.current?.id === target.pageId) {
      if (this.leavingCurrent) this.current.enter(this.context, this.currentIdentity?.pageId ?? undefined)
      this.leavingCurrent = false
      this.currentIdentity = target
      return
    }
    const module = this.preloaded?.sequence === this.sequence ? this.preloaded.module : await this.preloadTarget()
    if (!module || !this.isCurrent(sequence)) return
    this.preloaded = null
    try {
      module.mount(this.context)
      module.enter(this.context, this.currentIdentity?.pageId ?? undefined)
      module.resize(this.viewport.width, this.viewport.height, this.viewport.dpr)
      module.update(this.visualState, this.getPageState(module.id))
      this.current = module
      this.currentIdentity = target
      this.leavingCurrent = false
    } catch (error) {
      module.dispose()
      throw error
    }
  }

  setVisualState(state: VisualState): void { this.visualState = state }

  updatePageState(pageId: string, state: unknown): void {
    this.pageStates.set(pageId, state)
    if (this.current?.id === pageId) this.current.update(this.visualState, state as Readonly<Record<string, unknown>>)
  }

  updateFrame(state: VisualState): void {
    this.visualState = state
    if (this.current) this.current.update(state, this.getPageState(this.current.id))
  }

  resize(width: number, height: number, dpr: number): void {
    this.viewport = { width, height, dpr }
    this.current?.resize(width, height, dpr)
  }
  render(context: Parameters<PageSceneModule['render']>[0]): void { this.current?.render(context) }

  private getPageState(pageId: PageSceneModule['id']): Readonly<Record<string, unknown>> {
    return (this.pageStates.get(pageId) ?? initialPageSceneStates[pageId]) as Readonly<Record<string, unknown>>
  }

  suspend(): void {
    this.sequence += 1
    this.suspended = true
    const current = this.current
    const preloaded = this.preloaded?.module
    this.current = null
    this.currentIdentity = null
    this.preloaded = null
    this.leavingCurrent = false
    try { current?.leave(this.context, undefined) } catch { /* best effort after a scene failure */ }
    try { current?.dispose() } catch { /* best effort after a scene failure */ }
    if (preloaded && preloaded !== current) {
      try { preloaded.dispose() } catch { /* best effort after a scene failure */ }
    }
  }

  async resume(): Promise<boolean> {
    const target = this.target
    const sequence = this.sequence
    if (!target?.pageId) return false
    let module: PageSceneModule | null = null
    try {
      module = await this.preload(target)
      if (!module || sequence !== this.sequence || this.target !== target) {
        module?.dispose()
        return false
      }
      module.mount(this.context)
      module.enter(this.context)
      module.resize(this.viewport.width, this.viewport.height, this.viewport.dpr)
      module.update(this.visualState, this.getPageState(module.id))
      this.current = module
      this.currentIdentity = target
      this.suspended = false
      return true
    } catch (error) {
      module?.dispose()
      throw error
    }
  }

  dispose(): void {
    this.suspend()
    this.target = null
  }
}
