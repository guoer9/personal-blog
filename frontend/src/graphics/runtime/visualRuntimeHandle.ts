import type { InjectionKey, Ref } from 'vue'
import type { PageSceneBridge } from './types'
import type { VisualRuntime } from './VisualRuntime'

export type VisualRuntimeHandle = VisualRuntime
export interface VisualRuntimeBridge {
  setPageState(pageId: string, state: unknown): void
  registerAnchor?(id: string, element: HTMLElement): () => void
  measureAnchors?(): void
}
export const visualRuntimeKey: InjectionKey<Ref<VisualRuntimeBridge | null>> = Symbol('visual-runtime')
export const visualPageSceneBridgeKey: InjectionKey<PageSceneBridge<unknown> | null> = Symbol('visual-page-scene-bridge')
