import type { InjectionKey, Ref } from 'vue'
import type { PageSceneBridge } from './types'
import type { VisualRuntime } from './VisualRuntime'

export type VisualRuntimeHandle = VisualRuntime
export const visualRuntimeKey: InjectionKey<Ref<VisualRuntimeHandle | null>> = Symbol('visual-runtime')
export const visualPageSceneBridgeKey: InjectionKey<PageSceneBridge<unknown> | null> = Symbol('visual-page-scene-bridge')
