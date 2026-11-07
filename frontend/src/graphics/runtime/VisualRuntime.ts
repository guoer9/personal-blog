import { DomAnchorRegistry } from './DomAnchorRegistry'
import { EffectQueue } from './EffectQueue'
import { PageTransitionCoordinator } from './PageTransitionCoordinator'
import { SceneRegistry } from './SceneRegistry'
import { createVisualState, normalizeVisualState } from './VisualState'
import type { PageSceneId, RendererAdapter, RouteVisualIdentity, SceneContext, VisualState } from './types'
import { frameTimeEma, resolveQualityState, type QualityState } from '../quality'
import { clamp, damp } from '../motion'

export interface VisualRuntimeOptions {
  readonly sceneRegistry: SceneRegistry
  readonly createRenderer: (canvas: HTMLCanvasElement) => RendererAdapter
  readonly requestFrame?: (callback: FrameRequestCallback) => number
  readonly cancelFrame?: (id: number) => void
  readonly now?: () => number
  readonly onFallbackChange?: (fallback: boolean) => void
}

export interface VisualRuntimeDiagnostics {
  readonly activePageId: PageSceneId | null
  readonly rendererCount: 0 | 1
  readonly rafActive: boolean
  readonly qualityTier: QualityState['tier']
  readonly contextLost: boolean
  readonly frameTimeMs: number
  readonly fallback: boolean
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
  private readonly pointerVelocityTarget = { x: 0, y: 0 }
  private pointerVelocity = { x: 0, y: 0 }
  private lastPointerSample: { x: number; y: number; timeMs: number } | null = null
  private coordinator: PageTransitionCoordinator | null = null
  private renderer: RendererAdapter | null = null
  private canvas: HTMLCanvasElement | null = null
  private frameId = 0
  private lastTime = 0
  private runningRequested = false
  private disposed = false
  private documentHidden = false
  private canvasVisible = true
  private contextLost = false
  private fallback = false
  private viewport = { width: 0, height: 0, dpr: 1 }
  private averageFrameTimeMs = 0
  private qualityState: QualityState = { tier: 'high', slowFrames: 0, fastFrames: 0 }
  private readonly onVisibilityChange = (): void => {
    this.setDocumentHidden(document.hidden)
  }
  private readonly onContextLost = (event: Event): void => {
    if (this.disposed) return
    event.preventDefault()
    this.contextLost = true
    this.stopFrameOnly()
    this.coordinator?.suspend()
    this.setFallback(true)
  }
  private readonly onContextRestored = (): void => { void this.restoreContext() }

  constructor(options: VisualRuntimeOptions) {
    this.options = options
    this.requestFrame = options.requestFrame ?? defaultRequestFrame
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame
    this.now = options.now ?? (() => performance.now())
  }

  mount(canvas: HTMLCanvasElement): void {
    if (this.disposed) return
    if (this.renderer || this.canvas) return
    this.canvas = canvas
    try {
      this.renderer = this.options.createRenderer(canvas)
    } catch {
      this.setFallback(true)
      return
    }
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
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)
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
    if (this.fallback || this.contextLost) return
    void this.coordinator.preloadTarget().catch(() => this.failCurrentHandoff(sequence))
    if (this.coordinator.getActiveModule()?.id === identity.pageId) {
      void this.coordinator.afterEnter().then(() => {
        if (!this.coordinator?.isCurrent(sequence)) return
        this.syncCanvasVisibility()
        this.scheduleIfNeeded()
      }).catch(() => this.failCurrentHandoff(sequence))
    }
  }

  beginTransitionLeave(): void {
    try { this.coordinator?.beforeLeave() } catch { this.activateFallback() }
  }

  finishTransitionLeave(): void {
    try {
      this.coordinator?.afterLeave()
      this.syncCanvasVisibility()
      if (!this.coordinator?.getActiveModule()) this.stopFrameOnly()
    } catch { this.activateFallback() }
  }

  async finishTransitionEnter(): Promise<void> {
    const coordinator = this.coordinator
    if (!coordinator || this.disposed || this.fallback || this.contextLost) return
    const sequence = coordinator.getSequence()
    try {
      await coordinator.afterEnter()
      if (!coordinator.isCurrent(sequence)) return
      this.syncCanvasVisibility()
      this.scheduleIfNeeded()
    } catch { this.failCurrentHandoff(sequence) }
  }

  setPageState(pageId: PageSceneId, state: unknown): void {
    try {
      this.coordinator?.updatePageState(pageId, state)
      const activeModule = this.coordinator?.getActiveModule()
      if (activeModule?.shouldAnimate?.() === false) this.stopFrameOnly()
      else this.scheduleIfNeeded()
    } catch { this.activateFallback() }
  }
  registerAnchor(id: string, element: HTMLElement): () => void { return this.anchors.register(id, element) }
  measureAnchors(): void { this.anchors.measure() }
  getVisualState(): Readonly<VisualState> { return { ...this.state, pointerVelocity: { ...this.state.pointerVelocity } } }
  setPointer(pointerX: number, pointerY: number, pointerPixelX?: number, pointerPixelY?: number): void {
    const nextPointerX = clamp(Number.isFinite(pointerX) ? pointerX : 0, -1, 1)
    const nextPointerY = clamp(Number.isFinite(pointerY) ? pointerY : 0, -1, 1)
    const now = this.now()
    if (this.lastPointerSample) {
      const elapsedSeconds = Math.max(1 / 240, (now - this.lastPointerSample.timeMs) / 1000)
      this.pointerVelocityTarget.x = clamp((nextPointerX - this.lastPointerSample.x) / elapsedSeconds, -6, 6)
      this.pointerVelocityTarget.y = clamp((nextPointerY - this.lastPointerSample.y) / elapsedSeconds, -6, 6)
    }
    this.lastPointerSample = { x: nextPointerX, y: nextPointerY, timeMs: now }
    const resolvedPixelX = Number.isFinite(pointerPixelX)
      ? Math.max(0, Number(pointerPixelX))
      : ((nextPointerX + 1) * 0.5) * this.viewport.width
    const resolvedPixelY = Number.isFinite(pointerPixelY)
      ? Math.max(0, Number(pointerPixelY))
      : ((1 - nextPointerY) * 0.5) * this.viewport.height
    Object.assign(this.targetState, {
      pointerX: nextPointerX,
      pointerY: nextPointerY,
      pointerPixelX: resolvedPixelX,
      pointerPixelY: resolvedPixelY,
    })
  }
  setScroll(scrollY: number, documentProgress = this.targetState.documentProgress): void { Object.assign(this.targetState, { scrollY, documentProgress }) }
  setReducedMotion(reducedMotion: boolean): void {
    if (reducedMotion) {
      this.pointerVelocityTarget.x = 0
      this.pointerVelocityTarget.y = 0
    }
    Object.assign(this.targetState, { reducedMotion })
    this.state = normalizeVisualState({ ...this.state, reducedMotion })
    this.coordinator?.setVisualState(this.state)
    this.coordinator?.updateFrame(this.state)
    this.syncCanvasVisibility()
    if (reducedMotion) this.stopFrameOnly()
    else this.scheduleIfNeeded()
  }
  setDocumentHidden(documentHidden: boolean): void {
    this.documentHidden = documentHidden
    Object.assign(this.targetState, { documentHidden })
    this.state = normalizeVisualState({ ...this.state, documentHidden })
    this.coordinator?.setVisualState(this.state)
    if (documentHidden) this.stopFrameOnly()
    else this.scheduleIfNeeded()
  }
  setCanvasVisible(canvasVisible: boolean): void {
    this.canvasVisible = canvasVisible
    Object.assign(this.targetState, { canvasVisible })
    this.state = normalizeVisualState({ ...this.state, canvasVisible })
    this.coordinator?.setVisualState(this.state)
    this.syncCanvasVisibility()
    if (!canvasVisible) this.stopFrameOnly()
    else this.scheduleIfNeeded()
  }
  resize(width: number, height: number, dpr: number): void {
    this.viewport = {
      width: Number.isFinite(width) ? Math.max(0, width) : 0,
      height: Number.isFinite(height) ? Math.max(0, height) : 0,
      dpr: Number.isFinite(dpr) ? Math.max(1, dpr) : 1,
    }
    this.applyRendererSize()
  }

  get isFallback(): boolean { return this.fallback }
  getDiagnostics(): VisualRuntimeDiagnostics {
    return {
      activePageId: this.coordinator?.getActiveModule()?.id ?? null,
      rendererCount: this.renderer ? 1 : 0,
      rafActive: this.frameId !== 0,
      qualityTier: this.state.qualityTier,
      contextLost: this.contextLost,
      frameTimeMs: this.averageFrameTimeMs,
      fallback: this.fallback,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.canvas?.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas?.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.coordinator?.dispose()
    this.effects.dispose()
    this.renderer?.dispose()
    this.coordinator = null
    this.renderer = null
    this.canvas = null
  }

  private failCurrentHandoff(sequence: number): void {
    if (this.coordinator?.isCurrent(sequence)) this.activateFallback()
  }

  private scheduleIfNeeded(): void {
    const activeModule = this.coordinator?.getActiveModule()
    if (!this.runningRequested || this.frameId || !activeModule || activeModule.shouldAnimate?.() === false || !this.canRender() || this.state.reducedMotion) return
    this.frameId = this.requestFrame((time) => this.renderFrame(time))
  }

  private canRender(): boolean { return !this.disposed && !this.fallback && !this.contextLost && !this.documentHidden && !document.hidden && this.canvasVisible && !this.state.reducedMotion }
  private stopFrameOnly(): void {
    if (this.frameId) this.cancelFrame(this.frameId)
    this.frameId = 0
    this.lastTime = 0
  }
  private renderFrame(time: number): void {
    this.frameId = 0
    if (!this.canRender() || !this.coordinator?.getActiveModule() || !this.renderer) return
    const frameTime = Number.isFinite(time) ? time : this.now()
    const deltaSeconds = this.lastTime ? Math.min(0.1, Math.max(0, (frameTime - this.lastTime) / 1000)) : 1 / 60
    this.lastTime = frameTime
    try {
      this.averageFrameTimeMs = frameTimeEma(this.averageFrameTimeMs, deltaSeconds * 1000)
      this.qualityState = resolveQualityState(this.qualityState, this.averageFrameTimeMs)
      const previousTier = this.state.qualityTier
      this.pointerVelocity.x = damp(this.pointerVelocity.x, this.pointerVelocityTarget.x, 12, deltaSeconds)
      this.pointerVelocity.y = damp(this.pointerVelocity.y, this.pointerVelocityTarget.y, 12, deltaSeconds)
      this.pointerVelocityTarget.x = damp(this.pointerVelocityTarget.x, 0, 8, deltaSeconds)
      this.pointerVelocityTarget.y = damp(this.pointerVelocityTarget.y, 0, 8, deltaSeconds)
      this.state = normalizeVisualState({
        ...this.targetState,
        pointerVelocity: this.pointerVelocity,
        timeMs: frameTime,
        deltaSeconds,
        viewportWidth: this.viewport.width,
        viewportHeight: this.viewport.height,
        dpr: this.effectiveDpr(),
        qualityTier: this.qualityState.tier,
      })
      if (previousTier !== this.state.qualityTier) this.applyRendererSize()
      this.coordinator.updateFrame(this.state)
      const context = { renderer: this.renderer, visualState: this.state, viewportWidth: this.state.viewportWidth, viewportHeight: this.state.viewportHeight, dpr: this.state.dpr }
      this.coordinator.render(context)
      this.effects.render(context)
      this.scheduleIfNeeded()
    } catch {
      this.activateFallback()
    }
  }

  private effectiveDpr(): number {
    const cap = this.qualityState.tier === 'low' ? 1 : this.qualityState.tier === 'balanced' ? 1.5 : 2
    return Math.max(1, Math.min(this.viewport.dpr, cap))
  }

  private applyRendererSize(): void {
    const dpr = this.effectiveDpr()
    Object.assign(this.targetState, { viewportWidth: this.viewport.width, viewportHeight: this.viewport.height, dpr })
    this.state = normalizeVisualState({
      ...this.state,
      viewportWidth: this.viewport.width,
      viewportHeight: this.viewport.height,
      dpr,
      qualityTier: this.qualityState.tier,
    })
    this.coordinator?.setVisualState(this.state)
    try {
      if (this.renderer) {
        this.renderer.setPixelRatio(dpr)
        this.renderer.setSize(this.viewport.width, this.viewport.height, false)
      }
      this.coordinator?.resize(this.viewport.width, this.viewport.height, dpr)
      this.effects.resize(this.viewport.width, this.viewport.height, dpr)
    } catch {
      this.activateFallback()
    }
  }

  private activateFallback(): void {
    this.stopFrameOnly()
    this.coordinator?.suspend()
    this.setFallback(true)
  }

  private setFallback(fallback: boolean): void {
    if (this.fallback === fallback) {
      this.syncCanvasVisibility()
      return
    }
    this.fallback = fallback
    this.options.onFallbackChange?.(fallback)
    this.syncCanvasVisibility()
  }

  private syncCanvasVisibility(): void {
    if (!this.canvas) return
    const show = Boolean(this.coordinator?.getActiveModule()) && !this.fallback && !this.contextLost && !this.state.reducedMotion && this.canvasVisible
    this.canvas.style.display = show ? '' : 'none'
  }

  private async restoreContext(): Promise<void> {
    if (this.disposed || !this.contextLost || !this.coordinator) return
    try {
      const target = this.coordinator.getTarget()
      const restored = target?.pageId ? await this.coordinator.resume() : true
      if (!restored) throw new Error('Unable to restore the active page scene')
      this.contextLost = false
      this.setFallback(false)
      this.scheduleIfNeeded()
    } catch {
      this.setFallback(true)
    }
  }
}
