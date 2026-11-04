import { DomAnchorRegistry } from './DomAnchorRegistry'
import { EffectQueue } from './EffectQueue'
import { PageTransitionCoordinator } from './PageTransitionCoordinator'
import { SceneRegistry } from './SceneRegistry'
import { createVisualState, normalizeVisualState } from './VisualState'
import type { PageSceneId, RendererAdapter, RouteVisualIdentity, SceneContext, VisualState } from './types'

export interface VisualRuntimeOptions {
  readonly sceneRegistry: SceneRegistry
  readonly createRenderer: (canvas: HTMLCanvasElement) => RendererAdapter
  readonly requestFrame?: (callback: FrameRequestCallback) => number
  readonly cancelFrame?: (id: number) => void
  readonly now?: () => number
}

const defaultRequestFrame = (callback: FrameRequestCallback): number => window.requestAnimationFrame(callback)
const defaultCancelFrame = (id: number): void => window.cancelAnimationFrame(id)

export class VisualRuntime {
  private readonly options: VisualRuntimeOptions
  private readonly requestFrame: (callback: FrameRequestCallback) => number
  private readonly cancelFrame: (id: number) => void
  private readonly now: () => number
  private readonly anchors = new DomAnchorRegistry()
  private readonly effects = new EffectQueue()
  private readonly targetState: VisualState = createVisualState()
  private state: VisualState = createVisualState()
  private coordinator: PageTransitionCoordinator | null = null
  private renderer: RendererAdapter | null = null
  private canvas: HTMLCanvasElement | null = null
  private frameId = 0
  private lastTime = 0
  private runningRequested = false
  private disposed = false
  private documentHidden = false
  private canvasVisible = true
  private readonly onVisibilityChange = (): void => {
    this.setDocumentHidden(document.hidden)
  }

  constructor(options: VisualRuntimeOptions) {
    this.options = options
    this.requestFrame = options.requestFrame ?? defaultRequestFrame
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame
    this.now = options.now ?? (() => performance.now())
  }

  mount(canvas: HTMLCanvasElement): void {
    if (this.disposed) return
    if (this.renderer) return
    this.canvas = canvas
    this.renderer = this.options.createRenderer(canvas)
    const context: SceneContext = {
      renderer: this.renderer,
      anchors: this.anchors,
      effects: this.effects,
      getQualityTier: () => this.state.qualityTier,
      isReducedMotion: () => this.state.reducedMotion,
    }
    this.coordinator = new PageTransitionCoordinator({
      context,
      preload: async (identity) => this.options.sceneRegistry.create(identity.pageId),
    })
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.setDocumentHidden(document.hidden)
  }

  start(): void {
    this.runningRequested = true
    this.scheduleIfNeeded()
  }

  stop(): void {
    this.runningRequested = false
    if (this.frameId) this.cancelFrame(this.frameId)
    this.frameId = 0
    this.lastTime = 0
  }

  setRoute(identity: RouteVisualIdentity): void {
    if (!this.coordinator || this.disposed) return
    const sequence = this.coordinator.setTarget(identity)
    void this.handoff(sequence)
  }

  setPageState(pageId: PageSceneId, state: unknown): void { this.coordinator?.updatePageState(pageId, state) }
  measureAnchors(): void { this.anchors.measure() }
  getVisualState(): Readonly<VisualState> { return { ...this.state, pointerVelocity: { ...this.state.pointerVelocity } } }
  setPointer(pointerX: number, pointerY: number): void { Object.assign(this.targetState, { pointerX, pointerY }) }
  setScroll(scrollY: number, documentProgress = this.targetState.documentProgress): void { Object.assign(this.targetState, { scrollY, documentProgress }) }
  setReducedMotion(reducedMotion: boolean): void { Object.assign(this.targetState, { reducedMotion }) }
  setDocumentHidden(documentHidden: boolean): void {
    this.documentHidden = documentHidden
    Object.assign(this.targetState, { documentHidden })
    if (documentHidden) this.stopFrameOnly()
    else this.scheduleIfNeeded()
  }
  setCanvasVisible(canvasVisible: boolean): void {
    this.canvasVisible = canvasVisible
    Object.assign(this.targetState, { canvasVisible })
    if (!canvasVisible) this.stopFrameOnly()
    else this.scheduleIfNeeded()
  }
  resize(width: number, height: number, dpr: number): void {
    if (!this.renderer) return
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
    this.coordinator?.resize(width, height, dpr)
    this.effects.resize(width, height, dpr)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.coordinator?.dispose()
    this.effects.dispose()
    this.renderer?.dispose()
    this.coordinator = null
    this.renderer = null
    this.canvas = null
  }

  private async handoff(sequence: number): Promise<void> {
    const coordinator = this.coordinator
    if (!coordinator) return
    await coordinator.preloadTarget()
    if (!coordinator.isCurrent(sequence)) return
    coordinator.beforeLeave()
    if (!coordinator.isCurrent(sequence)) return
    coordinator.afterLeave()
    await coordinator.afterEnter()
    if (!coordinator.isCurrent(sequence)) return
    const target = coordinator.getTarget()
    if (this.canvas) this.canvas.style.display = target?.pageId ? '' : 'none'
    this.scheduleIfNeeded()
  }

  private scheduleIfNeeded(): void {
    if (!this.runningRequested || this.frameId || !this.coordinator?.getActiveModule() || !this.canRender()) return
    this.frameId = this.requestFrame((time) => this.renderFrame(time))
  }

  private canRender(): boolean { return !this.disposed && !this.documentHidden && !document.hidden && this.canvasVisible }
  private stopFrameOnly(): void {
    if (this.frameId) this.cancelFrame(this.frameId)
    this.frameId = 0
    this.lastTime = 0
  }
  private renderFrame(time: number): void {
    this.frameId = 0
    if (!this.canRender() || !this.coordinator?.getActiveModule() || !this.renderer) return
    const deltaSeconds = this.lastTime ? Math.min(0.1, Math.max(0, (time - this.lastTime) / 1000)) : 1 / 60
    this.lastTime = time
    this.state = normalizeVisualState({ ...this.targetState, timeMs: time, deltaSeconds })
    this.coordinator.updateFrame(this.state)
    this.coordinator.render({ renderer: this.renderer, visualState: this.state, viewportWidth: this.state.viewportWidth, viewportHeight: this.state.viewportHeight, dpr: this.state.dpr })
    this.effects.render({ renderer: this.renderer, visualState: this.state, viewportWidth: this.state.viewportWidth, viewportHeight: this.state.viewportHeight, dpr: this.state.dpr })
    this.scheduleIfNeeded()
  }
}
