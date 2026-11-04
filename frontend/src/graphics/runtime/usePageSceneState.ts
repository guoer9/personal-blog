import { shallowRef } from 'vue'
import { DomAnchorRegistry } from './DomAnchorRegistry'
import type { PageSceneBridge } from './types'

function cloneState<T>(state: T): T {
  if (state === null || typeof state !== 'object') return state
  if (Array.isArray(state)) return state.map((item) => cloneState(item)) as T
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) result[key] = cloneState(value)
  return result as T
}
export function createPageSceneBridge<TPageState>(initialState: TPageState): PageSceneBridge<TPageState> {
  const state = shallowRef(cloneState(initialState))
  const anchors = new DomAnchorRegistry()
  return {
    anchors,
    setState(nextState) { state.value = cloneState(nextState) },
    getState() { return cloneState(state.value) as Readonly<TPageState> },
    registerAnchor(id, element) { return anchors.register(id, element) },
    clear() { state.value = cloneState(initialState); anchors.clear() },
  }
}
export function usePageSceneState<TPageState>(initialState: TPageState): PageSceneBridge<TPageState> { return createPageSceneBridge(initialState) }
