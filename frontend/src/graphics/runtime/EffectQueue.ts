import type { SceneRenderContext } from './types'

export interface RuntimeEffect {
  readonly enabled: boolean
  resize?(width: number, height: number, dpr: number): void
  render?(context: SceneRenderContext): void
  dispose?(): void
}

export class EffectQueue {
  private readonly effects = new Set<RuntimeEffect>()
  register(effect: RuntimeEffect): () => void {
    if (effect.enabled) this.effects.add(effect)
    return () => this.effects.delete(effect)
  }
  unregister(effect: RuntimeEffect): void { this.effects.delete(effect) }
  resize(width: number, height: number, dpr: number): void {
    for (const effect of this.effects) if (effect.enabled) effect.resize?.(width, height, dpr)
  }
  render(context: SceneRenderContext): void {
    for (const effect of this.effects) if (effect.enabled) effect.render?.(context)
  }
  dispose(): void {
    for (const effect of this.effects) effect.dispose?.()
    this.effects.clear()
  }
}
