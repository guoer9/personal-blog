import { createLiquidScene, type LiquidSceneController } from '@/graphics/liquidScene'
import type { HomePageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'
import { createPortraitEffect, type PortraitEffectController } from './PortraitEffect'
import type { AudioFeatures } from '@/audio/performanceAudio'

export class HomeScene implements PageSceneModule<HomePageState> {
  readonly id = 'home' as const
  private controller: LiquidSceneController | null = null
  private portrait: PortraitEffectController | null = null
  private pageState: HomePageState = { paused: false, interaction: null }
  private lastInteractionSequence = 0
  constructor(private readonly audio?: AudioFeatures, private readonly portraits = true) {}

  mount(context: SceneContext): void {
    this.controller = createLiquidScene(context.renderer, {
      pointerX: 0,
      pointerY: 0,
      pointerPixelX: 0,
      pointerPixelY: 0,
      pointerVelocity: { x: 0, y: 0 },
      scroll: 0,
    })
    if (this.portraits) this.portrait = createPortraitEffect(context)
  }
  enter(): void {}
  leave(): void {}
  update(visualState: Readonly<VisualState>, pageState: Readonly<HomePageState>): void {
    this.pageState = { ...(pageState || { paused: false, interaction: null }) }
    this.portrait?.update(visualState, this.pageState.portraitMode ?? 'front', !this.pageState.paused && Boolean(this.pageState.portraitPointerActive), this.pageState.portraitExitProgress ?? 0)
    this.controller?.setQualityTier(visualState.qualityTier)
    this.controller?.setInput({
      pointerX: visualState.pointerX,
      pointerY: visualState.pointerY,
      pointerPixelX: visualState.pointerPixelX,
      pointerPixelY: visualState.pointerPixelY,
      pointerVelocity: visualState.pointerVelocity,
      scroll: this.pageState.sceneProgress ?? visualState.documentProgress,
      ...(this.audio ? { audio: this.audio } : {}),
    })
    const interaction = this.pageState.interaction
    if (!interaction || interaction.sequence <= this.lastInteractionSequence) return
    this.lastInteractionSequence = interaction.sequence
    if (interaction.type === 'press-end') {
      this.controller?.endPress?.()
      return
    }
    if (this.pageState.paused || visualState.reducedMotion) return
    if (interaction.type === 'tap' || interaction.type === 'drag') this.controller?.triggerRipple?.(interaction.ndcX, interaction.ndcY)
    if (interaction.type === 'press-start') this.controller?.beginPress?.(interaction.ndcX, interaction.ndcY)
  }
  resize(width: number, height: number, dpr: number): void {
    this.controller?.resize(width, height, dpr)
    this.portrait?.resize(width, height, dpr)
  }
  render(context: SceneRenderContext): void {
    if (this.pageState.paused || context.visualState.reducedMotion) return
    this.controller?.render(context.visualState.timeMs)
    this.portrait?.render()
  }
  shouldAnimate(): boolean { return !this.pageState.paused }
  dispose(): void {
    try { this.portrait?.dispose() }
    finally { this.portrait = null; this.controller?.dispose(); this.controller = null }
  }
}
