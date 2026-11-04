import { createVisualState } from './VisualState'
import type { PageSceneModule, RouteVisualIdentity, SceneContext, VisualState } from './types'

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
  private sequence = 0
  private visualState: VisualState = createVisualState()
  private readonly pageStates = new Map<string, unknown>()

  constructor(options: PageTransitionCoordinatorOptions) {
    this.context = options.context
    this.preload = options.preload
  }

  setTarget(identity: RouteVisualIdentity): number {
    this.sequence += 1
    this.target = identity
    if (this.preloaded && this.preloaded.sequence !== this.sequence) {
      this.preloaded.module.dispose()
      this.preloaded = null
    }
    return this.sequence
  }

  isCurrent(sequence: number): boolean { return sequence === this.sequence }
  getTarget(): RouteVisualIdentity | null { return this.target }
  getPreloadedPageId(): PageSceneModule['id'] | null { return this.preloaded?.module.id ?? null }
  getActiveModule(): PageSceneModule | null { return this.current }

  async preloadTarget(): Promise<PageSceneModule | null> {
    const target = this.target
    const sequence = this.sequence
    if (!target?.pageId) return null
    if (this.current?.id === target.pageId) return this.current
    if (this.preloaded?.sequence === sequence) return this.preloaded.module

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
    if (this.current && this.current.id !== this.target?.pageId) this.current.leave(this.context, this.target?.pageId ?? undefined)
  }

  afterLeave(): void {
    if (this.current && this.current.id !== this.target?.pageId) {
      this.current.dispose()
      this.current = null
      this.currentIdentity = null
    }
  }

  async afterEnter(): Promise<void> {
    const target = this.target
    if (!target?.pageId) return
    if (this.current?.id === target.pageId) {
      this.currentIdentity = target
      return
    }
    const module = this.preloaded?.sequence === this.sequence ? this.preloaded.module : await this.preloadTarget()
    if (!module || !this.isCurrent(this.sequence)) return
    this.preloaded = null
    module.mount(this.context)
    module.enter(this.context, this.currentIdentity?.pageId ?? undefined)
    this.current = module
    this.currentIdentity = target
  }

  setVisualState(state: VisualState): void { this.visualState = state }

  updatePageState(pageId: string, state: unknown): void {
    this.pageStates.set(pageId, state)
    if (this.current?.id === pageId) this.current.update(this.visualState, state as Readonly<Record<string, unknown>>)
  }

  updateFrame(state: VisualState): void {
    this.visualState = state
    if (this.current) this.current.update(state, this.pageStates.get(this.current.id) as Readonly<Record<string, unknown>>)
  }

  resize(width: number, height: number, dpr: number): void { this.current?.resize(width, height, dpr) }
  render(context: Parameters<PageSceneModule['render']>[0]): void { this.current?.render(context) }

  dispose(): void {
    this.current?.dispose()
    if (this.preloaded && this.preloaded.module !== this.current) this.preloaded.module.dispose()
    this.current = null
    this.preloaded = null
    this.target = null
  }
}
