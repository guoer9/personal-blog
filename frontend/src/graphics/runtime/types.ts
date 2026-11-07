import type { DomAnchorRegistry } from './DomAnchorRegistry'

export type PageSceneId = 'home' | 'works' | 'work-detail' | 'about' | 'article' | 'archive' | 'library'
export type QualityTier = 'high' | 'balanced' | 'low'

export interface RouteVisualIdentity {
  readonly routeName: string
  readonly pageId: PageSceneId | null
  readonly params: Readonly<Record<string, string>>
}

export interface RendererAdapter {
  readonly domElement: HTMLCanvasElement
  setPixelRatio(value: number): void
  setSize(width: number, height: number, updateStyle?: boolean): void
  render(scene?: unknown, camera?: unknown): void
  setRenderTarget?(target: unknown | null): void
  getRenderTarget?(): unknown | null
  clear?(color?: boolean, depth?: boolean, stencil?: boolean): void
  dispose(): void
}

export interface Vector2 { readonly x: number; readonly y: number }

export interface VisualState {
  readonly timeMs: number
  readonly deltaSeconds: number
  readonly pointerX: number
  readonly pointerY: number
  readonly pointerPixelX: number
  readonly pointerPixelY: number
  readonly pointerVelocity: Vector2
  readonly scrollY: number
  readonly scrollVelocity: number
  readonly documentProgress: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly dpr: number
  readonly qualityTier: QualityTier
  readonly reducedMotion: boolean
  readonly documentHidden: boolean
  readonly canvasVisible: boolean
}

export interface EffectQueueAdapter {
  register(effect: unknown): void
  unregister(effect: unknown): void
}

export interface SceneContext {
  readonly renderer: RendererAdapter
  readonly anchors: DomAnchorRegistry
  readonly effects: EffectQueueAdapter
  getQualityTier(): QualityTier
  isReducedMotion(): boolean
}

export interface SceneRenderContext {
  readonly renderer: RendererAdapter
  readonly visualState: Readonly<VisualState>
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly dpr: number
}

export interface PageSceneModule<TPageState = unknown> {
  readonly id: PageSceneId
  mount(context: SceneContext): void
  enter(context: SceneContext, from?: PageSceneId): void
  leave(context: SceneContext, to?: PageSceneId): void
  update(visualState: Readonly<VisualState>, pageState: Readonly<TPageState>): void
  resize(width: number, height: number, dpr: number): void
  render(context: SceneRenderContext): void
  shouldAnimate?(): boolean
  dispose(): void
}

export interface PageSceneBridge<TPageState> {
  readonly anchors: DomAnchorRegistry
  setState(state: TPageState): void
  getState(): Readonly<TPageState>
  registerAnchor(id: string, element: HTMLElement): () => void
  clear(): void
}
