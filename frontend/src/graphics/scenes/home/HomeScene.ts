import { createLiquidScene, type LiquidSceneController } from '@/graphics/liquidScene'
import type { HomePageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'

export class HomeScene implements PageSceneModule<HomePageState> {
  readonly id = 'home' as const
  private controller: LiquidSceneController | null = null
  private pageState: HomePageState = { paused: false }

  mount(context: SceneContext): void {
    this.controller = createLiquidScene(context.renderer, { pointerX: 0, pointerY: 0, scroll: 0 })
  }
  enter(): void {}
  leave(): void {}
  update(visualState: Readonly<VisualState>, pageState: Readonly<HomePageState>): void {
    this.pageState = { ...(pageState || { paused: false }) }
    this.controller?.setInput({ pointerX: visualState.pointerX, pointerY: visualState.pointerY, scroll: visualState.documentProgress })
  }
  resize(width: number, height: number, dpr: number): void { this.controller?.resize(width, height, dpr) }
  render(context: SceneRenderContext): void {
    if (this.pageState.paused || context.visualState.reducedMotion) return
    this.controller?.render(context.visualState.timeMs)
  }
  dispose(): void { this.controller?.dispose(); this.controller = null }
}
