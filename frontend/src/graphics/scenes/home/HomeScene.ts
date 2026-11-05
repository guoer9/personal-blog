import { createLiquidScene, type LiquidSceneController } from '@/graphics/liquidScene'
import type { HomePageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'

export class HomeScene implements PageSceneModule<HomePageState> {
  readonly id = 'home' as const
  private controller: LiquidSceneController | null = null
  private pageState: HomePageState = { paused: false, interaction: null }
  private lastInteractionSequence = 0

  mount(context: SceneContext): void {
    this.controller = createLiquidScene(context.renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 })
  }
  enter(): void {}
  leave(): void {}
  update(visualState: Readonly<VisualState>, pageState: Readonly<HomePageState>): void {
    this.pageState = { ...(pageState || { paused: false, interaction: null }) }
    this.controller?.setQualityTier(visualState.qualityTier)
    this.controller?.setInput({ pointerX: visualState.pointerX, pointerY: visualState.pointerY, pointerVelocity: visualState.pointerVelocity, scroll: visualState.documentProgress })
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
  resize(width: number, height: number, dpr: number): void { this.controller?.resize(width, height, dpr) }
  render(context: SceneRenderContext): void {
    if (this.pageState.paused || context.visualState.reducedMotion) return
    this.controller?.render(context.visualState.timeMs)
  }
  shouldAnimate(): boolean { return !this.pageState.paused }
  dispose(): void { this.controller?.dispose(); this.controller = null }
}
